// Edge Function `social-publish`: el publicador de la Fase 3 (handler.ts).
// La dispara pg_cron (migración 20261119040000) y solo atiende a la clave de
// servicio. En config.toml lleva `verify_jwt = false` porque la clave puede
// llegar en la cabecera `apikey`; la comprobación la hace handler.ts.
//
// Secretos (docs/publicacion.md): META_APP_ID, META_APP_SECRET y las claves de
// cifrado de los tokens (SOCIAL_TOKEN_KEYS, SOCIAL_TOKEN_KEY_ID), de «Plataforma
// → Integraciones» o, si no están ahí, de las variables de entorno. Sin claves
// de cifrado no publica nada (y lo deja en el registro). Adaptador de Meta SIN PROBAR contra
// el servicio real; en la prueba local, Graph API simulada (local-test.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { RpcClient } from '../_shared/ai/contract.ts';
import { createRpcSettingsLoader, memoByEnv } from '../_shared/integrations/settings.ts';
import { loadSocialConfig } from '../_shared/social/config.ts';
import { checkAccountTokens } from '../_shared/social/oauth.ts';
import { createSocialPublishHandler } from './handler.ts';

/** Cubo privado de la biblioteca (20261115121000_storage_brand_media.sql). */
const STORAGE_BUCKET = 'brand-media';
const env = Deno.env.toObject();
const admin = createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc: RpcClient = (fn, args) => admin.rpc(fn, args);
const log = (event: string, data: Record<string, unknown>) =>
  console.error(`[social-publish] ${event}`, JSON.stringify(data));
const settings = createRpcSettingsLoader(rpc, env, log);
const workerName = `social-publish:${crypto.randomUUID()}`;

const handlerFor = memoByEnv((effective) => {
  const config = loadSocialConfig(effective, (input, init) => fetch(input, init));
  for (const problem of config.problems) console.warn(`[social-publish] configuración: ${problem}`);
  return createSocialPublishHandler({
    serviceKeys: [env.SUPABASE_SERVICE_ROLE_KEY ?? ''],
    rpc,
    workerName,
    log,
    publisher: () =>
      config.keyRing
        ? {
            api: config.graph,
            keyRing: config.keyRing,
            log,
            async signedUrl(path, seconds) {
              const { data, error } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(path, seconds);
              if (error || !data?.signedUrl) throw new Error('No se pudo firmar la dirección del recurso');
              return data.signedUrl;
            },
          }
        : null,
    async accountsToCheck() {
      const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const { data, error } = await admin
        .from('social_accounts')
        .select('id, brand_id, network, external_id')
        .eq('status', 'active')
        .or(`token_checked_at.is.null,token_checked_at.lt.${since}`)
        .limit(10);
      if (error) throw new Error('No se pudieron leer las cuentas');
      return data ?? [];
    },
    checkTokens: (accounts) => checkAccountTokens(config, rpc, accounts, log),
  });
});

Deno.serve(async (request) => handlerFor(await settings.get())(request));
