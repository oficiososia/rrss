import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, brandRow, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { createEmptyDocument, type ContentDocument } from './document';
import type { CanvasViewProps } from './editor/canvas/types';
import type { UserEvent } from '@testing-library/user-event';

// El editor con la generación de imágenes con IA (función `ai-media`): ya no es
// un botón suelto de la barra; está en el cajón «Subidas» («Crear con IA», el
// del selector de la biblioteca), solo con VITE_AI_IMAGE_ENABLED. Se ve el
// coste antes de generar; la imagen entra como capa (se deshace) y queda en la
// biblioteca.

vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => (
    <div
      data-testid="canvas-stub"
      data-layers={props.document.layers.length}
      data-assets={props.document.layers
        .map((l) => (l.type === 'image' && l.source.kind === 'asset' ? l.source.assetId : ''))
        .join(',')}
    />
  ),
}));

const EDITOR = `${BRAND_BASE}/contenidos/content-1`;
const MODELS = [
  {
    id: 'simulated-image:simulado-e2e',
    displayName: 'Imagen simulada (pruebas locales)',
    delivery: 'sync',
    dataRegion: 'eu',
    euProcessing: true,
    trainsOnInputs: 'no',
    untestedAdapter: true,
    default: true,
  },
  {
    id: 'simulated-image-async:simulado-e2e-asincrono',
    displayName: 'Imagen simulada asíncrona',
    delivery: 'async',
    dataRegion: 'eu',
    euProcessing: true,
    trainsOnInputs: 'no',
    untestedAdapter: true,
    default: false,
  },
];

function seed(document: ContentDocument) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.content_items = [
    {
      id: 'content-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      title: 'Terraza',
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
}

function generatedAsset(id: string, generationId: string) {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    kind: 'image',
    origin: 'generated',
    storage_path: `${ORG_ID}/${BRAND_ID}/ia/${generationId}-0.png`,
    file_name: 'IA · Terraza.png',
    mime_type: 'image/png',
    bytes: 100,
    width: 1024,
    height: 1024,
    duration_ms: null,
    sha256: null,
    folder: 'IA',
    tags: ['ia'],
    rights: {},
    provenance: { type: 'ai_generation', generation_id: generationId, prompt: 'Terraza' },
    created_by: ME.id,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
  };
}

async function openEditor(document = createEmptyDocument({ aspectRatio: '4:5' })) {
  seed(document);
  const app = renderApp(EDITOR);
  await screen.findByTestId('editor-title');
  // El lienzo sale cuando se han leído (y cargado) las tipografías de la marca.
  await screen.findByTestId('canvas-stub');
  return app;
}

/** `ai-media` simulada: modelos, estimación y lo que se pida para generar. */
function fakeAiMedia(generate: (input: Record<string, unknown>) => { status: number; body: unknown }) {
  fake.fn('ai-media', (body) => {
    const { action, input } = body as { action: string; input: Record<string, unknown> };
    if (action === 'image.models') return { status: 200, body: { action, models: MODELS } };
    if (action === 'image.estimate') {
      return {
        status: 200,
        body: { action, model: input.model, costMicros: 20_000, size: { width: 896, height: 1152 } },
      };
    }
    return generate(input);
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Cajón «Subidas» → «Crear con IA». */
async function openAiImage(user: UserEvent) {
  await user.click(screen.getByTestId('drawer-uploads'));
  await user.click(await screen.findByTestId('picker-ai'));
  return screen.findByRole('dialog');
}

describe('Editor: imagen con IA en modo agencia', () => {
  it('si el servidor la cierra a la marca (modo agencia), no sale «Crear con IA»', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fake.fn('ai-media', (body) => {
      const { action } = body as { action: string };
      return { status: 200, body: { action, models: [], agencyMode: true } };
    });
    seed(createEmptyDocument({ aspectRatio: '4:5' }));
    fake.tables.brands = [brandRow({ ai_mode: 'agency' })];
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await user.click(screen.getByTestId('drawer-uploads'));
    expect(await screen.findByTestId('picker-upload')).toBeInTheDocument();
    expect(screen.queryByTestId('picker-ai')).not.toBeInTheDocument();
  });

  it('si el servidor la deja usar (personal de la agencia), «Crear con IA» sale', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fakeAiMedia(() => ({ status: 200, body: {} }));
    seed(createEmptyDocument({ aspectRatio: '4:5' }));
    fake.tables.brands = [brandRow({ ai_mode: 'agency' })];
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await user.click(screen.getByTestId('drawer-uploads'));
    expect(await screen.findByTestId('picker-ai')).toBeInTheDocument();
  });
});

describe('Editor: imagen con IA', () => {
  it('sin VITE_AI_IMAGE_ENABLED no aparece nada (y la barra no tiene un «Con IA» suelto)', async () => {
    const { user } = await openEditor();
    expect(screen.queryByTestId('add-image-ai')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('drawer-uploads'));
    expect(await screen.findByTestId('picker-upload')).toBeInTheDocument();
    expect(screen.queryByTestId('picker-ai')).not.toBeInTheDocument();
  });

  it('enseña el coste antes de generar, genera con la proporción del lienzo y añade la capa (que se deshace)', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fakeAiMedia(() => {
      fake.tables.media_assets = [generatedAsset('asset-ia-1', 'g-1')];
      return {
        status: 200,
        body: {
          action: 'image.generate',
          status: 'completed',
          generationId: 'g-1',
          model: 'simulated-image:simulado-e2e',
          costMicros: 20_000,
          estimatedCostMicros: 20_000,
          asset: { id: 'asset-ia-1', path: 'x' },
          dataHandling: {},
        },
      };
    });
    const { user } = await openEditor();
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0');

    const dialog = await openAiImage(user);
    expect(await within(dialog).findByTestId('ai-image-estimate')).toHaveTextContent('Coste máximo: 0,02');
    expect(within(dialog).getByTestId('ai-image-ratio')).toHaveValue('4:5');
    expect(within(dialog).getByTestId('ai-image-untested')).toBeInTheDocument();
    expect(within(dialog).getByTestId('ai-image-generate')).toBeDisabled();

    await user.type(within(dialog).getByTestId('ai-image-prompt'), 'Terraza al atardecer');
    await user.click(within(dialog).getByTestId('ai-image-generate'));

    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '1'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-assets', 'asset-ia-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // La pieza pasa a llevar la marca de contenido generado con IA (se ve en «Compartir»).
    await user.click(screen.getByTestId('editor-share'));
    expect(await screen.findByTestId('editor-ai-label')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const calls = fake.callsTo('ai-media', 'function');
    expect(calls[calls.length - 1]!.payload).toMatchObject({
      action: 'image.generate',
      brandId: BRAND_ID,
      input: { prompt: 'Terraza al atardecer', aspectRatio: '4:5', model: 'simulated-image:simulado-e2e' },
    });

    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0');
  });

  it('asíncrono: sigue la generación y, al terminar, añade la imagen', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fakeAiMedia(() => {
      // Cuando la interfaz pregunte, la generación ya habrá terminado.
      fake.tables.ai_generations = [
        {
          id: 'g-2',
          brand_id: BRAND_ID,
          organization_id: ORG_ID,
          status: 'succeeded',
          error_code: null,
          cost_micros: 20_000,
          output: {
            assets: [{ kind: 'image', path: 'x', mime_type: 'image/png', bytes: 100, asset_id: 'asset-ia-2' }],
          },
        },
      ];
      fake.tables.media_assets = [generatedAsset('asset-ia-2', 'g-2')];
      return {
        status: 202,
        body: {
          action: 'image.generate',
          status: 'pending',
          generationId: 'g-2',
          jobId: 'job-1',
          model: 'simulated-image-async:simulado-e2e-asincrono',
          estimatedCostMicros: 20_000,
          dataHandling: {},
        },
      };
    });
    const { user } = await openEditor();
    const dialog = await openAiImage(user);
    await within(dialog).findByTestId('ai-image-estimate');
    await user.selectOptions(
      within(dialog).getByTestId('ai-image-model'),
      'simulated-image-async:simulado-e2e-asincrono',
    );
    await user.type(within(dialog).getByTestId('ai-image-prompt'), 'Cócteles');
    await user.click(within(dialog).getByTestId('ai-image-generate'));

    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-assets', 'asset-ia-2'));
  });

  it('con el cupo agotado lo explica y no añade nada', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fakeAiMedia(() => ({
      status: 402,
      body: { error: { code: 'quota_exhausted', message: 'agotado', retryable: false } },
    }));
    const { user } = await openEditor();
    const dialog = await openAiImage(user);
    await within(dialog).findByTestId('ai-image-estimate');
    await user.type(within(dialog).getByTestId('ai-image-prompt'), 'Tapas');
    await user.click(within(dialog).getByTestId('ai-image-generate'));
    expect(await within(dialog).findByTestId('ai-quota-error')).toHaveTextContent(
      'El cupo de IA de este mes está agotado',
    );
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '0');
  });

  it('sin modelo configurado en el servidor, lo dice con el mensaje de siempre', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fake.fn('ai-media', () => ({
      status: 503,
      body: { error: { code: 'not_configured', message: 'x', retryable: false } },
    }));
    const { user } = await openEditor();
    const dialog = await openAiImage(user);
    expect(await within(dialog).findByTestId('ai-error')).toHaveTextContent('falta configurarla en la plataforma');
  });
});
