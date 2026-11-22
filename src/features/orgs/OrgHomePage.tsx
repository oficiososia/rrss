import { Archive, ArrowRight, Palette, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { socialPublishingEnabled } from '@/config/app';
import { BRAND_ROLE_LABEL } from '@/features/permissions/roles';
import { useOrgAccountHealth } from '@/features/social/api';
import { accountAttention } from '@/features/social/calendar';
import type { BrandRow, BrandStatus } from '@/lib/database.types';
import { formatDate } from '@/lib/utils';
import { useOrg } from './context';

const STATUS: Record<BrandStatus, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  active: { label: 'Activa', tone: 'success' },
  onboarding: { label: 'En configuración', tone: 'warning' },
  archived: { label: 'Archivada', tone: 'neutral' },
};

function BrandCard({
  brand,
  orgId,
  roleLabel,
  accessWarning,
}: {
  brand: BrandRow;
  orgId: string;
  roleLabel: string;
  /** Hay que hacer algo con el acceso a Instagram de esta marca. */
  accessWarning?: 'warning' | 'danger' | null;
}) {
  const status = STATUS[brand.status];
  return (
    <Link
      to={`/o/${orgId}/m/${brand.id}/inicio`}
      className="group block rounded-xl"
      data-testid={`brand-card-${brand.id}`}
    >
      <Card className="h-full p-5 transition-shadow group-hover:shadow-pop">
        <div className="flex items-start justify-between gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-sm font-semibold text-primary">
            {brand.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="flex flex-wrap justify-end gap-1.5">
            {accessWarning && (
              <span data-testid={`brand-access-warning-${brand.id}`}>
                <Badge tone={accessWarning === 'danger' ? 'danger' : 'warning'}>
                  {accessWarning === 'danger' ? 'Instagram: reconectar' : 'Instagram caduca pronto'}
                </Badge>
              </span>
            )}
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
        </div>
        <h2 className="mt-4 truncate text-base">{brand.name}</h2>
        <p className="truncate text-sm text-muted">{brand.sector || 'Sin sector indicado'}</p>
        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>
            {roleLabel} · desde {formatDate(brand.created_at)}
          </span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
      </Card>
    </Link>
  );
}

export function OrgHomePage() {
  const { org, brands, isAdmin, brandRoles } = useOrg();
  const [showArchived, setShowArchived] = useState(false);
  const archived = brands.filter((b) => b.status === 'archived');
  const visible = showArchived ? brands : brands.filter((b) => b.status !== 'archived');
  const health = useOrgAccountHealth(org.id, socialPublishingEnabled());
  const warningOf = (brandId: string): 'warning' | 'danger' | null => {
    let worst: 'warning' | 'danger' | null = null;
    for (const a of health.data ?? []) {
      if (a.brand_id !== brandId) continue;
      const attention = accountAttention(a);
      if (attention?.tone === 'danger') return 'danger';
      if (attention) worst = 'warning';
    }
    return worst;
  };
  const roleLabel = (brand: BrandRow) => BRAND_ROLE_LABEL[isAdmin ? 'manager' : (brandRoles.get(brand.id) ?? 'viewer')];

  return (
    <>
      <PageHeader
        title="Marcas"
        description={org.kind === 'agency' ? `Las marcas que gestiona ${org.name}.` : `Las marcas de ${org.name}.`}
        action={
          isAdmin && (
            <Link to={`/o/${org.id}/marcas/nueva`}>
              <Button data-testid="new-brand">
                <Plus className="h-4 w-4" aria-hidden />
                Nueva marca
              </Button>
            </Link>
          )
        }
      />
      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Palette}
            title={isAdmin ? 'Da de alta tu primera marca' : 'Todavía no tienes acceso a ninguna marca'}
            description={
              isAdmin
                ? 'Un asistente te pedirá lo esencial: quiénes sois, a quién os dirigís y cómo os comunicáis.'
                : 'Pide a un administrador de la organización que te añada a una marca.'
            }
            action={
              isAdmin && (
                <Link to={`/o/${org.id}/marcas/nueva`}>
                  <Button data-testid="new-brand-empty">
                    <Plus className="h-4 w-4" aria-hidden />
                    Nueva marca
                  </Button>
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((brand) => (
            <BrandCard
              key={brand.id}
              brand={brand}
              orgId={org.id}
              roleLabel={roleLabel(brand)}
              accessWarning={warningOf(brand.id)}
            />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <Button variant="ghost" size="sm" className="mt-6" onClick={() => setShowArchived((v) => !v)}>
          <Archive className="h-4 w-4" aria-hidden />
          {showArchived ? 'Ocultar archivadas' : `Ver archivadas (${archived.length})`}
        </Button>
      )}
    </>
  );
}
