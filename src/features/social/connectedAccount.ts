import type { SocialAccountRow } from '@/lib/database.types';
import { useSocialAccounts } from './api';

// ¿Tiene la marca una cuenta conectada en la que publicar? Se pregunta ANTES de
// aprobar, programar o publicar, para no dejar nada a medias (fallo 9 de la
// prueba en staging: «Aprobar y publicar ahora» aprobaba la pieza y después
// decía «Falta elegir la cuenta…», sin enlace).
//
// Uso (calendario, programar, editor):
//
//   const connected = useConnectedAccount(brand.id);          // red: instagram
//   if (!connected.isLoading && !connected.connected) {
//     return <NoConnectedAccountNotice orgId={org.id} brandId={brand.id} />;   // (NoConnectedAccountNotice.tsx); no se aprueba nada
//   }
//   … connected.account.id es la cuenta que se usa por defecto.

type Account = Pick<SocialAccountRow, 'id' | 'network' | 'status' | 'username' | 'external_id'>;

export type ConnectionState =
  /** Hay una cuenta activa: se puede publicar. */
  | 'connected'
  /** Hay cuenta, pero el acceso caducó: hay que volver a conectarla. */
  | 'needs_reauth'
  /** No hay ninguna cuenta de esa red. */
  | 'none';

/** La cuenta en la que se publica por defecto y en qué estado está la conexión. Sin React: se prueba aparte. */
export function connectionOf(
  accounts: readonly Account[] | undefined,
  network = 'instagram',
): { state: ConnectionState; account: Account | null } {
  const own = (accounts ?? []).filter((a) => a.network === network && a.status !== 'disconnected');
  const active = own.find((a) => a.status === 'active');
  if (active) return { state: 'connected', account: active };
  const stale = own.find((a) => a.status === 'needs_reauth');
  if (stale) return { state: 'needs_reauth', account: stale };
  return { state: 'none', account: null };
}

/**
 * Hook reutilizable: la cuenta conectada de la marca en una red (Instagram por defecto).
 * `connected` es true solo con una cuenta ACTIVA (con la que el publicador puede publicar).
 */
export function useConnectedAccount(brandId: string, network = 'instagram', enabled = true) {
  const accounts = useSocialAccounts(brandId, enabled);
  const { state, account } = connectionOf(accounts.data, network);
  return {
    /** Mientras se lee: no avises todavía de que falta (saldría un aviso falso un instante). */
    isLoading: enabled && accounts.isPending,
    connected: state === 'connected',
    state,
    /** La cuenta activa (o la que hay que volver a conectar). */
    account,
    accounts: accounts.data ?? [],
  };
}

/** El texto del aviso, según el estado. */
export function noAccountText(state: ConnectionState): string {
  return state === 'needs_reauth'
    ? 'El acceso a la cuenta de Instagram ha caducado'
    : 'No hay ninguna cuenta conectada';
}
