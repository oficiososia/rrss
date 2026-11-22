// Lógica (pura) de la configuración recomendada de la IA en Integraciones:
//   * `buildAiOverview`: lo que la pantalla enseña de OpenAI y Claude (qué modelo
//     se sugiere para cada tarea, cuánto cuesta un uso, los precios al día frente
//     a los cargados en la app);
//   * `buildApplyPlan`: qué ajustes cambiar para aplicar los valores por defecto
//     al guardar la clave, la configuración recomendada entera o solo los precios.
//
// No lee claves ni llama a la red: recibe lo guardado (sin secretos), la lectura
// de precios y la lista de modelos de la cuenta. Sin dependencias de Deno ni de Node.
import { parsePrices, TEXT_PURPOSES } from '../ai/text/config.ts';
import { DEFAULT_TRANSCRIPTION_PRICES } from '../ai/transcription/config.ts';
import {
  EU_SURCHARGE,
  RECOMMENDED_TASKS,
  SEEDED_OPENAI_IMAGE_MODELS,
  candidateModels,
  type RecCandidate,
  type RecProvider,
  type RecTask,
} from './recommendations.ts';
import { PRICE_SOURCE, type PriceEntry, type PriceSnapshot } from './pricing.ts';
import type { Env } from './settings.ts';

export { TEXT_PURPOSES };

export const OPENAI_EU_BASE = 'https://eu.api.openai.com';
export const OPENAI_GLOBAL_BASE = 'https://api.openai.com';

/** Dónde procesa OpenAI con la configuración dada. */
export type OpenAiRegion = 'eu' | 'global' | 'unset';

export function openAiRegion(env: Env): OpenAiRegion {
  const raw = env.OPENAI_BASE_URL?.trim();
  if (!raw) return 'unset';
  try {
    return new URL(raw).hostname === 'eu.api.openai.com' ? 'eu' : 'global';
  } catch {
    return 'global';
  }
}

/** Precio cargado o esperado, en micros por unidad (1 micro por token = 1 dólar por millón). */
export interface MicroPrice {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_write_input_tokens?: number;
  audio_seconds?: number;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Los micros que corresponden a una lectura de la fuente, con el recargo regional si lo hay. */
export function expectedMicros(entry: PriceEntry, surcharge: number): MicroPrice | null {
  if (entry.mode === 'chat' && entry.inputPerM !== undefined && entry.outputPerM !== undefined) {
    const out: MicroPrice = {
      input_tokens: round4(entry.inputPerM * surcharge),
      output_tokens: round4(entry.outputPerM * surcharge),
      cache_read_input_tokens: round4((entry.cacheReadPerM ?? entry.inputPerM) * surcharge),
    };
    if (entry.provider === 'claude') {
      out.cache_write_input_tokens = round4((entry.cacheWritePerM ?? entry.inputPerM * 1.25) * surcharge);
    }
    return out;
  }
  if (entry.mode === 'transcription' && entry.perSecond !== undefined) {
    return { audio_seconds: round4(entry.perSecond * 1_000_000 * surcharge) };
  }
  return null;
}

export type PriceStatus = 'same' | 'different' | 'none' | 'no_source';

const close = (a: number | undefined, b: number | undefined) =>
  a !== undefined && b !== undefined && Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.005);

export function comparePrices(loaded: MicroPrice | null, expected: MicroPrice | null): PriceStatus {
  if (!expected) return 'no_source';
  if (!loaded) return 'none';
  const keys = Object.keys(expected).filter(
    (k) => k !== 'cache_read_input_tokens' && k !== 'cache_write_input_tokens',
  ) as Array<keyof MicroPrice>;
  return keys.every((k) => close(loaded[k], expected[k])) ? 'same' : 'different';
}

// ───────────────────────────── contexto ─────────────────────────────

export interface AiContext {
  /** Configuración efectiva (base de datos sobre entorno). */
  env: Env;
  snapshot: PriceSnapshot | null;
  /** Modelos de la cuenta de OpenAI; `null` si no se pudo mirar. */
  available: Set<string> | null;
}

const priced = (ctx: AiContext, provider: RecProvider, model: string) => {
  const entry = ctx.snapshot?.models[model];
  return entry && entry.provider === provider ? entry : undefined;
};

/** Claves de AI_PRICES con las que se carga cada proveedor. */
const PRICE_PREFIXES: Record<RecProvider, string[]> = {
  openai: ['openai'],
  claude: ['anthropic-vertex', 'anthropic', 'anthropic-bedrock'],
};

function loadedFor(ctx: AiContext, provider: RecProvider, model: string): { key: string; price: MicroPrice | null } {
  const table = parsePrices(ctx.env.AI_PRICES, []);
  for (const prefix of PRICE_PREFIXES[provider]) {
    const found = table[`${prefix}/${model}`];
    if (found) return { key: `${prefix}/${model}`, price: found };
  }
  const key = `${PRICE_PREFIXES[provider][0]}/${model}`;
  // La transcripción tiene precio por defecto en el código.
  if (provider === 'openai' && DEFAULT_TRANSCRIPTION_PRICES[model] !== undefined) {
    return { key, price: { audio_seconds: DEFAULT_TRANSCRIPTION_PRICES[model] } };
  }
  return { key, price: null };
}

/** Recargo de la UE que se aplica a los precios de un proveedor con esta configuración. */
export function surchargeFor(env: Env, provider: RecProvider): number {
  if (provider === 'openai') return openAiRegion(env) === 'eu' ? EU_SURCHARGE : 1;
  // Claude por Vertex o Bedrock con punto europeo (lo que usa la aplicación por defecto).
  return EU_SURCHARGE;
}

// ───────────────────────────── elección ─────────────────────────────

export interface Pick {
  candidate: RecCandidate;
  /** Posición en la lista de preferencia (0 = la primera). */
  index: number;
  /** `true` si la cuenta lo lista; `null` si no se pudo mirar. */
  available: boolean | null;
}

/**
 * El primer candidato que existe en la cuenta (si se sabe) y tiene precio (si
 * es de texto o transcripción). Si ninguno cumple, `null`.
 */
export function pickCandidate(ctx: AiContext, task: RecTask, provider: RecProvider): Pick | null {
  const list = task.candidates[provider] ?? [];
  for (const [index, candidate] of list.entries()) {
    const available = provider === 'openai' && ctx.available ? ctx.available.has(candidate.model) : null;
    if (available === false) continue;
    if (task.kind !== 'image') {
      const hasSource = priced(ctx, provider, candidate.model) !== undefined;
      const hasLoaded = loadedFor(ctx, provider, candidate.model).price !== null;
      if (!hasSource && !hasLoaded) continue;
    }
    return { candidate, index, available };
  }
  return null;
}

/** Céntimos de dólar por uso (con recargo), o `null` si no se puede calcular. */
export function estimateCents(ctx: AiContext, task: RecTask, provider: RecProvider, model: string): number | null {
  const entry = priced(ctx, provider, model);
  const surcharge = surchargeFor(ctx.env, provider);
  if (task.kind === 'text' && task.usage) {
    let inputPerM: number | undefined;
    let outputPerM: number | undefined;
    if (entry) {
      inputPerM = entry.inputPerM === undefined ? undefined : entry.inputPerM * surcharge;
      outputPerM = entry.outputPerM === undefined ? undefined : entry.outputPerM * surcharge;
    } else {
      const loaded = loadedFor(ctx, provider, model).price;
      inputPerM = loaded?.input_tokens;
      outputPerM = loaded?.output_tokens;
    }
    if (inputPerM === undefined || outputPerM === undefined) return null;
    const usd = (task.usage.inputTokens * inputPerM + task.usage.outputTokens * outputPerM) / 1_000_000;
    return usd * 100;
  }
  if (task.kind === 'transcription') {
    const perSecond = entry?.perSecond;
    if (perSecond !== undefined) return perSecond * 60 * 100 * surcharge;
    const loaded = loadedFor(ctx, provider, model).price?.audio_seconds;
    return loaded === undefined ? null : (loaded * 60 * 100) / 1_000_000;
  }
  return null; // imagen: la fuente da el precio por token de imagen, no por imagen
}

// ───────────────────────────── resumen para la pantalla ─────────────────────────────

export interface TaskView {
  id: string;
  label: string;
  kind: RecTask['kind'];
  unit: string;
  recommended: null | {
    model: string;
    why: string;
    measured: string;
    centsPerUse: number | null;
    /** Qué se ha tenido que saltar: «gpt-6-luna no está en tu cuenta». */
    skipped: string[];
    /** `true` si no se ha podido mirar qué modelos tiene la cuenta. */
    unchecked: boolean;
  };
  /** Por qué no hay recomendación. */
  none?: string;
  /** El modelo que usa hoy esta tarea, si hay uno elegido. */
  current: string | null;
}

export interface PriceRow {
  provider: RecProvider;
  model: string;
  usedFor: string[];
  /** Precio de la fuente (dólares por millón / por segundo), sin recargo. */
  source: PriceEntry | null;
  /** Lo que debería cargarse en la app con la configuración actual (con recargo). */
  expected: MicroPrice | null;
  /** Lo que tiene cargado la app. */
  loaded: MicroPrice | null;
  status: PriceStatus;
  surcharge: number;
}

export interface AiOverview {
  source: {
    name: string;
    url: string;
    officialUrl: Record<RecProvider, string>;
    fetchedAt: string | null;
    /** `true` si la lectura es la guardada porque la fuente falló o está desactualizada. */
    stale: boolean;
    problem: string | null;
  };
  region: OpenAiRegion;
  openaiModels: { known: boolean; problem: string | null };
  providers: Record<
    RecProvider,
    {
      tasks: TaskView[];
      prices: PriceRow[];
      /** Dólares al mes de un uso normal (texto y subtítulos), y qué no cuenta. */
      monthly: { usd: number | null; notCounted: string[] };
      /** Cuántos precios cargados no coinciden con la fuente. */
      differing: number;
    }
  >;
}

function currentModel(env: Env, task: RecTask): string | null {
  if (task.kind === 'transcription') return env.AI_TRANSCRIPTION_MODEL?.trim() || null;
  if (task.kind === 'image') return env.AI_MEDIA_IMAGE_MODEL?.trim() || null;
  const prefix = task.prefix!;
  const provider = env[`${prefix}_PROVIDER`]?.trim() || env.AI_TEXT_PROVIDER?.trim();
  const model = env[`${prefix}_MODEL`]?.trim() || env.AI_TEXT_MODEL?.trim();
  return provider && model ? `${provider}/${model}` : null;
}

const TEXT_ROUTE_PROVIDERS: Record<RecProvider, string[]> = {
  openai: ['openai'],
  claude: ['anthropic-vertex', 'anthropic', 'anthropic-bedrock'],
};

export function buildAiOverview(
  ctx: AiContext,
  info: { fetchedAt: string | null; stale: boolean; problem: string | null; modelsProblem: string | null },
): AiOverview {
  const providers = {} as AiOverview['providers'];
  for (const provider of ['openai', 'claude'] as const) {
    const tasks: TaskView[] = [];
    const rows = new Map<string, PriceRow>();
    const addRow = (model: string, usedFor: string) => {
      const existing = rows.get(model);
      if (existing) {
        if (!existing.usedFor.includes(usedFor)) existing.usedFor.push(usedFor);
        return;
      }
      const source = priced(ctx, provider, model) ?? null;
      const surcharge = surchargeFor(ctx.env, provider);
      const expected = source ? expectedMicros(source, surcharge) : null;
      const loaded = loadedFor(ctx, provider, model).price;
      rows.set(model, {
        provider,
        model,
        usedFor: [usedFor],
        source,
        expected,
        loaded,
        status: source?.mode === 'image' ? 'no_source' : comparePrices(loaded, expected),
        surcharge,
      });
    };
    let usd = 0;
    let any = false;
    const notCounted: string[] = [];
    for (const task of RECOMMENDED_TASKS) {
      if (!task.candidates[provider]) continue;
      const pick = pickCandidate(ctx, task, provider);
      const list = task.candidates[provider]!;
      const current = currentModel(ctx.env, task);
      if (!pick) {
        tasks.push({
          id: task.id,
          label: task.label,
          kind: task.kind,
          unit: task.unit,
          recommended: null,
          none:
            task.kind === 'image'
              ? 'Tu cuenta no lista ningún modelo de imagen de OpenAI (puede hacer falta verificar la organización).'
              : 'Ningún modelo de la lista está disponible en tu cuenta o tiene precio en la fuente.',
          current,
        });
        continue;
      }
      const skipped = list.slice(0, pick.index).map((c) => c.model);
      const centsPerUse = estimateCents(ctx, task, provider, pick.candidate.model);
      tasks.push({
        id: task.id,
        label: task.label,
        kind: task.kind,
        unit: task.unit,
        recommended: {
          model: pick.candidate.model,
          why: pick.candidate.why,
          measured: pick.candidate.measured,
          centsPerUse,
          skipped,
          unchecked: provider === 'openai' && pick.available === null,
        },
        current,
      });
      if (task.kind !== 'image') addRow(pick.candidate.model, task.label);
      if (task.kind === 'image') notCounted.push(task.label);
      else if (centsPerUse !== null) {
        usd += (centsPerUse / 100) * task.monthlyUses;
        any = true;
      } else notCounted.push(task.label);
    }
    // Lo que está configurado hoy y no es una recomendación: también se compara.
    for (const task of RECOMMENDED_TASKS) {
      if (task.kind !== 'text') continue;
      const current = currentModel(ctx.env, task);
      const [prov, ...rest] = (current ?? '').split('/');
      if (current && TEXT_ROUTE_PROVIDERS[provider].includes(prov!)) addRow(rest.join('/'), task.label);
    }
    const prices = [...rows.values()];
    providers[provider] = {
      tasks,
      prices,
      monthly: { usd: any ? Math.round(usd * 100) / 100 : null, notCounted },
      differing: prices.filter((r) => r.status === 'different' || r.status === 'none').length,
    };
  }
  return {
    source: {
      name: PRICE_SOURCE.name,
      url: PRICE_SOURCE.url,
      officialUrl: { openai: PRICE_SOURCE.official.openai, claude: PRICE_SOURCE.official.claude },
      fetchedAt: ctx.snapshot?.fetchedAt ?? info.fetchedAt,
      stale: info.stale,
      problem: info.problem,
    },
    region: openAiRegion(ctx.env),
    openaiModels: { known: ctx.available !== null, problem: info.modelsProblem },
    providers,
  };
}

/** Todos los modelos cuyos precios hay que pedir a la fuente (recomendados y configurados). */
export function wantedModels(env: Env): { openai: string[]; claude: string[] } {
  const openai = new Set(candidateModels('openai'));
  const claude = new Set(candidateModels('claude'));
  for (const task of RECOMMENDED_TASKS) {
    const current = currentModel(env, task);
    if (!current) continue;
    const [prov, ...rest] = current.split('/');
    const model = rest.join('/');
    if (prov === 'openai' && task.kind !== 'image') openai.add(model);
    if (prov?.startsWith('anthropic') && task.kind === 'text') claude.add(model);
  }
  for (const key of Object.keys(parsePrices(env.AI_PRICES, []))) {
    const [prov, ...rest] = key.split('/');
    if (prov === 'openai') openai.add(rest.join('/'));
    if (prov?.startsWith('anthropic')) claude.add(rest.join('/'));
  }
  return { openai: [...openai], claude: [...claude] };
}

// ───────────────────────────── aplicar ─────────────────────────────

export type ApplyScope = 'defaults' | 'all' | 'prices';

export interface ApplyPlan {
  /** Ajustes a cambiar (`null` = borrar). Solo los que de verdad cambian. */
  changes: Record<string, string | null>;
  /** Frases para decir qué se ha hecho (y qué no). */
  notes: string[];
  /** Modelos de imagen sembrados que hay que activar en el registro de modelos. */
  activateImageModels: string[];
}

const same = (a: string | undefined, b: string | null) => (a?.trim() || null) === b;

/**
 * Qué cambiar para aplicar la recomendación de un proveedor.
 *   defaults  al guardar la clave: solo rellena lo que falta, no pisa nada.
 *   all       «Usar la configuración recomendada»: sustituye modelos y precios.
 *   prices    «Usar estos precios»: solo la tabla de precios.
 * `ctx.env` es la configuración efectiva ANTES de aplicar.
 */
export function buildApplyPlan(
  ctx: AiContext,
  provider: RecProvider,
  scope: ApplyScope,
  options: { regionAfter?: OpenAiRegion; onlyModels?: Set<string> } = {},
): ApplyPlan {
  const env = ctx.env;
  const fill = scope === 'defaults';
  const changes: Record<string, string | null> = {};
  const notes: string[] = [];
  const activate: string[] = [];
  const set = (key: string, value: string | null) => {
    if (!same(env[key], value)) changes[key] = value;
  };

  // Región: con la clave recién puesta, por defecto la UE (los datos se quedan en Europa).
  if (provider === 'openai' && scope !== 'prices') {
    if (fill && openAiRegion(env) === 'unset' && env.AI_ALLOW_NON_EU_PROCESSING?.trim() !== 'true') {
      changes.OPENAI_BASE_URL = OPENAI_EU_BASE;
      notes.push('Procesado en la UE (servidor europeo de OpenAI). Si tu clave no es de un proyecto europeo, «Probar conexión» te lo dirá y podrás cambiarlo en un clic.');
    }
  }
  let regionEnv: Env = { ...env, ...(changes.OPENAI_BASE_URL ? { OPENAI_BASE_URL: changes.OPENAI_BASE_URL } : {}) };
  if (options.regionAfter === 'eu') regionEnv = { ...regionEnv, OPENAI_BASE_URL: OPENAI_EU_BASE };
  if (options.regionAfter === 'global') regionEnv = { ...regionEnv, OPENAI_BASE_URL: OPENAI_GLOBAL_BASE };
  const pctx: AiContext = { ...ctx, env: regionEnv };

  // Elecciones y modelos que llevan precio.
  const toPrice = new Map<string, RecProvider>(); // modelo → proveedor
  const picks = new Map<string, Pick>();
  for (const task of RECOMMENDED_TASKS) {
    if (!task.candidates[provider]) continue;
    const pick = pickCandidate(pctx, task, provider);
    if (!pick) {
      if (task.kind === 'text' && provider === 'openai') {
        notes.push(`«${task.label}»: no hay un modelo recomendado disponible; se deja como está.`);
      }
      continue;
    }
    picks.set(task.id, pick);
    if (task.kind !== 'image') toPrice.set(pick.candidate.model, provider);
  }

  // Elegir modelos de texto y de transcripción (solo OpenAI: Claude no se configura aquí).
  if (provider === 'openai' && scope !== 'prices') {
    const textTasks = RECOMMENDED_TASKS.filter((t) => t.kind === 'text');
    const anyRoute =
      Boolean(env.AI_TEXT_PROVIDER?.trim()) ||
      Boolean(env.AI_TEXT_MODEL?.trim()) ||
      textTasks.some((t) => env[`${t.prefix}_PROVIDER`]?.trim() || env[`${t.prefix}_MODEL`]?.trim());
    const cheap = picks.get('copilot');
    if (fill && anyRoute) {
      notes.push('Ya había un modelo de texto elegido: no se ha tocado.');
    } else if (cheap) {
      set('AI_TEXT_PROVIDER', 'openai');
      set('AI_TEXT_MODEL', cheap.candidate.model);
      for (const task of textTasks) {
        if (task.id === 'copilot') continue;
        const pick = picks.get(task.id);
        const providerKey = `${task.prefix}_PROVIDER`;
        const modelKey = `${task.prefix}_MODEL`;
        if (pick && pick.candidate.model !== cheap.candidate.model) {
          set(providerKey, 'openai');
          set(modelKey, pick.candidate.model);
        } else if (!fill) {
          set(providerKey, null);
          set(modelKey, null);
        }
      }
    }
    const subtitles = picks.get('subtitles');
    if (subtitles) {
      const now = env.AI_TRANSCRIPTION_MODEL?.trim() || 'gpt-transcribe';
      if (subtitles.candidate.model !== now && (!fill || !env.AI_TRANSCRIPTION_MODEL?.trim())) {
        set('AI_TRANSCRIPTION_MODEL', subtitles.candidate.model);
      }
    }
    for (const id of ['image_create', 'photo_edit'] as const) {
      const pick = picks.get(id);
      if (pick && (SEEDED_OPENAI_IMAGE_MODELS as readonly string[]).includes(pick.candidate.model)) {
        activate.push(pick.candidate.model);
      }
    }
  }

  // También se actualizan los precios de lo que ya está configurado (solo al pedirlo).
  if (!fill) {
    for (const task of RECOMMENDED_TASKS) {
      if (task.kind !== 'text') continue;
      const current = currentModel(env, task);
      const [prov, ...rest] = (current ?? '').split('/');
      if (current && TEXT_ROUTE_PROVIDERS[provider].includes(prov!)) toPrice.set(rest.join('/'), provider);
    }
    for (const key of Object.keys(parsePrices(env.AI_PRICES, []))) {
      const [prov, ...rest] = key.split('/');
      if (TEXT_ROUTE_PROVIDERS[provider].includes(prov!) || (provider === 'openai' && prov === 'openai')) {
        toPrice.set(rest.join('/'), provider);
      }
    }
  }

  // Tabla de precios.
  const table = parsePrices(env.AI_PRICES, []);
  const next: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(table));
  let priceChanged = false;
  for (const [model, prov] of toPrice) {
    if (options.onlyModels && !options.onlyModels.has(model)) continue;
    const entry = priced(pctx, prov, model);
    const expected = entry ? expectedMicros(entry, surchargeFor(regionEnv, prov)) : null;
    if (!expected) continue;
    const { key } = loadedFor(pctx, prov, model);
    const current = next[key];
    if (fill && current) continue;
    const merged = { ...(current ?? {}), ...expected } as Record<string, number>;
    if (JSON.stringify(merged) !== JSON.stringify(current ?? null)) {
      next[key] = merged;
      priceChanged = true;
    }
  }
  if (priceChanged) changes.AI_PRICES = JSON.stringify(next);

  if (Object.keys(changes).length === 0 && activate.length === 0 && notes.length === 0) {
    notes.push('No había nada que cambiar.');
  }
  return { changes, notes, activateImageModels: activate };
}
