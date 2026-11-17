// Edge Function `ai-generate`: la puerta de la interfaz a las tareas de IA de texto.
//
// SIN DESPLEGAR. La lógica (handler.ts) está probada en Node con la base de
// datos real y el proveedor simulado; este arranque en Deno solo se ha
// ejecutado en local (`supabase functions serve`, prueba de extremo a extremo
// de la Fase 2), con el proveedor simulado de pruebas locales.
//
// Secretos: la clave de servicio y las de los proveedores solo existen aquí,
// en las variables de entorno de la función (ver `.env.example`). Nada de esto
// llega al navegador. `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
// `SUPABASE_SERVICE_ROLE_KEY` las pone Supabase en todas las funciones.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Json, RpcClient } from '../_shared/ai/contract.ts';
import { createAiService } from '../_shared/ai/service.ts';
import { loadAiTextConfig } from '../_shared/ai/text/config.ts';
import { loadLocalTestTextConfig } from '../_shared/ai/text/local-test.ts';
import { createAiGenerateHandler } from './handler.ts';

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const options = { auth: { persistSession: false, autoRefreshToken: false } };

// Con la clave de servicio: solo para validar la sesión y para las funciones
// SQL del cupo, que no se pueden ejecutar de otra forma.
const admin = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
const rpc: RpcClient = (fn, args) => admin.rpc(fn, args);

// Sin proveedor simulado: si falta configuración, la función responde que la
// IA no está disponible. Los avisos (solo nombres de variables) van al registro.
// Única excepción: la prueba de extremo a extremo en local, que exige
// AI_E2E_SIMULATED_PROVIDER=true Y un Supabase local; si la variable está en
// cualquier otro entorno, la función no arranca (ver local-test.ts).
const config = loadLocalTestTextConfig(env) ?? loadAiTextConfig(env);
for (const problem of config.problems) console.warn(`[ai-generate] configuración: ${problem}`);

const handler = createAiGenerateHandler({
  service: createAiService({
    rpc,
    providers: config.providers,
    models: config.models,
    unavailable: config.unavailable,
    timeoutMs: config.timeoutMs,
  }),

  async authenticate(accessToken) {
    const { data, error } = await admin.auth.getUser(accessToken);
    return error || !data.user ? null : { userId: data.user.id };
  },

  // Con la identidad del usuario: la RLS decide qué marca y qué perfil ve.
  async loadBrandProfile(accessToken, brandId) {
    const asUser = createClient(supabaseUrl, env.SUPABASE_ANON_KEY ?? '', {
      ...options,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const brand = await asUser.from('brands').select('id').eq('id', brandId).maybeSingle();
    if (brand.error) throw new Error('No se ha podido leer la marca');
    if (!brand.data) return { brandVisible: false, profile: null };
    const profile = await asUser
      .from('brand_profiles')
      .select('data')
      .eq('brand_id', brandId)
      .eq('status', 'active')
      .maybeSingle();
    if (profile.error) throw new Error('No se ha podido leer el perfil de marca');
    return { brandVisible: true, profile: (profile.data?.data as Json | undefined) ?? null };
  },

  log: (event, data) => console.error(`[ai-generate] ${event}`, JSON.stringify(data)),
  allowedOrigin: env.AI_ALLOWED_ORIGIN,
});

Deno.serve(handler);
