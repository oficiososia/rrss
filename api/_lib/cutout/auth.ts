// Autorización y cupo de `api/cutout-mask.ts`: el JWT de Supabase de la persona
// (`Authorization: Bearer …`) se comprueba contra el proyecto de ESTE despliegue y,
// COMO ESA PERSONA (nunca con la clave de servicio), se llama a `cutout_reserve`
// (migración 20261213120000): exige poder EDITAR la marca y mira los topes.
// Al acabar, `cutout_finish` anota la duración. Solo `fetch`, sin dependencias.

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export type Authorization =
  | { ok: true; userId: string; reservation: number }
  | { ok: false; status: 400 | 401 | 403 | 429 | 500 | 503; message: string; reason?: 'day' | 'month' };

const AUTH_TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseEnv(env: Record<string, string | undefined> = process.env): SupabaseEnv | null {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ''), anonKey };
}

/** Token de `Authorization: Bearer <jwt>` (null si no hay o no tiene forma de JWT). */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\s*$/i.exec(header ?? '');
  return m ? m[1]! : null;
}

interface Options {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

const headers = (sb: SupabaseEnv, token: string) => ({
  apikey: sb.anonKey,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

/** Sesión válida + permiso de edición de la marca + cupo libre → id de la reserva. */
export async function authorizeCutout(
  authHeader: string | null | undefined,
  brandId: string | null | undefined,
  options: Options = {},
): Promise<Authorization> {
  const token = bearerToken(authHeader);
  if (!token) return { ok: false, status: 401, message: 'Falta la sesión' };
  if (!brandId || !UUID.test(brandId)) return { ok: false, status: 400, message: 'Falta la marca de la foto' };
  const sb = supabaseEnv(options.env);
  if (!sb) return { ok: false, status: 500, message: 'Falta la configuración de Supabase' };
  const f = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(AUTH_TIMEOUT_MS);
  try {
    const who = await f(`${sb.url}/auth/v1/user`, { headers: headers(sb, token), signal });
    if (who.status === 401 || who.status === 403)
      return { ok: false, status: 401, message: 'Sesión no válida o caducada' };
    if (!who.ok) return { ok: false, status: 500, message: `Auth respondió ${who.status}` };
    const user = (await who.json().catch(() => null)) as { id?: string } | null;
    if (!user?.id) return { ok: false, status: 401, message: 'Sesión no válida' };

    const res = await f(`${sb.url}/rest/v1/rpc/cutout_reserve`, {
      method: 'POST',
      headers: headers(sb, token),
      body: JSON.stringify({ p_brand_id: brandId }),
      signal,
    });
    if (res.status === 401) return { ok: false, status: 401, message: 'Sesión no válida o caducada' };
    // `42501` (sin permiso) llega como 403 desde PostgREST.
    if (res.status === 403) return { ok: false, status: 403, message: 'Sin permiso para editar esta marca' };
    // Sin la migración no hay control de gasto: no se recorta.
    if (res.status === 404)
      return { ok: false, status: 503, message: 'Falta aplicar la migración del cupo de recortes' };
    if (!res.ok) return { ok: false, status: 500, message: `La reserva respondió ${res.status}` };
    const r = (await res.json().catch(() => null)) as { allowed?: boolean; id?: number; reason?: string } | null;
    if (!r || typeof r.allowed !== 'boolean')
      return { ok: false, status: 500, message: 'Respuesta de reserva no válida' };
    if (!r.allowed) {
      const reason = r.reason === 'day' ? 'day' : 'month';
      return {
        ok: false,
        status: 429,
        reason,
        message:
          reason === 'day'
            ? 'Has llegado al tope diario de recortes en el servidor'
            : 'La marca ha llegado al tope mensual de recortes en el servidor',
      };
    }
    return { ok: true, userId: user.id, reservation: Number(r.id) };
  } catch (error) {
    return { ok: false, status: 500, message: `No se pudo comprobar la sesión: ${(error as Error)?.message ?? error}` };
  }
}

/** Anota cuánto tardó el trabajo y si salió bien. Nunca lanza. */
export async function finishCutout(
  authHeader: string | null | undefined,
  reservation: number,
  ms: number,
  ok: boolean,
  options: Options = {},
): Promise<void> {
  const token = bearerToken(authHeader);
  const sb = supabaseEnv(options.env);
  if (!token || !sb) return;
  try {
    await (options.fetch ?? fetch)(`${sb.url}/rest/v1/rpc/cutout_finish`, {
      method: 'POST',
      headers: headers(sb, token),
      body: JSON.stringify({ p_id: reservation, p_ms: Math.round(ms), p_ok: ok }),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    /* anotar el tiempo no es crítico */
  }
}
