import {
  adaptDocument,
  MAX_LAYERS,
  type AspectRatio,
  type ContentDocument,
  type ImageLayer,
  type Layer,
  type LogoLayer,
  type PostCopy,
  type ShapeLayer,
  type TextLayer,
} from '../document';

// Estado del editor y sus órdenes, como funciones puras: el documento es la
// fuente de verdad y cada cambio produce un documento nuevo. El lienzo (Konva)
// solo dibuja este estado y avisa de lo que hace la persona; nunca guarda nada
// por su cuenta. Deshacer y rehacer viven aquí y no se guardan en el servidor.

/** Pasos de deshacer que se conservan. */
export const HISTORY_LIMIT = 100;

export interface EditorState {
  document: ContentDocument;
  /** Capa seleccionada; null si no hay ninguna. */
  selectedId: string | null;
  past: ContentDocument[];
  future: ContentDocument[];
  /**
   * Clave del último cambio. Dos cambios seguidos con la misma clave (teclear
   * en un campo, mover con las flechas) cuentan como un solo paso de deshacer.
   */
  lastKey: string | null;
}

type Editable<T> = Partial<Omit<T, 'id' | 'type'>>;
/** Campos que se pueden cambiar de una capa. El tipo y el identificador no cambian nunca. */
export type LayerPatch = Editable<ImageLayer> & Editable<TextLayer> & Editable<LogoLayer> & Editable<ShapeLayer>;

export type ReorderTarget = 'forward' | 'backward' | 'front' | 'back';

export type EditorAction =
  /** Abre un documento y empieza el historial de cero. */
  | { type: 'load'; document: ContentDocument }
  | { type: 'select'; id: string | null }
  | { type: 'add'; layer: Layer }
  | { type: 'update'; id: string; patch: LayerPatch; key?: string }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; id: string; to: ReorderTarget }
  | { type: 'nudge'; id: string; dx: number; dy: number }
  | { type: 'setRatio'; ratio: AspectRatio }
  | { type: 'setBackground'; color: string; key?: string }
  | { type: 'setCopy'; patch: Partial<PostCopy>; key?: string }
  /** Corta la agrupación: el próximo cambio será un paso nuevo aunque tenga la misma clave. */
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' };

export function initEditor(document: ContentDocument): EditorState {
  return { document, selectedId: null, past: [], future: [], lastKey: null };
}

const COORD_LIMIT = 100_000;
const clampCoord = (value: number) => Math.min(COORD_LIMIT, Math.max(-COORD_LIMIT, value));

/** Giro llevado a (-180, 180], que es lo que admite el documento sin perder nada. */
export function normalizeRotation(degrees: number): number {
  const turned = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const result = turned === -180 ? 180 : turned;
  return Math.round(result * 100) / 100;
}

/** Aplica un cambio a una capa respetando los límites del documento. */
export function applyLayerPatch(layer: Layer, patch: LayerPatch): Layer {
  const next = { ...layer, ...patch } as Layer;
  next.x = clampCoord(next.x);
  next.y = clampCoord(next.y);
  next.width = Math.min(COORD_LIMIT, Math.max(1, next.width));
  next.height = Math.min(COORD_LIMIT, Math.max(1, next.height));
  next.rotation = normalizeRotation(next.rotation);
  next.opacity = Math.min(1, Math.max(0, next.opacity));
  return next;
}

/** Nuevo orden de apilado. La primera capa del array queda al fondo. */
export function reorderLayers(layers: Layer[], id: string, to: ReorderTarget): Layer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index < 0) return layers;
  const target =
    to === 'front'
      ? layers.length - 1
      : to === 'back'
        ? 0
        : Math.min(layers.length - 1, Math.max(0, index + (to === 'forward' ? 1 : -1)));
  if (target === index) return layers;
  const next = [...layers];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

function commit(state: EditorState, document: ContentDocument, key: string | null, selectedId = state.selectedId) {
  if (document === state.document) return state;
  const grouped = key !== null && key === state.lastKey && state.past.length > 0;
  const past = grouped ? state.past : [...state.past, state.document].slice(-HISTORY_LIMIT);
  return { document, selectedId, past, future: [], lastKey: key };
}

function mapLayer(document: ContentDocument, id: string, change: (layer: Layer) => Layer): ContentDocument {
  let changed = false;
  const layers = document.layers.map((layer) => {
    if (layer.id !== id) return layer;
    changed = true;
    return change(layer);
  });
  return changed ? { ...document, layers } : document;
}

/** Si la capa seleccionada ya no existe (tras deshacer, por ejemplo), se quita la selección. */
function keepSelection(document: ContentDocument, selectedId: string | null): string | null {
  return selectedId && document.layers.some((layer) => layer.id === selectedId) ? selectedId : null;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return initEditor(action.document);
    case 'select':
      return { ...state, selectedId: keepSelection(state.document, action.id), lastKey: null };
    case 'checkpoint':
      return state.lastKey === null ? state : { ...state, lastKey: null };
    case 'add': {
      if (state.document.layers.length >= MAX_LAYERS) return state;
      if (state.document.layers.some((layer) => layer.id === action.layer.id)) return state;
      const document = { ...state.document, layers: [...state.document.layers, action.layer] };
      return commit(state, document, null, action.layer.id);
    }
    case 'update': {
      const document = mapLayer(state.document, action.id, (layer) => applyLayerPatch(layer, action.patch));
      return commit(state, document, action.key ?? null);
    }
    case 'nudge': {
      const document = mapLayer(state.document, action.id, (layer) =>
        layer.locked ? layer : applyLayerPatch(layer, { x: layer.x + action.dx, y: layer.y + action.dy }),
      );
      return commit(state, document, `nudge:${action.id}`);
    }
    case 'remove': {
      if (!state.document.layers.some((layer) => layer.id === action.id)) return state;
      const document = { ...state.document, layers: state.document.layers.filter((layer) => layer.id !== action.id) };
      return commit(state, document, null, state.selectedId === action.id ? null : state.selectedId);
    }
    case 'reorder': {
      const layers = reorderLayers(state.document.layers, action.id, action.to);
      if (layers === state.document.layers) return state;
      return commit(state, { ...state.document, layers }, null);
    }
    case 'setRatio': {
      if (action.ratio === state.document.canvas.aspectRatio) return state;
      return commit(state, adaptDocument(state.document, action.ratio), null);
    }
    case 'setBackground': {
      if (action.color === state.document.canvas.backgroundColor) return state;
      const document = { ...state.document, canvas: { ...state.document.canvas, backgroundColor: action.color } };
      return commit(state, document, action.key ?? null);
    }
    case 'setCopy': {
      const document = { ...state.document, copy: { ...state.document.copy, ...action.patch } };
      return commit(state, document, action.key ?? null);
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        document: previous,
        selectedId: keepSelection(previous, state.selectedId),
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future],
        lastKey: null,
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        document: next,
        selectedId: keepSelection(next, state.selectedId),
        past: [...state.past, state.document].slice(-HISTORY_LIMIT),
        future: rest,
        lastKey: null,
      };
    }
  }
}
