// Lógica de la Edge Function `ai-generate`, sin nada de Deno: recibe sus
// dependencias (sesión, lectura del perfil, servicio de IA) y devuelve una
// `Response`. Así las pruebas la ejecutan en Node con la base de datos real y
// el proveedor simulado; `index.ts` solo la conecta con Supabase.
//
//   1. verifica la sesión (token del usuario);
//   2. valida la petición;
//   3. lee el perfil de marca CON LA IDENTIDAD DEL USUARIO (la RLS decide si lo ve);
//      si la marca redacta «por encargo a la agencia» (`brands.ai_mode = 'agency'`),
//      rechaza la petición (409 `agency_mode`) antes de tocar el cupo;
//   4. llama a la tarea, que pasa por el servicio: reservar cupo → generar → registrar.
//
// El permiso de «crear contenido en la marca» lo impone la base de datos al
// reservar el cupo (`ai_reserve_generation`, error 42501 → 403), antes de
// llamar a ningún proveedor: no hay forma de generar sin él.
//
// Una petición = una llamada al proveedor. Aquí no hay bucles ni reintentos.
import { AiError, type AiErrorCode, type AiService, type Json } from '../_shared/ai/contract.ts';
import { checkBrandCompliance } from '../_shared/ai/text/tasks/brand-check.ts';
import { generatePostCopy, type NetworkLimits } from '../_shared/ai/text/tasks/post-copy.ts';
import { proposeBrandProfile, type ProfileSource } from '../_shared/ai/text/tasks/profile-proposal.ts';
import { AiTaskInputError, type TaskMeta } from '../_shared/ai/text/tasks/shared.ts';

export const AI_GENERATE_ACTIONS = ['post.caption', 'profile.proposal', 'brand.check'] as const;
export type AiGenerateAction = (typeof AI_GENERATE_ACTIONS)[number];

export interface BrandProfileLookup {
  /** ¿Ve el usuario esta marca? Si no, se responde como si no existiera. */
  brandVisible: boolean;
  /** Perfil activo (`brand_profiles.data`), o `null` si la marca aún no tiene. */
  profile: Json | null;
  /** Cómo se redacta en la marca (`brands.ai_mode`). En `agency` no se usa este servicio. */
  aiMode: 'api' | 'agency';
}

export interface AiGenerateDeps {
  /** Valida el token de sesión y devuelve el usuario, o `null` si no vale. */
  authenticate(accessToken: string): Promise<{ userId: string } | null>;
  /** Lee la marca y su perfil activo con la identidad del usuario (RLS). */
  loadBrandProfile(accessToken: string, brandId: string): Promise<BrandProfileLookup>;
  service: AiService;
  /** Registro del servidor. Nunca recibe claves ni el contenido de la petición. */
  log?: (event: string, data: Record<string, unknown>) => void;
  /** Origen permitido para CORS (por defecto, cualquiera: la sesión va en cabecera, no en cookie). */
  allowedOrigin?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1_500_000;

const STATUS: Record<AiErrorCode, number> = {
  quota_exhausted: 402,
  quota_missing: 402,
  forbidden: 403,
  not_configured: 503,
  provider_failed: 502,
  provider_timeout: 504,
  invalid_output: 502,
  refused: 422,
  internal: 500,
};

/** Lo que la interfaz necesita de la generación; el coste se consulta en `ai_generations`. */
function strip(result: TaskMeta): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...result };
  for (const key of ['provider', 'model', 'usage', 'costMicros', 'latencyMs']) delete rest[key];
  return rest;
}

export function createAiGenerateHandler(deps: AiGenerateDeps): (request: Request) => Promise<Response> {
  const cors = {
    'access-control-allow-origin': deps.allowedOrigin ?? '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });
  const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    json(status, { error: { code, message, retryable: false, ...extra } });

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Esta función solo admite POST.');

    // 1. Sesión.
    const header = request.headers.get('authorization') ?? '';
    const accessToken = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (!accessToken) return fail(401, 'unauthenticated', 'Inicia sesión para usar la IA.');
    let user: { userId: string } | null;
    try {
      user = await deps.authenticate(accessToken);
    } catch {
      return fail(500, 'internal', 'No se ha podido comprobar la sesión. Inténtalo de nuevo.', { retryable: true });
    }
    if (!user) return fail(401, 'unauthenticated', 'La sesión ha caducado. Vuelve a iniciar sesión.');

    // 2. Petición.
    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large', 'La petición es demasiado grande.');
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'invalid_request', 'La petición no es JSON válido.');
    }
    const { action, brandId, input } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    if (typeof action !== 'string' || !(AI_GENERATE_ACTIONS as readonly string[]).includes(action)) {
      return fail(400, 'invalid_request', `Indica la acción: ${AI_GENERATE_ACTIONS.join(', ')}.`);
    }
    if (typeof brandId !== 'string' || !UUID.test(brandId)) {
      return fail(400, 'invalid_request', 'Indica la marca (brandId).');
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail(400, 'invalid_request', 'Faltan los datos de la petición (input).');
    }
    const data = input as Record<string, unknown>;
    const actor = { userId: user.userId, brandId };

    try {
      // 3. Perfil de marca, con la identidad del usuario.
      const lookup = await deps.loadBrandProfile(accessToken, brandId);
      if (!lookup.brandVisible) return fail(404, 'brand_not_found', 'No existe esa marca o no tienes acceso a ella.');
      // Modo agencia: la marca ha decidido que redacta la agencia por encargo.
      // Se impone aquí (no solo ocultando botones) y antes de reservar cupo.
      if (lookup.aiMode === 'agency') {
        return fail(
          409,
          'agency_mode',
          'Esta marca redacta por encargo a la agencia: pide la pieza desde «Encargos».',
        );
      }
      if (action !== 'profile.proposal' && lookup.profile === null) {
        return fail(409, 'brand_profile_missing', 'Esta marca todavía no tiene perfil. Complétalo antes de usar la IA.');
      }

      // 4. Tarea.
      let result: Record<string, unknown>;
      if (action === 'post.caption') {
        result = strip(
          await generatePostCopy(deps.service, actor, {
            brandProfile: lookup.profile,
            brief: data.brief as string,
            network: data.network as NetworkLimits,
            variants: data.variants === undefined ? 3 : (data.variants as number),
          }),
        );
      } else if (action === 'brand.check') {
        result = strip(
          await checkBrandCompliance(deps.service, actor, { brandProfile: lookup.profile, text: data.text as string }),
        );
      } else {
        result = strip(
          await proposeBrandProfile(deps.service, actor, {
            sources: data.sources as ProfileSource[],
            currentProfile: lookup.profile ?? undefined,
          }),
        );
      }
      return json(200, { action, ...result });
    } catch (error) {
      if (error instanceof AiTaskInputError) return fail(400, 'invalid_request', error.message);
      if (error instanceof AiError) {
        deps.log?.('ai_error', {
          action,
          brandId,
          code: error.code,
          generationId: error.generationId,
          // El motivo exacto (qué variable falta, qué respondió el proveedor) se queda en el servidor.
          detail: error.code === 'not_configured' ? error.message : error.details,
        });
        const message =
          error.code === 'not_configured'
            ? 'La IA no está disponible en este momento. Avisa a quien administra la plataforma.'
            : error.message;
        return json(STATUS[error.code], {
          error: { code: error.code, message, retryable: error.retryable, generationId: error.generationId },
        });
      }
      deps.log?.('unexpected_error', { action, brandId });
      return fail(500, 'internal', 'Algo ha fallado al usar la IA. Inténtalo de nuevo.', { retryable: true });
    }
  };
}
