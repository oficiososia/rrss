// Medidas de una tipografía TrueType/OpenType leídas del propio archivo, para
// partir las líneas y apilar los textos con el ancho REAL de cada letra (no con
// un ancho medio inventado). Solo se leen cuatro tablas: `head` (unidades por
// eme), `hhea` (subida y bajada de la letra, que es lo que usa `drawtext` con
// `y_align=font`), `hmtx` (avance de cada glifo) y `cmap` (qué glifo es cada
// carácter, formatos 4 y 12). Sin kerning: el error es de un 1–3 %, que se
// cubre con el margen de la caja.
//
// Si el archivo no se puede leer, `readFontMetrics` devuelve null y el montaje
// usa la estimación de siempre (`AVERAGE_GLYPH_WIDTH`).
import { readFile } from 'node:fs/promises';

export interface FontMetrics {
  unitsPerEm: number;
  /** Subida y bajada (positiva) de la letra, en unidades de la tipografía. */
  ascender: number;
  descender: number;
  /** Avance de cada carácter que la tipografía tiene (punto de código → unidades). */
  advances: Map<number, number>;
  /** Avance de lo que no está (el glifo 0, «.notdef»). */
  fallbackAdvance: number;
}

interface Table {
  offset: number;
  length: number;
}

function tables(data: Buffer): Map<string, Table> | null {
  if (data.length < 12) return null;
  const tag = data.toString('latin1', 0, 4);
  let base = 0;
  // Colección (.ttc): se usa la primera tipografía.
  if (tag === 'ttcf') {
    if (data.length < 16) return null;
    base = data.readUInt32BE(12);
  }
  if (base + 12 > data.length) return null;
  const count = data.readUInt16BE(base + 4);
  const out = new Map<string, Table>();
  for (let i = 0; i < count; i += 1) {
    const at = base + 12 + i * 16;
    if (at + 16 > data.length) return null;
    const name = data.toString('latin1', at, at + 4);
    const offset = data.readUInt32BE(at + 8);
    const length = data.readUInt32BE(at + 12);
    if (offset + length > data.length) continue;
    out.set(name, { offset, length });
  }
  return out;
}

/** Punto de código → glifo, de las subtablas Unicode de `cmap` (formato 12 si la hay; si no, 4). */
function readCmap(data: Buffer, table: Table): Map<number, number> {
  const glyphs = new Map<number, number>();
  const start = table.offset;
  const count = data.readUInt16BE(start + 2);
  let format4: number | null = null;
  let format12: number | null = null;
  for (let i = 0; i < count; i += 1) {
    const at = start + 4 + i * 8;
    const platform = data.readUInt16BE(at);
    const encoding = data.readUInt16BE(at + 2);
    const sub = start + data.readUInt32BE(at + 4);
    if (sub + 2 > data.length) continue;
    const format = data.readUInt16BE(sub);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12 && format12 === null) format12 = sub;
    if (format === 4 && format4 === null) format4 = sub;
  }
  if (format12 !== null) {
    const groups = data.readUInt32BE(format12 + 12);
    for (let g = 0; g < groups; g += 1) {
      const at = format12 + 16 + g * 12;
      if (at + 12 > data.length) break;
      const first = data.readUInt32BE(at);
      const last = data.readUInt32BE(at + 4);
      const glyph = data.readUInt32BE(at + 8);
      // Solo el plano básico y algo más: lo que puede salir en un rótulo.
      for (let c = first; c <= Math.min(last, 0x2fff); c += 1) glyphs.set(c, glyph + (c - first));
    }
    return glyphs;
  }
  if (format4 !== null) {
    const segX2 = data.readUInt16BE(format4 + 6);
    const segs = segX2 / 2;
    const ends = format4 + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segs; s += 1) {
      const end = data.readUInt16BE(ends + s * 2);
      const first = data.readUInt16BE(starts + s * 2);
      const delta = data.readInt16BE(deltas + s * 2);
      const rangeAt = ranges + s * 2;
      const range = data.readUInt16BE(rangeAt);
      for (let c = first; c <= end && c !== 0xffff; c += 1) {
        let glyph: number;
        if (range === 0) {
          glyph = (c + delta) & 0xffff;
        } else {
          const at = rangeAt + range + (c - first) * 2;
          if (at + 2 > data.length) continue;
          const raw = data.readUInt16BE(at);
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (glyph !== 0) glyphs.set(c, glyph);
      }
    }
  }
  return glyphs;
}

/** Medidas de una tipografía a partir de su contenido; null si no es una TrueType/OpenType legible. */
export function parseFontMetrics(data: Buffer): FontMetrics | null {
  try {
    const map = tables(data);
    if (!map) return null;
    const head = map.get('head');
    const hhea = map.get('hhea');
    const hmtx = map.get('hmtx');
    const cmap = map.get('cmap');
    if (!head || !hhea || !hmtx || !cmap) return null;
    const unitsPerEm = data.readUInt16BE(head.offset + 18);
    if (unitsPerEm < 16 || unitsPerEm > 16384) return null;
    const ascender = data.readInt16BE(hhea.offset + 4);
    const descender = data.readInt16BE(hhea.offset + 6);
    const metricsCount = data.readUInt16BE(hhea.offset + 34);
    const advanceOf = (glyph: number) => {
      const index = Math.min(glyph, metricsCount - 1);
      return data.readUInt16BE(hmtx.offset + index * 4);
    };
    const advances = new Map<number, number>();
    for (const [code, glyph] of readCmap(data, cmap)) advances.set(code, advanceOf(glyph));
    if (advances.size === 0) return null;
    return { unitsPerEm, ascender, descender: Math.abs(descender), advances, fallbackAdvance: advanceOf(0) };
  } catch {
    return null;
  }
}

export async function readFontMetrics(file: string): Promise<FontMetrics | null> {
  try {
    return parseFontMetrics(await readFile(file));
  } catch {
    return null;
  }
}

/** Ancho de un texto en píxeles con la letra a `fontSize` px (sin kerning). */
export function measureText(metrics: FontMetrics, text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    units += metrics.advances.get(code) ?? metrics.fallbackAdvance;
  }
  return (units * fontSize) / metrics.unitsPerEm;
}

/** Alto de una línea dibujada con `y_align=font` (subida + bajada), en píxeles. */
export function lineBoxHeight(metrics: FontMetrics, fontSize: number): number {
  return ((metrics.ascender + metrics.descender) * fontSize) / metrics.unitsPerEm;
}
