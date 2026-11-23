// Nombres legibles en las miniaturas de la biblioteca (simplificación B4): «Portada reel» en vez de
// «portada-reel-20261123-085833.jpg». No cambia nada guardado: es solo cómo se enseña. El nombre
// del archivo sigue en la ficha y al pasar el ratón. Sin React: se prueba aparte.

/** Fecha y hora pegadas al nombre: 20261123-085833, 20261123_085833, 20261123, o una marca de tiempo en ms. */
const TIMESTAMP = /(?:^|[\s_-])(?:\d{8}(?:[\s_-]?\d{4,6})?|\d{13})(?=$|[\s_-])/g;
/** Tamaño de una exportación: 1080x1350. */
const SIZE = /(?:^|[\s_-])\d{2,5}x\d{2,5}(?=$|[\s_-])/gi;
/** Versión y página de una exportación: -v3, -p2, -pag2. */
const VERSION = /(?:^|[\s_-])(?:v\d{1,4}|p(?:ag)?\d{1,3})(?=$|[\s_-])/gi;

/** El nombre del archivo sin extensión. */
export function withoutExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, '').trim() || fileName;
}

/**
 * El título que se enseña. Si el nombre ya lo escribió una persona (con espacios), se respeta
 * tal cual sin la extensión; si es un nombre técnico (guiones, fechas, tamaños), se limpia.
 */
export function readableName(fileName: string): string {
  const base = withoutExtension(fileName);
  if (/\s/.test(base) && !/\d{8}/.test(base)) return base;
  const cleaned = base
    .replace(TIMESTAMP, ' ')
    .replace(SIZE, ' ')
    .replace(VERSION, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^\d+$/.test(cleaned)) return base;
  return cleaned.charAt(0).toLocaleUpperCase('es') + cleaned.slice(1);
}
