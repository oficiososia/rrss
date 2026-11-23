import type { MediaAssetRow } from '@/lib/database.types';
import { folderName } from './folders';

// Nombres de archivo que caben en una tarjeta pequeña y, aun así, se distinguen.
//
// Fallo 19 de la prueba en staging: tres «Arroz meloso…» cortados por el mismo
// sitio no se distinguían. Si varios nombres largos empiezan igual, en la
// tarjeta se deja la parte que los diferencia (el final del nombre o, si los
// nombres son iguales, la carpeta). El nombre entero sigue a mano al pasar el
// ratón o al mantener pulsado (ver AssetName.tsx). Sin React: se prueba aparte.

/** Caracteres que caben en la tarjeta de una rejilla de tres columnas en el móvil (402 px, letra de 12 px). */
export const NAME_CHARS = 16;

export interface DistinctName {
  /** Lo que cabe en la tarjeta (con «…» donde se ha cortado). */
  label: string;
  /** El nombre entero (para el título y la pulsación larga). */
  full: string;
  /** La carpeta, solo cuando hace falta para distinguir dos nombres iguales. */
  folder: string | null;
}

type Named = Pick<MediaAssetRow, 'id' | 'file_name' | 'folder'>;

function commonPrefix(values: string[]): number {
  if (values.length === 0) return 0;
  let n = 0;
  const first = values[0]!;
  while (n < first.length && values.every((v) => v[n] === first[n])) n += 1;
  return n;
}

/** El corte normal: el principio y «…». */
const head = (base: string, max: number) => (base.length <= max ? base : `${base.slice(0, max - 1).trimEnd()}…`);

/**
 * Etiqueta de cada archivo para la tarjeta. Los nombres que caben, enteros; los largos, cortados
 * al final salvo que choquen con otro (mismo principio): entonces se enseña la parte que cambia.
 */
export function distinctNames(assets: readonly Named[], max = NAME_CHARS): Map<string, DistinctName> {
  // Con la extensión: «.jpg» también es parte del nombre que se reconoce.
  const bases = new Map(assets.map((a) => [a.id, a.file_name.trim() || a.file_name]));
  // Grupos de nombres que, cortados por el principio, se verían iguales.
  const byHead = new Map<string, Named[]>();
  for (const a of assets) {
    const key = head(bases.get(a.id)!, max).toLocaleLowerCase('es');
    byHead.set(key, [...(byHead.get(key) ?? []), a]);
  }

  const result = new Map<string, DistinctName>();
  for (const group of byHead.values()) {
    const groupBases = group.map((a) => bases.get(a.id)!);
    const distinctBases = new Set(groupBases.map((b) => b.toLocaleLowerCase('es')));
    const prefix = commonPrefix([...distinctBases]);
    const folders = new Set(group.map((a) => a.folder));
    for (const a of group) {
      const base = bases.get(a.id)!;
      let label = head(base, max);
      if (distinctBases.size > 1 && base.length > max) {
        // La parte que cambia: desde un poco antes de donde empiezan a diferir (o el final).
        const tail = base.slice(-(max - 1)).trimStart();
        const window = base.slice(Math.max(0, prefix - 4), Math.max(0, prefix - 4) + max - 2).trim();
        label = prefix >= base.length - (max - 1) ? `…${tail}` : `…${window}…`;
      }
      // Mismo nombre en carpetas distintas: la carpeta los distingue.
      const sameName = groupBases.filter((b) => b.toLocaleLowerCase('es') === base.toLocaleLowerCase('es')).length > 1;
      result.set(a.id, {
        label,
        full: a.file_name,
        folder: sameName && folders.size > 1 && a.folder ? folderName(a.folder) : null,
      });
    }
  }
  return result;
}
