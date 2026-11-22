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
import path from 'node:path';
import { z } from 'zod';
import { BEN2_MODEL_NAME, type CutoutEngine, type CutoutSession } from '../cutout/engine.ts';
import { ben2Mask, applyMask, NoSubjectError, toBen2Input } from '../cutout/shared/mask.ts';
import type { Pixels } from '../cutout/shared/types.ts';
import { PermanentError } from '../errors.ts';
import type { Handler } from '../handler.ts';
import { assertOutputPaths, fetchInput, parsePayload, storagePathSchema, storeOutput } from './shared.ts';

export const CUTOUT_KIND = 'media.cutout';

/** Lado mayor con el que se trabaja y se devuelve: acota memoria, tiempo y el peso del PNG. */
export const CUTOUT_MAX_SIDE = 4096;
/** Más píxeles que esto (en la foto de origen, antes de reducirla) no se abren. */
export const CUTOUT_MAX_INPUT_PIXELS = 100_000_000;

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

const ms = (since: number) => Math.round(performance.now() - since);

export interface CutoutDeps {
  engine: CutoutEngine;
}

export function createCutoutHandler(deps: CutoutDeps): Handler {
  return {
    kind: CUTOUT_KIND,
    async run(context) {
      const payload = parsePayload(cutoutPayloadSchema, context.job.payload);
      assertOutputPaths(context, [payload.output.path]);
      const timings: Record<string, number> = {};
      let t = performance.now();

      const sourceFile = await fetchInput(context, payload.source.path, 'source');
      timings.downloadMs = ms(t);

      // 1. Foto → píxeles RGBA derechos (EXIF aplicado) y a ≤ 4096 px.
      t = performance.now();
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
      timings.prepareMs = ms(t);
      context.signal.throwIfAborted();

      // 2. Modelo: la sesión se abre para ESTE trabajo y se libera pase lo que pase.
      let alphas: Float32Array;
      let session: CutoutSession | undefined;
      try {
        t = performance.now();
        session = await deps.engine.open();
        timings.loadMs = ms(t);
        t = performance.now();
        alphas = await session.run(input, context.signal);
        timings.inferenceMs = ms(t);
      } finally {
        await session?.release();
      }
      context.signal.throwIfAborted();

      // 3. Máscara → alfa de la foto (limpieza de motas, islas y agujeros), sin filtro guiado: BEN2 ya da medios tonos.
      t = performance.now();
      let cut: Pixels;
      try {
        cut = applyMask(image, ben2Mask(alphas), 1024, 'clean');
      } catch (error) {
        if (error instanceof NoSubjectError) throw new PermanentError(error.message);
        throw error;
      }
      timings.postMs = ms(t);

      // 4. PNG con alfa y a la biblioteca.
      t = performance.now();
      const outFile = path.join(context.workDir, 'output.png');
      await sharp(Buffer.from(cut.data.buffer, cut.data.byteOffset, cut.data.byteLength), {
        raw: { width: cut.width, height: cut.height, channels: 4 },
      })
        .png({ compressionLevel: 6 })
        .toFile(outFile);
      timings.encodeMs = ms(t);
      t = performance.now();
      const bytes = await storeOutput(context, outFile, payload.output.path, 'image/png');
      timings.uploadMs = ms(t);

      // `maxRSS` va en KB: el pico de memoria de este proceso (de todos los trabajos desde que arrancó).
      const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
      return {
        source: { width: image.width, height: image.height },
        model: payload.model,
        output: { path: payload.output.path, width: cut.width, height: cut.height, bytes },
        timings,
        peakRssMb,
      };
    },
  };
}
