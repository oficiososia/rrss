import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as libraryApi from '@/features/library/api';
import * as storageApi from '@/features/storage/api';
import { createEmptyDocument, type ContentDocument } from '@/features/content/document';
import type { CanvasViewProps } from '@/features/content/editor/canvas/types';
import type { ContentVersionRow, MediaAssetRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import * as canvasModule from './canvas';
import type { Pixels } from './pixels';

// «Editar foto» desde la biblioteca y desde el editor. jsdom no dibuja: la
// lectura y escritura de píxeles (canvas.ts) se espía con dobles; la
// lógica de los ajustes y del encuadre es la de verdad (pixels.ts, framing.ts).

const mocks = vi.hoisted(() => ({
  loadPixels: vi.fn(),
  encodePixels: vi.fn(),
  loadCoverPixels: vi.fn(),
  uploadAsset: vi.fn(),
}));

vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => <div data-testid="canvas-stub" data-layers={props.document.layers.length} />,
}));

function pixels(width: number, height: number, alpha = 255): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([40 + (i % 60), 60, 120, alpha], i);
  return { data, width, height };
}

const asset = (id: string, fileName: string, extra: Partial<MediaAssetRow> = {}): MediaAssetRow =>
  ({
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    kind: 'image',
    origin: 'upload',
    storage_path: `${ORG_ID}/${BRAND_ID}/media/${fileName}`,
    file_name: fileName,
    mime_type: 'image/jpeg',
    bytes: 1000,
    width: 1200,
    height: 900,
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
  }) as MediaAssetRow;

let uploaded: Array<Parameters<typeof libraryApi.uploadAsset>[0]> = [];

beforeEach(() => {
  uploaded = [];
  mocks.loadPixels.mockImplementation(async (url: string) => ({
    pixels: /sin[- ]fondo/i.test(url) ? pixels(40, 30, 0) : pixels(120, 90),
    reduced: false,
    natural: { width: 120, height: 90 },
  }));
  mocks.encodePixels.mockImplementation(async (_p: Pixels, mime: string) => new Blob(['x'], { type: mime }));
  mocks.uploadAsset.mockImplementation(async (input: Parameters<typeof libraryApi.uploadAsset>[0]) => {
    uploaded.push(input);
    const row = asset(`editada-${uploaded.length}`, input.file.name, {
      mime_type: input.file.type,
      folder: input.folder ?? '',
      tags: input.tags ?? [],
      provenance: input.provenance ?? {},
    });
    fake.rows('media_assets').push(row);
    return row;
  });
  vi.spyOn(libraryApi, 'uploadAsset').mockImplementation(mocks.uploadAsset);
  // La pantalla ya está cargada por la preparación común: se espían las funciones del lienzo.
  vi.spyOn(canvasModule, 'loadPixels').mockImplementation(mocks.loadPixels);
  vi.spyOn(canvasModule, 'encodePixels').mockImplementation(mocks.encodePixels);
  vi.spyOn(canvasModule, 'loadCoverPixels').mockImplementation(mocks.loadCoverPixels);
  vi.spyOn(canvasModule, 'paint').mockImplementation(() => undefined);
  // Direcciones firmadas: una por ruta (el almacenamiento simulado no las da).
  vi.spyOn(storageApi, 'signStoragePaths').mockImplementation(
    async (paths: string[]) => new Map(paths.map((p) => [p, `https://almacen.test/${p}`])),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function openPhoto(
  role: { orgRole: 'owner' | 'member'; brandRole?: 'editor' | 'viewer' },
  rows: MediaAssetRow[],
) {
  seedWorkspace(role);
  fake.tables.media_assets = rows;
  fake.tables.jobs = [];
  fake.tables.brand_profiles = [];
  const app = renderApp(`${BRAND_BASE}/biblioteca`);
  await app.user.click(await screen.findByTestId('library-asset'));
  await screen.findByRole('dialog');
  return app;
}

async function openEditDialog(user: Awaited<ReturnType<typeof openPhoto>>['user']) {
  await user.click(await screen.findByTestId('asset-edit-photo'));
  const dialog = await screen.findByTestId('photo-edit');
  await within(dialog).findByTestId('photo-edit-preview');
  return within(dialog);
}

describe('Editar foto desde la biblioteca', () => {
  it('quien solo ve la marca no puede editar', async () => {
    await openPhoto({ orgRole: 'member', brandRole: 'viewer' }, [asset('foto-1', 'plato.jpg')]);
    expect(screen.queryByTestId('asset-edit-photo')).not.toBeInTheDocument();
  });

  it('mejorar sin IA guarda una copia nueva con su procedencia; el original no cambia', async () => {
    const original = asset('foto-1', 'Chuletón.jpg');
    const { user } = await openPhoto({ orgRole: 'member', brandRole: 'editor' }, [original]);
    const dialog = await openEditDialog(user);

    // Sin IA: no hay pestaña de ampliar ni se pregunta al servidor.
    expect(dialog.queryByRole('tab', { name: 'Ampliar' })).not.toBeInTheDocument();
    expect(dialog.getByTestId('photo-edit-save')).toBeDisabled();
    await user.click(dialog.getByTestId('photo-edit-auto'));
    await user.click(dialog.getByTestId('photo-edit-save'));

    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]).toMatchObject({
      organizationId: ORG_ID,
      brandId: BRAND_ID,
      folder: 'Ediciones',
      tags: ['edición'],
      provenance: { type: 'photo_edit', source_asset_id: 'foto-1', width: 120, height: 90 },
    });
    expect(uploaded[0]!.file.name).toBe('Mejorada · Chuletón.jpg');
    expect(uploaded[0]!.file.type).toBe('image/jpeg');
    expect((uploaded[0]!.provenance as { steps: Array<{ kind: string; auto?: boolean }> }).steps[0]).toMatchObject({
      kind: 'adjust',
      auto: true,
    });
    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Mejorada · Chuletón.jpg');
    expect(fake.rows('media_assets').find((r) => r.id === 'foto-1')).toEqual(original);
    expect(fake.calls.filter((c) => c.kind === 'function' && c.name === 'ai-media')).toEqual([]);
  });

  it('recortes por red: guarda un recurso nuevo por formato, con su caja', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Recortes' }));
    await user.click(await dialog.findByTestId('photo-edit-crops-save'));
    await waitFor(() => expect(uploaded).toHaveLength(3));
    expect(uploaded.map((u) => u.file.name)).toEqual([
      'Recorte 1:1 · plato.jpg',
      'Recorte 4:5 · plato.jpg',
      'Recorte 9:16 · plato.jpg',
    ]);
    const square = (uploaded[0]!.provenance as { steps: Array<{ box: { width: number; height: number } }> }).steps[0]!;
    expect(square).toMatchObject({ kind: 'crop', aspect: '1:1', smart: true, box: { width: 90, height: 90 } });
    expect(uploaded[0]!.dimensions).toEqual({ width: 90, height: 90, durationMs: null });
  });

  it('sin IA, una foto con fondo no ofrece quitarlo y lo dice', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    expect(await dialog.findByText(/no está disponible en este entorno/)).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-ai-remove_background')).not.toBeInTheDocument();
  });

  it('una foto sin fondo recibe uno de color (sin IA) en un PNG nuevo', async () => {
    const cutout = asset('sin-fondo', 'sin-fondo.png', { mime_type: 'image/png' });
    const { user } = await openPhoto({ orgRole: 'owner' }, [cutout]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await dialog.findByTestId('photo-edit-backgrounds');
    await user.click(dialog.getByTestId('photo-edit-color-apply'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.file.name).toBe('Fondo nuevo · sin-fondo.png');
    expect(uploaded[0]!.provenance).toMatchObject({
      type: 'photo_edit',
      source_asset_id: 'sin-fondo',
      steps: [{ kind: 'background', color: '#FFFFFF' }],
    });
  });

  it('con IA: quitar el fondo enseña el coste, crea un recurso nuevo y no toca el original', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const original = asset('foto-1', 'plato.jpg');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fake.fn('ai-media', (body) => {
      const { action, input } = body as { action: string; input?: Record<string, unknown> };
      calls.push({ action, input });
      const choice = (operation: string) => ({
        operation,
        model: `simulated-image-edit:${operation}`,
        delivery: 'sync',
        dataRegion: 'eu',
        euProcessing: true,
        trainsOnInputs: 'no',
        untestedAdapter: true,
      });
      if (action === 'photo.options') {
        return { status: 200, body: { action, edits: [choice('remove_background'), choice('upscale')] } };
      }
      if (action === 'photo.estimate') {
        return { status: 200, body: { action, costMicros: 10_000, model: 'simulated-image-edit:x' } };
      }
      fake
        .rows('media_assets')
        .push(asset('sin-fondo', 'Sin fondo · plato.png', { mime_type: 'image/png', origin: 'generated' }));
      return {
        status: 200,
        body: {
          action,
          status: 'completed',
          generationId: 'gen-1',
          costMicros: 10_000,
          asset: { id: 'sin-fondo', path: `${ORG_ID}/${BRAND_ID}/ia/gen-1-0.png` },
        },
      };
    });
    const { user } = await openPhoto({ orgRole: 'owner' }, [original]);
    const dialog = await openEditDialog(user);
    expect(await dialog.findByRole('tab', { name: 'Ampliar' })).toBeInTheDocument();
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    const ai = within(await dialog.findByTestId('photo-edit-ai-remove_background'));
    expect(await ai.findByTestId('photo-edit-ai-cost')).toHaveTextContent(/Coste máximo: 0,01/);
    await user.click(ai.getByTestId('photo-edit-ai-run-remove_background'));

    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Sin fondo · plato.png');
    expect(calls.find((c) => c.action === 'photo.edit')).toEqual({
      action: 'photo.edit',
      input: { assetId: 'foto-1', operation: 'remove_background' },
    });
    expect(fake.rows('media_assets').find((r) => r.id === 'foto-1')).toEqual(original);
    // Pasa a editar la foto sin fondo: ya ofrece fondos sin IA.
    expect(await dialog.findByTestId('photo-edit-backgrounds')).toBeInTheDocument();
  });

  it('con IA activada pero sin modelo en el servidor, no sale nada de IA', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    fake.fn('ai-media', (body) => ({ status: 200, body: { action: (body as { action: string }).action, edits: [] } }));
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(fake.calls.some((c) => c.kind === 'function' && c.name === 'ai-media')).toBe(true));
    expect(dialog.queryByRole('tab', { name: 'Ampliar' })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    expect(await dialog.findByText(/no está disponible en este entorno/)).toBeInTheDocument();
  });
});

// ─────────────────────────────── Editor ───────────────────────────────

function documentWithPhoto(): ContentDocument {
  const doc = createEmptyDocument({ aspectRatio: '4:5' });
  return {
    ...doc,
    layers: [
      {
        id: 'foto',
        type: 'image',
        name: 'Foto',
        x: 0,
        y: 0,
        width: 1080,
        height: 1350,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        anchor: { x: 'stretch', y: 'stretch' },
        source: { kind: 'asset', assetId: '11111111-1111-4111-8111-111111111111' },
        fit: 'cover',
        focus: { x: 0.5, y: 0.5 },
      },
    ],
  };
}

describe('Editar foto desde el editor', () => {
  it('la capa pasa a usar la foto editada; la original sigue en la biblioteca', async () => {
    seedWorkspace({ orgRole: 'owner' });
    const original = asset('11111111-1111-4111-8111-111111111111', 'plato.jpg');
    fake.tables.media_assets = [original];
    fake.tables.brand_profiles = [];
    fake.tables.content_items = [
      {
        id: 'content-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        title: 'Plato del día',
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
    const version: ContentVersionRow = {
      id: 'v-1',
      content_id: 'content-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      schema_version: 1,
      data: documentWithPhoto() as unknown as ContentVersionRow['data'],
      change_note: '',
      restored_from: null,
      created_by: ME.id,
      created_at: '2026-11-11T09:00:00Z',
    };
    fake.tables.content_versions = [version];
    // La foto editada tiene que tener un identificador válido para el documento.
    mocks.uploadAsset.mockImplementationOnce(async (input: Parameters<typeof libraryApi.uploadAsset>[0]) => {
      uploaded.push(input);
      const row = asset('22222222-2222-4222-8222-222222222222', input.file.name, {
        provenance: input.provenance ?? {},
      });
      fake.rows('media_assets').push(row);
      return row;
    });

    const { user } = renderApp(`${BRAND_BASE}/contenidos/content-1`);
    await screen.findByTestId('editor-title');
    await user.click(screen.getByRole('tab', { name: /Capas/ }));
    await user.click(await screen.findByTestId('layer-item'));
    await user.click(screen.getByRole('tab', { name: 'Diseño' }));
    await user.click(await screen.findByTestId('layer-edit-photo'));
    const dialog = within(await screen.findByTestId('photo-edit'));
    await dialog.findByTestId('photo-edit-preview');
    await user.click(dialog.getByTestId('photo-edit-auto'));
    await user.click(dialog.getByTestId('photo-edit-save'));
    await user.click(await dialog.findByTestId('photo-edit-use'));

    await waitFor(() => expect(screen.queryByTestId('photo-edit')).not.toBeInTheDocument());
    expect(uploaded[0]!.provenance).toMatchObject({ source_asset_id: original.id });
    expect(fake.rows('media_assets').find((r) => r.id === original.id)).toEqual(original);
    expect(await screen.findByText(/La capa usa ahora la foto editada/)).toBeInTheDocument();
  });
});
