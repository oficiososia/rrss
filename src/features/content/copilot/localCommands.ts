import { copilotOperationSchema, type CopilotOperation } from './operations';

// Intérprete local de las órdenes más frecuentes del copiloto del editor.
//
// Antes de llamar a la IA (que cuesta y tarda), se mira si lo dicho es una orden
// sencilla de las de siempre («deshaz», «más grande», «siguiente página»). Si lo
// es, aquí mismo salen las operaciones, con el mismo contrato que las de la IA
// (operations.ts). Es una función pura: no toca el documento ni llama a nadie.
//
// La regla de oro: la orden ENTERA, ya limpia de muletillas, tiene que encajar
// con un patrón. No se busca un patrón dentro de una frase más larga. Ante la
// duda se devuelve `null` y la orden va al modelo: equivocarse aquí es peor que
// una llamada a la IA.

/** Capa de la página activa, con lo justo para decidir. */
export interface LocalCommandLayer {
  id: string;
  type: 'image' | 'text' | 'logo' | 'shape';
  locked?: boolean;
  /** Desenfoque actual (solo imágenes), de 0 a 100. */
  blur?: number;
  /** Cubre todo el lienzo: es la «foto de fondo». */
  background?: boolean;
}

export interface LocalCommandContext {
  /** Capas de la página activa, del fondo al frente. */
  layers: LocalCommandLayer[];
  /** Capas elegidas en el editor. */
  selectedIds: string[];
  /** Página activa, desde 0. */
  pageIndex: number;
  pageCount: number;
}

export type LocalCommandResult =
  /** Operaciones listas para aplicar. `note`, si viene, cuenta lo que se ha saltado (capas bloqueadas). */
  | { kind: 'operations'; operations: CopilotOperation[]; note?: string }
  /** Se entiende la orden pero no se puede hacer aquí: se dice sin llamar a la IA. */
  | { kind: 'note'; note: string };

/** Ejemplos de órdenes que se resuelven al momento, para enseñarlos como ayuda. */
export const LOCAL_COMMAND_EXAMPLES: string[] = [
  'deshaz',
  'rehaz',
  'guarda',
  'más grande',
  'un poco más pequeño',
  'súbelo',
  'a la derecha',
  'céntralo',
  'tráelo al frente',
  'duplícalo',
  'bórralo',
  'bloquea esto',
  'siguiente página',
  've a la página 2',
  'añade una página',
  'abre las plantillas',
];

type OpFields = Partial<CopilotOperation> & Pick<CopilotOperation, 'op'>;
type Intensity = 'little' | 'normal' | 'much';

/** Lo más largo que puede ser una orden de las de aquí (lo demás ni se mira). */
const MAX_TRANSCRIPT_LENGTH = 200;
/** Tope de operaciones de una respuesta del copiloto (igual que el del servidor). */
const MAX_OPERATIONS = 20;

const MOVE_STEPS: Record<Intensity, number> = { little: 1, normal: 2, much: 4 };
const SIZE_STEPS: Record<Intensity, number> = { little: 1, normal: 1, much: 2 };
const BLUR_STEPS: Record<Intensity, number> = { little: 10, normal: 20, much: 40 };

export const NOTE_NOTHING_SELECTED = 'No hay ninguna capa elegida: elige una o di cuál.';
export const NOTE_ONE_PAGE = 'Una pieza tiene al menos una página.';
export const NOTE_LAST_PAGE = 'Ya estás en la última página.';
export const NOTE_FIRST_PAGE = 'Ya estás en la primera página.';

// ---------------------------------------------------------------------------
// Limpieza de lo dicho
// ---------------------------------------------------------------------------

/** Muletillas y titubeos: se quitan estén donde estén. */
const FILLER_WORDS = new Set([
  'eh', 'ehh', 'em', 'emm', 'ehm', 'mm', 'mmm', 'hmm', 'um', 'uh', 'uhm', 'ah',
  'vale', 'venga', 'pues', 'porfa', 'porfi', 'oye', 'ahora', 'bueno', 'mira', 'ok', 'okay', 'okey', 'gracias',
]);

/** Palabras de corrección («no, mejor…», «espera», «perdón»): la frase la decide el modelo. */
const CORRECTION_WORDS = new Set([
  'no', 'mejor', 'espera', 'esperate', 'perdon', 'perdona', 'digo', 'rectifico', 'olvida', 'olvidalo', 'cancela', 'tampoco', 'nada',
]);

/** Palabras en minúsculas, sin tildes ni signos. */
function plainWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
}

const startsWith = (words: string[], phrase: string[]) => phrase.every((word, index) => words[index] === word);
const endsWith = (words: string[], phrase: string[]) =>
  words.length >= phrase.length && phrase.every((word, index) => words[words.length - phrase.length + index] === word);

/**
 * La orden limpia: sin muletillas («eh», «vale», «por favor», «a ver»), sin
 * palabras repetidas seguidas y sin la «y» de arranque. `null` si trae una
 * corrección o no queda nada.
 */
function cleanCommand(transcript: string): string | null {
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) return null;
  const spoken = plainWords(transcript);
  if (spoken.some((word) => CORRECTION_WORDS.has(word))) return null;

  let words = spoken.filter((word) => !FILLER_WORDS.has(word));
  // «por favor», en cualquier sitio.
  words = words.filter((word, index) => !(word === 'por' && words[index + 1] === 'favor') && !(word === 'favor' && words[index - 1] === 'por'));
  // «a ver», solo al principio o al final (en medio puede ser parte de la frase).
  while (startsWith(words, ['a', 'ver'])) words = words.slice(2);
  while (endsWith(words, ['a', 'ver'])) words = words.slice(0, -2);
  // «y más grande»: la «y» de seguir hablando no cuenta.
  while (words[0] === 'y') words = words.slice(1);
  // «más más grande»: palabras repetidas seguidas.
  words = words.filter((word, index) => word !== words[index - 1]);

  return words.length > 0 ? words.join(' ') : null;
}

// ---------------------------------------------------------------------------
// Piezas de los patrones (todo ya en minúsculas y sin tildes)
// ---------------------------------------------------------------------------

/** Pronombre pegado al verbo: «bórralo», «súbela», «duplícalos». */
const ENCLITIC = '(?:l[oa]s?)';
/** Formas de decir «lo que tengo elegido» sin nombrar ninguna capa. */
const SELECTION =
  '(?:esto|eso|est[ea]|es[ea]|estos|esos|estas|esas' +
  '|(?:la|esta|esa) capa(?: (?:seleccionada|elegida))?' +
  '|(?:las|estas|esas) capas(?: (?:seleccionadas|elegidas))?' +
  '|la seleccion|lo seleccionado|el seleccionado|la seleccionada|los seleccionados|las seleccionadas|lo elegido' +
  '|(?:el|este|ese) elemento(?: seleccionado)?)';
/** Tras el verbo: «bórralo», «borra esto» o nada («borra»). */
const OBJECT = `(?:${ENCLITIC}| ${SELECTION})?`;
/** Tras el verbo, pero obligatorio: «quítalo», «copia esto» (el verbo solo es ambiguo). */
const OBJECT_REQUIRED = `(?:${ENCLITIC}| ${SELECTION})`;
/** «un poco» / «mucho». Es el ÚNICO grupo con captura de los patrones de capas. */
const AMOUNT = '(un poco|un poquito|un poquitin|un pelin|algo|ligeramente|mucho|muchisimo|bastante)';
const MUCH = new Set(['mucho', 'muchisimo', 'bastante']);

/** «hazlo …», «pon esto …», «déjalo …» delante de un adjetivo. */
const MAKE = `(?:(?:haz|hacer|pon|poner|deja|dejar)${OBJECT} )?`;
/** «muévelo …», «desplaza esto …» delante de una dirección. */
const MOVE = `(?:(?:mueve|mover|desplaza|desplazar|lleva|llevar|corre|correr)${OBJECT} )?`;
/** «tráelo …», «ponlo …», «mándalo …» delante de «al frente» / «al fondo». */
const BRING = `(?:(?:trae|traer|pon|poner|lleva|llevar|pasa|pasar|manda|mandar|envia|enviar|mueve|mover|deja|dejar)${OBJECT} )?`;
/** «ponlo …», «llévalo …» delante de «en el medio». */
const PUT = `(?:(?:pon|poner|lleva|llevar|mueve|mover|deja|dejar)${OBJECT} )?`;
const ONE_LAYER = '(?:una capa|un nivel|una posicion)';

const UP = '(?:mas )?(?:(?:hacia|para) )?arriba';
const DOWN = '(?:mas )?(?:(?:hacia|para) )?abajo';
const LEFT = '(?:mas )?(?:(?:a|hacia|para) la )?izquierda';
const RIGHT = '(?:mas )?(?:(?:a|hacia|para) la )?derecha';

const BLURRY = '(?:difuminad[oa]s?|borros[oa]s?|desenfocad[oa]s?|desenfoque)';
const BLUR_VERB = `(?:difumina|difuminar|desenfoca|desenfocar)${OBJECT}`;

/** «ve a …», «pasa a …», «vuelve a …». */
const GO_TO = '(?:(?:ve|vete|ir|pasa|pasar|salta|saltar|avanza|avanzar|vuelve|volver|regresa|regresar|retrocede|retroceder|cambia|cambiar) a )';
const PAGE_NUMBERS: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};
const PAGE_ORDINALS: Record<string, number> = {
  segunda: 2, tercera: 3, cuarta: 4, quinta: 5, sexta: 6, septima: 7, octava: 8, novena: 9, decima: 10,
};

/** Patrón que debe casar con la orden entera. */
const whole = (body: string) => new RegExp(`^(?:${body})$`);

// ---------------------------------------------------------------------------
// Construcción de resultados
// ---------------------------------------------------------------------------

const note = (text: string): LocalCommandResult => ({ kind: 'note', note: text });

/** Operaciones validadas con el contrato. Si alguna no cumple (un id raro), `null`: que lo vea el modelo. */
function operations(fields: OpFields[], skippedNote?: string): LocalCommandResult | null {
  if (fields.length === 0 || fields.length > MAX_OPERATIONS) return null;
  const built: CopilotOperation[] = [];
  for (const item of fields) {
    const parsed = copilotOperationSchema.safeParse(item);
    if (!parsed.success) return null;
    built.push(parsed.data);
  }
  return skippedNote ? { kind: 'operations', operations: built, note: skippedNote } : { kind: 'operations', operations: built };
}

const lockedNote = (count: number) =>
  count === 1
    ? 'La capa elegida está bloqueada: desbloquéala primero.'
    : 'Las capas elegidas están bloqueadas: desbloquéalas primero.';
const skippedLockedNote = (count: number) =>
  count === 1 ? 'Se ha saltado una capa bloqueada.' : `Se han saltado ${count} capas bloqueadas.`;

interface SelectionOptions {
  /** A qué capas elegidas se aplica. Por omisión, a las que no están bloqueadas. */
  accepts?: (layer: LocalCommandLayer) => boolean;
  /** Qué decir si ninguna de las elegidas vale. Por omisión, que están bloqueadas. */
  noneNote?: (count: number) => string;
  /** ¿Se avisa de las que se saltan? (al bloquear o desbloquear no hace falta). */
  quietSkips?: boolean;
  /** Del frente al fondo: para que varias capas conserven su orden al mandarlas al fondo o subirlas una capa. */
  topFirst?: boolean;
}

/** Una operación por capa elegida. Sin nada elegido, se dice (la IA tampoco sabría a qué se refiere). */
function onSelection(
  context: LocalCommandContext,
  build: (layer: LocalCommandLayer) => OpFields,
  options: SelectionOptions = {},
): LocalCommandResult | null {
  const chosen = context.layers.filter((layer) => context.selectedIds.includes(layer.id));
  if (chosen.length === 0) return note(NOTE_NOTHING_SELECTED);
  const usable = chosen.filter(options.accepts ?? ((layer) => !layer.locked));
  if (usable.length === 0) return note((options.noneNote ?? lockedNote)(chosen.length));
  const skipped = chosen.length - usable.length;
  const ordered = options.topFirst ? [...usable].reverse() : usable;
  return operations(ordered.map(build), skipped > 0 && !options.quietSkips ? skippedLockedNote(skipped) : undefined);
}

/** «un poco», «mucho» o nada, según lo capturado. `null` si se contradice («un poco … mucho»). */
function intensityOf(match: RegExpExecArray): Intensity | null {
  const amounts = match.slice(1).filter((value): value is string => typeof value === 'string');
  const kinds = new Set(amounts.map((amount) => (MUCH.has(amount) ? 'much' : 'little')));
  if (kinds.size > 1) return null;
  return kinds.has('much') ? 'much' : kinds.has('little') ? 'little' : 'normal';
}

const editor = (action: 'undo' | 'redo' | 'save' | 'template') => operations([{ op: 'editor', action }]);

function move(match: RegExpExecArray, context: LocalCommandContext, x: -1 | 0 | 1, y: -1 | 0 | 1) {
  const intensity = intensityOf(match);
  if (!intensity) return null;
  const steps = MOVE_STEPS[intensity];
  return onSelection(context, (layer) => ({
    op: 'move_layer',
    target: layer.id,
    ...(x !== 0 ? { dx: x * steps } : {}),
    ...(y !== 0 ? { dy: y * steps } : {}),
  }));
}

function resize(match: RegExpExecArray, context: LocalCommandContext, sign: -1 | 1) {
  const intensity = intensityOf(match);
  if (!intensity) return null;
  return onSelection(context, (layer) => ({ op: 'resize_layer', target: layer.id, steps: sign * SIZE_STEPS[intensity] }));
}

function arrange(context: LocalCommandContext, order: 'front' | 'back' | 'forward' | 'backward') {
  return onSelection(context, (layer) => ({ op: 'arrange_layer', target: layer.id, order }), {
    topFirst: order === 'back' || order === 'forward',
  });
}

/**
 * «más / menos difuminada»: sobre las fotos elegidas; si no hay ninguna elegida,
 * sobre la foto de fondo (o la única foto de la página). Con varias fotos y sin
 * saber cuál, lo decide el modelo.
 */
function blur(match: RegExpExecArray, context: LocalCommandContext, sign: -1 | 1): LocalCommandResult | null {
  const intensity = intensityOf(match);
  if (!intensity) return null;
  const images = context.layers.filter((layer) => layer.type === 'image');
  if (images.length === 0) return note('No hay ninguna foto en esta página.');
  const chosen = images.filter((layer) => context.selectedIds.includes(layer.id));
  const background = images.find((layer) => layer.background);
  const targets = chosen.length > 0 ? chosen : background ? [background] : images.length === 1 ? images : [];
  if (targets.length === 0) return null;
  const free = targets.filter((layer) => !layer.locked);
  if (free.length === 0) return note('La foto está bloqueada: desbloquéala primero.');

  const current = (layer: LocalCommandLayer) => Math.min(100, Math.max(0, Math.round(layer.blur ?? 0)));
  const changes = free
    .map((layer) => ({ layer, value: Math.min(100, Math.max(0, current(layer) + sign * BLUR_STEPS[intensity])) }))
    .filter((change) => change.value !== current(change.layer));
  if (changes.length === 0) {
    return note(sign > 0 ? 'La foto ya está difuminada al máximo.' : 'La foto ya no tiene desenfoque.');
  }
  const skipped = targets.length - free.length;
  return operations(
    changes.map((change) => ({ op: 'blur_image', target: change.layer.id, blur: change.value })),
    skipped > 0 ? skippedLockedNote(skipped) : undefined,
  );
}

const pageCountOf = (context: LocalCommandContext) => Math.max(1, Math.floor(context.pageCount));
const pageIndexOf = (context: LocalCommandContext) =>
  Math.min(pageCountOf(context) - 1, Math.max(0, Math.floor(context.pageIndex)));

function goToDirection(context: LocalCommandContext, direction: 'next' | 'previous' | 'first' | 'last') {
  const atFirst = pageIndexOf(context) === 0;
  const atLast = pageIndexOf(context) === pageCountOf(context) - 1;
  if ((direction === 'next' || direction === 'last') && atLast) return note(NOTE_LAST_PAGE);
  if ((direction === 'previous' || direction === 'first') && atFirst) return note(NOTE_FIRST_PAGE);
  return operations([{ op: 'page', action: 'go', direction }]);
}

function goToPage(context: LocalCommandContext, page: number): LocalCommandResult | null {
  if (!Number.isInteger(page) || page < 1) return null;
  const count = pageCountOf(context);
  if (page > count) return note(count === 1 ? 'Esta pieza solo tiene una página.' : `Esta pieza solo tiene ${count} páginas.`);
  if (page === pageIndexOf(context) + 1) return note(`Ya estás en la página ${page}.`);
  return operations([{ op: 'page', action: 'go', page }]);
}

// ---------------------------------------------------------------------------
// Las órdenes
// ---------------------------------------------------------------------------

interface Rule {
  pattern: RegExp;
  /** Qué hacer si la orden entera casa. `null` = es del modelo. */
  run: (match: RegExpExecArray, context: LocalCommandContext) => LocalCommandResult | null;
}

// Cada orden casa, como mucho, con una regla: los patrones no se pisan. Las
// reglas que devuelven `null` a propósito van delante de la que las incluiría.
const RULES: Rule[] = [
  // --- Acciones del editor ---
  {
    pattern: whole(
      'deshaz(?:lo)?|deshacer(?:lo)?' +
        '|(?:deshaz|deshacer) (?:eso|esto|lo ultimo|lo anterior|el cambio|el ultimo cambio|el ultimo paso)' +
        '|atras|(?:vuelve|volver|ve|ir) atras|(?:control|ctrl) (?:z|zeta|ceta)',
    ),
    run: () => editor('undo'),
  },
  {
    pattern: whole(
      'rehaz(?:lo)?|rehacer(?:lo)?' +
        '|(?:rehaz|rehacer) (?:eso|esto|lo ultimo|el cambio|el ultimo cambio)' +
        '|(?:vuelve|volver) a hacerlo|(?:vuelve|volver) a hacer eso|(?:control|ctrl) (?:y|i griega)',
    ),
    run: () => editor('redo'),
  },
  {
    pattern: whole(
      '(?:guarda|guardar)(?:lo|la)?' +
        '|(?:guarda|guardar) (?:esto|todo|(?:(?:la|una|esta) )?version|(?:los )?cambios|(?:(?:el|este) )?diseno|(?:(?:la|esta) )?pieza)',
    ),
    run: () => editor('save'),
  },
  {
    pattern: whole(
      'plantillas?' +
        '|(?:abre|abrir|muestra|mostrar|ver|ensename) (?:las )?plantillas?' +
        '|(?:aplica|aplicar|usa|usar|pon|poner|elige|elegir|escoge|escoger) (?:(?:una|otra) )?plantilla' +
        '|(?:cambia|cambiar) (?:la|de) plantilla',
    ),
    run: () => editor('template'),
  },

  // --- Páginas ---
  {
    pattern: whole(`${GO_TO}?(?:la )?pagina (?:numero )?(\\d{1,2}|${Object.keys(PAGE_NUMBERS).join('|')})`),
    run: (match, context) => {
      const said = match[1] ?? '';
      return goToPage(context, PAGE_NUMBERS[said] ?? Number.parseInt(said, 10));
    },
  },
  {
    pattern: whole(`${GO_TO}?(?:la )?(${Object.keys(PAGE_ORDINALS).join('|')}) pagina`),
    run: (match, context) => goToPage(context, PAGE_ORDINALS[match[1] ?? ''] ?? 0),
  },
  {
    pattern: whole(
      '(?:la )?(?:siguiente|proxima)(?: pagina)?|(?:la )?pagina siguiente' +
        `|${GO_TO}(?:la )?(?:siguiente|proxima)(?: pagina)?|${GO_TO}(?:la )?pagina siguiente` +
        '|avanza|avanzar|(?:avanza|avanzar) (?:una )?pagina|(?:pasa|pasar) (?:de )?pagina',
    ),
    run: (_match, context) => goToDirection(context, 'next'),
  },
  {
    pattern: whole(
      '(?:la )?anterior(?: pagina)?|(?:la )?pagina anterior' +
        `|${GO_TO}(?:la )?anterior(?: pagina)?|${GO_TO}(?:la )?pagina anterior` +
        '|retrocede|retroceder|(?:retrocede|retroceder|vuelve|volver) (?:una )?pagina',
    ),
    run: (_match, context) => goToDirection(context, 'previous'),
  },
  {
    pattern: whole(`(?:la )?primera pagina|${GO_TO}(?:la )?primera(?: pagina)?`),
    run: (_match, context) => goToDirection(context, 'first'),
  },
  {
    pattern: whole(`(?:la )?ultima pagina|${GO_TO}(?:la )?ultima(?: pagina)?`),
    run: (_match, context) => goToDirection(context, 'last'),
  },
  {
    pattern: whole(
      'nueva pagina|pagina nueva|otra pagina|una pagina mas|una nueva pagina|una pagina nueva' +
        '|(?:anade|anadir|agrega|agregar|crea|crear|inserta|insertar|pon|poner|mete|meter)(?:me)? (?:(?:una|otra) )?(?:nueva )?pagina(?: nueva)?(?: mas)?',
    ),
    run: () => operations([{ op: 'page', action: 'add' }]),
  },
  {
    pattern: whole('(?:duplica|duplicar|copia|copiar|clona|clonar) (?:(?:la|esta) )?pagina(?: actual)?'),
    run: () => operations([{ op: 'page', action: 'duplicate' }]),
  },
  {
    pattern: whole('(?:borra|borrar|elimina|eliminar|quita|quitar|suprime|suprimir) (?:(?:la|esta) )?pagina(?: actual)?'),
    run: (_match, context) =>
      pageCountOf(context) <= 1 ? note(NOTE_ONE_PAGE) : operations([{ op: 'page', action: 'remove' }]),
  },

  // --- Capas elegidas: quitar, duplicar, ocultar, bloquear ---
  // «quita la selección» puede ser «deja de tener esto elegido»: no es de aquí.
  { pattern: whole('(?:quita|quitar) la seleccion'), run: () => null },
  {
    pattern: whole(`(?:borra|borrar|elimina|eliminar|suprime|suprimir)${OBJECT}|(?:quita|quitar)${OBJECT_REQUIRED}`),
    run: (_match, context) => onSelection(context, (layer) => ({ op: 'remove_layer', target: layer.id })),
  },
  {
    pattern: whole(`(?:duplica|duplicar|clona|clonar)${OBJECT}|(?:copia|copiar)${OBJECT_REQUIRED}`),
    run: (_match, context) => onSelection(context, (layer) => ({ op: 'duplicate_layer', target: layer.id })),
  },
  {
    pattern: whole(`(?:oculta|ocultar|esconde|esconder)${OBJECT}`),
    run: (_match, context) => onSelection(context, (layer) => ({ op: 'style_layer', target: layer.id, visible: false })),
  },
  {
    pattern: whole(`(?:bloquea|bloquear)${OBJECT}`),
    run: (_match, context) =>
      onSelection(context, (layer) => ({ op: 'style_layer', target: layer.id, locked: true }), {
        noneNote: (count) => (count === 1 ? 'La capa elegida ya está bloqueada.' : 'Las capas elegidas ya están bloqueadas.'),
        quietSkips: true,
      }),
  },
  {
    pattern: whole(`(?:desbloquea|desbloquear)${OBJECT}`),
    run: (_match, context) =>
      onSelection(context, (layer) => ({ op: 'style_layer', target: layer.id, locked: false }), {
        accepts: (layer) => layer.locked === true,
        noneNote: (count) => (count === 1 ? 'La capa elegida no está bloqueada.' : 'Las capas elegidas no están bloqueadas.'),
        quietSkips: true,
      }),
  },

  // --- Tamaño ---
  {
    pattern: whole(
      `(?:${SELECTION} )?${MAKE}(?:${AMOUNT} )?mas grandes?(?: ${AMOUNT})?(?: ${SELECTION})?` +
        `|(?:agranda|agrandar|aumenta|aumentar)${OBJECT}(?: ${AMOUNT})?(?: mas)?` +
        `|(?:aumenta|aumentar)(?:le)? el tamano(?: ${AMOUNT})?`,
    ),
    run: (match, context) => resize(match, context, 1),
  },
  {
    pattern: whole(
      `(?:${SELECTION} )?${MAKE}(?:${AMOUNT} )?mas (?:pequen[oa]s?|chic[oa]s?)(?: ${AMOUNT})?(?: ${SELECTION})?` +
        `|(?:reduce|reducir|achica|achicar|encoge|encoger|disminuye|disminuir|empequenece|empequenecer)${OBJECT}(?: ${AMOUNT})?(?: mas)?` +
        `|(?:reduce|reducir|disminuye|disminuir)(?:le)? el tamano(?: ${AMOUNT})?`,
    ),
    run: (match, context) => resize(match, context, -1),
  },

  // --- Orden de capas (antes que mover: «súbelo una capa» no es «súbelo») ---
  {
    pattern: whole(`(?:${SELECTION} )?${BRING}(?:al frente|delante(?: del todo)?|(?:al|en|a) primer plano|(?:por )?encima de todo)`),
    run: (_match, context) => arrange(context, 'front'),
  },
  {
    pattern: whole(`(?:${SELECTION} )?${BRING}(?:al fondo(?: del todo)?|detras(?: del todo)?|(?:por )?debajo de todo)`),
    run: (_match, context) => arrange(context, 'back'),
  },
  {
    pattern: whole(
      `(?:sube|subir)${OBJECT} ${ONE_LAYER}(?: (?:mas )?arriba)?` +
        `|${BRING}${ONE_LAYER} (?:mas )?(?:(?:hacia|para) )?(?:arriba|adelante|delante)`,
    ),
    run: (_match, context) => arrange(context, 'forward'),
  },
  {
    pattern: whole(
      `(?:baja|bajar)${OBJECT} ${ONE_LAYER}(?: (?:mas )?abajo)?` +
        `|${BRING}${ONE_LAYER} (?:mas )?(?:(?:hacia|para) )?(?:abajo|atras|detras)`,
    ),
    run: (_match, context) => arrange(context, 'backward'),
  },

  // --- Mover ---
  {
    pattern: whole(
      `(?:${SELECTION} )?${MOVE}(?:${AMOUNT} )?${UP}(?: ${AMOUNT})?` +
        `|(?:sube|subir)${OBJECT}(?: ${AMOUNT})?(?: mas)?(?: ${UP})?(?: ${AMOUNT})?`,
    ),
    run: (match, context) => move(match, context, 0, -1),
  },
  {
    pattern: whole(
      `(?:${SELECTION} )?${MOVE}(?:${AMOUNT} )?${DOWN}(?: ${AMOUNT})?` +
        `|(?:baja|bajar)${OBJECT}(?: ${AMOUNT})?(?: mas)?(?: ${DOWN})?(?: ${AMOUNT})?`,
    ),
    run: (match, context) => move(match, context, 0, 1),
  },
  {
    pattern: whole(`(?:${SELECTION} )?${MOVE}(?:${AMOUNT} )?${LEFT}(?: ${AMOUNT})?`),
    run: (match, context) => move(match, context, -1, 0),
  },
  {
    pattern: whole(`(?:${SELECTION} )?${MOVE}(?:${AMOUNT} )?${RIGHT}(?: ${AMOUNT})?`),
    run: (match, context) => move(match, context, 1, 0),
  },

  // --- Centrar ---
  // «céntralo» = centro horizontal.
  {
    pattern: whole(
      `(?:centra|centrar)${OBJECT}(?: (?:en horizontal|horizontalmente))?` +
        `|centrad[oa]s?|(?:pon|poner|deja|dejar)${OBJECT} centrad[oa]s?`,
    ),
    run: (_match, context) => onSelection(context, (layer) => ({ op: 'move_layer', target: layer.id, align: 'center' })),
  },
  // «al medio», «céntralo en vertical» = a media altura.
  {
    pattern: whole(
      `${PUT}(?:al|en el) medio|(?:centra|centrar)${OBJECT} (?:en vertical|verticalmente)` +
        `|${PUT}(?:al|en el) centro (?:en vertical|verticalmente)`,
    ),
    run: (_match, context) => onSelection(context, (layer) => ({ op: 'move_layer', target: layer.id, position: 'middle' })),
  },
  // «en el centro del todo» = las dos cosas.
  {
    pattern: whole(
      `${PUT}(?:al|en el) (?:centro|medio) del todo` +
        `|${PUT}(?:justo )?en el centro (?:del lienzo|de la pagina|de la imagen|del diseno)` +
        `|(?:centra|centrar)${OBJECT} (?:del todo|en horizontal y (?:en )?vertical|en vertical y (?:en )?horizontal|en los dos ejes|en ambos ejes)`,
    ),
    run: (_match, context) =>
      onSelection(context, (layer) => ({ op: 'move_layer', target: layer.id, align: 'center', position: 'middle' })),
  },

  // --- Desenfoque de la foto ---
  {
    pattern: whole(
      `(?:${SELECTION} )?${MAKE}(?:${AMOUNT} )?mas ${BLURRY}(?: ${AMOUNT})?` + `|${BLUR_VERB}(?: ${AMOUNT})? mas`,
    ),
    run: (match, context) => blur(match, context, 1),
  },
  {
    pattern: whole(
      `(?:${SELECTION} )?${MAKE}(?:${AMOUNT} )?menos ${BLURRY}(?: ${AMOUNT})?` + `|${BLUR_VERB}(?: ${AMOUNT})? menos`,
    ),
    run: (match, context) => blur(match, context, -1),
  },
];

/**
 * Intenta resolver la orden sin la IA. Devuelve las operaciones, una nota (se
 * entiende pero no se puede hacer) o `null` si la orden no es, con seguridad,
 * una de las de aquí: entonces va al modelo.
 */
export function interpretLocally(transcript: string, context: LocalCommandContext): LocalCommandResult | null {
  const command = cleanCommand(transcript);
  if (command === null) return null;
  for (const rule of RULES) {
    const match = rule.pattern.exec(command);
    if (match) return rule.run(match, context);
  }
  return null;
}
