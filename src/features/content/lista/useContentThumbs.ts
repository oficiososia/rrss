import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { previewPath, useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { isReelProject, parseProject } from '@/features/reels/editor/project';
import type { MediaAssetRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { migrateDocument, type Canvas, type ContentDocument, type Layer } from '../document';
import type { ImageLookup } from '../editor/canvas/nodes';
import { cachedPreview, hashOf, renderPreview } from '../templates/preview';
/** Lo mínimo de una pieza para dibujar su miniatura. */
export interface ThumbSource {
  id: string;
  current_version: number;
}

// Miniaturas reales de las piezas de la lista:
//   · publicación, carrusel, historia: la primera página, dibujada con el mismo motor que el lienzo y
//     la exportación (el de las plantillas), con su caché;
//   · reel: su portada, o la miniatura del primer clip;
//   · si no se puede dibujar: el esquema de capas, y si no hay nada, el icono del formato.
// Solo se piden las que se están viendo.

export type PieceThumb =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'image'; url: string }
  | { kind: 'sketch'; canvas: Canvas; layers: Layer[]; images: ImageLookup };

interface VersionData {
  documents: Map<string, ContentDocument>;
  /** Ruta de almacenamiento que representa a cada reel (portada o primer clip). */
  reels: Map<string, string>;
}

function reelPath(data: unknown): string | null {
  try {
    const { plan } = parseProject(data);
    if (plan.cover?.type === 'photo') return plan.cover.path;
    return plan.clips[0]?.path ?? null;
  } catch {
    return null;
  }
}

function assetIdsOf(document: ContentDocument): string[] {
  return (document.pages[0]?.layers ?? []).flatMap((layer) => {
    if (layer.type === 'image' && layer.source.kind === 'asset') return [layer.source.assetId];
    if (layer.type === 'logo') return [layer.assetId];
    return [];
  });
}

export function useContentThumbs(brandId: string, items: ThumbSource[]): Map<string, PieceThumb> {
  const wanted = useMemo(() => items.filter((i) => i.current_version > 0), [items]);
  const wantedKey = wanted.map((i) => `${i.id}:${i.current_version}`).join(',');

  const versions = useQuery({
    queryKey: ['brand', brandId, 'content', 'thumb-versions', wantedKey] as const,
    enabled: wanted.length > 0,
    // Una versión guardada no cambia: lo leído sirve mientras la pieza siga en la misma.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<VersionData> => {
      const rows = unwrap(
        await supabase
          .from('content_versions')
          .select('content_id, version, data')
          .in(
            'content_id',
            wanted.map((i) => i.id),
          ),
      ) as { content_id: string; version: number; data: unknown }[];
      const current = new Map(wanted.map((i) => [i.id, i.current_version]));
      const documents = new Map<string, ContentDocument>();
      const reels = new Map<string, string>();
      for (const row of rows) {
        if (current.get(row.content_id) !== row.version) continue;
        if (isReelProject(row.data)) {
          const path = reelPath(row.data);
          if (path) reels.set(row.content_id, path);
          continue;
        }
        try {
          documents.set(row.content_id, migrateDocument(row.data));
        } catch {
          // Un documento ilegible se queda con el icono del formato.
        }
      }
      return { documents, reels };
    },
  });

  // Reels: recurso por ruta, y su miniatura firmada.
  const reelPaths = useMemo(() => [...new Set(versions.data?.reels.values() ?? [])].sort(), [versions.data]);
  const reelAssets = useQuery({
    queryKey: ['brand', brandId, 'content', 'thumb-reel-assets', reelPaths.join(',')] as const,
    enabled: reelPaths.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () =>
      unwrap(
        await supabase.from('media_assets').select('*').eq('brand_id', brandId).in('storage_path', reelPaths),
      ) as MediaAssetRow[],
  });
  const reelSignPaths = useMemo(
    () =>
      (reelAssets.data ?? [])
        .filter((a) => a.thumb_path || a.mime_type.startsWith('image/'))
        .map(previewPath)
        .sort(),
    [reelAssets.data],
  );
  const reelUrls = useSignedUrls(reelSignPaths, { variant: 'thumb' });

  // Documentos: las fotos y logotipos que usa la primera página.
  const assetIds = useMemo(
    () => [...new Set([...(versions.data?.documents.values() ?? [])].flatMap(assetIdsOf))].sort(),
    [versions.data],
  );
  const assets = useAssetsByIds(brandId, assetIds);
  const docPaths = useMemo(() => (assets.data ?? []).map(previewPath).sort(), [assets.data]);
  const signed = useSignedUrls(docPaths);
  const lookup: ImageLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets.data ?? []) {
      const url = signed.data?.get(previewPath(asset));
      if (url) map.set(asset.id, url);
    }
    return map;
  }, [assets.data, signed.data]);
  const lookupReady = assetIds.length === 0 || (!assets.isPending && (docPaths.length === 0 || !signed.isPending));
  const lookupSignature = [...lookup.keys()].sort().join(',');

  const [drawn, setDrawn] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    if (!versions.data || !lookupReady) return;
    let cancelled = false;
    for (const [id, document] of versions.data.documents) {
      const version = wanted.find((i) => i.id === id)?.current_version ?? 0;
      const key = `pieza|${brandId}|${id}|${version}|${hashOf(lookupSignature)}`;
      void cachedPreview(key, () => renderPreview(document, lookup)).then((url) => {
        if (!cancelled) setDrawn((current) => new Map(current).set(id, url));
      });
    }
    return () => {
      cancelled = true;
    };
    // `lookupSignature` resume las fotos disponibles; `lookup` cambia con ellas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions.data, lookupReady, lookupSignature, brandId]);

  return useMemo(() => {
    const map = new Map<string, PieceThumb>();
    const reelAssetByPath = new Map((reelAssets.data ?? []).map((a) => [a.storage_path, a]));
    for (const item of items) {
      if (item.current_version === 0 || versions.isError) {
        map.set(item.id, { kind: 'none' });
        continue;
      }
      if (!versions.data) {
        map.set(item.id, { kind: 'loading' });
        continue;
      }
      const document = versions.data.documents.get(item.id);
      if (document) {
        const url = drawn.get(item.id);
        if (url) map.set(item.id, { kind: 'image', url });
        else if (url === null && document.pages[0]) {
          map.set(item.id, { kind: 'sketch', canvas: document.canvas, layers: document.pages[0].layers, images: lookup });
        } else map.set(item.id, { kind: 'loading' });
        continue;
      }
      const path = versions.data.reels.get(item.id);
      if (path) {
        if (reelAssets.isPending) {
          map.set(item.id, { kind: 'loading' });
          continue;
        }
        const asset = reelAssetByPath.get(path);
        const url = asset ? reelUrls.data?.get(previewPath(asset)) : undefined;
        map.set(item.id, url ? { kind: 'image', url } : { kind: 'none' });
        continue;
      }
      map.set(item.id, { kind: 'none' });
    }
    return map;
  }, [items, versions.data, versions.isError, drawn, lookup, reelAssets.data, reelAssets.isPending, reelUrls.data]);
}
