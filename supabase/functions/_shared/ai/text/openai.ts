// Adaptador de texto: OpenAI (Chat Completions).
//
// ⚠ SIN PROBAR CONTRA EL SERVICIO REAL (no hay cuenta ni clave). Probado solo
// con respuestas HTTP simuladas. Fuentes (consultadas el 20/11/2026):
//   https://developers.openai.com/api/docs/guides/data-residency
//   https://developers.openai.com/api/docs/pricing
//
// Lo que dice la documentación y aquí se aplica:
//   * `POST {base}/v1/chat/completions` con `Authorization: Bearer`. Cabeceras
//     opcionales `OpenAI-Organization` y `OpenAI-Project`.
//   * Salida estructurada: `response_format: { type: "json_schema", json_schema:
//     { name, schema, strict: true } }`; el JSON llega como texto en
//     `choices[0].message.content`. El modo estricto exige todas las
//     propiedades en `required` y `additionalProperties: false` (ya lo cumplen
//     los esquemas de las tareas). Una negativa llega en `message.refusal`.
//   * Límite de salida: `max_completion_tokens` (en los modelos de
//     razonamiento incluye los tokens de razonamiento, que se facturan como
//     salida y vienen dentro de `completion_tokens`).
//   * Caché de prompts automática por prefijo; `prompt_cache_key` mejora el
//     acierto. Los tokens leídos de caché vienen en
//     `usage.prompt_tokens_details.cached_tokens`, INCLUIDOS en
//     `prompt_tokens`. No hay recargo por escribir en la caché.
//   * Residencia en la UE: un proyecto creado con región «Europa» se usa
//     contra `eu.api.openai.com` (OPENAI_BASE_URL). Con ese endpoint no se
//     puede enviar `store: true`; aquí nunca se envía `store`.
import {
  AiProviderFailure,
  type AiFinishReason,
  type Json,
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResult,
  type AiUsage,
} from '../contract.ts';
import { toProviderSchema } from '../schema.ts';
import { field, postJson, tokenCount, type FetchLike } from './http.ts';
import { estimateTextUsage, maxOutputTokens, orderedContext, renderContextPart, TEXT_UNITS } from './prompt.ts';
import { imageDataUrl } from './vision.ts';

export const OPENAI_PROVIDER_ID = 'openai';
const NAME = 'OpenAI';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';
export const OPENAI_EU_BASE_URL = 'https://eu.api.openai.com';

export interface OpenAiProviderOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  organization?: string;
  project?: string;
}

/** Quita barras finales y un `/v1` final: el adaptador añade `/v1/...`. */
export function normalizeOpenAiBaseUrl(raw: string | undefined): string {
  return (raw ?? OPENAI_DEFAULT_BASE_URL).trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** Problema de dirección (no https, con usuario…), o null. */
export function openAiBaseUrlProblem(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return 'OPENAI_BASE_URL debe empezar por https://.';
    if (u.username || u.password) return 'OPENAI_BASE_URL no puede llevar usuario ni contraseña.';
    return null;
  } catch {
    return 'OPENAI_BASE_URL no es una dirección válida.';
  }
}

/**
 * Residencia: solo `eu.api.openai.com` (proyecto con región Europa) garantiza
 * proceso en la UE. Devuelve el problema, o null si es ese endpoint.
 */
export function openAiEuProblem(baseUrl: string): string | null {
  let host = '';
  try {
    host = new URL(normalizeOpenAiBaseUrl(baseUrl)).hostname;
  } catch {
    return 'la dirección no es válida';
  }
  return host === 'eu.api.openai.com'
    ? null
    : `«${host}» no es el endpoint de residencia en la UE de OpenAI (eu.api.openai.com)`;
}

/** Valores de `reasoning_effort` que se dejan pasar al proveedor. */
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export function buildChatBody(request: Omit<AiProviderRequest, 'signal'>): Record<string, unknown> {
  const { input } = request;
  const { cacheable, volatile } = orderedContext(input);
  const user = [...cacheable, ...volatile].map(renderContextPart).concat(input.prompt).join('\n\n');

  const messages: { role: string; content: unknown }[] = [];
  if (input.instructions) messages.push({ role: 'system', content: input.instructions });
  if (input.images && input.images.length > 0) {
    // Visión: el texto y, detrás, cada imagen con su etiqueta. Detalle bajo: las
    // imágenes ya llegan pequeñas (512 px de lado como mucho) y así el coste es fijo.
    const parts: unknown[] = [{ type: 'text', text: user }];
    for (const image of input.images) {
      if (image.label) parts.push({ type: 'text', text: image.label });
      parts.push({ type: 'image_url', image_url: { url: imageDataUrl(image), detail: 'low' } });
    }
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({ role: 'user', content: user });
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
    max_completion_tokens: maxOutputTokens(input),
  };
  if (input.outputSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: input.outputSchema.name,
        schema: toProviderSchema(input.outputSchema.schema),
        strict: true,
      },
    };
  }
  // Herramientas (function calling): modo estricto, varias llamadas en paralelo
  // y «auto» (el modelo puede no llamar a ninguna y contestar con texto). Van
  // delante de los mensajes en lo que el proveedor guarda en caché: mientras no
  // cambien, se leen de caché con las instrucciones.
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toProviderSchema(tool.parameters),
        strict: true,
      },
    }));
    body.tool_choice = 'auto';
    body.parallel_tool_calls = true;
  }
  if (input.cacheKey && (cacheable.length > 0 || body.tools)) body.prompt_cache_key = input.cacheKey;
  // Esfuerzo de razonamiento: solo si quien llama lo pide en `params` (la sonda
  // de «Probar conexión» y el copiloto del editor). No todos los modelos lo
  // admiten (responden 400). Ojo: `gpt-6-luna` solo admite herramientas en Chat
  // Completions con `reasoning_effort: "none"` (su página de modelo, 22/11/2026).
  const effort = input.params?.reasoning_effort;
  if (typeof effort === 'string' && REASONING_EFFORTS.has(effort)) body.reasoning_effort = effort;
  return body;
}

function finishReason(value: unknown): AiFinishReason {
  if (value === 'stop' || value === 'tool_calls') return 'stop';
  if (value === 'length') return 'length';
  return 'other';
}

export function parseChatResponse(body: unknown): AiProviderResult {
  const choices = field(body, 'choices');
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = field(choice, 'message');
  const content = field(message, 'content');
  const refusal = field(message, 'refusal');
  const usage = field(body, 'usage');
  const prompt = tokenCount(field(usage, 'prompt_tokens'));
  const completion = tokenCount(field(usage, 'completion_tokens'));
  const reason = field(choice, 'finish_reason');

  // Llamadas a herramientas: `message.tool_calls[]` con los argumentos como
  // texto JSON. Con llamadas, `content` suele venir a null.
  const rawCalls = field(message, 'tool_calls');
  const toolCalls: { name: string; arguments: Json }[] = [];
  if (Array.isArray(rawCalls)) {
    for (const call of rawCalls) {
      const fn = field(call, 'function');
      const name = field(fn, 'name');
      if (field(call, 'type') !== 'function' || typeof name !== 'string') continue;
      let args: Json = null;
      try {
        const parsed: unknown = JSON.parse(String(field(fn, 'arguments') ?? ''));
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) args = parsed as Json;
      } catch {
        args = null;
      }
      toolCalls.push({ name, arguments: args });
    }
  }

  if (typeof refusal === 'string' && refusal && typeof content !== 'string' && toolCalls.length === 0) {
    // No se copia el texto de la negativa: puede citar lo enviado.
    throw new AiProviderFailure('refused', `${NAME} se ha negado a responder`);
  }
  if ((typeof content !== 'string' && toolCalls.length === 0) || prompt === null || completion === null) {
    throw new AiProviderFailure('bad_response', `${NAME} ha devuelto una respuesta sin contenido o sin consumo`);
  }
  if (reason === 'content_filter') {
    throw new AiProviderFailure('refused', `${NAME} ha filtrado la respuesta por su política de contenido`);
  }

  const cached = Math.min(tokenCount(field(field(usage, 'prompt_tokens_details'), 'cached_tokens')) ?? 0, prompt);
  const result: AiProviderResult = {
    output: {
      text: typeof content === 'string' ? content : '',
      finish_reason: finishReason(reason),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    usage: {
      [TEXT_UNITS.input]: prompt - cached,
      [TEXT_UNITS.output]: completion,
      [TEXT_UNITS.cacheRead]: cached,
    },
  };
  const id = field(body, 'id');
  if (typeof id === 'string' && id) result.providerRequestId = id;
  return result;
}

/** `{ error: { message, type, code } }`. */
export function describeOpenAiError(body: unknown): string | undefined {
  const message = field(field(body, 'error'), 'message');
  return typeof message === 'string' ? message : undefined;
}

export function createOpenAiProvider(options: OpenAiProviderOptions): AiProvider {
  const fetchFn: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const baseUrl = normalizeOpenAiBaseUrl(options.baseUrl);

  return {
    id: OPENAI_PROVIDER_ID,
    supportsTools: true,

    estimateUsage(request): AiUsage {
      return estimateTextUsage(request.input, { cacheWrites: false });
    },

    async generate(request): Promise<AiProviderResult> {
      if (request.task !== 'text') {
        throw new AiProviderFailure('unsupported_task', `El adaptador de ${NAME} solo sirve la tarea de texto`);
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      };
      if (options.organization) headers['openai-organization'] = options.organization;
      if (options.project) headers['openai-project'] = options.project;
      const response = await postJson({
        fetch: fetchFn,
        url: `${baseUrl}/v1/chat/completions`,
        headers,
        body: buildChatBody(request),
        signal: request.signal,
        providerName: NAME,
        secrets: [options.apiKey],
        describeError: describeOpenAiError,
      });
      return parseChatResponse(response.body);
    },
  };
}
