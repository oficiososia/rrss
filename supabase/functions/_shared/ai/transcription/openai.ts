// Transcripción con OpenAI (`POST /v1/audio/transcriptions`), sin SDK.
//
// Fuentes (consultadas el 21/11/2026):
//  * Modelos y formatos: https://developers.openai.com/api/docs/guides/speech-to-text
//    — `gpt-transcribe` es el recomendado y devuelve `text` (sin marcas de
//    tiempo); `whisper-1` y los `gpt-4o-*-transcribe` están obsoletos y se
//    apagan el 26/02/2027. Archivos de hasta 25 MB (flac, mp3, mp4, mpeg, mpga,
//    m4a, ogg, wav, webm).
//  * Referencia: https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
//    — `usage` puede ser de duración (`seconds`) o de tokens.
//  * Precio: https://developers.openai.com/api/docs/pricing — `gpt-transcribe`
//    0,0045 $/min estimado; `whisper-1` 0,006 $/min.
//  * Vocabulario de pista (consultado el 22/11/2026 en la misma guía):
//    `gpt-transcribe` admite `keywords[]` («literal terms you expect to hear»;
//    cada una en una línea y sin `<`, `>` ni saltos: si no, rechaza la petición
//    entera); el resto de modelos solo `prompt` (en `whisper-1`, 224 tokens como
//    mucho). La guía no da un máximo de palabras: los topes de aquí son propios.
//
// Como el modelo vigente no da tiempos, el navegador manda el sonido ya cortado
// en trozos de voz (cada uno con su principio y su final en el clip) y aquí se
// transcribe cada trozo por separado: un trozo = un subtítulo. Así vale para
// cualquier modelo y sobrevive al apagado de `whisper-1`.
import { AiProviderFailure, type AiProvider, type AiProviderResult, type AiUsage } from '../contract.ts';
import { describeOpenAiError, normalizeOpenAiBaseUrl, OPENAI_PROVIDER_ID } from '../text/openai.ts';

/** Unidad de consumo con la que se cobra: segundos de sonido enviados. */
export const TRANSCRIPTION_UNIT = 'audio_seconds';
export const TRANSCRIPTION_DEFAULT_MODEL = 'gpt-transcribe';

/** Topes propios del vocabulario de pista (la guía de OpenAI no da un máximo). */
export const MAX_HINTS = 30;
export const MAX_HINT_CHARS = 40;
export const MAX_HINTS_TOTAL_CHARS = 600;

/**
 * Vocabulario de pista listo para mandar: solo textos, en una línea, sin `<`,
 * `>` ni caracteres de control (OpenAI rechaza la petición entera si los hay),
 * sin repetidos, y dentro de los topes. Lo que no vale se descarta sin avisar:
 * son pistas, no datos.
 */
export function sanitizeTranscriptionHints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item
      // eslint-disable-next-line no-control-regex
      .replace(/[<>\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
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

/** Trozo de sonido de un clip: WAV (o lo que admita OpenAI) y cuánto dura. */
export interface AudioChunk {
  data: Uint8Array;
  mimeType: string;
  /** Duración del trozo, medida por quien lo cortó. */
  seconds: number;
}

export type TranscriptionFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal: AbortSignal },
) => Promise<Response>;

export interface OpenAiTranscriptionOptions {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  fetch?: TranscriptionFetch;
}

const EXTENSION: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/flac': 'flac',
};

/** Segundos que se reservan: cada trozo, redondeado al segundo por arriba (cota). */
export function chunkSeconds(chunks: readonly AudioChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + Math.ceil(Math.max(0, chunk.seconds)), 0);
}

function redact(text: string, secret: string): string {
  return (secret ? text.split(secret).join('[oculto]') : text).replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function createOpenAiTranscriptionProvider(options: OpenAiTranscriptionOptions): AiProvider {
  const fetchFn: TranscriptionFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const baseUrl = normalizeOpenAiBaseUrl(options.baseUrl);

  return {
    id: OPENAI_PROVIDER_ID,

    estimateUsage(request): AiUsage {
      return { [TRANSCRIPTION_UNIT]: chunkSeconds(request.input.audio?.chunks ?? []) };
    },

    async generate(request): Promise<AiProviderResult> {
      if (request.task !== 'transcription') {
        throw new AiProviderFailure('unsupported_task', 'Este adaptador de OpenAI solo transcribe');
      }
      const audio = request.input.audio;
      if (!audio || audio.chunks.length === 0)
        throw new AiProviderFailure('bad_request', 'No hay sonido que transcribir');
      const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}` };
      if (options.organization) headers['openai-organization'] = options.organization;
      if (options.project) headers['openai-project'] = options.project;

      const segments: Array<{ index: number; text: string }> = [];
      let billedSeconds = 0;
      let requestId: string | undefined;
      for (const [index, chunk] of audio.chunks.entries()) {
        const form = new FormData();
        const extension = EXTENSION[chunk.mimeType] ?? 'wav';
        form.append('file', new Blob([chunk.data], { type: chunk.mimeType }), `trozo-${index}.${extension}`);
        form.append('model', request.model);
        form.append('response_format', 'json');
        // `languages` solo es de `gpt-transcribe`; el resto de modelos toma `language`.
        if (audio.language && request.model !== 'gpt-transcribe') form.append('language', audio.language);
        if (audio.language && request.model === 'gpt-transcribe') form.append('languages[]', audio.language);
        // Vocabulario de pista: `keywords[]` solo es de `gpt-transcribe`; el resto lo toma como `prompt`.
        const hints = sanitizeTranscriptionHints(audio.hints);
        if (hints.length > 0 && request.model === 'gpt-transcribe') {
          for (const hint of hints) form.append('keywords[]', hint);
        } else if (hints.length > 0) {
          form.append('prompt', hints.join(', '));
        }

        let response: Response;
        try {
          response = await fetchFn(`${baseUrl}/v1/audio/transcriptions`, {
            method: 'POST',
            headers,
            body: form,
            signal: request.signal,
          });
        } catch (error) {
          if (request.signal.aborted) throw new AiProviderFailure('aborted', 'Petición cancelada');
          throw new AiProviderFailure(
            'network',
            `No se pudo contactar con OpenAI: ${redact(String(error), options.apiKey)}`,
            {
              retryable: true,
            },
          );
        }
        const text = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
        if (!response.ok) {
          const detail = redact(describeOpenAiError(body) ?? `HTTP ${response.status}`, options.apiKey);
          if (response.status === 429) {
            throw new AiProviderFailure('rate_limited', `OpenAI: límite de uso (${detail})`, { retryable: true });
          }
          throw new AiProviderFailure(response.status >= 500 ? 'overloaded' : 'provider_error', `OpenAI: ${detail}`, {
            retryable: response.status >= 500,
          });
        }
        const transcript = (body as { text?: unknown } | undefined)?.text;
        if (typeof transcript !== 'string') {
          throw new AiProviderFailure('invalid_response', 'OpenAI respondió sin texto');
        }
        const usage = (body as { usage?: { type?: string; seconds?: number } }).usage;
        billedSeconds +=
          usage?.type === 'duration' && typeof usage.seconds === 'number' && usage.seconds > 0
            ? Math.ceil(usage.seconds)
            : Math.ceil(chunk.seconds);
        requestId ??= response.headers.get('x-request-id') ?? undefined;
        segments.push({ index, text: transcript.trim() });
      }
      return { output: { segments }, usage: { [TRANSCRIPTION_UNIT]: billedSeconds }, providerRequestId: requestId };
    },
  };
}
