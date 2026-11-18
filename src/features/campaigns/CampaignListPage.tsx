import { ChevronRight, Megaphone, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { aiTextEnabled } from '@/config/app';
import { useSources } from '@/features/brand/api';
import { networkLabel } from '@/features/content/labels';
import { useBrand, useOrg } from '@/features/orgs/context';
import { formatDateTime } from '@/lib/utils';
import { useCampaigns } from './api';
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE, campaignPaths, campaignsAvailable } from './labels';
import { NewCampaignDialog } from './NewCampaignDialog';
import { shortDay } from './plan';

/** Campañas de la marca: pedir un plan y ver en qué punto está cada uno. */
export function CampaignListPage() {
  const { org } = useOrg();
  const { brand } = useBrand();
  const available = campaignsAvailable(brand, aiTextEnabled());
  if (!available) return <Navigate to={`/o/${org.id}/m/${brand.id}/inicio`} replace />;
  return <CampaignList />;
}

function CampaignList() {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const mode = brand.ai_mode === 'agency' ? 'agency' : 'ai';
  // Con la IA hace falta poder crear contenido; a la agencia lo pide quien puede comentar (como un encargo).
  const canAsk = mode === 'ai' ? can('edit') : can('comment');
  const paths = campaignPaths(org.id, brand.id);
  const campaigns = useCampaigns(brand.id);
  const sources = useSources(brand.id);
  const textSources = (sources.data ?? []).filter((s) => s.kind === 'text' && s.storage_path !== null).length;
  const [creating, setCreating] = useState(false);
  const rows = campaigns.data ?? [];

  const newButton = canAsk && (
    <Button onClick={() => setCreating(true)} data-testid="campaign-new">
      <Plus className="h-4 w-4" aria-hidden />
      {mode === 'ai' ? 'Preparar un plan' : 'Pedir un plan'}
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Campañas"
        description={
          mode === 'ai'
            ? `Planes de publicaciones para ${brand.name}: la IA propone y explica; al aceptar, las piezas se crean como borradores.`
            : `Planes de publicaciones para ${brand.name}: la agencia los prepara; al aceptar, las piezas se crean como borradores.`
        }
        action={newButton}
      />

      {campaigns.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : campaigns.isError ? (
        <Card>
          <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title="Todavía no hay campañas"
            description={
              canAsk
                ? 'Pide un plan con tus palabras («prepara la semana que viene») y revísalo antes de crear nada.'
                : 'Cuando alguien pida un plan, aparecerá aquí.'
            }
            action={newButton}
          />
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface" data-testid="campaign-list">
          {rows.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={paths.item(campaign.id)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-subtle"
                data-testid="campaign-row"
              >
                <Megaphone className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{campaign.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {shortDay(campaign.starts_on)} – {shortDay(campaign.ends_on)} ·{' '}
                    {campaign.networks.map(networkLabel).join(', ')} · {formatDateTime(campaign.created_at)}
                  </span>
                </span>
                <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABEL[campaign.status]}</Badge>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canAsk && (
        <NewCampaignDialog
          orgId={org.id}
          brandId={brand.id}
          mode={mode}
          open={creating}
          onOpenChange={setCreating}
          textSourceCount={textSources}
        />
      )}
    </>
  );
}
