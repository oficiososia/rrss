// «Fondo con IA»: de dónde sale la selección de lo principal (el recorte) y qué intentos lleva la persona.
// Regla: el recorte se hace UNA sola vez por foto. Si ya hay uno (el de esta sesión, o la propia foto
// ya viene sin fondo) se reutiliza; solo si no hay ninguno se recorta.
import type { Json, MediaAssetRow } from '@/lib/database.types';
import type { Pixels } from './pixels';
import { alphaOf } from './cutout/plate';
import { applyStrokes, type BrushStroke } from './portrait/brush';

/** El recorte hecho en esta pantalla (el mismo que usa la pestaña «Fondo»). */
export interface SessionCutout {
  pixels: Pixels;
  model: string;
  strokes?: readonly BrushStroke[];
}

export interface ExistingSubject {
  /** Alfa 0-255 con las medidas de `width` × `height`. */
  alpha: Uint8Array;
  width: number;
  height: number;
  /** Modelo que dio el recorte (procedencia). */
  model: string;
  /** De dónde sale: el recorte de la sesión o la propia foto, que ya es transparente. */
  from: 'session' | 'transparent';
}

/** Modelo con el que se quitó el fondo, leído de la procedencia de la foto (si procede de un recorte). */
export function cutoutModelFromProvenance(provenance: Json | undefined): string | null {
  const steps = (provenance as { steps?: unknown } | null | undefined)?.steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const s = step as { kind?: unknown; model?: unknown } | null;
    if (s?.kind === 'remove_background' && typeof s.model === 'string') return s.model;
  }
  return null;
}

/**
 * La selección de lo principal que ya se tiene, si se tiene: el recorte de esta sesión (con los
 * retoques a mano) o, si la foto ya viene sin fondo, su propio canal alfa. `null` = hay que recortar.
 */
export function existingSubject(input: {
  pixels: Pixels;
  transparent: boolean;
  cutout: SessionCutout | null;
  provenance?: Json;
}): ExistingSubject | null {
  const { pixels, cutout } = input;
  if (cutout && cutout.pixels.width === pixels.width && cutout.pixels.height === pixels.height) {
    const base = alphaOf(cutout.pixels);
    const strokes = cutout.strokes ?? [];
    return {
      alpha: strokes.length > 0 ? applyStrokes(base, pixels.width, pixels.height, strokes) : base,
      width: pixels.width,
      height: pixels.height,
      model: cutout.model,
      from: 'session',
    };
  }
  if (input.transparent) {
    return {
      alpha: alphaOf(pixels),
      width: pixels.width,
      height: pixels.height,
      model: cutoutModelFromProvenance(input.provenance) ?? 'recorte-previo',
      from: 'transparent',
    };
  }
  return null;
}

/** El resultado de un intento de la IA, listo para mirarlo antes de usarlo. */
export interface AiCandidate {
  /** Recurso que dejó el servidor en la biblioteca (se borra si se descarta el intento). */
  row: MediaAssetRow;
  /** Lo que se enseña, en tamaño de vista previa: la foto con lo principal original pegado encima, o lo que dio la IA. */
  preview: Pixels;
  /** La versión con lo principal original vuelto a pegar, a tamaño completo (se guarda al «Usar esta»). */
  merged: Pixels | null;
  /** Modelo del recorte que dio la selección (procedencia). */
  maskModel: string | null;
  /** Se vio la original en vez del resultado (comparar antes/después). */
  showBefore: boolean;
  /** Coste de este intento (millonésimas); `null` si el servidor no lo dijo. */
  costMicros: number | null;
  prompt: string;
  /** Se pudo volver a pegar lo principal de la original (si no, es el resultado puro de la IA). */
  protectedPlate: boolean;
}

export interface AiAttempt {
  prompt: string;
  costMicros: number | null;
}

/** Lo que lleva la persona en «Fondo con IA»: intentos hechos y el resultado que está mirando. */
export interface AiReview {
  attempts: AiAttempt[];
  candidate: AiCandidate | null;
}

export const EMPTY_AI_REVIEW: AiReview = { attempts: [], candidate: null };

/** Suma de lo gastado en los intentos (los que no dicen coste no suman). */
export function spentMicros(attempts: readonly AiAttempt[]): number {
  return attempts.reduce((sum, a) => sum + (a.costMicros ?? 0), 0);
}
