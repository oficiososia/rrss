// Gestión de las plantillas de la marca: renombrar y duplicar (migración 20261220010000).
// Solo quien edita la marca; la copia es del editor y respeta el tope de 50; nada cruza organizaciones.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createBrand, createDb, createOrg, createUser, denied, join, type Db, type TestUser } from './helpers';

let db: Db;
let owner: TestUser, editor: TestUser, viewer: TestUser, outsider: TestUser;
let orgId: string, brandId: string, templateId: string;

const document = {
  schemaVersion: 3,
  canvas: { aspectRatio: '1:1', width: 1080, height: 1080, backgroundColor: '#FFFFFF' },
  layers: [],
  copy: { caption: '', hashtags: [], mentions: [], altText: '', callToAction: { label: '', url: '' } },
};

beforeAll(async () => {
  db = await createDb();
  owner = await createUser(db, 'dueña@plantillas.test');
  editor = await createUser(db, 'editora@plantillas.test');
  viewer = await createUser(db, 'lectora@plantillas.test');
  outsider = await createUser(db, 'ajena@plantillas.test');
  orgId = await createOrg(db, owner, 'Plantillas SL');
  brandId = await createBrand(db, owner, orgId, 'Marca A');
  await join(db, owner, editor, orgId, 'member', brandId, 'editor');
  await join(db, owner, viewer, orgId, 'member', brandId, 'viewer');
  const rows = await db.query<{ id: string }>(
    `insert into public.brand_design_templates (brand_id, organization_id, template_key, name, network, format, document, analysis, source)
     values ($1, $2, 'cartel', 'Cartel del menú', 'instagram', 'post', $3::jsonb, '{"summary":"x"}'::jsonb, 'manual') returning id`,
    [brandId, orgId, JSON.stringify(document)],
  );
  templateId = rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe('renombrar una plantilla', () => {
  it('quien edita la marca cambia solo el nombre', async () => {
    const [row] = await as<{ name: string; source: string; template_key: string }>(
      db,
      editor,
      `select name, source, template_key from public.rename_design_template($1, $2)`,
      [templateId, '  Cartel de verano  '],
    );
    expect(row).toMatchObject({ name: 'Cartel de verano', source: 'manual', template_key: 'cartel' });
  });

  it('el nombre debe tener entre 1 y 120 caracteres', async () => {
    await denied(db, editor, `select public.rename_design_template($1, '   ')`, [templateId], /entre 1 y 120/);
    await denied(
      db,
      editor,
      `select public.rename_design_template($1, $2)`,
      [templateId, 'x'.repeat(121)],
      /entre 1 y 120/,
    );
  });

  it('quien solo ve la marca, otra organización y sin sesión no pueden', async () => {
    await denied(db, viewer, `select public.rename_design_template($1, 'otro')`, [templateId], /edita/);
    await denied(db, outsider, `select public.rename_design_template($1, 'otro')`, [templateId], /edita/);
    await denied(
      db,
      null,
      `select public.rename_design_template($1, 'otro')`,
      [templateId],
      /permission denied|sesión/,
    );
    await denied(db, editor, `select public.rename_design_template(gen_random_uuid(), 'otro')`, [], /edita/);
  });
});

describe('duplicar una plantilla', () => {
  it('crea una copia del editor con otra clave y el mismo documento, y el original no cambia', async () => {
    const [copy] = await as<{ id: string; name: string; source: string; template_key: string; created_by: string }>(
      db,
      editor,
      `select id, name, source, template_key, created_by from public.duplicate_design_template($1)`,
      [templateId],
    );
    expect(copy).toMatchObject({ name: 'Cartel de verano (copia)', source: 'editor', created_by: editor.id });
    expect(copy!.template_key).toMatch(/^copia-[0-9a-f]{12}$/);
    const rows = await as<{ id: string; same: boolean }>(
      db,
      owner,
      `select id, document = (select document from public.brand_design_templates where id = $1) as same
       from public.brand_design_templates where brand_id = $2 order by created_at`,
      [templateId, brandId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.same)).toBe(true);
    // Se puede renombrar y borrar como cualquier otra.
    await as(db, editor, `select public.rename_design_template($1, 'Mi copia')`, [copy!.id]);
    await as(db, editor, `select public.delete_design_template($1)`, [copy!.id]);
  });

  it('quien solo ve la marca y otra organización no pueden duplicar', async () => {
    await denied(db, viewer, `select public.duplicate_design_template($1)`, [templateId], /edita/);
    await denied(db, outsider, `select public.duplicate_design_template($1)`, [templateId], /edita/);
    await denied(db, null, `select public.duplicate_design_template($1)`, [templateId], /permission denied|sesión/);
  });

  it('respeta el tope de 50 plantillas del editor por marca', async () => {
    await db.query(
      `insert into public.brand_design_templates (brand_id, organization_id, template_key, name, network, format, document, source)
       select $1, $2, 'relleno-' || g, 'Relleno', 'instagram', 'post', $3::jsonb, 'editor' from generate_series(1, 50) g`,
      [brandId, orgId, JSON.stringify(document)],
    );
    await denied(db, editor, `select public.duplicate_design_template($1)`, [templateId], /50 plantillas/);
    await db.query(`delete from public.brand_design_templates where source = 'editor'`);
  });
});
