// Dónde se pone la barra de acciones del elemento elegido sin tapar lo que hay
// debajo: se prueban, por este orden, encima del elemento, debajo, a su derecha,
// a su izquierda y, si nada de eso cabe, pegada al borde de arriba o de abajo
// del área. De los sitios que caben se queda el que menos pisa los textos de la
// página (lo que más estorba tapar) y el propio elemento; a igualdad, el
// primero. Nunca se sale del área. Puro: recibe medidas en píxeles del área del
// lienzo y devuelve una posición.

export interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Algo que la barra no debería tapar, con lo que pesa taparlo. */
export interface ToolbarObstacle extends PixelRect {
  weight: number;
}

export interface ToolbarPlacement {
  left: number;
  top: number;
  /** `beside`: a un lado del elemento; `edge`: pegada al borde de arriba o de abajo del área. */
  side: 'above' | 'below' | 'beside' | 'edge';
}

/** Aire entre la barra y los bordes del área. */
export const TOOLBAR_MARGIN = 4;
/** Aire entre la barra y el elemento. */
export const TOOLBAR_GAP = 6;
/** Sitio que ocupa debajo del elemento el tirador de girar (ver `ROTATE_ANCHOR_OFFSET` en scene.ts). */
export const ROTATE_HANDLE_ROOM = 44;
/** Lo que pesa tapar un texto de la página (frente a 1 de un píxel del elemento elegido). */
export const TEXT_WEIGHT = 10;
/** Lo que pesa tapar el propio elemento elegido. */
export const TARGET_WEIGHT = 3;

function overlapArea(a: PixelRect, b: PixelRect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

export function placeToolbar(
  target: PixelRect,
  bar: { width: number; height: number },
  area: { width: number; height: number },
  obstacles: readonly ToolbarObstacle[] = [],
): ToolbarPlacement {
  const center = (target.left + target.right) / 2;
  // Si no cabe ni con los márgenes (una pantalla muy estrecha), centrada en el área.
  const tight = bar.width + 2 * TOOLBAR_MARGIN >= area.width;
  const centered = tight
    ? Math.max(0, Math.round((area.width - bar.width) / 2))
    : Math.round(Math.min(area.width - bar.width - TOOLBAR_MARGIN, Math.max(TOOLBAR_MARGIN, center - bar.width / 2)));
  const maxTop = Math.max(TOOLBAR_MARGIN, area.height - bar.height - TOOLBAR_MARGIN);
  const besideTop = Math.round(Math.min(maxTop, Math.max(TOOLBAR_MARGIN, target.top)));

  const candidates: ToolbarPlacement[] = [];
  const above = target.top - TOOLBAR_GAP - bar.height;
  if (above >= TOOLBAR_MARGIN)
    candidates.push({ left: centered, top: Math.round(Math.min(above, maxTop)), side: 'above' });
  const below = target.bottom + TOOLBAR_GAP + ROTATE_HANDLE_ROOM;
  if (below + bar.height <= area.height - TOOLBAR_MARGIN)
    candidates.push({ left: centered, top: Math.round(below), side: 'below' });
  const right = target.right + TOOLBAR_GAP;
  if (right + bar.width <= area.width - TOOLBAR_MARGIN)
    candidates.push({ left: Math.round(right), top: besideTop, side: 'beside' });
  const left = target.left - TOOLBAR_GAP - bar.width;
  if (left >= TOOLBAR_MARGIN) candidates.push({ left: Math.round(left), top: besideTop, side: 'beside' });
  candidates.push({ left: centered, top: TOOLBAR_MARGIN, side: 'edge' });
  candidates.push({ left: centered, top: Math.round(maxTop), side: 'edge' });

  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const place of candidates) {
    const box = { left: place.left, top: place.top, right: place.left + bar.width, bottom: place.top + bar.height };
    let score = overlapArea(box, target) * TARGET_WEIGHT;
    for (const obstacle of obstacles) score += overlapArea(box, obstacle) * obstacle.weight;
    if (score < bestScore) {
      best = place;
      bestScore = score;
    }
  }
  return best;
}

/** Caja alineada con los ejes que contiene a varias cajas giradas (unidades del lienzo). */
export function boundsOf(
  boxes: readonly { x: number; y: number; width: number; height: number; rotation: number }[],
): PixelRect | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const angle = (box.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const halfW = (box.width * cos + box.height * sin) / 2;
    const halfH = (box.width * sin + box.height * cos) / 2;
    left = Math.min(left, cx - halfW);
    right = Math.max(right, cx + halfW);
    top = Math.min(top, cy - halfH);
    bottom = Math.max(bottom, cy + halfH);
  }
  return { left, top, right, bottom };
}
