import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@/config/app';
import type { AssetKind, SourceKind } from './database.types';
import { formatBytes } from './utils';

/** Nombre apto para una ruta de almacenamiento: ASCII, sin espacios ni separadores. */
export function sanitizeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const rawBase = dot > 0 ? name.slice(0, dot) : name;
  const rawExt = dot > 0 ? name.slice(dot + 1) : '';
  const clean = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  const base = clean(rawBase).slice(0, 80) || 'archivo';
  const ext = clean(rawExt).slice(0, 10);
  return ext ? `${base}.${ext}` : base;
}

export type StorageFolder = 'media' | 'sources';

export function buildStoragePath(
  organizationId: string,
  brandId: string,
  folder: StorageFolder,
  fileName: string,
  id: string = crypto.randomUUID(),
): string {
  return `${organizationId}/${brandId}/${folder}/${id}-${sanitizeFileName(fileName)}`;
}

/** Devuelve el motivo por el que el archivo no se puede subir, o null si vale. */
export function validateFile(file: { size: number; type: string; name: string }, allowed: readonly string[] = ALLOWED_MIME_TYPES): string | null {
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (file.size > MAX_FILE_BYTES)
    return `«${file.name}» pesa ${formatBytes(file.size)} y el máximo es ${formatBytes(MAX_FILE_BYTES)}.`;
  if (!allowed.includes(file.type)) return `«${file.name}» es de un tipo que no se admite (${file.type || 'desconocido'}).`;
  return null;
}

export function assetKindFromMime(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

export function sourceKindFromMime(mime: string): SourceKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/json') return 'json';
  if (mime === 'text/plain') return 'text';
  if (mime.startsWith('image/')) return 'image';
  return 'document';
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface MediaDimensions {
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

const NO_DIMENSIONS: MediaDimensions = { width: null, height: null, durationMs: null };

/** Medidas de una imagen o un vídeo; si el navegador no sabe leerlo, todo null. */
export function readMediaDimensions(file: File): Promise<MediaDimensions> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (value: MediaDimensions) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => done(NO_DIMENSIONS), 8000);
    const finish = (value: MediaDimensions) => {
      window.clearTimeout(timer);
      done(value);
    };
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => finish({ width: img.naturalWidth || null, height: img.naturalHeight || null, durationMs: null });
      img.onerror = () => finish(NO_DIMENSIONS);
      img.src = url;
    } else if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () =>
        finish({
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null,
        });
      video.onerror = () => finish(NO_DIMENSIONS);
      video.src = url;
    } else {
      finish(NO_DIMENSIONS);
    }
  });
}
