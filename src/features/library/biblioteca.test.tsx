import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageApi from '@/features/storage/api';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// La biblioteca con cientos de archivos: árbol de carpetas con contadores, filtros
// en chips, selección múltiple con acciones por lotes, ficha lateral con ← y →,
// arrastrar a una carpeta y «en qué piezas se usa». Contra el Supabase simulado.

beforeEach(() => {
  // Las direcciones firmadas de las miniaturas y de la ficha.
  vi.spyOn(storageApi, 'signStoragePaths').mockImplementation(
    async (paths) => new Map(paths.map((path) => [path, `https://example.test/${path}`])),
  );
});
afterEach(() => vi.restoreAllMocks());

const asset = (id: string, fileName: string, extra: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${id}.jpg`,
  file_name: fileName,
  mime_type: 'image/jpeg',
  bytes: 1000,
  width: 4000,
  height: 3000,
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

const usageRow = (assetId: string, contentId: string, title: string, archived = false) => ({
  asset_id: assetId,
  content_id: contentId,
  title,
  network: 'instagram',
  format: 'post',
  status: 'draft',
  archived,
});

function seed(options: { role?: 'owner' | 'viewer'; usage?: boolean } = {}) {
  if (options.role === 'viewer') seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
  else seedWorkspace({ orgRole: 'owner' });
  fake.tables.media_assets = [
    asset('a1', 'langostinos.jpg', { folder: 'Platos / Mariscos', created_at: '2026-11-20T09:00:00Z', tags: ['marisco'] }),
    asset('a2', 'almejas.jpg', { folder: 'Platos / Mariscos', created_at: '2026-11-19T09:00:00Z' }),
    asset('a3', 'chuleta.jpg', { folder: 'Platos / Carnes', created_at: '2026-11-18T09:00:00Z' }),
    asset('a4', 'tinto-crianza.jpg', { folder: 'Vinos / Tintos', created_at: '2026-11-17T09:00:00Z' }),
    asset('a5', 'suelta.jpg', { created_at: '2026-11-16T09:00:00Z' }),
    asset('v1', 'brasa.mp4', { kind: 'video', mime_type: 'video/mp4', created_at: '2026-11-15T09:00:00Z' }),
    asset('l1', 'logo.png', { kind: 'logo', mime_type: 'image/png', created_at: '2026-11-14T09:00:00Z' }),
    asset('s1', 'Sin fondo · chuleta.png', {
      mime_type: 'image/png',
      created_at: '2026-01-01T09:00:00Z',
      provenance: { type: 'photo_edit', steps: [{ kind: 'remove_background' }] },
    }),
    asset('i1', 'cartel-ia.png', {
      mime_type: 'image/png',
      created_at: '2026-01-02T09:00:00Z',
      provenance: { type: 'ai_generation' },
    }),
  ];
  fake.rpc('asset_facets', () => [{ tags: ['marisco'], folders: ['Platos / Carnes', 'Platos / Mariscos', 'Vinos / Tintos'] }]);
  if (options.usage === false) return;
  fake.rpc('asset_usage', () => [
    usageRow('a1', 'c1', 'Menú de otoño'),
    usageRow('a1', 'c2', 'Marisco de temporada', true),
    usageRow('a3', 'c1', 'Menú de otoño'),
  ]);
}

const names = () =>
  screen
    .getAllByTestId('library-asset')
    .map((el) => within(el).getByText(/\.(jpg|png|mp4)$/).textContent)
    .filter(Boolean);

const open = async () => {
  const view = renderApp(`${BRAND_BASE}/biblioteca`);
  await screen.findAllByTestId('library-asset');
  return view;
};

describe('Biblioteca: carpetas', () => {
  it('el árbol sale de las carpetas con contadores y filtrar por una incluye lo que hay dentro', async () => {
    seed();
    const { user } = await open();
    const tree = screen.getByRole('tree', { name: 'Carpetas de la biblioteca' });
    expect(within(tree).getByTestId('library-folder-all')).toHaveTextContent('9');
    expect(within(tree).getByTestId('library-folder-Platos')).toHaveTextContent('3');
    expect(within(tree).getByTestId('library-folder-Platos / Mariscos')).toHaveTextContent('2');
    expect(within(tree).getByTestId('library-folder-Vinos / Tintos')).toHaveTextContent('1');
    // Lo que no está en ninguna carpeta se puede ver aparte.
    expect(within(tree).getByTestId('library-folder-none')).toHaveTextContent('5');

    await user.click(within(tree).getByTestId('library-folder-Platos'));
    expect(names()).toEqual(['langostinos.jpg', 'almejas.jpg', 'chuleta.jpg']);
    await user.click(within(tree).getByTestId('library-folder-Platos / Mariscos'));
    expect(names()).toEqual(['langostinos.jpg', 'almejas.jpg']);
    // Migas de pan: cada tramo lleva a su carpeta.
    const crumbs = screen.getByRole('navigation', { name: 'Dónde estás' });
    expect(within(crumbs).getByText('Mariscos')).toHaveAttribute('aria-current', 'page');
    await user.click(within(crumbs).getByRole('button', { name: 'Platos' }));
    expect(names()).toHaveLength(3);
    await user.click(within(tree).getByTestId('library-folder-none'));
    expect(names()).toContain('suelta.jpg');
    expect(names()).not.toContain('almejas.jpg');
  });

  it('en móvil hay un selector de carpeta con los mismos contadores', async () => {
    seed();
    const { user } = await open();
    const select = screen.getByTestId('library-folder-select');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Toda la biblioteca (9)',
      'Sin carpeta (5)',
      'Platos (3)',
      ' Carnes (1)',
      ' Mariscos (2)',
      'Vinos (1)',
      ' Tintos (1)',
    ]);
    await user.selectOptions(select, 'Vinos / Tintos');
    expect(names()).toEqual(['tinto-crianza.jpg']);
  });

  it('crear una carpeta vacía la deja en el árbol; renombrar una con archivos los mueve; la vacía se elimina', async () => {
    seed();
    localStorage.clear();
    const { user } = await open();
    await user.click(screen.getByTestId('library-new-folder'));
    await user.type(screen.getByTestId('folder-name-input'), 'Postres');
    await user.click(screen.getByTestId('folder-name-confirm'));
    const tree = screen.getByRole('tree', { name: 'Carpetas de la biblioteca' });
    expect(within(tree).getByTestId('library-folder-Postres')).toHaveTextContent('0');
    // Una carpeta vacía no existe en la base de datos hasta que se mueve algo dentro.
    expect(fake.tables.media_assets!.some((a) => a.folder === 'Postres')).toBe(false);

    // Se elimina (está vacía y es la elegida).
    await user.click(screen.getByTestId('folder-menu'));
    await user.click(await screen.findByTestId('folder-delete'));
    await waitFor(() => expect(within(tree).queryByTestId('library-folder-Postres')).not.toBeInTheDocument());

    // Renombrar «Platos»: los archivos de dentro pasan a «Cocina / …».
    await user.click(within(tree).getByTestId('library-folder-Platos'));
    await user.click(screen.getByTestId('folder-menu'));
    await user.click(await screen.findByTestId('folder-rename'));
    const input = screen.getByTestId('folder-name-input');
    await user.clear(input);
    await user.type(input, 'Cocina');
    await user.click(screen.getByTestId('folder-name-confirm'));
    await waitFor(() =>
      expect(fake.tables.media_assets!.filter((a) => String(a.folder).startsWith('Cocina')).map((a) => a.folder).sort()).toEqual([
        'Cocina / Carnes',
        'Cocina / Mariscos',
        'Cocina / Mariscos',
      ]),
    );
    expect(await within(tree).findByTestId('library-folder-Cocina')).toHaveTextContent('3');
  });

  it('una carpeta con archivos no se puede eliminar', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getByTestId('library-folder-Vinos'));
    await user.click(screen.getByTestId('folder-menu'));
    expect(await screen.findByTestId('folder-delete')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Biblioteca: filtros y orden', () => {
  it('los chips filtran por tipo, fondo quitado, IA y uso, y se pueden combinar', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getByTestId('chip-videos'));
    expect(names()).toEqual(['brasa.mp4']);
    await user.click(screen.getByTestId('chip-videos'));
    await user.click(screen.getByTestId('chip-logos'));
    expect(names()).toEqual(['logo.png']);
    await user.click(screen.getByTestId('chip-logos'));

    await user.click(screen.getByTestId('chip-cutout'));
    expect(names()).toEqual(['Sin fondo · chuleta.png']);
    await user.click(screen.getByTestId('chip-cutout'));
    await user.click(screen.getByTestId('chip-ai'));
    expect(names()).toEqual(['cartel-ia.png']);
    await user.click(screen.getByTestId('chip-ai'));

    // Sin usar: lo que ninguna pieza usa (a1 y a3 sí).
    await user.click(screen.getByTestId('chip-unused'));
    expect(names()).not.toContain('langostinos.jpg');
    expect(names()).not.toContain('chuleta.jpg');
    expect(names()).toContain('almejas.jpg');
    // Y combinado con una carpeta.
    await user.click(screen.getByTestId('library-folder-Platos / Mariscos'));
    expect(names()).toEqual(['almejas.jpg']);
    expect(screen.getByTestId('chip-unused')).toHaveAttribute('aria-pressed', 'true');
  });

  it('«Recientes» deja solo lo de las últimas dos semanas', async () => {
    seed();
    const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    fake.tables.media_assets![0]!.created_at = dias(2);
    fake.tables.media_assets![1]!.created_at = dias(40);
    const { user } = await open();
    await user.click(screen.getByTestId('chip-recent'));
    expect(names()).toContain('langostinos.jpg');
    expect(names()).not.toContain('almejas.jpg');
  });

  it('busca por nombre, etiqueta y carpeta, y ordena por nombre o por uso', async () => {
    seed();
    const { user } = await open();
    await user.type(screen.getByTestId('library-search'), 'marisco');
    // «langostinos» tiene la etiqueta y dos están en la carpeta «Mariscos».
    await waitFor(() => expect(names()).toEqual(['langostinos.jpg', 'almejas.jpg']));
    await user.clear(screen.getByTestId('library-search'));
    await user.type(screen.getByTestId('library-search'), 'tinto');
    await waitFor(() => expect(names()).toEqual(['tinto-crianza.jpg']));
    await user.clear(screen.getByTestId('library-search'));

    await user.selectOptions(screen.getByTestId('library-sort'), 'Por nombre');
    expect(names().slice(0, 3)).toEqual(['almejas.jpg', 'brasa.mp4', 'cartel-ia.png']);
    await user.selectOptions(screen.getByTestId('library-sort'), 'Más usadas');
    // Usadas primero: a1 (2 piezas contando la archivada: cuenta 1 vigente) y a3.
    expect(names().slice(0, 2).sort()).toEqual(['chuleta.jpg', 'langostinos.jpg']);
  });

  it('si no se sabe en qué piezas se usa, no se ofrece «Sin usar» ni «Más usadas» ni se inventa nada', async () => {
    seed({ usage: false });
    await open();
    expect(screen.queryByTestId('chip-unused')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Más usadas' })).not.toBeInTheDocument();
    expect(await screen.findByTestId('library-usage-missing')).toBeInTheDocument();
  });
});

describe('Biblioteca: selección y acciones por lotes', () => {
  it('casillas y Mayús eligen; la barra mueve, etiqueta y borra con confirmación', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Elegir langostinos.jpg' }));
    expect(screen.getByTestId('library-selection-bar')).toHaveTextContent('1 elegido');
    // Con Mayús se elige el tramo hasta la clicada.
    fireEvent.click(screen.getAllByTestId('library-asset')[2]!, { shiftKey: true });
    expect(screen.getByTestId('library-selection-bar')).toHaveTextContent('3 elegidos');

    // Mover a una carpeta nueva.
    await user.click(screen.getByTestId('bulk-move'));
    await user.selectOptions(screen.getByTestId('move-target'), 'Una carpeta nueva…');
    await user.type(screen.getByTestId('move-new-name'), 'Para el lunes');
    await user.click(screen.getByTestId('move-confirm'));
    await waitFor(() =>
      expect(fake.tables.media_assets!.filter((a) => a.folder === 'Para el lunes').map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3']),
    );
    await waitFor(() => expect(screen.queryByTestId('library-selection-bar')).not.toBeInTheDocument());

    // Etiquetar respeta las que ya había.
    await user.click(screen.getByRole('checkbox', { name: 'Elegir langostinos.jpg' }));
    await user.click(screen.getByTestId('bulk-tag'));
    await user.type(screen.getByTestId('bulk-tag-input'), 'portada{Enter}');
    await user.click(screen.getByTestId('tag-confirm'));
    await waitFor(() => expect(fake.tables.media_assets!.find((a) => a.id === 'a1')!.tags).toEqual(['marisco', 'portada']));

    // Eliminar avisa de que está en piezas y pide confirmar.
    await user.click(screen.getByTestId('bulk-delete'));
    expect(await screen.findByText(/está en alguna pieza/)).toBeInTheDocument();
    // Dice cuál (la archivada no cuenta) y qué le pasará.
    expect(screen.getByText(/está en alguna pieza/)).toHaveTextContent(
      'Se usa en «Menú de otoño»: esa pieza quedará con un hueco que se puede sustituir por otra foto desde el editor.',
    );
    await user.click(screen.getByTestId('confirm-action'));
    await waitFor(() => expect(fake.tables.media_assets!.some((a) => a.id === 'a1')).toBe(false));
  });

  it('Esc quita la selección', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Elegir almejas.jpg' }));
    expect(screen.getByTestId('library-selection-bar')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('library-selection-bar')).not.toBeInTheDocument());
  });

  it('arrastrar archivos elegidos a una carpeta del árbol los mueve todos', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Elegir suelta.jpg' }));
    await user.click(screen.getByRole('checkbox', { name: 'Elegir brasa.mp4' }));
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (type: string, value: string) => (store[type] = value),
      getData: (type: string) => store[type] ?? '',
      get types() {
        return Object.keys(store);
      },
      effectAllowed: '',
      dropEffect: '',
      files: [],
    };
    const origen = screen.getAllByTestId('library-asset').find((el) => el.textContent?.includes('suelta.jpg'))!;
    fireEvent.dragStart(origen, { dataTransfer });
    const destino = screen.getByTestId('library-folder-Vinos / Tintos').parentElement!;
    fireEvent.dragOver(destino, { dataTransfer });
    fireEvent.drop(destino, { dataTransfer });
    await waitFor(() =>
      expect(fake.tables.media_assets!.filter((a) => a.folder === 'Vinos / Tintos').map((a) => a.id).sort()).toEqual(['a4', 'a5', 'v1']),
    );
  });

  it('quien solo mira no ve casillas, ni subir, ni crear carpetas', async () => {
    seed({ role: 'viewer' });
    await open();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-upload-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-new-folder')).not.toBeInTheDocument();
  });
});

describe('Biblioteca: ficha lateral', () => {
  it('se abre al lado de la lista, dice dónde se usa y ← y → pasan al archivo anterior y siguiente', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getAllByTestId('library-asset')[0]!);
    const panel = await screen.findByRole('dialog', { name: 'langostinos.jpg' });
    expect(panel).toHaveAttribute('aria-modal', 'false');
    // La lista sigue a la vista y usable.
    expect(screen.getAllByTestId('library-asset').length).toBeGreaterThan(1);
    expect(within(panel).getByText(/1 de 9/)).toBeInTheDocument();
    const usage = within(panel).getByTestId('asset-usage');
    expect(within(usage).getByRole('link', { name: 'Menú de otoño' })).toHaveAttribute(
      'href',
      `/o/${ORG_ID}/m/${BRAND_ID}/contenidos/c1`,
    );
    expect(within(usage).getByText('Marisco de temporada')).toBeInTheDocument();
    expect(within(usage).getByText('Archivada')).toBeInTheDocument();
    // Acciones claras.
    expect(await within(panel).findByTestId('asset-edit-photo')).toHaveTextContent('Editar foto');
    expect(within(panel).getByTestId('asset-use-post')).toHaveTextContent('Usar en una publicación');

    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('dialog', { name: 'almejas.jpg' })).toBeInTheDocument();
    expect(screen.getByTestId('asset-usage')).toHaveTextContent('Todavía no está en ninguna pieza');
    await user.keyboard('{ArrowLeft}');
    expect(await screen.findByRole('dialog', { name: 'langostinos.jpg' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('con cambios sin guardar las flechas no cambian de archivo; guardar mantiene la ficha abierta', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getAllByTestId('library-asset')[0]!);
    await screen.findByRole('dialog', { name: 'langostinos.jpg' });
    const name = screen.getByTestId('asset-name');
    expect(screen.getByTestId('asset-save')).toBeDisabled();
    await user.type(name, ' nuevo');
    expect(screen.getByTestId('asset-next')).toBeDisabled();
    await user.keyboard('{Escape}'); // en un campo: no cierra ni roba la tecla
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('asset-save'));
    await waitFor(() => expect(fake.tables.media_assets!.find((a) => a.id === 'a1')!.file_name).toBe('langostinos.jpg nuevo'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('abre la ficha del archivo de ?recurso= y al cerrarla limpia la dirección', async () => {
    seed();
    const view = renderApp(`${BRAND_BASE}/biblioteca?recurso=a3`);
    expect(await screen.findByRole('dialog', { name: 'chuleta.jpg' })).toBeInTheDocument();
    await view.user.click(screen.getByTestId('asset-close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('«Usar en una publicación» crea la idea con la foto y abre el editor', async () => {
    seed();
    // Los archivos reales tienen identificador UUID y el documento de la pieza lo exige.
    const FOTO_ID = '11111111-1111-4111-8111-111111111111';
    fake.tables.media_assets![0]!.id = FOTO_ID;
    fake.tables.content_items = [];
    fake.rpc('save_content_version', (args) => ({ id: 'ver-1', content_id: args.p_content_id, version: 1 }));
    const { user } = await open();
    await user.click(screen.getAllByTestId('library-asset')[0]!);
    await user.click(await screen.findByTestId('asset-use-post'));
    await waitFor(() => expect(fake.tables.content_items).toHaveLength(1));
    const item = fake.tables.content_items![0]!;
    expect(item).toMatchObject({ title: 'langostinos', network: 'instagram', format: 'post' });
    const saved = fake.calls.find((c) => c.kind === 'rpc' && c.name === 'save_content_version');
    const data = (saved!.payload as { p_data: { pages: { layers: { source: { assetId: string } }[] }[] } }).p_data;
    expect(data.pages[0]!.layers[0]!.source.assetId).toBe(FOTO_ID);
  });
});

describe('Biblioteca: subir', () => {
  it('con una carpeta elegida, lo que se suelta en la página va a esa carpeta', async () => {
    seed();
    const { user } = await open();
    await user.click(screen.getByTestId('library-folder-Vinos / Tintos'));
    const file = new File([new Uint8Array(32)], 'blanco.png', { type: 'image/png' });
    fireEvent.dragOver(screen.getByTestId('library-grid').closest('section')!, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    expect(await screen.findByTestId('library-drop-overlay')).toHaveTextContent('Suelta para subir a «Vinos / Tintos»');
    fireEvent.drop(screen.getByTestId('library-grid').closest('section')!, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    // La cola de subida aparece con el archivo y su carpeta de destino.
    expect(await screen.findByTestId('library-upload-list')).toHaveTextContent('blanco.png');
    expect(screen.getByTestId('library-dropzone')).toHaveTextContent('Irán a «Vinos / Tintos»');
    void user;
  });
});

describe('Biblioteca: estados', () => {
  it('vacía, lo dice y ofrece subir', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.media_assets = [];
    fake.rpc('asset_facets', () => [{ tags: [], folders: [] }]);
    fake.rpc('asset_usage', () => []);
    renderApp(`${BRAND_BASE}/biblioteca`);
    expect(await screen.findByText('La biblioteca está vacía')).toBeInTheDocument();
    expect(screen.getByTestId('library-empty-upload')).toBeInTheDocument();
  });

  it('los filtros sin resultado dicen cómo quitarlos', async () => {
    seed();
    const { user } = await open();
    await user.type(screen.getByTestId('library-search'), 'zzz');
    expect(await screen.findByText('Nada coincide con los filtros')).toBeInTheDocument();
    await user.click(screen.getByTestId('library-clear-filters'));
    expect(await screen.findAllByTestId('library-asset')).not.toHaveLength(0);
  });

  it('una consulta que falla se dice y se puede reintentar', async () => {
    seed();
    // La aplicación reintenta una vez: falla dos veces seguidas.
    fake.failNext('media_assets', 'select', { message: 'Failed to fetch' });
    fake.failNext('media_assets', 'select', { message: 'Failed to fetch' });
    renderApp(`${BRAND_BASE}/biblioteca`);
    expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
