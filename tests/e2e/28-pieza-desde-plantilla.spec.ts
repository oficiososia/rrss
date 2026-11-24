import { expect, test } from '@playwright/test';
import { abrir, dato, sinErrores, sql, abrirCompartir, nuevaIdea } from './apoyo';

// Crear una pieza a partir de una plantilla de la marca, de extremo a extremo
// contra el Supabase LOCAL. Las plantillas las entrega la agencia (no hay
// pantalla para crearlas), así que aquí se siembran por SQL en La Espiga
// Obrador, como lo haría `deliver_design_templates`.
//
// Ana abre «Nueva idea», marca «Empezar desde una plantilla», ve la plantilla con
// su análisis, la elige y crea la pieza: nace con el documento de la plantilla
// en la versión 1. La plantilla es de las antiguas (documento v3, con la foto
// como una forma llamada «Foto (sustituir)» y la indicación en el pie): al
// leerla, el marcador pasa a ser un marco de foto vacío y el pie, un pie de
// ejemplo que no se publica.

test.describe.configure({ mode: 'serial' });

const marca = () => `/o/${dato('orgA')}/m/${dato('marcaA2')}`;
const TITULO = 'Pan del día desde plantilla';

const DOCUMENTO = {
  schemaVersion: 3,
  canvas: { aspectRatio: '4:5', width: 1080, height: 1350, backgroundColor: '#1F1B16' },
  layers: [
    {
      id: 'marcador-foto',
      name: 'Foto (sustituir)',
      type: 'shape',
      x: 0,
      y: 0,
      width: 1080,
      height: 1350,
      shape: 'rectangle',
      fill: '#3A332B',
    },
    {
      id: 'titular',
      name: 'Titular',
      type: 'text',
      x: 80,
      y: 1000,
      width: 920,
      height: 200,
      text: 'Titular de la publicación',
      fontFamily: 'sans-serif',
      fontSize: 84,
      fontWeight: 700,
      color: '#FFFFFF',
      align: 'left',
    },
  ],
  copy: { caption: 'Hoy sale del horno: …', hashtags: ['panartesano'], mentions: [], altText: '' },
};

const ANALISIS = {
  summary: 'Titular grande sobre una foto a sangre.',
  layers: [{ role: 'photo', position: 'toda la página', description: '' }],
  typography: [],
  colors: [{ hex: '#1F1B16', role: 'background', note: '' }],
  logo: { position: 'none' },
  photo: { type: 'pan recién hecho', treatment: '' },
  tone: { description: 'Cercano', samples: [] },
  recurrence: { count: 9, reviewed: 30 },
  examples: [
    { permalink: 'https://www.instagram.com/p/ejemplo-a/' },
    { permalink: 'https://www.instagram.com/p/ejemplo-b/' },
  ],
};

test('Ana crea una pieza desde una plantilla de la marca y nace con su documento', async ({ browser }) => {
  await sql(
    `insert into public.brand_design_templates (brand_id, organization_id, template_key, name, network, format, document, analysis, source)
     select b.id, b.organization_id, 'titular-sobre-foto-e2e', 'Titular sobre foto', 'instagram', 'post', $2::jsonb, $3::jsonb, 'manual'
     from public.brands b where b.id = $1
     on conflict (brand_id, template_key) do update set document = excluded.document, analysis = excluded.analysis`,
    [dato('marcaA2'), JSON.stringify(DOCUMENTO), JSON.stringify(ANALISIS)],
  );

  const s = await abrir(browser, 'ana');
  const { page } = s;
  await page.goto(`${marca()}/contenidos`);
  await nuevaIdea(page);
  const dialogo = page.getByRole('dialog');
  await dialogo.getByTestId('create-content-title').fill(TITULO);
  await dialogo.getByTestId('create-content-from-template').check();

  const opcion = dialogo.getByTestId('template-option').filter({ hasText: 'Titular sobre foto' });
  await expect(opcion).toBeVisible();
  await expect(opcion).toContainText('Instagram · Publicación');
  await expect(opcion).toContainText('Titular grande sobre una foto a sangre.');
  await opcion.click();
  await expect(dialogo.getByTestId('create-content-format-post').locator('input')).toBeDisabled();
  await dialogo.getByTestId('create-content-submit').click();

  await expect(page.getByTestId('editor-title')).toHaveText(TITULO);
  const id = /\/contenidos\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`No se ve el id de la pieza en ${page.url()}`);

  const versiones = await sql<{
    version: number;
    change_note: string;
    capas: string[];
    pie: string;
    ejemplo: string;
    foto: { type: string; frame: boolean; source: { kind: string }; name: string };
  }>(
    `select version, change_note,
            array(select l ->> 'id' from jsonb_array_elements(data #> '{pages,0,layers}') l) as capas,
            data #>> '{copy,caption}' as pie,
            data #>> '{copy,captionHint}' as ejemplo,
            data #> '{pages,0,layers,0}' as foto
     from public.content_versions where content_id = $1 order by version`,
    [id],
  );
  expect(versiones).toHaveLength(1);
  expect(versiones[0]).toMatchObject({
    version: 1,
    capas: ['marcador-foto', 'titular'],
    // El pie de la plantilla no es el texto de la pieza: llega como ejemplo y el pie, vacío.
    pie: '',
    ejemplo: 'Hoy sale del horno: …',
    // El marcador es ya un marco de foto vacío.
    foto: { type: 'image', frame: true, source: { kind: 'empty' }, name: 'Foto' },
  });
  expect(versiones[0]?.change_note).toContain('Titular sobre foto');

  // En el editor: falta una foto (se dice arriba) y el pie de ejemplo se ve en gris, sin ser el pie.
  await expect(page.getByTestId('editor-empty-frames')).toHaveText('Falta 1 foto');
  await abrirCompartir(page);
  await expect(page.getByTestId('copy-caption')).toHaveValue('');
  await expect(page.getByTestId('copy-caption')).toHaveAttribute('placeholder', 'Hoy sale del horno: …');

  sinErrores(s);
  await s.context.close();
});
