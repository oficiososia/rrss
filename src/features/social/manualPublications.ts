import type { ManualPublicationRow, ScheduledPublicationRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Lo terminado a mano en Instagram («Terminar en Instagram», `manual_publications`,
// docs/editor-reels.md §12) en el calendario, el inicio y los resultados.
//
// No es `scheduled_publications` (allí «publicada» exige el identificador que da la red al
// publicar por la API), así que aquí se convierte en una fila con la misma forma para pintarla
// en los mismos sitios, marcada con `manual`:
//   · publicada (por «Ya lo publiqué» o encontrada en la cuenta) → «Publicada (a mano)», en su
//     día, con su enlace si lo tiene, y cuenta en «N de M publicadas»;
//   · pendiente de publicar a mano → «Pendiente en Instagram», en el día en que se mandó al
//     móvil. Pendiente NO es publicado: cuenta en M, no en N.
// Lo cancelado no sale. Nada de esto se mueve, se cancela ni se publica desde el calendario:
// se gestiona en la hoja «Exportar» del reel.

export type ManualPublicationLite = Pick<
  ManualPublicationRow,
  | 'id'
  | 'brand_id'
  | 'organization_id'
  | 'content_id'
  | 'content_version'
  | 'media_asset_id'
  | 'status'
  | 'handed_off_at'
  | 'published_at'
  | 'match_source'
  | 'external_id'
  | 'external_url'
  | 'created_by'
  | 'created_at'
  | 'updated_at'
>;

const COLUMNS =
  'id, brand_id, organization_id, content_id, content_version, media_asset_id, status, handed_off_at, published_at, match_source, external_id, external_url, created_by, created_at, updated_at';

/** Lo que distingue una fila hecha a mano. */
export interface ManualMark {
  /** Identificador en `manual_publications` (el mismo que la fila). */
  id: string;
  status: 'pending' | 'published';
  /** Cómo se supo que salió: «Ya lo publiqué» o encontrada en la cuenta. */
  source: 'manual' | 'import' | null;
}

/** Una fila del calendario hecha a mano. */
export type ManualPublicationEntry = ScheduledPublicationRow & { manual: ManualMark };

/** El día en que cuenta: publicada, cuándo salió; pendiente, cuándo se mandó al móvil. */
export function manualDate(row: Pick<ManualPublicationLite, 'status' | 'published_at' | 'handed_off_at'>): string {
  return row.status === 'published' ? (row.published_at ?? row.handed_off_at) : row.handed_off_at;
}

/** La entrega a mano con la forma de una publicación del calendario. Null si está cancelada. */
export function manualAsPublication(row: ManualPublicationLite): ManualPublicationEntry | null {
  if (row.status !== 'pending' && row.status !== 'published') return null;
  const published = row.status === 'published';
  return {
    id: row.id,
    brand_id: row.brand_id,
    organization_id: row.organization_id,
    content_id: row.content_id,
    content_version: row.content_version,
    social_account_id: null,
    network: 'instagram',
    format: 'reel',
    scheduled_at: manualDate(row),
    media_asset_ids: [row.media_asset_id],
    // «planned» sin motivo: está en la semana pero no ha salido. Nunca «scheduled» (no lo publica nadie solo).
    status: published ? 'published' : 'planned',
    hold_reason: null,
    generation: 0,
    attempt_count: 0,
    last_error_code: null,
    last_error: null,
    container_id: null,
    container_created_at: null,
    external_id: published ? row.external_id : null,
    external_url: published ? row.external_url : null,
    published_at: published ? row.published_at : null,
    locked_by: null,
    locked_until: null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    manual: { id: row.id, status: row.status, source: row.match_source },
  };
}

/** Las entregas a mano vivas (pendientes y publicadas) de la marca, las más recientes primero. */
export async function fetchManualPublications(brandId: string): Promise<ManualPublicationLite[]> {
  return unwrap(
    await supabase
      .from('manual_publications')
      .select(COLUMNS)
      .eq('brand_id', brandId)
      .in('status', ['pending', 'published'])
      .order('handed_off_at', { ascending: false })
      .limit(500),
  ) as ManualPublicationLite[];
}

/** Las que caen entre dos instantes [desde, hasta), como filas del calendario. */
export function manualEntriesBetween(rows: ManualPublicationLite[], from: Date, to: Date): ManualPublicationEntry[] {
  const start = from.getTime();
  const end = to.getTime();
  return rows.flatMap((row) => {
    const at = Date.parse(manualDate(row));
    if (!(at >= start && at < end)) return [];
    const entry = manualAsPublication(row);
    return entry ? [entry] : [];
  });
}
