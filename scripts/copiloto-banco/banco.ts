// Banco de pruebas del copiloto del editor: la lógica (el punto de entrada es
// scripts/copiloto-banco.ts; los casos, casos.ts).
//
//   * EN SECO (sin red ni coste): cada caso pasa por la tarea real del servidor
//     (`runEditorCopilot`) con un proveedor simulado que responde exactamente lo
//     esperado, por la ruta de herramientas y por la de JSON, y después por lo
//     que hace el editor (validar la respuesta, quitar lo no dictado y aplicar
//     las operaciones). Dice si el caso se puede ejecutar de principio a fin y
//     cuánto ocupa el prompt en cada ruta.
//   * DE VERDAD (`--apply`): llama a la función desplegada `ai-generate` con la
//     sesión de una persona y compara lo que responde el modelo configurado con
//     lo esperado. Mide aciertos, latencia, tokens y coste.
//   * AUDIO (`--apply --audio carpeta`): grabaciones → `ai-transcribe` → copiloto.
//
// El token de sesión se lee solo del entorno y no se imprime ni se guarda nunca.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyCopilotOperations,
  backgroundImageOf,
  historyActions,
  needsPhotoPick,
  withPickedPhoto,
  type CopilotApplyContext,
  type CopilotAssetInfo,
} from '../../src/features/content/copilot/apply';
import { interpretLocally } from '../../src/features/content/copilot/localCommands';
import {
  COPILOT_LEGACY_OPS,
  dictationWords,
  keepDictated,
  parseCopilotResponse,
  summarizeDocument,
  type CopilotOperation,
} from '../../src/features/content/copilot/operations';
import {
  buildPlan,
  composePlan,
  hasPlanSteps,
  matchLibraryPhotos,
  namesFoodOrProduct,
  planStepCount,
  type LibraryPhoto,
} from '../../src/features/content/copilot/plan';
import { pageView, validateDocument } from '../../src/features/content/document';
import type { AiService, AiToolCall, Json, RpcClient } from '../../supabase/functions/_shared/ai/contract.ts';
import { createAiService } from '../../supabase/functions/_shared/ai/service.ts';
import { countPromptTokens, createSimulatedProvider } from '../../supabase/functions/_shared/ai/simulated-provider.ts';
import { compactDocument, compactPhotos, DONE_TOOL, EDITOR_COPILOT_TOOLS } from '../../supabase/functions/_shared/ai/text/tasks/editor-copilot-tools.ts';
import {
  EDITOR_COPILOT_PURPOSE,
  MAX_TOOL_TURNS,
  readDocumentSummary,
  runEditorCopilot,
  type CopilotMode,
} from '../../supabase/functions/_shared/ai/text/tasks/editor-copilot.ts';
import {
  BENCH_BRAND_PROFILE,
  BENCH_CASES,
  BENCH_DOCUMENT_ASSETS,
  BENCH_DOCUMENT_IDS,
  BENCH_DOCUMENTS,
  BENCH_GENERATED_BACKGROUND,
  BENCH_GROUPS,
  BENCH_LIBRARIES,
  BENCH_LOGO,
  BENCH_PHOTOS,
  type BenchCase,
  type BenchDocumentId,
  type BenchGroup,
  type BenchPhotoId,
  type ExpectedCount,
  type ExpectedOperation,
  type ExpectedValue,
} from './casos.ts';

export const BENCH_MODES: readonly CopilotMode[] = ['tools', 'json'];

// ── Comparación (tolerante y explicada) ──────────────────────────────────

/** Pasos relativos: cuenta el sentido (subir o bajar, agrandar o reducir), no cuántos pasos. */
const SIGN_FIELDS = new Set(['dx', 'dy', 'steps']);
/** Los doce campos que conoce la ruta JSON. */
const JSON_FIELDS = ['target', 'text', 'style', 'assetId', 'position', 'align', 'color', 'font', 'blur', 'dx', 'dy'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const show = (value: unknown): string => (value === undefined ? 'nada' : JSON.stringify(value));

type Scalar = string | number | boolean | null;
const isAnyOf = (value: ExpectedValue): value is { anyOf: Scalar[] } =>
  isObject(value) && Array.isArray((value as { anyOf?: unknown }).anyOf);
const isBetween = (value: ExpectedValue): value is { between: [number, number] } =>
  isObject(value) && Array.isArray((value as { between?: unknown }).between);
const isBackground = (value: ExpectedValue): value is { background: string } =>
  isObject(value) && typeof (value as { background?: unknown }).background === 'string';
const isIncludes = (value: ExpectedValue): value is { includes: string; example: string } =>
  isObject(value) && typeof (value as { includes?: unknown }).includes === 'string';

/** Sin tildes ni mayúsculas, para comparar palabras sueltas. */
const plainText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

function sameScalar(field: string, expected: Scalar, actual: unknown): boolean {
  const got = actual === undefined ? null : actual;
  if (expected === null || got === null) return expected === got;
  if (field === 'text') return typeof got === 'string' && dictationWords(String(expected)) === dictationWords(got);
  if (SIGN_FIELDS.has(field)) {
    return typeof expected === 'number' && typeof got === 'number' && expected !== 0 && Math.sign(expected) === Math.sign(got);
  }
  if (typeof expected === 'string' && typeof got === 'string') {
    // Colores e identificadores de fotos: sin distinguir mayúsculas.
    return field === 'color' || field === 'color2' || field === 'assetId'
      ? expected.toLowerCase() === got.toLowerCase()
      : expected === got;
  }
  return expected === got;
}

/** ¿Vale este valor para lo esperado? */
export function matchesValue(field: string, expected: ExpectedValue, actual: unknown): boolean {
  if (isAnyOf(expected)) return expected.anyOf.some((option) => sameScalar(field, option, actual));
  if (isBetween(expected)) {
    const [min, max] = expected.between;
    return typeof actual === 'number' && actual >= min && actual <= max;
  }
  // La descripción de un fondo la escribe el modelo: vale cualquiera que no nombre comida ni productos.
  if (isBackground(expected)) return typeof actual === 'string' && actual.trim() !== '' && !namesFoodOrProduct(actual);
  if (isIncludes(expected)) return typeof actual === 'string' && plainText(actual).includes(plainText(expected.includes));
  return sameScalar(field, expected, actual);
}

function describeExpected(field: string, expected: ExpectedValue): string {
  if (isAnyOf(expected)) return `uno de ${show(expected.anyOf)}`;
  if (isBetween(expected)) return `entre ${expected.between[0]} y ${expected.between[1]}`;
  if (isBackground(expected)) return 'la descripción de un fondo, sin comida ni productos';
  if (isIncludes(expected)) return `un texto con «${expected.includes}»`;
  if (SIGN_FIELDS.has(field) && typeof expected === 'number') return expected > 0 ? 'un valor positivo' : 'un valor negativo';
  return field === 'text' ? `las palabras de ${show(expected)}` : show(expected);
}

/** Diferencias entre una operación esperada y una recibida (vacío = coincide). */
export function operationProblems(expected: ExpectedOperation, actual: Record<string, unknown>): string[] {
  if (actual.op !== expected.op) return [`se esperaba «${expected.op}» y ha llegado «${String(actual.op)}»`];
  const problems: string[] = [];
  for (const [field, value] of Object.entries(expected)) {
    if (field === 'op') continue;
    if (!matchesValue(field, value, actual[field])) {
      problems.push(`${expected.op}.${field}: se esperaba ${describeExpected(field, value)} y ha llegado ${show(actual[field])}`);
    }
  }
  return problems;
}

export interface Comparison {
  ok: boolean;
  problems: string[];
}

/** Empareja esperadas y recibidas sin importar el orden; `null` si no hay forma. */
function matchAnyOrder(expected: ExpectedOperation[], actual: Record<string, unknown>[]): boolean {
  if (expected.length === 0) return true;
  const [first, ...rest] = expected as [ExpectedOperation, ...ExpectedOperation[]];
  return actual.some(
    (candidate, index) =>
      operationProblems(first, candidate).length === 0 &&
      matchAnyOrder(rest, [...actual.slice(0, index), ...actual.slice(index + 1)]),
  );
}

/**
 * Compara lo recibido con lo esperado. Coinciden si hay las mismas operaciones
 * (ni una de más ni una de menos), con el mismo `op` y los campos clave de cada
 * una; lo que el caso no nombra no se mira. Ver `ExpectedValue` (casos.ts).
 */
export function compareOperations(
  expected: ExpectedOperation[],
  actual: Record<string, unknown>[],
  options: { anyOrder?: boolean } = {},
): Comparison {
  const names = (list: { op: unknown }[]) => (list.length > 0 ? list.map((item) => String(item.op)).join(', ') : 'ninguna');
  if (expected.length !== actual.length) {
    return {
      ok: false,
      problems: [
        `Se esperaban ${expected.length} operaciones (${names(expected)}) y han llegado ${actual.length} (${names(actual as { op: unknown }[])}).`,
      ],
    };
  }
  if (options.anyOrder) {
    if (matchAnyOrder(expected, actual)) return { ok: true, problems: [] };
    // Para explicarlo, se dice qué esperada no tiene pareja.
    const problems = expected
      .filter((item) => !actual.some((candidate) => operationProblems(item, candidate).length === 0))
      .map((item) => `Ninguna operación recibida coincide con la esperada ${show(item)}.`);
    return { ok: false, problems: problems.length > 0 ? problems : ['Las operaciones no se pueden emparejar una a una con las esperadas.'] };
  }
  const problems = expected.flatMap((item, index) =>
    operationProblems(item, actual[index]!).map((problem) => `Operación ${index + 1}: ${problem}.`),
  );
  return { ok: problems.length === 0, problems };
}

/**
 * ¿Es lo recibido una parte de lo esperado? Cada operación recibida coincide con
 * una esperada distinta, pero falta alguna: la orden se quedó a medias (lo
 * hecho estaba bien). Es el fallo de un modelo que llama a una sola herramienta
 * cuando la orden pedía varias cosas.
 */
export function isIncomplete(expected: ExpectedOperation[], received: Record<string, unknown>[]): boolean {
  if (received.length >= expected.length) return false;
  const fits = (pending: Record<string, unknown>[], left: ExpectedOperation[]): boolean => {
    if (pending.length === 0) return true;
    const [first, ...rest] = pending as [Record<string, unknown>, ...Record<string, unknown>[]];
    return left.some(
      (candidate, index) =>
        operationProblems(candidate, first).length === 0 && fits(rest, [...left.slice(0, index), ...left.slice(index + 1)]),
    );
  };
  return fits(received, expected);
}

/**
 * Por qué no acierta una orden:
 *   * `incomplete`: faltó alguna operación esperada (lo recibido era correcto, pero no todo);
 *   * `wrong`: otra capa, otro valor, una operación de más, un texto no dictado o la frase que faltaba;
 *   * `error`: no hubo respuesta que el editor pudiera usar (red, HTTP distinto de 200, fuera del contrato).
 */
export type FailureKind = 'incomplete' | 'wrong' | 'error';

// ── De lo esperado a lo que respondería un modelo perfecto ───────────────

/** Valor concreto para simular: el primero de la lista o el centro del intervalo. */
function simulatedValue(expected: ExpectedValue): Json {
  if (isAnyOf(expected)) return expected.anyOf[0] ?? null;
  if (isBetween(expected)) return Math.round((expected.between[0] + expected.between[1]) / 2);
  if (isBackground(expected)) return expected.background;
  if (isIncludes(expected)) return expected.example;
  return expected;
}

export interface CaseSetup {
  benchCase: BenchCase;
  /** Lo que el editor manda del documento (página activa, elegidas y páginas). */
  summary: ReturnType<typeof summarizeDocument>;
  /** Fotos elegidas para el copiloto, como viajan en la petición. */
  assets: { id: string; name: string }[];
}

export function setupCase(benchCase: BenchCase): CaseSetup {
  const start = BENCH_DOCUMENTS[benchCase.document];
  const summary = summarizeDocument(pageView(start.document, start.pageIndex), {
    selectedIds: start.selectedIds,
    pageIndex: start.pageIndex,
    pageCount: start.document.pages.length,
  });
  const assets = (benchCase.assets ?? []).map((id) => ({ id: BENCH_PHOTOS[id].id, name: BENCH_PHOTOS[id].name }));
  return { benchCase, summary, assets };
}

/** Las llamadas a herramientas que daría un modelo que acierta, con los alias del prompt compacto (c1, f1…). */
export function toolCallsFor(setup: CaseSetup): AiToolCall[] {
  const layerAlias = new Map([...compactDocument(readDocumentSummary(setup.summary)).layerIds].map(([alias, id]) => [id, alias]));
  const photoAlias = new Map([...compactPhotos(setup.assets).photoIds].map(([alias, id]) => [id, alias]));
  return setup.benchCase.expected.map((expected) => {
    const spec = EDITOR_COPILOT_TOOLS.find((tool) => tool.name === expected.op);
    if (!spec) throw new Error(`No hay herramienta para «${expected.op}».`);
    const properties = Object.keys(spec.parameters.properties as Record<string, unknown>);
    const args: Record<string, Json> = {};
    for (const property of properties) {
      const field = property === 'photo' ? 'assetId' : property;
      const value = field in expected ? simulatedValue(expected[field]!) : null;
      if (value === null) args[property] = null;
      else if (property === 'target') args[property] = layerAlias.get(String(value)) ?? String(value);
      else if (property === 'photo') args[property] = photoAlias.get(String(value)) ?? 'f99';
      else args[property] = value;
    }
    const unknown = Object.keys(expected).filter(
      (field) => field !== 'op' && !properties.includes(field === 'assetId' ? 'photo' : field),
    );
    if (unknown.length > 0) throw new Error(`«${expected.op}» no tiene los campos ${unknown.join(', ')}.`);
    return { name: expected.op, arguments: args };
  });
}

const NOTE_FOR_PERSON = '¿A qué te refieres exactamente? Eso no lo puedo hacer así.';
/** Nota de cierre del modelo simulado cuando no hay nada que preguntar. */
const NOTE_DONE = 'Hecho.';

/** La respuesta JSON (ruta anterior) de un modelo que acierta. */
export function jsonAnswerFor(setup: CaseSetup): string {
  const operations = setup.benchCase.expected.map((expected) => {
    const operation: Record<string, Json> = { op: expected.op };
    for (const field of JSON_FIELDS) operation[field] = field in expected ? simulatedValue(expected[field]!) : null;
    return operation;
  });
  return JSON.stringify({ operations, note: setup.benchCase.note ? NOTE_FOR_PERSON : '' });
}

/** ¿Cabe lo esperado en la ruta JSON? (las ocho operaciones y los doce campos de siempre). */
export function fitsJsonRoute(benchCase: BenchCase): boolean {
  return benchCase.expected.every(
    (expected) =>
      (COPILOT_LEGACY_OPS as readonly string[]).includes(expected.op) &&
      Object.keys(expected).every((field) => field === 'op' || JSON_FIELDS.includes(field)),
  );
}

// ── Lo que hace el editor con una respuesta ──────────────────────────────

/** Contexto para aplicar las operaciones, como el del editor: marca, recursos, página y elegidas. */
function applyContext(documentId: BenchDocumentId, photos: BenchPhotoId[]): CopilotApplyContext {
  const start = BENCH_DOCUMENTS[documentId];
  const assets = new Map<string, CopilotAssetInfo>();
  for (const asset of [...BENCH_DOCUMENT_ASSETS, ...photos.map((id) => BENCH_PHOTOS[id])]) assets.set(asset.id, asset);
  return {
    brand: {
      palette: BENCH_BRAND_PROFILE.visual.colors.map((color) => ({ hex: color.hex.toUpperCase(), role: color.role })),
      fonts: BENCH_BRAND_PROFILE.visual.fonts.map((font) => font.family),
    },
    assets,
    logoIds: [BENCH_LOGO],
    pageIndex: start.pageIndex,
    selectedIds: start.selectedIds,
    pageLimits: start.pageLimits,
  };
}

export interface Evaluation {
  ok: boolean;
  problems: string[];
  /** Operaciones que quedan tras validar y quitar lo no dictado (lo que el editor aplicaría). */
  operations: CopilotOperation[];
  note: string;
  /** Si no acierta, por qué (ver `FailureKind`). */
  failure?: FailureKind;
}

/**
 * Evalúa una respuesta de `ai-generate` (o la simulada) contra un caso, haciendo
 * lo mismo que el editor: validar el contrato, quitar los textos no dictados y
 * comparar lo que queda con lo esperado. `transcript` es lo que oyó el copiloto
 * (la orden del caso, o lo transcrito de una grabación).
 */
export function evaluateResponse(benchCase: BenchCase, body: unknown, transcript = benchCase.order): Evaluation {
  const response = parseCopilotResponse(body);
  if (!response) {
    return {
      ok: false,
      problems: ['La respuesta no cumple el contrato del editor: no se aplicaría nada.'],
      operations: [],
      note: '',
      failure: 'error',
    };
  }
  const dictated = keepDictated(response.operations, transcript);
  const comparison = compareOperations(benchCase.expected, dictated.operations, { anyOrder: benchCase.anyOrder });
  const problems = [...comparison.problems];
  if (dictated.removed > 0) problems.push('El editor ha quitado un texto que no estaba en lo dictado.');
  if (benchCase.note && response.note.trim() === '') problems.push('Se esperaba una frase para la persona (una pregunta o lo que no se puede hacer) y no ha llegado.');
  // Órdenes que montan una pieza: se evalúa el PLAN que saldría (sin ejecutar ningún paso).
  if (benchCase.plan) problems.push(...planProblemsFor(benchCase, dictated.operations));
  if (problems.length === 0) return { ok: true, problems, operations: dictated.operations, note: response.note };
  // A medias (faltó algo de lo esperado y lo demás estaba bien) o equivocada.
  const incomplete =
    dictated.removed === 0 && isIncomplete(benchCase.expected, dictated.operations as unknown as Record<string, unknown>[]);
  return {
    ok: false,
    problems,
    operations: dictated.operations,
    note: response.note,
    failure: incomplete ? 'incomplete' : 'wrong',
  };
}

const inCount = (expected: ExpectedCount, actual: number) =>
  typeof expected === 'number' ? actual === expected : actual >= expected[0] && actual <= expected[1];
const showCount = (expected: ExpectedCount) => (typeof expected === 'number' ? String(expected) : `entre ${expected[0]} y ${expected[1]}`);

/**
 * Evalúa el PLAN de una orden que monta una pieza, con el mismo código que usa
 * el editor (plan.ts) y sin gastar nada: el banco NO genera imágenes, NO
 * recorta y NO llama a `ai-media`. Comprueba que ningún fondo nombra comida ni
 * productos, que el plan se puede ejecutar, cuántos pasos tiene, que las fotos
 * salen de la biblioteca (`find_photos`) y no de la generación, y que al
 * componerlo queda un documento válido con cada cosa en su sitio.
 */
export function planProblemsFor(benchCase: BenchCase, operations: CopilotOperation[]): string[] {
  const expected = benchCase.plan;
  if (!expected) return [];
  const problems: string[] = [];
  const start = BENCH_DOCUMENTS[benchCase.document];
  const library: readonly LibraryPhoto[] = BENCH_LIBRARIES[expected.library];
  const chosen = (benchCase.assets ?? []).map((id) => BENCH_PHOTOS[id]);

  // 1. La IA solo crea el fondo: ninguna descripción de fondo nombra comida ni productos.
  for (const operation of operations) {
    if (operation.op === 'generate_background' && namesFoodOrProduct(operation.prompt ?? '')) {
      problems.push(`El fondo nombra comida o un producto («${(operation.prompt ?? '').slice(0, 80)}»): la IA solo crea el fondo.`);
    }
  }
  const generates = operations.some((operation) => operation.op === 'generate_background');
  if (!expected.background && generates) problems.push('No se esperaba generar nada y la respuesta trae un `generate_background`.');
  if (expected.background && !hasPlanSteps(operations)) problems.push('Se esperaba un plan (pasos de fondo y fotos) y la respuesta no trae ninguno.');

  // 2. El plan, como lo construye el editor (con IA de imagen disponible y recorte posible).
  const context = applyContext(benchCase.document, benchCase.assets ?? []);
  const plan = buildPlan(operations, {
    canvasRatio: start.document.canvas.aspectRatio,
    imageAi: { available: true },
    palette: context.brand.palette,
    canCutout: true,
  });
  for (const blocker of plan.blockers) problems.push(`El plan no se podría ejecutar: ${blocker}`);
  if (expected.background !== (plan.background?.mode === 'ai')) {
    problems.push(expected.background ? 'El plan no lleva fondo con IA y se esperaba.' : 'El plan lleva un fondo con IA y no se esperaba.');
  }

  // 3. Las fotos salen de la biblioteca (o de las elegidas a mano), nunca de la generación.
  const photos: LibraryPhoto[] = [];
  for (const search of plan.searches) {
    for (const found of matchLibraryPhotos(library, search.query, search.count)) {
      if (photos.length < 6 && !photos.some((photo) => photo.id === found.id)) photos.push(found);
    }
  }
  if (plan.placement && plan.searches.length === 0) photos.push(...chosen);
  if (photos.length > 0 && !plan.placement) problems.push('Hay fotos buscadas, pero el plan no dice cómo colocarlas.');
  if (!inCount(expected.photos, photos.length)) {
    problems.push(`Se esperaban ${showCount(expected.photos)} fotos de la biblioteca y el plan colocaría ${photos.length}.`);
  }
  const steps = planStepCount(plan, photos.length);
  if (!inCount(expected.steps, steps)) problems.push(`Se esperaban ${showCount(expected.steps)} pasos y el plan tiene ${steps}.`);
  // Sobre un fondo de imagen las fotos van recortadas aunque la respuesta no lo pida: lo fija el editor.
  if (expected.cutout !== undefined && plan.placement && plan.placement.cutout !== expected.cutout) {
    problems.push(
      expected.cutout
        ? 'Se esperaba que las fotos fuesen recortadas (van sobre un fondo de imagen) y el plan las coloca enteras.'
        : 'Se esperaba que las fotos fuesen enteras y el plan las recorta.',
    );
  }

  // 4. Lo que quedaría en el documento: fondo (el generado, si lo hay), una capa por foto de la biblioteca y los textos.
  const background = plan.background?.mode === 'ai' ? BENCH_GENERATED_BACKGROUND : null;
  const assets = new Map(context.assets);
  for (const asset of [...photos, ...(background ? [background] : [])]) assets.set(asset.id, asset);
  const composed = composePlan(plan, { background, photos }, start.document, { ...context, assets });
  const result = applyCopilotOperations(start.document, composed.operations, { ...context, assets });
  if (!result.ok) return [...problems, `El documento resultante no sería válido: ${JSON.stringify(result.issues).slice(0, 200)}`];
  if (!validateDocument(result.document).ok) problems.push('El documento resultante no pasa su esquema.');
  for (const reason of result.skipped) problems.push(`El editor se ha saltado algo: ${reason}`);
  const sources = pageView(result.document, result.pageIndex).layers.flatMap((layer) =>
    layer.type === 'image' && layer.source.kind === 'asset' ? [layer.source.assetId] : [],
  );
  const before = new Set(
    pageView(start.document, start.pageIndex).layers.flatMap((layer) => (layer.type === 'image' && layer.source.kind === 'asset' ? [layer.source.assetId] : [])),
  );
  const allowed = new Set([...library, ...chosen].map((photo) => photo.id));
  const placed = sources.filter((id) => id !== background?.id && !before.has(id));
  if (placed.length !== photos.length) problems.push(`Se esperaba una capa por foto (${photos.length}) y hay ${placed.length}.`);
  if (placed.some((id) => !allowed.has(id))) problems.push('Alguna foto colocada no es de la biblioteca.');
  if (background && sources.filter((id) => id === background.id).length !== 1) problems.push('El fondo generado no ha quedado como foto de fondo.');
  return problems;
}

/** Aplica las operaciones al documento de partida del caso, como el editor. Devuelve los problemas. */
export function applyProblems(benchCase: BenchCase, operations: CopilotOperation[]): string[] {
  const start = BENCH_DOCUMENTS[benchCase.document];
  const photos = benchCase.assets ?? [];
  // «Esta foto» sin ninguna elegida: el editor la pide; aquí se da por elegida una.
  const picked = needsPhotoPick(operations) ? withPickedPhoto(operations, BENCH_PHOTOS.canas.id) : operations;
  const result = applyCopilotOperations(start.document, picked, applyContext(benchCase.document, [...photos, 'canas']));
  if (!result.ok) return [`El documento resultante no sería válido: ${JSON.stringify(result.issues).slice(0, 200)}`];
  const problems = result.skipped.map((reason) => `El editor se ha saltado algo: ${reason}`);
  if (!validateDocument(result.document).ok) problems.push('El documento resultante no pasa su esquema.');
  const done = result.changes.length + result.flows.length + result.after.length + historyActions(picked).length;
  if (benchCase.expected.length > 0 && done === 0) problems.push('Las operaciones no han tenido ningún efecto en el editor.');
  if (benchCase.expected.length === 0 && result.document !== start.document) problems.push('No se esperaba ningún cambio y el documento ha cambiado.');
  if (benchCase.pagesAfter) {
    // Las páginas del documento final: una copia lleva las mismas capas que la original, con otros identificadores.
    const shape = (layers: readonly object[]) =>
      JSON.stringify(layers.map((layer) => ({ ...layer, id: undefined, groupId: undefined })));
    const original = shape(start.document.pages[start.pageIndex]!.layers);
    const pages = result.document.pages;
    const same = pages.filter((page) => shape(page.layers) === original).length;
    const found = {
      total: pages.length,
      // La original sigue estando: las demás con sus mismas capas son copias.
      copiesOfStart: Math.max(0, same - 1),
      empty: pages.filter((page) => page.layers.length === 0).length,
    };
    const wanted = benchCase.pagesAfter;
    if (same === 0) problems.push('La página de la que se partía ya no está tal como era.');
    if (found.total !== wanted.total) problems.push(`Se esperaban ${wanted.total} páginas y quedan ${found.total}.`);
    if (found.copiesOfStart !== wanted.copiesOfStart) {
      problems.push(`Se esperaban ${wanted.copiesOfStart} copias de la página de partida (con sus capas) y hay ${found.copiesOfStart}.`);
    }
    if (found.empty !== wanted.empty) problems.push(`Se esperaban ${wanted.empty} páginas vacías y hay ${found.empty}.`);
  }
  return problems;
}

// ── En seco ──────────────────────────────────────────────────────────────

/** Servicio de IA sin base de datos: reserva y registro de mentira, y el proveedor que se le dé. */
function offlineService(respond: Parameters<typeof createSimulatedProvider>[0]): {
  service: AiService;
  provider: ReturnType<typeof createSimulatedProvider>;
} {
  const provider = createSimulatedProvider(respond);
  const rpc: RpcClient = async (fn) =>
    fn === 'ai_reserve_generation' ? { data: { id: randomUUID() }, error: null } : { data: null, error: null };
  const service = createAiService({
    rpc,
    providers: [provider],
    models: [
      { provider: provider.id, model: 'banco-en-seco', task: 'text', microsPerUnit: { input_tokens: 0, output_tokens: 0 } },
    ],
  });
  return { service, provider };
}

export interface PromptTokens {
  total: number;
  stable: number;
  volatile: number;
}

export interface DryResult {
  caseId: string;
  group: BenchGroup;
  /**
   * `local` = la comprobación del intérprete local (sin IA). `turns` = por
   * herramientas, con un modelo que llama DE UNA EN UNA y espera el resultado de
   * cada herramienta (el servidor le devuelve «hecho» y le deja seguir).
   */
  mode: CopilotMode | 'local' | 'turns';
  ok: boolean;
  /** La ruta JSON no puede expresar el caso: no se ejecuta por ella. */
  notExpressible?: boolean;
  problems: string[];
  tokens?: PromptTokens;
  /** Peticiones al modelo que ha hecho falta (vueltas). */
  turns?: number;
}

/** ¿Resuelve el intérprete local el caso como dice su `local`? */
export function checkLocal(benchCase: BenchCase): DryResult {
  const start = BENCH_DOCUMENTS[benchCase.document];
  const view = pageView(start.document, start.pageIndex);
  const background = backgroundImageOf(view);
  const local = interpretLocally(benchCase.order, {
    layers: view.layers.map((layer) => ({
      id: layer.id,
      type: layer.type,
      ...(layer.locked ? { locked: true } : {}),
      ...(layer.type === 'image' ? { blur: layer.blur ?? 0, background: layer.id === background?.id } : {}),
    })),
    selectedIds: [...start.selectedIds],
    pageIndex: start.pageIndex,
    pageCount: start.document.pages.length,
  });
  const problems: string[] = [];
  if (benchCase.local) {
    if (!local) problems.push('Se esperaba que el intérprete local la resolviera sin IA y la manda al modelo.');
    else if (local.kind !== 'operations') problems.push(`El intérprete local responde con una nota («${local.note}») y se esperaban operaciones.`);
    else {
      problems.push(...compareOperations(benchCase.expected, local.operations, { anyOrder: benchCase.anyOrder }).problems);
      problems.push(...applyProblems(benchCase, local.operations));
    }
  } else if (local) {
    problems.push(
      local.kind === 'operations'
        ? `El intérprete local la resuelve sin IA (${local.operations.map((operation) => operation.op).join(', ')}) y el caso dice que va al modelo.`
        : `El intérprete local responde sin IA («${local.note}») y el caso dice que va al modelo.`,
    );
  }
  return { caseId: benchCase.id, group: benchCase.group, mode: 'local', ok: problems.length === 0, problems };
}

/**
 * Lo que respondería `ai-generate` a un caso si el modelo acertase de lleno: la
 * tarea real del servidor con un proveedor simulado que contesta lo esperado.
 * Sin red, sin base de datos y sin coste.
 */
export async function simulateServer(
  benchCase: BenchCase,
  mode: CopilotMode,
  options: { stepwise?: boolean } = {},
): Promise<{ body: Record<string, unknown>; mode: CopilotMode; tokens?: PromptTokens; turns: number }> {
  const setup = setupCase(benchCase);
  // La respuesta se prepara antes: un caso mal escrito falla aquí, con su motivo, y no como «fallo del proveedor».
  const calls = mode === 'tools' ? toolCallsFor(setup) : [];
  const json = mode === 'json' ? jsonAnswerFor(setup) : '';
  // Por herramientas, el modelo cierra con `done` y su nota para la persona.
  const closing: AiToolCall = { name: DONE_TOOL, arguments: { note: benchCase.note ? NOTE_FOR_PERSON : NOTE_DONE } };
  const { service, provider } = offlineService(
    mode === 'json'
      ? { respond: () => json }
      : options.stepwise
        ? {
            // De una en una: en cada vuelta, la siguiente llamada; cuando no quedan, el cierre.
            toolTurns: true,
            respond: (request) => ({ text: '', tool_calls: [calls[request.input.toolTurns?.length ?? 0] ?? closing] }),
          }
        : // Lo normal: todas las llamadas y el cierre en una sola respuesta.
          { respond: () => ({ text: '', tool_calls: [...calls, closing] }) },
  );
  const result = await runEditorCopilot(
    service,
    { userId: randomUUID(), brandId: randomUUID() },
    { brandProfile: BENCH_BRAND_PROFILE as unknown as Json, transcript: benchCase.order, document: setup.summary, assets: setup.assets, mode },
  );
  return {
    // Lo que recibe el navegador: sin ruta, consumo ni coste.
    body: {
      action: 'editor.copilot',
      generationId: result.generationId,
      operations: result.operations,
      discarded: result.discarded,
      note: result.note,
    },
    mode: result.mode,
    tokens: provider.calls[0] ? countPromptTokens(provider.calls[0].input) : undefined,
    turns: provider.calls.length,
  };
}

/**
 * ¿Cabe el caso con un modelo que llama de una en una? El servidor hace como
 * mucho `MAX_TOOL_TURNS` vueltas: caben esas operaciones (y, si se espera una
 * frase para la persona, una menos: el cierre va en su propia vuelta).
 */
export function fitsStepwise(benchCase: BenchCase): boolean {
  const room = benchCase.note ? MAX_TOOL_TURNS - 1 : MAX_TOOL_TURNS;
  return benchCase.expected.length >= 2 && benchCase.expected.length <= room;
}

/** Un caso por una ruta, de principio a fin y sin red: tarea del servidor → editor. */
export async function dryRunCase(
  benchCase: BenchCase,
  mode: CopilotMode,
  options: { stepwise?: boolean } = {},
): Promise<DryResult> {
  const stepwise = mode === 'tools' && options.stepwise === true;
  const base = { caseId: benchCase.id, group: benchCase.group, mode: stepwise ? ('turns' as const) : mode };
  if (mode === 'json' && !benchCase.json) {
    // Si el caso dice que la ruta JSON no puede, no se intenta (y si cupiese, da igual: puede depender de lo elegido).
    return { ...base, ok: true, notExpressible: true, problems: [] };
  }
  if (mode === 'json' && !fitsJsonRoute(benchCase)) {
    return { ...base, ok: false, problems: ['El caso dice `json: true`, pero usa operaciones o campos que la ruta JSON no tiene.'] };
  }
  try {
    const simulated = await simulateServer(benchCase, mode, { stepwise });
    const problems: string[] = [];
    if (simulated.mode !== mode) problems.push(`Se pidió la ruta «${mode}» y se ha usado «${simulated.mode}».`);
    // Una vuelta si el modelo lo llama todo junto; de una en una, una por operación y otra para cerrar (con tope).
    const turns = mode === 'json' || !stepwise ? 1 : Math.min(MAX_TOOL_TURNS, benchCase.expected.length + 1);
    if (simulated.turns !== turns) problems.push(`Se esperaban ${turns} vueltas y ha habido ${simulated.turns}.`);
    for (const item of simulated.body.discarded as { op: string; reason: string }[]) {
      problems.push(`El servidor ha descartado «${item.op}»: ${item.reason}`);
    }
    const evaluation = evaluateResponse(benchCase, simulated.body);
    problems.push(...evaluation.problems);
    // Un plan no se aplica tal cual: ya se ha evaluado, compuesto y aplicado en `planProblemsFor`.
    if (evaluation.problems.length === 0 && !benchCase.plan) problems.push(...applyProblems(benchCase, evaluation.operations));
    return { ...base, ok: problems.length === 0, problems, tokens: simulated.tokens, turns: simulated.turns };
  } catch (error) {
    return { ...base, ok: false, problems: [`Error al ejecutar el caso: ${error instanceof Error ? error.message : 'desconocido'}`] };
  }
}

export interface DryReport {
  results: DryResult[];
  ok: boolean;
}

/** Todos los casos, por las rutas pedidas, más la comprobación del intérprete local. */
export async function dryRun(cases: BenchCase[] = BENCH_CASES, modes: readonly CopilotMode[] = BENCH_MODES): Promise<DryReport> {
  const results: DryResult[] = [];
  const seen = new Set<string>();
  for (const benchCase of cases) {
    if (seen.has(benchCase.id)) {
      results.push({ caseId: benchCase.id, group: benchCase.group, mode: 'local', ok: false, problems: ['Identificador de caso repetido.'] });
      continue;
    }
    seen.add(benchCase.id);
    results.push(checkLocal(benchCase));
    for (const mode of modes) results.push(await dryRunCase(benchCase, mode));
    // Variante de una en una (el bucle de vueltas del servidor), en lo que cabe en sus vueltas.
    if (modes.includes('tools') && fitsStepwise(benchCase)) results.push(await dryRunCase(benchCase, 'tools', { stepwise: true }));
  }
  return { results, ok: results.every((result) => result.ok) };
}

const mean = (values: number[]) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const round = (value: number | null, digits = 0) => (value === null ? '—' : value.toFixed(digits));

/** Tabla de texto con las columnas alineadas. */
export function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd()).join('\n');
}

export function formatDryReport(report: DryReport, cases: BenchCase[] = BENCH_CASES, options: { detail?: boolean } = {}): string {
  const lines: string[] = [];
  const byMode = (mode: DryResult['mode']) => report.results.filter((result) => result.mode === mode);
  const groups = BENCH_GROUPS.filter((name) => name === 'plan' || cases.some((item) => item.group === name));
  lines.push('Casos por grupo');
  lines.push(
    table([
      ['grupo', 'casos', 'los resuelve el intérprete local (sin IA)', 'la ruta JSON no puede expresarlos'],
      ...groups.map((name) => {
        const own = cases.filter((item) => item.group === name);
        return [name, String(own.length), String(own.filter((item) => item.local).length), String(own.filter((item) => !item.json).length)];
      }),
      ['TOTAL', String(cases.length), String(cases.filter((item) => item.local).length), String(cases.filter((item) => !item.json).length)],
    ]),
  );
  lines.push('');
  lines.push('Tokens de entrada por ruta (contador aproximado: 1 token = 4 caracteres; «estable» = lo que no cambia entre peticiones y se puede leer de caché)');
  const tokenRows = [['ruta', 'casos', 'total (media)', 'estable (media)', 'variable (media)', 'variable (máx.)']];
  for (const mode of BENCH_MODES) {
    const measured = byMode(mode).flatMap((result) => (result.tokens ? [result.tokens] : []));
    if (measured.length === 0) continue;
    tokenRows.push([
      mode,
      String(measured.length),
      round(mean(measured.map((item) => item.total))),
      round(mean(measured.map((item) => item.stable))),
      round(mean(measured.map((item) => item.volatile))),
      String(Math.max(...measured.map((item) => item.volatile))),
    ]);
  }
  lines.push(table(tokenRows));
  const notExpressible = report.results.filter((result) => result.notExpressible).map((result) => result.caseId);
  if (notExpressible.length > 0) {
    lines.push('');
    lines.push(`La ruta JSON no puede expresar ${notExpressible.length} casos: ${notExpressible.join(', ')}`);
  }
  if (options.detail) {
    lines.push('');
    lines.push('Caso a caso');
    lines.push(
      table([
        ['caso', 'ruta', 'resultado', 'tokens (total/estable/variable)'],
        ...report.results.map((result) => [
          result.caseId,
          result.mode,
          result.notExpressible ? 'no expresable' : result.ok ? (result.mode === 'turns' ? `bien (${result.turns} vueltas)` : 'bien') : 'FALLO',
          result.tokens ? `${result.tokens.total}/${result.tokens.stable}/${result.tokens.volatile}` : '',
        ]),
      ]),
    );
  }
  const stepwise = byMode('turns');
  if (stepwise.length > 0) {
    const several = cases.filter((item) => item.expected.length >= 2);
    const tooMany = several.filter((item) => !fitsStepwise(item)).map((item) => item.id);
    lines.push('');
    lines.push(
      `Varias acciones en una orden: ${several.length} casos piden dos o más. Lo normal es que el modelo las llame todas en una respuesta y cierre con «done» (una vuelta). ` +
        `Si las llama de una en una (espera el resultado de cada una), el servidor le deja seguir hasta ${MAX_TOOL_TURNS} vueltas: así se han probado ${stepwise.length} casos de entre 2 y ${MAX_TOOL_TURNS} acciones.` +
        (tooMany.length > 0
          ? ` Con un modelo así NO cabrían enteros ${tooMany.length} casos (más acciones que vueltas): ${tooMany.join(', ')}.`
          : ''),
    );
  }
  const plans = cases.filter((item) => item.plan).length;
  if (plans > 0) {
    lines.push('');
    lines.push(
      `Planes (órdenes que montan una pieza): ${plans} casos. Se evalúa el plan que saldría (pasos, fondo sin comida ni productos, fotos de la biblioteca, disposición y titular) y el documento que quedaría; el banco no genera imágenes ni recorta.`,
    );
  }
  const failures = report.results.filter((result) => !result.ok);
  lines.push('');
  if (failures.length === 0) {
    lines.push(`En seco: los ${cases.length} casos cuadran de principio a fin (intérprete local, servidor y editor).`);
  } else {
    lines.push(`En seco: ${failures.length} comprobaciones NO cuadran:`);
    for (const failure of failures) {
      lines.push(`  - ${failure.caseId} [${failure.mode}]`);
      for (const problem of failure.problems) lines.push(`      ${problem}`);
    }
  }
  return lines.join('\n');
}

// ── De verdad: configuración y secretos ──────────────────────────────────

export class BenchConfigError extends Error {
  override name = 'BenchConfigError';
}

export interface RealConfig {
  url: string;
  anonKey: string;
  token: string;
  brandId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REAL_ENV = ['COPILOTO_BANCO_URL', 'COPILOTO_BANCO_ANON_KEY', 'COPILOTO_BANCO_TOKEN', 'COPILOTO_BANCO_BRAND'] as const;

/** Lee la configuración del entorno. Los mensajes de error nombran las variables, nunca sus valores. */
export function readRealConfig(env: Record<string, string | undefined>): RealConfig {
  const missing = REAL_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new BenchConfigError(
      `Para llamar al servicio real faltan estas variables de entorno: ${missing.join(', ')}. No se ha hecho ninguna llamada.`,
    );
  }
  const url = env.COPILOTO_BANCO_URL!.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BenchConfigError('COPILOTO_BANCO_URL no es una dirección válida.');
  }
  const local = ['127.0.0.1', 'localhost'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new BenchConfigError('COPILOTO_BANCO_URL debe empezar por https:// (solo se admite http en local).');
  }
  if (parsed.username || parsed.password || parsed.search) {
    throw new BenchConfigError('COPILOTO_BANCO_URL no puede llevar usuario, contraseña ni parámetros.');
  }
  const brandId = env.COPILOTO_BANCO_BRAND!.trim();
  if (!UUID.test(brandId)) throw new BenchConfigError('COPILOTO_BANCO_BRAND debe ser el identificador (uuid) de la marca.');
  return { url, anonKey: env.COPILOTO_BANCO_ANON_KEY!.trim(), token: env.COPILOTO_BANCO_TOKEN!.trim(), brandId };
}

/** Quita de un texto los secretos (el token y la clave), por si un error los citase. */
export function redactor(secrets: string[]): (text: string) => string {
  const known = secrets.filter((secret) => secret.length >= 4);
  return (text) => known.reduce((clean, secret) => clean.split(secret).join('***'), text);
}

// ── De verdad: resultados y agregados ────────────────────────────────────

export interface BenchResult {
  caseId: string;
  group: BenchGroup | 'audio';
  mode: CopilotMode;
  repetition: number;
  ok: boolean;
  problems: string[];
  /** Si no acierta, por qué: a medias, equivocada o sin respuesta válida. */
  failure?: FailureKind;
  /** Código HTTP de `ai-generate` (0 = sin respuesta). */
  status: number;
  /** De extremo a extremo, medido aquí. */
  e2eMs: number;
  generationId: string | null;
  /** Lo que dice `ai_generations` de la llamada; null si no se ha podido leer. */
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Millonésimas de la moneda de cuenta de la plataforma. */
  costMicros: number | null;
  /**
   * Por herramientas: ¿llamó el modelo al cierre (`done`) en su PRIMERA respuesta?
   * Sale de la primera generación (la del `generationId`). `false` = se quedó
   * esperando y, si el adaptador lo admite, hubo más vueltas (cada una, otra
   * generación que el banco no ve). null = no se sabe (ruta JSON, o no se pudo leer).
   */
  closedFirstTurn?: boolean | null;
  expected: ExpectedOperation[];
  /** Operaciones recibidas (solo `op` y los campos con valor). */
  received: Record<string, unknown>[];
  note: string;
  /** Audio: el archivo y lo transcrito. */
  file?: string;
  transcript?: string;
}

/** Percentil por el método del rango más cercano; null sin datos. */
export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export interface Aggregate {
  mode: CopilotMode;
  /** `proveedor/modelo` que atendió las llamadas, o «desconocido». */
  model: string;
  total: number;
  hits: number;
  /** Aciertos, en tanto por ciento (0-100). */
  hitRate: number;
  /** Faltó alguna operación esperada. */
  incomplete: number;
  /** Otra capa, otro valor, una operación de más o la frase que faltaba. */
  wrong: number;
  /** Sin respuesta que el editor pudiera usar. */
  errors: number;
  /** Órdenes de las que se sabe si el modelo cerró en la primera respuesta, y cuántas lo hicieron. */
  closedKnown: number;
  closedFirst: number;
  serverP50: number | null;
  serverP95: number | null;
  e2eP50: number | null;
  e2eP95: number | null;
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  meanCacheReadTokens: number | null;
  meanCostMicros: number | null;
  totalCostMicros: number;
  failures: BenchResult[];
}

const numbers = (values: (number | null)[]) => values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

/** Por qué falla un resultado (también los guardados antes de que se anotase). */
export function failureOf(result: Pick<BenchResult, 'ok' | 'failure' | 'status' | 'expected' | 'received'>): FailureKind | null {
  if (result.ok) return null;
  if (result.failure) return result.failure;
  if (result.status !== 200) return 'error';
  return isIncomplete(result.expected, result.received) ? 'incomplete' : 'wrong';
}

/** Agrupa los resultados por ruta y modelo: aciertos, latencias, tokens y coste. */
export function aggregateResults(results: BenchResult[]): Aggregate[] {
  const groups = new Map<string, BenchResult[]>();
  for (const result of results) {
    const model = result.provider && result.model ? `${result.provider}/${result.model}` : 'desconocido';
    const key = `${result.mode}\u0000${model}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const [mode, model] = key.split('\u0000') as [CopilotMode, string];
      const hits = items.filter((item) => item.ok).length;
      const costs = numbers(items.map((item) => item.costMicros));
      const kinds = items.map((item) => failureOf(item));
      const closed = items.filter((item) => typeof item.closedFirstTurn === 'boolean');
      return {
        mode,
        model,
        total: items.length,
        hits,
        hitRate: items.length > 0 ? (hits / items.length) * 100 : 0,
        incomplete: kinds.filter((kind) => kind === 'incomplete').length,
        wrong: kinds.filter((kind) => kind === 'wrong').length,
        errors: kinds.filter((kind) => kind === 'error').length,
        closedKnown: closed.length,
        closedFirst: closed.filter((item) => item.closedFirstTurn === true).length,
        serverP50: percentile(numbers(items.map((item) => item.latencyMs)), 50),
        serverP95: percentile(numbers(items.map((item) => item.latencyMs)), 95),
        e2eP50: percentile(items.map((item) => item.e2eMs), 50),
        e2eP95: percentile(items.map((item) => item.e2eMs), 95),
        meanInputTokens: mean(numbers(items.map((item) => item.inputTokens))),
        meanOutputTokens: mean(numbers(items.map((item) => item.outputTokens))),
        meanCacheReadTokens: mean(numbers(items.map((item) => item.cacheReadTokens))),
        meanCostMicros: mean(costs),
        totalCostMicros: costs.reduce((sum, value) => sum + value, 0),
        failures: items.filter((item) => !item.ok),
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.mode.localeCompare(b.mode));
}

const money = (micros: number | null) => (micros === null ? '—' : (micros / 1_000_000).toFixed(6));

export function formatAggregates(aggregates: Aggregate[], options: { failures?: boolean } = {}): string {
  if (aggregates.length === 0) return 'Sin resultados.';
  const lines = [
    table([
      [
        'modelo',
        'ruta',
        'aciertos',
        '%',
        'órdenes incompletas',
        'equivocadas',
        'errores',
        'cerradas en la 1.ª vuelta',
        'lat. servidor p50/p95 (ms)',
        'extremo a extremo p50/p95 (ms)',
        'entrada sin caché',
        'leídos de caché',
        'salida',
        'coste medio',
        'coste total',
      ],
      ...aggregates.map((item) => [
        item.model,
        item.mode,
        `${item.hits}/${item.total}`,
        item.hitRate.toFixed(1),
        String(item.incomplete),
        String(item.wrong),
        String(item.errors),
        item.closedKnown > 0 ? `${item.closedFirst}/${item.closedKnown}` : '—',
        `${round(item.serverP50)}/${round(item.serverP95)}`,
        `${round(item.e2eP50)}/${round(item.e2eP95)}`,
        round(item.meanInputTokens),
        round(item.meanCacheReadTokens),
        round(item.meanOutputTokens),
        money(item.meanCostMicros),
        money(item.totalCostMicros),
      ]),
    ]),
    'Tokens: medias por llamada. Coste: en la moneda de cuenta de la plataforma, según `ai_generations` («—» = no se ha podido leer).',
    'Órdenes incompletas: faltó alguna operación esperada (lo recibido era correcto, pero no todo). Equivocadas: otra capa, otro valor, una operación de más, un texto no dictado o la frase que faltaba. Errores: sin respuesta que el editor pudiera usar.',
    `Coste, tokens y latencia del servidor son los de la PRIMERA generación de cada orden (la del \`generationId\`). Por herramientas, una orden puede ser de varias generaciones (una por vuelta, hasta ${MAX_TOOL_TURNS}) y el banco solo ve la primera: el coste real de las órdenes que no cerraron a la primera es mayor. «Cerradas en la 1.ª vuelta» sale de esa primera generación (¿llamó a «done»?); cuántas vueltas más hubo no se puede saber desde fuera. La latencia de extremo a extremo sí las incluye todas.`,
  ];
  if (options.failures !== false) {
    for (const item of aggregates) {
      if (item.failures.length === 0) continue;
      lines.push('');
      lines.push(`Fallos de ${item.model} por «${item.mode}» (${item.failures.length}):`);
      for (const failure of item.failures) {
        const kind = failureOf(failure);
        const label = kind === 'incomplete' ? ' [incompleta]' : kind === 'wrong' ? ' [equivocada]' : '';
        lines.push(`  - ${failure.caseId}${failure.file ? ` (${failure.file})` : ''}${failure.status !== 200 ? ` [HTTP ${failure.status}]` : ''}${label}`);
        for (const problem of failure.problems) lines.push(`      ${problem}`);
        lines.push(`      esperado: ${JSON.stringify(failure.expected)}`);
        lines.push(`      recibido: ${JSON.stringify(failure.received)}${failure.note ? ` · nota: «${failure.note}»` : ''}`);
        if (failure.transcript !== undefined) lines.push(`      transcrito: «${failure.transcript}»`);
      }
    }
  }
  return lines.join('\n');
}

// ── De verdad: llamadas ──────────────────────────────────────────────────

export interface RealOptions {
  modes: CopilotMode[];
  group?: BenchGroup;
  caseId?: string;
  repetitions: number;
  pauseMs: number;
  /** Archivo JSON donde se acumulan los resultados entre ejecuciones (para comparar modelos). */
  output?: string;
  /** Enviar también los casos que resuelve el intérprete local (cuestan). */
  includeLocal: boolean;
  /** No preguntar antes de empezar. */
  yes: boolean;
  /** Carpeta de grabaciones con su `casos.json`. */
  audioDir?: string;
  /** Precio por millón de tokens de entrada y de salida, para estimar el coste antes de empezar. */
  priceIn?: number;
  priceOut?: number;
}

export interface RealDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Pregunta a la persona; true = seguir. */
  confirm: (question: string) => Promise<boolean>;
  now: () => number;
}

export function selectCases(options: Pick<RealOptions, 'group' | 'caseId'>, cases: BenchCase[] = BENCH_CASES): BenchCase[] {
  return cases.filter((item) => (!options.group || item.group === options.group) && (!options.caseId || item.id === options.caseId));
}

/** Operación recibida, sin los campos a null (para guardarla y enseñarla). */
const compactOperation = (operation: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(operation).filter(([, value]) => value !== null && value !== undefined));

interface GenerationRow {
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costMicros: number | null;
  closedFirstTurn: boolean | null;
}
const NO_GENERATION: GenerationRow = {
  provider: null,
  model: null,
  latencyMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  costMicros: null,
  closedFirstTurn: null,
};

const numberOrNull = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

/**
 * Lee de `ai_generations` el modelo real, el consumo, el coste y la latencia de UNA generación (la
 * RLS deja a quien edita la marca), y si el modelo cerró con `done` en esa respuesta. Es la primera
 * vuelta de la orden: las siguientes, si las hubo, son otras generaciones que no se conocen desde fuera.
 */
async function readGeneration(config: RealConfig, deps: RealDeps, generationId: string): Promise<GenerationRow> {
  try {
    const response = await deps.fetch(
      `${config.url}/rest/v1/ai_generations?id=eq.${encodeURIComponent(generationId)}&select=provider,model,usage,cost_micros,latency_ms,output`,
      { headers: { authorization: `Bearer ${config.token}`, apikey: config.anonKey, accept: 'application/json' } },
    );
    if (!response.ok) return NO_GENERATION;
    const rows = (await response.json()) as unknown;
    const row = Array.isArray(rows) && isObject(rows[0]) ? rows[0] : null;
    if (!row) return NO_GENERATION;
    const usage = isObject(row.usage) ? row.usage : {};
    const toolCalls = isObject(row.output) && Array.isArray(row.output.tool_calls) ? row.output.tool_calls : null;
    return {
      provider: typeof row.provider === 'string' ? row.provider : null,
      model: typeof row.model === 'string' ? row.model : null,
      latencyMs: numberOrNull(row.latency_ms),
      inputTokens: numberOrNull(usage.input_tokens),
      outputTokens: numberOrNull(usage.output_tokens),
      cacheReadTokens: numberOrNull(usage.cache_read_input_tokens),
      cacheWriteTokens: numberOrNull(usage.cache_write_input_tokens),
      costMicros: numberOrNull(row.cost_micros),
      closedFirstTurn: toolCalls ? toolCalls.some((call) => isObject(call) && call.name === DONE_TOOL) : null,
    };
  } catch {
    return NO_GENERATION;
  }
}

/**
 * Códigos con los que no tiene sentido seguir llamando: sesión caducada (401), sin cupo (402), sin
 * permiso (403), marca que no se ve o función sin desplegar (404) e IA en pausa o sin configurar (503).
 */
const STOP_STATUS = new Set([401, 402, 403, 404, 503]);

interface CopilotCall {
  result: BenchResult;
  /** Hay que parar: seguir solo gastaría llamadas. */
  stop: boolean;
}

/** Una llamada a `ai-generate` (`editor.copilot`) y su evaluación contra el caso. */
async function callCopilot(
  config: RealConfig,
  deps: RealDeps,
  clean: (text: string) => string,
  benchCase: BenchCase,
  mode: CopilotMode,
  repetition: number,
  transcript: string,
  extra: Pick<BenchResult, 'file' | 'transcript'> & { group?: BenchResult['group'] } = {},
): Promise<CopilotCall> {
  const setup = setupCase(benchCase);
  const base: BenchResult = {
    caseId: benchCase.id,
    group: extra.group ?? benchCase.group,
    mode,
    repetition,
    ok: false,
    problems: [],
    status: 0,
    e2eMs: 0,
    generationId: null,
    ...NO_GENERATION,
    expected: benchCase.expected,
    received: [],
    note: '',
    ...(extra.file ? { file: extra.file } : {}),
    ...(extra.transcript !== undefined ? { transcript: extra.transcript } : {}),
  };
  const started = deps.now();
  let response: Response;
  try {
    response = await deps.fetch(`${config.url}/functions/v1/ai-generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, apikey: config.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: EDITOR_COPILOT_PURPOSE,
        brandId: config.brandId,
        input: { transcript, document: setup.summary, assets: setup.assets, mode },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${clean(error.message)}` : 'error desconocido';
    return {
      result: { ...base, failure: 'error', e2eMs: deps.now() - started, problems: [`No se ha podido llamar a ai-generate (${reason}).`] },
      stop: false,
    };
  }
  const e2eMs = deps.now() - started;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const generationId =
    isObject(body) && typeof body.generationId === 'string'
      ? body.generationId
      : isObject(body) && isObject(body.error) && typeof body.error.generationId === 'string'
        ? body.error.generationId
        : null;
  const generation = generationId && UUID.test(generationId) ? await readGeneration(config, deps, generationId) : NO_GENERATION;
  if (response.status !== 200) {
    const error = isObject(body) && isObject(body.error) ? body.error : {};
    const detail = clean(`${String(error.code ?? 'sin código')}: ${String(error.message ?? 'sin mensaje')}`);
    return {
      result: {
        ...base,
        ...generation,
        failure: 'error',
        status: response.status,
        e2eMs,
        generationId,
        problems: [`ai-generate ha respondido ${response.status} (${detail}).`],
      },
      stop: STOP_STATUS.has(response.status),
    };
  }
  const evaluation = evaluateResponse(benchCase, body, transcript);
  return {
    result: {
      ...base,
      ...generation,
      status: 200,
      e2eMs,
      generationId,
      ok: evaluation.ok,
      problems: evaluation.problems,
      ...(evaluation.failure ? { failure: evaluation.failure } : {}),
      received: evaluation.operations.map((operation) => compactOperation(operation as unknown as Record<string, unknown>)),
      note: evaluation.note,
    },
    stop: false,
  };
}

// ── Audio ────────────────────────────────────────────────────────────────

export const AUDIO_EXTENSIONS = ['.wav', '.m4a', '.webm'] as const;
/** Lo que admite `ai-transcribe`: WAV de 16 kHz mono en trozos de 15 s como mucho y 120 s por petición. */
export const TRANSCRIBE_SAMPLE_RATE = 16000;
export const TRANSCRIBE_CHUNK_SECONDS = 14;
export const TRANSCRIBE_MAX_SECONDS = 120;

export interface Sound {
  sampleRate: number;
  /** Mono, de −1 a 1. */
  samples: Float32Array;
}

/** Lee un WAV sin comprimir (PCM de 8, 16, 24 o 32 bits, o coma flotante de 32) y lo deja en mono. */
export function parseWav(bytes: Uint8Array): Sound {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('No es un archivo WAV.');
  let format: { code: number; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === 'fmt ') {
      const code = view.getUint16(start, true);
      format = {
        // 0xFFFE = «extensible»: el formato real va en el subformato.
        code: code === 0xfffe && size >= 26 ? view.getUint16(start + 24, true) : code,
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true),
      };
    } else if (id === 'data') {
      if (!format) throw new Error('El WAV no dice su formato antes del sonido.');
      const { code, channels, sampleRate, bits } = format;
      if (channels < 1 || sampleRate < 1 || ![1, 3].includes(code) || (code === 3 && bits !== 32)) {
        throw new Error('WAV comprimido o con un formato que no se admite: conviértelo a PCM de 16 bits.');
      }
      const bytesPerSample = bits / 8;
      const end = Math.min(bytes.length, start + size);
      const frames = Math.floor((end - start) / (bytesPerSample * channels));
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          const at = start + (frame * channels + channel) * bytesPerSample;
          if (code === 3) sum += view.getFloat32(at, true);
          else if (bits === 8) sum += (view.getUint8(at) - 128) / 128;
          else if (bits === 16) sum += view.getInt16(at, true) / 32768;
          else if (bits === 24) sum += ((view.getInt8(at + 2) << 16) | (view.getUint8(at + 1) << 8) | view.getUint8(at)) / 8388608;
          else if (bits === 32) sum += view.getInt32(at, true) / 2147483648;
          else throw new Error(`WAV de ${bits} bits: no se admite.`);
        }
        samples[frame] = sum / channels;
      }
      return { sampleRate, samples };
    }
    offset = start + size + (size % 2);
  }
  throw new Error('El WAV no tiene sonido.');
}

/** Cambia la frecuencia de muestreo (interpolación lineal: suficiente para voz). */
export function resample(sound: Sound, sampleRate: number): Float32Array {
  if (sound.sampleRate === sampleRate) return sound.samples;
  const length = Math.max(0, Math.round((sound.samples.length * sampleRate) / sound.sampleRate));
  const out = new Float32Array(length);
  const step = sound.sampleRate / sampleRate;
  for (let i = 0; i < length; i += 1) {
    const position = i * step;
    const left = Math.floor(position);
    const a = sound.samples[left] ?? 0;
    const b = sound.samples[left + 1] ?? a;
    out[i] = a + (b - a) * (position - left);
  }
  return out;
}

/** WAV PCM de 16 bits mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(value < 0 ? value * 32768 : value * 32767), true);
  }
  return new Uint8Array(buffer);
}

/** Trozos de `seconds` como mucho (el último, lo que quede). */
export function splitSamples(samples: Float32Array, sampleRate: number, seconds = TRANSCRIBE_CHUNK_SECONDS): Float32Array[] {
  const size = Math.max(1, Math.floor(sampleRate * seconds));
  const pieces: Float32Array[] = [];
  for (let start = 0; start < samples.length; start += size) pieces.push(samples.subarray(start, Math.min(samples.length, start + size)));
  return pieces;
}

export interface AudioEntry {
  /** Nombre del archivo dentro de la carpeta. */
  file: string;
  benchCase: BenchCase;
}

/**
 * Lee `casos.json` de la carpeta de grabaciones: una lista de
 * `{ "archivo": "…", "caso": "<id de un caso>" | { order, document, expected, … } }`.
 * Devuelve las entradas válidas y, aparte, lo que no se puede usar y por qué.
 */
export function readAudioEntries(directory: string, cases: BenchCase[] = BENCH_CASES): { entries: AudioEntry[]; skipped: string[] } {
  const skipped: string[] = [];
  const index = path.join(directory, 'casos.json');
  if (!existsSync(directory) || !existsSync(index)) return { entries: [], skipped };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(index, 'utf8'));
  } catch {
    return { entries: [], skipped: ['casos.json no es JSON válido.'] };
  }
  if (!Array.isArray(raw)) return { entries: [], skipped: ['casos.json debe ser una lista.'] };
  const entries: AudioEntry[] = [];
  raw.forEach((item, position) => {
    const where = `casos.json, entrada ${position + 1}`;
    if (!isObject(item) || typeof item.archivo !== 'string' || item.archivo.trim() === '') {
      skipped.push(`${where}: falta «archivo».`);
      return;
    }
    const file = path.basename(item.archivo);
    if (!(AUDIO_EXTENSIONS as readonly string[]).includes(path.extname(file).toLowerCase())) {
      skipped.push(`${file}: solo se admiten ${AUDIO_EXTENSIONS.join(', ')}.`);
      return;
    }
    if (!existsSync(path.join(directory, file))) {
      skipped.push(`${file}: no está en la carpeta.`);
      return;
    }
    if (typeof item.caso === 'string') {
      const found = cases.find((candidate) => candidate.id === item.caso);
      if (!found) skipped.push(`${file}: no existe el caso «${item.caso}».`);
      else entries.push({ file, benchCase: found });
      return;
    }
    const own = item.caso;
    if (
      !isObject(own) ||
      typeof own.order !== 'string' ||
      !(BENCH_DOCUMENT_IDS as readonly string[]).includes(String(own.document)) ||
      !Array.isArray(own.expected) ||
      !own.expected.every((operation) => isObject(operation) && typeof operation.op === 'string')
    ) {
      skipped.push(`${where}: «caso» debe ser el id de un caso o { order, document, expected }.`);
      return;
    }
    const photos = Array.isArray(own.assets) ? own.assets.filter((id): id is BenchPhotoId => typeof id === 'string' && id in BENCH_PHOTOS) : [];
    entries.push({
      file,
      benchCase: {
        id: `audio:${file}`,
        group: 'simple',
        order: own.order,
        document: own.document as BenchDocumentId,
        ...(photos.length > 0 ? { assets: photos } : {}),
        expected: own.expected as ExpectedOperation[],
        anyOrder: own.anyOrder === true,
        note: own.note === true,
        json: true,
        local: false,
      },
    });
  });
  return { entries, skipped };
}

/** ¿Está `ffmpeg` en el PATH? (para convertir .m4a y .webm a WAV). */
export function ffmpegAvailable(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

/** El sonido de una grabación, a 16 kHz mono. Los .m4a y .webm se convierten con ffmpeg. */
export function loadSound(file: string): Float32Array {
  if (path.extname(file).toLowerCase() === '.wav') return resample(parseWav(new Uint8Array(readFileSync(file))), TRANSCRIBE_SAMPLE_RATE);
  const folder = mkdtempSync(path.join(os.tmpdir(), 'copiloto-banco-'));
  try {
    const converted = path.join(folder, 'audio.wav');
    const run = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-ac', '1', '-ar', String(TRANSCRIBE_SAMPLE_RATE), '-c:a', 'pcm_s16le', converted],
      { stdio: 'ignore' },
    );
    if (run.status !== 0 || !existsSync(converted)) throw new Error('ffmpeg no ha podido convertir la grabación.');
    return resample(parseWav(new Uint8Array(readFileSync(converted))), TRANSCRIBE_SAMPLE_RATE);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Manda una grabación a `ai-transcribe` y devuelve el texto. */
async function transcribe(
  config: RealConfig,
  deps: RealDeps,
  clean: (text: string) => string,
  samples: Float32Array,
): Promise<{ text: string } | { problem: string; stop: boolean }> {
  const pieces = splitSamples(samples, TRANSCRIBE_SAMPLE_RATE).filter((piece) => piece.length / TRANSCRIBE_SAMPLE_RATE >= 0.2);
  if (pieces.length === 0) return { problem: 'La grabación está vacía.', stop: false };
  const form = new FormData();
  form.append('brandId', config.brandId);
  form.append(
    'meta',
    JSON.stringify({
      chunks: pieces.map((piece) => ({ seconds: Number((piece.length / TRANSCRIBE_SAMPLE_RATE).toFixed(3)) })),
      language: 'es',
      purpose: 'editor.dictation',
    }),
  );
  pieces.forEach((piece, index) => form.append(`chunk-${index}`, new Blob([encodeWav(piece, TRANSCRIBE_SAMPLE_RATE)], { type: 'audio/wav' })));
  let response: Response;
  try {
    response = await deps.fetch(`${config.url}/functions/v1/ai-transcribe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, apikey: config.anonKey },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${clean(error.message)}` : 'error desconocido';
    return { problem: `No se ha podido llamar a ai-transcribe (${reason}).`, stop: false };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.status !== 200) {
    const error = isObject(body) && isObject(body.error) ? body.error : {};
    return {
      problem: `ai-transcribe ha respondido ${response.status} (${clean(`${String(error.code ?? 'sin código')}: ${String(error.message ?? 'sin mensaje')}`)}).`,
      stop: STOP_STATUS.has(response.status),
    };
  }
  const segments = isObject(body) && Array.isArray(body.segments) ? body.segments : [];
  const text = segments
    .filter((segment): segment is { index?: unknown; text: string } => isObject(segment) && typeof segment.text === 'string')
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ');
  return { text };
}

// ── De verdad: la ejecución ──────────────────────────────────────────────

interface OutputFile {
  version: 1;
  runs: { startedAt: string; kind: 'texto' | 'audio'; results: BenchResult[] }[];
}

/** Resultados acumulados de ejecuciones anteriores (vacío si no hay archivo o no se entiende). */
export function readOutput(file: string): OutputFile {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as OutputFile;
    if (parsed?.version === 1 && Array.isArray(parsed.runs)) return parsed;
  } catch {
    // Sin archivo o ilegible: se empieza de cero.
  }
  return { version: 1, runs: [] };
}

export interface RealReport {
  results: BenchResult[];
  audio: BenchResult[];
  /** 0 = todo acertado; 1 = algún fallo; 2 = no se ha ejecutado (configuración, o la persona dijo que no). */
  exitCode: number;
}

/**
 * Ejecución contra el servicio real. No imprime ni guarda nunca el token ni la
 * clave: todo lo que sale pasa por `redactor`.
 */
export async function runReal(options: RealOptions, deps: RealDeps): Promise<RealReport> {
  let config: RealConfig;
  try {
    config = readRealConfig(deps.env);
  } catch (error) {
    deps.log(error instanceof BenchConfigError ? error.message : 'La configuración del banco no es válida.');
    return { results: [], audio: [], exitCode: 2 };
  }
  const clean = redactor([config.token, config.anonKey]);
  const log = (line: string) => deps.log(clean(line));

  const chosen = selectCases(options);
  const cases = chosen.filter((item) => options.includeLocal || !item.local);
  const localSkipped = chosen.length - cases.length;
  const plan = cases.flatMap((benchCase) =>
    options.modes.filter((mode) => mode === 'tools' || benchCase.json).map((mode) => ({ benchCase, mode })),
  );
  const notExpressible = cases.filter((item) => !item.json && options.modes.includes('json')).length;

  const audio = options.audioDir ? readAudioEntries(options.audioDir) : { entries: [], skipped: [] };
  const audioCalls = audio.entries.length * (1 + options.modes.length);
  const calls = plan.length * options.repetitions + audioCalls;

  // Estimación con el contador aproximado del modo en seco (4 caracteres por token).
  let inputTokens = 0;
  let outputTokens = 0;
  for (const { benchCase, mode } of plan) {
    const dry = await dryRunCase(benchCase, mode);
    inputTokens += (dry.tokens?.total ?? 0) * options.repetitions;
    outputTokens += 150 * options.repetitions;
  }
  log(`Servicio: ${new URL(config.url).host} · marca ${config.brandId}`);
  log(
    `Se van a hacer ${calls} llamadas de pago: ${plan.length * options.repetitions} al copiloto (${cases.length} casos, rutas ${options.modes.join(' y ')}, ${options.repetitions} repeticiones)` +
      (audioCalls > 0 ? ` y ${audioCalls} de audio (${audio.entries.length} grabaciones: transcribir y copiloto).` : '.'),
  );
  if (localSkipped > 0) log(`No se envían ${localSkipped} casos que resuelve el intérprete local sin IA (coste cero). Con --incluir-locales, sí.`);
  if (notExpressible > 0) log(`Por la ruta JSON no se envían ${notExpressible} casos que no puede expresar.`);
  const planCases = cases.filter((item) => item.plan).length;
  if (planCases > 0) {
    log(
      `De los ${planCases} casos de plan (órdenes que montan una pieza) solo se evalúa el plan que devuelve el copiloto: el banco no ejecuta sus pasos, no genera imágenes y no recorta (su único gasto es la llamada de texto).`,
    );
  }
  if (options.modes.includes('tools')) {
    log(
      `Por herramientas, cada orden puede ser de varias generaciones (una por vuelta, hasta ${MAX_TOOL_TURNS}, si el modelo llama a las herramientas de una en una): la estimación cuenta una por orden y el banco solo ve la primera por su generationId.`,
    );
  }
  log(
    `Estimación (sin audio): unos ${inputTokens} tokens de entrada (parte se leerá de caché) y unos ${outputTokens} de salida. ` +
      (options.priceIn !== undefined && options.priceOut !== undefined
        ? `Con ${options.priceIn} por millón de entrada y ${options.priceOut} por millón de salida: como mucho ${((inputTokens * options.priceIn + outputTokens * options.priceOut) / 1_000_000).toFixed(4)}.`
        : 'El coste depende del modelo que tenga puesto el servidor (Plataforma → Integraciones); con --precio-entrada y --precio-salida (por millón de tokens) se calcula aquí.'),
  );
  if (calls === 0) {
    log('No hay nada que enviar con esos filtros.');
    return { results: [], audio: [], exitCode: 2 };
  }
  if (!options.yes && !(await deps.confirm('¿Seguir? Escribe «si» para hacer las llamadas: '))) {
    log('No se ha hecho ninguna llamada.');
    return { results: [], audio: [], exitCode: 2 };
  }

  const results: BenchResult[] = [];
  let stopped = false;
  outer: for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
    for (const { benchCase, mode } of plan) {
      const { result, stop } = await callCopilot(config, deps, clean, benchCase, mode, repetition, benchCase.order);
      results.push(result);
      log(`${result.ok ? 'bien ' : 'FALLO'} [${mode}] ${benchCase.id} · ${Math.round(result.e2eMs)} ms${result.model ? ` · ${result.provider}/${result.model}` : ''}`);
      if (stop) {
        log(`Se para aquí: ${result.problems[0] ?? 'el servicio no deja seguir.'}`);
        stopped = true;
        break outer;
      }
      if (options.pauseMs > 0) await deps.sleep(options.pauseMs);
    }
  }

  // Audio: grabación → transcripción → copiloto → la misma comparación.
  const audioResults: BenchResult[] = [];
  if (options.audioDir && !stopped) {
    for (const reason of audio.skipped) log(`Audio, se salta: ${reason}`);
    const listed = new Set(audio.entries.map((entry) => entry.file));
    const unlisted = audioFiles(options.audioDir).filter((file) => !listed.has(file));
    if (unlisted.length > 0) log(`Audio: hay grabaciones que no están en casos.json y no se usan: ${unlisted.join(', ')}`);
    if (audio.entries.length === 0) {
      log(`Audio: no hay grabaciones que usar en ${options.audioDir} (hace falta un casos.json; ver scripts/copiloto-banco/audio/LEEME.md). Se salta.`);
    }
    const canConvert = audio.entries.some((entry) => path.extname(entry.file).toLowerCase() !== '.wav') ? ffmpegAvailable() : true;
    audioLoop: for (const entry of audio.entries) {
      if (path.extname(entry.file).toLowerCase() !== '.wav' && !canConvert) {
        log(`Audio, se salta ${entry.file}: no es WAV y no hay ffmpeg en el PATH para convertirlo.`);
        continue;
      }
      let samples: Float32Array;
      try {
        samples = loadSound(path.join(options.audioDir, entry.file));
      } catch (error) {
        log(`Audio, se salta ${entry.file}: ${error instanceof Error ? error.message : 'no se puede leer'}`);
        continue;
      }
      if (samples.length / TRANSCRIBE_SAMPLE_RATE > TRANSCRIBE_MAX_SECONDS) {
        log(`Audio, se salta ${entry.file}: dura más de ${TRANSCRIBE_MAX_SECONDS} s.`);
        continue;
      }
      const heard = await transcribe(config, deps, clean, samples);
      if ('problem' in heard) {
        log(`Audio, ${entry.file}: ${heard.problem}`);
        if (heard.stop) break;
        continue;
      }
      log(`Audio, ${entry.file}: dicho «${entry.benchCase.order}» · transcrito «${heard.text}»`);
      if (heard.text.trim() === '') {
        log(`Audio, ${entry.file}: la transcripción ha salido vacía; no se envía al copiloto.`);
        continue;
      }
      for (const mode of options.modes) {
        const { result, stop } = await callCopilot(config, deps, clean, entry.benchCase, mode, 1, heard.text, {
          group: 'audio',
          file: entry.file,
          transcript: heard.text,
        });
        audioResults.push(result);
        log(`${result.ok ? 'bien ' : 'FALLO'} [${mode}] ${entry.file} · ${Math.round(result.e2eMs)} ms`);
        if (stop) break audioLoop;
        if (options.pauseMs > 0) await deps.sleep(options.pauseMs);
      }
    }
  } else if (!options.audioDir) {
    log('Audio: sin --audio <carpeta>, no se prueban grabaciones.');
  }

  let all = [...results, ...audioResults];
  if (options.output) {
    const stored = readOutput(options.output);
    const startedAt = new Date(deps.now()).toISOString();
    if (results.length > 0) stored.runs.push({ startedAt, kind: 'texto', results });
    if (audioResults.length > 0) stored.runs.push({ startedAt, kind: 'audio', results: audioResults });
    writeFileSync(options.output, clean(JSON.stringify(stored, null, 2)));
    all = stored.runs.flatMap((run) => run.results);
    log(`Resultados guardados en ${options.output} (${stored.runs.length} ejecuciones acumuladas).`);
  }

  log('');
  log(options.output ? 'Órdenes escritas, por modelo y ruta (todas las ejecuciones acumuladas)' : 'Órdenes escritas, por modelo y ruta');
  log(formatAggregates(aggregateResults(all.filter((result) => result.group !== 'audio'))));
  const allAudio = all.filter((result) => result.group === 'audio');
  if (allAudio.length > 0) {
    log('');
    log('Grabaciones (transcripción + copiloto), por modelo y ruta');
    log(formatAggregates(aggregateResults(allAudio)));
    log(
      table([
        ['grabación', 'ruta', 'resultado', 'dicho (esperado)', 'transcrito'],
        ...audioResults.map((result) => [
          result.file ?? '',
          result.mode,
          result.ok ? 'bien' : 'FALLO',
          audio.entries.find((entry) => entry.file === result.file)?.benchCase.order ?? '',
          result.transcript ?? '',
        ]),
      ]),
    );
  }
  const failed = [...results, ...audioResults].some((result) => !result.ok);
  return { results, audio: audioResults, exitCode: stopped || failed ? 1 : 0 };
}

/** Lista de archivos de sonido de una carpeta (para decir cuáles no están en casos.json). */
export function audioFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((file) => (AUDIO_EXTENSIONS as readonly string[]).includes(path.extname(file).toLowerCase()));
}
