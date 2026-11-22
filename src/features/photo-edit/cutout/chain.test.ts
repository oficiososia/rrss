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

function deps(over: Partial<RemovalDeps> = {}): RemovalDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    browserSupport: () => ({ ok: true }),
    browser: vi.fn(async () => {
      calls.push('browser');
      return browserResult();
    }),
    serverAvailable: () => true,
    server: vi.fn(async () => {
      calls.push('server');
      return image();
    }),
    deviceMemory: () => 8,
    ...over,
  };
}

beforeEach(() => {
  resetRemovalSession();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('cadena: navegador → servidor', () => {
  it('con un navegador capaz, recorta en el navegador y no toca el servidor', async () => {
    const d = deps();
    const r = await removeBackground(image(), undefined, undefined, { brandId: BRAND }, d);
    expect(d.calls).toEqual(['browser']);
    expect(r).toMatchObject({ where: 'browser', quality: 'high', model: 'ben2-base-fp16' });
  });

  it('si el navegador falla (modelo, red…), sigue en el servidor y lo dice como calidad básica', async () => {
    const d = deps({
      browser: vi.fn(async () => {
        throw new Error('sesión sin soporte');
      }),
    });
    const r = await removeBackground(image(), undefined, undefined, { brandId: BRAND }, d);
    expect(r).toMatchObject({ where: 'server', quality: 'basic', model: 'isnet-general-use' });
    expect(d.server).toHaveBeenCalledTimes(1);
  });

  it('si el navegador no puede (sin WebAssembly o poca memoria), va directo al servidor', async () => {
    const d = deps({ browserSupport: () => ({ ok: false, reason: 'sin memoria' }) });
    const r = await removeBackground(image(), undefined, undefined, { brandId: BRAND }, d);
    expect(d.browser).not.toHaveBeenCalled();
    expect(r.where).toBe('server');
  });

  it('un dispositivo con menos de 4 GB prueba primero el servidor, y si falla, el navegador', async () => {
    const d = deps({
      deviceMemory: () => 2,
      server: vi.fn(async () => {
        throw new CutoutServerError('sin red', 'network');
      }),
    });
    const r = await removeBackground(image(), undefined, undefined, { brandId: BRAND }, d);
    expect(r.where).toBe('browser');
    expect(d.server).toHaveBeenCalledTimes(1);
  });

  it('tras quedarse sin memoria en el navegador, las fotos siguientes van directas al servidor', async () => {
    const d = deps({
      browser: vi.fn(async () => {
        throw new RangeError('Array buffer allocation failed');
      }),
    });
    await removeBackground(image(), undefined, undefined, { brandId: BRAND }, d);
    const d2 = deps();
    const r = await removeBackground(image(), undefined, undefined, { brandId: BRAND }, d2);
    expect(r.where).toBe('server');
    expect(d2.browser).not.toHaveBeenCalled();
  });

  it('sin marca o sin servidor no hay respaldo: se devuelve el error del navegador', async () => {
    const boom = new Error('fallo del modelo');
    const failing = { browser: vi.fn(async () => Promise.reject(boom)) };
    await expect(removeBackground(image(), undefined, undefined, {}, deps(failing))).rejects.toBe(boom);
    await expect(
      removeBackground(
        image(),
        undefined,
        undefined,
        { brandId: BRAND },
        deps({ ...failing, serverAvailable: () => false }),
      ),
    ).rejects.toBe(boom);
  });

  it('si fallan los dos, se enseña el primer error', async () => {
    const first = new Error('primero');
    const d = deps({
      browser: vi.fn(async () => Promise.reject(first)),
      server: vi.fn(async () => Promise.reject(new CutoutServerError('segundo', 'server'))),
    });
    await expect(removeBackground(image(), undefined, undefined, { brandId: BRAND }, d)).rejects.toBe(first);
  });

  it('«nada que recortar» y cancelar cortan la cadena: no se prueba otro motor', async () => {
    const none = deps({ browser: vi.fn(async () => Promise.reject(new NoSubjectError())) });
    await expect(removeBackground(image(), undefined, undefined, { brandId: BRAND }, none)).rejects.toBeInstanceOf(
      NoSubjectError,
    );
    expect(none.server).not.toHaveBeenCalled();
    const abort = Object.assign(new Error('cancelado'), { name: 'AbortError' });
    const cancelled = deps({ browser: vi.fn(async () => Promise.reject(abort)) });
    await expect(removeBackground(image(), undefined, undefined, { brandId: BRAND }, cancelled)).rejects.toBe(abort);
    expect(cancelled.server).not.toHaveBeenCalled();
  });

  it('el botón sale si el navegador puede o si hay servidor', () => {
    expect(removalSupport({ browserSupport: () => ({ ok: false, reason: 'x' }), serverAvailable: () => true }).ok).toBe(
      true,
    );
    expect(
      removalSupport({ browserSupport: () => ({ ok: false, reason: 'x' }), serverAvailable: () => false }).ok,
    ).toBe(false);
    expect(removalSupport({ browserSupport: () => ({ ok: true }), serverAvailable: () => false }).ok).toBe(true);
  });

  it('los fallos del servidor se explican en claro', () => {
    expect(describeRemovalError(new CutoutServerError('Has llegado al tope diario', 'limit', 429))).toMatch(
      /tope diario.*mañana/,
    );
    expect(describeRemovalError(new CutoutServerError('x', 'session', 401))).toMatch(/sesión/i);
    expect(describeRemovalError(new CutoutServerError('x', 'permission', 403))).toMatch(/permiso/i);
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
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }));
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
