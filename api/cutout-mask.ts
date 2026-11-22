/**
 * POST /api/cutout-mask: quita el fondo de una foto en el servidor (Vercel Function,
 * runtime Node). Respaldo del navegador: ver docs/edicion-fotos.md, §7.
 *
 *   Petición: cuerpo = la foto (JPEG, PNG o WebP, ≤ 4 MB, la manda el navegador ya
 *             reducida a ≤ 1600 px), `Authorization: Bearer <JWT de Supabase>` y
 *             `X-Brand-Id: <id de la marca de la foto>`.
 *   Respuesta 200: PNG gris de 1 canal (la máscara refinada) al tamaño de la foto,
 *             con `X-Cutout-Width`/`X-Cutout-Height` y los tiempos en `Server-Timing`.
 *   Errores (JSON `{ error }`): 400 sin marca o foto ilegible, 401 sin sesión, 403 sin
 *             permiso de edición en esa marca, 413 foto > 4 MB, 415 tipo no admitido,
 *             422 no se encuentra nada que recortar, 429 tope de uso (`{ limit }`),
 *             500/503 fallo del servidor.
 *
 * Antes de gastar CPU: sesión + permiso de edición de la marca + cupo
 * (`cutout_reserve`, que deja la fila); al acabar se anota la duración.
 *
 * GET /api/cutout-mask: diagnóstico sin sesión (¿están el modelo, onnxruntime-node
 * y sharp?). No recorta nada.
 */
import { authorizeCutout, finishCutout } from './_lib/cutout/auth.js';
import { BadPhoto, engineStatus, maskFromPhoto, NoSubject } from './_lib/cutout/run.js';

/** Vercel admite 4,5 MB de cuerpo: se rechaza por encima de 4. */
export const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = /^image\/(jpeg|jpg|pjpeg|png|webp)$/i;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return json(413, { error: 'La foto pesa más de 4 MB' });
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!TYPES.test(type)) return json(415, { error: 'La foto tiene que ser JPEG, PNG o WebP' });

  const header = request.headers.get('authorization');
  const auth = await authorizeCutout(header, request.headers.get('x-brand-id'));
  if (!auth.ok) {
    if (auth.status >= 500) console.error('[cutout-mask] autorización', auth.message);
    return json(
      auth.status,
      { error: auth.message, ...(auth.reason ? { limit: auth.reason } : {}) },
      auth.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {},
    );
  }

  const photo = new Uint8Array(await request.arrayBuffer());
  if (photo.byteLength === 0 || photo.byteLength > MAX_BYTES) {
    await finishCutout(header, auth.reservation, 0, false);
    return photo.byteLength === 0
      ? json(400, { error: 'No ha llegado la foto' })
      : json(413, { error: 'La foto pesa más de 4 MB' });
  }

  const started = performance.now();
  try {
    const r = await maskFromPhoto(photo);
    await finishCutout(header, auth.reservation, r.ms.total, true);
    console.info(
      '[cutout-mask]',
      JSON.stringify({
        warm: r.warm,
        size: `${r.width}x${r.height}`,
        bytes: photo.byteLength,
        ...r.ms,
        rssMB: Math.round(process.memoryUsage().rss / 1048576),
      }),
    );
    return new Response(new Uint8Array(r.png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Cutout-Width': String(r.width),
        'X-Cutout-Height': String(r.height),
        'Server-Timing': `decode;dur=${r.ms.decode}, inference;dur=${r.ms.inference}, refine;dur=${r.ms.refine}, png;dur=${r.ms.png}`,
      },
    });
  } catch (error) {
    await finishCutout(header, auth.reservation, performance.now() - started, false);
    if (error instanceof NoSubject) return json(422, { error: error.message });
    if (error instanceof BadPhoto) return json(400, { error: error.message });
    console.error('[cutout-mask] fallo', error);
    return json(500, { error: 'No se pudo quitar el fondo en el servidor' });
  }
}

export async function GET(): Promise<Response> {
  const status = await engineStatus();
  const ok = status.model && status.onnx && status.images;
  return json(ok ? 200 : 503, { ok, ...status });
}
