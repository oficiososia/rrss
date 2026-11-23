// Lógica de la Edge Function `platform-integrations` (Plataforma → Integraciones).
// Sin nada de Deno: recibe sus dependencias y devuelve una `Response`, así las
// pruebas la ejecutan en Node con la base de datos real y servicios simulados.
//
// Una sola dirección, POST con `{ action, … }` y la sesión del usuario:
//   availability        cualquiera con sesión: qué integraciones están listas
//                       (solo booleanos), para que la interfaz enseñe lo que funciona.
//   status              superadministrador: qué ajustes hay guardados (los secretos,
//                       SIN valor: «configurado · …a1b2 · fecha · quién»), cuáles
//                       vienen de variables de entorno, la última prueba y la actividad.
//   save                superadministrador: guarda o borra ajustes de UNA integración
//                       (`values: { NOMBRE: "valor" | null }`).
//   test                superadministrador: «Probar conexión» (probes.ts). Con `service`
//                       (la tarjeta: openai, claude, fal, images_other) prueba solo lo suyo.
//   worker_check        superadministrador: estado de la máquina de Fly; si lleva
//                       encendida más de WORKER_MAX_UPTIME_HOURS levanta un aviso de plataforma.
//   ai_overview         superadministrador: qué modelo se sugiere para cada tarea de
//                       OpenAI y Claude, con los precios al día frente a los cargados
//                       (fuente de precios en _shared/integrations/pricing.ts, con caché).
//   ai_apply            superadministrador: aplica la configuración recomendada de IA
//                       (`defaults` al guardar la clave, `all` o solo `prices`);
//                       devuelve lo anterior para poder deshacerlo.
//   openai_region       superadministrador: pasa OpenAI al servidor europeo o al general.
//   generate_token_key  superadministrador: añade una clave nueva de cifrado de los
//                       tokens de las redes y la deja como la que cifra lo nuevo.
//   generate_worker_token  superadministrador: token nuevo del trabajador de medios
//                       para `worker-gateway`. Se guarda SOLO su huella SHA-256
//                       (WORKER_GATEWAY_TOKEN, cifrada en Vault) y el token sale
//                       una única vez en la respuesta, para pegarlo en Fly.
//
// El permiso lo impone la base de datos: las RPC de escritura se llaman con la
// sesión del usuario y rechazan a quien no es superadministrador. Ninguna
// respuesta lleva un valor secreto, y los registros tampoco.
import type { RpcClient } from '../_shared/ai/contract.ts';
import type { MediaModelRow } from '../_shared/ai/media/models.ts';
import { computeAvailability, NOTHING_AVAILABLE } from '../_shared/integrations/availability.ts';
import {
  INTEGRATION_IDS,
  INTEGRATION_SETTINGS,
  settingSpec,
  validateSetting,
  WORKER_GATEWAY_TOKEN_PATTERN,
  type IntegrationId,
} from '../_shared/integrations/catalog.ts';
import {
  buildAiOverview,
  buildApplyPlan,
  OPENAI_EU_BASE,
  OPENAI_GLOBAL_BASE,
  openAiRegion,
  wantedModels,
  type AiContext,
  type ApplyScope,
} from '../_shared/integrations/ai-setup.ts';
import { fetchPriceSource, loadPrices, parseSnapshot } from '../_shared/integrations/pricing.ts';
import {
  probeRecordId,
  WORKER_MAX_UPTIME_HOURS,
  type ProbeResult,
  type ProbeScope,
} from '../_shared/integrations/probes.ts';
import type { RecProvider } from '../_shared/integrations/recommendations.ts';
import type { Env, SettingsLoader } from '../_shared/integrations/settings.ts';

export interface PlatformIntegrationsDeps {
  /** Valida el token de sesión y devuelve el usuario, o `null`. */
  authenticate(accessToken: string): Promise<{ userId: string } | null>;
  /** RPC con la sesión del usuario (su JWT): la base de datos decide si es superadministrador. */
  userRpc(accessToken: string): RpcClient;
  /** RPC con la clave de servicio. */
  rpc: RpcClient;
  settings: SettingsLoader;
  /** Variables de entorno de la función: para decir qué viene de ahí (sin valores). */
  baseEnv: Env;
  /** Modelos de imagen activos (`ai_media_models`), con la clave de servicio. */
  imageModelRows(): Promise<MediaModelRow[]>;
  /** `scope`: la tarjeta que prueba, si la integración la comparten varias (probes.ts, PROBE_SCOPES). */
  probe(id: IntegrationId, env: Env, scope?: ProbeScope): Promise<ProbeResult>;
  /** Estado de la máquina de Fly (solo lectura); sin esto, `worker_check` dice que no se sabe. */
  workerMachine?(env: Env): Promise<{ state: string; startedAt: string | null } | { problem: string }>;
  /** Lee la fuente de precios (JSON ya leído). Lanza si falla. Por defecto, la real. */
  readPriceSource?: () => Promise<unknown>;
  /** Modelos que lista la cuenta de OpenAI (gratis); sin esto no se sabe cuáles tiene. */
  listOpenAiModels?: (env: Env) => Promise<{ models: string[] } | { problem: string }>;
  /** Activa en el registro de modelos de imagen los de OpenAI indicados; devuelve los que estaban apagados. */
  activateImageModels?: (models: string[]) => Promise<string[]>;
  /** 32 bytes aleatorios en base64 (clave nueva de cifrado de los tokens). */
  randomKey?: () => string;
  /** Token nuevo del trabajador («rrss_wgt_» + 32 bytes en base64url). */
  randomWorkerToken?: () => string;
  now?: () => Date;
  allowedOrigin?: string;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const isIntegration = (value: unknown): value is IntegrationId =>
  typeof value === 'string' && (INTEGRATION_IDS as readonly string[]).includes(value);

function defaultRandomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function defaultWorkerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `rrss_wgt_${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

/** Huella que se guarda del token del trabajador: «sha256:<hex>». */
export async function workerTokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createPlatformIntegrationsHandler(
  deps: PlatformIntegrationsDeps,
): (request: Request) => Promise<Response> {
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
  const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });
  const rpcFailure = (error: { code?: string; message: string }) =>
    error.code === '42501'
      ? fail(403, 'forbidden', 'Solo para superadministradores.')
      : error.code === '22023'
        ? fail(400, 'invalid', error.message)
        : fail(500, 'internal', 'No se ha podido completar. Inténtalo de nuevo.');

  async function availability() {
    try {
      const env = await deps.settings.get();
      return computeAvailability(env, await deps.imageModelRows());
    } catch {
      deps.log?.('availability_failed', {});
      return NOTHING_AVAILABLE;
    }
  }

  /** Ajustes guardados que no son secretos (para comparar y para poder deshacer). */
  async function storedPlain(): Promise<Record<string, string>> {
    const r = await deps.rpc('integration_settings_for_service', {});
    if (r.error) throw new Error('No se pudieron leer los ajustes');
    const all = (r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}) as Record<
      string,
      unknown
    >;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(all)) {
      if (settingSpec(key)?.secret === false && typeof value === 'string') out[key] = value;
    }
    return out;
  }

  /** Configuración efectiva, precios al día (con caché) y modelos de la cuenta. */
  async function aiContext(asUser: RpcClient, refresh: boolean) {
    deps.settings.invalidate();
    const env = await deps.settings.get();
    const stored = await storedPlain();
    const now = (deps.now ?? (() => new Date()))();
    const loaded = await loadPrices({
      stored: parseSnapshot(stored.AI_PRICE_SNAPSHOT),
      wanted: wantedModels(env),
      now,
      readSource: deps.readPriceSource ?? (() => fetchPriceSource()),
      force: refresh,
    });
    if (loaded.fresh && loaded.snapshot) {
      const saved = await asUser('admin_set_integration_setting', {
        p_key: 'AI_PRICE_SNAPSHOT',
        p_value: JSON.stringify(loaded.snapshot),
      });
      if (saved.error) deps.log?.('price_snapshot_not_saved', { code: saved.error.code ?? null });
      deps.settings.invalidate();
    }
    let available: Set<string> | null = null;
    let modelsProblem: string | null = null;
    if (!env.OPENAI_API_KEY?.trim()) modelsProblem = 'Falta la clave de OpenAI.';
    else if (deps.listOpenAiModels) {
      try {
        const listed = await deps.listOpenAiModels(env);
        if ('models' in listed) available = new Set(listed.models);
        else modelsProblem = listed.problem;
      } catch {
        modelsProblem = 'No se pudo mirar qué modelos tiene la cuenta de OpenAI.';
      }
    }
    const ctx: AiContext = { env, snapshot: loaded.snapshot, available };
    return {
      ctx,
      stored,
      info: {
        fetchedAt: loaded.snapshot?.fetchedAt ?? null,
        stale: loaded.problem !== undefined,
        problem: loaded.problem ?? null,
        modelsProblem,
      },
    };
  }

  /** Escribe los cambios (validados antes), con la sesión del superadministrador. */
  async function writeChanges(
    asUser: RpcClient,
    changes: Record<string, string | null>,
    stored: Record<string, string>,
  ): Promise<
    | Response
    | { previous: Record<string, string | null>; applied: Array<{ key: string; from: string | null; to: string | null }> }
  > {
    for (const [key, value] of Object.entries(changes)) {
      if (!settingSpec(key)) return fail(400, 'invalid', `«${key.slice(0, 64)}» no es un ajuste.`);
      if (value !== null) {
        const problem = validateSetting(key, value);
        if (problem) return fail(400, 'invalid', `${key}: ${problem}`);
      }
    }
    const previous: Record<string, string | null> = {};
    const applied: Array<{ key: string; from: string | null; to: string | null }> = [];
    for (const [key, value] of Object.entries(changes)) {
      previous[key] = stored[key] ?? null;
      const r =
        value === null
          ? await asUser('admin_delete_integration_setting', { p_key: key })
          : await asUser('admin_set_integration_setting', { p_key: key, p_value: value });
      if (r.error) {
        deps.settings.invalidate();
        deps.log?.('apply_failed', { key, code: r.error.code ?? null });
        return rpcFailure(r.error);
      }
      applied.push({ key, from: stored[key] ?? null, to: value });
    }
    deps.settings.invalidate();
    return { previous, applied };
  }

  /** ¿Es superadministrador? Se pregunta a la base de datos con su sesión. */
  async function requireAdmin(token: string): Promise<Response | null> {
    const r = await deps.userRpc(token)('admin_integration_tests', {});
    if (r.error) return rpcFailure(r.error);
    return null;
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Esta función solo admite POST.');

    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim();
    const user = token ? await deps.authenticate(token).catch(() => null) : null;
    if (!token || !user) return fail(401, 'unauthorized', 'Tu sesión ha caducado. Vuelve a iniciar sesión.');

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('no es un objeto');
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(400, 'bad_request', 'La petición no es válida.');
    }

    if (body.action === 'availability') return json(200, await availability());

    const denied = await requireAdmin(token);
    if (denied) return denied;
    const asUser = deps.userRpc(token);

    if (body.action === 'status') {
      const [settings, tests, audit] = await Promise.all([
        asUser('admin_integration_settings', {}),
        asUser('admin_integration_tests', {}),
        asUser('admin_integration_audit', { p_limit: 30 }),
      ]);
      for (const r of [settings, tests, audit]) if (r.error) return rpcFailure(r.error);
      const environment = INTEGRATION_SETTINGS.filter((s) => Boolean(deps.baseEnv[s.key]?.trim())).map((s) => s.key);
      return json(200, {
        settings: settings.data ?? [],
        tests: tests.data ?? [],
        audit: audit.data ?? [],
        environment,
        availability: await availability(),
      });
    }

    if (body.action === 'save') {
      if (!isIntegration(body.integration)) return fail(400, 'bad_request', 'Falta la integración.');
      const values = body.values;
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        return fail(400, 'bad_request', 'Faltan los valores.');
      }
      const entries = Object.entries(values as Record<string, unknown>);
      if (entries.length === 0 || entries.length > 60) return fail(400, 'bad_request', 'Faltan los valores.');
      // Todo se comprueba antes de guardar nada.
      for (const [key, value] of entries) {
        const spec = settingSpec(key);
        if (!spec || spec.integration !== body.integration) {
          return fail(400, 'invalid', `«${key.slice(0, 64)}» no es un ajuste de esta integración.`);
        }
        if (key === 'SOCIAL_TOKEN_KEYS') {
          return fail(400, 'invalid', 'Las claves de cifrado de los tokens solo se generan con «Generar clave».');
        }
        // Revocarlo (null) sí; ponerlo a mano, no.
        if (key === 'WORKER_GATEWAY_TOKEN' && value !== null) {
          return fail(400, 'invalid', 'El token del trabajador solo se genera con «Generar token».');
        }
        if (value !== null && typeof value !== 'string') return fail(400, 'invalid', `Valor no válido en ${key}.`);
        if (typeof value === 'string') {
          const problem = validateSetting(key, value);
          if (problem) return fail(400, 'invalid', `${key}: ${problem}`);
        }
      }
      for (const [key, value] of entries) {
        const r =
          value === null
            ? await asUser('admin_delete_integration_setting', { p_key: key })
            : await asUser('admin_set_integration_setting', { p_key: key, p_value: (value as string).trim() });
        if (r.error) {
          deps.settings.invalidate();
          deps.log?.('save_failed', { key, code: r.error.code ?? null });
          return rpcFailure(r.error);
        }
      }
      deps.settings.invalidate();
      deps.log?.('saved', { integration: body.integration, keys: entries.map(([k]) => k) });
      return json(200, { saved: entries.map(([k]) => k) });
    }

    if (body.action === 'test') {
      if (!isIntegration(body.integration)) return fail(400, 'bad_request', 'Falta la integración.');
      // `service`: la tarjeta que prueba, cuando varias comparten integración
      // (OpenAI y Claude; fal.ai y los demás de imagen). Cada una prueba, recibe
      // y anota solo lo suyo. Sin `service`, la prueba completa de siempre.
      let scope: ProbeScope | undefined;
      let record: string = body.integration;
      if (body.service !== undefined) {
        const own = probeRecordId(body.integration, body.service);
        if (!own) return fail(400, 'bad_request', 'Esa tarjeta no es de esta integración.');
        scope = body.service as ProbeScope;
        record = own;
      }
      deps.settings.invalidate();
      let result: ProbeResult;
      try {
        result = await deps.probe(body.integration, await deps.settings.get(), scope);
      } catch {
        deps.log?.('probe_failed', { integration: body.integration });
        result = { ok: false, message: 'No se pudo hacer la prueba (error inesperado del servidor).', checks: [] };
      }
      // Si la base de datos aún no admite la fila propia de la tarjeta (migración
      // 20270105010000 sin aplicar), la prueba se devuelve igual; solo no queda anotada.
      const recorded = await deps.rpc('integration_record_test', {
        p_user_id: user.userId,
        p_integration: record,
        p_ok: result.ok,
        p_message: result.message.slice(0, 500),
      });
      if (recorded.error) deps.log?.('record_test_failed', { record, code: recorded.error.code ?? null });
      deps.log?.('tested', { integration: body.integration, service: scope ?? null, ok: result.ok });
      return json(200, result);
    }

    if (body.action === 'ai_overview') {
      const { ctx, info } = await aiContext(asUser, body.refresh === true);
      return json(200, buildAiOverview(ctx, info));
    }

    if (body.action === 'ai_apply') {
      const provider = body.provider as RecProvider;
      const scope = body.scope as ApplyScope;
      if (provider !== 'openai' && provider !== 'claude') return fail(400, 'bad_request', 'Falta el proveedor.');
      if (scope !== 'defaults' && scope !== 'all' && scope !== 'prices') {
        return fail(400, 'bad_request', 'Falta qué aplicar.');
      }
      if (provider === 'claude' && scope !== 'prices') {
        return fail(400, 'bad_request', 'Claude solo tiene precios que aplicar: no hace falta configurarlo.');
      }
      const { ctx, stored } = await aiContext(asUser, false);
      if (provider === 'openai' && scope !== 'prices' && !ctx.env.OPENAI_API_KEY?.trim()) {
        return fail(400, 'invalid', 'Primero guarda la clave de OpenAI.');
      }
      if (!ctx.snapshot) {
        return fail(502, 'prices_unavailable', 'No se han podido leer los precios al día. Inténtalo de nuevo en un rato.');
      }
      const plan = buildApplyPlan(ctx, provider, scope);
      const written = await writeChanges(asUser, plan.changes, stored);
      if (written instanceof Response) return written;
      let activated: string[] = [];
      if (plan.activateImageModels.length > 0 && deps.activateImageModels) {
        try {
          activated = await deps.activateImageModels(plan.activateImageModels);
        } catch {
          deps.log?.('activate_image_models_failed', {});
          plan.notes.push('No se pudieron activar los modelos de imagen; actívalos en el registro de modelos.');
        }
      }
      deps.log?.('ai_applied', { provider, scope, keys: Object.keys(plan.changes) });
      return json(200, { ...written, notes: plan.notes, activatedImageModels: activated });
    }

    if (body.action === 'openai_region') {
      const region = body.region;
      if (region !== 'global' && region !== 'eu') return fail(400, 'bad_request', 'Falta la región.');
      const { ctx, stored } = await aiContext(asUser, false);
      const before = openAiRegion(ctx.env);
      const changes: Record<string, string | null> =
        region === 'global'
          ? { OPENAI_BASE_URL: OPENAI_GLOBAL_BASE, AI_ALLOW_NON_EU_PROCESSING: 'true', AI_MEDIA_ALLOW_NON_EU: 'true' }
          : { OPENAI_BASE_URL: OPENAI_EU_BASE };
      // Los precios que coincidían con la fuente siguen coincidiendo con el recargo nuevo.
      if (ctx.snapshot && before !== region) {
        const overview = buildAiOverview(ctx, { fetchedAt: null, stale: false, problem: null, modelsProblem: null });
        const onlyModels = new Set(overview.providers.openai.prices.filter((r) => r.status === 'same').map((r) => r.model));
        if (onlyModels.size > 0) {
          const plan = buildApplyPlan(ctx, 'openai', 'prices', { regionAfter: region, onlyModels });
          if (plan.changes.AI_PRICES) changes.AI_PRICES = plan.changes.AI_PRICES;
        }
      }
      const written = await writeChanges(asUser, changes, stored);
      if (written instanceof Response) return written;
      deps.log?.('openai_region', { region });
      return json(200, { ...written, notes: [] });
    }

    if (body.action === 'worker_check') {
      if (!deps.workerMachine) return json(200, { known: false, problem: 'No disponible en este entorno.' });
      deps.settings.invalidate();
      let machine: Awaited<ReturnType<NonNullable<typeof deps.workerMachine>>>;
      try {
        machine = await deps.workerMachine(await deps.settings.get());
      } catch {
        deps.log?.('worker_check_failed', {});
        return json(200, { known: false, problem: 'No se pudo consultar a Fly.' });
      }
      if ('problem' in machine) return json(200, { known: false, problem: machine.problem });
      const now = (deps.now ?? (() => new Date()))();
      const hours = machine.startedAt ? (now.getTime() - new Date(machine.startedAt).getTime()) / 3_600_000 : null;
      const tooLong = machine.state === 'started' && hours !== null && hours > WORKER_MAX_UPTIME_HOURS;
      if (tooLong) {
        const day = now.toISOString().slice(0, 10);
        const raised = await deps.rpc('platform_alert_external', {
          p_kind: 'worker_machine_long',
          p_key: `worker_machine_long:${day}`,
          p_title: 'La máquina del trabajador de medios lleva demasiado tiempo encendida',
          p_detail: `Lleva encendida unas ${Math.floor(hours!)} horas (lo normal es apagarse sola al vaciar la cola). Revisa si hay un trabajo atascado o si la máquina no se apaga; cada hora encendida cuesta dinero.`,
          p_data: { hours: Math.floor(hours!), started_at: machine.startedAt },
        });
        if (raised.error) deps.log?.('worker_alert_failed', { code: raised.error.code ?? null });
      }
      return json(200, { known: true, state: machine.state, startedAt: machine.startedAt, hours, tooLong });
    }

    if (body.action === 'generate_token_key') {
      const stored = await deps.rpc('integration_settings_for_service', {});
      if (stored.error) return fail(500, 'internal', 'No se han podido leer las claves actuales.');
      const current = (stored.data as Record<string, unknown> | null)?.SOCIAL_TOKEN_KEYS;
      const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/\D/g, '').slice(0, 14);
      const keyId = `k${stamp}`;
      const entry = `${keyId}:${(deps.randomKey ?? defaultRandomKey)()}`;
      const ring = typeof current === 'string' && current.trim() ? `${current.trim()},${entry}` : entry;
      for (const [key, value] of [
        ['SOCIAL_TOKEN_KEYS', ring],
        ['SOCIAL_TOKEN_KEY_ID', keyId],
      ] as const) {
        const r = await asUser('admin_set_integration_setting', { p_key: key, p_value: value });
        if (r.error) {
          deps.settings.invalidate();
          return rpcFailure(r.error);
        }
      }
      deps.settings.invalidate();
      deps.log?.('token_key_generated', { keyId });
      return json(200, { keyId });
    }

    if (body.action === 'generate_worker_token') {
      const token = (deps.randomWorkerToken ?? defaultWorkerToken)();
      if (!WORKER_GATEWAY_TOKEN_PATTERN.test(token)) return fail(500, 'internal', 'No se ha podido generar el token.');
      const r = await asUser('admin_set_integration_setting', {
        p_key: 'WORKER_GATEWAY_TOKEN',
        p_value: `sha256:${await workerTokenHash(token)}`,
      });
      deps.settings.invalidate();
      if (r.error) return rpcFailure(r.error);
      deps.log?.('worker_token_generated', {});
      // La única vez que sale: no se guarda ni se registra.
      return json(200, { token });
    }

    return fail(400, 'bad_request', 'Acción desconocida.');
  };
}
