import { expect, test } from '@playwright/test';
import { abrir, aviso, dato, sinErrores, sql } from './apoyo';

// Carrusel de varias páginas de extremo a extremo, contra el Supabase LOCAL y la
// Graph API de Meta SIMULADA (supabase/functions/_shared/social/local-test.ts),
// como 23-publicar-ahora.spec.ts.
//
// Ana crea un carrusel (empieza con 2 páginas), añade una tercera, pone algo
// distinto en cada una, guarda UNA versión, exporta el carrusel (una imagen
// JPEG por página, con su número en la procedencia), lo aprueba y pulsa
// «Publicar ahora». Se comprueba que la publicación lleva las exportaciones en
// el orden de las páginas y que Instagram (simulado) recibió los hijos del
// carrusel en ese orden: importando lo publicado, la simulada devuelve como
// dirección de cada hijo la que se le envió al crearlo.
//
// Parte de lo que dejaron los archivos anteriores: la cuenta de Instagram
// simulada conectada a La Espiga Obrador (13-publicacion-calendario.spec.ts).

test.describe.configure({ mode: 'serial' });

const marca = () => `/o/${dato('orgA')}/m/${dato('marcaA2')}`;
const TITULO = 'Tres panes de otoño';

test('un carrusel de 3 páginas se exporta, se aprueba y se publica con sus hijos en orden', async ({ browser }) => {
  const s = await abrir(browser, 'ana');
  const { page } = s;

  await page.goto(`${marca()}/contenidos`);
  await page.getByTestId('content-new').click();
  await page.getByTestId('create-content-title').fill(TITULO);
  await page.getByTestId('create-content-network').selectOption('instagram');
  await page.getByTestId('create-content-format').selectOption('carousel');
  await page.getByTestId('create-content-submit').click();
  await expect(page.getByTestId('editor-title')).toHaveText(TITULO);
  const id = /\/contenidos\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`No se ve el id de la pieza en ${page.url()}`);

  // Un carrusel empieza con las 2 páginas mínimas; se añade una tercera.
  const thumbs = page.getByTestId('page-thumb');
  await expect(thumbs).toHaveCount(2);
  await page.getByTestId('add-rectangle').click();
  await thumbs.nth(1).click();
  await page.getByTestId('add-ellipse').click();
  await page.getByTestId('page-add').click();
  await expect(thumbs).toHaveCount(3);
  await expect(thumbs.nth(2)).toHaveAttribute('aria-current', 'true');
  await page.getByTestId('add-text').click();

  await page.getByRole('tab', { name: 'Publicación' }).click();
  await page.getByTestId('copy-caption').fill('Tres panes para el otoño: desliza y elige.');
  await page.getByTestId('editor-save').click();
  await page.getByTestId('save-confirm').click();
  await aviso(page, 'Versión 1 guardada');

  // UNA versión con las 3 páginas, cada una con su capa.
  const [version] = await sql<{ paginas: number; capas: string }>(
    `select jsonb_array_length(data->'pages') as paginas,
            (select string_agg(p->'layers'->0->>'type', ',' order by o) from jsonb_array_elements(data->'pages')
               with ordinality x(p, o)) as capas
     from public.content_versions where content_id = $1 and version = 1`,
    [id],
  );
  expect(version).toEqual({ paginas: 3, capas: 'shape,shape,text' });

  // Exportar el carrusel: tres JPEG, uno por página, guardados en la biblioteca.
  await page.getByTestId('editor-export').click();
  await expect(page.getByTestId('export-pages-notice')).toContainText('3 páginas');
  await page.getByTestId('export-download').uncheck();
  await page.getByTestId('export-confirm').click();
  await expect(page.getByTestId('export-done')).toContainText('3 imágenes', { timeout: 60_000 });
  await page.getByTestId('export-close').click();
  const exportaciones = await sql<{ id: string; pagina: number; total: number; mime: string }>(
    `select id, (provenance->>'page')::int as pagina, (provenance->>'page_count')::int as total, mime_type as mime
     from public.media_assets
     where provenance->>'type' = 'export' and provenance->>'content_id' = $1 and (provenance->>'version')::int = 1
     order by pagina`,
    [id],
  );
  expect(exportaciones.map((e) => [e.pagina, e.total, e.mime])).toEqual([
    [1, 3, 'image/jpeg'],
    [2, 3, 'image/jpeg'],
    [3, 3, 'image/jpeg'],
  ]);

  await page.getByTestId('status-approved').click();
  await aviso(page, 'Aprobada');

  await page.getByTestId('editor-publish-now').click();
  await expect(page.getByTestId('publish-now-pages')).toContainText('3 imágenes, en el orden de las páginas');
  await page.getByTestId('publish-now-confirm').click();
  await expect(page.getByTestId('publish-now-done')).toHaveText('Publicada', { timeout: 90_000 });

  // La publicación lleva las exportaciones en el orden de las páginas.
  const [fila] = await sql<{ status: string; format: string; external_id: string; ids: string[] }>(
    `select status::text, format, external_id, media_asset_ids::text[] as ids
     from public.scheduled_publications where content_id = $1`,
    [id],
  );
  expect(fila!.status).toBe('published');
  expect(fila!.format).toBe('carousel');
  expect(fila!.ids).toEqual(exportaciones.map((e) => e.id));
  await page.getByTestId('publish-now-close').click();

  // Instagram (simulado) recibió los hijos en ese orden: se importa lo publicado
  // (sin copiar imágenes) y se mira la dirección de cada hijo.
  await page.goto(`${marca()}/marca`);
  await page.getByRole('tab', { name: 'Datos de la marca' }).click();
  const panel = page.getByTestId('social-accounts').getByTestId('social-import');
  await panel.getByTestId('social-import-copy').uncheck();
  await panel.getByTestId('social-import-start').click();
  await expect(panel.getByTestId('social-import-done')).toBeVisible({ timeout: 120_000 });
  const [importada] = await sql<{ media_type: string; hijos: string[] }>(
    `select media_type, array(select c->>'media_url' from jsonb_array_elements(children) with ordinality x(c, o)
                              order by o) as hijos
     from public.social_imported_media where brand_id = $1 and external_id = $2`,
    [dato('marcaA2'), fila!.external_id],
  );
  expect(importada!.media_type).toBe('CAROUSEL_ALBUM');
  const rutas = await sql<{ storage_path: string }>(
    `select a.storage_path from unnest($1::uuid[]) with ordinality u(id, o) join public.media_assets a on a.id = u.id
     order by u.o`,
    [fila!.ids],
  );
  expect(importada!.hijos).toHaveLength(3);
  importada!.hijos.forEach((url, i) => {
    // La dirección firmada lleva el nombre del objeto de su página.
    const archivo = rutas[i]!.storage_path.split('/').pop()!;
    expect(decodeURIComponent(url)).toContain(archivo);
  });

  sinErrores(s);
  await s.context.close();
});
