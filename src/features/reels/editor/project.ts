// Proyecto de reel del editor: lo que se guarda como versión de una pieza de
// formato reel (`content_versions.data`) y lo que se encarga al trabajador.
//
//   { kind: 'reel', template: { id }, plan: <plan v2>, guide?: <guion> }
//
// `guide` es opcional y solo vive en la versión guardada (nunca se manda al
// trabajador): el guion de un reel hecho con «Hacer un reel como este», con los
// planos que faltan por grabar (src/features/reels/like/draft.ts).
//
// El plan v2 es el mismo que valida el trabajador (worker/src/reel/schema.ts,
// zod 4); aquí se repite con zod 3 y las mismas reglas, y un ejemplo
// compartido (worker/tests/fixtures/plan-v2.json) comprueba que los dos lados
// dicen lo mismo. Las cuentas de la línea de tiempo y del texto son las del
// motor (worker/src/reel/build.ts): la vista previa usa estas para parecerse
// lo más posible a lo que monta FFmpeg.
//
// Todo es puro: sin red ni React.
import { z } from 'zod';
import type { Json } from '@/lib/database.types';
import type { ReelTemplateSummary } from '../templates';
import { TEXT_IN_ANIMATIONS, TEXT_OUT_ANIMATIONS, type TextAnimation } from './animation';

export const PROJECT_KIND = 'reel';
/** Versión del plan (y `schema_version` de la versión de la pieza). */
export const REEL_PLAN_VERSION = 2;
export const REEL_MAX_SECONDS = 90;
export const REEL_MAX_CLIPS = 30;
export const REEL_MAX_TEXTS = 30;
export const REEL_MAX_CUES = 200;
export const REEL_TEXT_MAX_LENGTH = 200;
export const MIN_SEGMENT_SECONDS = 0.5;
export const MAX_CLIP_SEGMENT_SECONDS = 60;
export const PHOTO_SECONDS = { min: 0.5, max: 10 } as const;
export const MAX_TEXT_LINES = 6;
export const MAX_SUBTITLE_LINES = 3;
/** Ancho medio de un carácter respecto al tamaño de letra (el del motor). */
export const AVERAGE_GLYPH_WIDTH = 0.56;

export const TRANSITION_TYPES = ['cut', 'fade', 'fadeblack', 'dissolve', 'slideleft', 'slideup'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];
export const PHOTO_MOTIONS = ['none', 'zoom-in', 'zoom-out', 'pan-right', 'pan-left', 'pan-up', 'pan-down'] as const;
export type PhotoMotion = (typeof PHOTO_MOTIONS)[number];
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];
/** Velocidad de un clip: de la mitad al doble. Sin el campo, 1 (la del archivo). */
export const CLIP_SPEED = { min: 0.5, max: 2 } as const;
/** Filtros de color de un clip o una foto: los mismos nombres que los filtros rápidos de las fotos. */
export const CLIP_FILTERS = ['bw', 'sepia', 'vivid', 'warm', 'cool', 'fade', 'drama'] as const;
export type ClipFilter = (typeof CLIP_FILTERS)[number];
/** Cuánto se puede apartar un texto de su sitio (fracción del ancho y del alto). */
export const TEXT_OFFSET_LIMIT = 0.5;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB');
const storagePath = z.string().min(5).max(600);
const fontPath = storagePath.regex(/\.(ttf|otf)$/i, 'La tipografía debe ser .ttf u .otf');
const elementId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const focalPoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const blur = z.number().min(0).max(100).optional();
const clipFilter = z.enum(CLIP_FILTERS).optional();
const textOffset = z
  .object({
    x: z.number().min(-TEXT_OFFSET_LIMIT).max(TEXT_OFFSET_LIMIT),
    y: z.number().min(-TEXT_OFFSET_LIMIT).max(TEXT_OFFSET_LIMIT),
  })
  .strict();

export const transitionSchema = z
  .object({ type: z.enum(TRANSITION_TYPES), seconds: z.number().min(0).max(2) })
  .strict();
export type Transition = z.infer<typeof transitionSchema>;

export const textStyleSchema = z
  .object({
    fontPath: fontPath.optional(),
    fontFamily: z.string().max(100).optional(),
    sizeRatio: z.number().min(0.02).max(0.15),
    color: hexColor,
    marginRatio: z.number().min(0).max(0.4),
    maxWidthRatio: z.number().min(0.4).max(1),
    lineHeight: z.number().min(1).max(2),
    box: z
      .object({ color: hexColor, opacity: z.number().min(0).max(1), paddingRatio: z.number().min(0).max(1) })
      .strict()
      .nullable(),
    outline: z
      .object({ color: hexColor, widthRatio: z.number().min(0).max(0.2) })
      .strict()
      .nullable(),
    fadeSeconds: z.number().min(0).max(1),
  })
  .strict();
export type TextStyle = z.infer<typeof textStyleSchema>;

export const cueSchema = z
  .object({ start: z.number().min(0), end: z.number().positive(), text: z.string().min(1).max(REEL_TEXT_MAX_LENGTH) })
  .strict()
  .refine((c) => c.end > c.start, 'El subtítulo debe terminar después de empezar');
export type Cue = z.infer<typeof cueSchema>;

export const textAnimationSchema = z
  .object({
    in: z.enum(TEXT_IN_ANIMATIONS),
    out: z.enum(TEXT_OUT_ANIMATIONS),
    seconds: z.number().min(0.1).max(1.5).optional(),
  })
  .strict();

/** Portada: un fotograma del reel (segundo del reel) o una foto de la biblioteca. */
export const coverSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('frame'), at: z.number().min(0).max(REEL_MAX_SECONDS) }).strict(),
  z.object({ type: z.literal('photo'), path: storagePath }).strict(),
]);
export type Cover = z.infer<typeof coverSchema>;

const photoClipSchema = z
  .object({
    id: elementId,
    type: z.literal('photo'),
    path: storagePath,
    focalPoint: focalPoint.optional(),
    blur,
    transition: transitionSchema.optional(),
    seconds: z.number().min(PHOTO_SECONDS.min).max(PHOTO_SECONDS.max),
    motion: z.enum(PHOTO_MOTIONS).optional(),
    motionAmount: z.number().min(0).max(0.3).optional(),
    filter: clipFilter,
  })
  .strict();
const videoClipSchema = z
  .object({
    id: elementId,
    type: z.literal('video'),
    path: storagePath,
    focalPoint: focalPoint.optional(),
    blur,
    transition: transitionSchema.optional(),
    in: z.number().min(0),
    out: z.number().positive(),
    volume: z.number().min(0).max(1),
    subtitles: z.array(cueSchema).max(REEL_MAX_CUES).optional(),
    /** Velocidad (0,5 a 2): el tramo dura (out − in) / speed y el sonido se acelera igual, sin cambiar de tono. */
    speed: z.number().min(CLIP_SPEED.min).max(CLIP_SPEED.max).optional(),
    filter: clipFilter,
  })
  .strict();
export const clipSchema = z.discriminatedUnion('type', [photoClipSchema, videoClipSchema]);
export type PhotoClip = z.infer<typeof photoClipSchema>;
export type VideoClip = z.infer<typeof videoClipSchema>;
export type Clip = z.infer<typeof clipSchema>;

export const textSchema = z
  .object({
    id: elementId,
    text: z.string().min(1).max(REEL_TEXT_MAX_LENGTH),
    start: z.number().min(0),
    end: z.number().positive(),
    position: z.enum(TEXT_POSITIONS),
    style: textStyleSchema,
    animation: textAnimationSchema.optional(),
    /** Desplazamiento desde su sitio (arriba, centro o abajo), como fracción del ancho y del alto. */
    offset: textOffset.optional(),
  })
  .strict()
  .refine((t) => t.end > t.start, 'El texto debe terminar después de empezar');
export type ReelText = z.infer<typeof textSchema>;

/** Velocidad de un elemento: la del clip, o 1 (fotos y clips sin el campo). */
export const clipSpeed = (clip: Clip): number => (clip.type === 'video' ? (clip.speed ?? 1) : 1);

export const musicSchema = z
  .object({
    path: storagePath,
    startAt: z.number().min(0),
    volume: z.number().min(0).max(1),
    fadeInSeconds: z.number().min(0).max(5),
    fadeOutSeconds: z.number().min(0).max(5),
    license: z
      .object({ confirmed: z.boolean(), note: z.string().max(300).optional() })
      .strict()
      .optional(),
  })
  .strict();
export type Music = z.infer<typeof musicSchema>;

export const subtitlesSchema = z
  .object({ enabled: z.boolean(), position: z.enum(TEXT_POSITIONS), style: textStyleSchema })
  .strict();
export type SubtitleSettings = z.infer<typeof subtitlesSchema>;

export const planSchema = z
  .object({
    version: z.literal(REEL_PLAN_VERSION),
    clips: z.array(clipSchema).min(1).max(REEL_MAX_CLIPS),
    texts: z.array(textSchema).max(REEL_MAX_TEXTS).default([]),
    subtitles: subtitlesSchema.optional(),
    music: musicSchema.optional(),
    cover: coverSchema.optional(),
    fontPath: fontPath.optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    plan.clips.forEach((clip, index) => {
      if (clip.type !== 'video') return;
      const length = clip.out - clip.in;
      if (length < MIN_SEGMENT_SECONDS || length > MAX_CLIP_SEGMENT_SECONDS) {
        ctx.addIssue({
          code: 'custom',
          path: ['clips', index],
          message: 'El tramo de un clip debe durar entre 0,5 y 60 s',
        });
      }
    });
  });
export type ReelPlan = z.infer<typeof planSchema>;
export type { TextAnimation };

/** Plan en edición: puede no tener todavía ningún elemento. */
export type DraftPlan = Omit<ReelPlan, 'clips'> & { clips: Clip[] };

// ───────────────────────────── Guion («Hacer un reel como este») ─────────────────────────────

export const GUIDE_SHOT_KINDS = ['detalle', 'general', 'persona', 'texto'] as const;
export const GUIDE_TEXT_SIZES = ['grande', 'normal', 'pequeno'] as const;

/** Un plano del guion. Sin `clipId` (o si ese clip ya no está en el reel), falta por grabar. */
export const guideShotSchema = z
  .object({
    id: elementId,
    /** Qué grabar (o qué foto usar). */
    label: z.string().min(1).max(240),
    tip: z.string().max(240).optional(),
    kind: z.enum(GUIDE_SHOT_KINDS),
    media: z.enum(['foto', 'video']),
    seconds: z.number().min(0.1).max(180),
    /** Cómo se entra desde el plano anterior. */
    transition: transitionSchema.optional(),
    clipId: elementId.optional(),
  })
  .strict();
export type GuideShot = z.infer<typeof guideShotSchema>;

/** Un texto en pantalla del guion: se ve durante los planos `fromShot`…`toShot`. */
export const guideTextSchema = z
  .object({
    id: elementId,
    text: z.string().min(1).max(REEL_TEXT_MAX_LENGTH),
    position: z.enum(TEXT_POSITIONS),
    size: z.enum(GUIDE_TEXT_SIZES),
    fromShot: elementId,
    toShot: elementId,
  })
  .strict();
export type GuideText = z.infer<typeof guideTextSchema>;

export const guideSchema = z
  .object({
    /** Análisis del que sale (`reel_references.id`). */
    referenceId: z.string().uuid(),
    shots: z.array(guideShotSchema).min(1).max(REEL_MAX_CLIPS),
    texts: z.array(guideTextSchema).max(REEL_MAX_TEXTS).default([]),
  })
  .strict();
export type ReelGuide = z.infer<typeof guideSchema>;

export interface ReelProject {
  kind: typeof PROJECT_KIND;
  template: { id: string };
  plan: DraftPlan;
  guide?: ReelGuide;
}

export const projectSchema = z
  .object({
    kind: z.literal(PROJECT_KIND),
    template: z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/) }).strict(),
    plan: planSchema,
    guide: guideSchema.optional(),
  })
  .strict();

// ───────────────────────────── Borrador automático ─────────────────────────────

const draftClipSchema = z.discriminatedUnion('type', [
  z.object({ id: elementId, type: z.literal('photo'), path: storagePath, seconds: z.number().positive() }).passthrough(),
  z
    .object({
      id: elementId,
      type: z.literal('video'),
      path: storagePath,
      in: z.number().min(0),
      out: z.number().positive(),
      volume: z.number().min(0).max(1),
    })
    .passthrough(),
]);
const draftTextSchema = z
  .object({
    id: elementId,
    text: z.string().max(REEL_TEXT_MAX_LENGTH),
    start: z.number().min(0),
    end: z.number().min(0),
    position: z.enum(TEXT_POSITIONS),
    style: textStyleSchema,
  })
  .passthrough();
const draftSchema = z.object({
  kind: z.literal(PROJECT_KIND),
  template: z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/) }).strict(),
  plan: z
    .object({
      version: z.literal(REEL_PLAN_VERSION),
      clips: z.array(draftClipSchema).max(REEL_MAX_CLIPS),
      texts: z.array(draftTextSchema).max(REEL_MAX_TEXTS).default([]),
    })
    .passthrough(),
  guide: guideSchema.optional(),
});

/**
 * Lee un borrador automático (`reel_drafts.data`). Es el montaje a medio hacer, tal cual
 * estaba: puede no tener todavía ningún clip o tener un texto vacío, así que solo se
 * comprueba lo que el editor necesita para abrirlo. Null si no se puede usar.
 */
export function parseDraftProject(data: unknown): ReelProject | null {
  if (!isReelProject(data)) return null;
  const parsed = draftSchema.safeParse(data);
  return parsed.success ? (parsed.data as unknown as ReelProject) : null;
}

export class ProjectError extends Error {
  override name = 'ProjectError';
}

/** ¿Es este JSON (una versión guardada) un proyecto de reel? */
export function isReelProject(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === PROJECT_KIND;
}

/** Lee un proyecto guardado. Lanza `ProjectError` con el motivo en español. */
export function parseProject(data: unknown): ReelProject {
  if (!isReelProject(data)) throw new ProjectError('Esta versión no es un montaje de reel.');
  const version = (data as { plan?: { version?: unknown } }).plan?.version;
  if (typeof version === 'number' && version > REEL_PLAN_VERSION) {
    throw new ProjectError('Este reel lo guardó una versión más nueva de la aplicación. Recarga la página.');
  }
  const parsed = projectSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProjectError(`El montaje guardado no es válido (${issue?.path.join('.') || 'raíz'}: ${issue?.message}).`);
  }
  return parsed.data;
}

// ───────────────────────────── Plantillas ─────────────────────────────

export function templateTextStyle(template: ReelTemplateSummary): TextStyle {
  const t = template.text;
  return {
    sizeRatio: t.sizeRatio,
    color: t.color.toUpperCase(),
    marginRatio: t.marginRatio,
    maxWidthRatio: t.maxWidthRatio,
    lineHeight: t.lineHeight,
    box: t.box ? { ...t.box } : null,
    outline: t.outline ? { ...t.outline } : null,
    fadeSeconds: t.fadeSeconds,
  };
}

export const templateTransition = (template: ReelTemplateSummary): Transition => ({
  type: template.transition.type,
  seconds: template.transition.seconds,
});

/** Estilo de los subtítulos de partida: abajo, sobre una franja, con el tamaño algo menor que el del texto. */
export function defaultSubtitleSettings(template: ReelTemplateSummary): SubtitleSettings {
  return {
    enabled: true,
    position: 'bottom',
    style: {
      sizeRatio: 0.048,
      color: '#FFFFFF',
      marginRatio: 0.16,
      maxWidthRatio: 0.86,
      lineHeight: 1.3,
      box: { color: '#000000', opacity: 0.6, paddingRatio: 0.3 },
      outline: null,
      fadeSeconds: Math.min(0.1, template.text.fadeSeconds),
    },
  };
}

export function emptyProject(template: ReelTemplateSummary): ReelProject {
  return {
    kind: PROJECT_KIND,
    template: { id: template.id },
    plan: { version: REEL_PLAN_VERSION, clips: [], texts: [] },
  };
}

/**
 * Aplica una plantilla como punto de partida: su transición en cada paso, su
 * duración de foto, su estilo en los textos (conservando la tipografía y el
 * color elegidos) y sus volúmenes. Los recortes, el orden y los textos no cambian.
 */
export function applyTemplate(project: ReelProject, template: ReelTemplateSummary): ReelProject {
  const base = templateTextStyle(template);
  const plan = project.plan;
  return {
    ...project,
    template: { id: template.id },
    plan: {
      ...plan,
      clips: plan.clips.map((clip) =>
        clip.type === 'photo'
          ? {
              ...clip,
              seconds: template.timing.photoSeconds,
              transition: templateTransition(template),
              motion: undefined,
            }
          : { ...clip, volume: template.audio.clipVolume, transition: templateTransition(template) },
      ),
      texts: plan.texts.map((text) => ({
        ...text,
        position: template.text.position,
        style: {
          ...base,
          color: text.style.color,
          ...(text.style.fontPath ? { fontPath: text.style.fontPath } : {}),
          ...(text.style.fontFamily ? { fontFamily: text.style.fontFamily } : {}),
        },
      })),
      ...(plan.music
        ? {
            music: {
              ...plan.music,
              volume: template.audio.musicVolume,
              fadeInSeconds: template.audio.fadeInSeconds,
              fadeOutSeconds: template.audio.fadeOutSeconds,
            },
          }
        : {}),
    },
  };
}

// ───────────────────────────── Plan v1 → v2 ─────────────────────────────

/** Plan v1 (el de la pantalla de reels y los encargos antiguos). */
export interface PlanV1 {
  media: Array<{
    type: 'photo' | 'video';
    path: string;
    focalPoint?: { x: number; y: number };
    startAt?: number;
    seconds?: number;
    blur?: number;
  }>;
  texts?: Array<{ text: string; start: number; end: number; position?: TextPosition }>;
  music?: { path: string; startAt?: number; volume?: number };
  fontPath?: string;
}

/** La misma migración que hace el trabajador (`migratePlanV1`): da el mismo vídeo. */
export function migratePlanV1(plan: PlanV1, template: ReelTemplateSummary): ReelPlan {
  const transition = templateTransition(template);
  return {
    version: REEL_PLAN_VERSION,
    clips: plan.media.map((item, index): Clip => {
      const base = {
        id: `m${index + 1}`,
        path: item.path,
        ...(item.focalPoint ? { focalPoint: item.focalPoint } : {}),
        ...(item.blur !== undefined ? { blur: item.blur } : {}),
        transition: { ...transition },
      };
      if (item.type === 'photo')
        return { ...base, type: 'photo', seconds: item.seconds ?? template.timing.photoSeconds };
      const start = item.startAt ?? 0;
      return {
        ...base,
        type: 'video',
        in: start,
        out: start + (item.seconds ?? template.timing.maxClipSeconds),
        volume: template.audio.clipVolume,
      };
    }),
    texts: (plan.texts ?? []).map((text, index) => ({
      id: `t${index + 1}`,
      text: text.text,
      start: text.start,
      end: text.end,
      position: text.position ?? template.text.position,
      style: templateTextStyle(template),
    })),
    ...(plan.music
      ? {
          music: {
            path: plan.music.path,
            startAt: plan.music.startAt ?? 0,
            volume: plan.music.volume ?? template.audio.musicVolume,
            fadeInSeconds: template.audio.fadeInSeconds,
            fadeOutSeconds: template.audio.fadeOutSeconds,
          },
        }
      : {}),
    ...(plan.fontPath ? { fontPath: plan.fontPath } : {}),
  };
}

// ───────────────────────────── Línea de tiempo ─────────────────────────────

export interface PlanTimeline {
  durations: number[];
  /** Transición con la que entra cada elemento (0 en el primero y en los cortes). */
  transitions: number[];
  starts: number[];
  total: number;
}

/**
 * La misma cuenta que el motor (`planTimeline` en worker/src/reel/build.ts):
 * duración ajustada a fotogramas, transición de entrada limitada a la mitad del
 * más corto de los dos elementos que une, y segundo en que empieza cada uno.
 * `fileSeconds` (duración real de cada clip, si se conoce) recorta los tramos
 * que pidan más de lo que dura el archivo.
 */
export function planTimeline(
  clips: Clip[],
  template: ReelTemplateSummary,
  fileSeconds: (clip: VideoClip) => number | null = () => null,
): PlanTimeline {
  const fps = template.canvas.fps;
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps));
  const durations = clips.map((clip) => {
    if (clip.type === 'photo') return frames(clip.seconds) / fps;
    const available = fileSeconds(clip);
    const end = available === null ? clip.out : Math.min(clip.out, available);
    // A otra velocidad el tramo dura (out − in) / speed; con speed = 1 la cuenta es la de siempre.
    return Math.max(0, Math.floor(((end - clip.in) / (clip.speed ?? 1)) * fps) / fps);
  });
  const transitions = clips.map((clip, index) => {
    if (index === 0) return 0;
    const t = clip.transition ?? templateTransition(template);
    if (t.type === 'cut' || t.seconds <= 0) return 0;
    const limit = Math.min(durations[index - 1]!, durations[index]!) / 2;
    return Math.max(0, Math.floor(Math.min(t.seconds, limit) * fps) / fps);
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

export interface TimelineCue {
  start: number;
  end: number;
  text: string;
  /** Índice del clip y del subtítulo dentro de él. */
  clip: number;
  cue: number;
}

/** Subtítulos de los clips en segundos del reel (solo lo que se ve de cada clip), como el motor. */
export function timelineSubtitles(clips: Clip[], timeline: Pick<PlanTimeline, 'durations' | 'starts'>): TimelineCue[] {
  const out: TimelineCue[] = [];
  clips.forEach((clip, index) => {
    if (clip.type !== 'video' || !clip.subtitles) return;
    const speed = clip.speed ?? 1;
    const from = clip.in;
    const to = clip.in + timeline.durations[index]! * speed;
    clip.subtitles.forEach((cue, cueIndex) => {
      const a = Math.max(cue.start, from);
      const b = Math.min(cue.end, to);
      if ((b - a) / speed < 0.2) return;
      const start = timeline.starts[index]! + (a - from) / speed;
      out.push({
        start: Number(start.toFixed(3)),
        end: Number((start + (b - a) / speed).toFixed(3)),
        text: cue.text,
        clip: index,
        cue: cueIndex,
      });
    });
  });
  return out.sort((x, y) => x.start - y.start);
}

// ───────────────────────────── Texto (mismas cuentas que el motor) ─────────────────────────────

/** Parte un texto en líneas que quepan en el ancho dado (igual que `wrapText` del trabajador). */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
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

export function textLayout(
  style: Pick<TextStyle, 'sizeRatio' | 'lineHeight' | 'maxWidthRatio' | 'marginRatio'>,
  position: TextPosition,
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

/** Líneas que dibujará el motor para un texto o un subtítulo (con su tope de líneas). */
export function textLines(
  text: string,
  style: TextStyle,
  position: TextPosition,
  width: number,
  height: number,
  max: number,
) {
  const { maxChars } = textLayout(style, position, 1, width, height);
  const lines = wrapText(text, maxChars);
  return { lines: lines.slice(0, max), truncated: lines.length > max };
}

// ───────────────────────────── Comprobaciones ─────────────────────────────

export interface ProjectContext {
  /** Duración real de cada clip de la biblioteca (por ruta), si se conoce. */
  fileSeconds?: (path: string) => number | null;
}

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);

/** Lo que impide guardar o montar, en español y en el orden de la pantalla. */
export function projectProblems(
  project: ReelProject,
  template: ReelTemplateSummary | undefined,
  context: ProjectContext = {},
): string[] {
  const problems: string[] = [];
  const { plan } = project;
  if (!template) problems.push('Elige una plantilla de partida.');
  if (plan.clips.length === 0) problems.push('Añade al menos una foto o un clip.');
  if (plan.clips.length > REEL_MAX_CLIPS) problems.push(`Como mucho ${REEL_MAX_CLIPS} fotos o clips.`);
  plan.clips.forEach((clip, index) => {
    if (clip.type !== 'video') return;
    const available = context.fileSeconds?.(clip.path) ?? null;
    const end = available === null ? clip.out : Math.min(clip.out, available);
    const length = end - clip.in;
    if (length < MIN_SEGMENT_SECONDS)
      problems.push(`El clip ${index + 1} se queda en menos de ${fmt(MIN_SEGMENT_SECONDS)} s.`);
    if (clip.out - clip.in > MAX_CLIP_SEGMENT_SECONDS)
      problems.push(`El clip ${index + 1} pasa de ${MAX_CLIP_SEGMENT_SECONDS} s.`);
  });
  if (template && plan.clips.length > 0) {
    const { total } = planTimeline(plan.clips, template, (c) => context.fileSeconds?.(c.path) ?? null);
    if (total > REEL_MAX_SECONDS + 1e-6) {
      problems.push(`El reel duraría ${fmt(total)} s y el máximo es ${REEL_MAX_SECONDS} s.`);
    }
  }
  if (plan.texts.length > REEL_MAX_TEXTS) problems.push(`Como mucho ${REEL_MAX_TEXTS} textos.`);
  plan.texts.forEach((text, index) => {
    if (!text.text.trim()) problems.push(`El texto ${index + 1} está vacío.`);
    if (!(text.end > text.start) || text.start < 0)
      problems.push(`El texto ${index + 1} debe terminar después de empezar.`);
  });
  plan.clips.forEach((clip, index) => {
    if (clip.type !== 'video') return;
    (clip.subtitles ?? []).forEach((cue, cueIndex) => {
      if (!cue.text.trim()) problems.push(`El subtítulo ${cueIndex + 1} del clip ${index + 1} está vacío.`);
    });
  });
  if (plan.cover?.type === 'frame' && template && plan.clips.length > 0) {
    const { total } = planTimeline(plan.clips, template, (c) => context.fileSeconds?.(c.path) ?? null);
    if (plan.cover.at > total + 1e-6) problems.push('La portada está después del final del vídeo: elige otro fotograma.');
  }
  const coverPhoto = plan.cover?.type === 'photo' ? plan.cover.path : null;
  if (coverPhoto && !plan.clips.some((c) => c.type === 'photo' && c.path === coverPhoto)) {
    problems.push('La foto de la portada ya no está en el reel: elige otra.');
  }
  if (plan.music && plan.music.license?.confirmed !== true) {
    problems.push('Confirma que la marca tiene licencia para usar la música elegida.');
  }
  return problems;
}

/** El proyecto listo para guardar: valida con el esquema y quita lo vacío. Lanza `ProjectError`. */
export function finalizeProject(project: ReelProject): ReelProject & { plan: ReelPlan } {
  const cleaned = {
    ...project,
    plan: {
      ...project.plan,
      texts: project.plan.texts.map((t) => ({ ...t, text: t.text.trim() })),
      clips: project.plan.clips.map((clip) =>
        clip.type === 'video' && clip.subtitles
          ? { ...clip, subtitles: clip.subtitles.map((c) => ({ ...c, text: c.text.trim() })) }
          : clip,
      ),
    },
  };
  const parsed = projectSchema.safeParse(JSON.parse(JSON.stringify(cleaned)));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProjectError(`El montaje no es válido (${issue?.path.join('.') || 'raíz'}: ${issue?.message}).`);
  }
  return parsed.data;
}

/** Lo que se manda a `request_media_job` para montar una versión guardada (la salida la pone la base de datos). */
export function buildRenderRequest(project: ReelProject, content: { id: string; version: number }): Json {
  const ready = finalizeProject(project);
  return {
    template: { id: ready.template.id },
    plan: ready.plan as unknown as Json,
    content: { id: content.id, version: content.version },
  };
}
