// Motor del reel: convierte plantilla + plan v2 (ya con los archivos en disco
// y sus duraciones medidas) en una orden de FFmpeg. Un plan v1 entra por el
// mismo camino (`media`/`texts`/`music` se pasan a v2 aquí, igual que hace
// `migratePlanV1` con la carga).
//
// Es una función pura —no toca disco ni lanza procesos—, así que se prueba
// sin FFmpeg. Trampas que evita:
//  * Rutas y textos NO viajan dentro del grafo de filtros: FFmpeg se ejecuta
//    en la carpeta del trabajo y todo se nombra con rutas relativas simples;
//    el texto va en archivos (`textfile`). Así no hay que escapar «C:\…», ni
//    dos puntos, comas, comillas o «%» (en Windows es donde más duele).
//  * Cada línea de texto es un `drawtext` propio y centrado, con `y_align=font`
//    (FFmpeg ≥ 6.1): todas las líneas tienen la misma caja aunque una tenga
//    letras con rabito y otra no.
//  * Las fotos se giran aquí según su EXIF, con `-noautorotate`.
//  * Las fotos JPEG vienen en rango completo de color; se pasan a rango de
//    vídeo (`out_range=tv`) para que el H.264 salga en `yuv420p` normal.
//  * Transiciones mixtas: un corte seco se une con `concat` y el resto con
//    `xfade`, en cadena (el desplazamiento de cada `xfade` es el segundo del
//    reel en el que empieza el elemento).
//  * Los subtítulos se queman con `drawtext`, como los textos (no hace falta
//    libass), con la tipografía de la marca.
//
// Calidad (docs/reels-calidad.md):
//  * Encuadre por sujeto: la foto se recorta sobre lo principal (máscara del
//    recorte o saliencia, ver subject.ts) y la cámara se acerca a ello con un
//    movimiento suavizado. Si el sujeto no cabe en 9:16 (un plato alargado en
//    una foto horizontal), la foto se ve más pequeña sobre una copia suya
//    desenfocada, en lugar de cortar el plato.
//  * Textos por papel, en su franja, dentro de las zonas seguras y sin
//    solaparse nunca (textlayout.ts).
//  * Gradación ligera e igual en todo el reel, cierre con la marca y H.264
//    High a ~9 Mbps con `+faststart`.
//  * Sin música ni sonido de clips, el vídeo sale SIN pista de audio (en vez
//    de una pista muda que parece rota).
import { PermanentError } from '../errors.ts';
import { orientationFilters } from '../ffmpeg/exif.ts';
import type { FontMetrics } from '../ffmpeg/fontmetrics.ts';
import { num } from '../ffmpeg/run.ts';
import { CENTER, focalCropExpr, type FocalPoint } from '../handlers/shared.ts';
import {
  animationDurations,
  RISE_TRAVEL,
  SLIDE_TRAVEL,
  ZOOM_FROM,
  type TextAnimation,
} from './animation.ts';
import {
  REEL_PLAN_V2_MAX_SECONDS,
  templateTextStyle,
  type ClipFilter,
  type ReelCue,
  type ReelGrade,
  type ReelTemplate,
  type ReelTextStyle,
  type ReelTextV2,
  type ReelTransition,
} from './schema.ts';
import type { Subject } from './subject.ts';
import {
  contrastingDark,
  inferRole,
  layoutText,
  measurer,
  moveText,
  placeTexts,
  safeArea,
  type LaidText,
  type TextRole,
} from './textlayout.ts';

/** Pieza de un plan v1 ya bajada y medida. */
export type ResolvedMedia =
  | { type: 'photo'; file: string; orientation: number; focalPoint?: FocalPoint; seconds?: number; blur?: number }
  | {
      type: 'video';
      file: string;
      focalPoint?: FocalPoint;
      /** Desenfoque de 0 a 100 (ver `blurSigma`). */
      blur?: number;
      startAt: number;
      seconds?: number;
      /** Duración real del clip y si trae sonido, según ffprobe. */
      durationSeconds: number;
      hasAudio: boolean;
    };

export interface ResolvedText {
  text: string;
  start: number;
  end: number;
  position?: 'top' | 'center' | 'bottom';
}

export type PhotoMotion = 'none' | 'zoom-in' | 'zoom-out' | 'pan-right' | 'pan-left' | 'pan-up' | 'pan-down';

/** Elemento de un plan v2 ya bajado y medido. */
export type ResolvedClip =
  | {
      type: 'photo';
      file: string;
      orientation: number;
      focalPoint?: FocalPoint;
      blur?: number;
      seconds: number;
      motion?: PhotoMotion;
      /** Cuánto se amplía o se desplaza; por defecto, el de la plantilla. */
      motionAmount?: number;
      transition?: ReelTransition;
      filter?: ClipFilter;
      /** Medidas de la foto tal como se ve (ya girada). Sin ellas, recorte por el punto de interés y nada más. */
      sourceSize?: { width: number; height: number };
      /** Lo principal de la foto (máscara o saliencia), en coordenadas de la foto vista. */
      subject?: Subject | null;
    }
  | {
      type: 'video';
      file: string;
      focalPoint?: FocalPoint;
      blur?: number;
      in: number;
      out: number;
      volume: number;
      /** Velocidad (0,5 a 2); sin ella, 1. */
      speed?: number;
      filter?: ClipFilter;
      transition?: ReelTransition;
      subtitles?: ReelCue[];
      durationSeconds: number;
      hasAudio: boolean;
    };

/** Texto de un plan resuelto: el del plan v2, con el papel opcional. */
export type ResolvedPlanText = Omit<ReelTextV2, 'role'> & { role?: TextRole | null };

/** Cierre con la marca ya resuelto (archivos en la carpeta de trabajo). */
export interface ResolvedOutro {
  seconds: number;
  cta: string;
  handle?: string | null;
  address?: string | null;
  /** Logotipo (archivo relativo) y su orientación EXIF. */
  logo?: { file: string; orientation: number } | null;
  background?: string | null;
  accent?: string | null;
  accentText?: string | null;
}

export interface ResolvedPlan {
  clips: ResolvedClip[];
  texts: ResolvedPlanText[];
  subtitles?: { enabled: boolean; position: 'top' | 'center' | 'bottom'; style: ReelTextStyle };
  music?: { file: string; startAt: number; volume: number; fadeInSeconds: number; fadeOutSeconds: number };
  outro?: ResolvedOutro | null;
  /** Gradación de todo el reel; sin ella, `natural`. */
  grade?: ReelGrade | null;
}

export interface ReelBuildInput {
  template: ReelTemplate;
  /** Plan v2. Si no viene, se usan `media`, `texts` y `music` (plan v1). */
  plan?: ResolvedPlan;
  media?: ResolvedMedia[];
  texts?: ResolvedText[];
  music?: { file: string; startAt: number; volume?: number };
  /** Tipografía por defecto (relativa a la carpeta de trabajo). Obligatoria si hay textos sin la suya. */
  fontFile?: string;
  /**
   * Tipografía para rótulos y subtítulos cuando la marca no tiene la suya (la del
   * trabajador, menos gruesa que la de los titulares). Sin ella, `fontFile`.
   */
  labelFontFile?: string;
  /** Tipografías propias de los textos: ruta del cubo → archivo en la carpeta de trabajo. */
  fontFiles?: Record<string, string>;
  /** Medidas de cada tipografía (archivo de la carpeta de trabajo → medidas), para medir los textos de verdad. */
  fontMetrics?: Record<string, FontMetrics | null>;
  /** Duración máxima. Por defecto: la de la plantilla en v1 y 90 s en v2. */
  maxTotalSeconds?: number;
  /** Ancho de salida; por defecto, el del lienzo. */
  outputWidth?: number;
  outputFile: string;
}

export interface TimelineSegment {
  index: number;
  type: 'photo' | 'video' | 'outro';
  /** Segundo del reel en el que empieza a verse. */
  start: number;
  seconds: number;
  /** Duración de la transición con la que entra (0 = corte o primer elemento). */
  transitionIn: number;
}

/** Dónde quedó cada texto (para comprobar que no se pisan y que respetan las zonas seguras). */
export interface TextPlacement {
  kind: 'text' | 'subtitle' | 'outro';
  index: number;
  role: TextRole;
  start: number;
  end: number;
  /** Arriba y abajo del bloque (con la caja), en píxeles de la salida. */
  top: number;
  bottom: number;
  /** Ancho estimado del bloque (con la caja). */
  width: number;
  fontSize: number;
  lines: string[];
}

export interface PhotoFraming {
  index: number;
  mode: 'cover' | 'fit';
  /** Punto hacia el que va la cámara, en el cuadro ya compuesto (0 a 1). */
  target: FocalPoint;
  source: 'plan' | 'mask' | 'saliency' | 'center';
  /** Encuadre ceñido sobre el sujeto (1 = la foto a pantalla llena). */
  tighten?: number;
  /** Corte a detalle a mitad del plano (×); 0 si no lo hay (plano corto o sin resolución). */
  detail?: number;
}

export interface ReelBuild {
  /** Argumentos de FFmpeg (sin el nombre del programa). */
  args: string[];
  filterGraph: string;
  /** Archivos de texto que hay que escribir en la carpeta de trabajo antes de lanzar FFmpeg. */
  textFiles: Array<{ name: string; content: string }>;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  /** La transición más larga del reel (para la portada). */
  transitionSeconds: number;
  timeline: TimelineSegment[];
  /** Subtítulos dibujados, ya en segundos del reel. */
  subtitles: Array<{ start: number; end: number; text: string }>;
  texts: TextPlacement[];
  framing: PhotoFraming[];
  /** De dónde sale el sonido del vídeo: música, solo el de los clips o ninguno (sin pista). */
  audio: 'music' | 'clips' | 'none';
  warnings: string[];
}

/** Las fotos se preparan al doble del lienzo para que el zoom no tiemble. */
const SUPERSAMPLE = 2;
export const MOTION_CYCLE = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'] as const;
export const MIN_SEGMENT_SECONDS = 0.5;
export const MAX_TEXT_LINES = 6;
export const MAX_SUBTITLE_LINES = 3;
/** Ancho medio de un carácter respecto al tamaño de letra, para partir líneas (solo `wrapText`, la cuenta antigua). */
export const AVERAGE_GLYPH_WIDTH = 0.56;
/** Lo mínimo que se dibuja de un texto o subtítulo. */
const MIN_VISIBLE_SECONDS = 0.1;
/** Fundido mínimo de un texto: un texto que aparece de golpe parece un error. */
const MIN_TEXT_FADE = 0.2;
/** Transición hacia el cierre con la marca. */
const OUTRO_FADE = 0.4;
/** Lo más pequeño que se deja una foto horizontal para que quepa el sujeto (fracción del recorte a pantalla llena). */
const MIN_FIT_SCALE = 0.8;
/** Se reduce la foto solo si a pantalla llena se vería menos de esta parte del sujeto. */
const FIT_WHEN_VISIBLE_BELOW = 0.33;
/**
 * Corte de cámara dentro de una foto: a partir de esta duración, el plano empieza
 * general y, a mitad, corta a un detalle del sujeto (hasta ×1,55), como si hubiera
 * dos cámaras. Solo si la foto tiene resolución para ello (ver `MIN_USEFUL_WIDTH`):
 * si no llega a ×1,25 sin ampliar de más, no hay corte a detalle.
 */
export const DETAIL_CUT_MIN_SECONDS = 1.6;
export const DETAIL_ZOOM = 1.55;
const DETAIL_MIN_ZOOM = 1.25;
/**
 * Lo mínimo que se ve de la foto original a lo ancho en cualquier momento (píxeles de
 * la foto): unos 1080, el ancho del reel. Ninguna ampliación (encuadre ceñido,
 * movimiento de cámara ni corte a detalle) baja de ahí: se vería borroso.
 */
export const MIN_USEFUL_WIDTH = 1000;
/**
 * Encuadre ceñido: con el sujeto localizado (máscara o saliencia), la foto se acerca
 * hasta que el plato ocupe ~90 % del ancho o ~70 % del alto del cuadro (deja sitio a
 * los textos), para que no se vea lo que sobra alrededor (la encimera, unos pies…).
 * Como mucho ×1,8 con máscara y ×1,5 con saliencia (es una estimación).
 */
const TIGHT_FILL_W = 0.9;
const TIGHT_FILL_H = 0.7;
const TIGHT_MAX: Record<'mask' | 'saliency', number> = { mask: 1.8, saliency: 1.5 };
/** Movimiento de cámara más golpe de zoom que se deja de margen al ceñir el encuadre. */
const MOTION_HEADROOM = 1.12;
/** «Golpe» de zoom al entrar por corte: empieza un 7 % más cerca y se asienta en ~0,25 s. */
const PUNCH = 0.07;
const PUNCH_FRAMES = 8;
/** Por debajo de este tamaño (fracción del ancho), un texto sin caja la lleva: el contorno solo no basta. */
const BOX_BELOW_SIZE = 0.075;

/**
 * Filtros de color con FFmpeg. Llevan los nombres de los filtros rápidos de las fotos
 * (src/features/content/editor/imageEffects/filters.ts), que se calculan píxel a píxel en
 * el navegador: aquí son una aproximación con filtros de siempre (`eq`, `hue`,
 * `colorbalance`, `colorchannelmixer`, `curves`, `unsharp`), no la misma cuenta.
 */
export const CLIP_FILTER_CHAINS: Record<ClipFilter, string[]> = {
  bw: ['hue=s=0', 'eq=contrast=1.08'],
  sepia: ['colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'],
  vivid: ['eq=saturation=1.35:contrast=1.12'],
  warm: ['colorbalance=rs=0.10:rm=0.08:rh=0.05:bs=-0.10:bm=-0.08:bh=-0.05', 'eq=saturation=1.08'],
  cool: ['colorbalance=rs=-0.10:rm=-0.08:rh=-0.05:bs=0.10:bm=0.08:bh=0.05', 'eq=saturation=0.96'],
  fade: ['eq=contrast=0.82:brightness=0.03:saturation=0.78', "curves=all='0/0.1 1/0.94'"],
  drama: ['eq=contrast=1.3:brightness=-0.03:saturation=0.88', 'unsharp=5:5:0.6:5:5:0'],
};

/**
 * Gradación de todo el reel (después de unir los planos, antes de los textos): un
 * poco más de contraste y color, un enfoque suave y un viñeteado apenas visible.
 * Es la misma en todos los planos, para que el reel parezca de una sola sesión.
 */
export const GRADE_CHAINS: Record<ReelGrade, string[]> = {
  natural: ['eq=contrast=1.05:saturation=1.08', 'unsharp=5:5:0.35:5:5:0', 'vignette=angle=0.3'],
  warm: [
    'eq=contrast=1.05:saturation=1.08',
    'colorbalance=rs=0.04:gs=0.01:bs=-0.04:rm=0.03:bm=-0.03',
    'unsharp=5:5:0.35:5:5:0',
    'vignette=angle=0.3',
  ],
  none: [],
};

/** Exportación del reel: H.264 High, ~9 Mbps (o el CRF de la plantilla) y `+faststart`. */
export function reelVideoArgs(template: ReelTemplate): string[] {
  const rate = template.export.videoBitrateKbps;
  return [
    '-c:v',
    'libx264',
    '-preset',
    template.export.preset,
    '-profile:v',
    'high',
    '-level:v',
    '4.2',
    ...(rate
      ? ['-b:v', `${rate}k`, '-maxrate', `${Math.round(rate * 1.35)}k`, '-bufsize', `${rate * 2}k`]
      : ['-crf', String(template.export.crf)]),
    '-g',
    String(template.canvas.fps * 2),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ];
}

const hex = (color: string, opacity = 1) =>
  `0x${color.slice(1).toUpperCase()}${opacity < 1 ? `@${num(opacity, 2)}` : ''}`;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const r3 = (n: number) => Number(n.toFixed(3));

/**
 * Desviación del desenfoque gaussiano de FFmpeg (`gblur`) para una intensidad
 * de 0 a 100 sobre un cuadro de `width` × `height`. Es la misma cuenta que el
 * editor (`blurRadius` en src/features/content/document/schema.ts): 100 = el
 * 5 % del lado menor. El filtro `blur()` del lienzo del navegador también toma
 * la desviación, así que se ve igual en el editor y en el reel.
 */
export function blurSigma(blur: number | undefined, width: number, height: number): number {
  if (!blur || blur <= 0) return 0;
  return (Math.min(blur, 100) / 100) * 0.05 * Math.min(width, height);
}

/** Parte un texto en líneas que quepan en el ancho dado. Respeta los saltos de línea. (Cuenta antigua, la de la vista previa.) */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  // Sin caracteres de control: un salto dentro de `textfile` se dibujaría como un recuadro.
  const clean = text.replace(/\r/g, '').replace(/[^\S\n]+/g, ' ');
  for (const paragraph of clean.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(' ')) {
      if (!word) continue;
      if (line && line.length + 1 + word.length > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Medidas de un bloque de texto en un cuadro de `width` × `height` (cuenta antigua, la de la vista previa del editor). */
export function textLayout(
  style: Pick<ReelTextStyle, 'sizeRatio' | 'lineHeight' | 'maxWidthRatio' | 'marginRatio'>,
  position: 'top' | 'center' | 'bottom',
  lineCount: number,
  width: number,
  height: number,
) {
  const fontSize = Math.max(8, Math.round(style.sizeRatio * width));
  const lineStep = Math.round(fontSize * style.lineHeight);
  const maxChars = Math.max(4, Math.floor((style.maxWidthRatio * width) / (fontSize * AVERAGE_GLYPH_WIDTH)));
  const block = lineStep * (Math.max(1, lineCount) - 1) + fontSize;
  const margin = Math.round(style.marginRatio * height);
  const top =
    position === 'top' ? margin : position === 'center' ? Math.round((height - block) / 2) : height - margin - block;
  return { fontSize, lineStep, maxChars, top };
}

/** Plan v1 ya resuelto → plan v2 resuelto, con la plantilla (mismo vídeo). */
function legacyPlan(input: ReelBuildInput): ResolvedPlan {
  const { template } = input;
  const transition = { type: template.transition.type, seconds: template.transition.seconds };
  return {
    clips: (input.media ?? []).map((item): ResolvedClip => {
      if (item.type === 'photo') {
        return {
          type: 'photo',
          file: item.file,
          orientation: item.orientation,
          focalPoint: item.focalPoint,
          blur: item.blur,
          seconds: item.seconds ?? template.timing.photoSeconds,
          transition,
        };
      }
      return {
        type: 'video',
        file: item.file,
        focalPoint: item.focalPoint,
        blur: item.blur,
        in: item.startAt,
        out: item.startAt + (item.seconds ?? template.timing.maxClipSeconds),
        volume: template.audio.clipVolume,
        transition,
        durationSeconds: item.durationSeconds,
        hasAudio: item.hasAudio,
      };
    }),
    texts: (input.texts ?? []).map((text, index) => ({
      id: `t${index + 1}`,
      text: text.text,
      start: text.start,
      end: text.end,
      position: text.position ?? template.text.position,
      style: templateTextStyle(template),
    })),
    music: input.music
      ? {
          file: input.music.file,
          startAt: input.music.startAt,
          volume: input.music.volume ?? template.audio.musicVolume,
          fadeInSeconds: template.audio.fadeInSeconds,
          fadeOutSeconds: template.audio.fadeOutSeconds,
        }
      : undefined,
  };
}

export interface PlanTimeline {
  durations: number[];
  /** Transición con la que entra cada elemento (la del primero es 0). */
  transitions: number[];
  starts: number[];
  total: number;
}

/**
 * Línea de tiempo de un plan v2: duración de cada elemento ajustada a
 * fotogramas, transición de entrada de cada uno (como mucho la mitad del más
 * corto de los dos que une) y segundo en que empieza. La misma cuenta hace el
 * editor (src/features/reels/editor/project.ts) para la vista previa.
 */
export function planTimeline(
  clips: Array<
    | { type: 'photo'; seconds: number; transition?: ReelTransition }
    | {
        type: 'video';
        in: number;
        out: number;
        durationSeconds?: number;
        speed?: number;
        transition?: ReelTransition;
      }
  >,
  template: ReelTemplate,
  fps: number = template.canvas.fps,
): PlanTimeline {
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps));
  const durations = clips.map((clip, index) => {
    if (clip.type === 'photo') return frames(clip.seconds) / fps;
    const end = Math.min(clip.out, clip.durationSeconds ?? clip.out);
    const length = end - clip.in;
    if (length < MIN_SEGMENT_SECONDS) {
      throw new PermanentError(
        `El clip ${index + 1} no tiene ${MIN_SEGMENT_SECONDS} s a partir del segundo ${clip.in}`,
      );
    }
    // Por debajo, para no pedir fotogramas que el clip no tiene. A otra velocidad el tramo dura length / speed.
    return Math.floor((length / (clip.speed ?? 1)) * fps) / fps;
  });
  const transitions = clips.map((clip, index) => {
    if (index === 0) return 0;
    const t = clip.transition ?? template.transition;
    if (t.type === 'cut' || t.seconds <= 0) return 0;
    const limit = Math.min(durations[index - 1]!, durations[index]!) / 2;
    return Math.floor(Math.min(t.seconds, limit) * fps) / fps;
  });
  const starts: number[] = [];
  let cursor = 0;
  durations.forEach((seconds, index) => {
    cursor -= transitions[index]!;
    starts.push(Number(cursor.toFixed(4)));
    cursor += seconds;
  });
  return { durations, transitions, starts, total: Number(cursor.toFixed(4)) };
}

/** Subtítulos de los clips pasados a segundos del reel (solo la parte que se ve de cada clip). */
export function timelineSubtitles(
  clips: ResolvedClip[],
  timeline: Pick<PlanTimeline, 'durations' | 'starts'>,
): Array<{ start: number; end: number; text: string; clip: number }> {
  const out: Array<{ start: number; end: number; text: string; clip: number }> = [];
  clips.forEach((clip, index) => {
    if (clip.type !== 'video' || !clip.subtitles) return;
    const speed = clip.speed ?? 1;
    const from = clip.in;
    const to = clip.in + timeline.durations[index]! * speed;
    for (const cue of clip.subtitles) {
      const a = Math.max(cue.start, from);
      const b = Math.min(cue.end, to);
      if ((b - a) / speed < MIN_VISIBLE_SECONDS * 2) continue;
      const start = timeline.starts[index]! + (a - from) / speed;
      out.push({
        start: Number(start.toFixed(3)),
        end: Number((start + (b - a) / speed).toFixed(3)),
        text: cue.text,
        clip: index,
      });
    }
  });
  return out.sort((x, y) => x.start - y.start);
}

/**
 * Cómo se encuadra una foto en un cuadro de `w` × `h` (ya al doble del lienzo).
 *  * `cover`: la foto llena el cuadro y se recorta alrededor del punto de interés.
 *  * `fit`: el sujeto no cabe a pantalla llena (p. ej. una bandeja alargada en
 *    una foto horizontal): la foto se reduce hasta que el sujeto quepa con algo
 *    de aire (nunca por debajo de la mitad) y el resto del cuadro es la misma foto
 *    desenfocada.
 * `target` es dónde queda el punto de interés en el cuadro compuesto, para que el
 * movimiento de cámara vaya hacia él.
 */
export function photoFraming(
  clip: Pick<Extract<ResolvedClip, { type: 'photo' }>, 'focalPoint' | 'sourceSize' | 'subject'>,
  w: number,
  h: number,
): {
  mode: 'cover' | 'fit';
  focal: FocalPoint;
  target: FocalPoint;
  source: PhotoFraming['source'];
  fit?: { fgW: number; fgH: number; cropW: number; cropH: number; cropX: number; cropY: number; x: number; y: number };
  /** Encuadre ceñido sobre el sujeto (×, sobre la foto a pantalla llena); 1 = sin ceñir. */
  tighten: number;
  /**
   * Cuánto más se puede acercar la cámara sin que se vea menos de `MIN_USEFUL_WIDTH` px de la
   * foto a lo ancho (sobre el cuadro ya compuesto). 0 si no se sabe el tamaño de la foto.
   */
  room: number;
  /** Dónde queda el sujeto en el cuadro compuesto (0 a 1), si se conoce. */
  subjectBox?: { x: number; y: number; w: number; h: number };
} {
  const subject = clip.subject ?? null;
  const focal = clip.focalPoint ?? subject?.focal ?? CENTER;
  const source: PhotoFraming['source'] = clip.focalPoint ? 'plan' : subject ? subject.source : 'center';
  const size = clip.sourceSize;
  if (!size || size.width <= 0 || size.height <= 0)
    return { mode: 'cover', focal, target: { ...CENTER }, source, tighten: 1, room: 0 };
  const cover = Math.max(w / size.width, h / size.height);
  const contain = Math.min(w / size.width, h / size.height);
  // Lo que debe caber: el sujeto con un 8 % de aire.
  let scale = cover;
  if (subject && subject.box.w > 0 && w / (subject.box.w * size.width * cover) < FIT_WHEN_VISIBLE_BELOW) {
    const need = (0.92 * w) / (subject.box.w * size.width);
    scale = clamp(need, Math.max(contain, cover * MIN_FIT_SCALE), cover);
  }
  const placeCrop = (scaled: number, view: number, point: number) =>
    clamp(point * scaled - view / 2, 0, Math.max(0, scaled - view));
  // Cuánto se puede ampliar una escala sin bajar de MIN_USEFUL_WIDTH px de la foto a lo ancho.
  const roomAt = (s: number) => w / (s * MIN_USEFUL_WIDTH);
  if (scale >= cover * 0.97) {
    // Encuadre ceñido sobre el sujeto (sin pasar de lo que aguanta la resolución).
    let tighten = 1;
    if (subject && !clip.focalPoint && subject.box.w > 0 && subject.box.h > 0) {
      const boxW = (subject.box.w * size.width * cover) / w;
      const boxH = (subject.box.h * size.height * cover) / h;
      const wanted = Math.min(TIGHT_FILL_W / boxW, TIGHT_FILL_H / boxH, TIGHT_MAX[subject.source]);
      tighten = clamp(Math.min(wanted, roomAt(cover) / MOTION_HEADROOM), 1, TIGHT_MAX[subject.source]);
      if (tighten < 1.04) tighten = 1;
    }
    const s = cover * tighten;
    const sw = size.width * s;
    const sh = size.height * s;
    const cx = placeCrop(sw, w, focal.x);
    const cy = placeCrop(sh, h, focal.y);
    const box = subject?.box;
    let subjectBox: { x: number; y: number; w: number; h: number } | undefined;
    if (box) {
      const x0 = clamp((box.x * sw - cx) / w, 0, 1);
      const y0 = clamp((box.y * sh - cy) / h, 0, 1);
      const x1 = clamp(((box.x + box.w) * sw - cx) / w, 0, 1);
      const y1 = clamp(((box.y + box.h) * sh - cy) / h, 0, 1);
      if (x1 > x0 && y1 > y0) subjectBox = { x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0) };
    }
    return {
      mode: 'cover',
      focal,
      target: { x: r3(clamp((focal.x * sw - cx) / w, 0, 1)), y: r3(clamp((focal.y * sh - cy) / h, 0, 1)) },
      source,
      tighten: r3(tighten),
      room: r3(roomAt(s)),
      ...(subjectBox ? { subjectBox } : {}),
    };
  }
  const fgW = even(size.width * scale);
  const fgH = even(size.height * scale);
  const cropW = Math.min(fgW, w);
  const cropH = Math.min(fgH, h);
  const cropX = Math.round(placeCrop(fgW, cropW, focal.x));
  const cropY = Math.round(placeCrop(fgH, cropH, focal.y));
  const x = Math.round((w - cropW) / 2);
  // Un poco por encima del centro: abajo están los botones de la red.
  const y = Math.round((h - cropH) * 0.44);
  return {
    mode: 'fit',
    focal,
    target: {
      x: r3(clamp((x + focal.x * fgW - cropX) / w, 0, 1)),
      y: r3(clamp((y + focal.y * fgH - cropY) / h, 0, 1)),
    },
    source,
    fit: { fgW, fgH, cropW, cropH, cropX, cropY, x, y },
    tighten: 1,
    room: r3(roomAt(scale)),
  };
}

/** Papel por defecto → animación por defecto (solo si el plan no trae la suya y el texto tiene papel explícito). */
const ROLE_ANIMATION: Record<TextRole, TextAnimation> = {
  headline: { in: 'rise', out: 'fade', seconds: 0.4 },
  label: { in: 'rise', out: 'fade', seconds: 0.35 },
  price: { in: 'zoom', out: 'fade', seconds: 0.35 },
  cta: { in: 'zoom', out: 'fade', seconds: 0.4 },
};

export function buildReel(input: ReelBuildInput): ReelBuild {
  const { template } = input;
  const plan = input.plan ?? legacyPlan(input);
  const clips = plan.clips;
  if (clips.length === 0) throw new PermanentError('El reel no tiene ningún elemento');
  const warnings: string[] = [];
  const fps = template.canvas.fps;
  const width = input.outputWidth ?? template.canvas.width;
  if (width > template.canvas.width) throw new PermanentError('El ancho de salida no puede superar el del lienzo');
  const height = Math.round((width * 16) / 9 / 2) * 2;
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps));
  const grade: ReelGrade = plan.grade ?? 'natural';
  // Rango de vídeo al escalar. Sin cambiar de matriz de color ni etiquetarla: probado con FFmpeg 9,
  // forzar BT.709 a mitad del grafo anulaba parte de los filtros de color que trabajan en RGB.
  const scaleColor = 'out_range=tv';

  // ── Línea de tiempo ──────────────────────────────────────────────────
  const { durations, transitions, starts, total: clipsTotal } = planTimeline(clips, template, fps);
  const outro = plan.outro ?? null;
  const outroSeconds = outro ? frames(outro.seconds) / fps : 0;
  const outroFade = outro ? Math.min(OUTRO_FADE, durations[durations.length - 1]! / 2) : 0;
  const outroStart = outro ? Number((clipsTotal - outroFade).toFixed(4)) : clipsTotal;
  const total = outro ? Number((outroStart + outroSeconds).toFixed(4)) : clipsTotal;
  const maxTotal = input.maxTotalSeconds ?? (input.plan ? REEL_PLAN_V2_MAX_SECONDS : template.timing.maxTotalSeconds);
  if (total > maxTotal + 1e-6) {
    throw new PermanentError(
      input.plan
        ? `El reel duraría ${num(total, 2)} s y admite ${maxTotal} s como máximo`
        : `El reel duraría ${num(total, 2)} s y la plantilla admite ${maxTotal} s como máximo`,
    );
  }
  const timeline: TimelineSegment[] = clips.map((clip, index) => ({
    index,
    type: clip.type,
    start: starts[index]!,
    seconds: durations[index]!,
    transitionIn: transitions[index]!,
  }));
  if (outro) {
    timeline.push({ index: clips.length, type: 'outro', start: outroStart, seconds: outroSeconds, transitionIn: outroFade });
  }

  // Misma foto en varios planos: se avisa (quien elige el material debería evitarlo).
  const seen = new Map<string, number>();
  clips.forEach((clip) => seen.set(clip.file, (seen.get(clip.file) ?? 0) + 1));
  for (const [, count] of seen) {
    if (count > 1) warnings.push(`Una misma foto o clip sale ${count} veces en el reel`);
  }

  // ── Entradas ─────────────────────────────────────────────────────────
  const args: string[] = [];
  const chains: string[] = [];
  const crop = (w: number, h: number, focal: FocalPoint = CENTER) =>
    `crop=${w}:${h}:${focalCropExpr('w', w, focal.x)}:${focalCropExpr('h', h, focal.y)}`;
  const finish = 'setsar=1,format=yuv420p,settb=AVTB';
  // Desenfoque después del recorte: el radio es relativo al cuadro que se ve.
  const blurFilter = (blur: number | undefined, w: number, h: number) => {
    const sigma = blurSigma(blur, w, h);
    return sigma > 0 ? [`gblur=sigma=${num(sigma, 2)}`] : [];
  };
  const colorFilter = (filter: ClipFilter | undefined) => (filter ? CLIP_FILTER_CHAINS[filter] : []);
  const framing: PhotoFraming[] = [];
  let photoCount = 0;
  let nextInput = 0;

  clips.forEach((item, index) => {
    const seconds = durations[index]!;
    if (item.type === 'photo') {
      args.push('-noautorotate', '-i', item.file);
      nextInput += 1;
      const sw = width * SUPERSAMPLE;
      const sh = height * SUPERSAMPLE;
      const count = frames(seconds);
      // Avance suavizado (entra y sale despacio): la cámara no arranca ni frena de golpe.
      const ease = (from: number, length: number) =>
        `(0.5-0.5*cos(PI*${from === 0 ? 'on' : `(on-${from})`}/${Math.max(1, length - 1)}))`;
      const amount = num(item.motionAmount ?? Math.max(template.photoMotion.amount, 0.08));
      const kind: PhotoMotion =
        item.motion ??
        (template.photoMotion.type === 'alternate'
          ? MOTION_CYCLE[photoCount % MOTION_CYCLE.length]!
          : template.photoMotion.type);
      photoCount += 1;
      const frame = photoFraming(item, sw, sh);
      const framed: PhotoFraming = { index, mode: frame.mode, target: frame.target, source: frame.source, tighten: frame.tighten };
      framing.push(framed);
      // La ventana del zoom se centra en el sujeto (sin salirse de la foto).
      const tx = `max(0,min(iw-iw/zoom,${num(frame.target.x, 3)}*iw-iw/zoom/2))`;
      const ty = `max(0,min(ih-ih/zoom,${num(frame.target.y, 3)}*ih-ih/zoom/2))`;
      // Corte a detalle a mitad del plano (solo acercamientos y si la resolución lo aguanta:
      // nunca menos de MIN_USEFUL_WIDTH px de la foto a lo ancho; si no llega a ×1,25, no hay corte).
      const detailZoom = Math.min(DETAIL_ZOOM, frame.room / (1 + Number(amount)));
      const detailAt =
        (kind === 'zoom-in' || kind === 'zoom-out') && seconds >= DETAIL_CUT_MIN_SECONDS && detailZoom >= DETAIL_MIN_ZOOM
          ? Math.round(count * 0.5)
          : 0;
      framed.detail = detailAt ? Number(detailZoom.toFixed(3)) : 0;
      const first = detailAt || count;
      const progress = ease(0, first);
      const motion = {
        none: { z: '1', x: '0', y: '0' },
        'zoom-in': { z: `1+${amount}*${progress}`, x: tx, y: ty },
        'zoom-out': { z: `1+${amount}-${amount}*${progress}`, x: tx, y: ty },
        'pan-right': { z: `1+${amount}`, x: `(iw-iw/zoom)*${progress}`, y: ty },
        'pan-left': { z: `1+${amount}`, x: `(iw-iw/zoom)*(1-${progress})`, y: ty },
        // La cámara sube (la ventana va de abajo arriba) o baja.
        'pan-up': { z: `1+${amount}`, x: tx, y: `(ih-ih/zoom)*(1-${progress})` },
        'pan-down': { z: `1+${amount}`, x: tx, y: `(ih-ih/zoom)*${progress}` },
      }[kind];
      // Entra por corte: un golpe de zoom corto que se asienta (no en las transiciones suaves).
      const punch = (from: number) =>
        `(1+${PUNCH}*pow(max(0,1-${from === 0 ? 'on' : `(on-${from})`}/${PUNCH_FRAMES}),2))`;
      let z = motion.z;
      if (detailAt) {
        const second = `${num(detailZoom, 3)}+${amount}*${ease(detailAt, count - detailAt)}`;
        z = `if(lt(on,${detailAt}),${z},(${second})*${punch(detailAt)})`;
        // El detalle no se sale del sujeto: la ventana queda dentro de su caja (o centrada en
        // ella si la caja es más pequeña que la ventana).
        const b = frame.subjectBox;
        if (b) {
          const inside = (axis: 'iw' | 'ih', t: number, from: number, size: number) => {
            const win = `${axis}/zoom`;
            const lo = `${num(from, 3)}*${axis}`;
            const hi = `${num(from + size, 3)}*${axis}-${win}`;
            const wanted = `${num(t, 3)}*${axis}-${win}/2`;
            const centred = `${num(from + size / 2, 3)}*${axis}-${win}/2`;
            return `max(0,min(${axis}-${win},if(gt(${win},${num(size, 3)}*${axis}),${centred},max(${lo},min(${hi},${wanted})))))`;
          };
          motion.x = `if(lt(on,${detailAt}),${tx},${inside('iw', frame.target.x, b.x, b.w)})`;
          motion.y = `if(lt(on,${detailAt}),${ty},${inside('ih', frame.target.y, b.y, b.h)})`;
        } else {
          motion.x = tx;
          motion.y = ty;
        }
      }
      if (transitions[index] === 0 && kind !== 'none') z = `(${z})*${punch(0)}`;
      motion.z = z;
      const tail = [
        ...blurFilter(item.blur, sw, sh),
        ...colorFilter(item.filter),
        `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=${count}:s=${width}x${height}:fps=${fps}`,
        `trim=duration=${num(seconds)}`,
        finish,
      ];
      const head = [
        // Un solo fotograma, aunque el archivo sea una imagen animada.
        'trim=end_frame=1',
        ...orientationFilters(item.orientation),
      ];
      if (frame.mode === 'fit' && frame.fit) {
        const f = frame.fit;
        chains.push(`[${nextInput - 1}:v]${head.join(',')},split=2[pb${index}][pf${index}]`);
        chains.push(
          `[pb${index}]${[
            // Fondo a sangre: la misma foto ampliada y desenfocada, con la sombra de la foto encima.
            `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=bilinear:${scaleColor}`,
            crop(sw, sh, frame.focal),
            `drawbox=x=${f.x + Math.round(sw * 0.01)}:y=${f.y + Math.round(sh * 0.012)}:w=${f.cropW}:h=${f.cropH}:color=black@0.55:t=fill`,
            `gblur=sigma=${num(sw * 0.03, 1)}`,
            'eq=brightness=-0.03:saturation=0.95',
          ].join(',')}[pbg${index}]`,
        );
        chains.push(
          `[pf${index}]${[
            `scale=${f.fgW}:${f.fgH}:flags=lanczos:${scaleColor}`,
            `crop=${f.cropW}:${f.cropH}:${f.cropX}:${f.cropY}`,
          ].join(',')}[pfg${index}]`,
        );
        chains.push(`[pbg${index}][pfg${index}]overlay=${f.x}:${f.y},${tail.join(',')}[v${index}]`);
      } else {
        chains.push(
          `[${nextInput - 1}:v]${[
            ...head,
            // A pantalla llena (y, si se ciñe al sujeto, un poco más) y recortado sobre el punto de interés.
            `scale=${even(sw * frame.tighten)}:${even(sh * frame.tighten)}:force_original_aspect_ratio=increase:flags=lanczos:${scaleColor}`,
            crop(sw, sh, frame.focal),
            ...tail,
          ].join(',')}[v${index}]`,
        );
      }
    } else {
      const speed = item.speed ?? 1;
      // Se lee el tramo del archivo (seconds × speed) y se le cambia el reloj antes de igualar los fotogramas.
      args.push('-ss', num(item.in), '-t', num(seconds * speed + 1), '-i', item.file);
      nextInput += 1;
      chains.push(
        `[${nextInput - 1}:v]${[
          ...(speed !== 1 ? [`setpts=(PTS-STARTPTS)/${num(speed, 4)}`] : []),
          `fps=${fps}`,
          `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic:${scaleColor}`,
          crop(width, height, item.focalPoint),
          ...blurFilter(item.blur, width, height),
          ...colorFilter(item.filter),
          // Si al clip le falta algún fotograma al final, se repite el último.
          'tpad=stop_mode=clone:stop_duration=1',
          `trim=duration=${num(seconds)}`,
          'setpts=PTS-STARTPTS',
          finish,
        ].join(',')}[v${index}]`,
      );
    }
  });

  // ── Unión de los elementos: corte (concat) o transición (xfade) ──────
  let videoLabel = 'v0';
  if (clips.length > 1 && transitions.every((t) => t === 0)) {
    chains.push(`${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[joined]`);
    videoLabel = 'joined';
  } else if (clips.length > 1) {
    for (let i = 1; i < clips.length; i += 1) {
      const out = `x${i}`;
      const t = transitions[i]!;
      if (t === 0) {
        chains.push(`[${videoLabel}][v${i}]concat=n=2:v=1:a=0[${out}]`);
      } else {
        const type = (clips[i]!.transition ?? template.transition).type;
        chains.push(
          `[${videoLabel}][v${i}]xfade=transition=${type}:duration=${num(t)}:offset=${num(starts[i]!)}[${out}]`,
        );
      }
      videoLabel = out;
    }
  }

  // ── Cierre con la marca ──────────────────────────────────────────────
  if (outro) {
    const count = frames(outroSeconds);
    const lastPhoto = [...clips].reverse().find((c): c is Extract<ResolvedClip, { type: 'photo' }> => c.type === 'photo');
    if (outro.background || !lastPhoto) {
      const color = outro.background ?? '#151515';
      args.push('-f', 'lavfi', '-i', `color=c=${hex(color)}:s=${width}x${height}:r=${fps}:d=${num(outroSeconds)}`);
      chains.push(`[${nextInput}:v]${finish}[obg]`);
    } else {
      // La última foto, muy desenfocada y oscurecida, con un acercamiento lento.
      args.push('-noautorotate', '-i', lastPhoto.file);
      const sw = width;
      const sh = height;
      chains.push(
        `[${nextInput}:v]${[
          'trim=end_frame=1',
          ...orientationFilters(lastPhoto.orientation),
          `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=bilinear:${scaleColor}`,
          crop(sw, sh, lastPhoto.focalPoint ?? lastPhoto.subject?.focal),
          `gblur=sigma=${num(width * 0.045, 1)}`,
          'eq=brightness=-0.24:saturation=0.75',
          `zoompan=z='1.03+0.04*on/${Math.max(1, count - 1)}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${count}:s=${width}x${height}:fps=${fps}`,
          `trim=duration=${num(outroSeconds)}`,
          finish,
        ].join(',')}[obg]`,
      );
    }
    nextInput += 1;
    let outroLabel = 'obg';
    if (outro.logo) {
      args.push('-noautorotate', '-i', outro.logo.file);
      const maxW = even(width * 0.46);
      const maxH = even(height * 0.15);
      chains.push(
        `[${nextInput}:v]${[
          'trim=end_frame=1',
          ...orientationFilters(outro.logo.orientation),
          `scale=${maxW}:${maxH}:force_original_aspect_ratio=decrease:flags=lanczos`,
          'format=rgba',
          `loop=loop=${count}:size=1:start=0`,
          `setpts=N/${fps}/TB`,
          'fade=t=in:st=0.15:d=0.45:alpha=1',
        ].join(',')}[ologo]`,
      );
      chains.push(`[obg][ologo]overlay=x=(W-w)/2:y=${Math.round(height * 0.34)}-h/2:eof_action=repeat,${finish}[outro]`);
      outroLabel = 'outro';
      nextInput += 1;
    }
    chains.push(
      `[${videoLabel}][${outroLabel}]xfade=transition=fade:duration=${num(outroFade)}:offset=${num(outroStart)}[withoutro]`,
    );
    videoLabel = 'withoutro';
  }

  // ── Textos y subtítulos ──────────────────────────────────────────────
  const textFiles: ReelBuild['textFiles'] = [];
  const draws: string[] = [];
  let missingFont = false;
  const fontFor = (style: ReelTextStyle, role: TextRole) => {
    const own = style.fontPath ? input.fontFiles?.[style.fontPath] : undefined;
    const file = own ?? (role === 'label' && input.labelFontFile ? input.labelFontFile : input.fontFile);
    if (!file) missingFont = true;
    return file;
  };
  const metricsFor = (file: string | undefined) => (file ? input.fontMetrics?.[file] : undefined);
  const area = safeArea(width, height);

  /** El estilo con lo mínimo para leerse sobre cualquier foto: contorno o caja, y fundido. */
  const legible = (style: ReelTextStyle, role: TextRole | null): ReelTextStyle => {
    const next: ReelTextStyle = { ...style, fadeSeconds: Math.max(style.fadeSeconds, MIN_TEXT_FADE) };
    // Un rótulo pequeño sin caja no se lee sobre una foto con detalle: lleva una caja oscura translúcida.
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
  };

  const draw = (
    prefix: string,
    laid: LaidText,
    style: ReelTextStyle,
    fontFile: string | undefined,
    start: number,
    end: number,
    animation?: TextAnimation,
    offsetX = 0,
  ) => {
    const lines = laid.lines;
    const fontSize = laid.fontSize;
    const ox = Math.round(offsetX * width);
    const chars = lines.reduce((n, line) => n + line.length, 0);
    const d = animationDurations(animation, style, start, end, chars);
    const a = animation ?? { in: 'fade' as const, out: 'fade' as const };
    const typewriter = a.in === 'typewriter' && d.steps > 0;
    // Expresiones de FFmpeg: P y Q son el avance de la entrada y de la salida (0 a 1), E y F su suavizado.
    const P = `clip((t-${num(start)})/${num(d.inSeconds)},0,1)`;
    const Q = `clip((${num(end)}-t)/${num(d.outSeconds)},0,1)`;
    const E = `(1-pow(1-${P},3))`;
    const F = `(1-pow(1-${Q},3))`;

    const alphaIn = d.inSeconds > 0 && ['fade', 'rise', 'zoom', 'slide'].includes(a.in);
    const alphaOut = d.outSeconds > 0 && ['fade', 'fall', 'slide'].includes(a.out);
    let alpha: string | null = null;
    if (a.in === 'fade' && a.out === 'fade' && d.inSeconds === d.outSeconds) {
      const f = num(d.inSeconds);
      alpha = `if(lt(t,${num(start + d.inSeconds)}),(t-${num(start)})/${f},if(gt(t,${num(end - d.inSeconds)}),(${num(end)}-t)/${f},1))`;
    } else if (alphaIn || alphaOut) {
      alpha = [alphaIn ? P : null, alphaOut ? Q : null].filter(Boolean).join('*');
    }
    const slideIn = a.in === 'slide' && d.inSeconds > 0;
    const slideOut = a.out === 'slide' && d.outSeconds > 0;
    const riseIn = a.in === 'rise' && d.inSeconds > 0;
    const fallOut = a.out === 'fall' && d.outSeconds > 0;
    const zoom = a.in === 'zoom' && d.inSeconds > 0;
    const travelX = num(SLIDE_TRAVEL * width);
    const travelY = num(RISE_TRAVEL * height);
    // Centrado y, si se movió a mano, sin salirse de los márgenes laterales.
    const left = area.left + laid.padding;
    const right = area.right - laid.padding;
    const typewriterLeft = Math.round((width - laid.blockWidth) / 2) + laid.padding + ox;
    const baseX = typewriter
      ? `${clamp(typewriterLeft, left, right)}`
      : ox === 0
        ? '(w-text_w)/2'
        : `clip((w-text_w)/2${ox > 0 ? `+${ox}` : ox},${left},${right}-text_w)`;
    const x = baseX + (slideIn ? `-(1-${E})*${travelX}` : '') + (slideOut ? `+(1-${F})*${travelX}` : '');
    const shadow = !style.box;

    const draws1 = (name: string, enable: string, lineIndex: number) => {
      const baseY = laid.top + lineIndex * laid.lineStep;
      const y =
        `${baseY}` +
        (riseIn ? `+(1-${E})*${travelY}` : '') +
        (fallOut ? `+(1-${F})*${travelY}` : '') +
        (zoom ? `+${num((laid.lineBox * (1 - ZOOM_FROM)) / 2)}*(1-${E})` : '');
      const options = [
        `fontfile=${fontFile}`,
        `textfile=${name}`,
        'expansion=none',
        'y_align=font',
        zoom ? `fontsize='${fontSize}*(${ZOOM_FROM}+${num(1 - ZOOM_FROM)}*${E})'` : `fontsize=${fontSize}`,
        `fontcolor=${hex(style.color)}`,
        x === '(w-text_w)/2' ? `x=${x}` : `x='${x}'`,
        y === `${baseY}` ? `y=${baseY}` : `y='${y}'`,
        `enable='${enable}'`,
      ];
      if (style.box) {
        options.push(
          'box=1',
          `boxcolor=${hex(style.box.color, style.box.opacity)}`,
          `boxborderw=${Math.max(1, laid.padding)}`,
        );
      }
      if (style.outline) {
        options.push(
          `borderw=${Math.max(1, Math.round(style.outline.widthRatio * fontSize))}`,
          `bordercolor=${hex(style.outline.color)}`,
        );
      }
      if (shadow) {
        options.push(
          `shadowcolor=${hex('#000000', 0.45)}`,
          'shadowx=0',
          `shadowy=${Math.max(1, Math.round(fontSize * 0.045))}`,
        );
      }
      if (alpha) options.push(`alpha='${alpha}'`);
      draws.push(`drawtext=${options.join(':')}`);
    };

    if (typewriter) {
      // Letra a letra: un `drawtext` por línea y por paso, con el texto escrito hasta ese paso.
      let offset = 0;
      lines.forEach((line, lineIndex) => {
        const entries: Array<{ from: number; chars: number }> = [];
        let shown = 0;
        for (let step = 1; step <= d.steps; step += 1) {
          const visible = Math.min(line.length, Math.max(0, Math.round((chars * step) / d.steps) - offset));
          if (visible > shown) {
            entries.push({ from: start + ((step - 1) * d.inSeconds) / d.steps, chars: visible });
            shown = visible;
          }
        }
        offset += line.length;
        entries.forEach((entry, entryIndex) => {
          const name = `${prefix}-${lineIndex}-${entryIndex}.txt`;
          textFiles.push({ name, content: line.slice(0, entry.chars).trimEnd() });
          const next = entries[entryIndex + 1];
          const enable = next
            ? `gte(t,${num(entry.from)})*lt(t,${num(next.from)})`
            : `between(t,${num(entry.from)},${num(end)})`;
          draws1(name, enable, lineIndex);
        });
      });
      return;
    }
    lines.forEach((line, lineIndex) => {
      const name = `${prefix}-${lineIndex}.txt`;
      textFiles.push({ name, content: line });
      draws1(name, `between(t,${num(start)},${num(end)})`, lineIndex);
    });
  };

  // 1) Medir cada texto (con su papel) y 2) colocarlos todos sin que se pisen.
  interface Pending {
    kind: 'text' | 'subtitle';
    index: number;
    prefix: string;
    role: TextRole;
    start: number;
    end: number;
    position: 'top' | 'center' | 'bottom';
    style: ReelTextStyle;
    fontFile: string | undefined;
    animation?: TextAnimation;
    offsetX: number;
    laid: LaidText;
  }
  const pending: Pending[] = [];
  const firstStart = Math.min(...plan.texts.map((t) => t.start), Number.POSITIVE_INFINITY);
  plan.texts.forEach((item, index) => {
    let start = Math.min(item.start, outroStart);
    const end = Math.min(item.end, outroStart);
    if (end - start < MIN_VISIBLE_SECONDS) {
      warnings.push(`El texto ${index + 1} queda fuera del vídeo (${num(clipsTotal, 2)} s) y no se ha puesto`);
      return;
    }
    if (item.end > outroStart + 0.05) {
      warnings.push(
        outro ? `El texto ${index + 1} se ha recortado antes del cierre` : `El texto ${index + 1} se ha recortado al final del vídeo`,
      );
    }
    const explicit = item.role ?? null;
    const role = explicit ?? inferRole(item, index, clipsTotal, firstStart);
    // Gancho: el titular del principio entra en el primer segundo (salvo que traiga su propia animación).
    if (role === 'headline' && !item.animation && start > 0.15 && start <= 1) start = 0.15;
    const style = legible(item.style, role);
    const fontFile = fontFor(style, role);
    const m = measurer(metricsFor(fontFile));
    const laid = layoutText(
      { text: item.text, style, position: item.position, role, offset: item.offset, maxLines: MAX_TEXT_LINES },
      width,
      height,
      m,
    );
    if (laid.lines.length === 0) return;
    if (laid.truncated) warnings.push(`El texto ${index + 1} no cabe: se han dejado ${laid.lines.length} líneas`);
    pending.push({
      kind: 'text',
      index,
      prefix: `text-${index}`,
      role,
      start,
      end,
      position: item.position,
      style,
      fontFile,
      animation: item.animation ?? (explicit ? ROLE_ANIMATION[explicit] : undefined),
      offsetX: item.offset?.x ?? 0,
      laid,
    });
  });

  const subtitles: ReelBuild['subtitles'] = [];
  if (plan.subtitles?.enabled) {
    const style = legible(plan.subtitles.style, 'label');
    const position = plan.subtitles.position;
    const fontFile = fontFor(style, 'label');
    const m = measurer(metricsFor(fontFile));
    const cues = timelineSubtitles(clips, { durations, starts });
    cues.forEach((cue, index) => {
      const start = Math.min(cue.start, outroStart);
      const end = Math.min(cue.end, outroStart);
      if (end - start < MIN_VISIBLE_SECONDS) return;
      const laid = layoutText(
        { text: cue.text, style, position, role: null, maxLines: MAX_SUBTITLE_LINES },
        width,
        height,
        m,
      );
      if (laid.lines.length === 0) return;
      if (laid.truncated) {
        warnings.push(`El subtítulo ${index + 1} no cabe: se han dejado ${MAX_SUBTITLE_LINES} líneas`);
      }
      subtitles.push({ start, end, text: laid.lines.join('\n') });
      pending.push({
        kind: 'subtitle',
        index: 1000 + index,
        prefix: `sub-${index}`,
        role: 'label',
        start,
        end,
        position,
        style,
        fontFile,
        offsetX: 0,
        laid,
      });
    });
  }

  const { placed, warnings: placeWarnings } = placeTexts(
    pending.map((p) => ({ index: pending.indexOf(p), start: p.start, end: p.end, laid: p.laid, position: p.position })),
    width,
    height,
  );
  // Los avisos de colocación hablan de «texto N»: se traducen a su número real.
  for (const w of placeWarnings) {
    const match = /^El texto (\d+) (.*)$/.exec(w);
    const p = match ? pending[Number(match[1]) - 1] : undefined;
    if (p) warnings.push(p.kind === 'text' ? `El texto ${p.index + 1} ${match![2]}` : `Un subtítulo ${match![2]}`);
  }
  const placements: TextPlacement[] = [];
  for (const spot of placed) {
    const p = pending[spot.index]!;
    draw(p.prefix, spot.laid, p.style, p.fontFile, spot.start, spot.end, p.animation, p.offsetX);
    placements.push({
      kind: p.kind,
      index: p.kind === 'text' ? p.index : p.index - 1000,
      role: p.role,
      start: r3(spot.start),
      end: r3(spot.end),
      top: spot.laid.extent[0],
      bottom: spot.laid.extent[1],
      width: Math.round(spot.laid.blockWidth),
      fontSize: spot.laid.fontSize,
      lines: spot.laid.lines,
    });
  }

  // Textos del cierre: llamada grande en la caja del color de la marca, y usuario y dirección debajo.
  if (outro) {
    const accent = outro.accent ?? '#FFFFFF';
    const accentText = outro.accentText ?? contrastingDark(accent);
    const onBg = outro.background ? contrastingDark(outro.background) : '#FFFFFF';
    const textStart = outroStart + outroFade * 0.6;
    const textEnd = total;
    const ctaStyle: ReelTextStyle = {
      sizeRatio: 0.078,
      color: accentText,
      marginRatio: 0,
      maxWidthRatio: 0.84,
      lineHeight: 1.1,
      box: { color: accent, opacity: 1, paddingRatio: 0.42 },
      outline: null,
      fadeSeconds: 0.3,
    };
    const smallStyle = (sizeRatio: number): ReelTextStyle => ({
      sizeRatio,
      color: onBg,
      marginRatio: 0,
      maxWidthRatio: 0.84,
      lineHeight: 1.15,
      box: null,
      outline: null,
      fadeSeconds: 0.3,
    });
    const ctaFont = fontFor(ctaStyle, 'cta');
    const smallFont = fontFor(ctaStyle, 'label');
    const cta = layoutText(
      { text: outro.cta, style: ctaStyle, position: 'center', role: 'cta', maxLines: 2 },
      width,
      height,
      measurer(metricsFor(ctaFont)),
    );
    let cursor = Math.round(height * (outro.logo ? 0.47 : 0.42));
    const items: Array<{ laid: LaidText; style: ReelTextStyle; font: string | undefined; delay: number; role: TextRole }> = [
      { laid: moveText(cta, cursor), style: ctaStyle, font: ctaFont, delay: 0.1, role: 'cta' },
    ];
    cursor = items[0]!.laid.extent[1] + Math.round(height * 0.035);
    for (const [value, size, delay] of [
      [outro.handle, 0.05, 0.3],
      // Sin signos colgando («…(Alicante),»): los planes guardados antes pueden traerlos.
      [outro.address?.replace(/^[\s,.;:·]+|[\s,.;:·]+$/g, '') ?? null, 0.038, 0.4],
    ] as const) {
      if (!value) continue;
      const style = legible(smallStyle(size), 'cta');
      const laid = layoutText(
        { text: value, style, position: 'center', role: null, maxLines: 2 },
        width,
        height,
        measurer(metricsFor(smallFont)),
      );
      const moved = moveText(laid, Math.min(cursor, area.bottom - (laid.extent[1] - laid.extent[0])));
      items.push({ laid: moved, style, font: smallFont, delay, role: 'label' });
      cursor = moved.extent[1] + Math.round(height * 0.012);
    }
    items.forEach((item, index) => {
      const start = r3(textStart + item.delay);
      draw(`outro-${index}`, item.laid, item.style, item.font, start, textEnd, {
        in: index === 0 ? 'zoom' : 'rise',
        out: 'none',
        seconds: 0.35,
      });
      placements.push({
        kind: 'outro',
        index,
        role: item.role,
        start,
        end: r3(textEnd),
        top: item.laid.extent[0],
        bottom: item.laid.extent[1],
        width: Math.round(item.laid.blockWidth),
        fontSize: item.laid.fontSize,
        lines: item.laid.lines,
      });
    });
  }

  if (draws.length > 0 && missingFont) {
    throw new Error('Hay textos pero el trabajador no tiene ninguna tipografía (WORKER_FONT_FILE)');
  }
  chains.push(`[${videoLabel}]${[...GRADE_CHAINS[grade], ...draws, 'format=yuv420p'].join(',')}[vout]`);

  // ── Sonido: música y/o sonido de los clips; sin ninguno, sin pista ───
  const audioFormat = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const clipSound = clips.some((c) => c.type === 'video' && c.hasAudio && c.volume > 0);
  const audio: ReelBuild['audio'] = plan.music ? 'music' : clipSound ? 'clips' : 'none';
  if (audio !== 'none') {
    const mix: string[] = [];
    args.push('-f', 'lavfi', '-t', num(total), '-i', 'anullsrc=r=48000:cl=stereo');
    chains.push(`[${nextInput}:a]${audioFormat}[abase]`);
    mix.push('[abase]');
    nextInput += 1;

    if (plan.music) {
      const music = plan.music;
      const fadeIn = Math.min(music.fadeInSeconds, total / 2);
      const fadeOut = Math.min(Math.max(music.fadeOutSeconds, outro ? outroSeconds * 0.6 : 0), total / 2);
      args.push('-stream_loop', '-1', '-i', music.file);
      const filters = [
        `atrim=start=${num(music.startAt)}:end=${num(music.startAt + total)}`,
        'asetpts=PTS-STARTPTS',
        audioFormat,
        `volume=${num(music.volume, 3)}`,
      ];
      if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${num(fadeIn)}`);
      if (fadeOut > 0) filters.push(`afade=t=out:st=${num(total - fadeOut)}:d=${num(fadeOut)}`);
      chains.push(`[${nextInput}:a]${filters.join(',')}[amusic]`);
      mix.push('[amusic]');
      nextInput += 1;
    }

    clips.forEach((item, index) => {
      if (item.type !== 'video' || !item.hasAudio || item.volume <= 0) return;
      const seconds = durations[index]!;
      // Fundido corto en los extremos: con la transición, o mínimo para que no chasquee.
      const around = Math.max(transitions[index]!, transitions[index + 1] ?? (index === clips.length - 1 ? outroFade : 0));
      const edge = Math.min(Math.max(around, 0.03), seconds / 2);
      const speed = item.speed ?? 1;
      const filters = [
        `atrim=duration=${num(seconds * speed)}`,
        'asetpts=PTS-STARTPTS',
        // Más deprisa o más despacio sin cambiar el tono (atempo admite de 0,5 a 2 en todas las versiones).
        ...(speed !== 1 ? [`atempo=${num(speed, 4)}`] : []),
        audioFormat,
        `volume=${num(item.volume, 3)}`,
        `afade=t=in:st=0:d=${num(edge)}`,
        `afade=t=out:st=${num(seconds - edge)}:d=${num(edge)}`,
      ];
      const delay = Math.round(starts[index]! * 1000);
      if (delay > 0) filters.push(`adelay=${delay}:all=1`);
      // Las entradas de los clips son las primeras, en el orden del plan.
      chains.push(`[${index}:a]${filters.join(',')}[aclip${index}]`);
      mix.push(`[aclip${index}]`);
    });
    chains.push(
      mix.length === 1
        ? `${mix[0]}anull[aout]`
        : `${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0[aout]`,
    );
  }

  const filterGraph = chains.join(';\n');
  args.push('-filter_complex', filterGraph, '-map', '[vout]');
  if (audio !== 'none') args.push('-map', '[aout]');
  args.push(...reelVideoArgs(template), '-r', String(fps));
  if (audio !== 'none') {
    args.push('-c:a', 'aac', '-b:a', `${template.export.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2');
  } else {
    args.push('-an');
  }
  args.push('-t', num(total), input.outputFile);

  return {
    args,
    filterGraph,
    textFiles,
    width,
    height,
    fps,
    durationSeconds: total,
    transitionSeconds: Math.max(0, ...transitions),
    timeline,
    subtitles,
    texts: placements,
    framing,
    audio,
    warnings,
  };
}
