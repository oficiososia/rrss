// Conectar una cuenta de Instagram a una marca (Facebook Login for Business).
//
//   1. start: quien gestiona la marca pide conectar. Con SU sesión se llama a
//      `social_oauth_begin` (comprueba el permiso y da el estado anti-CSRF) y se
//      devuelve la dirección del diálogo de Meta.
//   2. Meta vuelve a `social-connect/callback` con `code` y `state`. Se gasta el
//      estado (una vez, 10 minutos, y quien empezó tiene que seguir gestionando
//      la marca), se cambia el código por un token de usuario, ese por uno largo
//      (≈60 días) y se piden las páginas con su cuenta de Instagram. El token
//      que publica es el de la página (no caduca si sale de un token largo).
//   3. Se cifran los tokens (crypto.ts) y se guardan con
//      `social_account_connect`. El navegador vuelve a la aplicación con
//      `?social=connected` o el motivo del fallo; nunca ve un token.
//
// Si la persona concede varias cuentas de Instagram, no se elige por ella: se
// le pide que conceda solo una (Login for Business deja escogerla en el diálogo).
import type { RpcClient } from '../ai/contract.ts';
import type { SocialConfig } from './config.ts';
import { decryptToken, encryptToken, tokenBinding } from './crypto.ts';

export type ConnectResult =
  'connected' | 'denied' | 'expired' | 'no_instagram' | 'several_accounts' | 'forbidden' | 'failed';

export class ConnectError extends Error {
  override name = 'ConnectError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const NETWORKS = ['instagram'] as const;

/** Paso 1. Devuelve la dirección a la que mandar el navegador. */
export async function startConnect(
  config: SocialConfig,
  userRpc: RpcClient,
  input: { brandId: unknown; network: unknown },
  randomCode: () => string = () => crypto.randomUUID(),
): Promise<string> {
  if (!config.meta || !config.callbackUrl || !config.keyRing || !config.appUrl) {
    throw new ConnectError(503, 'not_configured', 'La conexión con las redes no está configurada en este entorno.');
  }
  if (typeof input.brandId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.brandId)) {
    throw new ConnectError(400, 'bad_request', 'Falta la marca.');
  }
  if (typeof input.network !== 'string' || !(NETWORKS as readonly string[]).includes(input.network)) {
    throw new ConnectError(400, 'bad_request', 'Esa red todavía no se puede conectar.');
  }
  const { data, error } = await userRpc('social_oauth_begin', { p_brand_id: input.brandId, p_network: input.network });
  if (error) {
    if (error.code === '42501' || error.code === '28000') throw new ConnectError(403, 'forbidden', error.message);
    // Planes: la publicación no está en el plan de la organización.
    if (error.code === 'PL002') throw new ConnectError(402, 'plan_feature', error.message);
    throw new ConnectError(400, 'refused', error.message);
  }
  const state = String(data);
  if (config.simulated) {
    // Prueba local: no hay diálogo de Meta; se vuelve directamente con un código simulado.
    const u = new URL(config.callbackUrl);
    u.searchParams.set('code', `sim-code-${randomCode()}`);
    u.searchParams.set('state', state);
    return u.toString();
  }
  return config.graph.dialogUrl({
    appId: config.meta.appId,
    redirectUri: config.callbackUrl,
    state,
    configId: config.meta.configId ?? undefined,
    scopes: config.meta.scopes,
  });
}

/** Paso 2 y 3. Devuelve la dirección de la aplicación a la que volver. */
export async function finishConnect(
  config: SocialConfig,
  rpc: RpcClient,
  params: URLSearchParams,
  log: (event: string, data: Record<string, unknown>) => void = () => undefined,
): Promise<string> {
  const appUrl = config.appUrl ?? '';
  // Vuelve a la pestaña «Datos de la marca», donde vive la tarjeta de cuentas
  // conectadas: es la que lee `?social=` y dice cómo fue.
  const back = (ctx: { organization_id: string; brand_id: string } | null, result: ConnectResult) =>
    ctx
      ? `${appUrl}/o/${ctx.organization_id}/m/${ctx.brand_id}/marca?seccion=datos&social=${result}`
      : `${appUrl}/?social=${result}`;

  if (!config.meta || !config.callbackUrl || !config.keyRing) return back(null, 'failed');
  const state = params.get('state') ?? '';
  const consumed = await rpc('social_oauth_consume', { p_state: state });
  if (consumed.error) {
    log('state_rejected', { code: consumed.error.code });
    return back(null, consumed.error.code === '42501' ? 'forbidden' : 'expired');
  }
  const ctx = consumed.data as { brand_id: string; organization_id: string; user_id: string; network: string };

  // La persona canceló o no concedió los permisos.
  if (params.get('error') || !params.get('code')) return back(ctx, 'denied');

  try {
    const { appId, appSecret } = config.meta;
    const short = await config.graph.exchangeCode({
      appId,
      appSecret,
      redirectUri: config.callbackUrl,
      code: params.get('code')!,
    });
    const long = await config.graph.exchangeLongLived({ appId, appSecret, token: short.accessToken });
    const pages = (await config.graph.pagesWithInstagram(long.accessToken)).filter((p) => p.instagram);
    if (pages.length === 0) return back(ctx, 'no_instagram');
    if (pages.length > 1) return back(ctx, 'several_accounts');
    const page = pages[0]!;
    const ig = page.instagram!;

    const info = await config.graph.debugToken({ appId, appSecret, token: page.pageAccessToken });
    if (!info.isValid) return back(ctx, 'failed');
    const binding = tokenBinding({ brandId: ctx.brand_id, network: ctx.network, externalId: ig.id });
    const access = await encryptToken(config.keyRing, page.pageAccessToken, binding);
    const refresh = await encryptToken(config.keyRing, long.accessToken, binding);
    const expiresAt = info.expiresAt ?? info.dataAccessExpiresAt;

    const saved = await rpc('social_account_connect', {
      p_user_id: ctx.user_id,
      p_brand_id: ctx.brand_id,
      p_network: ctx.network,
      p_external_id: ig.id,
      p_username: ig.username ?? '',
      p_display_name: ig.name ?? page.pageName ?? '',
      p_page_id: page.pageId,
      p_scopes: info.scopes,
      p_token_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      p_key_id: access.keyId,
      p_access_token_ciphertext: access.ciphertext,
      p_refresh_token_ciphertext: refresh.ciphertext,
    });
    if (saved.error) {
      log('connect_failed', { code: saved.error.code });
      return back(ctx, saved.error.code === '42501' ? 'forbidden' : 'failed');
    }
    return back(ctx, 'connected');
  } catch (e) {
    log('meta_failed', { name: (e as Error)?.name, message: (e as Error)?.message?.slice(0, 200) });
    return back(ctx, 'failed');
  }
}

/**
 * Comprueba los tokens de las cuentas vivas (una vez al día): si Meta dice que
 * ya no valen, la cuenta pasa a «hay que volver a conectarla» y lo programado
 * para ella se detiene; si caduca pronto, se anota la fecha para avisar.
 * Renovar es volver a conectar: la documentación de Meta no ofrece un
 * refresco silencioso del token de usuario.
 */
export async function checkAccountTokens(
  config: SocialConfig,
  rpc: RpcClient,
  accounts: Array<{ id: string; brand_id: string; network: string; external_id: string }>,
  log: (event: string, data: Record<string, unknown>) => void = () => undefined,
): Promise<number> {
  if (!config.keyRing) return 0;
  let checked = 0;
  for (const account of accounts) {
    try {
      const secret = (await rpc('social_account_token', { p_account_id: account.id })).data as {
        key_id: string;
        access_token_ciphertext: string;
        connection_method?: string;
      } | null;
      if (!secret) continue;
      // Las cuentas de OAuth se comprueban con la aplicación del producto; las
      // conectadas con un token pegado, con el propio token (puede ser de otra aplicación).
      const byToken = secret.connection_method === 'token';
      if (!byToken && !config.meta) continue;
      const token = await decryptToken(
        config.keyRing,
        secret.key_id,
        secret.access_token_ciphertext,
        tokenBinding({ brandId: account.brand_id, network: account.network, externalId: account.external_id }),
      );
      const info = byToken
        ? await config.graph.inspectToken(token)
        : await config.graph.debugToken({ appId: config.meta!.appId, appSecret: config.meta!.appSecret, token });
      const expiresAt = info.expiresAt ?? info.dataAccessExpiresAt;
      await rpc('social_account_report', {
        p_account_id: account.id,
        p_status: info.isValid ? null : 'needs_reauth',
        p_last_error: info.isValid
          ? null
          : byToken
            ? 'Meta indica que el token ya no es válido: pega uno nuevo.'
            : 'Meta indica que el acceso ya no es válido: vuelve a conectar la cuenta.',
        p_token_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        p_token_checked: true,
      });
      checked++;
    } catch (e) {
      log('token_check_failed', { accountId: account.id, name: (e as Error)?.name });
    }
  }
  return checked;
}

/** Cuentas que toca renovar (lo que devuelve `social_accounts_to_renew`). */
export interface RenewableAccount {
  id: string;
  brand_id: string;
  network: string;
  external_id: string;
  /** Caducidad conocida antes de renovar (lo que se compara para dar la renovación por buena). */
  token_expires_at?: string | null;
}

/** Cuánto tiene que ganar la caducidad para dar por buena una renovación. */
const MIN_RENEWAL_GAIN_MS = 86_400_000;

/**
 * Renueva el acceso de las cuentas conectadas por OAuth ANTES de que caduque,
 * sin que nadie tenga que volver a conectar: cambia el token largo del usuario
 * (guardado cifrado) por uno nuevo (`fb_exchange_token`), vuelve a pedir los
 * tokens de página con él y guarda lo nuevo con su caducidad.
 *
 * ⚠ SIN PROBAR CONTRA META REAL. La documentación de Meta describe el cambio
 * de un token corto por uno largo, pero no promete que repetirlo sobre uno
 * largo vigente amplíe su caducidad. Por eso una renovación solo se da por
 * buena si Meta dice que la caducidad nueva es posterior a la anterior; si no,
 * o si algo falla, se anota el motivo (`renewal_error`) y la interfaz avisa a la
 * marca y a la agencia de que hay que volver a conectar antes de la fecha.
 * Nunca se registra un token. Devuelve cuántas se renovaron.
 */
export async function renewAccountTokens(
  config: SocialConfig,
  rpc: RpcClient,
  accounts: RenewableAccount[],
  log: (event: string, data: Record<string, unknown>) => void = () => undefined,
): Promise<number> {
  if (!config.keyRing || !config.meta) return 0;
  const { appId, appSecret } = config.meta;
  let renewed = 0;
  for (const account of accounts) {
    const fail = async (message: string) => {
      log('renewal_failed', { accountId: account.id, reason: message });
      await rpc('social_account_renewal_failed', { p_account_id: account.id, p_error: message });
    };
    try {
      const secret = (await rpc('social_account_token', { p_account_id: account.id })).data as {
        key_id: string;
        access_token_ciphertext: string;
        refresh_token_ciphertext: string | null;
      } | null;
      if (!secret?.refresh_token_ciphertext) {
        await fail('No hay un acceso largo guardado para renovar: vuelve a conectar la cuenta.');
        continue;
      }
      const binding = tokenBinding({
        brandId: account.brand_id,
        network: account.network,
        externalId: account.external_id,
      });
      const userToken = await decryptToken(config.keyRing, secret.key_id, secret.refresh_token_ciphertext, binding);
      const before = account.token_expires_at ? Date.parse(account.token_expires_at) : null;

      const long = await config.graph.exchangeLongLived({ appId, appSecret, token: userToken });
      const page = (await config.graph.pagesWithInstagram(long.accessToken)).find(
        (p) => p.instagram?.id === account.external_id,
      );
      if (!page) {
        await fail('Meta ya no da acceso a esta cuenta de Instagram: vuelve a conectarla.');
        continue;
      }
      const info = await config.graph.debugToken({ appId, appSecret, token: page.pageAccessToken });
      if (!info.isValid) {
        await fail('Meta no ha dado un acceso válido al renovar: vuelve a conectar la cuenta.');
        continue;
      }
      const after = info.expiresAt ?? info.dataAccessExpiresAt;
      if (after !== null && before !== null && after < before + MIN_RENEWAL_GAIN_MS) {
        await fail('Meta no ha ampliado la caducidad del acceso: vuelve a conectar la cuenta antes de esa fecha.');
        continue;
      }
      const access = await encryptToken(config.keyRing, page.pageAccessToken, binding);
      const refresh = await encryptToken(config.keyRing, long.accessToken, binding);
      const saved = await rpc('social_account_renew', {
        p_account_id: account.id,
        p_key_id: access.keyId,
        p_access_token_ciphertext: access.ciphertext,
        p_refresh_token_ciphertext: refresh.ciphertext,
        p_token_expires_at: after ? new Date(after).toISOString() : null,
      });
      if (saved.error) {
        log('renewal_save_failed', { accountId: account.id, code: saved.error.code });
        continue;
      }
      renewed++;
      log('renewed', { accountId: account.id });
    } catch (e) {
      // El motivo que ve la gente no lleva detalle de la red; en el registro, solo el nombre del error.
      log('renewal_error', { accountId: account.id, name: (e as Error)?.name });
      try {
        await rpc('social_account_renewal_failed', {
          p_account_id: account.id,
          p_error: 'No se pudo renovar el acceso con Meta: vuelve a conectar la cuenta antes de que caduque.',
        });
      } catch {
        // Si ni siquiera se puede anotar, se volverá a intentar en la siguiente pasada.
      }
    }
  }
  return renewed;
}
