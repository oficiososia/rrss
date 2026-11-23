import { useEffect, useState } from 'react';

/** Ancho a partir del cual el editor tiene riel a la izquierda y paneles a los lados (`lg` de Tailwind). */
const WIDE = '(min-width: 1024px)';

const matches = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;

/**
 * ¿Pantalla ancha? En el móvil los cajones y los paneles son hojas bajas que se turnan (solo una
 * abierta a la vez) y se cierran al añadir algo, para ver cómo ha quedado. Sin `matchMedia`, ancha.
 */
export function useWideScreen(): boolean {
  const [wide, setWide] = useState(
    () => (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') || matches(),
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(WIDE);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return wide;
}
