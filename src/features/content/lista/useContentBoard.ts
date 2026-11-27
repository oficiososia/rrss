import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ContentItemRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { contentKeys } from '../api';
import { isEmptyPiece, pickPublications, stageOf, type ContentStage, type PublicationLite } from './stage';

/** Tope de piezas que se traen de una vez: de sobra para una marca; la pantalla las enseña por tandas. */
export const BOARD_LIMIT = 600;

export interface BoardItem extends ContentItemRow {
  stage: ContentStage;
  publication: PublicationLite | null;
  /** Sin ninguna versión guardada: solo tiene nombre. */
  empty: boolean;
  campaignIds: string[];
}

interface BoardData {
  items: ContentItemRow[];
  publications: PublicationLite[];
  campaignLinks: { content_id: string; campaign_id: string }[];
}

/**
 * Todas las piezas vivas (o todas las archivadas) de la marca, con la etapa de cada una. La etapa
 * mezcla el estado de la pieza con el de su publicación, así que se calcula aquí y no en la consulta.
 */
export function useContentBoard(brandId: string, archived: boolean) {
  const query = useQuery({
    queryKey: [...contentKeys.all(brandId), 'board', archived] as const,
    queryFn: async (): Promise<BoardData> => {
      let items = supabase
        .from('content_items')
        .select('*')
        .eq('brand_id', brandId)
        .order('updated_at', { ascending: false })
        .order('id')
        .limit(BOARD_LIMIT);
      items = archived ? items.not('archived_at', 'is', null) : items.is('archived_at', null);
      const [rows, publications, links] = await Promise.all([
        items,
        supabase
          .from('scheduled_publications')
          .select('id, content_id, status, scheduled_at, published_at, hold_reason, external_url, network')
          .eq('brand_id', brandId)
          .order('scheduled_at', { ascending: false })
          .limit(1000),
        supabase.from('campaign_contents').select('content_id, campaign_id').eq('brand_id', brandId).limit(1000),
      ]);
      return {
        items: unwrap(rows) as ContentItemRow[],
        publications: unwrap(publications) as PublicationLite[],
        campaignLinks: unwrap(links) as BoardData['campaignLinks'],
      };
    },
  });

  const items = useMemo<BoardItem[]>(() => {
    if (!query.data) return [];
    const publications = pickPublications(query.data.publications);
    const campaigns = new Map<string, string[]>();
    for (const link of query.data.campaignLinks) {
      campaigns.set(link.content_id, [...(campaigns.get(link.content_id) ?? []), link.campaign_id]);
    }
    return query.data.items.map((item) => {
      const publication = publications.get(item.id) ?? null;
      return {
        ...item,
        stage: stageOf(item, publication),
        publication,
        empty: isEmptyPiece(item, publication),
        campaignIds: campaigns.get(item.id) ?? [],
      };
    });
  }, [query.data]);

  return { ...query, items };
}
