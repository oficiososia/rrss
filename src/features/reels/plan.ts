// Lógica pura de la pantalla de reels: duración estimada, comprobaciones antes
// de encargar, la petición a `request_media_job` y cómo se cuenta el estado de
// un trabajo. Sin red ni React, para probarla aparte.
import type { Json, JobRow, JobStatus } from '@/lib/database.types';
import { cleanMessage } from '@/lib/errors';
import type { ReelTemplateSummary } from './templates';

export type TextPosition = 'top' | 'center' | 'bottom';

export interface ReelPiece {
  /** Clave local de la fila (una misma foto puede salir dos veces). */
  key: string;
  assetId: string;
  path: string;
  fileName: string;
  type: 'photo' | 'video';
  /** Segundos en pantalla. Vacío = los de la plantilla. */
  seconds: number | null;
  /** Desenfoque de la foto, de 0 (nítida) a 100. Vacío o 0 = sin desenfoque. Solo fotos. */
  blur?: number;
  /** Duración del clip en la biblioteca, si se conoce. */
  clipSeconds: number | null;
}

export interface ReelText {
  key: string;
  text: string;
  start: number;
  end: number;
  position: TextPosition | null;
}

export const MAX_PIECES = 20;
export const MAX_TEXTS = 20;
export const MAX_TEXT_LENGTH = 200;
/** Lo mínimo que el trabajador toma de un clip (worker/src/reel/build.ts). */
const MIN_SEGMENT_SECONDS = 0.5;

/**
 * Duración del reel tal como la calcula el motor (worker/src/reel/build.ts):
 * cada foto, sus segundos ajustados a fotogramas; cada clip, lo pedido sin
 * pasar de lo que dura; y cada transición (salvo el corte seco) solapa dos
 * piezas. Es una estimación: el trabajador la vuelve a calcular y rechaza un
 * plan que pase del máximo.
 */
export function estimateDuration(template: ReelTemplateSummary, pieces: ReelPiece[]) {
  const fps = template.canvas.fps;
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps));
  const durations = pieces.map((piece) => {
    if (piece.type === 'photo') return frames(piece.seconds ?? template.timing.photoSeconds) / fps;
    const wanted = piece.seconds ?? template.timing.maxClipSeconds;
    const available = piece.clipSeconds ?? wanted;
    return Math.floor(Math.max(0, Math.min(wanted, available)) * fps) / fps;
  });
  if (durations.length === 0) return { total: 0, durations, transition: 0 };
  const shortest = Math.min(...durations);
  const transition =
    template.transition.type === 'cut' || durations.length === 1
      ? 0
      : Math.floor(Math.min(template.transition.seconds, shortest / 2) * fps) / fps;
  const total = durations.reduce((sum, seconds) => sum + seconds, 0) - transition * (durations.length - 1);
  return { total: Number(total.toFixed(3)), durations, transition };
}

/** Problemas que impiden encargar el reel, en español y en el orden en que se ven en pantalla. */
export function reelProblems(template: ReelTemplateSummary | undefined, pieces: ReelPiece[], texts: ReelText[]) {
  const problems: string[] = [];
  if (!template) problems.push('Elige una plantilla.');
  if (pieces.length === 0) problems.push('Añade al menos una foto o un clip.');
  if (pieces.length > MAX_PIECES) problems.push(`Como mucho ${MAX_PIECES} fotos o clips.`);
  for (const [index, piece] of pieces.entries()) {
    if (piece.type === 'video' && piece.clipSeconds !== null && piece.clipSeconds < MIN_SEGMENT_SECONDS) {
      problems.push(`El clip ${index + 1} es demasiado corto.`);
    }
  }
  if (template && pieces.length > 0) {
    const { total } = estimateDuration(template, pieces);
    if (total > template.timing.maxTotalSeconds + 1e-6) {
      problems.push(
        `El reel duraría ${formatSeconds(total)} y la plantilla admite ${formatSeconds(template.timing.maxTotalSeconds)} como máximo.`,
      );
    }
  }
  if (texts.length > MAX_TEXTS) problems.push(`Como mucho ${MAX_TEXTS} textos.`);
  for (const [index, text] of texts.entries()) {
    if (!text.text.trim()) problems.push(`El texto ${index + 1} está vacío.`);
    else if (text.text.length > MAX_TEXT_LENGTH)
      problems.push(`El texto ${index + 1} pasa de ${MAX_TEXT_LENGTH} caracteres.`);
    if (!(text.end > text.start) || text.start < 0) {
      problems.push(`El texto ${index + 1} debe terminar después de empezar.`);
    }
  }
  return problems;
}

/** Lo que se envía a `request_media_job` para un reel (la salida la pone la base de datos). */
export function buildReelInput(
  template: ReelTemplateSummary,
  pieces: ReelPiece[],
  texts: ReelText[],
  musicPath: string | null,
): Json {
  return {
    template: { id: template.id },
    plan: {
      media: pieces.map((piece) => ({
        type: piece.type,
        path: piece.path,
        ...(piece.seconds !== null ? { seconds: piece.seconds } : {}),
        ...(piece.type === 'photo' && piece.blur && piece.blur > 0
          ? { blur: Math.min(100, Math.round(piece.blur)) }
          : {}),
      })),
      texts: texts.map((text) => ({
        text: text.text.trim(),
        start: text.start,
        end: text.end,
        ...(text.position ? { position: text.position } : {}),
      })),
      ...(musicPath ? { music: { path: musicPath } } : {}),
    },
  };
}

export function formatSeconds(seconds: number): string {
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(seconds)} s`;
}

// ───────────────────────────── Estado de un trabajo ─────────────────────────────

export type JobTone = 'neutral' | 'progress' | 'success' | 'danger';

export interface JobView {
  label: string;
  tone: JobTone;
  /** Motivo del fallo (o del último intento fallido, si se está reintentando). */
  detail: string | null;
  /** Recurso creado en la biblioteca, cuando ha terminado. */
  assetId: string | null;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'En cola',
  running: 'Montando',
  succeeded: 'Listo',
  failed: 'Falló',
  cancelled: 'Cancelado',
};

export type MediaJobSummary = Pick<
  JobRow,
  'id' | 'kind' | 'status' | 'attempts' | 'max_attempts' | 'last_error' | 'result' | 'payload' | 'created_at'
>;

/** Un montaje que sigue en cola pasado este tiempo: el servicio de montaje está parado o arrancando. */
export const QUEUE_STALLED_MS = 10 * 60_000;

const REEL_JOB = 'media.reel.template';

/**
 * Los fallos que escribe el trabajador (o la cola) traducidos a una frase con qué hacer, sin rutas
 * ni nombres internos. `retrying`: el trabajo ya ha vuelto a la cola solo (no hay que pulsar nada).
 * Lo que no se reconoce sale como antes (`cleanMessage`: sin rutas ni identificadores).
 */
export function jobFailureMessage(message: string, kind: string, retrying = false): string {
  const text = message.trim();
  const reel = kind === REEL_JOB;
  // La máquina del trabajador se apagó o se cortó a medias (en Fly, por ejemplo, al pasar su tiempo).
  if (/^El trabajador dejó de responder/i.test(text) || /^El trabajo superó el tiempo/i.test(text)) {
    if (retrying) return 'El intento anterior se cortó a medias; se vuelve a probar solo.';
    return reel
      ? 'El servicio de montaje se cortó a medias y no ha podido terminar. El reel está guardado: pulsa «Probar otra vez» para montarlo de nuevo, sin rehacer nada. Si vuelve a pasar, avisa al equipo.'
      : 'El servicio se cortó a medias y no ha podido terminar. Vuelve a intentarlo; si vuelve a pasar, avisa al equipo.';
  }
  // El trabajador desplegado es más antiguo que la aplicación: no conoce alguna opción del plan.
  if (/^Carga del trabajo inválida:.*Unrecognized key/i.test(text)) {
    return reel
      ? 'El servicio de montaje todavía no conoce alguna opción de este reel (está pendiente de actualizar). El reel está guardado: avisa al equipo y, cuando esté al día, pulsa «Probar otra vez».'
      : 'El servicio todavía no conoce alguna opción de este trabajo (está pendiente de actualizar). Avisa al equipo.';
  }
  if (/^Carga del trabajo inválida/i.test(text)) {
    return reel
      ? 'El servicio de montaje no ha aceptado algún ajuste de este reel. Revisa en el editor los textos, las duraciones y la portada, y vuelve a montarlo; si sigue igual, avisa al equipo.'
      : 'El servicio no ha aceptado los datos de este trabajo. Vuelve a intentarlo; si sigue igual, avisa al equipo.';
  }
  if (/no está instalada en el trabajador|el trabajador no tiene ninguna tipografía/i.test(text)) {
    return 'La tipografía de los textos no está disponible para montar el vídeo. Elige otra en «Estilo» o avisa al equipo.';
  }
  if (/^El archivo no es un medio legible|^La pieza \d+ no (tiene imagen|es un vídeo)/i.test(text)) {
    return 'Alguna foto o vídeo del reel no se puede leer (archivo dañado o de un tipo no admitido). Sustitúyelo en el editor y vuelve a montarlo.';
  }
  if (/^No existe (el archivo|el recurso)/i.test(text)) {
    return 'Algún archivo del reel ya no está guardado. Sustitúyelo en el editor y vuelve a montarlo.';
  }
  if (/^«[^»]*» terminó con código|^No se pudo ejecutar «/i.test(text)) {
    return retrying
      ? 'El intento anterior falló al procesar el vídeo; se vuelve a probar solo.'
      : 'No se ha podido procesar el vídeo con este material. Pulsa «Probar otra vez»; si vuelve a fallar, sustituye el último clip o foto que añadiste y avisa al equipo.';
  }
  if (/^La cola respondió|^No se pudo bajar|^Google Drive no firmó/i.test(text)) {
    return retrying
      ? 'El servicio no pudo leer el material en el intento anterior; se vuelve a probar solo.'
      : 'El servicio de montaje no pudo leer el material en ese momento. Pulsa «Probar otra vez» dentro de un rato.';
  }
  return cleanMessage(text);
}

/**
 * Cómo va un trabajo. Con `now` (milisegundos), un trabajo que lleva en cola más de
 * `QUEUE_STALLED_MS` sin empezar lo dice: el servicio está parado o arrancando.
 */
export function describeJob(job: MediaJobSummary, now?: number): JobView {
  const assets = (job.result as { assets?: Array<{ id?: unknown }> } | null)?.assets;
  const assetId = Array.isArray(assets) && typeof assets[0]?.id === 'string' ? assets[0].id : null;
  if (job.status === 'queued' && job.attempts > 0) {
    return {
      label: 'En cola (reintento)',
      tone: 'progress',
      detail: job.last_error ? jobFailureMessage(job.last_error, job.kind, true) : null,
      assetId: null,
    };
  }
  if (job.status === 'queued' && now !== undefined && now - Date.parse(job.created_at) > QUEUE_STALLED_MS) {
    return {
      label: 'En cola, esperando al servicio de montaje',
      tone: 'progress',
      detail:
        'El servicio de montaje está tardando en empezar (puede estar parado o arrancando). El reel está guardado y entrará solo en cuanto vuelva; si en un rato sigue igual, avisa al equipo.',
      assetId: null,
    };
  }
  const tone: JobTone =
    job.status === 'succeeded'
      ? 'success'
      : job.status === 'failed'
        ? 'danger'
        : job.status === 'cancelled'
          ? 'neutral'
          : 'progress';
  return {
    label: STATUS_LABEL[job.status],
    tone,
    // Sin rutas ni identificadores: el motivo se traduce si es uno conocido (un archivo borrado…).
    detail:
      job.status === 'failed'
        ? job.last_error
          ? jobFailureMessage(job.last_error, job.kind)
          : 'Sin motivo registrado'
        : null,
    assetId: job.status === 'succeeded' ? assetId : null,
  };
}

export const isActive = (job: Pick<JobRow, 'status'>) => job.status === 'queued' || job.status === 'running';

/** Nombre de la plantilla de un trabajo de reel (o su id si ya no existe). */
export function jobTemplateName(job: MediaJobSummary, templates: ReelTemplateSummary[]): string {
  const id = (job.payload as { template?: { id?: unknown } } | null)?.template?.id;
  if (typeof id !== 'string') return 'Reel';
  return templates.find((t) => t.id === id)?.name ?? id;
}

/** Número de piezas de un trabajo de reel. */
export function jobPieceCount(job: MediaJobSummary): number {
  const media = (job.payload as { plan?: { media?: unknown } } | null)?.plan?.media;
  return Array.isArray(media) ? media.length : 0;
}
