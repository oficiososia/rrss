// Composición de los textos del reel: tamaño por papel, cortes de línea
// equilibrados, zonas seguras de Instagram y NUNCA dos textos encima uno de
// otro. Es una cuenta pura: `build.ts` la traduce a `drawtext`.
//
//   Papel       para qué                       tamaño mínimo (fracción del ancho)
//   headline    titular / gancho del principio  0,085  (≈ 92 px en 1080)
//   label       rótulo, paso, detalle           0,056  (≈ 60 px)
//   price       precio o dato grande            0,075
//   cta         llamada final                   0,072
//   (sin papel) lo que escribe la persona       0,05   (solo se sube si es menor)
//
// Zonas seguras (Instagram, 1080 × 1920): nada importante en los 250 px de
// arriba, en los 400 px de abajo ni a menos de 60 px de los lados. Se guardan
// como proporciones para cualquier tamaño de salida.
//
// Solapes: dos textos que coinciden en el tiempo y en la vertical se APILAN
// (el segundo debajo o encima del primero, dentro de la zona segura). Si no
// caben, se ENCADENAN: el primero sale antes y el segundo entra cuando el
// primero ya se ha ido. Así nunca se dibujan dos textos en el mismo sitio.
import type { FontMetrics } from '../ffmpeg/fontmetrics.ts';
import { lineBoxHeight, measureText } from '../ffmpeg/fontmetrics.ts';

export const TEXT_ROLES = ['headline', 'label', 'price', 'cta'] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

/** Zonas que tapa Instagram (1080 × 1920). */
export const SAFE_ZONE = { top: 250 / 1920, bottom: 400 / 1920, side: 60 / 1080 } as const;

export interface RoleRule {
  minSizeRatio: number;
  maxLines: number;
  /** Alto de línea de un texto sin caja (en tamaños de letra). */
  lineHeight: number;
}

export const ROLE_RULES: Record<TextRole, RoleRule> = {
  headline: { minSizeRatio: 0.085, maxLines: 3, lineHeight: 1.08 },
  label: { minSizeRatio: 0.056, maxLines: 3, lineHeight: 1.18 },
  price: { minSizeRatio: 0.075, maxLines: 2, lineHeight: 1.08 },
  cta: { minSizeRatio: 0.072, maxLines: 2, lineHeight: 1.1 },
};
/** Lo mínimo para un texto sin papel: más pequeño no se lee en un móvil. */
export const MIN_SIZE_RATIO = 0.05;
/** Ancho medio de un carácter respecto al tamaño de letra cuando no hay medidas de la tipografía. */
export const FALLBACK_GLYPH_WIDTH = 0.6;
/** Hueco entre dos textos apilados, como fracción del alto. */
const STACK_GAP = 0.018;
/** Lo mínimo que un texto encadenado tiene que verse para que se lea. */
export const MIN_READ_SECONDS = 0.9;
/** Un solape de hasta esto (una transición) no se apila: el texto anterior sale justo antes. */
const SHORT_OVERLAP = 0.6;

/** Palabras que no deben quedar solas al final de una línea («de la / cocina»). */
const WEAK_ENDINGS = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'para', 'por', 'que', 'se', 'su', 'sus',
  'tu', 'tus', 'un', 'una', 'y', 'o', 'e', 'u', 'mi', 'mis', 'sin', 'sobre', 'the', 'of', 'and', 'to', 'for',
]);

export interface Measurer {
  /** Ancho del texto en píxeles con la letra a `size` px. */
  width(text: string, size: number): number;
  /** Alto de una línea (subida + bajada de la tipografía) a `size` px. */
  lineHeight(size: number): number;
}

export function measurer(metrics: FontMetrics | null | undefined): Measurer {
  if (!metrics) {
    return {
      width: (text, size) => [...text].length * size * FALLBACK_GLYPH_WIDTH,
      lineHeight: (size) => size * 1.17,
    };
  }
  return { width: (text, size) => measureText(metrics, text, size), lineHeight: (size) => lineBoxHeight(metrics, size) };
}

function clean(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Parte un párrafo en líneas de como mucho `maxWidth` px con el MENOR número de
 * líneas posible y, con ese número, lo más parejas posible y sin dejar una
 * palabra débil («de», «la», «y»…) al final de una línea. Una palabra que no cabe
 * sola va en su línea (se avisa fuera).
 */
export function balancedParagraph(paragraph: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = paragraph.split(' ').filter(Boolean);
  if (words.length <= 1) return words;
  const lineWidth = (from: number, to: number) => measure(words.slice(from, to).join(' '));
  // Menor número de líneas: el reparto voraz.
  const count = greedy(words, maxWidth, measure).length;
  // Con ese número de líneas, el reparto de menor coste (programación dinámica).
  const n = words.length;
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(INF));
  const from: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(-1));
  cost[0]![0] = 0;
  for (let lines = 1; lines <= count; lines += 1) {
    for (let end = 1; end <= n; end += 1) {
      for (let start = lines - 1; start < end; start += 1) {
        const before = cost[lines - 1]![start]!;
        if (before === INF) continue;
        const width = lineWidth(start, end);
        if (width > maxWidth && end - start > 1) continue;
        const slack = Math.max(0, maxWidth - width) / maxWidth;
        const last = words[end - 1]!.toLocaleLowerCase('es').replace(/[^\p{L}]/gu, '');
        const weak = end < n && WEAK_ENDINGS.has(last) ? 0.6 : 0;
        const c = before + slack * slack + weak;
        if (c < cost[lines]![end]!) {
          cost[lines]![end] = c;
          from[lines]![end] = start;
        }
      }
    }
  }
  if (cost[count]![n] === INF) return greedy(words, maxWidth, measure);
  const out: string[] = [];
  let end = n;
  for (let lines = count; lines > 0; lines -= 1) {
    const start = from[lines]![end]!;
    out.unshift(words.slice(start, end).join(' '));
    end = start;
  }
  return out;
}

function greedy(words: string[], maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      out.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) out.push(line);
  return out;
}

export function balancedLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  return clean(text).flatMap((p) => balancedParagraph(p, maxWidth, measure));
}

export interface TextBoxStyle {
  sizeRatio: number;
  marginRatio: number;
  maxWidthRatio: number;
  lineHeight: number;
  box: { paddingRatio: number } | null;
}

export interface LaidText {
  lines: string[];
  fontSize: number;
  /** Distancia entre la parte de arriba de una línea y la siguiente. */
  lineStep: number;
  /** Alto de la caja de una línea (sin el relleno). */
  lineBox: number;
  /** Relleno de la caja (0 si no hay caja). */
  padding: number;
  /** Arriba de la primera línea (lo que se pasa a `drawtext` con `y_align=font`). */
  top: number;
  /** Lo que ocupa el bloque, con la caja: [arriba, abajo]. */
  extent: [number, number];
  /** Ancho del bloque (la línea más larga, con la caja). */
  blockWidth: number;
  /** Si se ha tenido que achicar la letra o cortar líneas. */
  shrunk: boolean;
  truncated: boolean;
}

export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function safeArea(width: number, height: number): SafeArea {
  const side = Math.round(SAFE_ZONE.side * width);
  return {
    top: Math.round(SAFE_ZONE.top * height),
    bottom: height - Math.round(SAFE_ZONE.bottom * height),
    left: side,
    right: width - side,
  };
}

/**
 * Medidas y sitio de un texto: tamaño (con el mínimo de su papel), líneas
 * equilibradas que caben en el ancho útil (si no caben en `maxLines`, la letra
 * se achica hasta el mínimo del papel) y su franja dentro de la zona segura.
 */
export function layoutText(
  input: {
    text: string;
    style: TextBoxStyle;
    position: 'top' | 'center' | 'bottom';
    role?: TextRole | null;
    offset?: { x: number; y: number };
    maxLines?: number;
  },
  width: number,
  height: number,
  m: Measurer,
): LaidText {
  const area = safeArea(width, height);
  const rule = input.role ? ROLE_RULES[input.role] : null;
  const floor = rule ? rule.minSizeRatio : MIN_SIZE_RATIO;
  const maxLines = input.maxLines ?? rule?.maxLines ?? 6;
  const padRatio = input.style.box ? input.style.box.paddingRatio : 0;
  let size = Math.max(8, Math.round(Math.max(input.style.sizeRatio, floor) * width));
  const minSize = Math.max(8, Math.round(floor * width * 0.9));
  let lines: string[] = [];
  let shrunk = false;
  let truncated = false;
  for (let guard = 0; guard < 24; guard += 1) {
    const pad = Math.round(padRatio * size);
    const usable = Math.min(input.style.maxWidthRatio * width, area.right - area.left) - 2 * pad;
    lines = balancedLines(input.text, usable, (s) => m.width(s, size));
    const widest = Math.max(0, ...lines.map((l) => m.width(l, size)));
    if ((lines.length <= maxLines && widest <= usable + 1) || size <= minSize) break;
    size = Math.max(minSize, Math.round(size * 0.93));
    shrunk = true;
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }
  const pad = Math.round(padRatio * size);
  const lineBox = Math.round(m.lineHeight(size));
  // Con caja: las cajas de cada línea casi se tocan (un hueco fino). Sin caja: el alto de línea del papel.
  const lineStep = input.style.box
    ? lineBox + 2 * pad + Math.round(size * 0.06)
    : Math.round(size * Math.max(1, rule ? Math.min(input.style.lineHeight, rule.lineHeight + 0.1) : input.style.lineHeight));
  const blockInner = lineStep * (Math.max(1, lines.length) - 1) + lineBox;
  const blockHeight = blockInner + 2 * pad;
  const margin = Math.round(input.style.marginRatio * height);
  let blockTop: number;
  if (input.position === 'top') blockTop = Math.max(margin, area.top);
  else if (input.position === 'bottom') blockTop = Math.min(height - margin, area.bottom) - blockHeight;
  else blockTop = Math.round((area.top + area.bottom - blockHeight) / 2);
  blockTop += Math.round((input.offset?.y ?? 0) * height);
  blockTop = clampBlock(blockTop, blockHeight, area);
  const blockWidth = Math.max(0, ...lines.map((l) => m.width(l, size))) + 2 * pad;
  return {
    lines,
    fontSize: size,
    lineStep,
    lineBox,
    padding: pad,
    top: blockTop + pad,
    extent: [blockTop, blockTop + blockHeight],
    blockWidth,
    shrunk,
    truncated,
  };
}

function clampBlock(top: number, blockHeight: number, area: SafeArea): number {
  if (blockHeight >= area.bottom - area.top) return area.top;
  return Math.min(Math.max(top, area.top), area.bottom - blockHeight);
}

/** Mueve un texto ya medido a otra altura (arriba del bloque). */
export function moveText(laid: LaidText, blockTop: number): LaidText {
  const h = laid.extent[1] - laid.extent[0];
  return { ...laid, top: blockTop + laid.padding, extent: [blockTop, blockTop + h] };
}

export interface PlacedText {
  index: number;
  start: number;
  end: number;
  laid: LaidText;
  /** Qué se hizo para que no pisara a otro. */
  resolved?: 'stacked' | 'chained';
}

const timeOverlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.02;
const spaceOverlap = (a: [number, number], b: [number, number], gap: number) =>
  a[0] < b[1] + gap && b[0] < a[1] + gap;

/**
 * Coloca los textos sin que dos coincidan a la vez en el mismo sitio. Entran
 * por orden de aparición; cada uno, si choca con alguno ya colocado, se apila
 * (debajo o encima, lo que quepa en la zona segura) o, si no cabe, se encadena
 * en el tiempo. Devuelve también avisos legibles.
 */
export function placeTexts(
  items: Array<{ index: number; start: number; end: number; laid: LaidText; position: 'top' | 'center' | 'bottom' }>,
  width: number,
  height: number,
): { placed: PlacedText[]; warnings: string[] } {
  const area = safeArea(width, height);
  const gap = Math.round(STACK_GAP * height);
  const placed: PlacedText[] = [];
  const warnings: string[] = [];
  const order = [...items].sort((a, b) => a.start - b.start || a.index - b.index);
  for (const item of order) {
    let current: PlacedText = { index: item.index, start: item.start, end: item.end, laid: item.laid };
    const clashes = (candidate: PlacedText) =>
      placed.filter((p) => timeOverlap(p, candidate) && spaceOverlap(p.laid.extent, candidate.laid.extent, gap));
    let hit = clashes(current);
    // Un roce corto (lo que dura una transición): el anterior sale un poco antes y este entra en su sitio.
    if (hit.length > 0 && hit.every((p) => p.end - current.start <= SHORT_OVERLAP && current.start - p.start >= MIN_READ_SECONDS)) {
      for (const p of hit) p.end = Number((current.start - 0.04).toFixed(3));
      hit = clashes(current);
    }
    if (hit.length === 0) {
      placed.push(current);
      continue;
    }
    // 1) Apilar: justo debajo o justo encima de lo que coincide en el tiempo.
    const busy = placed.filter((p) => timeOverlap(p, current));
    const h = current.laid.extent[1] - current.laid.extent[0];
    const candidates: number[] = [];
    const below = Math.max(...hit.map((p) => p.laid.extent[1])) + gap;
    const above = Math.min(...hit.map((p) => p.laid.extent[0])) - gap - h;
    if (item.position === 'bottom') candidates.push(above, below);
    else candidates.push(below, above);
    let stacked: PlacedText | null = null;
    for (const top of candidates) {
      if (top < area.top || top + h > area.bottom) continue;
      const moved = { ...current, laid: moveText(current.laid, top) };
      if (!busy.some((p) => spaceOverlap(p.laid.extent, moved.laid.extent, gap))) {
        stacked = { ...moved, resolved: 'stacked' };
        break;
      }
    }
    if (stacked) {
      placed.push(stacked);
      continue;
    }
    // 2) Encadenar: los que chocan salen antes y este entra cuando ya se han ido.
    for (const other of hit) {
      const room = current.start - other.start;
      if (room >= MIN_READ_SECONDS) {
        other.end = Number(Math.max(other.start + MIN_READ_SECONDS, current.start - 0.04).toFixed(3));
        other.resolved = other.resolved ?? 'chained';
      }
    }
    hit = clashes(current);
    if (hit.length > 0) {
      const after = Math.max(...hit.map((p) => p.end)) + 0.04;
      if (current.end - after >= MIN_READ_SECONDS) {
        current = { ...current, start: Number(after.toFixed(3)) };
      } else {
        // Ni apilado ni a continuación: se reparte el tiempo a medias con el que choca.
        const other = hit[0]!;
        const mid = Number(((Math.max(other.start, current.start) + Math.max(other.end, current.end)) / 2).toFixed(3));
        other.end = Math.max(other.start + 0.3, mid - 0.04);
        current = { ...current, start: Math.min(mid, current.end - 0.3) };
      }
    }
    current.resolved = 'chained';
    if (clashes(current).length > 0) {
      warnings.push(`El texto ${item.index + 1} no cabía sin pisar a otro y no se ha puesto`);
      continue;
    }
    placed.push(current);
  }
  for (const p of placed) {
    if (p.resolved === 'stacked') warnings.push(`El texto ${p.index + 1} coincidía con otro: se ha puesto al lado`);
    if (p.resolved === 'chained') warnings.push(`El texto ${p.index + 1} coincidía con otro: se ha encadenado`);
  }
  return { placed: placed.sort((a, b) => a.index - b.index), warnings };
}

/** Papel de un texto sin papel: el gancho del principio, la llamada del final, un precio o un rótulo. */
export function inferRole(
  text: { text: string; start: number; end: number },
  index: number,
  total: number,
  firstStart: number,
): TextRole {
  const plain = text.text.toLocaleLowerCase('es');
  if (/\d\s?(€|eur\b|euros\b)|(€|\$)\s?\d/.test(plain)) return 'price';
  const ctaWords =
    /\b(reserva|reservar|reservad|pide|pídelo|llama|llámanos|visítanos|ven|venid|encarga|compra|apúntate|escríbenos|link|enlace|bio)\b/;
  if (ctaWords.test(plain) && text.end >= total - 3) return 'cta';
  if (index === 0 && text.start <= Math.max(0.6, firstStart + 0.01) && text.start < 1) return 'headline';
  return 'label';
}

/** Color de contorno o sombra que contrasta con el del texto. */
export function contrastingDark(hex: string): string {
  const v = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lum = 0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2);
  return lum > 0.45 ? '#000000' : '#FFFFFF';
}
