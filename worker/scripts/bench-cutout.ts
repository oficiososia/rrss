// Mide el trabajo `media.cutout` COMPLETO (leer foto → modelo real → PNG) con onnxruntime-node:
// tiempo por fase y memoria. Es el mismo manejador que corre en Fly, con una carpeta local de cubo.
//
//   node scripts/bench-cutout.ts <modelo.onnx> <foto1> [foto2 …]
//   (variables: WORKER_CUTOUT_THREADS, por defecto 2; BENCH_OUT, carpeta donde dejar los PNG;
//    BENCH_ENGINE=process (por defecto, como en Fly: el modelo en un proceso hijo) o inline;
//    BENCH_PHASES=1 imprime también las líneas `cutout.phase` del registro)
//
// Para la memoria, cada foto va en un proceso nuevo si se pasa BENCH_FRESH=1 (lo hace el propio
// script volviéndose a lanzar): así el pico de cada foto no se mezcla con el de las anteriores.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOrtEngine } from '../src/cutout/engine.ts';
import { createProcessEngine } from '../src/cutout/process-engine.ts';
import { createCutoutHandler } from '../src/handlers/cutout.ts';
import { createMemoryLogger } from '../src/logger.ts';
import { createFolderStorage } from '../src/storage.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';

async function runOne(model: string, photo: string): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rrss-bench-'));
  const dir = path.join(root, ORG, BRAND, 'media');
  mkdirSync(dir, { recursive: true });
  const name = path.basename(photo);
  copyFileSync(photo, path.join(dir, name));
  const work = mkdtempSync(path.join(os.tmpdir(), 'rrss-bench-job-'));
  const threads = Number(process.env.WORKER_CUTOUT_THREADS) || 2;
  const engineKind = process.env.BENCH_ENGINE === 'inline' ? 'inline' : 'process';
  const engineOptions = { modelPath: model, threads };
  const handler = createCutoutHandler({
    engine: engineKind === 'inline' ? createOrtEngine(engineOptions) : createProcessEngine(engineOptions),
  });
  const log = createMemoryLogger();
  let peak = 0;
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
  const started = performance.now();
  const outPath = `${ORG}/${BRAND}/ediciones/${name.replace(/\.[^.]+$/, '')}.png`;
  try {
    const result = await handler.run({
      job: {
        id: 'bench',
        organization_id: ORG,
        brand_id: BRAND,
        kind: 'media.cutout',
        payload: {
          source: { path: `${ORG}/${BRAND}/media/${name}` },
          output: { path: outPath },
          model: 'ben2-base-fp16',
          engine: 'servidor',
        },
        attempts: 1,
        max_attempts: 3,
      },
      signal: new AbortController().signal,
      storage: createFolderStorage(root),
      workDir: work,
      log,
    });
    const total = Math.round(performance.now() - started);
    peak = Math.max(peak, process.memoryUsage().rss);
    if (process.env.BENCH_OUT) {
      mkdirSync(process.env.BENCH_OUT, { recursive: true });
      copyFileSync(path.join(root, outPath), path.join(process.env.BENCH_OUT, path.basename(outPath)));
    }
    if (process.env.BENCH_PHASES === '1') {
      for (const entry of log.entries) process.stdout.write(`${JSON.stringify(entry)}\n`);
    }
    process.stdout.write(
      `${JSON.stringify({
        photo: name,
        engine: engineKind,
        threads,
        totalMs: total,
        timings: result.timings,
        output: result.output,
        peakRssMb_sampled: Math.round(peak / 1048576),
        peakRssMb_os: result.peakRssMb,
      })}\n`,
    );
  } finally {
    clearInterval(timer);
    rmSync(root, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

const [model, ...photos] = process.argv.slice(2);
if (!model || photos.length === 0) {
  process.stderr.write('Uso: node scripts/bench-cutout.ts <modelo.onnx> <foto> [foto…]\n');
  process.exit(2);
}
if (process.env.BENCH_FRESH === '1') {
  await runOne(model, photos[0]!);
} else {
  for (const photo of photos) {
    const r = spawnSync(process.execPath, [process.argv[1]!, model, photo], {
      env: { ...process.env, BENCH_FRESH: '1' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}
