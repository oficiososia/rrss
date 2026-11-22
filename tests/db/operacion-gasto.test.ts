// Operación y control de gasto (migración 20261219010000, docs/operacion-gasto.md):
// tope global de IA, panel «Gasto y uso», avisos de plataforma y limpieza de la
// cola de archivos de marcas borradas. Contra las migraciones reales.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RpcClient } from '../../supabase/functions/_shared/ai/contract.ts';
import { loadMediaStorageConfig } from '../../supabase/functions/_shared/storage/config.ts';
import type { ObjectStorage } from '../../supabase/functions/_shared/storage/contract.ts';
import { createMediaStorageHandler } from '../../supabase/functions/media-storage/handler.ts';
import {
  as,
  asService,
  createBrand,
  createDb,
  createOrg,
  createUser,
  serviceRpc,
  setAiQuota,
  type Db,
  type Row,
  type TestUser,
} from './helpers';

let db: Db;
let root: TestUser;
let n = 0;

interface Tenant {
  owner: TestUser;
  org: string;
  brand: string;
  name: string;
}

const M = 1_000_000;

beforeAll(async () => {
  db = await createDb();
  root = await createUser(db, 'root@gasto.test', 'Root');
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [root.id]);
});

afterAll(async () => {
  await db?.close();
});

async function tenant(limitMicros?: number): Promise<Tenant> {
  n += 1;
  const owner = await createUser(db, `propietaria${n}@gasto${n}.test`);
  const name = `Organización ${n}`;
  const org = await createOrg(db, owner, name);
  const brand = await createBrand(db, owner, org, `Marca ${n}`);
  if (limitMicros !== undefined) await setAiQuota(db, root, org, limitMicros);
  return { owner, org, brand, name };
}

const reserve = (t: Tenant, micros: number, task = 'text') =>
  serviceRpc<Row & { id: string }>(db, 'ai_reserve_generation', {
    p_user_id: t.owner.id,
    p_brand_id: t.brand,
    p_task: task,
    p_purpose: 'post.caption',
    p_provider: 'simulated',
    p_model: 'sim-1',
    p_reserve_micros: micros,
  });

const complete = (id: string, cost: number) =>
  serviceRpc(db, 'ai_complete_generation', { p_generation_id: id, p_cost_micros: cost });

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

const setCap = (value: string) =>
  as(db, root, `select public.admin_set_integration_setting('AI_GLOBAL_MONTHLY_CAP', $1)`, [value]);
const clearCap = () => db.query(`delete from private.integration_settings where setting_key = 'AI_GLOBAL_MONTHLY_CAP'`);
const period = () => new Date().toISOString().slice(0, 7) + '-01';

describe('tope global de gasto de IA', () => {
  it('sin tope no cambia nada; con tope, rechaza con AI003 al pasarlo y lo que ya se gastó cuenta', async () => {
    const a = await tenant(10 * M);
    const b = await tenant(10 * M);
    const first = await reserve(a, 600_000);
    await complete(first.id, 600_000);

    await setCap('1');
    // Quedan 400.000: 500.000 no caben (aunque el cupo de B sea de 10), 400.000 sí.
    expect(await code(reserve(b, 500_000))).toBe('AI003');
    const ok = await reserve(b, 400_000);
    expect(ok.id).toBeTruthy();
    // Ahora está justo en el tope: ni una más, de ninguna organización.
    expect(await code(reserve(a, 1))).toBe('AI003');
    expect(await code(reserve(b, 1, 'image'))).toBe('AI003');

    // Si falla una generación, su reserva se devuelve y vuelve a haber hueco.
    await serviceRpc(db, 'ai_fail_generation', { p_generation_id: ok.id, p_error_code: 'x' });
    expect((await reserve(a, 100_000)).id).toBeTruthy();

    // El mensaje es claro y trae las cifras.
    await reserve(a, 300_000).catch(() => undefined);
    const err = await reserve(a, 900_000).catch((e: { code?: string; message: string; detail?: string }) => e);
    expect((err as { code?: string }).code).toBe('AI003');
    expect((err as { message: string }).message).toMatch(/pausa/);
    expect(JSON.parse((err as { detail: string }).detail)).toMatchObject({ cap_micros: M });

    // Quitar el tope libera la IA.
    await clearCap();
    expect((await reserve(b, 500_000)).id).toBeTruthy();
  });

  it('el estado del tope lo ve solo el superadministrador y marca la pausa', async () => {
    await clearCap();
    const [sin] = await as<{ s: { cap_micros: number | null; paused: boolean } }>(
      db,
      root,
      `select public.platform_ai_global_status() as s`,
    );
    expect(sin!.s.cap_micros).toBeNull();
    expect(sin!.s.paused).toBe(false);

    await setCap('0.5');
    const [con] = await as<{ s: { cap_micros: number; paused: boolean; committed_micros: number } }>(
      db,
      root,
      `select public.platform_ai_global_status() as s`,
    );
    expect(Number(con!.s.cap_micros)).toBe(500_000);
    expect(con!.s.paused).toBe(Number(con!.s.committed_micros) >= 500_000);
    await clearCap();
  });

  it('un valor mal escrito no se interpreta como tope (no apaga la IA por error)', async () => {
    await db.query(
      `insert into private.integration_settings (setting_key, plain_value) values ('AI_GLOBAL_MONTHLY_CAP', 'mucho')
       on conflict (setting_key) do update set plain_value = 'mucho'`,
    );
    const [row] = await db.query<{ c: number | null }>(`select private.ai_global_cap_micros() as c`);
    expect(row!.c).toBeNull();
    await clearCap();
  });

  it('las reservas caducadas de otras organizaciones no cuentan para el tope', async () => {
    const a = await tenant(10 * M);
    const stale = await reserve(a, 900_000);
    await db.query(`update public.ai_generations set reserved_until = now() - interval '1 minute' where id = $1`, [
      stale.id,
    ]);
    const [antes] = await db.query<{ c: string }>(`select private.ai_global_committed($1::date)::text as c`, [
      period(),
    ]);
    await setCap('1000');
    const b = await tenant(10 * M);
    expect((await reserve(b, 100)).id).toBeTruthy();
    const [despues] = await db.query<{ c: string }>(`select private.ai_global_committed($1::date)::text as c`, [
      period(),
    ]);
    expect(Number(despues!.c)).toBeLessThanOrEqual(Number(antes!.c) + 100);
    await clearCap();
  });

  it('el catálogo de Integraciones conoce el ajuste, no es secreto y solo vale con la forma esperada', async () => {
    const [row] = await db.query<{ is_secret: boolean; integration: string }>(
      `select is_secret, integration from private.integration_setting_keys where setting_key = 'AI_GLOBAL_MONTHLY_CAP'`,
    );
    expect(row).toEqual({ is_secret: false, integration: 'ai_text' });
  });
});

describe('«Gasto y uso»', () => {
  it('coste por tipo, cupo consumido, trabajos de medios con segundos de máquina y almacenamiento', async () => {
    const t = await tenant(10 * M);
    const text = await reserve(t, 300_000, 'text');
    await complete(text.id, 200_000);
    const image = await reserve(t, 800_000, 'image');
    await complete(image.id, 700_000);
    const tr = await reserve(t, 100_000, 'transcription');
    await complete(tr.id, 50_000);
    await reserve(t, 400_000, 'text'); // reserva viva: cuenta como comprometido, no como coste

    const job = (status: string, kind: string, result: unknown) =>
      db.query(
        `insert into public.jobs (organization_id, brand_id, kind, idempotency_key, status, finished_at, result, attempts)
         values ($1, $2, $3, $4, $5::public.job_status, now(), $6::jsonb, 1)`,
        [t.org, t.brand, kind, randomUUID(), status, result === null ? null : JSON.stringify(result)],
      );
    await job('succeeded', 'media.reel.template', { timings: { downloadMs: 1000, renderMs: 8000, uploadMs: 1500 } });
    await job('succeeded', 'media.cutout', { timings: { inferenceMs: 2500 }, peakRssMb: 900 });
    await job('succeeded', 'media.image.process', { output: {} }); // sin tiempos: no se inventa
    await job('failed', 'media.cutout', null);
    await job('succeeded', 'other.kind', { timings: { renderMs: 99_999 } }); // no es del trabajador de medios

    await db.query(
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes, storage_backend)
       values ($1, $2, 'image', $3, 'a.jpg', 'image/jpeg', 5000, 'r2'), ($1, $2, 'image', $4, 'b.jpg', 'image/jpeg', 1000, 'supabase')`,
      [
        t.brand,
        t.org,
        `${t.org}/${t.brand}/media/${randomUUID()}.jpg`,
        `${t.org}/${t.brand}/media/${randomUUID()}.jpg`,
      ],
    );

    const rows = await as<Row & Record<string, string | number | boolean | null>>(
      db,
      root,
      `select * from public.platform_usage_overview($1::date) where organization_id = $2`,
      [period(), t.org],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(Number(row.cost_text_micros)).toBe(200_000);
    expect(Number(row.cost_image_micros)).toBe(700_000);
    expect(Number(row.cost_video_micros)).toBe(0);
    expect(Number(row.cost_transcription_micros)).toBe(50_000);
    expect(Number(row.ai_cost_micros)).toBe(950_000);
    expect(Number(row.ai_committed_micros)).toBe(950_000 + 400_000);
    expect(Number(row.ai_limit_micros)).toBe(10 * M);
    expect(row.ai_limit_overridden).toBe(true);
    expect(Number(row.generations)).toBe(3);
    expect(Number(row.media_jobs)).toBe(4);
    expect(Number(row.media_jobs_succeeded)).toBe(3);
    expect(Number(row.media_jobs_failed)).toBe(1);
    expect(Number(row.media_machine_seconds)).toBe(13);
    expect(Number(row.media_jobs_without_timings)).toBe(1);
    expect(Number(row.storage_bytes)).toBe(6000);

    const brands = await as<Row>(
      db,
      root,
      `select * from public.platform_storage_by_brand() where organization_id = $1`,
      [t.org],
    );
    expect(brands).toHaveLength(1);
    expect(Number(brands[0]!.bytes)).toBe(6000);
    expect(Number(brands[0]!.r2_bytes)).toBe(5000);
    expect(Number(brands[0]!.assets)).toBe(2);
  });

  it('pide el primer día del mes', async () => {
    await expect(as(db, root, `select * from public.platform_usage_overview('2026-11-15'::date)`)).rejects.toThrow(
      /primer día del mes/,
    );
  });

  it('un mes sin actividad sale a cero, no vacío', async () => {
    const t = await tenant();
    const [row] = await as<Row>(
      db,
      root,
      `select * from public.platform_usage_overview('2020-01-01'::date) where organization_id = $1`,
      [t.org],
    );
    expect(Number(row!.ai_cost_micros)).toBe(0);
    expect(Number(row!.media_jobs)).toBe(0);
  });
});

describe('avisos de plataforma', () => {
  const open = async (kind: string, org?: string) =>
    db.query<Row>(
      `select * from public.platform_alerts where kind = $1 and resolved_at is null and ($2::uuid is null or organization_id = $2)`,
      [kind, org ?? null],
    );

  it('cupo de IA: aviso al 80 % y otro al 100 %, sin duplicarse al repetir', async () => {
    const t = await tenant(10 * M);
    const g = await reserve(t, 8_500_000);
    await complete(g.id, 8_500_000);
    expect(
      (await as<{ n: number }>(db, root, `select public.platform_alerts_refresh() as n`))[0]!.n,
    ).toBeGreaterThanOrEqual(1);
    const ochenta = await open('ai_quota_80', t.org);
    expect(ochenta).toHaveLength(1);
    expect(ochenta[0]!.title).toContain(t.name);
    expect(await open('ai_quota_100', t.org)).toHaveLength(0);
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('ai_quota_80', t.org)).toHaveLength(1);

    const g2 = await reserve(t, 1_500_000);
    await complete(g2.id, 1_500_000);
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('ai_quota_100', t.org)).toHaveLength(1);
    const data = (await open('ai_quota_100', t.org))[0]!.data as { limit_micros: number; committed_micros: number };
    expect(Number(data.committed_micros)).toBe(10 * M);

    // «Visto» lo cierra y, al ser una situación continua, no reaparece.
    const id = (await open('ai_quota_100', t.org))[0]!.id as string;
    expect((await as<{ n: number }>(db, root, `select public.platform_alert_resolve($1) as n`, [id]))[0]!.n).toBe(1);
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('ai_quota_100', t.org)).toHaveLength(0);
    const [closed] = await db.query<Row>(`select resolved_by from public.platform_alerts where id = $1`, [id]);
    expect(closed!.resolved_by).toBe(root.id);
  });

  it('una organización sin cupo o por debajo del 80 % no genera aviso', async () => {
    const sin = await tenant();
    const bajo = await tenant(10 * M);
    const g = await reserve(bajo, 1 * M);
    await complete(g.id, 1 * M);
    await as(db, root, `select public.platform_alerts_refresh()`);
    for (const org of [sin.org, bajo.org]) {
      expect(await db.query(`select 1 from public.platform_alerts where organization_id = $1`, [org])).toEqual([]);
    }
  });

  it('tope global: aviso al 80 % y al alcanzarlo', async () => {
    await db.query(`delete from public.platform_alerts where kind like 'ai_global%'`);
    const [row] = await db.query<{ c: string }>(`select private.ai_global_committed($1::date)::text as c`, [period()]);
    const committed = Number(row!.c);
    await setCap(String((committed / 0.9 / M).toFixed(6)));
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('ai_global_cap_80')).toHaveLength(1);
    expect(await open('ai_global_cap_reached')).toHaveLength(0);
    await setCap(String(((committed - 1) / M).toFixed(6)));
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('ai_global_cap_reached')).toHaveLength(1);
    await clearCap();
  });

  it('trabajos de medios que fallan: 3 en 24 horas avisan, 2 no; y reabre si vuelve a fallar tras verlo', async () => {
    const malo = await tenant();
    const casiMalo = await tenant();
    const fail = (t: Tenant, finished = 'now()') =>
      db.query(
        `insert into public.jobs (organization_id, brand_id, kind, idempotency_key, status, finished_at, last_error, attempts)
         values ($1, $2, 'media.reel.template', $3, 'failed', ${finished}, 'ffmpeg terminó con código 1', 3)`,
        [t.org, t.brand, randomUUID()],
      );
    await fail(malo);
    await fail(malo);
    await fail(casiMalo);
    await fail(casiMalo);
    await fail(malo, `now() - interval '2 days'`); // fuera de las 24 h: no cuenta
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('media_jobs_failing', malo.org)).toHaveLength(0);

    await fail(malo);
    await as(db, root, `select public.platform_alerts_refresh()`);
    const aviso = await open('media_jobs_failing', malo.org);
    expect(aviso).toHaveLength(1);
    expect(aviso[0]!.detail).toContain('ffmpeg');
    expect(await open('media_jobs_failing', casiMalo.org)).toHaveLength(0);

    await as(db, root, `select public.platform_alert_resolve($1)`, [aviso[0]!.id]);
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('media_jobs_failing', malo.org)).toHaveLength(0);
    await fail(malo); // otro fallo posterior a «Visto»
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await open('media_jobs_failing', malo.org)).toHaveLength(1);
  });

  it('funciones programadas: lee las ejecuciones fallidas de pg_cron y las llamadas con error de pg_net', async () => {
    // pg_cron y pg_net no existen en las pruebas: se imitan con la forma de sus tablas.
    await db.exec(`
      create schema if not exists cron;
      create table if not exists cron.job (jobid bigint primary key, jobname text);
      create table if not exists cron.job_run_details (jobid bigint, status text, return_message text, start_time timestamptz);
      create schema if not exists net;
      create table if not exists net._http_response (id bigint, status_code integer, timed_out boolean, error_msg text, created timestamptz);
      insert into cron.job values (1, 'rrss-social-publish'), (2, 'otra-cosa');
      insert into cron.job_run_details values
        (1, 'succeeded', null, now()),
        (1, 'failed', 'function private.social_publish_dispatch() does not exist', now()),
        (2, 'failed', 'no es nuestra', now());
      insert into net._http_response values (1, 200, false, null, now()), (2, 500, false, null, now()), (3, null, true, null, now());
    `);
    await db.query(
      `delete from public.platform_alerts where kind in ('scheduled_job_failed', 'scheduled_http_failed')`,
    );
    await as(db, root, `select public.platform_alerts_refresh()`);
    const jobs = await open('scheduled_job_failed');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.title).toContain('rrss-social-publish');
    expect(jobs[0]!.detail).toContain('does not exist');
    const http = await open('scheduled_http_failed');
    expect(http).toHaveLength(1);
    expect(http[0]!.detail).toContain('2 llamadas');
    await db.exec(`drop schema cron cascade; drop schema net cascade;`);
  });

  it('el borrado de una organización se lleva sus avisos', async () => {
    const t = await tenant(10 * M);
    const g = await reserve(t, 9 * M);
    await complete(g.id, 9 * M);
    await as(db, root, `select public.platform_alerts_refresh()`);
    expect(await db.query(`select 1 from public.platform_alerts where organization_id = $1`, [t.org])).not.toEqual([]);
    await db.query(`delete from public.organizations where id = $1`, [t.org]);
    expect(await db.query(`select 1 from public.platform_alerts where organization_id = $1`, [t.org])).toEqual([]);
  });
});

describe('limpieza de la cola de marcas y organizaciones borradas', () => {
  const SERVICE = 'clave-de-servicio';

  const rpc: RpcClient = async (fn, args) => {
    const names = Object.keys(args).filter((k) => args[k] !== undefined);
    const list = names.map((k, i) => `${k} => $${i + 1}${k === 'p_min_age' ? '::interval' : ''}`).join(', ');
    try {
      const rows = await asService<{ data: unknown }>(
        db,
        `select to_jsonb(public.${fn}(${list})) as data`,
        names.map((k) => args[k]),
      );
      return { data: rows[0]?.data ?? null, error: null };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { data: null, error: { code, message } };
    }
  };

  function memory(backend: 'supabase' | 'r2'): ObjectStorage & { objects: Set<string> } {
    const objects = new Set<string>();
    return {
      backend,
      objects,
      signGet: async (key) => `https://${backend}.test/${key}`,
      signPut: async (key, contentType, _bytes, seconds) => ({
        url: `https://${backend}.test/${key}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        expiresIn: seconds,
      }),
      head: async (key) => (objects.has(key) ? { bytes: 1 } : null),
      put: async (key) => void objects.add(key),
      remove: async (keys) => {
        keys.forEach((k) => objects.delete(k));
        return { failed: [] };
      },
      list: async (prefix) => [...objects].filter((k) => k.startsWith(prefix)).map((key) => ({ key, bytes: 1 })),
    };
  }

  const post = async (h: (r: Request) => Promise<Response>, token: string) => {
    const res = await h(
      new Request('http://funciones.test/functions/v1/media-storage/purge-cleanup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: '{}',
      }),
    );
    return { status: res.status, json: (await res.json()) as { removed: string[] } };
  };

  it('barre las rutas de marcas que ya no existen (con más de una hora) y deja lo demás', async () => {
    const t = await tenant();
    const sb = memory('supabase');
    const handler = createMediaStorageHandler({
      config: loadMediaStorageConfig({}),
      r2: null,
      supabase: sb,
      rpc,
      authenticate: async () => null,
      isServiceToken: (token) => token === SERVICE,
      assetsForPaths: async () => [],
      cleanupForPaths: async () => [],
    });

    const gone = randomUUID();
    const goneOrg = randomUUID();
    const path = (org: string, brand: string) => `${org}/${brand}/media/${randomUUID()}.jpg`;
    const vieja = path(goneOrg, gone);
    const reciente = path(goneOrg, gone);
    const deMarcaViva = path(t.org, t.brand);
    const insert = (p: string, org: string, brand: string, age: string) =>
      db.query(
        `insert into public.storage_cleanup_queue (organization_id, brand_id, storage_path, created_at)
         values ($1, $2, $3, now() - $4::interval)`,
        [org, brand, p, age],
      );
    await insert(vieja, goneOrg, gone, '3 hours');
    await insert(reciente, goneOrg, gone, '5 minutes');
    await insert(deMarcaViva, t.org, t.brand, '3 hours');
    [vieja, reciente, deMarcaViva].forEach((p) => sb.objects.add(p));

    expect((await post(handler, 'jwt-de-una-persona')).status).toBe(401);
    const res = await post(handler, SERVICE);
    expect(res.status).toBe(200);
    expect(res.json.removed).toEqual([vieja]);
    expect(sb.objects.has(vieja)).toBe(false);
    expect(sb.objects.has(reciente)).toBe(true);
    expect(sb.objects.has(deMarcaViva)).toBe(true);
    const left = await db.query<{ storage_path: string }>(
      `select storage_path from public.storage_cleanup_queue where storage_path = any($1::text[]) order by 1`,
      [[vieja, reciente, deMarcaViva]],
    );
    expect(left.map((r) => r.storage_path).sort()).toEqual([reciente, deMarcaViva].sort());

    // Una segunda pasada no encuentra nada más.
    expect((await post(handler, SERVICE)).json.removed).toEqual([]);
  });

  it('al borrar una organización de verdad, sus rutas quedan barribles por el servidor', async () => {
    const t = await tenant();
    const p = `${t.org}/${t.brand}/media/${randomUUID()}.jpg`;
    await db.query(
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'a.jpg', 'image/jpeg', 10)`,
      [t.brand, t.org, p],
    );
    await db.query(`delete from public.organizations where id = $1`, [t.org]);
    await db.query(
      `update public.storage_cleanup_queue set created_at = now() - interval '2 hours' where storage_path = $1`,
      [p],
    );
    const [row] = await asService<{ r: { storage_path: string; backend: string }[] }>(
      db,
      `select public.storage_cleanup_orphans() as r`,
    );
    expect(row!.r.map((x) => x.storage_path)).toContain(p);
  });
});

describe('tope mensual de trabajos de medios por marca', () => {
  const setJobsCap = (value: string) =>
    as(db, root, `select public.admin_set_integration_setting('MEDIA_JOBS_MONTHLY_PER_BRAND', $1)`, [value]);
  const clearJobsCap = () =>
    db.query(`delete from private.integration_settings where setting_key = 'MEDIA_JOBS_MONTHLY_PER_BRAND'`);
  const addJobs = (t: Tenant, n: number, status = 'succeeded', age = '0 days') =>
    db.query(
      `insert into public.jobs (organization_id, brand_id, kind, idempotency_key, status, finished_at, created_at)
       select $1, $2, 'media.cutout', gen_random_uuid()::text, $4::public.job_status, now(), now() - $5::interval
       from generate_series(1, $3)`,
      [t.org, t.brand, n, status, age],
    );
  const request = (t: Tenant) =>
    as(db, t.owner, `select id from public.request_media_job($1, 'media.cutout', '{}'::jsonb, $2)`, [
      t.brand,
      `clave-${randomUUID()}`,
    ]);

  it('sin ajuste el tope es de 400 y 0 lo quita', async () => {
    await clearJobsCap();
    expect((await db.query<{ c: number }>(`select private.media_jobs_monthly_max() as c`))[0]!.c).toBe(400);
    await setJobsCap('0');
    expect((await db.query<{ c: number | null }>(`select private.media_jobs_monthly_max() as c`))[0]!.c).toBeNull();
    await clearJobsCap();
  });

  it('al llegar al tope, la marca no puede encargar más y el mensaje lo dice; otra marca sí', async () => {
    const a = await tenant();
    const b = await tenant();
    await setJobsCap('3');
    await addJobs(a, 3, 'succeeded');
    await addJobs(a, 5, 'cancelled'); // los cancelados no cuentan
    await addJobs(a, 4, 'succeeded', '45 days'); // meses anteriores, tampoco
    const error = await request(a).catch((e: { code?: string; message: string }) => e);
    expect((error as { message: string }).message).toMatch(/tope mensual de 3 trabajos de medios/);
    expect((error as { message: string }).message).toMatch(/día 1/);
    // La otra marca, con su propio contador, no se ve afectada (falla después por otra cosa: no hay foto).
    const other = await request(b).catch((e: { message: string }) => e);
    expect((other as { message?: string }).message ?? '').not.toMatch(/tope mensual/);
    // Subir el tope libera a la marca.
    await setJobsCap('4');
    const again = await request(a).catch((e: { message: string }) => e);
    expect((again as { message?: string }).message ?? '').not.toMatch(/tope mensual/);
    await clearJobsCap();
  });

  it('la marca que llega al tope deja un aviso, y la pantalla ve cuántos lleva', async () => {
    const t = await tenant();
    await setJobsCap('2');
    await addJobs(t, 2);
    await as(db, root, `select public.platform_alerts_refresh()`);
    const [aviso] = await db.query<{ title: string; data: { jobs: number; cap: number } }>(
      `select title, data from public.platform_alerts where kind = 'media_jobs_cap_reached' and organization_id = $1`,
      [t.org],
    );
    expect(aviso!.title).toContain(t.name);
    expect(aviso!.data).toMatchObject({ jobs: 2, cap: 2 });
    const [row] = await as<{ media_jobs_month: number; media_jobs_cap: number | null }>(
      db,
      root,
      `select media_jobs_month, media_jobs_cap from public.platform_storage_by_brand() where brand_id = $1`,
      [t.brand],
    );
    expect(Number(row!.media_jobs_month)).toBe(2);
    expect(Number(row!.media_jobs_cap)).toBe(2);
    await clearJobsCap();
  });
});

describe('precios de IA sin verificar y marcas del panel', () => {
  it('clasifica cada modelo usado: verificado, sin verificar, desconocido, simulado, sin contrastar y sin precio', async () => {
    const t = await tenant(100 * M);
    const gen = (task: string, provider: string, model: string, cost: number) =>
      db.query(
        `insert into public.ai_generations (brand_id, organization_id, requested_by, task, purpose, provider, model, status,
                                            period_start, reserved_micros, reserved_until, cost_micros, finished_at)
         values ($1, $2, $3, $4::public.ai_task, 'x', $5, $6, 'succeeded', $7::date, 1, now(), $8, now())`,
        [t.brand, t.org, t.owner.id, task, provider, model, period(), cost],
      );
    const model = (provider: string, name: string, verified: boolean) =>
      db.query(
        `insert into public.ai_media_models (provider, model, task, display_name, billing_unit, price_micros,
                                             price_checked_on, price_source, price_verified, data_region, trains_on_inputs, delivery)
         values ($1, $2, 'image', $2, 'image', 100, now(), 'prueba', $3, 'eu', 'no', 'sync')`,
        [provider, name, verified],
      );
    await model('prov-ok', 'img-ok', true);
    await model('prov-no', 'img-no', false);
    await gen('image', 'prov-ok', 'img-ok', 100);
    await gen('image', 'prov-no', 'img-no', 200);
    await gen('image', 'prov-ghost', 'img-x', 300);
    await gen('text', 'simulated', 'sim-1', 10);
    await gen('text', 'openai', 'gpt-con-precio', 20);
    await gen('text', 'openai', 'gpt-sin-precio', 30);
    await db.query(
      `insert into private.integration_settings (setting_key, plain_value) values ('AI_PRICES', $1)
       on conflict (setting_key) do update set plain_value = excluded.plain_value`,
      [JSON.stringify({ 'openai/gpt-con-precio': { input_tokens: 1 } })],
    );

    const rows = await as<{ provider: string; model: string; status: string; generations: number }>(
      db,
      root,
      `select provider, model, status, generations from public.platform_price_review($1::date)`,
      [period()],
    );
    const status = (provider: string, model: string) =>
      rows.find((r) => r.provider === provider && r.model === model)?.status;
    expect(status('prov-ok', 'img-ok')).toBe('verified');
    expect(status('prov-no', 'img-no')).toBe('unverified');
    expect(status('prov-ghost', 'img-x')).toBe('unknown');
    expect(status('simulated', 'sim-1')).toBe('simulated');
    expect(status('openai', 'gpt-con-precio')).toBe('unconfirmed');
    expect(status('openai', 'gpt-sin-precio')).toBe('no_price');
    await db.query(`delete from private.integration_settings where setting_key = 'AI_PRICES'`);
  });

  it('el panel marca el cupo puesto a mano y el plan sin límites', async () => {
    const t = await tenant(5 * M);
    const [row] = await as<{ ai_limit_overridden: boolean; plan_code: string; plan_unlimited: boolean }>(
      db,
      root,
      `select ai_limit_overridden, plan_code, plan_unlimited from public.platform_usage_overview($1::date) where organization_id = $2`,
      [period(), t.org],
    );
    // En las pruebas las organizaciones nacen en el plan «Heredado» (sin límites).
    expect(row).toEqual({ ai_limit_overridden: true, plan_code: 'legacy', plan_unlimited: true });
  });

  it('platform_alert_external solo lo llama el servidor y solo con tipos conocidos', async () => {
    await expect(
      as(db, root, `select public.platform_alert_external('worker_machine_long', 'k', 't', 'd', '{}')`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asService(db, `select public.platform_alert_external('inventado', 'k', 't', 'd', '{}'::jsonb)`),
    ).rejects.toThrow(/no admitido/);
    const [ok] = await asService<{ r: boolean }>(
      db,
      `select public.platform_alert_external('worker_machine_long', 'worker_machine_long:test', 't', 'd', '{}'::jsonb) as r`,
    );
    expect(ok!.r).toBe(true);
  });
});
