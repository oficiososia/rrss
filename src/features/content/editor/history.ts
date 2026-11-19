import {
  adaptDocument,
  MAX_IMAGE_BLUR,
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
import {
  alignMoves,
  distributeMoves,
  dropLoneGroups,
  expandGroups,
  type AlignTarget,
  type DistributeAxis,
  type Moves,
} from './arrange';

// Estado del editor y sus órdenes, como funciones puras: el documento es la
// fuente de verdad y cada cambio produce un documento nuevo. El lienzo (Konva)
// solo dibuja este estado y avisa de lo que hace la persona; nunca guarda nada
// por su cuenta. Deshacer y rehacer viven aquí y no se guardan en el servidor.

/** Pasos de deshacer que se conservan. */
export const HISTORY_LIMIT = 100;

export interface EditorState {
  document: ContentDocument;
  /** Capas seleccionadas, en el orden del documento (del fondo al frente). */
  selectedIds: string[];
  /** La capa seleccionada si hay exactamente una; null si no hay ninguna o hay varias. */
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
  /**
   * Elige una capa. Si está en un grupo, se elige el grupo entero salvo con
   * `exact` (desde el panel de capas, para cambiar una sola). Con `toggle` se
   * añade a la selección o se quita (Mayúsculas o Ctrl al hacer clic).
   */
  | { type: 'select'; id: string | null; toggle?: boolean; exact?: boolean }
  /** Elige varias (rectángulo de selección). Con `additive` se suman a las que ya había. */
  | { type: 'selectMany'; ids: string[]; additive?: boolean }
  | { type: 'add'; layer: Layer }
  | { type: 'update'; id: string; patch: LayerPatch; key?: string }
  /** Varios cambios de capa como un solo paso de deshacer (mover o transformar varias a la vez). */
  | { type: 'updateMany'; changes: { id: string; patch: LayerPatch }[]; key?: string }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; id: string; to: ReorderTarget }
  | { type: 'nudge'; id: string; dx: number; dy: number }
  /** Mueve todas las capas elegidas (las bloqueadas no). */
  | { type: 'nudgeSelection'; dx: number; dy: number }
  /** Borra las capas elegidas que no estén bloqueadas. */
  | { type: 'removeSelection' }
  /** Alinea las capas elegidas entre sí (o una sola respecto al lienzo). */
  | { type: 'align'; to: AlignTarget }
  /** Reparte el espacio entre tres o más capas elegidas. */
  | { type: 'distribute'; axis: DistributeAxis }
  /** Agrupa las capas elegidas (dos o más). */
  | { type: 'group' }
  /** Deshace los grupos de las capas elegidas. */
  | { type: 'ungroup' }
  | { type: 'setRatio'; ratio: AspectRatio }
  | { type: 'setBackground'; color: string; key?: string }
  | { type: 'setCopy'; patch: Partial<PostCopy>; key?: string }
  /**
   * Sustituye el documento entero en UN solo paso de deshacer (lo usa el
   * copiloto por voz: una orden dictada = un paso). Quien lo envía ya lo ha
   * validado con el esquema; aquí no se comprueba otra vez.
   */
  | { type: 'replace'; document: ContentDocument; select?: string[] }
  /** Corta la agrupación: el próximo cambio será un paso nuevo aunque tenga la misma clave. */
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' };

export function initEditor(document: ContentDocument): EditorState {
  return { document, selectedIds: [], selectedId: null, past: [], future: [], lastKey: null };
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
  if (next.type === 'image' && next.blur !== undefined) {
    const blur = Math.min(MAX_IMAGE_BLUR, Math.max(0, Number.isFinite(next.blur) ? next.blur : 0));
    if (blur > 0) next.blur = blur;
    else delete next.blur;
  }
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

let groupCounter = 0;
/** Identificador de grupo nuevo, con el formato que exige el esquema y sin repetir uno existente. */
export function newGroupId(layers: readonly Layer[]): string {
  const taken = new Set(layers.map((layer) => layer.groupId).filter(Boolean));
  let id: string;
  do {
    groupCounter += 1;
    id = `g${Date.now().toString(36)}${groupCounter.toString(36)}`;
  } while (taken.has(id));
  return id;
}

/** Selección normalizada: solo capas que existen, en el orden del documento, y la única si hay una. */
function selection(document: ContentDocument, ids: readonly string[]): Pick<EditorState, 'selectedIds' | 'selectedId'> {
  const wanted = new Set(ids);
  const selectedIds = document.layers.filter((layer) => wanted.has(layer.id)).map((layer) => layer.id);
  return { selectedIds, selectedId: selectedIds.length === 1 ? selectedIds[0]! : null };
}

function commit(
  state: EditorState,
  document: ContentDocument,
  key: string | null,
  selectedIds: readonly string[] = state.selectedIds,
): EditorState {
  if (document === state.document) return state;
  const grouped = key !== null && key === state.lastKey && state.past.length > 0;
  const past = grouped ? state.past : [...state.past, state.document].slice(-HISTORY_LIMIT);
  return { document, ...selection(document, selectedIds), past, future: [], lastKey: key };
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

/** Aplica desplazamientos a varias capas, respetando los límites del documento. */
function moveLayers(document: ContentDocument, moves: Moves): ContentDocument {
  if (moves.size === 0) return document;
  return {
    ...document,
    layers: document.layers.map((layer) => {
      const move = moves.get(layer.id);
      return move ? applyLayerPatch(layer, { x: layer.x + move.dx, y: layer.y + move.dy }) : layer;
    }),
  };
}

function selectedLayers(state: EditorState): Layer[] {
  const ids = new Set(state.selectedIds);
  return state.document.layers.filter((layer) => ids.has(layer.id));
}

function withoutGroup(layer: Layer): Layer {
  const rest = { ...layer };
  delete rest.groupId;
  return rest;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return initEditor(action.document);
    case 'select': {
      if (action.id === null) return { ...state, ...selection(state.document, []), lastKey: null };
      const ids = action.exact ? [action.id] : expandGroups(state.document.layers, [action.id]);
      if (!action.toggle) return { ...state, ...selection(state.document, ids), lastKey: null };
      const next = state.selectedIds.includes(action.id)
        ? state.selectedIds.filter((id) => !ids.includes(id))
        : [...state.selectedIds, ...ids];
      return { ...state, ...selection(state.document, next), lastKey: null };
    }
    case 'selectMany': {
      const ids = expandGroups(state.document.layers, action.ids);
      return {
        ...state,
        ...selection(state.document, action.additive ? [...state.selectedIds, ...ids] : ids),
        lastKey: null,
      };
    }
    case 'replace':
      return commit(state, action.document, null, action.select ?? state.selectedIds);
    case 'checkpoint':
      return state.lastKey === null ? state : { ...state, lastKey: null };
    case 'add': {
      if (state.document.layers.length >= MAX_LAYERS) return state;
      if (state.document.layers.some((layer) => layer.id === action.layer.id)) return state;
      const document = { ...state.document, layers: [...state.document.layers, action.layer] };
      return commit(state, document, null, [action.layer.id]);
    }
    case 'update': {
      const document = mapLayer(state.document, action.id, (layer) => applyLayerPatch(layer, action.patch));
      return commit(state, document, action.key ?? null);
    }
    case 'updateMany': {
      const patches = new Map(action.changes.map((change) => [change.id, change.patch]));
      let changed = false;
      const layers = state.document.layers.map((layer) => {
        const patch = patches.get(layer.id);
        if (!patch) return layer;
        changed = true;
        return applyLayerPatch(layer, patch);
      });
      return changed ? commit(state, { ...state.document, layers }, action.key ?? null) : state;
    }
    case 'nudge': {
      const document = mapLayer(state.document, action.id, (layer) =>
        layer.locked ? layer : applyLayerPatch(layer, { x: layer.x + action.dx, y: layer.y + action.dy }),
      );
      return commit(state, document, `nudge:${action.id}`);
    }
    case 'nudgeSelection': {
      const moves: Moves = new Map();
      for (const layer of selectedLayers(state)) {
        if (!layer.locked) moves.set(layer.id, { dx: action.dx, dy: action.dy });
      }
      return commit(state, moveLayers(state.document, moves), `nudge:${state.selectedIds.join(',')}`);
    }
    case 'remove': {
      if (!state.document.layers.some((layer) => layer.id === action.id)) return state;
      const layers = dropLoneGroups(state.document.layers.filter((layer) => layer.id !== action.id));
      return commit(
        state,
        { ...state.document, layers },
        null,
        state.selectedIds.filter((id) => id !== action.id),
      );
    }
    case 'removeSelection': {
      const doomed = new Set(
        selectedLayers(state)
          .filter((layer) => !layer.locked)
          .map((layer) => layer.id),
      );
      if (doomed.size === 0) return state;
      const layers = dropLoneGroups(state.document.layers.filter((layer) => !doomed.has(layer.id)));
      return commit(
        state,
        { ...state.document, layers },
        null,
        state.selectedIds.filter((id) => !doomed.has(id)),
      );
    }
    case 'align': {
      const moves = alignMoves(selectedLayers(state), action.to, state.document.canvas);
      return commit(state, moveLayers(state.document, moves), null);
    }
    case 'distribute':
      return commit(state, moveLayers(state.document, distributeMoves(selectedLayers(state), action.axis)), null);
    case 'group': {
      if (state.selectedIds.length < 2) return state;
      const groupId = newGroupId(state.document.layers);
      const ids = new Set(state.selectedIds);
      const layers = dropLoneGroups(
        state.document.layers.map((layer) => (ids.has(layer.id) ? { ...layer, groupId } : layer)),
      );
      return commit(state, { ...state.document, layers }, null);
    }
    case 'ungroup': {
      const ids = new Set(state.selectedIds);
      if (!state.document.layers.some((layer) => ids.has(layer.id) && layer.groupId)) return state;
      const layers = dropLoneGroups(
        state.document.layers.map((layer) => (ids.has(layer.id) && layer.groupId ? withoutGroup(layer) : layer)),
      );
      return commit(state, { ...state.document, layers }, null);
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
        ...selection(previous, state.selectedIds),
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
        ...selection(next, state.selectedIds),
        past: [...state.past, state.document].slice(-HISTORY_LIMIT),
        future: rest,
        lastKey: null,
      };
    }
  }
}
