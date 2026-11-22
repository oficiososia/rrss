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
  // «Hacer un reel como este» (reel-como-este.html) solo se ofrece con estos dos interruptores:
  // en el banco van encendidos. El banco del editor de piezas no depende de ellos.
  define: {
    'import.meta.env.VITE_MEDIA_WORKER_ENABLED': JSON.stringify('true'),
    'import.meta.env.VITE_REEL_LIKE_ENABLED': JSON.stringify('true'),
    // «Preparar un plan con IA» (campanas-voz.html) solo se ofrece con la IA de texto encendida.
    'import.meta.env.VITE_AI_TEXT_ENABLED': JSON.stringify('true'),
  },
  server: { port: 5391, strictPort: true },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
