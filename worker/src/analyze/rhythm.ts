// Ritmo de una pista de sonido: los golpes y su tempo.
//
// Es LA MISMA CUENTA que la del editor de reels en el navegador
// (`src/features/reels/editor/rhythm.ts`, `detectBeats`): curva de «novedad»
// del sonido → autocorrelación entre 60 y 180 pulsaciones por minuto → fase con
// más energía. Allí decodifica Web Audio; aquí, FFmpeg (mono, coma flotante).
// Si se cambia una, hay que cambiar la otra: las dos pruebas usan la misma
// pista sintética (un golpe cada medio segundo = 120 pulsaciones).
//
// Sin dependencias.

export const MIN_BPM = 60;
export const MAX_BPM = 180;
/** Frecuencia a la que se trabaja: de sobra para ver golpes y barata de calcular. */
export const ANALYSIS_RATE = 11025;
/** Salto entre ventanas de análisis. */
export const HOP = 128;
const WINDOW = 512;
/** Por debajo de esta confianza, el sonido casi no tiene pulso. */
export const MIN_CONFIDENCE = 0.25;

export interface BeatAnalysis {
  /** Pulsaciones por minuto estimadas. */
  bpm: number;
  /** Segundos en que cae cada golpe, de menor a mayor. */
  beats: number[];
  /** De 0 a 1: cuánto destaca el pulso sobre el resto. */
  confidence: number;
}

/** Pasa una señal a ~`ANALYSIS_RATE` promediando muestras (basta: solo importa la envolvente). */
export function downsample(samples: Float32Array, sampleRate: number): { samples: Float32Array; rate: number } {
  const ratio = Math.max(1, Math.floor(sampleRate / ANALYSIS_RATE));
  if (ratio === 1) return { samples, rate: sampleRate };
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < ratio; j += 1) sum += samples[i * ratio + j]!;
    out[i] = sum / ratio;
  }
  return { samples: out, rate: sampleRate / ratio };
}

/** Curva de novedad: subida de energía entre ventanas. */
export function onsetEnvelope(samples: Float32Array): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP));
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const from = f * HOP;
    for (let i = 0; i < WINDOW; i += 1) sum += samples[from + i]! * samples[from + i]!;
    energy[f] = Math.log1p(1000 * Math.sqrt(sum / WINDOW));
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f += 1) flux[f] = Math.max(0, energy[f]! - energy[f - 1]!);
  return flux;
}

/** Golpes de una señal mono (muestras entre −1 y 1). `maxSeconds` limita el tramo que se analiza. */
export function detectBeats(samples: Float32Array, sampleRate: number, maxSeconds = 180): BeatAnalysis {
  const limit = Math.min(samples.length, Math.floor(maxSeconds * sampleRate));
  const reduced = downsample(samples.subarray(0, limit), sampleRate);
  const env = onsetEnvelope(reduced.samples);
  const frameRate = reduced.rate / HOP;
  const empty: BeatAnalysis = { bpm: 0, beats: [], confidence: 0 };
  if (env.length < frameRate * 4) return empty;
  const total = env.reduce((sum, v) => sum + v, 0);
  if (total <= 1e-6) return empty;
  // Quita la media para que la autocorrelación mire los picos y no el volumen.
  const mean = total / env.length;
  const centered = env.map((v) => v - mean);

  // Autocorrelación en los retardos de 60 a 180 pulsaciones por minuto.
  const minLag = Math.floor((frameRate * 60) / MAX_BPM);
  const maxLag = Math.ceil((frameRate * 60) / MIN_BPM);
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < centered.length; i += 1) sum += centered[i]! * centered[i + lag]!;
    scores[lag - minLag] = sum / (centered.length - lag);
  }
  // Prefiere el tempo medio de la gama: la octava de abajo o de arriba puntúa casi igual.
  const weighted = scores.map((score, i) => {
    const bpm = (frameRate * 60) / (i + minLag);
    return score * Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 1.1, 2));
  });
  let best = 0;
  weighted.forEach((v, i) => {
    if (v > weighted[best]!) best = i;
  });
  // Afina el retardo con la parábola de los tres puntos vecinos.
  const left = scores[best - 1] ?? scores[best]!;
  const right = scores[best + 1] ?? scores[best]!;
  const denom = left - 2 * scores[best]! + right;
  const shift = denom < 0 ? (0.5 * (left - right)) / denom : 0;
  const period = best + minLag + Math.max(-0.5, Math.min(0.5, shift)); // en ventanas
  const bpm = (frameRate * 60) / period;

  // Fase: el desfase (en ventanas) cuyos golpes caen sobre más energía.
  let bestPhase = 0;
  let bestSum = -1;
  const steps = Math.max(1, Math.round(period));
  for (let phase = 0; phase < steps; phase += 1) {
    let sum = 0;
    for (let x = phase; x < env.length; x += period) sum += env[Math.round(x)] ?? 0;
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }
  const beats: number[] = [];
  for (let x = bestPhase; x < env.length; x += period) beats.push(Number((x / frameRate).toFixed(3)));

  const onBeat = bestSum / Math.max(1, beats.length);
  const confidence = Math.max(0, Math.min(1, (onBeat / Math.max(mean, 1e-9) - 1) / 5));
  return { bpm: Number(bpm.toFixed(1)), beats, confidence: Number(confidence.toFixed(2)) };
}
