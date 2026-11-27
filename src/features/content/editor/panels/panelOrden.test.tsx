import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentDocumentSchema, DOCUMENT_SCHEMA_VERSION, type Canvas, type Layer } from '../../document';
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
    expect(screen.getByTestId('photo-filter-warm')).toBeVisible();
    expect(screen.getByLabelText('Encaje en el recuadro')).toBeVisible();
    const list = sections();
    expect(list.map((s) => s.id)).toEqual([
      'photo.backdrop',
      'photo.blur',
      'common.opacity',
      'tech.position',
      'tech.anchor',
      'tech.name',
    ]);
    expect(list.every((s) => !s.open)).toBe(true);
  });

  it('texto: grosor arriba (tipografía, tamaño, color y alineación están en la barra); efectos plegados', () => {
    renderPanel(text);
    const main = screen.getByTestId('text-main');
    expect(within(main).getAllByText('Grosor').length).toBeGreaterThan(0);
    // La tipografía sale aquí solo en el móvil (en la barra no cabe); lo demás, nunca.
    for (const label of ['Texto', 'Tamaño de letra', 'Color del texto', 'Alineación']) {
      expect(within(main).queryByText(label)).not.toBeInTheDocument();
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
    expect(values).toContain('800 × 200 en 0, 0');
    expect(adjustSummary(image as never)).toBe('Sin cambios');
    expect(geometrySummary(image as never)).toBe('Sin cambios');
  });
});

describe('acciones de la capa', () => {
  it('el panel no repite las acciones de la barra flotante (duplicar, borrar, orden, alinear)', () => {
    renderPanel(text);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    for (const name of ['Duplicar', 'Borrar', 'Traer al frente', 'Llevar al fondo', 'Centrar en horizontal del lienzo']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('layer-heading')).toHaveTextContent('Hola');
  });

  it('duplicar crea una copia desplazada, elegida y fuera del grupo', () => {
    const doc = contentDocumentSchema.parse({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
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
    const backdrop = details('photo.backdrop');
    backdrop.open = true;
    fireEvent(backdrop, new Event('toggle'));
    expect(JSON.parse(window.localStorage.getItem(SECTION_MEMORY_KEY)!)).toEqual({ 'photo.backdrop': true });
    first.unmount();
    renderPanel(image);
    expect(details('photo.backdrop').open).toBe(true);
    expect(details('photo.blur').open).toBe(false);
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
    expect(sections()).toHaveLength(6);
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
