import { describe, expect, it } from 'vitest';
import {
  interpretLocally,
  LOCAL_COMMAND_EXAMPLES,
  NOTE_FIRST_PAGE,
  NOTE_LAST_PAGE,
  NOTE_NOTHING_SELECTED,
  NOTE_ONE_PAGE,
  type LocalCommandContext,
} from './localCommands';
import { copilotOp, type CopilotOperation } from './operations';

type Fields = Partial<CopilotOperation> & Pick<CopilotOperation, 'op'>;

// Página 2 de 3, con foto de fondo (desenfoque 40), logotipo, título (elegido) y una forma bloqueada.
const context: LocalCommandContext = {
  layers: [
    { id: 'bg', type: 'image', background: true, blur: 40 },
    { id: 'logo', type: 'logo' },
    { id: 'title', type: 'text' },
    { id: 'frame', type: 'shape', locked: true },
  ],
  selectedIds: ['title'],
  pageIndex: 1,
  pageCount: 3,
};
const withSelection = (...selectedIds: string[]): LocalCommandContext => ({ ...context, selectedIds });
const onPage = (pageIndex: number, pageCount = 3): LocalCommandContext => ({ ...context, pageIndex, pageCount });

const ops = (...fields: Fields[]) => ({ kind: 'operations', operations: fields.map((item) => copilotOp(item)) });
const editor = (action: 'undo' | 'redo' | 'save' | 'template') => ops({ op: 'editor', action });
const go = (direction: 'next' | 'previous' | 'first' | 'last') => ops({ op: 'page', action: 'go', direction });
const goPage = (page: number) => ops({ op: 'page', action: 'go', page });
const moved = (dx: number | null, dy: number | null) => ops({ op: 'move_layer', target: 'title', dx, dy });
const resized = (steps: number) => ops({ op: 'resize_layer', target: 'title', steps });
const arranged = (order: 'front' | 'back' | 'forward' | 'backward') => ops({ op: 'arrange_layer', target: 'title', order });
const blurred = (blur: number) => ops({ op: 'blur_image', target: 'bg', blur });

const UNDO = editor('undo');
const REDO = editor('redo');
const SAVE = editor('save');
const TEMPLATE = editor('template');
const REMOVE = ops({ op: 'remove_layer', target: 'title' });
const DUPLICATE = ops({ op: 'duplicate_layer', target: 'title' });
const CENTER = ops({ op: 'move_layer', target: 'title', align: 'center' });
const MIDDLE = ops({ op: 'move_layer', target: 'title', position: 'middle' });
const CENTER_BOTH = ops({ op: 'move_layer', target: 'title', align: 'center', position: 'middle' });
const HIDE = ops({ op: 'style_layer', target: 'title', visible: false });
const LOCK = ops({ op: 'style_layer', target: 'title', locked: true });

describe('copiloto: órdenes que se resuelven sin la IA', () => {
  it.each<[string, unknown]>([
    // Deshacer
    ['deshaz', UNDO],
    ['Deshaz.', UNDO],
    ['deshacer', UNDO],
    ['deshazlo', UNDO],
    ['Deshaz eso', UNDO],
    ['deshaz lo último', UNDO],
    ['atrás', UNDO],
    ['vuelve atrás', UNDO],
    ['control zeta', UNDO],
    ['Ctrl+Z', UNDO],
    ['eh, vale, deshaz, por favor', UNDO],
    // Rehacer
    ['rehaz', REDO],
    ['rehacer', REDO],
    ['rehazlo', REDO],
    ['vuelve a hacerlo', REDO],
    ['¡Rehaz eso!', REDO],
    // Guardar
    ['guarda', SAVE],
    ['Guardar', SAVE],
    ['guárdalo', SAVE],
    ['guarda la versión', SAVE],
    ['guarda los cambios', SAVE],
    ['guardar versión', SAVE],
    ['venga, guarda los cambios, gracias', SAVE],
    // Plantilla
    ['plantilla', TEMPLATE],
    ['abre las plantillas', TEMPLATE],
    ['aplica una plantilla', TEMPLATE],
    ['usar plantilla', TEMPLATE],
    ['a ver, cambia de plantilla', TEMPLATE],
  ])('editor: «%s»', (phrase, expected) => {
    expect(interpretLocally(phrase, context)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    // Quitar
    ['borra', REMOVE],
    ['bórralo', REMOVE],
    ['Borra esto', REMOVE],
    ['elimina', REMOVE],
    ['elimínalo', REMOVE],
    ['quita esto', REMOVE],
    ['quítalo', REMOVE],
    ['suprime', REMOVE],
    ['borra la capa', REMOVE],
    ['elimina la selección', REMOVE],
    ['oye, bórrala, porfa', REMOVE],
    // Duplicar
    ['duplica', DUPLICATE],
    ['duplícalo', DUPLICATE],
    ['copia esto', DUPLICATE],
    ['clónalo', DUPLICATE],
    ['duplicar', DUPLICATE],
    // Ocultar y bloquear
    ['oculta esto', HIDE],
    ['ocúltalo', HIDE],
    ['esconde esta capa', HIDE],
    ['bloquea esto', LOCK],
    ['bloquéalo', LOCK],
  ])('capas: «%s»', (phrase, expected) => {
    expect(interpretLocally(phrase, context)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    // Más grande
    ['más grande', resized(1)],
    ['MÁS GRANDE', resized(1)],
    ['mas grande', resized(1)],
    ['agranda', resized(1)],
    ['agrándalo', resized(1)],
    ['hazlo más grande', resized(1)],
    ['pon esto más grande', resized(1)],
    ['aumenta', resized(1)],
    ['un poco más grande', resized(1)],
    ['hazlo un poquito más grande', resized(1)],
    ['mucho más grande', resized(2)],
    ['agrándalo bastante', resized(2)],
    ['pues ahora más más grande', resized(1)],
    // Más pequeño
    ['más pequeño', resized(-1)],
    ['más pequeña', resized(-1)],
    ['reduce', resized(-1)],
    ['redúcelo', resized(-1)],
    ['hazlo más pequeño', resized(-1)],
    ['achica', resized(-1)],
    ['algo más pequeño', resized(-1)],
    ['mucho más pequeño', resized(-2)],
    ['redúcelo mucho', resized(-2)],
  ])('tamaño: «%s»', (phrase, expected) => {
    expect(interpretLocally(phrase, context)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    // Subir y bajar
    ['sube', moved(null, -2)],
    ['súbelo', moved(null, -2)],
    ['arriba', moved(null, -2)],
    ['más arriba', moved(null, -2)],
    ['sube esto', moved(null, -2)],
    ['muévelo hacia arriba', moved(null, -2)],
    ['sube un poco', moved(null, -1)],
    ['un poco más arriba', moved(null, -1)],
    ['súbelo mucho', moved(null, -4)],
    ['baja', moved(null, 2)],
    ['bájalo', moved(null, 2)],
    ['abajo', moved(null, 2)],
    ['más abajo', moved(null, 2)],
    ['bájalo un poquito', moved(null, 1)],
    ['mucho más abajo', moved(null, 4)],
    // Izquierda y derecha
    ['izquierda', moved(-2, null)],
    ['a la izquierda', moved(-2, null)],
    ['muévelo a la izquierda', moved(-2, null)],
    ['un poco a la izquierda', moved(-1, null)],
    ['derecha', moved(2, null)],
    ['A la derecha.', moved(2, null)],
    ['muévelo a la derecha', moved(2, null)],
    ['mueve esto un poco a la derecha', moved(1, null)],
    ['bastante más a la derecha', moved(4, null)],
    // Centrar
    ['céntralo', CENTER],
    ['centra', CENTER],
    ['centra esto', CENTER],
    ['ponlo centrado', CENTER],
    ['al medio', MIDDLE],
    ['ponlo en el medio', MIDDLE],
    ['céntralo en vertical', MIDDLE],
    ['al centro en vertical', MIDDLE],
    ['en el centro del todo', CENTER_BOTH],
    ['ponlo en el centro del todo', CENTER_BOTH],
    ['céntralo del todo', CENTER_BOTH],
  ])('mover: «%s»', (phrase, expected) => {
    expect(interpretLocally(phrase, context)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    ['tráelo al frente', arranged('front')],
    ['al frente', arranged('front')],
    ['delante', arranged('front')],
    ['ponlo delante del todo', arranged('front')],
    ['al fondo', arranged('back')],
    ['mándalo al fondo', arranged('back')],
    ['detrás', arranged('back')],
    ['súbelo una capa', arranged('forward')],
    ['sube una capa', arranged('forward')],
    ['una capa arriba', arranged('forward')],
    ['bájalo una capa', arranged('backward')],
    ['una capa más abajo', arranged('backward')],
  ])('orden de capas: «%s»', (phrase, expected) => {
    expect(interpretLocally(phrase, context)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    ['más difuminada', blurred(60)],
    ['Más difuminado', blurred(60)],
    ['más borrosa', blurred(60)],
    ['difumínala más', blurred(60)],
    ['un poco más difuminada', blurred(50)],
    ['mucho más difuminada', blurred(80)],
    ['menos difuminada', blurred(20)],
    ['menos desenfoque', blurred(20)],
    ['un poco menos borrosa', blurred(30)],
    ['mucho menos difuminada', blurred(0)],
  ])('desenfoque: «%s»', (phrase, expected) => {
    expect(interpretLocally(phrase, context)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    // Siguiente y anterior
    ['siguiente', go('next')],
    ['siguiente página', go('next')],
    ['página siguiente', go('next')],
    ['pasa a la siguiente', go('next')],
    ['avanza', go('next')],
    ['ve a la siguiente página', go('next')],
    ['anterior', go('previous')],
    ['página anterior', go('previous')],
    ['vuelve a la anterior', go('previous')],
    ['retrocede', go('previous')],
    // Primera y última
    ['primera página', go('first')],
    ['ve a la primera', go('first')],
    ['última página', go('last')],
    ['ve a la última página', go('last')],
    // Por número
    ['ve a la página 3', goPage(3)],
    ['página 1', goPage(1)],
    ['página tres', goPage(3)],
    ['Página uno.', goPage(1)],
    ['ir a la página número 3', goPage(3)],
    ['tercera página', goPage(3)],
    // Añadir, duplicar y quitar
    ['añade una página', ops({ op: 'page', action: 'add' })],
    ['nueva página', ops({ op: 'page', action: 'add' })],
    ['añade otra página', ops({ op: 'page', action: 'add' })],
    ['crea una página nueva', ops({ op: 'page', action: 'add' })],
    ['duplica la página', ops({ op: 'page', action: 'duplicate' })],
    ['duplica esta página', ops({ op: 'page', action: 'duplicate' })],
    ['borra esta página', ops({ op: 'page', action: 'remove' })],
    ['borra la página', ops({ op: 'page', action: 'remove' })],
    ['elimina esta página', ops({ op: 'page', action: 'remove' })],
  ])('páginas: «%s»', (phrase, expected) => {
    expect(interpretLocally(phrase, context)).toEqual(expected);
  });

  it('con varias capas elegidas hace una operación por capa y avisa de las bloqueadas que salta', () => {
    expect(interpretLocally('más grande', withSelection('title', 'logo'))).toEqual(
      ops({ op: 'resize_layer', target: 'logo', steps: 1 }, { op: 'resize_layer', target: 'title', steps: 1 }),
    );
    expect(interpretLocally('bórralo', withSelection('title', 'frame'))).toEqual({
      ...REMOVE,
      note: 'Se ha saltado una capa bloqueada.',
    });
  });

  it('al mandar varias capas al fondo o subirlas una capa, empieza por la de más arriba (conservan su orden)', () => {
    const both = withSelection('logo', 'title');
    const order = (phrase: string) => {
      const result = interpretLocally(phrase, both);
      return result?.kind === 'operations' ? result.operations.map((item) => item.target) : null;
    };
    expect(order('al frente')).toEqual(['logo', 'title']);
    expect(order('bájalo una capa')).toEqual(['logo', 'title']);
    expect(order('al fondo')).toEqual(['title', 'logo']);
    expect(order('súbelo una capa')).toEqual(['title', 'logo']);
  });

  it('desbloquea solo las capas bloqueadas', () => {
    expect(interpretLocally('desbloquea esto', withSelection('frame'))).toEqual(
      ops({ op: 'style_layer', target: 'frame', locked: false }),
    );
    expect(interpretLocally('desbloquéalo', withSelection('frame', 'title'))).toEqual(
      ops({ op: 'style_layer', target: 'frame', locked: false }),
    );
  });

  it('difumina la foto elegida antes que la de fondo, y la única foto si no hay fondo', () => {
    const layers: LocalCommandContext['layers'] = [
      { id: 'bg', type: 'image', background: true, blur: 40 },
      { id: 'dish', type: 'image' },
    ];
    expect(interpretLocally('más difuminada', { ...context, layers, selectedIds: ['dish'] })).toEqual(
      ops({ op: 'blur_image', target: 'dish', blur: 20 }),
    );
    expect(interpretLocally('más difuminada', { ...context, layers: [{ id: 'dish', type: 'image', blur: 95 }], selectedIds: [] })).toEqual(
      ops({ op: 'blur_image', target: 'dish', blur: 100 }),
    );
  });

  it('los ejemplos de la ayuda se resuelven todos aquí', () => {
    expect(LOCAL_COMMAND_EXAMPLES.length).toBeGreaterThanOrEqual(12);
    for (const example of LOCAL_COMMAND_EXAMPLES) {
      expect(interpretLocally(example, onPage(0)), example).toMatchObject({ kind: 'operations' });
    }
  });
});

describe('copiloto: órdenes que van al modelo', () => {
  it.each([
    // Compuestas
    'pon el título más grande y en rojo',
    'deshaz y pon el título arriba',
    'más grande y más arriba',
    'arriba a la derecha',
    'deshaz y guarda',
    'deshaz dos veces',
    // Con una capa nombrada
    'borra el título',
    'sube el logo',
    'más grande el título',
    'duplica el logo',
    'oculta el logo',
    'bloquea el fondo',
    'difumina la foto',
    'tráelo delante del texto',
    // Con un texto que poner o algo que crear
    'escribe menú de navidad',
    'añade un texto que diga hola',
    'añade una página con el menú',
    'sube una foto',
    // Con corrección
    'no, mejor más pequeño',
    'no no, deshaz',
    'espera, guarda',
    'perdón, la página 2',
    'más grande, digo, más pequeño',
    'un poco más grande mucho',
    // Ambiguas o de otra herramienta
    'quita el fondo',
    'quita la selección',
    'quita',
    'copia',
    'pon esto en rojo',
    'hazlo más bonito',
    'ponlo a la izquierda',
    'en el centro',
    'más nítida',
    'sube la opacidad',
    'guarda como plantilla',
    'aplica la plantilla de navidad',
    'borra la página 2',
    'página 0',
    'página once',
    'siguiente foto',
    'muévelo',
    'gira esto',
    'más',
    'para',
    'cierra',
    'adelante',
    // Nada que entender
    '',
    '   ',
    'eh, vale, a ver',
  ])('«%s» → null', (phrase) => {
    expect(interpretLocally(phrase, context)).toBeNull();
  });

  it('no busca la orden dentro de una frase larga', () => {
    expect(interpretLocally(`deshaz ${'y luego otra cosa '.repeat(20)}`, context)).toBeNull();
    expect(interpretLocally('quiero que el texto de arriba diga más grande', context)).toBeNull();
  });

  it('con varias fotos y ninguna elegida ni de fondo, no adivina cuál difuminar', () => {
    const layers: LocalCommandContext['layers'] = [
      { id: 'one', type: 'image' },
      { id: 'two', type: 'image' },
    ];
    expect(interpretLocally('más difuminada', { ...context, layers, selectedIds: [] })).toBeNull();
  });

  it('si un identificador no cumple el contrato, no inventa la operación', () => {
    const layers: LocalCommandContext['layers'] = [{ id: 'capa rara!', type: 'text' }];
    expect(interpretLocally('bórralo', { ...context, layers, selectedIds: ['capa rara!'] })).toBeNull();
  });
});

describe('copiloto: órdenes que se entienden pero no se pueden hacer', () => {
  const note = (text: string) => ({ kind: 'note', note: text });

  it.each([
    'más grande',
    'súbelo',
    'bórralo',
    'duplica',
    'céntralo',
    'arriba',
    'al frente',
    'oculta esto',
    'bloquea esto',
    'desbloquea esto',
    'a la derecha',
  ])('sin nada elegido, «%s» lo dice', (phrase) => {
    expect(interpretLocally(phrase, withSelection())).toEqual(note(NOTE_NOTHING_SELECTED));
    // Una capa elegida que ya no está en la página es como no tener nada elegido.
    expect(interpretLocally(phrase, withSelection('gone'))).toEqual(note(NOTE_NOTHING_SELECTED));
  });

  it.each(['más grande', 'súbelo', 'bórralo', 'duplícalo', 'al fondo', 'ocúltalo'])(
    'con la capa elegida bloqueada, «%s» no la toca',
    (phrase) => {
      expect(interpretLocally(phrase, withSelection('frame'))).toEqual(
        note('La capa elegida está bloqueada: desbloquéala primero.'),
      );
    },
  );

  it('bloquear lo bloqueado o desbloquear lo que no lo está se dice', () => {
    expect(interpretLocally('bloquea esto', withSelection('frame'))).toEqual(note('La capa elegida ya está bloqueada.'));
    expect(interpretLocally('desbloquea esto', withSelection('title'))).toEqual(note('La capa elegida no está bloqueada.'));
  });

  it('los límites de las páginas', () => {
    expect(interpretLocally('siguiente página', onPage(2))).toEqual(note(NOTE_LAST_PAGE));
    expect(interpretLocally('última página', onPage(2))).toEqual(note(NOTE_LAST_PAGE));
    expect(interpretLocally('página anterior', onPage(0))).toEqual(note(NOTE_FIRST_PAGE));
    expect(interpretLocally('primera página', onPage(0))).toEqual(note(NOTE_FIRST_PAGE));
    expect(interpretLocally('siguiente', onPage(0, 1))).toEqual(note(NOTE_LAST_PAGE));
    expect(interpretLocally('página 7', onPage(0))).toEqual(note('Esta pieza solo tiene 3 páginas.'));
    expect(interpretLocally('página dos', onPage(0, 1))).toEqual(note('Esta pieza solo tiene una página.'));
    expect(interpretLocally('ve a la página 2', onPage(1))).toEqual(note('Ya estás en la página 2.'));
    expect(interpretLocally('borra la página', onPage(0, 1))).toEqual(note(NOTE_ONE_PAGE));
    expect(interpretLocally('elimina esta página', onPage(0, 1))).toEqual(note(NOTE_ONE_PAGE));
  });

  it('el desenfoque: sin fotos, bloqueada o ya en el tope', () => {
    const only = (layer: LocalCommandContext['layers'][number]): LocalCommandContext => ({ ...context, layers: [layer], selectedIds: [] });
    expect(interpretLocally('más difuminada', only({ id: 'title', type: 'text' }))).toEqual(note('No hay ninguna foto en esta página.'));
    expect(interpretLocally('más difuminada', only({ id: 'bg', type: 'image', background: true, locked: true }))).toEqual(
      note('La foto está bloqueada: desbloquéala primero.'),
    );
    expect(interpretLocally('más difuminada', only({ id: 'bg', type: 'image', background: true, blur: 100 }))).toEqual(
      note('La foto ya está difuminada al máximo.'),
    );
    expect(interpretLocally('menos difuminada', only({ id: 'bg', type: 'image', background: true }))).toEqual(
      note('La foto ya no tiene desenfoque.'),
    );
  });
});

describe('órdenes que montan una pieza: nunca las resuelve el intérprete local', () => {
  it('una orden compuesta con fondo, fotos y textos va entera al modelo', () => {
    for (const order of [
      'haz el menú de otoño: crea un fondo que parezca otoñal y pon los platos en el centro',
      'crea un fondo otoñal',
      'genera un fondo de madera y pon las fotos de los platos en fila',
      'busca las fotos de los postres y ponlas en rejilla',
      'pon los platos en el centro',
      'pon estas fotos en abanico',
      'monta la pieza de la promoción con un fondo de gimnasio',
      'eh… haz el cartel, con un fondo, no sé, de madera, y los platos en fila',
    ]) {
      expect(interpretLocally(order, context), order).toBeNull();
      expect(interpretLocally(order, withSelection()), order).toBeNull();
    }
  });

  it('«sí» y «no» sueltos tampoco son órdenes del intérprete (los resuelve el plan pendiente)', () => {
    for (const answer of ['sí', 'si', 'vale', 'adelante', 'hazlo', 'no', 'cancela', 'sí, hazlo']) {
      expect(interpretLocally(answer, context), answer).toBeNull();
    }
  });
});
