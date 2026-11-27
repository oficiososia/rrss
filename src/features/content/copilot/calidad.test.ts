// Arreglos de la prueba real en staging del 23/11/2026 (fallos 6 y 7, docs/copiloto-voz.md §16), en
// funciones puras: la nota de la IA, lo que pide la orden, el titular con los colores de la marca, la foto
// que llena el lienzo, el recorte que no queda diminuto y la búsqueda por intención.
import { describe, expect, it } from 'vitest';
import { createEmptyDocument, withPageLayers, type ImageLayer } from '../document';
import { newImageLayer } from '../editor/layers';
import { applyCopilotOperations, capitalizeFirst, headingLook, type CopilotApplyContext } from './apply';
import { alignWithOrder, asksForBackground, occasionHeadline, trustedNotes, wantsFullBleed } from './intent';
import { contrastOf } from './legibility';
import { copilotOp } from './operations';
import { buildPlan, composePlan, matchLibraryPhotos, setPlanAiBackground, type LibraryPhoto, type PlanEnvironment } from './plan';
import { subjectBounds } from './subject';

const PALETTE = [
  { hex: '#1F3A5F', role: 'principal' },
  { hex: '#F5EBDD', role: 'fondo' },
  { hex: '#E0A526', role: 'acento' },
];
const ENV: PlanEnvironment = { canvasRatio: '4:5', imageAi: { available: true }, palette: PALETTE, canCutout: true };

describe('la nota de la IA', () => {
  it('nunca enseña lo que dice haber hecho; sí lo que no se puede, lo que falta y las preguntas', () => {
    expect(trustedNotes('Añadí el título «Ven a disfrutar este finde». El copiloto no redacta.')).toEqual(['El copiloto no redacta.']);
    expect(trustedNotes('La foto ahora llena el lienzo.')).toEqual([]);
    expect(trustedNotes('He puesto el título arriba y he subido la foto.')).toEqual([]);
    expect(trustedNotes('Listo.')).toEqual([]);
    expect(trustedNotes('¿Qué texto quieres de título?')).toEqual(['¿Qué texto quieres de título?']);
    expect(trustedNotes('No puedo publicar desde el editor.')).toEqual(['No puedo publicar desde el editor.']);
    expect(trustedNotes('Dime el texto del título.')).toEqual(['Dime el texto del título.']);
    expect(trustedNotes('No he podido mover el logotipo: está bloqueado.')).toEqual(['No he podido mover el logotipo: está bloqueado.']);
    expect(trustedNotes('')).toEqual([]);
    expect(trustedNotes(null)).toEqual([]);
  });
});

describe('lo que pide la orden', () => {
  it('un fondo, solo si se nombra («al fondo» es el orden de las capas)', () => {
    expect(asksForBackground('crea un fondo que parezca otoñal')).toBe(true);
    expect(asksForBackground('con un fondo de mármol')).toBe(true);
    expect(asksForBackground('hazme algo para el finde que quede bonito')).toBe(false);
    expect(asksForBackground('hazme algo con una foto del gym, con título: sin excusas')).toBe(false);
    expect(asksForBackground('llévalo al fondo')).toBe(false);
  });

  it('«que la foto llene todo» pide el lienzo entero: un `cover` de la IA pasa a `canvas`', () => {
    expect(wantsFullBleed('que la foto llene todo y el título abajo')).toBe(true);
    expect(wantsFullBleed('foto a sangre')).toBe(true);
    expect(wantsFullBleed('sin márgenes')).toBe(true);
    expect(wantsFullBleed('pon la foto entera')).toBe(false);
    const cover = copilotOp({ op: 'transform_image', fit: 'cover' });
    expect(alignWithOrder([cover], 'que la foto llene todo')[0]!.fit).toBe('canvas');
    expect(alignWithOrder([cover], 'que la foto llene su caja')[0]!.fit).toBe('cover');
  });

  it('el titular de la ocasión, solo si la orden la nombra', () => {
    expect(occasionHeadline('hazme algo para el finde que quede bonito')).toBe('Este finde');
    expect(occasionHeadline('algo para el fin de semana')).toBe('Este finde');
    expect(occasionHeadline('que motive a venir esta semana')).toBe('Esta semana');
    expect(occasionHeadline('pon una foto bonita')).toBeNull();
  });
});

describe('titulares con los colores de la marca', () => {
  it('mayúscula inicial, saltando los signos de apertura', () => {
    expect(capitalizeFirst('este finde, ven a Casa')).toBe('Este finde, ven a Casa');
    expect(capitalizeFirst('¡sin excusas!')).toBe('¡Sin excusas!');
    expect(capitalizeFirst('«menú» de otoño')).toBe('«Menú» de otoño');
    expect(capitalizeFirst('Ya va')).toBe('Ya va');
  });

  it('un color de la marca que se lea; si ninguno se lee, el de la marca de etiqueta y el texto que contraste con él', () => {
    const white = { hex: '#FFFFFF', kind: 'color', required: 3 } as const;
    expect(headingLook(PALETTE, white, null)).toEqual({ color: '#1F3A5F' });
    // Sobre un gris medio con 4,5:1 exigido ningún color de esta marca llega: etiqueta del principal.
    const onlyAccent = [{ hex: '#E0A526', role: 'principal' }];
    const grey = { hex: '#8A8A8A', kind: 'photo', required: 4.5 } as const;
    const look = headingLook(onlyAccent, grey, null);
    expect(look.label).toBe('#E0A526');
    expect(contrastOf(look.color, look.label!)).toBeGreaterThanOrEqual(4.5);
    // Un color pedido que no se lee: va de etiqueta, no se pierde.
    expect(headingLook(PALETTE, { hex: '#1F3A5F', kind: 'color', required: 3 }, '#1F3A5F').label).toBe('#1F3A5F');
  });

  it('un titular dictado en minúscula entra con mayúscula, la tipografía de la marca y un color de la marca', () => {
    const document = createEmptyDocument({ aspectRatio: '1:1', backgroundColor: '#FFFFFF' });
    const context: CopilotApplyContext = { brand: { palette: PALETTE, fonts: ['Recoleta', 'Inter'] }, assets: new Map(), logoIds: [] };
    const result = applyCopilotOperations(document, [copilotOp({ op: 'add_text', text: 'este finde, ven a vernos', style: 'title' })], context);
    if (!result.ok) throw new Error('no válido');
    const title = result.document.pages[0]!.layers[0]!;
    expect(title).toMatchObject({ type: 'text', text: 'Este finde, ven a vernos', fontFamily: 'Recoleta', color: '#1F3A5F' });
  });
});

describe('la foto que llena el lienzo', () => {
  it('`fit: canvas` lleva la foto de borde a borde, al fondo y en «llenar»', () => {
    const empty = createEmptyDocument({ aspectRatio: '1:1' });
    const dish: ImageLayer = { ...newImageLayer(empty.canvas, [], { id: '11111111-1111-4111-8111-111111111111', name: 'plato.jpg' }), id: 'foto', x: 108, y: 108, width: 864, height: 864, fit: 'contain' };
    const document = withPageLayers(empty, 0, [dish]);
    const context: CopilotApplyContext = { brand: { palette: PALETTE, fonts: [] }, assets: new Map(), logoIds: [] };
    const result = applyCopilotOperations(document, [copilotOp({ op: 'transform_image', target: 'foto', fit: 'canvas' })], context);
    if (!result.ok) throw new Error('no válido');
    expect(result.document.pages[0]!.layers[0]).toMatchObject({ x: 0, y: 0, width: 1080, height: 1080, fit: 'cover' });
    expect(result.changes[0]).toMatch(/llenando todo el lienzo, de borde a borde/);
  });
});

describe('el recorte no queda diminuto', () => {
  it('la caja de lo opaco, con un poco de aire; nada si ya ocupa casi todo', () => {
    const size = 100;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 40; y < 60; y += 1) for (let x = 30; x < 50; x += 1) pixels[(y * size + x) * 4 + 3] = 255;
    const box = subjectBounds(pixels, size, size)!;
    expect(box.x).toBeCloseTo(0.292, 2);
    expect(box.width).toBeCloseTo(0.216, 2);
    expect(subjectBounds(new Uint8ClampedArray(size * size * 4).fill(255), size, size)).toBeNull();
    expect(subjectBounds(new Uint8ClampedArray(size * size * 4), size, size)).toBeNull();
  });

  it('el plan coloca solo esa zona (`crop`) y la caja llena su sitio', () => {
    const photo = { id: '22222222-2222-4222-8222-222222222222', name: 'banco (sin fondo).png', width: 1000, height: 1000 };
    const plan = buildPlan([copilotOp({ op: 'place_photos', layout: 'center', cutout: true })], { ...ENV, backgroundImage: true });
    const document = createEmptyDocument({ aspectRatio: '1:1' });
    const context: CopilotApplyContext = { brand: { palette: PALETTE, fonts: [] }, assets: new Map([[photo.id, photo]]), logoIds: [] };
    const subject = { x: 0.3, y: 0.4, width: 0.2, height: 0.2 };
    const { operations } = composePlan(plan, { background: null, photos: [photo], subjects: new Map([[photo.id, subject]]) }, document, context);
    const result = applyCopilotOperations(document, operations, context);
    if (!result.ok) throw new Error('no válido');
    const placed = result.document.pages[0]!.layers.find((layer) => layer.type === 'image') as ImageLayer;
    expect(placed.crop).toEqual(subject);
    expect(placed.width).toBeGreaterThan(1080 * 0.5);
  });
});

describe('una pieza «bonita» sin pedir un fondo', () => {
  const STAGING = [
    copilotOp({ op: 'generate_background', prompt: 'Gimnasio oscuro con luces rojas' }),
    copilotOp({ op: 'find_photos', query: 'gym', count: 1 }),
    copilotOp({ op: 'place_photos', layout: 'center', cutout: true }),
    copilotOp({ op: 'add_text', text: 'sin excusas', style: 'title' }),
  ];

  it('foto real a sangre, sin gasto; el fondo con IA queda como opción; y la llamada de la marca', () => {
    const plan = buildPlan(STAGING, { ...ENV, transcript: 'hazme algo con una foto del gym que motive a venir esta semana, con título: sin excusas', pageHasTexts: false, callToAction: 'Apúntate en recepción' });
    expect(plan.background).toBeNull();
    expect(plan.placement).toMatchObject({ layout: 'fill', cutout: false });
    expect(plan.wanted).toBe(1);
    expect(plan.aiAlternative).toMatchObject({ prompt: 'Gimnasio oscuro con luces rojas', active: false });
    const texts = plan.sequence.flatMap((item) => (item.kind === 'operation' ? [item.operation.text] : []));
    // El titular es el dictado (no se propone otro) y se añade la llamada del perfil.
    expect(texts).toEqual(['sin excusas', 'Apúntate en recepción']);
    const ai = setPlanAiBackground(plan, true);
    expect(ai.background).toMatchObject({ mode: 'ai' });
    expect(ai.placement).toMatchObject({ layout: 'center', cutout: true });
    expect(setPlanAiBackground(ai, false).placement).toMatchObject({ layout: 'fill' });
  });

  it('sin la orden (como antes) el fondo con IA sigue siendo el del plan', () => {
    expect(buildPlan(STAGING, ENV).background).toMatchObject({ mode: 'ai' });
  });

  it('sin IA de imagen no se ofrece el fondo con IA, pero la foto real va igual', () => {
    const plan = buildPlan(STAGING, { ...ENV, imageAi: { available: false, reason: 'Sin IA de imagen.' }, transcript: 'hazme algo con una foto del gym' });
    expect(plan.aiAlternative).toBeUndefined();
    expect(plan.placement?.layout).toBe('fill');
  });
});

describe('buscar por intención, nunca diseños', () => {
  const row = (n: number, name: string, extra: Partial<LibraryPhoto> = {}): LibraryPhoto => ({ id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`, name, ...extra });
  const LIBRARY = [
    row(1, 'Arroz de rape · plato de la semana.png', { folder: 'Exportaciones', tags: ['plato'], provenance: { type: 'export' } }),
    row(2, 'Portada reel.jpg', { tags: ['plato'], provenance: { role: 'cover' } }),
    row(3, 'Arroz meloso de langosta.jpg', { folder: 'Carta / Arroces' }),
    row(4, 'Chuletón.jpg', { folder: 'Carta / Carnes' }),
    row(5, 'Salmón.jpg', { folder: 'Carta' }),
    row(6, 'Banco de press.jpg', { folder: 'Sala' }),
  ];
  const names = (query: string, count = 6) => matchLibraryPhotos(LIBRARY, query, count).map((photo) => photo.name);

  it('«un plato nuestro» busca platos por carpetas y nunca devuelve exportaciones ni portadas', () => {
    const found = names('plato nuestro');
    expect(found).not.toContain('Arroz de rape · plato de la semana.png');
    expect(found).not.toContain('Portada reel.jpg');
    expect(found).toEqual(expect.arrayContaining(['Arroz meloso de langosta.jpg', 'Chuletón.jpg']));
  });

  it('«carnes» trae el chuletón; «gym», la sala; «sala» no casa con «salmón» por familia', () => {
    expect(names('carnes')).toEqual(['Chuletón.jpg']);
    expect(names('gym')).toEqual(['Banco de press.jpg']);
    expect(names('gym')).not.toContain('Salmón.jpg');
  });

  it('una palabra concreta no se amplía: «hamburguesas» no trae cualquier plato', () => {
    expect(names('hamburguesas')).toEqual([]);
  });
});
