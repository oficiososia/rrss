// Sonido de un vídeo de referencia, SIN IA: volumen a lo largo del tiempo,
// tramos con sonido (para transcribir solo donde hay algo) y cómo caen los
// cortes respecto al compás. Todo es puro: recibe las muestras ya decodificadas.

/** Volumen eficaz por ventanas, de 0 a 1 respecto al tramo más fuerte. */
export function loudnessEnvelope(
  samples: Float32Array,
  sampleRate: number,
  windowSeconds = 0.5,
): { energy: number[]; peak: number } {
  const size = Math.max(1, Math.floor(windowSeconds * sampleRate));
  const rms: number[] = [];
  for (let from = 0; from + size <= samples.length; from += size) {
    let sum = 0;
    for (let i = from; i < from + size; i += 1) sum += samples[i]! * samples[i]!;
    rms.push(Math.sqrt(sum / size));
  }
  const peak = rms.reduce((max, v) => Math.max(max, v), 0);
  return {
    energy: rms.map((v) => (peak > 0 ? Number((v / peak).toFixed(2)) : 0)),
    peak: Number(peak.toFixed(4)),
  };
}

/** Por debajo de este volumen eficaz máximo, la pista se da por muda. */
export const SILENT_PEAK = 0.003;

export interface Segment {
  start: number;
  end: number;
}

export interface SpeechOptions {
  /** Ventana con la que se mide. */
  frameSeconds: number;
  /** Una pausa más corta que esto no parte el tramo. */
  minPauseSeconds: number;
  /** Tramos más cortos que esto se descartan (un golpe, un clic). */
  minSegmentSeconds: number;
}

export const DEFAULT_SPEECH: SpeechOptions = { frameSeconds: 0.02, minPauseSeconds: 0.4, minSegmentSeconds: 0.4 };

/**
 * Tramos con sonido, partidos por las pausas. No distingue la voz de la música
 * (eso no se puede sin un modelo): con música continua sale un solo tramo.
 */
export function soundSegments(
  samples: Float32Array,
  sampleRate: number,
  overrides: Partial<SpeechOptions> = {},
): Segment[] {
  const options = { ...DEFAULT_SPEECH, ...overrides };
  const size = Math.max(1, Math.floor(options.frameSeconds * sampleRate));
  const levels: number[] = [];
  for (let from = 0; from + size <= samples.length; from += size) {
    let sum = 0;
    for (let i = from; i < from + size; i += 1) sum += samples[i]! * samples[i]!;
    levels.push(Math.sqrt(sum / size));
  }
  if (levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)]!;
  if (loud < SILENT_PEAK) return [];
  // Silencio: bastante por debajo de lo que suena fuerte en este vídeo.
  const threshold = Math.max(SILENT_PEAK, loud * 0.1);
  const frame = size / sampleRate;
  const segments: Segment[] = [];
  let start: number | null = null;
  let quiet = 0;
  levels.forEach((level, index) => {
    if (level >= threshold) {
      if (start === null) start = index * frame;
      quiet = 0;
    } else if (start !== null) {
      quiet += frame;
      if (quiet >= options.minPauseSeconds) {
        segments.push({ start, end: (index + 1) * frame - quiet });
        start = null;
        quiet = 0;
      }
    }
  });
  if (start !== null) segments.push({ start, end: levels.length * frame - quiet });
  return segments
    .filter((s) => s.end - s.start >= options.minSegmentSeconds)
    .map((s) => ({ start: Number(s.start.toFixed(2)), end: Number(s.end.toFixed(2)) }));
}

export interface ChunkLimits {
  maxChunkSeconds: number;
  maxTotalSeconds: number;
  maxChunks: number;
}

/**
 * Junta los tramos en trozos para transcribir: cada trozo dura como mucho
 * `maxChunkSeconds` (un tramo más largo se parte), y entre todos no pasan de
 * `maxTotalSeconds` ni de `maxChunks`; lo que no cabe se deja fuera y se dice.
 */
export function chunkSegments(segments: Segment[], limits: ChunkLimits): { chunks: Segment[]; truncated: boolean } {
  const pieces: Segment[] = [];
  for (const segment of segments) {
    for (let from = segment.start; from < segment.end - 1e-6; from += limits.maxChunkSeconds) {
      pieces.push({ start: from, end: Math.min(segment.end, from + limits.maxChunkSeconds) });
    }
  }
  const merged: Segment[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && piece.end - last.start <= limits.maxChunkSeconds) last.end = piece.end;
    else merged.push({ ...piece });
  }
  const chunks: Segment[] = [];
  let total = 0;
  let truncated = false;
  for (const chunk of merged) {
    const room = limits.maxTotalSeconds - total;
    if (chunks.length >= limits.maxChunks || room < 0.5) {
      truncated = true;
      break;
    }
    const end = Math.min(chunk.end, chunk.start + room);
    if (end < chunk.end) truncated = true;
    chunks.push({ start: Number(chunk.start.toFixed(2)), end: Number(end.toFixed(2)) });
    total += end - chunk.start;
  }
  return { chunks, truncated };
}

/** Margen (en segundos) para dar un corte por «en el golpe». */
export const ON_BEAT_TOLERANCE = 0.12;

/**
 * Cómo caen los cortes respecto a los golpes: qué parte cae en uno y cada
 * cuántos golpes se corta (lo más habitual: 1, 2, 4…).
 */
export function rhythmOfCuts(
  cutTimes: number[],
  beats: number[],
  bpm: number,
): { cutsOnBeat: number; beatsPerCut: number | null } {
  if (cutTimes.length === 0 || beats.length === 0 || bpm <= 0) return { cutsOnBeat: 0, beatsPerCut: null };
  const onBeat = cutTimes.filter((cut) => beats.some((beat) => Math.abs(beat - cut) <= ON_BEAT_TOLERANCE)).length;
  const period = 60 / bpm;
  const gaps: number[] = [];
  const edges = [0, ...cutTimes];
  for (let i = 1; i < edges.length; i += 1) gaps.push(edges[i]! - edges[i - 1]!);
  const sorted = gaps.sort((a, b) => a - b);
  const typical = sorted[sorted.length >> 1]!;
  const beatsPerCut = Math.max(1, Math.round(typical / period));
  return { cutsOnBeat: Number((onBeat / cutTimes.length).toFixed(2)), beatsPerCut };
}
