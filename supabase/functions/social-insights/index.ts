// Edge Function `social-insights`: capturas de métricas e informes mensuales
// de la Fase 5 (handler.ts). La dispara pg_cron (migración 20261119630000) y
// solo atiende a la clave de servicio. En config.toml lleva `verify_jwt = false`
// porque la clave puede llegar en la cabecera `apikey`; la comprobación la hace
// handler.ts.
//
// Secretos: los mismos que el publicador (docs/publicacion.md): META_APP_ID,
// META_APP_SECRET, SOCIAL_TOKEN_KEYS, SOCIAL_TOKEN_KEY_ID y, opcional,
// META_GRAPH_API_VERSION. Sin claves de cifrado no mide nada (lo deja en el
// registro), pero sí prepara los informes. Lectura de métricas SIN PROBAR contra
// el servicio real; en la prueba local, Graph API simulada (local-test.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { RpcClient } from '../_shared/ai/contract.ts';
import { createInsightsGraph } from '../_shared/analytics/insights-graph.ts';
import { loadSocialConfig } from '../_shared/social/config.ts';
import { loadSocialLocalTest } from '../_shared/social/local-test.ts';
import { DEFAULT_GRAPH_API_VERSION } from '../_shared/social/meta-graph.ts';
import { createSocialInsightsHandler } from './handler.ts';

const env = Deno.env.toObject();
const admin = createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rpc: RpcClient = (fn, args) => admin.rpc(fn, args);
const config = loadSocialConfig(env, (input, init) => fetch(input, init));
for (const problem of config.problems) console.warn(`[social-insights] configuración: ${problem}`);
const local = loadSocialLocalTest(env);
const insights = createInsightsGraph({
  fetch: local ? local.fetch : (input, init) => fetch(input, init),
  apiVersion: env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION,
});
const log = (event: string, data: Record<string, unknown>) =>
  console.error(`[social-insights] ${event}`, JSON.stringify(data));

Deno.serve(
  createSocialInsightsHandler({
    serviceKeys: [env.SUPABASE_SERVICE_ROLE_KEY ?? ''],
    rpc,
    workerName: `social-insights:${crypto.randomUUID()}`,
    log,
    capture: () => (config.keyRing ? { api: insights, keyRing: config.keyRing, log } : null),
  }),
);
