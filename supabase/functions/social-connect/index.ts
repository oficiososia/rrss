// Edge Function `social-connect`: conectar una cuenta de Instagram a una marca
// por OAuth (Facebook Login for Business). Lógica en handler.ts y
// ../_shared/social/oauth.ts; variables en docs/publicacion.md.
//
// Adaptador de Meta SIN PROBAR contra el servicio real (no hay aplicación de
// Meta todavía). En la prueba local, con SOCIAL_E2E_SIMULATED_GRAPH=true y un
// Supabase local, no hay diálogo de Meta y la Graph API es la simulada.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { RpcClient } from '../_shared/ai/contract.ts';
import { loadSocialConfig } from '../_shared/social/config.ts';
import { createSocialConnectHandler } from './handler.ts';

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
const rpc: RpcClient = (fn, args) => admin.rpc(fn, args);
const config = loadSocialConfig(env, (input, init) => fetch(input, init));
for (const problem of config.problems) console.warn(`[social-connect] configuración: ${problem}`);

Deno.serve(
  createSocialConnectHandler({
    config,
    rpc,
    userRpc(accessToken) {
      const asUser = createClient(supabaseUrl, env.SUPABASE_ANON_KEY ?? '', {
        ...options,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      return (fn, args) => asUser.rpc(fn, args);
    },
    allowedOrigin: env.SOCIAL_ALLOWED_ORIGIN?.trim() || undefined,
    log: (event, data) => console.error(`[social-connect] ${event}`, JSON.stringify(data)),
  }),
);
