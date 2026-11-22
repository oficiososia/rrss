import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  IntegrationAuditRow,
  IntegrationSettingRow,
  IntegrationTestRow,
  PlatformCostRow,
} from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { UI_INTEGRATIONS, type AiTextTask, type IntegrationId } from './catalog';

export { AI_TEXT_TASKS, type AiTextTask } from './catalog';

// Plataforma → Integraciones. Todo pasa por la función `platform-integrations`
// (supabase/functions/platform-integrations/handler.ts): el navegador manda los
// valores al guardar y nunca recibe un secreto de vuelta.

/** Qué está configurado y listo en el servidor (solo booleanos). */
export interface IntegrationAvailability {
  publishing: boolean;
  socialOAuth: boolean;
  socialToken: boolean;
  /** Alguna tarea de texto está lista. Cada botón mira la suya en `aiTextTasks`. */
  aiText: boolean;
  /**
   * Una por tarea de texto: `true` solo si esa tarea tiene proveedor, modelo y
   * precio. Un servidor anterior a esta versión no la manda (ver `useTextTask`).
   */
  aiTextTasks?: Record<AiTextTask, boolean>;
  aiImage: boolean;
  billing: boolean;
  /** Biblioteca con Google Drive (cliente OAuth y claves de cifrado). */
  drive: boolean;
  /** Archivos de la biblioteca en Cloudflare R2 (docs/almacenamiento-r2.md). */
  mediaStorage: boolean;
  /** Subtítulos automáticos de los reels con OpenAI (docs/editor-reels.md). */
  reelSubtitles: boolean;
}

export interface IntegrationStatus {
  settings: IntegrationSettingRow[];
  tests: IntegrationTestRow[];
  audit: IntegrationAuditRow[];
  /** Ajustes que vienen de variables de entorno de las funciones (sin valor). */
  environment: string[];
  availability: IntegrationAvailability;
}

export interface ProbeResult {
  ok: boolean;
  message: string;
  checks: Array<{ name: string; ok: boolean | null; message: string }>;
  /** Arreglo de un clic que ofrece la pantalla (hoy: usar el servidor general de OpenAI). */
  fix?: 'openai_global';
}

/** A qué integración pertenece cada ajuste (el servidor guarda de una integración por llamada). */
export const SETTING_INTEGRATION: Record<string, IntegrationId> = Object.fromEntries(
  UI_INTEGRATIONS.flatMap((i) => i.groups.flatMap((g) => g.fields.map((f) => [f.key, i.id] as const))),
);

export const integrationKeys = {
  availability: ['platform', 'integrations', 'availability'] as const,
  status: ['platform', 'integrations', 'status'] as const,
};

const FAILED = 'No se ha podido hablar con el servidor. Inténtalo de nuevo en un momento.';

export async function callIntegrations<T>(body: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.functions.invoke('platform-integrations', { body });
  } catch {
    throw new Error(FAILED);
  }
  if (result.error) {
    const context = (result.error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = (await context
        .clone()
        .json()
        .catch(() => null)) as { error?: { message?: unknown } } | null;
      const message = payload?.error?.message;
      if (typeof message === 'string' && message) throw new Error(message);
    }
    throw new Error(FAILED);
  }
  return result.data as T;
}

/**
 * Disponibilidad de las integraciones. Se pregunta una vez y se guarda unos
 * minutos; si el servidor no contesta, nada está disponible (lo que no
 * funciona no sale).
 */
export function useIntegrationAvailability(enabled = true) {
  return useQuery({
    queryKey: integrationKeys.availability,
    queryFn: () => callIntegrations<IntegrationAvailability>({ action: 'availability' }),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function useIntegrationStatus() {
  return useQuery({
    queryKey: integrationKeys.status,
    queryFn: () => callIntegrations<IntegrationStatus>({ action: 'status' }),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: integrationKeys.status });
    void qc.invalidateQueries({ queryKey: integrationKeys.availability });
  };
}

/** Guarda o borra (`null`) ajustes de una integración. */
export function useSaveIntegration() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { integration: IntegrationId; values: Record<string, string | null> }) =>
      callIntegrations<{ saved: string[] }>({ action: 'save', ...input }),
    onSuccess: invalidate,
  });
}

/**
 * «Probar conexión». `service` es la tarjeta que prueba cuando varias comparten
 * integración (OpenAI y Claude; fal.ai y las demás de imagen): el servidor
 * prueba, devuelve y anota solo lo de esa tarjeta.
 */
export function useTestIntegration() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { integration: IntegrationId; service?: string }) =>
      callIntegrations<ProbeResult>({
        action: 'test',
        integration: input.integration,
        ...(input.service ? { service: input.service } : {}),
      }),
    onSettled: invalidate,
  });
}

/**
 * Genera el token del trabajador para `worker-gateway` (sustituye al anterior,
 * que deja de valer). El token solo viaja en esta respuesta: no se guarda.
 */
export function useGenerateWorkerToken() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => callIntegrations<{ token: string }>({ action: 'generate_worker_token' }),
    onSuccess: invalidate,
  });
}

export function useGenerateTokenKey() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => callIntegrations<{ keyId: string }>({ action: 'generate_token_key' }),
    onSuccess: invalidate,
  });
}

// ───────────────────── IA sencilla: precios al día y configuración recomendada ─────────────────────

export type AiProviderId = 'openai' | 'claude';
export type PriceStatus = 'same' | 'different' | 'none' | 'no_source';

/** Precio en micros por unidad (1 micro por token = 1 dólar por millón de tokens). */
export interface MicroPrice {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_write_input_tokens?: number;
  audio_seconds?: number;
}

export interface AiTaskView {
  id: string;
  label: string;
  kind: 'text' | 'image' | 'transcription';
  unit: string;
  recommended: null | {
    model: string;
    why: string;
    measured: string;
    centsPerUse: number | null;
    skipped: string[];
    unchecked: boolean;
  };
  none?: string;
  current: string | null;
}

export interface AiPriceRow {
  provider: AiProviderId;
  model: string;
  usedFor: string[];
  source: {
    mode: 'chat' | 'transcription' | 'image';
    inputPerM?: number;
    outputPerM?: number;
    perSecond?: number;
  } | null;
  expected: MicroPrice | null;
  loaded: MicroPrice | null;
  status: PriceStatus;
  surcharge: number;
}

export interface AiOverview {
  source: {
    name: string;
    url: string;
    officialUrl: Record<AiProviderId, string>;
    fetchedAt: string | null;
    stale: boolean;
    problem: string | null;
  };
  region: 'eu' | 'global' | 'unset';
  openaiModels: { known: boolean; problem: string | null };
  providers: Record<
    AiProviderId,
    {
      tasks: AiTaskView[];
      prices: AiPriceRow[];
      monthly: { usd: number | null; notCounted: string[] };
      differing: number;
    }
  >;
}

/** Lo que devuelven las acciones que cambian ajustes: lo anterior (para deshacer) y avisos. */
export interface AppliedChange {
  previous: Record<string, string | null>;
  applied: Array<{ key: string; from: string | null; to: string | null }>;
  notes: string[];
  activatedImageModels?: string[];
}

export const aiKeys = {
  overview: ['platform', 'integrations', 'ai-overview'] as const,
  cost: (period: string) => ['platform', 'integrations', 'cost-per-operation', period] as const,
};

/** Precios al día y sugerencias. Lo lee el servidor (con caché de 12 h); si la fuente falla, usa lo último guardado. */
export function useAiOverview(enabled = true) {
  return useQuery({
    queryKey: aiKeys.overview,
    queryFn: () => callIntegrations<AiOverview>({ action: 'ai_overview' }),
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}

/** «Actualizar»: vuelve a leer la fuente de precios (como mucho cada 10 minutos). */
export function useRefreshAiOverview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => callIntegrations<AiOverview>({ action: 'ai_overview', refresh: true }),
    onSuccess: (data) => qc.setQueryData(aiKeys.overview, data),
  });
}

/** Aplica los valores por defecto, la configuración recomendada o solo los precios. */
export function useAiApply() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider: AiProviderId; scope: 'defaults' | 'all' | 'prices' }) =>
      callIntegrations<AppliedChange>({ action: 'ai_apply', ...input }),
    onSettled: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: aiKeys.overview });
    },
  });
}

/** Pasa OpenAI al servidor europeo o al general (los datos se tratan fuera de la UE). */
export function useOpenAiRegion() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (region: 'eu' | 'global') => callIntegrations<AppliedChange>({ action: 'openai_region', region }),
    onSettled: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: aiKeys.overview });
    },
  });
}

/** Deshace un cambio: vuelve a guardar (o borra, si no había) lo que había antes. */
export function useRestoreSettings() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (previous: Record<string, string | null>) => {
      const byIntegration = new Map<IntegrationId, Record<string, string | null>>();
      for (const [key, value] of Object.entries(previous)) {
        const integration = SETTING_INTEGRATION[key];
        if (!integration) continue;
        byIntegration.set(integration, { ...(byIntegration.get(integration) ?? {}), [key]: value });
      }
      for (const [integration, values] of byIntegration) {
        await callIntegrations<{ saved: string[] }>({ action: 'save', integration, values });
      }
    },
    onSettled: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: aiKeys.overview });
    },
  });
}

/** Coste liquidado del mes por tipo de operación (de `ai_generations`), solo superadministradores. */
export function useCostPerOperation(periodStart: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.cost(periodStart),
    enabled,
    queryFn: async (): Promise<PlatformCostRow[]> =>
      unwrap(await supabase.rpc('platform_cost_per_operation', { p_period_start: periodStart })),
  });
}
