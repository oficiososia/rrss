// BEN2 / IS-Net: preprocesado, postprocesado, elección de motor y caída al
// respaldo. Sin modelos ni navegador: los modelos se sustituyen por dobles.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pixels } from '../pixels';
import {
  ben2FailedThisSession,
  removeBackgroundInBrowser,
  resetCutoutSession,
  type CutoutDeps,
  type CutoutProgress,
  type ModelRun,
} from './engine';
import { ModelDownloadError } from './download';
import { applyMask, ben2Mask, NoSubjectError, resizeAreaChannel, toBen2Input } from './mask';
import { BEN2_MODEL_NAME, CUTOUT_MODEL_NAME, engineSpec, MODEL_SIDE } from './model';
import { chooseEngine } from './select';

const photo = (width = 16, height = 12): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([200, 100, 50, 255], i * 4);
  return { data, width, height };
};
const gpu = { requestAdapter: async () => ({}) };

describe('preprocesado de BEN2', () => {
  it('1×3×1024×1024, con la media y desviación de ImageNet y sin tocar la foto', () => {
    const src = photo();
    const copy = new Uint8ClampedArray(src.data);
    const t = toBen2Input(src);
    expect(t).toHaveLength(3 * MODEL_SIDE * MODEL_SIDE);
    const n = MODEL_SIDE * MODEL_SIDE;
    expect(t[0]).toBeCloseTo((200 / 255 - 0.485) / 0.229, 4);
    expect(t[n]).toBeCloseTo((100 / 255 - 0.456) / 0.224, 4);
    expect(t[2 * n + n - 1]).toBeCloseTo((50 / 255 - 0.406) / 0.225, 4);
    expect(src.data).toEqual(copy);
  });

  it('la transparencia se pone sobre blanco', () => {
    const src = photo(4, 4);
    src.data.fill(0);
    expect(toBen2Input(src, 8)[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
  });

  it('al encoger promedia el área (sin escalones) y al agrandar interpola', () => {
    expect(Array.from(resizeAreaChannel([0, 0, 100, 100], 4, 1, 2, 1))).toEqual([0, 100]);
    expect(resizeAreaChannel([0, 0, 100, 100], 4, 1, 1, 1)[0]).toBeCloseTo(50, 5);
    // Razón fraccionaria: 3 → 2 pesa los bordes por su fracción de área.
    const out = resizeAreaChannel([0, 30, 60], 3, 1, 2, 1);
    expect(out[0]).toBeCloseTo((0 * 1 + 30 * 0.5) / 1.5, 4);
    expect(out[1]).toBeCloseTo((30 * 0.5 + 60 * 1) / 1.5, 4);
    const up = resizeAreaChannel([0, 100], 2, 1, 4, 1);
    expect(up[0]).toBe(0);
    expect(up[3]).toBe(100);
  });
});

describe('postprocesado de BEN2', () => {
  it('la salida (ya 0–1) pasa a 0–255 sin normalizar entre mínimo y máximo y sin curva', () => {
    expect(Array.from(ben2Mask([0, 0.5, 1, 1.2, -0.3, NaN]))).toEqual([0, 127.5, 255, 255, 0, 0]);
    const src = photo(8, 8);
    const alphas = new Float32Array(MODEL_SIDE * MODEL_SIDE).fill(0.6); // medio tono: se conserva (IS-Net lo endurecería)
    const out = applyMask(src, ben2Mask(alphas), MODEL_SIDE, 'clean');
    expect(out.data[3]).toBe(Math.round(255 * 0.6));
    expect(out.data[0]).toBe(200); // el color no se toca
  });

  it('la máscara se reescala al tamaño de la foto y, si no hay sujeto, lo dice', () => {
    const src = photo(30, 20);
    const half = new Float32Array(MODEL_SIDE * MODEL_SIDE);
    for (let y = 0; y < MODEL_SIDE; y += 1) half.fill(1, y * MODEL_SIDE, y * MODEL_SIDE + MODEL_SIDE / 2);
    const out = applyMask(src, ben2Mask(half), MODEL_SIDE, 'clean');
    expect([out.width, out.height]).toEqual([30, 20]);
    expect(out.data[(5 * 30 + 3) * 4 + 3]).toBe(255);
    expect(out.data[(5 * 30 + 27) * 4 + 3]).toBe(0);
    expect(() => applyMask(src, ben2Mask(new Float32Array(MODEL_SIDE * MODEL_SIDE)), MODEL_SIDE, 'clean')).toThrow(
      NoSubjectError,
    );
  });
});

describe('elección de motor', () => {
  it('BEN2 solo con WebGPU (API y adaptador) y memoria suficiente', async () => {
    expect(await chooseEngine({ gpu })).toEqual({ engine: 'ben2' });
    expect(await chooseEngine({ gpu, deviceMemory: 8 })).toEqual({ engine: 'ben2' });
    expect(await chooseEngine({ gpu: null })).toEqual({ engine: 'isnet', reason: 'no-webgpu' });
    expect(await chooseEngine({ gpu: { requestAdapter: async () => null } })).toEqual({
      engine: 'isnet',
      reason: 'no-adapter',
    });
    const broken = {
      requestAdapter: async () => {
        throw new Error('x');
      },
    };
    expect(await chooseEngine({ gpu: broken })).toEqual({ engine: 'isnet', reason: 'no-adapter' });
    expect(await chooseEngine({ gpu, deviceMemory: 2 })).toEqual({ engine: 'isnet', reason: 'low-memory' });
    expect(await chooseEngine({ gpu, ben2Failed: true })).toEqual({ engine: 'isnet', reason: 'failed-before' });
  });

  it('las fichas: BEN2 de 219 MB y calidad alta; IS-Net de respaldo, básico', () => {
    expect(engineSpec('ben2')).toMatchObject({
      name: BEN2_MODEL_NAME,
      bytes: 219_121_675,
      side: 1024,
      quality: 'high',
    });
    expect(engineSpec('ben2').url).toContain('onnx-community/BEN2-ONNX');
    expect(engineSpec('isnet')).toMatchObject({ name: CUTOUT_MODEL_NAME, quality: 'basic' });
  });
});

describe('caída al respaldo', () => {
  beforeEach(() => {
    resetCutoutSession();
    // El entorno de pruebas de lógica no tiene Worker; basta con que exista (los modelos son dobles).
    vi.stubGlobal('Worker', class {});
  });
  afterEach(() => vi.unstubAllGlobals());
  /** Sujeto a la izquierda (valor alto) y fondo a la derecha; `0` = no hay sujeto. */
  const run = (value = 0.9): ModelRun => {
    const prediction = new Float32Array(MODEL_SIDE * MODEL_SIDE);
    for (let y = 0; y < MODEL_SIDE; y += 1) prediction.fill(value, y * MODEL_SIDE, y * MODEL_SIDE + MODEL_SIDE / 2);
    return { prediction, provider: 'webgpu', fromCache: false };
  };
  const deps = (runModel: CutoutDeps['runModel'], withGpu = true): CutoutDeps => ({
    probe: (ben2Failed) => ({ gpu: withGpu ? gpu : null, ben2Failed }),
    runModel,
  });

  it('con WebGPU usa BEN2 y lo apunta como motor y modelo', async () => {
    const seen: string[] = [];
    const result = await removeBackgroundInBrowser(photo(), undefined, {
      deps: deps(async (spec) => {
        seen.push(spec.id);
        return run();
      }),
    });
    expect(seen).toEqual(['ben2']);
    expect(result).toMatchObject({ engine: 'ben2', quality: 'high', model: BEN2_MODEL_NAME });
  });

  it('sin WebGPU usa IS-Net, calidad básica', async () => {
    const seen: string[] = [];
    const result = await removeBackgroundInBrowser(photo(), undefined, {
      deps: deps(async (spec) => {
        seen.push(spec.id);
        return run();
      }, false),
    });
    expect(seen).toEqual(['isnet']);
    expect(result).toMatchObject({ engine: 'isnet', quality: 'basic', model: CUTOUT_MODEL_NAME });
  });

  it('si BEN2 falla al ejecutarse, sigue con IS-Net, lo recuerda y no vuelve a intentarlo', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const seen: string[] = [];
    const runModel: CutoutDeps['runModel'] = async (spec) => {
      seen.push(spec.id);
      if (spec.id === 'ben2') throw new Error('Operador no soportado en WebGPU');
      return run();
    };
    const first = await removeBackgroundInBrowser(photo(), undefined, { deps: deps(runModel) });
    expect(first).toMatchObject({ engine: 'isnet', quality: 'basic' });
    expect(ben2FailedThisSession()).toBe(true);
    await removeBackgroundInBrowser(photo(), undefined, { deps: deps(runModel) });
    expect(seen).toEqual(['ben2', 'isnet', 'isnet']);
  });

  it('un corte de red al bajar BEN2 usa IS-Net esta vez, pero no lo descarta para la sesión', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = await removeBackgroundInBrowser(photo(), undefined, {
      deps: deps(async (spec) => {
        if (spec.id === 'ben2') throw new ModelDownloadError('sin red');
        return run();
      }),
    });
    expect(first.engine).toBe('isnet');
    expect(ben2FailedThisSession()).toBe(false);
  });

  it('«nada que recortar» y cancelar no provocan caída: se devuelven tal cual', async () => {
    const seen: string[] = [];
    await expect(
      removeBackgroundInBrowser(photo(), undefined, {
        deps: deps(async (spec) => {
          seen.push(spec.id);
          return run(0);
        }),
      }),
    ).rejects.toThrow(NoSubjectError);
    expect(seen).toEqual(['ben2']);

    const abort = new AbortController();
    abort.abort();
    await expect(
      removeBackgroundInBrowser(photo(), undefined, { signal: abort.signal, deps: deps(async () => run()) }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('el progreso de la descarga llega con el motor', async () => {
    const steps: CutoutProgress[] = [];
    await removeBackgroundInBrowser(photo(), (p) => steps.push(p), {
      deps: deps(async (spec, _input, onProgress) => {
        onProgress?.({ phase: 'downloading', received: 1, total: spec.bytes, engine: spec.id });
        return run();
      }),
    });
    expect(steps[0]).toMatchObject({ phase: 'downloading', engine: 'ben2', total: 219_121_675 });
  });
});
