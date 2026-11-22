// Ritmo de la música y cortes a su compás.
//
//   1. `detectBeats` busca los golpes de una señal mono: saca una curva de
//      «novedad» del sonido (cuánto sube la energía entre ventanas de ~12 ms),
//      estima el tempo con una autocorrelación (60 a 180 pulsaciones por
//      minuto), elige la fase que más cae sobre picos y devuelve los instantes
//      de cada golpe. Es una estimación: música sin pulso claro da `confidence`
//      baja y la pantalla avisa.
//   2. `analyzeMusic` descarga la canción y la decodifica con Web Audio (en el
//      navegador; en las pruebas se llama a `detectBeats` con una señal).
//   3. `fitCutsToBeats` reparte las duraciones de los clips para que cada corte
//      caiga en un golpe. Es una función pura sobre el proyecto: el botón la
//      aplica como un cambio más, así que «Deshacer» la quita.
import type { ReelTemplateSummary } from '../templates';
import { MIN_SEGMENT_SECONDS, PHOTO_SECONDS, planTimeline, type Clip, type ReelProject } from './project';

export const MIN_BPM = 60;
export const MAX_BPM = 180;
/** Frecuencia a la que se trabaja: de sobra para ver golpes y barata de calcular. */
export const ANALYSIS_RATE = 11025;
/** Salto entre ventanas de análisis. */
export const HOP = 128;
const WINDOW = 512;
/** Por debajo de esta confianza, la música casi no tiene pulso y los cortes saldrían al azar. */
export const MIN_CONFIDENCE = 0.25;

export interface BeatAnalysis {
  /** Pulsaciones por minuto estimadas. */
  bpm: number;
  /** Segundos de la canción en que cae cada golpe, de menor a mayor. */
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

/** Curva de novedad: subida de energía entre ventanas, con la media local restada. */
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

/** Descarga la canción y la analiza con Web Audio. Lanza con un motivo en español si el navegador no puede. */
export async function analyzeMusic(url: string, signal?: AbortSignal): Promise<BeatAnalysis> {
  const Context =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Context) throw new Error('Este navegador no puede analizar la música.');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('No se ha podido descargar la música para analizarla.');
  const data = await response.arrayBuffer();
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(data);
    // Mezcla a mono.
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c += 1) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i += 1) mono[i] = mono[i]! + channel[i]! / decoded.numberOfChannels;
    }
    return detectBeats(mono, decoded.sampleRate);
  } catch {
    throw new Error('El navegador no ha podido leer esa música (formato no admitido).');
  } finally {
    void context.close?.();
  }
}

// ───────────────────────────── Cortes al compás ─────────────────────────────

export interface FitResult {
  project: ReelProject;
  /** Cuántos cortes caen ahora sobre un golpe. */
  cuts: number;
  /** Cada cuántos golpes se corta. */
  beatsPerCut: number;
  /** Clips (el primero es el 1) que no llegan a su golpe porque su archivo o su límite no da más. */
  short: number[];
}

/** Golpes en tiempo de reel: los de la canción menos el punto de la canción en que empieza el reel. */
export function reelBeats(beats: number[], startAt: number): number[] {
  return beats.map((b) => Number((b - startAt).toFixed(3))).filter((b) => b > 0.05);
}

/**
 * Cada cuántos golpes cortar para que las piezas duren parecido a como están:
 * 1, 2, 4 u 8 golpes, el que más se acerque a la duración media actual.
 */
export function autoBeatsPerCut(averageSeconds: number, beatSeconds: number): number {
  let best = 1;
  let gap = Infinity;
  for (const k of [1, 2, 4, 8]) {
    const d = Math.abs(Math.log((k * beatSeconds) / Math.max(0.3, averageSeconds)));
    if (d < gap) {
      gap = d;
      best = k;
    }
  }
  return best;
}

export interface FitOptions {
  /** Cada cuántos golpes se corta; sin él, el que más se parezca al ritmo actual. */
  beatsPerCut?: number;
  /** Duración real de los archivos de vídeo, si se conoce. */
  fileSeconds?: (path: string) => number | null;
}

/**
 * Reparte las duraciones de los clips para que cada corte caiga en un golpe.
 *
 * El «corte» entre dos clips es el centro de su transición. El clip `i` ocupa
 * del corte `i` al corte `i + 1` más la mitad de cada transición que lo solapa.
 * Los cortes se eligen entre los golpes (de `k` en `k`), en orden y cada uno el
 * más cercano a donde estaba, respetando lo que admite cada clip: una foto dura
 * de 0,5 a 10 s; un vídeo, desde 0,5 s y sin pasar de lo que dura su archivo
 * (se mueve el punto de salida, no el de entrada). Si un clip no puede llegar a
 * su golpe, se queda con lo que más da y el siguiente corte se busca desde ahí.
 * El último clip acaba en el golpe más cercano a donde acababa el reel.
 */
export function fitCutsToBeats(
  project: ReelProject,
  template: ReelTemplateSummary,
  analysis: Pick<BeatAnalysis, 'bpm' | 'beats'>,
  options: FitOptions = {},
): FitResult | null {
  const music = project.plan.music;
  const clips = project.plan.clips;
  if (!music || clips.length === 0 || analysis.beats.length < 2 || analysis.bpm <= 0) return null;
  const fileSeconds = options.fileSeconds ?? (() => null);
  const timelineOf = (list: Clip[]) => planTimeline(list, template, (c) => fileSeconds(c.path));
  const before = timelineOf(clips);
  const all = reelBeats(analysis.beats, music.startAt);
  if (all.length < 2) return null;
  const k = options.beatsPerCut ?? autoBeatsPerCut(before.total / clips.length, 60 / analysis.bpm);
  const grid = all.filter((_, i) => i % k === 0);
  if (grid.length < 1) return null;

  // Cuánto puede ocupar cada clip.
  const limits = clips.map((clip) => {
    if (clip.type === 'photo') return { min: PHOTO_SECONDS.min, max: PHOTO_SECONDS.max };
    const room = Math.min(60, (fileSeconds(clip.path) ?? Infinity) - clip.in);
    return { min: MIN_SEGMENT_SECONDS, max: Math.max(MIN_SEGMENT_SECONDS, room) };
  });
  // Dónde estaba cada corte (y el final): lo que se intenta conservar.
  const wanted = clips.map((_, i) =>
    i + 1 < clips.length ? before.starts[i + 1]! + before.transitions[i + 1]! / 2 : before.total,
  );

  let current: Clip[] = clips;
  let cuts = 0;
  const short: number[] = [];
  // Dos pasadas: la segunda usa las transiciones que dejó la primera (se acortan en clips cortos).
  for (let pass = 0; pass < 2; pass += 1) {
    const timeline = timelineOf(current);
    const next: Clip[] = [];
    cuts = 0;
    short.length = 0;
    let cutAt = 0;
    for (let i = 0; i < clips.length; i += 1) {
      const half = timeline.transitions[i]! / 2 + (i + 1 < clips.length ? timeline.transitions[i + 1]! / 2 : 0);
      const lengthFor = (cut: number) => cut - cutAt + half;
      const fits = grid.filter(
        (b) => b > cutAt + 0.01 && lengthFor(b) >= limits[i]!.min - 1e-6 && lengthFor(b) <= limits[i]!.max + 1e-6,
      );
      let cut: number;
      if (fits.length > 0) {
        cut = fits.reduce((a, b) => (Math.abs(b - wanted[i]!) < Math.abs(a - wanted[i]!) ? b : a));
        cuts += 1;
      } else {
        // Ningún golpe sirve: lo más cercano a un golpe que admite el clip.
        const goal = grid.find((b) => b > cutAt + 0.01) ?? wanted[i]!;
        cut = Math.min(cutAt + limits[i]!.max - half, Math.max(cutAt + limits[i]!.min - half, goal));
        short.push(i + 1);
      }
      const length = Math.max(limits[i]!.min, Math.min(limits[i]!.max, lengthFor(cut)));
      next.push(withLength(clips[i]!, length));
      cutAt = cut;
    }
    current = next;
  }
  return {
    project: { ...project, plan: { ...project.plan, clips: current } },
    cuts,
    beatsPerCut: k,
    short,
  };
}

/** El clip con la duración pedida: foto → `seconds`; vídeo → `out` (el punto de entrada no cambia). */
function withLength(clip: Clip, seconds: number): Clip {
  if (clip.type === 'photo') return { ...clip, seconds: Number(Math.min(PHOTO_SECONDS.max, seconds).toFixed(2)) };
  return { ...clip, out: Number((clip.in + seconds).toFixed(2)) };
}
