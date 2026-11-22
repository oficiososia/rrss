// Ediciones de fondo que hacen un archivo nuevo, para el panel de fotos del
// editor: quitar el fondo (el desenfoque del fondo es el «Modo retrato» de «Editar foto»). Cada
// resultado es un recurso NUEVO de la biblioteca (la original no se toca) y se
// guarda con su procedencia, igual que en «Editar foto».
import type { MediaAssetRow } from '@/lib/database.types';
import type { SaveEditInput } from './api';
import { encodePixels, loadPixels } from './canvas';
import { removeBackground, type CutoutProgress } from './cutout/remover';
import { editedFileName, photoEditProvenance, type PhotoEditStep } from './provenance';
import { analyzeImage } from './pixels';

export type QuickEdit = { kind: 'cutout' };

type Saver = (input: SaveEditInput) => Promise<MediaAssetRow>;

/**
 * Quita el fondo y guarda el
 * resultado en la biblioteca. Devuelve el recurso nuevo.
 */
export async function runQuickEdit(options: {
  asset: MediaAssetRow;
  url: string;
  edit: QuickEdit;
  save: Saver;
  onProgress?: (progress: CutoutProgress) => void;
}): Promise<MediaAssetRow> {
  const { asset, url, save, onProgress } = options;
  const { pixels } = await loadPixels(url);
  const cut = await removeBackground(pixels, onProgress, undefined, { brandId: asset.brand_id });
  const result = cut.pixels;
  const steps: PhotoEditStep[] = [{ kind: 'remove_background', engine: 'browser', model: cut.model }];
  const transparent = analyzeImage(result).transparent;
  const png = transparent || asset.mime_type === 'image/png';
  const blob = await encodePixels(result, png ? 'image/png' : 'image/jpeg');
  return save({
    source: asset,
    blob,
    fileName: editedFileName(asset.file_name, steps, png ? 'png' : 'jpg'),
    width: result.width,
    height: result.height,
    provenance: photoEditProvenance({ sourceAssetId: asset.id, steps, width: result.width, height: result.height }),
  });
}
