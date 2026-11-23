// Margen alrededor del lienzo en el que se ve lo que sobresale (una foto
// agrandada más allá del borde), como en Canva: velado, con su caja y sus
// tiradores, y se puede agarrar. Lo que se exporta sigue siendo solo el lienzo.

/**
 * El margen, en píxeles de pantalla, a cada lado del lienzo: el hueco libre que deja dentro del área
 * (sin salirse de ella, para que no aparezcan barras de desplazamiento). Con el lienzo ampliado más
 * que el área, no queda margen.
 */
export function bleedFor(
  canvas: { width: number; height: number },
  scale: number,
  area: { width: number; height: number },
): { x: number; y: number } {
  const free = (room: number, size: number) => Math.max(0, Math.floor((room - Math.round(size * scale)) / 2) - 1);
  return { x: free(area.width, canvas.width), y: free(area.height, canvas.height) };
}

/** El color del velo: el fondo del área (token `--subtle`), casi opaco. */
export function veilColor(element: HTMLElement | null): string {
  const fallback = 'rgba(241, 243, 246, 0.72)';
  if (!element || typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(element).getPropertyValue('--subtle').trim();
  return value ? `hsl(${value} / 0.72)` : fallback;
}
