// Proveedor simulado: SOLO para pruebas. No llama a nadie, no cuesta nada y
// responde siempre lo mismo ante la misma petición, para poder probar el flujo
// completo (cupo, registro, coste, fallos) sin un proveedor real.
//
// No es una «IA de demostración»: su salida va marcada como simulada y no debe
// configurarse nunca en un entorno que usen clientes.
import {
  AiProviderFailure,
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResult,
  type AiTask,
  type AiToolCall,
  type AiUsage,
} from './contract.ts';

export const SIMULATED_PROVIDER_ID = 'simulated';

export interface SimulatedProviderOptions {
  /** Devuelve un fallo para que la llamada falle; `null` para que responda bien. */
  failWith?: (request: AiProviderRequest, callNumber: number) => Error | null;
  /** Retraso de la respuesta, para probar el tiempo máximo. */
  delayMs?: number;
  /**
   * Texto que responde a una petición de texto (por defecto, «[simulado] …»).
   * Sirve para probar las tareas con salida estructurada. Puede indicar además
   * por qué terminó (`finish_reason`).
   */
  respond?: (
    request: AiProviderRequest,
  ) => string | { text: string; finish_reason?: string; tool_calls?: AiToolCall[] } | undefined;
  /** Sustituye el consumo que se declara tras generar (por defecto, el calculado). */
  reportUsage?: (computed: AiUsage, request: AiProviderRequest) => AiUsage;
}

export interface SimulatedProvider extends AiProvider {
  /** Peticiones recibidas, en orden: las pruebas comprueban con esto que no se llamó. */
  readonly calls: AiProviderRequest[];
}

const SUPPORTED: AiTask[] = ['text', 'image'];
const DEFAULT_MAX_OUTPUT_TOKENS = 256;

/** Aproximación fija: un token cada cuatro caracteres. */
const tokens = (text: string) => Math.ceil(text.length / 4);

function inputTokens(request: Pick<AiProviderRequest, 'input'>): number {
  const { instructions = '', prompt, context = [], tools } = request.input;
  return (
    tokens(instructions) +
    tokens(prompt) +
    context.reduce((sum, part) => sum + tokens(part.content), 0) +
    // Las herramientas viajan en la petición: cuentan como entrada.
    (tools ? tokens(JSON.stringify(tools)) : 0)
  );
}

/**
 * Tamaño de una petición de texto con el contador del simulado (un token cada
 * cuatro caracteres), contando TODO lo que viaja: instrucciones, material,
 * encargo, herramientas y esquema de salida. `stable` es lo que no cambia entre
 * peticiones y va delante (instrucciones, herramientas, esquema y material
 * marcado como estable): lo que un proveedor puede leer de caché. Sirve para
 * comparar tamaños de prompt; no es el recuento de ningún proveedor.
 */
export function countPromptTokens(input: AiProviderRequest['input']): { total: number; stable: number; volatile: number } {
  const stable =
    tokens(input.instructions ?? '') +
    (input.tools ? tokens(JSON.stringify(input.tools)) : 0) +
    (input.outputSchema ? tokens(JSON.stringify(input.outputSchema.schema)) : 0) +
    (input.context ?? []).filter((part) => part.cacheable).reduce((sum, part) => sum + tokens(part.content), 0);
  const volatile =
    tokens(input.prompt) +
    (input.context ?? []).filter((part) => !part.cacheable).reduce((sum, part) => sum + tokens(part.content), 0);
  return { total: stable + volatile, stable, volatile };
}

function numberParam(request: Pick<AiProviderRequest, 'input'>, name: string, fallback: number): number {
  const value = request.input.params?.[name];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new AiProviderFailure('aborted', 'Petición cancelada'));
    });
  });
}

export function createSimulatedProvider(options: SimulatedProviderOptions = {}): SimulatedProvider {
  const calls: AiProviderRequest[] = [];

  return {
    id: SIMULATED_PROVIDER_ID,
    supportsTools: true,
    calls,

    estimateUsage(request): AiUsage {
      if (request.task === 'image') return { images: numberParam(request, 'count', 1) };
      return {
        input_tokens: inputTokens(request),
        output_tokens: numberParam(request, 'max_output_tokens', DEFAULT_MAX_OUTPUT_TOKENS),
      };
    },

    async generate(request): Promise<AiProviderResult> {
      calls.push(request);
      if (!SUPPORTED.includes(request.task)) {
        throw new AiProviderFailure('unsupported_task', `El proveedor simulado no sirve la tarea «${request.task}»`);
      }
      if (options.delayMs) await wait(options.delayMs, request.signal);
      const failure = options.failWith?.(request, calls.length);
      if (failure) throw failure;

      let output: AiProviderResult['output'];
      let usage: AiUsage;
      if (request.task === 'image') {
        const count = numberParam(request, 'count', 1);
        output = { simulated: true, assets: Array.from({ length: count }, (_, i) => ({ kind: 'image', index: i })) };
        usage = { images: count };
      } else {
        const limit = numberParam(request, 'max_output_tokens', DEFAULT_MAX_OUTPUT_TOKENS);
        const scripted = options.respond?.(request);
        if (scripted === undefined) {
          const text = `[simulado] ${request.input.prompt}`.slice(0, limit * 4);
          output = { simulated: true, text };
        } else if (typeof scripted === 'string') {
          output = { simulated: true, text: scripted };
        } else {
          output = {
            simulated: true,
            text: scripted.text,
            ...(scripted.finish_reason ? { finish_reason: scripted.finish_reason } : {}),
            ...(scripted.tool_calls ? { tool_calls: scripted.tool_calls } : {}),
          };
        }
        const text = String(output.text) + (output.tool_calls ? JSON.stringify(output.tool_calls) : '');
        usage = { input_tokens: inputTokens(request), output_tokens: tokens(text) };
      }

      return {
        output,
        usage: options.reportUsage ? options.reportUsage(usage, request) : usage,
        providerRequestId: `sim-${calls.length}`,
      };
    },
  };
}
