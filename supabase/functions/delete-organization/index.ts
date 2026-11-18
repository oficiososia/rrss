// Edge Function `delete-organization` (RGPD, derecho de supresión): un
// propietario borra su organización con todos sus datos y archivos. Lógica y
// garantías en ../_shared/gdpr/handler.ts.
// Sin desplegar todavía: probada en Node contra las migraciones reales
// (tests/db/rgpd.test.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createGdprDeps, type GdprAdminClient, type GdprAnonClient } from '../_shared/gdpr/deps.ts';
import { createDeleteOrganizationHandler } from '../_shared/gdpr/handler.ts';

const env = Deno.env.toObject();
const url = env.SUPABASE_URL ?? '';
const options = { auth: { persistSession: false, autoRefreshToken: false } };

const deps = createGdprDeps({
  name: 'delete-organization',
  admin: createClient(url, env.SUPABASE_SERVICE_ROLE_KEY ?? '', options) as unknown as GdprAdminClient,
  anonClient: () => createClient(url, env.SUPABASE_ANON_KEY ?? '', options) as unknown as GdprAnonClient,
  // CORS: el origen de la aplicación (el mismo que el de la IA si no se indica otro).
  allowedOrigin: env.GDPR_ALLOWED_ORIGIN ?? env.AI_ALLOWED_ORIGIN,
});

Deno.serve(createDeleteOrganizationHandler(deps));
