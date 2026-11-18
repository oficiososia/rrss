// Único sitio donde vive el nombre del producto y los límites compartidos.
export const APP_NAME = 'RRSS';

/**
 * ¿Hay IA de texto conectada en este entorno? La función `ai-generate` solo
 * funciona con un proveedor configurado en el servidor; mientras no lo haya, los
 * botones de redactar, comprobar el tono y proponer el perfil no se enseñan
 * (lo que no funciona no sale en la interfaz). Se activa con
 * `VITE_AI_TEXT_ENABLED=true` en el despliegue que tenga proveedor.
 */
export function aiTextEnabled(): boolean {
  return import.meta.env.VITE_AI_TEXT_ENABLED === 'true';
}

/**
 * ¿Hay generación de imágenes con IA en este entorno? Igual que el texto: la
 * función `ai-media` solo genera con un modelo de imagen configurado en el
 * servidor; sin él, el botón «Con IA» del editor no se enseña. Se activa con
 * `VITE_AI_IMAGE_ENABLED=true` en el despliegue que lo tenga.
 */
export function aiImageEnabled(): boolean {
  return import.meta.env.VITE_AI_IMAGE_ENABLED === 'true';
}

export const STORAGE_BUCKET = 'brand-media';
/** Tope del cubo (ver supabase/migrations/…_storage_brand_media.sql). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'application/pdf',
  'application/json',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export const SOURCE_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const LOCALES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'ca', label: 'Catalán' },
  { value: 'gl', label: 'Gallego' },
  { value: 'eu', label: 'Euskera' },
  { value: 'fr', label: 'Francés' },
  { value: 'pt', label: 'Portugués' },
  { value: 'it', label: 'Italiano' },
  { value: 'de', label: 'Alemán' },
] as const;

export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
