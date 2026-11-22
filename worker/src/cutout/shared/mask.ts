// COPIA GENERADA de src/features/photo-edit/cutout/mask.ts por scripts/sync-cutout.ts.
// No se edita aquí: se cambia el original y se ejecuta «npm run sync:cutout» en worker/.
// Matemática pura del recorte en el navegador: de la foto a la entrada del
// modelo, y de la máscara del modelo al canal alfa de la foto. Sin DOM ni
// onnxruntime, para probarla con vitest. Nunca modifica la imagen de entrada.
import type { Pixels } from './types.ts';
import { MODEL_SIDE } from './types.ts';
import { cleanOnlyMask, isnetInput, normalizePrediction, refineMask } from './refine.ts';

/** Ninguna parte de la foto se ha reconocido como sujeto. */
export class NoSubjectError extends Error {
  constructor() {
    super('No se ha encontrado nada que recortar en la foto.');
    this.name = 'NoSubjectError';
  }
}

export { resizeAreaChannel, resizeChannel } from './resample.ts';
import { resizeAreaChannel } from './resample.ts';

/** Medias y desviaciones de ImageNet, que es como entrenó BEN2. */
const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

/**
 * Foto → tensor CHW float32 de 1×3×lado×lado para BEN2: la foto se encaja,
 * deformándola, a lado × lado con buen remuestreo (promedio de área al
 * encogerla), se divide entre 255 y se normaliza con la media y la desviación de
 * ImageNet. El alfa se ignora (sobre blanco si la foto ya tenía transparencia).
 */
export function toBen2Input(image: Pixels, side = MODEL_SIDE): Float32Array {
  const n = side * side;
  const tensor = new Float32Array(3 * n);
  const channel = new Float32Array(image.width * image.height);
  for (let c = 0; c < 3; c += 1) {
    for (let i = 0; i < channel.length; i += 1) {
      const a = image.data[i * 4 + 3]! / 255;
      channel[i] = image.data[i * 4 + c]! * a + 255 * (1 - a);
    }
    const plane = resizeAreaChannel(channel, image.width, image.height, side, side);
    const mean = IMAGENET_MEAN[c]!;
    const std = IMAGENET_STD[c]!;
    for (let i = 0; i < n; i += 1) tensor[c * n + i] = (plane[i]! / 255 - mean) / std;
  }
  return tensor;
}

/**
 * Salida de BEN2 (`alphas`, ya entre 0 y 1) → máscara 0–255 para `applyMask`.
 * No se normaliza entre mínimo y máximo (cambiaría el matiz de los bordes) y se
 * deja sin cuantizar para no perder los medios tonos al escalar.
 */
export function ben2Mask(alphas: ArrayLike<number>): Float32Array {
  const out = new Float32Array(alphas.length);
  for (let i = 0; i < alphas.length; i += 1) {
    const v = alphas[i]!;
    out[i] = v >= 1 ? 255 : v > 0 ? v * 255 : 0; // NaN y negativos → 0
  }
  return out;
}

/**
 * Foto → tensor CHW float32 de 1×3×lado×lado, como espera IS-Net (ver
 * `isnetInput` en refine.ts: promedio de área al encoger, ÷ máximo − 0,5).
 */
export function toModelInput(image: Pixels, side = MODEL_SIDE): Float32Array {
  return isnetInput(image.data, image.width, image.height, side);
}

/** Salida del modelo (cualquier rango) → 0–255 normalizada entre su mínimo y su máximo. */
export const normalizeMask = normalizePrediction;

/** Fracción mínima de la foto que tiene que ser sujeto para dar el recorte por bueno. */
export const MIN_SUBJECT_FRACTION = 0.005;

/**
 * Pone la máscara del modelo como alfa de la foto, a resolución completa.
 *  - `refined` (IS-Net): limpieza de motas y agujeros + filtro guiado con la foto +
 *    curva suave (refine.ts). Si la foto ya tenía algo de transparencia, se multiplica.
 *  - `clean` (BEN2): la máscara ya es un alfa fino; solo se limpian motas, islas
 *    lejanas y agujeros y se reescala.
 * Lanza `NoSubjectError` si no queda sujeto. Devuelve una imagen nueva.
 */
export function applyMask(
  image: Pixels,
  mask: ArrayLike<number>,
  maskSide = MODEL_SIDE,
  mode: 'refined' | 'clean' = 'refined',
): Pixels {
  const input = { data: image.data, width: image.width, height: image.height, mask, maskSide };
  const { alpha, opaque } = mode === 'clean' ? cleanOnlyMask(input) : refineMask(input);
  if (opaque < alpha.length * MIN_SUBJECT_FRACTION) throw new NoSubjectError();
  const out = new Uint8ClampedArray(image.data);
  for (let i = 0; i < alpha.length; i += 1) out[i * 4 + 3] = Math.round((out[i * 4 + 3]! * alpha[i]!) / 255);
  return { data: out, width: image.width, height: image.height };
}
