import { AlertTriangle, AtSign, Link2, Unlink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, ErrorState, Skeleton } from '@/components/ui';
import { socialPublishingEnabled } from '@/config/app';
import { useBrand } from '@/features/orgs/context';
import type { SocialAccountRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatDate } from '@/lib/utils';
import { startSocialConnect, useDisconnectAccount, useSocialAccounts } from './api';
import { quotaWarning, tokenExpiresSoon } from './calendar';

/** Lo que significa cada `?social=` con el que vuelve la conexión. */
const CONNECT_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Cuenta de Instagram conectada' },
  denied: { ok: false, text: 'No se ha conectado: se canceló o no se concedieron los permisos en Meta.' },
  expired: { ok: false, text: 'La conexión caducó o ya se había usado. Vuelve a intentarlo.' },
  no_instagram: {
    ok: false,
    text: 'No hay ninguna cuenta profesional de Instagram unida a una página de Facebook en lo que se concedió.',
  },
  several_accounts: {
    ok: false,
    text: 'Se concedieron varias cuentas de Instagram. Vuelve a conectar y elige solo la de esta marca en el diálogo de Meta.',
  },
  forbidden: { ok: false, text: 'Solo quien gestiona la marca puede conectar sus redes.' },
  failed: { ok: false, text: 'No se pudo conectar la cuenta. Inténtalo de nuevo más tarde.' },
};

/**
 * Ajustes de la marca · Cuentas conectadas. Solo aparece si el entorno tiene la
 * publicación configurada (VITE_SOCIAL_PUBLISHING_ENABLED). Conectar y
 * desconectar es de quien gestiona la marca; los demás ven qué cuenta hay.
 */
export function ConnectedAccountsCard() {
  const { brand, can } = useBrand();
  const canManage = can('manage');
  const enabled = socialPublishingEnabled();
  const accounts = useSocialAccounts(brand.id);
  const disconnect = useDisconnectAccount(brand.id);
  const [connecting, setConnecting] = useState(false);
  const [confirming, setConfirming] = useState<SocialAccountRow | null>(null);
  const [params, setParams] = useSearchParams();

  // Vuelta de Meta: decir cómo fue y limpiar la dirección.
  useEffect(() => {
    const result = params.get('social');
    if (!result) return;
    const info = CONNECT_RESULT[result] ?? CONNECT_RESULT.failed!;
    if (info.ok) toast.success(info.text);
    else toast.error(info.text);
    const next = new URLSearchParams(params);
    next.delete('social');
    setParams(next, { replace: true });
  }, [params, setParams]);

  if (!enabled) return null;

  const instagram = accounts.data?.find((a) => a.network === 'instagram') ?? null;

  const connect = async () => {
    setConnecting(true);
    try {
      window.location.assign(await startSocialConnect(brand.id, 'instagram'));
    } catch (error) {
      toast.error(translateError(error));
      setConnecting(false);
    }
  };

  return (
    <Card data-testid="social-accounts">
      <CardHeader
        title="Cuentas conectadas"
        description="Las redes donde se publica lo que se programa en el calendario. Se conectan con el inicio de sesión oficial de Meta: nunca se guarda una contraseña y el acceso va cifrado."
      />
      <CardBody className="space-y-3">
        {accounts.isPending ? (
          <Skeleton className="h-14" />
        ) : accounts.isError ? (
          <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
        ) : instagram ? (
          <AccountRow account={instagram} canManage={canManage} onDisconnect={() => setConfirming(instagram)} />
        ) : (
          <p className="text-sm text-muted" data-testid="social-accounts-empty">
            No hay ninguna cuenta de Instagram conectada.
          </p>
        )}
        {canManage && (!instagram || instagram.status === 'needs_reauth') && (
          <Button onClick={() => void connect()} loading={connecting} data-testid="social-connect-instagram">
            <Link2 className="h-4 w-4" aria-hidden />
            {instagram ? 'Volver a conectar Instagram' : 'Conectar Instagram'}
          </Button>
        )}
        {canManage && !instagram && (
          <p className="text-xs text-muted">
            Hace falta una cuenta profesional de Instagram (de empresa o de creador) unida a una página de Facebook.
          </p>
        )}
      </CardBody>
      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="¿Desconectar la cuenta?"
        description="Lo programado para esta cuenta se detiene hasta que conectes una. Lo ya publicado no cambia."
        confirmLabel="Desconectar"
        loading={disconnect.isPending}
        onConfirm={() =>
          confirming &&
          disconnect.mutate(confirming.id, {
            onSuccess: () => {
              toast.success('Cuenta desconectada');
              setConfirming(null);
            },
            onError: (error) => toast.error(translateError(error)),
          })
        }
      />
    </Card>
  );
}

function AccountRow({
  account,
  canManage,
  onDisconnect,
}: {
  account: SocialAccountRow;
  canManage: boolean;
  onDisconnect: () => void;
}) {
  const quota = quotaWarning(account.quota_usage, account.quota_total);
  return (
    <div className="rounded-lg border border-border p-3" data-testid="social-account">
      <div className="flex flex-wrap items-center gap-3">
        <AtSign className="h-5 w-5 text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">@{account.username || account.external_id}</span>
          <span className="block text-xs text-muted">Conectada el {formatDate(account.connected_at)}</span>
        </span>
        {account.status === 'active' ? (
          <Badge tone="success">Conectada</Badge>
        ) : (
          <Badge tone="danger">Hay que volver a conectarla</Badge>
        )}
        {canManage && (
          <Button variant="ghost" size="sm" onClick={onDisconnect} data-testid="social-disconnect">
            <Unlink className="h-4 w-4" aria-hidden />
            Desconectar
          </Button>
        )}
      </div>
      {(account.status === 'needs_reauth' || tokenExpiresSoon(account.token_expires_at) || quota) && (
        <ul className="mt-2 space-y-1 text-xs text-warning">
          {account.status === 'needs_reauth' && (
            <Warning>
              El acceso ha caducado o se ha retirado{account.last_error ? `: ${account.last_error}` : ''}. Lo programado
              está detenido.
            </Warning>
          )}
          {account.status === 'active' && tokenExpiresSoon(account.token_expires_at) && (
            <Warning>
              El acceso caduca el {formatDate(account.token_expires_at!)}: vuelve a conectar la cuenta antes para
              renovarlo.
            </Warning>
          )}
          {quota && (
            <Warning>
              {quota === 'reached'
                ? `Límite de publicaciones de Instagram alcanzado (${account.quota_usage} de ${account.quota_total} en 24 h): lo programado espera.`
                : `Cerca del límite de publicaciones de Instagram: ${account.quota_usage} de ${account.quota_total} en 24 h.`}
            </Warning>
          )}
        </ul>
      )}
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-1.5">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
