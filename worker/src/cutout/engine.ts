// Motor de «Quitar el fondo» del trabajador: BEN2 base (fp16, MIT) con onnxruntime-node en CPU.
//
// Se mide en docs/edicion-fotos.md (§7, «Quitar el fondo en el servidor»): con 2 hilos y la
// arena de memoria desactivada, ~16 s por foto y ~2,3 GB de pico en un procesador de
// escritorio; por eso la máquina de Fly pasa a 4 GB. La sesión (219 MB de pesos + grafo) se
// abre al empezar CADA trabajo y se libera al terminar, haya ido bien o mal: entre trabajos
// la máquina no guarda nada del modelo en memoria, y si la cola se vacía se apaga.
import { existsSync } from 'node:fs';
import os from 'node:os';

/** Modelo, tal y como se guarda en la procedencia y en la carga del trabajo (la fija la base de datos). */
export const BEN2_MODEL_NAME = 'ben2-base-fp16';
/** Dónde está dentro de la imagen Docker (worker/Dockerfile) y valor por defecto de WORKER_CUTOUT_MODEL. */
export const DEFAULT_MODEL_PATH = '/app/models/ben2-base-fp16.onnx';
/** Hilos de cálculo: la máquina es shared-cpu-2x. Con más no se gana y se reparte peor la memoria. */
export const DEFAULT_THREADS = 2;

/** Una sesión abierta del modelo. */
export interface CutoutSession {
  /** Tensor 1×3×1024×1024 (ImageNet) → `alphas` 1×1×1024×1024 (de 0 a 1). */
  run(input: Float32Array, signal?: AbortSignal): Promise<Float32Array>;
  /** Suelta la sesión y su memoria. Se puede llamar más de una vez. */
  release(): Promise<void>;
}

/** Abre sesiones del modelo (en las pruebas, un doble sin onnxruntime). */
export interface CutoutEngine {
  model: string;
  open(): Promise<CutoutSession>;
}

export interface OrtEngineOptions {
  modelPath: string;
  threads?: number;
}

/** ¿Está el modelo en esta máquina? Si no, el trabajador no reclama `media.cutout`. */
export function modelAvailable(modelPath: string): boolean {
  return existsSync(modelPath);
}

export function createOrtEngine(options: OrtEngineOptions): CutoutEngine {
  const threads = Math.max(1, Math.min(options.threads ?? DEFAULT_THREADS, os.availableParallelism()));
  return {
    model: BEN2_MODEL_NAME,
    async open() {
      // Carga diferida: sin el modelo o sin el módulo nativo el resto del trabajador sigue funcionando.
      const ort = await import('onnxruntime-node');
      const session = await ort.InferenceSession.create(options.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: threads,
        interOpNumThreads: 1,
        // Sin arena ni patrón de memoria: el pico baja de ~4,5 GB a ~2,3 GB (cuesta algo de tiempo).
        enableCpuMemArena: false,
        enableMemPattern: false,
        extra: { session: { intra_op: { allow_spinning: '0' } } },
      });
      let released = false;
      return {
        async run(input, signal) {
          if (released) throw new Error('La sesión del modelo ya se ha liberado');
          signal?.throwIfAborted();
          const feeds = { [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, 1024, 1024]) };
          const outputs = await session.run(feeds);
          const tensor = outputs[session.outputNames[0]!]!;
          // Copia: el tensor es memoria de onnxruntime y se libera con la sesión.
          return Float32Array.from(tensor.data as Float32Array);
        },
        async release() {
          if (released) return;
          released = true;
          await session.release();
        },
      };
    },
  };
}
