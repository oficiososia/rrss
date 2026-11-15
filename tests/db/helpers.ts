// Utilidades para probar las migraciones REALES contra un Postgres de verdad.
//
// Por defecto se usa PGlite (Postgres compilado a WASM, en memoria): no hace
// falta instalar nada y vale para CI. Con DATABASE_URL (un superusuario de un
// Postgres local) se crea una base de datos temporal en ese servidor.
// Nunca se conecta a Supabase.
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
const SCAFFOLD = path.join(ROOT, 'supabase/tests/andamiaje.sql');

export type Row = Record<string, unknown>;

export interface TestUser {
  id: string;
  email: string;
}

export interface Db {
  engine: 'pglite' | 'postgres';
  /** Ejecuta SQL (una o varias sentencias) como superusuario. */
  exec(sql: string): Promise<void>;
  /** Ejecuta una sentencia como superusuario. */
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  return {
    engine: 'pglite',
    exec: async (sql) => {
      await pg.exec(sql);
    },
    query: async <T extends Row>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
    close: () => pg.close(),
  };
}

async function openPostgres(adminUrl: string): Promise<Db> {
  const { default: pgLib } = await import('pg');
  const name = `rrss_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = new pgLib.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const client = new pgLib.Client({ connectionString: url.toString() });
  await client.connect();
  return {
    engine: 'postgres',
    exec: async (sql) => {
      await client.query(sql);
    },
    query: async <T extends Row>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[],
    close: async () => {
      await client.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

export async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

/** Base de datos nueva con el andamiaje de Supabase y todas las migraciones aplicadas. */
export async function createDb(): Promise<Db> {
  const db = process.env.DATABASE_URL ? await openPostgres(process.env.DATABASE_URL) : await openPglite();
  await db.exec(await readFile(SCAFFOLD, 'utf8'));
  for (const file of await migrationFiles()) {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

export async function createUser(db: Db, email: string, fullName = ''): Promise<TestUser> {
  const [row] = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('full_name', $2::text)) returning id`,
    [email, fullName],
  );
  return { id: row!.id, email };
}

/**
 * Ejecuta una sentencia con la identidad de un usuario, igual que la API de
 * Supabase: rol `authenticated` (o `anon`) y el JWT en `request.jwt.claims`.
 * Si la sentencia falla, la transacción se deshace y el error se propaga.
 */
export async function as<T extends Row = Row>(
  db: Db,
  user: TestUser | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const role = user ? 'authenticated' : 'anon';
  const claims = user ? { sub: user.id, email: user.email, role } : { role };
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await db.exec(`set local role ${role}`);
    const rows = await db.query<T>(sql, params);
    await db.exec('commit');
    return rows;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

/** La sentencia debe fallar con un error que cumpla el patrón. */
export async function denied(
  db: Db,
  user: TestUser | null,
  sql: string,
  params: unknown[] = [],
  pattern: RegExp = /permission denied|row-level security|permiso|Solo/i,
): Promise<void> {
  let error: unknown;
  try {
    await as(db, user, sql, params);
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`Se esperaba un rechazo y la sentencia se ejecutó: ${sql}`);
  const message = error instanceof Error ? error.message : String(error);
  if (!pattern.test(message)) throw new Error(`Rechazo inesperado («${message}») en: ${sql}`);
}

export async function createOrg(db: Db, user: TestUser, name: string, kind = 'business'): Promise<string> {
  const [row] = await as<{ id: string }>(
    db,
    user,
    `select id from public.create_organization($1, $2::public.org_kind)`,
    [name, kind],
  );
  return row!.id;
}

export async function createBrand(db: Db, user: TestUser, orgId: string, name: string): Promise<string> {
  const [row] = await as<{ id: string }>(
    db,
    user,
    `insert into public.brands (organization_id, name) values ($1, $2) returning id`,
    [orgId, name],
  );
  return row!.id;
}

/** Invita y acepta: es la única vía real de entrar en una organización. */
export async function join(
  db: Db,
  inviter: TestUser,
  invitee: TestUser,
  orgId: string,
  orgRole: string,
  brandId: string | null = null,
  brandRole: string | null = null,
): Promise<void> {
  const [inv] = await as<{ token: string }>(
    db,
    inviter,
    `select token from public.create_invitation($1, $2, $3::public.org_role, $4, $5::public.brand_role)`,
    [orgId, invitee.email, orgRole, brandId, brandRole],
  );
  await as(db, invitee, `select public.accept_invitation($1)`, [inv!.token]);
}

export function assetPath(orgId: string, brandId: string, name = `${randomUUID()}.jpg`): string {
  return `${orgId}/${brandId}/media/${name}`;
}

export async function addAsset(db: Db, user: TestUser, orgId: string, brandId: string): Promise<string> {
  const [row] = await as<{ id: string }>(
    db,
    user,
    `insert into public.media_assets (brand_id, organization_id, kind, storage_path, file_name, mime_type, bytes)
     values ($1, $2, 'image', $3, 'foto.jpg', 'image/jpeg', 1234) returning id`,
    [brandId, orgId, assetPath(orgId, brandId)],
  );
  return row!.id;
}
