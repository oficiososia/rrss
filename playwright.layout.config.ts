import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Maquetación del editor en un navegador real, SIN Supabase: sirve el banco de
// vite.layout.config.ts (la aplicación con el cliente simulado de src/test).
// `npm run test:layout`. No sustituye a `npm run test:e2e`.
//
// Puerto: cada copia del repositorio (cada rama de trabajo) tiene el suyo, sacado de su carpeta, y se
// puede fijar con LAYOUT_PORT. Antes todas usaban el 5391 y se reutilizaba el servidor que ya
// escuchara: con varias ramas probando a la vez, unas pruebas se pasaban contra el código de OTRA
// carpeta (fallaban las que esa rama había cambiado) y, al terminar la otra tanda, su servidor se
// cerraba a mitad de la nuestra (`page.goto` sin respuesta). Ahora el servidor no se reutiliza: si el
// puerto está ocupado, falla al empezar y lo dice. LAYOUT_REUSE=1 reutiliza uno que hayas arrancado tú.
const folder = fileURLToPath(new URL('.', import.meta.url)).toLowerCase();
const folderPort = 5400 + (parseInt(createHash('sha1').update(folder).digest('hex').slice(0, 8), 16) % 500);
const PORT = Number(process.env.LAYOUT_PORT ?? folderPort);

export default defineConfig({
  testDir: 'tests/layout',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 2 : 0,
  // Abre cada banco una vez antes de empezar: la primera transformación de Vite no cuenta en el
  // límite de ninguna prueba (ver tests/layout/global-setup.ts).
  globalSetup: './tests/layout/global-setup.ts',
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: 'es-ES', ...devices['Desktop Chrome'] },
  webServer: {
    command: `npx vite --config vite.layout.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/layout.html`,
    reuseExistingServer: process.env.LAYOUT_REUSE === '1',
    timeout: 60_000,
  },
});
