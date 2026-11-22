import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageApi from '@/features/storage/api';
import { fake } from '@/test/fakeSupabase';
import { BRAND_ID, ORG_ID, brandRow } from '@/test/fixtures';
import { BrandContext, makeBrandContext, OrgContext } from '@/features/orgs/context';
import { isPhotoDrag, PHOTO_DRAG_TYPE, PhotoPanel, readPhotoDrag } from './PhotoPanel';

// El panel de fotos reutilizable: carpetas a un toque, buscador sin tildes, «Subir»,
// miniaturas que se eligen o se arrastran. Se prueba suelto, sin editores.

const asset = (id: string, fileName: string, extra: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${id}.jpg`,
  file_name: fileName,
  mime_type: 'image/jpeg',
  bytes: 1,
  width: 10,
  height: 10,
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

beforeEach(() => {
  vi.spyOn(storageApi, 'signStoragePaths').mockImplementation(
    async (paths) => new Map(paths.map((path) => [path, `https://example.test/${path}`])),
  );
  fake.tables.media_assets = [
    asset('a1', 'Chuletón ternera.jpg', { folder: 'Platos / Carnes' }),
    asset('a2', 'langostinos.jpg', { folder: 'Platos / Mariscos', tags: ['postres'] }),
    asset('a3', 'sala.jpg', { folder: 'Local' }),
    asset('g1', 'Fondo nuevo · Chuletón ternera.jpg', { folder: 'Ediciones', provenance: { type: 'photo_edit' } }),
    asset('g2', 'portada-reel.jpg', { folder: 'Reels' }),
    asset('v1', 'brasa.mp4', { kind: 'video', mime_type: 'video/mp4' }),
  ];
});
afterEach(() => vi.restoreAllMocks());

/** Monta el panel suelto, solo con la marca y las consultas, como lo haría un editor. */
function mount(props: Partial<React.ComponentProps<typeof PhotoPanel>> = {}, role: 'owner' | 'viewer' = 'owner') {
  const org = { id: ORG_ID, name: 'Grupo Demo', kind: 'business', role: role === 'owner' ? 'owner' : 'member' } as never;
  const brand = brandRow();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPick = props.onPick ?? vi.fn();
  render(
    <QueryClientProvider client={client}>
      <OrgContext.Provider value={{ org, isAdmin: role === 'owner', brands: [brand], brandRoles: new Map() }}>
        <BrandContext.Provider value={makeBrandContext(org, brand, role === 'viewer' ? 'viewer' : undefined)}>
          <div style={{ height: 600 }}>
            <PhotoPanel {...props} onPick={onPick} />
          </div>
        </BrandContext.Provider>
      </OrgContext.Provider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup({ applyAccept: false }), onPick };
}

describe('Panel de fotos', () => {
  it('se puede probar suelto: ofrece solo fotos subidas por una persona, con carpetas a un toque', async () => {
    // Se monta como lo haría un editor: dentro de la aplicación, en una ruta de la marca.
    const { user, onPick } = mount();
    const panel = await screen.findByTestId('photo-panel');
    await waitFor(() => expect(within(panel).getAllByTestId('photo-panel-item')).toHaveLength(3));
    // Lo generado por la aplicación y los vídeos no salen.
    const names = () => within(panel).getAllByTestId('photo-panel-item').map((b) => b.getAttribute('title'));
    expect(names()).toEqual(['Chuletón ternera.jpg', 'langostinos.jpg', 'sala.jpg']);
    const folders = within(panel).getByTestId('photo-panel-folders');
    expect(within(folders).getByTestId('photo-panel-folder-Platos')).toHaveTextContent('2');
    await user.click(within(folders).getByTestId('photo-panel-folder-Local'));
    expect(names()).toEqual(['sala.jpg']);
    await user.click(within(folders).getByTestId('photo-panel-folder-all'));

    // Sin tildes y también por etiqueta.
    await user.type(within(panel).getByTestId('photo-panel-search'), 'chuleton');
    await waitFor(() => expect(names()).toEqual(['Chuletón ternera.jpg']));
    await user.clear(within(panel).getByTestId('photo-panel-search'));
    await user.type(within(panel).getByTestId('photo-panel-search'), 'postre');
    await waitFor(() => expect(names()).toEqual(['langostinos.jpg']));

    // Elegir avisa con la foto entera.
    await user.click(within(panel).getByTestId('photo-panel-item'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2', file_name: 'langostinos.jpg' }));
  });

  it('el filtro por tipo y lo generado se piden con propiedades', async () => {
    mount({ kinds: ['video'] });
    const panel = await screen.findByTestId('photo-panel');
    await waitFor(() => expect(within(panel).getAllByTestId('photo-panel-item')).toHaveLength(1));
    expect(within(panel).getByTestId('photo-panel-item')).toHaveAttribute('title', 'brasa.mp4');
  });

  it('con includeGenerated enseña también lo que generó la aplicación', async () => {
    mount({ includeGenerated: true });
    const panel = await screen.findByTestId('photo-panel');
    await waitFor(() => expect(within(panel).getAllByTestId('photo-panel-item')).toHaveLength(5));
  });

  it('arrastrar una foto deja su identificador para soltarla donde se quiera y avisa a onDragStart', async () => {
    const onDragStart = vi.fn();
    mount({ onDragStart });
    const panel = await screen.findByTestId('photo-panel');
    const first = (await within(panel).findAllByTestId('photo-panel-item'))[0]!;
    const store: Record<string, string> = {};
    const dataTransfer = {
      setData: (t: string, v: string) => (store[t] = v),
      getData: (t: string) => store[t] ?? '',
      get types() {
        return Object.keys(store);
      },
      effectAllowed: '',
    };
    fireEvent.dragStart(first, { dataTransfer });
    expect(onDragStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), expect.anything());
    expect(JSON.parse(store[PHOTO_DRAG_TYPE]!)).toEqual({ assetId: 'a1', fileName: 'Chuletón ternera.jpg' });
    const event = { dataTransfer } as unknown as Parameters<typeof readPhotoDrag>[0];
    expect(isPhotoDrag(event)).toBe(true);
    expect(readPhotoDrag(event)).toEqual({ assetId: 'a1', fileName: 'Chuletón ternera.jpg' });
    expect(readPhotoDrag({ dataTransfer: { getData: () => 'no es json', types: [] } } as never)).toBeNull();
  });

  it('«Subir» está solo para quien puede editar la marca', async () => {
    const { user } = mount();
    const panel = await screen.findByTestId('photo-panel');
    await user.click(await within(panel).findByTestId('photo-panel-upload'));
    expect(await screen.findByTestId('library-dropzone')).toBeInTheDocument();
  });

  it('un lector no ve «Subir» y, sin fotos, no promete poder subirlas', async () => {
    fake.tables.media_assets = [];
    mount({}, 'viewer');
    const panel = await screen.findByTestId('photo-panel');
    expect(await within(panel).findByText('Todavía no hay fotos')).toBeInTheDocument();
    expect(within(panel).queryByTestId('photo-panel-upload')).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('Quien edita la marca puede subirlas');
  });
});
