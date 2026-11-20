import { Building2, SearchX } from 'lucide-react';
import { Suspense, useEffect, useMemo } from 'react';
import { Link, Navigate, Outlet, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { useUser } from '@/features/auth/AuthProvider';
import { connectResultNotice } from '@/features/social/connectResult';
import { PENDING_INVITE_KEY } from '@/features/invitations/pending';
import { AppShell } from '@/layout/AppShell';
import { readLocal, writeLocal } from '@/lib/localStore';
import { useBrands, useMyBrandRoles, useMyOrganizations } from './api';
import { BrandContext, lastSelectionKey, makeBrandContext, OrgContext, useOrg, type LastSelection } from './context';

/** «/»: decide a dónde va cada usuario al entrar. */
export function RootRedirect() {
  const user = useUser();
  const orgs = useMyOrganizations(user.id);
  const pendingInvite = readLocal<string | null>(PENDING_INVITE_KEY, null);
  const [params] = useSearchParams();
  const social = params.get('social');

  // La conexión con Meta vuelve a «/» cuando no sabe la marca: sin esto, el fallo no se vería.
  useEffect(() => {
    const info = connectResultNotice(social);
    if (!info) return;
    if (info.ok) toast.success(info.text);
    else toast.error(info.text);
  }, [social]);

  if (pendingInvite) return <Navigate to={`/invitacion/${pendingInvite}`} replace />;
  if (orgs.isPending) return <Spinner className="min-h-dvh" />;
  if (orgs.isError) return <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />;
  if (orgs.data.length === 0) return <Navigate to="/bienvenida" replace />;

  const last = readLocal<LastSelection>(lastSelectionKey(user.id), {});
  const org = orgs.data.find((o) => o.id === last.orgId) ?? orgs.data[0]!;
  const brandId = last.brandByOrg?.[org.id];
  return <Navigate to={brandId ? `/o/${org.id}/m/${brandId}/inicio` : `/o/${org.id}`} replace />;
}

export function OrgLayout() {
  const user = useUser();
  const { orgId = '', brandId } = useParams();
  const orgs = useMyOrganizations(user.id);
  const brands = useBrands(orgId);
  const brandRoles = useMyBrandRoles(orgId, user.id);

  const org = orgs.data?.find((o) => o.id === orgId);

  useEffect(() => {
    if (!org) return;
    const key = lastSelectionKey(user.id);
    const last = readLocal<LastSelection>(key, {});
    const brandByOrg = { ...last.brandByOrg };
    if (brandId) brandByOrg[org.id] = brandId;
    writeLocal(key, { orgId: org.id, brandByOrg });
  }, [org, brandId, user.id]);

  const value = useMemo(
    () =>
      org
        ? {
            org,
            isAdmin: org.role === 'owner' || org.role === 'admin',
            brands: brands.data ?? [],
            brandRoles: brandRoles.data ?? new Map(),
          }
        : null,
    [org, brands.data, brandRoles.data],
  );

  if (orgs.isPending) return <Spinner className="min-h-dvh" />;
  if (orgs.isError) return <ErrorState error={orgs.error} onRetry={() => void orgs.refetch()} />;
  if (!org || !value) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <EmptyState
          icon={Building2}
          title="No tienes acceso a esta organización"
          description="Puede que el enlace sea antiguo o que ya no formes parte de ella."
          action={
            <Link to="/">
              <Button>Ir a mis organizaciones</Button>
            </Link>
          }
        />
      </main>
    );
  }

  const brand = value.brands.find((b) => b.id === brandId) ?? null;
  return (
    <OrgContext.Provider value={value}>
      <AppShell orgs={orgs.data} org={org} brands={value.brands} brand={brand}>
        {brands.isPending || brandRoles.isPending ? (
          <Spinner />
        ) : brands.isError ? (
          <ErrorState error={brands.error} onRetry={() => void brands.refetch()} />
        ) : (
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        )}
      </AppShell>
    </OrgContext.Provider>
  );
}

export function BrandLayout() {
  const { org, brands, brandRoles } = useOrg();
  const { brandId = '' } = useParams();
  const brand = brands.find((b) => b.id === brandId);
  const value = useMemo(
    () => (brand ? makeBrandContext(org, brand, brandRoles.get(brand.id)) : null),
    [org, brand, brandRoles],
  );

  if (!brand || !value) {
    return (
      <EmptyState
        icon={SearchX}
        title="No encontramos esta marca"
        description="Puede que no exista o que no tengas acceso a ella."
        action={
          <Link to={`/o/${org.id}`}>
            <Button>Ver mis marcas</Button>
          </Link>
        }
      />
    );
  }
  return (
    <BrandContext.Provider value={value}>
      <Outlet />
    </BrandContext.Provider>
  );
}
