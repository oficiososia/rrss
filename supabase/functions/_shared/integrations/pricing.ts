// Precios al día de los modelos de OpenAI y Claude, leídos por el SERVIDOR.
//
// Fuente: el JSON de precios de LiteLLM en GitHub (BerriAI/litellm,
// model_prices_and_context_window.json). Ni OpenAI ni Anthropic publican una API
// oficial de tarifas. Se eligió ésta (consultadas el 22/11/2026) porque:
//   * trae, para los dos proveedores, texto (por token, con caché), transcripción
//     (por segundo) e imagen (por token de imagen); OpenRouter solo trae texto;
//   * cada entrada de OpenAI cita su página oficial de precios (`source`);
//   * se contrastaron gpt-6-luna, gpt-6.1-terra, claude-haiku-5-5 y
//     claude-sonnet-5-5 contra el listado de OpenRouter y coinciden.
// No es la tarifa oficial de la cuenta (descuentos, volumen, recargos) y puede
// tardar en reflejar un cambio: la pantalla lo dice siempre junto a la fecha.
//
// La lectura se guarda como ajuste `AI_PRICE_SNAPSHOT` (caché de 12 h y último
// valor bueno si la fuente falla). Nunca se llama desde el navegador.
//
// Sin dependencias de Deno ni de Node.

export const PRICE_SOURCE = {
  id: 'litellm',
  name: 'LiteLLM',
  url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  /** Dónde se ve la tarifa oficial. */
  official: {
    openai: 'https://developers.openai.com/api/docs/pricing',
    claude: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
} as const;

/** Cuánto vale una lectura antes de volver a pedirla. */
export const PRICE_TTL_MS = 12 * 3_600_000;
/** Con «Actualizar», no más de una lectura cada tanto. */
export const PRICE_MIN_REFRESH_MS = 10 * 60_000;
/** Si la fuente pesa más, se descarta (hoy ~5 MB). */
export const PRICE_SOURCE_MAX_BYTES = 30_000_000;

/** Un modelo en la lectura. Precios en dólares por millón de tokens; la transcripción, por segundo. */
export interface PriceEntry {
  /** `openai` o `claude`. */
  provider: 'openai' | 'claude';
  mode: 'chat' | 'transcription' | 'image';
  inputPerM?: number;
  outputPerM?: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  perSecond?: number;
  /** Imagen: por millón de tokens de imagen (no hay precio por imagen en la fuente). */
  imageInputPerM?: number;
  imageOutputPerM?: number;
}

export interface PriceSnapshot {
  source: string;
  url: string;
  /** Cuándo se leyó (ISO). */
  fetchedAt: string;
  models: Record<string, PriceEntry>;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const perM = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;
};

/**
 * Saca de la fuente los modelos pedidos. Un modelo que la fuente no trae, o que
 * trae de otro proveedor, no aparece (la pantalla dice «la fuente no lo trae»).
 */
export function extractSnapshot(
  raw: unknown,
  wanted: { openai: string[]; claude: string[] },
  now: Date,
): PriceSnapshot {
  const table = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const models: Record<string, PriceEntry> = {};
  const take = (id: string, provider: 'openai' | 'claude') => {
    const e = table[id];
    if (typeof e !== 'object' || e === null) return;
    const row = e as Record<string, unknown>;
    if (row.litellm_provider !== (provider === 'openai' ? 'openai' : 'anthropic')) return;
    if (row.mode === 'chat') {
      const inputPerM = perM(row.input_cost_per_token);
      const outputPerM = perM(row.output_cost_per_token);
      if (inputPerM === undefined || outputPerM === undefined) return;
      models[id] = {
        provider,
        mode: 'chat',
        inputPerM,
        outputPerM,
        cacheReadPerM: perM(row.cache_read_input_token_cost),
        cacheWritePerM: perM(row.cache_creation_input_token_cost),
      };
    } else if (row.mode === 'audio_transcription') {
      const perSecond = num(row.input_cost_per_second);
      if (perSecond === undefined) return;
      models[id] = { provider, mode: 'transcription', perSecond };
    } else if (row.mode === 'image_generation') {
      const imageInputPerM = perM(row.input_cost_per_image_token);
      const imageOutputPerM = perM(row.output_cost_per_image_token);
      if (imageInputPerM === undefined && imageOutputPerM === undefined) return;
      models[id] = {
        provider,
        mode: 'image',
        inputPerM: perM(row.input_cost_per_token),
        imageInputPerM,
        imageOutputPerM,
      };
    }
  };
  for (const id of new Set(wanted.openai)) take(id, 'openai');
  for (const id of new Set(wanted.claude)) take(id, 'claude');
  return { source: PRICE_SOURCE.name, url: PRICE_SOURCE.url, fetchedAt: now.toISOString(), models };
}

/** Lee lo guardado; `null` si no hay o está roto. */
export function parseSnapshot(raw: string | undefined): PriceSnapshot | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PriceSnapshot> | null;
    if (!p || typeof p !== 'object' || typeof p.fetchedAt !== 'string' || !p.models || typeof p.models !== 'object') {
      return null;
    }
    if (Number.isNaN(Date.parse(p.fetchedAt))) return null;
    return {
      source: typeof p.source === 'string' ? p.source : PRICE_SOURCE.name,
      url: typeof p.url === 'string' ? p.url : PRICE_SOURCE.url,
      fetchedAt: p.fetchedAt,
      models: p.models as Record<string, PriceEntry>,
    };
  } catch {
    return null;
  }
}

export function snapshotAgeMs(snapshot: PriceSnapshot | null, now: Date): number {
  return snapshot ? now.getTime() - Date.parse(snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
}

export interface PriceFetchResult {
  /** La lectura que se usa (nueva, o la guardada si la fuente falló). */
  snapshot: PriceSnapshot | null;
  /** `true` si se ha leído de la fuente ahora y hay que guardarla. */
  fresh: boolean;
  /** Si la fuente falló y se usa lo guardado (o nada), por qué. */
  problem?: string;
}

/**
 * Devuelve la lectura a usar: la guardada si es reciente; si no, lee la fuente.
 * Si la fuente falla, devuelve la guardada con el motivo (nunca lanza).
 */
export async function loadPrices(options: {
  stored: PriceSnapshot | null;
  wanted: { openai: string[]; claude: string[] };
  now: Date;
  /** Pide la fuente (JSON ya leído). Lanza si falla. */
  readSource: () => Promise<unknown>;
  /** `true` = «Actualizar» (salta la caché, salvo lectura muy reciente). */
  force?: boolean;
}): Promise<PriceFetchResult> {
  const age = snapshotAgeMs(options.stored, options.now);
  // Un modelo que la lectura guardada no trae sale como «la fuente no lo trae» hasta la siguiente
  // lectura (12 h) o hasta «Actualizar»: no se pide la fuente (5 MB) solo por eso.
  const useStored = options.stored !== null && (options.force ? age < PRICE_MIN_REFRESH_MS : age < PRICE_TTL_MS);
  if (useStored) return { snapshot: options.stored, fresh: false };
  try {
    const raw = await options.readSource();
    const snapshot = extractSnapshot(raw, options.wanted, options.now);
    if (Object.keys(snapshot.models).length === 0) {
      return {
        snapshot: options.stored,
        fresh: false,
        problem: 'La fuente de precios respondió, pero no trae ninguno de los modelos que se usan.',
      };
    }
    return { snapshot, fresh: true };
  } catch {
    return {
      snapshot: options.stored,
      fresh: false,
      problem: options.stored
        ? 'No se pudo leer la fuente de precios: se usan los últimos precios guardados.'
        : 'No se pudo leer la fuente de precios y todavía no hay ninguna lectura guardada.',
    };
  }
}

/** Pide la fuente real (solo servidor). Lanza si no responde bien o pesa demasiado. */
export async function fetchPriceSource(fetchFn: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchFn(PRICE_SOURCE.url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > PRICE_SOURCE_MAX_BYTES) throw new Error('demasiado grande');
  const text = await response.text();
  if (text.length > PRICE_SOURCE_MAX_BYTES) throw new Error('demasiado grande');
  return JSON.parse(text);
}
