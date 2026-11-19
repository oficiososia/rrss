import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type TextLayer } from '../document';
import { editorReducer, initEditor } from '../editor/history';
import { applyCopilotOperations, backgroundImageOf, needsPhotoPick, withPickedPhoto, type CopilotApplyContext } from './apply';
import { isDictated, keepDictated, parseCopilotResponse, summarizeDocument, type CopilotOperation } from './operations';

const PHOTO = '11111111-1111-4111-8111-111111111111';
const LOGO = '22222222-2222-4222-8222-222222222222';

const op = (fields: Partial<CopilotOperation> & Pick<CopilotOperation, 'op'>): CopilotOperation => ({
  target: null,
  text: null,
  style: null,
  assetId: null,
  position: null,
  align: null,
  color: null,
  font: null,
  blur: null,
  ...fields,
});

const context: CopilotApplyContext = {
  brand: { palette: ['#A3122A', '#F4E9D8'], fonts: ['Marca Titulares', 'Marca Texto'] },
  assets: new Map([
    [PHOTO, { id: PHOTO, name: 'mesa.jpg' }],
    [LOGO, { id: LOGO, name: 'logo.png', width: 400, height: 200 }],
  ]),
  logoIds: [LOGO],
};

const MENU = [
  op({ op: 'set_background_image', assetId: PHOTO, blur: 40 }),
  op({ op: 'add_logo', assetId: LOGO, position: 'top', align: 'center' }),
  op({ op: 'add_text', text: 'Menú de Navidad', style: 'title', position: 'upper' }),
  op({ op: 'add_text', text: 'crema de marisco\ncordero asado\nturrón casero', style: 'body', position: 'middle' }),
  op({ op: 'add_text', text: '45 euros por persona', style: 'small', position: 'lower', color: '#FFFFFF' }),
];

describe('copiloto: aplicar operaciones', () => {
  it('monta fondo difuminado, logotipo y textos con la tipografía y los colores de la marca', () => {
    const document = createEmptyDocument({ aspectRatio: '4:5' });
    const result = applyCopilotOperations(document, MENU, context);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const [background, logo, title, dishes, price] = result.document.layers;
    expect(background).toMatchObject({ type: 'image', blur: 40, x: 0, y: 0, width: 1080, height: 1350 });
    expect(backgroundImageOf(result.document)?.id).toBe(background!.id);
    expect(logo).toMatchObject({ type: 'logo', assetId: LOGO });
    expect(logo!.y).toBeLessThan(title!.y);
    expect(title).toMatchObject({ type: 'text', text: 'Menú de Navidad', fontFamily: 'Marca Titulares', color: '#A3122A', fontWeight: 700 });
    expect(dishes).toMatchObject({ text: 'crema de marisco\ncordero asado\nturrón casero', fontFamily: 'Marca Texto', color: '#F4E9D8' });
    expect(price).toMatchObject({ text: '45 euros por persona', color: '#FFFFFF' });
    // Los textos no se pisan.
    const texts = [title, dishes, price] as TextLayer[];
    for (let i = 1; i < texts.length; i += 1) expect(texts[i]!.y).toBeGreaterThanOrEqual(texts[i - 1]!.y + texts[i - 1]!.height);
    expect(result.changes).toHaveLength(5);
  });

  it('una orden es un solo paso de deshacer', () => {
    const document = createEmptyDocument({ aspectRatio: '4:5' });
    const result = applyCopilotOperations(document, MENU, context);
    if (!result.ok) throw new Error('no aplica');
    let state = editorReducer(initEditor(document), { type: 'replace', document: result.document });
    expect(state.document.layers).toHaveLength(5);
    const blur = applyCopilotOperations(state.document, [op({ op: 'blur_image', blur: 70 })], context);
    if (!blur.ok) throw new Error('no aplica');
    state = editorReducer(state, { type: 'replace', document: blur.document });
    expect(backgroundImageOf(state.document)?.blur).toBe(70);
    state = editorReducer(state, { type: 'undo' });
    expect(backgroundImageOf(state.document)?.blur).toBe(40);
    state = editorReducer(state, { type: 'undo' });
    expect(state.document.layers).toEqual([]);
  });

  it('cambia la foto de fondo existente en vez de añadir otra, y salta lo que no puede hacer', () => {
    const first = applyCopilotOperations(createEmptyDocument(), [op({ op: 'set_background_image', assetId: PHOTO })], context);
    if (!first.ok) throw new Error('no aplica');
    const other = '33333333-3333-4333-8333-333333333333';
    const second = applyCopilotOperations(
      first.document,
      [
        op({ op: 'set_background_image', assetId: other }),
        op({ op: 'remove_layer', target: 'no-existe' }),
        op({ op: 'set_background_color', color: '#000000' }),
      ],
      context,
    );
    if (!second.ok) throw new Error('no aplica');
    expect(second.document.layers).toHaveLength(1);
    expect(second.document.layers[0]).toMatchObject({ source: { kind: 'asset', assetId: other } });
    expect(second.document.canvas.backgroundColor).toBe('#000000');
    expect(second.skipped).toEqual(['No se encuentra la capa que hay que quitar.']);
  });

  it('«esta foto» sin foto elegida: se pide; si no se elige, la operación se quita', () => {
    const ops = [op({ op: 'set_background_image', blur: 40 }), op({ op: 'add_text', text: 'Hola' })];
    expect(needsPhotoPick(ops)).toBe(true);
    expect(withPickedPhoto(ops, PHOTO)[0]).toMatchObject({ assetId: PHOTO, blur: 40 });
    expect(withPickedPhoto(ops, null).map((o) => o.op)).toEqual(['add_text']);
  });

  it('no toca capas bloqueadas', () => {
    const base = applyCopilotOperations(createEmptyDocument(), [op({ op: 'add_text', text: 'Hola' })], context);
    if (!base.ok) throw new Error('no aplica');
    const locked = { ...base.document, layers: base.document.layers.map((l) => ({ ...l, locked: true })) };
    const id = locked.layers[0]!.id;
    const result = applyCopilotOperations(locked, [op({ op: 'remove_layer', target: id }), op({ op: 'update_text', target: id, text: 'Adiós' })], context);
    expect(result.ok && result.document.layers[0]).toMatchObject({ text: 'Hola' });
    expect(result.ok && result.changes).toEqual([]);
  });
});

describe('copiloto: validación en el navegador', () => {
  it('solo acepta respuestas que cumplen el contrato estricto', () => {
    const good = { action: 'editor.copilot', generationId: PHOTO, operations: MENU, discarded: [], note: 'Hecho' };
    expect(parseCopilotResponse(good)?.operations).toHaveLength(5);
    expect(parseCopilotResponse({ ...good, operations: [{ ...MENU[0], op: 'publish' }] })).toBeNull();
    expect(parseCopilotResponse({ ...good, operations: [{ ...MENU[0], approve: true }] })).toBeNull();
    expect(parseCopilotResponse({ ...good, extra: 1 })).toBeNull();
    expect(parseCopilotResponse({ ...good, operations: [{ ...MENU[0], blur: 500 }] })).toBeNull();
  });

  it('los textos deben estar en lo dictado (se perdonan mayúsculas y puntuación, no palabras)', () => {
    const dictado = 'Título: menú de Navidad. Platos: crema de marisco, cordero asado.';
    expect(isDictated('Menú de Navidad', dictado)).toBe(true);
    expect(isDictated('crema de marisco\ncordero asado', dictado)).toBe(true);
    expect(isDictated('Menu de Navidad', dictado)).toBe(false);
    expect(isDictated('Delicioso menú de Navidad', dictado)).toBe(false);
    expect(isDictated('', dictado)).toBe(false);
    const kept = keepDictated([op({ op: 'add_text', text: 'APROBADO' }), op({ op: 'blur_image', blur: 10 })], dictado);
    expect(kept).toMatchObject({ removed: 1, operations: [{ op: 'blur_image' }] });
  });

  it('el resumen del documento no lleva el texto de la publicación ni las fuentes de las imágenes', () => {
    const result = applyCopilotOperations(createEmptyDocument(), MENU, context);
    if (!result.ok) throw new Error('no aplica');
    const summary = summarizeDocument({ ...result.document, copy: { ...result.document.copy, caption: 'secreto' } });
    expect(JSON.stringify(summary)).not.toContain('secreto');
    expect(JSON.stringify(summary)).not.toContain(PHOTO);
    expect(summary.layers[0]).toMatchObject({ type: 'image', blur: 40 });
  });
});
