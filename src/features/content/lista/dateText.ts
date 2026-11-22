import type { BoardItem } from './useContentBoard';

/**
 * «25 nov, 22:28» en la hora de la marca; con el año solo si no es el de ahora («25 nov 2027, 22:28»).
 * Corto a propósito: va en tarjetas pequeñas.
 */
export function shortDateTime(iso: string, zone: string, now = new Date()): string {
  const date = new Date(iso);
  const year = (d: Date) => Number(d.toLocaleDateString('en-US', { year: 'numeric', timeZone: zone }));
  return date.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    ...(year(date) !== year(now) ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  });
}

/** Fecha que importa de la pieza: cuándo sale o cuándo salió. Sin fecha, nada. */
export function dateText(item: Pick<BoardItem, 'publication'>, zone: string): string | null {
  const publication = item.publication;
  if (!publication) return null;
  if (publication.status === 'published') {
    return `Publicada el ${shortDateTime(publication.published_at ?? publication.scheduled_at, zone).split(',')[0]}`;
  }
  return `Sale el ${shortDateTime(publication.scheduled_at, zone)}`;
}
