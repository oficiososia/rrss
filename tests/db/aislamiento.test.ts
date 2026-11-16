// Aislamiento multi-tenant y permisos, contra las migraciones reales.
// Cada comprobación se hace con la identidad de un usuario (rol y JWT), igual
// que llegaría desde la API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addAsset,
  as,
  assetPath,
  createBrand,
  createDb,
  createOrg,
  createUser,
  denied,
  join,
  serviceRpc,
  setAiQuota,
  type Db,
  type TestUser,
} from './helpers';

let db: Db;

// Organización A (empresa): ana es propietaria.
let ana: TestUser, adminA: TestUser, editorA: TestUser, clienteA: TestUser, sinMarcaA: TestUser, gestorA: TestUser;
// Organización B (otra empresa): berta es propietaria.
let berta: TestUser;
// Agencia: gema gestiona varias marcas; ana también está, pero solo de lectura en una.
let gema: TestUser;
let ajeno: TestUser, superadmin: TestUser;

let orgA: string, orgB: string, agencia: string;
let marcaA1: string, marcaA2: string, marcaB1: string, marcaG1: string, marcaG2: string;
let assetA1: string, assetB1: string;
// IA y cola de trabajos (Fase 2): una generación y un trabajo por organización.
let genA1: string, genB1: string, genG1: string;
let jobA1: string, jobOrgA: string, jobB1: string;

const PROFILE = { business: { description: 'Negocio de prueba' } };

beforeAll(async () => {
  db = await createDb();

  ana = await createUser(db, 'ana@a.test', 'Ana');
  adminA = await createUser(db, 'admin@a.test', 'Admin A');
  editorA = await createUser(db, 'editor@a.test', 'Editor A');
  clienteA = await createUser(db, 'cliente@a.test', 'Cliente A');
  sinMarcaA = await createUser(db, 'sinmarca@a.test', 'Sin marca');
  gestorA = await createUser(db, 'gestor@a.test', 'Gestor A');
  berta = await createUser(db, 'berta@b.test', 'Berta');
  gema = await createUser(db, 'gema@agencia.test', 'Gema');
  ajeno = await createUser(db, 'ajeno@x.test', 'Ajeno');
  superadmin = await createUser(db, 'root@plataforma.test', 'Root');
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [superadmin.id]);

  orgA = await createOrg(db, ana, 'Empresa A');
  orgB = await createOrg(db, berta, 'Empresa B');
  agencia = await createOrg(db, gema, 'Agencia G', 'agency');

  marcaA1 = await createBrand(db, ana, orgA, 'Marca A1');
  marcaA2 = await createBrand(db, ana, orgA, 'Marca A2');
  marcaB1 = await createBrand(db, berta, orgB, 'Marca B1');
  marcaG1 = await createBrand(db, gema, agencia, 'Cliente G1');
  marcaG2 = await createBrand(db, gema, agencia, 'Cliente G2');

  await join(db, ana, adminA, orgA, 'admin');
  await join(db, ana, editorA, orgA, 'member', marcaA1, 'editor');
  await join(db, ana, clienteA, orgA, 'member', marcaA1, 'client');
  await join(db, ana, gestorA, orgA, 'member', marcaA1, 'manager');
  await join(db, ana, sinMarcaA, orgA, 'member');
  await join(db, gema, ana, agencia, 'member', marcaG1, 'viewer');

  assetA1 = await addAsset(db, ana, orgA, marcaA1);
  await addAsset(db, ana, orgA, marcaA2);
  assetB1 = await addAsset(db, berta, orgB, marcaB1);
  await addAsset(db, gema, agencia, marcaG1);
  await addAsset(db, gema, agencia, marcaG2);

  await as(db, ana, `select public.save_brand_profile($1, $2::jsonb)`, [marcaA1, JSON.stringify(PROFILE)]);
  await as(db, berta, `select public.save_brand_profile($1, $2::jsonb)`, [marcaB1, JSON.stringify(PROFILE)]);
  await as(
    db,
    berta,
    `insert into public.brand_knowledge_sources (brand_id, organization_id, kind, title, url) values ($1, $2, 'website', 'Web', 'https://b.test')`,
    [marcaB1, orgB],
  );

  // Fase 2: cupo, generaciones (con su coste) y trabajos en cada organización.
  // Los escribe el servidor (clave de servicio); aquí se prueba quién los ve.
  for (const org of [orgA, orgB, agencia]) await setAiQuota(db, superadmin, org, 1_000_000);
  const generate = async (user: TestUser, brand: string, cost: number) => {
    const gen = await serviceRpc<{ id: string }>(db, 'ai_reserve_generation', {
      p_user_id: user.id,
      p_brand_id: brand,
      p_task: 'text',
      p_purpose: 'post.caption',
      p_provider: 'simulated',
      p_model: 'sim-text-1',
      p_reserve_micros: 5000,
    });
    await serviceRpc(db, 'ai_complete_generation', { p_generation_id: gen.id, p_cost_micros: cost });
    return gen.id;
  };
  genA1 = await generate(editorA, marcaA1, 1200);
  genB1 = await generate(berta, marcaB1, 3400);
  genG1 = await generate(gema, marcaG1, 500);

  const enqueue = async (org: string, brand: string | null, key: string) => {
    const job = await serviceRpc<{ id: string }>(db, 'enqueue_job', {
      p_organization_id: org,
      p_brand_id: brand,
      p_kind: 'media.render',
      p_payload: { pieza: key },
      p_idempotency_key: key,
    });
    return job.id;
  };
  jobA1 = await enqueue(orgA, marcaA1, 'a1');
  jobOrgA = await enqueue(orgA, null, 'org-a');
  jobB1 = await enqueue(orgB, marcaB1, 'b1');
});

afterAll(async () => {
  await db?.close();
});

const TENANT_TABLES = [
  'profiles',
  'platform_admins',
  'organizations',
  'organization_members',
  'brands',
  'brand_members',
  'brand_profiles',
  'brand_knowledge_sources',
  'media_assets',
  'invitations',
  'audit_logs',
  'usage_quotas',
  'ai_generations',
  'ai_usage',
  'jobs',
];

describe('catálogo: nada queda abierto por olvido', () => {
  it('todas las tablas de public tienen RLS activado', async () => {
    const rows = await db.query<{ relname: string }>(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('las tablas probadas aquí son todas las que existen', async () => {
    const rows = await db.query<{ relname: string }>(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([...TENANT_TABLES].sort());
  });

  it('anon no tiene ningún privilegio sobre tablas ni funciones', async () => {
    const tables = await db.query(
      `select c.relname, p.priv from pg_class c
       cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('anon', c.oid, p.priv)`,
    );
    expect(tables).toEqual([]);
    const functions = await db.query(
      `select p.proname from pg_proc p
       where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    );
    expect(functions).toEqual([]);
  });

  it('las funciones SECURITY DEFINER fijan search_path', async () => {
    const rows = await db.query(
      `select p.proname from pg_proc p
       where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it('anon no puede leer ninguna tabla ni crear organizaciones', async () => {
    for (const table of TENANT_TABLES) {
      await denied(db, null, `select * from public.${table}`);
    }
    await denied(db, null, `select public.create_organization('X')`);
  });
});

describe('aislamiento entre organizaciones', () => {
  it('cada propietaria solo ve su organización y sus marcas', async () => {
    const orgsBerta = await as(db, berta, `select id from public.organizations`);
    expect(orgsBerta.map((r) => r.id)).toEqual([orgB]);
    const marcasBerta = await as(db, berta, `select id from public.brands`);
    expect(marcasBerta.map((r) => r.id)).toEqual([marcaB1]);

    const marcasAna = await as(db, ana, `select id from public.brands order by name`);
    // Ana ve sus dos marcas y la marca de la agencia donde es lectora; nunca la de B ni G2.
    expect(marcasAna.map((r) => r.id).sort()).toEqual([marcaA1, marcaA2, marcaG1].sort());
  });

  it('un usuario sin organizaciones no ve nada', async () => {
    for (const table of TENANT_TABLES.filter((t) => t !== 'profiles')) {
      expect(await as(db, ajeno, `select * from public.${table}`), table).toEqual([]);
    }
    const perfiles = await as(db, ajeno, `select user_id from public.profiles`);
    expect(perfiles.map((r) => r.user_id)).toEqual([ajeno.id]);
  });

  it('ninguna tabla deja ver filas de la otra organización', async () => {
    for (const table of [
      'organization_members',
      'brands',
      'brand_members',
      'brand_profiles',
      'brand_knowledge_sources',
      'media_assets',
      'invitations',
      'audit_logs',
      'usage_quotas',
      'ai_generations',
      'ai_usage',
      'jobs',
    ]) {
      const column = table === 'brands' ? 'organization_id' : 'organization_id';
      const rows = await as(db, berta, `select distinct ${column}::text as org from public.${table}`);
      expect(
        rows.map((r) => r.org).filter((o) => o !== orgB),
        table,
      ).toEqual([]);
    }
    // Y al revés: B tiene filas que A no ve.
    expect(await as(db, ana, `select 1 from public.media_assets where id = $1`, [assetB1])).toEqual([]);
    expect(await as(db, ana, `select 1 from public.brand_profiles where brand_id = $1`, [marcaB1])).toEqual([]);
    expect(await as(db, ana, `select 1 from public.brand_knowledge_sources where brand_id = $1`, [marcaB1])).toEqual(
      [],
    );
    expect(await as(db, ana, `select 1 from public.organizations where id = $1`, [orgB])).toEqual([]);
  });

  it('no se puede escribir en la organización ajena', async () => {
    await denied(db, ana, `insert into public.brands (organization_id, name) values ($1, 'Intrusa')`, [orgB]);
    await denied(
      db,
      ana,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'x.jpg', 'image/jpeg', 1)`,
      [marcaB1, orgB, assetPath(orgB, marcaB1)],
    );
    await denied(
      db,
      ana,
      `insert into public.brand_knowledge_sources (brand_id, organization_id, kind, title, url) values ($1, $2, 'website', 'x', 'https://x.test')`,
      [marcaB1, orgB],
    );
    await denied(db, ana, `select public.save_brand_profile($1, '{}'::jsonb)`, [marcaB1]);
    await denied(db, ana, `select * from public.create_invitation($1, 'x@x.test')`, [orgB]);

    // UPDATE y DELETE sobre filas ajenas no fallan: sencillamente no encuentran nada.
    expect(await as(db, ana, `update public.brands set name = 'Robada' where id = $1 returning id`, [marcaB1])).toEqual(
      [],
    );
    expect(
      await as(db, ana, `update public.organizations set name = 'Robada' where id = $1 returning id`, [orgB]),
    ).toEqual([]);
    expect(await as(db, ana, `delete from public.media_assets where id = $1 returning id`, [assetB1])).toEqual([]);
    const [marca] = await db.query(`select name from public.brands where id = $1`, [marcaB1]);
    expect(marca!.name).toBe('Marca B1');
  });

  it('una marca no se puede mover de organización ni mezclar con otra', async () => {
    // organization_id no es una columna que el cliente pueda actualizar.
    await denied(db, ana, `update public.brands set organization_id = $1 where id = $2`, [orgB, marcaA1]);
    // Un recurso de mi marca no puede declararse de otra organización (FK compuesta).
    await denied(
      db,
      ana,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'x.jpg', 'image/jpeg', 1)`,
      [marcaA1, orgB, assetPath(orgB, marcaA1)],
      /foreign key|row-level security/i,
    );
    // Ni guardarse en la ruta de otra marca.
    await denied(
      db,
      ana,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'x.jpg', 'image/jpeg', 1)`,
      [marcaA1, orgA, assetPath(orgB, marcaB1)],
      /check constraint/i,
    );
  });

  it('las organizaciones solo se crean con la RPC y no se borran desde el cliente', async () => {
    await denied(db, ana, `insert into public.organizations (name) values ('Directa')`);
    await denied(
      db,
      ana,
      `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`,
      [orgB, ana.id],
    );
    await denied(db, ana, `delete from public.organizations where id = $1`, [orgA]);
    await denied(db, ana, `delete from public.brands where id = $1`, [marcaA1]);
  });

  it('los perfiles de usuario solo se ven entre compañeros de organización', async () => {
    const vistos = await as(db, berta, `select email from public.profiles`);
    expect(vistos.map((r) => r.email)).toEqual([berta.email]);
    const deAna = (await as(db, ana, `select email from public.profiles`)).map((r) => r.email);
    expect(deAna).toContain(editorA.email);
    expect(deAna).toContain(gema.email); // comparten la agencia
    expect(deAna).not.toContain(berta.email);

    expect(
      await as(db, ana, `update public.profiles set full_name = 'Hack' where user_id = $1 returning user_id`, [
        editorA.id,
      ]),
    ).toEqual([]);
    await denied(db, ana, `update public.profiles set email = 'otra@a.test' where user_id = $1`, [ana.id]);
  });
});

describe('roles dentro de una organización', () => {
  it('un miembro sin marcas no ve ninguna marca ni su contenido', async () => {
    expect(await as(db, sinMarcaA, `select id from public.brands`)).toEqual([]);
    expect(await as(db, sinMarcaA, `select id from public.media_assets`)).toEqual([]);
    expect(await as(db, sinMarcaA, `select id from public.brand_profiles`)).toEqual([]);
    // Pero sí sabe a qué organización pertenece.
    expect((await as(db, sinMarcaA, `select id from public.organizations`)).map((r) => r.id)).toEqual([orgA]);
  });

  it('el editor ve solo su marca; edita la biblioteca pero no la configuración', async () => {
    expect((await as(db, editorA, `select id from public.brands`)).map((r) => r.id)).toEqual([marcaA1]);
    const id = await addAsset(db, editorA, orgA, marcaA1);
    expect(
      await as(db, editorA, `update public.media_assets set tags = '{nuevo}' where id = $1 returning id`, [id]),
    ).toHaveLength(1);

    expect(
      await as(db, editorA, `update public.brands set name = 'Cambiada' where id = $1 returning id`, [marcaA1]),
    ).toEqual([]);
    await denied(db, editorA, `select public.save_brand_profile($1, '{}'::jsonb)`, [marcaA1]);
    await denied(
      db,
      editorA,
      `insert into public.brand_knowledge_sources (brand_id, organization_id, kind, title, url) values ($1, $2, 'website', 'x', 'https://x.test')`,
      [marcaA1, orgA],
    );
    // La otra marca de su propia organización también le está vedada.
    await denied(
      db,
      editorA,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'x.jpg', 'image/jpeg', 1)`,
      [marcaA2, orgA, assetPath(orgA, marcaA2)],
    );
    await denied(db, editorA, `insert into public.brands (organization_id, name) values ($1, 'Nueva')`, [orgA]);
  });

  it('el cliente ve su marca pero no escribe nada', async () => {
    expect(await as(db, clienteA, `select id from public.media_assets where id = $1`, [assetA1])).toHaveLength(1);
    await denied(
      db,
      clienteA,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'x.jpg', 'image/jpeg', 1)`,
      [marcaA1, orgA, assetPath(orgA, marcaA1)],
    );
    expect(await as(db, clienteA, `delete from public.media_assets where id = $1 returning id`, [assetA1])).toEqual([]);
    expect(await as(db, clienteA, `select id from public.audit_logs`)).toEqual([]);
    expect(await as(db, clienteA, `select id from public.invitations`)).toEqual([]);
  });

  it('nadie se sube el rol a sí mismo', async () => {
    expect(
      await as(db, editorA, `update public.brand_members set role = 'manager' where user_id = $1 returning user_id`, [
        editorA.id,
      ]),
    ).toEqual([]);
    await denied(
      db,
      editorA,
      `insert into public.brand_members (brand_id, organization_id, user_id, role) values ($1, $2, $3, 'manager')`,
      [marcaA2, orgA, editorA.id],
    );
    await denied(db, editorA, `select public.set_member_role($1, $2, 'admin')`, [orgA, editorA.id]);
    await denied(db, editorA, `update public.organization_members set role = 'owner' where user_id = $1`, [editorA.id]);
  });

  it('el gestor de una marca gestiona su equipo, pero solo con miembros de la organización', async () => {
    expect(
      await as(
        db,
        gestorA,
        `insert into public.brand_members (brand_id, organization_id, user_id, role) values ($1, $2, $3, 'viewer') returning user_id`,
        [marcaA1, orgA, sinMarcaA.id],
      ),
    ).toHaveLength(1);
    await as(db, gestorA, `delete from public.brand_members where brand_id = $1 and user_id = $2`, [
      marcaA1,
      sinMarcaA.id,
    ]);

    // berta no es de la organización A: la FK lo impide aunque el gestor tenga permiso.
    await denied(
      db,
      gestorA,
      `insert into public.brand_members (brand_id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')`,
      [marcaA1, orgA, berta.id],
      /foreign key/i,
    );
    // Y no gestiona la otra marca.
    await denied(
      db,
      gestorA,
      `insert into public.brand_members (brand_id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')`,
      [marcaA2, orgA, sinMarcaA.id],
    );
  });

  it('el administrador gestiona todas las marcas pero no a los propietarios', async () => {
    expect((await as(db, adminA, `select id from public.brands`)).map((r) => r.id).sort()).toEqual(
      [marcaA1, marcaA2].sort(),
    );
    await denied(db, adminA, `select public.set_member_role($1, $2, 'member')`, [orgA, ana.id]);
    await denied(db, adminA, `select public.set_member_role($1, $2, 'owner')`, [orgA, adminA.id]);
    await denied(db, adminA, `select public.remove_member($1, $2)`, [orgA, ana.id]);
    await denied(db, adminA, `select * from public.create_invitation($1, 'jefe@a.test', 'owner')`, [orgA]);
  });

  it('la organización nunca se queda sin propietario', async () => {
    await denied(db, ana, `select public.remove_member($1, $2)`, [orgA, ana.id], /al menos un propietario/);
    await denied(db, ana, `select public.set_member_role($1, $2, 'admin')`, [orgA, ana.id], /al menos un propietario/);
  });

  it('un mismo usuario tiene permisos distintos en cada organización', async () => {
    // Ana es propietaria de A y solo lectora de una marca de la agencia.
    expect(await as(db, ana, `select id from public.brands where organization_id = $1`, [agencia])).toHaveLength(1);
    await denied(
      db,
      ana,
      `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
       values ($1, $2, 'image', $3, 'x.jpg', 'image/jpeg', 1)`,
      [marcaG1, agencia, assetPath(agencia, marcaG1)],
    );
    await denied(db, ana, `insert into public.brands (organization_id, name) values ($1, 'Colada')`, [agencia]);
    expect(await as(db, ana, `select id from public.audit_logs where organization_id = $1`, [agencia])).toEqual([]);
    // Y la agencia no ve nada de la empresa A.
    expect(await as(db, gema, `select id from public.brands where organization_id = $1`, [orgA])).toEqual([]);
  });

  it('al salir de la organización se pierden también las marcas', async () => {
    const temporal = await createUser(db, 'temporal@a.test');
    await join(db, ana, temporal, orgA, 'member', marcaA1, 'editor');
    expect(await as(db, temporal, `select id from public.brands`)).toHaveLength(1);
    await as(db, ana, `select public.remove_member($1, $2)`, [orgA, temporal.id]);
    expect(await as(db, temporal, `select id from public.brands`)).toEqual([]);
    expect(await db.query(`select 1 from public.brand_members where user_id = $1`, [temporal.id])).toEqual([]);
  });
});

describe('perfil de marca versionado', () => {
  it('cada guardado crea una versión y solo una queda vigente', async () => {
    const marca = await createBrand(db, ana, orgA, 'Versionada');
    for (const n of [1, 2, 3]) {
      await as(db, ana, `select public.save_brand_profile($1, $2::jsonb, '{}'::jsonb, $3)`, [
        marca,
        JSON.stringify({ n }),
        `v${n}`,
      ]);
    }
    const versiones = await as(
      db,
      ana,
      `select version, status, data from public.brand_profiles where brand_id = $1 order by version`,
      [marca],
    );
    expect(versiones.map((v) => [v.version, v.status])).toEqual([
      [1, 'archived'],
      [2, 'archived'],
      [3, 'active'],
    ]);
    expect(versiones[0]!.data).toEqual({ n: 1 }); // las versiones antiguas no se pierden
  });

  it('el historial no se puede reescribir desde el cliente', async () => {
    await denied(
      db,
      ana,
      `insert into public.brand_profiles (brand_id, organization_id, version, data) values ($1, $2, 99, '{}')`,
      [marcaA1, orgA],
    );
    await denied(db, ana, `update public.brand_profiles set data = '{}' where brand_id = $1`, [marcaA1]);
    await denied(db, ana, `delete from public.brand_profiles where brand_id = $1`, [marcaA1]);
  });
});

describe('invitaciones', () => {
  it('el token solo sirve a la cuenta invitada, una vez', async () => {
    const invitado = await createUser(db, 'nuevo@a.test');
    const [inv] = await as<{ token: string }>(
      db,
      ana,
      `select token from public.create_invitation($1, 'Nuevo@A.test')`,
      [orgA],
    );
    const token = inv!.token;

    // Nadie puede leer la huella y el token no está guardado en claro.
    const guardado = await db.query(`select token_hash from public.invitations where token_hash = $1`, [token]);
    expect(guardado).toEqual([]);

    await denied(db, ajeno, `select public.accept_invitation($1)`, [token], /otra dirección/);
    await denied(db, ajeno, `select public.accept_invitation('token-inventado')`, [], /no existe/);
    expect(await as(db, ajeno, `select id from public.organizations`)).toEqual([]);

    await as(db, invitado, `select public.accept_invitation($1)`, [token]);
    expect((await as(db, invitado, `select id from public.organizations`)).map((r) => r.id)).toEqual([orgA]);
    await denied(db, invitado, `select public.accept_invitation($1)`, [token], /ya no es válida/);
  });

  it('una invitación caducada o anulada no vale', async () => {
    const tarde = await createUser(db, 'tarde@a.test');
    const [caducada] = await as<{ token: string; invitation_id: string }>(
      db,
      ana,
      `select invitation_id, token from public.create_invitation($1, $2)`,
      [orgA, tarde.email],
    );
    await db.query(`update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [
      caducada!.invitation_id,
    ]);
    await denied(db, tarde, `select public.accept_invitation($1)`, [caducada!.token], /ya no es válida/);

    const [anulada] = await as<{ token: string; invitation_id: string }>(
      db,
      ana,
      `select invitation_id, token from public.create_invitation($1, $2)`,
      [orgA, tarde.email],
    );
    await denied(db, berta, `select public.revoke_invitation($1)`, [anulada!.invitation_id], /No se puede anular/);
    await as(db, ana, `select public.revoke_invitation($1)`, [anulada!.invitation_id]);
    await denied(db, tarde, `select public.accept_invitation($1)`, [anulada!.token], /ya no es válida/);
    expect(await as(db, tarde, `select id from public.organizations`)).toEqual([]);
  });

  it('quién puede invitar y a qué', async () => {
    await denied(db, editorA, `select * from public.create_invitation($1, 'x@x.test')`, [orgA]);
    await denied(db, clienteA, `select * from public.create_invitation($1, 'x@x.test', 'member', $2, 'viewer')`, [
      orgA,
      marcaA1,
    ]);
    // El gestor de A1 invita a su marca, pero no a otra ni como administrador.
    expect(
      await as(db, gestorA, `select token from public.create_invitation($1, 'x@x.test', 'member', $2, 'client')`, [
        orgA,
        marcaA1,
      ]),
    ).toHaveLength(1);
    await denied(db, gestorA, `select * from public.create_invitation($1, 'x@x.test', 'member', $2, 'client')`, [
      orgA,
      marcaA2,
    ]);
    await denied(db, gestorA, `select * from public.create_invitation($1, 'x@x.test', 'admin', $2, 'client')`, [
      orgA,
      marcaA1,
    ]);
    await denied(db, gestorA, `select * from public.create_invitation($1, 'x@x.test')`, [orgA]);
    // No se puede invitar a una marca de otra organización.
    await denied(
      db,
      ana,
      `select * from public.create_invitation($1, 'x@x.test', 'member', $2, 'viewer')`,
      [orgA, marcaB1],
      /no pertenece/,
    );
  });

  it('aceptar una invitación no cambia el rol de quien ya era miembro', async () => {
    const [inv] = await as<{ token: string }>(db, ana, `select token from public.create_invitation($1, $2, 'admin')`, [
      orgA,
      editorA.email,
    ]);
    await as(db, editorA, `select public.accept_invitation($1)`, [inv!.token]);
    const [fila] = await db.query(
      `select role from public.organization_members where organization_id = $1 and user_id = $2`,
      [orgA, editorA.id],
    );
    expect(fila!.role).toBe('member');
  });
});

describe('almacenamiento', () => {
  const insert = `insert into storage.objects (bucket_id, name) values ('brand-media', $1) returning id`;

  it('solo se sube a la ruta de una marca propia con permiso de edición', async () => {
    expect(await as(db, ana, insert, [assetPath(orgA, marcaA1)])).toHaveLength(1);
    expect(await as(db, editorA, insert, [assetPath(orgA, marcaA1)])).toHaveLength(1);

    await denied(db, ana, insert, [assetPath(orgB, marcaB1)]);
    await denied(db, editorA, insert, [assetPath(orgA, marcaA2)]);
    await denied(db, clienteA, insert, [assetPath(orgA, marcaA1)]);
    await denied(db, ajeno, insert, [assetPath(orgA, marcaA1)]);
  });

  it('rechaza rutas trucadas', async () => {
    // Organización propia + marca ajena, y al revés.
    await denied(db, ana, insert, [assetPath(orgA, marcaB1)]);
    await denied(db, ana, insert, [assetPath(orgB, marcaA1)]);
    for (const name of [
      'suelto.jpg',
      `${orgA}/suelto.jpg`,
      `${orgA}/${marcaA1}`,
      `${orgA}/${marcaA1}/`,
      `../${orgA}/${marcaA1}/x.jpg`,
      `no-es-uuid/tampoco/x.jpg`,
      `${orgA.toUpperCase()}/${marcaA1}/x.jpg`,
    ]) {
      await denied(db, ana, insert, [name]);
    }
    await denied(
      db,
      ana,
      `insert into storage.objects (bucket_id, name) values ('otro-cubo', $1)`,
      [assetPath(orgA, marcaA1)],
      /row-level security|foreign key/i,
    );
  });

  it('nadie ve ni borra los archivos de otra organización', async () => {
    const ruta = assetPath(orgB, marcaB1);
    await as(db, berta, insert, [ruta]);
    expect(await as(db, ana, `select name from storage.objects where name = $1`, [ruta])).toEqual([]);
    expect(await as(db, ana, `delete from storage.objects where name = $1 returning id`, [ruta])).toEqual([]);
    expect(
      await as(db, ana, `update storage.objects set name = $2 where name = $1 returning id`, [
        ruta,
        assetPath(orgA, marcaA1),
      ]),
    ).toEqual([]);
    const nombres = await as(db, ana, `select name from storage.objects`);
    expect(nombres.every((r) => String(r.name).startsWith(orgA) || String(r.name).startsWith(agencia))).toBe(true);
    // El cliente lee los de su marca.
    expect((await as(db, clienteA, `select name from storage.objects`)).length).toBeGreaterThan(0);
  });

  it('un archivo propio no se puede mover a la ruta de otra organización', async () => {
    const ruta = assetPath(orgA, marcaA1);
    await as(db, ana, insert, [ruta]);
    await denied(db, ana, `update storage.objects set name = $2 where name = $1`, [ruta, assetPath(orgB, marcaB1)]);
  });
});

describe('IA y cola de trabajos', () => {
  const ids = async (user: TestUser, table: string) =>
    (await as<{ id: string }>(db, user, `select id::text as id from public.${table}`)).map((r) => r.id);
  const orgsOf = async (user: TestUser, table: string) =>
    (await as<{ org: string }>(db, user, `select distinct organization_id::text as org from public.${table}`)).map(
      (r) => r.org,
    );

  it('una organización no ve generaciones, costes, cupos ni trabajos de otra', async () => {
    // Cada propietaria ve lo suyo (la prueba no pasa «porque no hay nada»)…
    for (const table of ['usage_quotas', 'ai_generations', 'ai_usage', 'jobs']) {
      expect(await orgsOf(ana, table), table).toEqual([orgA]);
      expect(await orgsOf(berta, table), table).toEqual([orgB]);
    }
    expect(await ids(ana, 'ai_generations')).toEqual([genA1]);
    expect(await ids(berta, 'ai_generations')).toEqual([genB1]);
    expect((await ids(ana, 'jobs')).sort()).toEqual([jobA1, jobOrgA].sort());
    expect(await ids(berta, 'jobs')).toEqual([jobB1]);

    // …y buscando por identificador tampoco aparece lo ajeno.
    expect(await as(db, ana, `select 1 from public.ai_generations where id = $1`, [genB1])).toEqual([]);
    expect(await as(db, ana, `select 1 from public.ai_usage where generation_id = $1`, [genB1])).toEqual([]);
    expect(await as(db, ana, `select 1 from public.usage_quotas where organization_id = $1`, [orgB])).toEqual([]);
    expect(await as(db, ana, `select 1 from public.jobs where id = $1`, [jobB1])).toEqual([]);

    // El coste que ve cada una es solo el de su organización.
    const coste = (user: TestUser) =>
      as(
        db,
        user,
        `select organization_id, cost_micros::int as cost from public.ai_cost_by_organization(now() - interval '1 day', now() + interval '1 day')`,
      );
    expect(await coste(ana)).toEqual([{ organization_id: orgA, cost: 1200 }]);
    expect(await coste(berta)).toEqual([{ organization_id: orgB, cost: 3400 }]);
    expect(await coste(ajeno)).toEqual([]);
  });

  it('dentro de la organización: el dinero es de los administradores', async () => {
    expect(await orgsOf(adminA, 'usage_quotas')).toEqual([orgA]);
    expect(await orgsOf(adminA, 'ai_usage')).toEqual([orgA]);
    for (const user of [editorA, gestorA, clienteA, sinMarcaA]) {
      expect(await as(db, user, `select 1 from public.usage_quotas`), user.email).toEqual([]);
      expect(await as(db, user, `select 1 from public.ai_usage`), user.email).toEqual([]);
    }
  });

  it('las generaciones las ve quien crea contenido en la marca; los trabajos, quien ve la marca', async () => {
    expect(await ids(editorA, 'ai_generations')).toEqual([genA1]);
    expect(await ids(gestorA, 'ai_generations')).toEqual([genA1]);
    expect(await ids(clienteA, 'ai_generations')).toEqual([]);
    expect(await ids(sinMarcaA, 'ai_generations')).toEqual([]);

    // El trabajo de toda la organización solo lo ven sus administradores.
    expect((await ids(adminA, 'jobs')).sort()).toEqual([jobA1, jobOrgA].sort());
    expect(await ids(editorA, 'jobs')).toEqual([jobA1]);
    expect(await ids(clienteA, 'jobs')).toEqual([jobA1]);
    expect(await ids(sinMarcaA, 'jobs')).toEqual([]);

    // Ana solo es lectora en la agencia: no ve allí generaciones ni costes.
    expect(await as(db, ana, `select 1 from public.ai_generations where id = $1`, [genG1])).toEqual([]);
    expect(await as(db, ana, `select 1 from public.ai_usage where organization_id = $1`, [agencia])).toEqual([]);
    expect(await ids(gema, 'ai_generations')).toEqual([genG1]);
  });

  it('nadie escribe estas tablas ni mueve la cola desde el cliente', async () => {
    for (const user of [ana, adminA, editorA]) {
      await denied(
        db,
        user,
        `insert into public.usage_quotas (organization_id, metric, limit_value) values ($1, 'ai_cost_micros', 1)`,
        [orgA],
      );
      await denied(db, user, `update public.usage_quotas set limit_value = limit_value * 10`);
      await denied(db, user, `update public.ai_generations set cost_micros = 0`);
      await denied(db, user, `delete from public.ai_generations`);
      await denied(db, user, `update public.ai_usage set cost_delta_micros = 0`);
      await denied(db, user, `delete from public.ai_usage`);
      await denied(db, user, `update public.jobs set status = 'succeeded'`);
      await denied(db, user, `delete from public.jobs`);
    }
    const noFunction = /permission denied for function/;
    await denied(
      db,
      ana,
      `select public.ai_reserve_generation($1, $2, 'text', 'x', 'p', 'm', 1)`,
      [ana.id, marcaA1],
      noFunction,
    );
    await denied(db, ana, `select public.ai_complete_generation($1, 0)`, [genA1], noFunction);
    await denied(db, ana, `select public.ai_fail_generation($1, 'x')`, [genA1], noFunction);
    await denied(db, ana, `select public.enqueue_job($1, 'media.render', '{}'::jsonb, 'k')`, [orgA], noFunction);
    await denied(db, ana, `select * from public.claim_jobs('yo')`, [], noFunction);
    await denied(db, ana, `select public.cancel_job($1)`, [jobA1], noFunction);
    await denied(db, ana, `select public.admin_set_ai_quota($1, 999999999)`, [orgA]);
  });

  it('el servidor no puede generar en nombre de quien no pertenece a la marca', async () => {
    const reservar = (user: TestUser, brand: string) =>
      serviceRpc(db, 'ai_reserve_generation', {
        p_user_id: user.id,
        p_brand_id: brand,
        p_task: 'text',
        p_purpose: 'post.caption',
        p_provider: 'simulated',
        p_model: 'sim-text-1',
        p_reserve_micros: 1,
      });
    // Ana en la marca de B; el editor de A1 en A2; el cliente y la lectora de la agencia.
    await expect(reservar(ana, marcaB1)).rejects.toThrow(/No tienes permiso para generar/);
    await expect(reservar(editorA, marcaA2)).rejects.toThrow(/No tienes permiso para generar/);
    await expect(reservar(clienteA, marcaA1)).rejects.toThrow(/No tienes permiso para generar/);
    await expect(reservar(ana, marcaG1)).rejects.toThrow(/No tienes permiso para generar/);
    await expect(reservar(superadmin, marcaA1)).rejects.toThrow(/No tienes permiso para generar/);
  });

  it('ser superadministrador no abre las generaciones ni el consumo de los clientes', async () => {
    for (const table of ['usage_quotas', 'ai_generations', 'ai_usage', 'jobs']) {
      expect(await as(db, superadmin, `select 1 from public.${table}`), table).toEqual([]);
    }
  });
});

describe('auditoría y superadministración', () => {
  it('las acciones quedan registradas con su autor y solo las ven los administradores', async () => {
    const registros = await as(
      db,
      ana,
      `select action, entity_type, actor_id from public.audit_logs where organization_id = $1`,
      [orgA],
    );
    const tipos = new Set(registros.map((r) => `${r.action}:${r.entity_type}`));
    for (const esperado of [
      'insert:organizations',
      'insert:brands',
      'insert:organization_members',
      'insert:brand_profiles',
      'insert:invitations',
    ]) {
      expect(tipos, esperado).toContain(esperado);
    }
    expect(registros.some((r) => r.actor_id === ana.id)).toBe(true);
    expect(await as(db, adminA, `select id from public.audit_logs limit 1`)).toHaveLength(1);
    expect(await as(db, editorA, `select id from public.audit_logs`)).toEqual([]);
  });

  it('el registro no guarda contenidos ni huellas de token y no se puede manipular', async () => {
    const rows = await db.query(`select data from public.audit_logs where data ? 'token_hash' or data ? 'data'`);
    expect(rows).toEqual([]);
    await denied(
      db,
      ana,
      `insert into public.audit_logs (organization_id, action, entity_type) values ($1, 'x', 'x')`,
      [orgA],
    );
    await denied(db, ana, `delete from public.audit_logs where organization_id = $1`, [orgA]);
    await denied(db, ana, `update public.audit_logs set action = 'x' where organization_id = $1`, [orgA]);
  });

  it('el resumen global es solo para superadministradores', async () => {
    await denied(db, ana, `select * from public.admin_list_organizations()`);
    const todas = await as(db, superadmin, `select id, brands, assets from public.admin_list_organizations()`);
    expect(todas.map((r) => r.id).sort()).toEqual([orgA, orgB, agencia].sort());
    // Ser superadministrador no abre las tablas de los clientes.
    expect(await as(db, superadmin, `select id from public.media_assets`)).toEqual([]);
    await denied(db, ana, `insert into public.platform_admins (user_id) values ($1)`, [ana.id]);
    expect(await as(db, ana, `select user_id from public.platform_admins`)).toEqual([]);
  });
});
