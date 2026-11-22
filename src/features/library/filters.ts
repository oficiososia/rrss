import type { MediaAssetRow } from '@/lib/database.types';
import { isInside } from './folders';

// Filtros y orden de la biblioteca. Se aplican en el navegador sobre todos los
// archivos de la marca (cientos, no millones): así el árbol, los contadores y los
// filtros por uso responden al instante y siempre cuadran entre sí.

export type ChipId = 'photos' | 'videos' | 'logos' | 'cutout' | 'ai' | 'unused' | 'recent';
export type SortKey = 'date' | 'name' | 'usage';

export const CHIPS: ReadonlyArray<{ id: ChipId; label: string }> = [
  { id: 'photos', label: 'Fotos' },
  { id: 'videos', label: 'Vídeos' },
  { id: 'logos', label: 'Logotipos' },
  { id: 'cutout', label: 'Con fondo quitado' },
  { id: 'ai', label: 'Hechas con IA' },
  { id: 'unused', label: 'Sin usar' },
  { id: 'recent', label: 'Recientes' },
];

export const SORT_LABEL: Record<SortKey, string> = {
  date: 'Más recientes',
  name: 'Por nombre',
  usage: 'Más usadas',
};

export interface LibraryFilters {
  /** Carpeta elegida (con lo que haya dentro); `null` = toda la biblioteca; `''` = solo lo que no está en ninguna. */
  folder: string | null;
  chips: ReadonlySet<ChipId>;
  tag: string;
  search: string;
  sort: SortKey;
}

export const EMPTY_FILTERS: LibraryFilters = {
  folder: null,
  chips: new Set(),
  tag: '',
  search: '',
  sort: 'date',
};

export const RECENT_DAYS = 14;

type Provenance = { type?: unknown; steps?: unknown; job_kind?: unknown; kind?: unknown } | null;

function provenanceOf(asset: Pick<MediaAssetRow, 'provenance'>): Provenance {
  const p = asset.provenance;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Provenance) : null;
}

function stepKinds(asset: Pick<MediaAssetRow, 'provenance'>): string[] {
  const steps = provenanceOf(asset)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((s) => {
    const kind = s && typeof s === 'object' ? (s as { kind?: unknown }).kind : undefined;
    return typeof kind === 'string' ? [kind] : [];
  });
}

/** Fondo quitado: lo dice la procedencia de la edición o, en las antiguas, el nombre «Sin fondo · …». */
export function isCutout(asset: Pick<MediaAssetRow, 'provenance' | 'file_name'>): boolean {
  const p = provenanceOf(asset);
  if (stepKinds(asset).includes('remove_background')) return true;
  if (p?.type === 'media_job' && (p.job_kind === 'media.cutout' || p.kind === 'media.cutout')) return true;
  return /^sin fondo\b/i.test(asset.file_name);
}

/** Generada o animada con IA (imagen, vídeo o fondo cambiado con IA). */
export function isAiMade(asset: Pick<MediaAssetRow, 'provenance'>): boolean {
  const type = provenanceOf(asset)?.type;
  return type === 'ai_generation' || type === 'ai_animation' || stepKinds(asset).includes('ai_background');
}

export const isPhoto = (asset: Pick<MediaAssetRow, 'kind' | 'mime_type'>): boolean =>
  asset.kind === 'image' && asset.mime_type.startsWith('image/');

export const isVideo = (asset: Pick<MediaAssetRow, 'kind' | 'mime_type'>): boolean =>
  asset.kind === 'video' || asset.mime_type.startsWith('video/');

function matchesChip(chip: ChipId, asset: MediaAssetRow, usage: ReadonlyMap<string, number>, now: number): boolean {
  switch (chip) {
    case 'photos':
      return isPhoto(asset);
    case 'videos':
      return isVideo(asset);
    case 'logos':
      return asset.kind === 'logo';
    case 'cutout':
      return isCutout(asset);
    case 'ai':
      return isAiMade(asset);
    case 'unused':
      return (usage.get(asset.id) ?? 0) === 0;
    case 'recent':
      return now - Date.parse(asset.created_at) <= RECENT_DAYS * 86_400_000;
  }
}

/** Fotos, vídeos y logotipos se suman entre sí; el resto (fondo, IA, uso, fecha) se exige a la vez. */
const KIND_CHIPS: ReadonlySet<ChipId> = new Set<ChipId>(['photos', 'videos', 'logos']);

export function applyFilters(
  assets: readonly MediaAssetRow[],
  filters: LibraryFilters,
  usage: ReadonlyMap<string, number>,
  now: number = Date.now(),
): MediaAssetRow[] {
  const query = filters.search.trim().toLowerCase();
  const kindChips = [...filters.chips].filter((c) => KIND_CHIPS.has(c));
  const otherChips = [...filters.chips].filter((c) => !KIND_CHIPS.has(c));
  const out = assets.filter((a) => {
    if (filters.folder === '' && a.folder !== '') return false;
    if (filters.folder && !isInside(a.folder, filters.folder)) return false;
    if (filters.tag && !a.tags.includes(filters.tag)) return false;
    if (query && !`${a.file_name} ${a.folder} ${a.tags.join(' ')}`.toLowerCase().includes(query)) return false;
    if (kindChips.length && !kindChips.some((c) => matchesChip(c, a, usage, now))) return false;
    return otherChips.every((c) => matchesChip(c, a, usage, now));
  });
  return sortAssets(out, filters.sort, usage);
}

export function sortAssets(
  assets: readonly MediaAssetRow[],
  sort: SortKey,
  usage: ReadonlyMap<string, number>,
): MediaAssetRow[] {
  const byDate = (a: MediaAssetRow, b: MediaAssetRow) =>
    b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
  const sorted = [...assets];
  if (sort === 'name') {
    sorted.sort((a, b) => a.file_name.localeCompare(b.file_name, 'es', { numeric: true }) || byDate(a, b));
  } else if (sort === 'usage') {
    sorted.sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || byDate(a, b));
  } else {
    sorted.sort(byDate);
  }
  return sorted;
}

/** Cuántos archivos hay por carpeta (la carpeta vacía es «sin carpeta»). */
export function countByFolder(assets: readonly Pick<MediaAssetRow, 'folder'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.folder, (counts.get(a.folder) ?? 0) + 1);
  return counts;
}

/** Selección con Mayús: los ids entre dos posiciones de la lista, ambas incluidas. */
export function idsBetween(order: readonly string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}
