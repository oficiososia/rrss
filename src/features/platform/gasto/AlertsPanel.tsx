import { BellRing, Check, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Spinner } from '@/components/ui';
import { formatMicros } from '@/features/ai/money';
import { useInternalUse } from '@/features/orgs/workMode';
import type { PlatformAlertRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatDate } from '@/lib/utils';
import { usePlatformAlerts, useRefreshAlerts, useResolveAlert } from './api';

function figures(alert: PlatformAlertRow): string | null {
  const d = alert.data as Record<string, unknown>;
  if (
    alert.kind.startsWith('ai_quota') &&
    typeof d.committed_micros === 'number' &&
    typeof d.limit_micros === 'number'
  ) {
    return `${formatMicros(d.committed_micros)} de ${formatMicros(d.limit_micros)}`;
  }
  if (
    alert.kind.startsWith('ai_global') &&
    typeof d.committed_micros === 'number' &&
    typeof d.cap_micros === 'number'
  ) {
    return `${formatMicros(d.committed_micros)} de ${formatMicros(d.cap_micros)}`;
  }
  return null;
}

/** Plataforma → avisos abiertos: cupos, tope global, trabajos de medios y tareas programadas. */
export function AlertsPanel() {
  const alerts = usePlatformAlerts();
  const internal = useInternalUse();
  const refresh = useRefreshAlerts();
  const resolve = useResolveAlert();
  const fail = (e: unknown) => toast.error(translateError(e));
  const rows = alerts.data ?? [];

  return (
    <Card data-testid="platform-alerts">
      <CardHeader
        title="Avisos"
        description={
          internal
            ? 'Gasto de IA cerca del tope, trabajos de medios que fallan y tareas programadas con errores. Se revisan cada 10 minutos.'
            : 'Cupos de IA al 80 % y al 100 %, tope global, trabajos de medios que fallan y tareas programadas con errores. Se revisan cada 10 minutos.'
        }
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={refresh.isPending}
              onClick={() =>
                refresh.mutate(undefined, {
                  onSuccess: (n) =>
                    toast.success(n > 0 ? `${n} aviso${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}` : 'Nada nuevo'),
                  onError: fail,
                })
              }
              data-testid="alerts-refresh"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Revisar ahora
            </Button>
            {rows.length > 1 && (
              <Button
                size="sm"
                variant="secondary"
                loading={resolve.isPending}
                onClick={() => resolve.mutate(null, { onError: fail })}
                data-testid="alerts-resolve-all"
              >
                Marcar todos como vistos
              </Button>
            )}
          </div>
        }
      />
      <CardBody>
        {alerts.isPending ? (
          <Spinner />
        ) : alerts.isError ? (
          <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
        ) : rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted" data-testid="alerts-empty">
            <Check className="h-4 w-4 text-success" aria-hidden />
            Sin avisos abiertos.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="alerts-list">
            {rows.map((alert) => {
              const numbers = figures(alert);
              const strong = alert.kind === 'ai_quota_100' || alert.kind === 'ai_global_cap_reached';
              return (
                <li key={alert.id} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                  <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {alert.title}
                      <Badge tone={strong ? 'danger' : 'warning'}>{strong ? 'Urgente' : 'Aviso'}</Badge>
                    </p>
                    <p className="mt-1 text-muted">{alert.detail}</p>
                    {numbers && <p className="mt-1 tabular-nums">{numbers}</p>}
                    <p className="mt-1 text-xs text-muted">{formatDate(alert.created_at)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => resolve.mutate(alert.id, { onError: fail })}
                    data-testid={`alert-resolve-${alert.id}`}
                  >
                    Visto
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
