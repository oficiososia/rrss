// Lo publicado a mano («Terminar en Instagram») también se mide y sale en Resultados
// (migración 20270125010000_publicadas_a_mano_analitica). Contra las migraciones reales y
// la Graph API SIMULADA: un reel emparejado con su publicación y uno marcado «Ya lo publiqué»
// con su enlace se miden; lo pendiente no (pendiente no es publicado), y la marca de otra
// organización no ve nada.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANALYTICS_CAPTURE_JOB_KIND,
  processCaptureJob,
} from '../../supabase/functions/_shared/analytics/capture.ts';
import { createInsightsGraph } from '../../supabase/functions/_shared/analytics/insights-graph.ts';
import { simulatedMediaValue } from '../../supabase/functions/_shared/analytics/simulated-insights.ts';
import { createSimulatedGraph, type SimulatedGraph } from '../../supabase/functions/_shared/social/simulated-graph.ts';
import { KEYS, socialKit } from './apoyo-analitica';
import { as, assetPath, createBrand, createDb, createOrg, createUser, join, type Db, type TestUser } from './helpers';

let db: Db;
let kit: ReturnType<typeof socialKit>;
let graph: SimulatedGraph;
let ana: TestUser, lector: TestUser, berta: TestUser;
let org: string, marca: string, cuenta: string, video: string;
let emparejada: string, conEnlace: string, pendiente: string, sinLeer: string;

const WORKER = 'pruebas:social-insights-a-mano';
const TOKEN = 'sim-page-a-mano-1';
const DOC = { schemaVersion: 1, canvas: {}, layers: [], copy: { caption: '', hashtags: [] } };
const ID_EMPAREJADA = '178900000000101';
const ID_CON_ENLACE = '178900000000102';
const ID_PENDIENTE = '178900000000103';
type Job = { id: string; payload: Record<string, unknown>; attempts: number; max_attempts: number };

async function rpc(user: TestUser, fn: string, args: unknown[]): Promise<{ id: string; status: string }> {
  const list = args.map((_, i) => `$${i + 1}`).join(', ');
  const [row] = await as<{ data: { id: string; status: string } }>(
    db,
    user,
    `select to_jsonb(r) as data from public.${fn}(${list}) r`,
    args,
  );
  return row!.data;
}

/** Un reel aprobado con su primera versión, entregado para terminarlo en Instagram. */
async function handedOff(title: string): Promise<string> {
  const [item] = await as<{ id: string }>(
    db,
    ana,
    `insert into public.content_items (brand_id, organization_id, title, network, format)
     values ($1, $2, $3, 'instagram', 'reel') returning id`,
    [marca, org, title],
  );
  await as(db, ana, `select public.save_content_version($1, $2::jsonb, 1)`, [item!.id, JSON.stringify(DOC)]);
  await as(db, ana, `select public.set_content_status($1, 'approved', 1)`, [item!.id]);
  return (await rpc(ana, 'start_manual_publication', [item!.id, video, title])).id;
}

/** Una publicación leída de la cuenta (como la guarda «Buscar en Instagram»). */
async function imported(id: string, permalink: string): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into public.social_imported_media (social_account_id, brand_id, organization_id, external_id, media_type,
                                                media_product_type, permalink, published_at, caption)
     select a.id, a.brand_id, a.organization_id, $2, 'VIDEO', 'REELS', $3, now() + interval '1 minute', 'Pie'
     from public.social_accounts a where a.id = $1 returning id`,
    [cuenta, id, permalink],
  );
  return row!.id;
}

async function capture() {
  await kit.serviceCall('analytics_enqueue_captures', {});
  const jobs = (await kit.serviceCall('claim_jobs', {
    p_worker: WORKER,
    p_kinds: [ANALYTICS_CAPTURE_JOB_KIND],
    p_limit: 20,
    p_lease_seconds: 300,
  })) as Job[];
  const results = [];
  for (const job of jobs) {
    results.push(
      await processCaptureJob(job, {
        rpc: kit.rpc,
        api: createInsightsGraph({ fetch: graph.fetch }),
        keyRing: KEYS,
        workerName: WORKER,
      }),
    );
  }
  return results;
}

beforeAll(async () => {
  db = await createDb();
  kit = socialKit(db);
  ana = await createUser(db, 'ana@amano.test', 'Ana');
  lector = await createUser(db, 'lector@amano.test', 'Lector');
  berta = await createUser(db, 'berta@otra.test', 'Berta');
  org = await createOrg(db, ana, 'Empresa', 'business', 'self');
  marca = await createBrand(db, ana, org, 'Marca');
  await join(db, ana, lector, org, 'member', marca, 'viewer');
  const otra = await createOrg(db, berta, 'Otra', 'business', 'self');
  await createBrand(db, berta, otra, 'Marca ajena');
  // La red simulada contesta las métricas de publicaciones que no publicó la plataforma (las de a mano).
  graph = createSimulatedGraph({ insights: { answerUnknownMedia: true } });
  cuenta = await kit.connect(ana, marca, TOKEN);
  const [asset] = await as<{ id: string }>(
    db,
    ana,
    `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
     values ($1, $2, 'video', $3, 'reel.mp4', 'video/mp4', 100) returning id`,
    [marca, org, assetPath(org, marca, `${crypto.randomUUID()}.mp4`)],
  );
  video = asset!.id;

  // 1. Encontrada en la cuenta (emparejada con su publicación).
  emparejada = await handedOff('Reel emparejado');
  const leida = await imported(ID_EMPAREJADA, `https://www.instagram.com/reel/EMPAREJ1/`);
  await rpc(ana, 'match_manual_publication', [emparejada, leida]);
  // 2. «Ya lo publiqué» con el enlace; la publicación se leyó de la cuenta después.
  conEnlace = await handedOff('Reel con enlace');
  await rpc(ana, 'confirm_manual_publication', [conEnlace, 'https://www.instagram.com/reel/CONENL2/?igsh=abc']);
  await imported(ID_CON_ENLACE, 'https://www.instagram.com/casa_demo/reel/CONENL2/');
  // 3. Pendiente: aunque haya una publicación parecida en la cuenta, no es publicado.
  pendiente = await handedOff('Reel pendiente');
  await imported(ID_PENDIENTE, 'https://www.instagram.com/reel/PENDI3/');
  // 4. «Ya lo publiqué» sin enlace: no hay con qué reconocerla.
  sinLeer = await handedOff('Reel sin enlace');
  await rpc(ana, 'confirm_manual_publication', [sinLeer, null]);
});

afterAll(async () => {
  await db?.close();
});

describe('lo publicado a mano se mide', () => {
  it('el capturador mide los reels publicados a mano que reconoce en la cuenta; lo pendiente, no', async () => {
    const begin = (await kit.serviceCall('analytics_capture_begin', { p_account_id: cuenta })) as {
      media: Array<{ publication_id: string | null; manual_publication_id?: string; external_id: string; format: string }>;
    };
    expect(begin.media.map((m) => [m.manual_publication_id, m.external_id, m.format]).sort()).toEqual(
      [
        [emparejada, ID_EMPAREJADA, 'reel'],
        [conEnlace, ID_CON_ENLACE, 'reel'],
      ].sort(),
    );
    expect(begin.media.every((m) => m.publication_id === null)).toBe(true);
    // Ni la pendiente ni la marcada sin enlace (no hay con qué reconocerla).
    const measured = begin.media.map((m) => m.manual_publication_id);
    expect(measured).not.toContain(pendiente);
    expect(measured).not.toContain(sinLeer);

    const [result] = await capture();
    expect(result).toMatchObject({ outcome: 'succeeded' });
    const rows = await db.query<{ manual_publication_id: string; external_media_id: string; publication_id: null }>(
      `select distinct manual_publication_id, external_media_id, publication_id from public.media_metrics_daily
       where social_account_id = $1 order by external_media_id`,
      [cuenta],
    );
    expect(rows).toEqual([
      { manual_publication_id: emparejada, external_media_id: ID_EMPAREJADA, publication_id: null },
      { manual_publication_id: conEnlace, external_media_id: ID_CON_ENLACE, publication_id: null },
    ]);
  });

  it('el servidor no guarda cifras de lo pendiente ni de otra cuenta', async () => {
    await expect(
      kit.serviceCall('analytics_record_capture', {
        p_account_id: cuenta,
        p_job_id: null,
        p_status: 'succeeded',
        p_started_at: new Date().toISOString(),
        p_window_from: null,
        p_window_to: null,
        p_account_rows: [],
        p_media_rows: [
          { external_id: ID_PENDIENTE, metric_id: 'instagram.media.reach', date: new Date().toISOString().slice(0, 10), value: 1 },
        ],
      }),
    ).rejects.toThrow(/no es de esta cuenta/);
    const pend = await db.query(`select 1 from public.media_metrics_daily where external_media_id = $1`, [ID_PENDIENTE]);
    expect(pend).toEqual([]);
  });

  it('Resultados las enseña con el título de su pieza, su enlace y sus cifras; otra organización, nada', async () => {
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const hasta = new Date(Date.now() + 86_400_000).toISOString();
    const resumen = await as<{
      publication_id: string;
      title: string;
      format: string;
      external_url: string | null;
      manual: boolean;
      metrics: Record<string, number>;
    }>(db, lector, `select * from public.analytics_media_summary($1, $2, $3)`, [marca, desde, hasta]);
    expect(resumen.map((r) => [r.publication_id, r.title, r.format, r.manual]).sort()).toEqual(
      [
        [emparejada, 'Reel emparejado', 'reel', true],
        [conEnlace, 'Reel con enlace', 'reel', true],
      ].sort(),
    );
    const conCifras = resumen.find((r) => r.publication_id === conEnlace)!;
    expect(conCifras.external_url).toBe('https://www.instagram.com/reel/CONENL2/?igsh=abc');
    expect(conCifras.metrics['instagram.media.views']).toBe(simulatedMediaValue(ID_CON_ENLACE, 'REELS', 'views', 0));
    expect(await as(db, berta, `select * from public.analytics_media_summary($1, $2, $3)`, [marca, desde, hasta])).toEqual(
      [],
    );
  });

  it('el informe del mes los cuenta con su título', async () => {
    // El informe es de un mes terminado: las cifras se llevan al mes anterior.
    await db.query(
      `update public.media_metrics_daily set published_at = published_at - interval '1 month',
              metric_date = (metric_date - interval '1 month')::date where manual_publication_id is not null`,
    );
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 1);
    const month = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const [report] = await as<{ id: string }>(db, ana, `select (public.request_analytics_report($1, $2::date)).id`, [
      marca,
      month,
    ]);
    const source = (await kit.serviceCall('analytics_report_source', { p_report_id: report!.id })) as {
      media: Array<{ publication_id: string; title: string; manual: boolean }>;
    };
    expect(source.media.filter((m) => m.manual).map((m) => m.title).sort()).toEqual(
      ['Reel con enlace', 'Reel emparejado'].sort(),
    );
  });

  it('con la vuelta atrás de la entrega borrada, sus cifras se quedan sin entrega (no se pierden)', async () => {
    // Una cifra apunta a su entrega con «on delete set null».
    const [fk] = await db.query<{ confdeltype: string }>(
      `select confdeltype from pg_constraint where conrelid = 'public.media_metrics_daily'::regclass
       and contype = 'f' and pg_get_constraintdef(oid) like '%manual_publications%'`,
    );
    expect(fk!.confdeltype).toBe('n');
  });
});
