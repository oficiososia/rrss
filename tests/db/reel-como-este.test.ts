// «Hacer un reel como este» (docs/reel-como-este.md) contra las migraciones
// reales (PGlite):
//   1. El encargo del análisis (`request_media_job`, tipo `media.reel.analyze`),
//      lo que pasa al terminar el trabajo y qué ocurre con los archivos.
//   2. La función `ai-reel-like` (handler.ts) con el servicio de IA de siempre
//      (cupo, permiso, coste, modo agencia) y proveedores SIMULADOS.
//   3. La estructura que sale del análisis y la pieza que se abre con él (la plantilla
//      reutilizable se guarda en el formato compartido: src/features/reels/like/template.test.ts).
//   4. DE PUNTA A PUNTA: un vídeo de 4 planos con rótulos generado con FFmpeg
//      → el trabajador de verdad lo mide → la función lo estudia → la
//      plantilla tiene los cortes y las duraciones del vídeo. Necesita FFmpeg y
//      las dependencias de worker/ (en el trabajo `comprobar` del CI no están:
//      allí esta prueba se salta y el análisis se prueba en `worker/`).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiInput, AiModelSpec, AiProvider, Json, RpcClient } from '../../supabase/functions/_shared/ai/contract.ts';
import { createAiService, priceUsage } from '../../supabase/functions/_shared/ai/service.ts';
import {
  createSimulatedProvider,
  SIMULATED_PROVIDER_ID,
  type SimulatedProvider,
} from '../../supabase/functions/_shared/ai/simulated-provider.ts';
import { loadAiTextConfig, TEXT_PURPOSES } from '../../supabase/functions/_shared/ai/text/config.ts';
import { loadReelLikeTextConfig } from '../../supabase/functions/_shared/ai/text/reel-like-config.ts';
import { createLocalTestProvider, LOCAL_TEST_MODEL, LOCAL_TEST_PRICES } from '../../supabase/functions/_shared/ai/text/local-test.ts';
import { buildChatBody, createOpenAiProvider } from '../../supabase/functions/_shared/ai/text/openai.ts';
import { buildMessagesBody } from '../../supabase/functions/_shared/ai/text/anthropic-messages.ts';
import { createMistralProvider } from '../../supabase/functions/_shared/ai/text/mistral.ts';
import { IMAGE_TOKENS_UPPER } from '../../supabase/functions/_shared/ai/text/prompt.ts';
import {
  MATERIAL,
  REEL_LIKE_INSTRUCTIONS,
  REEL_LIKE_PURPOSE,
  REEL_LIKE_SCHEMA,
  reelLikeInput,
  reelLikeWorstCaseInput,
} from '../../supabase/functions/_shared/ai/text/tasks/reel-like.ts';
import { supportsImages } from '../../supabase/functions/_shared/ai/text/vision.ts';
import { validateJson } from '../../supabase/functions/_shared/ai/schema.ts';
import { REFERENCE_TRANSCRIPT_PURPOSE } from '../../supabase/functions/_shared/ai/transcription/config.ts';
import { TRANSCRIPTION_UNIT } from '../../supabase/functions/_shared/ai/transcription/openai.ts';
import {
  createSimulatedTranscriptionProvider,
  SIMULATED_TRANSCRIPTION_MODEL,
} from '../../supabase/functions/_shared/ai/transcription/simulated.ts';
import {
  LIKE_LIMITS,
  parseReelStructure,
  parseMeasurement,
  parseReelLikeResult,
  REFERENCE_LIMITS,
} from '../../supabase/functions/_shared/reels/like.ts';
import { createAiReelLikeHandler, type ReelLikeBrand } from '../../supabase/functions/ai-reel-like/handler.ts';
import { formatPlan, planRealTest, runRealTest, SAMPLE_PROFILE } from '../../scripts/reel-como-este-prueba.ts';
import {
  aiBrandAccess,
  as,
  asService,
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

const KIND = 'media.reel.analyze';
const SPEECH_PRICE = 100; // micros por segundo (inventado)
const TEXT_MODEL: AiModelSpec = {
  provider: SIMULATED_PROVIDER_ID,
  model: LOCAL_TEST_MODEL,
  task: 'text',
  microsPerUnit: { ...LOCAL_TEST_PRICES },
  purposes: [REEL_LIKE_PURPOSE],
};
const SPEECH_MODEL: AiModelSpec = {
  provider: 'simulated',
  model: SIMULATED_TRANSCRIPTION_MODEL,
  task: 'transcription',
  microsPerUnit: { [TRANSCRIPTION_UNIT]: SPEECH_PRICE },
  purposes: [REFERENCE_TRANSCRIPT_PURPOSE],
};

const PROFILE: Json = {
  business: { description: 'Panadería de barrio con obrador propio', products: ['pan de masa madre'], locations: [], valueProps: [] },
  audience: { segments: [] },
  goals: [],
  voice: {
    tone: ['cercano'],
    personality: 'Vecinos de toda la vida',
    values: [],
    keyMessages: ['Pan hecho hoy, con masa madre'],
    allowedPhrases: [],
    forbiddenPhrases: ['el mejor pan del mundo'],
    callsToAction: ['Pásate antes de las doce'],
    hashtags: { required: ['masamadre'], recommended: ['panaderia'] },
  },
  visual: { colors: [], fonts: [], styleNotes: '' },
  channels: [],
  languages: { primary: 'es', others: [] },
  restrictions: { legal: [], advertising: [] },
  notes: [],
};

let db: Db;
let root: TestUser;
let n = 0;
const sessions = new Map<string, TestUser>();

const rpc: RpcClient = async (fn, args) => {
  try {
    return { data: await serviceRpc(db, fn, args), error: null };
  } catch (error) {
    const { code, message, detail } = error as { code?: string; message: string; detail?: string };
    return { data: null, error: { code, message, details: detail ?? null } };
  }
};

beforeAll(async () => {
  db = await createDb();
  root = await createUser(db, 'root@plataforma.test');
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [root.id]);
});
afterAll(async () => {
  await db?.close();
});

const uuid = () => crypto.randomUUID();
const sourcePath = (org: string, brand: string, ext = 'mp4') => `${org}/${brand}/referencias/${uuid()}.${ext}`;

interface JobRow extends Row {
  id: string;
  kind: string;
  status: string;
  payload: {
    reference: { id: string };
    source: { path?: string; url?: string };
    speech: boolean;
    output: { dir: string };
  };
}
interface ReferenceRow extends Row {
  id: string;
  status: string;
  source_kind: string;
  source_host: string | null;
  source_path: string | null;
  keep_source: boolean;
  speech: boolean;
  idea: string;
  error: string | null;
  job_id: string | null;
  measurement: Json | null;
  result: Json | null;
  cost_micros: number | string;
  generation_ids: string[];
  content_id: string | null;
  files_released_at: string | null;
  ai_started_at: string | null;
}

async function request(user: TestUser | null, brand: string, input: unknown, key = `clave-${uuid()}`): Promise<JobRow> {
  const [row] = await as<{ data: JobRow }>(
    db,
    user,
    `select to_jsonb(j) as data from public.request_media_job($1, $2, $3::jsonb, $4) j`,
    [brand, KIND, JSON.stringify(input), key],
  );
  return row!.data;
}
const reference = async (id: string) =>
  (await db.query<ReferenceRow>(`select * from public.reel_references where id = $1`, [id]))[0];
const queued = async (brand: string) =>
  (
    await db.query<{ storage_path: string }>(
      `select storage_path from public.storage_cleanup_queue where brand_id = $1 order by storage_path`,
      [brand],
    )
  ).map((r) => r.storage_path);

/** La medición que devuelve el trabajador para el vídeo de ejemplo (worker/tests/helpers/reference.ts). */
function measurementFor(job: JobRow, options: { speech?: boolean; frames?: number } = {}): Json {
  const dir = job.payload.output.dir;
  const shots = [
    { index: 0, start: 0, end: 2, seconds: 2, motion: 0.7, still: false },
    { index: 1, start: 2, end: 3.5, seconds: 1.5, motion: 0, still: true, transitionIn: { type: 'cut', seconds: 0 } },
    { index: 2, start: 3.5, end: 5.75, seconds: 2.25, motion: 0.7, still: false, transitionIn: { type: 'cut', seconds: 0 } },
    { index: 3, start: 5.75, end: 7.5, seconds: 1.75, motion: 0, still: true, transitionIn: { type: 'fade', seconds: 0.5 } },
  ];
  return {
    reference: { id: job.payload.reference.id },
    source: { kind: job.payload.source.url ? 'link' : 'upload', durationSeconds: 7.5, width: 540, height: 960, fps: 30, hasAudio: true, bytes: 12345 },
    shots,
    frames: shots.slice(0, options.frames ?? 4).map((shot, i) => ({
      path: `${dir}/f-0${i + 1}.jpg`,
      at: shot.start + shot.seconds * 0.6,
      shot: i,
      bytes: 2000,
    })),
    audio: {
      present: true,
      silent: false,
      energy: [1, 0.9],
      bpm: 120,
      confidence: 0.8,
      beats: [0, 0.5, 1],
      cutsOnBeat: 0.67,
      beatsPerCut: 4,
      speech: options.speech ? [{ path: `${dir}/a-01.m4a`, start: 0.1, seconds: 7.2, bytes: 4000 }] : [],
    },
    warnings: [],
    timings: { downloadMs: 1, analyzeMs: 2, uploadMs: 3 },
  };
}

interface ClaimedJob {
  id: string;
  organization_id: string;
  brand_id: string;
  payload: Record<string, unknown>;
}

/** Un trabajador reclama ESE trabajo (los demás que caigan de paso vuelven a la cola). */
async function claimJob(job: JobRow): Promise<{ worker: string; claimed: ClaimedJob }> {
  const worker = `trabajador-${uuid()}`;
  const claim = rpcStatement('claim_jobs', { p_worker: worker, p_kinds: [KIND], p_limit: 100 });
  const rows = await asService<{ data: ClaimedJob }>(db, claim.sql, claim.params);
  for (const other of rows.filter((c) => c.data.id !== job.id)) {
    await serviceRpc(db, 'release_job', { p_job_id: other.data.id, p_worker: worker });
  }
  const mine = rows.find((c) => c.data.id === job.id);
  expect(mine, 'el trabajo está en la cola').toBeDefined();
  return { worker, claimed: mine!.data };
}

/** El trabajador reclama el trabajo y lo cierra con ese resultado (o falla). */
async function work(job: JobRow, outcome: { result: Json } | { error: string }): Promise<void> {
  const { worker } = await claimJob(job);
  if ('result' in outcome) {
    await serviceRpc(db, 'complete_job', { p_job_id: job.id, p_worker: worker, p_result: outcome.result });
  } else {
    await serviceRpc(db, 'fail_job', { p_job_id: job.id, p_worker: worker, p_error: outcome.error, p_retry: false });
  }
}

async function setup(options: { quota?: number | null; profile?: Json | null; kind?: string } = {}) {
  n += 1;
  const owner = await createUser(db, `duena${n}@reel${n}.test`);
  const editor = await createUser(db, `editora${n}@reel${n}.test`);
  const viewer = await createUser(db, `lector${n}@reel${n}.test`);
  const org = await createOrg(db, owner, `Organización ${n}`, options.kind ?? 'business');
  const brand = await createBrand(db, owner, org, `Marca ${n}`);
  await join(db, owner, editor, org, 'member', brand, 'editor');
  await join(db, owner, viewer, org, 'member', brand, 'viewer');
  if (options.quota !== null) await setAiQuota(db, root, org, options.quota ?? 10_000_000);
  if (options.profile !== null) {
    await as(db, owner, `select public.save_brand_profile($1, $2::jsonb)`, [brand, JSON.stringify(options.profile ?? PROFILE)]);
  }
  return { owner, editor, viewer, org, brand };
}

function login(user: TestUser): string {
  const token = `sesion-${user.id}`;
  sessions.set(token, user);
  return token;
}

/** La función con proveedores simulados y un «almacén» en memoria (o el que se le dé). */
function createFunction(
  options: {
    text?: SimulatedProvider | null;
    speech?: AiProvider | null;
    files?: Map<string, Uint8Array>;
    readFile?: (path: string) => Promise<Uint8Array | null>;
    removeFiles?: (paths: string[]) => Promise<string[]>;
  } = {},
) {
  const text = options.text === undefined ? createLocalTestProvider() : options.text;
  const speech = options.speech === undefined ? createSimulatedTranscriptionProvider() : options.speech;
  const files = options.files ?? new Map<string, Uint8Array>();
  const removed: string[] = [];
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
  const handler = createAiReelLikeHandler({
    rpc,
    textService: createAiService({ rpc, providers: text ? [text] : [], models: text ? [TEXT_MODEL] : [] }),
    transcriptionService: createAiService({ rpc, providers: speech ? [speech] : [], models: speech ? [SPEECH_MODEL] : [] }),
    estimateText: (input: AiInput) =>
      text ? priceUsage(TEXT_MODEL, text.estimateUsage({ task: 'text', model: TEXT_MODEL.model, input })).micros : null,
    transcriptionMicrosPerSecond: speech ? SPEECH_PRICE : null,
    authenticate: async (token) => (sessions.get(token) ? { userId: sessions.get(token)!.id } : null),
    async loadBrand(token, brandId): Promise<ReelLikeBrand> {
      const user = sessions.get(token)!;
      const access = await aiBrandAccess(db, user, brandId);
      if (!access) return { visible: false, profile: null, aiMode: 'api', agencyStaff: false, library: { folders: [], tags: [] } };
      const [profile] = await as<{ data: Json }>(
        db,
        user,
        `select data from public.brand_profiles where brand_id = $1 and status = 'active'`,
        [brandId],
      );
      const assets = await as<{ folder: string; tags: string[] }>(
        db,
        user,
        `select folder, tags from public.media_assets where brand_id = $1`,
        [brandId],
      );
      return {
        visible: true,
        profile: profile?.data ?? null,
        aiMode: access.aiMode,
        agencyStaff: access.agencyStaff,
        library: {
          folders: [...new Set(assets.map((a) => a.folder).filter(Boolean))],
          tags: [...new Set(assets.flatMap((a) => a.tags))],
        },
      };
    },
    async loadReference(token, referenceId) {
      const [row] = await as<ReferenceRow & { brand_id: string; organization_id: string }>(
        db,
        sessions.get(token)!,
        `select id, brand_id, organization_id, status, idea, measurement, result, cost_micros, error
         from public.reel_references where id = $1`,
        [referenceId],
      );
      return row ? { ...row, cost_micros: Number(row.cost_micros) } : null;
    },
    readFile: options.readFile ?? (async (p) => files.get(p) ?? null),
    removeFiles:
      options.removeFiles ??
      (async (paths) => {
        for (const p of paths) {
          files.delete(p);
          removed.push(p);
        }
        return paths;
      }),
    log: (event, data) => logs.push({ event, data }),
  });
  const call = async (token: string | null, body: unknown) => {
    const response = await handler(
      new Request('https://funciones.test/ai-reel-like', {
        method: 'POST',
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Row };
  };
  return { call, files, removed, logs, text, speech };
}

const errorOf = (body: Row) => body.error as { code: string; message: string; retryable?: boolean };

/** Un análisis ya medido (como si el trabajador hubiera terminado), con sus archivos en el almacén. */
async function measured(
  t: Awaited<ReturnType<typeof setup>>,
  files: Map<string, Uint8Array>,
  options: { speech?: boolean; keepSource?: boolean; idea?: string; user?: TestUser } = {},
) {
  const source = sourcePath(t.org, t.brand);
  const job = await request(options.user ?? t.editor, t.brand, {
    source: { path: source },
    speech: options.speech ?? false,
    ...(options.keepSource ? { keepSource: true } : {}),
    ...(options.idea ? { idea: options.idea } : {}),
  });
  const result = measurementFor(job, { speech: options.speech });
  files.set(source, new Uint8Array([1, 2, 3]));
  for (const frame of (result as { frames: Array<{ path: string }> }).frames) files.set(frame.path, new Uint8Array([0xff, 0xd8, 0xff]));
  for (const chunk of (result as { audio: { speech: Array<{ path: string }> } }).audio.speech) {
    files.set(chunk.path, new Uint8Array([0, 0, 0, 1]));
  }
  await work(job, { result });
  return { job, id: job.payload.reference.id, source };
}

// ───────────────────────────── 1. Encargo y trabajo ─────────────────────────────

describe('encargar el análisis de un vídeo de referencia', () => {
  it('quien edita la marca lo encarga con su archivo; la base de datos crea el análisis y fija la carpeta', async () => {
    const t = await setup();
    const source = sourcePath(t.org, t.brand, 'mov');
    const job = await request(t.editor, t.brand, { source: { path: source }, speech: true, keepSource: true, idea: '  Nuestro pan de masa madre  ' });
    expect(job).toMatchObject({ kind: KIND, status: 'queued' });
    const id = job.payload.reference.id;
    expect(job.payload).toEqual({
      reference: { id },
      source: { path: source },
      speech: true,
      output: { dir: `${t.org}/${t.brand}/referencias/${id}` },
    });
    expect(await reference(id)).toMatchObject({
      status: 'analyzing',
      source_kind: 'upload',
      source_host: null,
      source_path: source,
      keep_source: true,
      speech: true,
      idea: 'Nuestro pan de masa madre',
      job_id: job.id,
      created_by: t.editor.id,
    });
    // Repetir la clave devuelve el mismo trabajo, sin otro análisis.
    const again = await request(t.editor, t.brand, { source: { path: sourcePath(t.org, t.brand) } }, 'clave-repetida-1');
    const same = await request(t.editor, t.brand, { source: { path: sourcePath(t.org, t.brand) } }, 'clave-repetida-1');
    expect(same.id).toBe(again.id);
    expect(await db.query(`select 1 from public.reel_references where brand_id = $1`, [t.brand])).toHaveLength(2);
  });

  it('de un enlace solo guarda el dominio, y no admite guardarlo como referencia', async () => {
    const t = await setup();
    const job = await request(t.editor, t.brand, { source: { url: 'https://www.Instagram.com/reel/AbC123/?igsh=secreto' } });
    expect(job.payload.source).toEqual({ url: 'https://www.Instagram.com/reel/AbC123/?igsh=secreto' });
    expect(job.payload.speech).toBe(false);
    expect(await reference(job.payload.reference.id)).toMatchObject({
      source_kind: 'link',
      source_host: 'www.instagram.com',
      source_path: null,
      keep_source: false,
    });
    await expect(
      request(t.editor, t.brand, { source: { url: 'https://videos.example/v.mp4' }, keepSource: true }),
    ).rejects.toThrow(/Solo se puede guardar como referencia un vídeo subido/);
  });

  it('rechaza lo que no es la carpeta de referencias de la marca, enlaces raros y campos de más', async () => {
    const t = await setup();
    const other = await setup();
    const bad = async (input: unknown, pattern: RegExp) => expect(request(t.editor, t.brand, input)).rejects.toThrow(pattern);
    const folder = /carpeta de referencias de esta marca/;
    await bad({ source: { path: `${t.org}/${t.brand}/media/${uuid()}.mp4` } }, folder);
    await bad({ source: { path: sourcePath(other.org, other.brand) } }, folder);
    await bad({ source: { path: `${t.org}/${t.brand}/referencias/../media/x.mp4` } }, folder);
    await bad({ source: { path: `${t.org}/${t.brand}/referencias/${uuid()}.exe` } }, folder);
    await bad({ source: { path: sourcePath(t.org, t.brand), url: 'https://a.example/v.mp4' } }, /solo uno de los dos/);
    await bad({}, /solo uno de los dos/);
    await bad({ source: { url: 'ftp://a.example/v.mp4' } }, /no es una dirección web válida/);
    await bad({ source: { url: 'https://usuario:clave@a.example/v.mp4' } }, /no es una dirección web válida/);
    await bad({ source: { url: 'https://a.example/v .mp4' } }, /no es una dirección web válida/);
    await bad({ source: { path: sourcePath(t.org, t.brand) }, idea: 'x'.repeat(601) }, /600 caracteres/);
    await bad({ source: { path: sourcePath(t.org, t.brand) }, speech: 'sí' }, /sí o no/);
    await bad({ source: { path: sourcePath(t.org, t.brand) }, output: { dir: 'x' } }, /solo uno de los dos/);
    // El mismo archivo no se analiza dos veces a la vez.
    const source = sourcePath(t.org, t.brand);
    await request(t.editor, t.brand, { source: { path: source } });
    await bad({ source: { path: source } }, /ya se está analizando/);
    expect(await db.query(`select 1 from public.reel_references where brand_id = $1`, [t.brand])).toHaveLength(1);
  });

  it('solo quien edita la marca, y cuenta como trabajo de medios (máximo a la vez y plan con reels)', async () => {
    const t = await setup();
    const input = () => ({ source: { path: sourcePath(t.org, t.brand) } });
    await expect(request(t.viewer, t.brand, input())).rejects.toThrow(/No tienes permiso/);
    await expect(request(null, t.brand, input())).rejects.toThrow(/permission denied|Inicia sesión/);
    for (let i = 0; i < 5; i += 1) await request(t.editor, t.brand, input());
    await expect(request(t.editor, t.brand, input())).rejects.toThrow(/el máximo a la vez/);
    // Sin «reels» en el plan, tampoco se estudia un reel.
    const basic = await setup();
    await db.query(
      `update public.plans set features = array_remove(features, 'reels') where code = (select code from public.plans where is_default)`,
    );
    try {
      await expect(request(basic.editor, basic.brand, { source: { path: sourcePath(basic.org, basic.brand) } })).rejects.toThrow(/plan/i);
    } finally {
      await db.query(`update public.plans set features = array_append(features, 'reels') where is_default`);
    }
  });

  it('al terminar el trabajo, la medición pasa al análisis; un resultado que no es el suyo no cierra el trabajo', async () => {
    const t = await setup();
    const job = await request(t.editor, t.brand, { source: { path: sourcePath(t.org, t.brand) } });
    const good = measurementFor(job) as Record<string, Json>;
    const { worker } = await claimJob(job);
    const complete = (result: Json) => serviceRpc(db, 'complete_job', { p_job_id: job.id, p_worker: worker, p_result: result });
    const wrong = /no corresponde a su encargo/;
    await expect(complete({ ...good, reference: { id: uuid() } })).rejects.toThrow(wrong);
    await expect(complete({ ...good, shots: [] })).rejects.toThrow(wrong);
    await expect(
      complete({ ...good, frames: [{ path: `${t.org}/${t.brand}/media/f-01.jpg`, at: 1, shot: 0 }] }),
    ).rejects.toThrow(wrong);
    await expect(
      complete({ ...good, audio: { present: true, speech: [{ path: `${job.payload.output.dir}/../../x.m4a`, start: 0, seconds: 1 }] } }),
    ).rejects.toThrow(wrong);
    expect(await reference(job.payload.reference.id)).toMatchObject({ status: 'analyzing', measurement: null });
    await complete(good);
    const row = await reference(job.payload.reference.id);
    expect(row).toMatchObject({ status: 'measured', error: null });
    expect(parseMeasurement(row!.measurement)?.shots.map((s) => s.seconds)).toEqual([2, 1.5, 2.25, 1.75]);
    // Nada entra en la biblioteca: el vídeo de referencia solo se mide.
    expect(await db.query(`select 1 from public.media_assets where brand_id = $1`, [t.brand])).toEqual([]);
    expect(await queued(t.brand)).toEqual([]);
  });

  it('si el trabajo falla o se cancela, el análisis lo dice y suelta sus archivos (también el vídeo guardado)', async () => {
    const t = await setup();
    const source = sourcePath(t.org, t.brand);
    const failed = await request(t.editor, t.brand, { source: { path: source }, keepSource: true });
    await work(failed, { error: 'Instagram no deja descargar este vídeo desde un enlace (pide iniciar sesión). Descarga el vídeo…' });
    const row = await reference(failed.payload.reference.id);
    expect(row).toMatchObject({ status: 'failed', source_path: null, keep_source: false });
    expect(row!.error).toMatch(/no deja descargar este vídeo/);
    expect(row!.files_released_at).not.toBeNull();
    const paths = await queued(t.brand);
    expect(paths).toContain(source);
    // Sin medición no se sabe qué dejó el trabajador: se sueltan todos los nombres posibles.
    expect(paths).toContain(`${failed.payload.output.dir}/f-01.jpg`);
    expect(paths).toContain(`${failed.payload.output.dir}/f-12.jpg`);
    expect(paths).toContain(`${failed.payload.output.dir}/a-12.m4a`);
    expect(paths).toHaveLength(25);

    const cancelled = await request(t.editor, t.brand, { source: { url: 'https://videos.example/v.mp4' } });
    await denied(db, t.viewer, `select public.cancel_media_job($1)`, [cancelled.id]);
    await as(db, t.editor, `select public.cancel_media_job($1)`, [cancelled.id]);
    expect(await reference(cancelled.payload.reference.id)).toMatchObject({ status: 'failed', error: 'Se canceló el análisis.' });
  });

  it('descartar un análisis cancela su trabajo, suelta todos sus archivos y borra la fila', async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    const done = await measured(t, files, { keepSource: true, speech: true });
    await denied(db, t.viewer, `select public.discard_reel_reference($1)`, [done.id]);
    const other = await setup();
    await denied(db, other.owner, `select public.discard_reel_reference($1)`, [done.id]);
    const [row] = await as<{ paths: string[] }>(db, t.editor, `select public.discard_reel_reference($1) as paths`, [done.id]);
    const expected = [done.source, ...[1, 2, 3, 4].map((i) => `${done.job.payload.output.dir}/f-0${i}.jpg`), `${done.job.payload.output.dir}/a-01.m4a`].sort();
    expect([...row!.paths].sort()).toEqual(expected);
    expect(await queued(t.brand)).toEqual(expected);
    expect(await reference(done.id)).toBeUndefined();

    // En marcha: el trabajo se cancela.
    const running = await request(t.editor, t.brand, { source: { path: sourcePath(t.org, t.brand) } });
    await as(db, t.editor, `select public.discard_reel_reference($1)`, [running.payload.reference.id]);
    expect(await db.query(`select status from public.jobs where id = $1`, [running.id])).toEqual([{ status: 'cancelled' }]);
    expect(await reference(running.payload.reference.id)).toBeUndefined();
  });

  it('un análisis abandonado caduca al día y suelta sus archivos', async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    const old = await measured(t, files);
    const fresh = await measured(t, files);
    await db.query(`update public.reel_references set created_at = now() - interval '25 hours' where id = $1`, [old.id]);
    await denied(db, t.owner, `select public.reel_references_expire($1)`, [t.brand]);
    expect(await serviceRpc(db, 'reel_references_expire', { p_brand_id: t.brand })).toBe(1);
    expect(await reference(old.id)).toMatchObject({ status: 'expired', source_path: null });
    expect(await reference(fresh.id)).toMatchObject({ status: 'measured' });
    expect(await queued(t.brand)).toContain(old.source);
    expect(await queued(t.brand)).not.toContain(fresh.source);
  });

  it('las tablas solo se leen (quien ve la marca) y las funciones del servidor no son para personas', async () => {
    const t = await setup();
    const other = await setup();
    const done = await measured(t, new Map());
    const visible = (user: TestUser) => as(db, user, `select id from public.reel_references where id = $1`, [done.id]);
    expect(await visible(t.viewer)).toHaveLength(1);
    expect(await visible(other.owner)).toEqual([]);
    await denied(db, t.owner, `update public.reel_references set status = 'ready' where id = $1`, [done.id]);
    await denied(db, t.owner, `delete from public.reel_references where id = $1`, [done.id]);
    await denied(
      db,
      t.owner,
      `insert into public.reel_references (id, brand_id, organization_id, source_kind) values ($1, $2, $3, 'link')`,
      [uuid(), t.brand, t.org],
    );
    await denied(db, t.owner, `select public.reel_reference_claim($1, true)`, [done.id]);
    await denied(db, t.owner, `select public.reel_reference_finish($1, '{}'::jsonb, 0, '{}'::uuid[])`, [done.id]);
  });
});

// ───────────────────────────── 2. La función de IA ─────────────────────────────

describe('ai-reel-like: coste máximo antes de analizar', () => {
  it('dice si está disponible, el coste máximo (mirar + voz) y los topes', async () => {
    const t = await setup();
    const fn = createFunction();
    const { status, body } = await fn.call(login(t.editor), { action: 'options', brandId: t.brand });
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: true, speechAvailable: true });
    const estimate = body.estimate as { textMicros: number; speechMicros: number; maxMicros: number; speechMicrosPerSecond: number };
    // El peor caso: 12 fotogramas, 30 planos y la salida máxima, con el precio del modelo.
    const worst = priceUsage(TEXT_MODEL, fn.text!.estimateUsage({ task: 'text', model: TEXT_MODEL.model, input: reelLikeWorstCaseInput(t.brand, PROFILE) })).micros;
    expect(estimate.textMicros).toBe(worst);
    expect(estimate.speechMicros).toBe(SPEECH_PRICE * 120);
    expect(estimate.maxMicros).toBe(worst + SPEECH_PRICE * 120);
    expect(body.limits).toEqual({ maxSeconds: 180, maxUploadBytes: 50 * 1024 * 1024, maxSpeechSeconds: 120, maxFrames: 12 });
    // Preguntar no gasta ni reserva nada.
    expect(await db.query(`select 1 from public.ai_generations where brand_id = $1`, [t.brand])).toEqual([]);
    expect(fn.text!.calls).toHaveLength(0);
  });

  it('sin modelo con visión no está disponible (nada simulado); sin transcripción, sin voz; sin perfil, sí (y se avisa)', async () => {
    const t = await setup();
    const none = await createFunction({ text: null }).call(login(t.editor), { action: 'options', brandId: t.brand });
    expect(none.body).toMatchObject({ available: false, reason: 'not_configured', estimate: null });
    const mute = await createFunction({ speech: null }).call(login(t.editor), { action: 'options', brandId: t.brand });
    expect(mute.body).toMatchObject({ available: true, speechAvailable: false });
    expect((mute.body.estimate as { speechMicros: number }).speechMicros).toBe(0);
    const bare = await setup({ profile: null });
    const noProfile = await createFunction().call(login(bare.editor), { action: 'options', brandId: bare.brand });
    // Sin perfil también se puede (con el nombre y el sector de la marca); se avisa para que lo completen.
    expect(noProfile.body).toMatchObject({ available: true, profileMissing: true });
    // Y crear sin modelo responde 503 sin tocar el cupo.
    const done = await measured(t, new Map());
    const refused = await createFunction({ text: null }).call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: done.id });
    expect(refused.status).toBe(503);
    expect(errorOf(refused.body).code).toBe('not_configured');
    expect(await reference(done.id)).toMatchObject({ status: 'measured', ai_started_at: null });
  });

  it('exige sesión, marca visible y una petición bien formada', async () => {
    const t = await setup();
    const other = await setup();
    const fn = createFunction();
    expect((await fn.call(null, { action: 'options', brandId: t.brand })).status).toBe(401);
    expect((await fn.call('caducado', { action: 'options', brandId: t.brand })).status).toBe(401);
    expect((await fn.call(login(other.owner), { action: 'options', brandId: t.brand })).status).toBe(404);
    expect((await fn.call(login(t.editor), { action: 'borrar', brandId: t.brand })).status).toBe(400);
    expect((await fn.call(login(t.editor), { action: 'create', brandId: t.brand })).status).toBe(400);
    expect((await fn.call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: uuid() })).status).toBe(404);
  });
});

describe('ai-reel-like: estudiar el vídeo medido', () => {
  it('mira los fotogramas, transcribe la voz, guarda plantilla, guion y textos, y borra los archivos', async () => {
    const t = await setup();
    await as(
      db,
      t.owner,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes, folder, tags)
       values ($1, $2, 'image', $3, 'hogaza.jpg', 'image/jpeg', 10, 'Obrador', array['pan', 'horno'])`,
      [t.brand, t.org, `${t.org}/${t.brand}/media/${uuid()}.jpg`],
    );
    const fn = createFunction();
    const done = await measured(t, fn.files, { speech: true, idea: 'Cómo hacemos la hogaza de los sábados' });
    expect(fn.files.size).toBe(6);
    const { status, body } = await fn.call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: done.id });
    expect(status).toBe(200);
    expect(body.status).toBe('ready');
    const result = parseReelLikeResult(body.result)!;
    expect(result).not.toBeNull();

    // La estructura es la MEDIDA: cuatro planos, sus duraciones y sus transiciones.
    expect(result.template.shots.map((s) => s.seconds)).toEqual([2, 1.5, 2.25, 1.75]);
    expect(result.template.shots.map((s) => s.transition)).toEqual([
      { type: 'cut', seconds: 0 },
      { type: 'cut', seconds: 0 },
      { type: 'cut', seconds: 0 },
      { type: 'fade', seconds: 0.5 },
    ]);
    expect(result.template.totalSeconds).toBe(7.5);
    // Una imagen fija es foto aunque el modelo diga otra cosa.
    expect(result.template.shots.map((s) => s.media)).toEqual(['video', 'foto', 'video', 'foto']);
    expect(result.template.audio).toEqual({ kind: 'voz-y-musica', bpm: 120, cutsOnBeat: 0.67, beatsPerCut: 4 });
    expect(result.template.pace).toBe('medio');
    // Textos en pantalla: momento sacado de los planos.
    expect(result.template.texts).toMatchObject([
      { id: 't1', role: 'gancho', position: 'top', size: 'grande', fromShot: 's1', toShot: 's1', start: 0, end: 2 },
      { id: 't2', role: 'llamada', position: 'center', fromShot: 's4', toShot: 's4', start: 5.75, end: 7.5 },
    ]);
    expect(result.texts.onScreen.map((x) => x.text)).toEqual(['t1', 't2']);
    // Con la voz de la marca: la idea, el mensaje y la llamada del perfil.
    expect(result.script.idea).toBe('Cómo hacemos la hogaza de los sábados.');
    expect(result.texts.caption).toContain('Pan hecho hoy, con masa madre');
    expect(result.texts.caption).toContain('Pásate antes de las doce');
    expect(result.texts.hashtags).toEqual(['#masamadre', '#panaderia']);
    expect(result.script.shots).toHaveLength(4);
    // Las palabras de búsqueda salen de la biblioteca de la marca.
    expect(result.script.shots[0]!.search).toEqual(['pan']);
    expect(result.transcriptUsed).toBe(true);

    // El modelo recibió los 4 fotogramas (con su etiqueta), la medición y la transcripción, como datos.
    const sent = fn.text!.calls[0]!.input;
    expect(sent.images!.map((i) => i.label)).toEqual([
      'Fotograma del plano 1 (segundo 1.2):',
      'Fotograma del plano 2 (segundo 2.9):',
      'Fotograma del plano 3 (segundo 4.85):',
      'Fotograma del plano 4 (segundo 6.8):',
    ]);
    expect(sent.instructions).toBe(REEL_LIKE_INSTRUCTIONS);
    expect(sent.context!.map((c) => c.label)).toEqual(['perfil de marca', MATERIAL.measurement, MATERIAL.idea, MATERIAL.transcript, MATERIAL.library]);
    expect(sent.context!.find((c) => c.label === MATERIAL.transcript)!.content).toMatch(/^\[0\.1 s\] \[simulado\] Frase 1 de 1/);
    expect(JSON.parse(sent.context!.find((c) => c.label === MATERIAL.library)!.content)).toEqual({ carpetas: ['Obrador'], etiquetas: ['pan', 'horno'] });

    // Cupo y registro: dos generaciones (voz y visión) con su coste, a nombre de quien lo pidió.
    const generations = await db.query<{ task: string; purpose: string; status: string; cost_micros: string; requested_by: string }>(
      `select task, purpose, status, cost_micros, requested_by from public.ai_generations where brand_id = $1 order by created_at`,
      [t.brand],
    );
    expect(generations.map((g) => [g.task, g.purpose, g.status])).toEqual([
      ['transcription', 'reel.like.transcript', 'succeeded'],
      ['text', 'reel.like', 'succeeded'],
    ]);
    expect(generations.every((g) => g.requested_by === t.editor.id)).toBe(true);
    const total = generations.reduce((sum, g) => sum + Number(g.cost_micros), 0);
    expect(Number(generations[0]!.cost_micros)).toBe(8 * SPEECH_PRICE); // 7,2 s → 8 s
    expect(body.costMicros).toBe(total);

    // El análisis queda listo, sin vídeo, y los archivos se han borrado y olvidado.
    const row = await reference(done.id);
    expect(row).toMatchObject({ status: 'ready', source_path: null, ai_started_at: null, error: null });
    expect(Number(row!.cost_micros)).toBe(total);
    expect(row!.generation_ids).toHaveLength(2);
    expect(row!.files_released_at).not.toBeNull();
    expect(parseReelLikeResult(row!.result)).toEqual(result);
    expect(fn.files.size).toBe(0);
    expect([...fn.removed].sort()).toEqual(
      [done.source, ...[1, 2, 3, 4].map((i) => `${done.job.payload.output.dir}/f-0${i}.jpg`), `${done.job.payload.output.dir}/a-01.m4a`].sort(),
    );
    expect(await queued(t.brand)).toEqual([]);

    // Volver a pedirlo devuelve lo guardado, sin gastar otra vez.
    const again = await fn.call(login(t.viewer), { action: 'create', brandId: t.brand, referenceId: done.id });
    expect(again.status).toBe(200);
    expect(parseReelLikeResult(again.body.result)).toEqual(result);
    expect(fn.text!.calls).toHaveLength(1);
  });

  it('si se pidió guardar el vídeo como referencia privada, no se borra', async () => {
    const t = await setup();
    const fn = createFunction();
    const done = await measured(t, fn.files, { keepSource: true });
    expect((await fn.call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: done.id })).status).toBe(200);
    expect(await reference(done.id)).toMatchObject({ status: 'ready', source_path: done.source, keep_source: true });
    expect([...fn.files.keys()]).toEqual([done.source]);
    expect(fn.removed).not.toContain(done.source);
  });

  it('lo que no se pudo borrar se queda en la cola de limpieza', async () => {
    const t = await setup();
    const files = new Map<string, Uint8Array>();
    const fn = createFunction({ files, removeFiles: async () => [] });
    const done = await measured(t, files);
    expect((await fn.call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: done.id })).status).toBe(200);
    expect(await queued(t.brand)).toHaveLength(5);
    expect(fn.logs.map((l) => l.event)).toContain('files_left_for_cleanup');
  });

  it('sin cupo o sin permiso no se llama al modelo y el análisis se puede reintentar', async () => {
    const poor = await setup({ quota: 10 });
    const fn = createFunction();
    const done = await measured(poor, fn.files);
    const noQuota = await fn.call(login(poor.editor), { action: 'create', brandId: poor.brand, referenceId: done.id });
    expect(noQuota.status).toBe(402);
    expect(errorOf(noQuota.body).code).toBe('quota_exhausted');
    expect(fn.text!.calls).toHaveLength(0);
    expect(await reference(done.id)).toMatchObject({ status: 'measured', ai_started_at: null, result: null });
    expect(fn.files.size).toBe(5);

    // Quien solo ve la marca no puede gastar su cupo.
    const t = await setup();
    const other = createFunction();
    const mine = await measured(t, other.files);
    const viewer = await other.call(login(t.viewer), { action: 'create', brandId: t.brand, referenceId: mine.id });
    expect(viewer.status).toBe(403);
    expect(other.text!.calls).toHaveLength(0);
    // Con cupo y permiso, el mismo análisis sale.
    expect((await other.call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: mine.id })).status).toBe(200);
  });

  it('modo agencia: solo el personal de la agencia; el resto, 409 antes de tocar el cupo', async () => {
    // Marca de una empresa en modo agencia: sus miembros no son personal de la agencia.
    const client = await setup();
    await as(db, client.owner, `update public.brands set ai_mode = 'agency' where id = $1`, [client.brand]);
    const fn = createFunction();
    const done = await measured(client, fn.files);
    const options = await fn.call(login(client.owner), { action: 'options', brandId: client.brand });
    expect(options.body).toMatchObject({ available: false, reason: 'agency_mode', agencyMode: true });
    const refused = await fn.call(login(client.owner), { action: 'create', brandId: client.brand, referenceId: done.id });
    expect(refused.status).toBe(409);
    expect(errorOf(refused.body).code).toBe('agency_mode');
    expect(await db.query(`select 1 from public.ai_generations where brand_id = $1`, [client.brand])).toEqual([]);
    expect(await reference(done.id)).toMatchObject({ status: 'measured', ai_started_at: null });

    // La propietaria de una organización de tipo agencia sí, con su cupo.
    const staff = await setup({ kind: 'agency' });
    await as(db, staff.owner, `update public.brands set ai_mode = 'agency' where id = $1`, [staff.brand]);
    const staffFn = createFunction();
    const theirs = await measured(staff, staffFn.files, { user: staff.owner });
    expect((await staffFn.call(login(staff.owner), { action: 'options', brandId: staff.brand })).body).toMatchObject({ available: true });
    expect((await staffFn.call(login(staff.owner), { action: 'create', brandId: staff.brand, referenceId: theirs.id })).status).toBe(200);
    // Su editora (miembro de la marca, no administradora de la agencia), no.
    const second = await measured(staff, staffFn.files, { user: staff.owner });
    expect((await staffFn.call(login(staff.editor), { action: 'create', brandId: staff.brand, referenceId: second.id })).status).toBe(409);
  });

  it('no deja estudiar el análisis de otra marca ni uno a medias, cerrado o ya en marcha', async () => {
    const t = await setup();
    const other = await setup();
    const fn = createFunction();
    const done = await measured(t, fn.files);
    const token = login(t.editor);
    // Otra organización: como si no existiera. Y con otra marca en la petición, tampoco.
    expect((await fn.call(login(other.editor), { action: 'create', brandId: other.brand, referenceId: done.id })).status).toBe(404);
    expect((await fn.call(login(other.editor), { action: 'create', brandId: t.brand, referenceId: done.id })).status).toBe(404);
    // Todavía midiéndose.
    const pending = await request(t.editor, t.brand, { source: { path: sourcePath(t.org, t.brand) } });
    const early = await fn.call(token, { action: 'create', brandId: t.brand, referenceId: pending.payload.reference.id });
    expect(early.status).toBe(409);
    expect(errorOf(early.body)).toMatchObject({ code: 'not_measured', retryable: true });
    // Fallido: se enseña el motivo.
    await work(pending, { error: 'El vídeo dura 400 s y el máximo son 180 s (3 minutos).' });
    const closed = await fn.call(token, { action: 'create', brandId: t.brand, referenceId: pending.payload.reference.id });
    expect(closed.status).toBe(409);
    expect(errorOf(closed.body).message).toMatch(/400 s/);
    // Ya hay otra petición escribiéndolo.
    expect(await serviceRpc(db, 'reel_reference_claim', { p_reference_id: done.id, p_claim: true })).toBe(true);
    const busy = await fn.call(token, { action: 'create', brandId: t.brand, referenceId: done.id });
    expect(busy.status).toBe(409);
    expect(errorOf(busy.body).code).toBe('busy');
    // Una reserva de hace más de 5 minutos se da por perdida.
    await db.query(`update public.reel_references set ai_started_at = now() - interval '6 minutes' where id = $1`, [done.id]);
    expect((await fn.call(token, { action: 'create', brandId: t.brand, referenceId: done.id })).status).toBe(200);
    expect(fn.text!.calls).toHaveLength(1);
  });

  it('sin fotogramas en el almacén no gasta; si el modelo responde mal o falla la voz, lo dice y se puede reintentar', async () => {
    const t = await setup();
    const token = login(t.editor);
    // Fotogramas ya borrados.
    const empty = createFunction();
    const gone = await measured(t, new Map());
    const missing = await empty.call(token, { action: 'create', brandId: t.brand, referenceId: gone.id });
    expect(missing.status).toBe(409);
    expect(errorOf(missing.body).code).toBe('files_missing');
    expect(empty.text!.calls).toHaveLength(0);

    // El modelo no cumple el esquema: el coste queda anotado, nada se guarda y se suelta la reserva.
    const broken = createFunction({ text: createSimulatedProvider({ respond: () => '{"name": "a medias"}' }) });
    const first = await measured(t, broken.files);
    const invalid = await broken.call(token, { action: 'create', brandId: t.brand, referenceId: first.id });
    expect(invalid.status).toBe(502);
    expect(errorOf(invalid.body).code).toBe('invalid_output');
    expect(await reference(first.id)).toMatchObject({ status: 'measured', ai_started_at: null, result: null });
    expect(broken.files.size).toBe(5);

    // La transcripción falla (no es cosa del cupo): se sigue sin ella y se avisa.
    const deaf = createFunction({ speech: createSimulatedTranscriptionProvider({ failWith: () => new Error('caído') }) });
    const second = await measured(t, deaf.files, { speech: true });
    const partial = await deaf.call(token, { action: 'create', brandId: t.brand, referenceId: second.id });
    expect(partial.status).toBe(200);
    const result = parseReelLikeResult(partial.body.result)!;
    expect(result.transcriptUsed).toBe(false);
    expect(result.notes).toContain('No se ha podido transcribir la voz: el guion sale solo de las imágenes.');
    // Sin transcripción configurada, también se avisa.
    const mute = createFunction({ speech: null });
    const third = await measured(t, mute.files, { speech: true });
    const noSpeech = await mute.call(token, { action: 'create', brandId: t.brand, referenceId: third.id });
    expect(parseReelLikeResult(noSpeech.body.result)!.notes).toContain('No se ha transcrito la voz: la transcripción no está configurada.');
  });
});

describe('visión en los adaptadores de texto (sin llamar a nadie)', () => {
  const input: AiInput = reelLikeInput('11111111-1111-4111-8111-111111111111', {
    brandProfile: PROFILE,
    measurement: parseMeasurement(
      measurementFor({ payload: { reference: { id: uuid() }, source: { path: 'x' }, speech: false, output: { dir: 'o/m/referencias/r' } } } as JobRow),
    )!,
    frames: [
      { data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', shot: 0, at: 1.2 },
      { data: new Uint8Array([4, 5, 6]), mimeType: 'image/jpeg', shot: 1, at: 2.9 },
    ],
  });

  it('OpenAI: cada fotograma va como image_url en detalle bajo, tras su etiqueta', () => {
    const body = buildChatBody({ task: 'text', model: 'modelo', input }) as {
      messages: Array<{ role: string; content: unknown }>;
      response_format: { json_schema: { name: string; strict: boolean } };
    };
    expect(body.messages[0]).toEqual({ role: 'system', content: REEL_LIKE_INSTRUCTIONS });
    const parts = body.messages[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }>;
    expect(parts.map((p) => p.type)).toEqual(['text', 'text', 'image_url', 'text', 'image_url']);
    expect(parts[1]!.text).toBe('Fotograma del plano 1 (segundo 1.2):');
    expect(parts[2]!.image_url).toEqual({ url: 'data:image/jpeg;base64,AQID', detail: 'low' });
    expect(body.response_format.json_schema).toMatchObject({ name: 'reel_like', strict: true });
    // Sin imágenes, el cuerpo es el de siempre (texto suelto).
    const plain = buildChatBody({ task: 'text', model: 'm', input: { prompt: 'hola' } }) as { messages: Array<{ content: unknown }> };
    expect(plain.messages[0]!.content).toBe('hola');
  });

  it('Anthropic: bloques de imagen en base64, con el perfil (en caché) delante y la petición al final', () => {
    const body = buildMessagesBody({ task: 'text', model: 'modelo', input }) as {
      messages: Array<{ content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string }; cache_control?: unknown }> }>;
    };
    const content = body.messages[0]!.content;
    expect(content[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } });
    const images = content.filter((b) => b.type === 'image');
    expect(images.map((b) => b.source)).toEqual([
      { type: 'base64', media_type: 'image/jpeg', data: 'AQID' },
      { type: 'base64', media_type: 'image/jpeg', data: 'BAUG' },
    ]);
    expect(content[content.length - 1]!.text).toMatch(/^El vídeo de referencia tiene 4 planos/);
  });

  it('se reserva una cota por imagen; Mistral las rechaza sin llamar; y se sabe quién las admite', async () => {
    const openai = createOpenAiProvider({ apiKey: 'k', fetch: async () => new Response('{}') });
    const withImages = openai.estimateUsage({ task: 'text', model: 'm', input });
    const without = openai.estimateUsage({ task: 'text', model: 'm', input: { ...input, images: [] } });
    expect(withImages.input_tokens! - without.input_tokens!).toBe(2 * (IMAGE_TOKENS_UPPER + 20));
    let called = 0;
    const mistral = createMistralProvider({
      apiKey: 'k',
      fetch: async () => {
        called += 1;
        return new Response('{}');
      },
    });
    await expect(mistral.generate({ task: 'text', model: 'm', input, signal: new AbortController().signal })).rejects.toThrow(/no admite imágenes/);
    expect(called).toBe(0);
    expect(['openai', 'anthropic', 'anthropic-bedrock', 'anthropic-vertex'].every(supportsImages)).toBe(true);
    expect(supportsImages('mistral')).toBe(false);
  });

  it('reel.like usa el proveedor de texto general, o el suyo si se configura; sin visión o sin clave no hay función', () => {
    const openai = { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://eu.api.openai.com' };
    const prices = (key: string) => ({
      AI_PRICES: JSON.stringify({ [key]: { input_tokens: 1, output_tokens: 4, cache_read_input_tokens: 0.1 } }),
    });
    const general = loadReelLikeTextConfig({
      AI_TEXT_PROVIDER: 'openai',
      AI_TEXT_MODEL: 'modelo-general',
      // Las rutas de otras tareas no cuentan aquí.
      AI_TEXT_POST_CAPTION_PROVIDER: 'mistral',
      AI_TEXT_POST_CAPTION_MODEL: 'otro',
      ...openai,
      ...prices('openai/modelo-general'),
    });
    expect(general.spec).toMatchObject({ provider: 'openai', model: 'modelo-general', task: 'text', purposes: [REEL_LIKE_PURPOSE] });
    expect(general.spec!.microsPerUnit).toEqual({ input_tokens: 1, output_tokens: 4, cache_read_input_tokens: 0.1 });
    expect(general.ready).toBe(true);
    expect(general.providers.map((p) => p.id)).toEqual(['openai']);

    const own = loadReelLikeTextConfig({
      AI_TEXT_PROVIDER: 'mistral',
      AI_TEXT_MODEL: 'modelo-general',
      MISTRAL_API_KEY: 'k',
      AI_TEXT_REEL_LIKE_PROVIDER: 'openai',
      AI_TEXT_REEL_LIKE_MODEL: 'modelo-con-vision',
      ...openai,
    });
    expect(own.spec).toMatchObject({ provider: 'openai', model: 'modelo-con-vision' });
    expect(own.ready).toBe(true);

    // Un adaptador sin visión: hay modelo, pero la función no se ofrece y el registro dice por qué.
    const blind = loadReelLikeTextConfig({ AI_TEXT_PROVIDER: 'mistral', AI_TEXT_MODEL: 'm', MISTRAL_API_KEY: 'k' });
    expect(blind.ready).toBe(false);
    expect(blind.problems.join(' ')).toMatch(/no las admite: define AI_TEXT_REEL_LIKE_PROVIDER/);
    // Sin clave, fuera de la UE o sin nada configurado: tampoco.
    expect(loadReelLikeTextConfig({ AI_TEXT_PROVIDER: 'openai', AI_TEXT_MODEL: 'm' }).ready).toBe(false);
    expect(loadReelLikeTextConfig({ AI_TEXT_PROVIDER: 'openai', AI_TEXT_MODEL: 'm', OPENAI_API_KEY: 'k' }).ready).toBe(false);
    expect(loadReelLikeTextConfig({})).toMatchObject({ spec: null, ready: false, models: [] });
    // El simulado solo con la guarda de las pruebas locales.
    const local = loadReelLikeTextConfig({ AI_E2E_SIMULATED_PROVIDER: 'true', SUPABASE_URL: 'http://127.0.0.1:54321' });
    expect(local.spec).toMatchObject({ provider: 'simulated', purposes: [REEL_LIKE_PURPOSE] });
    expect(local.ready).toBe(true);
    expect(() => loadReelLikeTextConfig({ AI_E2E_SIMULATED_PROVIDER: 'true', SUPABASE_URL: 'https://x.supabase.co' })).toThrow();
    // Y no se ha colado como una tarea más de Integraciones.
    expect(TEXT_PURPOSES as readonly string[]).not.toContain(REEL_LIKE_PURPOSE);
    expect(loadAiTextConfig({ AI_TEXT_REEL_LIKE_PROVIDER: 'openai', AI_TEXT_REEL_LIKE_MODEL: 'm', ...openai }).models).toEqual([]);
  });

  it('el esquema que se pide al modelo es estricto y el peor caso cabe en él', () => {
    const everyRequired = (schema: Record<string, unknown>) => {
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      if (!properties) return;
      expect((schema.required as string[]).sort()).toEqual(Object.keys(properties).sort());
      expect(schema.additionalProperties).toBe(false);
      for (const child of Object.values(properties)) {
        everyRequired(child);
        if (child.items) everyRequired(child.items as Record<string, unknown>);
      }
    };
    everyRequired(REEL_LIKE_SCHEMA.schema as Record<string, unknown>);
    expect(validateJson({ name: 'x' }, REEL_LIKE_SCHEMA.schema).length).toBeGreaterThan(0);
    const worst = reelLikeWorstCaseInput('11111111-1111-4111-8111-111111111111', PROFILE);
    expect(worst.images).toHaveLength(LIKE_LIMITS.maxFrames);
    expect(worst.params).toEqual({ max_output_tokens: 12_000 });
  });
});

// ───────────────────────────── 3. La estructura del análisis y su pieza ─────────────────────────────

describe('la estructura que sale del análisis', () => {
  const spec = (name = 'Gancho + pasos + cierre') => ({
    schemaVersion: 1,
    name,
    summary: 'Arranca con una promesa y la cumple en tres pasos.',
    totalSeconds: 5,
    pace: 'medio',
    audio: { kind: 'musica', bpm: 120 },
    shots: [
      { id: 's1', seconds: 2, kind: 'detalle', media: 'video', description: 'Plano cerrado', transition: { type: 'cut', seconds: 0 } },
      { id: 's2', seconds: 3, kind: 'general', media: 'foto', description: 'El local', transition: { type: 'fade', seconds: 0.4 } },
    ],
    texts: [{ id: 't1', role: 'gancho', position: 'top', size: 'grande', fromShot: 's1', toShot: 's1', start: 0, end: 2, maxChars: 40 }],
    cover: { at: 1.2, note: 'El producto' },
  });
  it('el esquema compartido deja la plantilla en su forma canónica y rechaza lo que no lo es', () => {
    const parsed = parseReelStructure({
      ...spec(),
      totalSeconds: 999,
      pace: 'frenético',
      shots: [
        { seconds: 2, kind: 'inventado', media: 'video', description: '  Plano   cerrado  ', transition: { type: 'fade', seconds: 1 } },
        { seconds: 3, kind: 'general', media: 'foto', transition: { type: 'fade', seconds: 9 } },
      ],
      texts: [{ role: 'gancho', position: 'top', size: 'grande', fromShot: 's2', toShot: 's1', start: 77, end: 78, maxChars: 5000 }],
      cover: { at: 50, note: 'x' },
    })!;
    expect(parsed.totalSeconds).toBe(5);
    expect(parsed.pace).toBe('medio');
    expect(parsed.shots[0]).toMatchObject({ id: 's1', kind: 'general', description: 'Plano cerrado', transition: { type: 'cut', seconds: 0 } });
    expect(parsed.shots[1]!.transition).toEqual({ type: 'fade', seconds: 2 });
    // Los tiempos del texto salen de los planos, no de lo guardado.
    expect(parsed.texts[0]).toMatchObject({ fromShot: 's2', toShot: 's2', start: 2, end: 5, maxChars: 200 });
    expect(parsed.cover.at).toBe(5);
    expect(parseReelStructure({ ...spec(), schemaVersion: 2 })).toBeNull();
    expect(parseReelStructure({ ...spec(), name: '' })).toBeNull();
    expect(parseReelStructure({ ...spec(), shots: [{ seconds: -1 }] })).toBeNull();
    expect(parseReelStructure(null)).toBeNull();
  });

  it('la plantilla del análisis se entrega a la marca en el formato compartido, con origen «reference»', async () => {
    // El conversor y el validador son de la aplicación (zod, Vite): se cargan por ruta
    // calculada, porque TypeScript revisa estas pruebas sin la configuración de la aplicación.
    const app = <T>(file: string): Promise<T> =>
      import(/* @vite-ignore */ pathToFileURL(path.resolve(process.cwd(), 'src/features/reels', file)).href) as Promise<T>;
    type Checked = { ok: true; template: { slots: Array<{ seconds: number; shot?: string; kind: string }> } } | { ok: false };
    const { REEL_TEMPLATES } = await app<{ REEL_TEMPLATES: Array<{ id: string }> }>('templates.ts');
    const { validateReelTemplate } = await app<{ validateReelTemplate(raw: unknown, styleIds: string[]): Checked }>(
      'reelTemplate.ts',
    );
    const { toReelTemplate, templateKey } = await app<{
      toReelTemplate(result: unknown, options: { styles: unknown[]; origin: { kind: string } }): Json;
      templateKey(name: string, suffix?: string): string;
    }>('like/template.ts');
    const t = await setup();
    const other = await setup();
    const fn = createFunction();
    const done = await measured(t, fn.files);
    await fn.call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: done.id });
    const result = parseReelLikeResult((await reference(done.id))!.result)!;
    const document = toReelTemplate(result, { styles: REEL_TEMPLATES, origin: { kind: 'upload' } });
    const deliver = (user: TestUser, brand: string, key: string) =>
      as<{ data: Row }>(
        db,
        user,
        `select to_jsonb(r) as data from public.deliver_reel_templates($1, $2::jsonb, 'reference') r`,
        [brand, JSON.stringify([{ key, name: 'Gancho + 2 planos + cierre', document }])],
      ).then((rows) => rows[0]!.data);

    const key = templateKey('Gancho + 2 planos + cierre', 'ab12cd34');
    const saved = await deliver(t.editor, t.brand, key);
    expect(saved).toMatchObject({
      brand_id: t.brand,
      template_key: 'ref-gancho-2-planos-cierre-ab12cd34',
      name: 'Gancho + 2 planos + cierre',
      source: 'reference',
      created_by: t.editor.id,
    });
    // Lo guardado es una plantilla de reel válida, con los planos medidos.
    const stored = validateReelTemplate(
      saved.document,
      REEL_TEMPLATES.map((s) => s.id),
    );
    expect(stored.ok).toBe(true);
    expect(stored.ok && stored.template.slots.map((slot) => [slot.seconds, slot.shot, slot.kind])).toEqual([
      [2, 'detail', 'video'],
      [1.5, 'wide', 'photo'],
      [2.25, 'person', 'video'],
      [1.75, 'detail', 'photo'],
    ]);
    // Quien solo ve la marca no la guarda; otra organización, ni la guarda aquí ni la ve.
    await expect(deliver(t.viewer, t.brand, 'ref-otra-1')).rejects.toThrow(/Solo quien edita la marca/);
    await expect(deliver(other.owner, t.brand, 'ref-otra-2')).rejects.toThrow(/Solo quien edita la marca/);
    expect(await as(db, other.owner, `select 1 from public.brand_reel_templates where id = $1`, [saved.id])).toEqual([]);
    expect(await as(db, t.viewer, `select 1 from public.brand_reel_templates where id = $1`, [saved.id])).toHaveLength(1);
    // Descartar el análisis no borra la plantilla.
    await as(db, t.editor, `select public.discard_reel_reference($1)`, [done.id]);
    expect(await db.query(`select 1 from public.brand_reel_templates where id = $1`, [saved.id])).toHaveLength(1);
  });

  it('apunta la pieza que se abre en el editor a partir del análisis', async () => {
    const t = await setup();
    const other = await setup();
    const done = await measured(t, new Map());
    const piece = async (s: Awaited<ReturnType<typeof setup>>, format: string) =>
      (
        await as<{ id: string }>(
          db,
          s.owner,
          `insert into public.content_items (brand_id, organization_id, title, network, format)
           values ($1, $2, 'Pieza', 'instagram', $3) returning id`,
          [s.brand, s.org, format],
        )
      )[0]!.id;
    const reel = await piece(t, 'reel');
    await as(db, t.editor, `select public.set_reel_reference_content($1, $2)`, [done.id, reel]);
    expect(await reference(done.id)).toMatchObject({ content_id: reel });
    await expect(as(db, t.editor, `select public.set_reel_reference_content($1, $2)`, [done.id, await piece(t, 'post')])).rejects.toThrow(/no es un reel de esta marca/);
    await expect(as(db, t.editor, `select public.set_reel_reference_content($1, $2)`, [done.id, await piece(other, 'reel')])).rejects.toThrow(/no es un reel de esta marca/);
    await denied(db, t.viewer, `select public.set_reel_reference_content($1, $2)`, [done.id, reel]);
  });
});

// ───────────────────────────── 4. De punta a punta ─────────────────────────────

const WORKER_READY =
  ['zod', 'htmlparser2', 'robots-parser', 'ipaddr.js'].every((dep) =>
    existsSync(path.resolve(process.cwd(), 'worker/node_modules', dep)),
  ) && spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version']).status === 0;

/** Lo que se usa del trabajador (worker/), sin importarlo de forma estática. */
interface WorkerAnalyze {
  createReelAnalyzeHandler(deps: { tools: { ffmpeg: string; ffprobe: string }; defaultFontFile?: string }): {
    run(context: Record<string, unknown>): Promise<Json>;
  };
  REEL_ANALYZE_LIMITS: {
    maxSeconds: number;
    maxDownloadBytes: number;
    maxShots: number;
    maxFrames: number;
    speech: { maxTotalSeconds: number };
  };
}
interface WorkerReference {
  makeReferenceReel(file: string, options: { ffmpeg?: string; fontFile?: string }): Promise<void>;
  REFERENCE_REEL: {
    durationSeconds: number;
    bpm: number;
    shots: ReadonlyArray<{ start: number; seconds: number; still: boolean }>;
  };
}

describe('de punta a punta con un vídeo de ejemplo', () => {
  it.skipIf(!WORKER_READY)(
    'vídeo de 4 planos con rótulos → trabajador (FFmpeg) → función (IA simulada) → plantilla con los cortes y duraciones del vídeo',
    async () => {
      // El trabajador de verdad, cargado solo aquí y por ruta calculada: el CI de la raíz no
      // instala worker/ (zod 4, htmlparser2…), así que ni TypeScript ni Vite deben resolverlo antes.
      const worker = <T>(file: string): Promise<T> =>
        import(/* @vite-ignore */ pathToFileURL(path.resolve(process.cwd(), 'worker', file)).href) as Promise<T>;
      const { createReelAnalyzeHandler, REEL_ANALYZE_LIMITS } = await worker<WorkerAnalyze>('src/handlers/reel-analyze.ts');
      const { createFolderStorage } = await worker<{ createFolderStorage(root: string): unknown }>('src/storage.ts');
      const { toolsFromEnv } = await worker<{ toolsFromEnv(): { ffmpeg: string; ffprobe: string } }>('src/ffmpeg/run.ts');
      const { findDefaultFont } = await worker<{ findDefaultFont(): string | undefined }>('src/ffmpeg/fonts.ts');
      const { createMemoryLogger } = await worker<{ createMemoryLogger(): unknown }>('src/logger.ts');
      const { makeReferenceReel, REFERENCE_REEL } = await worker<WorkerReference>('tests/helpers/reference.ts');
      // Los topes que enseña la aplicación son los del trabajador.
      expect(REFERENCE_LIMITS.maxSeconds).toBe(REEL_ANALYZE_LIMITS.maxSeconds);
      expect(REFERENCE_LIMITS.maxSpeechSeconds).toBe(REEL_ANALYZE_LIMITS.speech.maxTotalSeconds);
      expect(REFERENCE_LIMITS.maxUploadBytes).toBe(REEL_ANALYZE_LIMITS.maxDownloadBytes);
      expect(LIKE_LIMITS.maxFrames).toBe(REEL_ANALYZE_LIMITS.maxFrames);
      expect(LIKE_LIMITS.maxShots).toBe(REEL_ANALYZE_LIMITS.maxShots);

      const t = await setup();
      const bucket = await mkdtemp(path.join(os.tmpdir(), 'rrss-reel-como-este-'));
      const workDir = await mkdtemp(path.join(os.tmpdir(), 'rrss-reel-como-este-job-'));
      const inBucket = (objectPath: string) => path.join(bucket, objectPath);
      try {
        // 1. La persona sube el vídeo a la carpeta privada de referencias y encarga el análisis.
        const tools = toolsFromEnv();
        const source = sourcePath(t.org, t.brand);
        await mkdir(path.dirname(inBucket(source)), { recursive: true });
        await makeReferenceReel(inBucket(source), { ffmpeg: tools.ffmpeg, fontFile: findDefaultFont() });
        const job = await request(t.editor, t.brand, { source: { path: source }, speech: true, idea: 'Así hacemos el pan cada mañana' });
        const id = job.payload.reference.id;

        // 2. El trabajador lo reclama de la cola, lo mide con FFmpeg y cierra el trabajo.
        const { worker, claimed } = await claimJob(job);
        const measurement = await createReelAnalyzeHandler({ tools, defaultFontFile: findDefaultFont() }).run({
          job: { ...claimed, kind: KIND, attempts: 1, max_attempts: 3 },
          signal: new AbortController().signal,
          storage: createFolderStorage(bucket),
          workDir,
          log: createMemoryLogger(),
        });
        await serviceRpc(db, 'complete_job', { p_job_id: job.id, p_worker: worker, p_result: measurement });
        expect(await reference(id)).toMatchObject({ status: 'measured' });
        const dir = inBucket(job.payload.output.dir);
        const produced = await readdir(dir);
        expect(produced.filter((f) => f.endsWith('.jpg'))).toHaveLength(4);
        expect(produced.some((f) => f.endsWith('.m4a'))).toBe(true);

        // 3. La función estudia los fotogramas reales (IA simulada) y guarda el resultado.
        const fn = createFunction({
          readFile: async (p) => readFile(inBucket(p)).then((b) => new Uint8Array(b)).catch(() => null),
          removeFiles: async (paths) => {
            for (const p of paths) await rm(inBucket(p), { force: true });
            return paths;
          },
        });
        const { status, body } = await fn.call(login(t.editor), { action: 'create', brandId: t.brand, referenceId: id });
        expect(status).toBe(200);
        const result = parseReelLikeResult(body.result)!;

        // 4. La plantilla tiene los cortes y las duraciones del vídeo de ejemplo.
        expect(result.template.shots).toHaveLength(REFERENCE_REEL.shots.length);
        result.template.shots.forEach((shot, index) => {
          const expected = REFERENCE_REEL.shots[index]!;
          expect(Math.abs(shot.seconds - expected.seconds), `duración del plano ${index + 1}`).toBeLessThan(0.1);
          expect(shot.media, `plano ${index + 1}`).toBe(expected.still ? 'foto' : 'video');
        });
        expect(result.template.shots.map((s) => s.transition.type)).toEqual(['cut', 'cut', 'cut', 'fade']);
        expect(Math.abs(result.template.totalSeconds - REFERENCE_REEL.durationSeconds)).toBeLessThan(0.1);
        expect(Math.abs((result.template.audio.bpm ?? 0) - REFERENCE_REEL.bpm)).toBeLessThan(5);
        expect(result.template.texts[0]).toMatchObject({ role: 'gancho', fromShot: 's1', start: 0 });
        expect(Math.abs(result.template.texts[0]!.end - 2)).toBeLessThan(0.1);
        expect(result.script.idea).toBe('Así hacemos el pan cada mañana.');
        expect(result.transcriptUsed).toBe(true);
        // El modelo recibió los JPEG de verdad.
        const images = fn.text!.calls[0]!.input.images!;
        expect(images).toHaveLength(4);
        expect(images.every((i) => i.data[0] === 0xff && i.data[1] === 0xd8 && i.data.length > 1000)).toBe(true);

        // 5. Del vídeo de referencia no queda nada: ni el archivo, ni fotogramas, ni sonido, ni recursos.
        await expect(stat(inBucket(source))).rejects.toThrow();
        expect(await readdir(dir)).toEqual([]);
        expect(await queued(t.brand)).toEqual([]);
        expect(await db.query(`select 1 from public.media_assets where brand_id = $1`, [t.brand])).toEqual([]);
        expect(await reference(id)).toMatchObject({ status: 'ready', source_path: null });
      } finally {
        await rm(bucket, { recursive: true, force: true });
        await rm(workDir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});

// ───────────────────────────── 5. La prueba real de un comando ─────────────────────────────

describe('scripts/reel-como-este-prueba.ts', () => {
  const openai = {
    AI_TEXT_PROVIDER: 'openai',
    AI_TEXT_MODEL: 'modelo-con-vision',
    OPENAI_API_KEY: 'clave-de-mentira',
    OPENAI_BASE_URL: 'https://eu.api.openai.com',
    AI_PRICES: JSON.stringify({ 'openai/modelo-con-vision': { input_tokens: 1, output_tokens: 4, cache_read_input_tokens: 0.1 } }),
  };

  it('en seco dice el modelo, lo que falta y el coste máximo, sin llamar a nadie', () => {
    const empty = planRealTest({});
    expect(empty).toMatchObject({ ready: false, model: null, maxMicros: null });
    expect(formatPlan(empty, false).join('\n')).toMatch(/Modelo: \(sin configurar\)[\s\S]*Falta: No hay modelo elegido[\s\S]*EN SECO: no se ha llamado a nadie/);

    const plan = planRealTest(openai);
    expect(plan).toMatchObject({ ready: true, provider: 'openai', model: 'modelo-con-vision', problems: [] });
    // 4 fotogramas (820 tokens de cota cada uno) + el texto, a 1 micro; la salida, a 4.
    expect(plan.maxMicros).toBeGreaterThan(4 * 820 + 3900 * 4);
    expect(plan.maxMicros).toBeLessThan(60_000);
    const lines = formatPlan(plan, false).join('\n');
    expect(lines).toContain('Modelo: openai/modelo-con-vision');
    expect(lines).toMatch(/Coste máximo estimado: 0,0\d+/);
    // La clave no sale nunca.
    expect(lines).not.toContain('clave-de-mentira');

    // Sin precio, sin clave o fuera de la UE no está lista; con --voz hace falta la transcripción.
    expect(planRealTest({ ...openai, AI_PRICES: undefined }).ready).toBe(false);
    expect(planRealTest({ ...openai, OPENAI_API_KEY: undefined }).ready).toBe(false);
    expect(planRealTest({ ...openai, OPENAI_BASE_URL: undefined }).ready).toBe(false);
    expect(planRealTest({ ...openai, AI_TEXT_PROVIDER: 'mistral', MISTRAL_API_KEY: 'k' }).ready).toBe(false);
    const withVoice = planRealTest(openai, { speech: true });
    expect(withVoice.ready).toBe(true);
    expect(withVoice.maxMicros).toBeGreaterThan(plan.maxMicros!);
    expect(formatPlan(planRealTest({}), true).join('\n')).toContain('No se ha llamado a nadie');
  });

  it.skipIf(!WORKER_READY)(
    'con --apply mide el vídeo de ejemplo con el trabajador, llama UNA vez al modelo y deja el resultado',
    async () => {
      const out = await mkdtemp(path.join(os.tmpdir(), 'rrss-reel-prueba-real-'));
      const provider = createLocalTestProvider();
      const lines: string[] = [];
      try {
        const run = await runRealTest({
          env: {},
          root: process.cwd(),
          out,
          speech: false,
          idea: 'Cómo hacemos el pan',
          profile: SAMPLE_PROFILE,
          log: (line) => lines.push(line),
          provider: { text: provider, model: LOCAL_TEST_MODEL, price: (usage) => priceUsage(TEXT_MODEL, usage).micros },
        });
        expect(provider.calls).toHaveLength(1);
        expect(provider.calls[0]!.input.images).toHaveLength(4);
        expect(run.result.template.shots.map((s) => Math.round(s.seconds * 4) / 4)).toEqual([2, 1.5, 2.25, 1.75]);
        expect(run.costMicros).toBeGreaterThan(0);
        const saved = JSON.parse(await readFile(run.file, 'utf8')) as { model: string; costMicros: number; result: Json };
        expect(saved).toMatchObject({ model: LOCAL_TEST_MODEL, costMicros: run.costMicros });
        expect(parseReelLikeResult(saved.result)).toEqual(run.result);
        expect(lines.join('\n')).toMatch(/Medido sin IA: 4 planos[\s\S]*Consumo: [\s\S]*coste real/);
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
