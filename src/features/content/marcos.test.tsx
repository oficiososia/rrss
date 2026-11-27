import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_DRAG_TYPE } from '@/features/library/PhotoPanel';
import * as libraryApi from '@/features/library/api';
import { BRAND_ID, ORG_ID, renderApp } from '@/test/fixtures';
import { buildPublications, CATALOG_SETS, NEUTRAL_THEME } from '../../../agency/catalogo/index.ts';
import {
  contentDocumentSchema,
  DOCUMENT_SCHEMA_VERSION,
  isEmptyFrame,
  migrateDocument,
  validateDocumentFromAnyVersion,
  type ImageLayer,
  type Layer,
} from './document';
import { ASSET_DRAG_TYPE, readAssetDrag, writeAssetDrag } from './editor/assetDrag';
import { describeLayer } from './editor/canvas/nodes';
import {
  frameAt,
  framePillSpot,
  frameToFill,
  newPhotoLayer,
  panFrame,
  replacePhotoPatch,
  visibleWindow,
  zoomFrame,
} from './editor/frames';
import { coverCrop } from './editor/geometry';
import { applyLayerPatch } from './editor/history';
import { assetRow, canvas, EDITOR, frame, PHOTO_A, PHOTO_B, photo, seedPiece, text } from './editorTestKit';
import { captionAsHint, photoCount } from './templates/api';

// Marcos de foto: el hueco de una plantilla ofrece «Poner foto», la foto entra
// DENTRO del marco (no a lienzo completo encima de todo), se recoloca y se
// amplía dentro, y «Sustituir» conserva el marco y los efectos. El lienzo de
// Konva se sustituye por un doble; lo que depende de Konva (el botón dibujado,
// el clic, el encuadre arrastrando) está en tests/layout/editor-marcos.spec.ts.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
  default: (await import('./editorTestCanvas')).CanvasStub,
}));
// La subida a la biblioteca se espía (la aplicación ya está cargada cuando corre la prueba).
const uploadAsset = vi.fn<typeof libraryApi.uploadAsset>();

const PHOTO_C = '33333333-3333-4333-8333-333333333333';
const layerOf = (id: string) => canvas().document.layers.find((layer) => layer.id === id)!;

async function openEditor(options?: Parameters<typeof seedPiece>[0]) {
  seedPiece(options);
  const app = renderApp(EDITOR);
  await screen.findByTestId('canvas-stub');
  return app;
}

/** Elige una foto en el selector abierto, por su nombre de archivo. */
async function pick(user: ReturnType<typeof renderApp>['user'], name: string, title: string) {
  const dialog = within(await screen.findByRole('dialog', { name: title }));
  const option = (await dialog.findAllByTestId('picker-asset')).find((button) => button.textContent?.includes(name))!;
  await user.click(option);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument());
}

beforeEach(() => {
  uploadAsset.mockReset();
  vi.spyOn(libraryApi, 'uploadAsset').mockImplementation(uploadAsset);
});

describe('Editor: marcos de foto', () => {
  it('el hueco de una plantilla ofrece «Poner foto»: la foto entra en el marco, con su caja, y no hay capa nueva', async () => {
    const { user } = await openEditor();
    expect(screen.getByTestId('editor-empty-frames')).toHaveTextContent('Falta 1 foto');
    // En el panel, un hueco no es «una forma con relleno y borde»: dice qué es y cómo ponerle la foto.
    await user.click(screen.getByTestId('stub-foto'));
    await pick(user, 'chuleton.jpg', 'Poner foto');

    const filled = layerOf('foto') as ImageLayer;
    expect(filled.source).toEqual({ kind: 'asset', assetId: PHOTO_A });
    expect(filled).toMatchObject({ frame: true, fit: 'cover', x: 0, y: 0, width: 1080, height: 700 });
    // El marco conserva su nombre («Foto del plato»): dice qué foto va ahí.
    expect(filled.name).toBe('Foto del plato');
    expect(canvas().document.layers.map((layer) => layer.id)).toEqual(['foto', 'titulo']);
    expect(screen.queryByTestId('editor-empty-frames')).not.toBeInTheDocument();
    // Queda elegida, con la barra de la foto a mano.
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', 'foto');
    expect(screen.getByTestId('bar-replace-photo')).toBeInTheDocument();
  });

  it('un hueco vacío elegido tiene su «Poner foto» en la barra; sus ajustes explican qué es', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-foto'));
    // El clic ya abre el selector: se cierra para ver la barra.
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('bar-more'));
    await user.click(await screen.findByTestId('menu-more-options'));
    const panel = within(screen.getByTestId('empty-frame-panel'));
    expect(panel.getByText(/Es un hueco para una foto/)).toBeInTheDocument();
    expect(panel.getByText(/no sale en la imagen/)).toBeInTheDocument();
    await user.click(screen.getByTestId('bar-place-photo'));
    expect(await screen.findByRole('dialog', { name: 'Poner foto' })).toBeInTheDocument();
  });

  it('una foto del cajón «Fotos» con un hueco vacío en la página va al hueco, no a lienzo completo encima', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('drawer-photos'));
    const items = await within(await screen.findByTestId('editor-photos')).findAllByTestId('photo-panel-item');
    await user.click(items.find((item) => item.getAttribute('title') === 'arroz.jpg')!);
    expect(canvas().document.layers).toHaveLength(2);
    expect((layerOf('foto') as ImageLayer).source).toEqual({ kind: 'asset', assetId: PHOTO_B });
  });

  it('sin huecos, una foto del cajón se añade con su proporción y sin tapar el diseño', async () => {
    const { user } = await openEditor({ layers: [text('titulo', 'Nombre del plato')] });
    await user.click(screen.getByTestId('drawer-photos'));
    const items = await within(await screen.findByTestId('editor-photos')).findAllByTestId('photo-panel-item');
    await user.click(items.find((item) => item.getAttribute('title') === 'chuleton.jpg')!);
    const added = canvas().document.layers.at(-1) as ImageLayer;
    expect(added.type).toBe('image');
    // 1200 × 800 → 3:2, como mucho el 70 % del lienzo (1080 × 1350) y centrada.
    expect(added.width / added.height).toBeCloseTo(1.5, 1);
    expect(added.width).toBeLessThanOrEqual(1080 * 0.7);
    expect(added.x).toBeGreaterThan(0);
    expect(added.y).toBeGreaterThan(0);
  });

  it('las fotos de la marca están a mano en el cajón «Fotos»: tocar una rellena el hueco, sin diálogo', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('drawer-photos'));
    const photos = within(await screen.findByTestId('editor-photos'));
    expect(photos.getByText(/Toca una foto para ponerla en el diseño/)).toBeInTheDocument();
    const items = await photos.findAllByTestId('photo-panel-item');
    expect(items).toHaveLength(2);
    await user.click(items.find((item) => item.getAttribute('title') === 'arroz.jpg')!);
    expect((layerOf('foto') as ImageLayer).source).toEqual({ kind: 'asset', assetId: PHOTO_B });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // En una pantalla estrecha la hoja del cajón se cierra para ver cómo ha quedado.
    expect(screen.queryByTestId('editor-photos')).not.toBeInTheDocument();
  });

  it('con un hueco concreto elegido, la foto que se toca va a ese hueco y no al primero', async () => {
    const { user } = await openEditor({ layers: [frame('antes'), frame('despues', { y: 700 })] });
    act(() => canvas().onSelect('despues'));
    await user.click(screen.getByTestId('drawer-photos'));
    const photos = within(await screen.findByTestId('editor-photos'));
    expect(photos.getByText('Toca una foto para ponerla en el hueco elegido.')).toBeInTheDocument();
    await user.click((await photos.findAllByTestId('photo-panel-item'))[0]!);
    expect((layerOf('despues') as ImageLayer).source.kind).toBe('asset');
    expect((layerOf('antes') as ImageLayer).source).toEqual({ kind: 'empty' });
  });

  it('soltar una foto de la biblioteca sobre un marco lo rellena; fuera de un marco, es una capa nueva en ese punto', async () => {
    await openEditor();
    act(() =>
      canvas().onDrop!({
        asset: { id: PHOTO_B, name: 'arroz.jpg', width: 800, height: 1200 },
        files: [],
        rejected: 0,
        at: { x: 500, y: 300 },
        frameId: 'foto',
      }),
    );
    expect((layerOf('foto') as ImageLayer).source).toEqual({ kind: 'asset', assetId: PHOTO_B });
    expect(canvas().document.layers).toHaveLength(2);

    act(() =>
      canvas().onDrop!({
        asset: { id: PHOTO_A, name: 'chuleton.jpg', width: 1200, height: 800 },
        files: [],
        rejected: 0,
        at: { x: 540, y: 1100 },
        frameId: null,
      }),
    );
    const added = canvas().document.layers.at(-1) as ImageLayer;
    expect(canvas().document.layers).toHaveLength(3);
    expect(added.source).toEqual({ kind: 'asset', assetId: PHOTO_A });
    // Centrada donde se soltó (sin salirse del lienzo).
    expect(added.x + added.width / 2).toBeCloseTo(540, 0);
    expect(added.y + added.height).toBeLessThanOrEqual(1350);
  });

  it('soltar un archivo del dispositivo lo sube a la biblioteca y lo pone en el marco', async () => {
    uploadAsset.mockResolvedValue(assetRow(PHOTO_C, { file_name: 'nueva.jpg' }));
    await openEditor();
    const file = new File(['x'], 'nueva.jpg', { type: 'image/jpeg' });
    act(() => canvas().onDrop!({ asset: null, files: [file], rejected: 0, at: { x: 500, y: 300 }, frameId: 'foto' }));
    await waitFor(() => expect((layerOf('foto') as ImageLayer).source).toEqual({ kind: 'asset', assetId: PHOTO_C }));
    expect(uploadAsset).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      brandId: BRAND_ID,
      file,
      kind: 'image',
    });
    expect(await screen.findByText('Foto añadida. Queda también en la biblioteca.')).toBeInTheDocument();
  });

  it('lo que se suelta y no es una foto se rechaza con un aviso claro', async () => {
    await openEditor();
    act(() => canvas().onDrop!({ asset: null, files: [], rejected: 1, at: null, frameId: null }));
    expect(await screen.findByText('Solo se pueden soltar fotos JPG, PNG o WebP.')).toBeInTheDocument();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('«Sustituir» conserva el marco y los efectos, y quita lo que era de la foto anterior', async () => {
    const { user } = await openEditor({
      layers: [
        photo('foto', PHOTO_A, {
          frame: true,
          name: 'Foto del plato',
          adjust: { brightness: 10, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, filter: 'bw' },
          shadow: { color: '#000000', blur: 12, offsetX: 0, offsetY: 4, opacity: 0.4 },
          crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
          zoom: 2,
          focus: { x: 0.2, y: 0.8 },
          rotation: 5,
        }),
      ],
    });
    await user.click(screen.getByTestId('stub-foto'));
    await user.click(screen.getByTestId('bar-replace-photo'));
    await pick(user, 'arroz.jpg', 'Sustituir la foto');

    const replaced = layerOf('foto') as ImageLayer;
    expect(replaced.source).toEqual({ kind: 'asset', assetId: PHOTO_B });
    // El marco (caja, giro) y los efectos se quedan…
    expect(replaced).toMatchObject({
      frame: true,
      x: 100,
      y: 100,
      width: 600,
      height: 400,
      rotation: 5,
      name: 'Foto del plato',
    });
    expect(replaced.adjust?.filter).toBe('bw');
    expect(replaced.shadow?.blur).toBe(12);
    // …y el recorte y el encuadre de la foto anterior, no.
    expect(replaced.crop).toBeUndefined();
    expect(replaced.zoom).toBeUndefined();
    expect(replaced.focus).toEqual({ x: 0.5, y: 0.5 });
    // Se deshace de un golpe.
    await user.click(screen.getByTestId('undo'));
    expect((layerOf('foto') as ImageLayer).source).toEqual({ kind: 'asset', assetId: PHOTO_A });
  });

  it('doble clic en una foto entra en «encuadrar»: mover y ampliar dentro del marco es un solo paso de deshacer', async () => {
    const { user } = await openEditor({ layers: [photo('foto', PHOTO_A, { frame: true })] });
    await user.dblClick(screen.getByTestId('stub-foto'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-framing', 'foto');

    act(() => canvas().onFrameChange!('foto', { focus: { x: 0.3, y: 0.5 } }));
    act(() => canvas().onFrameChange!('foto', { focus: { x: 0.25, y: 0.5 }, zoom: 2 }));
    expect(layerOf('foto')).toMatchObject({ focus: { x: 0.25, y: 0.5 }, zoom: 2, width: 600, height: 400 });
    act(() => canvas().onFramingEnd!());
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-framing', '');

    await user.click(screen.getByTestId('undo'));
    const back = layerOf('foto') as ImageLayer;
    expect(back.focus).toEqual({ x: 0.5, y: 0.5 });
    expect(back.zoom).toBeUndefined();
  });

  it('«Quitar la foto y dejar el hueco» vuelve a dejar un marco vacío con la misma caja', async () => {
    const { user } = await openEditor({ layers: [photo('foto')] });
    await user.click(screen.getByTestId('stub-foto'));
    await user.click(screen.getByTestId('bar-more'));
    await user.click(await screen.findByTestId('menu-empty-frame'));
    const emptied = layerOf('foto') as ImageLayer;
    expect(emptied.source).toEqual({ kind: 'empty' });
    expect(emptied).toMatchObject({ frame: true, x: 100, y: 100, width: 600, height: 400 });
    expect(screen.getByTestId('editor-empty-frames')).toBeInTheDocument();
  });
});

describe('Marcos de foto: documento v6', () => {
  const placeholder = {
    id: 'p1-foto',
    name: 'Foto de antes (sustituir)',
    type: 'shape',
    shape: 'rectangle',
    x: 0,
    y: 0,
    width: 1080,
    height: 663,
    fill: '#5A6068',
    anchor: { x: 'stretch', y: 'stretch' },
  };
  const v5 = (layers: unknown[], copy: object = {}) => ({
    schemaVersion: 5,
    canvas: { aspectRatio: '4:5', width: 1080, height: 1350, backgroundColor: '#FFFFFF' },
    pages: [{ id: 'p1', layers }],
    copy,
  });

  it('el marcador de foto de una plantilla v5 («… (sustituir)») pasa a ser un marco vacío con la misma caja', () => {
    const document = migrateDocument(v5([placeholder, { ...placeholder, id: 'fondo', name: 'Fondo' }]));
    expect(document.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
    const [first, second] = document.pages[0]!.layers as [ImageLayer, Layer];
    expect(first).toMatchObject({
      id: 'p1-foto',
      type: 'image',
      name: 'Foto de antes',
      source: { kind: 'empty' },
      frame: true,
      fit: 'cover',
      x: 0,
      y: 0,
      width: 1080,
      height: 663,
      anchor: { x: 'stretch', y: 'stretch' },
    });
    // Un rectángulo cualquiera no se toca.
    expect(second).toMatchObject({ id: 'fondo', type: 'shape', fill: '#5A6068' });
  });

  it('un documento v5 no trae marcos ni pie de ejemplo: si los trajera, se quitan al convertirlo', () => {
    const image = {
      id: 'i',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      source: { kind: 'asset', assetId: PHOTO_A },
      frame: true,
      zoom: 3,
    };
    const document = migrateDocument(v5([image], { caption: 'Pie real', captionHint: 'no debería' }));
    const layer = document.pages[0]!.layers[0] as ImageLayer;
    expect(layer.frame).toBeUndefined();
    expect(layer.zoom).toBeUndefined();
    expect(document.copy).toMatchObject({ caption: 'Pie real' });
    expect(document.copy.captionHint).toBeUndefined();
  });

  it('el esquema admite el marco vacío, la ampliación y el pie de ejemplo, y limita la ampliación', () => {
    const ok = validateDocumentFromAnyVersion({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      canvas: { aspectRatio: '1:1', width: 1080, height: 1080 },
      pages: [{ id: 'p1', layers: [frame('a'), photo('b', PHOTO_A, { zoom: 2.5 })] }],
      copy: { captionHint: 'Qué es y cuánto cuesta' },
    });
    expect(ok.ok).toBe(true);
    const bad = contentDocumentSchema.safeParse({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      canvas: { aspectRatio: '1:1', width: 1080, height: 1080 },
      pages: [{ id: 'p1', layers: [photo('b', PHOTO_A, { zoom: 9 })] }],
    });
    expect(bad.success).toBe(false);
  });

  it('un marco vacío se dibuja como hueco en el editor (y la exportación lo salta por esa marca)', () => {
    const spec = describeLayer(frame('a', { name: 'Retrato' }), new Map());
    expect(spec).toMatchObject({ kind: 'image', frame: 'empty', url: null, placeholder: 'Retrato', zoom: 1 });
    const filled = describeLayer(
      photo('b', PHOTO_A, { frame: true, zoom: 2 }),
      new Map([[PHOTO_A, 'https://x/y.jpg']]),
    );
    expect(filled).toMatchObject({ kind: 'image', frame: 'filled', url: 'https://x/y.jpg', zoom: 2 });
    expect(describeLayer(photo('c'), new Map())).toMatchObject({ frame: null });
  });

  it('las plantillas del catálogo usan marcos vacíos y su pie es una indicación, no el texto que se publica', () => {
    let frames = 0;
    for (const set of CATALOG_SETS) {
      const file = buildPublications(set, NEUTRAL_THEME);
      for (const template of file.templates) {
        const parsed = validateDocumentFromAnyVersion(template.document);
        expect(parsed.ok, template.key).toBe(true);
        if (!parsed.ok) continue;
        const layers = parsed.document.pages.flatMap((page) => page.layers);
        // Ningún marcador viejo: ni formas llamadas «(sustituir)» ni fotos sin marca de marco.
        expect(
          layers.filter((layer) => /sustituir/i.test(layer.name)),
          template.key,
        ).toEqual([]);
        for (const layer of layers) {
          if (layer.type !== 'image') continue;
          frames += 1;
          expect(isEmptyFrame(layer), template.key).toBe(true);
          expect(layer.frame, template.key).toBe(true);
        }
        expect(photoCount(parsed.document)).toBe(layers.filter((layer) => layer.type === 'image').length);
        expect(parsed.document.copy.caption, template.key).toBe('');
        expect(parsed.document.copy.captionHint?.length ?? 0, template.key).toBeGreaterThan(10);
      }
    }
    expect(frames).toBeGreaterThan(10);
  });

  it('al leer una plantilla guardada, su pie pasa a ser el pie de ejemplo (y un pie de ejemplo propio se respeta)', () => {
    const document = validateDocumentFromAnyVersion(v5([], { caption: 'Qué es, cuánto cuesta y hasta cuándo.' }));
    if (!document.ok) throw new Error('documento no válido');
    const hinted = captionAsHint(document.document);
    expect(hinted.copy.caption).toBe('');
    expect(hinted.copy.captionHint).toBe('Qué es, cuánto cuesta y hasta cuándo.');
    const own = captionAsHint({ ...document.document, copy: { ...document.document.copy, captionHint: 'Ya tenía' } });
    expect(own.copy).toMatchObject({ caption: '', captionHint: 'Ya tenía' });
    const empty = { ...document.document, copy: { ...document.document.copy, caption: '  ' } };
    expect(captionAsHint(empty)).toBe(empty);
  });
});

describe('Marcos de foto: cuentas', () => {
  const box = { width: 400, height: 400 };

  it('la parte visible de la foto coincide con el recorte que se dibuja, con y sin ampliación', () => {
    // Foto 3:2 en una caja cuadrada: se ve todo el alto y dos tercios del ancho.
    const view = visibleWindow(1.5, box, { x: 0.5, y: 0.5 });
    expect(view.width).toBeCloseTo(2 / 3);
    expect(view.height).toBeCloseTo(1);
    const crop = coverCrop({ width: 1200, height: 800 }, box, { x: 0.5, y: 0.5 });
    expect(crop.width / 1200).toBeCloseTo(view.width);
    expect(crop.x / 1200).toBeCloseTo(view.x);

    const zoomed = visibleWindow(1.5, box, { x: 0.2, y: 0.9 }, 2);
    const zoomedCrop = coverCrop({ width: 1200, height: 800 }, box, { x: 0.2, y: 0.9 }, 2);
    expect(zoomedCrop.width / 1200).toBeCloseTo(zoomed.width);
    expect(zoomedCrop.height / 800).toBeCloseTo(zoomed.height);
    expect(zoomedCrop.x / 1200).toBeCloseTo(zoomed.x);
    expect(zoomedCrop.y / 800).toBeCloseTo(zoomed.y);
  });

  it('arrastrar mueve la foto con el puntero y nunca deja ver fuera de ella', () => {
    // Arrastrar 100 unidades a la derecha: se ve lo de más a la izquierda.
    const moved = panFrame(1.5, box, { x: 0.5, y: 0.5 }, 1, { dx: 100, dy: 0 });
    expect(moved.x).toBeLessThan(0.5);
    expect(moved.y).toBeCloseTo(0.5);
    // Al tope: por mucho que se arrastre, el borde de la foto se queda en el borde del marco.
    const edge = panFrame(1.5, box, { x: 0.5, y: 0.5 }, 1, { dx: 10_000, dy: 10_000 });
    const view = visibleWindow(1.5, box, edge, 1);
    expect(view.x).toBeCloseTo(0);
    expect(view.y).toBeCloseTo(0);
  });

  it('ampliar conserva el centro de lo que se ve y no pasa del máximo; sin ampliar, el campo desaparece', () => {
    const { focus, zoom } = zoomFrame(1.5, box, { x: 0.1, y: 0.5 }, 1, 2);
    expect(zoom).toBe(2);
    // El punto de interés pedido (0,1) no se podía centrar sin ampliar: se toma el centro real de lo visible.
    expect(focus.x).toBeCloseTo(1 / 3);
    expect(zoomFrame(1.5, box, focus, 2, 99).zoom).toBe(5);
    expect(zoomFrame(1.5, box, focus, 2, 0.5).zoom).toBeUndefined();
    expect((applyLayerPatch(photo('p', PHOTO_A, { zoom: 2 }), { zoom: 1 }) as ImageLayer).zoom).toBeUndefined();
  });

  it('una foto soltada va al marco de más arriba bajo el puntero, aunque esté girado; una foto suelta no cuenta', () => {
    const layers: Layer[] = [
      frame('fondo', { x: 0, y: 0, width: 1080, height: 1350 }),
      photo('suelta', PHOTO_A, { x: 100, y: 100, width: 300, height: 300 }),
      frame('pequeno', { x: 600, y: 600, width: 200, height: 200, rotation: 45 }),
      frame('bloqueado', { x: 0, y: 1000, width: 200, height: 200, locked: true }),
    ];
    expect(frameAt(layers, { x: 700, y: 700 })?.id).toBe('pequeno');
    // La esquina de la caja sin girar queda fuera del marco girado: cae en el de fondo.
    expect(frameAt(layers, { x: 605, y: 605 })?.id).toBe('fondo');
    expect(frameAt(layers, { x: 200, y: 200 })?.id).toBe('fondo');
    expect(frameAt(layers, { x: 100, y: 1100 })?.id).toBe('fondo');
    expect(frameAt([photo('suelta')], { x: 200, y: 200 })).toBeNull();
  });

  it('sin decir dónde, la foto va al marco vacío elegido o, si no, al primero vacío de la página', () => {
    const layers: Layer[] = [frame('a'), frame('b'), photo('c', PHOTO_A, { frame: true })];
    expect(frameToFill(layers, [])?.id).toBe('a');
    expect(frameToFill(layers, ['b'])?.id).toBe('b');
    expect(frameToFill(layers, ['c'])?.id).toBe('a');
    expect(frameToFill([photo('c')], [])).toBeNull();
  });

  it('la foto nueva sobre un diseño entra con su proporción, hasta el 70 % del lienzo y sin salirse', () => {
    const size = { aspectRatio: '4:5' as const, width: 1080, height: 1350, backgroundColor: '#FFFFFF' };
    const tall = newPhotoLayer(
      size,
      [],
      { id: PHOTO_B, name: 'arroz.jpg', width: 800, height: 1200 },
      { x: 1070, y: 10 },
    );
    expect(tall.width / tall.height).toBeCloseTo(2 / 3, 1);
    expect(tall.height).toBeLessThanOrEqual(1350 * 0.7 + 1);
    expect(tall.x + tall.width).toBeLessThanOrEqual(1080);
    expect(tall.y).toBeGreaterThanOrEqual(0);
  });

  it('el botón «Poner foto» esquiva un titular que tape el centro del marco', () => {
    const whole = { x: 0, y: 0, width: 1080, height: 1350 };
    const pill = { width: 300, height: 90 };
    expect(framePillSpot(whole, [], pill)).toEqual({ x: 540, y: 675 });
    const title = { x: 72, y: 490, width: 936, height: 330 };
    expect(framePillSpot(whole, [title], pill)).toEqual({ x: 540, y: 270 });
    // Si arriba también hay texto, abajo.
    expect(framePillSpot(whole, [title, { x: 72, y: 200, width: 936, height: 120 }], pill).y).toBe(1080);
  });

  it('sustituir la foto no toca la caja ni los efectos', () => {
    const patch = replacePhotoPatch(PHOTO_B);
    expect(Object.keys(patch).sort()).toEqual(
      ['crop', 'flipX', 'flipY', 'focus', 'source', 'straighten', 'turn', 'zoom'].sort(),
    );
  });
});

describe('Arrastrar una foto de la biblioteca', () => {
  it('el lienzo entiende el dato que deja el panel de fotos de la biblioteca', () => {
    expect(ASSET_DRAG_TYPE).toBe(PHOTO_DRAG_TYPE);
    const data = new Map<string, string>();
    const transfer = {
      setData: (type: string, value: string) => void data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      effectAllowed: 'none',
    } as unknown as DataTransfer;
    // Lo que escribe el panel de la biblioteca: `{ assetId, fileName }`.
    transfer.setData(PHOTO_DRAG_TYPE, JSON.stringify({ assetId: PHOTO_A, fileName: 'chuleton.jpg' }));
    expect(readAssetDrag(transfer)).toEqual({ id: PHOTO_A, name: 'chuleton.jpg', width: null, height: null });
    // Con medidas, la foto entra con su proporción.
    writeAssetDrag(transfer, { id: PHOTO_B, name: 'arroz.jpg', width: 800, height: 1200 });
    expect(readAssetDrag(transfer)).toEqual({ id: PHOTO_B, name: 'arroz.jpg', width: 800, height: 1200 });
    // Lo que no es nuestro o no es un recurso válido se ignora.
    transfer.setData(PHOTO_DRAG_TYPE, JSON.stringify({ assetId: 'javascript:alert(1)' }));
    expect(readAssetDrag(transfer)).toBeNull();
    transfer.setData(PHOTO_DRAG_TYPE, 'no es json');
    expect(readAssetDrag(transfer)).toBeNull();
  });
});
