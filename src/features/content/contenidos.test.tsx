import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandRole, ContentItemRow, ContentStatus, ContentVersionRow, OrgRole } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { createEmptyDocument, DOCUMENT_SCHEMA_VERSION, type ContentDocument } from './document';
import { addFromDrawer } from './editorTestKit';
import type { CanvasViewProps } from './editor/canvas/types';
import { chooseEditorAction, chooseMoreAction, openMoreMenu, openShareSheet } from '@/test/moreMenu';

// El lienzo de Konva necesita un <canvas> de verdad, que jsdom no tiene: aquí se
// sustituye por un doble que enseña cuántas capas recibe. La lógica del lienzo
// (órdenes, traducción documento ↔ nodos) se prueba aparte como funciones puras.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => (
    <div
      data-testid="canvas-stub"
      data-layers={props.document.layers.length}
      data-ratio={props.document.canvas.aspectRatio}
    >
      {props.footerStart}
      {props.footerEnd}
    </div>
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
    pages: [
      {
        id: 'p1',
        name: '',
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

/**
 * Lo que llega tras guardar una versión o cambiar el estado (aviso, llamada a la base) se espera por
 * lo que de verdad se espera, sin pausas fijas, y con margen: con la máquina cargada, el segundo de
 * siempre no basta (fallaba de vez en cuando).
 */
const SLOW = { timeout: 5000 };

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
    // Se abre en la primera pestaña con algo: la idea sin diseño, marcada como vacía.
    const ideas = within(list).getAllByTestId('content-card');
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toHaveTextContent('Vídeo de la terraza');
    expect(ideas[0]).toHaveTextContent('Idea');
    expect(ideas[0]).toHaveTextContent('Vacía');
    expect(screen.getByTestId('content-count-idea')).toHaveTextContent('1');
    expect(screen.getByTestId('content-count-preparing')).toHaveTextContent('1');

    await user.click(screen.getByTestId('content-tab-preparing'));
    const cards = within(await screen.findByTestId('content-list')).getAllByTestId('content-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('Menú de otoño');
    expect(cards[0]).toHaveTextContent('Publicación');
    expect(cards[0]).toHaveTextContent('En preparación');
    expect(cards[0]).not.toHaveTextContent('Vacía');
    // Con la vista de lista, la misma pieza en una fila compacta.
    await user.click(screen.getByTestId('content-view-list'));
    expect(within(screen.getByTestId('content-list')).getAllByTestId('content-row')).toHaveLength(1);
    // Solo lectura: no puede crear, ni elegir, ni archivar.
    expect(screen.queryByTestId('create-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-archive')).not.toBeInTheDocument();
  });

  it('filtra por formato, nombre y archivadas, y los contadores siguen al filtro', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.content_items = [
      item(),
      item({ id: 'content-2', title: 'Vídeo de la terraza', network: 'instagram', format: 'reel', status: 'idea' }),
      item({ id: 'content-3', title: 'Navidad 2025', archived_at: '2026-01-10T09:00:00Z' }),
    ];
    const { user } = renderApp(CONTENT);
    await screen.findByTestId('content-list');
    expect(screen.getByTestId('content-count-idea')).toHaveTextContent('1');
    expect(screen.getByTestId('content-count-preparing')).toHaveTextContent('1');

    await user.selectOptions(screen.getByTestId('content-format-filter'), 'post');
    await waitFor(() => expect(screen.getByTestId('content-count-idea')).toHaveTextContent('0'));
    expect(screen.getByTestId('content-count-preparing')).toHaveTextContent('1');

    await user.selectOptions(screen.getByTestId('content-format-filter'), '');
    await user.type(screen.getByTestId('content-search'), 'terraza');
    await waitFor(() => expect(screen.getByTestId('content-count-preparing')).toHaveTextContent('0'));
    expect(within(screen.getByTestId('content-list')).getByTestId('content-card')).toHaveTextContent(
      'Vídeo de la terraza',
    );

    await user.clear(screen.getByTestId('content-search'));
    // Las archivadas, desde «⋯»: no ocupan un filtro más.
    await chooseMoreAction(user, 'content-more', 'content-show-archived');
    expect(await screen.findByTestId('content-archived-notice')).toHaveTextContent('Estás viendo las archivadas');
    await waitFor(() => expect(screen.getAllByTestId('content-card')).toHaveLength(1));
    expect(screen.getByTestId('content-card')).toHaveTextContent('Navidad 2025');
  });

  it('separa las programadas y las publicadas según su publicación', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.content_items = [
      item({ id: 'a', title: 'Aprobada sola', status: 'approved' }),
      item({ id: 'b', title: 'Con fecha', status: 'approved' }),
      item({ id: 'c', title: 'Ya salió', status: 'approved' }),
    ];
    fake.tables.scheduled_publications = [
      {
        id: 'p1',
        brand_id: BRAND_ID,
        content_id: 'b',
        status: 'scheduled',
        scheduled_at: '2026-12-01T10:00:00Z',
        published_at: null,
        hold_reason: null,
      },
      {
        id: 'p2',
        brand_id: BRAND_ID,
        content_id: 'c',
        status: 'published',
        scheduled_at: '2026-11-01T10:00:00Z',
        published_at: '2026-11-01T10:00:00Z',
        hold_reason: null,
      },
    ];
    const { user } = renderApp(CONTENT);
    await screen.findByTestId('content-list');
    expect(screen.getByTestId('content-count-ready')).toHaveTextContent('1');
    expect(screen.getByTestId('content-count-scheduled')).toHaveTextContent('1');
    expect(screen.getByTestId('content-count-published')).toHaveTextContent('1');
    await user.click(screen.getByTestId('content-tab-scheduled'));
    const card = await screen.findByTestId('content-card');
    expect(card).toHaveTextContent('Con fecha');
    expect(card).toHaveTextContent('Programada');
    expect(card).toHaveTextContent('Sale el');
  });

  it('elige varias y las archiva de una vez, y limpia las vacías', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.content_items = [
      item({ id: 'a', title: 'Vacía 1', status: 'idea', current_version: 0 }),
      item({ id: 'b', title: 'Vacía 2', status: 'idea', current_version: 0 }),
      item({ id: 'c', title: 'Vacía 3', status: 'draft', current_version: 0 }),
      item({ id: 'd', title: 'Con diseño', status: 'idea', current_version: 1 }),
    ];
    fake.rpc('archive_content_item', (args) => {
      const row = fake.tables.content_items!.find((r) => r.id === args.p_content_id)!;
      row.archived_at = args.p_archived ? '2026-11-22T10:00:00Z' : null;
      return row;
    });
    const { user } = renderApp(CONTENT);
    await screen.findByTestId('content-list');
    await user.click(within(screen.getAllByTestId('content-card')[0]!).getByTestId('content-select'));
    await user.click(within(screen.getAllByTestId('content-card')[1]!).getByTestId('content-select'));
    expect(screen.getByTestId('content-selection')).toHaveTextContent('2 elegidas');
    await user.click(screen.getByTestId('content-archive-selected'));
    await user.click(await screen.findByTestId('confirm-action'));
    await waitFor(() => expect(fake.callsTo('archive_content_item', 'rpc')).toHaveLength(2));

    // Las vacías que quedan se limpian desde «⋯».
    await chooseMoreAction(user, 'content-more', 'content-clean-empty');
    await user.click(await screen.findByTestId('confirm-action'));
    await waitFor(() => expect(fake.callsTo('archive_content_item', 'rpc').length).toBeGreaterThanOrEqual(3));
  });

  it('sin contenidos, explica cómo empezar', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
    renderApp(CONTENT);
    expect(await screen.findByText('Todavía no hay contenidos')).toBeInTheDocument();
  });
});

describe('Crear una idea', () => {
  it('elige el formato con una tarjeta y abre el editor que toca (un reel, el de reels)', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-empty-new'));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByTestId('create-content-title'), 'Reel del vermut');
    await user.click(dialog.getByTestId('create-content-format-reel'));
    expect(dialog.queryByText(/llegará más adelante/)).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('create-content-submit'));

    // Un reel se abre en el editor de reels (línea de tiempo y vista previa), no en el de imagen.
    expect(await screen.findByTestId('reel-editor', {}, { timeout: 20_000 })).toHaveTextContent('Reel del vermut');
    expect(fake.callsTo('content_items', 'insert')[0]?.payload).toEqual({
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      title: 'Reel del vermut',
      network: 'instagram',
      format: 'reel',
    });
    expect(screen.getByTestId('reel-version')).toHaveTextContent('Sin guardar');
    expect(screen.getByText('Empieza tu reel en tres pasos')).toBeInTheDocument();
    // Sin IA conectada todavía: no hay botón de generar.
    expect(screen.queryByRole('button', { name: /IA/ })).not.toBeInTheDocument();
  });

  it('sin nombre se llama como el formato y el día, no «Reel nuevo» a secas', async () => {
    seedWorkspace({ orgRole: 'owner' });
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-empty-new'));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('create-content-format-carousel'));
    await user.click(dialog.getByTestId('create-content-submit'));
    await waitFor(() => expect(fake.callsTo('content_items', 'insert')).toHaveLength(1));
    const payload = fake.callsTo('content_items', 'insert')[0]!.payload as { title: string; format: string };
    expect(payload.format).toBe('carousel');
    expect(payload.title).toMatch(/^Carrusel · \d{1,2} \p{L}+/u);
  });
});

describe('Editor: capas, teclado y texto de la publicación', () => {
  it('añade un texto desde el cajón «Elementos», lo borra con Supr en «Capas» y lo recupera con deshacer', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-layers', '1');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();

    await addFromDrawer(user, 'elements', 'add-text');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '2');
    expect(screen.getByTestId('editor-dirty')).toBeInTheDocument();

    await user.click(screen.getByTestId('editor-layers'));
    const layers = within(screen.getByTestId('layers-list'));
    const items = layers.getAllByTestId('layer-item');
    expect(items[0]).toHaveAttribute('aria-pressed', 'true');

    items[0]!.focus();
    await user.keyboard('{Delete}');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '1');
    await user.click(screen.getByTestId('undo'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '2');
  });

  it('cambiar la proporción («⋯ → Tamaño y fondo») adapta el lienzo', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    await chooseEditorAction(user, 'editor-canvas-settings');
    await user.selectOptions(await screen.findByLabelText('Proporción'), '4:5');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-ratio', '4:5');
  });

  it('cuenta el texto de la publicación (en «Compartir») frente al límite de la red', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    const sheet = await openShareSheet(user);
    await user.type(sheet.getByTestId('copy-caption'), 'Hola');
    expect(sheet.getByTestId('counter-caption')).toHaveTextContent('4 / 2200');
    await user.type(sheet.getByTestId('copy-hashtags'), '#otoño menu');
    await user.tab();
    expect(sheet.getByTestId('counter-hashtags')).toHaveTextContent('2 / 30');
  });
});

describe('Editor: versiones', () => {
  it('se guarda solo; «Guardar versión con una nota» (en «⋯») deja una versión sobre la que se abrió', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    // Sin botón «Guardar versión» en la cabecera: el guardado es automático.
    expect(screen.queryByTestId('editor-save')).not.toBeInTheDocument();
    await addFromDrawer(user, 'elements', 'add-text');
    await chooseEditorAction(user, 'editor-save-note');
    const dialog = within(await screen.findByRole('dialog'));
    // El foco cae en la nota y no en «Cerrar»: Intro ya no cierra el diálogo sin guardar.
    await waitFor(() => expect(dialog.getByTestId('save-note')).toHaveFocus());
    await user.type(dialog.getByTestId('save-note'), 'Añado el horario');
    await user.click(dialog.getByTestId('save-confirm'));

    expect(await screen.findByText('Versión 2 guardada', {}, SLOW)).toBeInTheDocument();
    const call = fake.callsTo('save_content_version', 'rpc')[0]!.payload as Record<string, unknown>;
    expect(call).toMatchObject({
      p_content_id: 'content-1',
      p_change_note: 'Añado el horario',
      p_expected_version: 1,
      p_schema_version: DOCUMENT_SCHEMA_VERSION,
    });
    expect((call.p_data as ContentDocument).pages[0]!.layers).toHaveLength(2);
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 2');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();
  });

  it('Ctrl+S guarda una versión al momento, sin diálogo ni nota', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    await addFromDrawer(user, 'elements', 'add-text');
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Versión 2 guardada', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.callsTo('save_content_version', 'rpc')[0]!.payload).toMatchObject({
      p_change_note: '',
      p_expected_version: 1,
    });
    expect(screen.getByTestId('editor-saved')).toHaveTextContent('Guardado');
  });

  it('si otra persona guardó antes, avisa sin perder los cambios y deja guardar encima', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    // Mientras tanto, otra persona guarda la versión 2.
    fake.rows('content_versions').push(version('content-1', 2, documentWithText('De otra persona')));
    fake.rows('content_items')[0]!.current_version = 2;

    await addFromDrawer(user, 'elements', 'add-text');
    await user.keyboard('{Control>}s{/Control}');

    const alert = await screen.findByTestId('editor-conflict');
    expect(alert).toHaveTextContent('Otra persona ha guardado una versión más reciente');
    expect(screen.getByTestId('editor-dirty')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '2');

    await user.click(within(alert).getByTestId('conflict-save-mine'));
    expect(await screen.findByText('Versión 3 guardada', {}, SLOW)).toBeInTheDocument();
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
    await addFromDrawer(user, 'elements', 'add-text');
    await user.keyboard('{Control>}s{/Control}');
    await user.click(await screen.findByTestId('conflict-load-latest'));
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0'));
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 2');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();
  });

  it('enseña el historial y restaura una versión anterior como versión nueva', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'manager' }, { versions: 2 });
    await chooseEditorAction(user, 'editor-history');
    const dialog = within(await screen.findByRole('dialog'));
    const rows = within(await dialog.findByTestId('versions-list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Versión 2');
    expect(rows[0]).toHaveTextContent('Vigente');
    expect(rows[1]).toHaveTextContent('«Nota 1»');

    await user.click(within(rows[1]!).getByTestId('version-view'));
    await user.click(await dialog.findByTestId('version-restore'));
    expect(await screen.findByText('Versión 1 restaurada como versión 3', {}, SLOW)).toBeInTheDocument();
    expect(fake.callsTo('restore_content_version', 'rpc')[0]?.payload).toMatchObject({
      p_content_id: 'content-1',
      p_version: 1,
      p_expected_version: 2,
    });
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 3');
  });

  it('con cambios sin guardar, restaurar pide confirmación', async () => {
    const { user } = await openEditor({ orgRole: 'owner' }, { versions: 2 });
    await addFromDrawer(user, 'elements', 'add-text');
    await chooseEditorAction(user, 'editor-history');
    const rows = within(await screen.findByTestId('versions-list')).getAllByRole('listitem');
    await user.click(within(rows[1]!).getByTestId('version-view'));
    await user.click(await screen.findByTestId('version-restore'));
    expect(await screen.findByText('¿Restaurar y descartar tus cambios?', {}, SLOW)).toBeInTheDocument();
    expect(fake.callsTo('restore_content_version', 'rpc')).toHaveLength(0);
  });
});

const account = {
  id: 'acc-1',
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  network: 'instagram',
  status: 'active',
  external_id: '1784',
  username: 'casa_demo',
};

/** Pieza con la publicación activa y una cuenta de Instagram conectada. */
function seedPublishing(role: Parameters<typeof seedContent>[0], options: Parameters<typeof seedContent>[1]) {
  vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
  seedContent(role, options);
  fake.tables.social_accounts = [account];
  fake.tables.scheduled_publications = [];
  fake.tables.media_assets = [];
}

describe('Editor: Publicar ahora (modo agencia: el flujo de aprobación de siempre)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('en una pieza aprobada, con la publicación activa, ofrece exportar y publicar en el mismo paso', async () => {
    seedPublishing({ orgRole: 'owner' }, { status: 'approved' });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    await chooseEditorAction(user, 'editor-publish-now');
    expect(await screen.findByTestId('publish-now-warning')).toHaveTextContent(
      'Se publicará ahora en @casa_demo. No se puede deshacer desde aquí.',
    );
    expect(screen.getByTestId('publish-now-export-note')).toHaveTextContent(/La imagen se prepara ahora/);
  });

  it('sin aprobar, quien puede aprobar la aprueba y la publica desde el mismo botón, que lo dice', async () => {
    seedPublishing({ orgRole: 'owner' }, { status: 'draft' });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    const sheet = await openShareSheet(user);
    expect(sheet.getByTestId('share-publish-now')).toHaveTextContent('Aprobar y publicar ahora');
    await user.click(sheet.getByTestId('share-publish-now'));
    // Se aprueba la versión que se ve y se abre la confirmación de publicar (nada se publica aún).
    expect(await screen.findByTestId('publish-now-warning')).toBeInTheDocument();
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toMatchObject({
      p_status: 'approved',
      p_expected_version: 1,
    });
  });

  it('quien edita pero no aprueba no puede publicar sin aprobar: se le dice por qué', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' }, { status: 'draft' });
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('share-publish-now')).toBeNull();
    expect(sheet.queryByTestId('share-schedule')).toBeNull();
    expect(sheet.getByTestId('editor-share-note')).toHaveTextContent(/antes tiene que aprobarla/);
  });

  it('sin la publicación activa en el entorno no se ofrece; ver cómo queda, descargar y copiar el texto, siempre', async () => {
    const { user } = await openEditor({ orgRole: 'owner' }, { status: 'approved' });
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('share-publish-now')).toBeNull();
    expect(sheet.getByTestId('share-preview')).toBeInTheDocument();
    expect(sheet.getByTestId('share-download')).toHaveTextContent('Descargar');
    expect(sheet.getByTestId('share-copy-text')).toHaveTextContent('Copiar el texto');
  });

  it('quien solo ve no puede publicar', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'viewer' }, { status: 'approved' });
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('share-publish-now')).toBeNull();
  });
});

describe('Editor en autogestión: sin paso de aprobación a la vista', () => {
  afterEach(() => vi.unstubAllEnvs());

  /** Como `seedPublishing`, con la organización en «Lo llevamos nosotros». */
  function seedSelf(status: ContentStatus, role: Parameters<typeof seedContent>[0] = { orgRole: 'owner' }) {
    seedPublishing(role, { status });
    fake.rows('organizations')[0]!.work_mode = 'self';
  }

  it('«Publicar ahora» guarda la versión y la aprueba por debajo, sin decir «Aprobar»', async () => {
    seedSelf('draft');
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    await addFromDrawer(user, 'elements', 'add-text');
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('share-review')).not.toBeInTheDocument();
    expect(sheet.queryByText(/Aprobar|Enviar a revisión|Aprobada/)).toBeNull();
    expect(sheet.getByTestId('share-publish-now')).toHaveTextContent('Publicar ahora');
    await user.click(sheet.getByTestId('share-publish-now'));
    expect(await screen.findByTestId('publish-now-warning')).toBeInTheDocument();
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1);
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toMatchObject({
      p_status: 'approved',
      p_expected_version: 2,
    });
  });

  it('una idea pasa antes a borrador (lo que pide la base de datos) y «Programar…» dice que programado no es publicado', async () => {
    seedSelf('idea');
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    const sheet = await openShareSheet(user);
    expect(sheet.getByTestId('share-schedule-note')).toHaveTextContent('no se publica hasta el día y la hora');
    await user.click(sheet.getByTestId('share-schedule'));
    expect(await screen.findByTestId('schedule-content')).toHaveValue('content-1');
    expect(fake.callsTo('set_content_status', 'rpc').map((c) => (c.payload as Record<string, unknown>).p_status)).toEqual(['draft', 'approved']);
  });

  it('sin la cabecera de estados: ni «Aprobar» ni «Enviar a revisión» en ningún sitio', async () => {
    seedSelf('draft');
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    expect(screen.queryByTestId('status-approved')).toBeNull();
    expect(screen.queryByTestId('status-in_review')).toBeNull();
    await openMoreMenu(user, 'editor-more');
    expect(screen.queryByText(/Aprobar|Enviar a revisión|Retirar la aprobación/)).toBeNull();
  });

  it('quien no puede aprobar en la marca no publica: se le dice sin hablar de aprobar', async () => {
    seedSelf('draft', { orgRole: 'member', brandRole: 'editor' });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('share-publish-now')).toBeNull();
    expect(sheet.getByTestId('editor-share-note')).toHaveTextContent('no se puede publicar ni programar');
  });
});

describe('Editor: estados según el rol (modo agencia, en «Compartir»)', () => {
  it('quien edita envía a revisión la versión que tiene abierta', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('status-approved')).not.toBeInTheDocument();
    await user.click(sheet.getByTestId('status-in_review'));
    expect(await screen.findByText('Enviada a revisión', {}, SLOW)).toBeInTheDocument();
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toEqual({
      p_content_id: 'content-1',
      p_status: 'in_review',
      p_expected_version: 1,
    });
  });

  it('con cambios sin guardar, cambiar el estado guarda antes la versión', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'editor' });
    await addFromDrawer(user, 'elements', 'add-text');
    await chooseEditorAction(user, 'status-in_review');
    expect(await screen.findByText('Enviada a revisión', {}, SLOW)).toBeInTheDocument();
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1);
    // Se envía a revisión la versión recién guardada, no la anterior.
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toEqual({
      p_content_id: 'content-1',
      p_status: 'in_review',
      p_expected_version: 2,
    });
  });

  it('quien revisa no edita, pero aprueba o devuelve a borrador', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'reviewer' }, { status: 'in_review' });
    expect(screen.getByText('Puedes revisarla y cambiar su estado (en «Compartir»), pero no editarla.')).toBeInTheDocument();
    expect(screen.queryByTestId('editor-rail')).not.toBeInTheDocument();
    // Sin archivar en «⋯» (no edita).
    await openMoreMenu(user, 'editor-more');
    expect(screen.queryByTestId('editor-archive')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    const sheet = await openShareSheet(user);
    expect(sheet.getByTestId('status-draft')).toHaveTextContent('Devolver a borrador');
    await user.click(sheet.getByTestId('status-approved'));
    await waitFor(() => expect(fake.callsTo('set_content_status', 'rpc')).toHaveLength(1), SLOW);
    // El aviso y la etiqueta de estado dicen lo mismo.
    expect((await screen.findAllByText('Aprobada')).length).toBeGreaterThan(0);
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toMatchObject({
      p_status: 'approved',
      p_expected_version: 1,
    });
  });

  it('quien solo ve no tiene ninguna acción', async () => {
    const { user } = await openEditor({ orgRole: 'member', brandRole: 'viewer' }, { status: 'in_review' });
    expect(screen.getByText(/Solo lectura/)).toBeInTheDocument();
    expect(screen.queryByTestId('editor-rail')).not.toBeInTheDocument();
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('status-approved')).not.toBeInTheDocument();
    expect(sheet.queryByTestId('status-draft')).not.toBeInTheDocument();
  });

  it('archivar pide confirmación y deja la pieza en solo lectura', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    await chooseEditorAction(user, 'editor-archive');
    await user.click(within(await screen.findByRole('dialog')).getByTestId('confirm-action'));
    expect(await screen.findByText('Contenido archivado', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText(/Está archivada/, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByTestId('editor-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-archive')).toHaveTextContent('Recuperar');
    const sheet = await openShareSheet(user);
    expect(sheet.queryByTestId('status-in_review')).not.toBeInTheDocument();
  });

  it('una pieza que no existe lo dice', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp(`${CONTENT}/no-existe`);
    expect(await screen.findByText('No encontramos este contenido', {}, SLOW)).toBeInTheDocument();
  });
});

describe('Editor: un solo camino para sacar la pieza', () => {
  /** Los botones de la cabecera que están a la vista (sin abrir «⋯»). */
  const visibleActions = () =>
    within(screen.getByTestId('page-actions'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());

  it('la cabecera: deshacer, rehacer, «⋯» y «Compartir»; nada de guardar, aprobar ni ver cómo quedará', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    expect(visibleActions()).toEqual(['Deshacer', 'Rehacer', 'Más acciones de la pieza', 'Compartir']);
    await openMoreMenu(user, 'editor-more');
    const menu = within(screen.getByRole('menu'));
    expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Guardar versión con una nota…',
      'Historial',
      'Nombre y red',
      'Tamaño y fondo',
      'Guardar como plantilla…',
      'Archivar',
    ]);
    // Archivar va al final, separado.
    expect(menu.getAllByRole('separator')).toHaveLength(2);
  });

  it('modo agencia, en «Compartir»: el estado arriba con su cambio principal y los de volver atrás', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    const sheet = await openShareSheet(user);
    const review = within(sheet.getByTestId('share-review'));
    expect(review.getByText('Borrador')).toBeInTheDocument();
    expect(review.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Enviar a revisión',
      'Aprobar',
      'Devolver a idea',
    ]);
  });

  it('aprobada y publicable: «Compartir» reúne ver, descargar, programar, publicar y copiar; retirar la aprobación, ahí también', async () => {
    seedPublishing({ orgRole: 'owner' }, { status: 'approved' });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('editor-title');
    const sheet = await openShareSheet(user);
    expect(sheet.getByTestId('status-draft')).toHaveTextContent('Retirar la aprobación');
    expect(within(sheet.getByTestId('share-actions')).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Descargar',
      'Copiar el texto',
      'Programar…',
      'Publicar ahora',
    ]);
    // «Programar» abre el diálogo con la pieza ya elegida.
    await user.click(sheet.getByTestId('share-schedule'));
    expect(await screen.findByTestId('schedule-content')).toHaveValue('content-1');
    vi.unstubAllEnvs();
  });

  it('«Copiar el texto» copia el pie con sus hashtags', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    const sheet = await openShareSheet(user);
    await user.type(sheet.getByTestId('copy-caption'), 'Menú de otoño');
    await user.type(sheet.getByTestId('copy-hashtags'), '#otoño');
    await user.tab();
    await user.click(sheet.getByTestId('share-copy-text'));
    expect(await screen.findByText('Texto copiado: pégalo donde lo vayas a publicar.', {}, SLOW)).toBeInTheDocument();
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain('Menú de otoño');
    expect(copied).toContain('#otoño');
  });

  it('con cambios sin guardar, el cambio de estado sigue activo: guarda la versión y aprueba', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    await addFromDrawer(user, 'elements', 'add-text');
    const sheet = await openShareSheet(user);
    expect(sheet.getByTestId('status-approved')).toBeEnabled();
    expect(sheet.getByTestId('status-approved')).toHaveAttribute('title', 'Guarda los cambios como versión y sigue');
    await user.click(sheet.getByTestId('status-approved'));
    await waitFor(() => expect(fake.callsTo('set_content_status', 'rpc')).toHaveLength(1), SLOW);
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1);
    expect(fake.callsTo('set_content_status', 'rpc')[0]?.payload).toMatchObject({
      p_status: 'approved',
      p_expected_version: 2,
    });
  });

  it('el menú «⋯» se maneja con el teclado y devuelve el foco al cerrarlo', async () => {
    const { user } = await openEditor({ orgRole: 'owner' });
    const trigger = screen.getByTestId('editor-more');
    expect(trigger).toHaveAccessibleName('Más acciones de la pieza');
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByText('Historial').closest('[role="menuitem"]')).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('archivada: «Recuperar» a la vista', async () => {
    await openEditor({ orgRole: 'owner' }, { archived: true });
    expect(screen.getByTestId('editor-archive')).toHaveTextContent('Recuperar');
    expect(visibleActions()).toEqual(['Más acciones de la pieza', 'Recuperar', 'Compartir']);
  });

  it('desde un aviso del calendario («Exportar») abre el diálogo de exportar', async () => {
    seedContent({ orgRole: 'owner' }, { status: 'approved' });
    renderApp(`${EDITOR}?exportar=1`);
    await screen.findByTestId('editor-title');
    expect(await screen.findByRole('dialog', { name: /Exportar/ })).toBeInTheDocument();
  });
});
