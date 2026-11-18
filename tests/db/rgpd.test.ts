// RGPD contra las migraciones reales: aceptación de las condiciones al
// registrarse, «descargar mis datos», exportar una organización, las Edge
// Functions de supresión (handler.ts, con Storage y Auth simulados sobre las
// tablas del andamiaje) y la marca de contenido generado con IA.
// El aislamiento entre personas y organizaciones está en aislamiento.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDeleteAccountHandler,
  createDeleteOrganizationHandler,
  listAllObjects,
  type GdprDeps,
  type GdprRpcClient,
} from '../../supabase/functions/_shared/gdpr/handler.ts';
import {
  addAsset,
  as,
  asService,
  assetPath,
  createBrand,
  createDb,
  createOrg,
  join,
  serviceRpc,
  type Db,
  type TestUser,
} from './helpers';

type Json = Record<string, unknown>;

let db: Db;
let n = 0;
const sessions = new Map<string, TestUser>();
const passwords = new Map<string, string>();

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db?.close();
});

async function user(prefix: string, metadata: Json = {}): Promise<TestUser> {
  n += 1;
  const email = `${prefix}${n}@rgpd.test`;
  const [row] = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify({ full_name: prefix, ...metadata })],
  );
  const created = { id: row!.id, email };
  passwords.set(email, `clave-${n}`);
  return created;
}

function login(u: TestUser): string {
  const token = `sesion-${u.id}`;
  sessions.set(token, u);
  return token;
}

const rpc: GdprRpcClient = async (fn, args) => {
  try {
    return { data: await serviceRpc(db, fn, args), error: null };
  } catch (error) {
    const { code, message, detail } = error as { code?: string; message: string; detail?: string };
    return { data: null, error: { code, message, details: detail ?? null } };
  }
};

/** Dependencias con Storage y Auth simulados sobre las tablas del andamiaje. */
function deps(overrides: Partial<GdprDeps> = {}): GdprDeps & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    authenticate: async (token) => {
      const u = sessions.get(token);
      return u ? { userId: u.id, email: u.email } : null;
    },
    verifyPassword: async (email, password) => passwords.get(email) === password,
    rpc,
    listObjects: async (prefix) =>
      (
        await db.query<{ name: string }>(
          `select name from storage.objects where bucket_id = 'brand-media' and name like $1 order by name`,
          [`${prefix}%`],
        )
      ).map((r) => r.name),
    removeObjects: async (paths) => {
      await db.query(`delete from storage.objects where bucket_id = 'brand-media' and name = any($1)`, [paths]);
      return { failed: [] };
    },
    deleteAuthUser: async (id) => {
      await db.query(`delete from auth.users where id = $1`, [id]);
    },
    log: (event) => logs.push(event),
    ...overrides,
  };
}

function post(token: string | null, body: unknown): Request {
  return new Request('http://localhost/fn', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function storeFile(path: string): Promise<void> {
  await db.query(`insert into storage.objects (bucket_id, name) values ('brand-media', $1)`, [path]);
}

async function files(prefix: string): Promise<string[]> {
  return (
    await db.query<{ name: string }>(`select name from storage.objects where name like $1 order by name`, [
      `${prefix}%`,
    ])
  ).map((r) => r.name);
}

/** Organización con dos personas, una marca, un archivo en la biblioteca y otro suelto. */
async function sharedOrg(owner: TestUser, member: TestUser, name: string) {
  const org = await createOrg(db, owner, name);
  const brand = await createBrand(db, owner, org, `${name} marca`);
  await join(db, owner, member, org, 'member', brand, 'editor');
  const asset = await addAsset(db, member, org, brand);
  const [{ storage_path }] = (await db.query(`select storage_path from public.media_assets where id = $1`, [
    asset,
  ])) as [{ storage_path: string }];
  await storeFile(storage_path);
  await storeFile(`${org}/${brand}/exports/suelto.png`);
  return { org, brand, asset, path: storage_path };
}

describe('aceptación de las condiciones y de la política de privacidad', () => {
  it('el registro deja constancia de las versiones aceptadas, con la hora del servidor', async () => {
    const u = await user('registro', { legal: { terms_version: '2026-11-19', privacy_version: '2026-11-19.1' } });
    const rows = await as(db, u, `select document, version, source from public.legal_acceptances order by document`);
    expect(rows).toEqual([
      { document: 'privacy', version: '2026-11-19.1', source: 'signup' },
      { document: 'terms', version: '2026-11-19', source: 'signup' },
    ]);
  });

  it('un alta sin aceptación o con versiones mal formadas no falla, pero no apunta nada', async () => {
    const sin = await user('sin');
    const mal = await user('mal', { legal: { terms_version: 'ayer', privacy_version: 42 } });
    expect(await as(db, sin, `select 1 from public.legal_acceptances`)).toEqual([]);
    expect(await as(db, mal, `select 1 from public.legal_acceptances`)).toEqual([]);
  });

  it('desde la cuenta se aceptan (o se vuelven a aceptar) sin duplicar', async () => {
    const u = await user('cuenta');
    await as(db, u, `select * from public.accept_legal_documents('2026-11-19', '2026-11-19')`);
    const again = await as(db, u, `select * from public.accept_legal_documents('2026-11-19', '2026-11-19')`);
    expect(again).toHaveLength(2);
    expect(again.every((r) => r.source === 'app')).toBe(true);
    await expect(as(db, u, `select * from public.accept_legal_documents('cualquiera', '2026-11-19')`)).rejects.toThrow(
      /no es válida/,
    );
  });
});

describe('derecho de acceso y portabilidad', () => {
  it('«descargar mis datos» reúne perfil, pertenencias, aceptaciones, actividad y lo que escribió, sin secretos', async () => {
    const owner = await user('propia', { legal: { terms_version: '2026-11-19', privacy_version: '2026-11-19' } });
    const editora = await user('editora');
    const { org, brand } = await sharedOrg(owner, editora, 'Acceso');
    const [request] = await as<{ id: string }>(
      db,
      editora,
      `select id from public.create_content_request($1, 'Encargo mío', 'Lo que pido', 'instagram', 'post')`,
      [brand],
    );
    await as(db, editora, `select public.comment_content_request($1, 'Mi comentario')`, [request!.id]);
    await db.query(`update auth.users set encrypted_password = 'hash-secreto' where id = $1`, [editora.id]);

    const [fila] = await as<{ data: Json }>(db, editora, `select public.export_my_data() as data`);
    const data = fila!.data;
    expect(data.format).toBe('rrss.personal-data');
    expect((data.profile as Json).email).toBe(editora.email);
    expect(data.organizations).toEqual([expect.objectContaining({ organization_id: org, role: 'member' })]);
    expect(data.brand_roles).toEqual([expect.objectContaining({ brand_id: brand, role: 'editor' })]);
    expect(data.invitations_received).toEqual([expect.objectContaining({ organization_id: org })]);
    expect(data.content_requests).toEqual([expect.objectContaining({ title: 'Encargo mío', brief: 'Lo que pido' })]);
    // El alta del encargo deja también un apunte de estado escrito a su nombre.
    expect(data.content_request_comments).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'comment', body: 'Mi comentario' })]),
    );
    expect((data.media_assets_uploaded as unknown[]).length).toBe(1);
    expect((data.activity as Json[]).some((a) => a.entity_type === 'content_requests')).toBe(true);
    const texto = JSON.stringify(data);
    expect(texto).not.toContain('hash-secreto');
    expect(texto).not.toContain('encrypted_password');

    const [deOwner] = await as<{ data: Json }>(db, owner, `select public.export_my_data() as data`);
    expect(deOwner!.data.legal_acceptances).toHaveLength(2);
    expect(deOwner!.data.invitations_sent).toEqual([expect.objectContaining({ email: editora.email })]);
  });

  it('exportar la organización trae configuración, marcas, perfiles, contenidos con sus versiones y archivos', async () => {
    const owner = await user('duena');
    const editora = await user('equipo');
    const { org, brand, path } = await sharedOrg(owner, editora, 'Exportable');
    await as(db, owner, `select public.save_brand_profile($1, '{"business":{"description":"Pan"}}'::jsonb)`, [brand]);
    const [item] = await as<{ id: string }>(
      db,
      editora,
      `insert into public.content_items (brand_id, organization_id, title, network, format)
       values ($1, $2, 'Pieza', 'instagram', 'post') returning id`,
      [brand, org],
    );
    await as(
      db,
      editora,
      `select public.save_content_version($1, '{"schemaVersion":1,"copy":{"caption":"Hola"}}'::jsonb, 1)`,
      [item!.id],
    );

    const [fila] = await as<{ data: Json }>(db, owner, `select public.export_organization_data($1) as data`, [org]);
    const data = fila!.data;
    expect((data.organization as Json).name).toBe('Exportable');
    expect((data.members as Json[]).map((m) => m.email).sort()).toEqual([owner.email, editora.email].sort());
    const [marca] = data.brands as Json[];
    expect((marca!.profiles as Json[])[0]).toEqual(
      expect.objectContaining({ version: 1, data: { business: { description: 'Pan' } } }),
    );
    const [pieza] = marca!.contents as Json[];
    expect((pieza!.versions as Json[])[0]).toEqual(
      expect.objectContaining({ version: 1, data: { schemaVersion: 1, copy: { caption: 'Hola' } } }),
    );
    expect((marca!.assets as Json[]).map((a) => a.storage_path)).toEqual([path]);
  });
});

describe('Edge Function delete-organization', () => {
  it('pide sesión, organización y el nombre exacto; solo el propietario borra', async () => {
    const owner = await user('dueno');
    const editora = await user('miembro');
    const { org } = await sharedOrg(owner, editora, 'Protegida');
    const handler = createDeleteOrganizationHandler(deps());

    expect((await handler(post(null, { organizationId: org, confirmation: 'Protegida' }))).status).toBe(401);
    expect((await handler(post(login(owner), { organizationId: 'x' }))).status).toBe(400);
    expect((await handler(post(login(editora), { organizationId: org, confirmation: 'Protegida' }))).status).toBe(403);
    const mal = await handler(post(login(owner), { organizationId: org, confirmation: 'protegida' }));
    expect(mal.status).toBe(400);
    expect(((await mal.json()) as { error: Json }).error.code).toBe('confirmation_mismatch');
    expect(await db.query(`select 1 from public.organizations where id = $1`, [org])).toHaveLength(1);
  });

  it('borra datos y archivos de esa organización y nada de otra', async () => {
    const owner = await user('borra');
    const editora = await user('ayuda');
    const otra = await user('vecina');
    const target = await sharedOrg(owner, editora, 'Se va');
    const vecina = await sharedOrg(otra, await user('colega'), 'Se queda');

    const res = await createDeleteOrganizationHandler(deps())(
      post(login(owner), { organizationId: target.org, confirmation: '  Se va ' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, organizationId: target.org, filesPending: 0 });

    expect(await db.query(`select 1 from public.organizations where id = $1`, [target.org])).toEqual([]);
    expect(await db.query(`select 1 from public.brands where organization_id = $1`, [target.org])).toEqual([]);
    expect(await db.query(`select 1 from public.media_assets where organization_id = $1`, [target.org])).toEqual([]);
    expect(await files(`${target.org}/`)).toEqual([]);
    expect(
      await db.query(`select 1 from public.storage_cleanup_queue where organization_id = $1`, [target.org]),
    ).toEqual([]);
    // Del registro solo queda la constancia del borrado, con quién lo pidió.
    expect(
      await db.query(`select action, entity_type, actor_id from public.audit_logs where organization_id = $1`, [
        target.org,
      ]),
    ).toEqual([{ action: 'delete', entity_type: 'organizations', actor_id: owner.id }]);
    // Las cuentas siguen existiendo.
    expect(await db.query(`select 1 from auth.users where id = any($1)`, [[owner.id, editora.id]])).toHaveLength(2);
    // La vecina, intacta.
    expect(await files(`${vecina.org}/`)).toHaveLength(2);
    expect(await db.query(`select 1 from public.media_assets where id = $1`, [vecina.asset])).toHaveLength(1);
  });

  it('si Storage falla, los datos se borran igual y las rutas quedan en la cola para el servidor', async () => {
    const owner = await user('fallo');
    const target = await sharedOrg(owner, await user('fallo-miembro'), 'Con fallo');
    const res = await createDeleteOrganizationHandler(deps({ removeObjects: async (paths) => ({ failed: paths }) }))(
      post(login(owner), { organizationId: target.org, confirmation: 'Con fallo' }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).filesPending).toBe(2);
    expect(await db.query(`select 1 from public.organizations where id = $1`, [target.org])).toEqual([]);
    const cola = await db.query<{ storage_path: string }>(
      `select storage_path from public.storage_cleanup_queue where organization_id = $1 order by 1`,
      [target.org],
    );
    expect(cola.map((r) => r.storage_path).sort()).toEqual((await files(`${target.org}/`)).sort());
  });
});

describe('Edge Function delete-account', () => {
  it('exige escribir el propio correo y la contraseña', async () => {
    const u = await user('confirma');
    const handler = createDeleteAccountHandler(deps());
    expect((await handler(post(null, {}))).status).toBe(401);
    const sinCorreo = await handler(
      post(login(u), { confirmation: 'otra@rgpd.test', password: passwords.get(u.email) }),
    );
    expect(sinCorreo.status).toBe(400);
    expect((await handler(post(login(u), { confirmation: u.email }))).status).toBe(400);
    const malaClave = await handler(post(login(u), { confirmation: u.email.toUpperCase(), password: 'mala' }));
    expect(malaClave.status).toBe(403);
    expect(await db.query(`select 1 from auth.users where id = $1`, [u.id])).toHaveLength(1);
  });

  it('no borra a la única propietaria de una organización con más miembros y dice cuáles', async () => {
    const owner = await user('unica');
    const { org } = await sharedOrg(owner, await user('acompanante'), 'Compartida');
    const res = await createDeleteAccountHandler(deps())(
      post(login(owner), { confirmation: owner.email, password: passwords.get(owner.email) }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; blocking: Json[] } };
    expect(body.error.code).toBe('owner_of_shared_organizations');
    expect(body.error.blocking).toEqual([{ organization_id: org, name: 'Compartida', members: 2 }]);
    expect(await db.query(`select 1 from auth.users where id = $1`, [owner.id])).toHaveLength(1);
  });

  it('con otra persona propietaria, sí: sale de la organización, que sigue con su trabajo', async () => {
    const owner = await user('cootitular');
    const socia = await user('socia');
    const { org, brand, asset } = await sharedOrg(owner, socia, 'Dos titulares');
    await as(db, owner, `select public.set_member_role($1, $2, 'owner')`, [org, socia.id]);
    const res = await createDeleteAccountHandler(deps())(
      post(login(owner), { confirmation: owner.email, password: passwords.get(owner.email) }),
    );
    expect(res.status).toBe(200);
    expect(await db.query(`select 1 from auth.users where id = $1`, [owner.id])).toEqual([]);
    expect(await db.query(`select 1 from public.organizations where id = $1`, [org])).toHaveLength(1);
    expect(await db.query(`select 1 from public.brands where id = $1`, [brand])).toHaveLength(1);
    expect(await db.query(`select created_by from public.brands where id = $1`, [brand])).toEqual([
      { created_by: null },
    ]);
    expect(await db.query(`select 1 from public.media_assets where id = $1`, [asset])).toHaveLength(1);
  });

  it('borra la cuenta, sus organizaciones sin más miembros y sus archivos', async () => {
    const u = await user('se-va');
    const sola = await createOrg(db, u, 'Solo yo');
    const brand = await createBrand(db, u, sola, 'Mi marca');
    const asset = await addAsset(db, u, sola, brand);
    const [{ storage_path }] = (await db.query(`select storage_path from public.media_assets where id = $1`, [
      asset,
    ])) as [{ storage_path: string }];
    await storeFile(storage_path);
    await as(db, u, `select * from public.accept_legal_documents('2026-11-19', '2026-11-19')`);

    const res = await createDeleteAccountHandler(deps())(
      post(login(u), { confirmation: ` ${u.email} `, password: passwords.get(u.email) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: true,
      deletedOrganizations: [{ id: sola, name: 'Solo yo' }],
      filesPending: 0,
    });
    expect(await db.query(`select 1 from auth.users where id = $1`, [u.id])).toEqual([]);
    expect(await db.query(`select 1 from public.profiles where user_id = $1`, [u.id])).toEqual([]);
    expect(await db.query(`select 1 from public.legal_acceptances where user_id = $1`, [u.id])).toEqual([]);
    expect(await db.query(`select 1 from public.organizations where id = $1`, [sola])).toEqual([]);
    expect(await files(`${sola}/`)).toEqual([]);
    // Queda la constancia del borrado de la organización, ya sin su autoría.
    expect(await db.query(`select actor_id from public.audit_logs where organization_id = $1`, [sola])).toEqual([
      { actor_id: null },
    ]);
  });

  it('si Auth falla, lo dice y no da la cuenta por borrada', async () => {
    const u = await user('auth-falla');
    const res = await createDeleteAccountHandler(
      deps({
        deleteAuthUser: async () => {
          throw new Error('caído');
        },
      }),
    )(post(login(u), { confirmation: u.email, password: passwords.get(u.email) }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: Json }).error.code).toBe('auth_delete_failed');
    expect(await db.query(`select 1 from auth.users where id = $1`, [u.id])).toHaveLength(1);
  });
});

describe('lista recursiva del cubo', () => {
  it('recorre carpetas y páginas', async () => {
    const tree: Record<string, { name: string; id: string | null }[]> = {
      org: [
        { name: 'marca', id: null },
        { name: 'raiz.txt', id: '1' },
      ],
      'org/marca': [
        { name: 'a.png', id: '2' },
        { name: 'b.png', id: '3' },
        { name: 'c.png', id: '4' },
      ],
    };
    const list = async (prefix: string, offset: number) => (tree[prefix] ?? []).slice(offset, offset + 2);
    expect((await listAllObjects(list, 'org/', 2)).sort()).toEqual(
      ['org/marca/a.png', 'org/marca/b.png', 'org/marca/c.png', 'org/raiz.txt'].sort(),
    );
  });
});

describe('contenido generado con IA', () => {
  let owner: TestUser;
  let org: string;
  let brand: string;
  let otherBrand: string;
  let otherOrg: string;
  let aiAsset: string;
  let plainAsset: string;
  let foreignAiAsset: string;

  const doc = (extra: Json = {}) => ({ schemaVersion: 1, layers: [], copy: {}, ...extra });
  const imageLayer = (source: Json, id = 'img') => ({ id, type: 'image', x: 0, y: 0, width: 10, height: 10, source });

  async function aiGenerated(orgId: string, brandId: string): Promise<string> {
    const [row] = await asService<{ id: string }>(
      db,
      `insert into public.media_assets (brand_id, organization_id, kind, origin, storage_path, file_name, mime_type, bytes, provenance)
       values ($1, $2, 'image', 'generated', $3, 'ia.png', 'image/png', 1,
               '{"type":"ai_generation","generation_id":"00000000-0000-0000-0000-000000000000"}') returning id`,
      [brandId, orgId, assetPath(orgId, brandId)],
    );
    return row!.id;
  }

  async function piece(data: Json): Promise<{ id: string; ai: boolean }> {
    const [item] = await as<{ id: string }>(
      db,
      owner,
      `insert into public.content_items (brand_id, organization_id, title, network, format)
       values ($1, $2, 'Pieza', 'instagram', 'post') returning id`,
      [brand, org],
    );
    const [version] = await as<{ ai_generated: boolean }>(
      db,
      owner,
      `select ai_generated from public.save_content_version($1, $2::jsonb, 1)`,
      [item!.id, JSON.stringify(data)],
    );
    return { id: item!.id, ai: version!.ai_generated };
  }

  beforeAll(async () => {
    owner = await user('ia');
    org = await createOrg(db, owner, 'IA');
    brand = await createBrand(db, owner, org, 'Marca IA');
    const other = await user('ia-otra');
    otherOrg = await createOrg(db, other, 'Otra IA');
    otherBrand = await createBrand(db, other, otherOrg, 'Otra marca');
    aiAsset = await aiGenerated(org, brand);
    plainAsset = await addAsset(db, owner, org, brand);
    foreignAiAsset = await aiGenerated(otherOrg, otherBrand);
  });

  it('marca la pieza cuando una capa es una imagen generada con IA, de la propia marca', async () => {
    expect((await piece(doc())).ai).toBe(false);
    expect((await piece(doc({ layers: [imageLayer({ kind: 'asset', assetId: plainAsset })] }))).ai).toBe(false);
    expect((await piece(doc({ layers: [imageLayer({ kind: 'asset', assetId: aiAsset })] }))).ai).toBe(true);
    expect(
      (
        await piece(
          doc({ layers: [imageLayer({ kind: 'generation', generationId: '00000000-0000-0000-0000-000000000001' })] }),
        )
      ).ai,
    ).toBe(true);
    expect(
      (await piece(doc({ layers: [{ id: 'l', type: 'logo', x: 0, y: 0, width: 1, height: 1, assetId: aiAsset }] }))).ai,
    ).toBe(true);
    // Un recurso de otra marca no cuenta (ni se averigua nada de él).
    expect((await piece(doc({ layers: [imageLayer({ kind: 'asset', assetId: foreignAiAsset })] }))).ai).toBe(false);
  });

  it('marca el texto redactado con IA según el documento', async () => {
    expect((await piece(doc({ copy: { caption: 'Hola', aiGenerated: true } }))).ai).toBe(true);
    expect((await piece(doc({ copy: { caption: 'Hola', aiGenerated: false } }))).ai).toBe(false);
    expect(
      (
        await piece(
          doc({ layers: [{ id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'x', aiGenerated: true }] }),
        )
      ).ai,
    ).toBe(true);
  });

  it('sigue el rastro de exportaciones y reels hechos con imágenes generadas', async () => {
    const conIa = await piece(doc({ layers: [imageLayer({ kind: 'asset', assetId: aiAsset })] }));
    const [exportada] = await as<{ id: string }>(
      db,
      owner,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes, provenance)
       values ($1, $2, 'image', $3, 'export.png', 'image/png', 1, $4::jsonb) returning id`,
      [brand, org, assetPath(org, brand), JSON.stringify({ type: 'export', content_id: conIa.id, version: 1 })],
    );
    expect((await piece(doc({ layers: [imageLayer({ kind: 'asset', assetId: exportada!.id })] }))).ai).toBe(true);

    const [reel] = await asService<{ id: string }>(
      db,
      `insert into public.media_assets (brand_id, organization_id, kind, origin, storage_path, file_name, mime_type, bytes, provenance)
       values ($1, $2, 'video', 'generated', $3, 'reel.mp4', 'video/mp4', 1, $4::jsonb) returning id`,
      [
        brand,
        org,
        assetPath(org, brand, 'reel.mp4'),
        JSON.stringify({ type: 'media_job', job_id: 'x', sources: [{ type: 'photo', asset_id: aiAsset, path: 'p' }] }),
      ],
    );
    expect((await piece(doc({ layers: [imageLayer({ kind: 'asset', assetId: reel!.id })] }))).ai).toBe(true);
  });

  it('la pieza lleva la marca de su versión vigente, también al restaurar, y nadie la cambia a mano', async () => {
    const p = await piece(doc());
    const read = async () =>
      (
        await db.query<{ ai_generated: boolean }>(`select ai_generated from public.content_items where id = $1`, [p.id])
      )[0]!.ai_generated;
    expect(await read()).toBe(false);
    await as(db, owner, `select public.save_content_version($1, $2::jsonb, 1)`, [
      p.id,
      JSON.stringify(doc({ copy: { aiGenerated: true } })),
    ]);
    expect(await read()).toBe(true);
    await as(db, owner, `select public.restore_content_version($1, 1)`, [p.id]);
    expect(await read()).toBe(false);
    await expect(
      as(db, owner, `update public.content_items set ai_generated = true where id = $1`, [p.id]),
    ).rejects.toThrow(/permission denied/);
    const versiones = await as<{ version: number; ai_generated: boolean }>(
      db,
      owner,
      `select version, ai_generated from public.content_versions where content_id = $1 order by version`,
      [p.id],
    );
    expect(versiones).toEqual([
      { version: 1, ai_generated: false },
      { version: 2, ai_generated: true },
      { version: 3, ai_generated: false },
    ]);
  });
});
