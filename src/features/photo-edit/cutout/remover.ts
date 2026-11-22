// Punto único para quitar el fondo de una foto: foto → la misma foto con el fondo transparente.
// Todo lo que necesite un recorte (el diálogo «Editar foto» y el panel de fotos del editor) pasa
// por aquí, así la cadena de motores se puede cambiar sin tocar a quien lo usa.
//
// Cadena (docs/edicion-fotos.md, §7), cada paso solo si se puede y, si falla, el siguiente:
//   1. NAVEGADOR con BEN2 (calidad alta): si hay WebGPU, adaptador y memoria.
//   2. SERVIDOR, trabajo `media.cutout` del trabajador de medios (BEN2 en CPU, calidad alta):
//      si `VITE_MEDIA_WORKER_ENABLED` está activo y la foto es de la biblioteca de la marca.
//      Suele tardar menos de un minuto (arranque de la máquina + ~16 s de modelo); se cancela.
//   3. FUNCIÓN DE VERCEL (`api/cutout-mask`, IS-Net): APAGADA por defecto; solo con
//      `VITE_CUTOUT_SERVER_URL` definida.
//   4. NAVEGADOR con IS-Net refinado («calidad básica»): último recurso, sin WebGPU ni servidor.
// «Nada que recortar» y cancelar cortan la cadena: otro motor daría lo mismo.
import { mediaWorkerEnabled } from '@/config/app';
import type { Pixels } from '../pixels';
import {
  browserCanRunBen2,
  cutoutSupport,
  describeCutoutError,
  isCutoutCancelled,
  removeBackgroundInBrowser,
  type CutoutProgress,
  type CutoutResult,
  type CutoutSupport,
} from './engine';
import { NoSubjectError } from './mask';
import { BEN2_MODEL_NAME, CUTOUT_MODEL_NAME } from './model';
import { CutoutServerError, cutoutServerAvailable, removeBackgroundOnServer, type ServerOptions } from './server';
import { removeBackgroundByJob, type JobOptions } from './serverJob';

export interface BackgroundRemoval {
  /** Misma foto con el fondo transparente (mismas medidas que la entrada). */
  pixels: Pixels;
  /** Nombre del modelo, para la procedencia del resultado. */
  model: string;
  /** `high` (BEN2, en el navegador o en el servidor) o `basic` (IS-Net: último recurso o función de Vercel). */
  quality: 'high' | 'basic';
  /** Dónde se ha hecho. */
  where: 'browser' | 'server';
}

/** Piezas cambiables (en las pruebas, dobles). */
export interface RemovalDeps {
  browserSupport: () => CutoutSupport;
  /** ¿Puede este navegador con BEN2 (WebGPU y memoria)? */
  ben2Capable: () => Promise<boolean>;
  browser: (
    image: Pixels,
    engine: 'ben2' | 'isnet',
    onProgress: ((p: CutoutProgress) => void) | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<CutoutResult>;
  /** ¿Hay trabajador de medios (`VITE_MEDIA_WORKER_ENABLED`)? */
  jobEnabled: () => boolean;
  job: (image: Pixels, options: JobOptions) => Promise<Pixels>;
  /** ¿Está encendida la función de Vercel (`VITE_CUTOUT_SERVER_URL`)? Por defecto, no. */
  serverAvailable: () => boolean;
  server: (image: Pixels, options: ServerOptions) => Promise<Pixels>;
}

const defaultDeps: RemovalDeps = {
  browserSupport: () => cutoutSupport(),
  ben2Capable: () => browserCanRunBen2(),
  browser: (image, engine, onProgress, signal) => removeBackgroundInBrowser(image, onProgress, { signal, engine }),
  jobEnabled: () => mediaWorkerEnabled(),
  job: (image, options) => removeBackgroundByJob(image, options),
  serverAvailable: () => cutoutServerAvailable(),
  server: (image, options) => removeBackgroundOnServer(image, options),
};

/** El navegador se quedó sin memoria con BEN2 en esta sesión: no se vuelve a probar hasta recargar. */
let browserOutOfMemory = false;

export function resetRemovalSession(): void {
  browserOutOfMemory = false;
}

function isOutOfMemory(error: unknown): boolean {
  const e = error as Error | undefined;
  return e?.name === 'RangeError' || /memory|alloc|out of/i.test(e?.message ?? '');
}

/** ¿Puede este navegador quitar el fondo, solo o con ayuda del servidor? Si no, el botón no sale. */
export function removalSupport(
  deps: Pick<RemovalDeps, 'browserSupport' | 'serverAvailable' | 'jobEnabled'> = defaultDeps,
): CutoutSupport {
  const browser = deps.browserSupport();
  if (browser.ok || deps.serverAvailable() || deps.jobEnabled()) return { ok: true };
  return browser;
}

export function canRemoveBackground(): boolean {
  return removalSupport().ok;
}

export function describeRemovalError(error: unknown): string {
  if (error instanceof CutoutServerError) {
    if (error.failure === 'limit') return `${error.message} Prueba mañana o desde un ordenador con tarjeta gráfica.`;
    if (error.failure === 'session') return 'La sesión ha caducado. Vuelve a entrar y repite el recorte.';
    if (error.failure === 'permission') return 'No tienes permiso para editar las fotos de esta marca.';
    if (error.failure === 'timeout' || error.failure === 'network') {
      return 'No se ha podido quitar el fondo: el servidor no ha respondido. Vuelve a intentarlo.';
    }
    return 'No se ha podido quitar el fondo en el servidor. Vuelve a intentarlo.';
  }
  return describeCutoutError(error);
}

export interface RemovalOptions {
  /** Marca de la foto: sin ella no se puede usar el servidor (comprueba que la persona puede editarla). */
  brandId?: string;
  /**
   * La foto como recurso de la biblioteca: el trabajo del servidor la lee de ahí (no se sube nada).
   * Sin ella (o si no es JPEG, PNG o WebP), el servidor no se usa.
   */
  source?: { storage_path: string; mime_type: string; kind: string };
}

const JOB_MIME = ['image/jpeg', 'image/png', 'image/webp'];

export async function removeBackground(
  image: Pixels,
  onProgress?: (progress: CutoutProgress) => void,
  signal?: AbortSignal,
  options: RemovalOptions = {},
  deps: RemovalDeps = defaultDeps,
): Promise<BackgroundRemoval> {
  const browserOk = deps.browserSupport().ok;
  const source = options.source;
  const jobOk =
    Boolean(options.brandId && source) &&
    (source!.kind === 'image' || source!.kind === 'logo') &&
    JOB_MIME.includes(source!.mime_type) &&
    deps.jobEnabled();
  const vercelOk = Boolean(options.brandId) && deps.serverAvailable();

  const viaBrowser = (engine: 'ben2' | 'isnet') => async (): Promise<BackgroundRemoval> => {
    const r = await deps.browser(image, engine, onProgress, signal);
    return { pixels: r.pixels, model: r.model, quality: r.quality, where: 'browser' };
  };
  const viaJob = async (): Promise<BackgroundRemoval> => {
    const pixels = await deps.job(image, {
      brandId: options.brandId!,
      sourcePath: source!.storage_path,
      signal,
      onProgress: (state) => onProgress?.({ phase: 'server-job', state }),
    });
    return { pixels, model: BEN2_MODEL_NAME, quality: 'high', where: 'server' };
  };
  const viaVercel = async (): Promise<BackgroundRemoval> => {
    const pixels = await deps.server(image, {
      brandId: options.brandId!,
      signal,
      onProgress: () => onProgress?.({ phase: 'server' }),
    });
    return { pixels, model: CUTOUT_MODEL_NAME, quality: 'basic', where: 'server' };
  };

  const order: Array<{ name: string; run: () => Promise<BackgroundRemoval> }> = [];
  if (browserOk && !browserOutOfMemory && (await deps.ben2Capable())) {
    order.push({ name: 'navegador (BEN2)', run: viaBrowser('ben2') });
  }
  if (jobOk) order.push({ name: 'servidor (trabajador)', run: viaJob });
  if (vercelOk) order.push({ name: 'servidor (función de Vercel)', run: viaVercel });
  if (browserOk) order.push({ name: 'navegador (IS-Net)', run: viaBrowser('isnet') });
  if (order.length === 0) {
    throw new Error(
      browserOk ? 'No se puede quitar el fondo aquí.' : (deps.browserSupport() as { reason: string }).reason,
    );
  }

  let first: unknown;
  for (const step of order) {
    try {
      return await step.run();
    } catch (error) {
      if (isCutoutCancelled(error) || error instanceof NoSubjectError || (error as Error)?.name === 'NoSubjectError')
        throw error;
      if (step.name === 'navegador (BEN2)' && isOutOfMemory(error)) browserOutOfMemory = true;
      console.warn(`[recorte] falla el recorte en ${step.name}`, error);
      // Se enseña el error del primer intento (lo que la persona esperaba que pasara).
      first ??= error;
    }
  }
  throw first;
}

/** ¿Lo canceló quien lo pidió? (no es un error que contar). */
export { isCutoutCancelled as isRemovalCancelled } from './engine';

export type { CutoutProgress };
