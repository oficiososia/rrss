// Uso del recorte de fondo en el servidor (migración 20261213120000, `api/cutout-mask.ts`):
// solo reserva quien puede EDITAR la marca, hay topes por persona/día y por marca/mes,
// la duración la anota solo quien reservó, y nadie escribe en la tabla a mano.
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
  type Db,
  type TestUser,
} from './helpers';

let db: Db;
let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let orgId: string;
let brandId: string;
let otherBrandId: string;

type Reserve = { allowed: boolean; id?: number; reason?: string; used_day: number; used_month: number };
const reserve = async (user: TestUser, brand: string | null) =>
  (await as<{ r: Reserve }>(db, user, `select public.cutout_reserve($1) as r`, [brand]))[0]!.r;

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, 'dueña@recorte.test');
  editor = await createUser(db, 'editora@recorte.test');
  viewer = await createUser(db, 'lectora@recorte.test');
  outsider = await createUser(db, 'ajena@recorte.test');
  orgId = await createOrg(db, owner, 'Recorte SL');
  brandId = await createBrand(db, owner, orgId, 'Marca A');
  otherBrandId = await createBrand(db, owner, orgId, 'Marca B');
  await join(db, owner, editor, orgId, 'member', brandId, 'editor');
  await join(db, owner, viewer, orgId, 'member', brandId, 'viewer');
});

afterAll(async () => {
  await db?.close();
});

describe('reservar un recorte en el servidor', () => {
  it('quien edita la marca reserva y queda la fila; la duración la anota quien reservó', async () => {
    const r = await reserve(editor, brandId);
    expect(r).toMatchObject({ allowed: true, used_day: 1, used_month: 1 });
    await as(db, editor, `select public.cutout_finish($1, 3400, true)`, [r.id]);
    const rows = await asService<{ duration_ms: number; ok: boolean; user_id: string; brand_id: string }>(
      db,
      `select duration_ms, ok, user_id, brand_id from public.cutout_usage where id = $1`,
      [r.id],
    );
    expect(rows[0]).toMatchObject({ duration_ms: 3400, ok: true, user_id: editor.id, brand_id: brandId });
    // Otra persona no puede cambiar la fila, ni se puede anotar dos veces.
    await as(db, owner, `select public.cutout_finish($1, 1, false)`, [r.id]);
    await as(db, editor, `select public.cutout_finish($1, 9, false)`, [r.id]);
    const after = await asService<{ duration_ms: number }>(
      db,
      `select duration_ms from public.cutout_usage where id = $1`,
      [r.id],
    );
    expect(after[0]!.duration_ms).toBe(3400);
  });

  it('sin permiso de edición (lector, ajena, sin sesión o de otra marca) se rechaza y no gasta cupo', async () => {
    const before = await asService<{ n: string }>(db, `select count(*)::text as n from public.cutout_usage`);
    await denied(db, viewer, `select public.cutout_reserve($1)`, [brandId], /Sin permiso/);
    await denied(db, outsider, `select public.cutout_reserve($1)`, [brandId], /Sin permiso/);
    await denied(db, editor, `select public.cutout_reserve($1)`, [otherBrandId], /Sin permiso/);
    await denied(db, editor, `select public.cutout_reserve(null)`, [], /Sin permiso/);
    await denied(db, null, `select public.cutout_reserve($1)`, [brandId]);
    const after = await asService<{ n: string }>(db, `select count(*)::text as n from public.cutout_usage`);
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('el tope diario por persona corta sin dejar fila; la dueña sigue pudiendo', async () => {
    let last: Reserve = await reserve(editor, brandId);
    for (let i = 0; i < 70 && last.allowed; i += 1) last = await reserve(editor, brandId);
    expect(last).toMatchObject({ allowed: false, reason: 'day' });
    const used = await asService<{ n: string }>(
      db,
      `select count(*)::text as n from public.cutout_usage where user_id = $1`,
      [editor.id],
    );
    expect(Number(used[0]!.n)).toBe(60);
    expect(await reserve(owner, brandId)).toMatchObject({ allowed: true });
  });

  it('el tope mensual por marca corta aunque la persona no haya llegado al diario', async () => {
    await asService(
      db,
      `insert into public.cutout_usage (organization_id, brand_id, user_id, created_at, duration_ms, ok)
       select $1, $2, $3, date_trunc('month', now()), 1000, true from generate_series(1, 600)`,
      [orgId, otherBrandId, owner.id],
    );
    expect(await reserve(owner, otherBrandId)).toMatchObject({ allowed: false, reason: 'month' });
  });
});

describe('la tabla de uso', () => {
  it('nadie escribe a mano; quien gestiona la marca la ve y el resto no', async () => {
    await denied(
      db,
      editor,
      `insert into public.cutout_usage (organization_id, brand_id, user_id) values ($1, $2, $3)`,
      [orgId, brandId, editor.id],
    );
    await denied(db, owner, `update public.cutout_usage set ok = true`);
    await denied(db, owner, `delete from public.cutout_usage`);
    expect(
      (await as(db, owner, `select id from public.cutout_usage where brand_id = $1`, [brandId])).length,
    ).toBeGreaterThan(0);
    expect(await as(db, editor, `select id from public.cutout_usage`)).toEqual([]);
    expect(await as(db, outsider, `select id from public.cutout_usage`)).toEqual([]);
  });
});
