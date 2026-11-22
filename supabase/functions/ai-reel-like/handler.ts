// Lógica de la Edge Function `ai-reel-like` («Hacer un reel como este»,
// docs/reel-como-este.md), sin nada de Deno: recibe sus dependencias y
// devuelve una `Response`. Las pruebas la ejecutan en Node con la base de datos
// real y el proveedor simulado (tests/db/reel-como-este.test.ts).
//
//   POST { action: "options", brandId }
//        → { available, reason?, speechAvailable, estimate, limits }
//          El coste MÁXIMO de un análisis, para enseñarlo antes de empezar.
//   POST { action: "create", brandId, referenceId }
//        → { status: "ready", result, costMicros }
//          La parte de IA de un análisis YA MEDIDO por el trabajador
//          (`media.reel.analyze`): transcribe la voz si se pidió, enseña los
//          fotogramas al modelo de visión y guarda plantilla, guion y textos.
//
// Reglas, las de toda la IA del producto:
//   * Sesión del usuario; la marca y el análisis se leen CON SU IDENTIDAD (RLS).
//   * Modo agencia (`brands.ai_mode = 'agency'`): como la IA de imagen y de
//     vídeo, solo la usa el personal de la agencia o de la plataforma
//     (`ai_brand_access`); el resto recibe 409 `agency_mode` antes de tocar el cupo.
//   * Permiso («editar la marca»), plan (`ai_text`) y cupo los impone la base
//     de datos al reservar (`ai_reserve_generation`); el coste queda en
//     `ai_generations` (propósitos `reel.like` y `reel.like.transcript`).
//   * Sin modelo con visión configurado, `available` es false y `create`
//     responde 503: no se simula nada.
//
// El vídeo de referencia no llega aquí: solo sus fotogramas y, si se pidió, el
// sonido. Al guardar el resultado se borran (y el vídeo subido también, salvo
// que la persona pidiera conservarlo como referencia privada).
import { AiError, type AiErrorCode, type AiInput, type AiService, type Json, type RpcClient } from '../_shared/ai/contract.ts';
import {
  reelLikeWorstCaseInput,
  studyReferenceReel,
  type ReelLikeFrame,
} from '../_shared/ai/text/tasks/reel-like.ts';
import { AiTaskInputError } from '../_shared/ai/text/tasks/shared.ts';
import { REFERENCE_TRANSCRIPT_PURPOSE } from '../_shared/ai/transcription/config.ts';
import { LIKE_LIMITS, parseMeasurement, parseReelLikeResult, REFERENCE_LIMITS } from '../_shared/reels/like.ts';

export const AI_REEL_LIKE_ACTIONS = ['options', 'create'] as const;

/** El análisis tal como lo ve la persona (RLS). */
export interface ReferenceRow {
  id: string;
  brand_id: string;
  organization_id: string;
  status: string;
  idea: string;
  measurement: Json | null;
  result: Json | null;
  cost_micros: number;
  error: string | null;
}

export interface ReelLikeBrand {
  /** ¿Ve la persona esta marca? Si no, se responde como si no existiera. */
  visible: boolean;
  /** Perfil activo, o null si la marca aún no tiene. */
  profile: Json | null;
  aiMode: 'api' | 'agency';
  /** ¿Es personal de la agencia o de la plataforma? (`ai_brand_access`) */
  agencyStaff: boolean;
  /** Carpetas y etiquetas que ya usa la biblioteca de la marca. */
  library: { folders: string[]; tags: string[] };
}

export interface AiReelLikeDeps {
  authenticate(accessToken: string): Promise<{ userId: string } | null>;
  loadBrand(accessToken: string, brandId: string): Promise<ReelLikeBrand>;
  loadReference(accessToken: string, referenceId: string): Promise<ReferenceRow | null>;
  /** Lee un archivo del análisis con la clave de servicio (en el almacén que sea); null si no está. */
  readFile(path: string): Promise<Uint8Array | null>;
  /** Borra archivos; devuelve los que se han borrado (o ya no estaban). */
  removeFiles(paths: string[]): Promise<string[]>;
  /** RPC con la clave de servicio. */
  rpc: RpcClient;
  textService: AiService;
  transcriptionService: AiService;
  /**
   * Coste máximo (micros) de una petición con el modelo de `reel.like`, sin
   * llamar a nadie; null si no hay un modelo con visión cargado y con precio.
   */
  estimateText(input: AiInput): number | null;
  /** Precio por segundo de la transcripción, o null si no hay. */
  transcriptionMicrosPerSecond: number | null;
  log?: (event: string, data: Record<string, unknown>) => void;
  allowedOrigin?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<AiErrorCode, number> = {
  quota_exhausted: 402,
  quota_missing: 402,
  ai_paused: 503,
  forbidden: 403,
  not_configured: 503,
  provider_failed: 502,
  provider_timeout: 504,
  invalid_output: 502,
  refused: 422,
  internal: 500,
};

/** Fallos de la transcripción que paran todo (no tiene sentido seguir gastando). */
const BLOCKING: AiErrorCode[] = ['quota_exhausted', 'quota_missing', 'ai_paused', 'forbidden'];

export function createAiReelLikeHandler(deps: AiReelLikeDeps): (request: Request) => Promise<Response> {
  const cors = {
    'access-control-allow-origin': deps.allowedOrigin ?? '*',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    json(status, { error: { code, message, retryable: false, ...extra } });

  const limits = {
    maxSeconds: REFERENCE_LIMITS.maxSeconds,
    maxUploadBytes: REFERENCE_LIMITS.maxUploadBytes,
    maxSpeechSeconds: REFERENCE_LIMITS.maxSpeechSeconds,
    maxFrames: LIKE_LIMITS.maxFrames,
  };

  async function serviceRpc(fn: string, args: Record<string, unknown>) {
    try {
      return await deps.rpc(fn, args);
    } catch {
      return { data: null, error: { message: 'Sin conexión con la base de datos' } };
    }
  }

  /** Coste máximo de un análisis para esta marca, o null si no se puede ofrecer. */
  function estimate(brandId: string, profile: Json) {
    const textMicros = deps.estimateText(reelLikeWorstCaseInput(brandId, profile));
    if (textMicros === null) return null;
    const speech = deps.transcriptionMicrosPerSecond;
    const speechMicros = speech === null ? 0 : Math.ceil(speech * REFERENCE_LIMITS.maxSpeechSeconds);
    return {
      /** Mirar los fotogramas y escribir, como mucho. */
      textMicros,
      /** Transcribir la voz, como mucho (0 si no hay transcripción). */
      speechMicros,
      speechMicrosPerSecond: speech,
      /** Todo junto, con la voz. */
      maxMicros: textMicros + speechMicros,
    };
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Esta función solo admite POST.');

    const header = request.headers.get('authorization') ?? '';
    const accessToken = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (!accessToken) return fail(401, 'unauthenticated', 'Inicia sesión para usar «Hacer un reel como este».');
    let user: { userId: string } | null;
    try {
      user = await deps.authenticate(accessToken);
    } catch {
      return fail(500, 'internal', 'No se ha podido comprobar la sesión. Inténtalo de nuevo.', { retryable: true });
    }
    if (!user) return fail(401, 'unauthenticated', 'La sesión ha caducado. Vuelve a iniciar sesión.');

    let body: { action?: unknown; brandId?: unknown; referenceId?: unknown };
    try {
      const raw = await request.text();
      if (raw.length > 10_000) return fail(413, 'too_large', 'La petición es demasiado grande.');
      body = JSON.parse(raw) as typeof body;
    } catch {
      return fail(400, 'invalid_request', 'La petición no es JSON válido.');
    }
    const { action, brandId, referenceId } = typeof body === 'object' && body !== null ? body : {};
    if (typeof action !== 'string' || !(AI_REEL_LIKE_ACTIONS as readonly string[]).includes(action)) {
      return fail(400, 'invalid_request', `Indica la acción: ${AI_REEL_LIKE_ACTIONS.join(', ')}.`);
    }
    if (typeof brandId !== 'string' || !UUID.test(brandId)) {
      return fail(400, 'invalid_request', 'Indica la marca (brandId).');
    }

    let brand: ReelLikeBrand;
    try {
      brand = await deps.loadBrand(accessToken, brandId);
    } catch {
      return fail(500, 'internal', 'No se ha podido leer la marca. Inténtalo de nuevo.', { retryable: true });
    }
    if (!brand.visible) return fail(404, 'brand_not_found', 'No existe esa marca o no tienes acceso a ella.');
    const agencyBlocked = brand.aiMode === 'agency' && !brand.agencyStaff;

    // ── Disponibilidad y coste máximo, para enseñarlos antes ──
    if (action === 'options') {
      const speechAvailable = deps.transcriptionMicrosPerSecond !== null;
      if (agencyBlocked) {
        return json(200, { available: false, reason: 'agency_mode', agencyMode: true, speechAvailable, estimate: null, limits });
      }
      const figures = estimate(brandId, brand.profile ?? {});
      if (!figures) {
        return json(200, { available: false, reason: 'not_configured', speechAvailable, estimate: null, limits });
      }
      if (brand.profile === null) {
        return json(200, { available: false, reason: 'profile_missing', speechAvailable, estimate: figures, limits });
      }
      return json(200, { available: true, speechAvailable, estimate: figures, limits });
    }

    // ── La parte de IA de un análisis ya medido ──
    if (typeof referenceId !== 'string' || !UUID.test(referenceId)) {
      return fail(400, 'invalid_request', 'Indica el análisis (referenceId).');
    }
    if (agencyBlocked) {
      return fail(
        409,
        'agency_mode',
        'Esta marca trabaja por encargo a la agencia: «Hacer un reel como este» lo usa el equipo de la agencia.',
      );
    }
    if (brand.profile === null) {
      return fail(409, 'brand_profile_missing', 'Esta marca todavía no tiene perfil. Complétalo antes de usar la IA.');
    }
    if (estimate(brandId, brand.profile) === null) {
      deps.log?.('not_configured', { brandId });
      return fail(503, 'not_configured', '«Hacer un reel como este» no está disponible. Avisa a quien administra la plataforma.');
    }

    let reference: ReferenceRow | null;
    try {
      reference = await deps.loadReference(accessToken, referenceId);
    } catch {
      return fail(500, 'internal', 'No se ha podido leer el análisis. Inténtalo de nuevo.', { retryable: true });
    }
    if (!reference || reference.brand_id !== brandId) {
      return fail(404, 'reference_not_found', 'No existe ese análisis o no tienes acceso a él.');
    }
    if (reference.status === 'ready') {
      const stored = parseReelLikeResult(reference.result);
      if (stored) return json(200, { status: 'ready', result: stored, costMicros: Number(reference.cost_micros) || 0 });
    }
    if (reference.status === 'analyzing') {
      return fail(409, 'not_measured', 'El vídeo todavía se está midiendo. Espera a que termine.', { retryable: true });
    }
    if (reference.status !== 'measured') {
      return fail(409, 'reference_closed', reference.error ?? 'Este análisis ya no se puede continuar: vuelve a subir el vídeo.');
    }
    const measurement = parseMeasurement(reference.measurement);
    if (!measurement) return fail(409, 'reference_closed', 'La medición del vídeo no se puede leer: vuelve a subirlo.');
    // Solo se leen archivos de la carpeta de ESTE análisis.
    const dir = `${reference.organization_id}/${reference.brand_id}/referencias/${reference.id}/`;
    const inDir = (path: string) => path.startsWith(dir) && !path.slice(dir.length).includes('/') && !path.includes('..');

    const claimed = await serviceRpc('reel_reference_claim', { p_reference_id: reference.id, p_claim: true });
    if (claimed.error) {
      return fail(500, 'internal', 'No se ha podido empezar el análisis. Inténtalo de nuevo.', { retryable: true });
    }
    if (claimed.data !== true) {
      return fail(409, 'busy', 'Este análisis ya se está escribiendo. Espera un momento.', { retryable: true });
    }
    const release = () => serviceRpc('reel_reference_claim', { p_reference_id: reference.id, p_claim: false });

    const actor = { userId: user.userId, brandId };
    const generationIds: string[] = [];
    let costMicros = 0;
    const notes: string[] = [];
    try {
      // 1. Fotogramas (los eligió y los midió el trabajador).
      const frames: ReelLikeFrame[] = [];
      for (const frame of measurement.frames.filter((f) => inDir(f.path))) {
        const data = await deps.readFile(frame.path);
        if (data && data.length > 0) frames.push({ data, mimeType: 'image/jpeg', shot: frame.shot, at: frame.at });
      }
      if (frames.length === 0) {
        await release();
        return fail(409, 'files_missing', 'Los fotogramas de este análisis ya no están. Vuelve a subir el vídeo.');
      }

      // 2. Lo que se dice (si se pidió y hay transcripción).
      const transcript: Array<{ start: number; text: string }> = [];
      const speech = measurement.audio.speech.filter((s) => inDir(s.path));
      if (speech.length > 0 && deps.transcriptionMicrosPerSecond === null) {
        notes.push('No se ha transcrito la voz: la transcripción no está configurada.');
      } else if (speech.length > 0) {
        const chunks: Array<{ data: Uint8Array; mimeType: string; seconds: number; start: number }> = [];
        for (const piece of speech) {
          const data = await deps.readFile(piece.path);
          if (data && data.length > 0) chunks.push({ data, mimeType: 'audio/mp4', seconds: piece.seconds, start: piece.start });
        }
        if (chunks.length > 0) {
          try {
            const heard = await deps.transcriptionService.generate({
              ...actor,
              task: 'transcription',
              purpose: REFERENCE_TRANSCRIPT_PURPOSE,
              input: {
                prompt: 'Transcribe literalmente lo que se dice.',
                audio: { chunks: chunks.map(({ data, mimeType, seconds }) => ({ data, mimeType, seconds })) },
              },
            });
            generationIds.push(heard.generationId);
            costMicros += heard.costMicros;
            const segments = Array.isArray(heard.output.segments) ? heard.output.segments : [];
            for (const segment of segments) {
              const entry = segment as { index?: unknown; text?: unknown } | null;
              const chunk = typeof entry?.index === 'number' ? chunks[entry.index] : undefined;
              if (chunk && typeof entry?.text === 'string' && entry.text.trim()) {
                transcript.push({ start: chunk.start, text: entry.text.trim() });
              }
            }
          } catch (error) {
            if (error instanceof AiError && BLOCKING.includes(error.code)) throw error;
            deps.log?.('transcription_failed', { brandId, code: error instanceof AiError ? error.code : 'unexpected' });
            notes.push('No se ha podido transcribir la voz: el guion sale solo de las imágenes.');
          }
        }
      }

      // 3. Mirar los fotogramas y escribir.
      const studied = await studyReferenceReel(deps.textService, actor, {
        brandProfile: brand.profile,
        measurement,
        frames,
        transcript,
        idea: reference.idea,
        library: brand.library,
      });
      generationIds.push(studied.generationId);
      costMicros += studied.costMicros;
      const result = { ...studied.result, notes: [...notes, ...studied.result.notes].slice(0, 12) };

      // 4. Guardar y borrar los archivos del análisis.
      const finished = await serviceRpc('reel_reference_finish', {
        p_reference_id: reference.id,
        p_result: result,
        p_cost_micros: costMicros,
        p_generation_ids: generationIds,
      });
      if (finished.error) {
        await release();
        return fail(500, 'internal', 'No se ha podido guardar el resultado. Inténtalo de nuevo.', { retryable: true });
      }
      const paths = Array.isArray(finished.data) ? finished.data.filter((p): p is string => typeof p === 'string') : [];
      try {
        const removed = paths.length > 0 ? await deps.removeFiles(paths) : [];
        if (removed.length > 0) await serviceRpc('media_storage_forget_paths', { p_paths: removed });
        if (removed.length < paths.length) deps.log?.('files_left_for_cleanup', { brandId, left: paths.length - removed.length });
      } catch {
        // Ya están en la cola de limpieza: los borra el barrido de siempre.
        deps.log?.('files_left_for_cleanup', { brandId, left: paths.length });
      }
      // De paso, los análisis abandonados de la marca sueltan sus archivos.
      await serviceRpc('reel_references_expire', { p_brand_id: brandId });
      return json(200, { status: 'ready', result, costMicros });
    } catch (error) {
      await release();
      if (error instanceof AiTaskInputError) return fail(400, 'invalid_request', error.message);
      if (error instanceof AiError) {
        deps.log?.('ai_error', {
          brandId,
          code: error.code,
          generationId: error.generationId,
          detail: error.code === 'not_configured' ? error.message : error.details,
        });
        const message =
          error.code === 'not_configured'
            ? '«Hacer un reel como este» no está disponible. Avisa a quien administra la plataforma.'
            : error.message;
        return json(STATUS[error.code], {
          error: { code: error.code, message, retryable: error.retryable, generationId: error.generationId },
        });
      }
      deps.log?.('unexpected_error', { brandId });
      return fail(500, 'internal', 'Algo ha fallado al estudiar el vídeo. Inténtalo de nuevo.', { retryable: true });
    }
  };
}
