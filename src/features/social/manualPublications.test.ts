import { describe, expect, it } from 'vitest';
import { displayState, isEntryEditable } from './calendar';
import { weekProgress } from '@/features/brand/home/week';
import { manualAsPublication, manualDate, manualEntriesBetween, type ManualPublicationLite } from './manualPublications';

// Lo terminado a mano en Instagram en el calendario y el inicio: publicado cuenta como
// publicado; pendiente no (pendiente no es publicado); lo cancelado no sale.

const row = (patch: Partial<ManualPublicationLite>): ManualPublicationLite => ({
  id: 'm1',
  brand_id: 'b',
  organization_id: 'o',
  content_id: 'c1',
  content_version: 2,
  media_asset_id: 'v1',
  status: 'pending',
  handed_off_at: '2026-11-20T10:00:00Z',
  published_at: null,
  match_source: null,
  external_id: null,
  external_url: null,
  created_by: null,
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
  ...patch,
});

describe('lo terminado a mano en el calendario', () => {
  it('publicada: en el día en que salió, «Publicada (a mano)», con su enlace; pendiente: el día en que se mandó', () => {
    const published = manualAsPublication(
      row({
        status: 'published',
        published_at: '2026-11-22T18:00:00Z',
        match_source: 'manual',
        external_url: 'https://www.instagram.com/reel/ABC/',
      }),
    )!;
    expect(published).toMatchObject({
      status: 'published',
      scheduled_at: '2026-11-22T18:00:00Z',
      format: 'reel',
      external_url: 'https://www.instagram.com/reel/ABC/',
      media_asset_ids: ['v1'],
      manual: { id: 'm1', status: 'published', source: 'manual' },
    });
    expect(displayState(published, 'approved')).toBe('manual_published');
    const pending = manualAsPublication(row({}))!;
    expect(pending).toMatchObject({ status: 'planned', scheduled_at: '2026-11-20T10:00:00Z', external_url: null });
    expect(displayState(pending, 'approved')).toBe('manual_pending');
    expect(manualAsPublication(row({ status: 'cancelled' }))).toBeNull();
    // Ni se mueve ni se cancela desde el calendario.
    expect(isEntryEditable(pending)).toBe(false);
    expect(isEntryEditable({ status: 'planned' })).toBe(true);
  });

  it('cuenta en «N de M publicadas» solo si salió', () => {
    const entries = [
      manualAsPublication(row({ status: 'published', published_at: '2026-11-22T18:00:00Z', match_source: 'import' }))!,
      manualAsPublication(row({ id: 'm2' }))!,
    ];
    expect(weekProgress(entries)).toEqual({ published: 1, total: 2 });
  });

  it('cae en el intervalo por su fecha: la de salida o, si está pendiente, la de entrega', () => {
    const rows = [
      row({ id: 'a', status: 'published', handed_off_at: '2026-11-10T10:00:00Z', published_at: '2026-11-21T10:00:00Z', match_source: 'manual' }),
      row({ id: 'b', handed_off_at: '2026-11-19T10:00:00Z' }),
      row({ id: 'c', status: 'cancelled', handed_off_at: '2026-11-21T10:00:00Z' }),
    ];
    expect(manualDate(rows[0]!)).toBe('2026-11-21T10:00:00Z');
    const week = manualEntriesBetween(rows, new Date('2026-11-17T00:00:00Z'), new Date('2026-11-24T00:00:00Z'));
    expect(week.map((e) => e.id)).toEqual(['a', 'b']);
    expect(manualEntriesBetween(rows, new Date('2026-11-20T00:00:00Z'), new Date('2026-11-21T00:00:00Z'))).toEqual([]);
  });
});
