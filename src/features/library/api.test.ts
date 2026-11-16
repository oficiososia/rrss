import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake mínimo del cliente de Supabase: registra las llamadas y responde lo que
// se le configure por tabla/operación.
const state = vi.hoisted(() => ({
  calls: [] as string[],
  queue: [] as { storage_path: string }[],
  deleteAssetRows: [{ id: 'a1', storage_path: 'o/b/media/1-a.png' }] as { id: string; storage_path: string }[],
  removeError: null as { message: string } | null,
}));

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    let op = 'select';
    const chain: Record<string, unknown> = {};
    const result = () => {
      if (table === 'storage_cleanup_queue' && op === 'select') return { data: state.queue, error: null };
      if (table === 'storage_cleanup_queue' && op === 'delete') return { data: null, error: null };
      if (table === 'media_assets' && op === 'delete') return { data: state.deleteAssetRows, error: null };
      return { data: [], error: null };
    };
    for (const name of ['select', 'eq', 'order', 'limit', 'in']) chain[name] = () => chain;
    chain.delete = () => {
      op = 'delete';
      state.calls.push(`delete ${table}`);
      return chain;
    };
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return chain;
  };
  return {
    supabaseConfigured: true,
    supabase: {
      from: builder,
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            state.calls.push(`remove ${paths.join(',')}`);
            return { data: [], error: state.removeError };
          },
        }),
      },
    },
  };
});

import { deleteAssets, sweepStorageCleanup } from './api';

beforeEach(() => {
  state.calls = [];
  state.queue = [];
  state.removeError = null;
});

describe('sweepStorageCleanup', () => {
  it('no hace nada si la cola está vacía', async () => {
    expect(await sweepStorageCleanup('brand')).toBe(0);
    expect(state.calls).toEqual([]);
  });

  it('borra los archivos anotados y después sus anotaciones', async () => {
    state.queue = [{ storage_path: 'o/b/media/1-a.jpg' }, { storage_path: 'o/b/media/2-b.jpg' }];
    expect(await sweepStorageCleanup('brand')).toBe(2);
    expect(state.calls).toEqual(['remove o/b/media/1-a.jpg,o/b/media/2-b.jpg', 'delete storage_cleanup_queue']);
  });

  it('si Storage falla conserva las anotaciones para reintentar', async () => {
    state.queue = [{ storage_path: 'o/b/media/1-a.jpg' }];
    state.removeError = { message: 'boom' };
    expect(await sweepStorageCleanup('brand')).toBe(0);
    expect(state.calls).toEqual(['remove o/b/media/1-a.jpg']);
  });
});

describe('deleteAssets', () => {
  it('borra la fila y después el archivo y su anotación', async () => {
    await deleteAssets(['a1']);
    expect(state.calls).toEqual(['delete media_assets', 'remove o/b/media/1-a.png', 'delete storage_cleanup_queue']);
  });

  it('no hace nada sin ids', async () => {
    await deleteAssets([]);
    expect(state.calls).toEqual([]);
  });
});
