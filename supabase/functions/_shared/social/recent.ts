// «Buscar en Instagram» del editor de reels (docs/editor-reels.md §12): lee la
// primera página de /media de la cuenta (las publicaciones más recientes) y la
// guarda en `social_imported_media`, como una página de «Importar publicaciones»
// pero sin tocar ninguna importación en marcha ni su cursor. Con eso la
// aplicación reconoce el reel que se terminó a mano en Instagram.
//
// ⚠ SIN PROBAR CONTRA EL SERVICIO REAL: solo contra la Graph API simulada. La
// misma llamada que la importación (import-graph.ts). El token se descifra aquí
// y no sale: ni a la respuesta ni al registro.
import type { RpcClient } from '../ai/contract.ts';
import { SocialApiError } from './contract.ts';
import { decryptToken, tokenBinding, type TokenKeyRing } from './crypto.ts';
import type { ImportedPost, MediaHistoryApi } from './import-graph.ts';

/** Publicaciones que se leen: las de los últimos días caben de sobra. */
export const RECENT_PAGE_SIZE = 25;

export interface RecentDeps {
  rpc: RpcClient;
  api: MediaHistoryApi;
  keyRing: TokenKeyRing;
  userId: string;
  now?: () => number;
}

export interface RecentResult {
  outcome: 'ok' | 'error';
  saved: number;
  /** Para la persona, si algo salió mal. */
  message?: string;
}

export async function fetchRecentMedia(accountId: string, deps: RecentDeps): Promise<RecentResult> {
  const now = deps.now ?? Date.now;
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await deps.rpc(fn, args);
    if (error) throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code });
    return data as T;
  };
  // Permiso (editar la marca) y cuenta conectada: si no, la base de datos lo rechaza y sube el error.
  const account = await rpc<{
    id: string;
    brand_id: string;
    network: string;
    external_id: string;
    token_expires_at: string | null;
  }>('social_recent_claim', { p_account_id: accountId, p_user_id: deps.userId });

  try {
    if (account.token_expires_at && Date.parse(account.token_expires_at) <= now()) {
      throw new SocialApiError({ kind: 'token', message: 'El token de la cuenta ha caducado' });
    }
    const secret = await rpc<{ key_id: string; access_token_ciphertext: string } | null>('social_account_token', {
      p_account_id: account.id,
    });
    if (!secret) throw new SocialApiError({ kind: 'token', message: 'La cuenta no tiene token' });
    const token = await decryptToken(
      deps.keyRing,
      secret.key_id,
      secret.access_token_ciphertext,
      tokenBinding({ brandId: account.brand_id, network: account.network, externalId: account.external_id }),
    );
    const page = await deps.api.listMedia(account.external_id, token, { limit: RECENT_PAGE_SIZE });
    const saved = await rpc<number>('social_recent_save', {
      p_account_id: account.id,
      p_user_id: deps.userId,
      p_items: page.items satisfies ImportedPost[],
    });
    return { outcome: 'ok', saved: Number(saved) || 0 };
  } catch (e) {
    if (e instanceof SocialApiError) {
      if (e.kind === 'token') {
        await rpc('social_account_report', {
          p_account_id: account.id,
          p_status: 'needs_reauth',
          p_last_error: e.message,
        }).catch(() => undefined);
        return { outcome: 'error', saved: 0, message: 'El acceso de la cuenta ha caducado: vuelve a conectarla.' };
      }
      if (e.kind === 'rate_limited' || e.kind === 'publish_limit') {
        return { outcome: 'error', saved: 0, message: 'Meta pide ir más despacio: prueba dentro de un rato.' };
      }
      return { outcome: 'error', saved: 0, message: `Meta respondió con un error: ${e.message}` };
    }
    throw e;
  }
}
