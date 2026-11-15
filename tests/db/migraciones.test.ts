// Las migraciones se pueden deshacer y volver a aplicar: cada una tiene su
// vuelta atrás y deja la base de datos como estaba.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDb, migrationFiles, MIGRATIONS_DIR, type Db } from './helpers';

const ROLLBACKS_DIR = path.join(MIGRATIONS_DIR, '../rollbacks');
let db: Db;

beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db?.close();
});

const objects = async () =>
  db.query(
    `select 'tabla ' || relname as o from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
     union all select 'función ' || pronamespace::regnamespace || '.' || proname from pg_proc
       where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     union all select 'tipo ' || typname from pg_type where typnamespace = 'public'::regnamespace and typtype = 'e'
     union all select 'política ' || policyname from pg_policies where schemaname in ('public', 'storage')
     order by 1`,
  );

it('cada migración tiene su vuelta atrás', async () => {
  for (const file of await migrationFiles()) {
    await expect(readFile(path.join(ROLLBACKS_DIR, file), 'utf8'), file).resolves.toBeTruthy();
  }
});

it('deshacer lo deja todo limpio y se puede volver a aplicar', async () => {
  const files = await migrationFiles();
  const antes = await objects();
  expect(antes.length).toBeGreaterThan(40);

  for (const file of [...files].reverse()) {
    await db.exec(await readFile(path.join(ROLLBACKS_DIR, file), 'utf8'));
  }
  expect(await objects()).toEqual([]);

  for (const file of files) {
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  expect(await objects()).toEqual(antes);
});
