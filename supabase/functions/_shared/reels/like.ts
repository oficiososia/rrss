// «Hacer un reel como este»: el formato de lo que sale (docs/reel-como-este.md).
//
//   * `ReelMeasurement`    lo que mide el trabajador SIN IA (`media.reel.analyze`).
//   * `BrandReelTemplate`  la PLANTILLA DE REEL REUTILIZABLE de una marca: nº de
//                          planos, duración y tipo de cada uno, transiciones,
//                          textos en pantalla (posición, momento, tamaño), ritmo
//                          y portada. Es la estructura, sin contenido: no lleva
//                          ni una imagen ni una frase del vídeo de referencia.
//   * `ReelLikeResult`     la plantilla + el guion con la lista de planos + los
//                          textos (gancho, rótulos y pie) ya con el tono de la marca.
//
// ESQUEMA MÍNIMO PROPIO (versión 1). El catálogo de plantillas de reel por marca
// lo está definiendo otra rama (f35/catalogo-plantillas): cuando exista, este
// archivo es el único sitio que hay que adaptar (`parseBrandReelTemplate` lee
// lo guardado en `brand_reel_templates.spec`). Ver «Convergencia» en la doc.
//
// Lo usan la función `ai-reel-like`, la aplicación y las pruebas: NO IMPORTA
// NADA (ni Deno, ni Node, ni zod) para que valga en los tres sitios.

export const REEL_LIKE_SCHEMA_VERSION = 1;

/** Tipo de plano. */
export const SHOT_KINDS = ['detalle', 'general', 'persona', 'texto'] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];
/** Con qué se rueda: una foto o un clip de vídeo. */
export const SHOT_MEDIA = ['foto', 'video'] as const;
export type ShotMedia = (typeof SHOT_MEDIA)[number];
export const TRANSITION_KINDS = ['cut', 'fade'] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];
/** Para qué sirve un texto en pantalla. */
export const TEXT_ROLES = ['gancho', 'dato', 'paso', 'llamada', 'otro'] as const;
export type TextRole = (typeof TEXT_ROLES)[number];
export const TEXT_POSITIONS = ['top', 'center', 'bottom'] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];
export const TEXT_SIZES = ['grande', 'normal', 'pequeno'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const PACES = ['lento', 'medio', 'rapido'] as const;
export type Pace = (typeof PACES)[number];
export const AUDIO_KINDS = ['musica', 'voz', 'voz-y-musica', 'silencio'] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

export const SHOT_KIND_LABEL: Record<ShotKind, string> = {
  detalle: 'Detalle',
  general: 'General',
  persona: 'Persona',
  texto: 'Texto',
};
export const TEXT_ROLE_LABEL: Record<TextRole, string> = {
  gancho: 'Gancho',
  dato: 'Dato',
  paso: 'Paso',
  llamada: 'Llamada a la acción',
  otro: 'Texto',
};
export const PACE_LABEL: Record<Pace, string> = { lento: 'Lento', medio: 'Medio', rapido: 'Rápido' };
export const AUDIO_KIND_LABEL: Record<AudioKind, string> = {
  musica: 'Música',
  voz: 'Voz',
  'voz-y-musica': 'Voz y música',
  silencio: 'Sin sonido',
};

export const LIKE_LIMITS = {
  maxShots: 30,
  maxTexts: 12,
  maxFrames: 12,
  maxSearchTerms: 6,
  maxHashtags: 12,
  /** Lo mismo que admite un texto del editor de reels. */
  maxTextChars: 200,
} as const;

/**
 * Topes del vídeo de referencia. Los del análisis son los del trabajador
 * (worker/src/handlers/reel-analyze.ts, `REEL_ANALYZE_LIMITS`); una prueba
 * comprueba que coinciden.
 */
export const REFERENCE_LIMITS = {
  /** Duración máxima del vídeo. */
  maxSeconds: 180,
  /** Peso máximo del archivo (el del almacenamiento). */
  maxUploadBytes: 50 * 1024 * 1024,
  /** Sonido que se transcribe como mucho. */
  maxSpeechSeconds: 120,
  /** Tipos de archivo admitidos al subir. */
  mimeTypes: { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' } as Record<string, string>,
} as const;

// ───────────────────────────── Medición (sin IA) ─────────────────────────────

export interface MeasuredShot {
  index: number;
  start: number;
  end: number;
  seconds: number;
  /** Cambio medio de la imagen dentro del plano. */
  motion: number;
  /** ¿Parece una imagen fija? */
  still: boolean;
  transitionIn?: { type: TransitionKind; seconds: number };
}

export interface MeasuredFrame {
  path: string;
  at: number;
  shot: number;
}

export interface MeasuredSpeech {
  path: string;
  start: number;
  seconds: number;
}

export interface ReelMeasurement {
  source: {
    kind: 'upload' | 'link';
    host?: string;
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
  };
  shots: MeasuredShot[];
  frames: MeasuredFrame[];
  audio: {
    present: boolean;
    silent: boolean;
    bpm: number | null;
    confidence: number;
    cutsOnBeat: number;
    beatsPerCut: number | null;
    speech: MeasuredSpeech[];
  };
  warnings: string[];
}

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, max: number): string =>
  typeof value === 'string' ? [...value.replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '';
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
const round = (value: number, decimals = 3) => Number(value.toFixed(decimals));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Lee la medición del trabajador (`jobs.result` → `reel_references.measurement`). Null si no lo es. */
export function parseMeasurement(value: unknown): ReelMeasurement | null {
  if (!isDict(value) || !isDict(value.source) || !Array.isArray(value.shots) || value.shots.length === 0) return null;
  const source = value.source;
  const duration = num(source.durationSeconds);
  if (duration <= 0) return null;
  const shots: MeasuredShot[] = [];
  for (const [index, raw] of value.shots.slice(0, LIKE_LIMITS.maxShots).entries()) {
    if (!isDict(raw)) return null;
    const seconds = num(raw.seconds);
    if (seconds <= 0) return null;
    const transition = isDict(raw.transitionIn)
      ? {
          type: oneOf(raw.transitionIn.type, TRANSITION_KINDS, 'cut'),
          seconds: clamp(num(raw.transitionIn.seconds), 0, 2),
        }
      : undefined;
    shots.push({
      index,
      start: num(raw.start),
      end: num(raw.end, num(raw.start) + seconds),
      seconds,
      motion: num(raw.motion),
      still: raw.still === true,
      ...(transition && index > 0 ? { transitionIn: transition } : {}),
    });
  }
  const frames: MeasuredFrame[] = (Array.isArray(value.frames) ? value.frames : [])
    .filter(isDict)
    .filter((f) => typeof f.path === 'string' && f.path !== '')
    .slice(0, LIKE_LIMITS.maxFrames)
    .map((f) => ({ path: f.path as string, at: num(f.at), shot: clamp(Math.round(num(f.shot)), 0, shots.length - 1) }));
  const audio = isDict(value.audio) ? value.audio : {};
  const speech: MeasuredSpeech[] = (Array.isArray(audio.speech) ? audio.speech : [])
    .filter(isDict)
    .filter((s) => typeof s.path === 'string' && s.path !== '' && num(s.seconds) > 0)
    .slice(0, 12)
    .map((s) => ({ path: s.path as string, start: num(s.start), seconds: num(s.seconds) }));
  return {
    source: {
      kind: source.kind === 'link' ? 'link' : 'upload',
      ...(typeof source.host === 'string' && source.host ? { host: source.host.slice(0, 255) } : {}),
      durationSeconds: duration,
      width: num(source.width),
      height: num(source.height),
      fps: num(source.fps),
      hasAudio: source.hasAudio === true,
    },
    shots,
    frames,
    audio: {
      present: audio.present === true,
      silent: audio.present !== true || audio.silent === true,
      bpm: typeof audio.bpm === 'number' && audio.bpm > 0 ? audio.bpm : null,
      confidence: num(audio.confidence),
      cutsOnBeat: clamp(num(audio.cutsOnBeat), 0, 1),
      beatsPerCut: typeof audio.beatsPerCut === 'number' && audio.beatsPerCut > 0 ? audio.beatsPerCut : null,
      speech,
    },
    warnings: (Array.isArray(value.warnings) ? value.warnings : [])
      .filter((w): w is string => typeof w === 'string')
      .slice(0, 10),
  };
}

/** Ritmo que sale de las cuentas, sin IA: cortes por minuto. */
export function paceOf(shots: Array<{ seconds: number }>): Pace {
  const total = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  if (shots.length <= 1 || total <= 0) return 'lento';
  const average = total / shots.length;
  return average < 1.5 ? 'rapido' : average < 3.5 ? 'medio' : 'lento';
}

// ───────────────────────────── Plantilla de reel de marca ─────────────────────────────

export interface TemplateShot {
  /** `s1`, `s2`… en el orden del reel. */
  id: string;
  seconds: number;
  kind: ShotKind;
  media: ShotMedia;
  /** Qué clase de imagen es, en genérico («plano cerrado del producto»). Nada del vídeo de referencia. */
  description: string;
  /** Cómo se entra desde el plano anterior (el primero, por corte). */
  transition: { type: TransitionKind; seconds: number };
}

export interface TemplateText {
  /** `t1`, `t2`… */
  id: string;
  role: TextRole;
  position: TextPosition;
  size: TextSize;
  /** Primer y último plano (por `id`) durante los que se ve. */
  fromShot: string;
  toShot: string;
  /** Segundos del reel (salen de los planos). */
  start: number;
  end: number;
  /** Largo orientativo del texto. */
  maxChars: number;
}

export interface BrandReelTemplate {
  schemaVersion: typeof REEL_LIKE_SCHEMA_VERSION;
  name: string;
  /** Por qué funciona la estructura, en una o dos frases. */
  summary: string;
  totalSeconds: number;
  pace: Pace;
  audio: { kind: AudioKind; bpm?: number; cutsOnBeat?: number; beatsPerCut?: number };
  shots: TemplateShot[];
  texts: TemplateText[];
  /** Portada: en qué segundo del reel y qué se ve. */
  cover: { at: number; note: string };
}

/** Segundo del reel en que empieza cada plano y el total (sin solapes: la transición no acorta la plantilla). */
export function templateTimeline(shots: Array<{ seconds: number }>): { starts: number[]; total: number } {
  const starts: number[] = [];
  let cursor = 0;
  for (const shot of shots) {
    starts.push(round(cursor));
    cursor += shot.seconds;
  }
  return { starts, total: round(cursor) };
}

function parseShots(value: unknown): TemplateShot[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIKE_LIMITS.maxShots) return null;
  const shots: TemplateShot[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isDict(raw)) return null;
    const seconds = num(raw.seconds);
    if (seconds <= 0 || seconds > 180) return null;
    const transition = isDict(raw.transition) ? raw.transition : {};
    shots.push({
      id: `s${index + 1}`,
      seconds: round(seconds),
      kind: oneOf(raw.kind, SHOT_KINDS, 'general'),
      media: oneOf(raw.media, SHOT_MEDIA, 'video'),
      description: str(raw.description, 200),
      transition:
        index === 0
          ? { type: 'cut', seconds: 0 }
          : {
              type: oneOf(transition.type, TRANSITION_KINDS, 'cut'),
              seconds: transition.type === 'fade' ? round(clamp(num(transition.seconds, 0.4), 0.1, 2)) : 0,
            },
    });
  }
  return shots;
}

/**
 * Lee (y deja en su forma canónica) una plantilla de reel de marca. Null si no
 * lo es. Los tiempos de los textos se recalculan desde los planos: lo guardado
 * no puede quedar incoherente.
 */
export function parseBrandReelTemplate(value: unknown): BrandReelTemplate | null {
  if (!isDict(value) || value.schemaVersion !== REEL_LIKE_SCHEMA_VERSION) return null;
  const shots = parseShots(value.shots);
  if (!shots) return null;
  const { starts, total } = templateTimeline(shots);
  const indexOf = (id: unknown, fallback: number) => {
    const found = shots.findIndex((shot) => shot.id === id);
    return found < 0 ? fallback : found;
  };
  const texts: TemplateText[] = [];
  for (const raw of (Array.isArray(value.texts) ? value.texts : []).slice(0, LIKE_LIMITS.maxTexts)) {
    if (!isDict(raw)) return null;
    const from = indexOf(raw.fromShot, 0);
    const to = Math.max(from, indexOf(raw.toShot, from));
    texts.push({
      id: `t${texts.length + 1}`,
      role: oneOf(raw.role, TEXT_ROLES, 'otro'),
      position: oneOf(raw.position, TEXT_POSITIONS, 'bottom'),
      size: oneOf(raw.size, TEXT_SIZES, 'normal'),
      fromShot: shots[from]!.id,
      toShot: shots[to]!.id,
      start: starts[from]!,
      end: round(starts[to]! + shots[to]!.seconds),
      maxChars: Math.round(clamp(num(raw.maxChars, 60), 10, LIKE_LIMITS.maxTextChars)),
    });
  }
  const audio = isDict(value.audio) ? value.audio : {};
  const cover = isDict(value.cover) ? value.cover : {};
  const name = str(value.name, 120);
  if (!name) return null;
  return {
    schemaVersion: REEL_LIKE_SCHEMA_VERSION,
    name,
    summary: str(value.summary, 400),
    totalSeconds: total,
    pace: oneOf(value.pace, PACES, paceOf(shots)),
    audio: {
      kind: oneOf(audio.kind, AUDIO_KINDS, 'musica'),
      ...(typeof audio.bpm === 'number' && audio.bpm > 0 ? { bpm: round(audio.bpm, 1) } : {}),
      ...(typeof audio.cutsOnBeat === 'number' ? { cutsOnBeat: round(clamp(audio.cutsOnBeat, 0, 1), 2) } : {}),
      ...(typeof audio.beatsPerCut === 'number' && audio.beatsPerCut > 0
        ? { beatsPerCut: Math.round(audio.beatsPerCut) }
        : {}),
    },
    shots,
    texts,
    cover: { at: round(clamp(num(cover.at), 0, total)), note: str(cover.note, 200) },
  };
}

// ───────────────────────────── Resultado completo ─────────────────────────────

export interface ScriptShot {
  /** Plano de la plantilla (`s1`…). */
  shot: string;
  /** Qué grabar (o qué foto usar) para la marca. */
  what: string;
  /** Consejo para grabarlo. */
  tip: string;
  /** Palabras con las que buscar en la biblioteca de la marca (etiquetas, carpetas, nombres). */
  search: string[];
}

export interface ReelLikeResult {
  schemaVersion: typeof REEL_LIKE_SCHEMA_VERSION;
  template: BrandReelTemplate;
  /** Guion y lista de planos, en el orden del reel. */
  script: { title: string; idea: string; shots: ScriptShot[] };
  /** Textos con el tono de la marca. `onScreen[i].text` es el `id` del texto de la plantilla. */
  texts: { hook: string; onScreen: Array<{ text: string; value: string }>; caption: string; hashtags: string[] };
  /** ¿Se transcribió lo que se dice en la referencia para entender el guion? */
  transcriptUsed: boolean;
  /** Avisos para la persona (lo que no se pudo mirar, lo que se estimó). */
  notes: string[];
}

/** Lo que devuelve el modelo (ya validado contra su esquema JSON en la tarea). */
export interface ReelLikeAiOutput {
  name: string;
  summary: string;
  pace: string;
  audioKind: string;
  title: string;
  idea: string;
  shots: Array<{
    index: number;
    kind: string;
    media: string;
    description: string;
    what: string;
    tip: string;
    search: string[];
  }>;
  texts: Array<{ role: string; position: string; size: string; fromShot: number; toShot: number; value: string }>;
  hook: string;
  caption: string;
  hashtags: string[];
  coverShot: number;
  coverNote: string;
}

function normalizeHashtag(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const tag = raw.trim().replace(/\s+/g, '').replace(/^#+/, '');
  return tag ? `#${[...tag].slice(0, 60).join('')}` : '';
}

const searchTerms = (value: unknown): string[] => [
  ...new Set(
    (Array.isArray(value) ? value : [])
      .map((term) => str(term, 40).toLowerCase())
      .filter(Boolean),
  ),
].slice(0, LIKE_LIMITS.maxSearchTerms);

/**
 * Junta la medición (lo que es un hecho: cuántos planos, cuánto dura cada uno,
 * cómo se pasa de uno a otro, el compás) con lo que ha visto y escrito el
 * modelo (qué tipo de plano es, qué rótulos lleva y qué grabar para la marca).
 * Lo medido nunca lo cambia el modelo. Los planos se numeran desde 1.
 */
export function buildReelLikeResult(
  measurement: ReelMeasurement,
  ai: ReelLikeAiOutput,
  options: { transcriptUsed: boolean; notes?: string[] } = { transcriptUsed: false },
): ReelLikeResult {
  const byIndex = new Map(ai.shots.map((shot) => [Math.round(shot.index), shot]));
  const seenFrames = new Set(measurement.frames.map((frame) => frame.shot));
  const shots: TemplateShot[] = measurement.shots.map((shot, index) => {
    const seen = byIndex.get(index + 1);
    return {
      id: `s${index + 1}`,
      seconds: round(shot.seconds),
      kind: oneOf(seen?.kind, SHOT_KINDS, 'general'),
      // Una imagen fija es un hecho medido; si se mueve, vale lo que diga el modelo.
      media: shot.still ? 'foto' : oneOf(seen?.media, SHOT_MEDIA, 'video'),
      description: str(seen?.description, 200),
      transition:
        index === 0 || !shot.transitionIn || shot.transitionIn.type === 'cut'
          ? { type: 'cut', seconds: 0 }
          : { type: 'fade', seconds: round(clamp(shot.transitionIn.seconds || 0.4, 0.1, 2)) },
    };
  });
  const { starts, total } = templateTimeline(shots);

  const texts: TemplateText[] = [];
  const onScreen: Array<{ text: string; value: string }> = [];
  for (const raw of ai.texts.slice(0, LIKE_LIMITS.maxTexts)) {
    const value = str(raw.value, LIKE_LIMITS.maxTextChars);
    if (!value) continue;
    const from = clamp(Math.round(num(raw.fromShot, 1)), 1, shots.length) - 1;
    const to = clamp(Math.round(num(raw.toShot, from + 1)), from + 1, shots.length) - 1;
    const id = `t${texts.length + 1}`;
    texts.push({
      id,
      role: oneOf(raw.role, TEXT_ROLES, 'otro'),
      position: oneOf(raw.position, TEXT_POSITIONS, 'bottom'),
      size: oneOf(raw.size, TEXT_SIZES, 'normal'),
      fromShot: shots[from]!.id,
      toShot: shots[to]!.id,
      start: starts[from]!,
      end: round(starts[to]! + shots[to]!.seconds),
      maxChars: Math.round(clamp(Math.ceil([...value].length / 10) * 10, 20, LIKE_LIMITS.maxTextChars)),
    });
    onScreen.push({ text: id, value });
  }

  const coverIndex = clamp(Math.round(num(ai.coverShot, 1)), 1, shots.length) - 1;
  const audio = measurement.audio;
  const template: BrandReelTemplate = {
    schemaVersion: REEL_LIKE_SCHEMA_VERSION,
    name: str(ai.name, 120) || 'Plantilla de reel',
    summary: str(ai.summary, 400),
    totalSeconds: total,
    // Con un compás claro o pocos planos, el ritmo sale de las cuentas; el del modelo solo desempata.
    pace: shots.length > 1 ? paceOf(shots) : oneOf(ai.pace, PACES, 'lento'),
    audio: {
      kind: audio.silent ? 'silencio' : oneOf(ai.audioKind, AUDIO_KINDS, 'musica'),
      ...(audio.bpm ? { bpm: round(audio.bpm, 1) } : {}),
      ...(audio.bpm ? { cutsOnBeat: round(audio.cutsOnBeat, 2) } : {}),
      ...(audio.bpm && audio.beatsPerCut ? { beatsPerCut: Math.round(audio.beatsPerCut) } : {}),
    },
    shots,
    texts,
    cover: {
      at: round(starts[coverIndex]! + shots[coverIndex]!.seconds * 0.6),
      note: str(ai.coverNote, 200),
    },
  };

  const notes = [...(options.notes ?? []), ...measurement.warnings];
  const unseen = shots.length - seenFrames.size;
  if (unseen > 0) {
    notes.push(
      `Solo se han mirado ${seenFrames.size} de los ${shots.length} planos: el tipo de los demás es una suposición.`,
    );
  }

  return {
    schemaVersion: REEL_LIKE_SCHEMA_VERSION,
    template,
    script: {
      title: str(ai.title, 120) || template.name,
      idea: str(ai.idea, 400),
      shots: shots.map((shot, index) => {
        const seen = byIndex.get(index + 1);
        return {
          shot: shot.id,
          what: str(seen?.what, 240) || `Plano ${index + 1} (${SHOT_KIND_LABEL[shot.kind].toLowerCase()})`,
          tip: str(seen?.tip, 240),
          search: searchTerms(seen?.search),
        };
      }),
    },
    texts: {
      hook: str(ai.hook, 200),
      onScreen,
      caption: typeof ai.caption === 'string' ? [...ai.caption.trim()].slice(0, 2200).join('') : '',
      hashtags: [...new Set((Array.isArray(ai.hashtags) ? ai.hashtags : []).map(normalizeHashtag).filter(Boolean))].slice(
        0,
        LIKE_LIMITS.maxHashtags,
      ),
    },
    transcriptUsed: options.transcriptUsed,
    notes: notes.slice(0, 12),
  };
}

/** Lee un resultado guardado (`reel_references.result`). Null si no tiene la forma esperada. */
export function parseReelLikeResult(value: unknown): ReelLikeResult | null {
  if (!isDict(value) || value.schemaVersion !== REEL_LIKE_SCHEMA_VERSION) return null;
  const template = parseBrandReelTemplate(value.template);
  if (!template) return null;
  const script = isDict(value.script) ? value.script : {};
  const texts = isDict(value.texts) ? value.texts : {};
  const rawShots = Array.isArray(script.shots) ? script.shots.filter(isDict) : [];
  const textIds = new Set(template.texts.map((text) => text.id));
  return {
    schemaVersion: REEL_LIKE_SCHEMA_VERSION,
    template,
    script: {
      title: str(script.title, 120) || template.name,
      idea: str(script.idea, 400),
      shots: template.shots.map((shot, index) => {
        const raw = rawShots.find((entry) => entry.shot === shot.id) ?? {};
        return {
          shot: shot.id,
          what: str(raw.what, 240) || `Plano ${index + 1}`,
          tip: str(raw.tip, 240),
          search: searchTerms(raw.search),
        };
      }),
    },
    texts: {
      hook: str(texts.hook, 200),
      onScreen: (Array.isArray(texts.onScreen) ? texts.onScreen : [])
        .filter(isDict)
        .filter((entry) => typeof entry.text === 'string' && textIds.has(entry.text))
        .map((entry) => ({ text: entry.text as string, value: str(entry.value, LIKE_LIMITS.maxTextChars) }))
        .filter((entry) => entry.value !== ''),
      caption: typeof texts.caption === 'string' ? [...texts.caption].slice(0, 2200).join('') : '',
      hashtags: (Array.isArray(texts.hashtags) ? texts.hashtags : []).map(normalizeHashtag).filter(Boolean),
    },
    transcriptUsed: value.transcriptUsed === true,
    notes: (Array.isArray(value.notes) ? value.notes : []).filter((n): n is string => typeof n === 'string').slice(0, 12),
  };
}
