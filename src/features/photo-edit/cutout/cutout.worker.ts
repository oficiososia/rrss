/// <reference lib="webworker" />
// Worker del recorte en el navegador: onnxruntime-web con BEN2 (calidad alta,
// solo WebGPU) o IS-Net (respaldo). Se crea al primer uso (desde engine.ts), así
// ni el runtime ni los modelos entran en el paquete inicial ni congelan la
// interfaz.
//
// BEN2 no cabe en WASM de 32 bits (pide ~4,6 GB en CPU): solo corre con WebGPU y,
// si la sesión o la inferencia fallan, el worker devuelve el error y engine.ts
// pasa a IS-Net. IS-Net usa WebGPU si hay y, si no, o si falla o devuelve una
// máscara vacía, WASM en CPU. Hilos solo con aislamiento cross-origin; la
// aplicación no lo activa a propósito (docs/edicion-fotos.md, §7): un hilo.
import * as ort from 'onnxruntime-web/webgpu';
import { loadModelBytes } from './download';
import { CUTOUT_MODEL_CACHE, type CutoutEngineId } from './model';
import { hasWebgpu, type GpuLike } from './select';

export type Provider = 'webgpu' | 'wasm';

export type ToWorker = {
  type: 'run';
  id: number;
  engine: CutoutEngineId;
  modelUrl: string;
  /** Tamaño aproximado del modelo (bytes), para el progreso si el servidor no dice la longitud. */
  modelBytes: number;
  /** Lado de la entrada (1×3×lado×lado). */
  side: number;
  input: Float32Array;
};
export type FromWorker =
  | { type: 'download'; id: number; engine: CutoutEngineId; received: number; total: number }
  | { type: 'loading'; id: number }
  | { type: 'running'; id: number }
  | { type: 'mask'; id: number; prediction: Float32Array; provider: Provider; fromCache: boolean; ms: number }
  | { type: 'error'; id: number; message: string; name?: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

type Loaded = { s: ort.InferenceSession; provider: Provider; fromCache: boolean };
let session: Promise<Loaded> | null = null;
let sessionKey = '';
let noWebgpu = false;

const gpuOf = () => (navigator as Navigator & { gpu?: GpuLike }).gpu;

/** Suelta la sesión anterior (y su memoria) antes de crear otra. */
function dropSession() {
  const old = session;
  session = null;
  void old?.then((l) => l.s.release()).catch(() => undefined);
}

function loadSession(message: ToWorker) {
  const key = `${message.engine}|${message.modelUrl}`;
  if (session && sessionKey !== key) dropSession();
  if (!session) {
    sessionKey = key;
    session = (async () => {
      ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      let last = 0;
      const model = await loadModelBytes({
        url: message.modelUrl,
        expectedBytes: message.modelBytes,
        openCache: () => caches.open(CUTOUT_MODEL_CACHE),
        onProgress: (received, total) => {
          if (received - last < 512 * 1024 && received < total) return;
          last = received;
          send({ type: 'download', id: message.id, engine: message.engine, received, total });
        },
      });
      const options = { graphOptimizationLevel: 'all' as const };
      if (message.engine === 'ben2') {
        // Solo WebGPU: en WASM no cabe. Si falla, el error sube y se usa IS-Net.
        if (!(await hasWebgpu(gpuOf()))) throw new Error('BEN2 necesita WebGPU y este navegador no lo tiene.');
        const s = await ort.InferenceSession.create(model.bytes, { ...options, executionProviders: ['webgpu'] });
        return { s, provider: 'webgpu' as const, fromCache: model.fromCache };
      }
      if (!noWebgpu && (await hasWebgpu(gpuOf()))) {
        try {
          const s = await ort.InferenceSession.create(model.bytes, { ...options, executionProviders: ['webgpu'] });
          return { s, provider: 'webgpu' as const, fromCache: model.fromCache };
        } catch (error) {
          console.warn('[recorte] WebGPU no disponible, se usa WASM', error);
          noWebgpu = true;
        }
      }
      const s = await ort.InferenceSession.create(model.bytes, { ...options, executionProviders: ['wasm'] });
      return { s, provider: 'wasm' as const, fromCache: model.fromCache };
    })();
    session.catch(() => {
      session = null; // se reintenta en la próxima petición
    });
  }
  return session;
}

let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type !== 'run') return;
  queue = queue.then(async () => {
    try {
      for (let attempt = 0; ; attempt += 1) {
        send({ type: 'loading', id: message.id });
        const { s, provider, fromCache } = await loadSession(message);
        send({ type: 'running', id: message.id });
        const started = performance.now();
        try {
          const side = message.side;
          const outputs = await s.run({
            [s.inputNames[0]!]: new ort.Tensor('float32', message.input, [1, 3, side, side]),
          });
          const tensor = outputs[s.outputNames[0]!]!;
          const data = (tensor.location === 'gpu-buffer' ? await tensor.getData() : tensor.data) as Float32Array;
          const prediction = new Float32Array(data);
          let max = -Infinity;
          for (let i = 0; i < prediction.length; i += 997) if (prediction[i]! > max) max = prediction[i]!;
          // Controladores de GPU raros: NaN o mapa plano → BEN2 falla (engine.ts pasa a IS-Net); IS-Net se repite en CPU.
          if (provider === 'webgpu' && !(max > 0)) throw new Error('Máscara vacía en WebGPU');
          send({ type: 'mask', id: message.id, prediction, provider, fromCache, ms: performance.now() - started }, [
            prediction.buffer,
          ]);
          return;
        } catch (error) {
          if (provider !== 'webgpu' || attempt > 0 || message.engine === 'ben2') throw error;
          console.warn('[recorte] fallo en WebGPU, se repite en WASM', error);
          noWebgpu = true;
          dropSession();
        }
      }
    } catch (error) {
      if (message.engine === 'ben2') dropSession();
      send({
        type: 'error',
        id: message.id,
        message: (error as Error)?.message || String(error),
        name: (error as Error)?.name,
      });
    }
  });
};
