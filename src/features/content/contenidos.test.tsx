import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrandRole, ContentItemRow, ContentStatus, ContentVersionRow, OrgRole } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { createEmptyDocument, DOCUMENT_SCHEMA_VERSION, type ContentDocument } from './document';
import type { CanvasViewProps } from './editor/canvas/types';

// El lienzo de Konva necesita un <canvas> de verdad, que jsdom no tiene: aquí se
// sustituye por un doble que enseña cuántas capas recibe. La lógica del lienzo
// (órdenes, traducción documento ↔ nodos) se prueba aparte como funciones puras.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => (
    <div
      data-testid="canvas-stub"
      data-layers={props.document.layers.length}
      data-ratio={props.document.canvas.aspectRatio}
    />
  ),
}));

const CONTENT = `${BRAND_BASE}/contenidos`;

function item(overrides: Partial<ContentItemRow> = {}): ContentItemRow {
  return {
    id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Menú de otoño',
    network: 'instagram',
    format: 'post',
    status: 'draft',
    current_version: 1,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    ...overrides,
  };
}

function documentWithText(text = 'Titular de otoño'): ContentDocument {
  const doc = createEmptyDocument();
  return {
    ...doc,
    layers: [
      {
        id: 'titular',
        type: 'text',
        name: '',
        x: 100,
        y: 100,
        width: 800,
        height: 200,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        anchor: { x: 'center', y: 'center' },
        text,
        fontFamily: 'sans-serif',
        fontSize: 80,
        fontWeight: 700,
        italic: false,
        color: '#111111',
        align: 'center',
        lineHeight: 1.2,
      },
    ],
  };
}

function version(contentId: string, number: number, data: ContentDocument, note = ''): ContentVersionRow {
  return {
    id: `v-${contentId}-${number}`,
    content_id: contentId,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: number,
    schema_version: 1,
    data: data as unknown as ContentVersionRow['data'],
    change_note: note,
    restored_from: null,
    created_by: ME.id,
    created_at: `2026-11-1${number}T09:00:00Z`,
  };
}

/** Pieza con sus versiones en la base simulada y las funciones de guardado y estado como las de la base de datos. */
function seedContent(
  role: { orgRole: OrgRole; brandRole?: BrandRole },
  options: { status?: ContentStatus; versions?: number; archived?: boolean } = {},
) {
  seedWorkspace(role);
  const count = options.versions ?? 1;
  fake.tables.content_items = [
    item({
      status: options.status ?? 'draft',
      current_version: count,
      archived_at: options.archived ? '2026-11-12T09:00:00Z' : null,
    }),
  ];
  fake.tables.content_versions = Array.from({ length: count }, (_, i) =>
    version('content-1', i + 1, documentWithText(`Titular ${i + 1}`), `Nota ${i + 1}`),
  );
  const current = () => fake.rows('content_items').find((row) => row.id === 'content-1')!;
  const conflict = (expected: unknown) => {
    if (expected !== null && expected !== current().current_version)
      throw { code: 'CT001', message: 'Otra persona ha guardado una versión más reciente de este contenido.' };
  };
  fake.rpc('save_content_version', (args) => {
    conflict(args.p_expected_version);
    const next = (current().current_version as number) + 1;
    const row = version('content-1', next, args.p_data as ContentDocument, args.p_change_note as string);
    fake.rows('content_versions').push(row);
    Object.assign(current(), { current_version: next, status: 'draft' });
    return row;
  });
  fake.rpc('restore_content_version', (args) => {
    conflict(args.p_expected_version);
    const source = fake.rows('content_versions').find((v) => v.version === args.p_version)!;
    const next = (current().current_version as number) + 1;
    const row = { ...version('content-1', next, source.data as ContentDocument), restored_from: args.p_version };
    fake.rows('content_versions').push(row);
    Object.assign(current(), { current_version: next, status: 'draft' });
    return row;
  });
  fake.rpc('set_content_status', (args) => {
    conflict(args.p_expected_version);
    Object.assign(current(), { status: args.p_status });
    return current();
  });
  fake.rpc('archive_content_item', (args) => {
    Object.assign(current(), { archived_at: args.p_archived ? '2026-11-17T10:00:00Z' : null });
    return current();
  });
}

const EDITOR = `${CONTENT}/content-1`;

async function openEditor(
  role: { orgRole: OrgRole; brandRole?: BrandRole },
  options?: Parameters<typeof seedContent>[1],
) {
  seedContent(role, options);
  const app = renderApp(EDITOR);
  await screen.findByTestId('editor-title');
  return app;
}

describe('Lista de contenidos', () => {
  it('aparece en el menú de la marca y lista las piezas con su red, versión y estado', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
    fake.tables.content_items = [
      item(),
      item({
        id: 'content-2',
        title: 'Vídeo de la terraza',
        network: 'tiktok',
        format: 'video',
        status: 'idea',
        current_version: 0,
      }),
    ];
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    const nav = within((await screen.findAllByRole('navigation', { name: 'Principal' }))[0]!);
    expect(nav.getByRole('link', { name: 'Contenidos' })).toHaveAttribute('href', CONTENT);

    await user.click(nav.getByRole('link', { name: 'Contenidos' }));
    const list = await screen.findByTestId('content-list');
    const rows = within(list).getAllByTestId('content-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Menú de otoño');
    expect(rows[0]).toHaveTextContent('Instagram · Publicación');
    expect(rows[0]).toHaveTextContent('versión 1');
    expect(rows[0]).toHaveTextContent('Borrador');
    expect(rows[1]).toHaveTextContent('sin diseño');
    // Solo lectura: no puede crear.
    expect(screen.queryByTestId('content-new')).not.toBeInTheDocument();
  });

  it('filtra por estado, red, nombre y archivadas', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.content_items = [
      item(),
      item({ id: 'content-2', title: 'Vídeo de la terraza', network: 'tiktok', format: 'video', status: 'idea' }),
      item({ id: 'content-3', title: 'Navidad 2025', archived_at: '2026-01-10T09:00:00Z' }),
    ];
    const { user } = renderApp(CONTENT);
    await screen.findByTestId('content-list');
    expect(screen.getAllByTestId('content-row')).toHaveLength(2);

    await user.selectOptions(screen.getByTestId('content-status-filter'), 'idea');
    await waitFor(() => expect(screen.getAllByTestId('content-row')).toHaveLength(1));
    expect(screen.getByTestId('content-row')).toHaveTextContent('Vídeo de la terraza');

    await user.selectOptions(screen.getByTestId('content-status-filter'), '');
    await user.selectOptions(screen.getByTestId('content-network-filter'), 'instagram');
    await waitFor(() => expect(screen.getAllByTestId('content-row')).toHaveLength(1));
    expect(screen.getByTestId('content-row')).toHaveTextContent('Menú de otoño');

    await user.selectOptions(screen.getByTestId('content-network-filter'), '');
    await user.type(screen.getByTestId('content-search'), 'terraza');
    await waitFor(() => expect(screen.getAllByTestId('content-row')).toHaveLength(1));
    expect(screen.getByTestId('content-row')).toHaveTextContent('Vídeo de la terraza');

    await user.clear(screen.getByTestId('content-search'));
    await user.selectOptions(screen.getByTestId('content-archived-filter'), 'archived');
    await waitFor(() => expect(screen.getAllByTestId('content-row')).toHaveLength(1));
    expect(screen.getByTestId('content-row')).toHaveTextContent('Navidad 2025');
  });

  it('sin contenidos, explica cómo empezar', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
    renderApp(CONTENT);
    expect(await screen.findByText('Todavía no hay contenidos')).toBeInTheDocument();
  });
});

describe('Crear una idea', () => {
  it('elige red y formato del catálogo y abre el editor con un lienzo de la proporción admitida', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-new'));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByTestId('create-content-title'), 'Reel del vermut');
    await user.selectOptions(dialog.getByTestId('create-content-network'), 'instagram');
    await user.selectOptions(dialog.getByTestId('create-content-format'), 'reel');
    expect(dialog.getByText(/Es un formato de vídeo/)).toBeInTheDocument();
    await user.click(dialog.getByTestId('create-content-submit'));

    expect(await screen.findByTestId('editor-title')).toHaveTextContent('Reel del vermut');
    expect(fake.callsTo('content_items', 'insert')[0]?.payload).toEqual({
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      title: 'Reel del vermut',
      network: 'instagram',
      format: 'reel',
    });
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Sin guardar todavía');
    // El reel recomienda 9:16.
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-ratio', '9:16');
    // Sin IA conectada todavía: no hay botón de generar.
    expect(screen.queryByRole('button', { name: /IA/ })).not.toBeInTheDocument();
  });

  it('sin nombre, no se crea y lo dice', async () => {
    seedWorkspace({ orgRole: 'owner' });
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-new'));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('create-content-submit'));
    expect(await dialog.findByText('Ponle un nombre al contenido.')).toBeInTheDocument();
    expect(fake.callsTo('content_items', 'insert')).toHaveLength(0);
  });
});

describe('Editor: capas, teclado y texto de la publicación', () => {
  it('añade un texto, lo edita, lo borra con Supr y lo recupera con deshacer', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-layers', '1');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('add-text'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '2');
    expect(screen.getByTestId('editor-dirty')).toBeInTheDocument();
    const text = screen.getByTestId('layer-text');
    await user.clear(text);
    await user.type(text, 'Abrimos el domingo');

    await user.click(screen.getByRole('tab', { name: /Capas/ }));
    const layers = within(screen.getByTestId('layers-list'));
    const items = layers.getAllByTestId('layer-item');
    expect(items[0]).toHaveTextContent('Abrimos el domingo');
    expect(items[0]).toHaveAttribute('aria-pressed', 'true');

    items[0]!.focus();
    await user.keyboard('{Delete}');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '1');
    await user.click(screen.getByTestId('undo'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '2');
  });

  it('cambiar la proporción adapta el lienzo', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    await user.selectOptions(await screen.findByLabelText('Proporción'), '4:5');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-ratio', '4:5');
  });

  it('cuenta el texto de la publicación frente al límite de la red', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    await user.click(screen.getByRole('tab', { name: 'Publicación' }));
    await user.type(screen.getByTestId('copy-caption'), 'Hola');
    expect(screen.getByTestId('counter-caption')).toHaveTextContent('4 / 2200');
    await user.type(screen.getByTestId('copy-hashtags'), '#otoño menu');
    await user.tab();
    expect(screen.getByTestId('counter-hashtags')).toHaveTextContent('2 / 30');
  });
});

describe('Editor: versiones', () => {
  it('guarda una versión con nota sobre la versión que se abrió', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    expect(screen.getByTestId('editor-save')).toBeDisabled();
    await user.click(screen.getByTestId('add-text'));
    await user.click(screen.getByTestId('editor-save'));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByTestId('save-note'), 'Añado el horario');
    await user.click(dialog.getByTestId('save-confirm'));

    expect(await screen.findByText('Versión 2 guardada')).toBeInTheDocument();
    const call = fake.callsTo('save_content_version', 'rpc')[0]!.payload as Record<string, unknown>;
    expect(call).toMatchObject({
      p_content_id: 'content-1',
      p_change_note: 'Añado el horario',
      p_expected_version: 1,
      p_schema_version: DOCUMENT_SCHEMA_VERSION,
    });
    expect((call.p_data as ContentDocument).layers).toHaveLength(2);
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 2');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();
  });

  it('si otra persona guardó antes, avisa sin perder los cambios y deja guardar encima', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    // Mientras tanto, otra persona guarda la versión 2.
    fake.rows('content_versions').push(version('content-1', 2, documentWithText('De otra persona')));
    fake.rows('content_items')[0]!.current_version = 2;

    await user.click(screen.getByTestId('add-text'));
    await user.click(screen.getByTestId('editor-save'));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('save-confirm'));

    const alert = await screen.findByTestId('editor-conflict');
    expect(alert).toHaveTextContent('Otra persona ha guardado una versión más reciente');
    expect(screen.getByTestId('editor-dirty')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '2');

    await user.click(within(alert).getByTestId('conflict-save-mine'));
    expect(await screen.findByText('Versión 3 guardada')).toBeInTheDocument();
    const calls = fake
      .callsTo('save_content_version', 'rpc')
      .map((c) => (c.payload as Record<string, unknown>).p_expected_version);
    expect(calls).toEqual([1, 2]);
    expect(screen.queryByTestId('editor-conflict')).not.toBeInTheDocument();
  });

  it('tras un conflicto, puede descartar lo suyo y abrir la última versión', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    fake.rows('content_versions').push(version('content-1', 2, createEmptyDocument()));
    fake.rows('content_items')[0]!.current_version = 2;
    await user.click(screen.getByTestId('add-text'));
    await user.click(screen.getByTestId('editor-save'));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('save-confirm'));
    await user.click(await screen.findByTestId('conflict-load-latest'));
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0'));
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 2');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();
  });

  it('enseña el historial y restaura una versión anterior como versión nueva', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'manager' }, { versions: 2 });
    await user.click(screen.getByTestId('editor-history'));
    const dialog = within(await screen.findByRole('dialog'));
    const rows = within(await dialog.findByTestId('versions-list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Versión 2');
    expect(rows[0]).toHaveTextContent('Vigente');
    expect(rows[1]).toHaveTextContent('«Nota 1»');

    await user.click(within(rows[1]!).getByTestId('version-view'));
    await user.click(await dialog.findByTestId('version-restore'));
    expect(await screen.findByText('Versión 1 restaurada como versión 3')).toBeInTheDocument();
    expect(fake.callsTo('restore_content_version', 'rpc')[0]?.payload).toMatchObject({
      p_content_id: 'content-1',
      p_version: 1,
      p_expected_version: 2,
    });
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 3');
  });

  it('con cambios sin guardar, restaurar pide confirmación', async () => {
    const { user } = await openEditor({ orgRole: 'owner' }, { versions: 2 });
    await user.click(screen.getByTestId('add-text'));
    await user.click(screen.getByTestId('editor-history'));
    const rows = within(await screen.findByTestId('versions-list')).getAllByRole('listitem');
    await user.click(within(rows[1]!).getByTestId('version-view'));
    await user.click(await screen.findByTestId('version-restore'));
    expect(await screen.findByText('¿Restaurar y descartar tus cambios?')).toBeInTheDocument();
    expect(fake.callsTo('restore_content_version', 'rpc')).toHaveLength(0);
  });
});

describe('Editor: Publicar ahora', () => {
  const account = {
    id: 'acc-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    network: 'instagram',
    status: 'active',
    external_id: '1784',
    username: 'casa_demo',
  };

  it('en una pieza aprobada, con la publicación activa, ofrece exportar y publicar en el mismo paso', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seedContent({ orgRole: 'owner' }, { status: 'approved' });
    fake.tables.social_accounts = [account];
    fake.tables.scheduled_publications = [];
    fake.tables.media_assets = [];
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    await user.click(screen.getByTestId('editor-publish-now'));
    expect(await screen.findByTestId('publish-now-warning')).toHaveTextContent(
      'Se publicará ahora en @casa_demo. No se puede deshacer desde aquí.',
    );
    expect(screen.getByTestId('publish-now-export-note')).toHaveTextContent(/se exportará a JPEG/);
    vi.unstubAllEnvs();
  });

  it('no aparece sin aprobar, sin la publicación activa ni para quien no edita', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    await openEditor({ orgRole: 'owner' }, { status: 'draft' });
    expect(screen.queryByTestId('editor-publish-now')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('sin la publicación activa en el entorno no se ofrece', async () => {
    await openEditor({ orgRole: 'owner' }, { status: 'approved' });
    expect(screen.queryByTestId('editor-publish-now')).toBeNull();
  });

  it('quien solo ve no puede publicar', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    await openEditor({ orgRole: 'member', brandRole: 'viewer' }, { status: 'approved' });
    expect(screen.queryByTestId('editor-publish-now')).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('Editor: estados según el rol', () => {
  it('quien edita envía a revisión la versión que tiene abierta', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    expect(screen.queryByTestId('status-approved')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('status-in_review'));
    expect(await screen.findByText('Enviada a revisión')).toBeInTheDocument();
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toEqual({
      p_content_id: 'content-1',
      p_status: 'in_review',
      p_expected_version: 1,
    });
  });

  it('con cambios sin guardar no se puede cambiar el estado', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    await user.click(screen.getByTestId('add-text'));
    expect(screen.getByTestId('status-in_review')).toBeDisabled();
  });

  it('quien revisa no edita, pero aprueba o devuelve a borrador', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'reviewer' }, { status: 'in_review' });
    expect(screen.getByText('Puedes revisarla y cambiar su estado, pero no editarla.')).toBeInTheDocument();
    expect(screen.queryByTestId('editor-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-text')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editor-archive')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-draft')).toHaveTextContent('Devolver a borrador');
    await user.click(screen.getByTestId('status-approved'));
    await waitFor(() => expect(fake.callsTo('set_content_status', 'rpc')).toHaveLength(1));
    // El aviso y la etiqueta de estado dicen lo mismo.
    expect((await screen.findAllByText('Aprobada')).length).toBeGreaterThan(0);
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toMatchObject({
      p_status: 'approved',
      p_expected_version: 1,
    });
  });

  it('quien solo ve no tiene ninguna acción', async () => {
    await openEditor({ orgRole: 'member', brandRole: 'viewer' }, { status: 'in_review' });
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
    expect(screen.queryByTestId('status-approved')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-draft')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editor-save')).not.toBeInTheDocument();
  });

  it('archivar pide confirmación y deja la pieza en solo lectura', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    await user.click(screen.getByTestId('editor-archive'));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('confirm-action'));
    expect(await screen.findByText('Contenido archivado')).toBeInTheDocument();
    expect(await screen.findByText(/Está archivada/)).toBeInTheDocument();
    expect(screen.queryByTestId('editor-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-in_review')).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-archive')).toHaveTextContent('Recuperar');
  });

  it('una pieza que no existe lo dice', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp(`${CONTENT}/no-existe`);
    expect(await screen.findByText('No encontramos este contenido')).toBeInTheDocument();
  });
});
