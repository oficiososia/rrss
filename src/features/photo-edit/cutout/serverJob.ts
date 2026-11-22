// Quitar el fondo en el SERVIDOR con el trabajador de medios (Fly): trabajo `media.cutout`.
//
// La foto ya está en la biblioteca: se encarga el trabajo con la ruta de la foto
// (`request_media_job`, la base de datos fija la salida), se espera a que termine (sondeo) y se
// baja el PNG con alfa que deja en «Ediciones». De ese PNG solo se usa el canal alfa, que se
// pone sobre los píxeles que ya tiene quien llama (si la foto se cargó reducida, se reescala).
// Cancelar pide `cancel_media_job`. Sin red ni Supabase real: todo se inyecta para probarlo.
import type { Json } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { signedUrlFor } from '../api';
import type { Pixels } from '../pixels';
import { NoSubjectError } from './mask';
import { sameAspect } from './plate';
import { resizeAreaChannel } from './resample';
import { CutoutServerError } from './server';

export const CUTOUT_JOB_KIND = 'media.cutout';
/** Modelo que fija la base de datos para este trabajo (procedencia). */
export const CUTOUT_JOB_MODEL = 'ben2-base-fp16';
/** Cada cuánto se mira el trabajo. */
export const JOB_POLL_MS = 2_000;
/** Con la máquina apagada tarda en arrancar (~10 s) y el modelo ~16 s: si en 3 minutos no hay resultado, se da por perdido. */
export const JOB_TIMEOUT_MS = 180_000;

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobStatus {
  status: JobState;
  last_error: string | null;
  result: Json | null;
}

export interface AlphaImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface JobDeps {
  request(brandId: string, sourcePath: string, key: string): Promise<{ id: string }>;
  status(jobId: string): Promise<JobStatus>;
  cancel(jobId: string): Promise<void>;
  /** PNG del resultado → su canal alfa. */
  loadAlpha(outputPath: string): Promise<AlphaImage>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface JobOptions {
  brandId: string;
  /** `storage_path` de la foto en la biblioteca. */
  sourcePath: string;
  signal?: AbortSignal;
  onProgress?: (state: 'queued' | 'running') => void;
  pollMs?: number;
  timeoutMs?: number;
  deps?: JobDeps;
}

function abortError(): Error {
  const error = new Error('Recorte cancelado.');
  error.name = 'AbortError';
  return error;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Alfa de un PNG (descargado con su dirección firmada). */
async function loadAlphaFromStorage(outputPath: string): Promise<AlphaImage> {
  const url = await signedUrlFor(outputPath);
  if (!url) throw new CutoutServerError('No se ha podido abrir la foto sin fondo.', 'server');
  const response = await fetch(url);
  if (!response.ok)
    throw new CutoutServerError(`No se ha podido bajar la foto sin fondo (${response.status}).`, 'server');
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Este navegador no deja leer fotos (sin lienzo 2D).');
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const data = new Uint8Array(bitmap.width * bitmap.height);
    for (let i = 0; i < data.length; i += 1) data[i] = rgba[i * 4 + 3]!;
    canvas.width = canvas.height = 0;
    return { data, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export const defaultJobDeps: JobDeps = {
  async request(brandId, sourcePath, key) {
    const job = unwrap(
      await supabase.rpc('request_media_job', {
        p_brand_id: brandId,
        p_kind: CUTOUT_JOB_KIND,
        p_input: { source: { path: sourcePath } },
        p_idempotency_key: key,
      }),
    );
    return { id: job.id };
  },
  async status(jobId) {
    const row = unwrap(await supabase.from('jobs').select('status, last_error, result').eq('id', jobId).single());
    return row as unknown as JobStatus;
  },
  async cancel(jobId) {
    unwrap(await supabase.rpc('cancel_media_job', { p_job_id: jobId }));
  },
  loadAlpha: loadAlphaFromStorage,
  sleep: defaultSleep,
};

/** ¿Es el aviso del trabajador de que no hay sujeto? (su mensaje llega en `last_error`). */
const NO_SUBJECT = /nada que recortar/i;

/**
 * Foto → la misma foto con el fondo transparente, hecho por el trabajador. Lanza `NoSubjectError`
 * (nada que recortar), `CutoutServerError` (fallo, plazo, permisos…) o un `AbortError` si se cancela.
 */
export async function removeBackgroundByJob(image: Pixels, options: JobOptions): Promise<Pixels> {
  const deps = options.deps ?? defaultJobDeps;
  const { signal } = options;
  if (signal?.aborted) throw abortError();

  let job: { id: string };
  try {
    job = await deps.request(options.brandId, options.sourcePath, crypto.randomUUID());
  } catch (error) {
    const message = (error as Error)?.message ?? '';
    const permission = /permiso|42501/i.test(message);
    throw new CutoutServerError(
      permission
        ? 'No tienes permiso para editar las fotos de esta marca.'
        : message || 'No se ha podido encargar el recorte.',
      permission ? 'permission' : 'server',
    );
  }

  // Cancelar desde la interfaz: se avisa al servidor (si no llega, caduca solo) y se corta aquí.
  const cancelOnServer = () => deps.cancel(job.id).catch(() => undefined);
  const pollMs = options.pollMs ?? JOB_POLL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? JOB_TIMEOUT_MS);
  let last: JobStatus | undefined;
  for (;;) {
    if (signal?.aborted) {
      await cancelOnServer();
      throw abortError();
    }
    try {
      last = await deps.status(job.id);
    } catch (error) {
      // Un fallo suelto de red no tira el trabajo: se sigue mirando hasta el plazo.
      if (Date.now() >= deadline)
        throw new CutoutServerError((error as Error)?.message || 'Sin conexión con el servidor.', 'network');
    }
    if (last?.status === 'succeeded') break;
    if (last?.status === 'failed') {
      if (NO_SUBJECT.test(last.last_error ?? '')) throw new NoSubjectError();
      throw new CutoutServerError(last.last_error || 'El servidor no ha podido quitar el fondo.', 'server');
    }
    if (last?.status === 'cancelled') throw new CutoutServerError('El recorte se ha cancelado.', 'server');
    if (Date.now() >= deadline) {
      await cancelOnServer();
      throw new CutoutServerError('El servidor no ha respondido a tiempo.', 'timeout');
    }
    if (last) options.onProgress?.(last.status === 'running' ? 'running' : 'queued');
    try {
      await deps.sleep(pollMs, signal);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        await cancelOnServer();
      }
      throw error;
    }
  }

  const output = (last.result as { output?: { path?: unknown } } | null)?.output?.path;
  if (typeof output !== 'string')
    throw new CutoutServerError('El servidor no ha devuelto la foto sin fondo.', 'server');
  const mask = await deps.loadAlpha(output);
  if (!sameAspect(mask, image)) {
    throw new CutoutServerError('La foto sin fondo no tiene la misma forma que la original.', 'server');
  }
  const alpha =
    mask.width === image.width && mask.height === image.height
      ? mask.data
      : resizeAreaChannel(mask.data, mask.width, mask.height, image.width, image.height);
  const out = new Uint8ClampedArray(image.data);
  let opaque = 0;
  for (let i = 0; i < out.length / 4; i += 1) {
    const a = Math.min(255, Math.max(0, Math.round(alpha[i]!)));
    if (a > 127) opaque += 1;
    out[i * 4 + 3] = Math.round((out[i * 4 + 3]! * a) / 255);
  }
  if (opaque === 0) throw new NoSubjectError();
  return { data: out, width: image.width, height: image.height };
}
