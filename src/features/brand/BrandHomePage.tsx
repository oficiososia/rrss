import { ArrowRight, BookOpen, CheckCircle2, Images, Palette, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, CardBody, CardHeader, ErrorState, Notice, PageHeader, Skeleton } from '@/components/ui';
import { ActivityList } from '@/features/audit/ActivityList';
import { useAssetCount } from '@/features/library/api';
import { useAuditLogs } from '@/features/orgs/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { BRAND_ROLE_LABEL } from '@/features/permissions/roles';
import { useActiveProfile, useSources } from './api';
import { profileCompleteness } from './completeness';
import { parseProfile } from './profile';

function Stat({
  label,
  value,
  to,
  icon: Icon,
}: {
  label: string;
  value: number | undefined;
  to: string;
  icon: typeof Images;
}) {
  return (
    <Link to={to} className="group block rounded-xl">
      <Card className="flex items-center gap-4 p-5 transition-shadow group-hover:shadow-pop">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-2xl font-semibold tabular-nums">
            {value === undefined ? <Skeleton className="h-7 w-10" /> : value}
          </span>
          <span className="block text-sm text-muted">{label}</span>
        </span>
        <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Card>
    </Link>
  );
}

export function BrandHomePage() {
  const { org, isAdmin } = useOrg();
  const { brand, role, can } = useBrand();
  const base = `/o/${org.id}/m/${brand.id}`;
  const profile = useActiveProfile(brand.id);
  const assetCount = useAssetCount(brand.id);
  const sources = useSources(brand.id);
  const activity = useAuditLogs(org.id, { brandId: brand.id, pageSize: 8, enabled: isAdmin });

  const completeness = profile.data !== undefined ? profileCompleteness(parseProfile(profile.data?.data)) : null;
  const canManage = can('manage');

  return (
    <>
      <PageHeader
        title={brand.name}
        description={[brand.sector, `Tu rol: ${BRAND_ROLE_LABEL[role]}`].filter(Boolean).join(' · ')}
        action={
          brand.status !== 'active' && (
            <Badge tone={brand.status === 'archived' ? 'neutral' : 'warning'}>
              {brand.status === 'archived' ? 'Archivada' : 'En configuración'}
            </Badge>
          )
        }
      />

      {brand.status === 'archived' && (
        <div className="mb-6">
          <Notice tone="warning">
            Esta marca está archivada. Sus datos se conservan; un gestor puede reactivarla desde «Marca».
          </Notice>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Archivos en la biblioteca" value={assetCount.data} to={`${base}/biblioteca`} icon={Images} />
        <Stat
          label="Fuentes de conocimiento"
          value={sources.data?.length}
          to={`${base}/marca?seccion=fuentes`}
          icon={BookOpen}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Perfil de marca"
            description="Cuanto más completo, mejor entenderá la IA cómo es la marca."
            action={
              completeness && (
                <span className="text-2xl font-semibold tabular-nums" data-testid="completeness-percent">
                  {completeness.percent}%
                </span>
              )
            }
          />
          <CardBody>
            {profile.isPending ? (
              <Skeleton className="h-32" />
            ) : profile.isError ? (
              <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
            ) : completeness ? (
              <>
                <div
                  className="h-2 overflow-hidden rounded-full bg-subtle"
                  role="progressbar"
                  aria-valuenow={completeness.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Perfil completado"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${completeness.percent}%` }}
                  />
                </div>
                {completeness.missing.length === 0 ? (
                  <p className="mt-4 flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    El perfil está completo.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 mt-4 text-sm font-medium">Siguientes pasos</p>
                    <ul className="space-y-1">
                      {completeness.missing.slice(0, 5).map((check) =>
                        canManage ? (
                          <li key={check.key}>
                            <Link
                              to={`${base}/marca?seccion=${check.section}`}
                              className="flex min-h-[2.5rem] items-center justify-between gap-3 rounded-lg px-2.5 text-sm hover:bg-subtle"
                            >
                              {check.label}
                              <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                            </Link>
                          </li>
                        ) : (
                          <li key={check.key} className="px-2.5 py-2 text-sm text-muted">
                            {check.label}
                          </li>
                        ),
                      )}
                    </ul>
                  </>
                )}
              </>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Accesos rápidos" />
          <CardBody className="grid gap-2">
            {[
              {
                to: `${base}/biblioteca`,
                label: can('edit') ? 'Subir fotos y vídeos' : 'Ver la biblioteca',
                icon: Images,
              },
              {
                to: `${base}/marca`,
                label: canManage ? 'Editar el perfil de marca' : 'Ver el perfil de marca',
                icon: Palette,
              },
              { to: `${base}/equipo`, label: canManage ? 'Gestionar el equipo' : 'Ver el equipo', icon: Users },
            ].map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex min-h-[2.75rem] items-center gap-3 rounded-lg border border-border px-3 text-sm font-medium hover:bg-subtle"
              >
                <Icon className="h-4 w-4 text-muted" aria-hidden />
                <span className="flex-1">{label}</span>
                <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      {isAdmin && (
        <Card className="mt-6">
          <CardHeader title="Actividad reciente" description="Últimos cambios en esta marca." />
          <ActivityList
            page={activity.data}
            isPending={activity.isPending}
            error={activity.error}
            onRetry={() => void activity.refetch()}
          />
        </Card>
      )}
    </>
  );
}
