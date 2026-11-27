// Avisos flotantes del editor de reels. En móvil el editor ocupa la pantalla:
// arriba están volver, deshacer, «⋯» y «Exportar», y abajo la barra de
// herramientas. Los avisos de la aplicación salen arriba y tapaban esos botones
// (y el toque se lo quedaba el aviso): aquí bajan hasta debajo de la cabecera,
// sobre el vídeo, y duran menos. En escritorio, como en el resto de la app.
import { toast, type ExternalToast } from 'sonner';

/** Por debajo de este ancho el editor va a pantalla completa (el `max-lg` de su raíz). */
const FULLSCREEN = '(max-width: 1023px)';

export function editorToastOptions(extra: ExternalToast = {}): ExternalToast {
  const fullscreen = typeof window !== 'undefined' && (window.matchMedia?.(FULLSCREEN).matches ?? false);
  if (!fullscreen) return extra;
  return {
    duration: 3000,
    ...extra,
    style: { marginTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)', ...extra.style },
  };
}

export const notify = {
  success: (message: string, extra?: ExternalToast) => toast.success(message, editorToastOptions(extra)),
  info: (message: string, extra?: ExternalToast) => toast.info(message, editorToastOptions(extra)),
  error: (message: string, extra?: ExternalToast) => toast.error(message, editorToastOptions(extra)),
};
