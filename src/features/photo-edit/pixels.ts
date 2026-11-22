// Ajustes de una foto SIN IA: luz, color y nitidez, calculados en el navegador
// sobre los píxeles (docs/edicion-fotos.md, §2). Funciones puras sobre una
// imagen en memoria (`Pixels`, la misma forma que `ImageData`): no dibujan ni
// leen nada, así se prueban sin navegador. Nunca modifican la imagen de
// entrada: devuelven otra.

/** Imagen RGBA en memoria: la forma de `ImageData`. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Ajustes. Los deslizadores van de -100 a 100 (nitidez, de 0 a 100); 0 es «sin
 * cambio». `levels` estira el histograma (negro y blanco) y `balance` es una
 * corrección fina del tinte (ganancia por canal); los rellena «Mejorar
 * automáticamente» y no tienen deslizador propio.
 *
 * - `exposure` (Luz): aclara u oscurece los tonos medios sin quemar los blancos.
 * - `shadows` / `highlights` (Sombras / Luces): suben las zonas oscuras o
 *   recuperan las claras sin tocar el resto.
 * - `clarity` (Claridad): contraste local suave, da relieve a la textura.
 * - `vibrance` (Viveza): satura más lo poco saturado y se corta con el rojo y
 *   el naranja (carne, piel) para que no se pasen.
 */
export interface Adjustments {
  exposure: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  shadows: number;
  highlights: number;
  clarity: number;
  vibrance: number;
  levels: { black: number; white: number } | null;
  balance: [number, number, number];
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  sharpness: 0,
  shadows: 0,
  highlights: 0,
  clarity: 0,
  vibrance: 0,
  levels: null,
  balance: [1, 1, 1],
};

export interface ImageStats {
  /** Luminancia (0–255) por debajo de la cual queda el 0,5 % de los píxeles, y por encima el 0,5 %. */
  black: number;
  white: number;
  /** Luminancia en los percentiles 10, 50, 90 y 99 (0–255). */
  p10: number;
  p50: number;
  p90: number;
  p99: number;
  /** Desviación típica de la luminancia (0–255): cuánto contraste hay. */
  spread: number;
  /** Luminancia media. */
  meanLuma: number;
  /** Media de cada canal. */
  mean: [number, number, number];
  /** Saturación media (0–1). */
  saturation: number;
  /** Saturación media de los tonos medios (luminancia 40–220): lo que se ve, sin fondos negros o blancos. */
  vividness: number;
  /** Media de los píxeles casi grises (platos, manteles, servilletas) y qué parte de la foto son; `null` si no hay. */
  neutral: { rgb: [number, number, number]; fraction: number } | null;
  /** Media de los píxeles poco saturados (sin salsas ni carnes vivas): referencia de respaldo. */
  muted: [number, number, number] | null;
  /** Detalle: media del valor absoluto del laplaciano de la luminancia (cuanto menor, más blanda). */
  detail: number;
  /** Algún píxel no es opaco. */
  transparent: boolean;
}

const clampByte = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** ¿Tiene algún píxel transparente o semitransparente? */
export function hasTransparency(image: Pixels): boolean {
  const { data } = image;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

/**
 * Estadísticas para «Mejorar automáticamente». En fotos grandes se mira una
 * muestra (como mucho ~250 000 píxeles): el resultado apenas cambia y es
 * inmediato. Los píxeles transparentes no cuentan.
 */
export function analyzeImage(image: Pixels): ImageStats {
  const { data, width, height } = image;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 250_000)));
  const histogram = new Uint32Array(256);
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumSat = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
  let detail = 0;
  let detailCount = 0;
  let transparent = false;
  let midSat = 0;
  let midCount = 0;
  const neutral = [0, 0, 0];
  let neutralCount = 0;
  const muted = [0, 0, 0];
  let mutedCount = 0;
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return luma(data[i]!, data[i + 1]!, data[i + 2]!);
  };
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const a = data[i + 3]!;
      if (a < 255) transparent = true;
      if (a < 128) continue;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const l = luma(r, g, b);
      histogram[Math.round(l)]! += 1;
      sumLuma += l;
      sumLumaSq += l * l;
      sumR += r;
      sumG += g;
      sumB += b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      sumSat += sat;
      count += 1;
      if (l >= 40 && l <= 220) {
        midSat += sat;
        midCount += 1;
      }
      // Referencias de blanco: casi grises, ni oscuros (el color no es fiable) ni quemados.
      if (l >= 30 && l <= 235) {
        if (sat < 0.2) {
          neutral[0]! += r;
          neutral[1]! += g;
          neutral[2]! += b;
          neutralCount += 1;
        }
        if (sat < 0.5) {
          muted[0]! += r;
          muted[1]! += g;
          muted[2]! += b;
          mutedCount += 1;
        }
      }
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        detail += Math.abs(4 * l - at(x - 1, y) - at(x + 1, y) - at(x, y - 1) - at(x, y + 1));
        detailCount += 1;
      }
    }
  }
  if (!transparent) transparent = hasTransparency(image);
  if (count === 0) {
    return {
      black: 0,
      white: 255,
      p10: 0,
      p50: 128,
      p90: 255,
      p99: 255,
      spread: 0,
      meanLuma: 128,
      mean: [128, 128, 128],
      saturation: 0,
      vividness: 0,
      neutral: null,
      muted: null,
      detail: 0,
      transparent,
    };
  }
  const percentile = (fraction: number) => {
    const target = count * fraction;
    let seen = 0;
    for (let v = 0; v < 256; v += 1) {
      seen += histogram[v]!;
      if (seen >= target) return v;
    }
    return 255;
  };
  const meanLuma = sumLuma / count;
  const mean = (sum: number[], n: number): [number, number, number] => [sum[0]! / n, sum[1]! / n, sum[2]! / n];
  return {
    black: percentile(0.005),
    white: percentile(0.995),
    p10: percentile(0.1),
    p50: percentile(0.5),
    p90: percentile(0.9),
    p99: percentile(0.99),
    spread: Math.sqrt(Math.max(0, sumLumaSq / count - meanLuma * meanLuma)),
    meanLuma,
    mean: [sumR / count, sumG / count, sumB / count],
    saturation: sumSat / count,
    vividness: midCount ? midSat / midCount : sumSat / count,
    neutral: neutralCount ? { rgb: mean(neutral, neutralCount), fraction: neutralCount / count } : null,
    muted: mutedCount >= count * 0.05 ? mean(muted, mutedCount) : null,
    detail: detailCount ? detail / detailCount : 0,
    transparent,
  };
}

// ───────────────────────────── Mejora automática ─────────────────────────────

/** Cuánto sube el rojo (y baja el azul) cada punto del deslizador de temperatura: ±0,2 % por punto. */
const WARMTH_GAIN = 0.002;
/** Escala de la luz: con el deslizador a 100 el gamma de los tonos medios es 2^(-100/70). */
const EXPOSURE_SCALE = 70;

/**
 * «Mejorar automáticamente» para fotos de restaurante y producto. Nada de
 * inventar contenido ni de efectos fuertes: cada ajuste se calcula del
 * histograma y de las medias de la foto, y se queda quieto si la foto ya está
 * bien (todos tienen una zona «correcta» donde valen 0).
 *
 * 1. Niveles: negro y blanco por percentiles, con recorte suave (se deja
 *    margen arriba para no quemar) y sin estirar más de ×1,7.
 * 2. Balance de blancos: se mide en lo casi gris de la foto (plato, mantel,
 *    servilleta). Si no hay, vale la media de lo poco saturado. Se corrige solo
 *    una parte, y menos hacia el frío, para no teñir la carne ni quitar el
 *    calor natural de la comida. Va al deslizador de Temperatura.
 * 3. Luz: lleva la «clave» (mezcla de mediana y tonos altos, para que un fondo
 *    oscuro no cuente tanto) a una zona cómoda.
 * 4. Sombras y luces: levanta un poco lo hundido y recupera lo quemado.
 * 5. Contraste solo si la foto está plana; Claridad suave siempre.
 * 6. Color: viveza (lo poco saturado, sin pasarse en rojos y naranjas) y un
 *    toque de saturación si está apagada. Nitidez según lo blanda que esté.
 */
export function autoAdjustments(stats: ImageStats): Adjustments {
  // 1. Niveles con recorte suave.
  let levels: Adjustments['levels'] = null;
  if (stats.white - stats.black > 20) {
    let black = Math.min(70, Math.round(stats.black * 0.85));
    let white = Math.round(stats.white + (255 - stats.white) * 0.12);
    white = Math.max(white, black + 150); // como mucho ×1,7; el resto lo hace el contraste
    if (white > 255) {
      black = Math.max(0, black - (white - 255));
      white = 255;
    }
    if (255 / (white - black) >= 1.1) levels = { black, white };
  }
  const level = (v: number) => (levels ? clamp(((v - levels.black) * 255) / (levels.white - levels.black), 0, 255) : v);

  // 2. Balance de blancos → Temperatura (eje azul–naranja) y tinte (eje verde–magenta).
  let gains: [number, number] | null = null; // [rojo, azul] respecto al verde
  let strength = 0;
  const reference = stats.neutral && stats.neutral.fraction >= 0.03 ? stats.neutral : null;
  if (reference) {
    const [r, g, b] = reference.rgb;
    gains = [g / Math.max(1, r), g / Math.max(1, b)];
    strength = 0.6 + 0.3 * clamp(reference.fraction / 0.1, 0, 1);
  } else if (stats.muted) {
    const [r, g, b] = stats.muted;
    gains = [g / Math.max(1, r), g / Math.max(1, b)];
    strength = 0.35;
  }
  let warmth = 0;
  let balance: [number, number, number] = [1, 1, 1];
  if (gains) {
    // Se corrige solo una parte y, hacia el frío, menos aún: la comida es cálida.
    const ratio = gains[0] / gains[1];
    const full = (500 * (ratio - 1)) / (ratio + 1);
    warmth = Math.round(clamp(full * strength * (full < 0 ? 0.85 : 1), -45, 45));
    const wr = 1 + WARMTH_GAIN * warmth;
    // Lo que sobra (verde–magenta) va en el tinte.
    const gr = 1 + (gains[0] - 1) * strength;
    const tint = clamp(wr / gr, 0.93, 1.07);
    balance = [1, Math.abs(tint - 1) < 0.01 ? 1 : Math.round(tint * 1000) / 1000, 1];
  }

  // 3. Luz: la «clave» pesa la mediana y, menos, los tonos altos (un plato blanco no es un exceso de luz).
  const key = (0.7 * level(stats.p50) + 0.3 * level(stats.p90)) / 255;
  const target = clamp(key, 0.4, 0.62);
  let exposure = 0;
  if (target !== key && key > 0.02) {
    const gamma = Math.log(target) / Math.log(key);
    exposure = Math.round(clamp(-EXPOSURE_SCALE * Math.log2(gamma) * 0.85, -15, 35));
  }

  // 4. Sombras y luces, sobre la foto ya estirada y con la luz puesta.
  const toned = (v: number) => 255 * Math.pow(level(v) / 255, Math.pow(2, -exposure / EXPOSURE_SCALE));
  const shadows = Math.round(clamp((0.17 - toned(stats.p10) / 255) * 160, 0, 25));
  const highlights = -Math.round(clamp(toned(stats.p99) - 232, 0, 30));

  // 5. Contraste (solo si está plana) y claridad.
  const spread = (stats.spread * (levels ? 255 / (levels.white - levels.black) : 1)) / 255;
  const contrast = Math.round(clamp((0.2 - spread) * 90, 0, 14));
  const clarity = stats.detail > 16 ? 10 : stats.detail < 5 ? 26 : 20;

  // 6. Color y nitidez.
  // La viveza solo actúa sobre lo poco saturado, así que vale siempre un mínimo: un fondo muy
  // naranja no debe impedir que el plato, más apagado, se avive.
  const vibrance = Math.round(clamp((0.55 - stats.vividness) * 90, 20, 50));
  const saturation = Math.round(clamp((0.4 - stats.vividness) * 45, 3, 14));
  const sharpness = stats.detail < 6 ? 35 : stats.detail < 12 ? 22 : 12;

  return {
    exposure,
    contrast,
    saturation,
    warmth,
    sharpness,
    shadows,
    highlights,
    clarity,
    vibrance,
    levels,
    balance,
  };
}

/** ¿Los ajustes cambian algo? */
export function isNeutral(adjustments: Adjustments): boolean {
  return (
    adjustments.exposure === 0 &&
    adjustments.contrast === 0 &&
    adjustments.saturation === 0 &&
    adjustments.warmth === 0 &&
    adjustments.sharpness === 0 &&
    adjustments.shadows === 0 &&
    adjustments.highlights === 0 &&
    adjustments.clarity === 0 &&
    adjustments.vibrance === 0 &&
    adjustments.levels === null &&
    adjustments.balance.every((g) => g === 1)
  );
}

// ───────────────────────────── Aplicar los ajustes ─────────────────────────────

/**
 * Tabla de cada canal con el balance y la temperatura (una ganancia por
 * canal), para no repetir la cuenta en cada píxel. Todo lo demás de la luz va
 * sobre la luminancia (`toneCurve`), para no desplazar ni saturar los colores.
 */
function gainTable(adjustments: Adjustments, channel: 0 | 1 | 2): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  const warm = clamp(adjustments.warmth, -100, 100) * WARMTH_GAIN;
  const gain = adjustments.balance[channel] * (channel === 0 ? 1 + warm : channel === 2 ? 1 - warm : 1);
  for (let v = 0; v < 256; v += 1) table[v] = clampByte(v * gain);
  return table;
}

/**
 * Curva de luminancia (0–255 → 0–255): niveles, luz, sombras, luces y
 * contraste, por este orden; o `null` si no hacen nada. La luz es un gamma (no
 * quema los blancos); las sombras actúan en lo oscuro sin mover el negro puro,
 * y las luces en lo claro sin mover el blanco puro. Al ir sobre la luminancia,
 * el color sigue al tono sin teñirse ni saturarse de más.
 */
function toneCurve(adjustments: Adjustments): Float32Array | null {
  const { levels } = adjustments;
  const exposure = clamp(adjustments.exposure, -100, 100);
  const shadows = clamp(adjustments.shadows, -100, 100) / 100;
  const highlights = clamp(adjustments.highlights, -100, 100) / 100;
  const c = clamp(adjustments.contrast, -100, 100) * 1.28;
  if (exposure === 0 && shadows === 0 && highlights === 0 && c === 0 && !levels) return null;
  const gamma = Math.pow(2, -exposure / EXPOSURE_SCALE);
  const contrast = (259 * (c + 255)) / (255 * (259 - c));
  const curve = new Float32Array(256);
  let previous = 0;
  for (let v = 0; v < 256; v += 1) {
    let y = levels ? clamp((v - levels.black) / Math.max(1, levels.white - levels.black), 0, 1) : v / 255;
    y = Math.pow(y, gamma);
    y += shadows * 0.24 * Math.pow(1 - y, 2) * Math.min(1, y / 0.12);
    y += highlights * 0.24 * y * y * Math.min(1, (1 - y) / 0.12);
    y = clamp(y, 0, 1) * 255;
    y = clamp(contrast * (y - 128) + 128, 0, 255);
    previous = Math.max(previous, y); // nunca invierte tonos
    curve[v] = previous;
  }
  return curve;
}

/** Desenfoque de caja (separable, bordes repetidos) de un plano; cada vuelta cuesta lo mismo sea cual sea el radio. */
function boxBlurPlane(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const size = 2 * r + 1;
  const horizontal = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum += source[row + clamp(k, 0, width - 1)]!;
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / size;
      sum += source[row + Math.min(width - 1, x + r + 1)]! - source[row + Math.max(0, x - r)]!;
    }
  }
  const out = new Float32Array(source.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum += horizontal[clamp(k, 0, height - 1) * width + x]!;
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / size;
      sum += horizontal[Math.min(height - 1, y + r + 1) * width + x]! - horizontal[Math.max(0, y - r) * width + x]!;
    }
  }
  return out;
}

/** Luminancia de una imagen RGBA como plano. */
function lumaPlane(data: Uint8ClampedArray, pixels: number): Float32Array {
  const lum = new Float32Array(pixels);
  for (let i = 0, p = 0; p < pixels; i += 4, p += 1) lum[p] = luma(data[i]!, data[i + 1]!, data[i + 2]!);
  return lum;
}

/**
 * Suma a los tres canales el detalle de la luminancia respecto a su versión
 * desenfocada (máscara de enfoque): sirve para la nitidez (radio pequeño) y la
 * claridad (radio grande). `weight` limita el efecto según la luminancia.
 */
function addLocalContrast(
  out: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  amount: number,
  passes: number,
  weight?: (luminance: number) => number,
) {
  const pixels = width * height;
  const lum = lumaPlane(out, pixels);
  let blur = lum;
  for (let n = 0; n < passes; n += 1) blur = boxBlurPlane(blur, width, height, radius);
  for (let i = 0, p = 0; p < pixels; i += 4, p += 1) {
    const l = lum[p]!;
    const delta = (l - blur[p]!) * amount * (weight ? weight(l) : 1);
    out[i] = out[i]! + delta;
    out[i + 1] = out[i + 1]! + delta;
    out[i + 2] = out[i + 2]! + delta;
  }
}

/** Aplica los ajustes y devuelve una imagen NUEVA del mismo tamaño (la de entrada no cambia). */
export function applyAdjustments(image: Pixels, adjustments: Adjustments): Pixels {
  const { data, width, height } = image;
  const out = new Uint8ClampedArray(data.length);
  const tables = [gainTable(adjustments, 0), gainTable(adjustments, 1), gainTable(adjustments, 2)] as const;
  const curve = toneCurve(adjustments);
  const saturation = 1 + clamp(adjustments.saturation, -100, 100) / 100;
  const vibrance = clamp(adjustments.vibrance, -100, 100) / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = tables[0][data[i]!]!;
    let g = tables[1][data[i + 1]!]!;
    let b = tables[2][data[i + 2]!]!;
    let l = luma(r, g, b);
    if (curve) {
      // Se mueve la luminancia y el color la sigue (mismo matiz), sin pasarse de ×4.
      const target = curve[Math.round(l)]!;
      if (l >= 1) {
        // Sin pasarse de ×4 ni de 255 en ningún canal (si no, el color se desplaza).
        const scale = Math.min(4, target / l, 255 / Math.max(r, g, b));
        r *= scale;
        g *= scale;
        b *= scale;
      } else {
        const lift = target - l;
        r += lift;
        g += lift;
        b += lift;
      }
      l = luma(r, g, b);
    }
    let factor = saturation;
    if (vibrance !== 0) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max <= 0 ? 0 : Math.min(1, (max - min) / max);
      if (vibrance > 0) {
        // Más a lo poco saturado; y la mitad en rojos y naranjas (carne, piel).
        const warmHue = r >= g && g >= b && g - b <= 0.85 * (r - b) && sat > 0.2;
        factor *= 1 + vibrance * Math.pow(1 - sat, 1.5) * (warmHue ? 0.5 : 1);
      } else {
        factor *= 1 + vibrance * (0.4 + 0.6 * sat);
      }
    }
    if (factor !== 1) {
      r = l + (r - l) * factor;
      g = l + (g - l) * factor;
      b = l + (b - l) * factor;
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = data[i + 3]!;
  }
  const side = Math.max(width, height);
  const clarity = clamp(adjustments.clarity, -100, 100) / 100;
  if (clarity !== 0 && width * height > 1) {
    // Contraste local: radio proporcional a la foto (así la vista previa y el archivo se ven igual),
    // con menos efecto en negros y blancos para no crear halos.
    addLocalContrast(out, width, height, Math.max(2, side * 0.02), clarity * 0.9, 2, (l) => {
      const x = l / 127.5 - 1;
      return 0.25 + 0.75 * (1 - x * x);
    });
  }
  const amount = (clamp(adjustments.sharpness, 0, 100) / 100) * 1.2;
  if (amount > 0 && width * height > 1) {
    // Máscara de enfoque sobre la luminancia: suma el detalle sin cambiar el color.
    addLocalContrast(out, width, height, Math.max(1, Math.round(side / 1500)), amount, 1);
  }
  return { data: out, width, height };
}

/** Fondo para una foto recortada (con transparencia): un color liso o una imagen del mismo tamaño. */
export type Backdrop = { kind: 'color'; hex: string } | { kind: 'image'; pixels: Pixels };

export function parseHex(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Pone la foto encima de un fondo (mezcla «normal» con su alfa). El resultado
 * es opaco. La imagen de fondo tiene que tener el mismo tamaño que la foto
 * (quien llama la ha encajado antes).
 */
export function compositeOver(foreground: Pixels, backdrop: Backdrop): Pixels {
  const { data, width, height } = foreground;
  const out = new Uint8ClampedArray(data.length);
  let color: [number, number, number] | null = null;
  if (backdrop.kind === 'color') {
    color = parseHex(backdrop.hex);
    if (!color) throw new Error('Color de fondo no válido');
  } else if (backdrop.pixels.width !== width || backdrop.pixels.height !== height) {
    throw new Error('El fondo debe tener el tamaño de la foto');
  }
  const bg = backdrop.kind === 'image' ? backdrop.pixels.data : null;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    const br = color ? color[0] : bg![i]!;
    const bgG = color ? color[1] : bg![i + 1]!;
    const bb = color ? color[2] : bg![i + 2]!;
    out[i] = data[i]! * a + br * (1 - a);
    out[i + 1] = data[i + 1]! * a + bgG * (1 - a);
    out[i + 2] = data[i + 2]! * a + bb * (1 - a);
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

/** Recorta una zona (en píxeles enteros) y devuelve una imagen nueva. */
export function cropPixels(image: Pixels, box: { x: number; y: number; width: number; height: number }): Pixels {
  const x0 = clamp(Math.round(box.x), 0, image.width - 1);
  const y0 = clamp(Math.round(box.y), 0, image.height - 1);
  const w = clamp(Math.round(box.width), 1, image.width - x0);
  const h = clamp(Math.round(box.height), 1, image.height - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = ((y0 + y) * image.width + x0) * 4;
    out.set(image.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

/** Reduce unos píxeles (para la vista previa): vecino más próximo, suficiente para ver el efecto. */
export function downscale(pixels: Pixels, maxSide: number): Pixels {
  const scale = Math.min(1, maxSide / Math.max(pixels.width, pixels.height));
  if (scale === 1) return pixels;
  const width = Math.max(1, Math.round(pixels.width * scale));
  const height = Math.max(1, Math.round(pixels.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(pixels.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(pixels.width - 1, Math.floor(x / scale));
      const from = (sy * pixels.width + sx) * 4;
      out.set(pixels.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { data: out, width, height };
}
