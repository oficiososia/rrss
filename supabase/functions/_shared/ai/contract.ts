// Contrato del servicio de IA, independiente del proveedor
// (docs/01-arquitectura.md, §5).
//
// Este código se ejecuta en el servidor (Edge Functions): por eso vive aquí y
// los módulos se importan con su extensión. No depende de ningún SDK ni de
// Deno: es TypeScript puro, y las pruebas lo ejecutan tal cual en Node.
//
// El resto del producto habla con `AiService` (service.ts). Un proveedor nuevo
// es un `AiProvider` más y unas filas de configuración (`AiModelSpec`); nada
// de lo que hay fuera de esta carpeta cambia.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Las tareas que el producto puede pedir. Coincide con el tipo `ai_task` de la base de datos. */
export type AiTask = 'text' | 'vision' | 'image' | 'video' | 'transcription' | 'embedding';

/**
 * Unidades consumidas, con el nombre que les dé cada modelo: `input_tokens`,
 * `output_tokens`, `images`, `seconds`…
 */
export type AiUsage = Record<string, number>;

/**
 * Un modelo disponible: qué adaptador lo sirve, para qué tarea y a qué precio.
 * Es configuración, no código: qué proveedores y modelos se usan lo decide
 * quien despliega.
 */
export interface AiModelSpec {
  /** Identificador del adaptador (`AiProvider.id`). */
  provider: string;
  /** Nombre del modelo tal como lo entiende ese proveedor. */
  model: string;
  task: AiTask;
  /**
   * Precio de cada unidad de consumo, en millonésimas de la moneda de cuenta
   * de la plataforma. Admite decimales (un token suele costar menos de una
   * millonésima).
   */
  microsPerUnit: Record<string, number>;
  /**
   * Propósitos (`AiGenerateParams.purpose`) que sirve este modelo. Sin lista,
   * sirve cualquiera de su tarea. Así cada tarea de texto puede usar un modelo
   * distinto (uno para redactar, otro más barato para comprobar).
   */
  purposes?: string[];
}

/** Esquema JSON (subconjunto que entienden todos los proveedores: ver schema.ts). */
export type JsonSchema = { [key: string]: Json | undefined };

/** Salida estructurada que se exige al modelo. */
export interface AiOutputSchema {
  /** Nombre corto del esquema (`[a-z0-9_]`): algunos proveedores lo piden. */
  name: string;
  schema: JsonSchema;
  /**
   * Esquema con el que se valida la respuesta aquí, si es más tolerante que el
   * que se envía al proveedor (por ejemplo, sin longitudes máximas: la tarea
   * recorta después). Sin él, se valida con `schema`. Nunca más permisivo con
   * la FORMA: los campos no previstos siguen invalidando la respuesta.
   */
  localSchema?: JsonSchema;
}

/**
 * Herramienta que el modelo puede llamar (function calling del proveedor). Los
 * parámetros son un esquema JSON de objeto en modo estricto: todas las
 * propiedades en `required`, `additionalProperties: false` y lo opcional, como
 * tipo que admite `null`.
 */
export interface AiToolSpec {
  /** `[a-z0-9_]`, como mucho 64 caracteres. */
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** Llamada a una herramienta tal como la devuelve el adaptador (`output.tool_calls`). */
export type AiToolCall = {
  /** Identificador de la llamada en el proveedor (hace falta para devolverle su resultado). */
  id?: string;
  name: string;
  /** Argumentos ya leídos como JSON; `null` si el proveedor mandó algo ilegible. */
  arguments: Json;
};

/** Por qué dejó de escribir el modelo, con el mismo nombre en todos los proveedores. */
export type AiFinishReason = 'stop' | 'length' | 'refusal' | 'other';

export interface AiInput {
  /** Instrucciones del producto. Nunca contienen texto escrito por un cliente. */
  instructions?: string;
  /** Lo que se pide. */
  prompt: string;
  /**
   * Material del cliente (perfil de marca, fragmentos de sus documentos…).
   * Viaja siempre como datos delimitados: el adaptador no puede mezclarlo con
   * las instrucciones.
   */
  context?: {
    label: string;
    content: string;
    /**
     * Material estable entre peticiones (el perfil de marca): el adaptador lo
     * coloca delante y lo marca para la caché de prompts del proveedor.
     */
    cacheable?: boolean;
  }[];
  /** Ajustes de la petición: `max_output_tokens`, `count`, `width`… */
  params?: Record<string, string | number | boolean>;
  /**
   * Si se indica, el modelo debe responder con un JSON que cumpla el esquema.
   * El adaptador usa la salida estructurada nativa del proveedor y el servicio
   * valida el resultado: `output.json` solo existe si lo cumple.
   */
  outputSchema?: AiOutputSchema;
  /**
   * Herramientas que el modelo puede llamar en esta petición (una sola vuelta:
   * el producto ejecuta las llamadas, no se devuelven resultados al modelo).
   * El adaptador usa el function calling nativo, en modo estricto y con
   * llamadas en paralelo; las llamadas llegan en `output.tool_calls`
   * (`AiToolCall[]`) y quien las pidió las valida con su esquema completo.
   * Solo en adaptadores con `supportsTools`.
   */
  tools?: AiToolSpec[];
  /** `required` obliga a llamar al menos a una herramienta (donde el proveedor lo admite). Por defecto, `auto`. */
  toolChoice?: 'auto' | 'required';
  /**
   * Vueltas anteriores de herramientas de esta misma petición: lo que el modelo
   * llamó y el resultado que se le devuelve. Sirve para seguir cuando un modelo
   * llama a una herramienta y se queda esperando su resultado antes de llamar a
   * la siguiente. Solo en adaptadores con `supportsToolTurns`.
   */
  toolTurns?: { calls: AiToolCall[]; results: string[] }[];
  /**
   * Clave estable y sin datos sensibles (por ejemplo, marca y propósito) para
   * los proveedores cuya caché de prompts se orienta con una clave.
   */
  cacheKey?: string;
  /**
   * Imágenes que el modelo tiene que mirar (visión), cada una con una etiqueta
   * que se le enseña justo antes («Plano 2, segundo 3,1»). Son datos: nunca
   * van al registro. Solo las admiten los adaptadores que lo dicen
   * (`text/vision.ts`, `supportsImages`).
   */
  images?: Array<{ data: Uint8Array; mimeType: string; label?: string }>;
  /**
   * Sonido que transcribir (tarea `transcription`): trozos ya cortados por
   * quien llama, cada uno con su duración. Nunca va al registro.
   */
  audio?: {
    chunks: Array<{ data: Uint8Array; mimeType: string; seconds: number }>;
    /** Idioma esperado (ISO 639-1), si se sabe. */
    language?: string;
    /**
     * Vocabulario de pista (nombres propios, platos, capas…): palabras que es
     * probable oír. Ya saneadas por quien llama (`sanitizeTranscriptionHints`).
     * Son una ayuda para el modelo, no texto obligado. Nunca van al registro.
     */
    hints?: string[];
  };
}

export interface AiProviderRequest {
  task: AiTask;
  model: string;
  input: AiInput;
  /** Se activa al agotarse el tiempo máximo o al cancelar: el adaptador debe respetarla. */
  signal: AbortSignal;
}

export interface AiProviderResult {
  /**
   * Resultado serializable: `{ text }`, `{ assets: […] }`, `{ vectors: […] }`…
   * En las tareas de texto: `{ text, finish_reason }` (`AiFinishReason`); el
   * servicio añade `json` cuando se pidió salida estructurada y es válida.
   */
  output: { [key: string]: Json | undefined };
  /** Consumo real, en las mismas unidades con las que el modelo tiene precio. */
  usage: AiUsage;
  /** Identificador de la llamada en el proveedor, para reclamaciones y diagnóstico. */
  providerRequestId?: string;
}

/** Adaptador de un proveedor. Es lo único que conoce su API. */
export interface AiProvider {
  readonly id: string;
  /** ¿Sabe servir `AiInput.tools` (function calling)? Si no, quien llama usa salida estructurada. */
  readonly supportsTools?: boolean;
  /** ¿Sabe continuar con `AiInput.toolTurns` (devolver resultados de herramientas y seguir)? */
  readonly supportsToolTurns?: boolean;
  /**
   * Cota superior del consumo de una petición, sin llamar al proveedor. Con
   * ella se reserva el cupo antes de gastar nada.
   */
  estimateUsage(request: Omit<AiProviderRequest, 'signal'>): AiUsage;
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}

/**
 * Fallo que un adaptador lanza a propósito. Su mensaje se guarda en el
 * registro de generaciones: no debe contener claves, cabeceras ni URL firmadas.
 */
export class AiProviderFailure extends Error {
  readonly code: string;
  /** ¿Tiene sentido repetir la misma petición? */
  readonly retryable: boolean;

  constructor(code: string, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = 'AiProviderFailure';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export type AiErrorCode =
  | 'quota_exhausted' // no queda cupo este mes
  | 'quota_missing' // la organización no tiene cupo asignado
  | 'ai_paused' // la plataforma ha llegado a su tope global de gasto: IA de pago en pausa
  | 'forbidden' // el usuario no puede generar en esa marca
  | 'not_configured' // no hay modelo, adaptador o precio para la tarea
  | 'provider_failed' // el proveedor respondió con un error
  | 'provider_timeout' // el proveedor no respondió a tiempo
  | 'invalid_output' // el modelo respondió, pero no con la estructura pedida (el coste queda anotado)
  | 'refused' // el modelo se negó a responder (el coste queda anotado)
  | 'internal'; // fallo propio (base de datos…)

/** Error del servicio. `message` está en español y se puede enseñar a una persona. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  /** Generación registrada, si se llegó a reservar cupo. */
  readonly generationId?: string;
  readonly retryable: boolean;
  /** Datos de apoyo (por ejemplo, las cifras del cupo). No se muestran tal cual. */
  readonly details?: Json;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { generationId?: string; retryable?: boolean; details?: Json } = {},
  ) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.generationId = options.generationId;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

/**
 * Acceso a las funciones SQL con la clave de servicio. Tiene la misma forma
 * que `supabase.rpc()`, así que el cliente de Supabase sirve tal cual.
 */
export type RpcClient = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{
  data: unknown;
  error: { code?: string; message: string; details?: string | null } | null;
}>;

export interface AiGenerateParams {
  /** Usuario en cuyo nombre se genera (ya autenticado por quien llama). */
  userId: string;
  brandId: string;
  task: AiTask;
  /** Para qué se pide: `post.caption`, `profile.proposal`… Queda en el registro. */
  purpose: string;
  input: AiInput;
  /**
   * Comprobación de la tarea sobre el JSON ya validado con el esquema: devuelve
   * por qué no se puede usar (y entonces la respuesta NO se cobra a la
   * organización: `ai_waive_generation`) o `null` si sirve. Sin ella, todo JSON
   * que cumple el esquema sirve.
   */
  accept?: (value: Json) => string | null;
  /**
   * Tiempo máximo de ESTA llamada al proveedor, si la tarea necesita otro que el
   * general (un plan de campaña largo tarda más que un pie de foto). Sin él, el del servicio.
   */
  timeoutMs?: number;
}

export interface AiGenerateResult {
  generationId: string;
  output: AiProviderResult['output'];
  usage: AiUsage;
  costMicros: number;
  provider: string;
  model: string;
  latencyMs: number;
}

/** Qué adaptador y modelo serviría una tarea, y qué sabe hacer. Sin secretos. */
export interface AiCapabilities {
  provider: string;
  model: string;
  tools: boolean;
  /** ¿Se le pueden devolver resultados de herramientas para que siga? */
  toolTurns: boolean;
}

export interface AiService {
  generate(params: AiGenerateParams): Promise<AiGenerateResult>;
  /**
   * Coste máximo (en millonésimas) de esa petición, sin reservar cupo ni llamar
   * a nadie: lo que se reservaría. Lanza `AiError('not_configured')` si no hay
   * modelo con precio para la tarea.
   */
  estimate?(params: AiGenerateParams): number;
  /** Adaptador y modelo que atenderían esa tarea y propósito, o `null` si no hay ninguno cargado. */
  capabilities?(task: AiTask, purpose: string): AiCapabilities | null;
}
