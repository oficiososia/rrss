import { pageView, type AspectRatio, type Canvas, type ContentDocument } from '../document';
import {
  applyCopilotOperations,
  type CopilotApplyContext,
  type CopilotAssetInfo,
  type CopilotPlacement,
  type PlacedCopilotOperation,
} from './apply';
import { colorRole, type CopilotBrandColor } from './legibility';
import {
  COPILOT_MAX_PLAN_PHOTOS,
  COPILOT_PLAN_OPS,
  copilotOp,
  type CopilotLayout,
  type CopilotOperation,
} from './operations';

// Órdenes que MONTAN una pieza entera («haz el menú de otoño: crea un fondo que
// parezca otoñal y pon los platos en el centro»), docs/copiloto-voz.md §15.
//
// La IA del copiloto devuelve, además de las operaciones de siempre, PASOS DE
// PLAN: crear el fondo con IA (`generate_background`), buscar fotos en la
// biblioteca (`find_photos`) y colocarlas (`place_photos`). Con alguno de esos
// pasos no se aplica nada al momento: aquí se construye el plan, el copiloto lo
// enseña con su coste máximo y, solo cuando la persona dice que sí, se ejecuta
// paso a paso y entra en el documento como UN paso de deshacer.
//
// Regla del producto: la IA solo crea el FONDO. Los platos y productos son
// siempre fotos reales de la biblioteca (recortadas y colocadas encima); nunca
// se genera comida ni producto.
//
// Este módulo es puro (sin React, sin red): qué plan sale de unas operaciones,
// cómo se dice, sus topes, dónde va cada foto y en qué operaciones normales
// acaba. El coste en palabras está en planCost.ts. Lo que gasta o lee (generar,
// buscar, recortar) lo hace el editor a través de `CopilotPlanHost` (planHost.ts).

/** Pasos que puede tener un plan, como mucho (cada recorte cuenta como un paso). */
export const PLAN_MAX_STEPS = 12;
/**
 * Coste máximo de un plan, en millonésimas de la moneda de cuenta (1 crédito).
 * Un plan que lo supere no se ofrece ejecutar tal cual: se dice por qué.
 */
export const PLAN_MAX_COST_MICROS = 1_000_000;

/**
 * Coletilla fija que se añade SIEMPRE a la indicación del fondo antes de
 * mandarla al generador de imágenes: pase lo que pase con la IA del copiloto,
 * lo que se pide es un fondo sin comida ni productos.
 */
export const BACKGROUND_PROMPT_SUFFIX =
  'Fondo para una pieza de redes sociales, sin comida, platos, bebidas, productos, personas, texto ni logotipos.';

/** Motivo con el que se descarta un fondo que nombra comida o productos (el mismo que da el servidor). */
export const BACKGROUND_ONLY_REASON = 'La IA solo crea el fondo: los platos y productos son fotos de la biblioteca.';

/** La indicación tal como se manda al generador (y como se enseña entera en el plan). */
export function backgroundPrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  return `${clean}${/[.!?…]$/.test(clean) ? '' : '.'} ${BACKGROUND_PROMPT_SUFFIX}`;
}

// ── Defensa: un fondo no nombra comida ni productos ──────────────────────

const FOOD_WORDS = new Set([
  ...['plato', 'comida', 'alimento', 'hamburguesa', 'pizza', 'bocadillo', 'postre', 'tarta', 'bebida', 'cerveza'].flatMap(
    (word) => [word, `${word}s`],
  ),
  ...['refresco', 'producto', 'botella'].flatMap((word) => [word, `${word}s`]),
  ...['coctel', 'cocteles', 'food', 'foods', 'dish', 'dishes', 'meal', 'meals', 'burger', 'burgers'],
  ...['drink', 'drinks', 'cocktail', 'cocktails', 'product', 'products', 'bottle', 'bottles'],
]);
const NEGATORS = new Set(['sin', 'ni', 'ningun', 'ninguna', 'ningunos', 'ningunas', 'no', 'without']);
const NEGATION_BREAKERS = new Set(['con', 'pero', 'sobre', 'junto', 'encima', 'bajo', 'entre', 'donde', 'que', 'with', 'but', 'on']);
const LIST_CLOSERS = new Set(['ni', 'y', 'o', 'e', 'u', 'nor', 'and', 'or']);
const CLAUSE_STARTERS = new Set(['con', 'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'y', 'with', 'a', 'an', 'the']);
const MAX_LIST_ITEM_WORDS = 3;

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

/**
 * ¿Pide la descripción de un fondo comida o un producto? Lo negado no cuenta
 * («sin comida, platos ni personas» es justo lo que se quiere); lo demás, sí.
 * Es una defensa por palabras, no entiende la frase: ante la duda, descarta.
 * Igual que en el servidor (`namesFoodOrProduct` de editor-copilot.ts).
 */
export function namesFoodOrProduct(prompt: string): boolean {
  for (const sentence of plain(prompt).split(/[.;:!?\n]+/)) {
    const clauses = sentence.split(',').map((clause) => clause.match(/[a-z0-9]+/g) ?? []);
    const listItem = (words: string[]) =>
      words.length > 0 &&
      words.length <= MAX_LIST_ITEM_WORDS &&
      !CLAUSE_STARTERS.has(words[0]!) &&
      !NEGATORS.has(words[0]!);
    let open = false;
    for (let index = 0; index < clauses.length; index += 1) {
      if (open) {
        // La lista negada sigue hasta el trozo que la cierra («ni», «y», «o»); si no se cierra, no era una lista.
        let end = index;
        while (end < clauses.length && listItem(clauses[end]!) && !clauses[end]!.some((word) => LIST_CLOSERS.has(word))) end += 1;
        if (end < clauses.length && listItem(clauses[end]!)) {
          index = end;
          open = false;
          continue;
        }
        open = false;
      }
      let negated = false;
      for (const word of clauses[index]!) {
        if (negated && NEGATION_BREAKERS.has(word)) negated = false;
        if (NEGATORS.has(word)) negated = true;
        else if (!negated && FOOD_WORDS.has(word)) return true;
      }
      open = negated;
    }
  }
  return false;
}

// ── «Sí» y «no» a un plan pendiente ──────────────────────────────────────

const ANSWER_FILLERS = new Set(['eh', 'em', 'mm', 'mmm', 'pues', 'bueno', 'por', 'favor', 'gracias', 'lo', 'la', 'ya', 'asi', 'tal', 'cual']);
const YES_WORDS = new Set(['si', 'vale', 'adelante', 'hazlo', 'hazla', 'venga', 'ok', 'okay', 'okey', 'dale', 'claro', 'perfecto']);
const YES_EXTRA = new Set(['de', 'acuerdo', 'confirmo', 'confirma', 'confirmado', 'ejecuta', 'ejecutalo', 'hagamoslo', 'haz']);
const NO_WORDS = new Set(['no', 'cancela', 'cancelar', 'cancelalo', 'cancelala', 'dejalo', 'olvidalo', 'descarta', 'descartalo', 'anula', 'anulalo']);
const NO_EXTRA = new Set(['mejor', 'nada', 'hagas', 'quiero', 'el', 'plan']);

/**
 * ¿Es lo dicho o escrito una respuesta a un plan pendiente? `yes` («sí»,
 * «vale», «adelante», «hazlo»), `no` («no», «cancela») o `null` si es otra
 * orden. Se mira la frase ENTERA: «sí, pero más grande» es otra orden.
 */
export function planAnswer(transcript: string): 'yes' | 'no' | null {
  const words = (plain(transcript).match(/[a-z0-9]+/g) ?? []).filter((word) => !ANSWER_FILLERS.has(word));
  if (words.length === 0 || words.length > 4) return null;
  if (words.some((word) => NO_WORDS.has(word))) {
    return words.every((word) => NO_WORDS.has(word) || NO_EXTRA.has(word)) ? 'no' : null;
  }
  const yes = words.some((word) => YES_WORDS.has(word) || word === 'acuerdo' || word.startsWith('confirm') || word.startsWith('ejecut'));
  return yes && words.every((word) => YES_WORDS.has(word) || YES_EXTRA.has(word)) ? 'yes' : null;
}

// ── Del resultado de la IA al plan ───────────────────────────────────────

const PLAN_OPS = new Set<string>(COPILOT_PLAN_OPS);

/** ¿Trae la orden algún paso de plan? Si lo trae, no se aplica nada sin confirmar. */
export function hasPlanSteps(operations: readonly CopilotOperation[]): boolean {
  return operations.some((operation) => PLAN_OPS.has(operation.op));
}

/** El color de la marca para un fondo liso: el que su perfil marca con el uso «fondo». */
export function brandBackgroundColor(palette: readonly CopilotBrandColor[]): string | null {
  return palette.find((color) => colorRole(color.role) === 'background')?.hex.toUpperCase() ?? null;
}

export type PlanBackground =
  /** Fondo generado con IA: lo único que se genera, y lo único que cuesta. */
  | { mode: 'ai'; prompt: string; ratio: AspectRatio }
  /** Sin IA de imagen: fondo liso del color de la marca. `reason` dice por qué. */
  | { mode: 'color'; color: string; reason: string }
  /** Sin IA de imagen y sin color de fondo en la marca: el fondo se queda como está. */
  | { mode: 'none'; reason: string };

export interface PlanPlacement {
  layout: CopilotLayout;
  /** Quitar el fondo a cada foto antes de colocarla. */
  cutout: boolean;
  /** Sombra suave bajo cada foto. */
  shadow: boolean;
}

/** Lo que queda de la orden, en su orden: dónde va el fondo, dónde las fotos y las operaciones normales. */
export type PlanSequenceItem = { kind: 'background' } | { kind: 'photos' } | { kind: 'operation'; operation: CopilotOperation };

export interface CopilotPlan {
  background: PlanBackground | null;
  /** Búsquedas en la biblioteca, en su orden. */
  searches: { query: string; count: number }[];
  /** Fotos que se quieren colocar (lo pedido en las búsquedas, con tope); 0 = las elegidas a mano. */
  wanted: number;
  placement: PlanPlacement | null;
  sequence: PlanSequenceItem[];
  /** Avisos para la persona (lo que no se hará y por qué). */
  notes: string[];
  /** Por qué el plan no se puede ejecutar tal cual (vacío = se puede). */
  blockers: string[];
}

export interface PlanEnvironment {
  /** Proporción del lienzo: la del fondo si la orden no dice otra. */
  canvasRatio: AspectRatio;
  /** ¿Se puede generar una imagen con IA? Si no, por qué (para decirlo tal cual). */
  imageAi: { available: true } | { available: false; reason: string };
  /** Colores de la marca, con su uso. */
  palette: readonly CopilotBrandColor[];
  /** ¿Se puede quitar el fondo aquí (en el navegador o con el servidor)? */
  canCutout: boolean;
}

/**
 * Lo que el plan pide al editor: lo único que gasta o lee. El editor lo hace
 * con los flujos que ya existen (`ai-media` para generar, la biblioteca para
 * buscar y la cadena de recorte para quitar el fondo); el copiloto no los
 * reimplementa. Cada recurso creado queda en la biblioteca con su procedencia.
 */
export interface CopilotPlanHost {
  /** ¿Se puede generar una imagen con IA aquí? Si no, por qué. */
  imageAi: PlanEnvironment['imageAi'];
  /** ¿Se puede quitar el fondo de una foto aquí? */
  canCutout: boolean;
  /** Coste máximo de generar el fondo, en micros, SIN reservar nada. `null` si no se puede saber antes. */
  estimateBackground(ratio: AspectRatio): Promise<number | null>;
  /** Genera el fondo (gasta cupo de IA) y devuelve el recurso que queda en la biblioteca. */
  generateBackground(prompt: string, ratio: AspectRatio, signal: AbortSignal): Promise<CopilotAssetInfo>;
  /** Busca fotos reales en la biblioteca de la marca (nombre, etiquetas y carpeta). No gasta. */
  searchLibrary(query: string, count: number): Promise<CopilotAssetInfo[]>;
  /**
   * Quita el fondo de una foto. `created` es false si ya había un recorte suyo
   * en la biblioteca (o la foto ya estaba recortada) y se ha usado ese.
   */
  cutout(photo: CopilotAssetInfo, signal: AbortSignal): Promise<{ asset: CopilotAssetInfo; created: boolean }>;
}

/** ¿Queda en el plan algo que confirmar? (un fondo o unas fotos; si no, es una orden normal). */
export function planNeedsConfirmation(plan: CopilotPlan): boolean {
  return (plan.background !== null && plan.background.mode !== 'none') || plan.placement !== null;
}

/** Las operaciones normales del plan, en su orden (titular, subtítulo…). */
export function planOperations(plan: CopilotPlan): CopilotOperation[] {
  return plan.sequence.flatMap((item) => (item.kind === 'operation' ? [item.operation] : []));
}

/**
 * Construye el plan a partir de las operaciones de una orden. No gasta ni lee
 * nada: solo decide qué pasos hay, qué no se hará y por qué.
 */
export function buildPlan(operations: readonly CopilotOperation[], env: PlanEnvironment): CopilotPlan {
  const notes: string[] = [];
  const blockers: string[] = [];
  const sequence: PlanSequenceItem[] = [];
  const searches: CopilotPlan['searches'] = [];
  let background: PlanBackground | null = null;
  let placement: PlanPlacement | null = null;
  let photosAt = -1;
  const ownPhotoBackground = operations.some((operation) => operation.op === 'set_background_image');

  for (const operation of operations) {
    if (operation.op === 'generate_background') {
      const prompt = (operation.prompt ?? '').replace(/\s+/g, ' ').trim();
      if (background) notes.push('Solo se crea un fondo por orden: el segundo no se hace.');
      else if (!prompt) notes.push('Falta la descripción del fondo: ese paso no se hace.');
      else if (namesFoodOrProduct(prompt)) notes.push(BACKGROUND_ONLY_REASON);
      else if (ownPhotoBackground) notes.push('Ya has pedido una foto tuya de fondo: no se genera otro.');
      else {
        if (env.imageAi.available) {
          background = { mode: 'ai', prompt, ratio: operation.ratio ?? env.canvasRatio };
          sequence.push({ kind: 'background' });
        } else {
          // Sin IA de imagen no se simula nada: un color liso de la marca, o nada, y se dice.
          const color = brandBackgroundColor(env.palette);
          const { reason } = env.imageAi;
          if (color) {
            background = { mode: 'color', color, reason };
            sequence.push({ kind: 'background' });
          } else {
            background = { mode: 'none', reason };
            notes.push(`${reason} La marca no tiene un color de fondo en su perfil: el fondo se queda como está.`);
          }
        }
      }
    } else if (operation.op === 'find_photos') {
      const query = (operation.query ?? '').replace(/\s+/g, ' ').trim();
      if (!query) continue;
      searches.push({ query, count: Math.min(Math.max(operation.count ?? 1, 1), COPILOT_MAX_PLAN_PHOTOS) });
      if (photosAt < 0) {
        photosAt = sequence.length;
        sequence.push({ kind: 'photos' });
      }
    } else if (operation.op === 'place_photos') {
      if (placement) {
        notes.push('Las fotos se colocan de una sola forma por orden: la segunda no se hace.');
        continue;
      }
      placement = { layout: operation.layout ?? 'center', cutout: operation.cutout === true, shadow: operation.on === true };
      // Las fotos van donde se dice colocarlas (si se buscaron antes, ese hueco se mueve aquí).
      if (photosAt >= 0) sequence.splice(photosAt, 1);
      photosAt = sequence.length;
      sequence.push({ kind: 'photos' });
    } else if (operation.op === 'editor' && (operation.action === 'undo' || operation.action === 'redo')) {
      notes.push('«Deshaz» y «rehaz» no se mezclan con un plan: dilo aparte.');
    } else {
      sequence.push({ kind: 'operation', operation });
    }
  }

  // Buscar fotos sin decir cómo colocarlas: en el centro, tal cual.
  if (!placement && searches.length > 0) placement = { layout: 'center', cutout: false, shadow: false };
  if (placement?.cutout && !env.canCutout) {
    placement = { ...placement, cutout: false };
    notes.push('Aquí no se puede quitar el fondo de las fotos: se colocan tal cual.');
  }
  const wanted = Math.min(
    searches.reduce((total, search) => total + search.count, 0),
    COPILOT_MAX_PLAN_PHOTOS,
  );

  const plan: CopilotPlan = { background, searches, wanted, placement, sequence, notes, blockers };
  const steps = planStepCount(plan);
  if (steps > PLAN_MAX_STEPS) {
    blockers.push(`El plan tiene ${steps} pasos y el tope es ${PLAN_MAX_STEPS}: pide menos cosas de una vez.`);
  }
  return plan;
}

const operationsOf = planOperations;

/** Pasos que ejecuta el plan: el fondo, cada búsqueda, cada recorte, colocar y cada operación normal. */
export function planStepCount(plan: CopilotPlan, photos?: number): number {
  const count = photos ?? plan.wanted;
  return (
    (plan.background && plan.background.mode !== 'none' ? 1 : 0) +
    plan.searches.length +
    (plan.placement?.cutout ? count : 0) +
    (plan.placement ? 1 : 0) +
    operationsOf(plan).length
  );
}

// ── El plan, en lenguaje llano ───────────────────────────────────────────

export type PlanStepKind = 'background' | 'find' | 'cutout' | 'place' | 'text' | 'other';
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface PlanStep {
  /** Estable entre repintados: `background`, `find-0`, `cutout`, `place`, `op-0`… */
  id: string;
  kind: PlanStepKind;
  /** Lo que hará, en lenguaje llano. */
  label: string;
  /** Lo que se enseña entero debajo (la indicación del fondo, el motivo de un cambio). */
  detail?: string;
}

const LAYOUT_LABEL: Record<CopilotLayout, string> = {
  center: 'en el centro',
  row: 'en fila',
  grid: 'en rejilla',
  fan: 'en abanico',
};
const TEXT_LABEL: Record<string, string> = { title: 'el titular', subtitle: 'el subtítulo', body: 'el texto', small: 'el texto pequeño' };

function operationLabel(operation: CopilotOperation): string {
  switch (operation.op) {
    case 'add_text':
      return `Poner ${TEXT_LABEL[operation.style ?? 'body']} «${(operation.text ?? '').replace(/\n/g, ' / ').slice(0, 80)}»`;
    case 'add_logo':
      return 'Poner el logotipo de la marca';
    case 'set_background_color':
      return `Poner el fondo de color ${operation.color ?? ''}`.trim();
    case 'set_background_image':
      return 'Poner tu foto de fondo';
    case 'set_canvas_ratio':
      return `Poner el lienzo en ${operation.ratio ?? 'otra proporción'}`;
    case 'add_shape':
      return 'Añadir una figura';
    case 'page':
      return 'Cambiar las páginas';
    case 'editor':
      return operation.action === 'save' ? 'Guardar una versión' : 'Abrir las plantillas';
    default:
      return 'Otro cambio del diseño';
  }
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Los pasos del plan, en el orden en que se hacen, para enseñarlos. `photos`: las fotos que ya se tienen. */
export function describePlan(plan: CopilotPlan, photos?: number): PlanStep[] {
  const steps: PlanStep[] = [];
  if (plan.background?.mode === 'ai') {
    steps.push({
      id: 'background',
      kind: 'background',
      label: `Crear el fondo con IA (${plan.background.ratio})`,
      detail: backgroundPrompt(plan.background.prompt),
    });
  } else if (plan.background?.mode === 'color') {
    steps.push({
      id: 'background',
      kind: 'background',
      label: `Poner de fondo un color liso de la marca (${plan.background.color})`,
      detail: `${plan.background.reason} En su lugar, un color liso: no se genera nada.`,
    });
  }
  plan.searches.forEach((search, index) => {
    steps.push({
      id: `find-${index}`,
      kind: 'find',
      label: `Buscar en la biblioteca ${search.count === 1 ? 'una foto' : `hasta ${search.count} fotos`} de «${search.query}»`,
    });
  });
  if (plan.placement) {
    const count = photos ?? plan.wanted;
    if (plan.placement.cutout) {
      steps.push({
        id: 'cutout',
        kind: 'cutout',
        label: count > 0 ? `Quitar el fondo a ${plural(count, 'foto', 'fotos')}` : 'Quitar el fondo a las fotos',
      });
    }
    steps.push({
      id: 'place',
      kind: 'place',
      label: `Colocar ${count === 1 ? 'la foto' : 'las fotos'} ${LAYOUT_LABEL[plan.placement.layout]}${plan.placement.shadow ? ', con sombra suave' : ''}`,
    });
  }
  operationsOf(plan).forEach((operation, index) => {
    steps.push({ id: `op-${index}`, kind: operation.op === 'add_text' ? 'text' : 'other', label: operationLabel(operation) });
  });
  return steps;
}

// ── Dónde va cada foto ───────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Margen del lienzo que las fotos de un plan no pisan: el 5 % del lado menor. */
const marginOf = (canvas: Pick<Canvas, 'width' | 'height'>) => Math.round(Math.min(canvas.width, canvas.height) * 0.05);
/** Una franja libre vale si tiene al menos este alto (parte del alto del lienzo). */
const MIN_FREE_BAND = 0.28;

/**
 * La franja del lienzo que queda libre para las fotos: la más alta entre lo
 * ocupado (el titular, el subtítulo, el logotipo). `fits` es false si no queda
 * una franja con sitio: entonces se usa el lienzo entero (menos el margen) y
 * las fotos pueden pisar algún texto.
 */
export function freeArea(canvas: Pick<Canvas, 'width' | 'height'>, occupied: readonly Rect[]): Rect & { fits: boolean } {
  const margin = marginOf(canvas);
  const gap = Math.round(canvas.height * 0.02);
  const top = margin;
  const bottom = canvas.height - margin;
  const full = { x: margin, y: top, width: canvas.width - margin * 2, height: bottom - top };
  const taken = occupied
    .map((rect) => ({ from: Math.max(top, rect.y - gap), to: Math.min(bottom, rect.y + rect.height + gap) }))
    .filter((band) => band.to > band.from)
    .sort((a, b) => a.from - b.from);
  if (taken.length === 0) return { ...full, fits: true };
  let best = { from: top, to: top };
  let cursor = top;
  for (const band of [...taken, { from: bottom, to: bottom }]) {
    if (band.from - cursor > best.to - best.from) best = { from: cursor, to: band.from };
    cursor = Math.max(cursor, band.to);
  }
  if (best.to - best.from < canvas.height * MIN_FREE_BAND) return { ...full, fits: false };
  return { x: full.x, y: best.from, width: full.width, height: best.to - best.from, fits: true };
}

/** Columnas que dan las celdas cuadradas más grandes para `count` fotos en un área. */
function bestColumns(area: Rect, count: number, gapRatio: number): number {
  let best = 1;
  let bestSide = 0;
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const side = Math.min(area.width / (columns + gapRatio * (columns - 1)), area.height / (rows + gapRatio * (rows - 1)));
    if (side > bestSide + 0.5) {
      best = columns;
      bestSide = side;
    }
  }
  return best;
}

/** Celdas cuadradas en `columns` columnas, centradas en el área; la última fila, centrada. */
function cells(area: Rect, count: number, columns: number, gapRatio: number): CopilotPlacement[] {
  const rows = Math.ceil(count / columns);
  const side = Math.min(area.width / (columns + gapRatio * (columns - 1)), area.height / (rows + gapRatio * (rows - 1)));
  const step = side * (1 + gapRatio);
  const blockHeight = side + step * (rows - 1);
  const out: CopilotPlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const inRow = row === rows - 1 ? count - columns * (rows - 1) : columns;
    const rowWidth = side + step * (inRow - 1);
    out.push({
      x: Math.round(area.x + (area.width - rowWidth) / 2 + (index % columns) * step),
      y: Math.round(area.y + (area.height - blockHeight) / 2 + row * step),
      width: Math.round(side),
      height: Math.round(side),
    });
  }
  return out;
}

const inset = (area: Rect, ratio: number): Rect => ({
  x: area.x + (area.width * (1 - ratio)) / 2,
  y: area.y + (area.height * (1 - ratio)) / 2,
  width: area.width * ratio,
  height: area.height * ratio,
});

/**
 * Cajas para `count` fotos (de 1 a 6) dentro de un área, según la disposición:
 *  - `center`: una grande en el centro, o varias agrupadas y un poco solapadas;
 *  - `row`: en una fila;
 *  - `grid`: en rejilla, con aire entre ellas;
 *  - `fan`: en abanico (giradas y solapadas, las de los lados algo más bajas).
 * Cada caja es cuadrada: la foto se encaja dentro con sus proporciones (apply.ts).
 * Ninguna se sale del área, tampoco girada.
 */
export function layoutBoxes(area: Rect, count: number, layout: CopilotLayout): CopilotPlacement[] {
  const total = Math.min(Math.max(Math.round(count), 0), COPILOT_MAX_PLAN_PHOTOS);
  if (total === 0) return [];
  if (layout === 'row') return cells(area, total, total, 0.06);
  if (layout === 'grid') return cells(area, total, bestColumns(area, total, 0.06), 0.06);
  if (layout === 'fan') {
    if (total === 1) return cells(inset(area, 0.9), 1, 1, 0);
    // Giro máximo de las de los extremos; solape del 30 % entre vecinas.
    const maxAngle = Math.min(15, 6 * (total - 1));
    const overlap = -0.3;
    const drop = 0.12;
    // Sitio para lo que crece una caja al girar (≈ 22 % a 15°) y para lo que bajan las de los lados.
    const side = Math.min(area.width / (total + overlap * (total - 1) + 0.25), area.height / (1.25 + drop));
    const step = side * (1 + overlap);
    const width = side + step * (total - 1);
    const left = area.x + (area.width - width) / 2;
    const topY = area.y + (area.height - side * (1 + drop)) / 2;
    return Array.from({ length: total }, (_, index) => {
      const t = (index / (total - 1)) * 2 - 1;
      return {
        x: Math.round(left + index * step),
        y: Math.round(topY + side * drop * t * t),
        width: Math.round(side),
        height: Math.round(side),
        rotation: Math.round(maxAngle * t),
      };
    });
  }
  // center
  if (total === 1) return cells(inset(area, 0.9), 1, 1, 0);
  const cluster = inset(area, 0.82);
  return cells(cluster, total, bestColumns(cluster, total, -0.08), -0.08);
}

/** Lo que ocupa una caja ya girada (para comprobar que no se sale). */
export function rotatedBounds(box: Rect & { rotation?: number }): Rect {
  const angle = ((box.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

// ── Del plan hecho a operaciones normales ────────────────────────────────

export interface PlanResources {
  /** El fondo generado (ya en la biblioteca), si el plan lo llevaba y se ha creado. */
  background: CopilotAssetInfo | null;
  /** Las fotos que se colocan, ya recortadas si tocaba. */
  photos: readonly CopilotAssetInfo[];
}

/**
 * Convierte el plan, con sus recursos ya creados, en operaciones normales del
 * editor, en el orden en que se aplican: el fondo (`set_background_image` o
 * `set_background_color`), una `add_image` por foto con su sitio, y el resto
 * de la orden (titular, subtítulo…). Las fotos van en la franja que dejan
 * libre los textos y el logotipo (los que pone la orden y los que ya había) y
 * por debajo de ellos. Quien llama las aplica de una vez
 * (`applyCopilotOperations`): UN paso de deshacer.
 */
export function composePlan(
  plan: CopilotPlan,
  resources: PlanResources,
  document: ContentDocument,
  context: CopilotApplyContext,
): { operations: PlacedCopilotOperation[]; notes: string[] } {
  const notes: string[] = [];
  const backgroundOperation: CopilotOperation | null =
    plan.background?.mode === 'ai' && resources.background
      ? copilotOp({ op: 'set_background_image', assetId: resources.background.id })
      : plan.background?.mode === 'color'
        ? copilotOp({ op: 'set_background_color', color: plan.background.color })
        : null;

  const base: PlacedCopilotOperation[] = [];
  let photosAt = -1;
  for (const item of plan.sequence) {
    if (item.kind === 'background') {
      if (backgroundOperation) base.push(backgroundOperation);
    } else if (item.kind === 'photos') photosAt = base.length;
    else base.push(item.operation);
  }
  const photos = plan.placement ? resources.photos.slice(0, COPILOT_MAX_PLAN_PHOTOS) : [];
  if (photos.length === 0 || !plan.placement) return { operations: base, notes };

  // Cómo queda la página sin las fotos: de ahí sale la franja libre (los textos no dependen de ellas).
  const preview = applyCopilotOperations(document, base, context);
  const page = preview.ok
    ? pageView(preview.document, preview.pageIndex)
    : pageView(document, context.pageIndex ?? 0);
  const occupied = page.layers.filter((layer) => (layer.type === 'text' || layer.type === 'logo') && layer.visible);
  const area = freeArea(page.canvas, occupied);
  if (!area.fits) notes.push('No queda una franja libre entre los textos: las fotos pueden pisar alguno. Muévelas si hace falta.');
  const boxes = layoutBoxes(area, photos.length, plan.placement.layout);
  const placed: PlacedCopilotOperation[] = photos.map((photo, index) => ({
    ...copilotOp({ op: 'add_image', assetId: photo.id }),
    place: { ...boxes[index]!, ...(plan.placement!.shadow ? { shadow: true } : {}) },
  }));
  // Donde la orden decía colocarlas. Vayan antes o después, quedan por debajo de los textos (apply.ts).
  const insertAt = photosAt < 0 ? base.length : photosAt;
  return { operations: [...base.slice(0, insertAt), ...placed, ...base.slice(insertAt)], notes };
}

// ── Buscar en la biblioteca ──────────────────────────────────────────────

/** Lo que hace falta de cada foto de la biblioteca para buscar entre ellas. */
export interface LibraryPhoto extends CopilotAssetInfo {
  tags?: readonly string[] | null;
  folder?: string | null;
  provenance?: unknown;
}

const SEARCH_STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas', 'y', 'con', 'para', 'por', 'en', 'que', 'mi', 'mis',
  'foto', 'fotos', 'imagen', 'imagenes', 'nuestro', 'nuestros', 'nuestra', 'nuestras', 'jpg', 'jpeg', 'png', 'webp',
]);

const searchWords = (text: string) =>
  (plain(text).match(/[a-z0-9]+/g) ?? []).filter((word) => word.length >= 3 && !SEARCH_STOPWORDS.has(word));

/** ¿Son la misma palabra salvo el plural o una terminación? («platos» y «plato», «otoño» y «otoñal»). */
function sameWord(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 3) return false;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= Math.max(3, Math.min(a.length, b.length) - 1);
}

const provenanceOf = (photo: LibraryPhoto) =>
  typeof photo.provenance === 'object' && photo.provenance !== null ? (photo.provenance as Record<string, unknown>) : {};

/** ¿Es una imagen generada con IA? Esas no valen como foto de un plato o un producto. */
export function isAiGenerated(photo: LibraryPhoto): boolean {
  const type = provenanceOf(photo).type;
  return type === 'ai_generation' || type === 'ai_animation';
}

/** ¿Es ya una foto con el fondo quitado? (una edición con el paso de recorte). */
export function isCutout(photo: LibraryPhoto): boolean {
  const steps = provenanceOf(photo).steps;
  return Array.isArray(steps) && steps.some((step) => typeof step === 'object' && step !== null && (step as { kind?: unknown }).kind === 'remove_background');
}

/** ¿Es exactamente «la foto `sourceId` con el fondo quitado» y nada más? (para no recortarla otra vez). */
export function isPlainCutoutOf(photo: LibraryPhoto, sourceId: string): boolean {
  const provenance = provenanceOf(photo);
  const steps = provenance.steps;
  return provenance.source_asset_id === sourceId && Array.isArray(steps) && steps.length === 1 && isCutout(photo);
}

/**
 * Las fotos de la biblioteca que mejor casan con lo que se busca, por nombre,
 * etiquetas y carpeta (sin tildes ni mayúsculas, y sin distinguir el plural).
 * Nunca devuelve una imagen generada con IA: los platos y productos son fotos
 * reales. Si casan una foto y una edición suya, se queda la original.
 */
export function matchLibraryPhotos<T extends LibraryPhoto>(photos: readonly T[], query: string, count: number): T[] {
  const terms = searchWords(query);
  if (terms.length === 0) return [];
  const scored = photos
    .filter((photo) => !isAiGenerated(photo))
    .map((photo, order) => {
      const name = searchWords(photo.name.replace(/\.[a-z0-9]{2,5}$/i, ''));
      const tags = (photo.tags ?? []).flatMap(searchWords);
      const folder = searchWords(photo.folder ?? '');
      let matched = 0;
      let score = 0;
      for (const term of terms) {
        const hit = Math.max(
          name.some((word) => sameWord(word, term)) ? 3 : 0,
          tags.some((word) => sameWord(word, term)) ? 3 : 0,
          folder.some((word) => sameWord(word, term)) ? 2 : 0,
        );
        if (hit > 0) matched += 1;
        score += hit;
      }
      return { photo, matched, score, order };
    })
    .filter((item) => item.matched > 0)
    .sort((a, b) => b.matched - a.matched || b.score - a.score || a.order - b.order);
  const found = new Set(scored.map((item) => item.photo.id));
  return scored
    .filter((item) => {
      const source = provenanceOf(item.photo).source_asset_id;
      return !(typeof source === 'string' && found.has(source));
    })
    .slice(0, Math.max(0, count))
    .map((item) => item.photo);
}
