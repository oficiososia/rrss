import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as libraryApi from '@/features/library/api';
import * as storageApi from '@/features/storage/api';
import { createEmptyDocument, type ContentDocument } from '@/features/content/document';
import type { CanvasViewProps } from '@/features/content/editor/canvas/types';
import type { ContentVersionRow, MediaAssetRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, brandRow, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import * as canvasModule from './canvas';
import * as cutoutEngine from './cutout/engine';
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
  default: (props: CanvasViewProps) => {
    const photo = props.document.layers.find((layer) => layer.type === 'image');
    const source = photo?.type === 'image' && photo.source.kind === 'asset' ? photo.source.assetId : '';
    return <div data-testid="canvas-stub" data-layers={props.document.layers.length} data-source={source} />;
  },
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
  // El navegador de las pruebas puede recortar; el modelo de verdad no se carga nunca aquí.
  vi.spyOn(cutoutEngine, 'cutoutSupport').mockReturnValue({ ok: true });
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

/** «Fondo» → «Cambiar con IA» (antes, la pestaña «Fondo con IA»). */
async function openChangeWithAi(
  user: Awaited<ReturnType<typeof openPhoto>>['user'],
  dialog: ReturnType<typeof within>,
) {
  await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
  await user.click(await dialog.findByRole('radio', { name: 'Cambiar con IA' }));
}

async function openEditDialog(user: Awaited<ReturnType<typeof openPhoto>>['user']) {
  await user.click(await screen.findByTestId('asset-edit-photo'));
  const dialog = await screen.findByTestId('photo-edit');
  await within(dialog).findByTestId('photo-edit-preview');
  return within(dialog);
}

/** `ai-media` simulado para «Cambiar el fondo con IA» (con modelo que usa la máscara). */
function fakeBackgroundAi(calls: Array<{ action: string; input?: unknown }>) {
  fake.fn('ai-media', (body) => {
    const { action, input } = body as { action: string; input?: Record<string, unknown> };
    calls.push({ action, input });
    if (action === 'photo.options') {
      return {
        status: 200,
        body: {
          action,
          edits: [
            {
              operation: 'replace_background',
              model: 'openai:gpt-image-2.5-sunburst',
              delivery: 'sync',
              dataRegion: 'global',
              euProcessing: false,
              trainsOnInputs: 'no',
              untestedAdapter: true,
              usesSubjectMask: true,
            },
          ],
        },
      };
    }
    if (action === 'photo.estimate') {
      return { status: 200, body: { action, costMicros: 200_000, model: 'openai:gpt-image-2.5-sunburst' } };
    }
    // (Cada intento deja el mismo recurso simulado: se borra y se vuelve a crear, como en el servidor.)
    fake.tables.media_assets = fake.rows('media_assets').filter((r) => r.id !== 'fondo-ia');
    fake
      .rows('media_assets')
      .push(asset('fondo-ia', 'Fondo nuevo · plato.png', { mime_type: 'image/png', origin: 'generated' }));
    return {
      status: 200,
      body: {
        action,
        status: 'completed',
        generationId: 'gen-2',
        costMicros: 200_000,
        asset: { id: 'fondo-ia', path: `${ORG_ID}/${BRAND_ID}/ia/gen-2-0.png` },
      },
    };
  });
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

    // Tres pestañas; sin IA no hay «Ampliar con IA» ni se pregunta al servidor.
    expect(dialog.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Ajustar', 'Recortar', 'Fondo']);
    expect(dialog.queryByTestId('photo-edit-upscale')).not.toBeInTheDocument();
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

  it('recortes por red: guarda un recurso nuevo con el formato elegido y su caja', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Recortar' }));
    // Se abre con la foto entera: sin cambios no hay nada que guardar.
    expect(await dialog.findByTestId('photo-edit-crop-none')).toBeChecked();
    expect(dialog.getByTestId('photo-edit-save')).toBeDisabled();
    // Siempre con encuadre inteligente: ya no hay casilla.
    expect(dialog.queryByTestId('photo-edit-smart')).not.toBeInTheDocument();
    await user.click(await dialog.findByTestId('photo-edit-crop-4:5'));
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.file.name).toBe('Recorte 4:5 · plato.jpg');
    const crop = (uploaded[0]!.provenance as { steps: Array<{ box: { width: number; height: number } }> }).steps[0]!;
    expect(crop).toMatchObject({ kind: 'crop', aspect: '4:5', smart: true, box: { width: 72, height: 90 } });
    expect(uploaded[0]!.dimensions).toEqual({ width: 72, height: 90, durationMs: null });
  });

  it('sin IA, quitar el fondo se ofrece en el navegador (gratis) y no se llama a ningún servidor', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    expect(await dialog.findByTestId('photo-edit-cutout-run')).toBeInTheDocument();
    expect(dialog.getByText(/Gratis y sin IA externa/)).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-ai-remove_background')).not.toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-engine-ai')).not.toBeInTheDocument();
  });

  it('si el navegador no puede recortar, lo dice con claridad y no ofrece el botón', async () => {
    vi.spyOn(cutoutEngine, 'cutoutSupport').mockReturnValue({
      ok: false,
      reason: 'Este navegador no puede quitar el fondo (le falta WebAssembly).',
    });
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    expect(await dialog.findByTestId('photo-edit-cutout-unsupported')).toHaveTextContent(/le falta WebAssembly/);
    expect(dialog.queryByTestId('photo-edit-cutout-run')).not.toBeInTheDocument();
  });

  it('quitar el fondo en el navegador: enseña la descarga y el recorte, y guarda un recurso nuevo con su procedencia', async () => {
    const original = asset('foto-1', 'plato.jpg');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const cut = vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(async (_image, onProgress) => {
      onProgress?.({ phase: 'downloading', received: 42_000_000, total: 84_000_000 });
      await gate;
      onProgress?.({ phase: 'running' });
      return {
        pixels: pixels(120, 90, 0),
        model: 'isnet-general-use',
        provider: 'wasm',
        engine: 'isnet',
        quality: 'basic',
        fromCache: false,
      };
    });
    const { user } = await openPhoto({ orgRole: 'owner' }, [original]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    const progress = await dialog.findByTestId('photo-edit-cutout-progress');
    expect(progress).toHaveTextContent('Descargando el modelo de recorte (84 MB, solo la primera vez): 42 de 84 MB');
    expect(within(progress).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    finish();

    // Con el recorte hecho aparecen los fondos y no se ha guardado nada todavía.
    await dialog.findByTestId('photo-edit-backgrounds');
    expect(cut).toHaveBeenCalledTimes(1);
    expect(uploaded).toHaveLength(0);
    await user.click(dialog.getByTestId('photo-edit-shadow'));
    await user.click(dialog.getByTestId('photo-edit-save'));

    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.file.name).toBe('Fondo nuevo · plato.jpg');
    expect(uploaded[0]!.file.type).toBe('image/jpeg');
    expect(uploaded[0]).toMatchObject({ folder: 'Ediciones', tags: ['edición'] });
    expect(uploaded[0]!.provenance).toMatchObject({
      type: 'photo_edit',
      source_asset_id: 'foto-1',
      steps: [
        { kind: 'remove_background', engine: 'browser', model: 'isnet-general-use' },
        { kind: 'background', color: '#FFFFFF', shadow: true },
      ],
    });
    expect(fake.rows('media_assets').find((r) => r.id === 'foto-1')).toEqual(original);
    expect(fake.calls.filter((c) => c.kind === 'function' && c.name === 'ai-media')).toEqual([]);
  });

  it('con BEN2 guarda ese motor en la procedencia y no avisa de calidad básica; con el respaldo, sí avisa', async () => {
    const spy = vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockResolvedValueOnce({
      pixels: pixels(120, 90, 0),
      model: 'ben2-base-fp16',
      provider: 'webgpu',
      engine: 'ben2',
      quality: 'high',
      fromCache: true,
    });
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    await dialog.findByTestId('photo-edit-backgrounds');
    expect(dialog.queryByTestId('photo-edit-cutout-basic')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-cutout-save'));
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect((uploaded[0]!.provenance as { steps: unknown[] }).steps).toEqual([
      { kind: 'remove_background', engine: 'browser', model: 'ben2-base-fp16' },
    ]);
    spy.mockRestore();
  });

  it('con el respaldo (sin WebGPU) dice «calidad básica» y el recorte en marcha se puede cancelar', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser')
      .mockImplementationOnce(
        (_image, _progress, options) =>
          new Promise((_ok, ko) => {
            signal = options?.signal;
            signal?.addEventListener('abort', () => ko(Object.assign(new Error('x'), { name: 'AbortError' })));
          }),
      )
      .mockResolvedValueOnce({
        pixels: pixels(120, 90, 0),
        model: 'isnet-general-use',
        provider: 'wasm',
        engine: 'isnet',
        quality: 'basic',
        fromCache: true,
      });
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    await user.click(await dialog.findByTestId('photo-edit-cutout-cancel'));
    await waitFor(() => expect(dialog.queryByTestId('photo-edit-cutout-progress')).not.toBeInTheDocument());
    expect(signal?.aborted).toBe(true);
    expect(dialog.queryByText(/No se ha podido quitar el fondo/)).not.toBeInTheDocument(); // cancelar no es un error
    await user.click(dialog.getByTestId('photo-edit-cutout-run'));
    expect(await dialog.findByTestId('photo-edit-cutout-basic')).toHaveTextContent(/Calidad básica/);
  });

  it('se puede guardar solo el recorte (PNG transparente) sin elegir fondo', async () => {
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockResolvedValue({
      pixels: pixels(120, 90, 0),
      model: 'isnet-general-use',
      provider: 'webgpu',
      engine: 'isnet',
      quality: 'basic',
      fromCache: true,
    });
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    await user.click(await dialog.findByTestId('photo-edit-cutout-save'));
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.file.name).toBe('Sin fondo · plato.png');
    expect((uploaded[0]!.provenance as { steps: unknown[] }).steps).toEqual([
      { kind: 'remove_background', engine: 'browser', model: 'isnet-general-use' },
    ]);
  });

  it('si el recorte falla, lo explica y se puede reintentar', async () => {
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockRejectedValue(
      Object.assign(new Error('No se ha podido descargar el modelo: revisa la conexión a internet.'), {
        name: 'ModelDownloadError',
      }),
    );
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    expect(await dialog.findByText(/revisa la conexión a internet/)).toBeInTheDocument();
    expect(dialog.getByTestId('photo-edit-cutout-run')).toBeEnabled();
    expect(uploaded).toHaveLength(0);
  });

  it('una foto sin fondo recibe uno de color (sin IA) en un PNG nuevo', async () => {
    const cutout = asset('sin-fondo', 'sin-fondo.png', { mime_type: 'image/png' });
    const { user } = await openPhoto({ orgRole: 'owner' }, [cutout]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await dialog.findByTestId('photo-edit-backgrounds');
    await user.click(dialog.getByTestId('photo-edit-save'));
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
    // «Ampliar con IA» ya no es una pestaña: está en «Recortar».
    expect(dialog.queryByRole('tab', { name: 'Ampliar' })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('tab', { name: 'Recortar' }));
    expect(await dialog.findByTestId('photo-edit-ai-upscale')).toBeInTheDocument();
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    // Con las dos opciones, la del navegador viene marcada por defecto.
    expect(await dialog.findByTestId('photo-edit-engine-browser')).toBeChecked();
    expect(dialog.queryByTestId('photo-edit-ai-remove_background')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-engine-ai'));
    const ai = within(await dialog.findByTestId('photo-edit-ai-remove_background'));
    expect(await ai.findByTestId('photo-edit-ai-cost')).toHaveTextContent(/Coste máximo: 0,01/);
    await user.click(ai.getByTestId('photo-edit-ai-run-remove_background'));

    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Sin fondo · plato.png');
    expect(calls.find((c) => c.action === 'photo.edit')).toEqual({
      action: 'photo.edit',
      input: { assetId: 'foto-1', operation: 'remove_background', subject: 'food' },
    });
    expect(fake.rows('media_assets').find((r) => r.id === 'foto-1')).toEqual(original);
    // Pasa a editar la foto sin fondo: ya ofrece fondos sin IA.
    expect(await dialog.findByTestId('photo-edit-backgrounds')).toBeInTheDocument();
  });

  it('con IA: cambiar el fondo pide el texto, avisa de que no hay recorte del plato y crea un recurso nuevo', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    vi.spyOn(cutoutEngine, 'cutoutSupport').mockReturnValue({ ok: false, reason: 'sin WebAssembly' });
    const original = asset('foto-1', 'plato.jpg');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    const { user } = await openPhoto({ orgRole: 'owner' }, [original]);
    const dialog = await openEditDialog(user);
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    // Sin recorte de la foto se avisa; sin texto no se puede lanzar.
    expect(ai.getByText(/No hay recorte de la foto/)).toBeInTheDocument();
    expect(ai.getByText(/fuera de la UE/)).toBeInTheDocument();
    const run = ai.getByTestId('photo-edit-ai-run-replace_background');
    expect(run).toBeDisabled();
    expect(await ai.findByTestId('photo-edit-ai-cost')).toHaveTextContent(/Coste máximo: 0,20/);
    // Sugerencias de la marca a un clic.
    const ideas = ai.getAllByTestId('photo-edit-ai-background-idea').map((b) => b.textContent);
    expect(ideas).toEqual(expect.arrayContaining(['mesa de mármol blanco con luz cálida', 'pizarra oscura']));
    await user.click(ai.getByRole('button', { name: 'mantel de lino beige' }));
    expect(ai.getByTestId('photo-edit-ai-background-text')).toHaveValue('mantel de lino beige');
    expect(run).toBeEnabled();
    await user.click(run);

    // El resultado se enseña antes de aplicarlo: hasta «Usar esta» no entra en la lista de guardados.
    expect(await dialog.findByTestId('photo-edit-ai-review')).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-result')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-ai-use'));
    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Fondo nuevo · plato.png');
    expect(calls.find((c) => c.action === 'photo.edit')).toEqual({
      action: 'photo.edit',
      input: { assetId: 'foto-1', operation: 'replace_background', prompt: 'mantel de lino beige', subject: 'food' },
    });
    expect(fake.rows('media_assets').find((r) => r.id === 'foto-1')).toEqual(original);
  });

  it('con IA: cambiar el fondo recorta el plato en el navegador, manda la máscara y vuelve a pegar el plato original', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const original = asset('foto-1', 'plato.jpg');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    const cut = vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(async (image, onProgress) => {
      onProgress?.({ phase: 'running' });
      // El plato: la mitad izquierda de la foto.
      const out = new Uint8ClampedArray(image.data);
      for (let i = 0; i < image.width * image.height; i += 1) {
        out[i * 4 + 3] = i % image.width < image.width / 2 ? 255 : 0;
      }
      return {
        pixels: { data: out, width: image.width, height: image.height },
        model: 'isnet-test',
        provider: 'wasm',
        engine: 'isnet',
        quality: 'basic',
        fromCache: true,
      };
    });
    const removed = vi.spyOn(libraryApi, 'deleteAssets').mockResolvedValue(undefined);
    const { user } = await openPhoto({ orgRole: 'owner' }, [original]);
    const dialog = await openEditDialog(user);
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    // Hay recorte posible: nada de «no hay recorte»; la casilla viene marcada.
    expect(ai.queryByText(/No hay recorte de la foto/)).not.toBeInTheDocument();
    expect(ai.getByTestId('photo-edit-ai-protect')).toBeChecked();
    await user.click(ai.getByRole('button', { name: 'mantel de lino beige' }));
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));

    // El resultado se enseña antes de aplicarlo: hasta «Usar esta» no entra en la lista de guardados.
    expect(await dialog.findByTestId('photo-edit-ai-review')).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-result')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-ai-use'));
    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Fondo nuevo · plato.jpg');
    expect(cut).toHaveBeenCalledTimes(1);
    // La máscara viaja en base64 y es un PNG (ya codificado por el doble) con las medidas de la foto.
    const sent = calls.find((c) => c.action === 'photo.edit')!.input as Record<string, unknown>;
    expect(sent).toMatchObject({ assetId: 'foto-1', operation: 'replace_background', prompt: 'mantel de lino beige' });
    expect(typeof sent.subjectMask).toBe('string');
    const maskCall = mocks.encodePixels.mock.calls.find(([p, mime]) => mime === 'image/png' && p.width === 1200);
    expect(maskCall).toBeTruthy();
    const mask = maskCall![0] as Pixels;
    expect([mask.width, mask.height]).toEqual([1200, 900]);
    expect(mask.data[(450 * 1200 + 100) * 4 + 3]).toBe(255); // plato: opaco
    expect(mask.data[(450 * 1200 + 1100) * 4 + 3]).toBe(0); // fondo: transparente
    // Se guarda una versión nueva con el plato protegido (photo_edit, no ai_edit) y se retira la sin proteger.
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]!.provenance).toMatchObject({
      type: 'photo_edit',
      source_asset_id: 'foto-1',
      steps: [
        {
          kind: 'ai_background',
          operation: 'replace_background',
          prompt: 'mantel de lino beige',
          plate_protected: true,
          mask_model: 'isnet-test',
        },
      ],
    });
    expect(removed).toHaveBeenCalledWith(['fondo-ia']);
    expect(fake.rows('media_assets').find((r) => r.id === 'foto-1')).toEqual(original);
  });

  it('con IA: sin la casilla «Proteger el plato original» manda la máscara pero deja el resultado de la IA', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(async (image) => ({
      pixels: image,
      model: 'isnet-test',
      provider: 'wasm',
      engine: 'isnet',
      quality: 'basic',
      fromCache: true,
    }));
    const removed = vi.spyOn(libraryApi, 'deleteAssets').mockResolvedValue(undefined);
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    await user.click(ai.getByTestId('photo-edit-ai-protect'));
    await user.click(ai.getByRole('button', { name: 'pizarra oscura' }));
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));

    // El resultado se enseña antes de aplicarlo: hasta «Usar esta» no entra en la lista de guardados.
    expect(await dialog.findByTestId('photo-edit-ai-review')).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-result')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-ai-use'));
    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Fondo nuevo · plato.png');
    expect((calls.find((c) => c.action === 'photo.edit')!.input as Record<string, unknown>).subjectMask).toBeTruthy();
    expect(uploaded).toHaveLength(0);
    expect(removed).not.toHaveBeenCalled();
  });

  it('con IA: si no se puede volver a pegar el plato, deja el resultado de la IA y avisa', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(async (image) => ({
      pixels: image,
      model: 'isnet-test',
      provider: 'wasm',
      engine: 'isnet',
      quality: 'basic',
      fromCache: true,
    }));
    const removed = vi.spyOn(libraryApi, 'deleteAssets').mockResolvedValue(undefined);
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    // El resultado de la IA tiene otra proporción que la foto: no se puede pegar el plato sin deformarlo.
    mocks.loadPixels.mockImplementation(async (url: string) =>
      /Fondo nuevo|Fondo%20nuevo/.test(url)
        ? { pixels: pixels(160, 40), reduced: false, natural: { width: 160, height: 40 } }
        : { pixels: pixels(120, 90), reduced: false, natural: { width: 120, height: 90 } },
    );
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    await user.click(ai.getByRole('button', { name: 'pizarra oscura' }));
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));

    // El resultado se enseña antes de aplicarlo: hasta «Usar esta» no entra en la lista de guardados.
    expect(await dialog.findByTestId('photo-edit-ai-review')).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-result')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-ai-use'));
    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Fondo nuevo · plato.png');
    expect(uploaded).toHaveLength(0);
    expect(removed).not.toHaveBeenCalled();
  });

  it('con IA: si no hay modelo de cambiar el fondo, no sale «Cambiar con IA»', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    fake.fn('ai-media', (body) => ({ status: 200, body: { action: (body as { action: string }).action, edits: [] } }));
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(fake.calls.some((c) => c.kind === 'function' && c.name === 'ai-media')).toBe(true));
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    expect(await dialog.findByTestId('photo-edit-bg-mode-blur')).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-bg-mode-ai')).not.toBeInTheDocument();
  });

  it('con IA activada pero sin modelo en el servidor, no sale nada de IA', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    fake.fn('ai-media', (body) => ({ status: 200, body: { action: (body as { action: string }).action, edits: [] } }));
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(fake.calls.some((c) => c.kind === 'function' && c.name === 'ai-media')).toBe(true));
    await user.click(dialog.getByRole('tab', { name: 'Recortar' }));
    expect(dialog.queryByTestId('photo-edit-upscale')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    // Sin modelo de IA queda el del navegador, sin elegir, y no se ofrece «Cambiar con IA».
    expect(dialog.queryByTestId('photo-edit-bg-mode-ai')).not.toBeInTheDocument();
    expect(await dialog.findByTestId('photo-edit-cutout-run')).toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-engine-ai')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────── Editor ───────────────────────────────

function documentWithPhoto(): ContentDocument {
  const doc = createEmptyDocument({ aspectRatio: '4:5' });
  return {
    ...doc,
    pages: [
      {
        id: 'p1',
        name: '',
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
      },
    ],
  };
}

describe('Editar foto desde el editor', () => {
  const ORIGINAL = '11111111-1111-4111-8111-111111111111';
  const EDITED = '22222222-2222-4222-8222-222222222222';

  async function openEditor() {
    seedWorkspace({ orgRole: 'owner' });
    const original = asset(ORIGINAL, 'plato.jpg');
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
      const row = asset(EDITED, input.file.name, { provenance: input.provenance ?? {} });
      fake.rows('media_assets').push(row);
      return row;
    });
    const app = renderApp(`${BRAND_BASE}/contenidos/content-1`);
    await screen.findByTestId('editor-title');
    await app.user.click(screen.getByRole('tab', { name: /Capas/ }));
    await app.user.click(await screen.findByTestId('layer-item'));
    await app.user.click(screen.getByRole('tab', { name: 'Diseño' }));
    return { ...app, original };
  }

  const layerSource = () => screen.getByTestId('canvas-stub').getAttribute('data-source');

  it('aplicar cambia la capa al momento; deshacer, rehacer y «Volver a la original» recorren todo el ciclo', async () => {
    const { user, original } = await openEditor();
    expect(layerSource()).toBe(ORIGINAL);
    // Sin ediciones previas no hay a qué volver.
    expect(screen.queryByTestId('layer-restore-original')).not.toBeInTheDocument();

    await user.click(await screen.findByTestId('layer-edit-photo'));
    const dialog = within(await screen.findByTestId('photo-edit'));
    await dialog.findByTestId('photo-edit-preview');
    // No es una ventana emergente: es una pantalla propia, sin diálogo.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(dialog.getByTestId('photo-edit-save')).toHaveTextContent('Aplicar a la capa');
    await user.click(dialog.getByTestId('photo-edit-auto'));
    await user.click(dialog.getByTestId('photo-edit-save'));

    // Editar → aplicar: la pantalla se cierra y la capa ya usa la copia (queda también en «Ediciones»).
    await waitFor(() => expect(screen.queryByTestId('photo-edit')).not.toBeInTheDocument());
    expect(uploaded[0]!.provenance).toMatchObject({ source_asset_id: ORIGINAL });
    expect(uploaded[0]!.folder).toBe('Ediciones');
    expect(fake.rows('media_assets').find((r) => r.id === ORIGINAL)).toEqual(original);
    expect(await screen.findByText(/La capa usa ahora la foto editada/)).toBeInTheDocument();
    expect(layerSource()).toBe(EDITED);

    // Deshacer / rehacer del editor.
    await user.click(screen.getByTestId('undo'));
    expect(layerSource()).toBe(ORIGINAL);
    await user.click(screen.getByTestId('redo'));
    expect(layerSource()).toBe(EDITED);

    // «Volver a la original» desde la propia capa (también se puede deshacer).
    await user.click(await screen.findByTestId('layer-restore-original'));
    expect(layerSource()).toBe(ORIGINAL);
    expect(screen.queryByTestId('layer-restore-original')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('undo'));
    expect(layerSource()).toBe(EDITED);
    expect(fake.rows('media_assets').find((r) => r.id === ORIGINAL)).toEqual(original);
  });

  it('la acción rápida «Modo retrato» del panel abre «Editar foto» en ese modo y se aplica a la capa (se deshace con Ctrl+Z)', async () => {
    const cutout = pixels(120, 90, 0);
    for (let y = 30; y < 60; y += 1) for (let x = 40; x < 80; x += 1) cutout.data[(y * 120 + x) * 4 + 3] = 255;
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockResolvedValue({
      pixels: cutout,
      model: 'ben2',
      provider: 'webgpu',
      engine: 'ben2',
      quality: 'high',
      fromCache: true,
    });
    const { user } = await openEditor();
    // El botón ya no hace un archivo a ciegas: abre la pantalla con el modo elegido.
    expect(screen.queryByTestId('photo-blur-background')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('photo-portrait'));
    const dialog = within(await screen.findByTestId('photo-edit'));
    expect(await dialog.findByTestId('photo-edit-bg-mode-blur')).toHaveAttribute('aria-checked', 'true');
    expect(dialog.getByTestId('photo-edit-cutout-run')).toHaveTextContent('Desenfocar el fondo');
    await user.click(dialog.getByTestId('photo-edit-cutout-run'));
    await dialog.findByTestId('photo-edit-backgrounds');
    expect(dialog.getByTestId('photo-edit-portrait-controls')).toBeInTheDocument();
    expect(dialog.getByTestId('photo-edit-save')).toHaveTextContent('Aplicar a la capa');
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(screen.queryByTestId('photo-edit')).not.toBeInTheDocument());
    expect(layerSource()).toBe(EDITED);
    expect((uploaded[0]!.provenance as { steps: Array<{ kind: string }> }).steps.map((s) => s.kind)).toEqual([
      'remove_background',
      'portrait_blur',
    ]);
    await user.click(screen.getByTestId('undo'));
    expect(layerSource()).toBe(ORIGINAL);
  });

  it('Ctrl+Z en la pantalla de edición no toca el diseño de debajo; Esc vuelve sin guardar nada', async () => {
    const { user } = await openEditor();
    await user.click(await screen.findByTestId('layer-edit-photo'));
    const dialog = within(await screen.findByTestId('photo-edit'));
    await dialog.findByTestId('photo-edit-preview');
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByTestId('photo-edit')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('photo-edit')).not.toBeInTheDocument());
    expect(uploaded).toHaveLength(0);
    expect(layerSource()).toBe(ORIGINAL);
  });

  it('volver con cambios sin guardar pregunta antes de descartarlos', async () => {
    const { user } = await openEditor();
    await user.click(await screen.findByTestId('layer-edit-photo'));
    const dialog = within(await screen.findByTestId('photo-edit'));
    await dialog.findByTestId('photo-edit-preview');
    await user.click(dialog.getByTestId('photo-edit-auto'));
    await user.click(dialog.getByTestId('photo-edit-back'));
    expect(await dialog.findByTestId('photo-edit-discard')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Seguir editando' }));
    expect(screen.getByTestId('photo-edit')).toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-back'));
    await user.click(await dialog.findByTestId('photo-edit-discard-confirm'));
    await waitFor(() => expect(screen.queryByTestId('photo-edit')).not.toBeInTheDocument());
    expect(uploaded).toHaveLength(0);
  });
});

describe('Pantalla «Editar foto»: detalles', () => {
  it('«Mejorar automáticamente» se quita en un clic y no se arrastra a la siguiente copia', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    const auto = dialog.getByTestId('photo-edit-auto');
    await user.click(auto);
    expect(auto).toHaveAttribute('aria-pressed', 'true');
    expect(dialog.getByTestId('photo-edit-save')).toBeEnabled();
    // Un clic y vuelve a como estaba.
    await user.click(auto);
    expect(auto).toHaveAttribute('aria-pressed', 'false');
    expect(dialog.getByTestId('photo-edit-save')).toBeDisabled();
    expect(dialog.getByTestId('photo-edit-exposure')).toHaveValue('0');

    // Una copia con la mejora automática y la siguiente, solo con un ajuste a mano.
    await user.click(auto);
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    await waitFor(() => expect(auto).toHaveAttribute('aria-pressed', 'false'));
    await waitFor(() => expect(dialog.getByTestId('photo-edit-save')).toBeDisabled());
    fireEvent.change(dialog.getByTestId('photo-edit-exposure'), { target: { value: '20' } });
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(2));
    const steps = (uploaded[1]!.provenance as { steps: Array<{ kind: string; auto?: boolean; adjustments?: unknown }> })
      .steps;
    expect(steps[0]).toMatchObject({ kind: 'adjust', auto: false, exposure: 20 });
  });

  it('la vista previa del fondo enseña el color elegido y «Ver la original» se mantiene con el puntero', async () => {
    const paint = vi.spyOn(canvasModule, 'paint').mockImplementation(() => undefined);
    const cutout = asset('sin-fondo', 'sin-fondo.png', { mime_type: 'image/png' });
    const { user } = await openPhoto({ orgRole: 'owner' }, [cutout]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await dialog.findByTestId('photo-edit-cutout-preview');
    const lastPixels = () => paint.mock.calls.at(-1)![1] as Pixels;
    fireEvent.change(dialog.getByTestId('photo-edit-color'), { target: { value: '#336699' } });
    await waitFor(() => expect(Array.from(lastPixels().data.slice(0, 4))).toEqual([0x33, 0x66, 0x99, 255]));

    // Mantener pulsado enseña la foto de antes; al soltar, vuelve lo editado.
    const compare = dialog.getByTestId('photo-edit-compare');
    fireEvent.pointerDown(compare);
    await waitFor(() => expect(compare).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.pointerUp(compare);
    await waitFor(() => expect(compare).toHaveAttribute('aria-pressed', 'false'));
  });

  it('desde la biblioteca, tras guardar una copia se puede deshacer y la copia desaparece', async () => {
    const original = asset('foto-1', 'plato.jpg');
    const { user } = await openPhoto({ orgRole: 'owner' }, [original]);
    const dialog = await openEditDialog(user);
    expect(dialog.getByTestId('photo-edit-save')).toHaveTextContent('Guardar copia');
    await user.click(dialog.getByTestId('photo-edit-auto'));
    await user.click(dialog.getByTestId('photo-edit-save'));
    const result = await dialog.findByTestId('photo-edit-result');
    expect(fake.rows('media_assets').some((r) => r.id === 'editada-1')).toBe(true);
    await user.click(within(result).getByTestId('photo-edit-undo-save'));
    await waitFor(() => expect(dialog.queryByTestId('photo-edit-result')).not.toBeInTheDocument());
    expect(fake.rows('media_assets').some((r) => r.id === 'editada-1')).toBe(false);
    expect(fake.rows('media_assets').find((r) => r.id === 'foto-1')).toEqual(original);
  });
});

describe('Modo retrato y retoque de la selección', () => {
  /** Recorte con el plato en el centro (opaco) y el resto transparente, con las medidas de la foto. */
  function plateCutout(): Pixels {
    const base = pixels(120, 90, 0);
    for (let y = 30; y < 60; y += 1) for (let x = 40; x < 80; x += 1) base.data[(y * 120 + x) * 4 + 3] = 255;
    return base;
  }
  const mockCut = () =>
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockResolvedValue({
      pixels: plateCutout(),
      model: 'ben2',
      provider: 'webgpu',
      engine: 'ben2',
      quality: 'high',
      fromCache: true,
    });
  const alphaAt = (image: Pixels, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]!;
  const rgbAt = (image: Pixels, x: number, y: number) =>
    Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));

  async function cutAndOpenBackgrounds() {
    mockCut();
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    await dialog.findByTestId('photo-edit-backgrounds');
    return { user, dialog };
  }

  function stubStageGeometry() {
    // jsdom no maqueta: la foto ocupa 120 x 90 píxeles de pantalla desde (0, 0).
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 120,
      bottom: 90,
      width: 120,
      height: 90,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }

  function paintAt(canvas: HTMLElement, from: [number, number], to?: [number, number]) {
    fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], pointerId: 1 });
    if (to) fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1], pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: (to ?? from)[0], clientY: (to ?? from)[1], pointerId: 1 });
  }

  it('«Modo retrato» se ve al momento, tiene sus controles y guarda una copia con la operación y la intensidad', async () => {
    const { user, dialog } = await cutAndOpenBackgrounds();
    const toggle = dialog.getByTestId('photo-edit-bg-mode-blur');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(dialog.queryByTestId('photo-edit-portrait-amount')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    const amount = dialog.getByTestId('photo-edit-portrait-amount');
    expect(amount).toHaveValue('60');
    fireEvent.change(amount, { target: { value: '85' } });
    fireEvent.change(dialog.getByTestId('photo-edit-portrait-dim'), { target: { value: '30' } });
    await user.click(dialog.getByTestId('photo-edit-portrait-progressive'));
    // Con retrato no hay fondo nuevo ni sombra suave que elegir.
    expect(dialog.queryByTestId('photo-edit-shadow')).not.toBeInTheDocument();
    expect(uploaded).toHaveLength(0);

    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    expect(uploaded[0]!.file.name).toBe('Modo retrato · plato.jpg');
    expect(uploaded[0]!.file.type).toBe('image/jpeg');
    expect(uploaded[0]!.provenance).toMatchObject({
      type: 'photo_edit',
      source_asset_id: 'foto-1',
      width: 120,
      height: 90,
      steps: [
        { kind: 'remove_background', engine: 'browser', model: 'ben2' },
        { kind: 'portrait_blur', amount: 85, progressive: false, dim: 30 },
      ],
    });
    // El resultado es la foto entera y opaca; el plato, tal cual.
    const saved = mocks.encodePixels.mock.calls.at(-1)![0] as Pixels;
    expect([saved.width, saved.height]).toEqual([120, 90]);
    expect(alphaAt(saved, 5, 5)).toBe(255);
    expect(rgbAt(saved, 60, 45)).toEqual(rgbAt(pixels(120, 90), 60, 45));
  });

  it('el retoque añade al plato con el pincel y se guarda en el recorte (PNG transparente) con su procedencia', async () => {
    stubStageGeometry();
    const { user, dialog } = await cutAndOpenBackgrounds();
    await user.click(dialog.getByTestId('photo-edit-retouch-toggle'));
    expect(dialog.getByTestId('photo-edit-brush-add')).toHaveAttribute('aria-checked', 'true');
    expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeDisabled();
    const canvas = await screen.findByTestId('photo-edit-retouch-canvas');
    paintAt(canvas, [8, 8], [14, 8]);
    await waitFor(() => expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeEnabled());
    await user.click(dialog.getByTestId('photo-edit-retouch-done'));
    expect(screen.queryByTestId('photo-edit-retouch-canvas')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-cutout-save'));
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    const saved = mocks.encodePixels.mock.calls.at(-1)![0] as Pixels;
    expect(alphaAt(saved, 10, 8)).toBe(255); // pintado: ahora es plato
    expect(alphaAt(saved, 100, 80)).toBe(0); // lejos: sigue siendo fondo
    expect(alphaAt(saved, 60, 45)).toBe(255); // el plato de siempre
    // Los colores del retoque son los de la foto original, no los del recorte.
    expect(rgbAt(saved, 10, 8)).toEqual(rgbAt(pixels(120, 90), 10, 8));
    expect(uploaded[0]!.file.type).toBe('image/png');
    expect((uploaded[0]!.provenance as { steps: unknown[] }).steps).toEqual([
      { kind: 'remove_background', engine: 'browser', model: 'ben2' },
      { kind: 'retouch_selection', strokes: 1 },
    ]);
  });

  it('el pincel «Quitar del plato», deshacer el último trazo y borrar los retoques', async () => {
    stubStageGeometry();
    const { user, dialog } = await cutAndOpenBackgrounds();
    await user.click(dialog.getByTestId('photo-edit-retouch-toggle'));
    await user.click(dialog.getByTestId('photo-edit-brush-remove'));
    expect(dialog.getByTestId('photo-edit-brush-remove')).toHaveAttribute('aria-checked', 'true');
    const canvas = await screen.findByTestId('photo-edit-retouch-canvas');
    paintAt(canvas, [60, 45]); // sobre el plato
    paintAt(canvas, [50, 40]);
    await waitFor(() => expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeEnabled());
    await user.click(dialog.getByTestId('photo-edit-retouch-undo')); // quita el 2º trazo
    await user.click(dialog.getByTestId('photo-edit-retouch-clear')); // y borra el resto
    await waitFor(() => expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeDisabled());
    await user.click(dialog.getByTestId('photo-edit-retouch-done'));
    await user.click(dialog.getByTestId('photo-edit-cutout-save'));
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    const saved = mocks.encodePixels.mock.calls.at(-1)![0] as Pixels;
    expect(alphaAt(saved, 60, 45)).toBe(255); // todo deshecho: el plato intacto
    expect((uploaded[0]!.provenance as { steps: unknown[] }).steps).toEqual([
      { kind: 'remove_background', engine: 'browser', model: 'ben2' },
    ]);
  });

  it('un trazo de «Quitar» abre un hueco y el retoque también vale para un fondo de color', async () => {
    stubStageGeometry();
    const { user, dialog } = await cutAndOpenBackgrounds();
    await user.click(dialog.getByTestId('photo-edit-retouch-toggle'));
    await user.click(dialog.getByTestId('photo-edit-brush-remove'));
    fireEvent.change(dialog.getByTestId('photo-edit-brush-size'), { target: { value: '8' } });
    paintAt(await screen.findByTestId('photo-edit-retouch-canvas'), [60, 45]);
    await waitFor(() => expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeEnabled());
    await user.click(dialog.getByTestId('photo-edit-retouch-done'));
    // Fondo de color: lo quitado del plato se ve ahora del color del fondo (blanco).
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    const saved = mocks.encodePixels.mock.calls.at(-1)![0] as Pixels;
    expect(rgbAt(saved, 60, 45)).toEqual([255, 255, 255]);
    expect(uploaded[0]!.provenance).toMatchObject({
      steps: [
        { kind: 'remove_background' },
        { kind: 'retouch_selection', strokes: 1 },
        { kind: 'background', color: '#FFFFFF' },
      ],
    });
  });

  it('Esc cierra la pantalla aunque el botón pulsado haya desaparecido y el foco esté fuera (tras quitar el fondo)', async () => {
    const { dialog } = await cutAndOpenBackgrounds();
    // «Quitar el fondo» ya no está: el foco se quedó en la página, no dentro de la pantalla.
    expect(dialog.queryByTestId('photo-edit-cutout-run')).not.toBeInTheDocument();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(screen.getByTestId('photo-edit').contains(document.activeElement)).toBe(false);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    // Con un recorte sin guardar pregunta antes de descartar, como Volver.
    expect(await dialog.findByTestId('photo-edit-discard')).toBeInTheDocument();
  });

  it('si el foco se pierde al desaparecer un botón, la pantalla lo recupera', async () => {
    const { dialog } = await cutAndOpenBackgrounds();
    const root = screen.getByTestId('photo-edit');
    const probe = document.createElement('button');
    root.appendChild(probe);
    probe.focus();
    probe.remove(); // jsdom no avisa con focusout al quitar un elemento: se avisa a mano
    root.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null }));
    await waitFor(() => expect(document.activeElement).toBe(root));
    expect(dialog.getByTestId('photo-edit-backgrounds')).toBeInTheDocument();
  });

  it('se puede pintar solo con el teclado: flechas, Espacio, [ ], X y Ctrl+Z', async () => {
    stubStageGeometry();
    const { user, dialog } = await cutAndOpenBackgrounds();
    await user.click(dialog.getByTestId('photo-edit-retouch-toggle'));
    expect(dialog.getByTestId('photo-edit-retouch-keys')).toBeInTheDocument();
    const canvas = await screen.findByTestId('photo-edit-retouch-canvas');
    expect(canvas).toHaveAttribute('tabindex', '0');
    canvas.focus();
    // Atajos de tamaño y de modo con el foco en la foto.
    expect(dialog.getByTestId('photo-edit-brush-size')).toHaveValue('4');
    await user.keyboard(']]');
    expect(dialog.getByTestId('photo-edit-brush-size')).toHaveValue('6');
    await user.keyboard('[[');
    expect(dialog.getByTestId('photo-edit-brush-size')).toHaveValue('5');
    await user.keyboard('x');
    expect(dialog.getByTestId('photo-edit-brush-remove')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('x');
    expect(dialog.getByTestId('photo-edit-brush-add')).toHaveAttribute('aria-checked', 'true');
    // Mover sin pintar no deja trazos; bajar el lápiz, mover y levantarlo deja uno.
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeDisabled();
    await user.keyboard(' {ArrowDown}{ArrowDown}{Shift>}{ArrowLeft}{/Shift} ');
    await waitFor(() => expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeEnabled());
    // Esc con el lápiz bajado solo lo levanta (deja un toque) y no cierra la pantalla.
    await user.keyboard(' {Escape}');
    expect(screen.getByTestId('photo-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('photo-edit-discard')).not.toBeInTheDocument();
    // Ctrl+Z deshace un trazo cada vez (con el foco en la foto): eran dos.
    await user.keyboard('{Control>}z{/Control}');
    expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeEnabled();
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(dialog.getByTestId('photo-edit-retouch-undo')).toBeDisabled());
    // También con el foco en el panel.
    dialog.getByTestId('photo-edit-brush-size').focus();
    await user.keyboard(']');
    expect(dialog.getByTestId('photo-edit-brush-size')).toHaveValue('6');
  });

  it('el velo de color se puede quitar para ver el recorte sobre el ajedrez', async () => {
    stubStageGeometry();
    const { user, dialog } = await cutAndOpenBackgrounds();
    await user.click(dialog.getByTestId('photo-edit-retouch-toggle'));
    const veil = dialog.getByTestId('photo-edit-retouch-veil');
    expect(veil).toBeChecked();
    await user.click(veil);
    expect(veil).not.toBeChecked();
    expect(await screen.findByTestId('photo-edit-retouch-canvas')).toHaveAccessibleName(/retocar la selección/i);
  });

  it('una foto que ya viene sin fondo no ofrece retrato ni retoque (no hay fondo que desenfocar)', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [
      asset('foto-1', 'sin-fondo.png', { mime_type: 'image/png' }),
    ]);
    const dialog = await openEditDialog(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await dialog.findByTestId('photo-edit-backgrounds');
    expect(dialog.queryByTestId('photo-edit-portrait')).not.toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-retouch-toggle')).not.toBeInTheDocument();
    // «Desenfocar» lo explica y no deja guardar.
    await user.click(dialog.getByTestId('photo-edit-bg-mode-blur'));
    expect(dialog.getByTestId('photo-edit-blur-unavailable')).toHaveTextContent(/no hay nada que desenfocar/);
    expect(dialog.getByTestId('photo-edit-save')).toBeDisabled();
  });
});

// ───────────────── «Fondo con IA»: un solo recorte, resultado a la vista y textos del sector ─────────────────

/** Recorte de prueba: la mitad izquierda es lo principal. */
function halfCutout(image: Pixels) {
  const out = new Uint8ClampedArray(image.data);
  for (let i = 0; i < image.width * image.height; i += 1) out[i * 4 + 3] = i % image.width < image.width / 2 ? 255 : 0;
  return {
    pixels: { data: out, width: image.width, height: image.height },
    model: 'ben2-test',
    provider: 'webgpu' as const,
    engine: 'ben2' as const,
    quality: 'high' as const,
    fromCache: true,
  };
}

async function openAiTab(user: Awaited<ReturnType<typeof openPhoto>>['user']) {
  const dialog = await openEditDialog(user);
  return dialog;
}

describe('Fondo con IA: un solo recorte', () => {
  it('si ya se quitó el fondo en la pestaña «Fondo», «Fondo con IA» reutiliza ese recorte y no recorta otra vez', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    const cut = vi
      .spyOn(cutoutEngine, 'removeBackgroundInBrowser')
      .mockImplementation(async (image) => halfCutout(image));
    vi.spyOn(libraryApi, 'deleteAssets').mockResolvedValue(undefined);
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openAiTab(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    await dialog.findByTestId('photo-edit-backgrounds');
    expect(cut).toHaveBeenCalledTimes(1);

    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    expect(ai.getByText(/no se vuelve a recortar/i)).toBeInTheDocument();
    await user.click(ai.getByRole('button', { name: 'mantel de lino beige' }));
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));
    expect(await dialog.findByTestId('photo-edit-ai-review')).toBeInTheDocument();
    expect(cut).toHaveBeenCalledTimes(1);
    const sent = calls.find((c) => c.action === 'photo.edit')!.input as Record<string, unknown>;
    expect(typeof sent.subjectMask).toBe('string');
  });

  it('si la foto ya viene sin fondo, usa su propio alfa y no recorta', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    const cut = vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser');
    mocks.loadPixels.mockImplementation(async (url: string) => {
      if (!/sin[- ]fondo/i.test(url))
        return { pixels: pixels(120, 90), reduced: false, natural: { width: 120, height: 90 } };
      const p = pixels(40, 30);
      for (let i = 0; i < 40 * 30; i += 1) p.data[i * 4 + 3] = i % 40 < 12 ? 255 : 0;
      return { pixels: p, reduced: false, natural: { width: 40, height: 30 } };
    });
    const { user } = await openPhoto({ orgRole: 'owner' }, [
      asset('sin-fondo', 'sin-fondo.png', {
        mime_type: 'image/png',
        provenance: {
          type: 'photo_edit',
          steps: [{ kind: 'remove_background', engine: 'browser', model: 'ben2-test' }],
        },
      }),
    ]);
    const dialog = await openAiTab(user);
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    expect(ai.getByText(/no se vuelve a recortar/i)).toBeInTheDocument();
    await user.click(ai.getByRole('button', { name: 'pizarra oscura' }));
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));
    expect(await dialog.findByTestId('photo-edit-ai-review')).toBeInTheDocument();
    expect(cut).not.toHaveBeenCalled();
    expect(typeof (calls.find((c) => c.action === 'photo.edit')!.input as Record<string, unknown>).subjectMask).toBe(
      'string',
    );
  });

  it('el recorte hecho desde «Cambiar con IA» queda para «Quitar» (se recorta una sola vez en total)', async () => {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    fakeBackgroundAi([]);
    const cut = vi
      .spyOn(cutoutEngine, 'removeBackgroundInBrowser')
      .mockImplementation(async (image) => halfCutout(image));
    vi.spyOn(libraryApi, 'deleteAssets').mockResolvedValue(undefined);
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openAiTab(user);
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    await user.click(ai.getByRole('button', { name: 'pizarra oscura' }));
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));
    await dialog.findByTestId('photo-edit-ai-review');
    await user.click(dialog.getByRole('radio', { name: 'Quitar' }));
    expect(await dialog.findByTestId('photo-edit-backgrounds')).toBeInTheDocument();
    expect(cut).toHaveBeenCalledTimes(1);
  });
});

describe('Fondo con IA: ver el resultado antes de aplicarlo', () => {
  async function runOnce() {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(async (image) => halfCutout(image));
    const removed = vi.spyOn(libraryApi, 'deleteAssets').mockResolvedValue(undefined);
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openAiTab(user);
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    await user.click(ai.getByRole('button', { name: 'mantel de lino beige' }));
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));
    await dialog.findByTestId('photo-edit-ai-review');
    return { user, dialog, calls, removed };
  }

  it('enseña el resultado en la vista previa, compara antes/después y dice lo que costó el intento', async () => {
    const paint = vi.spyOn(canvasModule, 'paint');
    const { user, dialog } = await runOnce();
    const review = within(dialog.getByTestId('photo-edit-ai-review'));
    expect(review.getByTestId('photo-edit-ai-attempt-cost')).toHaveTextContent('Este intento ha costado 0,20');
    expect(review.getByTestId('photo-edit-ai-after')).toHaveAttribute('aria-pressed', 'true');
    // Nada se aplica hasta «Usar esta».
    expect(dialog.queryByTestId('photo-edit-result')).not.toBeInTheDocument();
    expect(uploaded).toHaveLength(0);
    const shownAfter = paint.mock.calls.at(-1)![1];
    await user.click(review.getByTestId('photo-edit-ai-before'));
    expect(review.getByTestId('photo-edit-ai-before')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(paint.mock.calls.at(-1)![1]).not.toBe(shownAfter));
    await user.click(review.getByTestId('photo-edit-ai-after'));
    await waitFor(() => expect(paint.mock.calls.at(-1)![1]).toBe(shownAfter));
    // «Usar esta» guarda la versión con lo principal intacto y la deja en la lista.
    await user.click(review.getByTestId('photo-edit-ai-use'));
    expect(await dialog.findByTestId('photo-edit-result')).toHaveTextContent('Fondo nuevo · plato.jpg');
    expect(dialog.queryByTestId('photo-edit-ai-review')).not.toBeInTheDocument();
  });

  it('«Probar otra vez» descarta el intento, repite con la misma indicación y suma el coste de cada intento', async () => {
    const { user, dialog, calls, removed } = await runOnce();
    await user.click(within(dialog.getByTestId('photo-edit-ai-review')).getByTestId('photo-edit-ai-retry'));
    await waitFor(() => expect(calls.filter((c) => c.action === 'photo.edit')).toHaveLength(2));
    expect(removed).toHaveBeenCalledWith(['fondo-ia']);
    const second = calls.filter((c) => c.action === 'photo.edit')[1]!.input as Record<string, unknown>;
    expect(second).toMatchObject({ operation: 'replace_background', prompt: 'mantel de lino beige' });
    const review = within(await dialog.findByText(/Intento 2/).then(() => dialog.getByTestId('photo-edit-ai-review')));
    expect(review.getByTestId('photo-edit-ai-attempt-cost')).toHaveTextContent(
      /Este intento ha costado 0,20.*En total llevas 0,40 .* 2 intentos/,
    );
  });

  it('«Cambiar la indicación» vuelve al texto, con la misma indicación escrita y el gasto hecho', async () => {
    const { user, dialog, removed } = await runOnce();
    await user.click(within(dialog.getByTestId('photo-edit-ai-review')).getByTestId('photo-edit-ai-change'));
    const field = await dialog.findByTestId('photo-edit-ai-background-text');
    expect(field).toHaveValue('mantel de lino beige');
    expect(dialog.queryByTestId('photo-edit-ai-review')).not.toBeInTheDocument();
    expect(removed).toHaveBeenCalledWith(['fondo-ia']);
    expect(dialog.getByTestId('photo-edit-ai-attempts')).toHaveTextContent(/Intentos hechos: 1.*0,20/);
    expect(dialog.getByTestId('photo-edit-ai-run-replace_background')).toHaveTextContent('Cambiar el fondo otra vez');
  });
});

describe('Quitar el fondo: progreso por fases y un solo texto de privacidad', () => {
  it('en el navegador dice dónde recorta, cuánto suele tardar y cuánto lleva, y se puede cancelar', async () => {
    let release: (() => void) | undefined;
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(
      (image, onProgress, options) =>
        new Promise((resolve, reject) => {
          onProgress?.({ phase: 'running' });
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('x'), { name: 'AbortError' })),
          );
          release = () => resolve(halfCutout(image));
        }),
    );
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openAiTab(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    // Antes de empezar: un único texto de privacidad, coherente con que solo hay navegador.
    expect(dialog.getAllByText(/no sale de él/)).toHaveLength(1);
    expect(dialog.queryByText(/en el servidor/)).not.toBeInTheDocument();
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    expect(await dialog.findByTestId('photo-edit-cutout-phase')).toHaveTextContent('Recortando en tu equipo');
    expect(dialog.getByTestId('photo-edit-cutout-elapsed')).toHaveTextContent(
      /Suele tardar entre 5 y 30 segundos\. Llevas \d+ s\./,
    );
    expect(dialog.getByRole('progressbar')).toBeInTheDocument();
    await user.click(dialog.getByTestId('photo-edit-cutout-cancel'));
    await waitFor(() => expect(dialog.queryByTestId('photo-edit-cutout-progress')).not.toBeInTheDocument());
    release?.();
  });

  it('con el trabajador del servidor encendido, el texto antes de empezar lo dice y las fases se cuentan', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(
      (image, onProgress) =>
        new Promise((resolve) => {
          onProgress?.({ phase: 'server-job', state: 'queued' });
          setTimeout(() => {
            onProgress?.({ phase: 'server-job', state: 'running' });
            setTimeout(() => resolve(halfCutout(image)), 300);
          }, 100);
        }),
    );
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openAiTab(user);
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    expect(dialog.getByTestId('photo-edit-cutout-privacy')).toHaveTextContent(/servidor de la aplicación/);
    expect(dialog.getByTestId('photo-edit-cutout-privacy')).toHaveTextContent(/la foto no sale de él/);
    await user.click(await dialog.findByTestId('photo-edit-cutout-run'));
    expect(await dialog.findByTestId('photo-edit-cutout-phase')).toHaveTextContent(
      /Paso 2 de 4: En cola en el servidor/,
    );
  });
});

describe('Fondo con IA: textos según el sector de la marca', () => {
  async function openAs(sector: string) {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeBackgroundAi(calls);
    vi.spyOn(cutoutEngine, 'removeBackgroundInBrowser').mockImplementation(async (image) => halfCutout(image));
    vi.spyOn(libraryApi, 'deleteAssets').mockResolvedValue(undefined);
    seedWorkspace({ orgRole: 'owner', brands: [brandRow({ sector })] });
    fake.tables.media_assets = [asset('foto-1', 'foto.jpg')];
    fake.tables.jobs = [];
    fake.tables.brand_profiles = [];
    const app = renderApp(`${BRAND_BASE}/biblioteca`);
    await app.user.click(await screen.findByTestId('library-asset'));
    await screen.findByRole('dialog');
    const dialog = await openEditDialog(app.user);
    await openChangeWithAi(app.user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    return { user: app.user, dialog, ai, calls };
  }

  it('un gimnasio no ve fondos ni avisos de restaurante y manda «otra cosa» a la IA', async () => {
    const { user, dialog, ai, calls } = await openAs('Gimnasio');
    const ideas = ai.getAllByTestId('photo-edit-ai-background-idea').map((b) => b.textContent ?? '');
    expect(ideas.join(' ')).toMatch(/entrenamiento/);
    expect(ideas.join(' ')).not.toMatch(/mármol|mantel|pizarra/);
    await user.click(ai.getAllByTestId('photo-edit-ai-background-idea')[0]!);
    await user.click(ai.getByTestId('photo-edit-ai-run-replace_background'));
    await dialog.findByTestId('photo-edit-ai-review');
    expect(calls.find((c) => c.action === 'photo.edit')!.input).toMatchObject({ subject: 'other' });
    expect(screen.getByTestId('photo-edit').textContent).not.toMatch(/plato|guarnición/i);
  });

  it('una coctelería ve ideas de barra y manda «bebida»; un sector desconocido, ideas neutras', async () => {
    const cocktail = await openAs('Coctelería');
    expect(cocktail.ai.getAllByTestId('photo-edit-ai-background-idea')[0]).toHaveTextContent(/barra/);
    await cocktail.user.click(cocktail.ai.getAllByTestId('photo-edit-ai-background-idea')[0]!);
    await cocktail.user.click(cocktail.ai.getByTestId('photo-edit-ai-run-replace_background'));
    await cocktail.dialog.findByTestId('photo-edit-ai-review');
    expect(cocktail.calls.find((c) => c.action === 'photo.edit')!.input).toMatchObject({ subject: 'drink' });
  });

  it('un restaurante conserva sus ideas y sus textos de comida', async () => {
    const { ai } = await openAs('Restauración');
    expect(ai.getAllByTestId('photo-edit-ai-background-idea').map((b) => b.textContent)).toContain(
      'mesa de mármol blanco con luz cálida',
    );
  });
});

// ───────────────── Tres pestañas: cada acción en un solo sitio, sin «Mejorar con IA» y sin cupos en autogestión ─────────────────

describe('«Editar foto» en tres pestañas', () => {
  /** `ai-media` simulado con las cuatro ediciones (también «Mejorar con IA», que no se ofrece). */
  function fakeAllAi(calls: Array<{ action: string; input?: unknown }>) {
    fake.fn('ai-media', (body) => {
      const { action, input } = body as { action: string; input?: Record<string, unknown> };
      calls.push({ action, input });
      const choice = (operation: string) => ({
        operation,
        model: `openai:${operation}`,
        delivery: 'sync',
        dataRegion: 'global',
        euProcessing: false,
        trainsOnInputs: 'no',
        untestedAdapter: false,
        usesSubjectMask: operation === 'replace_background',
      });
      if (action === 'photo.options') {
        return {
          status: 200,
          body: {
            action,
            edits: ['remove_background', 'upscale', 'replace_background', 'enhance'].map(choice),
          },
        };
      }
      return { status: 200, body: { action, costMicros: 200_000, model: 'openai:x' } };
    });
  }

  async function openWith(workMode: 'self' | 'agency') {
    vi.stubEnv('VITE_AI_PHOTO_EDIT_ENABLED', 'true');
    const calls: Array<{ action: string; input?: unknown }> = [];
    fakeAllAi(calls);
    seedWorkspace({ orgRole: 'owner', workMode });
    fake.tables.media_assets = [asset('foto-1', 'plato.jpg')];
    fake.tables.jobs = [];
    fake.tables.brand_profiles = [];
    const app = renderApp(`${BRAND_BASE}/biblioteca`);
    await app.user.click(await screen.findByTestId('library-asset'));
    await screen.findByRole('dialog');
    const dialog = await openEditDialog(app.user);
    await waitFor(() => expect(calls.some((c) => c.action === 'photo.options')).toBe(true));
    return { user: app.user, dialog, calls };
  }

  it('«Mejorar con IA» no se ofrece aunque el servidor lo tenga; la mejora sin IA sigue', async () => {
    const { user, dialog } = await openWith('self');
    // Lo demás de IA sí llega (Ampliar en Recortar), así que las opciones ya están cargadas.
    await user.click(dialog.getByRole('tab', { name: 'Recortar' }));
    expect(await dialog.findByTestId('photo-edit-ai-upscale')).toBeInTheDocument();
    for (const name of ['Ajustar', 'Recortar', 'Fondo']) {
      await user.click(dialog.getByRole('tab', { name }));
      expect(dialog.queryByTestId('photo-edit-ai-enhance')).not.toBeInTheDocument();
      expect(dialog.queryByText(/Mejorar con IA/)).not.toBeInTheDocument();
    }
    await user.click(dialog.getByRole('tab', { name: 'Ajustar' }));
    expect(dialog.getByTestId('photo-edit-auto')).toHaveTextContent('Mejorar automáticamente');
  });

  it('Ajustar enseña cuatro deslizadores y el resto en «Más ajustes»; sin encuadre (está en Recortar)', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    const more = dialog.getByTestId('photo-edit-more-adjustments');
    for (const key of ['exposure', 'contrast', 'saturation', 'warmth']) {
      expect(more).not.toContainElement(dialog.getByTestId(`photo-edit-${key}`));
    }
    for (const key of ['sharpness', 'shadows', 'highlights', 'clarity', 'vibrance']) {
      expect(more).toContainElement(dialog.getByTestId(`photo-edit-${key}`));
    }
    expect(more).not.toHaveAttribute('open');
    expect(dialog.queryByTestId('photo-edit-framing')).not.toBeInTheDocument();
    expect(dialog.queryByTestId('photo-edit-reset')).not.toBeInTheDocument();
  });

  it('lo ajustado y el recorte se guardan en UNA copia, aunque se hagan en pestañas distintas', async () => {
    const { user } = await openPhoto({ orgRole: 'owner' }, [asset('foto-1', 'plato.jpg')]);
    const dialog = await openEditDialog(user);
    fireEvent.change(dialog.getByTestId('photo-edit-exposure'), { target: { value: '20' } });
    await user.click(dialog.getByRole('tab', { name: 'Recortar' }));
    await user.click(await dialog.findByTestId('photo-edit-crop-1:1'));
    // Volver a Ajustar no pierde nada.
    await user.click(dialog.getByRole('tab', { name: 'Ajustar' }));
    expect(dialog.getByTestId('photo-edit-exposure')).toHaveValue('20');
    await user.click(dialog.getByTestId('photo-edit-save'));
    await waitFor(() => expect(uploaded).toHaveLength(1));
    const steps = (uploaded[0]!.provenance as { steps: Array<{ kind: string }> }).steps;
    expect(steps.map((step) => step.kind)).toEqual(['adjust', 'crop']);
    expect(uploaded[0]!.dimensions).toEqual({ width: 90, height: 90, durationMs: null });
  });

  it('en autogestión el coste se dice sin hablar de cupos; el aviso de fuera de la UE sigue a la vista', async () => {
    const { user, dialog } = await openWith('self');
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    expect(await ai.findByTestId('photo-edit-ai-cost')).toHaveTextContent('Coste máximo: 0,20');
    expect(ai.getByTestId('photo-edit-ai-cost')).not.toHaveTextContent(/cupo/);
    expect(screen.getByTestId('photo-edit').textContent).not.toMatch(/cupo/i);
    expect(ai.getByText('Se procesa fuera de la UE o en región desconocida')).toBeInTheDocument();
    // Una línea a la vista; el detalle, en «Más información».
    expect(ai.getByText(/Usa IA \(OpenAI\) solo para el fondo/)).toBeInTheDocument();
    expect(ai.getByTestId('photo-edit-ai-mask-info').closest('details')).not.toHaveAttribute('open');
  });

  it('en modo agencia todo queda como estaba: el coste dice que se descuenta del cupo', async () => {
    const { user, dialog } = await openWith('agency');
    await openChangeWithAi(user, dialog);
    const ai = within(await dialog.findByTestId('photo-edit-ai-replace_background'));
    expect(await ai.findByTestId('photo-edit-ai-cost')).toHaveTextContent(
      /Coste máximo: 0,20.*\(se descuenta del cupo de IA de la organización\)\./,
    );
  });

  it('«Cambiar con IA» no tiene botón principal: se decide con «Usar esta»; Quitar y Desenfocar sí', async () => {
    const { user, dialog } = await openWith('self');
    await user.click(dialog.getByRole('tab', { name: 'Fondo' }));
    expect(dialog.getByTestId('photo-edit-save')).toBeInTheDocument();
    await openChangeWithAi(user, dialog);
    await dialog.findByTestId('photo-edit-ai-replace_background');
    expect(dialog.queryByTestId('photo-edit-save')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('radio', { name: 'Desenfocar' }));
    expect(dialog.getByTestId('photo-edit-save')).toBeInTheDocument();
  });
});
