import { pageView, type AspectRatio, type Canvas, type ContentDocument, type Layer, type PageView } from '../document';
import {
  applyCopilotOperations,
  type CopilotApplyContext,
  type CopilotAssetInfo,
  type CopilotPlacement,
  type PlacedCopilotOperation,
} from './apply';
import { isAppDesign } from '../../library/filters';
import { asksForBackground, occasionHeadline } from './intent';
import { colorRole, type CopilotBrandColor, type MeasuredTone } from './legibility';
import {
  COPILOT_MAX_PLAN_PHOTOS,
  COPILOT_PLAN_OPS,
  copilotOp,
  isDictated,
  type CopilotLayout,
  type CopilotOperation,
} from './operations';
import type { SubjectBox } from './subject';

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
// se genera comida ni producto. Por eso, sobre una imagen de fondo las fotos
// van RECORTADAS por defecto (lo decide `buildPlan`, no la IA) y la tarjeta
// deja colocarlas enteras con un interruptor (`setPlanCutout`).
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

/**
 * Lo que queda de la orden, en su orden: dónde va el fondo, dónde las fotos y las operaciones normales.
 * `proposed`: un texto que NO ha dicho la persona y propone el copiloto para completar la pieza: el
 * titular sacado de la ocasión que nombra la orden (`headline`) o la llamada a la acción del perfil de
 * la marca (`cta`). Se enseñan como propuestos antes del «sí».
 */
export type PlanSequenceItem =
  | { kind: 'background' }
  | { kind: 'photos' }
  | { kind: 'operation'; operation: CopilotOperation; proposed?: 'headline' | 'cta' };

/** El fondo con IA que se ofrece como alternativa (no lo primero) cuando la orden no pide un fondo. */
export interface PlanAiAlternative {
  prompt: string;
  ratio: AspectRatio;
  /** Cómo irían las fotos encima del fondo creado (recortadas). */
  placement: PlanPlacement;
  /** Fotos que se querrían colocar entonces. */
  wanted: number;
}

export interface CopilotPlan {
  background: PlanBackground | null;
  /** Búsquedas en la biblioteca, en su orden. */
  searches: { query: string; count: number }[];
  /** Fotos que se quieren colocar (lo pedido en las búsquedas, con tope); 0 = las elegidas a mano. */
  wanted: number;
  placement: PlanPlacement | null;
  /**
   * ¿Van las fotos sobre una IMAGEN de fondo? (la que crea este plan, la foto de
   * fondo que pone la orden o la que ya tenía la página). Entonces se recortan
   * por defecto; sobre un lienzo de color liso se respeta lo que diga la IA.
   */
  overImage: boolean;
  /** ¿Se puede quitar el fondo aquí? Sin ello no se ofrece el interruptor de recorte. */
  canCutout: boolean;
  sequence: PlanSequenceItem[];
  /** Avisos para la persona (lo que no se hará y por qué). */
  notes: string[];
  /** Por qué el plan no se puede ejecutar tal cual (vacío = se puede). */
  blockers: string[];
  /**
   * La orden no pedía un fondo pero la IA lo propuso: el plan usa una foto REAL
   * que llena el lienzo y deja el fondo con IA como opción (`setPlanAiBackground`).
   * `active`: la persona lo ha elegido.
   */
  aiAlternative?: PlanAiAlternative & { active: boolean };
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
  /** ¿Tiene ya la página una foto de fondo (una imagen que cubre todo el lienzo)? */
  backgroundImage?: boolean;
  /**
   * La orden tal como se dijo. Con ella, un fondo con IA que la orden no pide
   * (`asksForBackground`) no es lo primero: se usa una foto real de la marca.
   * Sin ella (pruebas antiguas, banco en seco), el plan es el de siempre.
   */
  transcript?: string;
  /** ¿Tiene ya textos la página? Si no, el plan completa la pieza con un titular y la llamada de la marca. */
  pageHasTexts?: boolean;
  /** Llamada a la acción del perfil de la marca («Reserva tu mesa»), si la tiene. */
  callToAction?: string | null;
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
  /**
   * Genera el fondo (gasta cupo de IA) y devuelve el recurso que queda en la
   * biblioteca y, si se sabe, lo que ha costado de verdad (`costMicros`).
   */
  generateBackground(
    prompt: string,
    ratio: AspectRatio,
    signal: AbortSignal,
  ): Promise<CopilotAssetInfo & { costMicros?: number | null }>;
  /** Busca fotos reales en la biblioteca de la marca (nombre, etiquetas y carpeta). No gasta. */
  searchLibrary(query: string, count: number): Promise<CopilotAssetInfo[]>;
  /**
   * Quita el fondo de una foto. `created` es false si ya había un recorte suyo
   * en la biblioteca (o la foto ya estaba recortada) y se ha usado ese.
   */
  cutout(photo: CopilotAssetInfo, signal: AbortSignal): Promise<{ asset: CopilotAssetInfo; created: boolean }>;
  /**
   * Mide el tono de una imagen de la biblioteca (el fondo recién generado): el
   * medio y por zonas, para que los textos se lean encima. No gasta. `null` si
   * no se puede medir (el navegador no deja leer sus píxeles, la carga falla o
   * tarda demasiado): entonces los textos llevan un contorno y se dice.
   */
  measureTone?(image: CopilotAssetInfo, signal: AbortSignal): Promise<MeasuredTone | null>;
  /**
   * Dónde está lo recortado dentro de un recorte (la caja de sus píxeles
   * opacos), para enseñar solo eso y que no quede diminuto. No gasta. `null`
   * si no se puede leer o si lo recortado ya ocupa casi toda la foto.
   */
  measureSubject?(image: CopilotAssetInfo, signal: AbortSignal): Promise<SubjectBox | null>;
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
  // Sin pedir un fondo («hazme algo para el finde que quede bonito»), el fondo con IA no es lo primero:
  // la pieza se monta con una foto REAL de la marca que llena el lienzo, y el fondo con IA queda como opción.
  const realPhotoFirst = env.transcript !== undefined && !asksForBackground(env.transcript);
  let alternative: { prompt: string; ratio: AspectRatio } | null = null;

  for (const operation of operations) {
    if (operation.op === 'generate_background') {
      const prompt = (operation.prompt ?? '').replace(/\s+/g, ' ').trim();
      if (background || alternative) notes.push('Solo se crea un fondo por orden: el segundo no se hace.');
      else if (!prompt) notes.push('Falta la descripción del fondo: ese paso no se hace.');
      else if (namesFoodOrProduct(prompt)) notes.push(BACKGROUND_ONLY_REASON);
      else if (ownPhotoBackground) notes.push('Ya has pedido una foto tuya de fondo: no se genera otro.');
      else if (realPhotoFirst) {
        alternative = { prompt, ratio: operation.ratio ?? env.canvasRatio };
        // Donde iba el fondo van ahora las fotos (la de fondo es una de ellas).
        if (photosAt < 0) {
          photosAt = sequence.length;
          sequence.push({ kind: 'photos' });
        }
      } else {
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
  const searched = Math.min(
    searches.reduce((total, search) => total + search.count, 0),
    COPILOT_MAX_PLAN_PHOTOS,
  );
  // El fondo con IA que no se pidió queda como opción; lo primero es UNA foto real a sangre.
  let aiAlternative: CopilotPlan['aiAlternative'];
  // Un fondo pedido de verdad manda sobre «una foto que llena el lienzo»: las fotos van encima, en el centro.
  if (placement?.layout === 'fill' && background) placement = { ...placement, layout: 'center' };
  if (alternative && env.imageAi.available) {
    aiAlternative = {
      ...alternative,
      placement: { ...(placement ?? { layout: 'center', cutout: true, shadow: false }), cutout: true },
      wanted: searched,
      active: false,
    };
  }
  if (alternative) {
    if (placement?.layout !== 'fill') {
      notes.push(
        aiAlternative
          ? 'No has pedido un fondo: monto la pieza con una foto tuya que llena el lienzo. Si prefieres el fondo creado con IA, márcalo antes de decir que sí.'
          : 'No has pedido un fondo: monto la pieza con una foto tuya que llena el lienzo.',
      );
    }
    placement = { layout: 'fill', cutout: false, shadow: false };
  }
  const fill = placement?.layout === 'fill';
  if (fill) placement = { layout: 'fill', cutout: false, shadow: false };

  // Sobre una IMAGEN de fondo (la que crea este plan, la foto de fondo que pone la orden o la que
  // ya tiene la página), las fotos van recortadas: es lo predeterminado, diga lo que diga la IA
  // (una foto entera encima deja ver un rectángulo con su propio fondo). La persona puede
  // cambiarlo en la tarjeta. Sobre un lienzo de color liso se respeta lo que diga la IA. Una foto
  // que LLENA el lienzo (`fill`) es ella misma el fondo: entera, nunca recortada.
  const overImage = !fill && (background?.mode === 'ai' || ownPhotoBackground || env.backgroundImage === true);
  if (placement && overImage) placement = { ...placement, cutout: true };
  if (placement?.cutout && !env.canCutout) {
    placement = { ...placement, cutout: false };
    notes.push('Aquí no se puede quitar el fondo de las fotos: se colocan tal cual.');
  }
  const wanted = fill ? Math.min(searched, 1) : searched;

  // Una pieza en blanco se completa: el titular de la ocasión que nombra la orden («para el finde» →
  // «Este finde») si no se ha dictado uno, y la llamada a la acción del perfil de la marca. Se enseñan
  // en el plan como propuestos antes del «sí»; no los escribe la IA.
  if ((placement || background) && env.transcript !== undefined && env.pageHasTexts === false) {
    const texts = sequence.flatMap((item) => (item.kind === 'operation' && item.operation.op === 'add_text' ? [item.operation] : []));
    const headline = occasionHeadline(env.transcript);
    if (headline && !texts.some((text) => text.style === 'title')) {
      sequence.push({ kind: 'operation', operation: copilotOp({ op: 'add_text', text: headline, style: 'title', position: 'top' }), proposed: 'headline' });
    }
    const cta = env.callToAction?.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (cta && !texts.some((text) => text.text !== null && isDictated(cta, text.text))) {
      sequence.push({ kind: 'operation', operation: copilotOp({ op: 'add_text', text: cta, style: 'subtitle', position: 'bottom' }), proposed: 'cta' });
    }
  }

  const plan: CopilotPlan = {
    background,
    searches,
    wanted,
    placement,
    overImage,
    canCutout: env.canCutout,
    sequence,
    notes,
    blockers,
    ...(aiAlternative ? { aiAlternative } : {}),
  };
  return { ...plan, blockers: stepBlockers(plan) };
}

/**
 * El interruptor «Crear el fondo con IA» de la tarjeta, cuando la orden no
 * pedía un fondo: con él, el fondo se crea con IA y las fotos van recortadas
 * encima (lo de antes); sin él, una foto real llena el lienzo. Devuelve el
 * mismo plan si no hay alternativa o ya estaba así. Sin IA de imagen no hay
 * alternativa (no se ofrece).
 */
export function setPlanAiBackground(plan: CopilotPlan, on: boolean): CopilotPlan {
  const alternative = plan.aiAlternative;
  if (!alternative || alternative.active === on) return plan;
  const next: CopilotPlan = on
    ? {
        ...plan,
        background: { mode: 'ai', prompt: alternative.prompt, ratio: alternative.ratio },
        placement: { ...alternative.placement, cutout: alternative.placement.cutout && plan.canCutout },
        wanted: alternative.wanted,
        overImage: true,
        sequence: [{ kind: 'background' }, ...plan.sequence],
        aiAlternative: { ...alternative, active: true },
      }
    : {
        ...plan,
        background: null,
        placement: { layout: 'fill', cutout: false, shadow: false },
        wanted: Math.min(alternative.wanted, 1),
        overImage: false,
        sequence: plan.sequence.filter((item) => item.kind !== 'background'),
        aiAlternative: { ...alternative, active: false },
      };
  return { ...next, blockers: stepBlockers(next) };
}

/** Por qué no se puede ejecutar un plan por su tamaño (vacío = cabe en el tope de pasos). */
function stepBlockers(plan: CopilotPlan): string[] {
  const steps = planStepCount(plan);
  return steps > PLAN_MAX_STEPS ? [`El plan tiene ${steps} pasos y el tope es ${PLAN_MAX_STEPS}: pide menos cosas de una vez.`] : [];
}

/**
 * El interruptor de la tarjeta: recortar las fotos (quitarles su fondo) o
 * colocarlas enteras. Devuelve el plan con ese cambio (los pasos, su texto y
 * el tope de pasos se recalculan); el mismo plan si no hay fotos que colocar,
 * si aquí no se puede recortar o si ya estaba así.
 */
export function setPlanCutout(plan: CopilotPlan, cutout: boolean): CopilotPlan {
  if (!plan.placement || plan.placement.layout === 'fill' || plan.placement.cutout === cutout || (cutout && !plan.canCutout)) return plan;
  const next: CopilotPlan = { ...plan, placement: { ...plan.placement, cutout } };
  return { ...next, blockers: stepBlockers(next) };
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
  fill: 'de fondo, llenando el lienzo de borde a borde',
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
    // Cómo van: recortadas (se dice siempre) o, si van sobre una imagen de fondo y se ha pedido dejarlas enteras, también.
    const one = count === 1 || plan.placement.layout === 'fill';
    const how = plan.placement.cutout
      ? `, ${one ? 'recortada' : 'recortadas'}, sin su fondo`
      : plan.overImage
        ? `, ${one ? 'entera' : 'enteras'}, con su fondo`
        : plan.placement.layout === 'fill'
          ? ' (se recorta lo que sobre)'
          : '';
    steps.push({
      id: 'place',
      kind: 'place',
      label: `Colocar ${one ? 'la foto' : 'las fotos'} ${LAYOUT_LABEL[plan.placement.layout]}${how}${plan.placement.shadow ? ', con sombra suave' : ''}`,
    });
  }
  const proposed = plan.sequence.flatMap((item) => (item.kind === 'operation' ? [item.proposed] : []));
  operationsOf(plan).forEach((operation, index) => {
    const from = proposed[index];
    steps.push({
      id: `op-${index}`,
      kind: operation.op === 'add_text' ? 'text' : 'other',
      label:
        from === 'headline'
          ? `${operationLabel(operation)} (propuesto: no lo has dicho; cámbialo luego si quieres)`
          : from === 'cta'
            ? `Poner la llamada de la marca «${(operation.text ?? '').slice(0, 80)}» (de su perfil)`
            : operationLabel(operation),
    });
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
/** Una franja libre vale si tiene al menos este alto (parte del alto del área). */
const MIN_FREE_BAND = 0.3;
/** Aire entre lo ocupado (un texto, el logotipo) y las fotos (parte del alto del área). */
const BAND_GAP = 0.022;

/**
 * Con «en el centro», el grupo de fotos se encoge para caber centrado en el
 * lienzo solo si le queda al menos esta parte del alto del hueco libre.
 */
const CENTERED_SHARE = 0.7;

/** El lienzo menos su margen: donde pueden ir las fotos de un plan. */
export function canvasArea(canvas: Pick<Canvas, 'width' | 'height'>): Rect {
  const margin = marginOf(canvas);
  return { x: margin, y: margin, width: canvas.width - margin * 2, height: canvas.height - margin * 2 };
}

/**
 * El hueco libre más grande de un área: la franja (a todo el ancho) más alta
 * entre lo ocupado; a igualdad, la de más abajo (el texto encabeza). `fits` es
 * false si no queda una franja con sitio: entonces vale el área entera y las
 * fotos pueden pisar algún texto.
 */
function freeBand(area: Rect, occupied: readonly Rect[]): Rect & { fits: boolean } {
  if (occupied.length === 0) return { ...area, fits: true };
  const gap = Math.round(area.height * BAND_GAP);
  const top = area.y;
  const bottom = area.y + area.height;
  const taken = occupied
    .map((rect) => ({ from: Math.max(top, rect.y - gap), to: Math.min(bottom, rect.y + rect.height + gap) }))
    .filter((band) => band.to > band.from)
    .sort((a, b) => a.from - b.from);
  let best = { from: top, to: top };
  let cursor = top;
  for (const band of [...taken, { from: bottom, to: bottom }]) {
    if (band.from > cursor && band.from - cursor >= best.to - best.from - 1) best = { from: cursor, to: band.from };
    cursor = Math.max(cursor, band.to);
  }
  if (best.to - best.from < area.height * MIN_FREE_BAND) return { ...area, fits: false };
  return { x: area.x, y: best.from, width: area.width, height: best.to - best.from, fits: true };
}

/**
 * La franja del lienzo que queda libre para las fotos: la más alta entre lo
 * ocupado (el titular, el subtítulo, el logotipo). `fits` es false si no queda
 * una franja con sitio: entonces se usa el lienzo entero (menos el margen) y
 * las fotos pueden pisar algún texto.
 */
export function freeArea(canvas: Pick<Canvas, 'width' | 'height'>, occupied: readonly Rect[]): Rect & { fits: boolean } {
  return freeBand(canvasArea(canvas), occupied);
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
 *
 * `occupied`: lo que ya ocupa sitio en el área (los textos que había, los que
 * añade el propio plan, el logotipo). Las fotos van entonces en el hueco libre
 * más grande (`freeBand`), sin pisar nada, agrupadas y centradas en ese hueco
 * a lo ancho y a lo alto; si no queda un hueco con sitio, en el área entera.
 * Con `center` («en el centro») el grupo va al centro exacto del área —el del
 * lienzo—: tal cual si cabe ahí sin salirse del hueco, o encogido lo justo si
 * con eso cabe sin perder más de un 30 % del alto del hueco; si no (el hueco
 * queda a un lado del centro), se queda centrado en el hueco.
 */
export function layoutBoxes(frame: Rect, count: number, layout: CopilotLayout, occupied: readonly Rect[] = []): CopilotPlacement[] {
  const total = Math.min(Math.max(Math.round(count), 0), COPILOT_MAX_PLAN_PHOTOS);
  if (total === 0) return [];
  const area: Rect = occupied.length > 0 ? freeBand(frame, occupied) : frame;
  const boxes = boxesIn(area, total, layout);
  if (layout !== 'center' || area === frame) return boxes;
  // «En el centro» es el centro del lienzo. Si el grupo cabe ahí sin salirse del hueco libre, va ahí tal cual.
  const middle = frame.y + frame.height / 2;
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const shift = Math.round(middle - (top + bottom) / 2);
  if (top + shift >= area.y && bottom + shift <= area.y + area.height) {
    return shift === 0 ? boxes : boxes.map((box) => ({ ...box, y: box.y + shift }));
  }
  // Si no cabe, se encoge lo justo para caber centrado, siempre que no pierda demasiado (`CENTERED_SHARE`).
  const half = Math.min(middle - area.y, area.y + area.height - middle);
  if (half * 2 >= area.height * CENTERED_SHARE) return boxesIn({ ...area, y: middle - half, height: half * 2 }, total, layout);
  // Y si ni así (el hueco queda a un lado del centro), el grupo se queda centrado en el hueco.
  return boxes;
}

/** Las cajas de una disposición dentro de un área ya libre, centradas en ella. */
function boxesIn(area: Rect, total: number, layout: CopilotLayout): CopilotPlacement[] {
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
  /**
   * Dónde está lo recortado dentro de cada recorte (por id de recurso): se
   * enseña solo esa zona para que llene su sitio y no quede diminuto.
   */
  subjects?: ReadonlyMap<string, SubjectBox>;
}

/**
 * Convierte el plan, con sus recursos ya creados, en operaciones normales del
 * editor, en el orden en que se aplican: el fondo (`set_background_image` o
 * `set_background_color`), una `add_image` por foto con su sitio, y el resto
 * de la orden (titular, subtítulo…). Antes de nada, los textos que ya había
 * en el centro se apartan para dejárselo a las fotos (`clearCenter`); las fotos
 * van en el hueco libre más grande que dejan los textos y el logotipo (los que
 * pone la orden y los que ya había), centradas en él y por debajo de ellos.
 * Quien llama las aplica de una vez (`applyCopilotOperations`): UN paso de
 * deshacer. Con el tono del fondo nuevo en el contexto (`imageTones`,
 * `imageZones`), al aplicar se revisa que los textos se lean encima.
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

  // Una foto que LLENA el lienzo: es la foto de fondo (de borde a borde, recortando lo que sobre).
  // Va donde la orden decía las fotos; los textos quedan encima y se revisa que se lean.
  if (plan.placement.layout === 'fill') {
    const fill = copilotOp({ op: 'set_background_image', assetId: photos[0]!.id });
    const at = photosAt < 0 ? 0 : photosAt;
    return { operations: [...base.slice(0, at), fill, ...base.slice(at)], notes };
  }

  // Cómo queda la página sin las fotos con unas operaciones: de ahí sale el hueco libre (los textos no dependen de ellas).
  const settled = (operations: PlacedCopilotOperation[]) => {
    const preview = applyCopilotOperations(document, operations, context);
    const page = preview.ok ? pageView(preview.document, preview.pageIndex) : pageView(document, context.pageIndex ?? 0);
    const occupied = page.layers.filter((layer) => (layer.type === 'text' || layer.type === 'logo') && layer.visible);
    return { canvas: page.canvas, occupied, free: freeArea(page.canvas, occupied) };
  };
  let before = base;
  let layout = settled(base);

  // 1. Los textos que ya había en el centro se apartan (títulos arriba, el resto abajo), pero solo
  //    si con ello el hueco para las fotos crece. No si la orden cambia de página o de proporción:
  //    entonces la página de las fotos no es la de ahora.
  const samePage = !base.some((operation) => operation.op === 'page' || operation.op === 'set_canvas_ratio');
  if (samePage) {
    // Lo que la propia orden mueve o quita va donde ella diga.
    const ownTargets = new Set(
      base.flatMap((operation) => ((operation.op === 'move_layer' || operation.op === 'remove_layer') && operation.target ? [operation.target] : [])),
    );
    const cleared = clearCenter(pageView(document, context.pageIndex ?? 0), ownTargets);
    notes.push(...cleared.locked);
    if (cleared.moves.length > 0) {
      const moved = settled([...cleared.moves, ...base]);
      if (moved.free.fits && (!layout.free.fits || moved.free.height > layout.free.height)) {
        before = [...cleared.moves, ...base];
        layout = moved;
        notes.push(...cleared.stuck);
      }
    }
  }

  // 2. Las fotos, en el hueco libre más grande que queda, centradas en él.
  if (!layout.free.fits) {
    notes.push('No queda una franja libre entre los textos: las fotos pueden pisar alguno. Muévelas si hace falta.');
  }
  const boxes = layoutBoxes(canvasArea(layout.canvas), photos.length, plan.placement.layout, layout.occupied);
  const placed: PlacedCopilotOperation[] = photos.map((photo, index) => ({
    ...copilotOp({ op: 'add_image', assetId: photo.id }),
    place: {
      ...boxes[index]!,
      ...(plan.placement!.shadow ? { shadow: true } : {}),
      ...(resources.subjects?.get(photo.id) ? { crop: resources.subjects.get(photo.id)! } : {}),
    },
  }));
  // Donde la orden decía colocarlas. Vayan antes o después, quedan por debajo de los textos (apply.ts).
  const insertAt = before.length - base.length + (photosAt < 0 ? base.length : photosAt);
  return { operations: [...before.slice(0, insertAt), ...placed, ...before.slice(insertAt)], notes };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const quoted = (text: string) => `«${text.split('\n')[0]!.slice(0, 40)}»`;

/**
 * Deja el centro del lienzo a las fotos de un plan. Regla, siempre la misma:
 *
 *  - Cuentan los textos que YA había en la página, visibles, cuyo centro cae en
 *    el tercio central del alto del lienzo. Los que añade la propia orden van
 *    donde ella dice, y los logotipos no se mueven: las fotos los esquivan.
 *  - Los de título (en negrita, como los títulos y subtítulos del copiloto)
 *    SUBEN a la franja superior, en su orden y desde el margen; el resto BAJA a
 *    la inferior, en su orden y hasta el margen. Solo cambia su altura.
 *  - Ninguno pisa otro texto ni el logotipo: se apilan con aire entre ellos.
 *  - Una capa bloqueada no se mueve, y tampoco una que no quepa fuera del tercio
 *    central: las fotos van en el hueco que quede, y se avisa.
 *
 * Devuelve los movimientos (operaciones `move_layer` con su sitio exacto y lo
 * que se le cuenta a la persona) y los avisos: `locked`, por cada texto
 * bloqueado que se queda en el centro; `stuck`, por cada uno que no cabe fuera.
 * Quien llama (`composePlan`) solo aplica los movimientos si con ellos el hueco
 * para las fotos crece.
 */
export function clearCenter(
  page: Pick<PageView, 'canvas' | 'layers'>,
  keep: ReadonlySet<string> = new Set(),
): { moves: PlacedCopilotOperation[]; locked: string[]; stuck: string[] } {
  const { canvas } = page;
  const margin = marginOf(canvas);
  const gap = Math.round(canvas.height * 0.02);
  const third = canvas.height / 3;
  const central = (layer: Layer) => layer.y + layer.height / 2 >= third && layer.y + layer.height / 2 <= third * 2;
  const taking = page.layers.filter((layer) => (layer.type === 'text' || layer.type === 'logo') && layer.visible);
  const inCenter = taking.filter(
    (layer): layer is Extract<Layer, { type: 'text' }> => layer.type === 'text' && central(layer) && !keep.has(layer.id),
  );
  const locked = inCenter
    .filter((layer) => layer.locked)
    .map((layer) => `El texto ${quoted(layer.text)} está bloqueado y no se mueve: las fotos van en el hueco que queda.`);
  const stuck: string[] = [];
  const movable = inCenter.filter((layer) => !layer.locked);
  const moving = new Set(movable.map((layer) => layer.id));
  // Lo que se queda donde está y lo ya recolocado: nada de lo que se mueve lo pisa.
  const obstacles: Rect[] = taking.filter((layer) => !moving.has(layer.id));
  const moves: PlacedCopilotOperation[] = [];
  const settle = (layer: (typeof movable)[number], up: boolean) => {
    let y = up ? margin : canvas.height - margin - layer.height;
    for (let guard = 0; guard <= obstacles.length; guard += 1) {
      const hit = obstacles.find((other) => overlaps({ x: layer.x, y: y - gap, width: layer.width, height: layer.height + gap * 2 }, other));
      if (!hit) break;
      y = up ? hit.y + hit.height + gap : hit.y - gap - layer.height;
    }
    y = Math.round(y);
    const center = y + layer.height / 2;
    const out = up ? y >= 0 && center < third : y + layer.height <= canvas.height && center > third * 2;
    if (!out || y === layer.y) {
      // No cabe fuera del centro: se queda donde está y las fotos lo esquivan.
      obstacles.push(layer);
      if (!out) stuck.push(`No hay sitio para apartar ${quoted(layer.text)}: se queda donde está y las fotos van en el hueco que queda.`);
      return;
    }
    obstacles.push({ x: layer.x, y, width: layer.width, height: layer.height });
    moves.push({
      ...copilotOp({ op: 'move_layer', target: layer.id }),
      place: { x: layer.x, y, width: layer.width, height: layer.height },
      say: up
        ? `He subido el título ${quoted(layer.text)} para dejar el centro a las fotos`
        : `He bajado el texto ${quoted(layer.text)} para dejar el centro a las fotos`,
    });
  };
  const byHeight = [...movable].sort((a, b) => a.y - b.y);
  // Los títulos, de arriba abajo desde el margen superior; el resto, de abajo arriba desde el inferior.
  for (const layer of byHeight.filter((item) => item.fontWeight >= 600)) settle(layer, true);
  for (const layer of byHeight.filter((item) => item.fontWeight < 600).reverse()) settle(layer, false);
  return { moves, locked, stuck };
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
  'nuestro', 'vuestro', 'vuestra', 'tuyo', 'tuya', 'mio', 'mia', 'algun', 'alguna', 'alguno', 'algunas', 'algunos',
  'bonita', 'bonito', 'bonitas', 'bonitos', 'chula', 'chulo', 'buena', 'bueno', 'rica', 'rico', 'casa',
]);

/**
 * Lo que una palabra GENÉRICA de la orden abarca en una biblioteca de negocio
 * (carpetas y etiquetas habituales): «un plato nuestro» busca también carnes,
 * arroces, postres…; «una foto del gym», la sala, las máquinas… Solo se amplía
 * desde la palabra genérica (`heads`): «hamburguesas» busca hamburguesas, no
 * cualquier plato. Vocabulario general del español, no de ningún cliente.
 * Lo ampliado cuenta menos que la palabra dicha.
 */
const SEARCH_FAMILIES: ReadonlyArray<{ heads: readonly string[]; members: readonly string[] }> = [
  {
    heads: ['plato', 'comida', 'carta', 'menu', 'cocina'],
    members: ['carne', 'chuleton', 'solomillo', 'entrecot', 'pescado', 'marisco', 'arroz', 'paella', 'entrante', 'postre', 'tapa', 'racion', 'ensalada', 'guiso', 'cocido'],
  },
  { heads: ['carne', 'carnes'], members: ['chuleton', 'solomillo', 'entrecot', 'cordero', 'cochinillo', 'cerdo', 'ternera', 'vaca', 'brasa', 'parrilla', 'asado'] },
  { heads: ['pescado', 'marisco'], members: ['gamba', 'langosta', 'bogavante', 'pulpo', 'calamar', 'rape', 'merluza', 'bacalao', 'atun'] },
  { heads: ['postre', 'dulce'], members: ['tarta', 'flan', 'helado', 'coulant', 'pastel'] },
  { heads: ['bebida', 'copa', 'coctel', 'cocktail', 'combinado', 'trago'], members: ['vino', 'cerveza', 'cafe', 'barra', 'gin', 'mojito', 'vermut'] },
  { heads: ['gym', 'gimnasio'], members: ['sala', 'maquina', 'pesa', 'rack', 'banco', 'entrenamiento', 'fitness', 'instalacion', 'clase'] },
  {
    heads: ['local', 'sitio', 'restaurante', 'establecimiento', 'instalacion', 'negocio'],
    members: ['sala', 'comedor', 'terraza', 'barra', 'fachada', 'entrada', 'interior', 'ambiente', 'tienda', 'escaparate'],
  },
  { heads: ['producto', 'articulo', 'novedad'], members: ['coleccion', 'tienda', 'escaparate'] },
  { heads: ['equipo', 'personal', 'plantilla'], members: ['cocinero', 'camarero', 'entrenador', 'monitor'] },
];

const searchWords = (text: string) =>
  (plain(text).match(/[a-z0-9]+/g) ?? []).filter((word) => word.length >= 3 && !SEARCH_STOPWORDS.has(word));

/** Lo que abarca una palabra dicha si es genérica (su familia, sin ella misma); nada si es concreta. */
function relatedWords(term: string): string[] {
  const related = new Set<string>();
  for (const family of SEARCH_FAMILIES) {
    if (!family.heads.some((word) => sameWord(word, term))) continue;
    for (const word of [...family.heads, ...family.members]) if (!sameWord(word, term)) related.add(word);
  }
  return [...related];
}

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
 * Busca también por intención: cada palabra trae su familia («plato» → carnes,
 * arroces, postres…; «gym» → sala, máquinas…), que cuenta menos que la palabra
 * dicha. Nunca devuelve una imagen generada con IA (los platos y productos son
 * fotos reales) ni una pieza ya diseñada o montada por la aplicación
 * (exportaciones, reels montados, portadas, informes: `isAppDesign`, como los
 * selectores de fotos). Si casan una foto y una edición suya, se queda la original.
 */
export function matchLibraryPhotos<T extends LibraryPhoto>(photos: readonly T[], query: string, count: number): T[] {
  const terms = searchWords(query);
  if (terms.length === 0) return [];
  const families = terms.map(relatedWords);
  const matchedAll = photos
    .filter((photo) => !isAiGenerated(photo) && !isAppDesign({ provenance: photo.provenance as never, folder: photo.folder ?? '' }))
    .map((photo, order) => {
      const name = searchWords(photo.name.replace(/.[a-z0-9]{2,5}$/i, ''));
      const tags = (photo.tags ?? []).flatMap(searchWords);
      const folder = searchWords(photo.folder ?? '');
      // Lo ampliado, más estricto: las cuatro primeras letras iguales («sala» no casa con «salmón»).
      const hitOf = (term: string, weight: number) => {
        const like = (word: string) => sameWord(word, term) && (weight === 1 || word.slice(0, 4) === term.slice(0, 4));
        return Math.max(name.some(like) ? 3 * weight : 0, tags.some(like) ? 3 * weight : 0, folder.some(like) ? 2 * weight : 0);
      };
      let matched = 0;
      let score = 0;
      let direct = false;
      terms.forEach((term, index) => {
        // La palabra dicha, entera; su familia, a medias.
        const own = hitOf(term, 1);
        const hit = Math.max(own, ...families[index]!.map((word) => hitOf(word, 0.5)));
        if (own > 0) direct = true;
        if (hit > 0) matched += 1;
        score += hit;
      });
      return { photo, matched, score, order, direct };
    })
    .filter((item) => item.matched > 0);
  // La familia de una palabra solo entra si la palabra dicha no encuentra nada: «platos» con fotos de platos
  // trae esas; «un plato nuestro» en una biblioteca ordenada por carpetas (Arroces, Carnes…) trae esas.
  const anyDirect = matchedAll.some((item) => item.direct);
  const scored = matchedAll
    .filter((item) => !anyDirect || item.direct)
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

