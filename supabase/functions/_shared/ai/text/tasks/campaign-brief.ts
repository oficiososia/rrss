// Tarea: la IA rellena contigo el formulario de «Preparar un plan» de Campañas
// (acción `campaign.brief` de `ai-generate`; el registro y el cupo son los de
// `campaign.plan`: es la misma tarea de planificación, más barata porque no
// escribe piezas).
//
// A partir de lo que la persona cuenta («prepárame la campaña del menú de
// otoño, que dure hasta navidades, sobre todo reels») PROPONE los datos del
// formulario: redes, fechas (con la duración razonada), ritmo (publicaciones por
// semana y reparto por formato), nombre y objetivo. No crea ninguna campaña ni
// ninguna pieza: la persona ve la propuesta, la corrige y solo entonces pide el
// plan. Si falta un dato imprescindible, devuelve UNA pregunta corta en lugar
// de una propuesta.
//
// Lo que sale del modelo se sanea aquí, sin IA: redes y formatos solo de la
// lista que mandó el producto (las de la marca), fechas reales y dentro de lo
// que admite un plan, ritmo acotado y una semana por fase como mucho.
import { AiError, type AiOutputSchema, type AiService, type JsonSchema, type Json } from '../../contract.ts';
import { CAMPAIGN_PLAN_PURPOSE, dayNumber, MAX_CAMPAIGN_DAYS, type CampaignTarget } from './campaign-plan.ts';
import { canon, FORMAT_GROUPS, resolveFormat, resolveNetwork } from './targets.ts';

export { resolveFormat, resolveNetwork };
import {
  AiTaskInputError,
  brandProfileContext,
  DATA_RULE,
  requireText,
  runStructuredTask,
  type TaskActor,
  type TaskMeta,
} from './shared.ts';

export const CAMPAIGN_BRIEF_PURPOSE = CAMPAIGN_PLAN_PURPOSE;
export const MAX_BRIEF_CHARS = 2000;
export const MAX_BRIEF_TARGETS = 20;
export const MAX_BRIEF_WEEKS = Math.ceil(MAX_CAMPAIGN_DAYS / 7);
export const MAX_PER_WEEK_PER_TARGET = 7;
export const MAX_PER_WEEK_TOTAL = 14;

const ID = /^[a-z][a-z0-9_]{0,31}$/;

/** Lo que la persona pide cambiar de una propuesta que ya tiene. */
export type BriefAdjustment = 'shorter' | 'longer';

/** Propuesta que ya se enseñó (para ajustarla: «más corta», «más larga»). */
export interface BriefProposal {
  title: string;
  objective: string;
  networks: string[];
  startDate: string;
  endDate: string;
  perWeek: number;
  mix: BriefMixItem[];
  weeks: BriefWeek[];
}

export interface BriefMixItem {
  network: string;
  format: string;
  /** Publicaciones por semana en ese formato. */
  perWeek: number;
}

export interface BriefWeek {
  /** «Anuncio», «Platos», «Cierre»… */
  title: string;
  /** Qué se cuenta esa semana, en una frase. */
  focus: string;
}

export interface CampaignBriefRequest {
  brandProfile: Json;
  /** Lo que cuenta la persona, con sus palabras (dictado o escrito). Es dato, no instrucciones. */
  instruction: string;
  /** Hoy, AAAA-MM-DD, en la hora de la persona. */
  today: string;
  /** Redes y formatos que se pueden ofrecer: los de la marca. Nada fuera de esta lista. */
  targets: CampaignTarget[];
  /** Propuesta anterior y ajuste pedido. */
  current?: BriefProposal;
  adjust?: BriefAdjustment;
  /** Respuesta a la pregunta que hizo la IA antes. */
  answer?: { question: string; text: string };
}

export interface CampaignBriefProposal extends BriefProposal {
  /** Por qué esta duración y este ritmo, en una o dos frases («Te propongo 3 semanas porque…»). */
  why: string;
}

export interface CampaignBriefResult extends TaskMeta {
  /** `question`: falta un dato imprescindible; `proposal`: datos del formulario por revisar. */
  status: 'question' | 'proposal';
  question: string | null;
  proposal: CampaignBriefProposal | null;
  /** Retoques que el producto ha hecho a lo que dijo el modelo (fechas, redes, ritmo). */
  notes: string[];
}

export const CAMPAIGN_BRIEF_INSTRUCTIONS = [
  'Eres estratega de redes sociales. Una persona te cuenta con sus palabras (material «lo que quiere») qué campaña quiere preparar para la marca del material «perfil de marca». Tu trabajo es proponer cómo rellenar el formulario de la campaña: redes, fechas, ritmo, nombre y objetivo. No escribes las publicaciones ni creas nada: es una propuesta que la persona revisará y corregirá.',
  'Tuteas y hablas en español llano. En «why» explica en una o dos frases por qué esa duración y ese ritmo, empezando por «Te propongo …».',
  'Redes: elige solo entre las de la lista «Destinos». Si la persona nombra una red que no está en la lista, no la pongas. Si no dice nada de redes, elige las que mejor encajen con el tema (normalmente una o dos).',
  'Fechas: el material «hoy» da la fecha de hoy. La campaña empieza como pronto mañana. «Hasta Navidad» acaba el 24 de diciembre; «esta semana» o «la semana que viene» son semanas naturales (de lunes a domingo). Si la persona no dice cuánto debe durar, propón la duración que mejor encaje con el tema y razónala (por ejemplo, 3 semanas: una de anuncio, una de platos y una de cierre); una campaña normal dura de 1 a 4 semanas y nunca más de 9.',
  'Ritmo: «perWeek» es el total de publicaciones por semana y «mix» lo reparte por red y formato de la lista «Destinos» (la suma de «mix» es «perWeek»). Cada entrada de «mix» lleva «network» y «format» copiados tal cual de un destino (por ejemplo «instagram» y «reel») y «perWeek», un número entero mayor que 0. Sé realista para un negocio pequeño: de 2 a 5 por semana en total, y nunca más de 7 por semana en un mismo formato. Si la persona prefiere un formato («sobre todo reels»), dale más peso en el reparto.',
  'Si en «why» dices cuántas publicaciones de cada formato hay, que sean exactamente las de «mix».',
  'Los reels se montan con fotos y vídeos de la biblioteca de la marca: no propongas reels solo tipográficos ni sin imágenes.',
  'Semanas: una entrada de «weeks» por semana de la campaña, en orden, con un título corto y qué se cuenta esa semana.',
  'Nombre y objetivo: «title» es un nombre corto para la campaña; «objective» es lo que se quiere conseguir, en una frase.',
  'Pregunta: si falta un dato imprescindible para proponer algo útil (casi siempre, de qué trata la campaña o qué se quiere dar a conocer), pon en «question» UNA pregunta corta y deja el resto vacío. Nunca preguntes por lo que puedes decidir tú (redes, duración, ritmo, nombre). Si el material «respuesta» ya contesta una pregunta anterior, no vuelvas a preguntar: propón.',
  'Si llega el material «propuesta actual» y el encargo pide acortarla o alargarla, devuelve la misma propuesta con una semana menos o una más (y su ritmo y su «why» coherentes), sin cambiar el tema.',
  'No inventes datos (precios, fechas de eventos, promociones) que no estén en el perfil o en lo que cuenta la persona.',
  DATA_RULE,
].join('\n');

const text = (maxLength: number): JsonSchema => ({ type: 'string', maxLength });

export const CAMPAIGN_BRIEF_SCHEMA: AiOutputSchema = {
  name: 'campaign_brief',
  schema: {
    type: 'object',
    properties: {
      question: text(200),
      title: text(120),
      objective: text(600),
      networks: { type: 'array', maxItems: 8, items: text(32) },
      startDate: text(10),
      endDate: text(10),
      perWeek: { type: 'integer' },
      mix: {
        type: 'array',
        maxItems: MAX_BRIEF_TARGETS,
        items: {
          type: 'object',
          properties: { network: text(32), format: text(32), perWeek: { type: 'integer' } },
          required: ['network', 'format', 'perWeek'],
          additionalProperties: false,
        },
      },
      weeks: {
        type: 'array',
        maxItems: MAX_BRIEF_WEEKS,
        items: {
          type: 'object',
          properties: { title: text(80), focus: text(240) },
          required: ['title', 'focus'],
          additionalProperties: false,
        },
      },
      why: text(500),
    },
    required: ['question', 'title', 'objective', 'networks', 'startDate', 'endDate', 'perWeek', 'mix', 'weeks', 'why'],
    additionalProperties: false,
  } as JsonSchema,
};

// ── Fechas ───────────────────────────────────────────────────────────────

export function dayFromNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** El lunes siguiente a `today` (si hoy es lunes, el de la semana que viene). */
export function nextMonday(today: number): number {
  const weekday = new Date(today * 86_400_000).getUTCDay(); // 0 = domingo
  return today + (((8 - weekday) % 7) || 7);
}

/** Semanas (de siete días, la última puede ser más corta) que caben entre dos días, ambos incluidos. */
export const weeksBetween = (start: number, end: number): number => Math.ceil((end - start + 1) / 7);

// ── Reparto tolerante ────────────────────────────────────────────────────
// Los nombres de red y formato se normalizan en targets.ts (también los usa el plan).

/** Un número de publicaciones por semana, venga como número o como texto («2», «2,5», «2 reels»); 0 si no es nada. */
export function parsePerWeek(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : 0;
  if (typeof value === 'string') {
    const found = /\d+(?:[.,]\d+)?/.exec(value);
    return found ? Math.round(Number(found[0].replace(',', '.'))) : 0;
  }
  return 0;
}

/** Reparte `total` en partes proporcionales a `weights` (método del mayor resto), cada una de al menos 1 si cabe. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);
  const goal = Math.max(total, weights.length);
  const exact = weights.map((w) => (w / sum) * goal);
  const out = exact.map((x) => Math.max(1, Math.floor(x)));
  let left = goal - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k]!.i]! += 1;
  // Si el mínimo de 1 hizo pasar del total, se quita a los que más tienen.
  while (out.reduce((a, b) => a + b, 0) > goal && out.some((n) => n > 1)) {
    const max = Math.max(...out);
    out[out.indexOf(max)]! -= 1;
  }
  return out;
}

/**
 * Qué formatos pidió la persona con sus palabras («sobre todo reels y alguna
 * foto»), en orden de aparición; el primero pesa el doble. Sirve para el
 * reparto de respaldo cuando el del modelo no se puede usar.
 */
export function formatsAsked(text: string, targets: CampaignTarget[], networks: string[]): { network: string; format: string; weight: number }[] {
  const plain = canon(text).split('_');
  const found: { at: number; format: string[] }[] = [];
  for (const group of FORMAT_GROUPS) {
    const at = plain.findIndex((word) => group.words.includes(word));
    if (at >= 0) found.push({ at, format: group.formats });
  }
  found.sort((a, b) => a.at - b.at);
  const out: { network: string; format: string; weight: number }[] = [];
  found.forEach((entry, order) => {
    for (const network of networks) {
      const target = targets.find((t) => t.network === network && entry.format.includes(t.format));
      if (target && !out.some((o) => o.network === network && o.format === target.format)) {
        out.push({ network, format: target.format, weight: order === 0 && found.length > 1 ? 2 : 1 });
      }
    }
  });
  return out;
}

// ── Lo que dice el texto frente al ritmo ─────────────────────────────────
// «Te propongo 4 semanas, dos de ellas reels» con un ritmo de 3 × reel es una
// incoherencia que la persona ve (prueba de calidad del 23/11/2026, fallo 15).
// Sin IA: se leen las cifras del texto y, si no cuadran con el ritmo final, el
// texto se rehace con las del ritmo.

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14,
};
/** Palabras que cuentan publicaciones en total (no un formato). */
const TOTAL_WORDS = ['publicacion', 'publicaciones', 'pieza', 'piezas'];

const numberOf = (word: string): number | null =>
  /^\d{1,2}$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? null);

/**
 * Cifras que da un texto: por grupo de formato («dos reels», «3 carruseles»)
 * y en total («tres publicaciones»). Busca el número hasta tres palabras antes.
 */
export function countsInText(text: string): { total: number | null; byGroup: Map<number, number> } {
  const words = canon(text).split('_').filter(Boolean);
  const byGroup = new Map<number, number>();
  const totals: number[] = [];
  words.forEach((word, i) => {
    const isTotal = TOTAL_WORDS.includes(word);
    const group = isTotal ? -1 : FORMAT_GROUPS.findIndex((g) => g.words.includes(word));
    if (group < 0 && !isTotal) return;
    for (let back = 1; back <= 3 && i - back >= 0; back += 1) {
      const n = numberOf(words[i - back]!);
      if (n === null) continue;
      if (isTotal) totals.push(n);
      else byGroup.set(group, (byGroup.get(group) ?? 0) + n);
      break;
    }
  });
  // «dos reels y una publicación»: junto a otros formatos, «publicación» es una foto, no el total.
  if (byGroup.size > 0 && totals.length > 0) {
    const post = FORMAT_GROUPS.findIndex((g) => g.formats.includes('post'));
    byGroup.set(post, (byGroup.get(post) ?? 0) + totals.reduce((a, b) => a + b, 0));
    return { total: null, byGroup };
  }
  return { total: totals[0] ?? null, byGroup };
}

const groupOf = (format: string): number => FORMAT_GROUPS.findIndex((g) => g.formats.includes(format));

/** ¿Las cifras que da el texto son las del ritmo? Sin cifras, sí. */
export function whyMatchesMix(why: string, mix: BriefMixItem[], perWeek: number): boolean {
  const { total, byGroup } = countsInText(why);
  if (total !== null && total !== perWeek && !byGroup.size) return false;
  for (const [group, count] of byGroup) {
    const have = mix.filter((m) => groupOf(m.format) === group).reduce((sum, m) => sum + m.perWeek, 0);
    if (have !== count) return false;
  }
  return true;
}

const FORMAT_NAMES: Record<string, [string, string]> = {
  reel: ['reel', 'reels'],
  video: ['vídeo', 'vídeos'],
  short: ['short', 'shorts'],
  post: ['publicación', 'publicaciones'],
  page_post: ['publicación', 'publicaciones'],
  photo: ['foto', 'fotos'],
  pin: ['pin', 'pines'],
  carousel: ['carrusel', 'carruseles'],
  story: ['historia', 'historias'],
};

/** «3 reels y 1 publicación a la semana». */
export function rhythmSentence(mix: BriefMixItem[]): string {
  const counts = new Map<string, number>();
  for (const m of mix) {
    const [one, many] = FORMAT_NAMES[m.format] ?? [m.format, m.format];
    const key = `${one}|${many}`;
    counts.set(key, (counts.get(key) ?? 0) + m.perWeek);
  }
  const parts = [...counts].map(([key, n]) => `${n} ${n === 1 ? key.split('|')[0] : key.split('|')[1]}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : (parts[0] ?? '');
  return `${list} a la semana`;
}

/** El reparto que dice el texto del modelo («dos reels y una publicación»), si lo dice con cifras. */
export function mixFromText(text: string, targets: CampaignTarget[], networks: string[]): BriefMixItem[] {
  const { byGroup } = countsInText(text);
  const out: BriefMixItem[] = [];
  for (const [group, count] of byGroup) {
    const network = networks.find((n) => targets.some((t) => t.network === n && FORMAT_GROUPS[group]!.formats.includes(t.format)));
    const target = network ? targets.find((t) => t.network === network && FORMAT_GROUPS[group]!.formats.includes(t.format)) : undefined;
    if (target && count >= 1) out.push({ network: target.network, format: target.format, perWeek: Math.min(MAX_PER_WEEK_PER_TARGET, count) });
  }
  return out;
}

// ── Saneado ──────────────────────────────────────────────────────────────

interface RawBrief {
  question: string;
  title: string;
  objective: string;
  networks: string[];
  startDate: string;
  endDate: string;
  perWeek: number;
  mix: BriefMixItem[];
  weeks: BriefWeek[];
  why: string;
}

const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);

/**
 * Deja en la propuesta solo lo que se puede usar. Determinista y sin añadir
 * contenido del modelo que no estuviera: lo que falta se rellena con valores
 * neutros (la semana que viene, el ritmo repartido entre las redes elegidas).
 */
export function sanitizeBrief(
  raw: RawBrief,
  ctx: { today: string; targets: CampaignTarget[]; /** Lo que dijo la persona: guía el reparto de respaldo. */ hint?: string },
): { proposal: CampaignBriefProposal; notes: string[]; diagnostic: string | null } {
  const notes: string[] = [];
  const today = dayNumber(ctx.today)!;
  const networks = [
    ...new Set((Array.isArray(raw.networks) ? raw.networks : []).flatMap((n) => resolveNetwork(n, ctx.targets) ?? [])),
  ];
  if (networks.length === 0) {
    const first = ctx.targets[0]!.network;
    networks.push(first);
    notes.push('La IA no eligió ninguna red de las de la marca: he dejado la primera.');
  }

  // Fechas: reales, desde mañana, y de 1 a MAX_CAMPAIGN_DAYS días.
  let start = dayNumber(raw.startDate);
  if (start === null || start <= today) {
    start = start === null ? nextMonday(today) : today + 1;
    notes.push('He ajustado el comienzo: una campaña no puede empezar antes de mañana.');
  }
  let end = dayNumber(raw.endDate);
  if (end === null || end < start) {
    end = start + 6;
    notes.push('La fecha final no era válida: he puesto una semana.');
  }
  if (end - start + 1 > MAX_CAMPAIGN_DAYS) {
    end = start + MAX_CAMPAIGN_DAYS - 1;
    notes.push(`Un plan dura como mucho ${MAX_CAMPAIGN_DAYS} días: he acortado la campaña.`);
  }
  const weekCount = weeksBetween(start, end);

  // Ritmo: solo formatos de la marca y de las redes elegidas, acotado. Se normalizan los nombres
  // («Reels», «Instagram», «publicación»), se leen números escritos como texto y las repeticiones se suman.
  const sums = new Map<string, BriefMixItem>();
  let normalized = false;
  let diagnostic: string | null = null;
  for (const item of Array.isArray(raw.mix) ? raw.mix : []) {
    // «instagram/reel» en un solo campo, o la red sin decir.
    const [maybeNetwork, maybeFormat] = typeof item?.format === 'string' && item.format.includes('/') ? item.format.split('/') : [item?.network, item?.format];
    // Sin red dicha vale la única elegida; una red dicha que no es de la marca no se reasigna a otra.
    const network = canon(maybeNetwork)
      ? resolveNetwork(maybeNetwork, ctx.targets)
      : networks.length === 1
        ? networks[0]!
        : null;
    if (!network || !networks.includes(network)) continue;
    const format = resolveFormat(network, maybeFormat, ctx.targets);
    const perWeek = parsePerWeek(item?.perWeek);
    if (!format || perWeek < 1) continue;
    if (network !== item.network || format !== item.format || perWeek !== item.perWeek) normalized = true;
    const key = `${network}/${format}`;
    const had = sums.get(key);
    sums.set(key, { network, format, perWeek: Math.min(MAX_PER_WEEK_PER_TARGET, (had?.perWeek ?? 0) + perWeek) });
  }
  let mix = [...sums.values()];
  const wanted = parsePerWeek(raw.perWeek);
  if (mix.length > 0) {
    // Si lo que suma el reparto no es el total que dijo, se ajusta proporcionalmente (no se tira el reparto).
    const have = mix.reduce((sum, m) => sum + m.perWeek, 0);
    if (wanted >= mix.length && wanted <= MAX_PER_WEEK_TOTAL && wanted !== have) {
      const shares = apportion(wanted, mix.map((m) => m.perWeek));
      mix = mix.map((m, i) => ({ ...m, perWeek: Math.min(MAX_PER_WEEK_PER_TARGET, shares[i]!) }));
      notes.push(`He ajustado el reparto para que sume ${mix.reduce((sum, m) => sum + m.perWeek, 0)} a la semana.`);
    }
  } else if (mixFromText(clean(raw.why, 500), ctx.targets, networks).length > 0) {
    // Sin reparto utilizable, pero el texto del modelo lo dice con cifras («dos reels y una
    // publicación»): se usa ese, así el texto y el ritmo cuadran.
    diagnostic = JSON.stringify({ mix: raw.mix, perWeek: raw.perWeek }).slice(0, 600);
    mix = mixFromText(clean(raw.why, 500), ctx.targets, networks);
  } else {
    // Sin reparto utilizable: según los formatos que pidió la persona y, si no dijo ninguno, entre todos los de las redes elegidas.
    diagnostic = JSON.stringify({ mix: raw.mix, perWeek: raw.perWeek }).slice(0, 600);
    let slots = formatsAsked(ctx.hint ?? '', ctx.targets, networks);
    const askedSome = slots.length > 0;
    if (!askedSome) {
      slots = networks.flatMap((network) =>
        ctx.targets.filter((t) => t.network === network).map((t) => ({ network, format: t.format, weight: 1 })),
      );
    }
    slots = slots.slice(0, MAX_PER_WEEK_TOTAL);
    const total = Math.min(MAX_PER_WEEK_TOTAL, Math.max(slots.length, wanted >= 1 ? wanted : Math.max(3, slots.length)));
    const shares = apportion(total, slots.map((slot) => slot.weight));
    mix = slots.map((slot, i) => ({ network: slot.network, format: slot.format, perWeek: Math.min(MAX_PER_WEEK_PER_TARGET, shares[i]!) }));
    notes.push(
      askedSome
        ? 'El reparto de la IA no era utilizable: lo he rehecho con los formatos que pediste.'
        : 'El reparto de la IA no era utilizable: lo he repartido a partes iguales entre los formatos.',
    );
  }
  if (normalized && diagnostic === null) diagnostic = JSON.stringify({ mix: raw.mix, perWeek: raw.perWeek }).slice(0, 600);
  // Tope total: se quita de los de más peso, de uno en uno.
  let total = mix.reduce((sum, m) => sum + m.perWeek, 0);
  while (total > MAX_PER_WEEK_TOTAL) {
    const heaviest = mix.reduce((a, b) => (b.perWeek > a.perWeek ? b : a));
    heaviest.perWeek -= 1;
    total -= 1;
  }

  const weeks = (Array.isArray(raw.weeks) ? raw.weeks : [])
    .map((week) => ({ title: clean(week?.title, 80), focus: clean(week?.focus, 240) }))
    .filter((week) => week.title)
    .slice(0, weekCount);

  const title = clean(raw.title, 120);
  const objective = clean(raw.objective, 600);
  const weeksText = `${weekCount} ${weekCount === 1 ? 'semana' : 'semanas'}`;
  const ownWhy = clean(raw.why, 500);
  // Si el texto da cifras que no son las del ritmo final, se rehace con las del ritmo
  // (se conservan las frases del modelo que no dan cifras: el porqué).
  const consistent = whyMatchesMix(ownWhy, mix, total);
  const sentences = ownWhy.split(/(?<=[.!?])\s+/).filter(Boolean);
  const because = /\bporque\s+(.+?)[.!?]?$/i.exec(sentences[0] ?? '')?.[1];
  const noCounts = (sentence: string) => {
    const counts = countsInText(sentence);
    return counts.byGroup.size === 0 && counts.total === null;
  };
  const reasons = [
    ...(because && noCounts(because) ? [`Porque ${because}.`] : []),
    ...sentences.slice(1).filter(noCounts),
  ].join(' ');
  const why = !ownWhy
    ? `Te propongo ${weeksText} con ${rhythmSentence(mix)}.`
    : consistent
      ? ownWhy
      : clean(`Te propongo ${weeksText} con ${rhythmSentence(mix)}.${reasons ? ` ${reasons}` : ''}`, 500);
  return {
    proposal: {
      title,
      objective,
      networks,
      startDate: dayFromNumber(start),
      endDate: dayFromNumber(end),
      perWeek: total,
      mix,
      weeks,
      why,
    },
    notes,
    diagnostic,
  };
}

function validTargets(targets: unknown): CampaignTarget[] {
  if (!Array.isArray(targets) || targets.length === 0) throw new AiTaskInputError('No hay redes que ofrecer.');
  if (targets.length > MAX_BRIEF_TARGETS) throw new AiTaskInputError(`Como mucho ${MAX_BRIEF_TARGETS} destinos.`);
  const out: CampaignTarget[] = [];
  for (const target of targets as unknown[]) {
    const { network, format } = (typeof target === 'object' && target !== null ? target : {}) as Record<
      string,
      unknown
    >;
    if (typeof network !== 'string' || !ID.test(network) || typeof format !== 'string' || !ID.test(format)) {
      throw new AiTaskInputError('Algún destino (red y formato) no es válido.');
    }
    if (!out.some((t) => t.network === network && t.format === format)) out.push({ network, format });
  }
  return out;
}

function validProposal(value: unknown, targets: CampaignTarget[]): BriefProposal {
  const p = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const start = typeof p.startDate === 'string' ? p.startDate : '';
  const end = typeof p.endDate === 'string' ? p.endDate : '';
  if (dayNumber(start) === null || dayNumber(end) === null) throw new AiTaskInputError('La propuesta anterior no es válida.');
  const mix = (Array.isArray(p.mix) ? p.mix : [])
    .map((m): BriefMixItem => {
      const item = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
      return {
        network: typeof item.network === 'string' ? item.network : '',
        format: typeof item.format === 'string' ? item.format : '',
        perWeek: Math.min(MAX_PER_WEEK_PER_TARGET, Math.max(0, whole(item.perWeek))),
      };
    })
    .filter((m) => targets.some((t) => t.network === m.network && t.format === m.format) && m.perWeek > 0);
  const networks = (Array.isArray(p.networks) ? p.networks : []).filter(
    (n): n is string => typeof n === 'string' && targets.some((t) => t.network === n),
  );
  const weeks = (Array.isArray(p.weeks) ? p.weeks : []).slice(0, MAX_BRIEF_WEEKS).map((w): BriefWeek => {
    const week = (typeof w === 'object' && w !== null ? w : {}) as Record<string, unknown>;
    return { title: clean(week.title, 80), focus: clean(week.focus, 240) };
  });
  return {
    title: clean(p.title, 120),
    objective: clean(p.objective, 600),
    networks,
    startDate: start,
    endDate: end,
    perWeek: Math.min(MAX_PER_WEEK_TOTAL, Math.max(0, whole(p.perWeek))),
    mix,
    weeks,
  };
}

// ── Tarea ────────────────────────────────────────────────────────────────

export async function proposeCampaignBrief(
  service: AiService,
  actor: TaskActor,
  request: CampaignBriefRequest,
  log?: (event: string, data: Record<string, unknown>) => void,
): Promise<CampaignBriefResult> {
  const instruction = requireText(request.instruction, 'lo que quieres preparar', MAX_BRIEF_CHARS);
  const today = dayNumber(request.today);
  if (today === null) throw new AiTaskInputError('La fecha de hoy no es válida (AAAA-MM-DD).');
  const targets = validTargets(request.targets);
  if (request.adjust !== undefined && request.adjust !== 'shorter' && request.adjust !== 'longer') {
    throw new AiTaskInputError('El ajuste pedido no es válido.');
  }
  const current = request.current === undefined ? undefined : validProposal(request.current, targets);
  if (request.adjust && !current) throw new AiTaskInputError('Para ajustar hace falta la propuesta anterior.');
  const answer =
    request.answer === undefined
      ? undefined
      : {
          question: requireText(request.answer.question, 'la pregunta', 200),
          text: requireText(request.answer.text, 'la respuesta', 500),
        };

  const context = [
    brandProfileContext(request.brandProfile),
    { label: 'lo que quiere', content: instruction },
    { label: 'hoy', content: request.today },
    ...(answer ? [{ label: 'respuesta', content: JSON.stringify(answer) }] : []),
    ...(current ? [{ label: 'propuesta actual', content: JSON.stringify(current) }] : []),
  ];
  const adjustLine =
    request.adjust === 'shorter'
      ? 'Encargo: acorta la propuesta actual una semana.'
      : request.adjust === 'longer'
        ? 'Encargo: alarga la propuesta actual una semana.'
        : 'Propón los datos del formulario.';
  const prompt = [
    'Destinos (red/formato):',
    ...targets.map((t) => `- Destino: ${t.network}/${t.format}`),
    `Duración máxima: ${MAX_CAMPAIGN_DAYS} días.`,
    adjustLine,
  ].join('\n');

  const { data, meta } = await runStructuredTask(service, {
    actor,
    purpose: CAMPAIGN_BRIEF_PURPOSE,
    instructions: CAMPAIGN_BRIEF_INSTRUCTIONS,
    context,
    prompt,
    schema: CAMPAIGN_BRIEF_SCHEMA,
    maxOutputTokens: 1500,
  });

  const raw = data as unknown as RawBrief;
  const question = clean(raw.question, 200);
  // Una pregunta solo vale si es la primera: tras una respuesta, o al ajustar, hay que proponer.
  if (question && !answer && !request.adjust) {
    return { ...meta, status: 'question', question, proposal: null, notes: [] };
  }
  if (question && (answer || request.adjust) && !clean(raw.startDate, 10) && !clean(raw.title, 120)) {
    throw new AiError('invalid_output', 'La IA no ha podido proponer los datos de la campaña. Cuéntalo con otras palabras.', {
      generationId: meta.generationId,
    });
  }
  const { proposal, notes, diagnostic } = sanitizeBrief(raw, {
    today: request.today,
    targets,
    hint: `${instruction} ${answer?.text ?? ''}`,
  });
  // Solo identificadores y números del reparto (nada de lo que escribió la persona): sirve para ver qué devuelve un modelo real.
  if (diagnostic) log?.('brief_mix_normalized', { mix: diagnostic });
  return { ...meta, status: 'proposal', question: null, proposal, notes };
}
