// Cadena de motores de «Quitar el fondo»: navegador (BEN2 o IS-Net) → servidor, y la
// función del servidor (autorización, cupo, límites). Sin modelo ni red: dobles.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeCutout, bearerToken, finishCutout } from '../../../../api/_lib/cutout/auth';
import { GET, MAX_BYTES, POST } from '../../../../api/cutout-mask';
import type { Pixels } from '../pixels';
import type { CutoutResult } from './engine';
import { NoSubjectError } from './mask';
import {
  describeRemovalError,
  removalSupport,
  removeBackground,
  resetRemovalSession,
  type RemovalDeps,
} from './remover';
import { CutoutServerError, removeBackgroundOnServer, shrinkPixels } from './server';
import { removeBackgroundByJob, type JobDeps, type JobStatus } from './serverJob';

const BRAND = '11111111-2222-4333-8444-555555555555';
const image = (w = 8, h = 6): Pixels => ({ data: new Uint8ClampedArray(w * h * 4).fill(200), width: w, height: h });
const browserResult = (): CutoutResult => ({
  pixels: image(),
  model: 'ben2-base-fp16',
  engine: 'ben2',
  quality: 'high',
  provider: 'webgpu',
  fromCache: true,
});

const SOURCE = { storage_path: 'org/brand/media/plato.jpg', mime_type: 'image/jpeg', kind: 'image' };
const OPTS = { brandId: BRAND, source: SOURCE };

function deps(over: Partial<RemovalDeps> = {}): RemovalDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    browserSupport: () => ({ ok: true }),
    ben2Capable: async () => true,
    browser: vi.fn(async (_image, engine) => {
      calls.push(`browser-${engine}`);
      return engine === 'ben2' ? browserResult() : { ...browserResult(), model: 'isnet-general-use', quality: 'basic' as const };
    }),
    jobEnabled: () => true,
    job: vi.fn(async () => {
      calls.push('job');
      return image();
    }),
    serverAvailable: () => false,
    server: vi.fn(async () => {
      calls.push('vercel');
      return image();
    }),
    ...over,
  };
}

beforeEach(() => {
  resetRemovalSession();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('cadena: BEN2 en el navegador → trabajador → (Vercel apagada) → IS-Net', () => {
  it('con WebGPU recorta en el navegador con BEN2 y no toca el servidor', async () => {
    const d = deps();
    const r = await removeBackground(image(), undefined, undefined, OPTS, d);
    expect(d.calls).toEqual(['browser-ben2']);
    expect(r).toMatchObject({ where: 'browser', quality: 'high', model: 'ben2-base-fp16' });
  });

  it('sin WebGPU va al trabajador del servidor (BEN2, calidad alta) y no gasta IS-Net', async () => {
    const d = deps({ ben2Capable: async () => false });
    const onProgress = vi.fn();
    const r = await removeBackground(image(), onProgress, undefined, OPTS, d);
    expect(d.calls).toEqual(['job']);
    expect(r).toMatchObject({ where: 'server', quality: 'high', model: 'ben2-base-fp16' });
    // Le pasa la foto de la biblioteca (no sube nada) y deja que la interfaz cuente el progreso.
    expect(d.job).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ brandId: BRAND, sourcePath: SOURCE.storage_path }),
    );
    (d.job as ReturnType<typeof vi.fn>).mock.calls[0]![1].onProgress('running');
    expect(onProgress).toHaveBeenCalledWith({ phase: 'server-job', state: 'running' });
  });

  it('si BEN2 falla en el navegador, sigue en el servidor', async () => {
    const d = deps({
      browser: vi.fn(async () => {
        throw new Error('sesión sin soporte');
      }),
    });
    const r = await removeBackground(image(), undefined, undefined, OPTS, d);
    expect(r).toMatchObject({ where: 'server', quality: 'high' });
    expect(d.job).toHaveBeenCalledTimes(1);
  });

  it('si el servidor también falla (o no hay trabajador), último recurso: IS-Net en el navegador, calidad básica', async () => {
    const d = deps({
      ben2Capable: async () => false,
      job: vi.fn(async () => {
        throw new CutoutServerError('la máquina no arranca', 'timeout');
      }),
    });
    const r = await removeBackground(image(), undefined, undefined, OPTS, d);
    expect(r).toMatchObject({ where: 'browser', quality: 'basic', model: 'isnet-general-use' });
    expect(d.calls).toEqual(['browser-isnet']);

    const sin = deps({ ben2Capable: async () => false, jobEnabled: () => false });
    const r2 = await removeBackground(image(), undefined, undefined, OPTS, sin);
    expect(r2).toMatchObject({ where: 'browser', quality: 'basic' });
    expect(sin.job).not.toHaveBeenCalled();
  });

  it('el servidor solo se usa con una foto de la biblioteca en JPEG, PNG o WebP y con marca', async () => {
    const base = { ben2Capable: async () => false };
    for (const options of [
      { brandId: BRAND },
      { source: SOURCE },
      { brandId: BRAND, source: { ...SOURCE, mime_type: 'image/gif' } },
      { brandId: BRAND, source: { ...SOURCE, kind: 'video' } },
    ]) {
      const d = deps(base);
      await removeBackground(image(), undefined, undefined, options, d);
      expect(d.job).not.toHaveBeenCalled();
    }
  });

  it('si el navegador no puede nada (sin WebAssembly), va directo al servidor', async () => {
    const d = deps({ browserSupport: () => ({ ok: false, reason: 'sin memoria' }) });
    const r = await removeBackground(image(), undefined, undefined, OPTS, d);
    expect(d.browser).not.toHaveBeenCalled();
    expect(r.where).toBe('server');
  });

  it('la función de Vercel está apagada salvo que se encienda, y va después del trabajador', async () => {
    const off = deps({
      ben2Capable: async () => false,
      jobEnabled: () => false,
      browserSupport: () => ({ ok: false, reason: 'x' }),
    });
    await expect(removeBackground(image(), undefined, undefined, OPTS, off)).rejects.toThrow('x');
    expect(off.server).not.toHaveBeenCalled();

    const on = deps({
      ben2Capable: async () => false,
      serverAvailable: () => true,
      job: vi.fn(async () => {
        throw new CutoutServerError('x', 'server');
      }),
    });
    const r = await removeBackground(image(), undefined, undefined, OPTS, on);
    expect(r).toMatchObject({ where: 'server', quality: 'basic', model: 'isnet-general-use' });
    expect(on.server).toHaveBeenCalledTimes(1);
  });

  it('tras quedarse sin memoria con BEN2 en el navegador, las fotos siguientes van directas al servidor', async () => {
    const d = deps({
      browser: vi.fn(async () => {
        throw new RangeError('Array buffer allocation failed');
      }),
    });
    await removeBackground(image(), undefined, undefined, OPTS, d);
    const d2 = deps();
    const r = await removeBackground(image(), undefined, undefined, OPTS, d2);
    expect(r.where).toBe('server');
    expect(d2.browser).not.toHaveBeenCalled();
  });

  it('si fallan todos, se enseña el primer error', async () => {
    const first = new Error('primero');
    const d = deps({
      browser: vi.fn(async () => Promise.reject(first)),
      job: vi.fn(async () => Promise.reject(new CutoutServerError('segundo', 'server'))),
    });
    await expect(removeBackground(image(), undefined, undefined, OPTS, d)).rejects.toBe(first);
  });

  it('«nada que recortar» y cancelar cortan la cadena: no se prueba otro motor', async () => {
    const none = deps({ browser: vi.fn(async () => Promise.reject(new NoSubjectError())) });
    await expect(removeBackground(image(), undefined, undefined, OPTS, none)).rejects.toBeInstanceOf(NoSubjectError);
    expect(none.job).not.toHaveBeenCalled();
    const abort = Object.assign(new Error('cancelado'), { name: 'AbortError' });
    const cancelled = deps({ ben2Capable: async () => false, job: vi.fn(async () => Promise.reject(abort)) });
    await expect(removeBackground(image(), undefined, undefined, OPTS, cancelled)).rejects.toBe(abort);
    expect(cancelled.browser).not.toHaveBeenCalled();
  });

  it('el botón sale si el navegador puede o si hay algún servidor', () => {
    const no = {
      browserSupport: () => ({ ok: false as const, reason: 'x' }),
      serverAvailable: () => false,
      jobEnabled: () => false,
    };
    expect(removalSupport(no).ok).toBe(false);
    expect(removalSupport({ ...no, serverAvailable: () => true }).ok).toBe(true);
    expect(removalSupport({ ...no, jobEnabled: () => true }).ok).toBe(true);
    expect(removalSupport({ ...no, browserSupport: () => ({ ok: true }) }).ok).toBe(true);
  });

  it('los fallos del servidor se explican en claro', () => {
    expect(describeRemovalError(new CutoutServerError('Has llegado al tope diario', 'limit', 429))).toMatch(
      /tope diario.*mañana/,
    );
    expect(describeRemovalError(new CutoutServerError('x', 'session', 401))).toMatch(/sesión/i);
    expect(describeRemovalError(new CutoutServerError('x', 'permission', 403))).toMatch(/permiso/i);
  });
});

describe('trabajo media.cutout del servidor (serverJob)', () => {
  const alpha = (w: number, h: number, value = 255) => ({
    data: new Uint8Array(w * h).fill(value),
    width: w,
    height: h,
  });
  const jobDeps = (over: Partial<JobDeps> = {}): JobDeps & { states: string[] } => {
    const states = ['queued', 'running', 'succeeded'];
    return {
      states,
      request: vi.fn(async () => ({ id: 'job-1' })),
      status: vi.fn(async () => ({
        status: (states.shift() ?? 'succeeded') as JobStatus['status'],
        last_error: null,
        result: { output: { path: 'org/brand/ediciones/x.png' } },
      })),
      cancel: vi.fn(async () => undefined),
      loadAlpha: vi.fn(async () => alpha(8, 6)),
      sleep: vi.fn(async () => undefined),
      ...over,
    };
  };
  const run = (deps: JobDeps, extra: Partial<Parameters<typeof removeBackgroundByJob>[1]> = {}) =>
    removeBackgroundByJob(image(), { brandId: BRAND, sourcePath: SOURCE.storage_path, deps, ...extra });

  it('encarga el trabajo con la ruta de la foto, espera y aplica el alfa del PNG', async () => {
    const d = jobDeps({ loadAlpha: vi.fn(async () => alpha(8, 6, 128)) });
    const seen: string[] = [];
    const out = await run(d, { onProgress: (s) => seen.push(s) });
    expect(d.request).toHaveBeenCalledWith(BRAND, SOURCE.storage_path, expect.any(String));
    expect(seen).toEqual(['queued', 'running']);
    expect(out.data[3]).toBe(100); // 200 × 128/255
    expect([out.width, out.height]).toEqual([8, 6]);
  });

  it('reescala el alfa si la foto de la biblioteca tiene otras medidas (misma forma)', async () => {
    const out = await run(jobDeps({ loadAlpha: vi.fn(async () => alpha(16, 12)) }));
    expect([out.width, out.height]).toEqual([8, 6]);
    expect(out.data[3]).toBe(200);
  });

  it('una foto de otra forma, sin sujeto o con el trabajo fallido da error claro', async () => {
    await expect(run(jobDeps({ loadAlpha: vi.fn(async () => alpha(6, 12)) }))).rejects.toBeInstanceOf(
      CutoutServerError,
    );
    await expect(run(jobDeps({ loadAlpha: vi.fn(async () => alpha(8, 6, 0)) }))).rejects.toBeInstanceOf(NoSubjectError);
    const sinSujeto = jobDeps({
      status: vi.fn(async () => ({
        status: 'failed' as const,
        last_error: 'No se ha encontrado nada que recortar en la foto.',
        result: null,
      })),
    });
    await expect(run(sinSujeto)).rejects.toBeInstanceOf(NoSubjectError);
    const roto = jobDeps({
      status: vi.fn(async () => ({ status: 'failed' as const, last_error: 'onnxruntime sin memoria', result: null })),
    });
    await expect(run(roto)).rejects.toMatchObject({ name: 'CutoutServerError', failure: 'server' });
  });

  it('cancelar pide cancel_media_job y corta; sin permiso se dice', async () => {
    const control = new AbortController();
    const d = jobDeps({
      sleep: vi.fn(async () => {
        control.abort();
        throw Object.assign(new Error('Recorte cancelado.'), { name: 'AbortError' });
      }),
    });
    await expect(run(d, { signal: control.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(d.cancel).toHaveBeenCalledWith('job-1');

    const sinPermiso = jobDeps({
      request: vi.fn(async () => Promise.reject(new Error('No tienes permiso para crear medios en esta marca'))),
    });
    await expect(run(sinPermiso)).rejects.toMatchObject({ failure: 'permission' });
  });

  it('si no termina en el plazo, lo cancela y da error de tiempo', async () => {
    const d = jobDeps({ status: vi.fn(async () => ({ status: 'queued' as const, last_error: null, result: null })) });
    await expect(run(d, { timeoutMs: 0 })).rejects.toMatchObject({ failure: 'timeout' });
    expect(d.cancel).toHaveBeenCalledWith('job-1');
  });
});

describe('cliente del servidor', () => {
  const grayMask = (w: number, h: number, value: number) => ({
    data: new Uint8Array(w * h).fill(value),
    width: w,
    height: h,
  });

  it('manda la foto con la sesión y la marca, y aplica la máscara a la foto entera', async () => {
    vi.stubEnv('VITE_CUTOUT_SERVER_URL', '/api/cutout-mask');
    const fetchMock = vi.fn(async () => new Response(new Blob(['png']), { status: 200 }));
    const out = await removeBackgroundOnServer(image(8, 6), {
      brandId: BRAND,
      deps: {
        fetch: fetchMock as unknown as typeof fetch,
        token: async () => 'jwt.a.b',
        encode: async () => new Blob(['jpeg']),
        decodeMask: async () => grayMask(4, 3, 255),
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/cutout-mask');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer jwt.a.b',
      'X-Brand-Id': BRAND,
      'Content-Type': 'image/jpeg',
    });
    expect([out.width, out.height]).toEqual([8, 6]);
    expect(out.data[3]).toBe(200); // alfa de la foto (200) × máscara llena
    vi.unstubAllEnvs();
  });

  it('traduce los estados del servidor: sin sesión, sin permiso, tope, nada que recortar', async () => {
    vi.stubEnv('VITE_CUTOUT_SERVER_URL', '/api/cutout-mask');
    const run = (status: number) =>
      removeBackgroundOnServer(image(), {
        brandId: BRAND,
        deps: {
          fetch: (async () => new Response(JSON.stringify({ error: 'x' }), { status })) as unknown as typeof fetch,
          token: async () => 'jwt.a.b',
          encode: async () => new Blob(['j']),
        },
      });
    await expect(run(401)).rejects.toMatchObject({ failure: 'session' });
    await expect(run(403)).rejects.toMatchObject({ failure: 'permission' });
    await expect(run(429)).rejects.toMatchObject({ failure: 'limit' });
    await expect(run(500)).rejects.toMatchObject({ failure: 'server' });
    await expect(run(422)).rejects.toBeInstanceOf(NoSubjectError);
    vi.unstubAllEnvs();
  });

  it('sin sesión no llama; con una foto demasiado pesada tampoco', async () => {
    vi.stubEnv('VITE_CUTOUT_SERVER_URL', '/api/cutout-mask');
    const fetchMock = vi.fn();
    const base = { fetch: fetchMock as unknown as typeof fetch, encode: async () => new Blob(['j']) };
    await expect(
      removeBackgroundOnServer(image(), { brandId: BRAND, deps: { ...base, token: async () => null } }),
    ).rejects.toMatchObject({
      failure: 'session',
    });
    await expect(
      removeBackgroundOnServer(image(), {
        brandId: BRAND,
        deps: { ...base, token: async () => 'a.b.c', encode: async () => new Blob([new Uint8Array(3_600_000)]) },
      }),
    ).rejects.toMatchObject({ status: 413 });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('la foto se reduce a ≤ 1600 px antes de mandarla y se conserva si ya cabe', () => {
    const big = image(3200, 1600);
    const small = shrinkPixels(big);
    expect([small.width, small.height]).toEqual([1600, 800]);
    const fits = image(100, 80);
    expect(shrinkPixels(fits)).toBe(fits);
  });
});

describe('función del servidor: autorización y límites', () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' };
  const jwt = 'aaa.bbb.ccc';
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  /** Auth devuelve el usuario y la reserva lo que se le pase. */
  const fetchOf = (user: Response, reserve: Response) =>
    vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/auth/v1/user') ? user : reserve,
    ) as unknown as typeof fetch;

  it('el token tiene que tener forma de JWT', () => {
    expect(bearerToken(`Bearer ${jwt}`)).toBe(jwt);
    expect(bearerToken('Bearer nada')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('sin sesión (401) o con marca ausente o mal formada, no llega a gastar nada', async () => {
    const never = vi.fn() as unknown as typeof fetch;
    expect(await authorizeCutout(null, BRAND, { env, fetch: never })).toMatchObject({ ok: false, status: 401 });
    expect(await authorizeCutout(`Bearer ${jwt}`, undefined, { env, fetch: never })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await authorizeCutout(`Bearer ${jwt}`, 'no-es-uuid', { env, fetch: never })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(never).not.toHaveBeenCalled();
  });

  it('sesión caducada → 401; sin permiso de edición en la marca → 403; sin migración → 503', async () => {
    expect(
      await authorizeCutout(`Bearer ${jwt}`, BRAND, { env, fetch: fetchOf(reply({}, 401), reply({})) }),
    ).toMatchObject({ status: 401 });
    const ok = reply({ id: 'u1' });
    expect(
      await authorizeCutout(`Bearer ${jwt}`, BRAND, { env, fetch: fetchOf(ok, reply({ message: 'x' }, 403)) }),
    ).toMatchObject({ status: 403 });
    expect(
      await authorizeCutout(`Bearer ${jwt}`, BRAND, { env, fetch: fetchOf(reply({ id: 'u1' }), reply({}, 404)) }),
    ).toMatchObject({ status: 503 });
  });

  it('tope diario o mensual → 429 con el motivo; con cupo → la reserva', async () => {
    const who = () => reply({ id: 'u1' });
    expect(
      await authorizeCutout(`Bearer ${jwt}`, BRAND, {
        env,
        fetch: fetchOf(who(), reply({ allowed: false, reason: 'day' })),
      }),
    ).toMatchObject({ ok: false, status: 429, reason: 'day' });
    expect(
      await authorizeCutout(`Bearer ${jwt}`, BRAND, {
        env,
        fetch: fetchOf(who(), reply({ allowed: false, reason: 'month' })),
      }),
    ).toMatchObject({ ok: false, status: 429, reason: 'month' });
    expect(
      await authorizeCutout(`Bearer ${jwt}`, BRAND, { env, fetch: fetchOf(who(), reply({ allowed: true, id: 7 })) }),
    ).toEqual({
      ok: true,
      userId: 'u1',
      reservation: 7,
    });
  });

  it('la reserva se pide con el JWT de la persona (nunca con otra clave) y se anota la duración', async () => {
    const f = fetchOf(reply({ id: 'u1' }), reply({ allowed: true, id: 7 }));
    await authorizeCutout(`Bearer ${jwt}`, BRAND, { env, fetch: f });
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const reserveCall = calls.find(([u]) => u.includes('cutout_reserve'))!;
    expect((reserveCall[1].headers as Record<string, string>).Authorization).toBe(`Bearer ${jwt}`);
    expect(JSON.parse(String(reserveCall[1].body))).toEqual({ p_brand_id: BRAND });
    const g = vi.fn(async () => reply(null, 204)) as unknown as typeof fetch;
    await finishCutout(`Bearer ${jwt}`, 7, 2100.4, true, { env, fetch: g });
    const body = JSON.parse(
      String(((g as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body),
    );
    expect(body).toEqual({ p_id: 7, p_ms: 2100, p_ok: true });
  });

  it('la función rechaza antes de gastar CPU: tipo no admitido, foto grande y sin sesión', async () => {
    const post = (headers: Record<string, string>) =>
      POST(new Request('http://x/api/cutout-mask', { method: 'POST', headers, body: new Uint8Array(4) }));
    expect((await post({ 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({ 'content-type': 'image/jpeg', 'content-length': String(MAX_BYTES + 1) })).status).toBe(413);
    const res = await post({ 'content-type': 'image/jpeg' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('el diagnóstico GET dice si están el modelo y los motores', async () => {
    const res = await GET();
    const json = (await res.json()) as { ok: boolean; model: boolean };
    expect(typeof json.ok).toBe('boolean');
    expect(json.model).toBe(true);
  });
});
