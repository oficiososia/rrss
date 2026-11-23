import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { contentDocumentSchema, DOCUMENT_SCHEMA_VERSION, type Canvas, type Layer } from '../../document';
import { applyLayerPatch, editorReducer, initEditor, type EditorAction } from '../history';
import { PropertiesPanel } from './PropertiesPanel';

const canvas: Canvas = { aspectRatio: '1:1', width: 1080, height: 1080, backgroundColor: '#FFFFFF' };
const brandStyle = { palette: [{ hex: '#112233', name: 'Azul' }], fonts: [] };
const ASSET = '11111111-1111-4111-8111-111111111111';

const image: Layer = {
  id: 'foto',
  type: 'image',
  name: '',
  x: 0,
  y: 0,
  width: 1080,
  height: 1080,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  anchor: { x: 'stretch', y: 'stretch' },
  source: { kind: 'asset', assetId: ASSET },
  fit: 'cover',
  focus: { x: 0.5, y: 0.5 },
};
const text: Layer = {
  id: 'titulo',
  type: 'text',
  name: '',
  x: 0,
  y: 0,
  width: 800,
  height: 200,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  anchor: { x: 'center', y: 'center' },
  text: 'Hola',
  fontFamily: 'sans-serif',
  fontSize: 80,
  fontWeight: 700,
  italic: false,
  color: '#111111',
  align: 'center',
  lineHeight: 1.2,
};

function renderPanel(layer: Layer, dispatch: (action: EditorAction) => void) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PropertiesPanel
        layer={layer}
        canvas={canvas}
        readOnly={false}
        dispatch={dispatch}
        brandStyle={brandStyle}
        allowedRatios={null}
      />
    </QueryClientProvider>,
  );
}

describe('ediciones sencillas en el panel', () => {
  it('un filtro rápido cambia los ajustes de la capa', () => {
    const dispatch = vi.fn();
    renderPanel(image, dispatch);
    fireEvent.click(screen.getByTestId('photo-filter-warm'));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update',
        id: 'foto',
        patch: { adjust: expect.objectContaining({ filter: 'warm' }) },
      }),
    );
  });

  it('luz y color, girar, recortar y el fondo están en «Editar foto» y en la barra: aquí no se repiten', () => {
    renderPanel(image, vi.fn());
    for (const id of [
      'photo-brightness',
      'photo-turn',
      'photo-crop',
      'photo-cutout',
      'photo-ai-background',
      'layer-edit-photo',
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it('una pieza de antes con luz y color o giro en la capa se puede limpiar', () => {
    const dispatch = vi.fn();
    renderPanel(
      {
        ...image,
        adjust: { brightness: 20, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 },
        turn: 90,
      } as Layer,
      dispatch,
    );
    fireEvent.click(screen.getByTestId('photo-adjust-reset'));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ patch: { adjust: undefined } }));
    fireEvent.click(screen.getByTestId('photo-geometry-reset'));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ turn: undefined }) }),
    );
  });

  it('activar el contorno y la sombra de un texto', () => {
    const dispatch = vi.fn();
    renderPanel(text, dispatch);
    fireEvent.click(screen.getByLabelText('Contorno de las letras'));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { outline: expect.objectContaining({ width: expect.any(Number) }) } }),
    );
    fireEvent.click(within(screen.getByTestId('text-effects')).getByLabelText('Sombra'));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { shadow: expect.objectContaining({ blur: 24 }) } }),
    );
  });
});

describe('deshacer ediciones y páginas', () => {
  const document = contentDocumentSchema.parse({
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    canvas,
    pages: [
      { id: 'p1', layers: [image] },
      { id: 'p2', layers: [{ ...image, id: 'foto2' }] },
    ],
  });

  it('una edición se deshace y solo toca la capa de su página', () => {
    let state = initEditor(document);
    state = editorReducer(state, { type: 'selectPage', pageId: 'p2' });
    state = editorReducer(state, {
      type: 'update',
      id: 'foto2',
      patch: { adjust: { brightness: 20, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 }, turn: 90 },
    });
    expect(state.document.pages[1]!.layers[0]).toMatchObject({ turn: 90, adjust: { brightness: 20 } });
    expect(state.document.pages[0]!.layers[0]).not.toHaveProperty('turn');
    state = editorReducer(state, { type: 'selectPage', pageId: 'p1' });
    state = editorReducer(state, { type: 'undo' });
    expect(state.activePageId).toBe('p2');
    expect(state.document.pages[1]!.layers[0]).not.toHaveProperty('turn');
    expect(state.document.pages[1]!.layers[0]).not.toHaveProperty('adjust');
  });

  it('lo que no cambia nada no se guarda en la capa', () => {
    const layer = applyLayerPatch(image, {
      adjust: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      straighten: 0,
      shadow: undefined,
    });
    for (const key of ['adjust', 'crop', 'straighten', 'shadow']) expect(layer).not.toHaveProperty(key);
    expect(
      contentDocumentSchema.safeParse({
        schemaVersion: DOCUMENT_SCHEMA_VERSION,
        canvas,
        pages: [{ id: 'p1', layers: [layer] }],
      }).success,
    ).toBe(true);
  });
});

describe('lo que dibujan el lienzo y la exportación sale de la misma descripción', () => {
  it('una foto editada lleva su edición, su fondo y su sombra', async () => {
    const { describeLayer } = await import('../canvas/nodes');
    const spec = describeLayer(
      {
        ...image,
        adjust: { brightness: 10, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, filter: 'warm' },
        turn: 90,
        backdrop: { kind: 'blur', blur: 100 },
        shadow: { color: '#000000', blur: 20, offsetX: 0, offsetY: 8, opacity: 0.4 },
      } as Layer,
      new Map([[ASSET, 'https://x/y.jpg']]),
    );
    expect(spec).toMatchObject({
      kind: 'image',
      url: 'https://x/y.jpg',
      edit: { turn: 90, adjust: { filter: 'warm' } },
      backdrop: { kind: 'blur' },
      shadow: { blur: 20 },
    });
    expect((spec as { backdrop: { radius: number } }).backdrop.radius).toBeCloseTo(54);
  });

  it('las figuras nuevas son «sticker» y la línea usa su borde (o el relleno)', async () => {
    const { describeLayer } = await import('../canvas/nodes');
    const base = { ...image, type: 'shape' as const, fill: '#FF0000', stroke: null, cornerRadius: 0, height: 20 };
    const star = describeLayer({ ...base, shape: 'star' } as unknown as Layer, new Map());
    expect(star).toMatchObject({ kind: 'sticker', shape: 'star', fill: '#FF0000' });
    const line = describeLayer({ ...base, shape: 'line' } as unknown as Layer, new Map());
    expect(line).toMatchObject({ kind: 'sticker', shape: 'line', fill: null, stroke: { color: '#FF0000', width: 20 } });
    expect(describeLayer({ ...base, shape: 'rectangle' } as unknown as Layer, new Map())).toMatchObject({
      kind: 'rect',
    });
  });
});
