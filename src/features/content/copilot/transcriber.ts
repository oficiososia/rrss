import { aiVoiceCopilotEnabled } from '@/config/app';
import { AiRequestError, aiErrorMessage, toAiError } from '@/features/ai/api';
import { useIntegrationAvailability } from '@/features/platform/integrations/api';
import { supabase } from '@/lib/supabase';

// Motor «transcriptor» del copiloto por voz: lo que hace falta para mandar lo
// grabado a la función `ai-transcribe` (supabase/functions/ai-transcribe) y
// recibir el texto. La función solo admite WAV, en trozos de 15 s como mucho:
// por eso aquí se recorta el silencio, se parte lo largo y se pasa a WAV de
// 16 kHz mono. El cupo de IA, el permiso y el coste los impone el servidor.
//
// Todo lo que no es red es puro y se prueba aparte (transcriber.test.ts).

/** Frecuencia con la que se manda el sonido (la misma que los subtítulos de los reels). */
export const DICTATION_SAMPLE_RATE = 16000;
/** Uso con el que queda apuntado el dictado en el registro de IA (`ai_generations.purpose`). */
export const DICTATION_PURPOSE = 'editor.dictation';

/** Límites de la función (supabase/functions/ai-transcribe/handler.ts). */
export const MAX_CHUNK_SECONDS = 15;
export const MIN_CHUNK_SECONDS = 0.2;
export const MAX_REQUEST_SECONDS = 120;
export const MAX_REQUEST_CHUNKS = 40;
export const MAX_REQUEST_BYTES = 6_000_000;

/** Topes del vocabulario de pista (los mismos que aplica el servidor al sanearlo). */
export const MAX_HINTS = 30;
export const MAX_HINT_CHARS = 40;
export const MAX_HINTS_TOTAL_CHARS = 600;

/** Margen sobre el tiempo máximo del servidor. */
const CLIENT_TIMEOUT_MS = 90_000;

// ── Disponibilidad ────────────────────────────────────────────────────────

/**
 * ¿Está el transcriptor configurado en el servidor? Lo dice
 * `platform-integrations` (acción `availability`) en `reelSubtitles`: el nombre
 * es el de su primer uso, pero es exactamente «la transcripción con OpenAI se
 * puede cargar y tiene precio» (`transcriptionReady`), que es lo que usa
 * también el dictado. Mientras no hay respuesta, o si falla, es falso (lo que
 * no funciona no sale). Solo pregunta si este despliegue tiene copiloto por voz.
 */
export function useTranscriberConfigured(): boolean {
  const allowed = aiVoiceCopilotEnabled();
  const availability = useIntegrationAvailability(allowed);
  return allowed && availability.data?.reelSubtitles === true;
}

// ── Sonido (puro) ─────────────────────────────────────────────────────────

/** Energía (RMS) por ventanas de 50 ms. */
function windowEnergies(samples: Float32Array, sampleRate: number): { energies: number[]; window: number } {
  const window = Math.max(1, Math.round(sampleRate * 0.05));
  const energies: number[] = [];
  for (let i = 0; i < samples.length; i += window) {
    let sum = 0;
    const end = Math.min(samples.length, i + window);
    for (let j = i; j < end; j += 1) sum += samples[j]! * samples[j]!;
    energies.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return { energies, window };
}

/**
 * Quita el silencio de antes y de después de la voz (deja un margen de
 * `padSeconds`) y conserva las pausas de en medio: una orden es una sola
 * petición. Si no hay voz (todo silencio, o un chasquido de menos de 150 ms),
 * devuelve un sonido vacío.
 */
export function trimSilence(samples: Float32Array, sampleRate: number, padSeconds = 0.25): Float32Array {
  const { energies, window } = windowEnergies(samples, sampleRate);
  if (energies.length === 0) return samples.subarray(0, 0);
  // Nivel de la voz: la tercera ventana más alta, para que un golpe suelto no mande.
  const sorted = [...energies].sort((a, b) => b - a);
  const loud = sorted[Math.min(2, sorted.length - 1)] ?? 0;
  if (loud < 0.003) return samples.subarray(0, 0);
  const threshold = Math.max(0.003, loud * 0.08);
  let first = -1;
  let last = -1;
  let voiced = 0;
  energies.forEach((energy, index) => {
    if (energy < threshold) return;
    voiced += 1;
    if (first < 0) first = index;
    last = index;
  });
  if (voiced < 3) return samples.subarray(0, 0);
  const pad = Math.round(padSeconds * sampleRate);
  const from = Math.max(0, first * window - pad);
  const to = Math.min(samples.length, (last + 1) * window + pad);
  return samples.subarray(from, to);
}

/**
 * Parte un sonido en trozos de `maxSeconds` como mucho. Corta en el tope, salvo
 * que en la segunda mitad del trozo haya una pausa: entonces corta ahí, para no
 * partir una palabra. Ningún trozo queda más corto de medio segundo.
 */
export function splitForTranscription(
  samples: Float32Array,
  sampleRate: number,
  maxSeconds = MAX_CHUNK_SECONDS,
): Float32Array[] {
  const max = Math.floor(maxSeconds * sampleRate);
  if (max < 2) return samples.length > 0 ? [samples] : [];
  const out: Float32Array[] = [];
  let rest = samples;
  while (rest.length > max) {
    const { energies, window } = windowEnergies(rest.subarray(0, max), sampleRate);
    // El corte nunca deja un resto de menos de medio segundo ni un trozo de menos de la mitad del tope.
    const lastUsable = Math.max(Math.ceil(max / 2), Math.min(max, rest.length - Math.round(sampleRate * 0.5)));
    const lastWindow = Math.min(energies.length - 1, Math.floor((lastUsable - 1) / window));
    // Se corta en el tope salvo que antes haya un punto claramente más callado (una pausa).
    let cut = lastUsable;
    let quietest = (energies[lastWindow] ?? 0) * 0.5;
    for (let i = Math.floor(energies.length / 2); i <= lastWindow; i += 1) {
      if (energies[i]! < quietest) {
        quietest = energies[i]!;
        cut = i * window;
      }
    }
    out.push(rest.subarray(0, cut));
    rest = rest.subarray(cut);
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/** WAV PCM de 16 bits, mono, a partir de muestras entre −1 y 1. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

// ── Vocabulario de pista ──────────────────────────────────────────────────

/**
 * Deja el vocabulario de pista (nombres de la marca, de platos, de capas…)
 * como lo admite la función: textos de una línea, sin `<` ni `>`, sin
 * repetidos, de 2 a 40 caracteres, 30 como mucho y 600 caracteres en total. Lo
 * primero de la lista es lo que más importa: lo que no cabe, se queda fuera.
 * El servidor vuelve a sanearlo; aquí se hace para no mandar de más.
 */
export function prepareHints(hints: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const hint of hints) {
    if (typeof hint !== 'string') continue;
    const clean = hint
      // eslint-disable-next-line no-control-regex
      .replace(/[<>\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_HINT_CHARS)
      .trim();
    if (clean.length < 2) continue;
    const key = clean.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    if (total + clean.length > MAX_HINTS_TOTAL_CHARS) break;
    seen.add(key);
    out.push(clean);
    total += clean.length;
    if (out.length >= MAX_HINTS) break;
  }
  return out;
}

// ── Petición ──────────────────────────────────────────────────────────────

export interface DictationRequest {
  brandId: string;
  /** Lo grabado, ya en 16 kHz mono y sin el silencio de los extremos. */
  samples: Float32Array;
  /** Vocabulario de pista (se sanea con `prepareHints`). */
  hints?: readonly string[];
  /** Idioma que se habla (ISO 639-1). Por defecto, español. */
  language?: string;
}

/**
 * Manda un dictado a `ai-transcribe` y devuelve el texto (vacío si el modelo no
 * ha entendido nada). Los fallos salen como `AiRequestError`, con el mismo
 * mensaje en español que el resto de la IA (cupo agotado, sin configurar, red…).
 */
export async function transcribeDictation(request: DictationRequest): Promise<string> {
  const pieces = splitForTranscription(request.samples, DICTATION_SAMPLE_RATE).filter(
    (piece) => piece.length / DICTATION_SAMPLE_RATE >= MIN_CHUNK_SECONDS,
  );
  if (pieces.length === 0) return '';
  const seconds = pieces.reduce((sum, piece) => sum + piece.length / DICTATION_SAMPLE_RATE, 0);
  const bytes = pieces.reduce((sum, piece) => sum + 44 + piece.length * 2, 0);
  if (pieces.length > MAX_REQUEST_CHUNKS || seconds > MAX_REQUEST_SECONDS || bytes > MAX_REQUEST_BYTES) {
    throw new AiRequestError(
      'too_large',
      'El dictado es demasiado largo para transcribirlo de una vez. Dilo en frases más cortas.',
    );
  }
  const hints = prepareHints(request.hints ?? []);
  const form = new FormData();
  form.append('brandId', request.brandId);
  form.append(
    'meta',
    JSON.stringify({
      chunks: pieces.map((piece) => ({ seconds: Number((piece.length / DICTATION_SAMPLE_RATE).toFixed(3)) })),
      language: request.language ?? 'es',
      purpose: DICTATION_PURPOSE,
      ...(hints.length > 0 ? { hints } : {}),
    }),
  );
  pieces.forEach((piece, index) => {
    form.append(`chunk-${index}`, new Blob([encodeWav(piece, DICTATION_SAMPLE_RATE)], { type: 'audio/wav' }));
  });

  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.functions.invoke('ai-transcribe', { body: form, timeout: CLIENT_TIMEOUT_MS });
  } catch (error) {
    throw await toAiError(error);
  }
  if (result.error) throw await toAiError(result.error);
  const segments = (result.data as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) throw new AiRequestError('internal', aiErrorMessage('internal'), { retryable: true });
  return (segments as Array<{ index?: unknown; text?: unknown }>)
    .filter((segment) => typeof segment?.text === 'string')
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((segment) => (segment.text as string).trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}
