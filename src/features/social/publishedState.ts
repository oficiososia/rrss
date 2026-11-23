import { useQuery } from '@tanstack/react-query';
import type { ScheduledPublicationRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { socialKeys, useContentPublication } from './api';

// «¿Esta pieza ya está publicada?», leído de los datos y no de la pieza.
//
// El estado de la pieza (idea, borrador, en revisión, aprobada) NO cambia al
// publicarse: lo que dice que ha salido es su publicación en
// `scheduled_publications` con `status = 'published'` (y entonces siempre trae
// `external_id` y `published_at`: lo impone un CHECK de la tabla). Una pieza
// tiene como mucho UNA publicación viva (no cancelada): el índice único
// `scheduled_publications_one_per_content_idx` (20261119030000). Así que, si
// esa publicación está publicada, la pieza está publicada, y no se puede volver
// a programar ni publicar: para repetirla se publica una copia («Publicar otra
// vez», ver RepublishDialog).

/** Lo que se enseña de una pieza ya publicada. */
export interface PublishedInfo {
  publicationId: string;
  /** Cuándo salió (ISO). */
  publishedAt: string;
  /** Enlace a la publicación en la red (Instagram), si la red lo dio. */
  url: string | null;
  network: string;
}

type PublicationLike = Pick<ScheduledPublicationRow, 'status' | 'published_at' | 'scheduled_at'> & {
  external_url?: string | null;
  id?: string;
  network?: string;
};

/** La información de «publicada» de una publicación; null si no ha salido. */
export function publishedInfoOf(publication: PublicationLike | null | undefined): PublishedInfo | null {
  if (!publication || publication.status !== 'published') return null;
  return {
    publicationId: publication.id ?? '',
    publishedAt: publication.published_at ?? publication.scheduled_at,
    url: publication.external_url ?? null,
    network: publication.network ?? 'instagram',
  };
}

/**
 * Estado de publicación de UNA pieza (para el editor y las fichas):
 *
 *   const { published, publication, isLoading } = usePublishedState(brand.id, contentId);
 *   if (published) → «Publicada el …» + enlace `published.url`; nada de «Publicar ahora» ni «Programar».
 *
 * `publication` es la publicación viva de la pieza (programada, detenida, fallida o publicada), o null.
 */
export function usePublishedState(brandId: string, contentId: string | null, enabled = true) {
  const query = useContentPublication(brandId, contentId, enabled);
  const publication = query.data ?? null;
  return {
    publication,
    published: publishedInfoOf(publication),
    isLoading: query.isPending && enabled && Boolean(contentId),
    isError: query.isError,
  };
}

/** Las piezas publicadas de la marca, por id de pieza (para listas: Contenidos, «Programar»…). */
export function usePublishedContents(brandId: string, enabled = true) {
  return useQuery({
    queryKey: [...socialKeys.calendar(brandId), 'published'] as const,
    enabled,
    queryFn: async (): Promise<Map<string, PublishedInfo>> => {
      const rows = unwrap(
        await supabase
          .from('scheduled_publications')
          .select('id, content_id, status, scheduled_at, published_at, external_url, network')
          .eq('brand_id', brandId)
          .eq('status', 'published')
          .limit(2000),
      ) as (PublicationLike & { content_id: string })[];
      const map = new Map<string, PublishedInfo>();
      for (const row of rows) {
        const info = publishedInfoOf(row);
        if (info) map.set(row.content_id, info);
      }
      return map;
    },
  });
}

/** «Publicada el 23 nov» (con la hora si se pide), en la hora de la marca. */
export function publishedText(info: Pick<PublishedInfo, 'publishedAt'>, zone: string, withTime = false): string {
  const date = new Date(info.publishedAt);
  const day = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: zone }).replace('.', '');
  if (!withTime) return `Publicada el ${day}`;
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zone });
  return `Publicada el ${day} a las ${time}`;
}
