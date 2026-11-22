// COPIA GENERADA de src/features/photo-edit/cutout/refine.ts por scripts/sync-cutout.ts.
// No se edita aquí: se cambia el original y se ejecuta «npm run sync:cutout» en worker/.
// Refinado de la máscara del recorte (matemática pura, SIN DOM y con una sola
// importación con extensión `.js`: lo usan el navegador y la función del servidor
// `api/cutout-mask.ts`, que corre en Node/ESM). Portado del panel del restaurante
// (`refinarMascara.ts`) y generalizado; docs/edicion-fotos.md, §7.
//
// Por qué existe. IS-Net da un mapa de 1024×1024, borroso en los bordes y con
// dudas en lo que se parece al fondo (una bandeja clara sobre un mueble
// metálico, un plato blanco). Reescalarlo y pasarle una curva dejaba cortes en
// diagonal, agujeros dentro del plato y bordes sucios. Se corrige en tres pasos:
//   1. `cleanMask`: quita motas e islas pequeñas de fondo lejos del sujeto y
//      rellena agujeros pequeños dentro (áreas relativas, conectividad 8 para lo
//      opaco: una antena o una pata fina unida al cuerpo se conserva).
//   2. Filtro guiado (He et al., 2010) con la luminancia de la propia foto: el
//      borde de la máscara se pega a los bordes reales de la imagen.
//   3. Curva suave (smoothstep) → alfa con 1–2 px de transición, no binaria.
// Para fotos grandes: los coeficientes del filtro se calculan a una resolución
// de trabajo (≤ 1600 px) y se aplican a la resolución completa interpolando
// («fast guided filter»), así no hacen falta buffers float del tamaño de 24 MP.
import { resizeAreaChannel } from './resample.ts';

export interface CleanOptions {
  /** 0–255: a partir de aquí un píxel cuenta como sujeto al buscar islas. */
  threshold?: number;
  /** 0–255: por debajo de esto un píxel cuenta como fondo al buscar agujeros. */
  holeThreshold?: number;
  /** Componentes con menos área que esta fracción de la imagen se quitan siempre (motas). */
  speckFraction?: number;
  /** Islas con menos área que esta fracción se quitan si están lejos del sujeto principal. */
  islandFraction?: number;
  /** «Lejos» = fuera de la caja del principal ampliada esta fracción de la diagonal. */
  islandMargin?: number;
  /** Agujeros cerrados (sin tocar el borde) con menos área que esta fracción se rellenan siempre. */
  holeFraction?: number;
  /** Agujeros algo mayores (hasta esta fracción) se rellenan solo si el modelo DUDABA en ellos. */
  doubtfulHoleFraction?: number;
  /** Valor medio (0–255) de la máscara en un agujero para considerar que dudaba. */
  holeDoubt?: number;
}

export const CLEAN_DEFAULTS: Required<CleanOptions> = {
  threshold: 96,
  holeThreshold: 128,
  speckFraction: 0.0001,
  islandFraction: 0.003,
  islandMargin: 0.03,
  holeFraction: 0.0003,
  doubtfulHoleFraction: 0.01,
  holeDoubt: 40,
};

/** Área mínima absoluta (px) de una mota, para imágenes pequeñas. */
const MIN_SPECK_PX = 6;

interface Components {
  labels: Int32Array;
  area: number[];
  box: number[][];
  touchesEdge: boolean[];
  sum: number[];
}

/** Componentes conexas de los píxeles con `inside[i] !== 0` (inundación con pila explícita). */
function components(
  width: number,
  height: number,
  inside: Uint8Array,
  eight: boolean,
  value?: ArrayLike<number>,
): Components {
  const n = width * height;
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const area: number[] = [0];
  const box: number[][] = [[0, 0, 0, 0]];
  const touchesEdge: boolean[] = [false];
  const sum: number[] = [0];
  const lastX = width - 1;
  const lastY = height - 1;
  let next = 0;
  for (let start = 0; start < n; start += 1) {
    if (labels[start] !== 0 || inside[start] === 0) continue;
    next += 1;
    let count = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let total = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    const label = next;
    const push = (j: number) => {
      if (labels[j] === 0 && inside[j] !== 0) {
        labels[j] = label;
        stack[top++] = j;
      }
    };
    while (top > 0) {
      const i = stack[--top]!;
      const y = (i / width) | 0;
      const x = i - y * width;
      count += 1;
      if (value) total += value[i]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const left = x > 0;
      const right = x < lastX;
      const up = y > 0;
      const down = y < lastY;
      if (left) push(i - 1);
      if (right) push(i + 1);
      if (up) push(i - width);
      if (down) push(i + width);
      if (eight) {
        if (up && left) push(i - width - 1);
        if (up && right) push(i - width + 1);
        if (down && left) push(i + width - 1);
        if (down && right) push(i + width + 1);
      }
    }
    area.push(count);
    box.push([x0, y0, x1, y1]);
    touchesEdge.push(x0 === 0 || y0 === 0 || x1 === lastX || y1 === lastY);
    sum.push(total);
  }
  return { labels, area, box, touchesEdge, sum };
}

function binary(m: Uint8Array, threshold: number, atLeast: boolean): Uint8Array {
  const out = new Uint8Array(m.length);
  if (atLeast) for (let i = 0; i < m.length; i += 1) out[i] = m[i]! >= threshold ? 1 : 0;
  else for (let i = 0; i < m.length; i += 1) out[i] = m[i]! < threshold ? 1 : 0;
  return out;
}

/**
 * Quita motas e islas pequeñas lejos del sujeto y rellena agujeros pequeños
 * dentro (ver cabecera). Solo cambia esos píxeles a 0 o 255: el resto de la
 * máscara (medios tonos de los bordes) queda como estaba. Devuelve una máscara
 * nueva 0–255; la entrada no se toca.
 */
export function cleanMask(m: Uint8Array, width: number, height: number, options: CleanOptions = {}): Uint8Array {
  const o = { ...CLEAN_DEFAULTS, ...options };
  const n = width * height;
  const out = new Uint8Array(m);
  if (n === 0) return out;

  // Islas: lo opaco, conectividad 8 (las líneas finas en diagonal siguen unidas).
  const fg = components(width, height, binary(m, o.threshold, true), true);
  const count = fg.area.length - 1;
  if (count > 1) {
    let main = 1;
    for (let e = 2; e <= count; e += 1) if (fg.area[e]! > fg.area[main]!) main = e;
    const margin = o.islandMargin * Math.hypot(width, height);
    const [mx0, my0, mx1, my1] = fg.box[main]! as [number, number, number, number];
    const speck = Math.max(MIN_SPECK_PX, o.speckFraction * n);
    const island = o.islandFraction * n;
    const drop = new Uint8Array(count + 1);
    for (let e = 1; e <= count; e += 1) {
      if (e === main) continue;
      const a = fg.area[e]!;
      if (a < speck) {
        drop[e] = 1;
        continue;
      }
      if (a >= island) continue;
      const [x0, y0, x1, y1] = fg.box[e]! as [number, number, number, number];
      const far = x1 < mx0 - margin || x0 > mx1 + margin || y1 < my0 - margin || y0 > my1 + margin;
      if (far) drop[e] = 1;
    }
    for (let i = 0; i < n; i += 1) {
      const e = fg.labels[i]!;
      if (e && drop[e]) out[i] = 0;
    }
  }

  // Agujeros: fondo cerrado, conectividad 4 (el complemento de la 8).
  const bg = components(width, height, binary(out, o.holeThreshold, false), false, out);
  const maxHole = o.holeFraction * n;
  const maxDoubtful = o.doubtfulHoleFraction * n;
  const fill = new Uint8Array(bg.area.length);
  let any = false;
  for (let e = 1; e < bg.area.length; e += 1) {
    if (bg.touchesEdge[e]) continue;
    const a = bg.area[e]!;
    if (a < maxHole || (a < maxDoubtful && bg.sum[e]! / a >= o.holeDoubt)) {
      fill[e] = 1;
      any = true;
    }
  }
  if (any) {
    for (let i = 0; i < n; i += 1) {
      const e = bg.labels[i]!;
      if (e && fill[e]) out[i] = 255;
    }
  }
  return out;
}

let boxTmp = new Float32Array(0);
let boxCol = new Float64Array(0);

/**
 * Media en una ventana (2r+1)² recortada en los bordes. Separable con sumas
 * deslizantes: O(n) para cualquier r. `out` puede ser el mismo array que `src`.
 */
export function boxMean(
  src: Float32Array,
  width: number,
  height: number,
  r: number,
  out = new Float32Array(src.length),
): Float32Array {
  const n = width * height;
  if (boxTmp.length < n) boxTmp = new Float32Array(n);
  if (boxCol.length < width) boxCol = new Float64Array(width);
  const tmp = boxTmp;
  for (let y = 0; y < height; y += 1) {
    const base = y * width;
    let s = 0;
    for (let x = 0; x <= Math.min(r, width - 1); x += 1) s += src[base + x]!;
    for (let x = 0; x < width; x += 1) {
      const a = x - r;
      const b = x + r;
      tmp[base + x] = s / (Math.min(width - 1, b) - Math.max(0, a) + 1);
      if (b + 1 < width) s += src[base + b + 1]!;
      if (a >= 0) s -= src[base + a]!;
    }
  }
  const col = boxCol;
  col.fill(0, 0, width);
  for (let y = 0; y <= Math.min(r, height - 1); y += 1) {
    const base = y * width;
    for (let x = 0; x < width; x += 1) col[x] = col[x]! + tmp[base + x]!;
  }
  for (let y = 0; y < height; y += 1) {
    const a = y - r;
    const b = y + r;
    const inv = 1 / (Math.min(height - 1, b) - Math.max(0, a) + 1);
    const base = y * width;
    for (let x = 0; x < width; x += 1) out[base + x] = col[x]! * inv;
    if (b + 1 < height) {
      const add = (b + 1) * width;
      for (let x = 0; x < width; x += 1) col[x] = col[x]! + tmp[add + x]!;
    }
    if (a >= 0) {
      const sub = a * width;
      for (let x = 0; x < width; x += 1) col[x] = col[x]! - tmp[sub + x]!;
    }
  }
  return out;
}

/** Luminancia 0–1 (Rec. 601) de un RGBA, con la transparencia puesta sobre blanco. */
export function luminance(rgba: ArrayLike<number>, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const a = rgba[o + 3]! / 255;
    const lum = 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
    out[i] = (lum * a + 255 * (1 - a)) / 255;
  }
  return out;
}

/** Radio del filtro guiado según el tamaño (≈ ancho de la franja dudosa de la máscara reescalada). */
export function guidedRadius(width: number, height: number): number {
  return Math.max(2, Math.min(8, Math.round(Math.max(width, height) / 320)));
}

/** Regularización del filtro guiado (guía en 0–1): bordes con desviación > ~0,03 se respetan. */
export const GUIDED_EPS = 1e-3;

/**
 * Coeficientes medios (ā, b̄) del filtro guiado: q = ā·I + b̄. `guide` en 0–1 y
 * `input` (máscara) en 0–1, ambos width×height. Devuelve arrays nuevos.
 */
export function guidedCoefficients(
  guide: Float32Array,
  input: Float32Array,
  width: number,
  height: number,
  r = guidedRadius(width, height),
  eps = GUIDED_EPS,
): { a: Float32Array; b: Float32Array } {
  const n = width * height;
  const mI = boxMean(guide, width, height, r);
  const mP = boxMean(input, width, height, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) a[i] = guide[i]! * input[i]!;
  boxMean(a, width, height, r, a);
  for (let i = 0; i < n; i += 1) b[i] = guide[i]! * guide[i]!;
  boxMean(b, width, height, r, b);
  for (let i = 0; i < n; i += 1) {
    const cov = a[i]! - mI[i]! * mP[i]!;
    const variance = b[i]! - mI[i]! * mI[i]!;
    const ai = cov / (variance + eps);
    a[i] = ai;
    b[i] = mP[i]! - ai * mI[i]!;
  }
  boxMean(a, width, height, r, a);
  boxMean(b, width, height, r, b);
  return { a, b };
}

/**
 * Rampa de la máscara ANTES del filtro guiado: por debajo de `low` es fondo, por
 * encima de `high` sujeto y en medio una transición lineal. Sin ella el velo
 * débil que el modelo deja sobre el fondo (10–30 %) salía semitransparente.
 */
export const RAMP_LOW = 0.45;
export const RAMP_HIGH = 0.55;

export function guidedInput(m: ArrayLike<number>, low = RAMP_LOW, high = RAMP_HIGH): Float32Array {
  const out = new Float32Array(m.length);
  const k = 1 / (high - low);
  for (let i = 0; i < m.length; i += 1) {
    const t = (m[i]! / 255 - low) * k;
    out[i] = t <= 0 ? 0 : t >= 1 ? 1 : t;
  }
  return out;
}

/** Curva final del alfa: smoothstep entre `CURVE_LOW` y `CURVE_HIGH` (0–1) → 0–255. */
export const CURVE_LOW = 0.25;
export const CURVE_HIGH = 0.75;

function curve(q: number): number {
  const t = (q - CURVE_LOW) / (CURVE_HIGH - CURVE_LOW);
  if (t <= 0) return 0;
  if (t >= 1) return 255;
  return Math.round(t * t * (3 - 2 * t) * 255);
}

/** Lado mayor de trabajo del refinado (el alfa final se aplica a la resolución completa). */
export const REFINE_WORK_SIDE = 1600;

/** Medidas de trabajo: lado mayor como mucho `maxSide`, sin agrandar. */
export function workSize(width: number, height: number, maxSide = REFINE_WORK_SIDE): { width: number; height: number } {
  const s = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

export interface RefineInput {
  /** RGBA de la foto (no se modifica). */
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Máscara del modelo 0–255, maskSide×maskSide. */
  mask: ArrayLike<number>;
  maskSide: number;
}

export interface RefineResult {
  /** Alfa 0–255 de la foto entera (sin multiplicar por la transparencia que ya tuviera). */
  alpha: Uint8Array;
  /** Píxeles con alfa > 127. */
  opaque: number;
}

function toUint8(src: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 1) {
    const v = Math.round(src[i]!);
    out[i] = v < 0 || Number.isNaN(v) ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

function count127(alpha: Uint8Array): number {
  let opaque = 0;
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i]! > 127) opaque += 1;
  return opaque;
}

/**
 * Máscara de IS-Net → alfa a resolución completa: limpieza + filtro guiado con la
 * luminancia de la foto + curva suave. Es lo que hace el panel del restaurante y
 * sustituye al `post_process` de rembg (apertura + gaussiana + umbral), que borraba
 * lo fino y dejaba el borde en escalera.
 */
export function refineMask(input: RefineInput): RefineResult {
  const { data, width, height, mask, maskSide } = input;
  const work = workSize(width, height);
  const gray = toUint8(resizeAreaChannel(mask, maskSide, maskSide, work.width, work.height));
  const cleaned = cleanMask(gray, work.width, work.height);
  const full = luminance(data, width * height);
  const guide =
    work.width === width && work.height === height
      ? full
      : resizeAreaChannel(full, width, height, work.width, work.height);
  const { a, b } = guidedCoefficients(guide, guidedInput(cleaned), work.width, work.height);
  const alpha = new Uint8Array(width * height);
  const sx = work.width / width;
  const sy = work.height / height;
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(work.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(work.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(work.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(work.width - 1, x0 + 1);
      const tx = fx - x0;
      const i00 = y0 * work.width + x0;
      const i01 = y0 * work.width + x1;
      const i10 = y1 * work.width + x0;
      const i11 = y1 * work.width + x1;
      const w00 = (1 - tx) * (1 - ty);
      const w01 = tx * (1 - ty);
      const w10 = (1 - tx) * ty;
      const w11 = tx * ty;
      const ai = a[i00]! * w00 + a[i01]! * w01 + a[i10]! * w10 + a[i11]! * w11;
      const bi = b[i00]! * w00 + b[i01]! * w01 + b[i10]! * w10 + b[i11]! * w11;
      alpha[y * width + x] = curve(ai * full[y * width + x]! + bi);
    }
  }
  return { alpha, opaque: count127(alpha) };
}

/**
 * Máscara de BEN2 (ya un alfa fino de 0 a 1, por 255) → alfa a resolución
 * completa: solo se limpian motas, islas lejanas y agujeros (a 0 o a 255) y se
 * reescala. Sin filtro guiado ni curva: endurecería los medios tonos que BEN2
 * ya acierta (pelo, cristal, bordes).
 */
export function cleanOnlyMask(input: RefineInput): RefineResult {
  const { width, height, mask, maskSide } = input;
  const cleaned = cleanMask(toUint8(mask), maskSide, maskSide);
  const alpha = toUint8(resizeAreaChannel(cleaned, maskSide, maskSide, width, height));
  return { alpha, opaque: count127(alpha) };
}

/** Salida de IS-Net (cualquier rango) → 0–255 normalizada entre su mínimo y su máximo. */
export function normalizePrediction(prediction: ArrayLike<number>): Uint8Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < prediction.length; i += 1) {
    const v = prediction[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Uint8Array(prediction.length);
  const range = max - min;
  if (!(range > 0)) return out;
  for (let i = 0; i < prediction.length; i += 1) out[i] = Math.floor(((prediction[i]! - min) / range) * 255);
  return out;
}

/**
 * RGBA (width×height, no se toca) → tensor CHW float32 de 1×3×side×side como
 * espera IS-Net: se encaja la foto, deformándola, a side×side PROMEDIANDO el área
 * al encogerla (no tomando 2×2 vecinos: con fotos de 12 MP o más, el muestreo
 * bilinear salta la mayoría de los píxeles y mete ruido y bordes sucios), se
 * divide entre el valor máximo y se resta 0,5. La transparencia se pone sobre blanco.
 */
export function isnetInput(rgba: ArrayLike<number>, width: number, height: number, side: number): Float32Array {
  const n = side * side;
  const planes: Float32Array[] = [];
  const channel = new Float32Array(width * height);
  for (let c = 0; c < 3; c += 1) {
    for (let i = 0; i < channel.length; i += 1) {
      const a = rgba[i * 4 + 3]! / 255;
      channel[i] = rgba[i * 4 + c]! * a + 255 * (1 - a);
    }
    planes[c] = resizeAreaChannel(channel, width, height, side, side);
  }
  let max = 0;
  for (const plane of planes) for (let i = 0; i < n; i += 1) if (plane[i]! > max) max = plane[i]!;
  const divisor = Math.max(max, 1e-6);
  const tensor = new Float32Array(3 * n);
  for (let c = 0; c < 3; c += 1) {
    const plane = planes[c]!;
    for (let i = 0; i < n; i += 1) tensor[c * n + i] = plane[i]! / divisor - 0.5;
  }
  return tensor;
}
