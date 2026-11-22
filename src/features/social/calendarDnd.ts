// Arrastrar en el calendario: una publicación ya programada (para moverla) o una
// pieza de la bandeja «Por programar» (para programarla). El navegador no deja leer
// lo arrastrado hasta soltar, así que todo viaja como texto y se valida al soltar.

export type DragPayload = { kind: 'entry'; id: string } | { kind: 'content'; id: string };

const TAG = 'rrss-calendario';

export function setDrag(transfer: DataTransfer, payload: DragPayload): void {
  transfer.setData('text/plain', JSON.stringify({ [TAG]: payload }));
  transfer.effectAllowed = 'move';
}

export function readDrag(transfer: DataTransfer): DragPayload | null {
  try {
    const parsed = JSON.parse(transfer.getData('text/plain')) as Record<string, unknown>;
    const p = parsed[TAG] as Partial<DragPayload> | undefined;
    if (p && (p.kind === 'entry' || p.kind === 'content') && typeof p.id === 'string') return p as DragPayload;
  } catch {
    /* no era nuestro */
  }
  return null;
}
