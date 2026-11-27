// Refinado de la máscara del recorte (refine.ts): limpieza de motas, islas y
// agujeros, filtro guiado, entrada de IS-Net con promedio de área y las dos vías
// de `applyMask` (IS-Net refinado, BEN2 solo limpio).
import { describe, expect, it } from 'vitest';
import type { Pixels } from '../pixels';
import { applyMask, NoSubjectError, toModelInput } from './mask';
import { boxMean, cleanMask, cleanOnlyMask, guidedInput, isnetInput, luminance, refineMask, workSize } from './refine';

const SIDE = 64;

/** Máscara SIDE×SIDE de prueba: `fill(x, y)` da 0–255. */
function mask(fill: (x: number, y: number) => number, side = SIDE): Uint8Array {
  const out = new Uint8Array(side * side);
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) out[y * side + x] = fill(x, y);
  return out;
}
const at = (m: Uint8Array, x: number, y: number, side = SIDE) => m[y * side + x]!;
const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x < x1 && y >= y0 && y < y1;

function photo(width: number, height: number, fill: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = fill(x, y);
      data.set([r!, g!, b!, a], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

describe('limpieza de la máscara', () => {
  it('quita una mota suelta lejos del sujeto y no toca la entrada', () => {
    const m = mask((x, y) => (inBox(x, y, 8, 8, 40, 40) || inBox(x, y, 58, 58, 60, 60) ? 255 : 0));
    const copy = new Uint8Array(m);
    const out = cleanMask(m, SIDE, SIDE);
    expect(at(out, 20, 20)).toBe(255);
    expect(at(out, 58, 58)).toBe(0);
    expect(m).toEqual(copy);
  });

  it('rellena un agujero cerrado pequeño dentro del sujeto, pero no un hueco que toca el borde', () => {
    const m = mask((x, y) => (inBox(x, y, 4, 4, 60, 60) && !inBox(x, y, 30, 30, 31, 31) ? 255 : 0));
    const out = cleanMask(m, SIDE, SIDE);
    expect(at(out, 31, 31)).toBe(255);
    // El fondo exterior (toca el borde de la imagen) se queda.
    expect(at(out, 1, 1)).toBe(0);
  });

  it('un agujero grande (un hueco de verdad, como el asa de una taza) se conserva', () => {
    const m = mask((x, y) => (inBox(x, y, 4, 4, 60, 60) && !inBox(x, y, 20, 20, 44, 44) ? 255 : 0));
    expect(at(cleanMask(m, SIDE, SIDE), 30, 30)).toBe(0);
  });

  it('una línea fina unida al cuerpo (una pata, una antena) no se borra', () => {
    const m = mask((x, y) => (inBox(x, y, 8, 8, 30, 30) || (y === 20 && x >= 30 && x < 60) ? 255 : 0));
    const out = cleanMask(m, SIDE, SIDE);
    expect(at(out, 55, 20)).toBe(255);
  });

  it('no endurece los medios tonos de los bordes', () => {
    const m = mask((x) => (x < 20 ? 255 : x < 24 ? 128 : 0));
    const out = cleanMask(m, SIDE, SIDE);
    expect(at(out, 21, 10)).toBe(128);
  });
});

describe('filtro guiado y refinado', () => {
  it('la media por ventana de una constante es la constante, también en los bordes', () => {
    const out = boxMean(new Float32Array(30 * 20).fill(0.5), 30, 20, 3);
    expect(Math.min(...out)).toBeCloseTo(0.5, 5);
    expect(Math.max(...out)).toBeCloseTo(0.5, 5);
  });

  it('la luminancia pone la transparencia sobre blanco', () => {
    const rgba = [0, 0, 0, 255, 0, 0, 0, 0];
    expect(Array.from(luminance(rgba, 2))).toEqual([0, 1]);
  });

  it('la rampa deja el fondo en 0, el sujeto en 1 y lo dudoso en medio', () => {
    expect(Array.from(guidedInput([0, 100, 128, 200, 255]))).toEqual([0, 0, expect.closeTo(0.52, 2), 1, 1]);
  });

  it('el borde de la máscara se pega al borde real de la foto (la máscara estaba corrida)', () => {
    // Foto: sujeto rojo en x < 30 sobre fondo blanco. Máscara corrida 1 px a la derecha.
    const w = 64;
    const h = 64;
    const img = photo(w, h, (x) => (x < 30 ? [160, 20, 20] : [250, 250, 250]));
    const m = mask((x) => (x < 31 ? 255 : 0), w);
    const { alpha } = refineMask({ data: img.data, width: w, height: h, mask: m, maskSide: w });
    // Sin el guiado el píxel 30 (ya fondo en la foto) sería sujeto; con él pierde casi todo su alfa.
    expect(alpha[10 * w + 30]!).toBeLessThan(120);
    expect(alpha[10 * w + 25]!).toBe(255);
  });

  it('con una foto grande trabaja a ≤ 1600 px y devuelve el alfa a tamaño completo', () => {
    expect(workSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(workSize(800, 600)).toEqual({ width: 800, height: 600 });
    const w = 1700;
    const h = 100;
    const img = photo(w, h, (x) => (x < 800 ? [20, 20, 20] : [240, 240, 240]));
    const m = mask((x) => (x < 32 ? 255 : 0));
    const out = refineMask({ data: img.data, width: w, height: h, mask: m, maskSide: SIDE });
    expect(out.alpha).toHaveLength(w * h);
    expect(out.alpha[50 * w + 100]).toBe(255);
    expect(out.alpha[50 * w + 1600]).toBe(0);
  });
});

describe('entrada de IS-Net', () => {
  it('al encoger promedia el área (el muestreo bilinear de antes saltaba píxeles)', () => {
    // Fila de píxeles alternos 0/255: el promedio da gris medio; un muestreo de 2 puntos daría 0 o 255.
    const w = 4096;
    const h = 8;
    const img = photo(w, h, (x) => (x % 2 === 0 ? [255, 255, 255] : [0, 0, 0]));
    const tensor = isnetInput(img.data, w, h, 8);
    // Todos los píxeles de la entrada valen ≈ 127,5 = el máximo: ÷ máximo − 0,5 = +0,5.
    // Con muestreo puntual saldrían mezclas de −0,5 y +0,5.
    for (let i = 0; i < 8; i += 1) expect(tensor[i]!).toBeGreaterThan(0.49);
  });

  it('toModelInput usa el mismo cálculo, con la forma 1×3×lado×lado', () => {
    const img = photo(10, 6, (x) => (x < 5 ? [0, 0, 0] : [255, 255, 255]));
    const a = toModelInput(img, 16);
    expect(a).toHaveLength(3 * 16 * 16);
    expect(a).toEqual(isnetInput(img.data, 10, 6, 16));
  });
});

describe('applyMask: dos vías', () => {
  const img = photo(40, 40, (x) => (x < 20 ? [30, 30, 30] : [230, 230, 230]));
  const side = 64;
  const half = mask((x) => (x < 32 ? 255 : 0), side);

  it('IS-Net (refinada) deja sujeto y fondo y no toca la entrada', () => {
    const copy = new Uint8ClampedArray(img.data);
    const out = applyMask(img, half, side, 'refined');
    expect(out.data[(20 * 40 + 5) * 4 + 3]).toBe(255);
    expect(out.data[(20 * 40 + 35) * 4 + 3]).toBe(0);
    expect(img.data).toEqual(copy);
  });

  it('BEN2 (limpia) respeta los medios tonos del alfa', () => {
    const soft = mask((x) => (x < 20 ? 255 : x < 44 ? 128 : 0), side);
    const out = applyMask(img, soft, side, 'clean');
    const mid = out.data[(20 * 40 + 25) * 4 + 3]!;
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(160);
  });

  it('la limpieza de BEN2 no deja motas lejanas', () => {
    const m = mask((x, y) => (inBox(x, y, 4, 4, 40, 40) || inBox(x, y, 60, 60, 62, 62) ? 255 : 0), side);
    const out = cleanOnlyMask({ data: img.data, width: 40, height: 40, mask: m, maskSide: side });
    expect(out.alpha[39 * 40 + 39]).toBe(0);
  });

  it('sin sujeto, lo dice en las dos vías', () => {
    const empty = new Uint8Array(side * side);
    expect(() => applyMask(img, empty, side, 'refined')).toThrow(NoSubjectError);
    expect(() => applyMask(img, empty, side, 'clean')).toThrow(NoSubjectError);
  });

  it('si la foto ya tenía transparencia, se multiplica', () => {
    const half255 = photo(40, 40, () => [10, 10, 10, 128]);
    const out = applyMask(
      half255,
      mask(() => 255, side),
      side,
      'clean',
    );
    expect(out.data[3]).toBe(128);
  });
});
