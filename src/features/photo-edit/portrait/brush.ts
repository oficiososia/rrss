// «Retocar la selección»: un pincel que corrige la máscara del plato a mano.
// Los trazos se guardan en coordenadas NORMALIZADAS (0–1 sobre la foto y radio como
// fracción del lado menor), no en píxeles: así se repintan igual sobre la vista
// previa reducida y sobre la foto a tamaño completo. Añadir y quitar son
// idempotentes (máximo / mínimo), por eso pintar sobre la marcha, tramo a tramo,
// da lo mismo que repetir los trazos de golpe. Funciones puras, sin DOM.
import type { Pixels } from '../pixels';

export type BrushMode = 'add' | 'remove';

export interface BrushStroke {
  mode: BrushMode;
  /** Radio del pincel como fracción del lado menor de la foto. */
  radius: number;
  /** Puntos del trazo: x e y entre 0 y 1. Un solo punto es un toque. */
  points: Array<[number, number]>;
}

/** Hasta qué fracción del radio el pincel es pleno; de ahí al borde se desvanece. */
export const BRUSH_HARDNESS = 0.6;
export const BRUSH_MIN_RADIUS = 0.005;
export const BRUSH_MAX_RADIUS = 0.15;

/** Cobertura del pincel (0–1) a una distancia del eje del trazo. */
function coverage(distance: number, radius: number): number {
  const inner = radius * BRUSH_HARDNESS;
  if (distance <= inner) return 1;
  if (distance >= radius) return 0;
  const t = (distance - inner) / (radius - inner);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Pinta un tramo (de `a` a `b`, en píxeles) sobre la máscara 0–255, en el sitio.
 * `add` sube el alfa hasta la cobertura; `remove` lo baja hasta lo que queda libre.
 */
export function paintSegment(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  a: readonly [number, number],
  b: readonly [number, number],
  radiusPx: number,
  mode: BrushMode,
): void {
  const r = Math.max(0.5, radiusPx);
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 1));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0]) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 1));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1]) + r + 1));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5 - a[0];
      const py = y + 0.5 - a[1];
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
      const cx = px - t * dx;
      const cy = py - t * dy;
      const c = coverage(Math.hypot(cx, cy), r);
      if (c <= 0) continue;
      const i = y * width + x;
      if (mode === 'add') {
        const v = Math.round(255 * c);
        if (v > alpha[i]!) alpha[i] = v;
      } else {
        const v = Math.round(255 * (1 - c));
        if (v < alpha[i]!) alpha[i] = v;
      }
    }
  }
}

/** Pinta un trazo entero (sus puntos normalizados) sobre una máscara de `width × height`. */
export function paintStroke(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  stroke: BrushStroke,
): void {
  const radiusPx = stroke.radius * Math.min(width, height);
  const px = stroke.points.map(([x, y]) => [x * width, y * height] as const);
  if (px.length === 1) paintSegment(alpha, width, height, px[0]!, px[0]!, radiusPx, stroke.mode);
  for (let i = 1; i < px.length; i += 1) paintSegment(alpha, width, height, px[i - 1]!, px[i]!, radiusPx, stroke.mode);
}

/** La máscara base con los trazos encima, a las medidas que se pidan. No modifica la base. */
export function applyStrokes(
  base: ArrayLike<number>,
  width: number,
  height: number,
  strokes: readonly BrushStroke[],
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = base[i]!;
  for (const stroke of strokes) paintStroke(out, width, height, stroke);
  return out;
}

/** La foto con otro alfa (los colores son los de la foto; el alfa de la foto se multiplica). Imagen nueva. */
export function withAlpha(image: Pixels, alpha: ArrayLike<number>): Pixels {
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < alpha.length; i += 1) data[i * 4 + 3] = Math.round((data[i * 4 + 3]! * alpha[i]!) / 255);
  return { data, width: image.width, height: image.height };
}

/**
 * La foto con la selección como un VELO de color encima del plato (para ver qué
 * está dentro y qué fuera mientras se retoca). Imagen nueva y opaca.
 */
export function veilOver(
  image: Pixels,
  alpha: ArrayLike<number>,
  color: readonly [number, number, number] = [236, 72, 153],
  strength = 0.5,
): Pixels {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < alpha.length; i += 1) {
    const k = (alpha[i]! / 255) * strength;
    const o = i * 4;
    out[o] = image.data[o]! * (1 - k) + color[0] * k;
    out[o + 1] = image.data[o + 1]! * (1 - k) + color[1] * k;
    out[o + 2] = image.data[o + 2]! * (1 - k) + color[2] * k;
    out[o + 3] = 255;
  }
  return { data: out, width: image.width, height: image.height };
}
