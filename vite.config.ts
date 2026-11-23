import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * `<link rel="preconnect">` a Supabase en index.html: el navegador abre la conexión (DNS, TCP y TLS)
 * mientras descarga el JavaScript, y la primera consulta del arranque ya no la espera. Sin
 * `VITE_SUPABASE_URL` no se añade nada.
 */
function preconnectSupabase(url: string | undefined): Plugin {
  return {
    name: 'preconectar-supabase',
    transformIndexHtml() {
      if (!url) return [];
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return [];
      }
      return [{ tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head' }];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), preconnectSupabase(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL)],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
  // Recorte de fotos en el navegador (onnxruntime-web en un Worker): módulo ES y
  // sin pre-empaquetar, para que encuentre su .wasm (docs/edicion-fotos.md, §7).
  worker: { format: 'es' as const },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          // Solo lo que pinta el armazón (menú desplegable y avisos). Las ventanas (Dialog) y las
          // pestañas (Tabs) llegan con las pantallas que las usan: metidas aquí, entraban en el
          // arranque aunque la primera pantalla no las enseñe.
          ui: ['@radix-ui/react-dropdown-menu', 'sonner'],
          // Sin lucide-react ni zod: metidos aquí arrastraban todos los iconos
          // (unos 4.700) y el validador al primer paquete. Fuera, cada pantalla
          // carga solo los iconos que usa y zod llega con las pantallas que lo piden.
          data: ['@tanstack/react-query'],
        },
      },
    },
  },
}));
