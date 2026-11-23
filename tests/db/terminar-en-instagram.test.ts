// «Terminar en Instagram (para poner música)» contra las migraciones reales
// (20270121010000_manual_publications, docs/editor-reels.md §12): entregar un
// reel aprobado para publicarlo a mano, «Ya lo publiqué», el emparejado con las
// publicaciones leídas de la cuenta (Graph API SIMULADA) y que pendiente no es
// publicado ni se cruza con la publicación por la API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createImportGraph } from '../../supabase/functions/_shared/social/import-graph.ts';
import { fetchRecentMedia } from '../../supabase/functions/_shared/social/recent.ts';
import { createSimulatedGraph } from '../../supabase/functions/_shared/social/simulated-graph.ts';
import { KEYS, socialKit } from './apoyo-analitica';
import {
  as,
  assetPath,
  createBrand,
  createDb,
  createOrg,
  createUser,
  denied,
  join,
  type Db,
  type TestUser,
} from './helpers';

interface Manual {
  id: string;
  status: string;
  content_version: number;
  media_asset_id: string;
  caption: string;
  handed_off_at: string;
  published_at: string | null;
  match_source: string | null;
  imported_media_id: string | null;
  external_id: string | null;
  external_url: string | null;
}

let db: Db;
let kit: ReturnType<typeof socialKit>;
let ana: TestUser, editor: TestUser, cliente: TestUser, berta: TestUser;
let org: string, marca: string, orgB: string, marcaB: string, cuenta: string;
let video: string, videoB: string, foto: string;

const TOKEN = 'sim-page-terminar-1';
const DOC = { schemaVersion: 1, canvas: {}, layers: [], copy: { caption: '', hashtags: [] } };

async function rpc(user: TestUser, fn: string, args: unknown[]): Promise<Manual> {
  const list = args.map((_, i) => `$${i + 1}`).join(', ');
  const [row] = await as<{ data: Manual }>(db, user, `select to_jsonb(r) as data from public.${fn}(${list}) r`, args);
  return row!.data;
}

async function addVideo(user: TestUser, o: string, b: string, kind = 'video', mime = 'video/mp4') {
  const [row] = await as<{ id: string }>(
    db,
    user,
    `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
     values ($1, $2, $3::public.asset_kind, $4, 'reel.mp4', $5, 100) returning id`,
    [b, o, kind, assetPath(o, b, `${crypto.randomUUID()}.mp4`), mime],
  );
  return row!.id;
}

/** Un reel con su primera versión; aprobado si se pide. */
async function reel(owner: TestUser, o: string, b: string, approved = true, format = 'reel'): Promise<string> {
  const [item] = await as<{ id: string }>(
    db,
    owner,
    `insert into public.content_items (brand_id, organization_id, title, network, format)
     values ($1, $2, 'Reel', 'instagram', $3) returning id`,
    [b, o, format],
  );
  await as(db, owner, `select public.save_content_version($1, $2::jsonb, 1)`, [item!.id, JSON.stringify(DOC)]);
  if (approved) await as(db, owner, `select public.set_content_status($1, 'approved', 1)`, [item!.id]);
  return item!.id;
}

/** Una publicación leída de la cuenta (como la guarda la importación). */
async function imported(
  brandAccount: string,
  id: string,
  extra: { type?: string; product?: string; at?: string; permalink?: string } = {},
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into public.social_imported_media (social_account_id, brand_id, organization_id, external_id, media_type,
                                                media_product_type, permalink, published_at, caption)
     select a.id, a.brand_id, a.organization_id, $2, $3, $4, $5, $6::timestamptz, 'Pie'
     from public.social_accounts a where a.id = $1 returning id`,
    [
      brandAccount,
      id,
      extra.type ?? 'VIDEO',
      extra.product ?? 'REELS',
      extra.permalink ?? `https://www.instagram.com/reel/${id}/`,
      extra.at ?? new Date(Date.now() + 60_000).toISOString(),
    ],
  );
  return row!.id;
}

beforeAll(async () => {
  db = await createDb();
  kit = socialKit(db);
  ana = await createUser(db, 'ana@terminar.test', 'Ana');
  editor = await createUser(db, 'editor@terminar.test', 'Editor');
  cliente = await createUser(db, 'cliente@terminar.test', 'Cliente');
  berta = await createUser(db, 'berta@terminar.test', 'Berta');
  org = await createOrg(db, ana, 'Empresa', 'business', 'self');
  marca = await createBrand(db, ana, org, 'Marca');
  orgB = await createOrg(db, berta, 'Otra', 'business', 'self');
  marcaB = await createBrand(db, berta, orgB, 'Marca B');
  await join(db, ana, editor, org, 'member', marca, 'editor');
  await join(db, ana, cliente, org, 'member', marca, 'client');
  cuenta = await kit.connect(ana, marca, TOKEN);
  video = await addVideo(ana, org, marca);
  foto = await addVideo(ana, org, marca, 'image', 'image/jpeg');
  videoB = await addVideo(berta, orgB, marcaB);
});

afterAll(async () => {
  await db?.close();
});

describe('entregar un reel para terminarlo en Instagram', () => {
  it('lo aprobado queda «pending»: pendiente no es publicado', async () => {
    const pieza = await reel(ana, org, marca);
    const row = await rpc(editor, 'start_manual_publication', [pieza, video, 'Pan del día\n\n#pan']);
    expect(row).toMatchObject({
      status: 'pending',
      content_version: 1,
      media_asset_id: video,
      caption: 'Pan del día\n\n#pan',
      published_at: null,
      match_source: null,
      external_url: null,
    });
    // Ni siquiera la base de datos lo deja «publicado» sin cuándo y cómo se supo.
    await expect(
      db.query(`update public.manual_publications set status = 'published' where id = $1`, [row.id]),
    ).rejects.toThrow(/check constraint/);
    // Mandarlo otra vez actualiza la misma entrega (no duplica).
    const again = await rpc(editor, 'start_manual_publication', [pieza, video, 'Otro pie']);
    expect(again.id).toBe(row.id);
    expect(again.caption).toBe('Otro pie');
  });

  it('solo lo aprobado, solo reels, solo con un vídeo de la marca y solo quien edita', async () => {
    const borrador = await reel(ana, org, marca, false);
    await denied(db, editor, `select public.start_manual_publication($1, $2, '')`, [borrador, video], /aprobado/);
    const post = await reel(ana, org, marca, true, 'post');
    await denied(db, editor, `select public.start_manual_publication($1, $2, '')`, [post, video], /reels/);
    const pieza = await reel(ana, org, marca);
    await denied(db, editor, `select public.start_manual_publication($1, $2, '')`, [pieza, foto], /MP4/);
    await denied(db, editor, `select public.start_manual_publication($1, $2, '')`, [pieza, videoB], /MP4/);
    await denied(db, cliente, `select public.start_manual_publication($1, $2, '')`, [pieza, video], /permiso/);
    await denied(db, berta, `select public.start_manual_publication($1, $2, '')`, [pieza, video], /permiso/);
    await denied(
      db,
      editor,
      `select public.start_manual_publication($1, $2, $3)`,
      [pieza, video, 'x'.repeat(5001)],
      /largo/,
    );
  });

  it('no se cruza con la publicación por la API: una u otra, mientras esté activa', async () => {
    // Entregada a mano: no se programa también.
    const aMano = await reel(ana, org, marca);
    const row = await rpc(editor, 'start_manual_publication', [aMano, video, '']);
    await denied(
      db,
      editor,
      `select public.save_publication(null, $1, now() + interval '1 day', $2, array[$3]::uuid[])`,
      [aMano, cuenta, video],
      /a mano/,
    );
    // Cancelada, sí.
    await rpc(editor, 'cancel_manual_publication', [row.id]);
    await as(db, editor, `select public.save_publication(null, $1, now() + interval '1 day', $2, array[$3]::uuid[])`, [
      aMano,
      cuenta,
      video,
    ]);
    // Y en el calendario: no se entrega a mano.
    await denied(db, editor, `select public.start_manual_publication($1, $2, '')`, [aMano, video], /calendario/);
  });
});

describe('«Ya lo publiqué» y cancelar', () => {
  it('marca publicada con el enlace (de instagram.com) o sin él, y deja poner el enlace después', async () => {
    const pieza = await reel(ana, org, marca);
    const row = await rpc(editor, 'start_manual_publication', [pieza, video, '']);
    await denied(
      db,
      editor,
      `select public.confirm_manual_publication($1, 'https://evil.test/reel/x')`,
      [row.id],
      /instagram\.com/,
    );
    const done = await rpc(editor, 'confirm_manual_publication', [row.id, null]);
    expect(done).toMatchObject({ status: 'published', match_source: 'manual', external_url: null });
    expect(done.published_at).toBeTruthy();
    const withLink = await rpc(editor, 'confirm_manual_publication', [
      row.id,
      ' https://www.instagram.com/reel/AbC123/ ',
    ]);
    expect(withLink).toMatchObject({ external_url: 'https://www.instagram.com/reel/AbC123/' });
    expect(withLink.published_at).toBe(done.published_at);
    // Publicada: ni se cancela ni se vuelve a entregar.
    await denied(db, editor, `select public.cancel_manual_publication($1)`, [row.id], /pendiente/);
    await denied(db, editor, `select public.start_manual_publication($1, $2, '')`, [pieza, video], /publicado/);
    // Quien solo ve la marca, no la marca; otra organización, tampoco.
    await denied(db, cliente, `select public.confirm_manual_publication($1, null)`, [row.id], /permiso/);
    await denied(db, berta, `select public.confirm_manual_publication($1, null)`, [row.id], /permiso/);
  });

  it('cancelar deja volver a entregarla', async () => {
    const pieza = await reel(ana, org, marca);
    const row = await rpc(editor, 'start_manual_publication', [pieza, video, '']);
    expect((await rpc(editor, 'cancel_manual_publication', [row.id])).status).toBe('cancelled');
    const nueva = await rpc(editor, 'start_manual_publication', [pieza, video, '']);
    expect(nueva.id).not.toBe(row.id);
  });
});

describe('emparejar con las publicaciones de la cuenta', () => {
  it('la deja publicada con el enlace, el identificador y la fecha de Instagram', async () => {
    const pieza = await reel(ana, org, marca);
    const row = await rpc(editor, 'start_manual_publication', [pieza, video, 'Pie']);
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    const reelIg = await imported(cuenta, 'R1', { at });
    const matched = await rpc(editor, 'match_manual_publication', [row.id, reelIg]);
    expect(matched).toMatchObject({
      status: 'published',
      match_source: 'import',
      imported_media_id: reelIg,
      external_id: 'R1',
      external_url: 'https://www.instagram.com/reel/R1/',
    });
    expect(Date.parse(matched.published_at!)).toBe(Date.parse(at));
    // Ya emparejada: no se vuelve a emparejar ni con otra.
    const otro = await imported(cuenta, 'R2');
    await denied(db, editor, `select public.match_manual_publication($1, $2)`, [row.id, otro], /ya no se puede/);
    // Una publicación de Instagram es de una sola pieza.
    const pieza2 = await reel(ana, org, marca);
    const row2 = await rpc(editor, 'start_manual_publication', [pieza2, video, 'Pie']);
    await denied(db, editor, `select public.match_manual_publication($1, $2)`, [row2.id, reelIg], /otra pieza/);
  });

  it('solo un vídeo de la marca, posterior a mandarlo al móvil; también pone el enlace a una marcada a mano', async () => {
    const pieza = await reel(ana, org, marca);
    const row = await rpc(editor, 'start_manual_publication', [pieza, video, '']);
    const foto = await imported(cuenta, 'F1', { type: 'IMAGE', product: 'FEED' });
    await denied(db, editor, `select public.match_manual_publication($1, $2)`, [row.id, foto], /vídeo/);
    const antes = await imported(cuenta, 'A1', { at: new Date(Date.now() - 3_600_000).toISOString() });
    await denied(db, editor, `select public.match_manual_publication($1, $2)`, [row.id, antes], /anterior/);
    const cuentaB = await kit.connect(berta, marcaB, 'sim-page-terminar-b', '17841400000000777');
    const ajena = await imported(cuentaB, 'B1');
    await denied(db, editor, `select public.match_manual_publication($1, $2)`, [row.id, ajena], /marca/);

    await rpc(editor, 'confirm_manual_publication', [row.id, null]);
    const bueno = await imported(cuenta, 'M1', { permalink: 'https://instagram.simulado.invalid/p/M1/' });
    const matched = await rpc(editor, 'match_manual_publication', [row.id, bueno]);
    // Un enlace que no es de instagram.com no se guarda como enlace (el identificador, sí).
    expect(matched).toMatchObject({ match_source: 'import', external_id: 'M1', external_url: null });
  });
});

describe('leer las últimas publicaciones de la cuenta (social-import/recent)', () => {
  it('guarda la primera página sin tocar ninguna importación, y solo para quien edita la marca', async () => {
    const graph = createSimulatedGraph({
      existing: [
        {
          id: '9100',
          caption: 'El reel',
          mediaType: 'VIDEO',
          productType: 'REELS',
          timestamp: new Date().toISOString(),
        },
        { id: '9101', caption: 'Una foto', timestamp: new Date(Date.now() - 86_400_000).toISOString() },
      ],
    });
    const api = createImportGraph({ fetch: graph.fetch });
    const runs = async () =>
      Number((await db.query<{ n: string }>(`select count(*)::text n from public.social_import_runs`))[0]!.n);
    const before = await runs();
    const result = await fetchRecentMedia(cuenta, { rpc: kit.rpc, api, keyRing: KEYS, userId: editor.id });
    expect(result).toEqual({ outcome: 'ok', saved: 2 });
    const rows = await db.query<{ external_id: string; media_product_type: string | null }>(
      `select external_id, media_product_type from public.social_imported_media
       where external_id in ('9100', '9101') order by external_id`,
    );
    expect(rows).toEqual([
      { external_id: '9100', media_product_type: 'REELS' },
      { external_id: '9101', media_product_type: 'FEED' },
    ]);
    expect(await runs()).toBe(before);
    // Otra vez: actualiza, no duplica.
    await fetchRecentMedia(cuenta, { rpc: kit.rpc, api, keyRing: KEYS, userId: editor.id });
    expect((await db.query(`select 1 from public.social_imported_media where external_id = '9100'`)).length).toBe(1);
    // Quien solo ve la marca u otra organización: no.
    await expect(
      fetchRecentMedia(cuenta, { rpc: kit.rpc, api, keyRing: KEYS, userId: cliente.id }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      fetchRecentMedia(cuenta, { rpc: kit.rpc, api, keyRing: KEYS, userId: berta.id }),
    ).rejects.toMatchObject({ code: '42501' });
    // Y las personas no llaman a estas funciones directamente.
    await denied(db, editor, `select public.social_recent_claim($1, $2)`, [cuenta, editor.id], /permission denied/);
    await denied(
      db,
      editor,
      `select public.social_recent_save($1, $2, '[]'::jsonb)`,
      [cuenta, editor.id],
      /permission denied/,
    );
  });
});

describe('aislamiento', () => {
  it('cada organización ve solo las suyas y nadie escribe la tabla desde la API', async () => {
    const piezaB = await reel(berta, orgB, marcaB);
    await rpc(berta, 'start_manual_publication', [piezaB, videoB, '']);
    const deB = await as<{ org: string }>(
      db,
      berta,
      `select distinct organization_id::text as org from public.manual_publications`,
    );
    expect(deB.map((r) => r.org)).toEqual([orgB]);
    const deA = await as<{ org: string }>(
      db,
      ana,
      `select distinct organization_id::text as org from public.manual_publications`,
    );
    expect(deA.map((r) => r.org)).toEqual([org]);
    expect((await as(db, cliente, `select 1 from public.manual_publications`)).length).toBeGreaterThan(0);
    await denied(db, ana, `delete from public.manual_publications`, [], /permission denied/);
    await denied(db, ana, `update public.manual_publications set caption = 'x'`, [], /permission denied/);
    await denied(
      db,
      ana,
      `insert into public.manual_publications (brand_id, organization_id, content_id, content_version, media_asset_id)
       values ($1, $2, $3, 1, $4)`,
      [marcaB, orgB, piezaB, videoB],
      /permission denied/,
    );
  });
});
