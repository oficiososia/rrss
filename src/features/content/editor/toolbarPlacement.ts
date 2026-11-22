// Dónde se pone la barra de acciones del elemento elegido: encima de él si
// cabe, debajo si no, y —solo cuando el elemento llena el lienzo y no queda
// sitio fuera— pegada al borde de arriba del área. Nunca se sale del área.
// Puro: recibe medidas en píxeles del área del lienzo y devuelve una posición.

export interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ToolbarPlacement {
  left: number;
  top: number;
  /** `overlap`: no cabía ni encima ni debajo. */
  side: 'above' | 'below' | 'overlap';
}

/** Aire entre la barra y los bordes del área. */
export const TOOLBAR_MARGIN = 4;
/** Aire entre la barra y el elemento. */
export const TOOLBAR_GAP = 10;
/** Sitio que ocupa debajo del elemento el tirador de girar (ver `ROTATE_ANCHOR_OFFSET` en scene.ts). */
export const ROTATE_HANDLE_ROOM = 44;

export function placeToolbar(
  target: PixelRect,
  bar: { width: number; height: number },
  area: { width: number; height: number },
): ToolbarPlacement {
  const center = (target.left + target.right) / 2;
  // Si no cabe ni con los márgenes (una pantalla muy estrecha), centrada en el área.
  const tight = bar.width + 2 * TOOLBAR_MARGIN >= area.width;
  const left = tight
    ? Math.max(0, Math.round((area.width - bar.width) / 2))
    : Math.round(Math.min(area.width - bar.width - TOOLBAR_MARGIN, Math.max(TOOLBAR_MARGIN, center - bar.width / 2)));
  const maxTop = Math.max(TOOLBAR_MARGIN, area.height - bar.height - TOOLBAR_MARGIN);

  const above = target.top - TOOLBAR_GAP - bar.height;
  if (above >= TOOLBAR_MARGIN) return { left, top: Math.round(Math.min(above, maxTop)), side: 'above' };

  const below = target.bottom + TOOLBAR_GAP + ROTATE_HANDLE_ROOM;
  if (below + bar.height <= area.height - TOOLBAR_MARGIN) return { left, top: Math.round(below), side: 'below' };

  return { left, top: TOOLBAR_MARGIN, side: 'overlap' };
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
