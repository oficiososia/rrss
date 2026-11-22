import { useQuery } from '@tanstack/react-query';
import { Card, CardBody, CardHeader, ErrorState, Skeleton } from '@/components/ui';
import { formatSeconds } from '@/features/platform/gasto/usage';
import type { PlatformUsageRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { formatBytes } from '@/lib/utils';
import { formatMicros } from './money';

/** Gasto real del mes de UNA organización (`org_usage_overview`: su propietario, en autogestión). */
export function useOrgUsage(orgId: string, periodStart: string, enabled = true) {
  return useQuery({
    queryKey: ['org', orgId, 'usage-overview', periodStart],
    enabled,
    queryFn: async (): Promise<PlatformUsageRow | null> =>
      unwrap(await supabase.rpc('org_usage_overview', { p_organization_id: orgId, p_period_start: periodStart }))[0] ??
      null,
  });
}

function Row({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm font-medium tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * «Gasto del mes» para el propietario de una organización que lo lleva todo por su cuenta: lo que ha costado
 * de verdad cada tipo de IA, los trabajos de reels y fotos, y lo que ocupa. Es el mismo detalle que ve la
 * plataforma de cada organización, solo que de la suya.
 */
export function OrgSpendCard({ orgId, periodStart }: { orgId: string; periodStart: string }) {
  const usage = useOrgUsage(orgId, periodStart);
  return (
    <Card data-testid="org-spend">
      <CardHeader
        title="Gasto del mes"
        description="Lo que ha costado de verdad cada tipo de IA este mes, y lo que han trabajado y ocupado los medios."
      />
      <CardBody>
        {usage.isPending ? (
          <Skeleton className="h-20" />
        ) : usage.isError ? (
          <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
        ) : usage.data === null ? (
          <p className="text-sm text-muted">Todavía no hay datos de este mes.</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-4">
            <Row label="Gasto de IA" value={formatMicros(usage.data.ai_cost_micros)} testId="spend-total" />
            <Row label="Textos" value={formatMicros(usage.data.cost_text_micros)} testId="spend-text" />
            <Row label="Imágenes" value={formatMicros(usage.data.cost_image_micros)} testId="spend-image" />
            <Row label="Vídeo" value={formatMicros(usage.data.cost_video_micros)} testId="spend-video" />
            <Row
              label="Transcripción"
              value={formatMicros(usage.data.cost_transcription_micros)}
              testId="spend-transcription"
            />
            <Row
              label="Reels y fotos (trabajos)"
              value={`${usage.data.media_jobs_succeeded} hechos, ${usage.data.media_jobs_failed} fallidos`}
              testId="spend-jobs"
            />
            <Row
              label="Tiempo de proceso"
              value={formatSeconds(usage.data.media_machine_seconds)}
              testId="spend-machine"
            />
            <Row label="Almacenamiento" value={formatBytes(Number(usage.data.storage_bytes))} testId="spend-storage" />
          </dl>
        )}
      </CardBody>
    </Card>
  );
}
