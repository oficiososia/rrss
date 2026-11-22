// Edge Function `ai-reel-like`: la parte de IA de «Hacer un reel como este»
// (docs/reel-como-este.md). La lógica está en handler.ts.
//
// Usa el modelo de texto CON VISIÓN del propósito `reel.like`
// (`AI_TEXT_REEL_LIKE_PROVIDER` / `AI_TEXT_REEL_LIKE_MODEL` como secretos de la
// función o, si no, los de «Plataforma → Integraciones → IA de texto»:
// `AI_TEXT_PROVIDER` / `AI_TEXT_MODEL`; ver _shared/ai/text/reel-like-config.ts)
// y, para la voz, la transcripción de
// OpenAI (`ai-transcribe`). Las claves nunca llegan al navegador. Sin un
// modelo con visión cargado y con precio, responde «no disponible» y la
// interfaz no enseña el botón.
// SIN DESPLEGAR (22/11/2026).
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Json, RpcClient } from '../_shared/ai/contract.ts';
import { createAiService, priceUsage } from '../_shared/ai/service.ts';
import { loadReelLikeTextConfig } from '../_shared/ai/text/reel-like-config.ts';
import { loadTranscriptionConfig, transcriptionPrice } from '../_shared/ai/transcription/config.ts';
import { createRpcSettingsLoader, memoByEnv } from '../_shared/integrations/settings.ts';
import { mediaStoresFor } from '../_shared/storage/resolve.ts';
import { createSupabaseObjectStorage } from '../_shared/storage/supabase.ts';
import { createAiReelLikeHandler } from './handler.ts';

const env = Deno.env.toObject();
const supabaseUrl = env.SUPABASE_URL ?? '';
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(supabaseUrl, serviceKey, options);
const rpc: RpcClient = (fn, args) => admin.rpc(fn, args);
const log = (event: string, data: Record<string, unknown>) =>
  console.error(`[ai-reel-like] ${event}`, JSON.stringify(data));
const settings = createRpcSettingsLoader(rpc, env, log);
const supabaseStorage = createSupabaseObjectStorage({ url: supabaseUrl, serviceKey });

const asUser = (accessToken: string) =>
  createClient(supabaseUrl, env.SUPABASE_ANON_KEY ?? '', {
    ...options,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

const handlerFor = memoByEnv((effective) => {
  const text = loadReelLikeTextConfig(effective);
  for (const problem of text.problems) console.warn(`[ai-reel-like] configuración: ${problem}`);
  const transcription = loadTranscriptionConfig(effective);
  const stores = mediaStoresFor(effective, supabaseStorage, log);

  // El modelo de `reel.like`: tiene que estar cargado y saber mirar imágenes
  // (lo decide `loadReelLikeTextConfig`; el simulado solo existe en pruebas locales).
  const spec = text.spec;
  const provider = spec ? text.providers.find((p) => p.id === spec.provider) : undefined;

  return createAiReelLikeHandler({
    rpc,
    // Mirar una docena de fotogramas y escribir el guion tarda más que un pie de foto.
    textService: createAiService({
      rpc,
      providers: text.providers,
      models: text.models,
      unavailable: text.unavailable,
      timeoutMs: Math.max(text.timeoutMs ?? 0, 100_000),
    }),
    transcriptionService: createAiService({
      rpc,
      providers: transcription.providers,
      models: transcription.models,
      unavailable: transcription.unavailable,
      timeoutMs: 40_000,
    }),
    estimateText(input) {
      if (!spec || !provider || !text.ready) return null;
      const priced = priceUsage(spec, provider.estimateUsage({ task: 'text', model: spec.model, input }));
      return priced.unpriced.length > 0 ? null : Math.max(1, priced.micros);
    },
    transcriptionMicrosPerSecond: transcriptionPrice(transcription),

    async authenticate(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return error || !data.user ? null : { userId: data.user.id };
    },

    // Con la identidad de la persona: la RLS decide qué marca, qué perfil y qué biblioteca ve.
    async loadBrand(accessToken, brandId) {
      const client = asUser(accessToken);
      const access = await client.rpc('ai_brand_access', { p_brand_id: brandId });
      if (access.error) throw new Error('No se ha podido leer la marca');
      const brandAccess = access.data as { ai_mode?: string; agency_staff?: boolean } | null;
      if (!brandAccess) {
        return { visible: false, profile: null, aiMode: 'api', agencyStaff: false, library: { folders: [], tags: [] } };
      }
      const [profile, assets] = await Promise.all([
        client.from('brand_profiles').select('data').eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
        client
          .from('media_assets')
          .select('folder, tags')
          .eq('brand_id', brandId)
          .in('kind', ['image', 'video'])
          .order('created_at', { ascending: false })
          .limit(500),
      ]);
      if (profile.error || assets.error) throw new Error('No se ha podido leer la marca');
      const folders = new Map<string, number>();
      const tags = new Map<string, number>();
      for (const row of (assets.data ?? []) as Array<{ folder: string | null; tags: string[] | null }>) {
        if (row.folder) folders.set(row.folder, (folders.get(row.folder) ?? 0) + 1);
        for (const tag of row.tags ?? []) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      }
      const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
      return {
        visible: true,
        profile: (profile.data?.data as Json | undefined) ?? null,
        aiMode: brandAccess.ai_mode === 'agency' ? 'agency' : 'api',
        agencyStaff: brandAccess.agency_staff === true,
        library: { folders: top(folders), tags: top(tags) },
      };
    },

    async loadReference(accessToken, referenceId) {
      const { data, error } = await asUser(accessToken)
        .from('reel_references')
        .select('id, brand_id, organization_id, status, idea, measurement, result, cost_micros, error')
        .eq('id', referenceId)
        .maybeSingle();
      if (error) throw new Error('No se ha podido leer el análisis');
      return data ?? null;
    },

    // Los archivos del análisis los subió el trabajador: en R2 si está activo, y si no, en Supabase.
    async readFile(path) {
      for (const store of [stores.r2, stores.supabase]) {
        if (!store) continue;
        try {
          if (!(await store.head(path))) continue;
          const response = await fetch(await store.signGet(path, 120));
          if (response.ok) return new Uint8Array(await response.arrayBuffer());
          await response.arrayBuffer().catch(() => undefined);
        } catch {
          // Se prueba el otro almacén.
        }
      }
      return null;
    },

    async removeFiles(paths) {
      const failed = new Set<string>();
      for (const store of [stores.r2, stores.supabase]) {
        if (!store) continue;
        for (const path of (await store.remove(paths)).failed) failed.add(path);
      }
      return paths.filter((path) => !failed.has(path));
    },

    log,
    allowedOrigin: env.AI_ALLOWED_ORIGIN,
  });
});

Deno.serve(async (request) => handlerFor(await settings.get())(request));
