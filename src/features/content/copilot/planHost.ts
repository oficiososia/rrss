// Lo que un plan del copiloto (plan.ts) pide al editor: generar el fondo,
// buscar fotos en la biblioteca y quitarles el fondo. Aquí no se inventa nada:
// se llama a lo que ya existe —`ai-media` (`image.estimate`, `image.generate`),
// la biblioteca de la marca y la cadena de recorte de «Editar foto»
// (`runQuickEdit`)— y cada recurso creado queda en la biblioteca con su
// procedencia de siempre (`ai_generation` el fondo, `photo_edit` los recortes).
import { generateImageAndWait, invokeAiMedia, type ImageEstimate } from '@/features/ai/imageApi';
import { fetchRecentImages } from '@/features/library/api';
import { canEditPhoto, fetchAsset, fetchPhotoEdits, signedUrlFor, type SaveEditInput } from '@/features/photo-edit/api';
import { canRemoveBackground, describeRemovalError } from '@/features/photo-edit/cutout/remover';
import { runQuickEdit } from '@/features/photo-edit/quickEdit';
import type { MediaAssetRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import type { CopilotAssetInfo } from './apply';
import { isCutout, isPlainCutoutOf, matchLibraryPhotos, type CopilotPlanHost, type LibraryPhoto, type PlanEnvironment } from './plan';

type AssetLike = Pick<MediaAssetRow, 'id' | 'file_name' | 'width' | 'height'> &
  Partial<Pick<MediaAssetRow, 'tags' | 'folder' | 'provenance'>>;

const toPhoto = (row: AssetLike): LibraryPhoto => ({
  id: row.id,
  name: row.file_name,
  width: row.width,
  height: row.height,
  tags: row.tags,
  folder: row.folder,
  provenance: row.provenance,
});
const toInfo = (row: AssetLike): CopilotAssetInfo => ({ id: row.id, name: row.file_name, width: row.width, height: row.height });

export interface PlanHostOptions {
  brandId: string;
  /** ¿Puede esta persona generar imágenes con IA en esta marca? Si no, por qué. */
  imageAi: PlanEnvironment['imageAi'];
  /** Guarda una foto editada como recurso nuevo de la biblioteca (`useSaveEdit`). */
  saveEdit: (input: SaveEditInput) => Promise<MediaAssetRow>;
  /** Tras crear algo en la biblioteca (para refrescar lo que la enseña). */
  onLibraryChange?: () => void;
}

export function createCopilotPlanHost({ brandId, imageAi, saveEdit, onLibraryChange }: PlanHostOptions): CopilotPlanHost {
  return {
    imageAi,
    canCutout: canRemoveBackground(),
    // El mismo cálculo que enseña «Generar imagen con IA»: no reserva ni gasta nada.
    estimateBackground: async (ratio) => {
      try {
        const estimate = await invokeAiMedia<ImageEstimate>('image.estimate', brandId, { prompt: '', aspectRatio: ratio });
        return Number.isFinite(estimate.costMicros) ? estimate.costMicros : null;
      } catch {
        return null;
      }
    },
    generateBackground: async (prompt, ratio, signal) => {
      const asset = await generateImageAndWait(brandId, { prompt, aspectRatio: ratio }, { signal });
      onLibraryChange?.();
      return toInfo(asset);
    },
    searchLibrary: async (query, count) =>
      matchLibraryPhotos((await fetchRecentImages(brandId)).map(toPhoto), query, count).map(
        ({ id, name, width, height }): CopilotAssetInfo => ({ id, name, width, height }),
      ),
    cutout: async (photo, signal) => {
      const row = await fetchAsset(brandId, photo.id);
      if (!row || !canEditPhoto(row)) throw new Error('Esa foto no se puede recortar.');
      // Ya recortada, o con un recorte suyo en la biblioteca: se usa ese (ni se repite el trabajo ni se duplica).
      if (isCutout(toPhoto(row))) return { asset: toInfo(row), created: false };
      const existing = (await fetchPhotoEdits(brandId, row.id)).find((edit) => isPlainCutoutOf(toPhoto(edit), row.id));
      if (existing) return { asset: toInfo(existing), created: false };
      const url = await signedUrlFor(row.storage_path);
      if (!url) throw new Error('No se ha podido abrir la foto.');
      try {
        const result = await runQuickEdit({ asset: row, url, edit: { kind: 'cutout' }, save: saveEdit, signal });
        onLibraryChange?.();
        return { asset: toInfo(result), created: true };
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(describeRemovalError(error) || translateError(error));
      }
    },
  };
}
