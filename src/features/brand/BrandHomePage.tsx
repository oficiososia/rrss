import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionNotice, Badge, LinkButton, Notice, PageHeader } from '@/components/ui';
import { useBrand, useOrg } from '@/features/orgs/context';
import { BRAND_ROLE_LABEL } from '@/features/permissions/roles';
import { useSocialConnectModes } from '@/features/platform/integrations/useFeature';
import { useSocialAccounts } from '@/features/social/api';
import { AccountAttentionNotice } from '@/features/social/AccountAttentionNotice';
import { connectedAccountsPath } from '@/features/social/links';
import { cn } from '@/lib/utils';
import { useActiveProfile } from './api';
import { profileCompleteness } from './completeness';
import { LatestPublished, StalledList, WeekStrip } from './home/sections';
import { useLatestPublished, useStalledPublications } from './home/useHomeData';
import { parseProfile } from './profile';

/**
 * Inicio de la marca: qué hacer hoy. Lo que sale esta semana, lo que está parado y lo último publicado.
 * Crear (publicación, reel, «como este», subir fotos) está en el botón «＋ Crear» del menú: aquí no se repite.
 */
export function BrandHomePage() {
  const { org } = useOrg();
  const { brand, role, can } = useBrand();
  const base = `/o/${org.id}/m/${brand.id}`;
  const canEdit = can('edit');
  const canManage = can('manage');
  const [now] = useState(() => new Date());

  const profile = useActiveProfile(brand.id);
  const completeness = profile.data !== undefined ? profileCompleteness(parseProfile(profile.data?.data)) : null;
  const stalled = useStalledPublications(brand.id);
  const published = useLatestPublished(brand.id, now);
  const modes = useSocialConnectModes();
  const accounts = useSocialAccounts(brand.id, modes.publishing);
  const notConnected = modes.publishing && accounts.isSuccess && accounts.data.length === 0;
  const stalledItems = stalled.data ?? [];

  return (
    <>
      <PageHeader
        title={brand.name}
        description={[brand.sector, `Tu rol: ${BRAND_ROLE_LABEL[role]}`].filter(Boolean).join(' · ')}
        className="!mb-4"
        action={
          brand.status !== 'active' && (
            <Badge tone={brand.status === 'archived' ? 'neutral' : 'warning'}>
              {brand.status === 'archived' ? 'Archivada' : 'En configuración'}
            </Badge>
          )
        }
      />

      <div className="mb-4 space-y-2 empty:hidden" data-testid="home-notices">
        {brand.status === 'archived' && (
          <Notice tone="warning">
            Esta marca está archivada. Sus datos se conservan; un gestor puede reactivarla desde «Marca».
          </Notice>
        )}
        <AccountAttentionNotice />
        {notConnected && (
          <ActionNotice
            tone="info"
            title="Instagram sin conectar: lo programado no saldrá solo"
            action={
              canManage ? (
                <LinkButton to={connectedAccountsPath(org.id, brand.id)} data-testid="home-connect">
                  Conectar Instagram
                </LinkButton>
              ) : undefined
            }
            why={canManage ? undefined : 'Solo quien gestiona la marca puede conectar la cuenta: avísale.'}
            data-testid="home-not-connected"
          />
        )}
      </div>

      <div className="space-y-5">
        <WeekStrip orgId={org.id} brandId={brand.id} now={now} />
        {(stalledItems.length > 0 || published.items.length > 0) && (
          <div className={cn('grid gap-5', stalledItems.length > 0 && published.items.length > 0 && 'lg:grid-cols-2')}>
            {stalledItems.length > 0 && (
              <StalledList orgId={org.id} brandId={brand.id} items={stalledItems} canFix={canEdit} />
            )}
            {published.items.length > 0 && <LatestPublished orgId={org.id} brandId={brand.id} items={published.items} />}
          </div>
        )}
        {completeness && completeness.percent < 100 && canManage && (
          <Link
            to={`${base}/marca`}
            className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 text-sm hover:bg-subtle"
            data-testid="home-profile"
          >
            <span className="font-semibold tabular-nums" data-testid="completeness-percent">
              {completeness.percent}%
            </span>
            <span className="flex-1">del perfil de marca. Completarlo mejora los textos de la IA.</span>
            <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
          </Link>
        )}
      </div>

    </>
  );
}
