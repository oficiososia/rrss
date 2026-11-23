import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/** Cuánto hay que mantener pulsado (en una pantalla táctil) para ver el nombre entero. */
export const LONG_PRESS_MS = 500;

/**
 * Ver el nombre entero de un archivo manteniendo pulsada su tarjeta (en el móvil no hay «pasar el
 * ratón»). Se reparte en el botón de la tarjeta; la pulsación larga NO elige la foto. Con ratón
 * basta el `title` del botón.
 */
export function useNameReveal() {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const onPointerDown = useCallback((event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    longPressed.current = false;
    clear();
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setRevealed(true);
    }, LONG_PRESS_MS);
  }, []);
  const stop = useCallback(() => clear(), []);
  const onClickCapture = useCallback((event: MouseEvent) => {
    // Soltar tras una pulsación larga solo enseña el nombre: no elige.
    if (longPressed.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressed.current = false;
    }
  }, []);
  const hide = useCallback(() => setRevealed(false), []);

  return {
    revealed,
    hide,
    handlers: {
      onPointerDown,
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onClickCapture,
      onContextMenu: (event: MouseEvent) => {
        // El menú del sistema de la pulsación larga taparía el nombre.
        if (longPressed.current || timer.current) event.preventDefault();
      },
    },
  };
}
