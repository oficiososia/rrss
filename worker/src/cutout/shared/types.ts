// Lo mínimo que necesitan los módulos copiados de `src/features/photo-edit/cutout/` (ver
// scripts/sync-cutout.ts): la forma de una imagen en memoria y el lado de entrada del modelo.
// A mano: en la aplicación vienen de `pixels.ts` y `model.ts`, que dependen del navegador.

/** Imagen RGBA en memoria: la forma de `ImageData`. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Lado fijo de la entrada del modelo (BEN2 e IS-Net: 1×3×1024×1024). */
export const MODEL_SIDE = 1024;
