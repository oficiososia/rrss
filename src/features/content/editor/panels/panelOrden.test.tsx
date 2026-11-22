import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentDocumentSchema, type Canvas, type Layer } from '../../document';
import { editorReducer, initEditor, type EditorAction } from '../history';
import { adjustSummary, geometrySummary } from './panelSummary';
import { PropertiesPanel } from './PropertiesPanel';
import { SECTION_MEMORY_KEY } from './sectionMemory';

const canvas: Canvas = { aspectRatio: '1:1', width: 1080, height: 1080, backgroundColor: '#FFFFFF' };
const brandStyle = { palette: [{ hex: '#112233', name: 'Azul' }], fonts: [] };
const base = {
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
} as const;
const image = {
  ...base,
  id: 'foto',
  type: 'image',
  source: { kind: 'asset', assetId: '11111111-1111-4111-8111-111111111111' },
  fit: 'cover',
  focus: { x: 0.5, y: 0.5 },
} as Layer;
const text = {
  ...base,
  id: 'titulo',
  type: 'text',
  text: 'Hola',
  fontFamily: 'sans-serif',
  fontSize: 80,
  fontWeight: 700,
  italic: false,
  color: '#111111',
  align: 'center',
  lineHeight: 1.2,
} as Layer;
const shape = {
  ...base,
  id: 'caja',
  type: 'shape',
  shape: 'rectangle',
  fill: '#FF0000',
  stroke: null,
  cornerRadius: 0,
} as Layer;

function renderPanel(layer: Layer, dispatch: (action: EditorAction) => void = vi.fn()) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PropertiesPanel
        layer={layer}
        canvas={canvas}
        readOnly={false}
        dispatch={dispatch}
        brandStyle={brandStyle}
        allowedRatios={null}
        textRef={{ current: null }}
        onEditPhoto={() => undefined}
      />
    </QueryClientProvider>,
  );
}

const sections = () =>
  screen.getAllByTestId('section-summary').map((summary) => {
    const details = summary.closest('details')!;
    return { id: details.getAttribute('data-section'), open: details.open };
  });
const details = (id: string) => document.querySelector<HTMLDetailsElement>(`[data-section="${id}"]`)!;

beforeEach(() => window.localStorage.clear());

describe('orden de las secciones del panel', () => {
  it('foto: lo más usado arriba y abierto; lo demás plegado y lo técnico al final', () => {
    renderPanel(image);
    expect(screen.getByTestId('layer-edit-photo')).toBeVisible();
    expect(screen.getByTestId('photo-filter-warm')).toBeVisible();
    expect(screen.getByLabelText('Encaje en el recuadro')).toBeVisible();
    const list = sections();
    expect(list.map((s) => s.id)).toEqual([
      'photo.light',
      'photo.geometry',
      'photo.focus',
      'photo.backdrop',
      'photo.blur',
      'common.opacity',
      'tech.position',
      'tech.anchor',
      'tech.name',
    ]);
    expect(list.every((s) => !s.open)).toBe(true);
    const edit = screen.getByTestId('layer-edit-photo');
    const firstSection = screen.getAllByTestId('section-summary')[0]!;
    expect(edit.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('texto: contenido, tipografía, tamaño y color arriba; efectos plegados', () => {
    renderPanel(text);
    const main = screen.getByTestId('text-main');
    for (const label of ['Texto', 'Tipografía', 'Tamaño de letra', 'Color del texto']) {
      expect(within(main).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(sections().map((s) => s.id)).toEqual([
      'text.spacing',
      'text.effects',
      'common.opacity',
      'tech.position',
      'tech.anchor',
      'tech.name',
    ]);
    expect(sections().some((s) => s.open)).toBe(false);
  });

  it('forma: relleno y borde arriba; esquinas y sombra plegadas', () => {
    renderPanel(shape);
    expect(within(screen.getByTestId('shape-main')).getByText('Relleno')).toBeVisible();
    expect(within(screen.getByTestId('shape-main')).getByText('Borde')).toBeVisible();
    expect(sections().map((s) => s.id)).toEqual([
      'shape.extras',
      'common.opacity',
      'tech.position',
      'tech.anchor',
      'tech.name',
    ]);
  });

  it('la cabecera de cada sección enseña el valor de ahora', () => {
    renderPanel({
      ...image,
      adjust: { brightness: 10, contrast: 0, saturation: 0, temperature: 0, sharpness: 0, filter: 'warm' },
      turn: 90,
    } as Layer);
    const values = screen.getAllByTestId('section-value').map((v) => v.textContent);
    expect(values).toContain('Cálido · 1 ajuste');
    expect(values).toContain('Girada 90°');
    expect(values).toContain('800 × 200 en 0, 0');
    expect(adjustSummary(image as never)).toBe('Sin cambios');
    expect(geometrySummary(image as never)).toBe('Sin cambios');
  });
});

describe('barra de acciones de la capa', () => {
  it('cada icono tiene nombre y hace lo suyo', () => {
    const dispatch = vi.fn();
    renderPanel(text, dispatch);
    const bar = screen.getByRole('toolbar');
    for (const name of [
      'Duplicar',
      'Borrar',
      'Traer al frente',
      'Subir un nivel',
      'Bajar un nivel',
      'Llevar al fondo',
    ]) {
      expect(within(bar).getByRole('button', { name })).toBeVisible();
    }
    fireEvent.click(within(bar).getByRole('button', { name: 'Duplicar' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Llevar al fondo' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Centrar en horizontal del lienzo' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Borrar' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'duplicate', id: 'titulo' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'reorder', id: 'titulo', to: 'back' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'align', to: 'centerX' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'remove', id: 'titulo' });
  });

  it('duplicar crea una copia desplazada, elegida y fuera del grupo', () => {
    const doc = contentDocumentSchema.parse({
      schemaVersion: 5,
      canvas,
      pages: [
        {
          id: 'p1',
          layers: [
            { ...text, groupId: 'g1' },
            { ...shape, groupId: 'g1' },
          ],
        },
      ],
    });
    const state = editorReducer(initEditor(doc), { type: 'duplicate', id: 'titulo' });
    const layers = state.document.pages[0]!.layers;
    expect(layers).toHaveLength(3);
    const copy = layers[2]!;
    expect(copy.id).not.toBe('titulo');
    expect(copy).toMatchObject({ type: 'text', text: 'Hola', x: 10, y: 10 });
    expect(copy.groupId).toBeUndefined();
    expect(state.selectedIds).toEqual([copy.id]);
  });
});

describe('recuerdo de las secciones abiertas', () => {
  it('abrir una sección se apunta y la siguiente vez sale abierta', () => {
    const first = renderPanel(image);
    const light = details('photo.light');
    light.open = true;
    fireEvent(light, new Event('toggle'));
    expect(JSON.parse(window.localStorage.getItem(SECTION_MEMORY_KEY)!)).toEqual({ 'photo.light': true });
    first.unmount();
    renderPanel(image);
    expect(details('photo.light').open).toBe(true);
    expect(details('photo.geometry').open).toBe(false);
  });

  it('lo apuntado manda sobre el valor de partida; lo que no es verdadero o falso se ignora', () => {
    window.localStorage.setItem(SECTION_MEMORY_KEY, JSON.stringify({ 'tech.name': true, 'photo.blur': 'raro' }));
    renderPanel(image);
    expect(details('tech.name').open).toBe(true);
    expect(details('photo.blur').open).toBe(false);
  });

  it('sin almacenamiento (o con datos rotos) el panel sale igual y no falla', () => {
    window.localStorage.setItem(SECTION_MEMORY_KEY, '{no es json');
    const first = renderPanel(image);
    expect(sections()).toHaveLength(9);
    first.unmount();
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    renderPanel(text);
    const effects = details('text.effects');
    effects.open = true;
    expect(() => fireEvent(effects, new Event('toggle'))).not.toThrow();
    expect(effects.open).toBe(true);
    get.mockRestore();
    set.mockRestore();
  });
});
