// Punto único para quitar el fondo de una foto: foto → la misma foto con el fondo
// transparente. Todo lo que necesite un recorte (el diálogo «Editar foto» y el panel
// de fotos del editor) pasa por aquí, así la cadena de motores se puede cambiar sin
// tocar a quien lo usa.
//
// Cadena (docs/edicion-fotos.md, §7):
//   1. NAVEGADOR: BEN2 si hay WebGPU y memoria; si no, IS-Net (engine.ts).
//   2. SERVIDOR (`api/cutout-mask.ts`, el mismo IS-Net con el mismo refinado): si el
//      navegador no puede (sin WebAssembly, poca memoria), falla (modelo, memoria,
//      red del modelo) o el dispositivo declara menos de 4 GB, y hay sesión y marca.
//   Tras un fallo de MEMORIA en el navegador, las fotos siguientes van directas al
//   servidor hasta recargar la página.
// «Nada que recortar» y cancelar cortan la cadena: otro motor daría lo mismo.
import type { Pixels } from '../pixels';
import {
  cutoutSupport,
  describeCutoutError,
  isCutoutCancelled,
  removeBackgroundInBrowser,
  type CutoutProgress,
  type CutoutResult,
  type CutoutSupport,
} from './engine';
import { NoSubjectError } from './mask';
import { CUTOUT_MODEL_NAME } from './model';
import { CutoutServerError, cutoutServerAvailable, removeBackgroundOnServer, type ServerOptions } from './server';

export interface BackgroundRemoval {
  /** Misma foto con el fondo transparente (mismas medidas que la entrada). */
  pixels: Pixels;
  /** Nombre del modelo, para la procedencia del resultado. */
  model: string;
  /** `high` (BEN2) o `basic` (IS-Net: respaldo sin WebGPU, tras un fallo o en el servidor): la interfaz lo dice. */
  quality: 'high' | 'basic';
  /** Dónde se ha hecho. */
  where: 'browser' | 'server';
}

/** Memoria (GB, `navigator.deviceMemory`) por debajo de la cual se prefiere el servidor. */
export const SERVER_FIRST_BELOW_GB = 4;

/** Piezas cambiables (en las pruebas, dobles). */
export interface RemovalDeps {
  browserSupport: () => CutoutSupport;
  browser: (
    image: Pixels,
    onProgress: ((p: CutoutProgress) => void) | undefined,
    signal: AbortSignal | undefined,
  ) => Promise<CutoutResult>;
  serverAvailable: () => boolean;
  server: (image: Pixels, options: ServerOptions) => Promise<Pixels>;
  deviceMemory: () => number | undefined;
}

const defaultDeps: RemovalDeps = {
  browserSupport: () => cutoutSupport(),
  browser: (image, onProgress, signal) => removeBackgroundInBrowser(image, onProgress, { signal }),
  serverAvailable: () => cutoutServerAvailable(),
  server: (image, options) => removeBackgroundOnServer(image, options),
  deviceMemory: () =>
    typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
};

/** El navegador se quedó sin memoria en esta sesión: las siguientes fotos van al servidor. */
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
  deps: Pick<RemovalDeps, 'browserSupport' | 'serverAvailable'> = defaultDeps,
): CutoutSupport {
  const browser = deps.browserSupport();
  if (browser.ok || deps.serverAvailable()) return { ok: true };
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
}

export async function removeBackground(
  image: Pixels,
  onProgress?: (progress: CutoutProgress) => void,
  signal?: AbortSignal,
  options: RemovalOptions = {},
  deps: RemovalDeps = defaultDeps,
): Promise<BackgroundRemoval> {
  const browserOk = deps.browserSupport().ok;
  const serverOk = Boolean(options.brandId) && deps.serverAvailable();
  const memory = deps.deviceMemory();
  const serverFirst =
    serverOk && (!browserOk || browserOutOfMemory || (typeof memory === 'number' && memory < SERVER_FIRST_BELOW_GB));

  const viaBrowser = async (): Promise<BackgroundRemoval> => {
    const r = await deps.browser(image, onProgress, signal);
    return { pixels: r.pixels, model: r.model, quality: r.quality, where: 'browser' };
  };
  const viaServer = async (): Promise<BackgroundRemoval> => {
    const pixels = await deps.server(image, {
      brandId: options.brandId!,
      signal,
      onProgress: () => onProgress?.({ phase: 'server' }),
    });
    return { pixels, model: CUTOUT_MODEL_NAME, quality: 'basic', where: 'server' };
  };

  const order = [
    ...(browserOk ? [{ name: 'browser' as const, run: viaBrowser }] : []),
    ...(serverOk ? [{ name: 'server' as const, run: viaServer }] : []),
  ];
  if (serverFirst) order.reverse();
  if (order.length === 0)
    throw new Error(
      deps.browserSupport().ok
        ? 'No se puede quitar el fondo aquí.'
        : (deps.browserSupport() as { reason: string }).reason,
    );

  let first: unknown;
  for (const step of order) {
    try {
      return await step.run();
    } catch (error) {
      if (isCutoutCancelled(error) || error instanceof NoSubjectError || (error as Error)?.name === 'NoSubjectError')
        throw error;
      if (step.name === 'browser' && isOutOfMemory(error)) browserOutOfMemory = true;
      console.warn(`[recorte] falla el recorte en ${step.name === 'browser' ? 'el navegador' : 'el servidor'}`, error);
      // Se enseña el error del primer intento (lo que la persona esperaba que pasara).
      first ??= error;
    }
  }
  throw first;
}

/** ¿Lo canceló quien lo pidió? (no es un error que contar). */
export { isCutoutCancelled as isRemovalCancelled } from './engine';

export type { CutoutProgress };
