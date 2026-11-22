import { describe, expect, it } from 'vitest';
import type { MediaAssetRow } from '@/lib/database.types';
import { applyFilters, EMPTY_FILTERS, fold, idsBetween, isAiMade, isCutout, isGenerated } from './filters';
import {
  breadcrumbs,
  buildFolderTree,
  cleanFolderName,
  flattenTree,
  isInside,
  renameProblem,
  renamedPath,
} from './folders';

const row = (id: string, extra: Partial<MediaAssetRow> = {}) =>
  ({
    id,
    kind: 'image',
    mime_type: 'image/jpeg',
    file_name: `${id}.jpg`,
    folder: '',
    tags: [],
    provenance: {},
    created_at: '2026-11-01T00:00:00Z',
    ...extra,
  }) as MediaAssetRow;

describe('carpetas', () => {
  it('limpia lo que se escribe como nombre', () => {
    expect(cleanFolderName('  Platos/ Mariscos  ')).toBe('Platos / Mariscos');
    expect(cleanFolderName('///')).toBe('');
    expect(cleanFolderName('a\\b')).toBe('a / b');
    expect(cleanFolderName('x'.repeat(300))).toHaveLength(200);
  });

  it('el árbol suma lo de dentro, crea los niveles intermedios y ordena en castellano', () => {
    const tree = buildFolderTree(
      new Map([
        ['Platos / Mariscos', 2],
        ['Platos / Carnes', 1],
        ['Álbum', 1],
        ['', 4],
      ]),
      ['Vinos / Tintos'],
    );
    expect(tree.map((n) => [n.name, n.own, n.total])).toEqual([
      ['Álbum', 1, 1],
      ['Platos', 0, 3],
      ['Vinos', 0, 0],
    ]);
    expect(flattenTree(tree).map((n) => n.path)).toEqual([
      'Álbum',
      'Platos',
      'Platos / Carnes',
      'Platos / Mariscos',
      'Vinos',
      'Vinos / Tintos',
    ]);
  });

  it('migas de pan, pertenencia y renombrado', () => {
    expect(breadcrumbs('Platos / Mariscos')).toEqual([
      { name: 'Platos', path: 'Platos' },
      { name: 'Mariscos', path: 'Platos / Mariscos' },
    ]);
    expect(isInside('Platos / Mariscos', 'Platos')).toBe(true);
    expect(isInside('Platos 2', 'Platos')).toBe(false);
    expect(isInside('Platos', '')).toBe(false);
    expect(renamedPath('Platos / Mariscos', 'Platos', 'Cocina')).toBe('Cocina / Mariscos');
    expect(renamedPath('Vinos', 'Platos', 'Cocina')).toBe('Vinos');
    expect(renameProblem('Platos', 'Platos / Dentro', ['Platos'])).toMatch(/dentro de sí misma/);
    expect(renameProblem('Platos', 'Vinos', ['Platos', 'Vinos'])).toMatch(/Ya existe/);
    expect(renameProblem('Platos', 'Cocina', ['Platos'])).toBeNull();
  });
});

describe('filtros', () => {
  const usage = new Map([['a', 2]]);
  const assets = [
    row('a', { folder: 'Platos / Mariscos', tags: ['marisco'], created_at: '2026-11-03T00:00:00Z' }),
    row('b', { folder: 'Platos', created_at: '2026-11-02T00:00:00Z' }),
    row('c', { kind: 'video', mime_type: 'video/mp4', created_at: '2026-11-01T00:00:00Z' }),
  ];
  const filters = (extra: Partial<typeof EMPTY_FILTERS>) => ({ ...EMPTY_FILTERS, ...extra });
  const ids = (list: MediaAssetRow[]) => list.map((a) => a.id);

  it('carpeta con lo de dentro, sin carpeta y toda la biblioteca', () => {
    expect(ids(applyFilters(assets, filters({ folder: 'Platos' }), usage))).toEqual(['a', 'b']);
    expect(ids(applyFilters(assets, filters({ folder: '' }), usage))).toEqual(['c']);
    expect(ids(applyFilters(assets, filters({ folder: null }), usage))).toEqual(['a', 'b', 'c']);
  });

  it('fotos y vídeos se suman; sin usar se exige aparte', () => {
    expect(ids(applyFilters(assets, filters({ chips: new Set(['photos', 'videos']) }), usage))).toEqual(['a', 'b', 'c']);
    expect(ids(applyFilters(assets, filters({ chips: new Set(['photos', 'unused']) }), usage))).toEqual(['b']);
  });

  it('busca en nombre, carpeta y etiquetas, sin importar mayúsculas', () => {
    expect(ids(applyFilters(assets, filters({ search: 'MARISCO' }), usage))).toEqual(['a']);
    expect(ids(applyFilters(assets, filters({ tag: 'marisco' }), usage))).toEqual(['a']);
  });

  it('ordena por uso con las más recientes primero en los empates', () => {
    expect(ids(applyFilters(assets, filters({ sort: 'usage' }), usage))).toEqual(['a', 'b', 'c']);
    expect(ids(applyFilters(assets, filters({ sort: 'name' }), usage))).toEqual(['a', 'b', 'c']);
  });

  it('reconoce el fondo quitado y lo hecho con IA por su procedencia', () => {
    expect(isCutout(row('x', { provenance: { type: 'photo_edit', steps: [{ kind: 'remove_background' }] } }))).toBe(true);
    expect(isCutout(row('x', { file_name: 'Sin fondo · plato.png' }))).toBe(true);
    expect(isCutout(row('x'))).toBe(false);
    expect(isAiMade(row('x', { provenance: { type: 'ai_generation' } }))).toBe(true);
    expect(isAiMade(row('x', { provenance: { type: 'ai_animation' } }))).toBe(true);
    expect(isAiMade(row('x', { provenance: { type: 'photo_edit', steps: [{ kind: 'ai_background' }] } }))).toBe(true);
    expect(isAiMade(row('x', { provenance: null as never }))).toBe(false);
  });

  it('la selección con Mayús recoge el tramo en cualquier sentido', () => {
    expect(idsBetween(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(idsBetween(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(idsBetween(['a', 'b'], 'zz', 'b')).toEqual(['b']);
  });
});

describe('búsqueda sin tildes', () => {
  const list = [
    row('a', { file_name: 'Chuletón ternera.jpg' }),
    row('b', { file_name: 'x.jpg', folder: 'Platos / Postres' }),
    row('c', { file_name: 'y.jpg', tags: ['Crème brûlée'] }),
  ];
  const find = (search: string) =>
    applyFilters(list, { ...EMPTY_FILTERS, search }, new Map()).map((a) => a.id);

  it('encuentra con o sin tildes y mayúsculas, por nombre, carpeta y etiqueta', () => {
    expect(fold('Chuletón ÑU')).toBe('chuleton nu');
    expect(find('chuleton')).toEqual(['a']);
    expect(find('CHULETÓN')).toEqual(['a']);
    expect(find('postre')).toEqual(['b']);
    expect(find('creme brulee')).toEqual(['c']);
    expect(find('platos / post')).toEqual(['b']);
  });

  it('distingue lo generado por la aplicación de lo que sube una persona', () => {
    expect(isGenerated(row('x'))).toBe(false);
    expect(isGenerated(row('x', { provenance: { type: 'photo_edit' } }))).toBe(true);
    expect(isGenerated(row('x', { folder: 'Reels' }))).toBe(true);
    expect(isGenerated(row('x', { folder: 'Platos / Reels' }))).toBe(false);
    expect(isGenerated(row('x', { file_name: 'Sin fondo · plato.png' }))).toBe(true);
  });
});
