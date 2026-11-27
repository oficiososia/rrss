import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type FullConfig } from '@playwright/test';

// Calentamiento del banco de maquetación antes de la primera prueba.
//
// Vite sirve los módulos sin empaquetar y los transforma la primera vez que alguien los pide. La
// primera prueba de cada banco pagaba esa transformación (cientos de módulos) dentro de su propio
// límite de 90 s: con la máquina cargada se pasaba y fallaba en `page.goto` o en el primer `expect`
// sin que nada estuviera mal. Aquí se abre cada banco una vez, con un límite propio holgado, para
// que las pruebas empiecen con todo transformado.

const root = fileURLToPath(new URL('../..', import.meta.url));
/** Límite de cada banco: transformar la aplicación entera es lento de verdad con la máquina cargada. */
const WARM_UP_TIMEOUT_MS = 300_000;

export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const benches = readdirSync(root).filter((name) => name.endsWith('.html') && name !== 'index.html');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const bench of benches) {
      await page.goto(`${baseURL}/${bench}`, { waitUntil: 'load', timeout: WARM_UP_TIMEOUT_MS });
    }
  } finally {
    await browser.close();
  }
}
