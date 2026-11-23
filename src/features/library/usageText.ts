// Aviso al eliminar archivos que se usan en piezas o reels: qué piezas (como mucho
// tres, «y N más») y qué les pasará. Puro, sin React.
import type { AssetUsageRow } from '@/lib/database.types';

/** Cuántos nombres de pieza se enseñan como mucho. */
export const USAGE_NAMES_SHOWN = 3;

/** Piezas vigentes (no archivadas) distintas, en el orden en que llegan. */
export function piecesUsing(rows: readonly Pick<AssetUsageRow, 'content_id' | 'title' | 'archived'>[]) {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (row.archived || seen.has(row.content_id)) continue;
    seen.set(row.content_id, row.title.trim() || 'Sin título');
  }
  return [...seen.values()];
}

/** «A», «B» y «C» · «A», «B», «C» y 2 más. */
export function listPieces(titles: readonly string[]): string {
  const quoted = titles.slice(0, USAGE_NAMES_SHOWN).map((t) => `«${t}»`);
  const rest = titles.length - quoted.length;
  if (rest > 0) return `${quoted.join(', ')} y ${rest} más`;
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} y ${quoted.at(-1)}`;
}

/**
 * Frase para el diálogo de eliminar, o null si no se usa en ninguna pieza vigente.
 * `files` es cuántos archivos se van a eliminar (cambia el sujeto de la frase).
 */
export function usageWarning(
  rows: readonly Pick<AssetUsageRow, 'content_id' | 'title' | 'archived'>[],
  files = 1,
): string | null {
  const titles = piecesUsing(rows);
  if (titles.length === 0) return null;
  const subject = files === 1 ? 'Se usa en' : 'Se usan en';
  const pieces = titles.length === 1 ? 'esa pieza quedará' : 'esas piezas quedarán';
  return `${subject} ${listPieces(titles)}: ${pieces} con un hueco que se puede sustituir por otra foto desde el editor.`;
}
