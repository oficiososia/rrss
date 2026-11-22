// Editor de piezas: marcos de foto (documento v6) y borradores que se guardan
// solos, contra la migración real 20270103010000_editor_frames_drafts.
//  · Las plantillas de marca aceptan el documento v6 (y siguen aceptando v3–v5),
//    también con un marco vacío, que no referencia ningún recurso.
//  · `content_drafts`: uno por pieza y persona; solo lo ve y lo escribe su
//    autora, y solo donde puede editar; guardar una versión borra el suyo.
//  · La vuelta atrás quita todo y se puede volver a aplicar.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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
  MIGRATIONS_DIR,
  type Db,
  type TestUser,
} from './helpers';

const NAME = '20270103010000_editor_frames_drafts.sql';
const MIGRATION = path.join(MIGRATIONS_DIR, NAME);
const ROLLBACK = path.join(MIGRATIONS_DIR, '../rollbacks', NAME);

let db: Db;
let ana: TestUser, eva: TestUser, lector: TestUser, berta: TestUser;
let org: string, marca: string, otraOrg: string, otraMarca: string;
let pieza: string, piezaAjena: string;

type Draft = {
  content_id: string;
  user_id: string;
  base_version: number;
  schema_version: number;
  data: { n?: number };
};

const doc = (n: number) => ({ schemaVersion: 6, n });

async function crear(user: TestUser, brand: string, organization: string): Promise<string> {
  const [row] = await as<{ id: string }>(
    db,
    user,
    `insert into public.content_items (brand_id, organization_id, title, network, format)
     values ($1, $2, 'Pieza', 'instagram', 'post') returning id`,
    [brand, organization],
  );
  return row!.id;
}

const guardarVersion = (user: TestUser, id: string, n: number) =>
  as(db, user, `select public.save_content_version($1, $2::jsonb, 6)`, [id, JSON.stringify(doc(n))]);

const guardarBorrador = (user: TestUser, id: string, n: number, base = 0) =>
  as<Draft>(db, user, `select * from public.save_content_draft($1, $2::jsonb, 6, $3)`, [
    id,
    JSON.stringify(doc(n)),
    base,
  ]).then((rows) => rows[0]!);

const borradores = (user: TestUser) =>
  as<Draft>(db, user, `select * from public.content_drafts order by content_id, user_id`);

beforeAll(async () => {
  db = await createDb();
  ana = await createUser(db, 'ana@marcos.test', 'Ana');
  eva = await createUser(db, 'eva@marcos.test', 'Eva');
  lector = await createUser(db, 'lector@marcos.test', 'Lector');
  berta = await createUser(db, 'berta@marcos.test', 'Berta');

  org = await createOrg(db, ana, 'Empresa A');
  marca = await createBrand(db, ana, org, 'Marca A');
  await join(db, ana, eva, org, 'member', marca, 'editor');
  await join(db, ana, lector, org, 'member', marca, 'viewer');
  otraOrg = await createOrg(db, berta, 'Empresa B');
  otraMarca = await createBrand(db, berta, otraOrg, 'Marca B');

  pieza = await crear(ana, marca, org);
  piezaAjena = await crear(berta, otraMarca, otraOrg);
});

afterAll(async () => {
  await db?.close();
});

describe('plantillas con el documento v6 (marcos de foto)', () => {
  const template = (version: number, key: string) =>
    db.query(
      `insert into public.brand_design_templates (brand_id, organization_id, template_key, name, network, format, document)
       values ($1, $2, $3, 'Prueba', 'instagram', 'post', $4::jsonb) returning id`,
      [
        marca,
        org,
        key,
        JSON.stringify({
          schemaVersion: version,
          canvas: { aspectRatio: '4:5', width: 1080, height: 1350, backgroundColor: '#FFFFFF' },
          pages: [
            {
              id: 'p1',
              layers: [
                {
                  id: 'foto',
                  type: 'image',
                  x: 0,
                  y: 0,
                  width: 1080,
                  height: 700,
                  source: { kind: 'empty' },
                  frame: true,
                },
              ],
            },
          ],
          copy: { caption: '', captionHint: 'Qué es y cuánto cuesta' },
        }),
      ],
    );

  it('la tabla acepta las versiones 3 a 6 y rechaza las demás', async () => {
    for (const version of [3, 4, 5, 6])
      await expect(template(version, `v${version}`), `v${version}`).resolves.toHaveLength(1);
    await expect(template(7, 'v7')).rejects.toThrow(/brand_design_templates_document_check/);
    await expect(template(2, 'v2')).rejects.toThrow(/brand_design_templates_document_check/);
  });

  it('guardar una plantilla con un marco vacío no pide ningún recurso (no hay foto que comprobar)', async () => {
    const item = {
      key: 'editor-con-marco',
      name: 'Con marco',
      network: 'instagram',
      format: 'post',
      source: 'editor',
      document: {
        schemaVersion: 6,
        canvas: { aspectRatio: '4:5', width: 1080, height: 1350, backgroundColor: '#FFFFFF' },
        pages: [
          {
            id: 'p1',
            layers: [
              {
                id: 'foto',
                type: 'image',
                x: 0,
                y: 0,
                width: 1080,
                height: 700,
                source: { kind: 'empty' },
                frame: true,
              },
            ],
          },
        ],
      },
      analysis: {},
    };
    const rows = await as<{ template_key: string; document: { schemaVersion: number } }>(
      db,
      ana,
      `select * from public.deliver_design_templates($1, $2::jsonb)`,
      [marca, JSON.stringify([item])],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.document.schemaVersion).toBe(6);
  });
});

describe('borradores del editor', () => {
  it('se guarda uno por pieza y persona, y volver a guardar lo sustituye', async () => {
    const first = await guardarBorrador(ana, pieza, 1);
    expect(first).toMatchObject({ content_id: pieza, user_id: ana.id, base_version: 0, schema_version: 6 });
    await guardarBorrador(ana, pieza, 2);
    const mine = await borradores(ana);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data.n).toBe(2);
    // No es una versión: la pieza sigue sin ninguna y en su estado.
    const [item] = await db.query<{ current_version: number; status: string }>(
      `select current_version, status from public.content_items where id = $1`,
      [pieza],
    );
    expect(item).toMatchObject({ current_version: 0, status: 'idea' });
  });

  it('cada persona tiene el suyo y no ve el de las demás, ni dentro de la misma marca', async () => {
    await guardarBorrador(eva, pieza, 10);
    expect((await borradores(eva)).map((d) => d.data.n)).toEqual([10]);
    expect((await borradores(ana)).map((d) => d.data.n)).toEqual([2]);
    // Quien solo mira, y otra organización, no ven ninguno.
    expect(await borradores(lector)).toEqual([]);
    expect(await borradores(berta)).toEqual([]);
    await denied(db, null, `select * from public.content_drafts`);
  });

  it('solo guarda borradores quien puede editar la pieza', async () => {
    await denied(
      db,
      lector,
      `select public.save_content_draft($1, '{"schemaVersion":6}'::jsonb, 6, 0)`,
      [pieza],
      /No tienes permiso/,
    );
    await denied(
      db,
      berta,
      `select public.save_content_draft($1, '{"schemaVersion":6}'::jsonb, 6, 0)`,
      [pieza],
      /No tienes permiso/,
    );
    await denied(
      db,
      ana,
      `select public.save_content_draft($1, '{"schemaVersion":6}'::jsonb, 6, 0)`,
      [piezaAjena],
      /No tienes permiso/,
    );
    await denied(db, null, `select public.save_content_draft($1, '{"schemaVersion":6}'::jsonb, 6, 0)`, [pieza]);
    await expect(as(db, ana, `select public.save_content_draft($1, '[]'::jsonb, 6, 0)`, [pieza])).rejects.toThrow(
      /El borrador no es válido/,
    );
  });

  it('nadie escribe la tabla a mano: ni el cliente ni la clave de servicio', async () => {
    const insert = `insert into public.content_drafts (content_id, brand_id, organization_id, user_id, base_version, schema_version, data)
       values ($1, $2, $3, $4, 0, 6, '{}'::jsonb)`;
    await denied(db, lector, insert, [pieza, marca, org, lector.id]);
    await denied(db, ana, insert, [piezaAjena, otraMarca, otraOrg, ana.id]);
    await denied(db, ana, `update public.content_drafts set data = '{"n":99}'::jsonb where content_id = $1`, [pieza]);
    await expect(asService(db, insert, [pieza, marca, org, lector.id])).rejects.toThrow(/permission denied/);
    await expect(asService(db, `delete from public.content_drafts`)).rejects.toThrow(/permission denied/);
  });

  it('una pieza archivada no admite borradores nuevos', async () => {
    const archivada = await crear(ana, marca, org);
    await as(db, ana, `select public.archive_content_item($1)`, [archivada]);
    await expect(guardarBorrador(ana, archivada, 1)).rejects.toThrow(/archivado/);
  });

  it('guardar una versión borra el borrador de quien la guarda, y solo el suyo', async () => {
    await guardarVersion(ana, pieza, 3);
    expect(await borradores(ana)).toEqual([]);
    // El de Eva sigue: empezó sobre la versión 0 y ahora la pieza va por la 1 (el editor avisa del conflicto).
    const hers = await borradores(eva);
    expect(hers).toHaveLength(1);
    expect(hers[0]!.base_version).toBe(0);
  });

  it('la versión de partida nunca es posterior a la de la pieza', async () => {
    const draft = await guardarBorrador(ana, pieza, 4, 99);
    expect(draft.base_version).toBe(1);
  });

  it('descartar es borrar el propio; el ajeno no se puede', async () => {
    await as(db, ana, `delete from public.content_drafts where content_id = $1`, [pieza]);
    // Sin política que lo permita, el borrado de Ana no toca el de Eva (no falla: no ve la fila).
    expect(await borradores(ana)).toEqual([]);
    expect(await borradores(eva)).toHaveLength(1);
  });

  it('al borrar la pieza o la persona, sus borradores desaparecen', async () => {
    const temporal = await crear(ana, marca, org);
    await guardarBorrador(ana, temporal, 1);
    await guardarBorrador(eva, temporal, 2);
    await db.query(`delete from public.content_items where id = $1`, [temporal]);
    expect(await db.query(`select 1 from public.content_drafts where content_id = $1`, [temporal])).toEqual([]);
  });
});

describe('vuelta atrás', () => {
  it('quita los borradores y el documento v6, y se puede volver a aplicar', async () => {
    await db.exec(`delete from public.brand_design_templates where document ->> 'schemaVersion' = '6'`);
    await db.exec(await readFile(ROLLBACK, 'utf8'));
    expect(await db.query(`select 1 from pg_class where relname = 'content_drafts'`)).toEqual([]);
    expect(
      await db.query(`select 1 from pg_proc where proname in ('save_content_draft', 'content_drafts_clear')`),
    ).toEqual([]);
    // Guardar versiones sigue funcionando sin el disparador.
    await guardarVersion(ana, pieza, 5);
    await expect(
      db.query(
        `insert into public.brand_design_templates (brand_id, organization_id, template_key, name, network, format, document)
         values ($1, $2, 'tras-volver', 'x', 'instagram', 'post', '{"schemaVersion":6}'::jsonb)`,
        [marca, org],
      ),
    ).rejects.toThrow(/brand_design_templates_document_check/);

    await db.exec(await readFile(MIGRATION, 'utf8'));
    await expect(guardarBorrador(ana, pieza, 6)).resolves.toMatchObject({ content_id: pieza });
  });
});
