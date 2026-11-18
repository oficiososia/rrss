// Adaptador de IMAGEN: un servidor ComfyUI propio con modelos abiertos
// (por defecto, FLUX.2 Klein 4B, licencia Apache-2.0).
//
// SIN PROBAR CONTRA UN COMFYUI REAL: solo con respuestas HTTP simuladas.
// Escrito contra la API HTTP documentada de ComfyUI (consultada el 18/11/2026):
//   · https://docs.comfy.org/development/comfyui-server/comms_routes
//   POST /prompt          { prompt: <grafo en formato API>, client_id } → { prompt_id, number, node_errors }
//   GET  /history/{id}    → { <id>: { status: { status_str, completed }, outputs: { <nodo>: { images: [...] } } } }
//                           (vacío mientras está en cola o en marcha)
//   GET  /view?filename=&subfolder=&type=output → los bytes de la imagen
//   POST /upload/image    multipart: image=<archivo>, overwrite=true → { name, subfolder, type }
//   GET  /queue           { queue_running: [[n, id, …]], queue_pending: […] }
//   POST /queue           { delete: [id] } quita un trabajo de la cola (la forma del
//                         cuerpo no está en esa página: sale del cliente del kit y
//                         del código del servidor; sin contrastar)
//   POST /interrupt       detiene lo que esté en marcha (sea de quien sea)
// La página de la documentación trae una indicación dirigida a asistentes
// automáticos (descargar un índice); no se ha seguido.
//
// El grafo es el del cuaderno de pruebas de Colab (FLUX.2 Klein 4B, 4 pasos,
// codificador Qwen3-4B en fp8): mismos nodos y mismos nombres de archivo, que
// se pueden cambiar por modelo en `ai_media_models.settings`. Las imágenes de
// referencia usan `ReferenceLatent`, que el cuaderno NO prueba: sin contrastar.
//
// Asíncrono, solo por sondeo: ComfyUI no tiene webhooks. Cada consulta es una
// llamada a /history; el resultado se descarga en la consulta que lo encuentra.
//
// Región: la del servidor que se configure (COMFYUI_DATA_REGION; por defecto,
// «desconocida»). Con modelos abiertos en un servidor propio nadie entrena con
// lo que se envía: el registro lo marca como `trains_on_inputs = 'no'`.
//
// Seguridad: ComfyUI no trae autenticación. Exponerlo a Internet sin una
// barrera delante (túnel con acceso, proxy con token) deja que cualquiera
// ejecute grafos en esa GPU. Ver docs/ia-medios.md, «ComfyUI propio».
import {
  MediaProviderFailure,
  type DataRegion,
  type MediaInput,
  type MediaModel,
  type MediaOutcome,
  type MediaProvider,
  type MediaRequest,
  type MediaStartRequest,
  type MediaStartResult,
  type MediaUsage,
  type ProviderJobRef,
} from './contract.ts';
import { failureFromResponse, isRecord, request, requestJson, type FetchLike } from './http.ts';
import { megapixels } from './models.ts';

export const COMFYUI_PROVIDER_ID = 'comfyui';
const PROVIDER_NAME = 'ComfyUI';
const MAX_REFERENCES = 4;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_RESULT_BYTES = 50 * 1024 * 1024;
/** Tope de píxeles por defecto (1,5 MP): cabe en una T4 de 16 GB con el modelo de 4B. */
const DEFAULT_MAX_PIXELS = 1_572_864;

/** Archivos y ajustes del flujo de FLUX.2 Klein 4B (los del cuaderno de Colab). */
export const COMFYUI_FLUX2_KLEIN_DEFAULTS = {
  unet_name: 'flux-2-klein-4b-fp8.safetensors',
  clip_name: 'qwen_3_4b_fp8_mixed.safetensors',
  clip_type: 'flux2',
  vae_name: 'flux2-vae.safetensors',
  steps: 4,
  sampler_name: 'euler',
  cfg: 1,
} as const;

export interface ComfyUiOptions {
  /** Dirección del servidor: https, o http solo en la propia máquina (localhost, 127.0.0.1). */
  baseUrl: string;
  /** Token que el proxy o túnel delante de ComfyUI exige (`Authorization: Bearer`). */
  token?: string;
  /** Dónde está el servidor. Por defecto, desconocido (se trata como fuera de la UE). */
  dataRegion?: DataRegion;
  fetch: FetchLike;
  /** Tiempo máximo de cada llamada. Por defecto, 30 s. */
  timeoutMs?: number;
}

/** ¿Se admite esta dirección? https siempre; http solo en la propia máquina. */
export function isComfyUiBaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;
const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** FNV-1a de 32 bits: semilla estable a partir de la clave de la generación. */
function seedFrom(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Tamaño que se pide al modelo: múltiplo de 16 (lo exige el espacio latente de
 * FLUX.2) y como mucho `maxPixels`, conservando la proporción.
 */
export function comfySize(width: number, height: number, maxPixels: number): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const round = (n: number) => Math.max(256, Math.floor((n * scale) / 16) * 16);
  return { width: round(width), height: round(height) };
}

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/**
 * Grafo en formato API de ComfyUI. Los identificadores de nodo son los del
 * flujo del cuaderno de Colab (`s01_still.api.json`), para poder compararlos.
 */
export function buildFlux2KleinGraph(params: {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  filenamePrefix: string;
  /** Nombres que devolvió /upload/image para cada referencia. */
  references: string[];
  settings: Record<string, unknown>;
}): Graph {
  const s = params.settings;
  const d = COMFYUI_FLUX2_KLEIN_DEFAULTS;
  const graph: Graph = {
    '70': {
      class_type: 'UNETLoader',
      inputs: { unet_name: text(s.unet_name, d.unet_name), weight_dtype: 'default' },
    },
    '71': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: text(s.clip_name, d.clip_name), type: text(s.clip_type, d.clip_type), device: 'default' },
    },
    '72': { class_type: 'VAELoader', inputs: { vae_name: text(s.vae_name, d.vae_name) } },
    '74': { class_type: 'CLIPTextEncode', inputs: { text: params.prompt, clip: ['71', 0] } },
    '76': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['74', 0] } },
  };

  // Referencias (SIN CONTRASTAR con un ComfyUI real): cada imagen se escala a
  // ~1 MP, se codifica con el VAE y se añade a la condición con ReferenceLatent.
  let positive: [string, number] = ['74', 0];
  let negative: [string, number] = ['76', 0];
  params.references.forEach((name, i) => {
    const id = 100 + i * 10;
    graph[`${id}`] = { class_type: 'LoadImage', inputs: { image: name } };
    graph[`${id + 1}`] = {
      class_type: 'ImageScaleToTotalPixels',
      inputs: { image: [`${id}`, 0], upscale_method: 'lanczos', megapixels: 1 },
    };
    graph[`${id + 2}`] = { class_type: 'VAEEncode', inputs: { pixels: [`${id + 1}`, 0], vae: ['72', 0] } };
    graph[`${id + 3}`] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: positive, latent: [`${id + 2}`, 0] },
    };
    graph[`${id + 4}`] = {
      class_type: 'ReferenceLatent',
      inputs: { conditioning: negative, latent: [`${id + 2}`, 0] },
    };
    positive = [`${id + 3}`, 0];
    negative = [`${id + 4}`, 0];
  });

  Object.assign(graph, {
    '63': {
      class_type: 'CFGGuider',
      inputs: { model: ['70', 0], positive, negative, cfg: num(s.cfg, d.cfg) },
    },
    '61': { class_type: 'KSamplerSelect', inputs: { sampler_name: text(s.sampler_name, d.sampler_name) } },
    '62': {
      class_type: 'Flux2Scheduler',
      inputs: { steps: Math.round(num(s.steps, d.steps)), width: params.width, height: params.height },
    },
    '66': {
      class_type: 'EmptyFlux2LatentImage',
      inputs: { width: params.width, height: params.height, batch_size: 1 },
    },
    '73': { class_type: 'RandomNoise', inputs: { noise_seed: params.seed } },
    '64': {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['73', 0], guider: ['63', 0], sampler: ['61', 0], sigmas: ['62', 0], latent_image: ['66', 0] },
    },
    '65': { class_type: 'VAEDecode', inputs: { samples: ['64', 0], vae: ['72', 0] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['65', 0], filename_prefix: params.filenamePrefix } },
  } satisfies Graph);
  return graph;
}

function usageFor(request: MediaRequest, model: MediaModel): MediaUsage {
  if (request.kind !== 'image') return {};
  if (model.billingUnit === 'megapixel') return { megapixels: megapixels(request.size.width, request.size.height) };
  return { images: 1 };
}

export function createComfyUiImageProvider(options: ComfyUiOptions): MediaProvider {
  if (!isComfyUiBaseUrl(options.baseUrl)) {
    throw new Error('Configuración de ComfyUI no válida: la dirección debe ser https (o http solo en localhost)');
  }
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 30_000;
  const auth: Record<string, string> = options.token ? { authorization: `Bearer ${options.token}` } : {};
  const http = (signal?: AbortSignal) => ({ fetch: options.fetch, provider: PROVIDER_NAME, timeoutMs, signal });

  /** Descarga bytes (resultado o referencia) con tamaño máximo y tiempo máximo. */
  async function fetchBytes(url: string, maxBytes: number, signal: AbortSignal | undefined, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const response = await options.fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        throw new MediaProviderFailure(
          'download_failed',
          `No se ha podido descargar un archivo (HTTP ${response.status})`,
          {
            retryable: response.status >= 500 || response.status === 429,
          },
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new MediaProviderFailure('too_large', 'El archivo supera el tamaño máximo');
      }
      return { bytes, contentType: response.headers.get('content-type') };
    } catch (error) {
      if (error instanceof MediaProviderFailure) throw error;
      throw new MediaProviderFailure('network', `No se ha podido descargar un archivo para ${PROVIDER_NAME}`, {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function uploadReference(input: MediaInput, index: number, key: string, signal: AbortSignal): Promise<string> {
    let bytes = input.bytes;
    if (!bytes) {
      if (!input.url || !/^https?:\/\//i.test(input.url)) {
        throw new MediaProviderFailure('invalid_request', 'Falta una imagen de referencia');
      }
      bytes = (await fetchBytes(input.url, MAX_REFERENCE_BYTES, signal)).bytes;
    }
    const extension = input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType === 'image/webp' ? 'webp' : 'png';
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: input.mimeType }), `rrss-${key}-ref${index}.${extension}`);
    form.append('overwrite', 'true');
    const body = await requestJson(`${base}/upload/image`, { method: 'POST', headers: auth, body: form }, http(signal));
    const name = isRecord(body) && typeof body.name === 'string' ? body.name : null;
    if (!name)
      throw new MediaProviderFailure('bad_response', `${PROVIDER_NAME} no ha aceptado la imagen de referencia`);
    const subfolder = isRecord(body) && typeof body.subfolder === 'string' && body.subfolder ? body.subfolder : '';
    return subfolder ? `${subfolder}/${name}` : name;
  }

  return {
    id: COMFYUI_PROVIDER_ID,
    kinds: ['image'],
    testedAgainstRealService: false,
    dataRegion: options.dataRegion ?? 'unknown',
    estimateUsage: usageFor,

    async start({ request, model, idempotencyKey, signal }: MediaStartRequest): Promise<MediaStartResult> {
      if (request.kind !== 'image') {
        throw new MediaProviderFailure('invalid_request', 'Este servidor ComfyUI solo genera imágenes');
      }
      const references = request.references ?? [];
      if (references.length > MAX_REFERENCES) {
        throw new MediaProviderFailure('invalid_request', `Como mucho ${MAX_REFERENCES} imágenes de referencia`);
      }
      const key = idempotencyKey.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || 'rrss';
      const uploaded: string[] = [];
      for (const [index, reference] of references.entries()) {
        uploaded.push(await uploadReference(reference, index, key, signal));
      }
      const size = comfySize(
        request.size.width,
        request.size.height,
        num(model.settings.max_pixels, DEFAULT_MAX_PIXELS),
      );
      const graph = buildFlux2KleinGraph({
        prompt: request.prompt,
        width: size.width,
        height: size.height,
        seed: seedFrom(idempotencyKey),
        filenamePrefix: `rrss/${key}`,
        references: uploaded,
        settings: model.settings as Record<string, unknown>,
      });
      const { response, body } = await request_(`${base}/prompt`, graph, key, signal);
      if (!response.ok) {
        if (response.status === 400) {
          // Faltan nodos o modelos en el servidor: no es culpa de la petición de la persona.
          throw new MediaProviderFailure(
            'provider_error',
            `${PROVIDER_NAME} ha rechazado el flujo (faltan nodos o archivos de modelo en el servidor)`,
          );
        }
        throw failureFromResponse(PROVIDER_NAME, response, body);
      }
      const promptId = isRecord(body) && typeof body.prompt_id === 'string' ? body.prompt_id : null;
      const nodeErrors = isRecord(body) && isRecord(body.node_errors) ? Object.keys(body.node_errors) : [];
      if (nodeErrors.length > 0) {
        throw new MediaProviderFailure(
          'provider_error',
          `${PROVIDER_NAME} ha rechazado el flujo (faltan nodos o archivos de modelo en el servidor)`,
        );
      }
      if (!promptId) throw new MediaProviderFailure('bad_response', `${PROVIDER_NAME} no ha devuelto el trabajo`);
      return { status: 'pending', job: { id: promptId } };
    },

    async poll(job: ProviderJobRef, model: MediaModel, signal: AbortSignal): Promise<MediaOutcome> {
      const id = encodeURIComponent(job.id);
      const body = await requestJson(`${base}/history/${id}`, { headers: auth }, http(signal));
      const entry = isRecord(body) ? body[job.id] : undefined;
      // Sin entrada en el historial: en cola o en marcha.
      if (!isRecord(entry)) return { status: 'pending' };
      const status = isRecord(entry.status) ? entry.status : {};
      if (status.status_str === 'error') {
        return {
          status: 'failed',
          code: 'provider_error',
          message: `${PROVIDER_NAME} no ha podido generar la imagen (error en el servidor)`,
        };
      }
      const outputs = isRecord(entry.outputs) ? entry.outputs : {};
      const images: { filename: string; subfolder: string; type: string }[] = [];
      for (const output of Object.values(outputs)) {
        if (!isRecord(output) || !Array.isArray(output.images)) continue;
        for (const image of output.images) {
          if (isRecord(image) && typeof image.filename === 'string') {
            images.push({
              filename: image.filename,
              subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
              type: typeof image.type === 'string' ? image.type : 'output',
            });
          }
        }
      }
      if (images.length === 0) {
        return status.completed === true
          ? { status: 'failed', code: 'bad_response', message: `${PROVIDER_NAME} terminó sin ninguna imagen` }
          : { status: 'pending' };
      }
      const first = images[0]!;
      const query = new URLSearchParams({ filename: first.filename, subfolder: first.subfolder, type: first.type });
      const file = await fetchBytes(`${base}/view?${query.toString()}`, MAX_RESULT_BYTES, signal, auth);
      const mimeType = file.contentType?.split(';')[0]?.trim() || 'image/png';
      return {
        status: 'completed',
        outputs: [{ mimeType, bytes: file.bytes }],
        usage: model.billingUnit === 'megapixel' ? undefined : { images: 1 },
      };
    },

    async cancel(job: ProviderJobRef, signal: AbortSignal): Promise<void> {
      const post = (path: string, payload: unknown) =>
        request(
          `${base}${path}`,
          { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(payload) },
          http(signal),
        ).catch(() => undefined);
      // /interrupt detiene LO QUE ESTÉ EN MARCHA, sea de quien sea: solo se
      // llama si lo que está en marcha es este trabajo.
      const queue = await request(`${base}/queue`, { headers: auth }, http(signal)).catch(() => null);
      const running =
        queue && isRecord(queue.body) && Array.isArray(queue.body.queue_running) ? queue.body.queue_running : [];
      const isRunning = running.some((item) => Array.isArray(item) && item[1] === job.id);
      if (isRunning) {
        await post('/interrupt', {});
      } else {
        await post('/queue', { delete: [job.id] });
      }
    },
  };

  function request_(url: string, graph: Graph, clientId: string, signal: AbortSignal) {
    return request(
      url,
      {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: `rrss-${clientId}` }),
      },
      http(signal),
    );
  }
}
