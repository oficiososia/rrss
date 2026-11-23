import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePickerDialog } from '@/features/content/editor/AssetPickerDialog';
import { BrandContext, makeBrandContext, OrgContext } from '@/features/orgs/context';
import * as storageApi from '@/features/storage/api';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, brandRow, renderApp, seedWorkspace } from '@/test/fixtures';
import { fetchRecentImages } from './api';
import { distinctNames, NAME_CHARS } from './assetNames';
import { readableName } from './readableName';
import { applyFilters, EMPTY_FILTERS, isExport } from './filters';
import { PhotoPanel } from './PhotoPanel';
import { LONG_PRESS_MS } from './useNameReveal';

// Fallos 17 y 19 de la prueba en staging (23/11/2026):
//   17 · las exportaciones llenaban la biblioteca y salían las primeras en los selectores;
//   19 · tres «Arroz meloso…» cortados igual no se distinguían en el selector de fotos.

const asset = (id: string, fileName: string, extra: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${id}.jpg`,
  thumb_path: null,
  file_name: fileName,
  mime_type: 'image/jpeg',
  bytes: 1,
  width: 1080,
  height: 1350,
  duration_ms: null,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: {},
  created_by: null,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
  ...extra,
});

const exported = (id: string, fileName: string, extra: Record<string, unknown> = {}) =>
  asset(id, fileName, {
    folder: 'Exportaciones',
    tags: ['exportación'],
    provenance: { type: 'export', content_id: 'c-1', version: 1, unsaved_changes: false },
    // Más recientes que las fotos: antes salían las primeras en todos los selectores.
    created_at: '2026-11-23T10:00:00Z',
    ...extra,
  });

function library() {
  return [
    asset('a1', 'Arroz meloso de langosta.jpg', { folder: 'Platos' }),
    asset('a2', 'Arroz meloso de bogavante.jpg', { folder: 'Platos' }),
    asset('a3', 'Arroz meloso de rape y alcachofa.jpg', { folder: 'Platos' }),
    asset('a4', 'sala.jpg', { folder: 'Local' }),
    exported('e1', 'arroz-de-rape-1080x1350-v1.jpg'),
    exported('e2', 'menu-otono-1080x1350-v2.jpg'),
    // Una exportación que alguien movió a otra carpeta: su procedencia la delata.
    exported('e3', 'cartel-movido.jpg', { folder: 'Local' }),
    asset('r1', 'portada-reel.jpg', { folder: 'Reels', provenance: { role: 'cover' } }),
  ];
}

beforeEach(() => {
  vi.spyOn(storageApi, 'signStoragePaths').mockImplementation(
    async (paths) => new Map(paths.map((path) => [path, `https://example.test/${path}`])),
  );
});
afterEach(() => vi.restoreAllMocks());

function withBrand(children: React.ReactNode) {
  const org = { id: ORG_ID, name: 'Grupo Demo', kind: 'business', role: 'owner' } as never;
  const brand = brandRow();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrgContext.Provider value={{ org, isAdmin: true, brands: [brand], brandRoles: new Map() }}>
          <BrandContext.Provider value={makeBrandContext(org, brand, undefined)}>{children}</BrandContext.Provider>
        </OrgContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Exportaciones aparte (fallo 17)', () => {
  it('isExport y applyFilters: fuera de «Toda la biblioteca», dentro de su carpeta', () => {
    const rows = library() as never[];
    expect(isExport(rows[4] as never)).toBe(true);
    expect(isExport(rows[6] as never)).toBe(true);
    expect(isExport(rows[0] as never)).toBe(false);
    const all = applyFilters(rows, EMPTY_FILTERS, new Map()).map((a) => (a as { id: string }).id);
    expect(all).not.toContain('e1');
    expect(all).not.toContain('e3');
    expect(all).toContain('a1');
    const inside = applyFilters(rows, { ...EMPTY_FILTERS, folder: 'Exportaciones' }, new Map()).map(
      (a) => (a as { id: string }).id,
    );
    expect(inside.sort()).toEqual(['e1', 'e2']);
    // Al buscar en toda la biblioteca tampoco salen.
    const searched = applyFilters(rows, { ...EMPTY_FILTERS, search: 'arroz' }, new Map()).map(
      (a) => (a as { id: string }).id,
    );
    expect(searched.sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('la biblioteca enseña «Exportaciones» aparte, al final, y no las cuenta en «Toda la biblioteca»', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.media_assets = library();
    fake.rpc('asset_facets', () => [{ tags: [], folders: ['Platos', 'Local', 'Exportaciones', 'Reels'] }]);
    fake.rpc('asset_usage', () => []);
    const { user } = renderApp(`${BRAND_BASE}/biblioteca`);
    await screen.findAllByTestId('library-asset');
    const tree = screen.getByRole('tree', { name: 'Carpetas de la biblioteca' });
    // 8 archivos, 3 son exportaciones (dos en su carpeta y una movida a «Local»).
    expect(within(tree).getByTestId('library-folder-all')).toHaveTextContent('5');
    // «Hechas aquí» (plegado) reúne lo que guarda la aplicación: Exportaciones y Reels.
    const group = within(tree).getByTestId('library-made-here');
    expect(within(tree).queryByTestId('library-folder-Exportaciones')).toBeNull();
    await user.click(within(group).getByTestId('library-made-here-toggle'));
    expect(within(group).getByTestId('library-folder-Exportaciones')).toHaveTextContent('2');
    expect(within(group).getByTestId('library-folder-Reels')).toHaveTextContent('1');
    expect(within(tree).queryByTestId('library-folder-Reels')).toBe(within(group).getByTestId('library-folder-Reels'));
    const titles = () => screen.getAllByTestId('library-asset').map((el) => el.getAttribute('title'));
    expect(titles()).not.toContain('arroz-de-rape-1080x1350-v1.jpg');
    expect(screen.getByTestId('library-exports-hint')).toHaveTextContent('Exportaciones (2)');

    await user.click(screen.getByTestId('library-exports-open'));
    await waitFor(() =>
      expect(titles().sort()).toEqual(['arroz-de-rape-1080x1350-v1.jpg', 'menu-otono-1080x1350-v2.jpg']),
    );
    // No se borra nada: lo que ya existía sigue ahí.
    expect(fake.calls.filter((c) => c.kind === 'delete')).toHaveLength(0);

    // En el móvil, el selector de carpeta también las pone aparte.
    const select = screen.getByTestId('library-folder-select');
    expect(within(select).getByRole('group', { name: 'Hechas aquí' })).toBeInTheDocument();
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent('Toda la biblioteca (5)');
  });

  it('el selector de fotos del editor no ofrece exportaciones ni portadas (aunque sean las más recientes)', async () => {
    fake.tables.media_assets = library();
    withBrand(
      <ImagePickerDialog brandId={BRAND_ID} libraryPath="/biblioteca" open onOpenChange={() => undefined} onPick={vi.fn()} />,
    );
    const grid = await screen.findByTestId('image-picker');
    const shown = within(grid).getAllByTestId('picker-asset').map((b) => b.textContent);
    expect(shown).toHaveLength(4);
    expect(shown.join(' ')).not.toMatch(/1080x1350|cartel-movido|portada-reel/);
  });

  it('el copiloto busca entre fotos, no entre exportaciones', async () => {
    fake.tables.media_assets = library();
    const found = await fetchRecentImages(BRAND_ID);
    expect(found.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
  });
});

describe('Nombres que se distinguen (fallo 19)', () => {
  it('distinctNames: corto, entero; largos que empiezan igual, la parte que cambia; iguales, la carpeta', () => {
    const names = distinctNames([
      { id: '1', file_name: 'Arroz meloso de langosta.jpg', folder: 'Platos' },
      { id: '2', file_name: 'Arroz meloso de bogavante.jpg', folder: 'Platos' },
      { id: '3', file_name: 'Arroz meloso de rape y alcachofa.jpg', folder: 'Platos' },
      { id: '4', file_name: 'sala.jpg', folder: 'Local' },
      { id: '5', file_name: 'Clover Club.jpg', folder: 'Cócteles' },
      { id: '6', file_name: 'Clover Club.jpg', folder: 'Sin revisar' },
      { id: '7', file_name: 'Un nombre larguísimo que no choca.jpg', folder: '' },
    ]);
    const labels = ['1', '2', '3'].map((id) => names.get(id)!.label);
    expect(new Set(labels).size).toBe(3);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(NAME_CHARS + 1);
    expect(names.get('1')!.label).toContain('langosta');
    expect(names.get('2')!.label).toContain('bogavante');
    expect(names.get('1')!.full).toBe('Arroz meloso de langosta.jpg');
    expect(names.get('4')).toEqual({ label: 'sala.jpg', full: 'sala.jpg', folder: null });
    expect(names.get('5')!.folder).toBe('Cócteles');
    expect(names.get('6')!.folder).toBe('Sin revisar');
    expect(names.get('7')!.label).toMatch(/^Un nombre largu.*…$/);
  });

  it('el panel de fotos enseña la parte que distingue, el nombre entero al pasar el ratón y al mantener pulsado', async () => {
    fake.tables.media_assets = library();
    const onPick = vi.fn();
    withBrand(
      <div style={{ height: 600 }}>
        <PhotoPanel onPick={onPick} />
      </div>,
    );
    const panel = await screen.findByTestId('photo-panel');
    await waitFor(() => expect(within(panel).getAllByTestId('photo-panel-item')).toHaveLength(4));
    const items = within(panel).getAllByTestId('photo-panel-item');
    const langosta = items.find((b) => b.getAttribute('title') === 'Arroz meloso de langosta.jpg')!;
    const labels = items.map((b) => within(b).getByTestId('asset-card-name-label').textContent);
    expect(new Set(labels).size).toBe(4);
    expect(within(langosta).getByTestId('asset-card-name-label')).toHaveTextContent('langosta');

    // Mantener pulsado (pantalla táctil): sale el nombre entero y no se elige la foto.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.pointerDown(langosta, { pointerType: 'touch' });
      vi.advanceTimersByTime(LONG_PRESS_MS + 50);
      await waitFor(() =>
        expect(within(langosta).getByTestId('asset-card-name-full')).toHaveTextContent('Arroz meloso de langosta.jpg'),
      );
      fireEvent.pointerUp(langosta, { pointerType: 'touch' });
      fireEvent.click(langosta);
      expect(onPick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    // Un toque normal sí la elige.
    await userEvent.setup().click(langosta);
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe('Nombres legibles en las miniaturas (simplificación B4)', () => {
  it('readableName: quita fechas, tamaños y versiones de los nombres técnicos; respeta los escritos a mano', () => {
    expect(readableName('portada-reel-20261123-085833.jpg')).toBe('Portada reel');
    expect(readableName('arroz-de-rape-1080x1350-v1.jpg')).toBe('Arroz de rape');
    expect(readableName('menu_otono-1080x1350-v2-p3.jpg')).toBe('Menu otono');
    expect(readableName('Sin fondo · chuleta.png')).toBe('Sin fondo · chuleta');
    expect(readableName('Arroz meloso de langosta.jpg')).toBe('Arroz meloso de langosta');
    expect(readableName('IMG_1234.jpg')).toBe('IMG 1234');
    // Si no queda nada que leer, el nombre tal cual (sin extensión).
    expect(readableName('20261123-085833.jpg')).toBe('20261123-085833');
  });

  it('distinctNames con nombres legibles: «Portada reel» se distingue por la carpeta si hay dos', () => {
    const names = distinctNames(
      [
        { id: '1', file_name: 'portada-reel-20261123-085833.jpg', folder: 'Reels / Navidad' },
        { id: '2', file_name: 'portada-reel-20261124-101010.jpg', folder: 'Reels / Otoño' },
      ],
      NAME_CHARS,
      (a) => readableName(a.file_name),
    );
    expect(names.get('1')).toEqual({ label: 'Portada reel', full: 'portada-reel-20261123-085833.jpg', folder: 'Navidad' });
    expect(names.get('2')!.folder).toBe('Otoño');
  });
});
