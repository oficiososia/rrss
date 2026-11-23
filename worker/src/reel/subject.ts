// Dónde está lo principal de una foto, para encuadrar el reel sobre ello y no
// sobre el centro geométrico (que en una foto horizontal recortada a 9:16 corta
// el plato o enseña la encimera).
//
// Dos fuentes, por este orden:
//   1. La MÁSCARA del recorte de la marca («Quitar el fondo», BEN2): el canal
//      alfa del PNG dice exactamente qué es el plato. Caja y centro de lo opaco.
//   2. SALIENCIA, sin modelos: en una foto de ~128 px de ancho se mide, píxel a
//      píxel, cuánto se aparta del color del borde (el fondo suele tocar los
//      bordes), cuánto contrasta con el color medio y cuánto detalle (bordes)
//      tiene alrededor, con una preferencia suave por el centro. El centro de
//      masa de lo más destacado es el punto de interés, y su caja, el sujeto.
//
// Todo en coordenadas de la foto TAL COMO SE VE (después de girarla según su
// EXIF), normalizadas de 0 a 1.
import sharp from 'sharp';
import type { FocalPoint } from '../handlers/shared.ts';

export interface SubjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Subject {
  focal: FocalPoint;
  box: SubjectBox;
  source: 'mask' | 'saliency';
}

const SAMPLE_WIDTH = 128;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Punto normalizado de la imagen guardada → el mismo punto en la imagen girada según su EXIF. */
export function orientPoint(p: FocalPoint, orientation: number): FocalPoint {
  const { x, y } = p;
  switch (orientation) {
    case 2:
      return { x: 1 - x, y };
    case 3:
      return { x: 1 - x, y: 1 - y };
    case 4:
      return { x, y: 1 - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: 1 - y, y: x };
    case 7:
      return { x: 1 - y, y: 1 - x };
    case 8:
      return { x: y, y: 1 - x };
    default:
      return { x, y };
  }
}

export function orientBox(box: SubjectBox, orientation: number): SubjectBox {
  const a = orientPoint({ x: box.x, y: box.y }, orientation);
  const b = orientPoint({ x: box.x + box.w, y: box.y + box.h }, orientation);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]!;
}

/** sRGB (0–255) → Lab aproximado (D65). */
function toLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/**
 * Saliencia de una imagen RGB ya reducida (`data` = width × height × channels).
 * Pura, para probarla sin archivos.
 */
export function saliencySubject(data: Uint8Array, width: number, height: number, channels: number): Subject | null {
  const n = width * height;
  if (n < 64) return null;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const [l, a, b] = toLab(data[i * channels]!, data[i * channels + 1]!, data[i * channels + 2]!);
    L[i] = l;
    A[i] = a;
    B[i] = b;
  }
  // Color del fondo: mediana de una franja del borde (un 6 % por cada lado).
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.06));
  const border: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < band || y < band || x >= width - band || y >= height - band) border.push(y * width + x);
    }
  }
  const med = (arr: Float32Array) => percentile(border.map((i) => arr[i]!), 0.5);
  const bg = [med(L), med(A), med(B)];
  let mL = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < n; i += 1) {
    mL += L[i]!;
    mA += A[i]!;
    mB += B[i]!;
  }
  mL /= n;
  mA /= n;
  mB /= n;
  // Detalle: gradiente de la luminancia (Sobel), suavizado.
  const edge = new Float32Array(n);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = (dx: number, dy: number) => L[(y + dy) * width + x + dx]!;
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
      edge[y * width + x] = Math.hypot(gx, gy);
    }
  }
  const blur = (src: Float32Array, radius: number) => {
    const tmp = new Float32Array(n);
    const out = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let s = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const xx = x + k;
          if (xx < 0 || xx >= width) continue;
          s += src[y * width + xx]!;
          c += 1;
        }
        tmp[y * width + x] = s / c;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let s = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const yy = y + k;
          if (yy < 0 || yy >= height) continue;
          s += tmp[yy * width + x]!;
          c += 1;
        }
        out[y * width + x] = s / c;
      }
    }
    return out;
  };
  const radius = Math.max(1, Math.round(width / 40));
  const Ls = blur(L, radius);
  const As = blur(A, radius);
  const Bs = blur(B, radius);
  const edges = blur(edge, radius * 2);
  const fromBg = new Float32Array(n);
  const fromMean = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    fromBg[i] = Math.hypot(Ls[i]! - bg[0]!, (As[i]! - bg[1]!) * 1.3, (Bs[i]! - bg[2]!) * 1.3);
    fromMean[i] = Math.hypot(Ls[i]! - mL, As[i]! - mA, Bs[i]! - mB);
  }
  const norm = (arr: Float32Array) => {
    const hi = percentile(Array.from(arr), 0.98) || 1;
    for (let i = 0; i < n; i += 1) arr[i] = Math.min(1, arr[i]! / hi);
  };
  norm(fromBg);
  norm(fromMean);
  norm(edges);
  const score = new Float32Array(n);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const dx = x / (width - 1) - 0.5;
      const dy = y / (height - 1) - 0.5;
      const prior = Math.exp(-(dx * dx + dy * dy) / (2 * 0.32 * 0.32));
      score[i] = (0.5 * fromBg[i]! + 0.25 * fromMean[i]! + 0.25 * edges[i]!) * (0.55 + 0.45 * prior);
    }
  }
  const threshold = percentile(Array.from(score), 0.8);
  let sw = 0;
  let sx = 0;
  let sy = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = score[y * width + x]!;
      if (s < threshold || s <= 0) continue;
      const w = s * s;
      sw += w;
      sx += w * x;
      sy += w * y;
      xs.push(x);
      ys.push(y);
    }
  }
  if (sw <= 0 || xs.length < 8) return null;
  const fx = sx / sw / (width - 1);
  const fy = sy / sw / (height - 1);
  const x0 = percentile(xs, 0.06) / (width - 1);
  const x1 = percentile(xs, 0.94) / (width - 1);
  const y0 = percentile(ys, 0.06) / (height - 1);
  const y1 = percentile(ys, 0.94) / (height - 1);
  return {
    focal: { x: round3(clamp01(fx)), y: round3(clamp01(fy)) },
    box: { x: round3(x0), y: round3(y0), w: round3(Math.max(0.05, x1 - x0)), h: round3(Math.max(0.05, y1 - y0)) },
    source: 'saliency',
  };
}

/** Caja y centro de lo opaco de un canal alfa (0–255). Null si casi todo es transparente u opaco. */
export function maskSubjectFromAlpha(alpha: Uint8Array, width: number, height: number): Subject | null {
  let count = 0;
  let sx = 0;
  let sy = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x]! < 128) continue;
      count += 1;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const share = count / (width * height);
  if (count === 0 || share < 0.01 || share > 0.97) return null;
  const nx = (v: number) => round3(clamp01(v / Math.max(1, width - 1)));
  const ny = (v: number) => round3(clamp01(v / Math.max(1, height - 1)));
  return {
    focal: { x: nx(sx / count), y: ny(sy / count) },
    box: { x: nx(x0), y: ny(y0), w: round3(Math.max(0.02, nx(x1) - nx(x0))), h: round3(Math.max(0.02, ny(y1) - ny(y0))) },
    source: 'mask',
  };
}

/** Sujeto de una foto por saliencia. `orientation` es la EXIF que se le quitó a la copia de trabajo. */
export async function detectSubject(file: string, orientation: number): Promise<Subject | null> {
  try {
    const { data, info } = await sharp(file, { failOn: 'none' })
      .resize({ width: SAMPLE_WIDTH, withoutEnlargement: false })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const subject = saliencySubject(new Uint8Array(data), info.width, info.height, info.channels);
    if (!subject) return null;
    return { ...subject, focal: orientPoint(subject.focal, orientation), box: orientBox(subject.box, orientation) };
  } catch {
    return null;
  }
}

/**
 * Sujeto a partir de la máscara del recorte (PNG con alfa, ya derecho). Si sus
 * proporciones no son las de la foto vista, no se usa (no es de esta foto).
 */
export async function subjectFromMask(file: string, photoAspect: number): Promise<Subject | null> {
  try {
    const image = sharp(file, { failOn: 'none' });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || !meta.hasAlpha) return null;
    if (Math.abs(meta.width / meta.height - photoAspect) / photoAspect > 0.03) return null;
    const { data, info } = await image
      .resize({ width: SAMPLE_WIDTH })
      .ensureAlpha()
      .extractChannel('alpha')
      .raw()
      .toBuffer({ resolveWithObject: true });
    return maskSubjectFromAlpha(new Uint8Array(data), info.width, info.height);
  } catch {
    return null;
  }
}
