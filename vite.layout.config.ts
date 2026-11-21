import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Banco de pruebas de MAQUETACIÓN del editor en un navegador real, sin Supabase:
// monta la aplicación con el cliente simulado de src/test (ver tests/layout/entry.tsx).
// Solo para `npm run test:layout`; nunca se compila en la aplicación.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    {
      // Cualquier ruta de la aplicación (recargas incluidas) sirve el banco, no el index.html real.
      name: 'banco-de-maquetacion',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const path = (req.url ?? '').split('?')[0]!;
          if (req.method === 'GET' && path.startsWith('/o/'))
            req.url = '/layout.html' + (req.url ?? '').slice(path.length);
          next();
        });
      },
    },
  ],
  resolve: {
    alias: [
      { find: 'vitest', replacement: here('./tests/layout/vitest-shim.ts') },
      { find: '@/lib/supabase', replacement: here('./tests/layout/supabase-fake.ts') },
      { find: '@', replacement: here('./src') },
    ],
  },
  server: { port: 5391, strictPort: true },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
