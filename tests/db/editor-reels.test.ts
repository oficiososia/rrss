// Editor de reels contra las migraciones reales (20261207010000_reel_editor):
// el montaje se guarda como versión de una pieza de formato reel, el encargo
// admite el plan v2 y el enlace con la pieza, cada archivo y cada tipografía
// se comprueban contra la marca, la música exige su licencia y el vídeo
// resultante queda unido a la pieza y a la versión en su procedencia.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
  type Db,
  type Row,
  type TestUser,
} from './helpers';

interface JobRow extends Row {
  id: string;
  payload: Row & { output: { path: string }; plan: Row; content?: Row };
  result: (Row & { assets?: Array<{ id: string }> }) | null;
}

let db: Db;
let ana: TestUser, editor: TestUser, berta: TestUser;
let orgA: string, orgB: string, marcaA: string, marcaA2: string, marcaB: string;
let fotoA: string, clipA: string, musicaA: string, fuenteA: string, fuenteA2: string, clipB: string;
let reelA: string, postA: string, reelA2: string, reelB: string;
let n = 0;

async function asset(user: TestUser, org: string, brand: string, kind: string, name: string, mime: string) {
  const storagePath = `${org}/${brand}/media/${name}`;
  await as(
    db,
    user,
    `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
     values ($1, $2, $3::public.asset_kind, $4, $5, $6, 1000)`,
    [brand, org, kind, storagePath, name, mime],
  );
  return storagePath;
}

async function font(user: TestUser, org: string, brand: string, family: string) {
  const storagePath = `${org}/${brand}/fonts/${family.toLowerCase()}.ttf`;
  await as(
    db,
    user,
    `insert into public.brand_fonts (brand_id, organization_id, family, format, storage_path, file_name, mime_type,
                                     bytes, license_confirmed)
     values ($1, $2, $3, 'ttf', $4, 'f.ttf', 'font/ttf', 10, true)`,
    [brand, org, family, storagePath],
  );
  return storagePath;
}

async function piece(user: TestUser, org: string, brand: string, format: string) {
  const rows = await as<{ id: string }>(
    db,
    user,
    `insert into public.content_items (brand_id, organization_id, title, network, format)
     values ($1, $2, 'Reel de prueba', 'instagram', $3) returning id`,
    [brand, org, format],
  );
  return rows[0]!.id;
}

const STYLE = {
  sizeRatio: 0.06,
  color: '#FFFFFF',
  marginRatio: 0.2,
  maxWidthRatio: 0.84,
  lineHeight: 1.3,
  box: null,
  outline: null,
  fadeSeconds: 0.25,
};

const planV2 = (overrides: Row = {}): Row => ({
  version: 2,
  clips: [
    { id: 'c1', type: 'photo', path: fotoA, seconds: 2, transition: { type: 'fade', seconds: 0.4 } },
    {
      id: 'c2',
      type: 'video',
      path: clipA,
      in: 0.5,
      out: 2.5,
      volume: 0.6,
      subtitles: [{ start: 0.6, end: 1.5, text: 'Hola' }],
    },
  ],
  texts: [
    { id: 't1', text: 'Menú del día', start: 0, end: 2, position: 'top', style: { ...STYLE, fontPath: fuenteA } },
  ],
  subtitles: { enabled: true, position: 'bottom', style: STYLE },
  music: {
    path: musicaA,
    startAt: 0,
    volume: 0.3,
    fadeInSeconds: 0.5,
    fadeOutSeconds: 1,
    license: { confirmed: true, note: 'Licencia de la marca' },
  },
  ...overrides,
});

const project = (plan: Row = planV2()) => ({ kind: 'reel', template: { id: 'fundido-suave' }, plan });

async function saveVersion(user: TestUser, contentId: string, data: Row) {
  const { sql, params } = rpcStatement('save_content_version', {
    p_content_id: contentId,
    p_data: data,
    p_schema_version: 2,
    p_change_note: 'Montaje',
  });
  return (await as<{ data: { version: number } }>(db, user, sql, params))[0]!.data;
}

const request = async (user: TestUser, brand: string, input: Row) => {
  const { sql, params } = rpcStatement('request_media_job', {
    p_brand_id: brand,
    p_kind: 'media.reel.template',
    p_input: input,
    p_idempotency_key: `editor-${++n}`,
  });
  return (await as<{ data: JobRow }>(db, user, sql, params))[0]!.data;
};

const rejected = (user: TestUser, brand: string, input: Row, pattern: RegExp) => {
  const { sql, params } = rpcStatement('request_media_job', {
    p_brand_id: brand,
    p_kind: 'media.reel.template',
    p_input: input,
    p_idempotency_key: `rechazo-${++n}`,
  });
  return denied(db, user, sql, params, pattern);
};

beforeAll(async () => {
  db = await createDb();
  ana = await createUser(db, 'ana@a.test');
  editor = await createUser(db, 'editor@a.test');
  berta = await createUser(db, 'berta@b.test');
  orgA = await createOrg(db, ana, 'Empresa A');
  orgB = await createOrg(db, berta, 'Empresa B');
  marcaA = await createBrand(db, ana, orgA, 'Marca A');
  marcaA2 = await createBrand(db, ana, orgA, 'Marca A2');
  marcaB = await createBrand(db, berta, orgB, 'Marca B');
  await join(db, ana, editor, orgA, 'member', marcaA, 'editor');
  fotoA = await asset(ana, orgA, marcaA, 'image', 'plato.jpg', 'image/jpeg');
  clipA = await asset(ana, orgA, marcaA, 'video', 'cocina.mp4', 'video/mp4');
  musicaA = await asset(ana, orgA, marcaA, 'audio', 'musica.m4a', 'audio/mp4');
  clipB = await asset(berta, orgB, marcaB, 'video', 'ajeno.mp4', 'video/mp4');
  fuenteA = await font(ana, orgA, marcaA, 'Titular');
  fuenteA2 = await font(ana, orgA, marcaA2, 'Otra');
  reelA = await piece(editor, orgA, marcaA, 'reel');
  postA = await piece(editor, orgA, marcaA, 'post');
  reelA2 = await piece(ana, orgA, marcaA2, 'reel');
  reelB = await piece(berta, orgB, marcaB, 'reel');
});

afterAll(async () => {
  await db?.close();
});

describe('el montaje como versión de la pieza', () => {
  it('se guarda con versiones, como un diseño, y se puede aprobar esa versión', async () => {
    const v1 = await saveVersion(editor, reelA, project());
    expect(v1.version).toBe(1);
    const v2 = await saveVersion(editor, reelA, project(planV2({ texts: [] })));
    expect(v2.version).toBe(2);
    const rows = await as<{ version: number; schema_version: number; kind: string }>(
      db,
      editor,
      `select version, schema_version, data ->> 'kind' as kind from public.content_versions
       where content_id = $1 order by version`,
      [reelA],
    );
    expect(rows).toEqual([
      { version: 1, schema_version: 2, kind: 'reel' },
      { version: 2, schema_version: 2, kind: 'reel' },
    ]);
    const { sql, params } = rpcStatement('set_content_status', {
      p_content_id: reelA,
      p_status: 'approved',
      p_expected_version: 2,
    });
    await as(db, ana, sql, params);
    const [item] = await db.query<{ status: string }>(`select status from public.content_items where id = $1`, [reelA]);
    expect(item!.status).toBe('approved');
  });
});

describe('encargar el montaje (plan v2)', () => {
  it('admite el plan v2 con la pieza, y la base pone la salida y la tipografía de la marca', async () => {
    const job = await request(editor, marcaA, {
      template: { id: 'fundido-suave' },
      plan: planV2(),
      content: { id: reelA, version: 2 },
    });
    expect(job.payload.output.path).toMatch(new RegExp(`^${orgA}/${marcaA}/reels/[0-9a-f-]{36}\\.mp4$`));
    expect(job.payload.content).toEqual({ id: reelA, version: 2 });
    expect(job.payload.plan).toMatchObject({ version: 2, clips: [{ id: 'c1' }, { id: 'c2', in: 0.5 }] });
    expect(job.payload.plan.fontPath).toBe(fuenteA);

    // Solo subtítulos, sin textos: también lleva la tipografía de la marca.
    const subs = await request(editor, marcaA, { template: { id: 'fundido-suave' }, plan: planV2({ texts: [] }) });
    expect(subs.payload.plan.fontPath).toBe(fuenteA);
    // Sin textos ni subtítulos, no.
    const bare = await request(editor, marcaA, {
      template: { id: 'fundido-suave' },
      plan: planV2({ texts: [], subtitles: { enabled: false, position: 'bottom', style: STYLE } }),
    });
    expect(bare.payload.plan).not.toHaveProperty('fontPath');
  });

  it('rechaza archivos y tipografías de otra marca, campos de más y música sin licencia', async () => {
    const input = (plan: Row) => ({ template: { id: 'fundido-suave' }, plan });
    const clips = planV2().clips as Row[];
    // Archivo de otra marca: el mensaje genérico, sin la ruta (20270107010000).
    await rejected(
      editor,
      marcaA,
      input(planV2({ clips: [{ ...clips[1], path: clipB }] })),
      /^Pieza 1: el archivo no es un recurso de esta marca$/,
    );
    await rejected(
      editor,
      marcaA,
      input(
        planV2({
          texts: [{ id: 't', text: 'x', start: 0, end: 1, position: 'top', style: { ...STYLE, fontPath: fuenteA2 } }],
        }),
      ),
      /tipografía no es un \.ttf u \.otf de esta marca/,
    );
    await rejected(
      editor,
      marcaA,
      input(
        planV2({
          subtitles: {
            enabled: true,
            position: 'bottom',
            style: { ...STYLE, fontPath: `${orgA}/${marcaA}/fonts/no.ttf` },
          },
        }),
      ),
      /tipografía no es/,
    );
    await rejected(editor, marcaA, input(planV2({ fontPath: fuenteA })), /solo admite/);
    await rejected(editor, marcaA, input(planV2({ clips: [{ ...clips[0], cliente: 'x' }] })), /campos no admitidos/);
    const music = planV2().music as Row;
    await rejected(editor, marcaA, input(planV2({ music: { ...music, license: { confirmed: false } } })), /licencia/);
    await rejected(editor, marcaA, input(planV2({ music: { ...music, license: undefined } })), /licencia/);
    await rejected(
      editor,
      marcaA,
      input(planV2({ clips: [{ ...clips[1], subtitles: [{ start: 0, end: 1, text: '' }] }] })),
      /subtítulo no válido/,
    );
  });

  it('la pieza tiene que ser un reel vivo de la misma marca, con esa versión', async () => {
    const input = (content: Row) => ({ template: { id: 'fundido-suave' }, plan: planV2(), content });
    const pattern = /no es un reel de esta marca/;
    await rejected(editor, marcaA, input({ id: reelA, version: 9 }), pattern);
    await rejected(editor, marcaA, input({ id: postA, version: 1 }), pattern);
    await saveVersion(ana, reelA2, project());
    await rejected(ana, marcaA, input({ id: reelA2, version: 1 }), pattern);
    await rejected(editor, marcaA, input({ id: reelB, version: 1 }), pattern);
    await rejected(editor, marcaA, input({ id: 'no-es-un-uuid', version: 1 }), pattern);
  });

  it('el vídeo montado queda unido a la pieza y a su versión, con la licencia de la música', async () => {
    const job = await request(editor, marcaA, {
      template: { id: 'fundido-suave' },
      plan: planV2(),
      content: { id: reelA, version: 2 },
    });
    const { sql, params } = rpcStatement('claim_jobs', { p_worker: 'editor-1', p_limit: 10 });
    await asService(db, sql, params);
    const done = await serviceRpc<JobRow>(db, 'complete_job', {
      p_job_id: job.id,
      p_worker: 'editor-1',
      p_result: {
        template: { id: 'fundido-suave', schemaVersion: 1 },
        plan: { version: 2 },
        content: { id: reelA, version: 2 },
        output: {
          path: job.payload.output.path,
          width: 1080,
          height: 1920,
          fps: 30,
          durationSeconds: 3.6,
          videoCodec: 'h264',
          audioCodec: 'aac',
          bytes: 123456,
        },
        timeline: [],
        warnings: [],
      },
    });
    const assetId = done.result!.assets![0]!.id;
    const [video] = await db.query<{ provenance: Row; kind: string }>(
      `select kind, provenance from public.media_assets where id = $1`,
      [assetId],
    );
    expect(video!.kind).toBe('video');
    expect(video!.provenance).toMatchObject({
      type: 'media_job',
      plan_version: 2,
      content_id: reelA,
      content_version: 2,
      music_license: { confirmed: true, note: 'Licencia de la marca' },
      sources: [
        { type: 'photo', path: fotoA },
        { type: 'video', path: clipA },
      ],
    });
    // Quien ve la marca encuentra los montajes de la pieza; la otra organización, no.
    const mine = await as(db, editor, `select id from public.media_assets where provenance ->> 'content_id' = $1`, [
      reelA,
    ]);
    expect(mine).toHaveLength(1);
    const theirs = await as(db, berta, `select id from public.media_assets where provenance ->> 'content_id' = $1`, [
      reelA,
    ]);
    expect(theirs).toHaveLength(0);
  });
});

describe('animación de textos, movimiento de fotos y portada (20261215010000)', () => {
  const animated = () =>
    planV2({
      clips: [
        { id: 'c1', type: 'photo', path: fotoA, seconds: 2, motion: 'pan-up', motionAmount: 0.15 },
        { id: 'c2', type: 'video', path: clipA, in: 0.5, out: 2.5, volume: 0 },
      ],
      texts: [
        {
          id: 't1',
          text: 'Hola',
          start: 0,
          end: 2,
          position: 'top',
          style: STYLE,
          animation: { in: 'typewriter', out: 'fall', seconds: 0.8 },
        },
      ],
      cover: { type: 'frame', at: 1.5 },
    });

  beforeAll(async () => {
    // Las pruebas anteriores dejan encargos en cola: el tope es de 5 a la vez por marca.
    await db.query(`update public.jobs set status = 'cancelled', locked_by = null, locked_until = null where status in ('queued', 'running')`);
  });

  it('admite animación, intensidad y portada, y la base pone la ruta de la portada', async () => {
    const job = await request(editor, marcaA, { template: { id: 'fundido-suave' }, plan: animated() });
    expect(job.payload.plan).toMatchObject({
      cover: { type: 'frame', at: 1.5 },
      texts: [{ animation: { in: 'typewriter', out: 'fall', seconds: 0.8 } }],
      clips: [{ motion: 'pan-up', motionAmount: 0.15 }, {}],
    });
    expect(job.payload.output).toMatchObject({
      posterPath: job.payload.output.path.replace(/\.mp4$/, '-cover.jpg'),
    });
    // Sin portada, sin ruta de portada.
    const bare = await request(editor, marcaA, { template: { id: 'fundido-suave' }, plan: planV2() });
    expect(bare.payload.output).not.toHaveProperty('posterPath');
  });

  it('rechaza una portada o una animación mal formadas y fotos de otra marca', async () => {
    const withCover = (cover: Row) => planV2({ cover });
    await rejected(editor, marcaA, { template: { id: 'fundido-suave' }, plan: withCover({ type: 'frame', at: 500 }) }, /portada/i);
    await rejected(editor, marcaA, { template: { id: 'fundido-suave' }, plan: withCover({ type: 'otra' }) }, /portada/i);
    await rejected(
      editor,
      marcaA,
      { template: { id: 'fundido-suave' }, plan: withCover({ type: 'photo', path: `${orgB}/${marcaB}/media/ajena.jpg` }) },
      /Portada/,
    );
    const bad = planV2({
      texts: [{ id: 't1', text: 'x', start: 0, end: 1, position: 'top', style: STYLE, animation: { in: 'fade', out: 'fade', extra: 1 } }],
    });
    await rejected(editor, marcaA, { template: { id: 'fundido-suave' }, plan: bad }, /animación/);
  });

  it('la portada del trabajo queda en la biblioteca, unida al vídeo y a la pieza', async () => {
    const job = await request(editor, marcaA, {
      template: { id: 'fundido-suave' },
      plan: animated(),
      content: { id: reelA, version: 2 },
    });
    const { sql, params } = rpcStatement('claim_jobs', { p_worker: 'editor-2', p_limit: 10 });
    await asService(db, sql, params);
    const done = await serviceRpc<JobRow>(db, 'complete_job', {
      p_job_id: job.id,
      p_worker: 'editor-2',
      p_result: {
        template: { id: 'fundido-suave', schemaVersion: 1 },
        plan: { version: 2 },
        output: { path: job.payload.output.path, width: 1080, height: 1920, fps: 30, durationSeconds: 3.6,
                  videoCodec: 'h264', audioCodec: 'aac', bytes: 123456 },
        poster: { path: (job.payload.output as Row).posterPath, source: 'frame', atSeconds: 1.5, width: 1080, height: 1920, bytes: 4000 },
        timeline: [],
        warnings: [],
      },
    });
    // El vídeo sigue siendo el primer recurso.
    const first = (await db.query<{ kind: string }>(`select kind from public.media_assets where id = $1`, [done.result!.assets![0]!.id]))[0]!;
    expect(first.kind).toBe('video');
    const poster = (done.result as Row).poster as Row;
    expect(poster.asset_id).toBeTruthy();
    const [cover] = await db.query<{ kind: string; folder: string; provenance: Row }>(
      `select kind, folder, provenance from public.media_assets where id = $1`,
      [poster.asset_id],
    );
    expect(cover).toMatchObject({
      kind: 'image',
      folder: 'Reels',
      provenance: { role: 'cover', cover_source: 'frame', cover_at_seconds: 1.5, cover_of_path: job.payload.output.path, content_id: reelA, content_version: 2 },
    });
  });
});

describe('editor como los de móvil (20261228010000): velocidad, filtro y textos colocados', () => {
  const clip = (patch: Row = {}) => ({ id: 'c1', type: 'video', path: clipA, in: 0, out: 2, volume: 1, ...patch });
  const plan = (clips: Row[], texts: Row[] = []) => ({ version: 2, clips, texts });
  const input = (p: Row) => ({ template: { id: 'fundido-suave' }, plan: p });

  it('admite un clip dividido en dos partes con velocidad, volumen y filtro propios, y un texto colocado a mano', async () => {
    const job = await request(
      editor,
      marcaA,
      input(
        plan(
          [
            clip({ out: 1.2 }),
            clip({ id: 'c2', in: 1.2, volume: 0, speed: 2, filter: 'bw', transition: { type: 'cut', seconds: 0 } }),
            { id: 'c3', type: 'photo', path: fotoA, seconds: 1.5, filter: 'warm' },
          ],
          [{ id: 't1', text: 'Oferta', start: 0, end: 1, position: 'center', style: STYLE, offset: { x: 0.1, y: -0.25 } }],
        ),
      ),
    );
    const clips = job.payload.plan.clips as Row[];
    expect(clips[1]).toMatchObject({ speed: 2, filter: 'bw', volume: 0 });
    expect(clips[2]).toMatchObject({ filter: 'warm' });
    expect((job.payload.plan.texts as Row[])[0]).toMatchObject({ offset: { x: 0.1, y: -0.25 } });
  });

  it('rechaza velocidades fuera de 0,5–2, filtros inventados y posiciones exageradas o con campos de más', async () => {
    await rejected(editor, marcaA, input(plan([clip({ speed: 3 })])), /velocidad/);
    await rejected(editor, marcaA, input(plan([clip({ speed: 0.2 })])), /velocidad/);
    await rejected(editor, marcaA, input(plan([clip({ speed: 'rapido' })])), /velocidad/);
    await rejected(editor, marcaA, input(plan([clip({ filter: 'neon' })])), /filtro/);
    // Una foto no tiene velocidad.
    await rejected(
      editor,
      marcaA,
      input(plan([{ id: 'c1', type: 'photo', path: fotoA, seconds: 2, speed: 2 }])),
      /campos no admitidos/,
    );
    const text = (offset: Row) => [{ id: 't1', text: 'x', start: 0, end: 1, position: 'top', style: STYLE, offset }];
    await rejected(editor, marcaA, input(plan([clip()], text({ x: 0.9, y: 0 }))), /posición/);
    await rejected(editor, marcaA, input(plan([clip()], text({ x: 0.1 }))), /posición/);
    await rejected(editor, marcaA, input(plan([clip()], text({ x: 0.1, y: 0.1, z: 1 }))), /posición/);
  });

  it('un nulo en los campos nuevos no llega al trabajador: la base de datos lo quita', async () => {
    const job = await request(editor, marcaA, input(plan([clip({ speed: null, filter: null })])));
    const stored = (job.payload.plan.clips as Row[])[0]!;
    expect(stored).not.toHaveProperty('speed');
    expect(stored).not.toHaveProperty('filter');
  });
});

describe('borrador automático del reel (20261228010000)', () => {
  const draft = (clips: Row[] = []) => ({ kind: 'reel', template: { id: 'fundido-suave' }, plan: { version: 2, clips, texts: [] } });
  const save = (user: TestUser, contentId: string, data: Row, base = 0) => {
    const { sql, params } = rpcStatement('save_reel_draft', {
      p_content_id: contentId,
      p_data: data,
      p_base_version: base,
    });
    return as<{ data: string }>(db, user, sql, params);
  };
  let pieza: string;

  beforeAll(async () => {
    pieza = await piece(editor, orgA, marcaA, 'reel');
  });

  it('guarda el montaje a medio hacer (también vacío) sin crear ninguna versión, y lo sustituye al volver a guardar', async () => {
    await save(editor, pieza, draft());
    await save(editor, pieza, draft([{ id: 'c1', type: 'photo', path: fotoA, seconds: 2 }]));
    const rows = await as<{ data: Row; base_version: number; updated_by: string }>(
      db,
      editor,
      `select data, base_version, updated_by from public.reel_drafts where content_id = $1`,
      [pieza],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ base_version: 0, updated_by: editor.id });
    expect(((rows[0]!.data.plan as Row).clips as Row[])[0]).toMatchObject({ id: 'c1' });
    const [item] = await db.query<{ current_version: number }>(
      `select current_version from public.content_items where id = $1`,
      [pieza],
    );
    expect(item!.current_version).toBe(0);
    expect(await db.query(`select 1 from public.content_versions where content_id = $1`, [pieza])).toEqual([]);
  });

  it('rechaza lo que no es un montaje de reel, las piezas que no son reels y a quien no edita la marca', async () => {
    const call = (contentId: string, data: Row) =>
      rpcStatement('save_reel_draft', { p_content_id: contentId, p_data: data, p_base_version: 0 });
    let c = call(pieza, { kind: 'otro', plan: {} });
    await denied(db, editor, c.sql, c.params, /no es un montaje de reel/);
    c = call(pieza, { kind: 'reel' });
    await denied(db, editor, c.sql, c.params, /no es un montaje de reel/);
    c = call(postA, draft());
    await denied(db, editor, c.sql, c.params, /formato reel/);
    // Otra marca de la misma organización (el editor no la edita) y otra organización.
    c = call(reelA2, draft());
    await denied(db, editor, c.sql, c.params, /Solo quien edita la marca/);
    c = call(pieza, draft());
    await denied(db, berta, c.sql, c.params, /Solo quien edita la marca/);
    const d = rpcStatement('discard_reel_draft', { p_content_id: pieza });
    await denied(db, berta, d.sql, d.params, /Solo quien edita la marca/);
    // No se escribe directamente en la tabla.
    await denied(db, editor, `delete from public.reel_drafts`, [], /permission denied/);
    await denied(db, editor, `update public.reel_drafts set base_version = 9`, [], /permission denied/);
  });

  it('al guardar una versión el borrador desaparece; también se puede descartar a mano', async () => {
    expect(await db.query(`select 1 from public.reel_drafts where content_id = $1`, [pieza])).toHaveLength(1);
    await saveVersion(editor, pieza, project());
    expect(await db.query(`select 1 from public.reel_drafts where content_id = $1`, [pieza])).toEqual([]);
    await save(editor, pieza, draft(), 1);
    const { sql, params } = rpcStatement('discard_reel_draft', { p_content_id: pieza });
    await as(db, editor, sql, params);
    expect(await db.query(`select 1 from public.reel_drafts where content_id = $1`, [pieza])).toEqual([]);
    // Descartar cuando no hay nada no falla.
    await as(db, editor, sql, params);
  });

  it('una pieza archivada no admite borrador, y el borrador se va con la pieza', async () => {
    const otra = await piece(editor, orgA, marcaA, 'reel');
    await save(editor, otra, draft());
    await db.query(`update public.content_items set archived_at = now() where id = $1`, [otra]);
    const c = rpcStatement('save_reel_draft', { p_content_id: otra, p_data: draft(), p_base_version: 0 });
    await denied(db, editor, c.sql, c.params, /archivado/);
    await db.query(`delete from public.content_items where id = $1`, [otra]);
    expect(await db.query(`select 1 from public.reel_drafts where content_id = $1`, [otra])).toEqual([]);
  });
});

describe('fotos y vídeos borrados de la biblioteca (20270107010000)', () => {
  const input = (plan: Row) => ({ template: { id: 'fundido-suave' }, plan });
  const borrada = () => `${orgA}/${marcaA}/media/borrada-${++n}.jpg`;

  it('una foto o un vídeo de la marca que ya no existe se dice así, con su número y sin la ruta', async () => {
    const clips = planV2().clips as Row[];
    const foto = borrada();
    await rejected(
      editor,
      marcaA,
      input(planV2({ clips: [clips[0], { ...clips[0], id: 'c3', path: foto }] })),
      /^La foto 2 ya no está en la biblioteca$/,
    );
    await rejected(
      editor,
      marcaA,
      input(planV2({ clips: [{ ...clips[1], path: `${orgA}/${marcaA}/media/borrado.mp4` }] })),
      /^El vídeo 1 ya no está en la biblioteca$/,
    );
    const music = { ...(planV2().music as Row), path: `${orgA}/${marcaA}/media/borrada.m4a` };
    await rejected(editor, marcaA, input(planV2({ music })), /^La música ya no está en la biblioteca$/);
    await rejected(
      editor,
      marcaA,
      input(planV2({ cover: { type: 'photo', path: foto } })),
      /^La foto de la portada ya no está en la biblioteca$/,
    );
  });

  it('una ruta de otra marca o mal formada no dice si existe ni enseña la ruta', async () => {
    const clips = planV2().clips as Row[];
    // De otra organización (exista o no): el mensaje genérico.
    for (const path of [clipB, `${orgB}/${marcaB}/media/no-existe.mp4`, `${orgA}/${marcaA2}/media/x.mp4`]) {
      await rejected(
        editor,
        marcaA,
        input(planV2({ clips: [{ ...clips[1], path }] })),
        /^Pieza 1: el archivo no es un recurso de esta marca$/,
      );
    }
    // De la marca pero de otro tipo (un clip donde va una foto): existe, así que tampoco es «borrada».
    await rejected(
      editor,
      marcaA,
      input(planV2({ clips: [{ ...clips[0], path: clipA }] })),
      /^Pieza 1: el archivo no es un recurso de esta marca$/,
    );
    await rejected(
      editor,
      marcaA,
      input(planV2({ clips: [{ ...clips[0], path: `${orgA}/${marcaA}/../x.jpg` }] })),
      /^Pieza 1: la ruta del archivo no es válida$/,
    );
  });

  it('asset_usage encuentra los reels por la ruta del archivo, también en el borrador', async () => {
    const usos = (user: TestUser) =>
      as<{ asset_id: string; content_id: string }>(
        db,
        user,
        `select asset_id::text, content_id::text from public.asset_usage($1)`,
        [marcaA],
      );
    // Un archivo cuya ruta NO lleva su id (como los que genera el servidor).
    const ruta = `${orgA}/${marcaA}/media/generada-${++n}.jpg`;
    await as(
      db,
      ana,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'generada.jpg', 'image/jpeg', 1)`,
      [marcaA, orgA, ruta],
    );
    const [row] = await db.query<{ id: string }>(`select id::text from public.media_assets where storage_path = $1`, [ruta]);
    const clips = planV2().clips as Row[];
    const conVersion = await piece(editor, orgA, marcaA, 'reel');
    await saveVersion(editor, conVersion, project(planV2({ clips: [{ ...clips[0], path: ruta }] })));
    const soloBorrador = await piece(editor, orgA, marcaA, 'reel');
    const { sql, params } = rpcStatement('save_reel_draft', {
      p_content_id: soloBorrador,
      p_data: project(planV2({ clips: [{ ...clips[0], path: ruta }] })),
      p_base_version: 0,
    });
    await as(db, editor, sql, params);
    const mias = (await usos(editor)).filter((u) => u.asset_id === row!.id).map((u) => u.content_id).sort();
    expect(mias).toEqual([conVersion, soloBorrador].sort());
    // Con versión y borrador a la vez, la pieza sale una sola vez.
    const both = rpcStatement('save_reel_draft', {
      p_content_id: conVersion,
      p_data: project(planV2({ clips: [{ ...clips[0], path: ruta }] })),
      p_base_version: 1,
    });
    await as(db, editor, both.sql, both.params);
    expect((await usos(editor)).filter((u) => u.asset_id === row!.id)).toHaveLength(2);
    // Otra organización no ve nada.
    expect(await as(db, berta, `select * from public.asset_usage($1)`, [marcaA])).toEqual([]);
    await db.query(`delete from public.content_items where id = any($1::uuid[])`, [[conVersion, soloBorrador]]);
  });
});
