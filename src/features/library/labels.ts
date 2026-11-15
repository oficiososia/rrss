import type { AssetKind } from '@/lib/database.types';

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  image: 'Imagen',
  video: 'Vídeo',
  logo: 'Logotipo',
  document: 'Documento',
  audio: 'Audio',
  template: 'Plantilla',
};

export const ASSET_KINDS = Object.keys(ASSET_KIND_LABEL) as AssetKind[];

export interface AssetRights {
  license: string;
  owner: string;
  expires_on: string;
  notes: string;
}

/** Lee los derechos de uso guardados (JSON libre) con valores por defecto. */
export function parseRights(value: unknown): AssetRights {
  const source =
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const text = (key: string) => (typeof source[key] === 'string' ? (source[key] as string) : '');
  return { license: text('license'), owner: text('owner'), expires_on: text('expires_on'), notes: text('notes') };
}

/** Solo se guardan los campos con contenido. */
export function serializeRights(rights: AssetRights): Record<string, string> {
  return Object.fromEntries(
    Object.entries(rights)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => [k, v.trim()]),
  );
}

export function rightsExpired(rights: AssetRights, today: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rights.expires_on)) return false;
  return rights.expires_on < today.toISOString().slice(0, 10);
}
