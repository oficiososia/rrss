import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

/** Cuánto hay que mantener pulsado (en una pantalla táctil) para que cuente como pulsación larga. */
export const LONG_PRESS_MS = 500;

/**
 * Pulsación larga en una pantalla táctil (con ratón no hace nada: para eso están el `title` y el
 * clic con Ctrl). Se reparte en el botón; soltar después de una pulsación larga NO cuenta como
 * clic, y el menú del sistema no sale.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  });
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
      callback.current();
    }, LONG_PRESS_MS);
  }, []);
  const stop = useCallback(() => clear(), []);
  const onClickCapture = useCallback((event: MouseEvent) => {
    if (longPressed.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressed.current = false;
    }
  }, []);
  const onContextMenu = useCallback((event: MouseEvent) => {
    if (longPressed.current || timer.current) event.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClickCapture,
    onContextMenu,
  };
}

/**
 * Ver el nombre entero de un archivo manteniendo pulsada su tarjeta (en el móvil no hay «pasar el
 * ratón»). La pulsación larga NO elige la foto.
 */
export function useNameReveal() {
  const [revealed, setRevealed] = useState(false);
  const handlers = useLongPress(() => setRevealed(true));
  const hide = useCallback(() => setRevealed(false), []);
  return { revealed, hide, handlers };
}
