import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PlatformAiGlobalStatus,
  PlatformAlertRow,
  PlatformPriceRow,
  PlatformStorageRow,
  PlatformUsageRow,
} from '@/lib/database.types';
import { callIntegrations } from '@/features/platform/integrations/api';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export const usageKeys = {
  overview: (period: string) => ['platform', 'usage-overview', period] as const,
  storage: ['platform', 'usage-storage'] as const,
  global: ['platform', 'ai-global'] as const,
  alerts: ['platform', 'alerts'] as const,
};

/** Gasto y uso del mes por organización (solo superadministradores). */
export function usePlatformUsage(periodStart: string, enabled = true) {
  return useQuery({
    queryKey: usageKeys.overview(periodStart),
    enabled,
    queryFn: async (): Promise<PlatformUsageRow[]> =>
      unwrap(await supabase.rpc('platform_usage_overview', { p_period_start: periodStart })),
  });
}

export function usePlatformStorage(enabled = true) {
  return useQuery({
    queryKey: usageKeys.storage,
    enabled,
    queryFn: async (): Promise<PlatformStorageRow[]> => unwrap(await supabase.rpc('platform_storage_by_brand')),
  });
}

/** Estado del tope global de gasto de IA. */
export function useAiGlobalStatus(enabled = true) {
  return useQuery({
    queryKey: usageKeys.global,
    enabled,
    queryFn: async (): Promise<PlatformAiGlobalStatus> => unwrap(await supabase.rpc('platform_ai_global_status')),
  });
}

/** Avisos abiertos de la plataforma, los más recientes primero. */
export function usePlatformAlerts(enabled = true) {
  return useQuery({
    queryKey: usageKeys.alerts,
    enabled,
    queryFn: async (): Promise<PlatformAlertRow[]> =>
      unwrap(
        await supabase
          .from('platform_alerts')
          .select('*')
          .is('resolved_at', null)
          .order('created_at', { ascending: false })
          .limit(100),
      ),
  });
}

/** Vuelve a mirar el estado (cupos, trabajos, tareas programadas) y crea los avisos que falten. */
export function useRefreshAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => unwrap(await supabase.rpc('platform_alerts_refresh')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usageKeys.alerts }),
  });
}

/** Marca como visto un aviso (o todos, sin id). */
export function useResolveAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string | null): Promise<number> =>
      unwrap(await supabase.rpc('platform_alert_resolve', { p_id: id })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usageKeys.alerts }),
  });
}

/** Precios de los modelos usados en el mes y si son de fiar. */
export function usePriceReview(periodStart: string, enabled = true) {
  return useQuery({
    queryKey: ['platform', 'price-review', periodStart] as const,
    enabled,
    queryFn: async (): Promise<PlatformPriceRow[]> =>
      unwrap(await supabase.rpc('platform_price_review', { p_period_start: periodStart })),
  });
}

export interface WorkerCheck {
  known: boolean;
  problem?: string;
  state?: string;
  startedAt?: string | null;
  hours?: number | null;
  tooLong?: boolean;
}

/** Pregunta a Fly si la máquina del trabajador lleva demasiado tiempo encendida (y, si sí, deja un aviso). */
export function useWorkerCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<WorkerCheck> => callIntegrations<WorkerCheck>({ action: 'worker_check' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usageKeys.alerts }),
  });
}
