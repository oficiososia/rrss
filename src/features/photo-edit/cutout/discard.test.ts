// `discardIntermediate`: solo borra el PNG que dejó ESE trabajo y que nadie ha tocado.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as libraryApi from '@/features/library/api';
import type { MediaAssetRow } from '@/lib/database.types';

const db = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ limit: async () => ({ data: db.rows, error: null }) }),
      }),
    }),
  },
}));

import { discardIntermediate } from './serverJob';

const PATH = 'org/brand/ediciones/x.png';
const row = (over: Partial<MediaAssetRow> = {}) =>
  ({
    id: 'a1',
    storage_path: PATH,
    file_name: 'Sin fondo · plato.png',
    folder: 'Ediciones',
    provenance: { type: 'media_job', kind: 'media.cutout', job_id: 'job-1' },
    ...over,
  }) as unknown as MediaAssetRow;

let deleted: string[][];
beforeEach(() => {
  deleted = [];
  vi.spyOn(libraryApi, 'deleteAssets').mockImplementation(async (ids) => {
    deleted.push(ids);
  });
});

describe('discardIntermediate', () => {
  it('borra el archivo que dejó ese trabajo tal como lo dejó', async () => {
    db.rows = [row()];
    await discardIntermediate('job-1', PATH);
    expect(deleted).toEqual([['a1']]);
  });

  it('no borra lo que es de otro trabajo, lo que se ha renombrado o movido, ni lo que no existe', async () => {
    for (const over of [
      { provenance: { type: 'media_job', kind: 'media.cutout', job_id: 'otro' } },
      { provenance: { type: 'photo_edit' } },
      { file_name: 'Mi recorte favorito.png' },
      { folder: 'Platos' },
    ] as Array<Partial<MediaAssetRow>>) {
      db.rows = [row(over)];
      await discardIntermediate('job-1', PATH);
    }
    db.rows = [];
    await discardIntermediate('job-1', PATH);
    expect(deleted).toEqual([]);
  });
});
