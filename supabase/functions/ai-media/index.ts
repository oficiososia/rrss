// Edge Function `ai-media`: la puerta de la interfaz a la generación de
// IMÁGENES con IA (acciones en handler.ts; contrato en docs/ia-medios.md, §7).
//
// La lógica está probada en Node con la base de datos real y el proveedor
// simulado; con proveedor real NO se ha ejecutado nunca. Sin proveedor
// configurado arranca y responde que la IA «no está disponible».
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { MediaInput } from '../_shared/ai/media/contract.ts';
import { signStoredPath } from '../_shared/storage/resolve.ts';
import { createAiMediaHandler } from './handler.ts';
import { admin, checkConfiguration, clientOptions, env, loadRuntime, mediaStores, supabaseUrl } from './setup.ts';

checkConfiguration('ai-media');

/** Las URL firmadas de las referencias duran lo justo para que el proveedor las descargue. */
const REFERENCE_URL_SECONDS = 15 * 60;

function asUser(accessToken: string) {
  return createClient(supabaseUrl, env.SUPABASE_ANON_KEY ?? '', {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

const handler = createAiMediaHandler({
  async authenticate(accessToken) {
    const { data, error } = await admin.auth.getUser(accessToken);
    return error || !data.user ? null : { userId: data.user.id };
  },

  // Con la identidad del usuario: la RLS decide qué marca ve.
  async brandVisible(accessToken, brandId) {
    const { data, error } = await asUser(accessToken).from('brands').select('id').eq('id', brandId).maybeSingle();
    if (error) throw new Error('No se ha podido leer la marca');
    return Boolean(data);
  },

  // Con la identidad del usuario: solo imágenes de la marca que ve.
  async loadReferences(accessToken, brandId, assetIds) {
    const client = asUser(accessToken);
    const { data, error } = await client
      .from('media_assets')
      .select('id, storage_path, storage_backend, mime_type, width, height, kind')
      .eq('brand_id', brandId)
      .in('id', assetIds);
    if (error) throw new Error('No se han podido leer las referencias');
    const rows = data ?? [];
    if (rows.length !== assetIds.length || rows.some((r) => r.kind !== 'image' && r.kind !== 'logo')) return null;
    const inputs: MediaInput[] = [];
    // Las filas ya salen de la RLS de quien pide: se firman en su almacén.
    const stores = await mediaStores();
    for (const id of assetIds) {
      const row = rows.find((r) => r.id === id)!;
      let url: string;
      try {
        url = await signStoredPath(
          stores,
          async () => (row.storage_backend === 'r2' ? 'r2' : 'supabase'),
          row.storage_path,
          REFERENCE_URL_SECONDS,
        );
      } catch {
        return null;
      }
      inputs.push({
        mimeType: row.mime_type,
        url,
        ...(row.width ? { width: row.width } : {}),
        ...(row.height ? { height: row.height } : {}),
      });
    }
    return inputs;
  },

  runtime: loadRuntime,
  log: (event, data) => console.error(`[ai-media] ${event}`, JSON.stringify(data)),
  allowedOrigin: env.AI_ALLOWED_ORIGIN,
});

Deno.serve(handler);
