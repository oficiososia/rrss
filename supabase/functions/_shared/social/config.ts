// Configuración del conector de Meta, leída de las variables de las Edge
// Functions (docs/publicacion.md, «Variables y secretos»). Nada de esto llega
// al navegador.
//
//   META_APP_ID, META_APP_SECRET   aplicación de Meta del producto
//   META_LOGIN_CONFIG_ID           configuración de Facebook Login for Business (recomendada)
//   META_GRAPH_API_VERSION         por defecto v27.0
//   SOCIAL_CALLBACK_URL            …/functions/v1/social-connect/callback (registrada en Meta)
//   SOCIAL_APP_URL                 dirección de la aplicación, para volver tras conectar
//   SOCIAL_TOKEN_KEYS, SOCIAL_TOKEN_KEY_ID   claves de cifrado de los tokens (crypto.ts)
//
// En la prueba LOCAL, con la guarda de local-test.ts, la Graph API es la
// simulada y la clave de cifrado es una fija de pruebas.
import { parseKeyRing, TokenKeyError, type TokenKeyRing } from './crypto.ts';
import { loadSocialLocalTest } from './local-test.ts';
import { createMetaGraph, DEFAULT_GRAPH_API_VERSION, INSTAGRAM_SCOPES, type FetchLike } from './meta-graph.ts';
import type { InstagramApi, MetaLoginApi } from './contract.ts';

export interface SocialConfig {
  graph: InstagramApi & MetaLoginApi;
  /** true = Graph API simulada (solo pruebas locales). */
  simulated: boolean;
  keyRing: TokenKeyRing | null;
  meta: { appId: string; appSecret: string; configId: string | null; scopes: string[] } | null;
  callbackUrl: string | null;
  appUrl: string | null;
  /** Lo que falta configurar (solo nombres de variables, nunca valores). */
  problems: string[];
}

const urlOrNull = (value: string | undefined) => {
  if (!value?.trim()) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
};

export function loadSocialConfig(env: Record<string, string | undefined>, realFetch: FetchLike): SocialConfig {
  const problems: string[] = [];
  const local = loadSocialLocalTest(env);
  const apiVersion = env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/.test(apiVersion)) problems.push('META_GRAPH_API_VERSION no tiene la forma vNN.N');

  let keyRing: TokenKeyRing | null = null;
  try {
    keyRing = local && !env.SOCIAL_TOKEN_KEYS ? local.keyRing : parseKeyRing(env.SOCIAL_TOKEN_KEYS, env.SOCIAL_TOKEN_KEY_ID);
  } catch (e) {
    problems.push(e instanceof TokenKeyError ? e.message : 'SOCIAL_TOKEN_KEYS no es válida');
  }

  const appId = local ? 'aplicacion-simulada' : env.META_APP_ID?.trim();
  const appSecret = local ? 'secreto-simulado' : env.META_APP_SECRET?.trim();
  if (!appId) problems.push('Falta META_APP_ID');
  if (!appSecret) problems.push('Falta META_APP_SECRET');
  const callbackUrl = urlOrNull(env.SOCIAL_CALLBACK_URL);
  if (!callbackUrl) problems.push('Falta SOCIAL_CALLBACK_URL (o no es una URL)');
  const appUrl = urlOrNull(env.SOCIAL_APP_URL);
  if (!appUrl) problems.push('Falta SOCIAL_APP_URL (o no es una URL)');
  if (local) problems.push(...local.problems);

  return {
    graph: createMetaGraph({ fetch: local ? local.fetch : realFetch, apiVersion }),
    simulated: Boolean(local),
    keyRing,
    meta:
      appId && appSecret
        ? { appId, appSecret, configId: env.META_LOGIN_CONFIG_ID?.trim() || null, scopes: INSTAGRAM_SCOPES }
        : null,
    callbackUrl,
    appUrl,
    problems,
  };
}
