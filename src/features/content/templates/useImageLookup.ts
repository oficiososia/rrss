import { useMemo } from 'react';
import { useAssetsByIds, useSignedUrls } from '@/features/library/api';
import type { ImageLookup } from '../editor/canvas/nodes';

/** Recurso de la biblioteca → dirección firmada, para dibujar las fotos de unos documentos. */
export function useImageLookup(brandId: string, assetIds: string[]): ImageLookup {
  const key = [...new Set(assetIds)].sort().join(',');
  const ids = useMemo(() => (key ? key.split(',') : []), [key]);
  const assets = useAssetsByIds(brandId, ids);
  const storagePaths = useMemo(() => (assets.data ?? []).map((a) => a.storage_path).sort(), [assets.data]);
  const signed = useSignedUrls(storagePaths);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets.data ?? []) {
      const url = signed.data?.get(asset.storage_path);
      if (url) map.set(asset.id, url);
    }
    return map;
  }, [assets.data, signed.data]);
}
