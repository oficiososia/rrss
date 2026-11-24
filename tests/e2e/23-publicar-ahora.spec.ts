import { expect, test } from '@playwright/test';
import { abrir, accionDelMenu, aviso, dato, sinErrores, sql, abrirCompartir, guardarVersion, nuevaIdea } from './apoyo';

// «Publicar ahora» de extremo a extremo, contra el Supabase LOCAL y la Graph API
// de Meta SIMULADA (supabase/functions/_shared/social/local-test.ts, activada
// en supabase/functions/e2e.env), igual que 13-publicacion-calendario.spec.ts.
//
// Ana aprueba una pieza SIN exportarla, pulsa «Publicar ahora» en el editor, el
// navegador exporta el JPEG de la versión en el mismo paso, la función
// `social-publish/now` la procesa al momento (sin esperar al minuto del reloj ni
// tocar la hora en la base de datos) y la ficha enseña «Publicada» con su enlace.
//
// Parte de lo que dejaron los archivos anteriores: la cuenta de Instagram
// simulada conectada a La Espiga Obrador (13-publicacion-calendario.spec.ts).

test.describe.configure({ mode: 'serial' });

const marca = () => `/o/${dato('orgA')}/m/${dato('marcaA2')}`;
const TITULO = 'Pan de centeno, ya';

test('una pieza aprobada se exporta y se publica al momento desde el editor', async ({ browser }) => {
  const s = await abrir(browser, 'ana');
  const { page } = s;

  await page.goto(`${marca()}/contenidos`);
  await nuevaIdea(page);
  await page.getByTestId('create-content-title').fill(TITULO);
  await page.getByTestId('create-content-format-post').click();
  await page.getByTestId('create-content-submit').click();
  await expect(page.getByTestId('editor-title')).toHaveText(TITULO);
  const id = /\/contenidos\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`No se ve el id de la pieza en ${page.url()}`);
  await abrirCompartir(page);
  await page.getByTestId('copy-caption').fill('El pan de centeno acaba de salir del horno.');
  await guardarVersion(page);
  await aviso(page, 'Versión 1 guardada');
  // Autogestión: sin «Aprobar» a la vista; «Publicar ahora» de «Compartir» la aprueba por debajo.

  // Sin exportación todavía: el propio paso la ofrece.
  const [antes] = await sql<{ n: number }>(
    `select count(*)::int as n from public.media_assets where provenance->>'content_id' = $1`,
    [id],
  );
  expect(antes).toEqual({ n: 0 });

  await accionDelMenu(page, 'editor-share', 'editor-publish-now');
  await expect(page.getByTestId('publish-now-warning')).toContainText(
    'Se publicará ahora en @cuenta_simulada. No se puede deshacer desde aquí.',
  );
  await expect(page.getByTestId('publish-now-export-note')).toBeVisible();
  await page.getByTestId('publish-now-confirm').click();

  await expect(page.getByTestId('publish-now-done')).toHaveText('Publicada', { timeout: 60_000 });
  const [fila] = await sql<{ status: string; external_id: string; external_url: string; scheduled_at: Date }>(
    `select status::text, external_id, external_url, scheduled_at from public.scheduled_publications where content_id = $1`,
    [id],
  );
  expect(fila!.status).toBe('published');
  expect(fila!.external_url).toBe(`https://instagram.simulado.invalid/p/${fila!.external_id}/`);
  await expect(page.getByTestId('publish-now-link')).toHaveAttribute('href', fila!.external_url);

  // Se exportó una sola imagen, de esta versión, y salió un solo intento publicado.
  const [exportaciones] = await sql<{ n: number }>(
    `select count(*)::int as n from public.media_assets
     where provenance->>'type' = 'export' and provenance->>'content_id' = $1 and (provenance->>'version')::int = 1`,
    [id],
  );
  expect(exportaciones).toEqual({ n: 1 });
  const [intentos] = await sql<{ n: number }>(
    `select count(*)::int as n from public.publication_attempts a join public.scheduled_publications p on p.id = a.publication_id
     where p.content_id = $1 and a.outcome in ('published', 'recovered')`,
    [id],
  );
  expect(intentos).toEqual({ n: 1 });

  // El calendario la enseña publicada, con su enlace.
  await page.getByTestId('publish-now-close').click();
  await page.addInitScript(`window.localStorage.setItem('rrss.calendar.view', '"agenda"')`);
  await page.goto(`${marca()}/calendario`);
  const chip = page.getByTestId('calendar-entry').filter({ hasText: TITULO });
  await expect(chip).toHaveAttribute('data-state', 'published');
  await chip.click();
  // Lo ya publicado no pasa por la vista rápida: abre su ficha directamente (CalendarPage, `onOpen`).
  await expect(page.getByTestId('publication-dialog')).toBeVisible();
  await expect(page.getByTestId('publication-published-link')).toHaveAttribute('href', fila!.external_url);

  // Repetir «ahora» sobre lo publicado no publica otra vez (la ficha ya no ofrece el botón).
  await expect(page.getByTestId('publication-publish-now')).toHaveCount(0);
  sinErrores(s);
  await s.context.close();
});
