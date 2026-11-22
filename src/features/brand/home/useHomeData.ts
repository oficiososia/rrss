import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useMediaSummary } from '@/features/analytics/api';
import type { ContentItemRow, ScheduledPublicationRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Lo que necesita el inicio de la marca, en consultas pequeñas y solo lectura:
//   · lo parado: publicaciones detenidas o fallidas, con la pieza;
//   · lo último publicado: las tres más recientes, con las cifras si ya se capturaron.

export type PieceRef = Pick<ContentItemRow, 'id' | 'title' | 'current_version' | 'network' | 'format'>;

export type HomePublication = Pick<
  ScheduledPublicationRow,
  'id' | 'content_id' | 'network' | 'format' | 'scheduled_at' | 'published_at' | 'status' | 'hold_reason' | 'external_url'
>;

const COLUMNS = 'id, content_id, network, format, scheduled_at, published_at, status, hold_reason, external_url';
const PIECE_COLUMNS = 'id, title, current_version, network, format';

async function piecesOf(ids: string[]): Promise<Map<string, PieceRef>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap(await supabase.from('content_items').select(PIECE_COLUMNS).in('id', ids)) as PieceRef[];
  return new Map(rows.map((r) => [r.id, r]));
}

export interface WithPiece {
  publication: HomePublication;
  piece: PieceRef | null;
}

/** Publicaciones que no van a salir solas: con un motivo de espera o que fallaron. */
export function useStalledPublications(brandId: string) {
  return useQuery({
    queryKey: ['brand', brandId, 'home', 'stalled'] as const,
    queryFn: async (): Promise<WithPiece[]> => {
      const rows = (
        unwrap(
          await supabase
            .from('scheduled_publications')
            .select(COLUMNS)
            .eq('brand_id', brandId)
            .in('status', ['planned', 'scheduled', 'failed'])
            .order('scheduled_at', { ascending: true })
            .limit(200),
        ) as HomePublication[]
      ).filter((p) => p.status === 'failed' || p.hold_reason);
      const pieces = await piecesOf([...new Set(rows.map((r) => r.content_id))]);
      return rows.map((publication) => ({ publication, piece: pieces.get(publication.content_id) ?? null }));
    },
  });
}

export const REACH_METRIC = 'instagram.media.reach';
export const INTERACTIONS_METRIC = 'instagram.media.total_interactions';

export interface PublishedWithFigures extends WithPiece {
  /** Solo las cifras que existen. */
  figures: { reach?: number; interactions?: number };
}

/** Las últimas publicaciones salidas, con sus cifras si la analítica ya las tiene. */
export function useLatestPublished(brandId: string, now = new Date()) {
  const published = useQuery({
    queryKey: ['brand', brandId, 'home', 'published'] as const,
    queryFn: async (): Promise<WithPiece[]> => {
      const rows = unwrap(
        await supabase
          .from('scheduled_publications')
          .select(COLUMNS)
          .eq('brand_id', brandId)
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(3),
      ) as HomePublication[];
      const pieces = await piecesOf([...new Set(rows.map((r) => r.content_id))]);
      return rows.map((publication) => ({ publication, piece: pieces.get(publication.content_id) ?? null }));
    },
  });
  // Tres meses atrás hasta mañana: de sobra para las tres últimas.
  const today = now.toDateString();
  const period = useMemo(() => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    return { from: day(new Date(now.getTime() - 90 * 86_400_000)), to: day(new Date(now.getTime() + 86_400_000)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);
  const summary = useMediaSummary(brandId, period);

  const items = useMemo<PublishedWithFigures[]>(() => {
    const byId = new Map((summary.data ?? []).map((s) => [s.publication_id, s.metrics]));
    return (published.data ?? []).map((entry) => {
      const metrics = byId.get(entry.publication.id) ?? {};
      const figures: PublishedWithFigures['figures'] = {};
      if (typeof metrics[REACH_METRIC] === 'number') figures.reach = metrics[REACH_METRIC];
      if (typeof metrics[INTERACTIONS_METRIC] === 'number') figures.interactions = metrics[INTERACTIONS_METRIC];
      return { ...entry, figures };
    });
  }, [published.data, summary.data]);

  return { isPending: published.isPending, isError: published.isError, items };
}
