// Textos del recorte del fondo: en qué fase va, cuánto suele tardar y qué pasa con la foto.
// Un solo texto de privacidad, que dice lo que de verdad pasa según lo que esté encendido:
// el navegador no manda la foto a ningún sitio; el servidor de la aplicación lee la que ya está
// en la biblioteca (no se sube nada nuevo y no interviene ninguna IA externa).
import { mediaWorkerEnabled } from '@/config/app';
import type { CutoutProgress } from './cutout/engine';
import { cutoutServerAvailable } from './cutout/server';

export interface ProgressView {
  /** Qué está pasando ahora, en una frase. */
  label: string;
  /** Cuánto suele tardar esta fase. */
  expected: string | null;
  /** 0-100 si se sabe; si no, barra sin porcentaje. */
  pct: number | null;
  /** «Paso 2 de 4» cuando las fases son fijas. */
  step: { index: number; total: number } | null;
  where: 'browser' | 'server' | 'unknown';
}

export const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0);

const SERVER_STEPS = { sending: 1, queued: 2, running: 3, receiving: 4 } as const;

/** Lo que se dice mientras otro motor termina un recorte que el servidor dejó a medias. */
const FALLBACK_NOTE = {
  'server-timeout': 'El servidor no ha respondido a tiempo; se termina con el recorte de calidad básica.',
  'server-failed': 'El servidor no ha podido quitar el fondo; se termina con el recorte de calidad básica.',
} as const;

/**
 * Qué enseñar según la fase en la que va el recorte. Si viene de un servidor que no pudo
 * (`after`), la frase empieza diciéndolo: nunca se cambia de motor en silencio.
 */
export function describeProgress(progress: CutoutProgress | null): ProgressView {
  const view = describePhase(progress);
  return progress?.after ? { ...view, label: `${FALLBACK_NOTE[progress.after]} ${view.label}` } : view;
}

function describePhase(progress: CutoutProgress | null): ProgressView {
  if (progress?.phase === 'downloading') {
    const pct = Math.min(100, Math.round((progress.received / Math.max(1, progress.total)) * 100));
    return {
      label: `Descargando el modelo de recorte (${megabytes(progress.total)} MB, solo la primera vez): ${megabytes(progress.received)} de ${megabytes(progress.total)} MB`,
      expected: 'Después queda guardado en este navegador.',
      pct,
      step: null,
      where: 'browser',
    };
  }
  if (progress?.phase === 'running') {
    return {
      label: 'Recortando en tu equipo…',
      expected: 'Suele tardar entre 5 y 30 segundos.',
      pct: null,
      step: null,
      where: 'browser',
    };
  }
  if (progress?.phase === 'server-job') {
    const labels = {
      sending: 'Encargando el recorte al servidor…',
      queued: 'En cola en el servidor (arrancando)…',
      running: 'Recortando en el servidor…',
      receiving: 'Descargando el resultado…',
    } as const;
    const expected = {
      sending: 'Unos segundos.',
      queued: 'Si estaba apagado, tarda hasta 30 segundos en arrancar.',
      running: 'Suele tardar menos de un minuto en total.',
      receiving: 'Unos segundos.',
    } as const;
    return {
      label: labels[progress.state],
      expected: expected[progress.state],
      pct: null,
      step: { index: SERVER_STEPS[progress.state], total: 4 },
      where: 'server',
    };
  }
  if (progress?.phase === 'server') {
    return {
      label: 'Recortando en el servidor…',
      expected: 'Suele tardar menos de un minuto.',
      pct: null,
      step: null,
      where: 'server',
    };
  }
  return {
    label: 'Preparando el recorte en tu equipo…',
    expected: 'Unos segundos.',
    pct: null,
    step: null,
    where: 'unknown',
  };
}

/** Texto único de privacidad, según los motores que hay encendidos (antes de empezar). */
export function removalPrivacyNote(
  serverOn: boolean = mediaWorkerEnabled() || cutoutServerAvailable(),
): string {
  return serverOn
    ? 'Gratis y sin IA externa. Se recorta en tu navegador si tu equipo puede (la foto no sale de él); si no, lo hace el servidor de la aplicación con la foto que ya está en tu biblioteca. Mientras trabaja, aquí verás dónde se está haciendo.'
    : 'Gratis y sin IA externa: se recorta en tu navegador y la foto no sale de él. La primera vez descarga el modelo de recorte (de 45 a 220 MB según tu navegador; queda guardado); después tarda unos segundos.';
}
