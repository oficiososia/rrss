// Órdenes que montan una pieza (plan por pasos, docs/copiloto-voz.md §15): qué
// plan sale de las operaciones del copiloto, cómo se dice, cuánto cuesta como
// mucho, los topes, dónde va cada foto y en qué operaciones normales acaba (un
// documento válido y UN paso de deshacer). Todo puro: aquí no se genera, no se
// busca y no se recorta nada.
import { describe, expect, it } from 'vitest';
import {
  ASPECT_RATIOS,
  CANVAS_SIZES,
  createEmptyDocument,
  pageView,
  validateDocument,
  withPageLayers,
  type ContentDocument,
  type ImageLayer,
  type TextLayer,
} from '../document';
import { editorReducer, initEditor } from '../editor/history';
import { DEFAULT_SHADOW } from '../editor/imageEffects/shadowDefaults';
import { newImageLayer, newTextLayer } from '../editor/layers';
import { applyCopilotOperations, type CopilotApplyContext, type CopilotAssetInfo } from './apply';
import { COPILOT_LAYOUTS, COPILOT_MAX_PLAN_PHOTOS, copilotOp, type CopilotOperation } from './operations';
import {
  BACKGROUND_ONLY_REASON,
  BACKGROUND_PROMPT_SUFFIX,
  backgroundPrompt,
  brandBackgroundColor,
  buildPlan,
  composePlan,
  describePlan,
  freeArea,
  hasPlanSteps,
  isAiGenerated,
  isCutout,
  isPlainCutoutOf,
  layoutBoxes,
  matchLibraryPhotos,
  namesFoodOrProduct,
  PLAN_MAX_COST_MICROS,
  PLAN_MAX_STEPS,
  planAnswer,
  planNeedsConfirmation,
  planOperations,
  planStepCount,
  rotatedBounds,
  type LibraryPhoto,
  type PlanEnvironment,
  type Rect,
} from './plan';
import { planCost, planProblems } from './planCost';

const BACKGROUND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OLD_PHOTO = '11111111-1111-4111-8111-111111111111';
const photoId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`;
const photo = (n: number, name = `plato-${n}.jpg`, width = 1200, height = 900): CopilotAssetInfo => ({ id: photoId(n), name, width, height });

const op = (fields: Partial<CopilotOperation> & Pick<CopilotOperation, 'op'>): CopilotOperation => copilotOp(fields);
const PALETTE = [
  { hex: '#1F3A5F', role: 'principal' },
  { hex: '#f5ebdd', role: 'Fondo' },
  { hex: '#2B2B2B', role: 'texto' },
];
const ENV: PlanEnvironment = { canvasRatio: '4:5', imageAi: { available: true }, palette: PALETTE, canCutout: true };
const NO_IMAGE_AI: PlanEnvironment = { ...ENV, imageAi: { available: false, reason: 'La imagen con IA no está configurada.' } };

/** «Haz el menú de otoño: crea un fondo que parezca otoñal y pon los platos en el centro». */
const AUTUMN: CopilotOperation[] = [
  op({ op: 'generate_background', prompt: 'Mesa de madera con hojas secas y luz cálida de otoño' }),
  op({ op: 'find_photos', query: 'platos de otoño', count: 3 }),
  op({ op: 'place_photos', layout: 'center', cutout: true, on: true }),
  op({ op: 'add_text', text: 'Menú de otoño', style: 'title', position: 'top' }),
  op({ op: 'add_text', text: 'Solo este mes', style: 'subtitle' }),
];

const context = (assets: CopilotAssetInfo[] = []): CopilotApplyContext => ({
  brand: { palette: PALETTE.map((color) => ({ hex: color.hex.toUpperCase(), role: color.role })), fonts: ['Recoleta', 'Inter'] },
  assets: new Map(assets.map((asset) => [asset.id, asset])),
  logoIds: [],
});

const inside = (inner: Rect, outer: Rect, slack = 1) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  inner.x + inner.width <= outer.x + outer.width + slack &&
  inner.y + inner.height <= outer.y + outer.height + slack;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('la IA solo crea el fondo', () => {
  it('una indicación que nombra comida o productos se reconoce; lo negado no cuenta', () => {
    for (const prompt of [
      'Un plato de sopa de calabaza sobre una mesa',
      'Fondo otoñal con hamburguesas y patatas',
      'Mesa de madera con una botella y dos copas',
      'Bodegón de comida de temporada',
      'Cócteles de colores en una barra',
      'Autumn table with a pumpkin soup dish',
      'Fondo de madera, sin personas, con un plato de sopa',
      'Hojas secas. Un producto en el centro.',
      'Fondo cálido sin texto, plato de cerámica y cubiertos',
    ]) {
      expect(namesFoodOrProduct(prompt), prompt).toBe(true);
    }
    for (const prompt of [
      'Mesa de madera con hojas secas y luz cálida de otoño',
      'Textura de pizarra oscura con tonos vino y naranja',
      'Fondo otoñal sin comida, platos ni personas',
      'Madera rústica y calabazas decorativas, sin platos ni bebidas, sin texto',
      'Hojas secas sobre lino. Sin comida, platos, bebidas, productos, personas ni texto.',
      'Warm autumn wooden table, no food, no people, no text',
      'Pared de ladrillo con luz de tarde, sin ningún producto',
      'Interior de gimnasio vacío con luz de neón, sin personas ni botellas',
    ]) {
      expect(namesFoodOrProduct(prompt), prompt).toBe(false);
    }
  });

  it('a lo que se manda al generador se le añade siempre la coletilla fija', () => {
    expect(backgroundPrompt('  Hojas secas   sobre madera ')).toBe(`Hojas secas sobre madera. ${BACKGROUND_PROMPT_SUFFIX}`);
    expect(backgroundPrompt('Hojas secas sobre madera.')).toBe(`Hojas secas sobre madera. ${BACKGROUND_PROMPT_SUFFIX}`);
    expect(BACKGROUND_PROMPT_SUFFIX).toBe(
      'Fondo para una pieza de redes sociales, sin comida, platos, bebidas, productos, personas, texto ni logotipos.',
    );
    // La coletilla, sola, no es «nombrar comida»: todo lo que nombra está negado.
    expect(namesFoodOrProduct(BACKGROUND_PROMPT_SUFFIX)).toBe(false);
  });

  it('un fondo con comida no entra en el plan (aunque el servidor lo hubiese dejado pasar) y se dice', () => {
    const plan = buildPlan(
      [op({ op: 'generate_background', prompt: 'Un plato de paella humeante' }), op({ op: 'add_text', text: 'Paella', style: 'title' })],
      ENV,
    );
    expect(plan.background).toBeNull();
    expect(plan.notes).toEqual([BACKGROUND_ONLY_REASON]);
    // Sin fondo ni fotos no queda nada que confirmar: lo demás es una orden normal.
    expect(planNeedsConfirmation(plan)).toBe(false);
    expect(planOperations(plan).map((operation) => operation.op)).toEqual(['add_text']);
  });
});

describe('«sí» y «no» a un plan pendiente', () => {
  it('reconoce las respuestas de una frase entera, con muletillas, y nada más', () => {
    for (const yes of ['sí', 'Sí.', 'si', 'vale', 'adelante', 'hazlo', 'Sí, hazlo', 'vale, adelante', 'venga, sí', 'ok', 'de acuerdo', 'eh… sí, por favor', 'confirmo', 'hazlo ya']) {
      expect(planAnswer(yes), yes).toBe('yes');
    }
    for (const no of ['no', 'No.', 'cancela', 'cancélalo', 'mejor no', 'no, déjalo', 'no lo hagas', 'cancela el plan', 'no, gracias', 'olvídalo']) {
      expect(planAnswer(no), no).toBe('no');
    }
    for (const other of ['', 'sí, pero más grande', 'no, mejor pon el título arriba', 'pon el título arriba', 'de', 'sí sí sí sí sí', 'más grande', 'el plan', 'vale, quita el logotipo']) {
      expect(planAnswer(other), other).toBeNull();
    }
  });
});

describe('construir el plan', () => {
  it('con algún paso de plan, la orden es un plan; sin ninguno, no', () => {
    expect(hasPlanSteps(AUTUMN)).toBe(true);
    expect(hasPlanSteps([op({ op: 'find_photos', query: 'platos', count: 1 })])).toBe(true);
    expect(hasPlanSteps(AUTUMN.slice(3))).toBe(false);
    expect(hasPlanSteps([])).toBe(false);
  });

  it('«haz el menú de otoño…»: fondo con IA, búsqueda, recorte y colocación, y los textos al final', () => {
    const plan = buildPlan(AUTUMN, ENV);
    expect(plan.background).toEqual({ mode: 'ai', prompt: 'Mesa de madera con hojas secas y luz cálida de otoño', ratio: '4:5' });
    expect(plan.searches).toEqual([{ query: 'platos de otoño', count: 3 }]);
    expect(plan.wanted).toBe(3);
    expect(plan.placement).toEqual({ layout: 'center', cutout: true, shadow: true });
    expect(plan.sequence.map((item) => item.kind)).toEqual(['background', 'photos', 'operation', 'operation']);
    expect(plan.notes).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(planNeedsConfirmation(plan)).toBe(true);
    // 1 fondo + 1 búsqueda + 3 recortes + colocar + 2 textos.
    expect(planStepCount(plan)).toBe(8);
    expect(planStepCount(plan, 2)).toBe(7);
  });

  it('cada paso, en lenguaje llano; la indicación del fondo se enseña ENTERA, con su coletilla', () => {
    const plan = buildPlan(AUTUMN, ENV);
    expect(describePlan(plan)).toEqual([
      {
        id: 'background',
        kind: 'background',
        label: 'Crear el fondo con IA (4:5)',
        detail: `Mesa de madera con hojas secas y luz cálida de otoño. ${BACKGROUND_PROMPT_SUFFIX}`,
      },
      { id: 'find-0', kind: 'find', label: 'Buscar en la biblioteca hasta 3 fotos de «platos de otoño»' },
      { id: 'cutout', kind: 'cutout', label: 'Quitar el fondo a 3 fotos' },
      { id: 'place', kind: 'place', label: 'Colocar las fotos en el centro, con sombra suave' },
      { id: 'op-0', kind: 'text', label: 'Poner el titular «Menú de otoño»' },
      { id: 'op-1', kind: 'text', label: 'Poner el subtítulo «Solo este mes»' },
    ]);
    // Con las fotos ya encontradas (una sola), se dice con ese número.
    const one = describePlan(plan, 1);
    expect(one.find((step) => step.id === 'cutout')!.label).toBe('Quitar el fondo a 1 foto');
    expect(one.find((step) => step.id === 'place')!.label).toBe('Colocar la foto en el centro, con sombra suave');
    // Las otras disposiciones y lo que no es un texto.
    const other = buildPlan(
      [
        op({ op: 'find_photos', query: 'bolsas', count: 1 }),
        op({ op: 'place_photos', layout: 'fan', cutout: false, on: false }),
        op({ op: 'add_logo', position: 'bottom' }),
        op({ op: 'editor', action: 'save' }),
      ],
      ENV,
    );
    expect(describePlan(other).map((step) => step.label)).toEqual([
      'Buscar en la biblioteca una foto de «bolsas»',
      'Colocar la foto en abanico',
      'Poner el logotipo de la marca',
      'Guardar una versión',
    ]);
    const labels = (layout: (typeof COPILOT_LAYOUTS)[number]) =>
      describePlan(buildPlan([op({ op: 'place_photos', layout, cutout: false, on: false })], ENV), 2)[0]!.label;
    expect(COPILOT_LAYOUTS.map(labels)).toEqual([
      'Colocar las fotos en el centro',
      'Colocar las fotos en fila',
      'Colocar las fotos en rejilla',
      'Colocar las fotos en abanico',
    ]);
  });

  it('la proporción del fondo es la del lienzo salvo que la orden diga otra', () => {
    const square = buildPlan([op({ op: 'generate_background', prompt: 'Pizarra oscura' })], { ...ENV, canvasRatio: '1:1' });
    expect(square.background).toMatchObject({ mode: 'ai', ratio: '1:1' });
    const story = buildPlan([op({ op: 'generate_background', prompt: 'Pizarra oscura', ratio: '9:16' })], ENV);
    expect(story.background).toMatchObject({ mode: 'ai', ratio: '9:16' });
  });

  it('sin IA de imagen: no se ofrece generar; fondo liso del color «fondo» de la marca, y se dice', () => {
    expect(brandBackgroundColor(PALETTE)).toBe('#F5EBDD');
    expect(brandBackgroundColor([{ hex: '#111111', role: 'principal' }])).toBeNull();
    const plan = buildPlan(AUTUMN, NO_IMAGE_AI);
    expect(plan.background).toEqual({ mode: 'color', color: '#F5EBDD', reason: 'La imagen con IA no está configurada.' });
    const [first] = describePlan(plan);
    expect(first).toEqual({
      id: 'background',
      kind: 'background',
      label: 'Poner de fondo un color liso de la marca (#F5EBDD)',
      detail: 'La imagen con IA no está configurada. En su lugar, un color liso: no se genera nada.',
    });
    expect(planCost(plan, 3, 0)).toMatchObject({ maxMicros: 0, overLimit: false, headline: 'Coste: nada. Este plan no usa IA de pago.' });
    expect(planCost(plan, 3, 0).summary).toBe('1 fondo de color gratis · 3 recortes gratis · 2 textos');
    // Sin color de fondo en la marca: el fondo se queda como está, y se dice. Lo demás sigue.
    const bare = buildPlan(AUTUMN, { ...NO_IMAGE_AI, palette: [{ hex: '#1F3A5F', role: 'principal' }] });
    expect(bare.background).toEqual({ mode: 'none', reason: 'La imagen con IA no está configurada.' });
    expect(bare.notes).toEqual(['La imagen con IA no está configurada. La marca no tiene un color de fondo en su perfil: el fondo se queda como está.']);
    expect(describePlan(bare).map((step) => step.kind)).toEqual(['find', 'cutout', 'place', 'text', 'text']);
    expect(planNeedsConfirmation(bare)).toBe(true);
    // Solo un fondo, sin IA y sin color: no queda nada que confirmar.
    const nothing = buildPlan([AUTUMN[0]!], { ...NO_IMAGE_AI, palette: [] });
    expect(planNeedsConfirmation(nothing)).toBe(false);
  });

  it('lo que no cuadra se dice: dos fondos, foto propia de fondo, sin recorte posible, deshacer en un plan', () => {
    const plan = buildPlan(
      [
        op({ op: 'generate_background', prompt: 'Pizarra oscura' }),
        op({ op: 'generate_background', prompt: 'Madera clara' }),
        op({ op: 'find_photos', query: 'bolsas', count: 2 }),
        op({ op: 'place_photos', layout: 'row', cutout: true, on: false }),
        op({ op: 'place_photos', layout: 'grid', cutout: false, on: false }),
        op({ op: 'editor', action: 'undo' }),
      ],
      { ...ENV, canCutout: false },
    );
    expect(plan.background).toMatchObject({ prompt: 'Pizarra oscura' });
    expect(plan.placement).toEqual({ layout: 'row', cutout: false, shadow: false });
    expect(plan.notes).toEqual([
      'Solo se crea un fondo por orden: el segundo no se hace.',
      'Las fotos se colocan de una sola forma por orden: la segunda no se hace.',
      '«Deshaz» y «rehaz» no se mezclan con un plan: dilo aparte.',
      'Aquí no se puede quitar el fondo de las fotos: se colocan tal cual.',
    ]);
    // Con una foto propia de fondo no se genera otro (y no se gasta).
    const own = buildPlan(
      [op({ op: 'generate_background', prompt: 'Pizarra oscura' }), op({ op: 'set_background_image', assetId: OLD_PHOTO }), op({ op: 'find_photos', query: 'bolsas', count: 1 })],
      ENV,
    );
    expect(own.background).toBeNull();
    expect(own.notes).toEqual(['Ya has pedido una foto tuya de fondo: no se genera otro.']);
    // Buscar sin decir cómo colocar: en el centro, tal cual.
    expect(own.placement).toEqual({ layout: 'center', cutout: false, shadow: false });
  });

  it('las fotos van donde la orden dice colocarlas; buscar varias veces suma, con tope', () => {
    const plan = buildPlan(
      [
        op({ op: 'find_photos', query: 'entrantes', count: 4 }),
        op({ op: 'add_text', text: 'Carta', style: 'title' }),
        op({ op: 'find_photos', query: 'postres', count: 4 }),
        op({ op: 'place_photos', layout: 'grid', cutout: false, on: false }),
      ],
      ENV,
    );
    expect(plan.searches).toHaveLength(2);
    expect(plan.wanted).toBe(COPILOT_MAX_PLAN_PHOTOS);
    expect(plan.sequence.map((item) => item.kind)).toEqual(['operation', 'photos']);
  });
});

describe('coste máximo y topes', () => {
  const plan = buildPlan(AUTUMN, ENV);

  it('lo único de pago es el fondo con IA; su precio lo da el servidor y lo demás es gratis', () => {
    const cost = planCost(plan, 3, 140_000);
    expect(cost.maxMicros).toBe(140_000);
    expect(cost.summary).toBe('1 fondo con IA ≈ 0,14 créditos · 3 recortes gratis · 2 textos');
    expect(cost.headline).toBe('Coste máximo: 0,14 créditos (el fondo con IA; lo demás es gratis).');
    expect(cost.overLimit).toBe(false);
    // Antes de saber cuántas fotos hay: «hasta».
    expect(planCost(plan, undefined, 140_000).summary).toBe('1 fondo con IA ≈ 0,14 créditos · hasta 3 recortes gratis · 2 textos');
    // Sin recorte, las fotos se cuentan como fotos de la biblioteca.
    const plain = buildPlan([AUTUMN[1]!, op({ op: 'place_photos', layout: 'row', cutout: false, on: false })], ENV);
    expect(planCost(plain, 1, 0)).toMatchObject({ maxMicros: 0, summary: '1 foto de la biblioteca', headline: 'Coste: nada. Este plan no usa IA de pago.' });
  });

  it('mientras se calcula, y si no se puede calcular, se dice con honestidad', () => {
    expect(planCost(plan, undefined, undefined)).toMatchObject({ maxMicros: null, headline: 'Calculando el coste del fondo con IA…' });
    const unknown = planCost(plan, 3, null);
    expect(unknown.maxMicros).toBeNull();
    expect(unknown.overLimit).toBe(false);
    expect(unknown.summary).toBe('1 fondo con IA (el coste se ve al generar) · 3 recortes gratis · 2 textos');
    expect(unknown.headline).toMatch(/No se ha podido calcular el coste del fondo con IA antes de generarlo/);
    expect(planProblems(plan, 3, null)).toEqual([]);
  });

  it('un plan por encima del tope de coste no se ofrece, y se dice por qué', () => {
    expect(PLAN_MAX_COST_MICROS).toBe(1_000_000);
    expect(planProblems(plan, 3, PLAN_MAX_COST_MICROS)).toEqual([]);
    expect(planCost(plan, 3, PLAN_MAX_COST_MICROS + 1).overLimit).toBe(true);
    expect(planProblems(plan, 3, 2_500_000)).toEqual([
      'El fondo con IA cuesta ≈ 2,50 créditos y el tope por plan es 1,00 crédito: no se ejecuta tal cual.',
    ]);
  });

  it('un plan con más pasos que el tope no se ofrece, y se dice por qué', () => {
    expect(PLAN_MAX_STEPS).toBe(12);
    const texts = Array.from({ length: 6 }, () => op({ op: 'add_text', text: 'Línea', style: 'body' }));
    const big = buildPlan(
      [AUTUMN[0]!, op({ op: 'find_photos', query: 'platos', count: 6 }), op({ op: 'place_photos', layout: 'grid', cutout: true, on: false }), ...texts],
      ENV,
    );
    // 1 fondo + 1 búsqueda + 6 recortes + colocar + 6 textos.
    expect(planStepCount(big)).toBe(15);
    expect(big.blockers).toEqual(['El plan tiene 15 pasos y el tope es 12: pide menos cosas de una vez.']);
    expect(planProblems(big, 6, 100)).toEqual(big.blockers);
    // Justo en el tope, sí.
    const fits = buildPlan([AUTUMN[0]!, op({ op: 'find_photos', query: 'platos', count: 6 }), op({ op: 'place_photos', layout: 'grid', cutout: true, on: false }), ...texts.slice(0, 3)], ENV);
    expect(planStepCount(fits)).toBe(12);
    expect(fits.blockers).toEqual([]);
  });
});

describe('dónde va cada foto', () => {
  const areaOf = (ratio: (typeof ASPECT_RATIOS)[number]) => freeArea(CANVAS_SIZES[ratio], []);

  it('las cuatro disposiciones, de 1 a 6 fotos y en todas las proporciones: dentro del lienzo, también giradas', () => {
    for (const ratio of ASPECT_RATIOS) {
      const canvas = { x: 0, y: 0, ...CANVAS_SIZES[ratio] };
      const area = areaOf(ratio);
      expect(inside(area, canvas), ratio).toBe(true);
      for (const layout of COPILOT_LAYOUTS) {
        for (let count = 1; count <= COPILOT_MAX_PLAN_PHOTOS; count += 1) {
          const boxes = layoutBoxes(area, count, layout);
          expect(boxes, `${ratio} ${layout} ${count}`).toHaveLength(count);
          for (const box of boxes) {
            expect(Number.isInteger(box.x) && Number.isInteger(box.y) && Number.isInteger(box.width), `${ratio} ${layout} ${count}`).toBe(true);
            expect(box.width, `${ratio} ${layout} ${count}`).toBeGreaterThanOrEqual(80);
            expect(box.width).toBe(box.height);
            expect(inside(rotatedBounds(box), area, 2), `${ratio} ${layout} ${count}: ${JSON.stringify(box)}`).toBe(true);
          }
        }
      }
    }
  });

  it('cada disposición es lo que dice: una grande, fila, rejilla con aire y abanico girado y solapado', () => {
    const area = areaOf('4:5');
    // Centro: una sola, grande y centrada.
    const [one] = layoutBoxes(area, 1, 'center');
    expect(one!.width).toBeGreaterThan(area.width * 0.8);
    expect(Math.abs(one!.x + one!.width / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(one!.y + one!.height / 2 - (area.y + area.height / 2))).toBeLessThanOrEqual(1);
    // Centro con varias: agrupadas (se solapan un poco) y sin girar.
    const cluster = layoutBoxes(area, 3, 'center');
    expect(cluster.some((box, index) => cluster.some((other, j) => j > index && overlap(box, other)))).toBe(true);
    expect(cluster.every((box) => !box.rotation)).toBe(true);
    // Fila: todas a la misma altura, de izquierda a derecha y sin pisarse.
    const row = layoutBoxes(area, 4, 'row');
    expect(new Set(row.map((box) => box.y)).size).toBe(1);
    expect(row.map((box) => box.x)).toEqual([...row.map((box) => box.x)].sort((a, b) => a - b));
    expect(row.some((box, index) => row.some((other, j) => j > index && overlap(box, other)))).toBe(false);
    // Rejilla: varias filas y ninguna se pisa.
    const grid = layoutBoxes(area, 6, 'grid');
    expect(new Set(grid.map((box) => box.y)).size).toBeGreaterThan(1);
    expect(grid.some((box, index) => grid.some((other, j) => j > index && overlap(box, other)))).toBe(false);
    // Abanico: giros simétricos de izquierda a derecha, solapadas y las de los lados más bajas.
    const fan = layoutBoxes(area, 3, 'fan');
    expect(fan.map((box) => box.rotation)).toEqual([-12, 0, 12]);
    expect(overlap(fan[0]!, fan[1]!) && overlap(fan[1]!, fan[2]!)).toBe(true);
    expect(fan[0]!.y).toBeGreaterThan(fan[1]!.y);
    expect(fan[2]!.y).toBe(fan[0]!.y);
    expect(layoutBoxes(area, 6, 'fan').map((box) => box.rotation)).toEqual([-15, -9, -3, 3, 9, 15]);
    expect(layoutBoxes(area, 1, 'fan')[0]!.rotation ?? 0).toBe(0);
    // Nada que colocar, y más de las que caben.
    expect(layoutBoxes(area, 0, 'grid')).toEqual([]);
    expect(layoutBoxes(area, 9, 'grid')).toHaveLength(COPILOT_MAX_PLAN_PHOTOS);
  });

  it('la franja libre es la más alta entre lo ocupado; sin sitio, el lienzo entero y se avisa', () => {
    const canvas = CANVAS_SIZES['4:5'];
    const title = { x: 86, y: 68, width: 908, height: 115 };
    const below = freeArea(canvas, [title]);
    expect(below.fits).toBe(true);
    expect(below.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(below.y + below.height).toBeLessThanOrEqual(canvas.height);
    // Titular arriba y precio abajo: la franja de en medio.
    const price = { x: 86, y: 1150, width: 908, height: 80 };
    const middle = freeArea(canvas, [price, title]);
    expect(middle.y).toBeGreaterThanOrEqual(title.y + title.height);
    expect(middle.y + middle.height).toBeLessThanOrEqual(price.y);
    // Textos por todas partes: no queda una franja con sitio.
    const crowded = freeArea(canvas, [title, { x: 86, y: 400, width: 908, height: 200 }, { x: 86, y: 800, width: 908, height: 200 }, price]);
    expect(crowded.fits).toBe(false);
    expect(crowded.height).toBeGreaterThan(canvas.height * 0.8);
  });
});

describe('del plan a operaciones normales', () => {
  const background: CopilotAssetInfo = { id: BACKGROUND, name: 'IA · fondo otoñal.png', width: 1024, height: 1280 };
  const photos = [photo(1), photo(2), photo(3)];
  const empty = () => createEmptyDocument({ aspectRatio: '4:5' });

  function apply(document: ContentDocument, operations: CopilotOperation[], env = ENV, assets = photos, generated: CopilotAssetInfo | null = background) {
    const plan = buildPlan(operations, env);
    const ctx = context([background, ...assets]);
    const composed = composePlan(plan, { background: generated, photos: assets }, document, ctx);
    const result = applyCopilotOperations(document, composed.operations, ctx);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return { plan, composed, result, layers: pageView(result.document, result.pageIndex).layers };
  }

  it('el fondo generado, una foto por caja y los textos encima: documento válido y UN paso de deshacer', () => {
    const start = empty();
    const { composed, result, layers } = apply(start, AUTUMN);
    expect(composed.operations.map((operation) => operation.op)).toEqual([
      'set_background_image',
      'add_image',
      'add_image',
      'add_image',
      'add_text',
      'add_text',
    ]);
    expect(composed.notes).toEqual([]);
    expect(validateDocument(result.document)).toEqual({ ok: true, document: result.document });
    expect(layers.map((layer) => layer.type)).toEqual(['image', 'image', 'image', 'image', 'text', 'text']);
    // El fondo: la imagen generada, a lienzo completo.
    const [back, ...rest] = layers as [ImageLayer, ...(ImageLayer | TextLayer)[]];
    expect(back).toMatchObject({ x: 0, y: 0, width: 1080, height: 1350, source: { kind: 'asset', assetId: BACKGROUND } });
    // Las fotos: las de la biblioteca (no la generada), enteras, con sombra y dentro del lienzo.
    const placed = rest.filter((layer): layer is ImageLayer => layer.type === 'image');
    expect(placed.map((layer) => (layer.source.kind === 'asset' ? layer.source.assetId : ''))).toEqual(photos.map((p) => p.id));
    const texts = rest.filter((layer): layer is TextLayer => layer.type === 'text');
    for (const layer of placed) {
      expect(layer).toMatchObject({ fit: 'contain', shadow: DEFAULT_SHADOW });
      // Con las proporciones de la foto (4:3), no las de la caja.
      expect(layer.width / layer.height).toBeCloseTo(4 / 3, 1);
      expect(inside(layer, { x: 0, y: 0, width: 1080, height: 1350 })).toBe(true);
      // Sin pisar el titular ni el subtítulo.
      for (const text of texts) expect(overlap(layer, text), `${layer.name} pisa «${text.text}»`).toBe(false);
    }
    expect(texts.map((text) => text.text)).toEqual(['Menú de otoño', 'Solo este mes']);
    expect(result.changes).toEqual([
      'Foto de fondo «IA · fondo otoñal.png»',
      'Foto «plato-1.jpg» añadida encima',
      'Foto «plato-2.jpg» añadida encima',
      'Foto «plato-3.jpg» añadida encima',
      'Texto «Menú de otoño»',
      'Texto «Solo este mes»',
    ]);

    // En el editor: una sola sustitución, y un solo «deshacer» vuelve al principio.
    const before = initEditor(start);
    const after = editorReducer(before, { type: 'replace', document: result.document, select: result.touched });
    expect(after.document).toBe(result.document);
    const undone = editorReducer(after, { type: 'undo' });
    expect(undone.document).toEqual(start);
    expect(editorReducer(undone, { type: 'undo' })).toBe(undone);
  });

  it('las cuatro disposiciones, de 1 a 6 fotos: siempre un documento válido, sin salirse y sin pisar el titular', () => {
    for (const layout of COPILOT_LAYOUTS) {
      for (let count = 1; count <= COPILOT_MAX_PLAN_PHOTOS; count += 1) {
        const assets = Array.from({ length: count }, (_, index) => photo(index + 1, `foto-${index + 1}.jpg`, index % 2 ? 900 : 1600, index % 2 ? 1600 : 900));
        const { result, layers } = apply(
          empty(),
          [
            AUTUMN[0]!,
            op({ op: 'find_photos', query: 'platos', count }),
            op({ op: 'place_photos', layout, cutout: false, on: layout === 'fan' }),
            op({ op: 'add_text', text: 'Menú de otoño', style: 'title', position: 'top' }),
          ],
          ENV,
          assets,
        );
        expect(validateDocument(result.document).ok, `${layout} ${count}`).toBe(true);
        const images = layers.filter((layer): layer is ImageLayer => layer.type === 'image').slice(1);
        const title = layers.find((layer) => layer.type === 'text')!;
        expect(images, `${layout} ${count}`).toHaveLength(count);
        for (const image of images) {
          const bounds = rotatedBounds(image);
          expect(inside(bounds, { x: 0, y: 0, width: 1080, height: 1350 }, 2), `${layout} ${count}: ${image.name}`).toBe(true);
          expect(overlap(bounds, title), `${layout} ${count}: ${image.name} pisa el titular`).toBe(false);
        }
        if (layout === 'fan' && count > 1) expect(images.some((image) => image.rotation !== 0)).toBe(true);
      }
    }
  });

  it('respeta lo que ya había: cambia la foto de fondo, deja libre el texto existente y no toca otras páginas', () => {
    const base = createEmptyDocument({ aspectRatio: '1:1', pages: 2 });
    const old: ImageLayer = { ...newImageLayer(base.canvas, [], { id: OLD_PHOTO, name: 'salón.jpg' }), id: 'fondo' };
    const existing: TextLayer = { ...newTextLayer(base.canvas, [], { fontFamily: 'Recoleta', color: '#FFFFFF' }), id: 'pie', text: 'Reserva ya', y: 900, height: 90 };
    const start = withPageLayers(base, 0, [old, existing]);
    const { result, layers } = apply(start, [AUTUMN[0]!, AUTUMN[1]!, op({ op: 'place_photos', layout: 'row', cutout: false, on: false })]);
    // La capa de fondo es la misma, con la imagen generada.
    expect(layers[0]).toMatchObject({ id: 'fondo', source: { kind: 'asset', assetId: BACKGROUND } });
    const images = layers.filter((layer): layer is ImageLayer => layer.type === 'image').slice(1);
    expect(images).toHaveLength(3);
    for (const image of images) expect(overlap(image, existing)).toBe(false);
    // El texto que había sigue encima de todo y la otra página, intacta.
    expect(layers.at(-1)).toMatchObject({ id: 'pie' });
    expect(result.document.pages[1]).toEqual(start.pages[1]);
  });

  it('sin fondo generado ni fotos, queda lo demás; sin IA de imagen, el color de la marca', () => {
    const start = empty();
    // El fondo no llegó a crearse y no hay fotos: solo los textos.
    const none = apply(start, AUTUMN, ENV, [], null);
    expect(none.composed.operations.map((operation) => operation.op)).toEqual(['add_text', 'add_text']);
    // Sin IA de imagen: color liso de la marca en vez de fondo generado; lo demás, igual.
    const color = apply(start, AUTUMN, NO_IMAGE_AI, photos, null);
    expect(color.composed.operations.map((operation) => operation.op)).toEqual(['set_background_color', 'add_image', 'add_image', 'add_image', 'add_text', 'add_text']);
    expect(color.result.document.canvas.backgroundColor).toBe('#F5EBDD');
    expect(color.layers.filter((layer) => layer.type === 'image')).toHaveLength(3);
    expect(validateDocument(color.result.document).ok).toBe(true);
  });

  it('las fotos van siempre por debajo de los textos, aunque la orden diga colocarlas después', () => {
    const { composed, layers } = apply(empty(), [
      op({ op: 'add_text', text: 'Carta', style: 'title', position: 'top' }),
      op({ op: 'find_photos', query: 'platos', count: 2 }),
      op({ op: 'place_photos', layout: 'row', cutout: false, on: false }),
    ], ENV, photos.slice(0, 2), null);
    expect(composed.operations.map((operation) => operation.op)).toEqual(['add_text', 'add_image', 'add_image']);
    expect(layers.map((layer) => layer.type)).toEqual(['image', 'image', 'text']);
    expect(layers.slice(0, 2).map((layer) => layer.name)).toEqual(['plato-1.jpg', 'plato-2.jpg']);
  });

  it('sin franja libre entre los textos, las fotos se colocan igualmente y se avisa', () => {
    const base = empty();
    const line = (id: string, y: number): TextLayer => ({ ...newTextLayer(base.canvas, [], {}), id, text: id, y, height: 200 });
    const start = withPageLayers(base, 0, [line('a', 60), line('b', 380), line('c', 700), line('d', 1050)]);
    const { composed, result } = apply(start, [AUTUMN[1]!, op({ op: 'place_photos', layout: 'grid', cutout: false, on: false })], ENV, photos, null);
    expect(composed.notes).toEqual(['No queda una franja libre entre los textos: las fotos pueden pisar alguno. Muévelas si hace falta.']);
    expect(validateDocument(result.document).ok).toBe(true);
  });
});

describe('buscar en la biblioteca', () => {
  const lib = (n: number, name: string, extra: Partial<LibraryPhoto> = {}): LibraryPhoto => ({ id: photoId(n), name, width: 1000, height: 800, ...extra });
  const LIBRARY: LibraryPhoto[] = [
    lib(1, 'crema-calabaza.jpg', { tags: ['plato', 'otoño'] }),
    lib(2, 'IMG_2231.jpg', { folder: 'Platos de otoño' }),
    lib(3, 'terraza.jpg', { tags: ['local'] }),
    lib(4, 'Plato de setas.JPG'),
    lib(5, 'plato-generado.png', { tags: ['plato', 'otoño'], provenance: { type: 'ai_generation', prompt: 'un plato' } }),
    lib(6, 'crema-calabaza (sin fondo).png', { folder: 'Ediciones', tags: ['edición', 'plato', 'otoño'], provenance: { type: 'photo_edit', source_asset_id: photoId(1), steps: [{ kind: 'remove_background' }] } }),
    lib(7, 'otoñal-decoración.jpg'),
    lib(8, 'botella-aceite.jpg', { tags: ['producto'] }),
  ];
  const names = (query: string, count = 6) => matchLibraryPhotos(LIBRARY, query, count).map((item) => item.name);

  it('por nombre, etiquetas y carpeta; sin tildes, mayúsculas ni plurales; lo que más casa, primero', () => {
    expect(names('platos de otoño')).toEqual(['crema-calabaza.jpg', 'IMG_2231.jpg', 'Plato de setas.JPG', 'otoñal-decoración.jpg']);
    expect(names('PLATOS', 2)).toEqual(['crema-calabaza.jpg', 'Plato de setas.JPG']);
    expect(names('la terraza')).toEqual(['terraza.jpg']);
    expect(names('productos')).toEqual(['botella-aceite.jpg']);
    expect(names('botellas de aceite')).toEqual(['botella-aceite.jpg']);
  });

  it('nunca devuelve una imagen generada con IA, ni una foto y su recorte a la vez', () => {
    expect(names('platos')).not.toContain('plato-generado.png');
    expect(names('crema de calabaza')).toEqual(['crema-calabaza.jpg']);
    // Si la original no casa (o ya no está), su edición sí vale.
    expect(matchLibraryPhotos(LIBRARY.filter((item) => item.id !== photoId(1)), 'crema', 3).map((item) => item.name)).toEqual(['crema-calabaza (sin fondo).png']);
  });

  it('sin nada que case, o sin nada que buscar, no devuelve nada', () => {
    expect(names('hamburguesas')).toEqual([]);
    expect(names('de la')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('platos', 0)).toEqual([]);
    expect(matchLibraryPhotos([], 'platos', 3)).toEqual([]);
  });

  it('sabe qué es una imagen de IA y qué un recorte (para no recortar dos veces)', () => {
    expect(isAiGenerated(LIBRARY[4]!)).toBe(true);
    expect(isAiGenerated(LIBRARY[0]!)).toBe(false);
    expect(isCutout(LIBRARY[5]!)).toBe(true);
    expect(isCutout(LIBRARY[0]!)).toBe(false);
    expect(isPlainCutoutOf(LIBRARY[5]!, photoId(1))).toBe(true);
    expect(isPlainCutoutOf(LIBRARY[5]!, photoId(2))).toBe(false);
    // Un recorte con más pasos (fondo nuevo…) no es «la foto sin fondo».
    const composed = lib(9, 'x.png', { provenance: { type: 'photo_edit', source_asset_id: photoId(1), steps: [{ kind: 'remove_background' }, { kind: 'background' }] } });
    expect(isCutout(composed)).toBe(true);
    expect(isPlainCutoutOf(composed, photoId(1))).toBe(false);
  });
});
