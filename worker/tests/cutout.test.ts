// «Quitar el fondo» (media.cutout) con archivos reales (sharp) y un motor doble: la sesión de
// onnxruntime no se carga aquí (pesa 219 MB); lo que se prueba es la tubería del trabajador:
// leer la foto (EXIF), preparar la entrada, abrir y LIBERAR la sesión por trabajo, aplicar la
// máscara, escribir el PNG con alfa y los rechazos. La medición con el modelo real va en
// scripts/bench-cutout.ts.
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BEN2_MODEL_NAME, type CutoutEngine } from '../src/cutout/engine.ts';
import { PermanentError } from '../src/errors.ts';
import { createCutoutHandler, cutoutPayloadSchema, type CutoutPayload } from '../src/handlers/cutout.ts';
import { createMediaHandlers } from '../src/handlers/index.ts';
import { createMemoryLogger } from '../src/logger.ts';
import { renderShared, TARGET_DIR } from '../scripts/sync-cutout.ts';
import { createBucket, deps, inBrand, OTHER_BRAND, ORG, runHandler, type Bucket } from './helpers/media.ts';

const SIDE = 1024;

/** Máscara de BEN2 de mentira: una elipse centrada (1 dentro, 0 fuera) o lo que se pida. */
const ellipse = (): Float32Array => {
  const out = new Float32Array(SIDE * SIDE);
  const c = SIDE / 2;
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      out[y * SIDE + x] = ((x - c) / (c * 0.6)) ** 2 + ((y - c) / (c * 0.6)) ** 2 <= 1 ? 1 : 0;
    }
  }
  return out;
};

interface Fake {
  engine: CutoutEngine;
  opened: number;
  released: number;
  inputs: Float32Array[];
}

function fakeEngine(mask: () => Float32Array | Error = ellipse): Fake {
  const state: Fake = {
    opened: 0,
    released: 0,
    inputs: [],
    engine: {
      model: BEN2_MODEL_NAME,
      async open() {
        state.opened += 1;
        let released = false;
        return {
          async run(input) {
            state.inputs.push(input);
            const result = mask();
            if (result instanceof Error) throw result;
            return result;
          },
          async release() {
            if (released) return;
            released = true;
            state.released += 1;
          },
        };
      },
    },
  };
  return state;
}

let bucket: Bucket;
let n = 0;
const payload = (source: string, out = `${n++}.png`): CutoutPayload => ({
  source: { path: inBrand(source) },
  output: { path: `${ORG}/22222222-2222-4222-8222-222222222222/ediciones/${out}` },
  model: BEN2_MODEL_NAME,
  engine: 'servidor',
});

beforeAll(async () => {
  bucket = await createBucket();
  // Foto de 600×400, roja, con la orientación EXIF 6 (el móvil la hizo girado 90°): derecha mide 400×600.
  await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(bucket.file(inBrand('movil.jpg')));
  await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 20, g: 120, b: 200 } } })
    .png()
    .toFile(bucket.file(inBrand('plana.png')));
  await sharp({ create: { width: 5000, height: 2500, channels: 3, background: '#888' } })
    .jpeg({ quality: 40 })
    .toFile(bucket.file(inBrand('grande.jpg')));
  await writeFile(bucket.file(inBrand('notas.txt')), 'esto no es una imagen');
});

afterAll(async () => {
  await bucket?.cleanup();
});

describe('media.cutout', () => {
  it('foto con EXIF → PNG con alfa: sujeto opaco, fondo transparente, medidas de la foto ya derecha', async () => {
    const fake = fakeEngine();
    const p = payload('movil.jpg');
    const result = await runHandler(createCutoutHandler({ engine: fake.engine }), bucket, p);

    expect(result.source).toEqual({ width: 400, height: 600 });
    expect(result.model).toBe(BEN2_MODEL_NAME);
    expect(result.output).toMatchObject({ path: p.output.path, width: 400, height: 600 });
    expect((result.output as { bytes: number }).bytes).toBeGreaterThan(100);
    expect(result.timings).toHaveProperty('inferenceMs');
    expect(result.peakRssMb).toBeGreaterThan(10);

    const file = bucket.file(p.output.path);
    const meta = await sharp(file).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 400, height: 600, channels: 4, hasAlpha: true });
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]!;
    expect(alphaAt(200, 300)).toBe(255); // centro: sujeto
    expect(alphaAt(2, 2)).toBe(0); // esquina: fondo
    expect(alphaAt(397, 597)).toBe(0);
    // El color de la foto no cambia, solo el alfa.
    expect(data[(300 * info.width + 200) * info.channels]).toBeGreaterThan(150);
  });

  it('abre UNA sesión por trabajo y la libera siempre (también si falla), una tras otra (sesión doble)', async () => {
    const fake = fakeEngine();
    const handler = createCutoutHandler({ engine: fake.engine });
    await runHandler(handler, bucket, payload('plana.png'));
    await runHandler(handler, bucket, payload('movil.jpg'));
    expect(fake).toMatchObject({ opened: 2, released: 2 });

    // Falla la inferencia: se libera igual y el error se propaga (reintentable).
    const roto = fakeEngine(() => new Error('onnxruntime se ha quedado sin memoria'));
    await expect(
      runHandler(createCutoutHandler({ engine: roto.engine }), bucket, payload('plana.png')),
    ).rejects.toThrow(/sin memoria/);
    expect(roto).toMatchObject({ opened: 1, released: 1 });

    // Sin sujeto (máscara vacía): fallo permanente, sesión liberada, nada que subir.
    const vacio = fakeEngine(() => new Float32Array(SIDE * SIDE));
    const p = payload('plana.png');
    const error = await runHandler(createCutoutHandler({ engine: vacio.engine }), bucket, p).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentError);
    expect((error as Error).message).toMatch(/nada que recortar/);
    expect(vacio).toMatchObject({ opened: 1, released: 1 });
    await expect(sharp(bucket.file(p.output.path)).metadata()).rejects.toThrow();
  });

  it('prepara la entrada como el navegador: 1×3×1024×1024 con la normalización de ImageNet', async () => {
    const fake = fakeEngine();
    await runHandler(createCutoutHandler({ engine: fake.engine }), bucket, payload('plana.png'));
    const input = fake.inputs[0]!;
    expect(input).toHaveLength(3 * SIDE * SIDE);
    // Foto azulada (20,120,200): canal 0 = (20/255 − 0,485)/0,229 ≈ −1,83; canal 2 = (200/255 − 0,406)/0,225 ≈ 1,68.
    expect(input[0]).toBeCloseTo((20 / 255 - 0.485) / 0.229, 1);
    expect(input[2 * SIDE * SIDE]).toBeCloseTo((200 / 255 - 0.406) / 0.225, 1);
  });

  it('una foto de 5000 px se reduce a 4096 de lado mayor antes de procesarla', async () => {
    const result = await runHandler(
      createCutoutHandler({ engine: fakeEngine().engine }),
      bucket,
      payload('grande.jpg'),
    );
    expect(result.output).toMatchObject({ width: 4096, height: 2048 });
  });

  it('rechaza lo que no es una carga válida, una ruta de otra marca o un archivo que no es imagen', async () => {
    const handler = createCutoutHandler({ engine: fakeEngine().engine });
    const good = payload('plana.png');
    // Campo de más, modelo o motor distintos a los que fija la base de datos.
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, model: 'otro' },
      { ...good, engine: 'navegador' },
      { source: good.source, model: good.model, engine: good.engine },
    ]) {
      await expect(runHandler(handler, bucket, bad)).rejects.toBeInstanceOf(PermanentError);
    }
    // Entrada y salida solo dentro de la marca del trabajo.
    await expect(
      runHandler(handler, bucket, { ...good, source: { path: `${ORG}/${OTHER_BRAND}/media/a.jpg` } }),
    ).rejects.toThrow(/marca/i);
    await expect(
      runHandler(handler, bucket, { ...good, output: { path: `${ORG}/${OTHER_BRAND}/ediciones/a.png` } }),
    ).rejects.toThrow(/marca/i);
    await expect(runHandler(handler, bucket, payload('notas.txt'))).rejects.toBeInstanceOf(PermanentError);
  });

  it('el esquema acepta lo que fija la base de datos y nada más', () => {
    expect(cutoutPayloadSchema.safeParse(payload('plana.png')).success).toBe(true);
    expect(
      cutoutPayloadSchema.safeParse({ ...payload('plana.png'), output: { path: 'x/y/z/w/q', x: 1 } }).success,
    ).toBe(false);
  });
});

describe('registro por fases de media.cutout', () => {
  const phaseLines = (log: ReturnType<typeof createMemoryLogger>) =>
    log.entries.filter((entry) => entry.event === 'cutout.phase');

  it('escribe una línea por fase, con su duración, y ninguna lleva rutas, nombres de archivo ni URL', async () => {
    const fake = fakeEngine();
    const open = fake.engine.open.bind(fake.engine);
    // Un motor de verdad dice además qué costó abrir el modelo (leerlo del disco y crear la sesión).
    fake.engine.open = async (signal) => {
      const session = await open(signal);
      session.opened = { modelBytes: 219_121_675, modelReadMs: 90, sessionMs: 1400, cpuMs: 1500 };
      const run = session.run.bind(session);
      session.run = async (input, runSignal) => {
        const alphas = await run(input, runSignal);
        session.lastRun = { cpuMs: 30_000, peakRssMb: 2200 };
        return alphas;
      };
      return session;
    };
    const log = createMemoryLogger();
    const p = payload('movil.jpg');
    const result = await runHandler(createCutoutHandler({ engine: fake.engine }), bucket, p, {}, { log });

    const lines = phaseLines(log);
    expect(lines.map((line) => line.phase)).toEqual([
      'download',
      'decode',
      'model_fetch',
      'load',
      'inference',
      'refine',
      'encode',
      'upload',
    ]);
    for (const line of lines) {
      expect(line).toMatchObject({ level: 'info', jobId: 'prueba', attempt: 1 });
      expect(typeof line.ms, String(line.phase)).toBe('number');
      expect(line.ms).toBeGreaterThanOrEqual(0);
    }
    const byPhase = Object.fromEntries(lines.map((line) => [line.phase, line]));
    expect(byPhase.model_fetch).toMatchObject({ ms: 90, bytes: 219_121_675, source: 'local-file' });
    expect(byPhase.load).toMatchObject({ cpuMs: 1500, sessionMs: 1400 });
    expect(byPhase.inference).toMatchObject({ cpuMs: 30_000, modelPeakRssMb: 2200 });
    expect(byPhase.decode).toMatchObject({ width: 400, height: 600 });
    expect(byPhase.upload!.bytes).toBe((result.output as { bytes: number }).bytes);

    // Nada que identifique a nadie: ni la organización ni la marca (van en las rutas), ni archivos, ni direcciones.
    const text = JSON.stringify(log.entries);
    expect(text).not.toContain(ORG);
    expect(text).not.toContain('2222-4222');
    expect(text).not.toMatch(/movil|\.jpg|\.png|https?:|ediciones|pruebas/);

    // Los tiempos del resultado no se solapan (la base de datos los SUMA como segundos de máquina) y el pico es el del modelo.
    const timings = result.timings as Record<string, number>;
    expect(Object.keys(timings).sort()).toEqual(
      ['downloadMs', 'encodeMs', 'inferenceMs', 'loadMs', 'modelReadMs', 'postMs', 'prepareMs', 'uploadMs'].sort(),
    );
    expect(timings.modelReadMs).toBe(90);
    expect(Object.values(timings).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(result.peakRssMb).toBe(2200);
  });

  it('si una fase se corta (fallo o cancelación), queda dicho en cuál y la señal llega al motor', async () => {
    const roto = fakeEngine(() => new Error('onnxruntime se ha quedado sin memoria'));
    const log = createMemoryLogger();
    await expect(
      runHandler(createCutoutHandler({ engine: roto.engine }), bucket, payload('plana.png'), {}, { log }),
    ).rejects.toThrow(/sin memoria/);
    expect(phaseLines(log).at(-1)).toMatchObject({ level: 'warn', phase: 'inference', ok: false });

    // Cancelado mientras el modelo calcula: el motor recibe la señal (el de verdad mata su proceso).
    const controller = new AbortController();
    const reason = new Error('La reserva ya no es de este trabajador');
    let released = 0;
    const colgado: CutoutEngine = {
      model: BEN2_MODEL_NAME,
      async open() {
        return {
          run: (_input, signal) =>
            new Promise<Float32Array>((_resolve, reject) => {
              signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
              setTimeout(() => controller.abort(reason), 20);
            }),
          async release() {
            released += 1;
          },
        };
      },
    };
    const log2 = createMemoryLogger();
    await expect(
      runHandler(
        createCutoutHandler({ engine: colgado }),
        bucket,
        payload('plana.png'),
        {},
        { log: log2, signal: controller.signal },
      ),
    ).rejects.toBe(reason);
    expect(released).toBe(1);
    expect(phaseLines(log2).at(-1)).toMatchObject({ phase: 'inference', ok: false });
  });
});

describe('registro del manejador', () => {
  const kinds = (cutout?: CutoutEngine) => createMediaHandlers({ ...deps, cutout }).map((h) => h.kind);

  it('sin modelo en la máquina no se reclama media.cutout; con él, sí', () => {
    expect(kinds()).not.toContain('media.cutout');
    expect(kinds(fakeEngine().engine)).toContain('media.cutout');
  });
});

describe('módulos compartidos con el navegador', () => {
  const sourceDir = fileURLToPath(new URL('../../src/features/photo-edit/cutout', import.meta.url));
  // En la imagen Docker de pruebas solo está worker/: sin la aplicación al lado no hay con qué comparar.
  const withApp = (() => {
    try {
      readFileSync(path.join(sourceDir, 'mask.ts'));
      return true;
    } catch {
      return false;
    }
  })();

  it.runIf(withApp)('las copias de src/cutout/shared son las de la aplicación (npm run sync:cutout)', () => {
    for (const [file, content] of Object.entries(renderShared())) {
      expect(readFileSync(path.join(TARGET_DIR, file), 'utf8').replace(/\r\n/g, '\n'), file).toBe(content);
    }
  });
});
