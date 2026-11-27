// «Modo retrato»: desenfocar SOLO el fondo y dejar el plato nítido, con un
// desenfoque que se parece al de una lente y no a un gaussiano plano.
// Matemática pura sobre `Pixels` y un alfa 0–255 (el plato), sin DOM ni modelo:
// se prueba con vitest y se usa igual en la vista previa y al guardar.
//
// Por qué no basta con difuminar la foto y pegar el plato encima: el difuminado
// mezcla el color del plato con el del fondo cerca del borde, y al pegar el plato
// queda un halo de su color alrededor. Aquí:
//   1. Se descarta del fondo todo lo que toca al plato (el alfa se DILATA unos
//      píxeles: el borde suave del recorte también lleva color del plato).
//   2. El difuminado es «normalizado»: promedia solo píxeles de fondo y divide por
//      el peso que ha reunido, así el hueco que deja el plato se RELLENA con el
//      color del fondo de alrededor y el plato no «sangra» en el fondo.
//   3. Lo brillante pesa más (desenfoque de lente: las luces del fondo se abren).
//   4. Desenfoque PROGRESIVO opcional: más borroso cuanto más lejos del plato
//      (varios niveles de desenfoque mezclados según la distancia).
//   5. «Resaltar el plato» oscurece un poco el fondo.
//   6. El plato se pega con su alfa, ligeramente suavizado en el borde.
// El desenfoque (que es de baja frecuencia) se calcula en una versión reducida y
// se amplía; el pegado se hace a tamaño completo con el alfa completo, así el
// borde del plato conserva todo su detalle y la vista previa y el archivo guardado
// salen igual.
import type { Pixels } from '../pixels';
import { boxBlur } from '../cutout/composition';
import { resizeAreaChannel, resizeChannel } from '../cutout/resample';

export interface PortraitOptions {
  /** Intensidad del desenfoque, de 1 a 100. */
  amount: number;
  /** Más borroso cuanto más lejos del plato. */
  progressive: boolean;
  /** «Resaltar el plato»: cuánto se oscurece el fondo, de 0 a 100 (100 = a la mitad). */
  dim: number;
}

export const PORTRAIT_DEFAULTS: PortraitOptions = { amount: 60, progressive: true, dim: 0 };
export const PORTRAIT_MIN_AMOUNT = 1;
export const PORTRAIT_MAX_AMOUNT = 100;

/** Lado mayor con el que se calcula el desenfoque (se amplía después). */
export const PORTRAIT_WORK_SIDE = 720;
/** Radio máximo del desenfoque, como fracción del lado mayor. */
const MAX_BLUR = 0.04;
/** Hasta dónde llega el desenfoque progresivo, como fracción del lado menor. */
const PROGRESSIVE_REACH = 0.18;
const LEVELS = 4;
/** Cuánto pesan las luces del fondo de más (apertura de la lente). */
const BLOOM = 3;
/** Un poco de color de reserva donde no queda fondo cerca (regulariza la división). */
const LAMBDA = 0.01;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Normaliza las opciones a rangos válidos. */
export function normalizeOptions(options: Partial<PortraitOptions> = {}): PortraitOptions {
  const merged = { ...PORTRAIT_DEFAULTS, ...options };
  return {
    amount: Math.min(PORTRAIT_MAX_AMOUNT, Math.max(PORTRAIT_MIN_AMOUNT, Math.round(merged.amount))),
    progressive: Boolean(merged.progressive),
    dim: Math.min(100, Math.max(0, Math.round(merged.dim))),
  };
}

/** Máximo móvil separable (dilatación) de un canal 0–1. */
function dilate(channel: Float32Array, width: number, height: number, radius: number): Float32Array {
  if (radius <= 0) return channel;
  const tmp = new Float32Array(channel.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let m = 0;
      const from = Math.max(0, x - radius);
      const to = Math.min(width - 1, x + radius);
      for (let k = from; k <= to; k += 1) if (channel[row + k]! > m) m = channel[row + k]!;
      tmp[row + x] = m;
    }
  }
  const out = new Float32Array(channel.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let m = 0;
      const from = Math.max(0, y - radius);
      const to = Math.min(height - 1, y + radius);
      for (let k = from; k <= to; k += 1) if (tmp[k * width + x]! > m) m = tmp[k * width + x]!;
      out[y * width + x] = m;
    }
  }
  return out;
}

/** Distancia (en píxeles) de cada píxel al plato (alfa ≥ 0,5), con una aproximación de 2 pasadas. */
function distanceToSubject(alpha: Float32Array, width: number, height: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i += 1) d[i] = alpha[i]! >= 0.5 ? 0 : INF;
  const D2 = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (y > 0) {
        v = Math.min(v, d[i - width]! + 1);
        if (x > 0) v = Math.min(v, d[i - width - 1]! + D2);
        if (x < width - 1) v = Math.min(v, d[i - width + 1]! + D2);
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      let v = d[i]!;
      if (x < width - 1) v = Math.min(v, d[i + 1]! + 1);
      if (y < height - 1) {
        v = Math.min(v, d[i + width]! + 1);
        if (x < width - 1) v = Math.min(v, d[i + width + 1]! + D2);
        if (x > 0) v = Math.min(v, d[i + width - 1]! + D2);
      }
      d[i] = v;
    }
  }
  return d;
}

interface WorkPlanes {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  width: number;
  height: number;
}

/**
 * Fondo desenfocado y rellenado, a la resolución de trabajo, como tres planos
 * 0–255. Es lo que se ve detrás del plato (el plato en sí no entra).
 */
function blurredBackground(image: Pixels, alpha: ArrayLike<number>, options: PortraitOptions): WorkPlanes {
  const scale = Math.min(1, PORTRAIT_WORK_SIDE / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const n = w * h;
  const long = Math.max(w, h);
  const short = Math.min(w, h);

  // Colores y alfa a la resolución de trabajo.
  const src = [0, 1, 2].map((c) => {
    const plane = new Float32Array(image.width * image.height);
    for (let i = 0; i < plane.length; i += 1) plane[i] = image.data[i * 4 + c]!;
    return scale === 1 ? plane : resizeAreaChannel(plane, image.width, image.height, w, h);
  }) as [Float32Array, Float32Array, Float32Array];
  const a0 = new Float32Array(image.width * image.height);
  for (let i = 0; i < a0.length; i += 1) a0[i] = clamp01((alpha[i] ?? 0) / 255);
  const a = scale === 1 ? a0 : resizeAreaChannel(a0, image.width, image.height, w, h);

  // Lo que toca al plato no es fondo: se dilata (también su borde suave, que lleva su color).
  const band = Math.max(1, Math.round(0.004 * long));
  const solid = new Float32Array(n);
  for (let i = 0; i < n; i += 1) solid[i] = clamp01(a[i]! * 8);
  const grown = boxBlur(dilate(solid, w, h, band), w, h, Math.max(1, Math.round(band / 2)));

  // Peso de cada píxel de fondo: 1 − plato, y las luces cuentan más (lente).
  const weight = new Float32Array(n);
  let wSum = 0;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const bg = clamp01(1 - grown[i]! * 1.5);
    const lum = (0.299 * src[0][i]! + 0.587 * src[1][i]! + 0.114 * src[2][i]!) / 255;
    const bright = clamp01((lum - 0.7) / 0.3);
    weight[i] = bg * (1 + BLOOM * bright * bright);
    wSum += bg;
    mean[0]! += src[0][i]! * bg;
    mean[1]! += src[1][i]! * bg;
    mean[2]! += src[2][i]! * bg;
  }
  // Color de reserva: la media del fondo (o gris si no hay fondo en la foto).
  const fallback = wSum > 0 ? mean.map((m) => m! / wSum) : [128, 128, 128];

  // Radios de los niveles: ≥ la banda descartada, para que siempre haya fondo que promediar.
  const rMin = band + 2;
  const rMax = Math.max(rMin, rMin + (options.amount / 100) * (MAX_BLUR * long - rMin));
  const levels = options.progressive ? LEVELS : 1;
  const radii = Array.from({ length: levels }, (_, k) =>
    levels === 1 ? rMax : rMin + ((rMax - rMin) * k) / (levels - 1),
  );

  const premult = src.map((plane) => {
    const p = new Float32Array(n);
    for (let i = 0; i < n; i += 1) p[i] = plane[i]! * weight[i]!;
    return p;
  }) as [Float32Array, Float32Array, Float32Array];

  const blurredLevels = radii.map((radius) => {
    const den = boxBlur(weight, w, h, radius);
    const planes = premult.map((p, c) => {
      const num = boxBlur(p, w, h, radius);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = (num[i]! + fallback[c]! * LAMBDA) / (den[i]! + LAMBDA);
      return out;
    });
    return planes as [Float32Array, Float32Array, Float32Array];
  });

  // Mezcla de niveles según la distancia al plato (más lejos, más borroso).
  const out: [Float32Array, Float32Array, Float32Array] = [
    new Float32Array(n),
    new Float32Array(n),
    new Float32Array(n),
  ];
  if (levels === 1) {
    for (let c = 0; c < 3; c += 1) out[c]!.set(blurredLevels[0]![c]!);
  } else {
    const dist = distanceToSubject(a, w, h);
    const reach = PROGRESSIVE_REACH * short;
    for (let i = 0; i < n; i += 1) {
      const t = clamp01(dist[i]! / reach);
      const eased = t * t * (3 - 2 * t);
      const pos = eased * (levels - 1);
      const k0 = Math.min(levels - 2, Math.floor(pos));
      const f = pos - k0;
      for (let c = 0; c < 3; c += 1) {
        out[c]![i] = blurredLevels[k0]![c]![i]! * (1 - f) + blurredLevels[k0 + 1]![c]![i]! * f;
      }
    }
  }

  // Oscurecido del fondo («Resaltar el plato»): hasta la mitad con dim = 100.
  const dimK = 1 - 0.5 * (options.dim / 100);
  if (dimK < 1) for (let c = 0; c < 3; c += 1) for (let i = 0; i < n; i += 1) out[c]![i] = out[c]![i]! * dimK;

  return { r: out[0]!, g: out[1]!, b: out[2]!, width: w, height: h };
}

/**
 * Modo retrato: la foto con el fondo desenfocado y el plato nítido. `alpha` es el
 * plato (0–255, una por píxel, con las medidas de la foto). Devuelve una imagen
 * NUEVA y opaca de las mismas medidas; las entradas no se modifican. Donde el alfa
 * es 255 (y lejos del borde) el resultado es la foto, sin tocar.
 */
export function portraitBlur(image: Pixels, alpha: ArrayLike<number>, options: Partial<PortraitOptions> = {}): Pixels {
  const opts = normalizeOptions(options);
  const { width, height } = image;
  if (alpha.length !== width * height) throw new Error('La selección debe tener las medidas de la foto');

  const bg = blurredBackground(image, alpha, opts);
  const planes =
    bg.width === width && bg.height === height
      ? [bg.r, bg.g, bg.b]
      : [bg.r, bg.g, bg.b].map((p) => resizeChannel(p, bg.width, bg.height, width, height));

  // Borde del plato: un suavizado mínimo (1–3 px) para que no se vea el escalón.
  const base = new Float32Array(width * height);
  for (let i = 0; i < base.length; i += 1) base[i] = alpha[i]!;
  const feather = Math.min(3, Math.max(1, Math.round(0.0012 * Math.max(width, height))));
  const soft = boxBlur(base, width, height, feather);

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const k = clamp01(soft[i]! / 255);
    const o = i * 4;
    if (k >= 0.9995) {
      // Dentro del plato sale la foto tal cual.
      out[o] = image.data[o]!;
      out[o + 1] = image.data[o + 1]!;
      out[o + 2] = image.data[o + 2]!;
    } else {
      out[o] = image.data[o]! * k + planes[0]![i]! * (1 - k);
      out[o + 1] = image.data[o + 1]! * k + planes[1]![i]! * (1 - k);
      out[o + 2] = image.data[o + 2]! * k + planes[2]![i]! * (1 - k);
    }
    out[o + 3] = 255;
  }
  return { data: out, width, height };
}
