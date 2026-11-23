import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as libraryApi from '@/features/library/api';
import type { ContentItemRow, ContentVersionRow, MediaAssetRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { assetRow, canvas, EDITOR as PIECE_EDITOR, frame, seedPiece } from '@/features/content/editorTestKit';
import { isAppDesign } from './filters';

// Subir, soltar y «Crear con IA» dentro de los selectores de material (editor de reels:
// «Añadir», «Sustituir», el material por planos de una plantilla; editor de piezas: «Poner
// foto», «Sustituir la foto»), y el selector de material de reels sin piezas ya diseñadas.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
  default: (await import('@/features/content/editorTestCanvas')).CanvasStub,
}));

const uploadAsset = vi.fn<typeof libraryApi.uploadAsset>();
const REEL_EDITOR = `${BRAND_BASE}/contenidos/reel-1`;
const path = (name: string) => `${ORG_ID}/${BRAND_ID}/media/${name}`;
const NEW_PHOTO = '44444444-4444-4444-8444-444444444444';

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerType = 'mouse';
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});
beforeEach(() => {
  uploadAsset.mockReset();
  vi.spyOn(libraryApi, 'uploadAsset').mockImplementation(uploadAsset);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const media = (id: string, fileName: string, overrides: Partial<MediaAssetRow> = {}) =>
  assetRow(id, { storage_path: path(fileName), file_name: fileName, ...overrides });

function seedReel(assets: MediaAssetRow[]) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.content_items = [
    {
      id: 'reel-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      title: 'Presentación del equipo',
      network: 'instagram',
      format: 'reel',
      status: 'draft',
      current_version: 1,
      archived_at: null,
      created_by: ME.id,
      created_at: '2026-11-21T09:00:00Z',
      updated_at: '2026-11-21T09:00:00Z',
    } as ContentItemRow,
  ];
  fake.tables.content_versions = [
    {
      id: 'v-1',
      content_id: 'reel-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      schema_version: 2,
      data: {
        kind: 'reel',
        template: { id: 'fundido-suave' },
        plan: { version: 2, clips: [{ id: 'c1', type: 'photo', path: path('local.jpg'), seconds: 2 }], texts: [] },
      },
      change_note: '',
      restored_from: null,
      created_by: ME.id,
      created_at: '2026-11-21T09:00:00Z',
    } as unknown as ContentVersionRow,
  ];
  fake.tables.media_assets = [media('11111111-0000-4000-8000-000000000001', 'local.jpg'), ...assets];
  fake.tables.jobs = [];
  fake.tables.reel_drafts = [];
  fake.tables.brand_fonts = [];
  fake.rpc('save_reel_draft', () => '2026-11-22T12:00:00Z');
  fake.rpc('brand_reel_font_info', () => []);
}

/** `ai-media` simulada: un modelo, el coste y una imagen que se crea al momento. */
function fakeAiMedia(newRow: MediaAssetRow) {
  fake.fn('ai-media', (body) => {
    const { action, input } = body as { action: string; input: Record<string, unknown> };
    if (action === 'image.models') {
      return {
        status: 200,
        body: {
          action,
          models: [
            {
              id: 'simulated-image:simulado-e2e',
              displayName: 'Imagen simulada',
              delivery: 'sync',
              dataRegion: 'eu',
              euProcessing: true,
              trainsOnInputs: 'no',
              default: true,
            },
          ],
        },
      };
    }
    if (action === 'image.estimate') {
      return { status: 200, body: { action, model: input.model, costMicros: 20_000, size: { width: 768, height: 1344 } } };
    }
    fake.tables.media_assets = [...fake.rows('media_assets'), newRow];
    return {
      status: 200,
      body: {
        action: 'image.generate',
        status: 'completed',
        generationId: 'g-1',
        model: 'simulated-image:simulado-e2e',
        costMicros: 20_000,
        estimatedCostMicros: 20_000,
        asset: { id: newRow.id, path: newRow.storage_path },
        dataHandling: {},
      },
    };
  });
}

async function openAdd() {
  const app = renderApp(REEL_EDITOR);
  await screen.findByTestId('reel-editor');
  fireEvent.click(screen.getByTestId('reel-bar-add'));
  const dialog = await screen.findByRole('dialog');
  return { ...app, dialog };
}

/** Nombres de las miniaturas, en orden (del nombre accesible: «Elegir «x»» o «Quitar «x»»). */
const optionNames = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByTestId('reel-media-option')
    .map((b) => /«(.*)»/.exec(b.getAttribute('aria-label') ?? '')?.[1]);

describe('selector de material del editor de reels', () => {
  it('por defecto no enseña lo ya diseñado o montado, sí lo hecho con IA y las ediciones; un interruptor lo enseña', async () => {
    seedReel([
      media('22222222-0000-4000-8000-000000000001', 'asi-es-energym-1.jpg', {
        folder: 'Exportaciones',
        provenance: { type: 'export', content_id: 'c', version: 1 },
      }),
      media('22222222-0000-4000-8000-000000000002', 'reel-fundido.mp4', {
        kind: 'video',
        mime_type: 'video/mp4',
        folder: 'Reels',
        provenance: { type: 'media_job', kind: 'media.reel.template' },
      }),
      media('22222222-0000-4000-8000-000000000003', 'portada.jpg', { folder: 'Reels', provenance: { role: 'cover' } }),
      media('22222222-0000-4000-8000-000000000004', 'terraza-ia.png', { provenance: { type: 'ai_generation' } }),
      media('22222222-0000-4000-8000-000000000005', 'Sin fondo · plato.png', {
        provenance: { type: 'photo_edit', steps: [{ kind: 'remove_background' }] },
      }),
    ]);
    const { dialog } = await openAdd();
    await waitFor(() => expect(optionNames(dialog)).toHaveLength(3));
    expect(optionNames(dialog).sort()).toEqual(['Sin fondo · plato.png', 'local.jpg', 'terraza-ia.png']);
    const toggle = within(dialog).getByTestId('reel-media-designs');
    expect(toggle).toHaveTextContent('Ver también diseños y montajes (3)');
    fireEvent.click(within(toggle).getByRole('checkbox'));
    expect(optionNames(dialog)).toHaveLength(6);
  });

  it('«Subir» está a la vista; lo subido sale el primero, con su progreso, y ya elegido', async () => {
    seedReel([]);
    const row = media(NEW_PHOTO, 'equipo.jpg');
    uploadAsset.mockImplementation(async (input) => {
      input.onProgress?.(50);
      return row;
    });
    const { dialog } = await openAdd();
    expect(within(dialog).getByTestId('picker-upload')).toHaveTextContent('Subir');
    const file = new File(['x'], 'equipo.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(dialog).getByTestId('picker-upload-input'), { target: { files: [file] } });
    await waitFor(() => expect(within(dialog).getByTestId('upload-item-done')).toHaveTextContent('equipo.jpg'));
    expect(uploadAsset).toHaveBeenCalledWith(expect.objectContaining({ brandId: BRAND_ID, file }));
    expect(optionNames(dialog)[0]).toBe('equipo.jpg');
    expect(within(dialog).getAllByTestId('reel-media-option')[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByTestId('reel-media-count')).toHaveTextContent('1 elegida');
  });

  it('se pueden soltar archivos del escritorio sobre el diálogo; lo que no es foto ni vídeo se dice y no se sube', async () => {
    seedReel([]);
    uploadAsset.mockResolvedValue(media(NEW_PHOTO, 'soltada.jpg'));
    const { dialog } = await openAdd();
    const zone = within(dialog).getByTestId('picker-dropzone');
    const photo = new File(['x'], 'soltada.jpg', { type: 'image/jpeg' });
    const doc = new File(['x'], 'carta.pdf', { type: 'application/pdf' });
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [photo, doc] } });
    expect(zone).toHaveAttribute('data-dragging', 'true');
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [photo, doc] } });
    expect(await screen.findByText('1 de los archivos no son fotos o vídeos: no se suben.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByTestId('reel-media-count')).toHaveTextContent('1 elegida'));
    expect(uploadAsset).toHaveBeenCalledTimes(1);
  });

  it('un error de subida se dice claro, con «Reintentar»', async () => {
    seedReel([]);
    uploadAsset.mockRejectedValue({ statusCode: '413', message: 'Payload too large' });
    const { dialog } = await openAdd();
    fireEvent.change(within(dialog).getByTestId('picker-upload-input'), {
      target: { files: [new File(['x'], 'enorme.jpg', { type: 'image/jpeg' })] },
    });
    const item = await within(dialog).findByTestId('upload-item-error');
    expect(item).toHaveTextContent('El archivo supera el tamaño máximo permitido.');
    expect(within(item).getByTestId('upload-retry')).toBeInTheDocument();
  });

  it('«Crear con IA» abre el diálogo de siempre en 9:16, con el coste antes, y deja la imagen elegida', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    seedReel([]);
    fakeAiMedia(media(NEW_PHOTO, 'ia-equipo.png', { provenance: { type: 'ai_generation' } }));
    const { dialog, user } = await openAdd();
    await user.click(within(dialog).getByTestId('picker-ai'));
    const ai = await screen.findByRole('dialog', { name: 'Generar imagen con IA' });
    expect(within(ai).getByTestId('ai-image-ratio')).toHaveValue('9:16');
    expect(await within(ai).findByTestId('ai-image-estimate')).toHaveTextContent('Coste máximo: 0,02');
    await user.type(within(ai).getByTestId('ai-image-prompt'), 'El equipo en la cocina');
    await user.click(within(ai).getByTestId('ai-image-generate'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Generar imagen con IA' })).not.toBeInTheDocument());
    await waitFor(() => expect(optionNames(dialog)[0]).toBe('ia-equipo.png'));
    expect(within(dialog).getByTestId('reel-media-count')).toHaveTextContent('1 elegida');
  });

  it('sin imagen con IA configurada no sale «Crear con IA»', async () => {
    seedReel([]);
    const { dialog } = await openAdd();
    expect(within(dialog).getByTestId('picker-upload')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('picker-ai')).not.toBeInTheDocument();
  });
});

describe('«Poner foto» del editor de piezas', () => {
  it('sube desde el diálogo y la foto entra en el hueco; con IA, el botón trae la proporción del hueco', async () => {
    vi.stubEnv('VITE_AI_IMAGE_ENABLED', 'true');
    fakeAiMedia(media(NEW_PHOTO, 'ia.png'));
    seedPiece({ layers: [frame('foto', { width: 1080, height: 1350 })] });
    uploadAsset.mockResolvedValue(assetRow(NEW_PHOTO, { file_name: 'subida.jpg' }));
    const user = userEvent.setup();
    renderApp(PIECE_EDITOR);
    await screen.findByTestId('canvas-stub');
    act(() => canvas().onFrameClick?.('foto'));
    const dialog = await screen.findByRole('dialog', { name: 'Poner foto' });
    expect(within(dialog).getByTestId('picker-upload')).toBeInTheDocument();
    // La proporción del hueco (1080 × 1350 → 4:5).
    await user.click(await within(dialog).findByTestId('picker-ai'));
    const ai = await screen.findByRole('dialog', { name: 'Generar imagen con IA' });
    expect(within(ai).getByTestId('ai-image-ratio')).toHaveValue('4:5');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Generar imagen con IA' })).not.toBeInTheDocument());

    fireEvent.change(within(screen.getByRole('dialog', { name: 'Poner foto' })).getByTestId('picker-upload-input'), {
      target: { files: [new File(['x'], 'subida.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() =>
      expect(canvas().document.layers.find((l) => l.id === 'foto')).toMatchObject({
        source: { kind: 'asset', assetId: NEW_PHOTO },
      }),
    );
  });
});

describe('qué es una pieza ya diseñada (puro)', () => {
  it('exportaciones, reels montados y portadas sí; fotos con IA, ediciones y recortes no', () => {
    const row = (provenance: unknown, folder = '') => ({ provenance, folder }) as Pick<MediaAssetRow, 'provenance' | 'folder'>;
    expect(isAppDesign(row({ type: 'export' }))).toBe(true);
    expect(isAppDesign(row({ type: 'media_job', kind: 'media.reel.template' }))).toBe(true);
    expect(isAppDesign(row({ role: 'cover' }))).toBe(true);
    expect(isAppDesign(row(null, 'Reels'))).toBe(true);
    expect(isAppDesign(row(null, 'Exportaciones / Noviembre'))).toBe(true);
    expect(isAppDesign(row({ type: 'ai_generation' }))).toBe(false);
    expect(isAppDesign(row({ type: 'photo_edit', steps: [{ kind: 'ai_background' }] }, 'Ediciones'))).toBe(false);
    expect(isAppDesign(row({ type: 'media_job', kind: 'media.cutout' }))).toBe(false);
    expect(isAppDesign(row({ type: 'media_job', kind: 'media.image.process' }, 'Recortes'))).toBe(false);
    expect(isAppDesign(row(null))).toBe(false);
  });
});
