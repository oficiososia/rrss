// Operaciones del copiloto que llegaron con la ruta de herramientas (todo lo que
// se hace a mano en el editor): cada una sobre un documento pequeño, con lo que
// cambia, lo que cuenta a la persona (`changes`, `skipped`) y lo que NO toca.
// Las ocho operaciones de la primera versión están en copilot.test.ts.
import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  pageView,
  validateDocument,
  withPageLayers,
  type ContentDocument,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type TextLayer,
} from '../document';
import { activePageIndex, editorReducer, initEditor } from '../editor/history';
import { DEFAULT_SHADOW } from '../editor/imageEffects/shadowDefaults';
import { newImageLayer, newLogoLayer, newShapeLayer, newTextLayer } from '../editor/layers';
import {
  applyCopilotOperations,
  historyActions,
  type CopilotApplyContext,
  type CopilotApplyResult,
  type PlacedCopilotOperation,
} from './apply';
import { COPILOT_SIZE_STEP, copilotOp, type CopilotOperation } from './operations';

const PHOTO = '11111111-1111-4111-8111-111111111111';
const LOOSE = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '44444444-4444-4444-8444-444444444444';
const LOGO = '22222222-2222-4222-8222-222222222222';

const op = (fields: Partial<CopilotOperation> & Pick<CopilotOperation, 'op'>): CopilotOperation => copilotOp(fields);

const context: CopilotApplyContext = {
  brand: {
    palette: [
      { hex: '#A3122A', role: 'principal' },
      { hex: '#F4E9D8', role: 'fondo' },
    ],
    fonts: ['Marca Titulares', 'Marca Texto'],
  },
  assets: new Map([
    [PHOTO, { id: PHOTO, name: 'mesa.jpg', width: 1600, height: 1200 }],
    [LOOSE, { id: LOOSE, name: 'plato.jpg', width: 400, height: 200 }],
    [LOGO, { id: LOGO, name: 'logo.png', width: 400, height: 200 }],
  ]),
  logoIds: [LOGO],
};

/**
 * Documento 4:5 con una foto de fondo, un título, una figura, una foto suelta y
 * el logotipo (en ese orden, del fondo al frente). `pages` > 1 = carrusel con
 * las demás páginas vacías.
 */
function menu(pages = 1) {
  const empty = createEmptyDocument({ aspectRatio: '4:5', pages });
  const canvas = empty.canvas;
  const background: ImageLayer = { ...newImageLayer(canvas, [], { id: PHOTO, name: 'mesa.jpg' }), id: 'fondo' };
  const title: TextLayer = {
    ...newTextLayer(canvas, [], { fontFamily: 'Marca Titulares', color: '#FFFFFF' }),
    id: 'titulo',
    text: 'Menú del día',
    y: 150,
    fontSize: 80,
    height: 100,
  };
  const shape: ShapeLayer = { ...newShapeLayer(canvas, [], 'star', '#A3122A'), id: 'forma' };
  const loose: ImageLayer = {
    ...newImageLayer(canvas, [], { id: LOOSE, name: 'plato.jpg' }),
    id: 'suelta',
    x: 300,
    y: 700,
    width: 400,
    height: 200,
    anchor: { x: 'center', y: 'center' },
  };
  const logo = { ...newLogoLayer(canvas, [], { id: LOGO, name: 'logo.png', width: 400, height: 200 }), id: 'logo' };
  const document = withPageLayers(empty, 0, [background, title, shape, loose, logo]);
  const checked = validateDocument(document);
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return checked.document;
}

function apply(document: ContentDocument, operations: PlacedCopilotOperation[], extra: Partial<CopilotApplyContext> = {}) {
  const result = applyCopilotOperations(document, operations, { ...context, ...extra });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  // Lo que sale es siempre un documento válido.
  expect(validateDocument(result.document).ok).toBe(true);
  return result;
}
type Applied = Extract<CopilotApplyResult, { ok: true }>;
const layerOf = <T extends Layer = Layer>(result: Applied | ContentDocument, id: string, page = 0): T => {
  const document = 'document' in result ? result.document : result;
  const found = document.pages[page]!.layers.find((layer) => layer.id === id);
  if (!found) throw new Error(`No está la capa ${id}`);
  return found as T;
};
const ids = (result: Applied, page = 0) => result.document.pages[page]!.layers.map((layer) => layer.id);
const lock = (document: ContentDocument, id: string) =>
  withPageLayers(
    document,
    0,
    document.pages[0]!.layers.map((layer) => (layer.id === id ? { ...layer, locked: true } : layer)),
  );

describe('copiloto: tamaño, orden, duplicar y estilo de una capa', () => {
  it('«más grande» y «más pequeño»: en un texto cambia la letra (y su caja); en lo demás, la caja desde su centro', () => {
    const document = menu();
    const bigger = apply(document, [op({ op: 'resize_layer', target: 'titulo', steps: 1 })]);
    const title = layerOf<TextLayer>(bigger, 'titulo');
    expect(title.fontSize).toBe(Math.round(80 * COPILOT_SIZE_STEP));
    expect(title.height).toBe(Math.round((100 * title.fontSize) / 80));
    expect(bigger.changes).toEqual(['«Menú del día», más grande']);
    expect(bigger.touched).toEqual(['titulo']);

    const smaller = apply(document, [op({ op: 'resize_layer', target: 'titulo', steps: -2 })]);
    expect(layerOf<TextLayer>(smaller, 'titulo').fontSize).toBe(Math.round(80 * COPILOT_SIZE_STEP ** -2));
    expect(smaller.changes).toEqual(['«Menú del día», más pequeño']);

    const before = layerOf(document, 'forma');
    const shape = layerOf(apply(document, [op({ op: 'resize_layer', target: 'forma', steps: 1 })]), 'forma');
    expect(shape.width).toBe(Math.round(before.width * COPILOT_SIZE_STEP));
    expect(shape.height).toBe(Math.round(before.height * COPILOT_SIZE_STEP));
    // Crece desde su centro (con el redondeo a píxeles enteros).
    expect(Math.abs(shape.x + shape.width / 2 - (before.x + before.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.y + shape.height / 2 - (before.y + before.height / 2))).toBeLessThanOrEqual(1);
  });

  it('tamaño: una capa bloqueada o que no existe no se toca, y una letra que ya no puede bajar lo dice', () => {
    const document = lock(menu(), 'titulo');
    const result = apply(document, [
      op({ op: 'resize_layer', target: 'titulo', steps: 1 }),
      op({ op: 'resize_layer', target: 'no-existe', steps: 1 }),
    ]);
    expect(result.document).toBe(document);
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual([
      '«Menú del día» está bloqueada.',
      'No se encuentra la capa que hay que cambiar de tamaño.',
    ]);
    const tiny = withPageLayers(
      menu(),
      0,
      menu().pages[0]!.layers.map((layer) => (layer.id === 'titulo' ? { ...layer, fontSize: 8 } : layer)),
    );
    const least = apply(tiny, [op({ op: 'resize_layer', target: 'titulo', steps: -1 })]);
    expect(least.document).toBe(tiny);
    expect(least.skipped).toEqual(['«Menú del día» ya no puede cambiar más de tamaño.']);
  });

  it('orden de apilado: al frente, al fondo y de nivel en nivel; si ya está ahí, lo dice', () => {
    const document = menu();
    expect(ids(apply(document, []))).toEqual(['fondo', 'titulo', 'forma', 'suelta', 'logo']);
    const front = apply(document, [op({ op: 'arrange_layer', target: 'titulo', order: 'front' })]);
    expect(ids(front)).toEqual(['fondo', 'forma', 'suelta', 'logo', 'titulo']);
    expect(front.changes).toEqual(['«Menú del día», al frente']);
    const back = apply(document, [op({ op: 'arrange_layer', target: 'forma', order: 'back' })]);
    expect(ids(back)).toEqual(['forma', 'fondo', 'titulo', 'suelta', 'logo']);
    expect(back.changes[0]).toMatch(/, al fondo$/);
    const steps = apply(document, [
      op({ op: 'arrange_layer', target: 'titulo', order: 'forward' }),
      op({ op: 'arrange_layer', target: 'logo', order: 'backward' }),
    ]);
    expect(ids(steps)).toEqual(['fondo', 'forma', 'titulo', 'logo', 'suelta']);
    expect(steps.changes).toEqual(['«Menú del día», un nivel más arriba', 'logo.png, un nivel más abajo']);
    const already = apply(document, [op({ op: 'arrange_layer', target: 'logo', order: 'front' })]);
    expect(already.document).toBe(document);
    expect(already.skipped).toEqual(['logo.png ya está ahí.']);
  });

  it('duplicar: una copia encima, desplazada, con otro identificador y sin bloqueo (también de una capa bloqueada)', () => {
    const document = lock(menu(), 'titulo');
    const result = apply(document, [op({ op: 'duplicate_layer', target: 'titulo' })]);
    const layers = result.document.pages[0]!.layers;
    expect(layers).toHaveLength(6);
    const copy = layers[5] as TextLayer;
    const source = layerOf<TextLayer>(document, 'titulo');
    expect(copy).toMatchObject({ type: 'text', text: 'Menú del día', locked: false, fontSize: 80 });
    expect(copy.id).not.toBe('titulo');
    expect(copy.x).toBeGreaterThan(source.x);
    expect(copy.y).toBeGreaterThan(source.y);
    // La original sigue igual, bloqueada.
    expect(layerOf(result, 'titulo')).toEqual(source);
    expect(result.changes).toEqual(['Duplicada «Menú del día»']);
    expect(result.touched).toEqual([copy.id]);
    const missing = apply(document, [op({ op: 'duplicate_layer', target: 'no-existe' })]);
    expect(missing.skipped).toEqual(['No se encuentra la capa que hay que duplicar.']);
  });

  it('opacidad, giro, ocultar y bloquear; una capa bloqueada solo admite que la desbloqueen', () => {
    const document = menu();
    const styled = apply(document, [
      op({ op: 'style_layer', target: 'titulo', opacity: 50, rotation: 30, visible: false, locked: true }),
    ]);
    expect(layerOf(styled, 'titulo')).toMatchObject({ opacity: 0.5, rotation: 30, visible: false, locked: true });
    expect(styled.changes).toEqual(['«Menú del día»: opacidad 50 %, giro 30°, oculta, bloqueada']);

    const locked = styled.document;
    const blocked = apply(locked, [op({ op: 'style_layer', target: 'titulo', opacity: 100 })]);
    expect(blocked.document).toBe(locked);
    expect(blocked.skipped).toEqual(['«Menú del día» está bloqueada.']);
    const unlocked = apply(locked, [op({ op: 'style_layer', target: 'titulo', locked: false, visible: true })]);
    expect(layerOf(unlocked, 'titulo')).toMatchObject({ locked: false, visible: true, opacity: 0.5 });
    expect(unlocked.changes).toEqual(['«Menú del día»: visible, desbloqueada']);

    const none = apply(document, [
      op({ op: 'style_layer', target: 'titulo' }),
      op({ op: 'style_layer', target: 'no-existe', opacity: 10 }),
    ]);
    expect(none.document).toBe(document);
    expect(none.changes).toEqual([]);
    expect(none.skipped).toEqual(['No se encuentra la capa que hay que cambiar.']);
  });

  it('negrita y cursiva de un texto («ponlo en negrita», «quita la negrita»)', () => {
    const document = menu();
    expect(layerOf<TextLayer>(document, 'titulo')).toMatchObject({ fontWeight: 700, italic: false });
    const plain = apply(document, [op({ op: 'update_text', target: 'titulo', bold: false, italic: true })]);
    expect(layerOf<TextLayer>(plain, 'titulo')).toMatchObject({ fontWeight: 400, italic: true, text: 'Menú del día' });
    expect(plain.changes).toEqual(['Cambiado el texto «Menú del día»']);
    const bold = apply(plain.document, [op({ op: 'update_text', target: 'titulo', bold: true, italic: false })]);
    expect(layerOf<TextLayer>(bold, 'titulo')).toMatchObject({ fontWeight: 700, italic: false });
    // Con estilo y negrita a la vez, manda lo que se dice de la negrita.
    const body = apply(document, [op({ op: 'update_text', target: 'titulo', style: 'body', bold: true })]);
    expect(layerOf<TextLayer>(body, 'titulo')).toMatchObject({ fontWeight: 700, fontSize: Math.round(1080 * 0.045) });
    // Sin nada que cambiar no se da por hecho.
    const nothing = apply(document, [op({ op: 'update_text', target: 'titulo' })]);
    expect(nothing.document).toBe(document);
    expect(nothing.changes).toEqual([]);
    expect(nothing.skipped).toEqual(['No dice qué cambiar de «Menú del día».']);
  });
});

describe('copiloto: efectos y figuras', () => {
  it('contorno y fondo de etiqueta en un texto: con un color que contraste si no se dice, y se quitan', () => {
    const document = menu();
    const on = apply(document, [
      op({ op: 'set_effect', target: 'titulo', effect: 'outline', on: true }),
      op({ op: 'set_effect', target: 'titulo', effect: 'background', on: true, color: '#A3122A' }),
    ]);
    const title = layerOf<TextLayer>(on, 'titulo');
    // El título es blanco: el contorno, negro.
    expect(title.outline).toEqual({ color: '#000000', width: Math.max(2, Math.round(80 * 0.06)) });
    expect(title.background).toMatchObject({ color: '#A3122A', opacity: 1 });
    expect(on.changes).toEqual(['«Menú del día», con contorno', '«Menú del día», con fondo de etiqueta']);
    const off = apply(on.document, [
      op({ op: 'set_effect', target: 'titulo', effect: 'outline', on: false }),
      op({ op: 'set_effect', target: 'titulo', effect: 'background', on: false }),
    ]);
    expect(layerOf<TextLayer>(off, 'titulo')).not.toHaveProperty('outline');
    expect(layerOf<TextLayer>(off, 'titulo')).not.toHaveProperty('background');
    expect(off.changes).toEqual(['«Menú del día», sin contorno', '«Menú del día», sin fondo de etiqueta']);
  });

  it('sombra: en textos, fotos y figuras; el logotipo no la admite y el contorno es solo de textos', () => {
    const document = menu();
    const result = apply(document, [
      op({ op: 'set_effect', target: 'suelta', effect: 'shadow', on: true }),
      op({ op: 'set_effect', target: 'forma', effect: 'shadow', on: true, color: '#A3122A' }),
      op({ op: 'set_effect', target: 'logo', effect: 'shadow', on: true }),
      op({ op: 'set_effect', target: 'forma', effect: 'outline', on: true }),
      op({ op: 'set_effect', target: 'no-existe', effect: 'shadow', on: true }),
    ]);
    expect(layerOf<ImageLayer>(result, 'suelta').shadow).toEqual(DEFAULT_SHADOW);
    expect(layerOf<ShapeLayer>(result, 'forma').shadow).toEqual({ ...DEFAULT_SHADOW, color: '#A3122A' });
    expect(layerOf(result, 'logo')).not.toHaveProperty('shadow');
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toBe('plato.jpg, con sombra');
    expect(result.skipped).toEqual([
      'El logotipo no admite sombra.',
      'El contorno y el fondo de etiqueta son solo para textos.',
      'No se encuentra la capa que hay que cambiar.',
    ]);
    const off = apply(result.document, [op({ op: 'set_effect', target: 'suelta', effect: 'shadow', on: false })]);
    expect(layerOf(off, 'suelta')).not.toHaveProperty('shadow');
    expect(off.changes).toEqual(['plato.jpg, sin sombra']);
  });

  it('añade una figura con un color de la marca y donde se diga (centrada si no se dice)', () => {
    const empty = createEmptyDocument({ aspectRatio: '4:5' });
    const result = apply(empty, [
      op({ op: 'add_shape', shape: 'star' }),
      op({ op: 'add_shape', shape: 'rectangle', color: '#000000', position: 'top', align: 'left' }),
      op({ op: 'add_shape', shape: 'ellipse', position: 'bottom', align: 'right' }),
      op({ op: 'add_shape', shape: 'line', color: '#A3122A' }),
    ]);
    const [star, rectangle, ellipse, line] = result.document.pages[0]!.layers as ShapeLayer[];
    expect(star).toMatchObject({ type: 'shape', shape: 'star', fill: '#F4E9D8' });
    expect(star!.x + star!.width / 2).toBeCloseTo(540, 0);
    expect(star!.y + star!.height / 2).toBeCloseTo(675, 0);
    const margin = Math.round(1080 * 0.05);
    expect(rectangle).toMatchObject({ shape: 'rectangle', fill: '#000000', x: margin, y: margin });
    expect(ellipse!.x + ellipse!.width).toBe(1080 - margin);
    expect(ellipse!.y + ellipse!.height).toBe(1350 - margin);
    // Una línea solo tiene trazo: el color es el del trazo.
    expect(line).toMatchObject({ shape: 'line', fill: null, stroke: { color: '#A3122A' } });
    expect(result.changes).toHaveLength(4);
    for (const change of result.changes) expect(change).toMatch(/^Añadida la figura \(/);
    expect(new Set(result.document.pages[0]!.layers.map((layer) => layer.id)).size).toBe(4);
  });

  it('relleno y borde de una figura; en lo que no es una figura, no', () => {
    const document = menu();
    const result = apply(document, [
      op({ op: 'style_shape', target: 'forma', color: '#F4E9D8', color2: '#000000' }),
      op({ op: 'style_shape', target: 'titulo', color: '#000000' }),
      op({ op: 'style_shape', target: 'forma' }),
    ]);
    expect(layerOf<ShapeLayer>(result, 'forma')).toMatchObject({ fill: '#F4E9D8', stroke: { color: '#000000', width: 4 } });
    expect(layerOf<TextLayer>(result, 'titulo').color).toBe('#FFFFFF');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatch(/^Cambiado el color de la figura/);
    expect(result.skipped).toEqual(['Solo las figuras tienen relleno y borde.']);

    const withLine = apply(createEmptyDocument(), [op({ op: 'add_shape', shape: 'line' })]);
    const lineId = withLine.document.pages[0]!.layers[0]!.id;
    const painted = apply(withLine.document, [op({ op: 'style_shape', target: lineId, color: '#A3122A' })]);
    expect(layerOf<ShapeLayer>(painted, lineId)).toMatchObject({ fill: null, stroke: { color: '#A3122A' } });
  });
});

describe('copiloto: fotos', () => {
  it('añade una foto suelta encima, con su proporción y entera; sin foto elegida, se pide', () => {
    const document = menu();
    const result = apply(document, [
      op({ op: 'add_image', assetId: LOOSE }),
      op({ op: 'add_image', assetId: UNKNOWN, position: 'top', align: 'left' }),
      op({ op: 'add_image' }),
    ]);
    const layers = result.document.pages[0]!.layers;
    expect(layers).toHaveLength(7);
    const [wide, square] = layers.slice(5) as ImageLayer[];
    // 400×200: el doble de ancha que de alta, el 60 % del lado menor del lienzo.
    expect(wide).toMatchObject({ type: 'image', width: 648, height: 324, fit: 'contain', source: { kind: 'asset', assetId: LOOSE } });
    expect(wide!.x + wide!.width / 2).toBeCloseTo(540, 0);
    expect(wide!.y + wide!.height / 2).toBeCloseTo(675, 0);
    // Sin medidas conocidas, cuadrada.
    const margin = Math.round(1080 * 0.05);
    expect(square).toMatchObject({ width: 648, height: 648, x: margin, y: margin });
    expect(result.changes).toEqual(['Foto «plato.jpg» añadida encima', 'Foto «Foto» añadida encima']);
    expect(result.skipped).toEqual(['Falta elegir la foto.']);
    // La foto de fondo sigue siendo la de fondo.
    expect(ids(result)[0]).toBe('fondo');
  });

  it('luz, color y filtro: sin decir cuál, la foto elegida en el editor; si no, la de fondo', () => {
    const document = menu();
    const background = apply(document, [op({ op: 'adjust_image', brightness: 20, contrast: -10 })]);
    expect(layerOf<ImageLayer>(background, 'fondo').adjust).toEqual({
      brightness: 20,
      contrast: -10,
      saturation: 0,
      temperature: 0,
      sharpness: 0,
    });
    expect(layerOf(background, 'suelta')).not.toHaveProperty('adjust');
    expect(background.changes).toEqual(['Luz y color de la foto ajustados']);

    const chosen = apply(document, [op({ op: 'adjust_image', filter: 'bw' })], { selectedIds: ['titulo', 'suelta'] });
    expect(layerOf<ImageLayer>(chosen, 'suelta').adjust).toMatchObject({ filter: 'bw' });
    expect(layerOf(chosen, 'fondo')).not.toHaveProperty('adjust');
    expect(chosen.changes[0]).toMatch(/^Filtro «.+» en la foto$/);

    // Lo que ya tenía se conserva; «sin filtro» lo quita y, si queda neutra, no se guarda nada.
    const more = apply(chosen.document, [op({ op: 'adjust_image', target: 'suelta', saturation: 30 })]);
    expect(layerOf<ImageLayer>(more, 'suelta').adjust).toMatchObject({ filter: 'bw', saturation: 30 });
    const clean = apply(chosen.document, [op({ op: 'adjust_image', target: 'suelta', filter: 'none' })]);
    expect(layerOf(clean, 'suelta')).not.toHaveProperty('adjust');
    expect(clean.changes).toEqual(['Foto sin filtro']);
  });

  it('operaciones de foto sin ninguna foto, sobre una bloqueada o sobre una capa que no es una foto', () => {
    const noPhoto = apply(createEmptyDocument(), [
      op({ op: 'adjust_image', brightness: 20 }),
      op({ op: 'transform_image', turn: true }),
      op({ op: 'image_backdrop', backdrop: 'blur' }),
      op({ op: 'photo_flow', action: 'portrait' }),
    ]);
    expect(noPhoto.changes).toEqual([]);
    expect(noPhoto.flows).toEqual([]);
    expect(noPhoto.skipped).toEqual(
      Array.from({ length: 4 }, () => 'No hay ninguna foto a la que aplicarlo: elige una o di cuál.'),
    );
    const locked = lock(menu(), 'fondo');
    const blocked = apply(locked, [
      op({ op: 'adjust_image', brightness: 20 }),
      op({ op: 'photo_flow', action: 'edit' }),
      op({ op: 'transform_image', target: 'titulo', turn: true }),
    ]);
    expect(blocked.document).toBe(locked);
    expect(blocked.flows).toEqual([]);
    expect(blocked.skipped).toEqual([
      'mesa.jpg está bloqueada.',
      'mesa.jpg está bloqueada.',
      'No hay ninguna foto a la que aplicarlo: elige una o di cuál.',
    ]);
    // Dos fotos sueltas y ninguna de fondo ni elegida: no se adivina cuál.
    const two = withPageLayers(menu(), 0, [
      { ...layerOf<ImageLayer>(menu(), 'suelta'), id: 'a' },
      { ...layerOf<ImageLayer>(menu(), 'suelta'), id: 'b', x: 10 },
    ]);
    expect(apply(two, [op({ op: 'transform_image', turn: true })]).skipped).toHaveLength(1);
    // Con una sola foto, es esa.
    const one = withPageLayers(menu(), 0, [layerOf(menu(), 'titulo'), layerOf(menu(), 'suelta')]);
    expect(layerOf<ImageLayer>(apply(one, [op({ op: 'transform_image', turn: true })]), 'suelta').turn).toBe(90);
  });

  it('girar, voltear, encajar y recortar a una proporción', () => {
    const document = menu();
    const turned = apply(document, [op({ op: 'transform_image', target: 'suelta', turn: true, flip: 'horizontal', fit: 'cover' })]);
    expect(layerOf<ImageLayer>(turned, 'suelta')).toMatchObject({ turn: 90, flipX: true, fit: 'cover' });
    expect(turned.changes).toEqual(['Foto girada 90°, volteada en horizontal, llenando su caja']);
    const twice = apply(turned.document, [
      op({ op: 'transform_image', target: 'suelta', turn: true }),
      op({ op: 'transform_image', target: 'suelta', flip: 'vertical', fit: 'contain' }),
    ]);
    expect(layerOf<ImageLayer>(twice, 'suelta')).toMatchObject({ turn: 180, fit: 'contain' });
    expect(twice.changes).toEqual(['Foto girada 90°', 'Foto volteada en vertical, entera']);

    // Recorte cuadrado de una foto de 400×200 en una caja de 400×200: la caja pasa a cuadrada, con el mismo centro.
    const cropped = apply(document, [op({ op: 'transform_image', target: 'suelta', crop: '1:1' })]);
    const photo = layerOf<ImageLayer>(cropped, 'suelta');
    expect(photo.crop).toBeDefined();
    expect(photo.crop!.width * 400).toBeCloseTo(photo.crop!.height * 200, 0);
    expect(photo).toMatchObject({ width: 200, height: 200, x: 400, y: 700 });
    expect(cropped.changes).toEqual(['Foto recortada a 1:1']);
    const restored = apply(cropped.document, [op({ op: 'transform_image', target: 'suelta', crop: 'none' })]);
    expect(layerOf(restored, 'suelta')).not.toHaveProperty('crop');
    expect(restored.changes).toEqual(['Foto sin recorte']);

    // Sin las medidas de la foto no se puede recortar a ciegas: se dice, y lo demás de la orden se hace.
    const unknown = apply(document, [op({ op: 'transform_image', target: 'suelta', crop: '4:5', flip: 'vertical' })], {
      assets: new Map(),
    });
    expect(layerOf<ImageLayer>(unknown, 'suelta')).toMatchObject({ flipY: true });
    expect(layerOf(unknown, 'suelta')).not.toHaveProperty('crop');
    expect(unknown.skipped).toEqual(['No se conocen las medidas de la foto: recórtala desde «Recortar…».']);
    // Nada que hacer («no la gires»): sin cambios.
    expect(apply(document, [op({ op: 'transform_image', target: 'suelta' })]).document).toBe(document);
  });

  it('lo que se ve detrás de la foto: color (el de la marca si no se dice), degradado, la misma desenfocada o nada', () => {
    const document = menu();
    const color = apply(document, [op({ op: 'image_backdrop', target: 'suelta', backdrop: 'color' })]);
    expect(layerOf<ImageLayer>(color, 'suelta')).toMatchObject({ backdrop: { kind: 'color', color: '#A3122A' }, fit: 'contain' });
    expect(color.changes).toEqual(['Color #A3122A detrás de la foto']);
    const gradient = apply(document, [
      op({ op: 'image_backdrop', target: 'suelta', backdrop: 'gradient', color: '#000000', color2: '#FFFFFF' }),
    ]);
    expect(layerOf<ImageLayer>(gradient, 'suelta').backdrop).toEqual({ kind: 'gradient', from: '#000000', to: '#FFFFFF', angle: 180 });
    const defaults = apply(document, [op({ op: 'image_backdrop', target: 'suelta', backdrop: 'gradient' })]);
    expect(layerOf<ImageLayer>(defaults, 'suelta').backdrop).toMatchObject({ from: '#A3122A', to: '#F4E9D8' });
    expect(defaults.changes).toEqual(['Degradado detrás de la foto']);
    // Sin decir cuál, la de fondo.
    const blur = apply(document, [op({ op: 'image_backdrop', backdrop: 'blur' })]);
    expect(layerOf<ImageLayer>(blur, 'fondo').backdrop).toEqual({ kind: 'blur', blur: 60 });
    expect(blur.changes).toEqual(['La misma foto, desenfocada, detrás']);
    const none = apply(blur.document, [op({ op: 'image_backdrop', backdrop: 'none' })]);
    expect(layerOf(none, 'fondo')).not.toHaveProperty('backdrop');
    expect(none.changes).toEqual(['Foto sin nada detrás']);
  });

  it('quitar el fondo, modo retrato, editar o cambiar la foto: se piden al editor (`flows`) y el documento no cambia', () => {
    const document = menu();
    const result = apply(
      document,
      [
        op({ op: 'photo_flow', action: 'remove_background' }),
        op({ op: 'photo_flow', target: 'suelta', action: 'portrait' }),
        op({ op: 'photo_flow', target: 'titulo', action: 'edit' }),
      ],
      { selectedIds: ['suelta'] },
    );
    expect(result.document).toBe(document);
    expect(result.flows).toEqual([
      { flow: 'remove_background', layerId: 'suelta' },
      { flow: 'portrait', layerId: 'suelta' },
    ]);
    expect(result.changes).toEqual([]);
    expect(result.touched).toEqual([]);
    expect(result.skipped).toEqual(['No hay ninguna foto a la que aplicarlo: elige una o di cuál.']);
    // Sin nada elegido, la foto de fondo.
    expect(apply(document, [op({ op: 'photo_flow', action: 'replace' })]).flows).toEqual([{ flow: 'replace', layerId: 'fondo' }]);
  });
});

describe('copiloto: lienzo y páginas', () => {
  it('proporción del lienzo: cambia en todas las páginas y recoloca las capas; avisa si la red no la admite', () => {
    const document = menu(2);
    const result = apply(document, [op({ op: 'set_canvas_ratio', ratio: '9:16' })], { allowedRatios: ['4:5', '9:16'] });
    expect(result.document.canvas).toMatchObject({ aspectRatio: '9:16', width: 1080, height: 1920 });
    expect(result.document.pages).toHaveLength(2);
    // La foto de fondo sigue llenando el lienzo.
    expect(layerOf(result, 'fondo')).toMatchObject({ x: 0, y: 0, width: 1080, height: 1920 });
    expect(result.changes).toEqual(['Lienzo en 9:16 (las capas se han recolocado: revísalo)']);
    expect(result.skipped).toEqual([]);

    const same = apply(document, [op({ op: 'set_canvas_ratio', ratio: '4:5' })]);
    expect(same.document).toBe(document);
    expect(same.skipped).toEqual(['El lienzo ya es 4:5.']);
    const warned = apply(document, [op({ op: 'set_canvas_ratio', ratio: '16:9' })], { allowedRatios: ['4:5', '1:1'] });
    expect(warned.document.canvas.aspectRatio).toBe('16:9');
    expect(warned.skipped).toEqual(['Ojo: la red de esta pieza no admite 16:9.']);

    // Lo hecho antes en la página se conserva, y lo de después se coloca en el lienzo nuevo.
    const mixed = apply(document, [
      op({ op: 'remove_layer', target: 'logo' }),
      op({ op: 'set_canvas_ratio', ratio: '1:1' }),
      op({ op: 'add_shape', shape: 'ellipse' }),
    ]);
    const layers = mixed.document.pages[0]!.layers;
    expect(layers.map((layer) => layer.id).slice(0, 4)).toEqual(['fondo', 'titulo', 'forma', 'suelta']);
    const ellipse = layers[4]!;
    expect(ellipse.x + ellipse.width / 2).toBeCloseTo(540, 0);
    expect(ellipse.y + ellipse.height / 2).toBeCloseTo(540, 0);
  });

  it('añadir y duplicar una página: detrás de la activa, se pasa a ella y respeta el máximo del formato', () => {
    const document = menu(2);
    const added = apply(document, [op({ op: 'page', action: 'add' })], { pageLimits: { min: 2, max: 3 } });
    expect(added.document.pages.map((page) => page.layers.length)).toEqual([5, 0, 0]);
    expect(added.pageIndex).toBe(1);
    expect(added.changes).toEqual(['Página 2 nueva']);
    expect(added.touched).toEqual([]);

    const duplicated = apply(document, [op({ op: 'page', action: 'duplicate' })], { pageLimits: { min: 2, max: 3 } });
    expect(duplicated.document.pages.map((page) => page.layers.length)).toEqual([5, 5, 0]);
    expect(duplicated.pageIndex).toBe(1);
    expect(duplicated.changes).toEqual(['Página duplicada (ahora, la 2)']);
    // Las capas copiadas llevan identificadores nuevos: ninguno repetido en el documento.
    const all = duplicated.document.pages.flatMap((page) => page.layers.map((layer) => layer.id));
    expect(new Set(all).size).toBe(all.length);

    const full = apply(added.document, [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'duplicate' })], {
      pageLimits: { min: 2, max: 3 },
    });
    expect(full.document).toBe(added.document);
    expect(full.skipped).toEqual(['Este formato admite 3 páginas como mucho.', 'Este formato admite 3 páginas como mucho.']);
    const single = apply(menu(), [op({ op: 'page', action: 'add' })], { pageLimits: { min: 1, max: 1 } });
    expect(single.skipped).toEqual(['Esta pieza es de una sola página.']);
    expect(single.pageIndex).toBe(0);
    // Sin límites del formato, el del documento (10 páginas).
    const ten = createEmptyDocument({ pages: 10 });
    expect(apply(ten, [op({ op: 'page', action: 'add' })]).skipped).toEqual(['Este formato admite 10 páginas como mucho.']);
  });

  it('«añade una página nueva y duplica esta»: «esta» es la página de la que se partía, no la recién añadida', () => {
    const single = menu();
    const limits = { pageLimits: { min: 1, max: 10 } };
    const original = single.pages[0]!;
    const kinds = (document: ContentDocument) => document.pages.map((page) => page.layers.map((layer) => layer.type).join(','));
    const full = 'image,text,shape,image,logo';

    // Añadir y duplicar: la copia es de la original (con sus cinco capas), no de la vacía. De una página se pasa a tres.
    const added = apply(single, [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'duplicate' })], limits);
    expect(added.document.pages).toHaveLength(3);
    expect(kinds(added.document)).toEqual([full, full, '']);
    expect(added.document.pages[0]).toEqual(original);
    expect(added.skipped).toEqual([]);
    expect(added.changes).toEqual(['Página 2 nueva', 'Página duplicada (ahora, la 2)']);
    // Se queda en la copia, y sus capas llevan identificadores nuevos (ninguno repetido).
    expect(added.pageIndex).toBe(1);
    const all = added.document.pages.flatMap((page) => page.layers.map((layer) => layer.id));
    expect(new Set(all).size).toBe(all.length);
    expect(added.document.pages[1]!.layers.map((layer) => ({ ...layer, id: '' }))).toEqual(original.layers.map((layer) => ({ ...layer, id: '' })));

    // Al revés queda lo mismo: la original, su copia y la vacía (aquí se termina en la vacía).
    const reversed = apply(single, [op({ op: 'page', action: 'duplicate' }), op({ op: 'page', action: 'add' })], limits);
    expect(kinds(reversed.document)).toEqual([full, full, '']);
    expect(reversed.pageIndex).toBe(2);
    expect(reversed.changes).toEqual(['Página duplicada (ahora, la 2)', 'Página 3 nueva']);

    // Duplicar a secas, como siempre: la copia detrás y se pasa a ella.
    const only = apply(single, [op({ op: 'page', action: 'duplicate' })], limits);
    expect(kinds(only.document)).toEqual([full, full]);
    expect(only.pageIndex).toBe(1);

    // Lo que sigue en la misma orden nombra las capas de la original y actúa en la copia.
    const edited = apply(
      single,
      [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'duplicate' }), op({ op: 'update_text', target: 'titulo', text: 'Menú de la noche' })],
      limits,
    );
    expect(edited.skipped).toEqual([]);
    expect(edited.document.pages[0]).toEqual(original);
    expect(edited.document.pages[1]!.layers[1]).toMatchObject({ type: 'text', text: 'Menú de la noche' });

    // Dos páginas nuevas y «duplica esta»: sigue siendo la de partida.
    const twice = apply(
      single,
      [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'duplicate' })],
      limits,
    );
    expect(kinds(twice.document)).toEqual([full, full, '', '']);
    // En un carrusel, desde otra página: «esta» es la activa al empezar la orden, no la primera.
    const carousel = menu(2);
    const second = apply(carousel, [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'duplicate' })], {
      pageIndex: 1,
      pageLimits: { min: 2, max: 10 },
    });
    // La segunda (vacía) es de la que se partía: su copia también está vacía, y la primera no se duplica.
    expect(kinds(second.document)).toEqual([full, '', '', '']);
    const first = apply(carousel, [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'duplicate' })], {
      pageLimits: { min: 2, max: 10 },
    });
    expect(kinds(first.document)).toEqual([full, full, '', '']);

    // Si se ha ido a otra página que ya existía, se duplica esa (no es una de las añadidas en la orden).
    const moved = apply(
      carousel,
      [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'go', direction: 'first' }), op({ op: 'page', action: 'duplicate' })],
      { pageIndex: 1, pageLimits: { min: 2, max: 10 } },
    );
    expect(kinds(moved.document)).toEqual([full, full, '', '']);
    // Sin sitio para las dos, la segunda se dice y no se hace.
    const tight = apply(single, [op({ op: 'page', action: 'add' }), op({ op: 'page', action: 'duplicate' })], {
      pageLimits: { min: 1, max: 2 },
    });
    expect(kinds(tight.document)).toEqual([full, '']);
    expect(tight.skipped).toEqual(['Este formato admite 2 páginas como mucho.']);
  });

  it('borrar y mover la página activa', () => {
    const document = menu(3);
    const removed = apply(document, [op({ op: 'page', action: 'remove' })], { pageIndex: 1 });
    expect(removed.document.pages.map((page) => page.id)).toEqual(['p1', 'p3']);
    expect(removed.pageIndex).toBe(1);
    expect(removed.changes).toEqual(['Borrada la página 2']);
    const last = apply(document, [op({ op: 'page', action: 'remove' })], { pageIndex: 2 });
    expect(last.pageIndex).toBe(1);
    const only = apply(menu(), [op({ op: 'page', action: 'remove' })]);
    expect(only.document.pages).toHaveLength(1);
    expect(only.skipped).toEqual(['Una pieza tiene al menos una página.']);

    const moved = apply(document, [op({ op: 'page', action: 'move', page: 3 })]);
    expect(moved.document.pages.map((page) => page.id)).toEqual(['p2', 'p3', 'p1']);
    expect(moved.pageIndex).toBe(2);
    expect(moved.changes).toEqual(['Página movida al puesto 3']);
    const still = apply(document, [op({ op: 'page', action: 'move', page: 1 })]);
    expect(still.document).toBe(document);
    expect(still.skipped).toEqual(['La página ya está en ese puesto.']);
    // Un puesto que no existe es el último.
    expect(apply(document, [op({ op: 'page', action: 'move', page: 9 })]).pageIndex).toBe(2);
  });

  it('ir a otra página no cambia el documento: devuelve EL MISMO y la página a la que se va', () => {
    const document = menu(3);
    const go = (fields: Partial<CopilotOperation>, pageIndex = 0) =>
      apply(document, [op({ op: 'page', action: 'go', ...fields })], { pageIndex });
    const second = go({ page: 2 });
    expect(second.document).toBe(document);
    expect(second.pageIndex).toBe(1);
    expect(second.changes).toEqual(['Página 2']);
    expect(second.touched).toEqual([]);
    expect(go({ direction: 'next' }).pageIndex).toBe(1);
    expect(go({ direction: 'last' }).pageIndex).toBe(2);
    expect(go({ direction: 'previous' }, 2).pageIndex).toBe(1);
    expect(go({ direction: 'first' }, 2).pageIndex).toBe(0);

    expect(go({ direction: 'previous' })).toMatchObject({ pageIndex: 0, skipped: ['Ya estás en la primera página.'] });
    expect(go({ direction: 'next' }, 2)).toMatchObject({ pageIndex: 2, skipped: ['Esa página no existe.'] });
    expect(go({ page: 7 })).toMatchObject({ pageIndex: 0, skipped: ['Esa página no existe.'] });
    expect(go({ page: 1 })).toMatchObject({ pageIndex: 0, skipped: ['Ya estás en esa página.'] });
    expect(go({ direction: 'first' })).toMatchObject({ pageIndex: 0, skipped: ['Ya estás en esa página.'] });
    const single = apply(menu(), [op({ op: 'page', action: 'go', direction: 'next' })]);
    expect(single).toMatchObject({ pageIndex: 0, skipped: ['Solo hay una página.'] });
    expect(single.document.pages).toHaveLength(1);
  });

  it('una orden que cambia de página sigue en la nueva: lo de antes queda en la suya y lo de después, en la otra', () => {
    const document = menu(2);
    const result = apply(
      document,
      [
        op({ op: 'remove_layer', target: 'logo' }),
        op({ op: 'page', action: 'add' }),
        op({ op: 'add_text', text: 'Segunda página', style: 'title' }),
        op({ op: 'set_background_color', color: '#A3122A' }),
      ],
      { pageLimits: { min: 2, max: 10 } },
    );
    expect(result.pageIndex).toBe(1);
    expect(result.document.pages.map((page) => page.layers.length)).toEqual([4, 1, 0]);
    expect(result.document.pages[1]!.layers[0]).toMatchObject({ type: 'text', text: 'Segunda página' });
    expect(result.document.canvas.backgroundColor).toBe('#A3122A');
    // Solo quedan elegidas las capas de la página en la que se termina.
    expect(result.touched).toEqual([result.document.pages[1]!.layers[0]!.id]);
    // Cuatro cambios y uno más: con el fondo granate, el texto recién puesto pasa a un color que se lea.
    expect(result.changes).toHaveLength(5);
    expect(result.changes.slice(0, 3)).toEqual(['Quitada logo.png', 'Página 2 nueva', 'Texto «Segunda página»']);
    expect(result.changes[4]).toMatch(/^Texto «Segunda página» en #[0-9A-F]{6} para que se lea sobre el fondo$/);

    // «Duplica la página y cambia el título…»: lo que sigue nombra las capas de la original y actúa en la copia.
    const copy = apply(
      document,
      [
        op({ op: 'page', action: 'duplicate' }),
        op({ op: 'update_text', target: 'titulo', text: 'Menú de la noche' }),
        op({ op: 'remove_layer', target: 'logo' }),
        op({ op: 'adjust_image', filter: 'bw' }),
      ],
      { pageLimits: { min: 2, max: 10 }, selectedIds: ['suelta'] },
    );
    expect(copy.skipped).toEqual([]);
    expect(copy.pageIndex).toBe(1);
    // La original, intacta; la copia, con el título nuevo, sin logotipo y con la foto elegida en blanco y negro.
    expect(copy.document.pages[0]).toEqual(document.pages[0]);
    const copied = copy.document.pages[1]!.layers;
    expect(copied.map((layer) => layer.type)).toEqual(['image', 'text', 'shape', 'image']);
    expect(copied[1]).toMatchObject({ text: 'Menú de la noche' });
    expect(copied[3]).toMatchObject({ name: 'plato.jpg', adjust: { filter: 'bw' } });
    expect(copied[0]).not.toHaveProperty('adjust');
    expect(copied.some((layer) => layer.id === 'titulo')).toBe(false);
    // Al pasar después a otra página, esos nombres dejan de valer.
    const away = apply(document, [
      op({ op: 'page', action: 'duplicate' }),
      op({ op: 'page', action: 'go', direction: 'last' }),
      op({ op: 'remove_layer', target: 'titulo' }),
    ], { pageLimits: { min: 2, max: 10 } });
    expect(away.skipped).toEqual(['No se encuentra la capa que hay que quitar.']);
    expect(away.document.pages[1]!.layers).toHaveLength(5);

    // Las capas de otra página no se alcanzan desde la activa.
    const other = apply(document, [op({ op: 'remove_layer', target: 'titulo' })], { pageIndex: 1 });
    expect(other.document).toBe(document);
    expect(other.skipped).toEqual(['No se encuentra la capa que hay que quitar.']);
  });
});

describe('copiloto: acciones del editor y órdenes compuestas', () => {
  it('guardar y plantillas van para después de aplicar (`after`); deshacer y rehacer, antes (`historyActions`)', () => {
    const document = menu();
    const operations = [
      op({ op: 'editor', action: 'undo' }),
      op({ op: 'editor', action: 'save' }),
      op({ op: 'editor', action: 'redo' }),
      op({ op: 'editor', action: 'template' }),
    ];
    const result = apply(document, operations);
    expect(result.document).toBe(document);
    expect(result.after).toEqual(['save', 'template']);
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(historyActions(operations)).toEqual(['undo', 'redo']);
    expect(historyActions([op({ op: 'page', action: 'add' }), op({ op: 'editor', action: 'save' })])).toEqual([]);
    // Con cambios en el documento, «guarda» va después de ellos.
    const both = apply(document, [op({ op: 'editor', action: 'save' }), op({ op: 'remove_layer', target: 'logo' })]);
    expect(both.after).toEqual(['save']);
    expect(both.document.pages[0]!.layers).toHaveLength(4);
  });

  it('una orden con varias operaciones es UN documento nuevo y un solo paso de deshacer, en la página que toca', () => {
    const document = menu(2);
    const result = apply(
      document,
      [
        op({ op: 'resize_layer', target: 'titulo', steps: 1 }),
        op({ op: 'arrange_layer', target: 'titulo', order: 'front' }),
        op({ op: 'set_effect', target: 'titulo', effect: 'shadow', on: true }),
        op({ op: 'style_shape', target: 'forma', color: '#F4E9D8' }),
        op({ op: 'adjust_image', filter: 'warm' }),
        op({ op: 'duplicate_layer', target: 'forma' }),
        op({ op: 'page', action: 'duplicate' }),
        op({ op: 'add_text', text: 'Solo hoy', style: 'subtitle' }),
        op({ op: 'editor', action: 'save' }),
      ],
      { pageLimits: { min: 2, max: 10 } },
    );
    expect(result.document).not.toBe(document);
    expect(result.changes).toHaveLength(8);
    expect(result.skipped).toEqual([]);
    expect(result.pageIndex).toBe(1);
    expect(result.after).toEqual(['save']);
    expect(result.document.pages.map((page) => page.layers.length)).toEqual([6, 7, 0]);
    // El documento de partida no se ha tocado.
    expect(document).toEqual(menu(2));

    // Como lo aplica el editor: sustituir el documento, elegir lo tocado y pasar a la página.
    const start = initEditor(document);
    const pageId = result.document.pages[result.pageIndex]!.id;
    const state = editorReducer(start, { type: 'replace', document: result.document, select: result.touched, pageId });
    expect(state.past).toHaveLength(1);
    expect(state.document).toBe(result.document);
    expect(activePageIndex(state)).toBe(1);
    expect(state.selectedIds).toEqual(result.touched);
    expect(result.touched).toHaveLength(1);
    // Un solo «Deshacer» vuelve al documento y a la página de antes.
    const undone = editorReducer(state, { type: 'undo' });
    expect(undone.document).toBe(document);
    expect(undone.past).toHaveLength(0);
    expect(activePageIndex(undone)).toBe(0);
    // «Rehacer» devuelve el documento de la orden (y enseña la página en la que se dio, como en cualquier otro paso).
    const redone = editorReducer(undone, { type: 'redo' });
    expect(redone.document).toBe(result.document);
    expect(redone.future).toHaveLength(0);

    // Ir a otra página no es un paso de deshacer: el mismo documento no se apila.
    const go = apply(document, [op({ op: 'page', action: 'go', page: 2 })]);
    expect(editorReducer(start, { type: 'replace', document: go.document, pageId: go.document.pages[1]!.id })).toBe(start);
  });

  it('si el resultado no sería un documento válido, no se aplica nada', () => {
    const document = menu();
    // Sin validar (como si el esquema de la respuesta fallase): un color que no lo es.
    const bad = { ...op({ op: 'set_background_color' }), color: 'rojo' } as CopilotOperation;
    const result = applyCopilotOperations(document, [op({ op: 'remove_layer', target: 'logo' }), bad], context);
    expect(result.ok).toBe(false);
    expect(pageView(document).layers).toHaveLength(5);
  });

  it('como mucho 60 capas por página: lo que no cabe se dice', () => {
    let document = createEmptyDocument();
    const batch = Array.from({ length: 20 }, () => op({ op: 'add_shape', shape: 'ellipse' }));
    for (let i = 0; i < 3; i += 1) document = apply(document, batch).document;
    expect(document.pages[0]!.layers).toHaveLength(60);
    const full = apply(document, [op({ op: 'add_shape', shape: 'star' }), op({ op: 'duplicate_layer', target: document.pages[0]!.layers[0]!.id })]);
    expect(full.document).toBe(document);
    expect(full.skipped).toEqual(['No caben más capas (máximo 60).', 'No caben más capas (máximo 60).']);
  });
});

describe('copiloto: fotos con el sitio que les da un plan', () => {
  it('`add_image` con caja: la foto cabe en ella con sus proporciones, girada, con sombra y por debajo de los textos', () => {
    const document = menu();
    const placed = {
      ...op({ op: 'add_image', assetId: LOOSE }),
      place: { x: 100, y: 600, width: 300, height: 300, rotation: -12, shadow: true },
    };
    const result = apply(document, [placed]);
    const added = result.document.pages[0]!.layers.find((layer) => result.touched.includes(layer.id)) as ImageLayer;
    // La foto es 2:1: ocupa el ancho de la caja y queda centrada en su alto.
    expect(added).toMatchObject({ x: 100, y: 675, width: 300, height: 150, rotation: -12, fit: 'contain', shadow: DEFAULT_SHADOW });
    expect(added.source).toEqual({ kind: 'asset', assetId: LOOSE });
    // Encima del fondo, por debajo del título (el primer texto) y del logotipo.
    expect(ids(result)).toEqual(['fondo', added.id, 'titulo', 'forma', 'suelta', 'logo']);
    expect(result.changes).toEqual(['Foto «plato.jpg» añadida encima']);
    // Sin sombra ni giro, y con una foto de medidas desconocidas: la caja entera.
    const plain = apply(document, [{ ...op({ op: 'add_image', assetId: UNKNOWN }), place: { x: 40, y: 40, width: 200, height: 200 } }]);
    const square = plain.document.pages[0]!.layers.find((layer) => plain.touched.includes(layer.id)) as ImageLayer;
    expect(square).toMatchObject({ x: 40, y: 40, width: 200, height: 200, rotation: 0 });
    expect(square.shadow).toBeUndefined();
    // Sin textos ni logotipo, va delante de todo, como cualquier foto.
    const bare = apply(createEmptyDocument(), [{ ...op({ op: 'add_image', assetId: LOOSE }), place: { x: 0, y: 0, width: 400, height: 400 } }]);
    expect(bare.document.pages[0]!.layers).toHaveLength(1);
  });

  it('sin caja, `add_image` sigue como siempre (delante de todo y centrada)', () => {
    const result = apply(menu(), [op({ op: 'add_image', assetId: LOOSE })]);
    const added = result.document.pages[0]!.layers.at(-1) as ImageLayer;
    expect(result.touched).toEqual([added.id]);
    expect(added).toMatchObject({ width: 648, height: 324, rotation: 0 });
  });

  it('los pasos de plan no se aplican solos: hay que confirmarlos en el copiloto', () => {
    const document = menu();
    const result = apply(document, [
      op({ op: 'generate_background', prompt: 'Madera clara' }),
      op({ op: 'find_photos', query: 'platos', count: 2 }),
      op({ op: 'place_photos', layout: 'row', cutout: true, on: false }),
    ]);
    expect(result.document).toBe(document);
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual(Array(3).fill('Ese paso es de un plan: hay que confirmarlo en el copiloto.'));
  });
});
