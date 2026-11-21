// Punto único para quitar el fondo de una foto en el navegador: foto → la misma
// foto con el fondo transparente. Todo lo que necesite un recorte (el diálogo
// «Editar foto» y el panel de fotos del editor) pasa por aquí, así el motor
// (BEN2 con WebGPU, IS-Net de respaldo; ver engine.ts) se puede cambiar sin tocar a quien lo usa.
import type { Pixels } from '../pixels';
import {
  cutoutSupport,
  describeCutoutError,
  removeBackgroundInBrowser,
  type CutoutProgress,
  type CutoutSupport,
} from './engine';

export interface BackgroundRemoval {
  /** Misma foto con el fondo transparente (mismas medidas que la entrada). */
  pixels: Pixels;
  /** Nombre del modelo, para la procedencia del resultado. */
  model: string;
  /** `high` (BEN2) o `basic` (respaldo sin WebGPU o tras un fallo): la interfaz lo dice. */
  quality: 'high' | 'basic';
}

/** ¿Puede este navegador quitar el fondo? Si no, el botón no sale. */
export function removalSupport(): CutoutSupport {
  return cutoutSupport();
}

export function canRemoveBackground(): boolean {
  return cutoutSupport().ok;
}

export function describeRemovalError(error: unknown): string {
  return describeCutoutError(error);
}

export async function removeBackground(
  image: Pixels,
  onProgress?: (progress: CutoutProgress) => void,
  signal?: AbortSignal,
): Promise<BackgroundRemoval> {
  const result = await removeBackgroundInBrowser(image, onProgress, { signal });
  return { pixels: result.pixels, model: result.model, quality: result.quality };
}

/** ¿Lo canceló quien lo pidió? (no es un error que contar). */
export { isCutoutCancelled as isRemovalCancelled } from './engine';

export type { CutoutProgress };
