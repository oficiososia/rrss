// Único sitio donde vive el nombre del producto y los límites compartidos.
export const APP_NAME = 'RRSS';

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
