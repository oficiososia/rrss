import { defineConfig, devices } from '@playwright/test';

// Maquetación del editor en un navegador real, SIN Supabase: sirve el banco de
// vite.layout.config.ts (la aplicación con el cliente simulado de src/test).
// `npm run test:layout`. No sustituye a `npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/layout',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5391', locale: 'es-ES', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npx vite --config vite.layout.config.ts --host 127.0.0.1',
    url: 'http://127.0.0.1:5391/layout.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
