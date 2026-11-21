// Quitar el fondo en el navegador, sin proveedor de IA ni coste (docs/edicion-fotos.md, §7).
//
//   removeBackgroundInBrowser(foto, onProgreso) → la misma foto con el alfa del modelo.
//
// Dos motores, los dos en un Web Worker con onnxruntime-web: BEN2 (calidad alta,
// solo con WebGPU) e IS-Net (respaldo, calidad básica). Se elige con select.ts y,
// si BEN2 falla al ejecutarse, se pasa a IS-Net sin romper y se recuerda durante
// la sesión. El modelo se descarga una vez y queda en Cache Storage. El worker se
// termina tras un rato sin uso para devolver la memoria.
import type { Pixels } from '../pixels';
import type { FromWorker, Provider, ToWorker } from './cutout.worker';
import { ModelDownloadError } from './download';
import { applyMask, ben2Mask, normalizeMask, NoSubjectError, toBen2Input, toModelInput } from './mask';
import {
  cutoutSimulated,
  CUTOUT_MODEL_NAME,
  DEFAULT_CUTOUT_MODEL_BYTES,
  engineSpec,
  MODEL_SIDE,
  type CutoutEngineId,
  type CutoutEngineSpec,
} from './model';
import { chooseEngine, probeNavigator, type EngineProbe } from './select';

export type CutoutProgress =
  | { phase: 'downloading'; received: number; total: number; engine?: CutoutEngineId }
  | { phase: 'loading' }
  | { phase: 'running' };

export interface CutoutResult {
  pixels: Pixels;
  /** Nombre del modelo, para la procedencia (`ben2-base-fp16` o `isnet-general-use`). */
  model: string;
  engine: CutoutEngineId;
  /** `high` con BEN2; `basic` con el respaldo (la interfaz lo dice). */
  quality: 'high' | 'basic';
  provider: Provider | 'simulated';
  fromCache: boolean;
}

/** Lo que devuelve el modelo ya ejecutado (antes de pasarlo a alfa). */
export interface ModelRun {
  prediction: Float32Array;
  provider: Provider;
  fromCache: boolean;
}

/** Piezas cambiables (en las pruebas, dobles): qué mira el navegador y cómo se ejecuta un modelo. */
export interface CutoutDeps {
  probe: (ben2Failed: boolean) => EngineProbe;
  runModel: (
    spec: CutoutEngineSpec,
    input: Float32Array,
    onProgress: ((p: CutoutProgress) => void) | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<ModelRun>;
}

export interface CutoutOptions {
  /** Para cancelar (descarga o recorte en marcha). */
  signal?: AbortSignal;
  /** Solo pruebas. */
  deps?: CutoutDeps;
}

/** Tras este tiempo sin recortes se termina el worker. */
export const WORKER_IDLE_MS = 60_000;
/** Memoria (GB, `navigator.deviceMemory`) por debajo de la cual no se intenta. */
const MIN_MEMORY_GB = 2;

export type CutoutSupport = { ok: true } | { ok: false; reason: string };

/** ¿Puede este navegador quitar el fondo? Si no, dice por qué, en claro. */
export function cutoutSupport(
  nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
): CutoutSupport {
  if (cutoutSimulated()) return { ok: true };
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    return {
      ok: false,
      reason:
        'Este navegador no puede quitar el fondo (le falta WebAssembly o los procesos en segundo plano). Prueba con una versión reciente de Chrome, Edge, Firefox o Safari.',
    };
  }
  const memory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  if (typeof memory === 'number' && memory < MIN_MEMORY_GB) {
    return {
      ok: false,
      reason: 'Este dispositivo tiene poca memoria para quitar el fondo en el navegador. Usa un ordenador.',
    };
  }
  return { ok: true };
}

/** Texto para quien pidió el recorte: qué pasó y qué hacer. */
export function describeCutoutError(error: unknown): string {
  const name = (error as Error | undefined)?.name;
  const message = (error as Error | undefined)?.message ?? '';
  if (error instanceof NoSubjectError || name === 'NoSubjectError') return message;
  if (name === 'ModelDownloadError') return message;
  if (name === 'AbortError') return '';
  if (name === 'RangeError' || /memory|alloc|out of/i.test(message)) {
    return 'El navegador se ha quedado sin memoria para quitar el fondo. Cierra otras pestañas, prueba con una foto más pequeña o usa un ordenador.';
  }
  if (/WebAssembly|wasm|session|backend|webgpu/i.test(message)) {
    return 'Este navegador no ha podido preparar el modelo para quitar el fondo (ni con la tarjeta gráfica ni con el procesador). Prueba con otro navegador o con un ordenador.';
  }
  return 'No se ha podido quitar el fondo en el navegador. Vuelve a intentarlo.';
}

/** BEN2 ya falló en esta sesión (operadores sin soporte, sin memoria…): se usa IS-Net hasta recargar. */
let ben2Failed = false;

/** Olvida que BEN2 falló (solo para las pruebas). */
export function resetCutoutSession(): void {
  ben2Failed = false;
}

/** ¿Se ha descartado BEN2 en esta sesión? */
export function ben2FailedThisSession(): boolean {
  return ben2Failed;
}

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const pending = new Map<
  number,
  {
    ok: (m: Extract<FromWorker, { type: 'mask' }>) => void;
    ko: (e: Error) => void;
    onProgress?: (p: CutoutProgress) => void;
  }
>();

/** Termina el worker ya (si no hay nada en marcha) y suelta su memoria. */
export function releaseCutoutWorker(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!worker || pending.size > 0) return;
  worker.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (worker) return worker;
  const w = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module', name: 'recorte-fotos' });
  w.onmessage = (event: MessageEvent<FromWorker>) => {
    const m = event.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'download') {
      p.onProgress?.({ phase: 'downloading', received: m.received, total: m.total, engine: m.engine });
    } else if (m.type === 'loading') p.onProgress?.({ phase: 'loading' });
    else if (m.type === 'running') p.onProgress?.({ phase: 'running' });
    else if (m.type === 'mask') {
      pending.delete(m.id);
      p.ok(m);
    } else {
      pending.delete(m.id);
      const error = new Error(m.message);
      if (m.name) error.name = m.name;
      p.ko(error);
    }
  };
  w.onerror = (event) => {
    const error = new Error(event.message || 'Error en el worker del recorte');
    pending.forEach((p) => p.ko(error));
    pending.clear();
    w.terminate();
    worker = null;
  };
  worker = w;
  return w;
}

/** Máscara simulada (solo pruebas de punta a punta): una elipse centrada. */
function simulatedPrediction(): Float32Array {
  const out = new Float32Array(MODEL_SIDE * MODEL_SIDE);
  const c = MODEL_SIDE / 2;
  for (let y = 0; y < MODEL_SIDE; y += 1) {
    for (let x = 0; x < MODEL_SIDE; x += 1) {
      const d = ((x - c) / (c * 0.8)) ** 2 + ((y - c) / (c * 0.7)) ** 2;
      out[y * MODEL_SIDE + x] = d <= 1 ? 1 : 0;
    }
  }
  return out;
}

function abortError(): Error {
  const error = new Error('Recorte cancelado.');
  error.name = 'AbortError';
  return error;
}

/** ¿Lo canceló quien lo pidió? */
export function isCutoutCancelled(error: unknown): boolean {
  return (error as Error | undefined)?.name === 'AbortError';
}

function runInWorker(
  spec: CutoutEngineSpec,
  input: Float32Array,
  onProgress: ((p: CutoutProgress) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ModelRun> {
  return new Promise<Extract<FromWorker, { type: 'mask' }>>((ok, ko) => {
    if (signal?.aborted) return ko(abortError());
    const id = nextId++;
    const cancel = () => {
      if (!pending.delete(id)) return;
      // El worker trabaja en serie: terminarlo es lo único que corta una descarga o una inferencia en marcha.
      if (pending.size === 0 && worker) {
        worker.terminate();
        worker = null;
      }
      ko(abortError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    pending.set(id, {
      ok: (m) => {
        signal?.removeEventListener('abort', cancel);
        ok(m);
      },
      ko: (e) => {
        signal?.removeEventListener('abort', cancel);
        ko(e);
      },
      onProgress,
    });
    const message: ToWorker = {
      type: 'run',
      id,
      engine: spec.id,
      modelUrl: spec.url,
      modelBytes: spec.bytes,
      side: spec.side,
      input,
    };
    getWorker().postMessage(message, [input.buffer]);
  })
    .then(({ prediction, provider, fromCache }) => ({ prediction, provider, fromCache }))
    .finally(() => {
      if (pending.size === 0) idleTimer = setTimeout(releaseCutoutWorker, WORKER_IDLE_MS);
    });
}

const defaultDeps: CutoutDeps = {
  probe: (failed) => probeNavigator(undefined, failed),
  runModel: runInWorker,
};

async function runEngine(
  id: CutoutEngineId,
  image: Pixels,
  onProgress: ((p: CutoutProgress) => void) | undefined,
  options: CutoutOptions,
): Promise<CutoutResult> {
  const deps = options.deps ?? defaultDeps;
  const spec = engineSpec(id);
  const input = id === 'ben2' ? toBen2Input(image, spec.side) : toModelInput(image, spec.side);
  const run = await deps.runModel(spec, input, onProgress, options.signal);
  const pixels =
    id === 'ben2'
      ? applyMask(image, ben2Mask(run.prediction), spec.side, 'none')
      : applyMask(image, normalizeMask(run.prediction), spec.side);
  return {
    pixels,
    model: spec.name,
    engine: id,
    quality: spec.quality,
    provider: run.provider,
    fromCache: run.fromCache,
  };
}

/**
 * Foto → la misma foto con el fondo transparente. Lanza `NoSubjectError` si no
 * encuentra nada que recortar, `ModelDownloadError` si no puede bajar el modelo
 * y un `AbortError` si se cancela (`isCutoutCancelled`).
 *
 * Motor: BEN2 con WebGPU; si no hay WebGPU o memoria, o BEN2 falla al ejecutarse,
 * IS-Net (y no se vuelve a intentar BEN2 en esta sesión, salvo que fuera solo un
 * corte de red al bajarlo).
 */
export async function removeBackgroundInBrowser(
  image: Pixels,
  onProgress?: (p: CutoutProgress) => void,
  options: CutoutOptions = {},
): Promise<CutoutResult> {
  const support = cutoutSupport();
  if (!support.ok) throw new Error(support.reason);
  if (options.signal?.aborted) throw abortError();
  if (cutoutSimulated()) {
    onProgress?.({ phase: 'downloading', received: DEFAULT_CUTOUT_MODEL_BYTES, total: DEFAULT_CUTOUT_MODEL_BYTES });
    onProgress?.({ phase: 'running' });
    return {
      pixels: applyMask(image, normalizeMask(simulatedPrediction())),
      model: CUTOUT_MODEL_NAME,
      engine: 'isnet',
      quality: 'basic',
      provider: 'simulated',
      fromCache: true,
    };
  }
  const deps = options.deps ?? defaultDeps;
  const choice = await chooseEngine(deps.probe(ben2Failed));
  if (choice.engine === 'ben2') {
    try {
      return await runEngine('ben2', image, onProgress, options);
    } catch (error) {
      if (isCutoutCancelled(error) || error instanceof NoSubjectError) throw error;
      // Un corte de red no dice nada de BEN2 (solo esta vez); operadores, memoria o GPU, sí.
      if ((error as Error)?.name !== 'ModelDownloadError' && !(error instanceof ModelDownloadError)) {
        ben2Failed = true;
      }
      console.warn('[recorte] BEN2 no ha funcionado, se usa IS-Net', error);
      if (!options.deps) releaseCutoutWorker();
    }
  }
  return runEngine('isnet', image, onProgress, options);
}
