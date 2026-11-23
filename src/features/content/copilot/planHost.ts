// Lo que un plan del copiloto (plan.ts) pide al editor: generar el fondo,
// buscar fotos en la biblioteca y quitarles el fondo. Aquí no se inventa nada:
// se llama a lo que ya existe —`ai-media` (`image.estimate`, `image.generate`),
// la biblioteca de la marca y la cadena de recorte de «Editar foto»
// (`runQuickEdit`)— y cada recurso creado queda en la biblioteca con su
// procedencia de siempre (`ai_generation` el fondo, `photo_edit` los recortes).
import { generateImageWithCost, invokeAiMedia, type ImageEstimate } from '@/features/ai/imageApi';
import { fetchRecentImages } from '@/features/library/api';
import { canEditPhoto, fetchAsset, fetchPhotoEdits, signedUrlFor, type SaveEditInput } from '@/features/photo-edit/api';
import { canRemoveBackground, describeRemovalError } from '@/features/photo-edit/cutout/remover';
import { runQuickEdit } from '@/features/photo-edit/quickEdit';
import type { MediaAssetRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import type { CopilotAssetInfo } from './apply';
import { measureTone, type MeasuredTone } from './legibility';
import { subjectBounds, type SubjectBox } from './subject';
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

/** Lado mayor del lienzo reducido en el que se mide el tono de una imagen: de sobra para una rejilla de 8 × 8. */
const TONE_SAMPLE_SIDE = 64;
/** Lo que se espera, como mucho, a que cargue la imagen que se va a medir. */
export const TONE_TIMEOUT_MS = 8000;

/**
 * Carga una imagen (con CORS, como el lienzo del editor) y mide su tono medio y
 * por zonas dibujándola reducida en un `canvas`. `null` si no se puede: sin
 * `canvas` 2D, la imagen no carga a tiempo, o el navegador no deja leer sus
 * píxeles (otro origen sin CORS: el lienzo queda «manchado»). No es un fallo
 * del plan: quien llama pone a los textos un respaldo que se lee igual.
 */
export function readImageTone(url: string, signal?: AbortSignal, timeoutMs = TONE_TIMEOUT_MS): Promise<MeasuredTone | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined' || signal?.aborted) return resolve(null);
    const image = new Image();
    // Se deja de esperar a la imagen pasado un tiempo o si el plan se cancela.
    function settle(tone: MeasuredTone | null) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', give);
      image.onload = null;
      image.onerror = null;
      resolve(tone);
    }
    function give() {
      settle(null);
    }
    const timer = setTimeout(give, timeoutMs);
    signal?.addEventListener('abort', give, { once: true });
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onerror = give;
    image.onload = () => {
      try {
        const scale = Math.min(1, TONE_SAMPLE_SIDE / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context || !image.naturalWidth || !image.naturalHeight) return settle(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const measured = measureTone(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        // La rejilla habla de la imagen entera: su proporción es la real, no la del lienzo reducido.
        settle(measured ? { ...measured, grid: { ...measured.grid, aspect: image.naturalWidth / image.naturalHeight } } : null);
      } catch {
        settle(null);
      }
    };
    image.src = url;
  });
}

/**
 * Carga una imagen recortada (con CORS) y dice qué parte ocupa lo que se ve:
 * la caja de los píxeles opacos, en fracciones. `null` si no se puede leer o
 * no hay nada que recortar (la foto ya ocupa casi todo).
 */
export function readSubjectBounds(url: string, signal?: AbortSignal, timeoutMs = TONE_TIMEOUT_MS): Promise<SubjectBox | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined' || signal?.aborted) return resolve(null);
    const image = new Image();
    function settle(box: SubjectBox | null) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', give);
      image.onload = null;
      image.onerror = null;
      resolve(box);
    }
    function give() {
      settle(null);
    }
    const timer = setTimeout(give, timeoutMs);
    signal?.addEventListener('abort', give, { once: true });
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onerror = give;
    image.onload = () => {
      try {
        // 256 px de lado mayor: de sobra para saber dónde empieza y acaba lo recortado.
        const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context || !image.naturalWidth || !image.naturalHeight) return settle(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        settle(subjectBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
      } catch {
        settle(null);
      }
    };
    image.src = url;
  });
}

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
  /** Dónde está guardado lo que se acaba de generar: para medirlo sin volver a preguntar a la base de datos. */
  const generatedPaths = new Map<string, string>();
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
      const { asset, costMicros } = await generateImageWithCost(brandId, { prompt, aspectRatio: ratio }, { signal });
      if (asset.storage_path) generatedPaths.set(asset.id, asset.storage_path);
      onLibraryChange?.();
      // Lo que ha costado de verdad: el copiloto lo dice junto a la orden (nunca «Sin IA» si se ha gastado).
      return { ...toInfo(asset), costMicros };
    },
    // El tono del fondo recién generado (medio y por zonas), para que los textos se lean encima. Leer no gasta.
    measureTone: async (image, signal) => {
      try {
        const path = generatedPaths.get(image.id) ?? (await fetchAsset(brandId, image.id))?.storage_path;
        const url = path ? await signedUrlFor(path) : undefined;
        return url ? await readImageTone(url, signal) : null;
      } catch {
        return null;
      }
    },
    // Dónde está lo recortado dentro de un recorte (sin su aire transparente), para que no quede diminuto. Leer no gasta.
    measureSubject: async (image, signal) => {
      try {
        const row = await fetchAsset(brandId, image.id);
        const url = row?.storage_path ? await signedUrlFor(row.storage_path) : undefined;
        return url ? await readSubjectBounds(url, signal) : null;
      } catch {
        return null;
      }
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
