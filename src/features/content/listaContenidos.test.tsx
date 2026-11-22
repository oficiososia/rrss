import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandDesignTemplateRow, ContentItemRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { createEmptyDocument, DOCUMENT_SCHEMA_VERSION } from './document';
import { PieceThumbView } from './lista/PieceThumb';

// Lista de Contenidos: miniaturas, acciones rápidas de la tarjeta y pantalla vacía con plantillas.

const CONTENT = `${BRAND_BASE}/contenidos`;

function item(patch: Partial<ContentItemRow> = {}): ContentItemRow {
  return {
    id: 'c1',
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
    ...patch,
  };
}

const doc = createEmptyDocument({ aspectRatio: '4:5' });

function version(contentId: string, data: unknown = doc) {
  return {
    id: `v-${contentId}`,
    content_id: contentId,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    schema_version: DOCUMENT_SCHEMA_VERSION,
    data,
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  };
}

function seed(items: ContentItemRow[]) {
  seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
  fake.tables.content_items = items;
  fake.tables.content_versions = items.filter((i) => i.current_version > 0).map((i) => version(i.id));
  fake.tables.scheduled_publications = [];
  fake.tables.media_assets = [];
  fake.tables.campaign_contents = [];
  fake.tables.campaigns = [];
  fake.tables.brand_design_templates = [];
}

describe('Miniaturas de las piezas', () => {
  it('una pieza con diseño enseña su primera página; una sin diseño, el icono del formato', async () => {
    seed([item(), item({ id: 'c2', title: 'Solo idea', status: 'draft', current_version: 0 })]);
    renderApp(CONTENT);
    await screen.findByTestId('content-list');
    const cards = await screen.findAllByTestId('content-card');
    expect(cards).toHaveLength(2);
    const withDesign = cards.find((c) => c.textContent?.includes('Menú de otoño'))!;
    const withoutDesign = cards.find((c) => c.textContent?.includes('Solo idea'))!;
    // En el navegador de pruebas no hay lienzo: se cae al esquema de capas, nunca a una imagen inventada.
    await waitFor(() => expect(within(withDesign).getByTestId('piece-thumb')).toHaveAttribute('data-thumb', 'sketch'));
    expect(within(withoutDesign).getByTestId('piece-thumb')).toHaveAttribute('data-thumb', 'none');
    expect(withoutDesign).toHaveTextContent('Vacía');
  });

  it('la imagen real sustituye al icono y es decorativa', () => {
    render(<PieceThumbView thumb={{ kind: 'image', url: 'https://x.test/a.jpg' }} format="reel" />);
    expect(screen.getByTestId('piece-thumb')).toHaveAttribute('data-thumb', 'image');
    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });
});

describe('Acciones rápidas de la tarjeta', () => {
  it('duplica una pieza con su diseño y la copia nace como borrador sin fecha', async () => {
    seed([item()]);
    const saved: Record<string, unknown>[] = [];
    fake.rpc('save_content_version', (args) => {
      saved.push(args);
      return version(String(args.p_content_id));
    });
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-duplicate'));
    await waitFor(() => expect(saved).toHaveLength(1));
    const inserted = fake.callsTo('content_items', 'insert')[0]!.payload as { title: string; format: string };
    expect(inserted.title).toBe('Copia de Menú de otoño');
    expect(inserted.format).toBe('post');
    expect(saved[0]).toMatchObject({ p_schema_version: DOCUMENT_SCHEMA_VERSION });
  });

  it('«Programar» solo sale en lo aprobado y sin fecha', async () => {
    seed([item({ id: 'a', title: 'Aprobada', status: 'approved' }), item({ id: 'b', title: 'En borrador' })]);
    const { user } = renderApp(CONTENT);
    await screen.findByTestId('content-list');
    // Se abre en «En preparación»: el borrador no se puede programar.
    expect(screen.queryByTestId('content-schedule')).toBeNull();
    await user.click(screen.getByTestId('content-tab-ready'));
    expect(await screen.findByTestId('content-schedule')).toHaveAccessibleName('Programar «Aprobada»');
  });

  it('archivar una pieza ofrece deshacer', async () => {
    seed([item()]);
    fake.rpc('archive_content_item', (args) => {
      const row = fake.rows('content_items').find((r) => r.id === args.p_content_id)!;
      row.archived_at = args.p_archived ? '2026-11-22T10:00:00Z' : null;
      return row;
    });
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-archive'));
    await waitFor(() => expect(fake.callsTo('archive_content_item', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('archive_content_item', 'rpc')[0]!.payload).toMatchObject({ p_archived: true });
  });
});

describe('Lista de contenidos vacía', () => {
  it('invita a «Nueva idea» y destaca las plantillas de la marca', async () => {
    seed([]);
    fake.tables.brand_design_templates = [
      {
        id: 'tpl-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        template_key: 'plato',
        name: 'Plato del día',
        network: 'instagram',
        format: 'post',
        document: doc as unknown as BrandDesignTemplateRow['document'],
        analysis: {},
        source: 'manual',
        created_by: null,
        created_at: '2026-11-20T09:00:00Z',
        updated_at: '2026-11-20T09:00:00Z',
      } as BrandDesignTemplateRow,
    ];
    const { user } = renderApp(CONTENT);
    expect(await screen.findByText('Todavía no hay contenidos')).toBeInTheDocument();
    expect(screen.getByTestId('content-empty-new')).toBeInTheDocument();
    const featured = await screen.findByTestId('featured-template');
    expect(featured).toHaveTextContent('Plato del día');
    await user.click(featured);
    const dialog = within(await screen.findByRole('dialog'));
    // Con la plantilla ya elegida: el formato es el suyo y no se puede cambiar.
    expect(await dialog.findByTestId('create-content-templates')).toBeInTheDocument();
    expect(dialog.getByTestId('create-content-format-post').querySelector('input')).toBeDisabled();
  });
});

describe('Nueva idea con formato Reel', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const reelTemplateRow = {
    id: 'rt-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    template_key: 'asi-se-hace',
    name: 'Así se hace',
    source: 'catalog',
    document: {
      kind: 'rrss.reel-template',
      schemaVersion: 1,
      purpose: 'Enseñar un producto con el resultado como gancho.',
      whenToUse: 'Para el producto estrella.',
      material: '2 fotos o clips: resultado y cierre.',
      style: { id: 'corte-ritmico' },
      slots: [
        { id: 'resultado', label: 'Resultado', kind: 'any', seconds: 1.8 },
        { id: 'final', label: 'Cierre', kind: 'any', seconds: 3 },
      ],
      texts: [],
    },
  };

  it('ya no dice que el vídeo llegará más adelante y ofrece las plantillas de reel de la marca', async () => {
    seed([]);
    fake.tables.brand_reel_templates = [reelTemplateRow];
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-empty-new'));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('create-content-format-reel'));
    expect(dialog.queryByText(/llegará más adelante/)).toBeNull();
    await user.click(await dialog.findByTestId('create-content-from-template'));
    const card = await dialog.findByTestId('create-content-reel-template');
    expect(card).toHaveTextContent('Así se hace');
    expect(dialog.getByTestId('reel-template-sample')).toBeInTheDocument();
    // Sin elegir ninguna, no se crea.
    await user.click(dialog.getByTestId('create-content-submit'));
    expect(await dialog.findByText(/Elige una plantilla/)).toBeInTheDocument();
    await user.click(card);
    await user.click(dialog.getByTestId('create-content-submit'));
    await waitFor(() => expect(fake.callsTo('content_items', 'insert')).toHaveLength(1));
    expect(fake.callsTo('content_items', 'insert')[0]!.payload).toMatchObject({ format: 'reel' });
    await waitFor(() => expect(window.location.search).toContain('plantilla=asi-se-hace'));
  });

  it('ofrece «Hacer un reel como este» con su coste como parte del cupo si el servidor puede', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    vi.stubEnv('VITE_REEL_LIKE_ENABLED', 'true');
    seed([]);
    // El cupo solo lo leen los administradores de la organización.
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.brand_reel_templates = [];
    fake.tables.usage_quotas = [
      { organization_id: ORG_ID, metric: 'ai_cost_micros', limit_value: 5_200_000, period: 'month' },
    ];
    fake.fn('ai-reel-like', () => ({
      status: 200,
      body: {
        available: true,
        speechAvailable: false,
        estimate: { textMicros: 40_000, speechMicros: 12_000, speechMicrosPerSecond: 100, maxMicros: 52_000 },
        limits: { maxSeconds: 180, maxUploadBytes: 50 * 1024 * 1024, maxSpeechSeconds: 120, maxFrames: 12 },
      },
    }));
    const { user } = renderApp(CONTENT);
    await user.click(await screen.findByTestId('content-empty-new'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByTestId('create-content-reel-like')).toBeNull();
    await user.click(dialog.getByTestId('create-content-format-reel'));
    const like = await dialog.findByTestId('create-content-reel-like');
    expect(like).toHaveAttribute('href', `${BRAND_BASE}/biblioteca/reels/como-este`);
    await waitFor(() => expect(like).toHaveTextContent('1 % del cupo de este mes'));
    expect(like).not.toHaveTextContent('créditos');
  });
});
