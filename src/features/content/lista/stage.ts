import type { ContentItemRow, PublicationHoldReason, PublicationStatus } from '@/lib/database.types';

// En qué punto está una pieza, en palabras de la persona y no de la base de datos.
// El estado de la pieza (idea, borrador, en revisión, aprobada) y el de su
// publicación (programada, publicada…) se juntan en cinco etapas:
//
//   Ideas · En preparación · Listas · Programadas · Publicadas
//
// Sin dependencias de React: se prueba aparte.

export type ContentStage = 'idea' | 'preparing' | 'ready' | 'scheduled' | 'published';

export const STAGES: { id: ContentStage; label: string; hint: string }[] = [
  { id: 'idea', label: 'Ideas', hint: 'Apuntadas, todavía sin diseñar.' },
  { id: 'preparing', label: 'En preparación', hint: 'Se están diseñando o esperan revisión.' },
  { id: 'ready', label: 'Listas', hint: 'Aprobadas, falta ponerles fecha.' },
  { id: 'scheduled', label: 'Programadas', hint: 'Con día y hora para salir.' },
  { id: 'published', label: 'Publicadas', hint: 'Ya están en la red.' },
];

type Tone = 'neutral' | 'primary' | 'warning' | 'success' | 'danger';

export const STAGE_TONE: Record<ContentStage, Tone> = {
  idea: 'neutral',
  preparing: 'primary',
  ready: 'success',
  scheduled: 'warning',
  published: 'success',
};

/** Lo que se sabe de la publicación de una pieza (la que manda, si tiene varias). */
export interface PublicationLite {
  content_id: string;
  status: PublicationStatus;
  scheduled_at: string;
  published_at: string | null;
  hold_reason: PublicationHoldReason | null;
}

const ACTIVE: PublicationStatus[] = ['planned', 'scheduled', 'publishing', 'failed'];

/**
 * Una publicación por pieza: la que está por salir más próxima y, si no hay
 * ninguna, la publicada más reciente. Las canceladas no cuentan.
 */
export function pickPublications(rows: PublicationLite[]): Map<string, PublicationLite> {
  const best = new Map<string, PublicationLite>();
  for (const row of rows) {
    if (row.status === 'cancelled') continue;
    const current = best.get(row.content_id);
    if (!current) {
      best.set(row.content_id, row);
      continue;
    }
    const rowActive = ACTIVE.includes(row.status);
    const currentActive = ACTIVE.includes(current.status);
    if (rowActive && !currentActive) best.set(row.content_id, row);
    else if (rowActive && currentActive && row.scheduled_at < current.scheduled_at) best.set(row.content_id, row);
    else if (!rowActive && !currentActive && row.scheduled_at > current.scheduled_at) best.set(row.content_id, row);
  }
  return best;
}

export function stageOf(item: Pick<ContentItemRow, 'status'>, publication?: PublicationLite | null): ContentStage {
  if (publication?.status === 'published') return 'published';
  if (publication && ACTIVE.includes(publication.status)) return 'scheduled';
  if (item.status === 'idea') return 'idea';
  if (item.status === 'approved') return 'ready';
  return 'preparing';
}

/** ¿La publicación necesita que alguien haga algo (detenida o fallida)? */
export function needsFix(publication?: PublicationLite | null): boolean {
  return Boolean(publication && (publication.status === 'failed' || publication.hold_reason));
}

/** Pieza sin ninguna versión guardada: no tiene diseño todavía, solo el nombre. */
export function isEmptyPiece(item: Pick<ContentItemRow, 'current_version'>, publication?: PublicationLite | null) {
  return item.current_version === 0 && !publication;
}

/** Texto y color del estado que se enseña en la tarjeta. */
export function stageBadge(
  stage: ContentStage,
  publication?: PublicationLite | null,
): { label: string; tone: Tone } {
  if (stage === 'scheduled' && needsFix(publication)) {
    return { label: publication?.status === 'failed' ? 'No salió' : 'Detenida', tone: 'danger' };
  }
  const label: Record<ContentStage, string> = {
    idea: 'Idea',
    preparing: 'En preparación',
    ready: 'Lista',
    scheduled: 'Programada',
    published: 'Publicada',
  };
  return { label: label[stage], tone: STAGE_TONE[stage] };
}

/** Nombre por defecto de una pieza nueva: el formato y el día («Reel · 22 nov»). */
export function defaultTitle(formatLabel: string, now = new Date()): string {
  const day = now.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
  return `${formatLabel} · ${day}`;
}
