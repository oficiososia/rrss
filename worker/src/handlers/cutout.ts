// Quitar el fondo de una foto de la biblioteca: foto → PNG con alfa en «Ediciones».
//
//   media.cutout   { source: { path }, output: { path }, model: 'ben2-base-fp16', engine: 'servidor' }
//
// La base de datos (`request_media_job`, migración 20261214010000) fija la ruta de salida, el
// modelo y el motor: el cliente solo dice qué foto. El resultado entra solo en la biblioteca
// (disparador de `jobs`), con la procedencia {model, engine, source_asset_id}.
//
// El preprocesado y el postprocesado son los MISMOS módulos que usa el navegador
// (src/features/photo-edit/cutout/, copiados a src/cutout/shared/ por scripts/sync-cutout.ts):
// entrada ImageNet 1024×1024, máscara `alphas` de 0 a 1, limpieza de motas y reescalado.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BEN2_MODEL_NAME, type CutoutEngine, type CutoutSession } from '../cutout/engine.ts';
import { ben2Mask, applyMask, NoSubjectError, toBen2Input } from '../cutout/shared/mask.ts';
import type { Pixels } from '../cutout/shared/types.ts';
import { PermanentError } from '../errors.ts';
import type { Handler, HandlerContext } from '../handler.ts';
import type { LogFields } from '../logger.ts';
import { readSwapUsedMb, readSystemCpu, type SystemCpu } from '../sysstat.ts';
import { assertOutputPaths, fetchInput, parsePayload, storagePathSchema, storeOutput } from './shared.ts';

export const CUTOUT_KIND = 'media.cutout';

/** Lado mayor con el que se trabaja y se devuelve: acota memoria, tiempo y el peso del PNG. */
export const CUTOUT_MAX_SIDE = 4096;
/** Más píxeles que esto (en la foto de origen, antes de reducirla) no se abren. */
export const CUTOUT_MAX_INPUT_PIXELS = 100_000_000;
/** Cada cuánto se escribe el latido mientras una fase sigue en marcha. */
export const CUTOUT_HEARTBEAT_MS = 15_000;

// Sin campos que admitan null: `request_media_job` hace jsonb_strip_nulls y un null desaparecería de la carga
// (en un esquema nuevo, todo campo nullable necesita `.default(null)`).
export const cutoutPayloadSchema = z.strictObject({
  source: z.strictObject({ path: storagePathSchema }),
  output: z.strictObject({ path: storagePathSchema }),
  model: z.literal(BEN2_MODEL_NAME),
  engine: z.literal('servidor'),
});
export type CutoutPayload = z.input<typeof cutoutPayloadSchema>;

type Sharp = typeof import('sharp');
let sharpModule: Sharp | null = null;
async function loadSharp(): Promise<Sharp> {
  if (!sharpModule) {
    const loaded = ((await import('sharp')) as unknown as { default: Sharp }).default;
    // Sin caché de archivos ni de operaciones: la máquina vive minutos y la memoria es lo escaso.
    loaded.cache(false);
    sharpModule = loaded;
  }
  return sharpModule;
}

const elapsedMs = (since: number) => Math.round(performance.now() - since);
const megabytes = (bytes: number) => Math.round(bytes / 1024 / 1024);
const cpuMsOf = (since: NodeJS.CpuUsage) => {
  const used = process.cpuUsage(since);
  return Math.round((used.user + used.system) / 1000);
};

/** Fases del trabajo, en orden. Cada una deja una línea `cutout.phase` en el registro. */
export type CutoutPhase =
  | 'download' // bajar la foto del almacén
  | 'decode' // foto → píxeles y tensor de entrada
  | 'model_fetch' // leer el archivo del modelo del disco (va dentro de la imagen: no se descarga)
  | 'load' // lanzar el proceso del modelo y crear la sesión de onnxruntime
  | 'inference' // el modelo
  | 'refine' // máscara → alfa (limpieza de motas, islas y agujeros)
  | 'encode' // PNG con alfa
  | 'upload'; // subir el resultado

/**
 * Registro por fases. Una línea `cutout.phase` al terminar cada una (o al cortarse, con
 * `ok: false`) y un latido `cutout.heartbeat` cada 15 s mientras una sigue en marcha, para que
 * entre `job.started` y el final nunca haya un silencio de minutos.
 *
 * Campos: `ms` (reloj), `cpuMs` (procesador gastado), `rssMb` y, en Linux, `stealMs`
 * (procesador que el anfitrión no dio), `iowaitMs` y `swapUsedMb` (src/sysstat.ts). Si `ms` es
 * mucho mayor que `cpuMs` ÷ hilos y `stealMs` es alto, a la máquina la están frenando.
 * Nunca rutas, nombres de archivo ni URL: solo el trabajo, números y medidas.
 */
function createPhaseLog(context: HandlerContext) {
  const base = { jobId: context.job.id, attempt: context.job.attempts };
  const jobStart = performance.now();
  let open: { name: CutoutPhase; t: number; cpu: NodeJS.CpuUsage; sys: SystemCpu | undefined } | undefined;
  /** CPU de quien calcula cuando no es este proceso (el hijo del modelo). */
  let externalCpu: (() => number | undefined) | undefined;

  const system = (since: SystemCpu | undefined): LogFields => {
    const now = readSystemCpu();
    const swapUsedMb = readSwapUsedMb();
    return {
      ...(since && now ? { stealMs: now.stealMs - since.stealMs, iowaitMs: now.iowaitMs - since.iowaitMs } : {}),
      ...(swapUsedMb === undefined ? {} : { swapUsedMb }),
    };
  };

  const heartbeat = setInterval(() => {
    if (!open) return;
    const modelCpuMs = externalCpu?.();
    context.log.info('cutout.heartbeat', {
      ...base,
      phase: open.name,
      phaseMs: elapsedMs(open.t),
      totalMs: elapsedMs(jobStart),
      ...(modelCpuMs === undefined ? {} : { modelCpuMs }),
      ...system(open.sys),
    });
  }, CUTOUT_HEARTBEAT_MS);
  heartbeat.unref();

  return {
    begin(name: CutoutPhase) {
      open = { name, t: performance.now(), cpu: process.cpuUsage(), sys: readSystemCpu() };
    },
    /** Cierra la fase abierta y devuelve lo que duró. `extra` puede corregir `cpuMs` (si lo gastó el hijo). */
    end(extra: LogFields = {}): number {
      if (!open) return 0;
      const ms = elapsedMs(open.t);
      context.log.info('cutout.phase', {
        ...base,
        phase: open.name,
        ms,
        cpuMs: cpuMsOf(open.cpu),
        rssMb: megabytes(process.memoryUsage().rss),
        ...system(open.sys),
        ...extra,
      });
      open = undefined;
      return ms;
    },
    /** Línea de una fase que ha medido otro (leer el modelo, dentro del hijo). */
    note(phase: CutoutPhase, fields: LogFields) {
      context.log.info('cutout.phase', { ...base, phase, ...fields });
    },
    watchCpu(read: (() => number | undefined) | undefined) {
      externalCpu = read;
    },
    /** Al salir del manejador: si una fase quedó a medias (fallo o cancelación), se dice cuál y cuánto llevaba. */
    close() {
      clearInterval(heartbeat);
      if (!open) return;
      context.log.warn('cutout.phase', {
        ...base,
        phase: open.name,
        ms: elapsedMs(open.t),
        ok: false,
        ...system(open.sys),
      });
      open = undefined;
    },
  };
}

export interface CutoutDeps {
  engine: CutoutEngine;
}

export function createCutoutHandler(deps: CutoutDeps): Handler {
  return {
    kind: CUTOUT_KIND,
    async run(context) {
      const payload = parsePayload(cutoutPayloadSchema, context.job.payload);
      assertOutputPaths(context, [payload.output.path]);
      // Fases sin solaparse y solo números: `private.job_machine_ms` (migración 20261219010000) SUMA estos valores.
      const timings: Record<string, number> = {};
      const phases = createPhaseLog(context);
      try {
        phases.begin('download');
        const sourceFile = await fetchInput(context, payload.source.path, 'source');
        timings.downloadMs = phases.end({ bytes: (await stat(sourceFile)).size });

        // 1. Foto → píxeles RGBA derechos (EXIF aplicado) y a ≤ 4096 px.
        phases.begin('decode');
        const sharp = await loadSharp();
        let image: Pixels;
        try {
          const decoded = await sharp(sourceFile, { limitInputPixels: CUTOUT_MAX_INPUT_PIXELS, failOn: 'error' })
            .rotate()
            .resize({ width: CUTOUT_MAX_SIDE, height: CUTOUT_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          image = {
            data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
            width: decoded.info.width,
            height: decoded.info.height,
          };
        } catch (error) {
          // Imagen corrupta, formato que no se lee o demasiados píxeles: reintentar no lo arregla.
          throw new PermanentError(`No se puede leer la foto de origen: ${(error as Error).message}`);
        }
        const input = toBen2Input(image);
        timings.prepareMs = phases.end({ width: image.width, height: image.height });
        context.signal.throwIfAborted();

        // 2. Modelo: la sesión se abre para ESTE trabajo y se libera pase lo que pase.
        let alphas: Float32Array;
        let modelPeakRssMb: number | undefined;
        let session: CutoutSession | undefined;
        try {
          phases.begin('load');
          session = await deps.engine.open(context.signal);
          phases.watchCpu(session.cpuMs?.bind(session));
          const opened = session.opened;
          if (opened) {
            // Leer el archivo del modelo es parte de abrir la sesión; va aparte para saber si lo lento es el disco.
            phases.note('model_fetch', { ms: opened.modelReadMs, bytes: opened.modelBytes, source: 'local-file' });
            timings.modelReadMs = opened.modelReadMs;
          }
          const openMs = phases.end(opened ? { cpuMs: opened.cpuMs, sessionMs: opened.sessionMs } : {});
          timings.loadMs = Math.max(0, openMs - (opened?.modelReadMs ?? 0));

          phases.begin('inference');
          alphas = await session.run(input, context.signal);
          modelPeakRssMb = session.lastRun?.peakRssMb;
          timings.inferenceMs = phases.end(
            session.lastRun ? { cpuMs: session.lastRun.cpuMs, modelPeakRssMb: session.lastRun.peakRssMb } : {},
          );
        } finally {
          phases.watchCpu(undefined);
          await session?.release();
        }
        context.signal.throwIfAborted();

        // 3. Máscara → alfa de la foto (limpieza de motas, islas y agujeros), sin filtro guiado: BEN2 ya da medios tonos.
        phases.begin('refine');
        let cut: Pixels;
        try {
          cut = applyMask(image, ben2Mask(alphas), 1024, 'clean');
        } catch (error) {
          if (error instanceof NoSubjectError) throw new PermanentError(error.message);
          throw error;
        }
        timings.postMs = phases.end();

        // 4. PNG con alfa y a la biblioteca.
        phases.begin('encode');
        const outFile = path.join(context.workDir, 'output.png');
        await sharp(Buffer.from(cut.data.buffer, cut.data.byteOffset, cut.data.byteLength), {
          raw: { width: cut.width, height: cut.height, channels: 4 },
        })
          .png({ compressionLevel: 6 })
          .toFile(outFile);
        timings.encodeMs = phases.end({ bytes: (await stat(outFile)).size });
        phases.begin('upload');
        const bytes = await storeOutput(context, outFile, payload.output.path, 'image/png');
        timings.uploadMs = phases.end({ bytes });

        // Pico de memoria: el del proceso del modelo si va aparte; si no, el de este proceso (de todos sus
        // trabajos desde que arrancó; `maxRSS` va en KB).
        const peakRssMb = modelPeakRssMb ?? Math.round(process.resourceUsage().maxRSS / 1024);
        return {
          source: { width: image.width, height: image.height },
          model: payload.model,
          output: { path: payload.output.path, width: cut.width, height: cut.height, bytes },
          timings,
          peakRssMb,
        };
      } finally {
        phases.close();
      }
    },
  };
}
