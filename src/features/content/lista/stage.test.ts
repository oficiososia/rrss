import { describe, expect, it } from 'vitest';
import { defaultTitle, isEmptyPiece, needsFix, pickPublications, stageBadge, stageOf, type PublicationLite } from './stage';

const pub = (patch: Partial<PublicationLite> = {}): PublicationLite => ({
  content_id: 'c1',
  status: 'scheduled',
  scheduled_at: '2026-12-01T10:00:00Z',
  published_at: null,
  hold_reason: null,
  ...patch,
});

describe('etapa de una pieza', () => {
  it('sin publicación manda el estado de la pieza', () => {
    expect(stageOf({ status: 'idea' })).toBe('idea');
    expect(stageOf({ status: 'draft' })).toBe('preparing');
    expect(stageOf({ status: 'in_review' })).toBe('preparing');
    expect(stageOf({ status: 'approved' })).toBe('ready');
  });

  it('con publicación manda la publicación', () => {
    expect(stageOf({ status: 'approved' }, pub())).toBe('scheduled');
    expect(stageOf({ status: 'approved' }, pub({ status: 'publishing' }))).toBe('scheduled');
    expect(stageOf({ status: 'approved' }, pub({ status: 'published' }))).toBe('published');
    // Una publicación detenida sigue siendo «programada», pero pide arreglo.
    expect(stageOf({ status: 'approved' }, pub({ hold_reason: 'no_account' }))).toBe('scheduled');
  });

  it('elige la publicación que manda: la próxima por salir, y si no, la última publicada', () => {
    const rows = [
      pub({ status: 'published', scheduled_at: '2026-10-01T10:00:00Z' }),
      pub({ status: 'scheduled', scheduled_at: '2026-12-10T10:00:00Z' }),
      pub({ status: 'scheduled', scheduled_at: '2026-12-02T10:00:00Z' }),
      pub({ content_id: 'c2', status: 'published', scheduled_at: '2026-09-01T10:00:00Z' }),
      pub({ content_id: 'c2', status: 'published', scheduled_at: '2026-10-05T10:00:00Z' }),
      pub({ content_id: 'c3', status: 'cancelled' }),
    ];
    const best = pickPublications(rows);
    expect(best.get('c1')?.scheduled_at).toBe('2026-12-02T10:00:00Z');
    expect(best.get('c2')?.scheduled_at).toBe('2026-10-05T10:00:00Z');
    expect(best.has('c3')).toBe(false);
  });

  it('el estado que se enseña lleva texto y color, y lo detenido sale en rojo', () => {
    expect(stageBadge('idea')).toEqual({ label: 'Idea', tone: 'neutral' });
    expect(stageBadge('ready')).toEqual({ label: 'Lista', tone: 'success' });
    expect(stageBadge('scheduled', pub())).toEqual({ label: 'Programada', tone: 'warning' });
    expect(stageBadge('scheduled', pub({ hold_reason: 'not_approved' }))).toEqual({ label: 'Detenida', tone: 'danger' });
    expect(stageBadge('scheduled', pub({ status: 'failed' }))).toEqual({ label: 'No salió', tone: 'danger' });
    expect(needsFix(pub())).toBe(false);
    expect(needsFix(null)).toBe(false);
  });

  it('una pieza sin ninguna versión está vacía, salvo que ya tenga publicación', () => {
    expect(isEmptyPiece({ current_version: 0 })).toBe(true);
    expect(isEmptyPiece({ current_version: 2 })).toBe(false);
    expect(isEmptyPiece({ current_version: 0 }, pub())).toBe(false);
  });

  it('el nombre por defecto es el formato y el día', () => {
    expect(defaultTitle('Reel', new Date(2026, 10, 22))).toBe('Reel · 22 nov');
    expect(defaultTitle('Carrusel', new Date(2026, 11, 3))).toBe('Carrusel · 3 dic');
  });
});
