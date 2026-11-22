// Quitar el fondo en el SERVIDOR (`api/cutout-mask.ts`): respaldo del navegador.
// La foto se reduce a ≤ 1600 px, va a la función con la sesión de quien edita y la
// marca de la foto, y vuelve SOLO la máscara (PNG gris); aquí se aplica a la foto
// entera. El resto (codificar y decodificar con el lienzo) se inyecta para probarlo.
import { supabase } from '../../../lib/supabase';
import type { Pixels } from '../pixels';
import { NoSubjectError } from './mask';
import { resizeAreaChannel } from './resample';

/** Dirección de la función. Vacía = el servidor no está disponible (desarrollo local, pruebas). */
export function cutoutServerUrl(): string {
  const configured = String(import.meta.env.VITE_CUTOUT_SERVER_URL ?? '').trim();
  if (configured === 'off') return '';
  if (configured) return configured;
  return import.meta.env.PROD ? '/api/cutout-mask' : '';
}

export function cutoutServerAvailable(): boolean {
  return cutoutServerUrl() !== '';
}

/** Lado mayor de la foto que se manda (la máscara se escala a la foto entera al volver). */
export const SERVER_SIDE = 1600;
/** Por debajo del tope de 4 MB de la función. */
export const SERVER_MAX_BYTES = 3_500_000;
/** Si el servidor no contesta en este tiempo, se da por fallido. */
export const SERVER_TIMEOUT_MS = 60_000;

export type ServerFailure = 'session' | 'permission' | 'limit' | 'no-subject' | 'timeout' | 'network' | 'server';

export class CutoutServerError extends Error {
  constructor(
    message: string,
    readonly failure: ServerFailure,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CutoutServerError';
  }
}

export interface ServerDeps {
  fetch?: typeof fetch;
  token?: () => Promise<string | null>;
  /** Foto (ya reducida) → JPEG. */
  encode?: (pixels: Pixels) => Promise<Blob>;
  /** PNG gris de la máscara → sus valores 0–255 y medidas. */
  decodeMask?: (png: Blob) => Promise<{ data: ArrayLike<number>; width: number; height: number }>;
}

export interface ServerOptions {
  brandId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: () => void;
  deps?: ServerDeps;
}

/** Reduce a ≤ `side` promediando el área (no cambia nada si ya cabe). */
export function shrinkPixels(image: Pixels, side = SERVER_SIDE): Pixels {
  const scale = Math.min(1, side / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);
  const channel = new Float32Array(image.width * image.height);
  for (let c = 0; c < 4; c += 1) {
    for (let i = 0; i < channel.length; i += 1) channel[i] = image.data[i * 4 + c]!;
    const plane = resizeAreaChannel(channel, image.width, image.height, width, height);
    for (let i = 0; i < plane.length; i += 1) out[i * 4 + c] = Math.round(plane[i]!);
  }
  return { data: out, width, height };
}

async function sessionToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Este navegador no deja leer ni dibujar fotos (sin lienzo 2D).');
  return { canvas, ctx };
}

/** JPEG 0,9 de unos píxeles; la transparencia se pone sobre blanco (como la ve el modelo). */
async function encodeJpeg(pixels: Pixels): Promise<Blob> {
  const { canvas, ctx } = canvasOf(pixels.width, pixels.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pixels.width, pixels.height);
  const layer = canvasOf(pixels.width, pixels.height);
  layer.ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  ctx.drawImage(layer.canvas, 0, 0);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  canvas.width = canvas.height = layer.canvas.width = layer.canvas.height = 0;
  if (!blob) throw new Error('No se ha podido preparar la foto para el servidor.');
  return blob;
}

async function decodeGrayPng(png: Blob) {
  const bitmap = await createImageBitmap(png, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const { canvas, ctx } = canvasOf(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const data = new Uint8Array(bitmap.width * bitmap.height);
    for (let i = 0; i < data.length; i += 1) data[i] = rgba[i * 4]!;
    const out = { data, width: bitmap.width, height: bitmap.height };
    canvas.width = canvas.height = 0;
    return out;
  } finally {
    bitmap.close();
  }
}

function failureOf(status: number): ServerFailure {
  if (status === 401) return 'session';
  if (status === 403) return 'permission';
  if (status === 429) return 'limit';
  if (status === 422) return 'no-subject';
  if (status === 504) return 'timeout';
  return 'server';
}

/** Pide la máscara al servidor y la aplica a la foto entera. Lanza `CutoutServerError` (o `NoSubjectError`). */
export async function removeBackgroundOnServer(image: Pixels, options: ServerOptions): Promise<Pixels> {
  const url = cutoutServerUrl();
  const deps = options.deps ?? {};
  if (!url) throw new CutoutServerError('El recorte en el servidor no está disponible aquí.', 'server');
  const token = await (deps.token ?? sessionToken)();
  if (!token)
    throw new CutoutServerError('Hace falta iniciar sesión para quitar el fondo en el servidor.', 'session', 401);

  const small = shrinkPixels(image);
  const body = await (deps.encode ?? encodeJpeg)(small);
  if (body.size > SERVER_MAX_BYTES) {
    throw new CutoutServerError('La foto pesa demasiado para mandarla al servidor.', 'server', 413);
  }

  const control = new AbortController();
  const onAbort = () => control.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => control.abort(), options.timeoutMs ?? SERVER_TIMEOUT_MS);
  try {
    options.onProgress?.();
    let response: Response;
    try {
      response = await (deps.fetch ?? fetch)(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg', 'X-Brand-Id': options.brandId },
        body,
        signal: control.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        const aborted = new Error('Recorte cancelado.');
        aborted.name = 'AbortError';
        throw aborted;
      }
      if (control.signal.aborted) throw new CutoutServerError('El servidor no ha respondido a tiempo.', 'timeout');
      throw new CutoutServerError((error as Error)?.message || 'Sin conexión con el servidor.', 'network');
    }
    if (!response.ok) {
      let message = `El servidor respondió ${response.status}.`;
      try {
        const json = (await response.json()) as { error?: string };
        if (json?.error) message = json.error;
      } catch {
        /* sin JSON */
      }
      if (response.status === 422) throw new NoSubjectError();
      throw new CutoutServerError(message, failureOf(response.status), response.status);
    }
    const mask = await (deps.decodeMask ?? decodeGrayPng)(await response.blob());
    const alpha = resizeAreaChannel(mask.data, mask.width, mask.height, image.width, image.height);
    const out = new Uint8ClampedArray(image.data);
    for (let i = 0; i < alpha.length; i += 1) {
      out[i * 4 + 3] = Math.round((out[i * 4 + 3]! * Math.min(255, Math.max(0, alpha[i]!))) / 255);
    }
    return { data: out, width: image.width, height: image.height };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
