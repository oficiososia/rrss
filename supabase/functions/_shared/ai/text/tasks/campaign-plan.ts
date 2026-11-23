// Tarea: plan de campaña por instrucción («prepara la semana que viene»,
// «campaña de 3 semanas para el menú de otoño»).
//
// La IA PROPONE un plan explicado; no hace nada más. Lo que sale de aquí es
// solo datos: objetivo, razonamiento (observado / respaldado por datos /
// hipótesis) y una lista de piezas (red, formato, fecha, idea, pie de borrador
// y recursos sugeridos). Una persona lo revisa y, si lo acepta, un motor
// determinista crea las piezas como BORRADORES (src/features/campaigns/engine.ts
// y la función SQL accept_campaign_plan). Ni esta tarea ni el motor conocen
// otra acción que «crear borrador»: no hay forma de aprobar, programar ni
// publicar desde un plan.
//
// Defensa ante instrucciones maliciosas (en el perfil, en una fuente o en la
// propia instrucción):
//   * las instrucciones de la tarea son texto fijo del producto (mensaje de
//     sistema); todo lo que escribe el cliente viaja como material delimitado;
//   * la salida tiene un esquema cerrado (sin campos libres de «acciones» ni de
//     estado) y se valida entera;
//   * después, el producto descarta lo que no se pidió: piezas en redes o
//     formatos no elegidos, fuera de las fechas, recursos que no son de la
//     biblioteca enviada, y lo que exceda el máximo de piezas;
//   * sin datos de resultados, nada puede presentarse como «respaldado por
//     datos»: lo que el modelo ponga ahí pasa a hipótesis.
//
// Tolerancia (prueba de calidad del 23/11/2026, fallo 2): un modelo real
// escribe ideas más largas de lo pedido, fechas con hora («2026-11-24 13:00»),
// redes y formatos con mayúsculas o en español, o el nombre de una foto en
// lugar de su identificador. Antes, cualquiera de esas cosas tiraba la
// respuesta entera («no se puede usar») y se cobraba. Ahora se valida la FORMA
// (campos y tipos; un campo no previsto sigue invalidando) y el resto se
// sanea: se recorta, se normaliza o se descarta la pieza. Si al final no queda
// ninguna pieza, la respuesta no se cobra (`accept` → ai_waive_generation).
import { AiError, type AiOutputSchema, type AiService, type Json, type JsonSchema } from '../../contract.ts';
import { resolveFormat, resolveNetwork } from './targets.ts';
import {
  AiTaskInputError,
  brandProfileContext,
  DATA_RULE,
  requireText,
  runStructuredTask,
  type TaskActor,
  type TaskMeta,
} from './shared.ts';

export const CAMPAIGN_PLAN_PURPOSE = 'campaign.plan';
export const MAX_INSTRUCTION_CHARS = 2000;
/** Duración máxima de un plan: 9 semanas (una campaña de 2–4 semanas cabe con holgura). */
export const MAX_CAMPAIGN_DAYS = 63;
export const MAX_PIECES = 30;
export const MAX_TARGETS = 20;
export const MAX_ASSETS = 60;
export const MAX_ASSETS_PER_PIECE = 4;
export const MAX_SOURCES = 5;
export const MAX_SOURCES_CHARS = 60_000;
export const MAX_HASHTAGS = 30;
export const MAX_PIECE_TITLE_CHARS = 60;
export const MAX_HEADLINE_CHARS = 120;
/** Proporciones que admite una pieza (las del lienzo del editor). */
export const PIECE_ASPECTS = ['1:1', '4:5', '9:16', '16:9'] as const;

const ID = /^[a-z][a-z0-9_]{0,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASHTAG = /^[\p{L}\p{N}_]{1,100}$/u;

/** Texto fijo que acompaña a un plan sin datos de resultados (hoy, todos: la analítica es de la Fase 5). */
export const NO_DATA_NOTE =
  'Esta marca todavía no tiene datos de resultados en la plataforma: nada de este plan está respaldado por datos. Lo que no es observación es hipótesis.';

/** Un destino posible: red y formato del catálogo de la aplicación. Lo aporta quien llama. */
export interface CampaignTarget {
  network: string;
  format: string;
}

/** Recurso de la biblioteca que la IA puede sugerir (solo su descripción, nunca el archivo). */
export interface CampaignAssetRef {
  id: string;
  name: string;
  kind: string;
  tags?: string[];
  folder?: string;
}

export interface CampaignSource {
  title: string;
  text: string;
}

export interface CampaignPlanRequest {
  /** Perfil de marca activo (`brand_profiles.data`). */
  brandProfile: Json;
  /** Lo que pide la persona, con sus palabras. Es dato, no instrucciones. */
  instruction: string;
  /** Primer y último día del plan (AAAA-MM-DD, ambos incluidos). */
  startDate: string;
  endDate: string;
  targets: CampaignTarget[];
  assets?: CampaignAssetRef[];
  /** Fuentes de texto de la marca (ya extraído). Son dato. */
  sources?: CampaignSource[];
  /** Máximo de piezas (1–30). Por defecto, una cada dos días (o, con acuerdo, las que salen de su ritmo). */
  maxPieces?: number;
  /** Lo acordado antes con la persona (duración, ritmo, formatos): `campaign.brief`. Es dato. */
  agreement?: CampaignAgreement;
}

/** Ritmo y fases acordados al preparar el formulario con la IA. */
export interface CampaignAgreement {
  objective?: string;
  /** Publicaciones por semana, en total (1–14). */
  perWeek?: number;
  /** Reparto por red y formato, en publicaciones por semana. */
  mix?: Array<{ network: string; format: string; perWeek: number }>;
  /** Una fase por semana, en orden. */
  phases?: Array<{ title: string; focus: string }>;
}

export interface CampaignPiece {
  network: string;
  format: string;
  /** AAAA-MM-DD, dentro del plan. */
  date: string;
  /** Idea de la pieza, para quien la prepare. */
  idea: string;
  /** Pie de borrador. */
  caption: string;
  /** Sin la almohadilla. */
  hashtags: string[];
  /** Recursos sugeridos de la biblioteca (de la marca). */
  assetIds: string[];
  /** Por qué esta pieza en este día y en esta red. */
  why: string;
  /** Nombre corto de la pieza (el de la lista de contenidos). Opcional: sin él, sale de la idea. */
  title?: string;
  /** Hora propuesta para publicarla (HH:MM, hora de la marca). */
  time?: string;
  /** Proporción que pide la idea (4:5, 1:1…), si la pide. */
  aspect?: (typeof PIECE_ASPECTS)[number];
  /** Titular que lleva la imagen o el vídeo (corto), si la idea promete uno. */
  headline?: string;
}

export interface CampaignReasoning {
  /** Lo que se ve en el perfil, la instrucción, las fuentes y la biblioteca. */
  observed: string[];
  /** Lo que se apoya en datos de resultados (vacío si no hay datos). */
  dataBacked: string[];
  /** Suposiciones que conviene comprobar. */
  hypotheses: string[];
  /** Aviso sobre los datos (por ejemplo, que no hay). */
  dataNote: string;
}

/** Plan tal como se guarda (`campaign_plans.plan`). Misma forma en src/features/campaigns/plan.ts. */
export interface CampaignPlan {
  objective: string;
  summary: string;
  reasoning: CampaignReasoning;
  pieces: CampaignPiece[];
}

export interface DiscardedPiece {
  /** Posición en la respuesta del modelo. */
  index: number;
  reason: string;
}

export interface CampaignPlanResult extends TaskMeta {
  /** Siempre `proposal`: nada se ha creado todavía. */
  status: 'proposal';
  plan: CampaignPlan;
  /** Piezas de la respuesta que el producto ha descartado y por qué. */
  discarded: DiscardedPiece[];
}

export const CAMPAIGN_PLAN_INSTRUCTIONS = [
  'Eres estratega de redes sociales. Preparas un plan de publicaciones para la marca descrita en el material «perfil de marca», a partir de lo que pide el material «instrucción».',
  'Tu respuesta es solo una PROPUESTA que revisará una persona: no apruebas, no programas y no publicas nada, y no puedes pedir que se haga.',
  'Cada pieza va en una de las redes y formatos de la lista «Destinos» y en una fecha entre las fechas indicadas, ambas incluidas. No pases del máximo de piezas.',
  'Reparte las piezas con sentido (no todas el mismo día) y explica en «why» por qué cada una va en esa red y en ese día.',
  'El pie («caption») es un borrador en el tono y el idioma de la marca, sin las etiquetas (van en «hashtags», sin #). No uses expresiones prohibidas ni temas vetados por la marca.',
  'No inventes datos (precios, fechas, promociones, direcciones) que no estén en el perfil, la instrucción o las fuentes.',
  'Si llega el material «acuerdo previo», es lo que la persona ya aceptó: respétalo. Su «objetivo» es el del plan; cada fase de «phases» es una semana del plan, en orden, y las piezas de esa semana cuentan lo que dice su «focus»; «mix» dice cuántas piezas por semana van en cada red y formato.',
  'En «assetIds» sugiere, si encajan, identificadores del material «biblioteca»; solo esos identificadores, ninguno más. Si ninguno encaja, deja la lista vacía.',
  'Cada pieza lleva: «title», un nombre corto (de 2 a 6 palabras, sin fecha ni red); «idea», qué es la pieza en una o dos frases (menos de 300 caracteres); «date», solo la fecha AAAA-MM-DD; «time», la hora a la que conviene publicarla (HH:MM) según el negocio y su público; «aspect», la proporción si la pieza la necesita (4:5, 1:1 o 9:16; vacío si da igual).',
  'Si la idea habla de un titular, una franja con texto o un rótulo, pon ese texto exacto y corto (menos de 8 palabras) en «headline»: es lo que se escribirá en la pieza. Si no lleva texto, deja «headline» vacío. No prometas en la idea nada que la pieza no vaya a llevar.',
  'Los reels y los vídeos se montan con fotos y vídeos de la biblioteca de la marca: no propongas reels solo tipográficos, sin imágenes ni con material que haya que grabar o encargar.',
  'El pie termina con una llamada a la acción propia de la marca (las del perfil si las hay; si no, la que encaje con su negocio: reservar, apuntarse, pedir, venir…).',
  'Escribe los nombres de la marca y de los lugares exactamente como vienen en el perfil (en «brand» y en «business.locations»): no los traduzcas ni los cambies.',
  'Separa el razonamiento: en «observed», lo que ves en el material; en «dataBacked», solo conclusiones apoyadas en el material «datos de resultados» (si no llega ese material, deja la lista vacía); en «hypotheses», lo que supones y convendría comprobar.',
  DATA_RULE,
].join('\n');

const text = (maxLength: number): JsonSchema => ({ type: 'string', maxLength });
const textList = (maxItems: number, maxLength: number): JsonSchema => ({
  type: 'array',
  maxItems,
  items: { type: 'string', maxLength },
});
const PIECE_REQUIRED = ['network', 'format', 'date', 'idea', 'caption', 'hashtags', 'assetIds', 'why'];
const PIECE_EXTRA = ['title', 'time', 'aspect', 'headline'];
const PLAN_REQUIRED = ['objective', 'summary', 'observed', 'dataBacked', 'hypotheses', 'pieces'];

export const CAMPAIGN_PLAN_SCHEMA: AiOutputSchema = {
  name: 'campaign_plan',
  // Lo que se pide al proveedor (en modo estricto, todos los campos obligatorios).
  schema: {
    type: 'object',
    properties: {
      objective: { type: 'string', minLength: 1, maxLength: 600 },
      summary: text(1500),
      observed: textList(10, 400),
      dataBacked: textList(10, 400),
      hypotheses: textList(10, 400),
      pieces: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_PIECES * 2,
        items: {
          type: 'object',
          properties: {
            network: text(32),
            format: text(32),
            date: text(10),
            time: text(5),
            title: text(MAX_PIECE_TITLE_CHARS),
            idea: { type: 'string', minLength: 1, maxLength: 300 },
            headline: text(MAX_HEADLINE_CHARS),
            aspect: text(5),
            caption: { type: 'string', minLength: 1, maxLength: 5000 },
            hashtags: textList(MAX_HASHTAGS, 100),
            assetIds: textList(10, 36),
            why: text(600),
          },
          required: [...PIECE_REQUIRED, ...PIECE_EXTRA],
          additionalProperties: false,
        },
      },
    },
    required: PLAN_REQUIRED,
    additionalProperties: false,
  } as JsonSchema,
  // Lo que se comprueba aquí: la forma (campos y tipos, sin campos de más). Las
  // longitudes, fechas, redes y recursos los arregla `sanitizePlan`; los campos
  // nuevos pueden faltar (un modelo o un simulado que no los conozca).
  localSchema: {
    type: 'object',
    properties: {
      objective: { type: 'string' },
      summary: { type: 'string' },
      observed: { type: 'array', items: { type: 'string' } },
      dataBacked: { type: 'array', items: { type: 'string' } },
      hypotheses: { type: 'array', items: { type: 'string' } },
      pieces: {
        type: 'array',
        items: {
          type: 'object',
          properties: Object.fromEntries(
            [...PIECE_REQUIRED, ...PIECE_EXTRA].map((key) => [
              key,
              key === 'hashtags' || key === 'assetIds' ? { type: 'array', items: { type: 'string' } } : { type: 'string' },
            ]),
          ),
          required: PIECE_REQUIRED,
          additionalProperties: false,
        },
      },
    },
    required: PLAN_REQUIRED,
    additionalProperties: false,
  } as JsonSchema,
};

// ── Validación de la petición ────────────────────────────────────────────

/** Día UTC de una fecha AAAA-MM-DD, o null si no es una fecha real. */
export function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time / 86_400_000;
}

function validTargets(targets: unknown): CampaignTarget[] {
  if (!Array.isArray(targets) || targets.length === 0) throw new AiTaskInputError('Elige al menos una red.');
  if (targets.length > MAX_TARGETS) throw new AiTaskInputError(`Como mucho ${MAX_TARGETS} destinos.`);
  const seen = new Set<string>();
  const out: CampaignTarget[] = [];
  for (const target of targets as unknown[]) {
    const { network, format } = (typeof target === 'object' && target !== null ? target : {}) as Record<
      string,
      unknown
    >;
    if (typeof network !== 'string' || !ID.test(network) || typeof format !== 'string' || !ID.test(format)) {
      throw new AiTaskInputError('Algún destino (red y formato) no es válido.');
    }
    const key = `${network}/${format}`;
    if (!seen.has(key)) out.push({ network, format });
    seen.add(key);
  }
  return out;
}

function validAssets(assets: unknown): CampaignAssetRef[] {
  if (assets === undefined || assets === null) return [];
  if (!Array.isArray(assets)) throw new AiTaskInputError('La lista de recursos no es válida.');
  if (assets.length > MAX_ASSETS) throw new AiTaskInputError(`Como mucho ${MAX_ASSETS} recursos de la biblioteca.`);
  return (assets as unknown[]).map((asset) => {
    const a = (typeof asset === 'object' && asset !== null ? asset : {}) as Record<string, unknown>;
    if (typeof a.id !== 'string' || !UUID.test(a.id)) throw new AiTaskInputError('Algún recurso no es válido.');
    const tags = Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string').slice(0, 20) : [];
    return {
      id: a.id.toLowerCase(),
      name: typeof a.name === 'string' ? a.name.slice(0, 200) : '',
      kind: typeof a.kind === 'string' ? a.kind.slice(0, 20) : '',
      tags: tags.map((t) => t.slice(0, 60)),
      folder: typeof a.folder === 'string' ? a.folder.slice(0, 200) : '',
    };
  });
}

function validSources(sources: unknown): CampaignSource[] {
  if (sources === undefined || sources === null) return [];
  if (!Array.isArray(sources)) throw new AiTaskInputError('Las fuentes no son válidas.');
  if (sources.length > MAX_SOURCES) throw new AiTaskInputError(`Como mucho ${MAX_SOURCES} fuentes.`);
  const out = (sources as unknown[]).map((source, i) => {
    const s = (typeof source === 'object' && source !== null ? source : {}) as Record<string, unknown>;
    return {
      title: requireText(s.title, `el título de la fuente ${i + 1}`, 200),
      text: requireText(s.text, `el texto de la fuente ${i + 1}`, MAX_SOURCES_CHARS),
    };
  });
  const total = out.reduce((sum, source) => sum + source.text.length, 0);
  if (total > MAX_SOURCES_CHARS) {
    throw new AiTaskInputError(`Las fuentes superan entre todas el máximo de ${MAX_SOURCES_CHARS} caracteres.`);
  }
  return out;
}

const MAX_PER_WEEK = 14;

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Valida lo acordado: solo destinos pedidos, ritmos acotados y textos cortos. Devuelve null si no hay nada. */
export function validAgreement(raw: unknown, targets: CampaignTarget[]): CampaignAgreement | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new AiTaskInputError('El acuerdo previo no es válido.');
  const a = raw as Record<string, unknown>;
  const out: CampaignAgreement = {};
  const objective = clip(a.objective, 600);
  if (objective) out.objective = objective;
  if (a.perWeek !== undefined) {
    if (!Number.isInteger(a.perWeek) || (a.perWeek as number) < 1 || (a.perWeek as number) > MAX_PER_WEEK) {
      throw new AiTaskInputError(`El ritmo debe estar entre 1 y ${MAX_PER_WEEK} publicaciones por semana.`);
    }
    out.perWeek = a.perWeek as number;
  }
  if (a.mix !== undefined) {
    if (!Array.isArray(a.mix) || a.mix.length > MAX_TARGETS) throw new AiTaskInputError('El reparto no es válido.');
    out.mix = (a.mix as unknown[]).flatMap((entry) => {
      const m = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
      const ok = targets.some((t) => t.network === m.network && t.format === m.format);
      if (!ok || !Number.isInteger(m.perWeek) || (m.perWeek as number) < 1 || (m.perWeek as number) > 7) return [];
      return [{ network: m.network as string, format: m.format as string, perWeek: m.perWeek as number }];
    });
  }
  if (a.phases !== undefined) {
    if (!Array.isArray(a.phases) || a.phases.length > 9) throw new AiTaskInputError('Las fases no son válidas.');
    out.phases = (a.phases as unknown[])
      .map((entry) => {
        const f = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
        return { title: clip(f.title, 80), focus: clip(f.focus, 240) };
      })
      .filter((phase) => phase.title);
  }
  return Object.keys(out).length ? out : null;
}

/** Piezas que salen de un ritmo semanal en un plan de `days` días (1–30). */
export function piecesForRhythm(days: number, perWeek: number): number {
  return Math.max(1, Math.min(MAX_PIECES, Math.ceil((days / 7) * perWeek)));
}

/**
 * Tokens de salida de un plan. Con margen para los modelos que razonan antes de
 * responder (el razonamiento cuenta como salida): con 1.500 + 700 por pieza, un
 * plan de 4 piezas se cortaba antes de terminar. Es también lo que se reserva.
 */
export function planOutputTokens(maxPieces: number): number {
  return Math.min(16_000, 3000 + maxPieces * 800);
}

/** Máximo de piezas por defecto: una cada dos días, entre 1 y 30. */
export function defaultMaxPieces(days: number): number {
  return Math.max(1, Math.min(MAX_PIECES, Math.ceil(days / 2)));
}

// ── Saneado de la respuesta ──────────────────────────────────────────────

export function normalizeHashtags(raw: string[]): string[] {
  const out: string[] = [];
  for (const tag of raw) {
    const clean = tag.trim().replace(/\s+/g, '').replace(/^#+/, '');
    if (HASHTAG.test(clean) && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, MAX_HASHTAGS);
}

const cleanList = (items: unknown, maxItems: number, maxChars: number) =>
  (Array.isArray(items) ? items : [])
    .map((item) => clipText(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);

/** Recorta un texto a `max` caracteres sin partir palabras, con «…» si hace falta. `oneLine`: junta los espacios. */
export function clipText(value: unknown, max: number, oneLine = true): string {
  const raw = typeof value === 'string' ? value : '';
  const text = (oneLine ? raw.replace(/\s+/g, ' ') : raw).trim();
  if ([...text].length <= max) return text;
  const cut = [...text].slice(0, max - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

const MONTHS = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/;

/**
 * Fecha de una pieza tal como la escribe un modelo: «2026-11-24», «2026-11-24T13:00:00»,
 * «2026-11-24 13:00» o «24/11/2026». Devuelve el día (AAAA-MM-DD) y la hora si venía.
 */
export function parsePieceDate(value: unknown, year: number): { date: string | null; time: string } {
  const raw = typeof value === 'string' ? value.trim() : '';
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[T\s]+(\d{1,2}):(\d{2}))?/.exec(raw);
  if (iso) {
    const time = iso[2] !== undefined ? normalizeTime(`${iso[2]}:${iso[3]}`) : '';
    return { date: dayNumber(iso[1]) === null ? null : iso[1]!, time };
  }
  const local = MONTHS.exec(raw.split(/\s+/)[0] ?? '');
  if (local) {
    const y = local[3] ? (local[3].length === 2 ? 2000 + Number(local[3]) : Number(local[3])) : year;
    const date = `${y}-${local[2]!.padStart(2, '0')}-${local[1]!.padStart(2, '0')}`;
    return { date: dayNumber(date) === null ? null : date, time: normalizeTime(raw.split(/\s+/)[1] ?? '') };
  }
  return { date: null, time: '' };
}

/** Hora HH:MM a partir de «13:00», «9:30», «13h», «13.30» o «13 h»; vacía si no es una hora real. */
export function normalizeTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const match = /^(\d{1,2})(?:[:.h]\s*(\d{2}))?\s*h?$/.exec(raw);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Proporción que dice el modelo («4:5», «4/5», «4x5») o, si no, la que menciona la idea. */
export function pieceAspect(value: unknown, idea: string): CampaignPiece['aspect'] | undefined {
  const pick = (text: string) => {
    const match = /\b(1|4|9|16)\s*[:/x×]\s*(1|5|16|9)\b/i.exec(text);
    if (!match) return undefined;
    const ratio = `${match[1]}:${match[2]}`;
    return (PIECE_ASPECTS as readonly string[]).includes(ratio) ? (ratio as CampaignPiece['aspect']) : undefined;
  };
  return pick(typeof value === 'string' ? value : '') ?? pick(idea);
}

/** Título corto de una pieza: el que dio el modelo o, si no, el principio de la idea. */
export function pieceTitle(title: unknown, idea: string): string {
  const own = clipText(title, MAX_PIECE_TITLE_CHARS);
  if (own) return own;
  const first = idea.split(/[.:;—–(]|\s-\s/)[0] ?? idea;
  return clipText(first, MAX_PIECE_TITLE_CHARS);
}

interface RawPiece {
  network?: unknown;
  format?: unknown;
  date?: unknown;
  time?: unknown;
  title?: unknown;
  idea?: unknown;
  headline?: unknown;
  aspect?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  assetIds?: unknown;
  why?: unknown;
}

interface RawPlan {
  objective: unknown;
  summary: unknown;
  observed: unknown;
  dataBacked: unknown;
  hypotheses: unknown;
  pieces: RawPiece[];
}

export interface SanitizeContext {
  startDate: string;
  endDate: string;
  targets: CampaignTarget[];
  assetIds: string[];
  /** Nombres de los recursos enviados: un modelo a veces pone el nombre en lugar del identificador. */
  assetNames?: Map<string, string>;
  maxPieces: number;
  /** ¿Se enviaron datos de resultados? Hoy nunca. */
  hasPerformanceData: boolean;
}

/**
 * Deja en el plan solo lo que se pidió. Determinista: la misma respuesta da
 * siempre el mismo plan. No añade nada que no dijera el modelo.
 */
export function sanitizePlan(raw: RawPlan, ctx: SanitizeContext): { plan: CampaignPlan; discarded: DiscardedPiece[] } {
  const start = dayNumber(ctx.startDate)!;
  const end = dayNumber(ctx.endDate)!;
  const year = Number(ctx.startDate.slice(0, 4));
  const targets = new Set(ctx.targets.map((t) => `${t.network}/${t.format}`));
  const assets = new Set(ctx.assetIds.map((id) => id.toLowerCase()));
  const byName = new Map([...(ctx.assetNames ?? new Map<string, string>())].map(([id, name]) => [name.trim().toLowerCase(), id.toLowerCase()]));
  const discarded: DiscardedPiece[] = [];
  const kept: CampaignPiece[] = [];

  (Array.isArray(raw.pieces) ? raw.pieces : []).forEach((piece, index) => {
    // Red y formato tal como los escribe un modelo («Instagram», «Reels»): se llevan a los pedidos.
    const network = resolveNetwork(piece.network, ctx.targets) ?? (typeof piece.network === 'string' ? piece.network : '');
    const format = resolveFormat(network, piece.format, ctx.targets) ?? (typeof piece.format === 'string' ? piece.format : '');
    const when = parsePieceDate(piece.date, year);
    const day = when.date === null ? null : dayNumber(when.date);
    const idea = clipText(piece.idea, 300);
    const caption = clipText(piece.caption, 5000, false);
    if (!targets.has(`${network}/${format}`)) {
      discarded.push({ index, reason: 'Red o formato que no se ha pedido.' });
    } else if (day === null || day < start || day > end) {
      discarded.push({ index, reason: 'Fecha fuera del plan.' });
    } else if (!idea || !caption) {
      discarded.push({ index, reason: 'Pieza sin idea o sin texto.' });
    } else {
      const assetIds = [
        ...new Set(
          (Array.isArray(piece.assetIds) ? piece.assetIds : [])
            .map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : ''))
            .map((id) => (assets.has(id) ? id : (byName.get(id) ?? ''))),
        ),
      ]
        .filter((id) => assets.has(id))
        .slice(0, MAX_ASSETS_PER_PIECE);
      const time = normalizeTime(piece.time) || when.time;
      const aspect = pieceAspect(piece.aspect, idea);
      const headline = clipText(piece.headline, MAX_HEADLINE_CHARS);
      kept.push({
        network,
        format,
        date: when.date!,
        idea,
        caption,
        hashtags: normalizeHashtags(
          (Array.isArray(piece.hashtags) ? piece.hashtags : []).filter((tag): tag is string => typeof tag === 'string'),
        ),
        assetIds,
        why: clipText(piece.why, 600),
        title: pieceTitle(piece.title, idea),
        ...(time ? { time } : {}),
        ...(aspect ? { aspect } : {}),
        ...(headline ? { headline } : {}),
      });
    }
  });

  // Por fecha (orden estable); lo que pase del máximo se descarta, avisando.
  const ordered = kept
    .map((piece, order) => ({ piece, order }))
    .sort((a, b) => (a.piece.date === b.piece.date ? a.order - b.order : a.piece.date < b.piece.date ? -1 : 1))
    .map(({ piece }) => piece);
  const pieces = ordered.slice(0, ctx.maxPieces);
  if (ordered.length > pieces.length) {
    discarded.push({
      index: -1,
      reason: `Sobran ${ordered.length - pieces.length} piezas sobre el máximo de ${ctx.maxPieces}.`,
    });
  }

  const observed = cleanList(raw.observed, 10, 400);
  const dataBacked = cleanList(raw.dataBacked, 10, 400);
  const hypotheses = cleanList(raw.hypotheses, 10, 400);
  const summary = clipText(raw.summary, 1500);
  // Sin objetivo, el principio del resumen (un plan guardado siempre lo necesita).
  const objective = clipText(raw.objective, 600) || clipText(summary.split(/(?<=\.)\s/)[0], 600) || 'Plan de publicaciones';
  return {
    plan: {
      objective,
      summary,
      reasoning: ctx.hasPerformanceData
        ? { observed, dataBacked, hypotheses, dataNote: '' }
        : // Sin datos, nada está respaldado por datos: lo que el modelo puso ahí es una hipótesis más.
          { observed, dataBacked: [], hypotheses: [...hypotheses, ...dataBacked].slice(0, 20), dataNote: NO_DATA_NOTE },
      pieces,
    },
    discarded,
  };
}

// ── Tarea ────────────────────────────────────────────────────────────────

function buildPrompt(
  startDate: string,
  endDate: string,
  targets: CampaignTarget[],
  maxPieces: number,
  perWeek?: number,
): string {
  // Todo lo de aquí está validado (fechas reales, identificadores con formato
  // fijo, número entero): ningún texto libre del cliente entra en el prompt.
  return [
    `Fechas: del ${startDate} al ${endDate}, ambos incluidos.`,
    'Destinos (red/formato):',
    ...targets.map((t) => `- Destino: ${t.network}/${t.format}`),
    `Máximo de piezas: ${maxPieces}.`,
    ...(perWeek ? [`Ritmo acordado: ${perWeek} piezas por semana.`] : []),
    '',
    'Prepara el plan que pide el material «instrucción».',
  ].join('\n');
}

export async function planCampaign(
  service: AiService,
  actor: TaskActor,
  request: CampaignPlanRequest,
): Promise<CampaignPlanResult> {
  const instruction = requireText(request.instruction, 'la instrucción', MAX_INSTRUCTION_CHARS);
  const start = dayNumber(request.startDate);
  const end = dayNumber(request.endDate);
  if (start === null || end === null) throw new AiTaskInputError('Las fechas del plan no son válidas (AAAA-MM-DD).');
  if (end < start) throw new AiTaskInputError('La fecha final es anterior a la inicial.');
  const days = end - start + 1;
  if (days > MAX_CAMPAIGN_DAYS) throw new AiTaskInputError(`Un plan dura como mucho ${MAX_CAMPAIGN_DAYS} días.`);
  const targets = validTargets(request.targets);
  const assets = validAssets(request.assets);
  const sources = validSources(request.sources);
  const agreement = validAgreement(request.agreement, targets);
  const maxPieces =
    request.maxPieces ?? (agreement?.perWeek ? piecesForRhythm(days, agreement.perWeek) : defaultMaxPieces(days));
  if (!Number.isInteger(maxPieces) || maxPieces < 1 || maxPieces > MAX_PIECES) {
    throw new AiTaskInputError(`El máximo de piezas debe estar entre 1 y ${MAX_PIECES}.`);
  }

  const context = [
    brandProfileContext(request.brandProfile),
    // Lo que escribe el cliente (instrucción, fuentes, nombres de archivos) viaja como material.
    { label: 'instrucción', content: instruction },
    { label: 'biblioteca', content: JSON.stringify(assets) },
    ...(agreement ? [{ label: 'acuerdo previo', content: JSON.stringify(agreement) }] : []),
    ...sources.map((source) => ({ label: `fuente: ${source.title}`, content: source.text })),
  ];

  const sanitizeContext: SanitizeContext = {
    startDate: request.startDate,
    endDate: request.endDate,
    targets,
    assetIds: assets.map((a) => a.id),
    assetNames: new Map(assets.filter((a) => a.name).map((a) => [a.id, a.name])),
    maxPieces,
    hasPerformanceData: false,
  };
  const { data, meta } = await runStructuredTask(service, {
    actor,
    purpose: CAMPAIGN_PLAN_PURPOSE,
    instructions: CAMPAIGN_PLAN_INSTRUCTIONS,
    context,
    prompt: buildPrompt(request.startDate, request.endDate, targets, maxPieces, agreement?.perWeek),
    schema: CAMPAIGN_PLAN_SCHEMA,
    maxOutputTokens: planOutputTokens(maxPieces),
    // Un plan sin ninguna pieza utilizable no se cobra.
    accept: (value) =>
      sanitizePlan(value as unknown as RawPlan, sanitizeContext).plan.pieces.length === 0
        ? 'La IA no ha propuesto ninguna pieza válida para esas fechas y redes. Vuelve a probar o cambia la instrucción.'
        : null,
  });

  const { plan, discarded } = sanitizePlan(data as unknown as RawPlan, sanitizeContext);
  if (plan.pieces.length === 0) {
    // No debería llegar aquí (lo frena `accept`), pero sin piezas no hay plan.
    throw new AiError(
      'invalid_output',
      'La IA no ha propuesto ninguna pieza válida para esas fechas y redes. Vuelve a probar o cambia la instrucción.',
      { generationId: meta.generationId },
    );
  }
  return { ...meta, status: 'proposal', plan, discarded };
}
