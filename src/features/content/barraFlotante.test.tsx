import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as libraryApi from '@/features/library/api';
import * as remover from '@/features/photo-edit/cutout/remover';
import { fake } from '@/test/fakeSupabase';
import { renderApp } from '@/test/fixtures';
import type { ImageLayer, ShapeLayer, TextLayer } from './document';
import { clearClipboard } from './editor/clipboard';
import {
  boundsOf,
  placeToolbar,
  ROTATE_HANDLE_ROOM,
  TEXT_WEIGHT,
  TOOLBAR_GAP,
  TOOLBAR_MARGIN,
} from './editor/toolbarPlacement';
import { assetRow, canvas, EDITOR, frame, PHOTO_A, photo, seedPiece, shape, text } from './editorTestKit';

// Barra de acciones del elemento elegido (flota sobre el lienzo, también en el
// móvil), Esc al escribir sobre el lienzo y lo habitual de un editor: copiar,
// pegar y duplicar entre páginas, pegar una imagen, menú del botón derecho,
// bloquear y agrupar. El lienzo es un doble que enseña la barra tal cual; dónde
// se coloca de verdad se prueba aquí con sus cuentas y, en un navegador, en
// tests/layout/editor-marcos.spec.ts.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
  default: (await import('./editorTestCanvas')).CanvasStub,
}));

const PHOTO_C = '33333333-3333-4333-8333-333333333333';
const layerOf = <T,>(id: string) => canvas().document.layers.find((layer) => layer.id === id) as T;
const ids = () => canvas().document.layers.map((layer) => layer.id);
const bar = () => within(screen.getByTestId('selection-toolbar'));

async function openEditor(options?: Parameters<typeof seedPiece>[0]) {
  seedPiece(options);
  const app = renderApp(EDITOR);
  await screen.findByTestId('canvas-stub');
  return app;
}

beforeEach(() => {
  clearClipboard();
  // Las fotos de la biblioteca tienen dirección (el almacenamiento simulado no firma nada por defecto).
  const storage = fake.storage.from();
  vi.spyOn(fake.storage, 'from').mockImplementation(() => ({
    ...storage,
    createSignedUrls: (async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://cdn.test/${path}` })),
      error: null,
    })) as unknown as typeof storage.createSignedUrls,
  }));
});

describe('Barra de acciones sobre el elemento elegido', () => {
  it('sin nada elegido no hay barra; al elegir una foto ofrece sustituir, editar y recortar; lo demás (duplicar, borrar, quitar el fondo…), solo en «⋯»', async () => {
    vi.spyOn(remover, 'canRemoveBackground').mockReturnValue(true);
    const { user } = await openEditor({ layers: [photo('foto'), text('titulo', 'Hola')] });
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('stub-foto'));
    expect(screen.getByRole('toolbar', { name: 'Acciones de foto.jpg' })).toBeInTheDocument();
    // Las que necesitan la foto ya cargada aparecen en cuanto llega su dirección.
    await waitFor(() => expect(bar().getByTestId('bar-edit-photo')).toBeInTheDocument());
    const names = bar()
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Sustituir', 'Editar foto', 'Recortar', 'Más acciones']);
    // Cada acción en un solo sitio: ni duplicar ni borrar en la barra, ni un panel fijo que los repita.
    expect(screen.queryByTestId('editor-panels')).not.toBeInTheDocument();

    await user.click(bar().getByTestId('bar-more'));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByTestId('menu-remove-background')).toBeInTheDocument();
    await user.click(menu.getByTestId('menu-duplicate'));
    expect(ids()).toHaveLength(3);
    // La copia queda elegida: la barra sigue ahí, ahora para ella.
    expect(screen.getByTestId('canvas-stub').getAttribute('data-selected')).not.toBe('foto');
    await user.click(bar().getByTestId('bar-more'));
    await user.click(await screen.findByTestId('menu-delete'));
    expect(ids()).toEqual(['foto', 'titulo']);
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument();
  });

  it('«Recortar» abre el recorte de esa foto y «Sustituir», el selector de fotos', async () => {
    const { user } = await openEditor({ layers: [photo('foto')] });
    await user.click(screen.getByTestId('stub-foto'));
    await user.click(await screen.findByTestId('bar-crop'));
    expect(await screen.findByRole('dialog', { name: /Recortar/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('bar-replace-photo'));
    expect(await screen.findByRole('dialog', { name: 'Sustituir la foto' })).toBeInTheDocument();
  });

  it('con un hueco vacío elegido, la barra ofrece «Poner foto»', async () => {
    const { user } = await openEditor({ layers: [frame('hueco'), text('titulo', 'Hola')] });
    await user.click(screen.getByTestId('stub-hueco'));
    await user.keyboard('{Escape}'); // el clic ya abre el selector
    await user.click(screen.getByTestId('stub-titulo'));
    await user.click(screen.getByTestId('stub-hueco'));
    await user.keyboard('{Escape}');
    expect(bar().getByTestId('bar-place-photo')).toHaveTextContent('Poner foto');
    expect(bar().queryByTestId('bar-edit-photo')).not.toBeInTheDocument();
  });

  it('con un texto: tipografía, tamaño −/+, color y alineación cambian la capa', async () => {
    const { user } = await openEditor({ layers: [text('titulo', 'Hola', { fontSize: 60, align: 'left' })] });
    await user.click(screen.getByTestId('stub-titulo'));

    await user.click(bar().getByTestId('bar-size-up'));
    await user.click(bar().getByTestId('bar-size-up'));
    expect(layerOf<TextLayer>('titulo').fontSize).toBe(68);
    expect(bar().getByTestId('bar-size')).toHaveTextContent('68');
    await user.click(bar().getByTestId('bar-size-down'));
    expect(layerOf<TextLayer>('titulo').fontSize).toBe(64);
    // Varios toques seguidos al tamaño son un solo paso de deshacer.
    await user.click(screen.getByTestId('undo'));
    expect(layerOf<TextLayer>('titulo').fontSize).toBe(60);

    await user.selectOptions(bar().getByTestId('bar-font'), 'serif');
    expect(layerOf<TextLayer>('titulo').fontFamily).toBe('serif');

    const align = bar().getByTestId('bar-align');
    expect(align).toHaveAccessibleName(/Alineación: izquierda/);
    await user.click(align);
    expect(layerOf<TextLayer>('titulo').align).toBe('center');
    await user.click(bar().getByTestId('bar-align'));
    expect(layerOf<TextLayer>('titulo').align).toBe('right');

    // El color: primero los de la marca (aquí no tiene) y siempre «Otro color…».
    await user.click(bar().getByTestId('bar-color'));
    expect(await screen.findByText('Otro color…')).toBeInTheDocument();
    expect(screen.getByText('La marca aún no tiene colores')).toBeInTheDocument();
  });

  it('«Escribir» abre el texto sobre el lienzo y Esc sale conservando lo escrito (Ctrl+Z lo deshace)', async () => {
    const { user } = await openEditor({ layers: [text('titulo', 'Nombre del menú o del plato')] });
    await user.click(screen.getByTestId('stub-titulo'));
    await user.click(bar().getByTestId('bar-edit-text'));
    const field = await screen.findByTestId('canvas-text-editor');
    expect(field).toHaveFocus();
    // Mientras se escribe no hay barra flotante encima del texto (no cambia el documento a medias).
    await user.clear(field);
    await user.type(field, 'Menú de otoño');
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('canvas-text-editor')).not.toBeInTheDocument();
    expect(layerOf<TextLayer>('titulo').text).toBe('Menú de otoño');
    expect(screen.getByTestId('stub-titulo')).toHaveTextContent('Menú de otoño');
    // Para volver atrás está deshacer, no Esc.
    await user.click(screen.getByTestId('undo'));
    expect(layerOf<TextLayer>('titulo').text).toBe('Nombre del menú o del plato');
  });

  it('con una forma: su color y «⋯»', async () => {
    const { user } = await openEditor({ layers: [shape('caja', { fill: '#E5E7EB' })] });
    await user.click(screen.getByTestId('stub-caja'));
    expect(bar().getByTestId('bar-color')).toHaveAccessibleName('Color');
    const names = bar()
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Color', 'Más acciones']);
    // El selector libre del sistema cambia el relleno.
    const free = screen.getByTestId('selection-toolbar').querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(free, { target: { value: '#ff0000' } });
    expect(layerOf<ShapeLayer>('caja').fill).toBe('#FF0000');
  });

  it('con varias: agrupar y desagrupar; en «⋯», alinear y bloquear; bloqueadas, solo «Desbloquear»', async () => {
    const { user } = await openEditor({
      layers: [shape('a', { x: 100 }), shape('b', { x: 400 }), text('titulo', 'Hola')],
    });
    await user.click(screen.getByTestId('stub-a'));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByTestId('stub-b'));
    await user.keyboard('{/Shift}');
    expect(screen.getByRole('toolbar', { name: 'Acciones de 2 capas' })).toBeInTheDocument();

    await user.click(bar().getByTestId('bar-group'));
    expect(layerOf<ShapeLayer>('a').groupId).toBeTruthy();
    expect(layerOf<ShapeLayer>('a').groupId).toBe(layerOf<ShapeLayer>('b').groupId);
    await user.click(bar().getByTestId('bar-ungroup'));
    expect(layerOf<ShapeLayer>('a').groupId).toBeUndefined();

    await user.click(bar().getByTestId('bar-more'));
    await user.click(await screen.findByTestId('menu-align-left'));
    expect(layerOf<ShapeLayer>('b').x).toBe(100);

    await user.click(bar().getByTestId('bar-more'));
    await user.click(await screen.findByTestId('menu-lock'));
    expect(layerOf<ShapeLayer>('a').locked).toBe(true);
    expect(layerOf<ShapeLayer>('b').locked).toBe(true);
    // Bloqueadas: solo desbloquear (y «⋯», donde borrar no se puede).
    expect(bar().getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Desbloquear', 'Más acciones']);
    await user.click(bar().getByTestId('bar-unlock'));
    expect(layerOf<ShapeLayer>('a').locked).toBe(false);
  });

  it('en solo lectura no hay barra de acciones', async () => {
    const { user } = await openEditor({ role: { orgRole: 'member', brandRole: 'viewer' } });
    await user.click(screen.getByTestId('stub-titulo'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', 'titulo');
    expect(screen.queryByTestId('selection-toolbar')).not.toBeInTheDocument();
  });
});

describe('Dónde se coloca la barra', () => {
  const area = { width: 800, height: 600 };
  const bar = { width: 300, height: 44 };

  it('encima del elemento y centrada con él, sin taparlo', () => {
    const place = placeToolbar({ left: 300, top: 200, right: 500, bottom: 300 }, bar, area);
    expect(place.side).toBe('above');
    expect(place.top + bar.height).toBeLessThanOrEqual(200 - TOOLBAR_GAP);
    expect(place.left).toBe(250);
  });

  it('si arriba no cabe, debajo (dejando sitio al tirador de girar)', () => {
    const place = placeToolbar({ left: 300, top: 10, right: 500, bottom: 110 }, bar, area);
    expect(place.side).toBe('below');
    expect(place.top).toBe(110 + TOOLBAR_GAP + ROTATE_HANDLE_ROOM);
  });

  it('nunca se sale por los lados, ni con un elemento pegado al borde ni en una pantalla de 375 px', () => {
    const left = placeToolbar({ left: 0, top: 200, right: 40, bottom: 260 }, bar, area);
    expect(left.left).toBe(TOOLBAR_MARGIN);
    const right = placeToolbar({ left: 780, top: 200, right: 800, bottom: 260 }, bar, area);
    expect(right.left + bar.width).toBeLessThanOrEqual(area.width - TOOLBAR_MARGIN);
    const phone = placeToolbar(
      { left: 20, top: 300, right: 355, bottom: 360 },
      { width: 340, height: 48 },
      { width: 343, height: 500 },
    );
    expect(phone.left).toBeGreaterThanOrEqual(0);
    expect(phone.left + 340).toBeLessThanOrEqual(343);
    expect(phone.side).toBe('above');
  });

  it('solo si el elemento llena el lienzo queda encima de él, pegada arriba', () => {
    const place = placeToolbar({ left: 0, top: 0, right: 800, bottom: 600 }, bar, area);
    expect(place).toMatchObject({ side: 'edge', top: TOOLBAR_MARGIN });
  });

  it('no tapa los textos: con un titular justo debajo de la foto elegida, se va a un lado', () => {
    // Una foto arriba (como «Oferta de la semana») y el titular debajo: debajo de la foto pisaría el titular.
    const photo = { left: 250, top: 0, right: 550, bottom: 360 };
    const title = { left: 270, top: 380, right: 530, bottom: 470, weight: TEXT_WEIGHT };
    const place = placeToolbar(photo, bar, { width: 1000, height: 600 }, [title]);
    expect(place.side).toBe('beside');
    expect(place.left).toBeGreaterThanOrEqual(550);
    // Sin sitio a los lados: pegada al borde de abajo, donde no hay ni foto ni texto.
    const narrow = placeToolbar(photo, bar, { width: 800, height: 600 }, [title]);
    expect(narrow).toMatchObject({ side: 'edge', top: 600 - bar.height - TOOLBAR_MARGIN });
    // Y si abajo también hay texto, encima de la foto antes que encima de un texto.
    const footer = { left: 0, top: 540, right: 800, bottom: 600, weight: TEXT_WEIGHT };
    expect(placeToolbar(photo, bar, { width: 800, height: 600 }, [title, footer])).toMatchObject({
      side: 'edge',
      top: TOOLBAR_MARGIN,
    });
  });

  it('pegada al borde, elige el de abajo si arriba hay un texto', () => {
    const photo = { left: 0, top: 0, right: 800, bottom: 600 };
    const title = { left: 100, top: 10, right: 700, bottom: 80, weight: TEXT_WEIGHT };
    const place = placeToolbar(photo, bar, area, [title]);
    expect(place.side).toBe('edge');
    expect(place.top).toBe(area.height - bar.height - TOOLBAR_MARGIN);
  });

  it('la caja de varias capas (o de una girada) es la que las contiene enteras', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        { x: 300, y: 200, width: 100, height: 50, rotation: 0 },
      ]),
    ).toEqual({ left: 0, top: 0, right: 400, bottom: 250 });
    const turned = boundsOf([{ x: 0, y: 0, width: 100, height: 100, rotation: 45 }])!;
    expect(turned.right - turned.left).toBeCloseTo(141.42, 1);
  });
});

describe('Lo habitual de un editor', () => {
  it('Ctrl+C y pegar llevan una capa a otra página; Ctrl+D duplica y Ctrl+X corta', async () => {
    const { user } = await openEditor({
      layers: [shape('a'), text('titulo', 'Hola')],
      secondPage: [shape('otra')],
    });
    await user.click(screen.getByTestId('stub-titulo'));
    await user.keyboard('{Control>}c{/Control}');

    // A la segunda página y pegar: cae en el mismo sitio (es otra página) y queda elegida.
    await user.click(screen.getAllByTestId('page-thumb')[1]!);
    expect(ids()).toEqual(['otra']);
    fireEvent.paste(screen.getByTestId('canvas-stub'));
    expect(canvas().document.layers).toHaveLength(2);
    const pasted = canvas().document.layers.at(-1) as TextLayer;
    expect(pasted).toMatchObject({ type: 'text', text: 'Hola', x: 100, y: 760 });
    expect(pasted.id).not.toBe('titulo');
    expect(canvas().selectedIds).toEqual([pasted.id]);

    // Pegar otra vez en la misma página: se desplaza para que se vea que hay dos.
    fireEvent.paste(screen.getByTestId('canvas-stub'));
    const again = canvas().document.layers.at(-1) as TextLayer;
    expect(again.x).toBeGreaterThan(100);

    // Ctrl+D duplica lo elegido; Ctrl+X lo quita (y se puede volver a pegar).
    await user.click(screen.getByTestId(`stub-${again.id}`));
    await user.keyboard('{Control>}d{/Control}');
    expect(canvas().document.layers).toHaveLength(4);
    await user.keyboard('{Control>}x{/Control}');
    expect(canvas().document.layers).toHaveLength(3);
    fireEvent.paste(screen.getByTestId('canvas-stub'));
    expect(canvas().document.layers).toHaveLength(4);
    // Cada paso se deshace por separado.
    await user.click(screen.getByTestId('undo'));
    expect(canvas().document.layers).toHaveLength(3);
  });

  it('copiar un grupo lo pega como otro grupo (no se mezcla con el original)', async () => {
    const { user } = await openEditor({
      layers: [shape('a', { groupId: 'g1' }), shape('b', { groupId: 'g1', x: 700 })],
    });
    await user.click(screen.getByTestId('stub-a'));
    expect(canvas().selectedIds).toEqual(['a', 'b']);
    await user.keyboard('{Control>}c{/Control}');
    fireEvent.paste(screen.getByTestId('canvas-stub'));
    const [, , c, d] = canvas().document.layers as ShapeLayer[];
    expect(c!.groupId).toBeTruthy();
    expect(c!.groupId).toBe(d!.groupId);
    expect(c!.groupId).not.toBe('g1');
  });

  it('pegar una imagen del portapapeles la sube a la biblioteca y la pone en el diseño', async () => {
    const upload = vi
      .spyOn(libraryApi, 'uploadAsset')
      .mockResolvedValue(assetRow(PHOTO_C, { file_name: 'captura.png', mime_type: 'image/png' }));
    await openEditor({ layers: [frame('hueco'), text('titulo', 'Hola')] });
    const file = new File(['x'], 'captura.png', { type: 'image/png' });
    fireEvent.paste(screen.getByTestId('canvas-stub'), { clipboardData: { files: [file], getData: () => '' } });
    await waitFor(() => expect(layerOf<ImageLayer>('hueco').source).toEqual({ kind: 'asset', assetId: PHOTO_C }));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toMatchObject({ file, kind: 'image' });
  });

  it('pegar mientras se escribe en un campo no toca el diseño', async () => {
    const { user } = await openEditor({ layers: [text('titulo', 'Hola')] });
    await user.click(screen.getByTestId('stub-titulo'));
    await user.keyboard('{Control>}c{/Control}');
    // Escribiendo en el texto, sobre el lienzo.
    await user.dblClick(screen.getByTestId('stub-titulo'));
    fireEvent.paste(await screen.findByTestId('canvas-text-editor'));
    expect(canvas().document.layers).toHaveLength(1);
  });

  it('el botón derecho elige la capa y abre su menú: orden, duplicar, bloquear…', async () => {
    const { user } = await openEditor({ layers: [shape('a'), photo('foto'), text('titulo', 'Hola')] });
    act(() => canvas().onContextMenu!({ id: 'titulo', clientX: 200, clientY: 200 }));
    expect(canvas().selectedIds).toEqual(['titulo']);
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByTestId('menu-copy')).toBeInTheDocument();
    expect(menu.getByTestId('menu-paste')).toHaveAttribute('aria-disabled', 'true');
    await user.click(menu.getByTestId('menu-order-back'));
    expect(ids()).toEqual(['titulo', 'a', 'foto']);

    // En el fondo: pegar y elegir todo.
    act(() => canvas().onContextMenu!({ id: null, clientX: 50, clientY: 50 }));
    const empty = within(await screen.findByRole('menu'));
    expect(empty.queryByTestId('menu-delete')).not.toBeInTheDocument();
    await user.click(empty.getByTestId('menu-select-all'));
    expect(canvas().selectedIds).toEqual(['titulo', 'a', 'foto']);
  });

  it('Ctrl+A elige todo lo que no está bloqueado', async () => {
    const { user } = await openEditor({ layers: [shape('a'), shape('b', { locked: true }), text('titulo', 'Hola')] });
    await user.click(screen.getByTestId('stub-a'));
    await user.keyboard('{Control>}a{/Control}');
    expect(canvas().selectedIds).toEqual(['a', 'titulo']);
  });

  it('Intro con un hueco vacío elegido pide la foto; con una foto, la encuadra', async () => {
    const { user } = await openEditor({ layers: [frame('hueco'), photo('foto', PHOTO_A)] });
    const section = screen.getByRole('region', { name: /^Lienzo/ });
    act(() => canvas().onSelect('foto'));
    section.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-framing', 'foto');
    act(() => canvas().onFramingEnd!());
    act(() => canvas().onSelect('hueco'));
    section.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Poner foto' })).toBeInTheDocument();
  });
});
