// Lo que un plan del copiloto pide al editor (planHost.ts): que llame a lo que ya
// existe con lo justo —`ai-media` para el precio y el fondo, la biblioteca para
// las fotos y la cadena de recorte para quitar el fondo— y que no repita un
// recorte que ya está en la biblioteca. Todo lo de fuera está simulado.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaAssetRow } from '@/lib/database.types';
import { createCopilotPlanHost } from './planHost';

const mocks = vi.hoisted(() => ({
  invokeAiMedia: vi.fn(),
  generateImageAndWait: vi.fn(),
  fetchRecentImages: vi.fn(),
  fetchAsset: vi.fn(),
  fetchPhotoEdits: vi.fn(),
  signedUrlFor: vi.fn(),
  runQuickEdit: vi.fn(),
  canRemoveBackground: vi.fn(() => true),
}));

vi.mock('@/features/ai/imageApi', () => ({
  invokeAiMedia: mocks.invokeAiMedia,
  generateImageAndWait: mocks.generateImageAndWait,
}));
vi.mock('@/features/library/api', () => ({ fetchRecentImages: mocks.fetchRecentImages }));
vi.mock('@/features/photo-edit/api', () => ({
  canEditPhoto: (row: { kind: string; mime_type: string }) => row.kind === 'image' && row.mime_type !== 'image/gif',
  fetchAsset: mocks.fetchAsset,
  fetchPhotoEdits: mocks.fetchPhotoEdits,
  signedUrlFor: mocks.signedUrlFor,
}));
vi.mock('@/features/photo-edit/cutout/remover', () => ({
  canRemoveBackground: mocks.canRemoveBackground,
  describeRemovalError: (error: unknown) => (error instanceof Error && error.name === 'NoSubjectError' ? 'No se ha encontrado nada que recortar.' : ''),
}));
vi.mock('@/features/photo-edit/quickEdit', () => ({ runQuickEdit: mocks.runQuickEdit }));

const BRAND = 'marca-1';
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`;
const row = (n: number, fileName: string, extra: Partial<MediaAssetRow> = {}): MediaAssetRow =>
  ({
    id: id(n),
    brand_id: BRAND,
    organization_id: 'org-1',
    kind: 'image',
    origin: 'uploaded',
    storage_path: `org-1/${BRAND}/media/${n}.jpg`,
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
    ...extra,
  }) as MediaAssetRow;
const cutoutOf = (n: number, source: number, steps: unknown[] = [{ kind: 'remove_background', engine: 'browser', model: 'ben2' }]) =>
  row(n, `foto (sin fondo).png`, { folder: 'Ediciones', provenance: { type: 'photo_edit', source_asset_id: id(source), steps } as never });

function makeHost(overrides: Partial<Parameters<typeof createCopilotPlanHost>[0]> = {}) {
  const saveEdit = vi.fn();
  const onLibraryChange = vi.fn();
  const host = createCopilotPlanHost({ brandId: BRAND, imageAi: { available: true }, saveEdit, onLibraryChange, ...overrides });
  return { host, saveEdit, onLibraryChange };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.canRemoveBackground.mockReturnValue(true);
  mocks.fetchPhotoEdits.mockResolvedValue([]);
  mocks.signedUrlFor.mockResolvedValue('https://archivos.test/foto.jpg');
});

describe('lo que el editor ofrece a un plan del copiloto', () => {
  it('dice si hay IA de imagen y si se puede recortar, tal como se lo da el editor', () => {
    expect(makeHost().host).toMatchObject({ imageAi: { available: true }, canCutout: true });
    mocks.canRemoveBackground.mockReturnValue(false);
    const reason = 'En modo agencia, la imagen con IA la usa solo el personal de la agencia.';
    expect(makeHost({ imageAi: { available: false, reason } }).host).toMatchObject({ imageAi: { available: false, reason }, canCutout: false });
  });

  it('el precio del fondo es el de `image.estimate`: no reserva nada, y si no se puede saber, se dice (null)', async () => {
    const { host } = makeHost();
    mocks.invokeAiMedia.mockResolvedValue({ action: 'image.estimate', model: 'm', costMicros: 140_000, size: { width: 896, height: 1152 } });
    expect(await host.estimateBackground('4:5')).toBe(140_000);
    expect(mocks.invokeAiMedia).toHaveBeenCalledWith('image.estimate', BRAND, { prompt: '', aspectRatio: '4:5' });
    mocks.invokeAiMedia.mockRejectedValue(new Error('sin modelo'));
    expect(await host.estimateBackground('1:1')).toBeNull();
    mocks.invokeAiMedia.mockResolvedValue({ action: 'image.estimate' });
    expect(await host.estimateBackground('1:1')).toBeNull();
    expect(mocks.generateImageAndWait).not.toHaveBeenCalled();
  });

  it('el fondo se genera con `ai-media` (que lo guarda en la biblioteca) y se avisa de que la biblioteca ha cambiado', async () => {
    const { host, onLibraryChange } = makeHost();
    const signal = new AbortController().signal;
    mocks.generateImageAndWait.mockResolvedValue(row(9, 'IA · fondo.png', { origin: 'generated', width: 1024, height: 1280 }));
    const background = await host.generateBackground('Madera clara. Fondo…', '9:16', signal);
    expect(background).toEqual({ id: id(9), name: 'IA · fondo.png', width: 1024, height: 1280 });
    expect(mocks.generateImageAndWait).toHaveBeenCalledWith(BRAND, { prompt: 'Madera clara. Fondo…', aspectRatio: '9:16' }, { signal });
    expect(onLibraryChange).toHaveBeenCalledTimes(1);
    // Un fallo (cupo, proveedor…) llega tal cual a quien ejecuta el plan.
    mocks.generateImageAndWait.mockRejectedValue(new Error('sin cupo'));
    await expect(host.generateBackground('x', '1:1', signal)).rejects.toThrow('sin cupo');
  });

  it('busca entre las fotos de la marca y nunca devuelve una imagen generada con IA', async () => {
    const { host } = makeHost();
    mocks.fetchRecentImages.mockResolvedValue([
      row(1, 'crema-calabaza.jpg', { tags: ['plato', 'otoño'] }),
      row(2, 'plato-ia.png', { tags: ['plato'], provenance: { type: 'ai_generation' } as never }),
      row(3, 'terraza.jpg'),
      row(4, 'IMG_1.jpg', { folder: 'Platos' }),
    ]);
    expect(await host.searchLibrary('platos de otoño', 3)).toEqual([
      { id: id(1), name: 'crema-calabaza.jpg', width: 1200, height: 900 },
      { id: id(4), name: 'IMG_1.jpg', width: 1200, height: 900 },
    ]);
    expect(mocks.fetchRecentImages).toHaveBeenCalledWith(BRAND);
    expect(await host.searchLibrary('hamburguesas', 3)).toEqual([]);
  });

  it('quita el fondo con la cadena de siempre y guarda el recorte como recurso nuevo de la biblioteca', async () => {
    const { host, saveEdit, onLibraryChange } = makeHost();
    const signal = new AbortController().signal;
    const source = row(1, 'crema.jpg');
    mocks.fetchAsset.mockResolvedValue(source);
    mocks.runQuickEdit.mockResolvedValue(cutoutOf(5, 1));
    const result = await host.cutout({ id: id(1), name: 'crema.jpg' }, signal);
    expect(result).toEqual({ asset: { id: id(5), name: 'foto (sin fondo).png', width: 1200, height: 900 }, created: true });
    expect(mocks.fetchAsset).toHaveBeenCalledWith(BRAND, id(1));
    expect(mocks.signedUrlFor).toHaveBeenCalledWith(source.storage_path);
    expect(mocks.runQuickEdit).toHaveBeenCalledWith({
      asset: source,
      url: 'https://archivos.test/foto.jpg',
      edit: { kind: 'cutout' },
      save: saveEdit,
      signal,
    });
    expect(onLibraryChange).toHaveBeenCalledTimes(1);
  });

  it('no recorta dos veces: una foto ya recortada, o con un recorte suyo en la biblioteca, se usa tal cual', async () => {
    const { host, onLibraryChange } = makeHost();
    const signal = new AbortController().signal;
    // La foto ya es un recorte.
    mocks.fetchAsset.mockResolvedValue(cutoutOf(5, 1));
    expect(await host.cutout({ id: id(5), name: 'x' }, signal)).toMatchObject({ asset: { id: id(5) }, created: false });
    // Hay un recorte de esta foto en la biblioteca (y otra edición suya que no es «la foto sin fondo»).
    mocks.fetchAsset.mockResolvedValue(row(1, 'crema.jpg'));
    mocks.fetchPhotoEdits.mockResolvedValue([cutoutOf(7, 1, [{ kind: 'remove_background' }, { kind: 'background' }]), cutoutOf(6, 1)]);
    expect(await host.cutout({ id: id(1), name: 'crema.jpg' }, signal)).toMatchObject({ asset: { id: id(6) }, created: false });
    expect(mocks.fetchPhotoEdits).toHaveBeenCalledWith(BRAND, id(1));
    expect(mocks.runQuickEdit).not.toHaveBeenCalled();
    expect(onLibraryChange).not.toHaveBeenCalled();
  });

  it('si no se puede recortar, lo dice con un motivo para personas; cancelado, no lo disfraza', async () => {
    const { host } = makeHost();
    const controller = new AbortController();
    mocks.fetchAsset.mockResolvedValue(null);
    await expect(host.cutout({ id: id(1), name: 'x' }, controller.signal)).rejects.toThrow('Esa foto no se puede recortar.');
    mocks.fetchAsset.mockResolvedValue(row(1, 'animada.gif', { mime_type: 'image/gif' }));
    await expect(host.cutout({ id: id(1), name: 'x' }, controller.signal)).rejects.toThrow('Esa foto no se puede recortar.');
    mocks.fetchAsset.mockResolvedValue(row(1, 'crema.jpg'));
    mocks.signedUrlFor.mockResolvedValue(undefined);
    await expect(host.cutout({ id: id(1), name: 'x' }, controller.signal)).rejects.toThrow('No se ha podido abrir la foto.');
    mocks.signedUrlFor.mockResolvedValue('https://archivos.test/foto.jpg');
    const nothing = new Error('interno');
    nothing.name = 'NoSubjectError';
    mocks.runQuickEdit.mockRejectedValue(nothing);
    await expect(host.cutout({ id: id(1), name: 'x' }, controller.signal)).rejects.toThrow('No se ha encontrado nada que recortar.');
    // Cancelado: el error original sigue su camino (quien ejecuta el plan mira la señal).
    const aborted = new DOMException('Cancelado', 'AbortError');
    mocks.runQuickEdit.mockRejectedValue(aborted);
    controller.abort();
    await expect(host.cutout({ id: id(1), name: 'x' }, controller.signal)).rejects.toBe(aborted);
  });
});
