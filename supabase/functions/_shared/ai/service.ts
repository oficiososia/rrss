// Servicio de IA: el único punto de entrada para generar.
//
//   pedir → elegir modelo → RESERVAR cupo → llamar al proveedor → registrar
//
// El orden es la garantía: no se llama a ningún proveedor sin cupo reservado, y
// lo reservado se convierte en coste real (si salió bien) o se devuelve entero
// (si falló). El cupo lo impone la base de datos (`ai_reserve_generation`), no
// este código.
import {
  AiError,
  AiProviderFailure,
  type AiGenerateParams,
  type AiGenerateResult,
  type AiModelSpec,
  type AiProvider,
  type AiProviderResult,
  type AiService,
  type AiUsage,
  type Json,
  type RpcClient,
} from './contract.ts';

export interface AiServiceConfig {
  /** Funciones SQL con la clave de servicio. */
  rpc: RpcClient;
  /** Adaptadores disponibles. */
  providers: AiProvider[];
  /**
   * Modelos configurados, por orden de preferencia: para cada tarea se usa el
   * primero que la sirva.
   */
  models: AiModelSpec[];
  /** Tiempo máximo de la llamada al proveedor. Por defecto, 60 segundos. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** Margen entre el tiempo máximo de la llamada y la caducidad de su reserva. */
const RESERVATION_MARGIN_SECONDS = 60;

/** Coste de un consumo según el precio del modelo, y las unidades sin precio. */
export function priceUsage(spec: AiModelSpec, usage: AiUsage): { micros: number; unpriced: string[] } {
  let total = 0;
  const unpriced: string[] = [];
  for (const [unit, amount] of Object.entries(usage)) {
    if (!Number.isFinite(amount) || amount < 0) {
      unpriced.push(unit);
      continue;
    }
    if (amount === 0) continue;
    const rate = spec.microsPerUnit[unit];
    if (rate === undefined || !Number.isFinite(rate) || rate < 0) unpriced.push(unit);
    else total += amount * rate;
  }
  // Siempre hacia arriba: una fracción de millonésima no se regala.
  return { micros: Math.ceil(total), unpriced };
}

function parseDetails(details: string | null | undefined): Json | undefined {
  if (!details) return undefined;
  try {
    return JSON.parse(details) as Json;
  } catch {
    return undefined;
  }
}

function idOf(row: unknown): string | null {
  if (typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string') return row.id;
  return null;
}

export function createAiService(config: AiServiceConfig): AiService {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const providers = new Map(config.providers.map((provider) => [provider.id, provider]));

  /** Llama a una función SQL; un fallo de red se trata igual que un error devuelto. */
  async function rpc(fn: string, args: Record<string, unknown>): Promise<Awaited<ReturnType<RpcClient>>> {
    try {
      return await config.rpc(fn, args);
    } catch {
      return { data: null, error: { message: 'Sin conexión con la base de datos' } };
    }
  }

  async function generate(params: AiGenerateParams): Promise<AiGenerateResult> {
    const spec = config.models.find((model) => model.task === params.task);
    const provider = spec ? providers.get(spec.provider) : undefined;
    if (!spec || !provider) {
      throw new AiError('not_configured', 'No hay ningún modelo de IA configurado para esta tarea.');
    }

    const request = { task: params.task, model: spec.model, input: params.input };
    const estimate = priceUsage(spec, provider.estimateUsage(request));
    if (estimate.unpriced.length > 0) {
      // Sin precio no se puede reservar ni cobrar: mejor no generar.
      throw new AiError('not_configured', 'El modelo de IA configurado para esta tarea no tiene precio completo.', {
        details: { model: spec.model, unpriced: estimate.unpriced },
      });
    }
    const reserveMicros = Math.max(1, estimate.micros);

    // 1. Reservar cupo. Si no hay, aquí se acaba: no se llama a nadie.
    const reservation = await rpc('ai_reserve_generation', {
      p_user_id: params.userId,
      p_brand_id: params.brandId,
      p_task: params.task,
      p_purpose: params.purpose,
      p_provider: provider.id,
      p_model: spec.model,
      p_reserve_micros: reserveMicros,
      p_ttl_seconds: Math.ceil(timeoutMs / 1000) + RESERVATION_MARGIN_SECONDS,
    });
    if (reservation.error) {
      const { code, message, details } = reservation.error;
      if (code === 'AI001') throw new AiError('quota_exhausted', message, { details: parseDetails(details) });
      if (code === 'AI002') throw new AiError('quota_missing', message);
      if (code === '42501') throw new AiError('forbidden', message);
      throw new AiError('internal', 'No se ha podido reservar el cupo de IA. Inténtalo de nuevo.', {
        retryable: true,
      });
    }
    const generationId = idOf(reservation.data);
    if (!generationId) {
      throw new AiError('internal', 'No se ha podido reservar el cupo de IA. Inténtalo de nuevo.');
    }

    // 2. Llamar al proveedor, con tiempo máximo.
    const started = Date.now();
    const controller = new AbortController();
    let result: AiProviderResult;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AiProviderFailure('timeout', 'El proveedor no respondió a tiempo', { retryable: true }));
        }, timeoutMs);
      });
      const call = provider.generate({ ...request, signal: controller.signal });
      // Si gana el tiempo máximo, el fallo tardío del proveedor ya no interesa.
      call.catch(() => undefined);
      result = await Promise.race([call, timeout]);
    } catch (error) {
      // 3a. Falló: se devuelve la reserva. Solo se guarda el mensaje de los
      // fallos que el adaptador lanza a propósito; de los demás, nada que
      // pueda llevar un secreto. Si ni siquiera esto se puede anotar, la
      // reserva caduca sola.
      const known = error instanceof AiProviderFailure ? error : null;
      await rpc('ai_fail_generation', {
        p_generation_id: generationId,
        p_error_code: known?.code ?? 'unexpected',
        p_error_message: known?.message ?? 'Error inesperado del adaptador',
        p_latency_ms: Date.now() - started,
      });

      if (known?.code === 'timeout') {
        throw new AiError('provider_timeout', 'La IA ha tardado demasiado en responder. No se ha consumido cupo.', {
          generationId,
          retryable: true,
        });
      }
      throw new AiError('provider_failed', 'La IA no ha podido completar la petición. No se ha consumido cupo.', {
        generationId,
        retryable: known?.retryable ?? false,
      });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - started;

    // 3b. Salió bien: la reserva se cambia por el coste real. Si el proveedor
    // informa de una unidad sin precio, se cobra al menos lo reservado.
    const actual = priceUsage(spec, result.usage);
    const costMicros = actual.unpriced.length > 0 ? Math.max(actual.micros, reserveMicros) : actual.micros;

    const completion = await rpc('ai_complete_generation', {
      p_generation_id: generationId,
      p_cost_micros: costMicros,
      p_usage: result.usage,
      p_output: result.output,
      p_latency_ms: latencyMs,
      p_provider_request_id: result.providerRequestId,
    });
    if (completion.error) {
      // El gasto ya está hecho pero no se ha podido anotar. No se entrega el
      // resultado sin registrar su coste; la reserva sigue contando hasta caducar.
      throw new AiError('internal', 'No se ha podido registrar el resultado de la IA. Inténtalo de nuevo.', {
        generationId,
        retryable: true,
      });
    }

    return {
      generationId,
      output: result.output,
      usage: result.usage,
      costMicros,
      provider: provider.id,
      model: spec.model,
      latencyMs,
    };
  }

  return { generate };
}
