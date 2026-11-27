// COPIA GENERADA de src/features/photo-edit/cutout/resample.ts por scripts/sync-cutout.ts.
// No se edita aquí: se cambia el original y se ejecuta «npm run sync:cutout» en worker/.
// Reescalado de un canal (matemática pura, SIN importaciones): lo usan el recorte del
// navegador y la función del servidor (`api/cutout-mask.ts`), que la importa tal cual.
// Con importaciones sin extensión no corre en Node (ESM): no añadir ninguna aquí.

/** Interpolación bilinear de un solo canal (0–255 o float) a otro tamaño. */
export function resizeChannel(
  source: ArrayLike<number>,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Float32Array {
  const out = new Float32Array(toWidth * toHeight);
  const sx = width / toWidth;
  const sy = height / toHeight;
  for (let y = 0; y < toHeight; y += 1) {
    const fy = Math.max(0, Math.min(height - 1, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < toWidth; x += 1) {
      const fx = Math.max(0, Math.min(width - 1, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      const top = source[y0 * width + x0]! * (1 - wx) + source[y0 * width + x1]! * wx;
      const bottom = source[y1 * width + x0]! * (1 - wx) + source[y1 * width + x1]! * wx;
      out[y * toWidth + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

/**
 * Reescalado de un canal con buen remuestreo: al ENCOGER promedia el área que
 * cubre cada píxel nuevo (como `INTER_AREA` de OpenCV, sin escalones ni moiré) y
 * al AGRANDAR interpola linealmente. Por ejes, así que sirve con proporciones
 * distintas en cada uno.
 */
export function resizeAreaChannel(
  source: ArrayLike<number>,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Float32Array {
  const axis = (from: number, to: number) => {
    const starts = new Int32Array(to);
    const weights: Float32Array[] = [];
    const scale = from / to;
    for (let i = 0; i < to; i += 1) {
      if (scale > 1) {
        const a = i * scale;
        const b = (i + 1) * scale;
        const first = Math.floor(a);
        const last = Math.min(from - 1, Math.ceil(b) - 1);
        const w = new Float32Array(last - first + 1);
        let sum = 0;
        for (let k = first; k <= last; k += 1) {
          w[k - first] = Math.min(b, k + 1) - Math.max(a, k);
          sum += w[k - first]!;
        }
        for (let k = 0; k < w.length; k += 1) w[k] = w[k]! / sum;
        starts[i] = first;
        weights.push(w);
      } else {
        const f = Math.max(0, Math.min(from - 1, (i + 0.5) * scale - 0.5));
        const k0 = Math.floor(f);
        const k1 = Math.min(from - 1, k0 + 1);
        starts[i] = k0;
        weights.push(k1 === k0 ? Float32Array.of(1) : Float32Array.of(1 - (f - k0), f - k0));
      }
    }
    return { starts, weights };
  };
  const ax = axis(width, toWidth);
  const ay = axis(height, toHeight);
  const rows = new Float32Array(toWidth * height); // primero en horizontal
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < toWidth; x += 1) {
      const w = ax.weights[x]!;
      const x0 = ax.starts[x]!;
      let acc = 0;
      for (let k = 0; k < w.length; k += 1) acc += source[y * width + x0 + k]! * w[k]!;
      rows[y * toWidth + x] = acc;
    }
  }
  const out = new Float32Array(toWidth * toHeight);
  for (let y = 0; y < toHeight; y += 1) {
    const w = ay.weights[y]!;
    const y0 = ay.starts[y]!;
    for (let x = 0; x < toWidth; x += 1) {
      let acc = 0;
      for (let k = 0; k < w.length; k += 1) acc += rows[(y0 + k) * toWidth + x]! * w[k]!;
      out[y * toWidth + x] = acc;
    }
  }
  return out;
}
