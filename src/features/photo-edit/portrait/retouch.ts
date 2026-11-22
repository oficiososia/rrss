// Guardar con retoques a TAMAÑO COMPLETO sin congelar la pantalla (docs/edicion-fotos.md §13).
// En una foto de 12 MP aplicar los trazos del pincel y el modo retrato cuesta de 2 a 4 s de
// cálculo (medido con `scripts/medir-guardado-retrato.ts`); en el hilo principal eso deja la
// pantalla sin responder, y más en un móvil. Por eso el cálculo corre en un Web Worker
// (`retouch.worker.ts`). Si el navegador no tiene Workers (o falla al crearlo), se calcula aquí
// mismo, cediendo antes un turno al navegador: mismo resultado, solo que sin fluidez.
// `computeRetouch` es la función pura que usan los dos caminos y las pruebas.
import type { Pixels } from '../pixels';
import { portraitBlur, type PortraitOptions } from './blur';
import { applyStrokes, withAlpha, type BrushStroke } from './brush';

export type RetouchJob =
  | {
      /** Foto en modo retrato con la selección retocada. */
      kind: 'portrait';
      image: Pixels;
      baseAlpha: Uint8Array;
      strokes: BrushStroke[];
      options: PortraitOptions;
    }
  | {
      /** El plato recortado con la selección retocada (colores de la foto original). */
      kind: 'subject';
      image: Pixels;
      baseAlpha: Uint8Array;
      strokes: BrushStroke[];
    };

export type RetouchMessage = { id: number; job: RetouchJob };
export type RetouchReply = { id: number; ok: true; pixels: Pixels } | { id: number; ok: false; message: string };

/** El cálculo en sí (sin DOM): igual en el worker, en el hilo principal y en las pruebas. */
export function computeRetouch(job: RetouchJob): Pixels {
  const { image, baseAlpha, strokes } = job;
  const alpha = applyStrokes(baseAlpha, image.width, image.height, strokes);
  return job.kind === 'portrait' ? portraitBlur(image, alpha, job.options) : withAlpha(image, alpha);
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (p: Pixels) => void; ko: (e: Error) => void }>();

function dropWorker(error: Error) {
  worker?.terminate();
  worker = null;
  for (const entry of waiting.values()) entry.ko(error);
  waiting.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./retouch.worker.ts', import.meta.url), { type: 'module', name: 'retoque-fotos' });
  w.onmessage = (event: MessageEvent<RetouchReply>) => {
    const entry = waiting.get(event.data.id);
    if (!entry) return;
    waiting.delete(event.data.id);
    if (event.data.ok) entry.ok(event.data.pixels);
    else entry.ko(new Error(event.data.message));
  };
  w.onerror = () => dropWorker(new Error('El cálculo de la foto se ha interrumpido.'));
  worker = w;
  return w;
}

/** Calcula el resultado en un worker; sin Workers (o si no arranca), en el hilo principal. */
export async function renderRetouch(job: RetouchJob): Promise<Pixels> {
  if (typeof Worker !== 'undefined') {
    try {
      const id = nextId++;
      const w = getWorker();
      return await new Promise<Pixels>((ok, ko) => {
        waiting.set(id, { ok, ko });
        // La foto se COPIA (el original se sigue usando en la pantalla) y la copia se cede al worker.
        const copy: RetouchJob = { ...job, image: { ...job.image, data: new Uint8ClampedArray(job.image.data) } };
        const message: RetouchMessage = { id, job: copy };
        w.postMessage(message, [copy.image.data.buffer]);
      });
    } catch {
      // Sin worker utilizable (o se ha caído): se sigue en el hilo principal.
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return computeRetouch(job);
}
