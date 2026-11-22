import { KeyRound } from 'lucide-react';
import { ActionNotice, LinkButton } from '@/components/ui';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useSocialConnectModes } from '@/features/platform/integrations/useFeature';
import { useSocialAccounts } from './api';
import { accountAttention } from './calendar';
import { connectedAccountsPath } from './links';
import { useBrandZone } from './useBrandZone';
import { formatDateIn } from './zone';

/**
 * Aviso de que el acceso a Instagram caduca pronto, no se ha podido renovar solo
 * o ya no vale. Lo ve quien ve la marca (también la agencia, que ve las marcas de
 * sus clientes) en el calendario y en el inicio de la marca. Solo con la
 * publicación activa en el entorno.
 */
export function AccountAttentionNotice() {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const zone = useBrandZone();
  const modes = useSocialConnectModes();
  const accounts = useSocialAccounts(brand.id, modes.publishing);
  if (!modes.publishing) return null;
  const canManage = can('manage');
  const items = (accounts.data ?? [])
    .map((a) => ({ account: a, attention: accountAttention(a, undefined, (iso) => formatDateIn(iso, zone)) }))
    .filter((x) => x.attention);
  if (items.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="account-attention">
      {items.map(({ account, attention }) => (
        <ActionNotice
          key={account.id}
          tone={attention!.tone === 'danger' ? 'danger' : 'warning'}
          icon={KeyRound}
          title={`@${account.username || account.external_id}: ${attention!.text}`}
          action={
            canManage ? (
              <LinkButton to={connectedAccountsPath(org.id, brand.id)} data-testid="account-attention-fix">
                Volver a conectar
              </LinkButton>
            ) : undefined
          }
          why={
            canManage
              ? undefined
              : 'Solo quien gestiona la marca puede volver a conectar la cuenta: avísale para que lo haga a tiempo.'
          }
          data-testid="account-attention-item"
        />
      ))}
    </div>
  );
}
