import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { BACKGROUND_PROMPT_SUFFIX } from './copilot/plan';
import { createEmptyDocument, type ContentDocument } from './document';
import type { CanvasViewProps } from './editor/canvas/types';

// El editor ENTERO con una orden del copiloto que monta una pieza (docs/copiloto-voz.md §15):
// el plan pasa por lo que ya existe —`ai-media` para el precio y para generar el fondo, y la
// biblioteca de la marca para las fotos— y entra en el documento como un solo paso de deshacer.
// Supabase y las funciones están simulados: no se llama a ningún servicio.

vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => (
    <div
      data-testid="canvas-stub"
      data-layers={props.document.layers.length}
      data-background={props.document.canvas.backgroundColor}
      data-assets={props.document.layers
        .map((l) => (l.type === 'image' && l.source.kind === 'asset' ? l.source.assetId : l.type))
        .join(',')}
    >
      {props.footerEnd}
    </div>
  ),
}));

const EDITOR = `${BRAND_BASE}/contenidos/content-1`;
const GENERATED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REAL_PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const AI_PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const GENERATION = '55555555-5555-4555-8555-555555555555';
const ORDER = 'crea un fondo que parezca otoñal y pon los platos en el centro, con el título menú de otoño';
const PROMPT = 'Mesa de madera con hojas secas y luz cálida de otoño';

function asset(id: string, fileName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    kind: 'image',
    origin: 'uploaded',
    storage_path: `${ORG_ID}/${BRAND_ID}/media/${id}.jpg`,
    file_name: fileName,
    mime_type: 'image/jpeg',
    bytes: 100,
    width: 1200,
    height: 900,
    duration_ms: null,
    sha256: null,
    folder: '',
    tags: [],
    rights: {},
    provenance: {},
    created_by: ME.id,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
    ...extra,
  };
}

function seed(document: ContentDocument, profileColors: { name: string; hex: string; role: string }[] = []) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.brand_profiles = [
    {
      id: 'perfil-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      status: 'active',
      schema_version: 1,
      data: { visual: { colors: profileColors, fonts: [], logoAssetIds: [] } },
      provenance: {},
      change_note: '',
      created_by: ME.id,
      created_at: '2026-11-01T10:00:00Z',
    },
  ];
  fake.tables.content_items = [
    {
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
    },
  ];
  fake.tables.content_versions = [
    {
      id: 'v-1',
      content_id: 'content-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      schema_version: 1,
      data: document,
      change_note: '',
      restored_from: null,
      created_by: ME.id,
      created_at: '2026-11-11T09:00:00Z',
    },
  ];
  // La biblioteca: una foto real de un plato y una imagen generada con IA que también casa con «platos».
  fake.tables.media_assets = [
    asset(REAL_PHOTO, 'crema-calabaza.jpg', { tags: ['plato', 'otoño'] }),
    asset(AI_PHOTO, 'plato-inventado.png', { origin: 'generated', tags: ['plato'], provenance: { type: 'ai_generation' } }),
  ];
}

/** La IA del copiloto, simulada: devuelve los pasos de plan de la orden. */
function fakeCopilot() {
  fake.fn('ai-generate', (body) => ({
    status: 200,
    body: {
      action: (body as { action: string }).action,
      generationId: GENERATION,
      operations: [
        { op: 'generate_background', prompt: PROMPT },
        { op: 'find_photos', query: 'platos de otoño', count: 3 },
        { op: 'place_photos', layout: 'center', cutout: false, on: true },
        { op: 'add_text', text: 'menú de otoño', style: 'title', position: 'top' },
      ],
      discarded: [],
      note: '',
    },
  }));
}

/** `ai-media` simulada: precio (0,02 créditos) y una imagen que queda en la biblioteca. */
function fakeAiMedia() {
  fake.fn('ai-media', (body) => {
    const { action } = body as { action: string };
    if (action === 'image.models') return { status: 200, body: { action, models: [] } };
    if (action === 'image.estimate') {
      return { status: 200, body: { action, model: 'simulated-image:simulado-e2e', costMicros: 20_000, size: { width: 896, height: 1152 } } };
    }
    fake.tables.media_assets = [
      ...(fake.tables.media_assets ?? []),
      asset(GENERATED, 'IA · Mesa de madera.png', {
        origin: 'generated',
        folder: 'IA',
        provenance: { type: 'ai_generation', generation_id: 'g-1', prompt: PROMPT },
      }),
    ];
    return {
      status: 200,
      body: {
        action: 'image.generate',
        status: 'completed',
        generationId: 'g-1',
        model: 'simulated-image:simulado-e2e',
        costMicros: 20_000,
        estimatedCostMicros: 20_000,
        asset: { id: GENERATED, path: 'x' },
        dataHandling: {},
      },
    };
  });
}

const generated = () =>
  fake.callsTo('ai-media', 'function').filter((call) => (call.payload as { action: string }).action === 'image.generate');

async function openCopilot() {
  const app = renderApp(EDITOR);
  await screen.findByTestId('editor-title');
  await screen.findByTestId('canvas-stub');
  await app.user.click(await screen.findByTestId('copilot-open'));
  await screen.findByTestId('copilot-panel');
  return app;
}

async function planReady() {
  await waitFor(() => expect(screen.getByTestId('copilot-plan')).toHaveAttribute('data-phase', 'ready'));
  return screen.getByTestId('copilot-plan');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Editor: orden del copiloto que monta una pieza', () => {
  it('enseña el plan con el precio de `ai-media`, no gasta hasta el «sí» y deja fondo, foto real y titular en un solo paso de deshacer', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    vi.stubEnv('VITE_AI_VOICE_COPILOT_ENABLED', 'true');
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fakeCopilot();
    fakeAiMedia();
    seed(createEmptyDocument({ aspectRatio: '4:5' }));
    const { user } = await openCopilot();

    await user.type(screen.getByTestId('copilot-text-input'), `${ORDER}{Enter}`);
    const card = await planReady();
    // El precio es el de `image.estimate` (sin reservar nada) y la foto, la real de la biblioteca.
    expect(within(card).getByTestId('copilot-plan-cost')).toHaveTextContent('Coste máximo: 0,02 créditos');
    expect(card).toHaveTextContent('Encontrada: «crema-calabaza.jpg»');
    expect(card).not.toHaveTextContent('plato-inventado.png');
    expect(within(card).getByTestId('copilot-plan-detail')).toHaveTextContent(`${PROMPT}. ${BACKGROUND_PROMPT_SUFFIX}`);
    // Sobre un fondo generado las fotos irían recortadas aunque la IA no lo pida (`cutout: false`); jsdom no
    // puede quitar el fondo (no tiene procesos en segundo plano): se dice y no se ofrece el interruptor.
    expect(card).toHaveTextContent('Aquí no se puede quitar el fondo de las fotos: se colocan tal cual.');
    expect(card).toHaveTextContent('Colocar la foto en el centro, entera, con su fondo, con sombra suave');
    expect(within(card).queryByTestId('copilot-plan-cutout')).not.toBeInTheDocument();
    const estimates = fake.callsTo('ai-media', 'function').filter((call) => (call.payload as { action: string }).action === 'image.estimate');
    expect(estimates[0]!.payload).toMatchObject({ brandId: BRAND_ID, input: { prompt: '', aspectRatio: '4:5' } });
    // Nada generado ni cambiado todavía.
    expect(generated()).toHaveLength(0);
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0');

    await user.click(within(card).getByTestId('copilot-plan-confirm'));
    // Del fondo al frente: el fondo generado, la foto real y el titular.
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-assets', `${GENERATED},${REAL_PHOTO},text`));
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    // Una sola generación, con la indicación que se enseñó (coletilla incluida) y la proporción del lienzo.
    expect(generated()).toHaveLength(1);
    expect(generated()[0]!.payload).toMatchObject({
      action: 'image.generate',
      brandId: BRAND_ID,
      input: { prompt: `${PROMPT}. ${BACKGROUND_PROMPT_SUFFIX}`, aspectRatio: '4:5' },
    });
    const order = screen.getAllByTestId('copilot-order').find((item) => item.textContent?.includes('crea un fondo'))!;
    expect(order).toHaveAttribute('data-status', 'applied');
    expect(within(order).getByTestId('copilot-notes')).toHaveTextContent('En la biblioteca queda lo creado: el fondo «IA · Mesa de madera.png».');
    // El tono del fondo nuevo no se puede medir aquí (el almacenamiento simulado no firma direcciones):
    // no se adivina; el titular lleva un contorno que se lee sobre cualquier fondo, y se dice.
    expect(within(order).getByTestId('copilot-changes')).toHaveTextContent(
      'Texto «Menú de otoño» con contorno: no he podido medir el tono del fondo nuevo y así se lee sobre cualquiera',
    );

    // La pieza lleva la marca de contenido generado con IA, por el fondo (se ve en «Compartir»).
    await user.click(screen.getByTestId('editor-share'));
    expect(await screen.findByTestId('editor-ai-label')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Compartir' })).not.toBeInTheDocument());

    // Un solo «Deshacer» lo quita todo; el fondo generado sigue en la biblioteca.
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0');
    expect((fake.tables.media_assets ?? []).some((row) => row.id === GENERATED)).toBe(true);
  });

  it('sin imagen con IA en este despliegue, el plan no ofrece generar: propone el color de fondo de la marca y no llama a `ai-media`', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    vi.stubEnv('VITE_AI_VOICE_COPILOT_ENABLED', 'true');
    fakeCopilot();
    fakeAiMedia();
    seed(createEmptyDocument({ aspectRatio: '4:5' }), [
      { name: 'Granate', hex: '#A3122A', role: 'principal' },
      { name: 'Crema', hex: '#F4E9D8', role: 'fondo' },
    ]);
    const { user } = await openCopilot();

    await user.type(screen.getByTestId('copilot-text-input'), `${ORDER}{Enter}`);
    const card = await planReady();
    expect(card).toHaveTextContent('Poner de fondo un color liso de la marca (#F4E9D8)');
    expect(card).toHaveTextContent('La imagen con IA no está configurada. En su lugar, un color liso: no se genera nada.');
    expect(card).not.toHaveTextContent('Crear el fondo con IA');
    expect(within(card).getByTestId('copilot-plan-cost')).toHaveTextContent('Coste: nada. Este plan no usa IA de pago.');

    await user.click(within(card).getByTestId('copilot-plan-confirm'));
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-assets', `${REAL_PHOTO},text`));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-background', '#F4E9D8');
    expect(fake.callsTo('ai-media', 'function')).toHaveLength(0);
    expect(screen.queryByTestId('editor-ai-label')).not.toBeInTheDocument();
  });
});
