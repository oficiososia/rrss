// Control del tamaño del JavaScript inicial (lo que el navegador descarga antes de pintar nada).
//
// Lee dist/index.html después de `npm run build`, suma el JavaScript que pide al entrar (el
// <script type="module"> y los <link rel="modulepreload">) comprimido con gzip, y falla si pasa
// del límite. Las pantallas que se cargan bajo demanda no cuentan.
//
//   npm run check:initial-js            (tras `npm run build`)
//   node scripts/check-initial-js.mjs --dist otra/carpeta
//
// El límite es lo conseguido al optimizar el arranque (docs/ESTADO.md, F60) más un 10 %. Si una
// funcionalidad nueva lo supera, la solución casi siempre es cargarla bajo demanda (lazyRoute,
// React.lazy o import()) y no subir el límite.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/** KB (gzip) de JavaScript inicial: 208 medidos en F60 (23/11/2026), más un 10 %. */
export const INITIAL_JS_LIMIT_KB = 229;

const argIndex = process.argv.indexOf('--dist');
const dist = resolve(argIndex > 0 ? process.argv[argIndex + 1] : 'dist');

let html;
try {
  html = readFileSync(join(dist, 'index.html'), 'utf8');
} catch {
  console.error(`No encuentro ${join(dist, 'index.html')}: ejecuta antes «npm run build».`);
  process.exit(2);
}

const files = new Set();
for (const match of html.matchAll(/<script[^>]*type="module"[^>]*src="\/([^"]+\.js)"/g)) files.add(match[1]);
for (const match of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/([^"]+\.js)"/g)) files.add(match[1]);
if (files.size === 0) {
  console.error('dist/index.html no pide ningún JavaScript: ¿ha cambiado el formato de la build?');
  process.exit(2);
}

let totalKb = 0;
const rows = [];
for (const file of files) {
  const kb = gzipSync(readFileSync(join(dist, file))).length / 1024;
  totalKb += kb;
  rows.push(`  ${kb.toFixed(1).padStart(6)} KB  ${file}`);
}
console.log(`JavaScript inicial (gzip), ${files.size} archivos:`);
console.log(rows.join('\n'));
console.log(`  ${totalKb.toFixed(1).padStart(6)} KB  en total (límite ${INITIAL_JS_LIMIT_KB} KB)`);

if (totalKb > INITIAL_JS_LIMIT_KB) {
  console.error(
    `\nEl JavaScript inicial pasa del límite (${totalKb.toFixed(1)} KB > ${INITIAL_JS_LIMIT_KB} KB). ` +
      'Carga bajo demanda lo nuevo (pantallas, editores, librerías pesadas) en vez de subir el límite.',
  );
  process.exit(1);
}
