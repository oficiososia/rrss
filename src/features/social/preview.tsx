import { useQuery } from '@tanstack/react-query';
import { Film } from 'lucide-react';
import { useMemo, useState } from 'react';
import { publishedText } from '@/features/brandcheck/text';
import { useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { ThumbImage } from '@/features/library/ThumbImage';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { CalendarEntry } from './api';

// Lo que se va a publicar, visto desde el calendario: la imagen (o el vídeo)
// elegida y el texto. El texto se compone con la misma regla que el publicador
// (supabase/functions/_shared/social/caption.ts → composeCaption) y que el
// verificador (publishedText): el pie y, al final, los hashtags de la lista que
// no estén ya en el pie.

/** Pie y hashtags del documento de una versión (lectura tolerante: solo `copy`). */
export function usePublicationText(brandId: string, entry: CalendarEntry | null) {
  const version = entry ? (entry.content_version ?? entry.content?.current_version ?? 0) : 0;
  return useQuery({
    queryKey: ['brand', brandId, 'social', 'publication-text', entry?.content_id ?? '', version] as const,
    enabled: Boolean(entry) && version > 0,
    queryFn: async (): Promise<string> => {
      const rows = unwrap(
        await supabase
          .from('content_versions')
          .select('data')
          .eq('content_id', entry!.content_id)
          .eq('version', version)
          .limit(1),
      );
      const data = rows[0]?.data as { copy?: { caption?: unknown; hashtags?: unknown } } | null | undefined;
      const caption = typeof data?.copy?.caption === 'string' ? data.copy.caption : '';
      const hashtags = Array.isArray(data?.copy?.hashtags)
        ? data.copy.hashtags.filter((h): h is string => typeof h === 'string')
        : [];
      return publishedText(caption, hashtags);
    },
  });
}

/** Miniaturas de la primera imagen (o vídeo) de cada publicación, en un solo lote. */
export function useEntryThumbs(brandId: string, entries: CalendarEntry[]) {
  const ids = useMemo(
    () => [...new Set(entries.map((e) => e.media_asset_ids[0]).filter((id): id is string => Boolean(id)))]
      .sort()
      .slice(0, 100),
    [entries],
  );
  const assets = useAssetsByIds(brandId, ids);
  const paths = useMemo(() => (assets.data ?? []).map((a) => a.storage_path), [assets.data]);
  const urls = useSignedUrls(paths, { variant: 'thumb' });
  return useMemo(() => {
    const map = new Map<string, { url?: string; video: boolean }>();
    for (const a of assets.data ?? []) {
      const url = urls.data?.get(a.storage_path);
      map.set(a.id, { ...(url ? { url } : {}), video: a.mime_type.startsWith('video/') });
    }
    return map;
  }, [assets.data, urls.data]);
}

/** Miniatura pequeña para la vista de calendario. No ocupa sitio si la publicación no tiene medio. */
export function EntryThumb({ thumb }: { thumb: { url?: string; video: boolean } | undefined }) {
  if (!thumb) return null;
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-subtle text-muted"
      data-testid="calendar-entry-thumb"
    >
      {thumb.video ? (
        <Film className="h-3.5 w-3.5" aria-label="Vídeo" />
      ) : thumb.url ? (
        <ThumbImage url={thumb.url} size={24} />
      ) : null}
    </span>
  );
}

const CLAMP_AT = 220;

/** Imagen o vídeo elegidos y texto que se publicará, con «Ver más» si es largo. */
export function PublicationPreview({ brandId, entry }: { brandId: string; entry: CalendarEntry }) {
  const assetId = entry.media_asset_ids[0] ?? null;
  const assets = useAssetsByIds(brandId, assetId ? [assetId] : []);
  const asset = assets.data?.[0] ?? null;
  const urls = useSignedUrls(asset ? [asset.storage_path] : []);
  const url = asset ? urls.data?.get(asset.storage_path) : undefined;
  const text = usePublicationText(brandId, entry);
  const [expanded, setExpanded] = useState(false);
  const full = text.data ?? '';
  const long = full.length > CLAMP_AT;

  return (
    <section aria-label="Lo que se publicará" className="flex gap-3" data-testid="publication-preview">
      {assetId && (
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-subtle">
          {asset?.mime_type.startsWith('video/') ? (
            url ? (
              <video src={url} controls preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted">
                <Film className="h-6 w-6" aria-hidden />
              </span>
            )
          ) : url ? (
            <ThumbImage url={url} size={112} />
          ) : null}
        </div>
      )}
      <div className="min-w-0 flex-1 text-sm">
        {text.isLoading ? (
          <p className="text-xs text-muted">Cargando el texto…</p>
        ) : full ? (
          <>
            <p className="whitespace-pre-wrap break-words" data-testid="publication-text">
              {long && !expanded ? `${full.slice(0, CLAMP_AT).trimEnd()}…` : full}
            </p>
            {long && (
              <button
                type="button"
                className="mt-1 text-xs text-primary underline"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                data-testid="publication-text-more"
              >
                {expanded ? 'Ver menos' : 'Ver más'}
              </button>
            )}
          </>
        ) : (
          <p className="text-xs text-muted" data-testid="publication-text-empty">
            Esta versión no tiene texto.
          </p>
        )}
      </div>
    </section>
  );
}
