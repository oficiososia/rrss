// «Animar esta foto con IA» (docs/ia-medios.md, §15) contra las migraciones
// reales y el adaptador de fal.ai con HTTP simulado (ninguna llamada de pago):
//   · migración 20261217010000: dos modelos de fal sembrados INACTIVOS y con el
//     precio sin verificar, operación `animate_photo` solo de vídeo, guarda de
//     la procedencia `ai_animation`, marca de contenido generado con IA;
//   · elección de modelo: principal y respaldo, nunca uno de «generar», y fuera
//     de la UE solo con AI_MEDIA_ALLOW_NON_EU;
//   · función `ai-media` (video.options, video.estimate, video.animate): lo que
//     se manda a fal.ai (resolución fijada, sin proporción, duración con tope),
//     la proporción según la foto, el coste máximo antes de gastar;
//   · cupo (reserva y devolución), permisos, aislamiento y modo agencia;
//   · el resultado: vídeo nuevo en «Vídeos con IA» con su procedencia; la foto
//     original no cambia.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RpcClient } from '../../supabase/functions/_shared/ai/contract.ts';
import type { MediaReader } from '../../supabase/functions/_shared/ai/media/contract.ts';
import { mediaModelsFromRows, resolveAnimateModel, resolveMediaModel, type MediaModelRow } from '../../supabase/functions/_shared/ai/media/models.ts';
import { createMediaRuntime } from '../../supabase/functions/_shared/ai/media/runtime.ts';
import { probeIntegration } from '../../supabase/functions/_shared/integrations/probes.ts';
import { createMediaProviders } from '../../supabase/functions/_shared/ai/media/config.ts';
import {
  createSupabaseMediaStorage,
  provenanceJson,
  type GeneratedAssetRow,
  type MediaStorageBackend,
} from '../../supabase/functions/_shared/ai/media/supabase-storage.ts';
import { animateAspectFor, createAiMediaHandler } from '../../supabase/functions/ai-media/handler.ts';
import {
  aiBrandAccess,
  as,
  asService,
  assetPath,
  createBrand,
  createDb,
  createOrg,
  createUser,
  denied,
  join,
  rpcStatement,
  serviceRpc,
  setAiQuota,
  type Db,
  type Row,
  type TestUser,
} from './helpers';

const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4]);
const H3 = 'minimax/h3/image-to-video';
const KLING = 'fal-ai/kling-video/v3/standard/image-to-video';
const FAL_ENV = { FAL_KEY: 'clave-de-prueba', AI_MEDIA_ALLOW_NON_EU: 'true' };

let db: Db;
let root: TestUser;
let n = 0;
const sessions = new Map<string, TestUser>();

const rpc: RpcClient = async (fn, args) => {
  try {
    if (fn === 'claim_jobs') {
      const { sql, params } = rpcStatement(fn, args);
      const rows = await asService<{ data: Row }>(db, sql, params);
      return { data: rows.map((r) => r.data), error: null };
    }
    return { data: await serviceRpc(db, fn, args), error: null };
  } catch (error) {
    const { code, message, detail } = error as { code?: string; message: string; detail?: string };
    return { data: null, error: { code, message, details: detail ?? null } };
  }
};

const reader: MediaReader = {
  getGeneration: async (id) => {
    const rows = await asService<{
      id: string;
      organization_id: string;
      brand_id: string;
      provider: string;
      status: string;
    }>(
      db,
      `select id, organization_id, brand_id, provider, status::text as status from public.ai_generations where id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },
  getJob: async (organizationId, key) => {
    const rows = await asService<{ id: string; status: string; payload: unknown }>(
      db,
      `select id, status::text as status, payload from public.jobs where organization_id = $1 and idempotency_key = $2`,
      [organizationId, key],
    );
    return rows[0] ?? null;
  },
};

const backend: MediaStorageBackend = {
  async upload(path, bytes, contentType) {
    await asService(
      db,
      `insert into storage.objects (bucket_id, name, metadata) values ('brand-media', $1, $2::jsonb)
       on conflict (bucket_id, name) do update set metadata = excluded.metadata`,
      [path, JSON.stringify({ size: bytes.byteLength, mimetype: contentType })],
    );
  },
  async saveAsset(row: GeneratedAssetRow) {
    const [saved] = await asService<{ id: string }>(
      db,
      `insert into public.media_assets (brand_id, organization_id, kind, origin, storage_path, file_name, mime_type, bytes,
         width, height, duration_ms, folder, tags, provenance, created_by)
       values ($1, $2, $3::public.asset_kind, 'generated', $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::jsonb, $14)
       on conflict (storage_path) do update set bytes = excluded.bytes, provenance = excluded.provenance
       returning id`,
      [
        row.brand_id,
        row.organization_id,
        row.kind,
        row.storage_path,
        row.file_name,
        row.mime_type,
        row.bytes,
        row.width,
        row.height,
        row.duration_ms ?? null,
        row.folder,
        row.tags,
        JSON.stringify(row.provenance),
        row.created_by,
      ],
    );
    return { id: saved!.id };
  },
};
const storage = createSupabaseMediaStorage(backend);

interface FalCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}
let falCalls: FalCall[] = [];
let falState: 'ok' | 'failed' | 'queued' | 'running' = 'ok';

/** fal.ai simulado: cola, estado, resultado y descarga del vídeo. */
const falFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
  falCalls.push({
    url,
    method: init?.method ?? 'GET',
    headers,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
  });
  const queue = /^https:\/\/queue\.fal\.run\/(.+?)(\/requests\/[^/]+)?(\/status)?$/.exec(url.split('?')[0]!);
  if (init?.method === 'POST' && queue && !queue[2]) {
    const model = queue[1]!;
    const base = `https://queue.fal.run/${model}/requests/req-1`;
    return Response.json({ request_id: 'req-1', status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
  }
  if (queue?.[3] && falState === 'queued') return Response.json({ status: 'IN_QUEUE' });
  if (queue?.[3] && falState === 'running') return Response.json({ status: 'IN_PROGRESS' });
  if (queue?.[3]) return Response.json(falState === 'ok' ? { status: 'COMPLETED' } : { status: 'COMPLETED', error: 'boom', error_type: 'x' });
  if (queue?.[2]) return Response.json({ video: { url: 'https://v3.fal.media/files/clip.mp4', content_type: 'video/mp4' } });
  if (url.startsWith('https://v3.fal.media/')) return new Response(MP4, { headers: { 'content-type': 'video/mp4' } });
  return new Response(null, { status: 599 });
};

beforeAll(async () => {
  db = await createDb();
  root = await createUser(db, 'root@plataforma.test');
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [root.id]);
});

afterAll(async () => {
  await db?.close();
});

function login(user: TestUser): string {
  const token = `sesion-${user.id}`;
  sessions.set(token, user);
  return token;
}

/** Activa (y da por verificado el precio de) los modelos de animar que se indican; los demás, apagados. */
async function activate(models: string[]) {
  await asService(db, `update public.ai_media_models set active = false where operation = 'animate_photo'`);
  for (const model of models) {
    await asService(
      db,
      `update public.ai_media_models set price_verified = true, active = true where operation = 'animate_photo' and model = $1`,
      [model],
    );
  }
}

async function modelRows(): Promise<MediaModelRow[]> {
  return db.query<MediaModelRow & Row>(
    `select provider, model, task::text as task, operation, display_name, billing_unit, price_micros, price_details,
            price_verified, data_region, trains_on_inputs, delivery, settings, priority, active
     from public.ai_media_models where active`,
  );
}

async function loadPhoto(token: string, brandId: string, assetId: string, options: { sign: boolean }) {
  const [row] = await as<{
    id: string;
    mime_type: string;
    kind: string;
    width: number | null;
    height: number | null;
    file_name: string;
    source: string;
  }>(
    db,
    sessions.get(token)!,
    `select id, mime_type, kind::text as kind, width, height, file_name, source
     from public.media_assets where brand_id = $1 and id = $2`,
    [brandId, assetId],
  );
  if (!row || (row.kind !== 'image' && row.kind !== 'logo') || row.source === 'google_drive') return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(row.mime_type) || !row.width || !row.height) return null;
  return {
    input: {
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      ...(options.sign ? { url: `https://firmada.test/${row.id}` } : {}),
    },
    fileName: row.file_name,
  };
}

async function runtime(env: Record<string, string | undefined> = FAL_ENV) {
  return createMediaRuntime({
    env,
    fetch: falFetch as never,
    rpc,
    reader,
    storage,
    modelRows: await modelRows(),
    serviceOptions: { pollIntervalMs: 0 },
  });
}

function mediaHandler(env: Record<string, string | undefined> = FAL_ENV) {
  return createAiMediaHandler({
    authenticate: async (token) => {
      const user = sessions.get(token);
      return user ? { userId: user.id } : null;
    },
    brandAccess: async (token, brandId) => aiBrandAccess(db, sessions.get(token)!, brandId),
    loadReferences: async () => null,
    loadPhoto,
    async allowance(userId, brandId, task) {
      const data = await serviceRpc<{ allowed: boolean; reason: string | null; remaining_micros: number }>(
        db,
        'ai_media_allowance',
        { p_user_id: userId, p_brand_id: brandId, p_task: task },
      );
      return { allowed: data.allowed, reason: data.reason, remainingMicros: Number(data.remaining_micros) };
    },
    runtime: () => runtime(env),
  });
}

async function call(
  handler: (request: Request) => Promise<Response>,
  token: string | null,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handler(
    new Request('http://funcion.test/ai-media', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function setup(options: { quota?: number | null; kind?: string } = {}) {
  n += 1;
  const owner = await createUser(db, `propietaria${n}@animar${n}.test`);
  const org = await createOrg(db, owner, `Organización ${n}`, options.kind);
  const brand = await createBrand(db, owner, org, `Marca ${n}`);
  if (options.quota !== null) await setAiQuota(db, root, org, options.quota ?? 10_000_000);
  return { owner, org, brand, token: login(owner) };
}

async function addPhoto(user: TestUser, org: string, brand: string, extra: { w?: number; h?: number } = {}) {
  const [row] = await as<{ id: string }>(
    db,
    user,
    `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes, width, height)
     values ($1, $2, 'image', $3, 'Paella de marisco.jpg', 'image/jpeg', 54321, $4, $5) returning id`,
    [brand, org, assetPath(org, brand), extra.w ?? 1080, extra.h ?? 1350],
  );
  return row!.id;
}

const assetRow = async (id: string) =>
  (await asService<Row>(db, `select * from public.media_assets where id = $1`, [id]))[0];
const errorOf = (body: Record<string, unknown>) => body.error as { code: string; message: string };

async function animate(t: Awaited<ReturnType<typeof setup>>, photo: string, input: Record<string, unknown> = {}) {
  return call(mediaHandler(), t.token, {
    action: 'video.animate',
    brandId: t.brand,
    input: { assetId: photo, motion: 'acercar despacio', ...input },
  });
}

/** Avanza el trabajo de seguimiento de ESA generación (los de otras pruebas se dejan como están). */
async function finishJob(generationId: unknown, env: Record<string, string | undefined> = FAL_ENV) {
  const claim = rpcStatement('claim_jobs', { p_worker: 'prueba', p_kinds: ['ai.media.poll'], p_limit: 100 });
  const jobs = await asService<{ data: Row }>(db, claim.sql, claim.params);
  const job = jobs.find((j) => (j.data.payload as { generation_id?: string }).generation_id === generationId);
  return (await runtime(env)).animateServiceFor().processJob(job!.data as never, 'prueba');
}

// ─────────────────────────────── Migración ───────────────────────────────

describe('migración de animar fotos', () => {
  it('siembra los dos modelos de fal.ai inactivos, de vídeo y con el precio sin verificar', async () => {
    const rows = await db.query<Row>(
      `select provider, model, task::text as task, operation, billing_unit, price_micros::int as price_micros, active,
              price_verified, data_region, priority from public.ai_media_models where operation = 'animate_photo' order by priority desc`,
    );
    expect(rows).toEqual([
      { provider: 'fal', model: H3, task: 'video', operation: 'animate_photo', billing_unit: 'second', price_micros: 60000, active: false, price_verified: false, data_region: 'unknown', priority: 10 },
      { provider: 'fal', model: KLING, task: 'video', operation: 'animate_photo', billing_unit: 'second', price_micros: 84000, active: false, price_verified: false, data_region: 'unknown', priority: 0 },
    ]);
  });

  it('un modelo con el precio sin verificar no se puede activar, y animar solo es de vídeo', async () => {
    await expect(
      db.query(`update public.ai_media_models set active = true where model = $1`, [H3]),
    ).rejects.toThrow(/check/i);
    await expect(
      db.query(
        `insert into public.ai_media_models (provider, model, task, operation, display_name, billing_unit, price_micros,
           price_checked_on, price_source, data_region, trains_on_inputs, delivery)
         values ('x', 'y', 'image', 'animate_photo', 'X', 'image', 1, '2026-11-22', 'prueba', 'eu', 'no', 'sync')`,
      ),
    ).rejects.toThrow(/ai_media_models_edit_is_image/);
  });

  it('el ajuste FAL_KEY existe en el catálogo de Integraciones como secreto', async () => {
    const rows = await db.query<Row>(
      `select integration, is_secret from private.integration_setting_keys where setting_key = 'FAL_KEY'`,
    );
    expect(rows).toEqual([{ integration: 'ai_image', is_secret: true }]);
  });
});

// ─────────────────────────────── Elección de modelo ───────────────────────────────

describe('elección del modelo para animar', () => {
  it('principal primero y respaldo si el principal no está activo; nunca uno de generar vídeo', async () => {
    const providers = createMediaProviders(FAL_ENV, { fetch: falFetch as never });
    await activate([H3, KLING]);
    let models = mediaModelsFromRows(await modelRows());
    expect(resolveAnimateModel(models, providers, { allowNonEu: true }).model.model).toBe(H3);
    await activate([KLING]);
    models = mediaModelsFromRows(await modelRows());
    expect(resolveAnimateModel(models, providers, { allowNonEu: true }).model.model).toBe(KLING);
    // Un modelo de animar no sirve para generar vídeo suelto.
    expect(() => resolveMediaModel('video', models, providers, { allowNonEu: true })).toThrow(/ningún modelo de vídeo activo/);
  });

  it('fuera de la UE solo si se admite; sin clave de fal no se ofrece nada', async () => {
    await activate([H3]);
    const withoutSwitch = await runtime({ FAL_KEY: 'k' });
    expect(withoutSwitch.animateChoices).toEqual([]);
    const withoutKey = await runtime({ AI_MEDIA_ALLOW_NON_EU: 'true' });
    expect(withoutKey.animateChoices).toEqual([]);
    const ok = await runtime();
    expect(ok.animateChoices.map((c) => c.id)).toEqual([`fal:${H3}`]);
    expect(ok.animateChoices[0]).toMatchObject({ euProcessing: false, untestedAdapter: true, priceVerified: true, maxSeconds: 10 });
    await activate([]);
    expect((await runtime()).animateChoices).toEqual([]);
  });
});

describe('proporción según la foto', () => {
  it('elige 9:16, 4:5 o 1:1 y avisa si la foto no tiene esa forma', () => {
    expect(animateAspectFor(1080, 1920)).toEqual({ ratio: '9:16', exact: true });
    expect(animateAspectFor(1080, 1350)).toEqual({ ratio: '4:5', exact: true });
    expect(animateAspectFor(1000, 1000)).toEqual({ ratio: '1:1', exact: true });
    expect(animateAspectFor(1600, 900)).toEqual({ ratio: '1:1', exact: false });
    expect(animateAspectFor(4000, 3000)).toMatchObject({ exact: false });
  });
});

// ─────────────────────────────── Función ai-media ───────────────────────────────

describe('video.options', () => {
  it('sin modelo activo no se ofrece; con modelo, permiso y cupo, sí, con el saldo', async () => {
    const t = await setup();
    await activate([]);
    let r = await call(mediaHandler(), t.token, { action: 'video.options', brandId: t.brand });
    expect(r.body.animate).toMatchObject({ available: false, reason: 'not_configured', models: [] });
    await activate([H3, KLING]);
    r = await call(mediaHandler(), t.token, { action: 'video.options', brandId: t.brand });
    const options = r.body.animate as { available: boolean; remainingMicros: number; models: { id: string }[]; maxSeconds: number };
    expect(options.available).toBe(true);
    expect(options.models.map((m) => m.id)).toEqual([`fal:${H3}`, `fal:${KLING}`]);
    expect(options.maxSeconds).toBe(10);
    expect(options.remainingMicros).toBe(10_000_000);
  });

  it('sin cupo, sin plan o sin permiso de edición no se ofrece', async () => {
    await activate([H3]);
    const noQuota = await setup({ quota: null });
    // Plan «Heredado» sin cupo de plan ni de la organización.
    let r = await call(mediaHandler(), noQuota.token, { action: 'video.options', brandId: noQuota.brand });
    expect(r.body.animate).toMatchObject({ available: false, reason: 'no_quota' });

    const t = await setup();
    const viewer = await createUser(db, `lectora${n}@animar.test`);
    await join(db, t.owner, viewer, t.org, 'member', t.brand, 'viewer');
    r = await call(mediaHandler(), login(viewer), { action: 'video.options', brandId: t.brand });
    expect(r.body.animate).toMatchObject({ available: false, reason: 'no_permission' });
  });

  it('con el plan real: sin la función «vídeo con IA» en el plan, no se ofrece', async () => {
    await activate([H3]);
    const t = await setup();
    await db.query(
      `update public.subscriptions set source = 'manual', plan_id = (select p.id from public.plans p where p.code = 'professional')
       where organization_id = $1`,
      [t.org],
    );
    const r = await call(mediaHandler(), t.token, { action: 'video.options', brandId: t.brand });
    expect(r.body.animate).toMatchObject({ available: false, reason: 'plan' });
  });
});

describe('video.estimate y video.animate', () => {
  it('estima el coste máximo (segundos × precio) sin reservar ni llamar a fal', async () => {
    await activate([H3]);
    const t = await setup();
    const photo = await addPhoto(t.owner, t.org, t.brand);
    falCalls = [];
    const r = await call(mediaHandler(), t.token, {
      action: 'video.estimate',
      brandId: t.brand,
      input: { assetId: photo, seconds: 10 },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ model: `fal:${H3}`, costMicros: 600_000, seconds: 10, aspectRatio: '4:5', exactAspect: true });
    expect(r.body.dataHandling).toMatchObject({ euProcessing: false, untestedAdapter: true });
    expect(falCalls).toHaveLength(0);
    const generations = await asService(db, `select id from public.ai_generations where brand_id = $1`, [t.brand]);
    expect(generations).toHaveLength(0);
  });

  it('anima: lo que se manda a fal, la reserva, el sondeo y el vídeo en «Vídeos con IA» con su procedencia', async () => {
    await activate([H3, KLING]);
    const t = await setup();
    const photo = await addPhoto(t.owner, t.org, t.brand);
    const before = await assetRow(photo);
    falCalls = [];
    falState = 'ok';

    const started = await animate(t, photo, { motion: 'acercar despacio', seconds: 5 });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ status: 'pending', model: `fal:${H3}`, estimatedCostMicros: 300_000, seconds: 5 });

    const post = falCalls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain(`https://queue.fal.run/${H3}`);
    expect(post.headers.Authorization).toBe('Key clave-de-prueba');
    expect(post.body).toMatchObject({
      image_url: `https://firmada.test/${photo}`,
      duration: 5,
      resolution: '768P',
      enable_safety_checker: true,
    });
    // El modelo no tiene parámetro de proporción: no se manda.
    expect(post.body).not.toHaveProperty('aspect_ratio');
    expect(String(post.body!.prompt)).toContain('acercar despacio');
    expect(String(post.body!.prompt)).toContain('Keep the dish');

    const [reserved] = await asService<Row>(db, `select status::text as status, reserved_micros::int as r from public.ai_generations where id = $1`, [started.body.generationId]);
    expect(reserved).toMatchObject({ status: 'reserved', r: 300_000 });

    const done = await finishJob(started.body.generationId);
    expect(done.status).toBe('completed');
    const assetId = done.status === 'completed' ? done.assets[0]!.assetId! : '';
    const video = await assetRow(assetId);
    expect(video).toMatchObject({
      kind: 'video',
      mime_type: 'video/mp4',
      folder: 'Vídeos con IA',
      file_name: 'Animada · Paella de marisco.mp4',
      duration_ms: 5000,
      origin: 'generated',
      created_by: t.owner.id,
    });
    expect(video!.tags).toEqual(['ia', 'animada']);
    expect(video!.provenance).toMatchObject({
      type: 'ai_animation',
      ai_generated: true,
      animated_from: photo,
      provider: 'fal',
      model: H3,
      prompt: 'acercar despacio',
      seconds: 5,
      aspect_ratio: '4:5',
      data_region: 'unknown',
      untested_adapter: true,
    });
    expect(Buffer.byteLength(JSON.stringify(video!.provenance))).toBeLessThanOrEqual(2048);
    // La foto original no cambia.
    expect(await assetRow(photo)).toEqual(before);
    // Cuenta como contenido generado con IA.
    const [ai] = await db.query<{ v: boolean }>(
      `select private.media_assets_ai_generated($1, array[$2]::uuid[]) as v`,
      [t.brand, assetId],
    );
    expect(ai!.v).toBe(true);
    // Coste real = segundos × precio.
    const [cost] = await asService<Row>(db, `select status::text as status, cost_micros::int as c from public.ai_generations where id = $1`, [started.body.generationId]);
    expect(cost).toMatchObject({ status: 'succeeded', c: 300_000 });
  });

  it('con el modelo de respaldo manda sus campos (start_image_url, duración como texto, sin audio)', async () => {
    await activate([KLING]);
    const t = await setup();
    const photo = await addPhoto(t.owner, t.org, t.brand);
    falCalls = [];
    const r = await animate(t, photo, { seconds: 3 });
    expect(r.status).toBe(202);
    const post = falCalls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain(KLING);
    expect(post.body).toMatchObject({ start_image_url: `https://firmada.test/${photo}`, duration: '3', generate_audio: false });
    expect(post.body).not.toHaveProperty('aspect_ratio');
    expect(r.body.estimatedCostMicros).toBe(252_000);
  });

  it('tope de duración: por defecto 5 s, máximo 10; 11 se rechaza antes de reservar', async () => {
    await activate([H3]);
    const t = await setup();
    const photo = await addPhoto(t.owner, t.org, t.brand);
    const tooLong = await animate(t, photo, { seconds: 11 });
    expect(tooLong.status).toBe(400);
    const tooShort = await animate(t, photo, { seconds: 3 });
    // El modelo principal pide al menos 5 s.
    expect(tooShort.status).toBe(400);
    const generations = await asService(db, `select id from public.ai_generations where brand_id = $1`, [t.brand]);
    expect(generations).toHaveLength(0);
    falCalls = [];
    const normal = await animate(t, photo, {});
    expect(normal.body).toMatchObject({ seconds: 5, estimatedCostMicros: 300_000 });
  });

  it('pide el movimiento y rechaza modelos que no se ofrecen', async () => {
    await activate([H3]);
    const t = await setup();
    const photo = await addPhoto(t.owner, t.org, t.brand);
    const noMotion = await call(mediaHandler(), t.token, { action: 'video.animate', brandId: t.brand, input: { assetId: photo } });
    expect(noMotion.status).toBe(400);
    const wrongModel = await animate(t, photo, { model: `fal:${KLING}` });
    expect(wrongModel.status).toBe(400);
  });

  it('mientras no termina, el trabajo dice si está en cola o generándose', async () => {
    await activate([H3]);
    const t = await setup();
    const photo = await addPhoto(t.owner, t.org, t.brand);
    const started = await animate(t, photo);
    const key = `ai-media:${started.body.generationId}`;
    const lastError = async () =>
      (await db.query<{ e: string | null }>(`select last_error as e from public.jobs where idempotency_key = $1`, [key]))[0]!.e;
    falState = 'queued';
    expect((await finishJob(started.body.generationId)).status).toBe('pending');
    expect(await lastError()).toBe('En cola en el proveedor');
    await db.query(`update public.jobs set run_after = now() where idempotency_key = $1`, [key]);
    falState = 'running';
    expect((await finishJob(started.body.generationId)).status).toBe('pending');
    expect(await lastError()).toBe('Generándose en el proveedor');
    falState = 'ok';
  });

  it('si fal falla, se devuelve la reserva entera y no queda vídeo', async () => {
    await activate([H3]);
    const t = await setup();
    const photo = await addPhoto(t.owner, t.org, t.brand);
    falState = 'failed';
    const started = await animate(t, photo);
    expect(started.status).toBe(202);
    const done = await finishJob(started.body.generationId);
    falState = 'ok';
    expect(done.status).toBe('failed');
    const [g] = await asService<Row>(
      db,
      `select g.status::text as status,
              (select coalesce(sum(u.reserved_delta_micros + u.cost_delta_micros), 0)::int from public.ai_usage u where u.generation_id = g.id) as net
       from public.ai_generations g where g.id = $1`,
      [started.body.generationId],
    );
    // Reservada y devuelta: el consumo neto es cero.
    expect(g).toMatchObject({ status: 'failed', net: 0 });
    const videos = await asService(db, `select id from public.media_assets where brand_id = $1 and kind = 'video'`, [t.brand]);
    expect(videos).toHaveLength(0);
  });
});

describe('cupo, permisos, aislamiento y modo agencia', () => {
  it('sin cupo suficiente no se llama a fal: 402', async () => {
    await activate([H3]);
    const t = await setup({ quota: 100_000 });
    const photo = await addPhoto(t.owner, t.org, t.brand);
    falCalls = [];
    const r = await animate(t, photo, { seconds: 5 });
    expect(r.status).toBe(402);
    expect(errorOf(r.body).code).toBe('quota_exhausted');
    expect(falCalls).toHaveLength(0);
  });

  it('quien solo ve la marca no puede animar; una foto de otra organización no existe para quien pide', async () => {
    await activate([H3]);
    const a = await setup();
    const b = await setup();
    const viewer = await createUser(db, `lectora${n}@animar2.test`);
    await join(db, a.owner, viewer, a.org, 'member', a.brand, 'viewer');
    const photoA = await addPhoto(a.owner, a.org, a.brand);
    const photoB = await addPhoto(b.owner, b.org, b.brand);
    falCalls = [];
    const asViewer = await call(mediaHandler(), login(viewer), {
      action: 'video.animate',
      brandId: a.brand,
      input: { assetId: photoA, motion: 'vapor suave' },
    });
    expect(asViewer.status).toBe(403);
    expect((await animate(a, photoB)).status).toBe(400);
    const otherBrand = await call(mediaHandler(), a.token, {
      action: 'video.animate',
      brandId: b.brand,
      input: { assetId: photoB, motion: 'vapor suave' },
    });
    expect(otherBrand.status).toBe(404);
    expect(falCalls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('en modo agencia, como la imagen: quien no es personal de la agencia recibe 409 antes de tocar el cupo; el personal sí puede', async () => {
    await activate([H3]);
    // Marca de una organización de empresa en modo agencia: su propietaria NO es personal de la agencia.
    const client = await setup();
    await as(db, client.owner, `update public.brands set ai_mode = 'agency' where id = $1`, [client.brand]);
    const photo = await addPhoto(client.owner, client.org, client.brand);
    falCalls = [];
    const options = await call(mediaHandler(), client.token, { action: 'video.options', brandId: client.brand });
    expect(options.body.animate).toMatchObject({ available: false, reason: 'agency_mode', agencyMode: true, models: [] });
    for (const action of ['video.estimate', 'video.animate']) {
      const r = await call(mediaHandler(), client.token, {
        action,
        brandId: client.brand,
        input: { assetId: photo, motion: 'vapor suave' },
      });
      expect(r.status).toBe(409);
      expect(errorOf(r.body).code).toBe('agency_mode');
    }
    expect(falCalls).toHaveLength(0);
    const reserved = await asService(db, `select id from public.ai_generations where brand_id = $1`, [client.brand]);
    expect(reserved).toHaveLength(0);

    // El personal de la agencia (propietaria de una organización de tipo agencia) sí anima, con su cupo.
    const staff = await setup({ kind: 'agency' });
    await as(db, staff.owner, `update public.brands set ai_mode = 'agency' where id = $1`, [staff.brand]);
    const photo2 = await addPhoto(staff.owner, staff.org, staff.brand);
    const staffOptions = await call(mediaHandler(), staff.token, { action: 'video.options', brandId: staff.brand });
    expect(staffOptions.body.animate).toMatchObject({ available: true });
    expect((await animate(staff, photo2)).status).toBe(202);
    // Y el cupo sigue mandando.
    const poor = await setup({ quota: 1000, kind: 'agency' });
    await as(db, poor.owner, `update public.brands set ai_mode = 'agency' where id = $1`, [poor.brand]);
    const photo3 = await addPhoto(poor.owner, poor.org, poor.brand);
    expect((await animate(poor, photo3)).status).toBe(402);
  });

  it('ai_media_allowance solo la llama el servidor', async () => {
    const t = await setup();
    await denied(db, t.owner, `select public.ai_media_allowance($1, $2, 'video')`, [t.owner.id, t.brand]);
    const data = await serviceRpc<{ allowed: boolean }>(db, 'ai_media_allowance', {
      p_user_id: t.owner.id,
      p_brand_id: t.brand,
      p_task: 'video',
    });
    expect(data.allowed).toBe(true);
  });
});

describe('procedencia ai_animation', () => {
  it('solo el servidor la escribe, y la foto de origen tiene que ser de la misma marca', async () => {
    const a = await setup();
    const b = await setup();
    const photoA = await addPhoto(a.owner, a.org, a.brand);
    const photoB = await addPhoto(b.owner, b.org, b.brand);
    const insert = (brand: string, org: string, source: string) =>
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes, provenance)
       values ('${brand}', '${org}', 'video', '${assetPath(org, brand, 'v.mp4')}', 'v.mp4', 'video/mp4', 10,
               '{"type": "ai_animation", "animated_from": "${source}"}'::jsonb)`;
    await denied(db, a.owner, insert(a.brand, a.org, photoA), [], /Solo el servidor/);
    await expect(asService(db, insert(a.brand, a.org, photoB))).rejects.toThrow(/no es de esta marca/);
    await asService(db, insert(a.brand, a.org, photoA));
  });

  it('la procedencia cabe en 2048 bytes aunque el encargo sea larguísimo', () => {
    const json = provenanceJson('00000000-0000-0000-0000-000000000000', {
      provider: 'fal',
      model: H3,
      prompt: 'ñ'.repeat(500),
      dataRegion: 'unknown',
      trainsOnInputs: 'unknown',
      untestedAdapter: true,
      animate: { sourceAssetId: '11111111-1111-1111-1111-111111111111', seconds: 5, aspectRatio: '4:5' },
    });
    expect(Buffer.byteLength(JSON.stringify(json))).toBeLessThanOrEqual(2048);
  });
});

describe('«Probar conexión» de fal.ai', () => {
  it('consulta el precio (no genera nada), no cita la clave y avisa si la rechaza', async () => {
    const seen: string[] = [];
    const ok = await probeIntegration(
      'ai_image',
      { FAL_KEY: 'clave-secreta-de-prueba' },
      {
        fetch: async (url, init) => {
          seen.push(`${init?.method ?? 'GET'} ${url}`);
          return Response.json({
            prices: [{ endpoint_id: H3, unit_price: 0.06, unit: 'video', currency: 'USD' }],
            next_cursor: null,
            has_more: false,
          });
        },
      },
    );
    expect(ok.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^GET https:\/\/api\.fal\.ai\/v1\/models\/pricing\?endpoint_id=/);
    expect(JSON.stringify(ok)).not.toContain('clave-secreta');
    expect(JSON.stringify(ok)).toContain('0.06');
    const rejected = await probeIntegration(
      'ai_image',
      { FAL_KEY: 'mala' },
      { fetch: async () => new Response('{}', { status: 401 }) },
    );
    expect(rejected.ok).toBe(false);
  });
});
