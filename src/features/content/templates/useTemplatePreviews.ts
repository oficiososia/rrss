import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { previewPath, useSignedUrls } from '@/features/library/api';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { ContentDocument } from '../document';
import type { ImageLookup } from '../editor/canvas/nodes';
import type { BrandTemplate } from './api';
import {
  cachedPreview,
  hashOf,
  PLACEHOLDER_ASSET_ID,
  PLACEHOLDER_PHOTO_URL,
  renderPreview,
  withSamplePhotos,
} from './preview';
import { useImageLookup } from './useImageLookup';

const SAMPLE_COUNT = 8;

export type TemplatePreview = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error' };

/** Fotos de ejemplo de la marca: las más recientes de la biblioteca (solo imágenes). */
function useSamplePhotos(brandId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['brand', brandId, 'assets', 'template-samples'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('media_assets')
          .select('*')
          .eq('brand_id', brandId)
          .eq('kind', 'image')
          .order('created_at', { ascending: false })
          .order('id')
          .limit(SAMPLE_COUNT),
      ),
  });
}

function logoIdsOf(document: ContentDocument | null): string[] {
  if (!document) return [];
  return document.pages.flatMap((page) => page.layers.flatMap((l) => (l.type === 'logo' ? [l.assetId] : [])));
}

/**
 * Vistas previas reales de las plantillas (mismo motor que el lienzo), con las fotos más recientes
 * de la biblioteca en los huecos de foto. No bloquea: cada plantilla pasa de `loading` a `ready`
 * (o `error`, y entonces quien la pinta usa el esquema de siempre).
 */
export function useTemplatePreviews(brandId: string, templates: BrandTemplate[]) {
  const usable = useMemo(() => templates.filter((t) => t.document), [templates]);
  const samples = useSamplePhotos(brandId, usable.length > 0);
  const sampleAssets = useMemo(() => samples.data ?? [], [samples.data]);
  const paths = useMemo(() => sampleAssets.map(previewPath), [sampleAssets]);
  const signed = useSignedUrls(paths);
  const logos = useImageLookup(
    brandId,
    useMemo(() => usable.flatMap((t) => logoIdsOf(t.document)), [usable]),
  );

  // Fotos de ejemplo con dirección ya firmada, en orden de más reciente.
  const sampleIds = useMemo(
    () => sampleAssets.filter((a) => signed.data?.has(previewPath(a))).map((a) => a.id),
    [sampleAssets, signed.data],
  );
  const lookup: ImageLookup = useMemo(() => {
    const map = new Map<string, string>(logos);
    map.set(PLACEHOLDER_ASSET_ID, PLACEHOLDER_PHOTO_URL);
    for (const asset of sampleAssets) {
      const url = signed.data?.get(previewPath(asset));
      if (url) map.set(asset.id, url);
    }
    return map;
  }, [logos, sampleAssets, signed.data]);

  // Hasta saber qué fotos hay (o que no hay) no se dibuja nada: así no se dibuja dos veces.
  const ready = !samples.isPending && (paths.length === 0 || !signed.isPending);
  const signature = usable
    .map((t, i) => `${t.id}:${hashOf(JSON.stringify(t.document))}:${i}`)
    .join('|')
    .concat(`#${sampleIds.join(',')}#${[...logos.keys()].sort().join(',')}`);

  const [previews, setPreviews] = useState<Map<string, TemplatePreview>>(new Map());

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    usable.forEach((template, index) => {
      const document = template.document!;
      const sampled = withSamplePhotos(document, sampleIds, index);
      const key = `${brandId}|${template.id}|${hashOf(JSON.stringify(sampled))}|${[...logos.keys()].sort().join(',')}`;
      void cachedPreview(key, () => renderPreview(sampled, lookup)).then((url) => {
        if (cancelled) return;
        setPreviews((current) =>
          new Map(current).set(template.id, url ? { status: 'ready', url } : { status: 'error' }),
        );
      });
    });
    return () => {
      cancelled = true;
    };
    // `signature` resume plantillas, fotos de ejemplo y logotipos; `lookup` cambia con ellos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, signature, brandId]);

  /** Estado de una plantilla: mientras no se pueda dibujar o no haya llegado, `loading`. */
  function previewOf(template: BrandTemplate): TemplatePreview {
    if (!template.document) return { status: 'error' };
    return previews.get(template.id) ?? { status: 'loading' };
  }

  /** Lo necesario para el esquema de reserva: la primera página con las fotos de ejemplo. */
  function fallbackOf(template: BrandTemplate) {
    const document = template.document!;
    const index = usable.findIndex((t) => t.id === template.id);
    const sampled = withSamplePhotos(document, sampleIds, Math.max(0, index));
    return { canvas: sampled.canvas, layers: sampled.pages[0]!.layers, images: lookup };
  }

  return { previewOf, fallbackOf };
}
