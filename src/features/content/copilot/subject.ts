// Dónde está lo recortado dentro de una foto sin su fondo.
//
// Un recorte (la foto con el fondo quitado) conserva el tamaño de la foto
// original: lo que se ve (el plato, la máquina) puede ocupar una parte pequeña
// y el resto es transparente. Si se encaja la foto ENTERA en su caja, lo
// recortado queda diminuto (prueba real del 23/11/2026: el banco de press de
// EnerGym). Aquí se calcula la caja de los píxeles opacos para enseñar solo
// esa zona (`crop` de la capa) y que llene su sitio.

/** Caja en fracciones (0–1) de la imagen. */
export interface SubjectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Opacidad (0–255) desde la que un píxel cuenta como parte de lo recortado. */
const OPAQUE = 24;
/** Aire alrededor de lo recortado, en fracción de su lado: que no quede pegado al borde de la caja. */
const PADDING = 0.04;
/** Si lo recortado ya ocupa casi toda la foto, no hace falta recortar nada. */
const ALMOST_ALL = 0.92;

/**
 * Caja de los píxeles opacos de una imagen RGBA (con un poco de aire), o
 * `null` si no hay nada opaco o si ya ocupa casi toda la imagen.
 */
export function subjectBounds(pixels: ArrayLike<number>, width: number, height: number): SubjectBox | null {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return null;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3]! < OPAQUE) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const boxWidth = (right - left + 1) / width;
  const boxHeight = (bottom - top + 1) / height;
  // Casi toda la foto (nada que ganar) o una mota (ruido): mejor la foto entera.
  if ((boxWidth >= ALMOST_ALL && boxHeight >= ALMOST_ALL) || boxWidth < 0.03 || boxHeight < 0.03) return null;
  const padX = boxWidth * PADDING;
  const padY = boxHeight * PADDING;
  const x = Math.max(0, left / width - padX);
  const y = Math.max(0, top / height - padY);
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  return {
    x: round(x),
    y: round(y),
    width: round(Math.min(1 - x, boxWidth + padX * 2)),
    height: round(Math.min(1 - y, boxHeight + padY * 2)),
  };
}
