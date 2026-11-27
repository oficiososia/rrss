import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrandRole, BrandDesignTemplateRow, ContentItemRow, OrgRole } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { createEmptyDocument, type ContentDocument, type Layer } from './document';
import type { CanvasViewProps } from './editor/canvas/types';
import { chooseEditorAction, openMoreMenu } from '@/test/moreMenu';

// Crear una pieza a partir de una plantilla de la marca: desde «Nueva idea» y
// desde el editor. El lienzo de Konva se sustituye por un doble que cuenta capas.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => (
    <div
      data-testid="canvas-stub"
      data-layers={props.document.layers.length}
      data-ratio={props.document.canvas.aspectRatio}
      data-ids={props.document.layers.map((l) => l.id).join(',')}
    />
  ),
}));

const CONTENT = `${BRAND_BASE}/contenidos`;
const ASSET = '33333333-3333-4333-8333-333333333333';

function layerBase(id: string) {
  return {
    id,
    name: '',
    x: 0,
    y: 0,
    width: 540,
    height: 540,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    anchor: { x: 'center' as const, y: 'center' as const },
  };
}

const PHOTO: Layer = {
  ...layerBase('foto-plato'),
  type: 'image',
  source: { kind: 'asset', assetId: ASSET },
  fit: 'cover',
  focus: { x: 0.5, y: 0.5 },
} as Layer;
const HEADLINE: Layer = {
  ...layerBase('titular-plantilla'),
  type: 'text',
  text: 'Plato del día',
  fontFamily: 'sans-serif',
  fontSize: 80,
  fontWeight: 700,
  italic: false,
  color: '#111111',
  align: 'center',
  lineHeight: 1.2,
} as Layer;

function templateDocument(): ContentDocument {
  const base = createEmptyDocument({ aspectRatio: '1:1' });
  return {
    ...base,
    pages: [{ id: 'p1', name: '', layers: [PHOTO, HEADLINE] }],
    copy: { ...base.copy, caption: 'Hoy en la carta: …', hashtags: ['platodeldia'] },
  };
}

function templateRow(overrides: Partial<BrandDesignTemplateRow> = {}): BrandDesignTemplateRow {
  return {
    id: 'tpl-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    template_key: 'plato-del-dia',
    name: 'Plato del día',
    network: 'instagram',
    format: 'post',
    document: templateDocument() as unknown as BrandDesignTemplateRow['document'],
    analysis: {
      summary: 'Foto del plato a sangre con el titular centrado.',
      layers: [{ role: 'photo', position: 'fondo', description: '' }],
      typography: [],
      colors: [{ hex: '#111111', role: 'text', note: '' }],
      logo: { position: 'none' },
      photo: { type: 'plato', treatment: '' },
      tone: { description: 'Cercano', samples: [] },
      recurrence: { count: 12, reviewed: 30 },
      examples: [{ permalink: 'https://instagram.com/p/a' }, { permalink: 'https://instagram.com/p/b' }],
    },
    source: 'instagram_import',
    created_by: null,
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:00:00Z',
    ...overrides,
  };
}

function saveRpc() {
  const saved: { contentId: string; data: ContentDocument; note: string }[] = [];
  fake.rpc('save_content_version', (args) => {
    saved.push({
      contentId: args.p_content_id as string,
      data: args.p_data as ContentDocument,
      note: args.p_change_note as string,
    });
    const items = fake.rows('content_items');
    const row = items.find((i) => i.id === args.p_content_id)!;
    Object.assign(row, { current_version: (row.current_version as number) + 1, status: 'draft' });
    return {
      id: 'v-new',
      content_id: args.p_content_id,
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: row.current_version,
      schema_version: 4,
      data: args.p_data,
      change_note: args.p_change_note,
      restored_from: null,
      created_by: ME.id,
      created_at: '2026-11-21T09:00:00Z',
    };
  });
  return saved;
}

function idea(overrides: Partial<ContentItemRow> = {}): ContentItemRow {
  return {
    id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Idea sin diseño',
    network: 'instagram',
    format: 'post',
    status: 'idea',
    current_version: 0,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    ...overrides,
  };
}

function seed(
  role: { orgRole: OrgRole; brandRole?: BrandRole },
  templates: BrandDesignTemplateRow[] = [templateRow()],
) {
  seedWorkspace(role);
  fake.tables.brand_design_templates = templates;
  fake.tables.content_items = [];
  fake.tables.content_versions = [];
  fake.tables.media_assets = [];
}

describe('Crear desde una plantilla («¿Qué quieres crear?»)', () => {
  it('al tocar una plantilla se crea la pieza con su documento, sin pedir nombre ni «Crear»', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' });
    const saved = saveRpc();
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-empty-new'));
    const dialog = within(await screen.findByRole('dialog', { name: '¿Qué quieres crear?' }));
    await user.click(dialog.getByTestId('create-content-format-post'));

    const option = await dialog.findByTestId('create-content-template');
    expect(option).toHaveTextContent('Plato del día');
    expect(dialog.queryByTestId('create-content-title')).not.toBeInTheDocument();
    expect(dialog.queryByTestId('create-content-submit')).not.toBeInTheDocument();
    await user.click(option);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fake.rows('content_items')[0]).toMatchObject({ network: 'instagram', format: 'post' });
    expect(fake.rows('content_items')[0]!.title).toMatch(/^Publicación · /);
    expect(saved[0]!.note).toContain('Plato del día');
    // La foto queda como marcador y el texto y el pie vienen como guía.
    expect(saved[0]!.data.pages[0]!.layers.map((l) => l.id)).toEqual(['foto-plato', 'titular-plantilla']);
    // El pie de la plantilla es una indicación: llega como pie de ejemplo (en gris) y el pie de verdad, vacío.
    expect(saved[0]!.data.copy.caption).toBe('');
    expect(saved[0]!.data.copy.captionHint).toBe('Hoy en la carta: …');
  });

  it('la galería del formato empieza por «En blanco» y solo trae las plantillas de ese formato', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, [
      templateRow(),
      templateRow({ id: 'tpl-c', template_key: 'carrusel', name: 'Tres pasos', format: 'carousel' }),
    ]);
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-empty-new'));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('create-content-format-carousel'));
    const gallery = await dialog.findByTestId('create-content-templates');
    const tiles = await within(gallery).findAllByRole('button');
    expect(tiles[0]).toHaveTextContent('En blanco');
    expect(await dialog.findAllByTestId('create-content-template')).toHaveLength(1);
    expect(dialog.getByTestId('create-content-template')).toHaveTextContent('Tres pasos');
    // «Otro formato» vuelve a la lista de formatos.
    await user.click(dialog.getByTestId('create-content-back'));
    expect(await screen.findByRole('dialog', { name: '¿Qué quieres crear?' })).toBeInTheDocument();
  });

  it('quien solo lee no puede crear piezas, y por tanto tampoco desde una plantilla', async () => {
    seed({ orgRole: 'member', brandRole: 'viewer' });
    renderApp(CONTENT);
    await screen.findByRole('heading', { name: 'Contenidos' });
    expect(screen.queryByTestId('create-menu')).not.toBeInTheDocument();
  });
});

describe('Empezar desde una plantilla en el editor', () => {
  it('sustituye el diseño de una idea vacía por el de la plantilla en un paso que se puede deshacer', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, [
      templateRow(),
      // Otra proporción que Instagram no admite para una publicación: se ofrece y se adapta.
      templateRow({
        id: 'tpl-2',
        template_key: 'historia',
        name: 'Historia vertical',
        document: {
          ...templateDocument(),
          canvas: { ...templateDocument().canvas, aspectRatio: '9:16', width: 1080, height: 1920 },
        } as unknown as BrandDesignTemplateRow['document'],
      }),
    ]);
    fake.tables.content_items = [idea()];
    const { user } = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-layers', '0');

    await chooseEditorAction(user, 'editor-from-template');
    const dialog = within(await screen.findByRole('dialog'));
    const options = await dialog.findAllByTestId('template-option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Plato del día');
    expect(within(options[0]!).queryByTestId('template-adapts')).not.toBeInTheDocument();
    expect(within(options[1]!).getByTestId('template-adapts')).toBeInTheDocument();
    expect(dialog.queryByTestId('template-replace-warning')).not.toBeInTheDocument();
    expect(dialog.getByTestId('template-apply')).toBeDisabled();

    await user.click(options[0]!);
    expect(dialog.queryByTestId('template-adapt-notice')).not.toBeInTheDocument();
    expect(dialog.getByTestId('template-apply')).toHaveTextContent('Usar esta plantilla');
    await user.click(dialog.getByTestId('template-apply'));
    await waitFor(() =>
      expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-ids', 'foto-plato,titular-plantilla'),
    );
    expect(screen.getByTestId('editor-dirty')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Deshacer/ }));
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0'));
  });

  it('una plantilla de otra proporción se adapta con los anclajes y avisa de lo que cambia', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, [
      templateRow({
        id: 'tpl-2',
        template_key: 'historia',
        name: 'Historia vertical',
        document: {
          ...templateDocument(),
          canvas: { ...templateDocument().canvas, aspectRatio: '9:16', width: 1080, height: 1920 },
        } as unknown as BrandDesignTemplateRow['document'],
      }),
    ]);
    fake.tables.content_items = [idea()];
    const { user } = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    await chooseEditorAction(user, 'editor-from-template');
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(await dialog.findByTestId('template-option'));
    const notice = await dialog.findByTestId('template-adapt-notice');
    expect(notice).toHaveTextContent('La proporción pasa de 9:16 a 1:1');
    expect(notice).toHaveTextContent('anclaje');
    expect(dialog.getByTestId('template-apply')).toHaveTextContent('Adaptar y usar esta plantilla');
    await user.click(dialog.getByTestId('template-apply'));
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-ratio', '1:1'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-ids', 'foto-plato,titular-plantilla');
    // Un solo paso de deshacer.
    await user.click(screen.getByRole('button', { name: /Deshacer/ }));
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0'));
  });

  it('con la marca sin plantillas lo explica, y el solo lectura no ve el botón', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, []);
    fake.tables.content_items = [idea()];
    const first = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    await chooseEditorAction(first.user, 'editor-from-template');
    expect(await screen.findByTestId('template-empty')).toBeInTheDocument();
    first.unmount();

    seed({ orgRole: 'member', brandRole: 'viewer' }, []);
    fake.tables.content_items = [idea()];
    renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    // Sin permiso de edición no hay riel de cajones (ni, con él, «Plantillas»).
    expect(screen.queryByTestId('drawer-templates')).not.toBeInTheDocument();
  });
});

describe('Guardar el diseño como plantilla desde el editor', () => {
  function withDesign() {
    fake.tables.content_items = [idea({ status: 'draft', current_version: 1, title: 'Chuletón de otoño' })];
    fake.tables.content_versions = [
      {
        id: 'v-1',
        content_id: 'content-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        version: 1,
        schema_version: 5,
        data: templateDocument() as unknown as ContentVersionRowData,
        change_note: '',
        restored_from: null,
        created_by: ME.id,
        created_at: '2026-11-11T09:00:00Z',
      },
    ];
  }
  type ContentVersionRowData = import('@/lib/database.types').ContentVersionRow['data'];

  function templateRpcs() {
    const delivered: Record<string, unknown>[] = [];
    fake.rpc('deliver_design_templates', (args) => {
      const draft = (args.p_templates as Record<string, unknown>[])[0]!;
      delivered.push(draft);
      const row = {
        id: `tpl-${delivered.length}`,
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        template_key: draft.key,
        name: draft.name,
        network: draft.network,
        format: draft.format,
        document: draft.document,
        analysis: draft.analysis,
        source: draft.source,
        created_by: ME.id,
        created_at: '2026-11-21T09:00:00Z',
        updated_at: '2026-11-21T09:00:00Z',
      };
      fake.rows('brand_design_templates').push(row);
      return [row];
    });
    fake.rpc('delete_design_template', (args) => {
      fake.tables.brand_design_templates = fake
        .rows('brand_design_templates')
        .filter((row) => row.id !== args.p_template_id);
      return null;
    });
    return delivered;
  }

  it('pide un nombre (el de la pieza), guarda con origen «editor» y la plantilla aparece en «Desde una plantilla»', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, []);
    withDesign();
    const delivered = templateRpcs();
    const { user } = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');

    await chooseEditorAction(user, 'editor-save-template');
    const dialog = within(await screen.findByRole('dialog'));
    const name = dialog.getByTestId('template-name-input') as HTMLInputElement;
    expect(name.value).toBe('Chuletón de otoño');
    await user.clear(name);
    await user.type(name, 'Plato de la semana');
    await user.click(dialog.getByTestId('template-save'));

    await waitFor(() => expect(delivered).toHaveLength(1));
    expect(delivered[0]).toMatchObject({
      name: 'Plato de la semana',
      network: 'instagram',
      format: 'post',
      source: 'editor',
    });
    expect(String(delivered[0]!.key)).toMatch(/^editor-plato-de-la-semana-[a-z0-9]{5}$/);
    const { templateAnalysisSchema } = await import('@/features/brand/templates');
    expect(templateAnalysisSchema.safeParse(delivered[0]!.analysis).success).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await chooseEditorAction(user, 'editor-from-template');
    const picker = within(await screen.findByRole('dialog'));
    const option = await picker.findByTestId('template-option');
    expect(option).toHaveTextContent('Plato de la semana');
    expect(option).toHaveTextContent('Guardada aquí');
    // Sin «en N de M publicaciones»: no viene de publicaciones.
    expect(option).not.toHaveTextContent('publicaciones');
    expect(picker.queryByTestId('template-adapts')).not.toBeInTheDocument();
  });

  it('un diseño vacío no se puede guardar, y quien solo lee no ve la opción', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, []);
    fake.tables.content_items = [idea()];
    const first = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    await openMoreMenu(first.user, 'editor-more');
    expect(await screen.findByTestId('editor-save-template')).toHaveAttribute('aria-disabled', 'true');
    first.unmount();

    seed({ orgRole: 'member', brandRole: 'viewer' }, []);
    withDesign();
    const viewer = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    await openMoreMenu(viewer.user, 'editor-more');
    expect(screen.queryByTestId('editor-save-template')).not.toBeInTheDocument();
  });

  it('si el servidor lo rechaza (p. ej. tope de plantillas), lo dice y no cierra el diálogo', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, []);
    withDesign();
    fake.rpc('deliver_design_templates', () => {
      throw { message: 'La marca ya tiene 50 plantillas guardadas desde el editor: borra alguna antes' };
    });
    const { user } = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    await chooseEditorAction(user, 'editor-save-template');
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('template-save'));
    expect(await dialog.findByTestId('template-save-error')).toHaveTextContent('50 plantillas');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('las plantillas guardadas desde el editor se pueden borrar (con confirmación); las importadas no', async () => {
    seed({ orgRole: 'member', brandRole: 'editor' }, [
      templateRow(),
      templateRow({ id: 'tpl-mia', template_key: 'editor-mia-abcde', name: 'La mía', source: 'editor' }),
    ]);
    withDesign();
    templateRpcs();
    const { user } = renderApp(`${CONTENT}/content-1`);
    await screen.findByTestId('editor-title');
    await chooseEditorAction(user, 'editor-from-template');
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findAllByTestId('template-option')).toHaveLength(2);
    // Solo la propia tiene «Borrar».
    expect(dialog.getAllByTestId('template-delete')).toHaveLength(1);
    await user.click(dialog.getByTestId('template-delete'));
    await user.click(dialog.getByTestId('template-delete-confirm'));
    await waitFor(() => expect(dialog.getAllByTestId('template-option')).toHaveLength(1));
    expect(dialog.getByTestId('template-option')).toHaveTextContent('Plato del día');
  });
});
