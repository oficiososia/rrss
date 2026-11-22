// Banco de pruebas del copiloto del editor (scripts/copiloto-banco.ts): que los
// casos son los pedidos, que el modo en seco pasa entero por las dos rutas, que
// la comparación detecta los fallos, que los agregados calculan bien y que el
// modo real se niega sin sesión y no enseña nunca el token.
//
// Ninguna prueba llama a ningún servicio: el modo real se ejecuta con un `fetch`
// de mentira. Vive en tests/db porque es el proyecto de Vitest que corre en
// Node; no usa la base de datos.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  aggregateResults,
  applyProblems,
  BENCH_CASES,
  BENCH_MODES,
  checkLocal,
  compareOperations,
  dryRun,
  dryRunCase,
  encodeWav,
  evaluateResponse,
  fitsJsonRoute,
  formatAggregates,
  formatDryReport,
  main,
  parseArgs,
  parseWav,
  percentile,
  planProblemsFor,
  readAudioEntries,
  readOutput,
  readRealConfig,
  REAL_ENV,
  redactor,
  resample,
  runReal,
  simulateServer,
  splitSamples,
  type BenchResult,
  type RealDeps,
  type RealOptions,
} from '../../scripts/copiloto-banco.ts';
import {
  BASE_GROUPS,
  BENCH_DOCUMENTS,
  BENCH_GROUPS,
  BENCH_LIBRARIES,
  PLAN_CASES,
  type BenchCase,
  type ExpectedOperation,
} from '../../scripts/copiloto-banco/casos.ts';
import { copilotOp, isDictated } from '../../src/features/content/copilot/operations';
import { isAiGenerated, matchLibraryPhotos, namesFoodOrProduct } from '../../src/features/content/copilot/plan';
import type { CopilotMode } from '../../supabase/functions/_shared/ai/text/tasks/editor-copilot.ts';

const byId = (id: string): BenchCase => {
  const found = BENCH_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`No existe el caso ${id}`);
  return found;
};

const folders: string[] = [];
const tempFolder = () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'banco-prueba-'));
  folders.push(folder);
  return folder;
};
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe('casos del banco', () => {
  it('hay al menos 40 órdenes base y 15 de habla titubeante, con todos los grupos pedidos', () => {
    const count = (group: string) => BENCH_CASES.filter((item) => item.group === group).length;
    const base = BENCH_CASES.filter((item) => BASE_GROUPS.includes(item.group));
    expect(base.length).toBeGreaterThanOrEqual(40);
    expect(count('titubeo')).toBeGreaterThanOrEqual(15);
    for (const group of ['simple', 'compuesta', 'ambigua', 'imposible', 'hosteleria', 'gimnasio']) {
      expect(count(group), group).toBeGreaterThanOrEqual(5);
    }
    // Identificadores únicos y documentos de partida que existen (los cuatro se usan).
    expect(new Set(BENCH_CASES.map((item) => item.id)).size).toBe(BENCH_CASES.length);
    expect(new Set(BENCH_CASES.map((item) => item.document))).toEqual(new Set(Object.keys(BENCH_DOCUMENTS)));
    expect(BENCH_DOCUMENTS.seleccion.selectedIds).toEqual(['titulo']);
    expect(BENCH_DOCUMENTS.carrusel.document.pages).toHaveLength(3);
    expect(BENCH_DOCUMENTS.vacio.document.pages[0]!.layers).toEqual([]);
    // Órdenes que montan una pieza: entre 5 y 8, todas con su plan esperado.
    expect(BENCH_GROUPS).toContain('plan');
    expect(count('plan')).toBe(PLAN_CASES.length);
    expect(PLAN_CASES.length).toBeGreaterThanOrEqual(5);
    expect(PLAN_CASES.length).toBeLessThanOrEqual(8);
  });

  it('los casos de plan montan una pieza: hostelería, gimnasio y genérica, uno titubeante, uno sin fotos y uno que pide generar comida', () => {
    for (const item of PLAN_CASES) {
      expect(item.plan, item.id).toBeDefined();
      // Van a la IA y solo por herramientas: ni el intérprete local ni la ruta JSON saben de planes.
      expect(item, item.id).toMatchObject({ group: 'plan', local: false, json: false });
      expect(BENCH_LIBRARIES[item.plan!.library], item.id).toBeDefined();
      const ops = item.expected.map((expected) => expected.op);
      // Las fotos salen siempre de la biblioteca: se buscan y se colocan; nunca se generan.
      expect(ops, item.id).toContain('find_photos');
      expect(ops, item.id).toContain('place_photos');
      expect(ops.filter((op) => op === 'generate_background').length, item.id).toBe(item.plan!.background ? 1 : 0);
      // Lo que respondería un modelo que acierta no nombra comida ni productos en el fondo.
      for (const expected of item.expected.filter((operation) => operation.op === 'generate_background')) {
        const prompt = (expected.prompt as { background: string }).background;
        expect(prompt.length, item.id).toBeGreaterThan(10);
        expect(namesFoodOrProduct(prompt), `${item.id}: ${prompt}`).toBe(false);
      }
    }
    const of = (library: string) => PLAN_CASES.filter((item) => item.plan!.library === library);
    expect(of('hosteleria').length).toBeGreaterThanOrEqual(2);
    expect(of('gimnasio').length).toBeGreaterThanOrEqual(1);
    expect(of('generica').length).toBeGreaterThanOrEqual(1);
    // Sin fotos en la biblioteca: no se coloca ninguna.
    expect(of('vacia').map((item) => item.plan!.photos)).toEqual([0]);
    // Habla titubeante, con corrección: cuenta la intención final («no, mejor en fila»).
    const hesitant = PLAN_CASES.filter((item) => /…|\beh\b/i.test(item.order) && /\bno\b.*mejor/i.test(item.order));
    expect(hesitant).toHaveLength(1);
    expect(hesitant[0]!.expected.find((expected) => expected.op === 'place_photos')).toMatchObject({ layout: 'row' });
    // «Genera un plato…»: nada que generar, se dice, y el plato sale de la biblioteca.
    const food = PLAN_CASES.filter((item) => /genera\b.*\bplato/i.test(item.order));
    expect(food).toHaveLength(1);
    expect(food[0]).toMatchObject({ note: true, plan: { background: false, photos: 1 } });
    // Las cuatro disposiciones y algún titular.
    const layouts = PLAN_CASES.map((item) => item.expected.find((expected) => expected.op === 'place_photos')!.layout);
    expect(new Set(layouts)).toEqual(new Set(['center', 'row', 'grid', 'fan']));
    expect(PLAN_CASES.filter((item) => item.expected.some((expected) => expected.op === 'add_text' && expected.style === 'title')).length).toBeGreaterThanOrEqual(4);
    // En cada biblioteca con fotos hay una imagen generada con IA que casa con lo buscado: nunca debe salir.
    for (const [name, photos] of Object.entries(BENCH_LIBRARIES)) {
      if (photos.length > 0) expect(photos.filter((photo) => isAiGenerated(photo)), name).toHaveLength(1);
    }
  });

  it('cada grupo es lo que dice ser', () => {
    const of = (group: string) => BENCH_CASES.filter((item) => item.group === group);
    // Compuestas: más de una operación. Ambiguas: nada que hacer y una pregunta.
    for (const item of of('compuesta')) expect(item.expected.length, item.id).toBeGreaterThan(1);
    for (const item of of('ambigua')) expect(item, item.id).toMatchObject({ expected: [], note: true });
    // Imposibles: se espera que se diga, y nunca hay una operación que publique, apruebe o genere.
    for (const item of of('imposible')) {
      expect(item.note, item.id).toBe(true);
      expect(item.order).toMatch(/publica|genera|ignora|programa|instrucciones|aprueba|escribe tú/i);
    }
    expect(of('imposible').some((item) => item.expected.length > 0)).toBe(true);
    // Jerga de cada sector.
    const words = (group: string) => of(group).map((item) => item.order).join(' ').toLowerCase();
    for (const word of ['menú del día', 'raciones', '2x1 en cañas', 'terraza']) expect(words('hosteleria')).toContain(word);
    for (const word of ['wod', 'clase de spinning a las 19:00', 'tarifa plana', 'reto de 30 días']) expect(words('gimnasio')).toContain(word);
    // Titubeos: muletillas, pausas o correcciones en lo dicho.
    for (const item of of('titubeo')) expect(item.order, item.id).toMatch(/…|\beh\b|mmm|\bno\b|a ver|vale|pues/i);
    expect(of('titubeo').filter((item) => /\bno\b|digo|mejor|perdón/i.test(item.order)).length).toBeGreaterThanOrEqual(8);
  });

  it('los textos esperados están dictados en su orden y `json` solo se dice de lo que la ruta JSON tiene', () => {
    for (const item of BENCH_CASES) {
      for (const expected of item.expected) {
        if (typeof expected.text === 'string') expect(isDictated(expected.text, item.order), `${item.id}: ${expected.text}`).toBe(true);
      }
      if (item.json) expect(fitsJsonRoute(item), item.id).toBe(true);
      // Lo que resuelve el intérprete local son operaciones nuevas: la ruta JSON no las tiene.
      if (item.local) expect(item.json, item.id).toBe(false);
    }
    expect(BENCH_CASES.filter((item) => item.local).length).toBeGreaterThanOrEqual(8);
    expect(BENCH_CASES.filter((item) => !item.json).length).toBeGreaterThanOrEqual(20);
  });
});

describe('modo en seco', () => {
  it('pasa entero por las dos rutas: intérprete local, servidor y editor, sin nada descartado', async () => {
    const report = await dryRun();
    const failures = report.results.filter((result) => !result.ok);
    expect(failures.map((failure) => `${failure.caseId} [${failure.mode}]: ${failure.problems.join(' | ')}`)).toEqual([]);
    expect(report.ok).toBe(true);
    // Tres comprobaciones por caso: intérprete local, herramientas y JSON.
    expect(report.results).toHaveLength(BENCH_CASES.length * 3);
    const of = (mode: string) => report.results.filter((result) => result.mode === mode);
    // Por herramientas se expresan TODOS; por JSON, solo los que caben.
    expect(of('tools').every((result) => result.tokens !== undefined && !result.notExpressible)).toBe(true);
    expect(of('json').filter((result) => result.notExpressible).map((result) => result.caseId)).toEqual(
      BENCH_CASES.filter((item) => !item.json).map((item) => item.id),
    );
    // La parte que cambia en cada petición es menor por herramientas, caso a caso.
    for (const json of of('json').filter((result) => result.tokens)) {
      const tools = of('tools').find((result) => result.caseId === json.caseId)!;
      expect(tools.tokens!.volatile, json.caseId).toBeLessThan(json.tokens!.volatile);
      expect(tools.tokens!.volatile, json.caseId).toBeLessThan(200);
    }
    // Lo estable de la ruta de herramientas es idéntico en todos los casos (se lee de caché).
    expect(new Set(of('tools').map((result) => result.tokens!.stable)).size).toBe(1);

    const text = formatDryReport(report);
    expect(text).toContain(`los ${BENCH_CASES.length} casos cuadran de principio a fin`);
    expect(text).toMatch(new RegExp(`^plan\\s+${PLAN_CASES.length}\\s+0\\s+${PLAN_CASES.length}$`, 'm'));
    expect(text).toContain(`Planes (órdenes que montan una pieza): ${PLAN_CASES.length} casos.`);
    expect(text).toContain('el banco no genera imágenes ni recorta');
    expect(text).toMatch(/^tools\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+$/m);
    expect(text).toContain(`La ruta JSON no puede expresar ${BENCH_CASES.filter((item) => !item.json).length} casos`);
    console.info(text);
  });

  it('lo que el caso dice que resuelve el intérprete local, lo resuelve sin IA; lo demás va al modelo', () => {
    for (const item of BENCH_CASES) expect(checkLocal(item).problems, item.id).toEqual([]);
    // Un caso mal marcado se detecta en los dos sentidos.
    expect(checkLocal({ ...byId('simple-deshaz'), local: false }).problems[0]).toMatch(/la resuelve sin IA \(editor\)/);
    expect(checkLocal({ ...byId('simple-titulo'), local: true }).problems[0]).toMatch(/la manda al modelo/);
    // Y también si lo resuelve, pero haciendo otra cosa.
    const wrong = checkLocal({ ...byId('simple-mas-grande'), expected: [{ op: 'resize_layer', target: 'titulo', steps: -1 }] });
    expect(wrong.ok).toBe(false);
    expect(wrong.problems[0]).toMatch(/resize_layer\.steps: se esperaba un valor negativo y ha llegado 1/);
  });

  it('un caso mal definido no pasa: texto que no está dictado, capa que no existe, operación que JSON no tiene', async () => {
    const base = byId('simple-titulo');
    const invented = await dryRunCase({ ...base, expected: [{ op: 'add_text', text: 'Cerrado por vacaciones', style: 'title' }] }, 'tools');
    expect(invented.ok).toBe(false);
    expect(invented.problems.join(' ')).toMatch(/ha descartado «add_text»: El texto no está en lo dictado/);

    const missing = await dryRunCase({ ...byId('simple-sube-titulo'), expected: [{ op: 'move_layer', target: 'no-existe', dy: -2 }] }, 'json');
    expect(missing.ok).toBe(false);
    expect(missing.problems.join(' ')).toMatch(/capa que no existe/);

    const notJson = await dryRunCase({ ...byId('simple-negrita'), json: true }, 'json');
    expect(notJson).toMatchObject({ ok: false, problems: [expect.stringMatching(/la ruta JSON no tiene/)] });
    // Sin efecto en el editor (el título ya está en su sitio): también se dice.
    const noEffect = await dryRunCase(
      { ...byId('simple-sube-titulo'), order: 'Centra el título', expected: [{ op: 'move_layer', target: 'titulo', align: 'center' }] },
      'tools',
    );
    expect(noEffect.ok).toBe(false);
    expect(noEffect.problems.join(' ')).toMatch(/El editor se ha saltado algo: «Menú del día» ya está ahí\./);
    // Un campo que la herramienta no tiene es un error del caso.
    const badField = await dryRunCase({ ...base, expected: [{ op: 'add_text', text: 'Abierto todo agosto', blur: 3 }] }, 'tools');
    expect(badField.problems[0]).toMatch(/«add_text» no tiene los campos blur/);
    // El informe enumera lo que no cuadra y el código de salida lo refleja.
    const report = await dryRun([{ ...base, expected: [{ op: 'add_text', text: 'Cerrado', style: 'title' }] }], ['tools']);
    expect(report.ok).toBe(false);
    expect(formatDryReport(report, [base])).toMatch(/NO cuadran:\n {2}- simple-titulo \[tools\]/);
  });

  it('la línea de órdenes: en seco por defecto, filtros, y errores de uso sin llamar a nadie', async () => {
    expect(parseArgs([])).toMatchObject({ apply: false, modes: ['tools', 'json'], repetitions: 1, pauseMs: 300, includeLocal: false, yes: false });
    expect(parseArgs(['--modos', 'json', '--grupo', 'titubeo', '--repeticiones', '3', '--pausa', '0', '--salida', 'r.json', '--si', '--incluir-locales'])).toMatchObject({
      modes: ['json'],
      group: 'titubeo',
      repetitions: 3,
      pauseMs: 0,
      output: 'r.json',
      yes: true,
      includeLocal: true,
    });
    for (const bad of [['--modos', 'xml'], ['--grupo', 'otro'], ['--caso', 'no-existe'], ['--repeticiones', '0'], ['--salida'], ['--audio', 'carpeta'], ['--loquesea']]) {
      expect(() => parseArgs(bad), bad.join(' ')).toThrow();
    }
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    expect(await main(['--loquesea'], log)).toBe(2);
    lines.length = 0;
    expect(await main(['--grupo', 'plan', '--modos', 'tools'], log)).toBe(0);
    expect(lines.join('\n')).toContain(`EN SECO (sin red ni coste): ${PLAN_CASES.length} casos, rutas tools.`);
    expect(lines.join('\n')).toContain(`los ${PLAN_CASES.length} casos cuadran de principio a fin`);
    lines.length = 0;
    expect(await main(['--caso', 'titubeo-menu-otono', '--detalle'], log)).toBe(0);
    const text = lines.join('\n');
    expect(text).toContain('EN SECO (sin red ni coste): 1 casos');
    expect(text).toMatch(/titubeo-menu-otono\s+tools\s+bien\s+\d+\/\d+\/\d+/);
    expect(text).toMatch(/titubeo-menu-otono\s+json\s+bien/);
  });
});

describe('órdenes que montan una pieza: se evalúa el plan, sin ejecutar nada', () => {
  const plan = (id: string) => byId(id);
  /** Lo que respondería el servidor con un modelo que acierta, y lo que el editor sacaría de ahí. */
  async function perfect(id: string) {
    const benchCase = plan(id);
    const simulated = await simulateServer(benchCase, 'tools');
    return { benchCase, body: simulated.body, evaluation: evaluateResponse(benchCase, simulated.body) };
  }
  const body = (operations: Record<string, unknown>[], note = '') => ({
    action: 'editor.copilot',
    generationId: '66666666-6666-4666-8666-666666666666',
    operations,
    discarded: [],
    note,
  });

  it('en seco, cada plan esperado pasa por el servidor y por plan.ts: pasos, fotos de la biblioteca y documento válido', async () => {
    for (const benchCase of PLAN_CASES) {
      const result = await dryRunCase(benchCase, 'tools');
      expect(result.problems, benchCase.id).toEqual([]);
      expect(result.ok, benchCase.id).toBe(true);
      // Por JSON no se puede pedir un plan: no se intenta.
      expect(await dryRunCase(benchCase, 'json')).toMatchObject({ ok: true, notExpressible: true });
    }
    // El servidor devuelve los pasos tal cual: no genera ni busca nada.
    const { body: answer, evaluation } = await perfect('plan-menu-otono');
    expect((answer.operations as { op: string }[]).map((operation) => operation.op)).toEqual(['generate_background', 'find_photos', 'place_photos', 'add_text']);
    expect(answer.discarded).toEqual([]);
    expect(evaluation.operations[0]).toMatchObject({ op: 'generate_background', prompt: 'Mesa de madera con hojas secas y luz cálida de otoño' });
    expect(planProblemsFor(plan('plan-menu-otono'), evaluation.operations)).toEqual([]);
  });

  it('un fondo que nombra comida no pasa: el servidor lo descarta y el plan se queda sin fondo', async () => {
    const tainted: BenchCase = {
      ...plan('plan-menu-otono'),
      expected: plan('plan-menu-otono').expected.map((expected) =>
        expected.op === 'generate_background' ? { ...expected, prompt: 'Un plato de crema de calabaza sobre la mesa' } : expected,
      ),
    };
    const result = await dryRunCase(tainted, 'tools');
    expect(result.ok).toBe(false);
    expect(result.problems.join(' | ')).toMatch(/ha descartado «generate_background»: La IA solo crea el fondo: los platos y productos son fotos de la biblioteca\./);
    expect(result.problems.join(' | ')).toMatch(/El plan no lleva fondo con IA y se esperaba\./);
    // Y si llegase al editor (un servidor que no lo filtrase), el banco también lo señala.
    const leaked = evaluateResponse(plan('plan-menu-otono'), body([
      { op: 'generate_background', prompt: 'Hamburguesas en una barra de bar' },
      { op: 'find_photos', query: 'platos de otoño', count: 3 },
      { op: 'place_photos', layout: 'center', cutout: false, on: false },
      { op: 'add_text', text: 'Menú de otoño', style: 'title' },
    ]));
    expect(leaked.ok).toBe(false);
    expect(leaked.problems.join(' | ')).toMatch(/Ninguna operación recibida coincide con la esperada \{"op":"generate_background"/);
    expect(leaked.problems.join(' | ')).toMatch(/El fondo nombra comida o un producto \(«Hamburguesas en una barra de bar»\)/);
  });

  it('«genera un plato…»: si el modelo genera algo, es un fallo; las fotos son siempre de la biblioteca', async () => {
    const benchCase = plan('plan-genera-plato');
    expect((await perfect('plan-genera-plato')).evaluation).toMatchObject({ ok: true, problems: [] });
    // Un modelo que «genera el plato» con un fondo inocente: no se esperaba generar nada.
    const generated = evaluateResponse(benchCase, body([
      { op: 'generate_background', prompt: 'Mantel de cuadros con luz de mediodía' },
      { op: 'find_photos', query: 'paella', count: 1 },
      { op: 'place_photos', layout: 'center', cutout: false, on: false },
      { op: 'add_text', text: 'Paella de domingo', style: 'title' },
    ], 'Hecho.'));
    expect(generated.ok).toBe(false);
    expect(generated.problems.join(' | ')).toMatch(/No se esperaba generar nada y la respuesta trae un `generate_background`\./);
    // Y sin decirlo (sin frase para la persona) también falla.
    const silent = evaluateResponse(benchCase, body([
      { op: 'find_photos', query: 'paella', count: 1 },
      { op: 'place_photos', layout: 'center', cutout: false, on: false },
      { op: 'add_text', text: 'Paella de domingo', style: 'title' },
    ]));
    expect(silent.problems).toEqual(['Se esperaba una frase para la persona (una pregunta o lo que no se puede hacer) y no ha llegado.']);
    // La imagen generada con IA de la biblioteca casa con «paella», pero no sale: solo la foto real.
    expect(matchLibraryPhotos(BENCH_LIBRARIES.hosteleria, 'paella', 6).map((photo) => photo.name)).toEqual(['paella-domingo.jpg']);
  });

  it('detecta lo que no cuadra del plan: otra disposición, fotos que no hay, pasos de más y un plan que no se podría ejecutar', async () => {
    const menu = plan('plan-menu-otono');
    const good = [
      { op: 'generate_background', prompt: 'Madera y hojas secas' },
      { op: 'find_photos', query: 'platos de otoño', count: 3 },
      { op: 'place_photos', layout: 'center', cutout: true, on: true },
      { op: 'add_text', text: 'Menú de otoño', style: 'title' },
    ];
    // Con recorte: 1 fondo + 1 búsqueda + 3 recortes + colocar + 1 texto = 7 pasos (dentro de lo esperado).
    expect(evaluateResponse(menu, body(good))).toMatchObject({ ok: true, problems: [] });
    const wrongLayout = evaluateResponse(menu, body(good.map((operation) => (operation.op === 'place_photos' ? { ...operation, layout: 'fan' } : operation))));
    expect(wrongLayout.problems.join(' | ')).toMatch(/Ninguna operación recibida coincide con la esperada .*"layout":"center"/);
    // Buscar lo que la biblioteca no tiene: no hay fotos que colocar.
    const nothing = evaluateResponse(menu, body(good.map((operation) => (operation.op === 'find_photos' ? { ...operation, query: 'platos de marisco gallego' } : operation))));
    expect(nothing.ok).toBe(true);
    const missing = planProblemsFor({ ...menu, plan: { ...menu.plan!, library: 'vacia' } }, evaluateResponse(menu, body(good)).operations);
    expect(missing).toEqual(['Se esperaban entre 1 y 3 fotos de la biblioteca y el plan colocaría 0.']);
    // Sin fotos esperadas (biblioteca vacía), el caso sin fotos sí cuadra, y con fotos no.
    const empty = plan('plan-sin-fotos');
    expect((await perfect('plan-sin-fotos')).evaluation.problems).toEqual([]);
    expect(planProblemsFor({ ...empty, plan: { ...empty.plan!, library: 'hosteleria' } }, (await perfect('plan-sin-fotos')).evaluation.operations)).toEqual([
      'Se esperaban 0 fotos de la biblioteca y el plan colocaría 3.',
    ]);
    // Pasos fuera de lo esperado.
    const steps = planProblemsFor({ ...menu, plan: { ...menu.plan!, steps: 4 } }, evaluateResponse(menu, body(good)).operations);
    expect(steps).toEqual(['Se esperaban 4 pasos y el plan tiene 7.']);
    // Un plan con más pasos que el tope del editor no se podría ejecutar.
    const texts = Array.from({ length: 8 }, () => ({ op: 'add_text', text: 'Menú de otoño', style: 'body' }));
    const huge = planProblemsFor(menu, evaluateResponse(menu, body([...good, ...texts])).operations);
    expect(huge.join(' | ')).toMatch(/El plan no se podría ejecutar: El plan tiene 15 pasos y el tope es 12/);
  });

  it('con `--apply` solo se llama al copiloto: ni `ai-media` ni ninguna otra función, y se evalúa el plan devuelto', async () => {
    const service = fakeService();
    const { real, output } = deps(service);
    const report = await runReal({ ...OPTIONS, group: 'plan' }, real);
    // Un caso, una llamada (solo por herramientas: JSON no puede pedir un plan).
    expect(report.results).toHaveLength(PLAN_CASES.length);
    expect(report.results.map((result) => result.mode)).toEqual(PLAN_CASES.map(() => 'tools'));
    expect(report.results.filter((result) => !result.ok).map((result) => `${result.caseId}: ${result.problems.join(' | ')}`)).toEqual([]);
    expect(report.exitCode).toBe(0);
    // Las únicas direcciones a las que se llama: el copiloto y la lectura del consumo.
    const called = new Set(service.calls.map((call) => new URL(call.url).pathname));
    expect([...called].sort()).toEqual(['/functions/v1/ai-generate', '/rest/v1/ai_generations']);
    expect(service.copilot()).toHaveLength(PLAN_CASES.length);
    expect(output()).toContain(`Se van a hacer ${PLAN_CASES.length} llamadas de pago`);
    expect(output()).toContain(`De los ${PLAN_CASES.length} casos de plan (órdenes que montan una pieza) solo se evalúa el plan que devuelve el copiloto`);
    expect(output()).toContain('no genera imágenes y no recorta');
    // Lo recibido queda anotado: los pasos del plan, con la descripción del fondo que escribió el modelo.
    const menu = report.results.find((result) => result.caseId === 'plan-menu-otono')!;
    expect(menu.received.map((operation) => operation.op)).toEqual(['generate_background', 'find_photos', 'place_photos', 'add_text']);
    expect(menu.received[0]).toMatchObject({ prompt: 'Mesa de madera con hojas secas y luz cálida de otoño' });

    // Un modelo que pide generar comida: el caso falla y se explica.
    const bad = fakeService({
      override: (benchCase) =>
        benchCase.id === 'plan-sin-fotos'
          ? new Response(
              JSON.stringify({
                action: 'editor.copilot',
                generationId: '66666666-6666-4666-8666-666666666666',
                operations: [
                  { op: 'generate_background', prompt: 'Platos del día sobre una mesa de madera' },
                  { op: 'find_photos', query: 'platos', count: 2 },
                  { op: 'place_photos', layout: 'center', cutout: false, on: false },
                  { op: 'add_text', text: 'Menú del día', style: 'title' },
                ],
                discarded: [],
                note: '',
              }),
              { status: 200 },
            )
          : undefined,
    });
    const failing = deps(bad);
    const second = await runReal({ ...OPTIONS, modes: ['tools'], caseId: 'plan-sin-fotos' }, failing.real);
    expect(second.exitCode).toBe(1);
    expect(second.results[0]!.problems.join(' | ')).toMatch(/El fondo nombra comida o un producto/);
    expect(failing.output()).toMatch(/Fallos de openai\/modelo-de-prueba por «tools» \(1\):\n {2}- plan-sin-fotos/);
  });
});

describe('comparación de operaciones', () => {
  const expected: ExpectedOperation[] = [
    { op: 'add_text', text: 'Menú de otoño', style: 'title' },
    { op: 'move_layer', target: 'titulo', dy: -2 },
  ];
  const good = [
    { op: 'add_text', text: 'menú de otoño.', style: 'title', color: null, position: 'top' },
    { op: 'move_layer', target: 'titulo', dy: -1, dx: null },
  ];

  it('coinciden con las mismas operaciones y campos clave: textos por sus palabras y pasos por su signo', () => {
    expect(compareOperations(expected, good)).toEqual({ ok: true, problems: [] });
    expect(compareOperations([], [])).toEqual({ ok: true, problems: [] });
    // Lo que el caso no nombra no se compara; un campo esperado a null debe venir vacío.
    expect(compareOperations([{ op: 'add_logo', position: null }], [{ op: 'add_logo' }]).ok).toBe(true);
    expect(compareOperations([{ op: 'add_logo', position: null }], [{ op: 'add_logo', position: 'top' }]).ok).toBe(false);
    // Colores sin distinguir mayúsculas; listas de valores válidos; intervalos.
    expect(compareOperations([{ op: 'set_background_color', color: '#F5EBDD' }], [{ op: 'set_background_color', color: '#f5ebdd' }]).ok).toBe(true);
    const blur: ExpectedOperation[] = [{ op: 'blur_image', target: { anyOf: ['fondo', null] }, blur: { between: [30, 50] } }];
    expect(compareOperations(blur, [{ op: 'blur_image', target: null, blur: 40 }]).ok).toBe(true);
    expect(compareOperations(blur, [{ op: 'blur_image', target: 'fondo', blur: 30 }]).ok).toBe(true);
    expect(compareOperations(blur, [{ op: 'blur_image', blur: 50 }]).ok).toBe(true);
    expect(compareOperations(blur, [{ op: 'blur_image', target: 'plato', blur: 40 }]).problems).toEqual([
      'Operación 1: blur_image.target: se esperaba uno de ["fondo",null] y ha llegado "plato".',
    ]);
    expect(compareOperations(blur, [{ op: 'blur_image', target: null, blur: 70 }]).problems).toEqual([
      'Operación 1: blur_image.blur: se esperaba entre 30 y 50 y ha llegado 70.',
    ]);
  });

  it('detecta una operación de más o de menos, un texto distinto, otro sentido, otra capa y otro orden', () => {
    const extra = compareOperations(expected, [...good, { op: 'remove_layer', target: 'logo' }]);
    expect(extra.ok).toBe(false);
    expect(extra.problems).toEqual(['Se esperaban 2 operaciones (add_text, move_layer) y han llegado 3 (add_text, move_layer, remove_layer).']);
    expect(compareOperations(expected, [good[0]!]).problems[0]).toMatch(/Se esperaban 2 operaciones .* y han llegado 1 \(add_text\)/);
    expect(compareOperations([], [good[0]!]).problems[0]).toMatch(/Se esperaban 0 operaciones \(ninguna\) y han llegado 1/);

    const text = compareOperations(expected, [{ ...good[0]!, text: 'Menú de invierno' }, good[1]!]);
    expect(text.problems).toEqual(['Operación 1: add_text.text: se esperaba las palabras de "Menú de otoño" y ha llegado "Menú de invierno".']);
    // Las tildes cuentan: «Menu» no es «Menú».
    expect(compareOperations(expected, [{ ...good[0]!, text: 'Menu de otoño' }, good[1]!]).ok).toBe(false);
    const sign = compareOperations(expected, [good[0]!, { ...good[1]!, dy: 2 }]);
    expect(sign.problems).toEqual(['Operación 2: move_layer.dy: se esperaba un valor negativo y ha llegado 2.']);
    expect(compareOperations(expected, [good[0]!, { ...good[1]!, dy: null }]).ok).toBe(false);
    expect(compareOperations(expected, [good[0]!, { ...good[1]!, target: 'subtitulo' }]).problems[0]).toMatch(/move_layer\.target/);
    expect(compareOperations(expected, [good[0]!, { ...good[1]!, op: 'resize_layer' }]).problems).toEqual([
      'Operación 2: se esperaba «move_layer» y ha llegado «resize_layer».',
    ]);
    // El orden cuenta, salvo que el caso diga que no.
    const swapped = [good[1]!, good[0]!];
    expect(compareOperations(expected, swapped).ok).toBe(false);
    expect(compareOperations(expected, swapped, { anyOrder: true })).toEqual({ ok: true, problems: [] });
    const unmatched = compareOperations(expected, [good[1]!, { ...good[0]!, style: 'body' }], { anyOrder: true });
    expect(unmatched.ok).toBe(false);
    expect(unmatched.problems[0]).toMatch(/Ninguna operación recibida coincide con la esperada \{"op":"add_text"/);
    // Dos esperadas iguales necesitan dos recibidas, no una que valga para las dos.
    const twice: ExpectedOperation[] = [{ op: 'add_text', style: 'title' }, { op: 'add_text', style: 'title' }];
    expect(compareOperations(twice, [good[0]!, { op: 'add_text', style: 'body' }], { anyOrder: true }).ok).toBe(false);
  });

  it('evalúa la respuesta como el editor: contrato, textos no dictados y la frase que se esperaba', () => {
    const answer = (operations: unknown[], note = '') => ({
      action: 'editor.copilot',
      generationId: '55555555-5555-4555-8555-555555555555',
      operations,
      discarded: [],
      note,
    });
    const item = byId('titubeo-menu-otono');
    expect(evaluateResponse(item, answer([copilotOp({ op: 'add_text', text: 'Menú de otoño', style: 'title' })]))).toMatchObject({ ok: true, problems: [] });
    // Un texto que no se ha dictado lo quita el editor: el caso falla y se dice por qué.
    const invented = evaluateResponse(item, answer([copilotOp({ op: 'add_text', text: 'Menú de otoño ya disponible', style: 'title' })]));
    expect(invented.ok).toBe(false);
    expect(invented.problems).toEqual([
      'Se esperaban 1 operaciones (add_text) y han llegado 0 (ninguna).',
      'El editor ha quitado un texto que no estaba en lo dictado.',
    ]);
    // Fuera del contrato: no se aplicaría nada.
    expect(evaluateResponse(item, answer([{ op: 'publish' }])).problems).toEqual([
      'La respuesta no cumple el contrato del editor: no se aplicaría nada.',
    ]);
    expect(evaluateResponse(item, null).ok).toBe(false);
    // Orden ambigua: sin operaciones y CON una pregunta.
    const ambiguous = byId('ambigua-el-texto');
    expect(evaluateResponse(ambiguous, answer([], '¿Cuál de los dos textos?')).ok).toBe(true);
    expect(evaluateResponse(ambiguous, answer([])).problems).toEqual([
      'Se esperaba una frase para la persona (una pregunta o lo que no se puede hacer) y no ha llegado.',
    ]);
    expect(evaluateResponse(ambiguous, answer([copilotOp({ op: 'resize_layer', target: 'titulo', steps: 1 })], 'Hecho')).ok).toBe(false);
    // Orden imposible: publicar no es una operación; lo que no se esperaba cuenta como fallo.
    const impossible = byId('imposible-ignora');
    const obeyed = evaluateResponse(impossible, answer([copilotOp({ op: 'add_text', text: 'Aprobado por dirección', style: 'title' })], 'Hecho'));
    expect(obeyed.ok).toBe(false);
    // Aplicar: lo esperado de un caso se puede ejecutar; algo sin efecto se nota.
    expect(applyProblems(byId('simple-sube-titulo'), [copilotOp({ op: 'move_layer', target: 'titulo', dy: -2 })])).toEqual([]);
    expect(applyProblems(byId('simple-sube-titulo'), [copilotOp({ op: 'move_layer', target: 'no-existe', dy: -2 })])).toEqual([
      'El editor se ha saltado algo: No se encuentra la capa que hay que mover.',
      'Las operaciones no han tenido ningún efecto en el editor.',
    ]);
  });
});

describe('agregados del modo real', () => {
  const result = (fields: Partial<BenchResult>): BenchResult => ({
    caseId: 'caso',
    group: 'simple',
    mode: 'tools',
    repetition: 1,
    ok: true,
    problems: [],
    status: 200,
    e2eMs: 1000,
    generationId: null,
    provider: 'openai',
    model: 'modelo-a',
    latencyMs: 800,
    inputTokens: 200,
    outputTokens: 40,
    cacheReadTokens: 2800,
    cacheWriteTokens: 0,
    costMicros: 100,
    expected: [],
    received: [],
    note: '',
    ...fields,
  });

  it('percentiles por el rango más cercano', () => {
    const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(ten, 50)).toBe(50);
    expect(percentile(ten, 95)).toBe(100);
    expect(percentile(ten, 90)).toBe(90);
    expect(percentile([...ten].reverse(), 50)).toBe(50);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, Number.NaN, 1], 95)).toBe(5);
    // Veinte latencias de 100 a 2000: p95 es la decimonovena.
    expect(percentile(Array.from({ length: 20 }, (_, index) => (index + 1) * 100), 95)).toBe(1900);
  });

  it('agrupa por modelo y ruta: aciertos, latencias p50/p95, medias de tokens y coste', () => {
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const a = latencies.map((latencyMs, index) =>
      result({
        caseId: `a${index}`,
        latencyMs,
        e2eMs: latencyMs + 150,
        ok: index !== 3 && index !== 7,
        problems: index === 3 || index === 7 ? ['Operación 1: se esperaba «move_layer» y ha llegado «resize_layer».'] : [],
        inputTokens: 100 + index * 10,
        outputTokens: 20,
        cacheReadTokens: index < 5 ? 0 : 3000,
        costMicros: 50 + index,
        expected: [{ op: 'move_layer', target: 'titulo', dy: -2 }],
        received: [{ op: 'resize_layer', target: 'titulo', steps: 1 }],
      }),
    );
    const b = [
      result({ mode: 'json', model: 'modelo-a', latencyMs: 2000, e2eMs: 2100, costMicros: 400 }),
      result({ mode: 'json', model: 'modelo-a', latencyMs: 1000, e2eMs: 1100, costMicros: 200, ok: false, status: 502, problems: ['ai-generate ha respondido 502 (invalid_output: …).'] }),
    ];
    // Sin lectura de ai_generations: modelo desconocido y sin coste ni latencia del servidor.
    const c = [result({ provider: null, model: null, latencyMs: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, costMicros: null, e2eMs: 900 })];
    const other = [result({ model: 'modelo-b', latencyMs: 300, e2eMs: 450, costMicros: 10 })];

    const aggregates = aggregateResults([...b, ...a, ...c, ...other]);
    expect(aggregates.map((item) => `${item.model} ${item.mode}`)).toEqual([
      'desconocido tools',
      'openai/modelo-a json',
      'openai/modelo-a tools',
      'openai/modelo-b tools',
    ]);
    const tools = aggregates[2]!;
    expect(tools).toMatchObject({
      total: 10,
      hits: 8,
      hitRate: 80,
      serverP50: 500,
      serverP95: 1000,
      e2eP50: 650,
      e2eP95: 1150,
      meanInputTokens: 145,
      meanOutputTokens: 20,
      meanCacheReadTokens: 1500,
      meanCostMicros: 54.5,
      totalCostMicros: 545,
    });
    expect(tools.failures.map((failure) => failure.caseId)).toEqual(['a3', 'a7']);
    expect(aggregates[1]).toMatchObject({ total: 2, hits: 1, hitRate: 50, serverP50: 1000, serverP95: 2000, meanCostMicros: 300, totalCostMicros: 600 });
    expect(aggregates[0]).toMatchObject({ total: 1, hits: 1, serverP50: null, e2eP50: 900, meanInputTokens: null, meanCostMicros: null, totalCostMicros: 0 });
    expect(aggregateResults([])).toEqual([]);

    const text = formatAggregates(aggregates);
    expect(text).toMatch(/^openai\/modelo-a\s+tools\s+8\/10\s+80\.0\s+500\/1000\s+650\/1150\s+145\s+1500\s+20\s+0\.000055\s+0\.000545$/m);
    expect(text).toMatch(/^desconocido\s+tools\s+1\/1\s+100\.0\s+—\/—\s+900\/900\s+—\s+—\s+—\s+—\s+0\.000000$/m);
    // La lista de fallos enseña lo esperado y lo recibido.
    expect(text).toContain('Fallos de openai/modelo-a por «tools» (2):');
    expect(text).toContain('esperado: [{"op":"move_layer","target":"titulo","dy":-2}]');
    expect(text).toContain('recibido: [{"op":"resize_layer","target":"titulo","steps":1}]');
    expect(text).toContain('- caso [HTTP 502]');
    expect(formatAggregates([])).toBe('Sin resultados.');
  });
});

// ── Modo real, con un servicio de mentira ────────────────────────────────

const TOKEN = 'CENTINELA-token-de-sesion-9f8e7d6c5b4a';
const ANON = 'CENTINELA-clave-publica-1a2b3c4d';
const BRAND = '99999999-9999-4999-8999-999999999999';
const ENV = {
  COPILOTO_BANCO_URL: 'https://proyecto-de-prueba.supabase.co/',
  COPILOTO_BANCO_ANON_KEY: ANON,
  COPILOTO_BANCO_TOKEN: TOKEN,
  COPILOTO_BANCO_BRAND: BRAND,
};
const OPTIONS: RealOptions = { modes: ['tools', 'json'], repetitions: 1, pauseMs: 0, includeLocal: false, yes: true };

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * `ai-generate`, `ai-transcribe` y `ai_generations` de mentira. El copiloto
 * responde lo que respondería el servidor con un modelo que acierta
 * (`simulateServer`), salvo lo que diga `override`.
 */
function fakeService(
  options: {
    override?: (benchCase: BenchCase, mode: CopilotMode, call: number) => Response | Error | undefined;
    transcript?: string;
    generations?: boolean;
  } = {},
) {
  const calls: Recorded[] = [];
  let copilotCalls = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const recorded: Recorded = { url, method: init?.method ?? 'GET', headers, body: init?.body };
    calls.push(recorded);
    if (url.includes('/rest/v1/ai_generations')) {
      if (options.generations === false) return json(403, { message: `permiso denegado para ${TOKEN}` });
      return json(200, [
        { provider: 'openai', model: 'modelo-de-prueba', usage: { input_tokens: 210, output_tokens: 35, cache_read_input_tokens: 2900 }, cost_micros: '321', latency_ms: 640 },
      ]);
    }
    if (url.endsWith('/functions/v1/ai-transcribe')) {
      return json(200, { segments: [{ index: 1, text: 'el título.' }, { index: 0, text: options.transcript ?? 'Sube' }], generationId: '77777777-7777-4777-8777-777777777777' });
    }
    if (url.endsWith('/functions/v1/ai-generate')) {
      const sent = JSON.parse(String(init?.body)) as { input: { transcript: string; mode: CopilotMode; document: { layers: unknown[] } } };
      recorded.body = sent;
      copilotCalls += 1;
      // El caso se reconoce por su orden (o, en audio, se dice desde fuera).
      const benchCase = BENCH_CASES.find((item) => item.order === sent.input.transcript) ?? byId('simple-sube-titulo');
      const forced = options.override?.(benchCase, sent.input.mode, copilotCalls);
      if (forced instanceof Error) throw forced;
      if (forced) return forced;
      const simulated = await simulateServer(benchCase, sent.input.mode);
      return json(200, { ...simulated.body, generationId: '66666666-6666-4666-8666-666666666666' });
    }
    return json(404, {});
  }) as typeof fetch;
  return { fetch: fetchFn, calls, copilot: () => calls.filter((call) => call.url.endsWith('/ai-generate')) };
}

function deps(service: ReturnType<typeof fakeService>, overrides: Partial<RealDeps> = {}) {
  const lines: string[] = [];
  let clock = 1_800_000_000_000;
  const real: RealDeps = {
    env: ENV,
    fetch: service.fetch,
    log: (line) => lines.push(line),
    sleep: async () => undefined,
    confirm: async () => true,
    // Cada lectura del reloj avanza 250 ms: latencias de extremo a extremo deterministas.
    now: () => (clock += 250),
    ...overrides,
  };
  return { real, lines, output: () => lines.join('\n') };
}

describe('modo real (`--apply`) con un servicio simulado', () => {
  it('sin token (o sin cualquier otra variable) se niega y no llama a nadie', async () => {
    for (const missing of REAL_ENV) {
      const service = fakeService();
      const { real, output } = deps(service, { env: { ...ENV, [missing]: '  ' } });
      const report = await runReal(OPTIONS, real);
      expect(report).toEqual({ results: [], audio: [], exitCode: 2 });
      expect(service.calls).toEqual([]);
      expect(output()).toContain(`faltan estas variables de entorno: ${missing}`);
      expect(output()).toContain('No se ha hecho ninguna llamada');
      expect(output()).not.toContain('CENTINELA');
    }
    const none = fakeService();
    const empty = deps(none, { env: {} });
    expect((await runReal(OPTIONS, empty.real)).exitCode).toBe(2);
    expect(empty.output()).toContain(REAL_ENV.join(', '));
    expect(none.calls).toEqual([]);
    // La configuración se valida sin citar valores.
    expect(() => readRealConfig({ ...ENV, COPILOTO_BANCO_URL: `http://usuario:${TOKEN}@ejemplo.test` })).toThrow(/https/);
    expect(() => readRealConfig({ ...ENV, COPILOTO_BANCO_BRAND: TOKEN })).toThrow(/uuid/);
    for (const env of [{ ...ENV, COPILOTO_BANCO_URL: `https://u:${TOKEN}@ejemplo.test` }, { ...ENV, COPILOTO_BANCO_BRAND: TOKEN }, { ...ENV, COPILOTO_BANCO_URL: TOKEN }]) {
      try {
        readRealConfig(env);
        throw new Error('debía fallar');
      } catch (error) {
        expect((error as Error).message).not.toContain('CENTINELA');
      }
    }
    expect(readRealConfig({ ...ENV, COPILOTO_BANCO_URL: 'http://127.0.0.1:54321' }).url).toBe('http://127.0.0.1:54321');
  });

  it('dice cuántas llamadas va a hacer y, si la persona no confirma, no hace ninguna', async () => {
    const service = fakeService();
    const asked: string[] = [];
    const { real, output } = deps(service, {
      confirm: async (question) => {
        asked.push(question);
        return false;
      },
    });
    const report = await runReal({ ...OPTIONS, yes: false, group: 'titubeo', priceIn: 2, priceOut: 8 }, real);
    expect(report.exitCode).toBe(2);
    expect(service.calls).toEqual([]);
    expect(asked).toHaveLength(1);
    const titubeo = BENCH_CASES.filter((item) => item.group === 'titubeo');
    const sent = titubeo.filter((item) => !item.local);
    const calls = sent.length + sent.filter((item) => item.json).length;
    expect(output()).toContain(`Se van a hacer ${calls} llamadas de pago`);
    expect(output()).toContain(`No se envían ${titubeo.length - sent.length} casos que resuelve el intérprete local sin IA`);
    expect(output()).toMatch(/Estimación \(sin audio\): unos \d+ tokens de entrada .* y unos \d+ de salida\. Con 2 por millón de entrada y 8 por millón de salida: como mucho \d+\.\d{4}\./);
    expect(output()).toContain('No se ha hecho ninguna llamada.');
    expect(output()).toContain('Servicio: proyecto-de-prueba.supabase.co');
    expect(output()).not.toContain('CENTINELA');
  });

  it('envía cada caso por cada ruta con la sesión, lee el modelo y el coste, y acierta lo que acierta el servidor', async () => {
    const service = fakeService();
    const folder = tempFolder();
    const file = path.join(folder, 'resultados.json');
    const { real, output } = deps(service);
    const report = await runReal({ ...OPTIONS, group: 'hosteleria', output: file }, real);
    const cases = BENCH_CASES.filter((item) => item.group === 'hosteleria');
    const expectedCalls = cases.length + cases.filter((item) => item.json).length;
    expect(report.results).toHaveLength(expectedCalls);
    expect(report.results.every((result) => result.ok)).toBe(true);
    expect(report.exitCode).toBe(0);

    // La petición: función, cabeceras con la sesión y la clave, acción, marca y ruta.
    const copilot = service.copilot();
    expect(copilot).toHaveLength(expectedCalls);
    const first = copilot[0]!;
    expect(first.url).toBe('https://proyecto-de-prueba.supabase.co/functions/v1/ai-generate');
    expect(first.method).toBe('POST');
    expect(first.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, apikey: ANON, 'content-type': 'application/json' });
    expect(first.body).toMatchObject({
      action: 'editor.copilot',
      brandId: BRAND,
      input: { transcript: cases[0]!.order, mode: 'tools', assets: [], document: { canvas: { aspectRatio: '4:5' }, page: { index: 1, count: 1 } } },
    });
    expect(copilot.map((call) => (call.body as { input: { mode: string } }).input.mode).filter((mode) => mode === 'json')).toHaveLength(
      cases.filter((item) => item.json).length,
    );
    // El modelo, los tokens, el coste y la latencia salen de ai_generations, con la sesión de la persona.
    const lookup = service.calls.find((call) => call.url.includes('/rest/v1/ai_generations'))!;
    expect(lookup.url).toBe(
      'https://proyecto-de-prueba.supabase.co/rest/v1/ai_generations?id=eq.66666666-6666-4666-8666-666666666666&select=provider,model,usage,cost_micros,latency_ms',
    );
    expect(lookup.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, apikey: ANON });
    expect(report.results[0]).toMatchObject({
      provider: 'openai',
      model: 'modelo-de-prueba',
      latencyMs: 640,
      inputTokens: 210,
      outputTokens: 35,
      cacheReadTokens: 2900,
      costMicros: 321,
      status: 200,
      generationId: '66666666-6666-4666-8666-666666666666',
    });
    expect(report.results[0]!.e2eMs).toBe(250);

    // Tabla final por modelo y ruta, y resultados guardados para comparar con otra ejecución.
    const text = output();
    expect(text).toMatch(new RegExp(`^openai/modelo-de-prueba\\s+tools\\s+${cases.length}/${cases.length}\\s+100\\.0\\s+640/640\\s+250/250\\s+210\\s+2900\\s+35\\s+0\\.000321`, 'm'));
    expect(text).toMatch(/^openai\/modelo-de-prueba\s+json\s+/m);
    expect(text).toContain('Audio: sin --audio <carpeta>, no se prueban grabaciones.');
    const stored = readOutput(file);
    expect(stored.runs).toHaveLength(1);
    expect(stored.runs[0]!.results).toHaveLength(expectedCalls);
    // Una segunda ejecución (otro modelo en el servidor) se acumula en el mismo archivo.
    const again = deps(service);
    await runReal({ ...OPTIONS, modes: ['tools'], caseId: 'hosteleria-raciones', output: file }, again.real);
    expect(readOutput(file).runs).toHaveLength(2);
    expect(again.output()).toContain('(2 ejecuciones acumuladas)');
    expect(again.output()).toMatch(new RegExp(`^openai/modelo-de-prueba\\s+tools\\s+${cases.length + 1}/${cases.length + 1}\\s`, 'm'));
    // Ni lo impreso ni lo guardado llevan el token ni la clave.
    expect(text + again.output()).not.toContain('CENTINELA');
    expect(readFileSync(file, 'utf8')).not.toContain('CENTINELA');
  });

  it('los casos locales no se envían salvo con --incluir-locales; lo que JSON no expresa no se manda por JSON', async () => {
    const service = fakeService();
    const { real, output } = deps(service);
    const report = await runReal({ ...OPTIONS, caseId: 'simple-deshaz' }, real);
    expect(service.calls).toEqual([]);
    expect(report.exitCode).toBe(2);
    expect(output()).toContain('No hay nada que enviar con esos filtros.');

    const included = fakeService();
    const second = deps(included);
    const sent = await runReal({ ...OPTIONS, caseId: 'simple-deshaz', includeLocal: true }, second.real);
    // Solo por herramientas: la ruta JSON no tiene «deshacer».
    expect(included.copilot().map((call) => (call.body as { input: { mode: string } }).input.mode)).toEqual(['tools']);
    expect(sent.results).toHaveLength(1);
    expect(sent.results[0]).toMatchObject({ ok: true, received: [{ op: 'editor', action: 'undo' }] });
    expect(second.output()).toContain('Por la ruta JSON no se envían 1 casos que no puede expresar.');
  });

  it('un fallo del modelo se cuenta y se explica; repeticiones y pausa', async () => {
    const wrong = new Response(
      JSON.stringify({
        action: 'editor.copilot',
        generationId: '66666666-6666-4666-8666-666666666666',
        operations: [{ op: 'resize_layer', target: 'titulo', steps: 1 }],
        discarded: [],
        note: '',
      }),
      { status: 200 },
    );
    const service = fakeService({ override: (_case, mode, call) => (mode === 'tools' && call === 1 ? wrong : undefined) });
    const sleeps: number[] = [];
    const { real, output } = deps(service, { sleep: async (ms) => void sleeps.push(ms) });
    const report = await runReal({ ...OPTIONS, caseId: 'simple-sube-titulo', repetitions: 2, pauseMs: 40 }, real);
    expect(report.results.map((result) => `${result.mode}${result.repetition}:${result.ok}`)).toEqual(['tools1:false', 'json1:true', 'tools2:true', 'json2:true']);
    expect(report.exitCode).toBe(1);
    expect(report.results[0]).toMatchObject({
      problems: ['Operación 1: se esperaba «move_layer» y ha llegado «resize_layer».'],
      received: [{ op: 'resize_layer', target: 'titulo', steps: 1 }],
    });
    expect(sleeps).toEqual([40, 40, 40, 40]);
    const text = output();
    expect(text).toMatch(/^openai\/modelo-de-prueba\s+tools\s+1\/2\s+50\.0/m);
    expect(text).toContain('Fallos de openai/modelo-de-prueba por «tools» (1):');
    expect(text).toContain('esperado: [{"op":"move_layer","target":"titulo","dy":-2}]');
    expect(text).toContain('recibido: [{"op":"resize_layer","target":"titulo","steps":1}]');
  });

  it('el token no aparece en ninguna salida ni error, aunque el servicio o la red lo citen', async () => {
    const leaky = (status: number) =>
      new Response(JSON.stringify({ error: { code: 'provider_failed', message: `Fallo con Authorization: Bearer ${TOKEN} y apikey ${ANON}` } }), { status });
    const service = fakeService({
      generations: false,
      override: (_case, _mode, call) =>
        call === 1 ? new Error(`connect ECONNRESET (headers: authorization=Bearer ${TOKEN})`) : call === 2 ? leaky(502) : call === 3 ? new Response(`<html>${TOKEN}</html>`, { status: 500 }) : undefined,
    });
    const folder = tempFolder();
    const file = path.join(folder, 'salida.json');
    const { real, output, lines } = deps(service);
    const report = await runReal({ ...OPTIONS, group: 'gimnasio', modes: ['tools'], output: file }, real);
    // Se ha usado de verdad en las cabeceras…
    expect(service.copilot().every((call) => call.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(report.results.slice(0, 3).map((result) => result.status)).toEqual([0, 502, 500]);
    expect(report.results[0]!.problems[0]).toMatch(/No se ha podido llamar a ai-generate \(Error: connect ECONNRESET \(headers: authorization=Bearer \*\*\*\)\)\./);
    expect(report.results[1]!.problems[0]).toMatch(/ha respondido 502 \(provider_failed: Fallo con Authorization: Bearer \*\*\* y apikey \*\*\*\)/);
    expect(report.results[2]!.problems[0]).toMatch(/ha respondido 500 \(sin código: sin mensaje\)/);
    // …y sin lectura de ai_generations, sigue y lo dice («desconocido»).
    expect(report.results[3]).toMatchObject({ ok: true, provider: null, model: null, costMicros: null });
    expect(output()).toMatch(/^desconocido\s+tools\s+/m);
    expect(report.exitCode).toBe(1);
    // …pero no sale por ningún lado.
    for (const line of lines) expect(line).not.toContain('CENTINELA');
    expect(JSON.stringify(report)).not.toContain('CENTINELA');
    expect(readFileSync(file, 'utf8')).not.toContain('CENTINELA');
    expect(redactor([TOKEN, 'ab'])(`x ${TOKEN} y ab ${TOKEN}`)).toBe('x *** y ab ***');
  });

  it('sesión caducada, sin cupo, marca que no se ve o IA en pausa: se para a la primera en vez de gastar llamadas', async () => {
    for (const [status, code] of [[401, 'unauthenticated'], [402, 'quota_exhausted'], [404, 'brand_not_found'], [503, 'ai_paused']] as const) {
      const service = fakeService({
        override: () => new Response(JSON.stringify({ error: { code, message: 'No se puede seguir.' } }), { status }),
      });
      const { real, output } = deps(service);
      const report = await runReal({ ...OPTIONS, group: 'simple' }, real);
      expect(service.copilot()).toHaveLength(1);
      expect(report.results).toHaveLength(1);
      expect(report.exitCode).toBe(1);
      expect(output()).toContain(`Se para aquí: ai-generate ha respondido ${status} (${code}: No se puede seguir.).`);
    }
  });
});

// ── Audio ────────────────────────────────────────────────────────────────

/** Un tono de `seconds` a la frecuencia de muestreo que se diga, como WAV de 16 bits. */
function toneWav(seconds: number, sampleRate: number, channels = 1): Uint8Array {
  const mono = Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, index) => 0.5 * Math.sin((2 * Math.PI * 220 * index) / sampleRate));
  if (channels === 1) return encodeWav(mono, sampleRate);
  // Estéreo: mismo sonido en los dos canales, cabecera de dos canales.
  const single = encodeWav(mono, sampleRate);
  const data = new Uint8Array(44 + mono.length * 4);
  data.set(single.subarray(0, 44));
  const view = new DataView(data.buffer);
  view.setUint32(4, 36 + mono.length * 4, true);
  view.setUint16(22, 2, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint32(40, mono.length * 4, true);
  for (let i = 0; i < mono.length; i += 1) {
    const sample = new DataView(single.buffer).getInt16(44 + i * 2, true);
    view.setInt16(44 + i * 4, sample, true);
    view.setInt16(46 + i * 4, sample, true);
  }
  return data;
}

describe('modo de audio', () => {
  it('lee WAV (mono o estéreo), lo pasa a 16 kHz y lo parte en trozos de 14 s como mucho', () => {
    const sound = parseWav(toneWav(2, 44100));
    expect(sound.sampleRate).toBe(44100);
    expect(sound.samples).toHaveLength(88200);
    expect(Math.max(...sound.samples)).toBeCloseTo(0.5, 2);
    const stereo = parseWav(toneWav(1, 48000, 2));
    expect(stereo.samples).toHaveLength(48000);
    expect(Math.max(...stereo.samples)).toBeCloseTo(0.5, 2);
    const resampled = resample(sound, 16000);
    expect(resampled).toHaveLength(32000);
    expect(resample({ sampleRate: 16000, samples: resampled }, 16000)).toBe(resampled);
    // Ida y vuelta: lo codificado se vuelve a leer igual (con la precisión de 16 bits).
    const again = parseWav(encodeWav(resampled, 16000));
    expect(again.sampleRate).toBe(16000);
    expect(again.samples[1234]).toBeCloseTo(resampled[1234]!, 3);
    const pieces = splitSamples(new Float32Array(16000 * 30), 16000);
    expect(pieces.map((piece) => piece.length / 16000)).toEqual([14, 14, 2]);
    expect(() => parseWav(new Uint8Array(100))).toThrow(/No es un archivo WAV/);
  });

  it('casos.json: por identificador o con un caso propio; lo que no vale se dice y se salta', () => {
    const folder = tempFolder();
    for (const name of ['sube.wav', 'propio.wav', 'otro.wav', 'nota.txt']) writeFileSync(path.join(folder, name), toneWav(0.5, 16000));
    writeFileSync(
      path.join(folder, 'casos.json'),
      JSON.stringify([
        { archivo: 'sube.wav', caso: 'simple-sube-titulo' },
        { archivo: 'propio.wav', caso: { order: 'Pon de título Paella los domingos', document: 'vacio', expected: [{ op: 'add_text', text: 'Paella los domingos' }], assets: ['terraza', 'no-existe'] } },
        { archivo: 'otro.wav', caso: 'no-existe' },
        { archivo: 'falta.wav', caso: 'simple-sube-titulo' },
        { archivo: 'nota.txt', caso: 'simple-sube-titulo' },
        { archivo: 'sube.wav', caso: { order: 'x', document: 'otro', expected: [] } },
        { caso: 'simple-sube-titulo' },
      ]),
    );
    const { entries, skipped } = readAudioEntries(folder);
    expect(entries.map((entry) => `${entry.file}:${entry.benchCase.id}`)).toEqual(['sube.wav:simple-sube-titulo', 'propio.wav:audio:propio.wav']);
    expect(entries[1]!.benchCase).toMatchObject({ order: 'Pon de título Paella los domingos', document: 'vacio', assets: ['terraza'] });
    expect(skipped).toEqual([
      'otro.wav: no existe el caso «no-existe».',
      'falta.wav: no está en la carpeta.',
      'nota.txt: solo se admiten .wav, .m4a, .webm.',
      'casos.json, entrada 6: «caso» debe ser el id de un caso o { order, document, expected }.',
      'casos.json, entrada 7: falta «archivo».',
    ]);
    // Sin carpeta, sin casos.json o con uno que no es una lista: nada que usar.
    expect(readAudioEntries(path.join(folder, 'no-existe'))).toEqual({ entries: [], skipped: [] });
    const empty = tempFolder();
    expect(readAudioEntries(empty)).toEqual({ entries: [], skipped: [] });
    writeFileSync(path.join(empty, 'casos.json'), '{');
    expect(readAudioEntries(empty).skipped).toEqual(['casos.json no es JSON válido.']);
  });

  it('grabación → ai-transcribe (WAV de 16 kHz en trozos) → copiloto → la misma comparación', async () => {
    const folder = tempFolder();
    // 20 segundos a 44,1 kHz: se manda en dos trozos de 16 kHz.
    writeFileSync(path.join(folder, 'sube-el-titulo.wav'), toneWav(20, 44100));
    writeFileSync(path.join(folder, 'sin-listar.wav'), toneWav(0.5, 16000));
    writeFileSync(path.join(folder, 'movil.m4a'), new Uint8Array([1, 2, 3]));
    writeFileSync(
      path.join(folder, 'casos.json'),
      JSON.stringify([
        { archivo: 'sube-el-titulo.wav', caso: 'simple-sube-titulo' },
        { archivo: 'movil.m4a', caso: 'simple-sube-titulo' },
      ]),
    );
    const service = fakeService({ transcript: 'Sube' });
    const { real, output } = deps(service);
    const report = await runReal({ ...OPTIONS, modes: ['tools'], caseId: 'simple-quita-logo', audioDir: folder }, real);

    const transcribe = service.calls.filter((call) => call.url.endsWith('/functions/v1/ai-transcribe'));
    expect(transcribe).toHaveLength(1);
    expect(transcribe[0]!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, apikey: ANON });
    expect(transcribe[0]!.headers).not.toHaveProperty('content-type');
    const form = transcribe[0]!.body as FormData;
    expect(form.get('brandId')).toBe(BRAND);
    const meta = JSON.parse(String(form.get('meta'))) as { chunks: { seconds: number }[]; language: string; purpose: string };
    expect(meta).toMatchObject({ language: 'es', purpose: 'editor.dictation' });
    expect(meta.chunks.map((chunk) => chunk.seconds)).toEqual([14, 6]);
    for (const chunk of meta.chunks) expect(chunk.seconds).toBeLessThanOrEqual(15);
    const chunk = form.get('chunk-0') as Blob;
    expect(chunk.type).toBe('audio/wav');
    const wav = parseWav(new Uint8Array(await chunk.arrayBuffer()));
    expect(wav.sampleRate).toBe(16000);
    expect(wav.samples).toHaveLength(14 * 16000);
    expect(form.get('chunk-1')).toBeInstanceOf(Blob);
    expect(form.get('chunk-2')).toBeNull();

    // Lo transcrito (los trozos, en su orden) es lo que se manda al copiloto.
    const copilot = service.copilot();
    expect(copilot.map((call) => (call.body as { input: { transcript: string } }).input.transcript)).toEqual(['Quita el logotipo', 'Sube el título.']);
    expect(report.results).toHaveLength(1);
    expect(report.audio).toHaveLength(1);
    expect(report.audio[0]).toMatchObject({ ok: true, group: 'audio', file: 'sube-el-titulo.wav', transcript: 'Sube el título.', caseId: 'simple-sube-titulo' });
    expect(report.exitCode).toBe(0);
    const text = output();
    expect(text).toContain('Se van a hacer 5 llamadas de pago: 1 al copiloto');
    expect(text).toContain('y 4 de audio (2 grabaciones: transcribir y copiloto).');
    expect(text).toContain('Audio, sube-el-titulo.wav: dicho «Sube el título» · transcrito «Sube el título.»');
    expect(text).toContain('Audio: hay grabaciones que no están en casos.json y no se usan: sin-listar.wav');
    // El .m4a: sin ffmpeg se dice; con ffmpeg, este archivo no es sonido y tampoco se puede convertir.
    expect(text).toMatch(/Audio, se salta movil\.m4a: (no es WAV y no hay ffmpeg en el PATH para convertirlo\.|ffmpeg no ha podido convertir la grabación\.)/);
    expect(text).toContain('Grabaciones (transcripción + copiloto), por modelo y ruta');
    expect(text).toMatch(/^sube-el-titulo\.wav\s+tools\s+bien\s+Sube el título\s+Sube el título\.$/m);
    expect(text).not.toContain('CENTINELA');
  });

  it('sin grabaciones, o con una transcripción que no acierta, el modo de audio se salta o lo cuenta como fallo', async () => {
    const empty = tempFolder();
    const service = fakeService();
    const { real, output } = deps(service);
    await runReal({ ...OPTIONS, modes: ['tools'], caseId: 'simple-quita-logo', audioDir: empty }, real);
    expect(output()).toMatch(/Audio: no hay grabaciones que usar en .* Se salta\./);
    expect(service.calls.some((call) => call.url.endsWith('/ai-transcribe'))).toBe(false);
    expect(existsSync(path.join(empty, 'casos.json'))).toBe(false);

    // El transcriptor entiende otra cosa («Suma» por «Sube»): el copiloto responde bien a lo que oye, pero el caso falla.
    const folder = tempFolder();
    writeFileSync(path.join(folder, 'sube.wav'), toneWav(1, 16000));
    writeFileSync(path.join(folder, 'casos.json'), JSON.stringify([{ archivo: 'sube.wav', caso: 'simple-quita-logo' }]));
    const misheard = fakeService({ transcript: 'Suma' });
    const second = deps(misheard);
    const report = await runReal({ ...OPTIONS, modes: ['tools'], caseId: 'simple-guarda', audioDir: folder }, second.real);
    // El caso escrito es local (no se envía); solo va la grabación.
    expect(report.results).toEqual([]);
    expect(report.audio).toHaveLength(1);
    expect(report.audio[0]).toMatchObject({ ok: false, transcript: 'Suma el título.' });
    expect(report.exitCode).toBe(1);
    expect(second.output()).toContain('transcrito: «Suma el título.»');
  });
});

describe('las rutas que prueba el banco', () => {
  it('son las dos del copiloto', () => {
    expect([...BENCH_MODES]).toEqual(['tools', 'json']);
  });
});
