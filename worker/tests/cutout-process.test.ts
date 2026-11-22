// El modelo de «Quitar el fondo» en un proceso hijo (src/cutout/process-engine.ts), con un hijo
// doble (tests/helpers/fake-cutout-child.ts): protocolo, tensores de tamaño real por el canal
// IPC, cancelación que MATA el hijo, hijo que muere solo y entorno sin secretos. El hijo de
// verdad (onnxruntime + BEN2) se mide con scripts/bench-cutout.ts.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BEN2_MODEL_NAME } from '../src/cutout/engine.ts';
import { childEnv, createProcessEngine } from '../src/cutout/process-engine.ts';
import { LeaseLostError } from '../src/errors.ts';
import { createCutoutHandler, CUTOUT_KIND } from '../src/handlers/cutout.ts';
import { createMemoryLogger } from '../src/logger.ts';
import type { Job, JobQueue } from '../src/queue.ts';
import { createFolderStorage } from '../src/storage.ts';
import { readProcessCpuMs, readSwapUsedMb, readSystemCpu } from '../src/sysstat.ts';
import { createWorker } from '../src/worker.ts';
import { BRAND, createBucket, inBrand, ORG } from './helpers/media.ts';

const childModule = fileURLToPath(new URL('./helpers/fake-cutout-child.ts', import.meta.url));
const engine = (mode: string) => createProcessEngine({ modelPath: mode, childModule });
const SIDE = 1024;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('motor del recorte en un proceso hijo', () => {
  it('abre, recorta con tensores de tamaño real y al liberar el hijo ya no existe', async () => {
    const session = await engine('ok').open();
    expect(session.opened).toMatchObject({ modelReadMs: 7, sessionMs: 11, cpuMs: 13 });
    const pid = session.opened!.modelBytes;
    expect(alive(pid)).toBe(true);

    const input = new Float32Array(3 * SIDE * SIDE);
    input[0] = 1;
    input[5] = -1;
    const alphas = await session.run(input);
    expect(alphas).toBeInstanceOf(Float32Array);
    expect(alphas).toHaveLength(SIDE * SIDE);
    expect([alphas[0], alphas[5]]).toEqual([1, 0]);
    expect(session.lastRun).toEqual({ cpuMs: 17, peakRssMb: 19 });

    await session.release();
    await session.release(); // se puede llamar dos veces
    expect(alive(pid)).toBe(false);
    await expect(session.run(input)).rejects.toThrow(/proceso del modelo/);
  });

  it('cancelar a media inferencia mata el hijo en el acto y devuelve el motivo de la cancelación', async () => {
    const session = await engine('hang').open();
    const pid = session.opened!.modelBytes;
    const controller = new AbortController();
    const reason = new Error('La reserva ya no es de este trabajador');
    const running = session.run(new Float32Array(3 * SIDE * SIDE), controller.signal);
    const aborted = Date.now();
    setTimeout(() => controller.abort(reason), 50);
    await expect(running).rejects.toBe(reason);
    await session.release();
    expect(Date.now() - aborted).toBeLessThan(5_000);
    expect(alive(pid)).toBe(false);
  });

  it('con la señal ya abortada no llega a lanzar nada', async () => {
    const controller = new AbortController();
    controller.abort(new Error('apagado'));
    await expect(engine('ok').open(controller.signal)).rejects.toThrow('apagado');
  });

  it('si el hijo muere solo o no puede abrir el modelo, el error lo dice y no queda nada vivo', async () => {
    const session = await engine('crash').open();
    await expect(session.run(new Float32Array(3 * SIDE * SIDE))).rejects.toThrow(
      /terminó antes de tiempo \(código 3\)/,
    );
    await session.release();
    await expect(engine('fail-open').open()).rejects.toThrow('No se puede abrir el modelo');
  });

  it('el hijo no recibe secretos ni la configuración de Supabase', async () => {
    expect(
      Object.keys(
        childEnv({
          PATH: '/usr/bin',
          WORKER_CUTOUT_THREADS: '2',
          WORKER_GATEWAY_TOKEN: 'x',
          SUPABASE_URL: 'x',
          SUPABASE_SERVICE_ROLE_KEY: 'x',
          FLY_API_TOKEN: 'x',
          R2_SECRET: 'x',
        }),
      ),
    ).toEqual(['PATH', 'WORKER_CUTOUT_THREADS']);

    process.env.WORKER_GATEWAY_TOKEN = 'valor-de-prueba';
    try {
      const error = (await engine('env')
        .open()
        .catch((e: unknown) => e)) as Error;
      expect(error.message).toMatch(/PATH/i);
      expect(error.message).not.toMatch(/TOKEN|SUPABASE/i);
    } finally {
      delete process.env.WORKER_GATEWAY_TOKEN;
    }
  });
});

describe('el bucle del trabajador con el modelo en un proceso hijo', () => {
  it('si el cliente cancela a media inferencia, lo descubre al renovar la reserva y mata el hijo', async () => {
    const bucket = await createBucket();
    try {
      await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 20, g: 120, b: 200 } } })
        .png()
        .toFile(bucket.file(inBrand('plana.png')));
      const job: Job = {
        id: 'job-1',
        organization_id: ORG,
        brand_id: BRAND,
        kind: CUTOUT_KIND,
        payload: {
          source: { path: inBrand('plana.png') },
          output: { path: `${ORG}/${BRAND}/ediciones/x.png` },
          model: BEN2_MODEL_NAME,
          engine: 'servidor',
        },
        attempts: 1,
        max_attempts: 3,
      };
      const logger = createMemoryLogger();
      const phase = (name: string) =>
        logger.entries.find((entry) => entry.event === 'cutout.phase' && entry.phase === name);
      let claimed = false;
      let renewals = 0;
      const closed: string[] = [];
      const queue: JobQueue = {
        async claim() {
          if (claimed) return [];
          claimed = true;
          return [job];
        },
        async complete() {
          closed.push('complete');
        },
        async fail() {
          closed.push('fail');
        },
        async release() {
          closed.push('release');
        },
        // El cliente cancela (cancel_media_job) en cuanto el modelo está cargado: la renovación siguiente lo ve.
        async extendLease() {
          renewals += 1;
          if (phase('load')) throw new LeaseLostError('El trabajo no está reservado por este trabajador');
        },
      };
      // El hijo «hang» no responde nunca al recortar: como una inferencia con el procesador frenado.
      const worker = createWorker({
        queue,
        storage: createFolderStorage(bucket.root),
        handlers: [createCutoutHandler({ engine: engine('hang') })],
        logger,
        workerId: 'trabajador-1',
        mode: 'drain',
        leaseSeconds: 30,
        renewEveryMs: 100,
        pollIntervalMs: 20,
        tmpRoot: path.join(bucket.root, 'tmp'),
      });
      const started = Date.now();
      const summary = await worker.run();

      // El bucle siguió vivo mientras el modelo «calculaba» (renovó la reserva) y cortó sin tocar la cola.
      expect(summary.outcomes).toMatchObject({ lease_lost: 1, succeeded: 0 });
      expect(renewals).toBeGreaterThanOrEqual(1);
      expect(closed).toEqual([]);
      expect(Date.now() - started).toBeLessThan(10_000);
      // Queda dicho en qué fase se cortó, y el proceso del modelo ya no existe.
      expect(logger.entries.filter((entry) => entry.event === 'cutout.phase').at(-1)).toMatchObject({
        phase: 'inference',
        ok: false,
      });
      expect(alive(phase('model_fetch')!.bytes as number)).toBe(false);
    } finally {
      await bucket.cleanup();
    }
  });
});

describe('contadores del sistema para el registro (src/sysstat.ts)', () => {
  it('lee steal, iowait, intercambio y CPU de un proceso de /proc; sin /proc, undefined', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rrss-sysstat-'));
    try {
      const stat = path.join(dir, 'stat');
      await writeFile(stat, 'cpu  1000 5 300 90000 42 0 7 1234 0 0\ncpu0 500 2 150 45000 21 0 3 617 0 0\n');
      expect(readSystemCpu(stat)).toEqual({ stealMs: 12_340, iowaitMs: 420 });

      const meminfo = path.join(dir, 'meminfo');
      await writeFile(meminfo, 'MemTotal:  4028304 kB\nSwapTotal:  1048572 kB\nSwapFree:   524284 kB\n');
      expect(readSwapUsedMb(meminfo)).toBe(512);

      const pidStat = path.join(dir, 'pid-stat');
      // El nombre del proceso lleva espacios y paréntesis: utime = 250 tics, stime = 50 tics.
      await writeFile(pidStat, '321 (node (hijo) x) R 1 321 321 0 -1 4194304 900 0 0 0 250 50 0 0 20 0 9 0 100 0 0\n');
      expect(readProcessCpuMs(321, pidStat)).toBe(3_000);

      const missing = path.join(dir, 'no-existe');
      expect(readSystemCpu(missing)).toBeUndefined();
      expect(readSwapUsedMb(missing)).toBeUndefined();
      expect(readProcessCpuMs(1, missing)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
