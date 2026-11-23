// Qué se ve y qué suena en cada instante del reel, para la vista previa del
// navegador. Puro (sin lienzo ni elementos de vídeo): el reproductor
// (ReelPlayer.tsx) solo dibuja lo que dice esto.
//
// Imita al motor (worker/src/reel/build.ts): mismas duraciones, mismos
// solapes en las transiciones, el mismo movimiento de las fotos, el mismo
// desenfoque relativo y los mismos mínimos de texto (textFit.ts: tamaño por
// papel, caja o contorno, zonas seguras y nunca dos textos encima). Las
// transiciones de FFmpeg (`xfade`) se aproximan: fundido, a negro y
// deslizamientos. Si el plan lleva el cierre con la marca, se ve al final.
import type { ReelTemplateSummary } from '../templates';
import { textAnimState, visiblePerLine } from './animation';
import {
  MAX_SUBTITLE_LINES,
  MAX_TEXT_LINES,
  outroSpan,
  timelineSubtitles,
  type Clip,
  type DraftPlan,
  type OutroSpan,
  type PhotoMotion,
  type PlanTimeline,
  type ReelOutro,
  type TextPosition,
  type TextRole,
  type TextStyle,
  type TransitionType,
} from './project';
import {
  contrastingDark,
  fitTexts,
  layoutText,
  legibleStyle,
  type FittedText,
  type LaidText,
  type Measurer,
} from './textFit';

export const MOTION_CYCLE: PhotoMotion[] = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'];

export interface FrameLayer {
  clip: number;
  alpha: number;
  /** Desplazamiento como fracción del lienzo (deslizamientos). */
  dx: number;
  dy: number;
  /** Segundo del archivo (clips). */
  sourceTime: number | null;
  /** Fotos: ampliación y desplazamiento del recorte (0 = izquierda o arriba, 1 = derecha o abajo). */
  zoom: number;
  panX: number;
  panY: number;
}

export interface FrameText {
  key: string;
  lines: string[];
  /** El estilo que dibuja el vídeo (con la caja o el contorno que le pone para que se lea). */
  style: TextStyle;
  position: TextPosition;
  /** Medidas y sitio, los del vídeo: tamaño de letra, alto de línea, relleno y arriba. */
  laid: LaidText;
  alpha: number;
  /** Animación: desplazamiento (fracción del ancho y del alto), tamaño y si se escribe letra a letra (alineado a la izquierda). */
  dx: number;
  dy: number;
  scale: number;
  typewriter: boolean;
}

export interface FrameOutro {
  outro: ReelOutro;
  /** Opacidad del cierre sobre el último plano (entra fundiéndose). */
  alpha: number;
  /** Opacidad del logotipo y de los textos (entran un poco después). */
  textAlpha: number;
  /** Último plano de foto (el fondo desenfocado y oscurecido), si no hay color de fondo. */
  backgroundClip: number | null;
  texts: FrameText[];
}

export interface Frame {
  layers: FrameLayer[];
  /** Negro por encima de todo (transición a negro), de 0 a 1. */
  black: number;
  texts: FrameText[];
  subtitles: FrameText[];
  /** El cierre con la marca, mientras se ve. */
  outro: FrameOutro | null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Movimiento de cada foto: el suyo o el de la plantilla (con el ciclo de «alternate»). */
export function photoMotions(clips: Clip[], template: ReelTemplateSummary): Array<PhotoMotion | null> {
  let photos = 0;
  return clips.map((clip) => {
    if (clip.type !== 'photo') return null;
    const kind =
      clip.motion ??
      (template.photoMotion.type === 'alternate'
        ? MOTION_CYCLE[photos % MOTION_CYCLE.length]!
        : (template.photoMotion.type as PhotoMotion));
    photos += 1;
    return kind;
  });
}

/** Ampliación y paneo de una foto con su movimiento y su avance (0 a 1), como `zoompan`. */
export function photoTransform(kind: PhotoMotion, amount: number, progress: number) {
  const p = clamp01(progress);
  switch (kind) {
    case 'zoom-in':
      return { zoom: 1 + amount * p, panX: 0.5, panY: 0.5 };
    case 'zoom-out':
      return { zoom: 1 + amount - amount * p, panX: 0.5, panY: 0.5 };
    case 'pan-right':
      return { zoom: 1 + amount, panX: p, panY: 0.5 };
    case 'pan-left':
      return { zoom: 1 + amount, panX: 1 - p, panY: 0.5 };
    case 'pan-up':
      return { zoom: 1 + amount, panX: 0.5, panY: 1 - p };
    case 'pan-down':
      return { zoom: 1 + amount, panX: 0.5, panY: p };
    default:
      return { zoom: 1, panX: 0.5, panY: 0.5 };
  }
}

/** Opacidad de un texto con su entrada y salida suaves (la misma rampa que el `alpha` de drawtext). */
export function fadeAlpha(t: number, start: number, end: number, fade: number): number {
  if (t < start || t > end) return 0;
  const f = Math.min(fade, (end - start) / 2);
  if (f < 0.02) return 1;
  if (t < start + f) return clamp01((t - start) / f);
  if (t > end - f) return clamp01((end - t) / f);
  return 1;
}

/** Volumen de la música en el segundo `t`, con su entrada y salida suaves. */
export function musicGain(
  t: number,
  total: number,
  music: { volume: number; fadeInSeconds: number; fadeOutSeconds: number },
): number {
  if (t < 0 || t > total) return 0;
  const fadeIn = Math.min(music.fadeInSeconds, total / 2);
  const fadeOut = Math.min(music.fadeOutSeconds, total / 2);
  let gain = music.volume;
  if (fadeIn > 0 && t < fadeIn) gain *= t / fadeIn;
  if (fadeOut > 0 && t > total - fadeOut) gain *= (total - t) / fadeOut;
  return clamp01(gain);
}

export function frameAt(
  t: number,
  plan: DraftPlan,
  timeline: PlanTimeline,
  template: ReelTemplateSummary,
  size: { width: number; height: number },
): Frame {
  return prepareFrames(plan, timeline, template, size)(t);
}

/**
 * Lo mismo que `frameAt`, pero preparado para pedir muchos fotogramas del MISMO montaje
 * (la reproducción): lo que no depende del instante —el movimiento de cada foto, las
 * líneas de cada texto y los subtítulos ya pasados a segundos del reel— se calcula una
 * vez, no en cada fotograma. Con 15 clips y varios textos es la diferencia entre ir
 * fluido y dar saltos.
 */
/** Medidor de cada texto (el lienzo del navegador con la letra que se dibuja); sin él, el ancho medio. */
export type MeasurerFor = (style: TextStyle, role: TextRole | null) => Measurer;

/** Duración de la vista previa: la de los planos y, si lo hay, la del cierre con la marca. */
export function previewTotal(plan: DraftPlan, timeline: PlanTimeline, template: ReelTemplateSummary): number {
  return outroSpan(plan, timeline, template)?.total ?? timeline.total;
}

/**
 * Textos y subtítulos del reel como los colocará el vídeo (textFit.ts), en el
 * tamaño dado. Lo usan la vista previa y las cajas para mover los textos.
 */
export function fittedTexts(
  plan: DraftPlan,
  timeline: PlanTimeline,
  template: ReelTemplateSummary,
  size: { width: number; height: number },
  measurerFor?: MeasurerFor,
): FittedText[] {
  const outro = outroSpan(plan, timeline, template);
  const cues = plan.subtitles?.enabled
    ? timelineSubtitles(plan.clips, timeline).map((cue) => ({
        key: `${cue.clip}:${cue.cue}`,
        text: cue.text,
        start: cue.start,
        end: cue.end,
      }))
    : [];
  return fitTexts(
    {
      texts: plan.texts,
      cues,
      subtitles: plan.subtitles?.enabled ? plan.subtitles : null,
      clipsTotal: timeline.total,
      ...(outro ? { outroStart: outro.start } : {}),
      maxTextLines: MAX_TEXT_LINES,
      maxSubtitleLines: MAX_SUBTITLE_LINES,
    },
    size.width,
    size.height,
    measurerFor,
  );
}

export function prepareFrames(
  plan: DraftPlan,
  timeline: PlanTimeline,
  template: ReelTemplateSummary,
  size: { width: number; height: number },
  measurerFor?: MeasurerFor,
): (t: number) => Frame {
  const { clips } = plan;
  const motions = photoMotions(clips, template);
  const positionOf = new Map(plan.texts.map((t) => [t.id, t.position]));
  const fitted = fittedTexts(plan, timeline, template, size, measurerFor).map((fit) => ({
    fit,
    position: fit.kind === 'subtitle' ? (plan.subtitles?.position ?? 'bottom') : (positionOf.get(fit.key) ?? 'bottom'),
    chars: fit.laid.lines.reduce((n, line) => n + line.length, 0),
  }));
  const outro = outroSpan(plan, timeline, template);
  const outroTexts = outro && plan.outro ? outroLayout(plan.outro, size, measurerFor) : [];
  return (t) => frameOf(t, plan, timeline, template, motions, fitted, outro, outroTexts);
}

/**
 * Textos del cierre con la marca, como `build.ts`: la llamada grande en la caja del
 * color de acento y, debajo, el usuario y la dirección.
 */
function outroLayout(
  outro: ReelOutro,
  size: { width: number; height: number },
  measurerFor?: MeasurerFor,
): Array<{ key: string; laid: LaidText; style: TextStyle }> {
  const { width, height } = size;
  const accent = outro.accent ?? '#FFFFFF';
  const onBg = outro.background ? contrastingDark(outro.background) : '#FFFFFF';
  const ctaStyle: TextStyle = {
    sizeRatio: 0.078,
    color: outro.accentText ?? contrastingDark(accent),
    marginRatio: 0,
    maxWidthRatio: 0.84,
    lineHeight: 1.1,
    box: { color: accent, opacity: 1, paddingRatio: 0.42 },
    outline: null,
    fadeSeconds: 0.3,
  };
  const moveTo = (laid: LaidText, top: number): LaidText => {
    const h = laid.extent[1] - laid.extent[0];
    return { ...laid, top: top + laid.padding, extent: [top, top + h] };
  };
  const cta = layoutText(
    { text: outro.cta, style: ctaStyle, position: 'center', role: 'cta', maxLines: 2 },
    width,
    height,
    measurerFor?.(ctaStyle, 'cta'),
  );
  const first = moveTo(cta, Math.round(height * (outro.logoPath ? 0.47 : 0.42)));
  const out = [{ key: 'outro-cta', laid: first, style: ctaStyle }];
  let cursor = first.extent[1] + Math.round(height * 0.035);
  const bottom = height - Math.round((400 / 1920) * height);
  for (const [value, ratio, key] of [
    [outro.handle, 0.05, 'outro-handle'],
    [outro.address, 0.038, 'outro-address'],
  ] as const) {
    if (!value) continue;
    const style = legibleStyle(
      {
        sizeRatio: ratio,
        color: onBg,
        marginRatio: 0,
        maxWidthRatio: 0.84,
        lineHeight: 1.15,
        box: null,
        outline: null,
        fadeSeconds: 0.3,
      },
      'cta',
    );
    const laid = layoutText(
      { text: value, style, position: 'center', role: null, maxLines: 2 },
      width,
      height,
      measurerFor?.(style, null),
    );
    const moved = moveTo(laid, Math.min(cursor, bottom - (laid.extent[1] - laid.extent[0])));
    out.push({ key, laid: moved, style });
    cursor = moved.extent[1] + Math.round(height * 0.012);
  }
  return out;
}

function frameOf(
  t: number,
  plan: DraftPlan,
  timeline: PlanTimeline,
  template: ReelTemplateSummary,
  motions: Array<PhotoMotion | null>,
  fitted: Array<{ fit: FittedText; position: TextPosition; chars: number }>,
  outro: OutroSpan | null,
  outroTexts: Array<{ key: string; laid: LaidText; style: TextStyle }>,
): Frame {
  const { clips } = plan;
  const layers: FrameLayer[] = [];
  let black = 0;
  const total = outro?.total ?? timeline.total;
  const time = Math.min(Math.max(0, t), Math.max(0, total - 1e-3));
  // Durante el cierre, debajo sigue el último plano, quieto en su último fotograma.
  const clipTime = Math.min(time, Math.max(0, timeline.total - 1e-3));

  const layerFor = (index: number, alpha = 1, dx = 0, dy = 0): FrameLayer => {
    const clip = clips[index]!;
    const start = timeline.starts[index]!;
    const duration = timeline.durations[index]!;
    if (clip.type === 'video') {
      const sourceTime = clip.in + (clipTime - start) * (clip.speed ?? 1);
      return { clip: index, alpha, dx, dy, sourceTime, zoom: 1, panX: 0.5, panY: 0.5 };
    }
    const progress = duration > 0 ? (clipTime - start) / duration : 0;
    const { zoom, panX, panY } = photoTransform(
      motions[index]!,
      clip.motionAmount ?? template.photoMotion.amount,
      progress,
    );
    return { clip: index, alpha, dx, dy, sourceTime: null, zoom, panX, panY };
  };

  for (let i = 0; i < clips.length; i += 1) {
    const start = timeline.starts[i]!;
    const end = start + timeline.durations[i]!;
    if (clipTime < start || clipTime >= end) continue;
    const next = i + 1 < clips.length ? i + 1 : -1;
    const nextStart = next >= 0 ? timeline.starts[next]! : Infinity;
    const transition = next >= 0 ? timeline.transitions[next]! : 0;
    if (next >= 0 && transition > 0 && clipTime >= nextStart) {
      // Dentro de la transición hacia el siguiente: se componen los dos.
      const p = clamp01((clipTime - nextStart) / transition);
      const type: TransitionType = clips[next]!.transition?.type ?? template.transition.type;
      if (type === 'fadeblack') {
        if (p < 0.5) {
          layers.push(layerFor(i));
          black = p * 2;
        } else {
          layers.push(layerFor(next));
          black = (1 - p) * 2;
        }
      } else if (type === 'slideleft') {
        layers.push(layerFor(i, 1, -p), layerFor(next, 1, 1 - p));
      } else if (type === 'slideup') {
        layers.push(layerFor(i, 1, 0, -p), layerFor(next, 1, 0, 1 - p));
      } else {
        layers.push(layerFor(i), layerFor(next, p));
      }
      break;
    }
    layers.push(layerFor(i));
    break;
  }

  // Textos y subtítulos ya colocados como en el vídeo (el desplazamiento vertical a mano ya va en `laid`).
  const texts: FrameText[] = [];
  const subtitles: FrameText[] = [];
  for (const { fit, position, chars } of fitted) {
    if (time < fit.start || time > fit.end) continue;
    const lines = fit.laid.lines;
    if (fit.kind === 'subtitle') {
      const alpha = fadeAlpha(time, fit.start, fit.end, fit.style.fadeSeconds);
      if (alpha <= 0) continue;
      subtitles.push({
        key: fit.key,
        lines,
        style: fit.style,
        position,
        laid: fit.laid,
        alpha,
        dx: 0,
        dy: 0,
        scale: 1,
        typewriter: false,
      });
      continue;
    }
    const state = textAnimState(fit.animation, fit.style, time, fit.start, fit.end, chars);
    if (state.alpha <= 0) continue;
    const typewriter = fit.animation?.in === 'typewriter';
    const shown = typewriter ? visiblePerLine(lines, state.visibleChars).map((n, i) => lines[i]!.slice(0, n)) : lines;
    texts.push({
      key: fit.key,
      lines: shown,
      style: fit.style,
      position,
      laid: fit.laid,
      alpha: state.alpha,
      dx: state.dx + fit.offsetX,
      dy: state.dy,
      scale: state.scale,
      typewriter,
    });
  }

  let outroFrame: FrameOutro | null = null;
  if (outro && plan.outro && time >= outro.start) {
    const alpha = outro.fade > 0 ? clamp01((time - outro.start) / outro.fade) : 1;
    const textAlpha = clamp01((time - (outro.start + outro.fade * 0.6)) / 0.35);
    let lastPhoto: number | null = null;
    for (let i = clips.length - 1; i >= 0 && lastPhoto === null; i -= 1) if (clips[i]!.type === 'photo') lastPhoto = i;
    outroFrame = {
      outro: plan.outro,
      alpha,
      textAlpha,
      backgroundClip: plan.outro.background ? null : lastPhoto,
      texts: outroTexts.map((item) => ({
        key: item.key,
        lines: item.laid.lines,
        style: item.style,
        position: 'center' as const,
        laid: item.laid,
        alpha: textAlpha,
        dx: 0,
        dy: 0,
        scale: 1,
        typewriter: false,
      })),
    };
  }
  return { layers, black, texts, subtitles, outro: outroFrame };
}

export interface PreviewContext {
  /** Familias de la marca que el navegador ha cargado. */
  loadedFamilies: string[];
  /** ¿Tiene la marca una tipografía .ttf/.otf para los reels? */
  brandReelFont: boolean;
  /** Tipo de archivo de cada ruta, si se sabe. */
  mimeOf: (path: string) => string | null;
}

/**
 * Lo que la vista previa enseña distinto del vídeo montado, en una frase cada cosa y con palabras de quien
 * edita (sin nombres de archivos, programas ni servidores). Se enseñan al exportar.
 */
export function previewWarnings(plan: DraftPlan, template: ReelTemplateSummary, context: PreviewContext): string[] {
  const warnings: string[] = [];
  const types = new Set(plan.clips.slice(1).map((c) => c.transition?.type ?? template.transition.type));
  if (types.has('dissolve')) warnings.push('La transición «disolver» se ve aquí como un fundido normal.');
  if (types.has('slideleft') || types.has('slideup'))
    warnings.push('Los deslizamientos son aproximados: en el vídeo pueden ir algo más suaves.');
  if (plan.clips.some((c) => c.type === 'photo' && (c.blur ?? 0) > 0))
    warnings.push('El desenfoque se ve aquí aproximado: en el vídeo puede quedar algo distinto.');
  if (plan.clips.some((c) => c.filter))
    warnings.push('Los filtros de color se ven aquí aproximados: en el vídeo el tono puede cambiar un poco.');
  const families = new Set(context.loadedFamilies.map((f) => f.toLowerCase()));
  const styles = [...plan.texts.map((t) => t.style), ...(plan.subtitles?.enabled ? [plan.subtitles.style] : [])];
  const missing = new Set(
    styles.filter((s) => s.fontFamily && !families.has(s.fontFamily.toLowerCase())).map((s) => s.fontFamily as string),
  );
  for (const family of missing)
    warnings.push(`El tipo de letra «${family}» no ha cargado aquí: en la vista previa se ve uno parecido.`);
  if (styles.some((s) => !s.fontPath) && !context.brandReelFont && styles.length > 0)
    warnings.push('El tipo de letra de la marca no se puede usar en vídeo; se usará uno parecido.');
  if (plan.clips.some((c) => /heic|heif/i.test(context.mimeOf(c.path) ?? '')))
    warnings.push('Hay fotos del iPhone en su formato original: no entran en el vídeo. Pásalas a JPEG.');
  return warnings;
}
