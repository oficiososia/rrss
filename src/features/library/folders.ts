// Carpetas de la biblioteca. En la base de datos una carpeta es solo el texto de
// `media_assets.folder`; los niveles se separan con « / » («Platos / Mariscos»),
// como las deja la importación desde Drive. De ese texto sale el árbol.

export const FOLDER_SEP = ' / ';
export const MAX_FOLDER_LENGTH = 200;

export interface FolderNode {
  /** Ruta completa, p. ej. «Platos / Mariscos». */
  path: string;
  /** Último tramo, p. ej. «Mariscos». */
  name: string;
  depth: number;
  /** Archivos directamente en esta carpeta. */
  own: number;
  /** Archivos en ella y en todas las de dentro. */
  total: number;
  children: FolderNode[];
}

/** Limpia lo que se escribe como nombre de carpeta: sin barras sueltas ni espacios de más. */
export function cleanFolderName(raw: string): string {
  return raw
    .split(/\s*[/\\]\s*/)
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(FOLDER_SEP)
    .slice(0, MAX_FOLDER_LENGTH);
}

export const folderParts = (path: string): string[] => (path ? path.split(FOLDER_SEP) : []);
export const folderParent = (path: string): string => folderParts(path).slice(0, -1).join(FOLDER_SEP);
export const folderName = (path: string): string => folderParts(path).at(-1) ?? '';
export const joinFolder = (parent: string, name: string): string => (parent ? `${parent}${FOLDER_SEP}${name}` : name);

/** ¿`path` es `ancestor` o está dentro de ella? La carpeta vacía (raíz) no cuenta como contenedor. */
export function isInside(path: string, ancestor: string): boolean {
  return Boolean(ancestor) && (path === ancestor || path.startsWith(ancestor + FOLDER_SEP));
}

/** Las migas de pan de una carpeta: cada tramo con su ruta. */
export function breadcrumbs(path: string): Array<{ name: string; path: string }> {
  const parts = folderParts(path);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join(FOLDER_SEP) }));
}

/**
 * Árbol de carpetas a partir de cuántos archivos hay en cada ruta. `extra` son
 * carpetas vacías creadas por la persona (aún sin ningún archivo).
 */
export function buildFolderTree(counts: ReadonlyMap<string, number>, extra: readonly string[] = []): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];
  const ensure = (path: string): FolderNode => {
    const found = nodes.get(path);
    if (found) return found;
    const node: FolderNode = {
      path,
      name: folderName(path),
      depth: folderParts(path).length - 1,
      own: 0,
      total: 0,
      children: [],
    };
    nodes.set(path, node);
    const parent = folderParent(path);
    (parent ? ensure(parent).children : roots).push(node);
    return node;
  };
  for (const path of [...counts.keys(), ...extra]) if (path) ensure(path);
  for (const [path, n] of counts) {
    if (!path) continue;
    ensure(path).own += n;
    for (let at = path; at; at = folderParent(at)) ensure(at).total += n;
  }
  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** Todas las carpetas del árbol en orden de lectura (para el selector de móvil y «Mover a…»). */
export function flattenTree(tree: FolderNode[]): FolderNode[] {
  return tree.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** La ruta nueva de `path` al renombrar `from` como `to` (si no está dentro de `from`, no cambia). */
export function renamedPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(from + FOLDER_SEP) ? to + path.slice(from.length) : path;
}

/** Por qué no se puede renombrar `from` como `to`; `null` si se puede. */
export function renameProblem(from: string, to: string, existing: readonly string[]): string | null {
  if (!to) return 'Escribe un nombre para la carpeta.';
  if (to === from) return 'Es el mismo nombre.';
  if (isInside(to, from)) return 'Una carpeta no puede ir dentro de sí misma.';
  if (existing.includes(to)) return 'Ya existe una carpeta con ese nombre.';
  return null;
}
