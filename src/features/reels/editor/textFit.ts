// Textos de la vista previa con los MISMOS mínimos que el vídeo
// (docs/reels-calidad.md, punto 1 y 2): tamaño mínimo por papel, cortes de
// línea equilibrados, zonas seguras de Instagram, caja o contorno para que se
// lea y nunca dos textos encima uno de otro (se apilan o se encadenan).
//
// Es la misma cuenta que el trabajador (worker/src/reel/textlayout.ts y
// `legible` en worker/src/reel/build.ts), repetida aquí porque aquella lee las
// tipografías con `node:fs`. La prueba tests/db/vista-previa-textos.test.ts
// compara las dos con los mismos datos para que no se separen.
//
// Lo único que cambia es cómo se mide: el trabajador lee las medidas de la
// tipografía del archivo; aquí se pasa un medidor (el del lienzo del navegador,
// con la letra que se dibuja) o, sin él, el ancho medio de siempre.
//
// Puro: sin React ni lienzo.
import type { TextAnimation } from './animation';
import type { TextPosition, TextRole, TextStyle } from './project';

/** Zonas que tapa Instagram (1080 × 1920): 250 px arriba, 400 px abajo, 60 px a los lados. */
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
/** Lo mínimo para un texto sin papel. */
export const MIN_SIZE_RATIO = 0.05;
/** Ancho medio de un carácter cuando no hay con qué medir (el del trabajador sin medidas). */
export const FALLBACK_GLYPH_WIDTH = 0.6;
/** Por debajo de este tamaño, un texto sin caja la lleva: el contorno solo no basta. */
export const BOX_BELOW_SIZE = 0.075;
/** Fundido mínimo: un texto que aparece de golpe parece un error. */
export const MIN_TEXT_FADE = 0.2;
/** Lo mínimo que un texto encadenado tiene que verse para que se lea. */
export const MIN_READ_SECONDS = 0.9;
const STACK_GAP = 0.018;
const SHORT_OVERLAP = 0.6;
const MIN_VISIBLE_SECONDS = 0.1;

/** Animación por defecto de un texto con papel explícito y sin animación propia (`ROLE_ANIMATION`). */
export const ROLE_ANIMATION: Record<TextRole, TextAnimation> = {
  headline: { in: 'rise', out: 'fade', seconds: 0.4 },
  label: { in: 'rise', out: 'fade', seconds: 0.35 },
  price: { in: 'zoom', out: 'fade', seconds: 0.35 },
  cta: { in: 'zoom', out: 'fade', seconds: 0.4 },
};

const WEAK_ENDINGS = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'el',
  'en',
  'la',
  'las',
  'lo',
  'los',
  'para',
  'por',
  'que',
  'se',
  'su',
  'sus',
  'tu',
  'tus',
  'un',
  'una',
  'y',
  'o',
  'e',
  'u',
  'mi',
  'mis',
  'sin',
  'sobre',
  'the',
  'of',
  'and',
  'to',
  'for',
]);

export interface Measurer {
  /** Ancho del texto en píxeles con la letra a `size` px. */
  width(text: string, size: number): number;
  /** Alto de una línea (subida + bajada de la tipografía) a `size` px. */
  lineHeight(size: number): number;
}

/** Sin medidas de la tipografía: lo mismo que el trabajador en ese caso. */
export const fallbackMeasurer: Measurer = {
  width: (text, size) => [...text].length * size * FALLBACK_GLYPH_WIDTH,
  lineHeight: (size) => size * 1.17,
};

function clean(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
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

/** Líneas con el menor número posible, parejas y sin «de», «la», «y»… al final de una línea. */
export function balancedParagraph(paragraph: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = paragraph.split(' ').filter(Boolean);
  if (words.length <= 1) return words;
  const lineWidth = (from: number, to: number) => measure(words.slice(from, to).join(' '));
  const count = greedy(words, maxWidth, measure).length;
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

export function balancedLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  return clean(text).flatMap((p) => balancedParagraph(p, maxWidth, measure));
}

export interface LaidText {
  lines: string[];
  fontSize: number;
  lineStep: number;
  /** Alto de la caja de una línea (sin el relleno). */
  lineBox: number;
  padding: number;
  /** Arriba de la primera línea. */
  top: number;
  /** Lo que ocupa el bloque, con la caja: [arriba, abajo]. */
  extent: [number, number];
  blockWidth: number;
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

function clampBlock(top: number, blockHeight: number, area: SafeArea): number {
  if (blockHeight >= area.bottom - area.top) return area.top;
  return Math.min(Math.max(top, area.top), area.bottom - blockHeight);
}

type BoxStyle = Pick<TextStyle, 'sizeRatio' | 'marginRatio' | 'maxWidthRatio' | 'lineHeight'> & {
  box: { paddingRatio: number } | null;
};

/** Medidas y sitio de un texto, como `layoutText` del trabajador. */
export function layoutText(
  input: {
    text: string;
    style: BoxStyle;
    position: TextPosition;
    role?: TextRole | null;
    offset?: { x: number; y: number };
    maxLines?: number;
  },
  width: number,
  height: number,
  m: Measurer = fallbackMeasurer,
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
  const lineStep = input.style.box
    ? lineBox + 2 * pad + Math.round(size * 0.06)
    : Math.round(
        size * Math.max(1, rule ? Math.min(input.style.lineHeight, rule.lineHeight + 0.1) : input.style.lineHeight),
      );
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

function moveLaid(laid: LaidText, blockTop: number): LaidText {
  const h = laid.extent[1] - laid.extent[0];
  return { ...laid, top: blockTop + laid.padding, extent: [blockTop, blockTop + h] };
}

export interface PlacedText {
  index: number;
  start: number;
  end: number;
  laid: LaidText;
  resolved?: 'stacked' | 'chained';
}

const timeOverlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.02;
const spaceOverlap = (a: [number, number], b: [number, number], gap: number) => a[0] < b[1] + gap && b[0] < a[1] + gap;

/** Coloca los textos sin que dos coincidan a la vez en el mismo sitio (`placeTexts` del trabajador). */
export function placeTexts(
  items: Array<{ index: number; start: number; end: number; laid: LaidText; position: TextPosition }>,
  width: number,
  height: number,
): PlacedText[] {
  const area = safeArea(width, height);
  const gap = Math.round(STACK_GAP * height);
  const placed: PlacedText[] = [];
  const order = [...items].sort((a, b) => a.start - b.start || a.index - b.index);
  for (const item of order) {
    let current: PlacedText = { index: item.index, start: item.start, end: item.end, laid: item.laid };
    const clashes = (candidate: PlacedText) =>
      placed.filter((p) => timeOverlap(p, candidate) && spaceOverlap(p.laid.extent, candidate.laid.extent, gap));
    let hit = clashes(current);
    if (
      hit.length > 0 &&
      hit.every((p) => p.end - current.start <= SHORT_OVERLAP && current.start - p.start >= MIN_READ_SECONDS)
    ) {
      for (const p of hit) p.end = Number((current.start - 0.04).toFixed(3));
      hit = clashes(current);
    }
    if (hit.length === 0) {
      placed.push(current);
      continue;
    }
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
      const moved = { ...current, laid: moveLaid(current.laid, top) };
      if (!busy.some((p) => spaceOverlap(p.laid.extent, moved.laid.extent, gap))) {
        stacked = { ...moved, resolved: 'stacked' };
        break;
      }
    }
    if (stacked) {
      placed.push(stacked);
      continue;
    }
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
        const other = hit[0]!;
        const mid = Number(((Math.max(other.start, current.start) + Math.max(other.end, current.end)) / 2).toFixed(3));
        other.end = Math.max(other.start + 0.3, mid - 0.04);
        current = { ...current, start: Math.min(mid, current.end - 0.3) };
      }
    }
    current.resolved = 'chained';
    if (clashes(current).length > 0) continue;
    placed.push(current);
  }
  return placed.sort((a, b) => a.index - b.index);
}

/** Papel de un texto sin papel (`inferRole` del trabajador). */
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

/** Color de contorno o caja que contrasta con el del texto. */
export function contrastingDark(hex: string): string {
  const v = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lum = 0.2126 * v(0) + 0.7152 * v(1) + 0.0722 * v(2);
  return lum > 0.45 ? '#000000' : '#FFFFFF';
}

/** El estilo con lo mínimo para leerse sobre cualquier foto (`legible` del trabajador). */
export function legibleStyle(style: TextStyle, role: TextRole | null): TextStyle {
  const next: TextStyle = { ...style, fadeSeconds: Math.max(style.fadeSeconds, MIN_TEXT_FADE) };
  if (!next.box && (role === 'label' || role === null) && style.sizeRatio < BOX_BELOW_SIZE) {
    next.box = { color: contrastingDark(next.color), opacity: 0.62, paddingRatio: 0.3 };
    next.outline = null;
  }
  if (!next.box) {
    const outline = next.outline;
    next.outline = {
      color: outline?.color ?? contrastingDark(next.color),
      widthRatio: Math.max(outline?.widthRatio ?? 0, 0.03),
    };
  }
  return next;
}

// ───────────────────────────── Todos los textos de un reel ─────────────────────────────

export interface FitInputText {
  id: string;
  text: string;
  start: number;
  end: number;
  position: TextPosition;
  style: TextStyle;
  animation?: TextAnimation;
  offset?: { x: number; y: number };
  role?: TextRole;
}

export interface FitInputCue {
  key: string;
  text: string;
  start: number;
  end: number;
}

export interface FittedText {
  /** `id` del texto o `key` del subtítulo. */
  key: string;
  kind: 'text' | 'subtitle';
  role: TextRole | null;
  /** Cuándo se ve (encadenado si chocaba con otro). */
  start: number;
  end: number;
  /** El estilo que dibuja el vídeo (con caja o contorno y el fundido mínimo). */
  style: TextStyle;
  laid: LaidText;
  /** La animación que hará el vídeo: la suya o la de su papel (si el papel es explícito). */
  animation?: TextAnimation;
  offsetX: number;
}

/**
 * Los textos y subtítulos de un reel tal como los dibuja el vídeo: con el papel
 * (el guardado o el deducido), el estilo legible, las líneas equilibradas, la
 * franja dentro de las zonas seguras y, si dos coinciden, apilados o encadenados.
 * `end` es lo que dura el vídeo hasta el cierre: lo que pase de ahí se recorta.
 */
export function fitTexts(
  input: {
    texts: readonly FitInputText[];
    cues?: readonly FitInputCue[];
    subtitles?: { position: TextPosition; style: TextStyle } | null;
    /** Final de los planos (sin el cierre) y segundo en que empieza a entrar el cierre. */
    clipsTotal: number;
    outroStart?: number;
    maxTextLines: number;
    maxSubtitleLines: number;
  },
  width: number,
  height: number,
  measurerFor: (style: TextStyle, role: TextRole | null) => Measurer = () => fallbackMeasurer,
): FittedText[] {
  const limit = input.outroStart ?? input.clipsTotal;
  const pending: Array<FittedText & { position: TextPosition }> = [];
  const firstStart = Math.min(...input.texts.map((t) => t.start), Number.POSITIVE_INFINITY);
  input.texts.forEach((item, index) => {
    let start = Math.min(item.start, limit);
    const end = Math.min(item.end, limit);
    if (end - start < MIN_VISIBLE_SECONDS || !item.text.trim()) return;
    const explicit = item.role ?? null;
    const role = explicit ?? inferRole(item, index, input.clipsTotal, firstStart);
    if (role === 'headline' && !item.animation && start > 0.15 && start <= 1) start = 0.15;
    const style = legibleStyle(item.style, role);
    const laid = layoutText(
      { text: item.text, style, position: item.position, role, offset: item.offset, maxLines: input.maxTextLines },
      width,
      height,
      measurerFor(style, role),
    );
    if (laid.lines.length === 0) return;
    const animation = item.animation ?? (explicit ? ROLE_ANIMATION[explicit] : undefined);
    pending.push({
      key: item.id,
      kind: 'text',
      role,
      start,
      end,
      style,
      laid,
      ...(animation ? { animation } : {}),
      offsetX: item.offset?.x ?? 0,
      position: item.position,
    });
  });
  if (input.subtitles && input.cues) {
    const style = legibleStyle(input.subtitles.style, 'label');
    const m = measurerFor(style, 'label');
    for (const cue of input.cues) {
      const start = Math.min(cue.start, limit);
      const end = Math.min(cue.end, limit);
      if (end - start < MIN_VISIBLE_SECONDS) continue;
      const laid = layoutText(
        { text: cue.text, style, position: input.subtitles.position, role: null, maxLines: input.maxSubtitleLines },
        width,
        height,
        m,
      );
      if (laid.lines.length === 0) continue;
      pending.push({
        key: cue.key,
        kind: 'subtitle',
        role: 'label',
        start,
        end,
        style,
        laid,
        offsetX: 0,
        position: input.subtitles.position,
      });
    }
  }
  const placed = placeTexts(
    pending.map((p, index) => ({ index, start: p.start, end: p.end, laid: p.laid, position: p.position })),
    width,
    height,
  );
  return placed.map((spot) => {
    const p = pending[spot.index]!;
    return {
      key: p.key,
      kind: p.kind,
      role: p.role,
      start: spot.start,
      end: spot.end,
      style: p.style,
      laid: spot.laid,
      ...(p.animation ? { animation: p.animation } : {}),
      offsetX: p.offsetX,
    };
  });
}
