// Copia al trabajador la matemática de «Quitar el fondo» de la aplicación, SIN duplicarla a
// mano: `src/features/photo-edit/cutout/{mask,refine,resample}.ts` es la única fuente, y lo
// que hay en `src/cutout/shared/` sale de aquí con las importaciones reescritas.
//
// Por qué una copia y no importar de `../../src`: la imagen Docker del trabajador solo lleva
// la carpeta `worker/`, y Node (que ejecuta el TypeScript tal cual, sin compilar) exige la
// extensión `.ts` en cada importación, que los módulos de la aplicación (vite) no llevan.
// Una prueba (tests/cutout-shared.test.ts) falla si la copia se queda desfasada:
//   npm run sync:cutout     (escribe las copias; hay que añadirlas al commit)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SOURCE_DIR = path.resolve(here, '../../src/features/photo-edit/cutout');
export const TARGET_DIR = path.resolve(here, '../src/cutout/shared');
export const SHARED_FILES = ['mask', 'refine', 'resample'] as const;

const HEADER = (name: string) =>
  `// COPIA GENERADA de src/features/photo-edit/cutout/${name}.ts por scripts/sync-cutout.ts.\n` +
  `// No se edita aquí: se cambia el original y se ejecuta «npm run sync:cutout» en worker/.\n`;

/** Importaciones del original → importaciones que Node resuelve (con `.ts`) dentro de la copia. */
export function transform(name: string, source: string): string {
  const rewritten = source
    .replace(/from '\.\.\/pixels'/g, "from './types.ts'")
    .replace(/from '\.\/model'/g, "from './types.ts'")
    .replace(/from '\.\/(refine|resample|mask)(\.js)?'/g, "from './$1.ts'");
  if (/from '(?!\.\/[a-z]+\.ts')[^']*'/.test(rewritten)) {
    throw new Error(`${name}.ts importa algo que la copia del trabajador no sabe resolver`);
  }
  return HEADER(name) + rewritten;
}

export function renderShared(): Record<string, string> {
  return Object.fromEntries(
    SHARED_FILES.map((name) => [
      `${name}.ts`,
      transform(name, readFileSync(path.join(SOURCE_DIR, `${name}.ts`), 'utf8').replace(/\r\n/g, '\n')),
    ]),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(TARGET_DIR, { recursive: true });
  for (const [file, content] of Object.entries(renderShared())) {
    writeFileSync(path.join(TARGET_DIR, file), content);
    process.stdout.write(`src/cutout/shared/${file}\n`);
  }
}
