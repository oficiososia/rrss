import { defineConfig, devices } from '@playwright/test';

// Prueba de extremo a extremo de la Fase 1 contra el Supabase LOCAL
// (`supabase start`, ver supabase/config.toml). Nunca apunta a un proyecto remoto.
//
// La aplicación se sirve en un puerto propio (5273) para no chocar con un
// `npm run dev` abierto en el 5173. Los archivos van en orden y con un solo
// trabajador: cada uno parte de lo que dejó el anterior (usuarios,
// organizaciones, marcas), guardado en `.e2e/estado.json`.
export const E2E_PORT = 5273;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Holgados a propósito: con Docker y otros procesos en la misma máquina hay parones de varios segundos.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: process.env.E2E_TRAZA === '1' ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } }],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
