// Forma de onda de la música para su pista de la línea de tiempo.
//
// La canción se descarga y se decodifica con Web Audio UNA vez por archivo
// (cuando la pista está a la vista y el navegador tiene un respiro) y se reduce
// a un pico por cada centésima de segundo: es lo único que se guarda. Sin Web
// Audio (o si el archivo no se puede leer), la pista se queda sin onda y se
// sigue pudiendo usar: no se simula nada.
import { useEffect, useState } from 'react';

/** Picos por segundo de canción. */
export const PEAKS_PER_SECOND = 100;
const MAX_PEAKS = 24_000;

export interface Waveform {
  /** Un valor de 0 a 1 por tramo. */
  peaks: Float32Array;
  /** Duración de la canción en segundos. */
  duration: number;
}

/** Reduce una señal a `buckets` picos (el máximo absoluto de cada tramo), normalizados al mayor. */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const n = Math.max(1, Math.floor(buckets));
  const peaks = new Float32Array(n);
  const size = samples.length / n;
  let top = 0;
  for (let i = 0; i < n; i += 1) {
    const from = Math.floor(i * size);
    const to = Math.max(from + 1, Math.floor((i + 1) * size));
    let max = 0;
    for (let j = from; j < to && j < samples.length; j += 1) {
      const v = Math.abs(samples[j]!);
      if (v > max) max = v;
    }
    peaks[i] = max;
    if (max > top) top = max;
  }
  if (top > 0) for (let i = 0; i < n; i += 1) peaks[i] = peaks[i]! / top;
  return peaks;
}

/**
 * Altura (0 a 1) de la onda en el segundo `t` del reel, para una canción que empieza en
 * `startAt` y se repite si es más corta que el reel (como hace el trabajador).
 */
export function peakAt(wave: Waveform, startAt: number, t: number): number {
  if (wave.duration <= 0 || wave.peaks.length === 0) return 0;
  const at = (((startAt + t) % wave.duration) + wave.duration) % wave.duration;
  const index = Math.min(wave.peaks.length - 1, Math.floor((at / wave.duration) * wave.peaks.length));
  return wave.peaks[index]!;
}

const cache = new Map<string, Waveform>();
const loading = new Map<string, Promise<Waveform | null>>();

async function decode(url: string): Promise<Waveform | null> {
  const Context =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Context) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.arrayBuffer();
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(data);
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c += 1) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i += 1) mono[i] = mono[i]! + channel[i]! / decoded.numberOfChannels;
    }
    const buckets = Math.min(MAX_PEAKS, Math.ceil(decoded.duration * PEAKS_PER_SECOND));
    return { peaks: computePeaks(mono, buckets), duration: decoded.duration };
  } catch {
    return null;
  } finally {
    void context.close?.();
  }
}

/** La onda de un archivo (por ruta), descargándola la primera vez. Null si no se puede. */
export function loadWaveform(path: string, url: string): Promise<Waveform | null> {
  const known = cache.get(path);
  if (known) return Promise.resolve(known);
  let pending = loading.get(path);
  if (!pending) {
    pending = decode(url)
      .catch(() => null)
      .then((wave) => {
        loading.delete(path);
        if (wave) cache.set(path, wave);
        return wave;
      });
    loading.set(path, pending);
  }
  return pending;
}

/** La onda de la música elegida; se pide solo cuando `enabled` (la pista está a la vista). */
export function useWaveform(path: string | undefined, url: string | undefined, enabled: boolean): Waveform | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!path || !url || !enabled || cache.has(path)) return;
    let alive = true;
    const idle =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 200));
    idle(() => {
      if (!alive) return;
      void loadWaveform(path, url).then((wave) => {
        if (alive && wave) setVersion((v) => v + 1);
      });
    });
    return () => {
      alive = false;
    };
  }, [path, url, enabled]);
  return path ? (cache.get(path) ?? null) : null;
}
