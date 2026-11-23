// Órdenes que montan una pieza (plan por pasos, docs/copiloto-voz.md §15): qué
// plan sale de las operaciones del copiloto, cómo se dice, cuánto cuesta como
// mucho, los topes, dónde va cada foto y en qué operaciones normales acaba (un
// documento válido y UN paso de deshacer). También lo que se corrigió tras la
// prueba real del 23/11/2026: las fotos van recortadas por defecto sobre una
// imagen de fondo, el tono del fondo generado se mide (no se supone) y las
// fotos no pisan los textos. Todo puro: aquí no se genera, no se busca y no se
// recorta nada.
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
import { newImageLayer, newLogoLayer, newTextLayer } from '../editor/layers';
import { applyCopilotOperations, type CopilotApplyContext, type CopilotAssetInfo } from './apply';
import { ASSUMED_PHOTO_TONE, backdropAt, contrastOf, measureTone, toneUnder } from './legibility';
import { COPILOT_LAYOUTS, COPILOT_MAX_PLAN_PHOTOS, copilotOp, type CopilotOperation } from './operations';
import {
  BACKGROUND_ONLY_REASON,
  BACKGROUND_PROMPT_SUFFIX,
  backgroundPrompt,
  brandBackgroundColor,
  buildPlan,
  canvasArea,
  clearCenter,
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
  setPlanCutout,
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
      { id: 'place', kind: 'place', label: 'Colocar las fotos en el centro, recortadas, sin su fondo, con sombra suave' },
      { id: 'op-0', kind: 'text', label: 'Poner el titular «Menú de otoño»' },
      { id: 'op-1', kind: 'text', label: 'Poner el subtítulo «Solo este mes»' },
    ]);
    // Con las fotos ya encontradas (una sola), se dice con ese número.
    const one = describePlan(plan, 1);
    expect(one.find((step) => step.id === 'cutout')!.label).toBe('Quitar el fondo a 1 foto');
    expect(one.find((step) => step.id === 'place')!.label).toBe('Colocar la foto en el centro, recortada, sin su fondo, con sombra suave');
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
    // Buscar sin decir cómo colocar: en el centro; sobre la foto de fondo que pone la orden, recortadas.
    expect(own.placement).toEqual({ layout: 'center', cutout: true, shadow: false });
    // Sin imagen de fondo: en el centro, tal cual.
    expect(buildPlan([op({ op: 'find_photos', query: 'bolsas', count: 1 })], ENV).placement).toEqual({ layout: 'center', cutout: false, shadow: false });
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

describe('recorte por defecto sobre una imagen de fondo', () => {
  const GENERATE = AUTUMN[0]!;
  const FIND = op({ op: 'find_photos', query: 'platos de carne', count: 2 });
  const place = (cutout: boolean) => op({ op: 'place_photos', layout: 'row', cutout, on: true });

  it('con fondo generado, las fotos van recortadas aunque la IA diga que no, y el plan lo dice', () => {
    // Lo que mandó el modelo en la prueba real del 23/11/2026: `cutout: false`.
    const plan = buildPlan([GENERATE, FIND, place(false)], ENV);
    expect(plan.overImage).toBe(true);
    expect(plan.canCutout).toBe(true);
    expect(plan.placement).toEqual({ layout: 'row', cutout: true, shadow: true });
    expect(plan.notes).toEqual([]);
    // 1 fondo + 1 búsqueda + 2 recortes + colocar.
    expect(planStepCount(plan)).toBe(5);
    expect(describePlan(plan, 2).map((step) => step.label)).toEqual([
      'Crear el fondo con IA (4:5)',
      'Buscar en la biblioteca hasta 2 fotos de «platos de carne»',
      'Quitar el fondo a 2 fotos',
      'Colocar las fotos en fila, recortadas, sin su fondo, con sombra suave',
    ]);
    expect(planCost(plan, 2, 140_000).summary).toBe('1 fondo con IA ≈ 0,14 créditos · 2 recortes gratis');
  });

  it('con una foto de fondo ya puesta en la página, o con la que pone la propia orden, también', () => {
    const existing = buildPlan([FIND, place(false)], { ...ENV, backgroundImage: true });
    expect(existing).toMatchObject({ background: null, overImage: true, placement: { cutout: true } });
    expect(describePlan(existing, 2).map((step) => step.id)).toEqual(['find-0', 'cutout', 'place']);
    const own = buildPlan([op({ op: 'set_background_image', assetId: OLD_PHOTO }), FIND, place(false)], ENV);
    expect(own).toMatchObject({ background: null, overImage: true, placement: { cutout: true } });
    // Sin IA de imagen el fondo es un color liso, pero la foto de fondo que había sigue debajo: recortadas.
    expect(buildPlan([GENERATE, FIND, place(false)], { ...NO_IMAGE_AI, backgroundImage: true })).toMatchObject({
      background: { mode: 'color' },
      overImage: true,
      placement: { cutout: true },
    });
  });

  it('sin imagen de fondo (lienzo de color liso) se respeta lo que diga la IA', () => {
    const whole = buildPlan([FIND, place(false)], ENV);
    expect(whole).toMatchObject({ overImage: false, placement: { cutout: false } });
    expect(describePlan(whole, 2).map((step) => step.label)).toEqual([
      'Buscar en la biblioteca hasta 2 fotos de «platos de carne»',
      'Colocar las fotos en fila, con sombra suave',
    ]);
    expect(buildPlan([FIND, place(true)], ENV)).toMatchObject({ overImage: false, placement: { cutout: true } });
    // Sin IA de imagen, el fondo es el color liso de la marca: tampoco es una imagen.
    const color = buildPlan([GENERATE, FIND, place(false)], NO_IMAGE_AI);
    expect(color).toMatchObject({ background: { mode: 'color' }, overImage: false, placement: { cutout: false } });
    // Y si el fondo no se llega a ofrecer (nombra comida), no hay imagen de fondo.
    const food = buildPlan([op({ op: 'generate_background', prompt: 'Un plato de paella' }), FIND, place(false)], ENV);
    expect(food).toMatchObject({ background: null, overImage: false, placement: { cutout: false } });
  });

  it('si aquí no se puede quitar el fondo, se colocan enteras y se dice', () => {
    const plan = buildPlan([GENERATE, FIND, place(false)], { ...ENV, canCutout: false });
    expect(plan).toMatchObject({ overImage: true, canCutout: false, placement: { cutout: false } });
    expect(plan.notes).toEqual(['Aquí no se puede quitar el fondo de las fotos: se colocan tal cual.']);
    expect(describePlan(plan, 2).at(-1)!.label).toBe('Colocar las fotos en fila, enteras, con su fondo, con sombra suave');
    // El interruptor no puede encender lo que aquí no se puede hacer.
    expect(setPlanCutout(plan, true)).toBe(plan);
  });

  it('el interruptor de la tarjeta: enteras o recortadas; cambian el texto del paso, los pasos, el coste y el tope', () => {
    const plan = buildPlan([GENERATE, FIND, place(false)], ENV);
    const whole = setPlanCutout(plan, false);
    expect(whole).not.toBe(plan);
    expect(whole.placement).toEqual({ layout: 'row', cutout: false, shadow: true });
    expect(plan.placement!.cutout).toBe(true);
    expect(describePlan(whole, 2).map((step) => step.label)).toEqual([
      'Crear el fondo con IA (4:5)',
      'Buscar en la biblioteca hasta 2 fotos de «platos de carne»',
      'Colocar las fotos en fila, enteras, con su fondo, con sombra suave',
    ]);
    expect(planStepCount(whole, 2)).toBe(3);
    expect(planCost(whole, 2, 140_000).summary).toBe('1 fondo con IA ≈ 0,14 créditos · 2 fotos de la biblioteca');
    // De vuelta a recortadas; pedir lo que ya está no cambia nada.
    expect(setPlanCutout(whole, true)).toEqual(plan);
    expect(setPlanCutout(plan, true)).toBe(plan);
    // Sin fotos que colocar no hay nada que cambiar.
    const bare = buildPlan([GENERATE], ENV);
    expect(setPlanCutout(bare, false)).toBe(bare);
    // El tope de pasos se recalcula: 6 recortes de más lo pasan; enteras, cabe.
    const texts = Array.from({ length: 6 }, () => op({ op: 'add_text', text: 'Línea', style: 'body' }));
    const big = buildPlan([GENERATE, op({ op: 'find_photos', query: 'platos', count: 6 }), op({ op: 'place_photos', layout: 'grid', cutout: false, on: false }), ...texts], ENV);
    expect(big.blockers).toEqual(['El plan tiene 15 pasos y el tope es 12: pide menos cosas de una vez.']);
    expect(setPlanCutout(big, false).blockers).toEqual([]);
    expect(setPlanCutout(setPlanCutout(big, false), true).blockers).toEqual(big.blockers);
  });
});

/** Píxeles RGBA de mentira (los de un `canvas` reducido), con el color de cada punto. */
function pixels(width: number, height: number, color: (x: number, y: number) => [number, number, number, number?]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = color(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return data;
}

describe('el tono del fondo se mide, no se supone', () => {
  const CREAM: [number, number, number] = [236, 222, 196];
  const DARK: [number, number, number] = [24, 20, 18];
  const canvas = createEmptyDocument({ aspectRatio: '1:1' }).canvas;
  const back = newImageLayer(canvas, [], { id: BACKGROUND, name: 'fondo.png' });

  it('de los píxeles sale el tono medio y una rejilla por zonas; lo transparente no cuenta', () => {
    const light = measureTone(pixels(16, 16, () => CREAM), 16, 16)!;
    expect(light.grid).toMatchObject({ columns: 8, rows: 8, aspect: 1 });
    expect(light.grid.cells).toHaveLength(64);
    // Un fondo crema es CLARO: sobre él se lee el negro, no el blanco (justo lo que falló al suponerlo oscuro).
    expect(contrastOf('#FFFFFF', light.mean)).toBeLessThan(1.5);
    expect(contrastOf('#000000', light.mean)).toBeGreaterThan(10);
    expect(contrastOf('#FFFFFF', ASSUMED_PHOTO_TONE)).toBeGreaterThan(4.5);
    // Mitad de arriba oscura, mitad de abajo clara.
    const split = measureTone(pixels(16, 32, (_x, y) => (y < 16 ? DARK : CREAM)), 16, 32)!;
    expect(split.grid.aspect).toBe(0.5);
    expect(split.grid.cells[0]!).toBeLessThan(0.02);
    expect(split.grid.cells[63]!).toBeGreaterThan(0.6);
    // Una imagen pequeña no inventa celdas; una vacía o toda transparente no se mide.
    expect(measureTone(pixels(2, 3, () => CREAM), 2, 3)!.grid).toMatchObject({ columns: 2, rows: 3 });
    expect(measureTone(pixels(4, 4, () => [0, 0, 0, 0]), 4, 4)).toBeNull();
    expect(measureTone(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    // Una zona transparente toma el tono medio de lo que sí se ve.
    const holed = measureTone(pixels(16, 16, (x) => (x < 8 ? [...CREAM, 0] : CREAM)), 16, 16)!;
    expect(holed.grid.cells[0]).toBeCloseTo(holed.grid.cells[7]!, 5);
  });

  it('bajo cada texto cuenta la zona del fondo que tiene debajo, no la media de toda la foto', () => {
    const split = measureTone(pixels(16, 16, (_x, y) => (y < 8 ? DARK : CREAM)), 16, 16)!;
    const top = { x: 108, y: 54, width: 864, height: 120 };
    const bottom = { x: 108, y: 900, width: 864, height: 120 };
    expect(contrastOf('#FFFFFF', toneUnder(split.grid, back, top)!)).toBeGreaterThan(10);
    expect(contrastOf('#000000', toneUnder(split.grid, back, bottom)!)).toBeGreaterThan(10);
    const zones = new Map([[BACKGROUND, split.grid]]);
    const tones = new Map([[BACKGROUND, split.mean]]);
    expect(backdropAt(canvas, [back], top, tones, zones)).toMatchObject({ kind: 'photo', assetId: BACKGROUND, required: 4.5 });
    expect(contrastOf('#FFFFFF', backdropAt(canvas, [back], top, tones, zones).hex)).toBeGreaterThan(10);
    expect(contrastOf('#000000', backdropAt(canvas, [back], bottom, tones, zones).hex)).toBeGreaterThan(10);
    // Sin zonas, la media; sin nada, lo supuesto.
    expect(backdropAt(canvas, [back], top, tones).hex).toBe(split.mean);
    expect(backdropAt(canvas, [back], top).hex).toBe(ASSUMED_PHOTO_TONE);
    // Si no se sabe qué parte de la foto se ve (recortada, girada, encajada entera), no se adivina la zona: la media.
    expect(toneUnder(split.grid, { ...back, fit: 'contain' }, top)).toBeNull();
    expect(toneUnder(split.grid, { ...back, turn: 90 }, top)).toBeNull();
    expect(toneUnder(split.grid, { ...back, flipY: true }, top)).toBeNull();
    expect(backdropAt(canvas, [{ ...back, fit: 'contain' }], top, tones, zones).hex).toBe(split.mean);
    // Una foto más ancha que su caja: se ve su franja central (lo de los lados no cuenta).
    const sides = measureTone(pixels(32, 16, (x) => (x < 8 || x >= 24 ? DARK : CREAM)), 32, 16)!;
    expect(contrastOf('#000000', toneUnder(sides.grid, back, { x: 0, y: 400, width: 1080, height: 100 })!)).toBeGreaterThan(10);
  });
});

describe('las fotos no pisan los textos', () => {
  const canvas = CANVAS_SIZES['1:1'];
  const frame = canvasArea(canvas);
  /** Un título centrado en el lienzo (como el de `newTextLayer`). */
  const centered: Rect = { x: 108, y: 449, width: 864, height: 182 };
  const atTop: Rect = { x: 108, y: 54, width: 864, height: 182 };
  const group = (boxes: Rect[]): Rect => {
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
  };
  const centerOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

  it('título centrado (no se puede mover) y «en el centro» con 1, 2 y 3 fotos: sin solapes, dentro del lienzo y centradas en el hueco', () => {
    // El hueco libre más grande: arriba y abajo miden lo mismo; a igualdad, el de abajo (el título encabeza).
    const gap = { from: centered.y + centered.height + 21, to: frame.y + frame.height };
    for (const count of [1, 2, 3]) {
      const boxes = layoutBoxes(frame, count, 'center', [centered]);
      expect(boxes, String(count)).toHaveLength(count);
      for (const box of boxes) {
        expect(inside(box, frame), `${count}: ${JSON.stringify(box)}`).toBe(true);
        expect(overlap(box, centered), `${count}: pisa el título`).toBe(false);
        expect(box.y).toBeGreaterThanOrEqual(gap.from);
      }
      const middle = centerOf(group(boxes));
      expect(Math.abs(middle.x - canvas.width / 2), `${count}: a lo ancho`).toBeLessThanOrEqual(1);
      expect(Math.abs(middle.y - (gap.from + gap.to) / 2), `${count}: a lo alto`).toBeLessThanOrEqual(1);
    }
  });

  it('con el título arriba, «en el centro» es el centro del lienzo; una fila se centra en el hueco, no se va abajo', () => {
    const gap = { from: atTop.y + atTop.height + 21, to: frame.y + frame.height };
    for (const count of [1, 2, 3]) {
      const boxes = layoutBoxes(frame, count, 'center', [atTop]);
      for (const box of boxes) {
        expect(inside(box, frame)).toBe(true);
        expect(overlap(box, atTop)).toBe(false);
      }
      const middle = centerOf(group(boxes));
      // Agrupadas y centradas en el lienzo, a lo ancho y a lo alto.
      expect(Math.abs(middle.x - canvas.width / 2), `${count}: a lo ancho`).toBeLessThanOrEqual(1);
      expect(Math.abs(middle.y - canvas.height / 2), `${count}: a lo alto`).toBeLessThanOrEqual(1);
    }
    for (const layout of ['row', 'grid', 'fan'] as const) {
      const boxes = layoutBoxes(frame, 2, layout, [atTop]);
      const bounds = group(boxes.map(rotatedBounds));
      expect(bounds.y, layout).toBeGreaterThanOrEqual(gap.from - 2);
      // El mismo aire por encima que por debajo: centrada en el hueco libre.
      expect(Math.abs(centerOf(group(boxes)).y - (gap.from + gap.to) / 2), layout).toBeLessThanOrEqual(layout === 'fan' ? 40 : 1);
      expect(Math.abs(centerOf(bounds).x - canvas.width / 2), layout).toBeLessThanOrEqual(2);
    }
  });

  it('con textos arriba y abajo, el hueco de en medio; si el grupo llena el hueco, se queda centrado en él; sin hueco, el área entera', () => {
    const footer: Rect = { x: 108, y: 930, width: 864, height: 90 };
    const between = layoutBoxes(frame, 3, 'center', [atTop, footer]);
    for (const box of between) {
      expect(overlap(box, atTop) || overlap(box, footer)).toBe(false);
      expect(box.y).toBeGreaterThanOrEqual(atTop.y + atTop.height);
      expect(box.y + box.height).toBeLessThanOrEqual(footer.y);
    }
    // Lo ocupado puede venir en cualquier orden.
    expect(layoutBoxes(frame, 3, 'center', [footer, atTop])).toEqual(between);
    // Sin nada ocupado, como siempre; y lo que no cabe en ningún hueco, en el área entera.
    expect(layoutBoxes(frame, 2, 'row', [])).toEqual(layoutBoxes(frame, 2, 'row'));
    const crowded = [atTop, { x: 108, y: 300, width: 864, height: 150 }, { x: 108, y: 560, width: 864, height: 150 }, footer];
    expect(layoutBoxes(frame, 2, 'row', crowded)).toEqual(layoutBoxes(frame, 2, 'row'));
  });
});

describe('los textos que ya había dejan el centro a las fotos', () => {
  const base = createEmptyDocument({ aspectRatio: '1:1' });
  /** Un texto en negrita (de título) centrado en el lienzo; su identificador sale de lo que dice. */
  const idOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const text = (label: string, extra: Partial<TextLayer> = {}): TextLayer => ({
    ...newTextLayer(base.canvas, [], { fontFamily: 'Recoleta', color: '#FFFFFF' }),
    id: idOf(label),
    text: label,
    height: 120,
    y: 480,
    ...extra,
  });
  const page = (...layers: (TextLayer | ImageLayer | ReturnType<typeof newLogoLayer>)[]) => pageView(withPageLayers(base, 0, layers), 0);
  const places = (result: ReturnType<typeof clearCenter>) => result.moves.map((move) => [move.target, move.place!.y]);

  it('los de título suben al margen y los demás bajan, cada grupo en su orden y sin pisarse', () => {
    const result = clearCenter(
      page(
        text('Menú de otoño', { y: 400 }),
        text('Solo este mes', { y: 530, fontWeight: 600, height: 90 }),
        text('Reserva en el 600 000 000', { y: 630, fontWeight: 400, height: 80 }),
      ),
    );
    // Títulos (negrita) arriba: el primero al margen (5 % = 54) y el segundo debajo, con aire (2 % = 22).
    // El texto normal, abajo: pegado al margen inferior (1080 − 54 − 80).
    expect(places(result)).toEqual([
      [idOf('Menú de otoño'), 54],
      [idOf('Solo este mes'), 54 + 120 + 22],
      [idOf('Reserva en el 600 000 000'), 946],
    ]);
    expect(result.moves.map((move) => move.say)).toEqual([
      'He subido el título «Menú de otoño» para dejar el centro a las fotos',
      'He subido el título «Solo este mes» para dejar el centro a las fotos',
      'He bajado el texto «Reserva en el 600 000 000» para dejar el centro a las fotos',
    ]);
    // Solo cambia la altura.
    for (const move of result.moves) expect(move.place).toMatchObject({ x: 108, width: 864 });
    expect(result).toMatchObject({ locked: [], stuck: [] });
  });

  it('lo que no está en el tercio central, lo oculto, los logotipos y lo que la orden ya mueve se quedan como están', () => {
    const logo = { ...newLogoLayer(base.canvas, [], { id: OLD_PHOTO, name: 'logo.png' }), id: 'logo', y: 500 };
    const result = clearCenter(
      page(text('arriba', { y: 60 }), text('abajo', { y: 900 }), text('oculto', { visible: false }), text('lo mueve la orden'), logo),
      new Set([idOf('lo mueve la orden')]),
    );
    expect(result).toEqual({ moves: [], locked: [], stuck: [] });
  });

  it('un título no se pone encima de lo que ya hay arriba: va debajo; si no cabe fuera del centro, se queda y se dice', () => {
    const stacked = clearCenter(page(text('ya arriba', { y: 54 }), text('Menú de otoño')));
    expect(places(stacked)).toEqual([[idOf('Menú de otoño'), 54 + 120 + 22]]);
    // Con la franja de arriba llena, no hay dónde subirlo sin dejarlo en el centro.
    const full = clearCenter(page(text('uno', { y: 54 }), text('dos', { y: 200 }), text('Menú de otoño')));
    expect(full.moves).toEqual([]);
    expect(full.stuck).toEqual(['No hay sitio para apartar «Menú de otoño»: se queda donde está y las fotos van en el hueco que queda.']);
  });

  it('una capa bloqueada no se mueve, y se avisa', () => {
    const result = clearCenter(page(text('Menú de otoño', { locked: true }), text('Solo este mes', { y: 380, fontWeight: 600, height: 60 })));
    expect(places(result)).toEqual([[idOf('Solo este mes'), 54]]);
    expect(result.locked).toEqual(['El texto «Menú de otoño» está bloqueado y no se mueve: las fotos van en el hueco que queda.']);
  });
});

describe('el caso real del 23/11/2026: pieza 1:1 con un título blanco centrado, fondo generado claro y dos fotos «en el centro»', () => {
  const background: CopilotAssetInfo = { id: BACKGROUND, name: 'IA · fondo otoñal.png', width: 1024, height: 1024 };
  const cuts = [photo(1, 'solomillo (sin fondo).png'), photo(2, 'entrecot (sin fondo).png')];
  const CANVAS: Rect = { x: 0, y: 0, width: 1080, height: 1080 };
  /** El fondo otoñal que salió: claro. Medido como en el editor (píxeles → tono medio y por zonas). */
  const light = measureTone(pixels(16, 16, () => [236, 222, 196]), 16, 16)!;
  const measured = { imageTones: new Map([[BACKGROUND, light.mean]]), imageZones: new Map([[BACKGROUND, light.grid]]) };

  function start(extra: Partial<TextLayer> = {}): ContentDocument {
    const base = createEmptyDocument({ aspectRatio: '1:1' });
    const title: TextLayer = { ...newTextLayer(base.canvas, [], { fontFamily: 'Recoleta', color: '#FFFFFF' }), id: 'titulo', text: 'Menú de otoño', ...extra };
    return withPageLayers(base, 0, [title]);
  }
  /** «…crea un fondo que parezca otoñal y pon dos platos de carne en el centro»: el modelo mandó `cutout: false`. */
  const order = (layout: 'center' | 'row') => [
    op({ op: 'generate_background', prompt: 'Mesa de madera clara con hojas secas de otoño', ratio: '1:1' }),
    op({ op: 'find_photos', query: 'platos de carne', count: 2 }),
    op({ op: 'place_photos', layout, cutout: false, on: true }),
  ];
  function run(document: ContentDocument, layout: 'center' | 'row', tones: Partial<CopilotApplyContext> = measured) {
    const plan = buildPlan(order(layout), { ...ENV, canvasRatio: '1:1' });
    const ctx = { ...context([background, ...cuts]), ...tones };
    const composed = composePlan(plan, { background, photos: cuts }, document, ctx);
    const result = applyCopilotOperations(document, composed.operations, ctx);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const layers = pageView(result.document, result.pageIndex).layers;
    const title = layers.find((layer): layer is TextLayer => layer.id === 'titulo')!;
    const [back, ...placed] = layers.filter((layer): layer is ImageLayer => layer.type === 'image');
    return { plan, composed, result, layers, title, back: back!, placed };
  }
  const bounds = (layers: Rect[]): Rect => {
    const x = Math.min(...layers.map((layer) => layer.x));
    const y = Math.min(...layers.map((layer) => layer.y));
    return { x, y, width: Math.max(...layers.map((layer) => layer.x + layer.width)) - x, height: Math.max(...layers.map((layer) => layer.y + layer.height)) - y };
  };

  it('las fotos van recortadas y al centro, el título sube y cambia a un color que se lee; todo en UN paso de deshacer', () => {
    const document = start();
    const before = pageView(document, 0).layers[0] as TextLayer;
    // Como estaba: blanco, centrado en el lienzo.
    expect(before.y + before.height / 2).toBe(540);
    const { plan, composed, result, layers, title, back, placed } = run(document, 'center');

    // Defecto 1: recortadas por defecto (el modelo dijo que no).
    expect(plan.placement).toMatchObject({ cutout: true });

    expect(composed.operations.map((operation) => operation.op)).toEqual(['move_layer', 'set_background_image', 'add_image', 'add_image']);
    expect(composed.notes).toEqual([]);
    expect(validateDocument(result.document).ok).toBe(true);
    expect(layers.map((layer) => layer.type)).toEqual(['image', 'image', 'image', 'text']);
    expect(result.changes).toEqual([
      'He subido el título «Menú de otoño» para dejar el centro a las fotos',
      'Foto de fondo «IA · fondo otoñal.png»',
      expect.stringMatching(/^Texto «Menú de otoño» en #[0-9A-F]{6} para que se lea sobre el fondo$/),
      'Foto «solomillo (sin fondo).png» añadida encima',
      'Foto «entrecot (sin fondo).png» añadida encima',
    ]);

    // Defecto 2 (b): el título, arriba y con margen; mismo ancho y misma letra.
    expect(title).toMatchObject({ x: before.x, y: 54, width: before.width, height: before.height, fontSize: before.fontSize });
    // Defecto 2 (a): ya no es blanco; se lee sobre el tono MEDIDO de la zona del fondo que tiene debajo.
    expect(title.color).not.toBe('#FFFFFF');
    const under = toneUnder(light.grid, back, title)!;
    expect(contrastOf('#FFFFFF', under)).toBeLessThan(1.5);
    expect(contrastOf(title.color, under)).toBeGreaterThanOrEqual(4.5);
    // Es el color de la marca para títulos (el principal), que sobre ese fondo se lee.
    expect(title.color).toBe('#1F3A5F');

    // Defecto 2 (b) y (c): las dos fotos, agrupadas en el centro del lienzo, sin pisar el título ni salirse.
    expect(placed.map((layer) => (layer.source.kind === 'asset' ? layer.source.assetId : ''))).toEqual(cuts.map((cut) => cut.id));
    for (const layer of placed) {
      expect(inside(layer, CANVAS)).toBe(true);
      expect(overlap(layer, title), `${layer.name} pisa el título`).toBe(false);
      expect(layer).toMatchObject({ fit: 'contain', shadow: DEFAULT_SHADOW });
    }
    const middle = bounds(placed);
    expect(Math.abs(middle.x + middle.width / 2 - 540)).toBeLessThanOrEqual(2);
    expect(Math.abs(middle.y + middle.height / 2 - 540)).toBeLessThanOrEqual(2);
    expect(placed[0]!.y).toBe(placed[1]!.y);

    // Un solo cambio en el editor; un «deshacer» lo quita todo, también el título movido y recoloreado.
    const editor = editorReducer(initEditor(document), { type: 'replace', document: result.document, select: result.touched });
    const undone = editorReducer(editor, { type: 'undo' });
    expect(undone.document).toEqual(document);
    expect(editorReducer(undone, { type: 'undo' })).toBe(undone);
  });

  it('si el modelo manda «en fila», la fila queda centrada en el hueco libre, no en el tercio inferior', () => {
    const { title, placed, result } = run(start(), 'row');
    expect(title.y).toBe(54);
    expect(result.changes[0]).toBe('He subido el título «Menú de otoño» para dejar el centro a las fotos');
    const row = bounds(placed);
    const gap = { from: title.y + title.height, to: 1080 - 54 };
    // El mismo aire por encima (hasta el título) que por debajo (hasta el margen), a un par de píxeles.
    expect(Math.abs(row.y - gap.from - (gap.to - (row.y + row.height)))).toBeLessThanOrEqual(24);
    // Antes: la fila caía entera por debajo del título centrado, en el tercio inferior del lienzo.
    expect(row.y).toBeLessThan(540);
    expect(row.y + row.height / 2).toBeLessThan(720);
    expect(Math.abs(row.x + row.width / 2 - 540)).toBeLessThanOrEqual(2);
    for (const layer of placed) expect(overlap(layer, title)).toBe(false);
  });

  it('sin tono medido se suponía una foto oscura y el título blanco no se tocaba: por eso no se leía', () => {
    // Lo de antes, tal cual: el mismo plan sin `imageTones`. El blanco «pasa» contra el gris supuesto.
    const { title, result } = run(start(), 'center', {});
    expect(title.color).toBe('#FFFFFF');
    expect(result.changes.some((change) => change.includes('para que se lea'))).toBe(false);
    expect(contrastOf('#FFFFFF', light.mean)).toBeLessThan(1.5);
  });

  it('si el tono del fondo no se puede medir, no se adivina: el título conserva su color y lleva un contorno; y se dice', () => {
    const { title, result, composed } = run(start(), 'center', { unmeasuredImages: new Set([BACKGROUND]) });
    expect(title).toMatchObject({ y: 54, color: '#FFFFFF', outline: { color: '#000000', width: Math.max(2, Math.round(title.fontSize * 0.06)) } });
    expect(result.changes).toEqual([
      'He subido el título «Menú de otoño» para dejar el centro a las fotos',
      'Foto de fondo «IA · fondo otoñal.png»',
      'Foto «solomillo (sin fondo).png» añadida encima',
      'Foto «entrecot (sin fondo).png» añadida encima',
      'Texto «Menú de otoño» con contorno: no he podido medir el tono del fondo nuevo y así se lee sobre cualquiera',
    ]);
    // El contorno negro se lee donde el blanco no, y al revés: vale para cualquier fondo.
    expect(contrastOf(title.outline!.color, light.mean)).toBeGreaterThan(10);
    // También lo llevan los textos que añade la propia orden; los que ya llevan contorno o etiqueta, no se tocan.
    const plan = buildPlan([...order('center'), op({ op: 'add_text', text: 'Solo este mes', style: 'subtitle', position: 'bottom' })], { ...ENV, canvasRatio: '1:1' });
    const ctx = { ...context([background, ...cuts]), unmeasuredImages: new Set([BACKGROUND]) };
    const labelled = start({ background: { color: '#000000', opacity: 1, padding: 16, radius: 0 } });
    const again = applyCopilotOperations(labelled, composePlan(plan, { background, photos: cuts }, labelled, ctx).operations, ctx);
    if (!again.ok) throw new Error('no válido');
    const texts = pageView(again.document, 0).layers.filter((layer): layer is TextLayer => layer.type === 'text');
    expect(texts.find((layer) => layer.id === 'titulo')!.outline).toBeUndefined();
    expect(texts.find((layer) => layer.text === 'Solo este mes')!.outline).toBeDefined();
    expect(composed.notes).toEqual([]);
  });

  it('un título bloqueado no se mueve ni se recolorea: las fotos van en el hueco que queda, sin pisarlo, y se avisa', () => {
    const document = start({ locked: true });
    const { composed, title, placed, result } = run(document, 'center');
    expect(composed.operations.map((operation) => operation.op)).toEqual(['set_background_image', 'add_image', 'add_image']);
    expect(composed.notes).toEqual(['El texto «Menú de otoño» está bloqueado y no se mueve: las fotos van en el hueco que queda.']);
    expect(title).toEqual(pageView(document, 0).layers[0]);
    expect(placed).toHaveLength(2);
    for (const layer of placed) {
      expect(inside(layer, CANVAS)).toBe(true);
      expect(overlap(layer, title)).toBe(false);
    }
    expect(result.skipped).toEqual([]);
  });

  it('un fondo oscuro arriba y claro abajo: el título, ya arriba, se queda blanco; el pie claro de abajo pasa a oscuro', () => {
    const split = measureTone(pixels(16, 16, (_x, y) => (y < 8 ? [24, 20, 18] : [236, 222, 196])), 16, 16)!;
    const base = start();
    const footer: TextLayer = { ...newTextLayer(base.canvas, [], { fontFamily: 'Inter', color: '#FFFFFF' }), id: 'pie', text: 'Reserva ya', fontWeight: 400, y: 930, height: 90 };
    const document = withPageLayers(base, 0, [...base.pages[0]!.layers, footer]);
    const { layers, title, result } = run(document, 'center', { imageTones: new Map([[BACKGROUND, split.mean]]), imageZones: new Map([[BACKGROUND, split.grid]]) });
    expect(title).toMatchObject({ y: 54, color: '#FFFFFF' });
    const moved = layers.find((layer): layer is TextLayer => layer.id === 'pie')!;
    expect(moved.y).toBe(930);
    expect(moved.color).toBe('#2B2B2B');
    expect(result.changes).toContain('Texto «Reserva ya» en #2B2B2B para que se lea sobre el fondo');
  });

  it('solo se aparta un texto si con ello el hueco de las fotos crece; y lo que la orden ya mueve, va donde ella dice', () => {
    // Con un fondo de color (sin IA de imagen) también se revisa el título contra el fondo nuevo.
    const plan = buildPlan(order('center'), { ...NO_IMAGE_AI, canvasRatio: '1:1' });
    const ctx = context(cuts);
    const document = start();
    const composed = composePlan(plan, { background: null, photos: cuts }, document, ctx);
    expect(composed.operations.map((operation) => operation.op)).toEqual(['move_layer', 'set_background_color', 'add_image', 'add_image']);
    const result = applyCopilotOperations(document, composed.operations, ctx);
    if (!result.ok) throw new Error('no válido');
    expect(result.changes).toEqual([
      'He subido el título «Menú de otoño» para dejar el centro a las fotos',
      'Color de fondo #F5EBDD',
      'Texto «Menú de otoño» en #1F3A5F para que se lea sobre el fondo',
      'Foto «solomillo (sin fondo).png» añadida encima',
      'Foto «entrecot (sin fondo).png» añadida encima',
    ]);
    // La orden ya dice dónde va el título: no se le lleva la contraria.
    const own = buildPlan([...order('center'), op({ op: 'move_layer', target: 'titulo', position: 'bottom' })], { ...ENV, canvasRatio: '1:1' });
    const moved = composePlan(own, { background, photos: cuts }, document, context([background, ...cuts]));
    expect(moved.operations.filter((operation) => operation.op === 'move_layer')).toHaveLength(1);
    expect(moved.operations.find((operation) => operation.op === 'move_layer')).toMatchObject({ position: 'bottom' });
    // Sin fotos que colocar, nada se mueve.
    const none = composePlan(buildPlan(order('center'), { ...ENV, canvasRatio: '1:1' }), { background, photos: [] }, document, context([background]));
    expect(none.operations.map((operation) => operation.op)).toEqual(['set_background_image']);
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
