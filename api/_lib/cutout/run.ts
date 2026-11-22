// Quitar el fondo en el servidor: foto (JPEG/PNG/WebP) → máscara refinada (PNG gris
// de 1 canal, al tamaño de la foto). Mismo IS-Net cuantizado que el navegador
// (`public/models/isnet-general-use-u8.onnx`) con el MISMO preprocesado y refinado
// (`src/features/photo-edit/cutout/refine.ts`), así el resultado es el mismo se
// haga donde se haga. La sesión de onnxruntime-node se crea una vez por instancia.
// Las importaciones de `src/` llevan `.js`: Node las corre como ESM.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isnetInput, normalizePrediction, refineMask } from '../../../src/features/photo-edit/cutout/refine.js';

export const MODEL_SIDE = 1024;
/** Lado mayor admitido en la foto de entrada (el navegador manda ≤ 1600). */
export const MAX_INPUT_SIDE = 4096;
/** Fracción mínima de la foto que tiene que ser sujeto (igual que el navegador). */
export const MIN_SUBJECT_FRACTION = 0.005;

export function modelPath(): string {
  return path.join(process.cwd(), 'public', 'models', 'isnet-general-use-u8.onnx');
}

export class NoSubject extends Error {
  constructor() {
    super('No se ha encontrado nada que recortar en la foto');
    this.name = 'NoSubject';
  }
}

export class BadPhoto extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadPhoto';
  }
}

type Ort = typeof import('onnxruntime-node');
type Sharp = typeof import('sharp');
interface Session {
  ort: Ort;
  s: import('onnxruntime-node').InferenceSession;
}

let session: Promise<Session> | null = null;

function loadSession(): Promise<Session> {
  if (!session) {
    session = (async () => {
      const ort = (await import('onnxruntime-node')) as Ort;
      // 1 vCPU en el plan Hobby (el host puede enseñar más núcleos): 2 hilos como mucho y sin «spinning».
      const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
      const threads = Number(process.env.CUTOUT_THREADS) || Math.max(1, Math.min(2, cores));
      const s = await ort.InferenceSession.create(modelPath(), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: threads,
        interOpNumThreads: 1,
        // Sin la arena de CPU la memoria vuelve a ~400 MB tras cada foto (con ella crecía a ~1,5 GB).
        enableCpuMemArena: false,
        enableMemPattern: false,
        extra: { session: { intra_op: { allow_spinning: '0' } } },
      });
      return { ort, s };
    })();
    session.catch(() => {
      session = null; // se reintenta en la siguiente petición
    });
  }
  return session;
}

let sharpModule: Sharp | null = null;
async function loadSharp(): Promise<Sharp> {
  if (!sharpModule) sharpModule = ((await import('sharp')) as unknown as { default: Sharp }).default;
  return sharpModule;
}

/** ¿Están el modelo y los dos motores nativos? (GET de diagnóstico: no crea la sesión ni recorta). */
export async function engineStatus(): Promise<{ model: boolean; onnx: boolean; images: boolean; error?: string }> {
  const model = existsSync(modelPath());
  let onnx = false;
  let images = false;
  const errors: string[] = [];
  try {
    await import('onnxruntime-node');
    onnx = true;
  } catch (e) {
    errors.push(`onnxruntime-node: ${(e as Error)?.message ?? e}`);
  }
  try {
    await import('sharp');
    images = true;
  } catch (e) {
    errors.push(`sharp: ${(e as Error)?.message ?? e}`);
  }
  return { model, onnx, images, ...(errors.length ? { error: errors.join('; ') } : {}) };
}

// Una inferencia cada vez por instancia: con dos a la vez se dobla la memoria y la CPU es la misma.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const r = queue.then(fn, fn);
  queue = r.catch(() => undefined);
  return r;
}

export interface MaskResult {
  png: Buffer;
  width: number;
  height: number;
  warm: boolean;
  ms: { total: number; decode: number; inference: number; refine: number; png: number };
}

export async function maskFromPhoto(photo: Uint8Array): Promise<MaskResult> {
  return enqueue(async () => {
    const t0 = performance.now();
    const sharp = await loadSharp();
    let decoded: { data: Buffer; info: { width: number; height: number } };
    try {
      decoded = await sharp(photo, { limitInputPixels: MAX_INPUT_SIDE * MAX_INPUT_SIDE, failOn: 'error' })
        .rotate() // orientación EXIF, como la decodifica el navegador
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch (e) {
      throw new BadPhoto(`No se pudo leer la foto: ${(e as Error)?.message ?? e}`);
    }
    const { width, height } = decoded.info;
    if (Math.max(width, height) > MAX_INPUT_SIDE) throw new BadPhoto('La foto es demasiado grande');
    const input = isnetInput(decoded.data, width, height, MODEL_SIDE);
    const t1 = performance.now();

    const warm = session !== null;
    const { ort, s } = await loadSession();
    const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, MODEL_SIDE, MODEL_SIDE]) });
    const prediction = out[s.outputNames[0]!]!.data as Float32Array;
    const mask = normalizePrediction(prediction);
    const t2 = performance.now();

    const { alpha, opaque } = refineMask({ data: decoded.data, width, height, mask, maskSide: MODEL_SIDE });
    if (opaque < alpha.length * MIN_SUBJECT_FRACTION) throw new NoSubject();
    const t3 = performance.now();

    const png = await sharp(Buffer.from(alpha.buffer, alpha.byteOffset, alpha.byteLength), {
      raw: { width, height, channels: 1 },
    })
      .png({ compressionLevel: 6, adaptiveFiltering: true })
      .toBuffer();
    const t4 = performance.now();
    return {
      png,
      width,
      height,
      warm,
      ms: {
        total: Math.round(t4 - t0),
        decode: Math.round(t1 - t0),
        inference: Math.round(t2 - t1),
        refine: Math.round(t3 - t2),
        png: Math.round(t4 - t3),
      },
    };
  });
}
