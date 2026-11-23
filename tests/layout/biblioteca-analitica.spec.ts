import { expect, test, type Page } from '@playwright/test';

// Biblioteca y Resultados (antes «Analítica») en un navegador real, sin Supabase (banco de
// tests/layout/biblioteca-analitica.tsx). Regla de la casa: el alto de la página
// es el alto de la pantalla y el scroll vive dentro de la lista; nada se sale por
// la derecha, ni en un móvil de 375 px.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'tablet 768×1024', width: 768, height: 1024 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

const open = (page: Page, view: string) => page.goto(`/biblioteca-analitica.html?vista=${view}`);

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

/** Elementos visibles de la pantalla que se salen por la derecha (salvo dentro de zonas con scroll lateral propio). */
const spilling = (page: Page) =>
  page.evaluate(() => {
    const width = window.innerWidth;
    return [...document.querySelectorAll('main *')]
      .filter((el) => {
        if (el.classList.contains('sr-only')) return false;
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'hidden') return false;
        }
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.right > width + 1;
      })
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`)
      .slice(0, 5);
  });

/** La fila de filtros rápidos: si se desplaza de lado, si enseñaría barra y si algún chip se sale de ella. */
const chipRow = (page: Page) =>
  page.getByTestId('library-chips').evaluate((row) => {
    const box = row.getBoundingClientRect();
    const chips = [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    return {
      scrolls: row.scrollWidth > row.clientWidth + 1,
      // El navegador de las pruebas no pinta barras: se mira el estilo que las quita.
      barHidden:
        getComputedStyle(row).scrollbarWidth === 'none' && getComputedStyle(row, '::-webkit-scrollbar').display === 'none',
      rows: new Set(chips.map((c) => Math.round(c.top))).size,
      outside: chips.filter((c) => c.left < box.left - 1 || c.right > box.right + 1).length,
      beyondPage: chips.filter((c) => c.right > window.innerWidth + 1).length,
    };
  });

// El defecto: entre 800 y 1024 px la fila de filtros no cabía y enseñaba una barra de scroll nativa.
for (const width of [800, 900, 1024, 1180]) {
  test(`biblioteca a ${width} px: los filtros saltan de línea, sin barra de scroll ni desbordar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await open(page, 'biblioteca');
    await expect(page.getByTestId('chip-photos')).toBeVisible();
    const row = await chipRow(page);
    expect(row.scrolls, 'la fila no se desplaza de lado').toBe(false);
    expect(row.outside).toBe(0);
    expect(row.beyondPage).toBe(0);
    expect(row.rows).toBeLessThanOrEqual(2);
    // Todos los filtros se ven y se pueden pulsar sin desplazar nada.
    for (const id of ['chip-photos', 'chip-videos', 'chip-logos', 'chip-cutout', 'chip-ai', 'chip-recent']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    }
    await page.getByTestId('chip-recent').click();
    await expect(page.getByTestId('chip-recent')).toHaveAttribute('aria-pressed', 'true');
    // Y la página sigue sin scroll propio.
    expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
    expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
    expect(await spilling(page)).toEqual([]);
  });
}

test('biblioteca en móvil: los filtros se desplazan con el dedo, sin barra visible ni desbordar la página', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, 'biblioteca');
  await expect(page.getByTestId('chip-photos')).toBeVisible();
  const row = await chipRow(page);
  expect(row.rows).toBe(1);
  expect(row.scrolls).toBe(true);
  expect(row.barHidden, 'la barra de scroll de la fila está oculta').toBe(true);
  expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  // El último filtro se alcanza desplazando la fila.
  await page.getByTestId('chip-recent').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('chip-recent')).toBeInViewport({ ratio: 1 });
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('biblioteca: la página no se desplaza, la rejilla sí, y pinta por tandas', async ({ page }) => {
      await open(page, 'biblioteca');
      await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible();
      await expect(page.getByTestId('library-asset').first()).toBeVisible();
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);

      // 270 archivos y no se pintan todos de golpe.
      const first = await page.getByTestId('library-asset').count();
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(270);
      const scroll = page.getByTestId('library-scroll');
      expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      // Al llegar al final se pintan más.
      await scroll.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect.poll(() => page.getByTestId('library-asset').count()).toBeGreaterThan(first);
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);

      // Los controles se pueden tocar con el dedo.
      for (const id of ['chip-photos', 'chip-videos']) {
        expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(36);
      }
    });

    test('biblioteca: carpetas (barra lateral o selector) con contadores', async ({ page }) => {
      await open(page, 'biblioteca');
      await expect(page.getByTestId('library-asset').first()).toBeVisible();
      if (size.width >= 1024) {
        await expect(page.getByTestId('library-folders')).toBeVisible();
        await expect(page.getByTestId('library-folder-select')).toBeHidden();
        await page.getByTestId('library-folder-Platos / Mariscos').click();
      } else {
        await expect(page.getByTestId('library-folders')).toBeHidden();
        await expect(page.getByTestId('library-folder-select')).toBeVisible();
        await page.getByTestId('library-folder-select').selectOption('Platos / Mariscos');
      }
      await expect(page.getByTestId('library-breadcrumbs')).toContainText('Mariscos');
      const count = await page.getByTestId('library-asset').count();
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(60);
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);
    });

    test('biblioteca: elegir archivos muestra la barra de acciones sin mover la página', async ({ page }) => {
      await open(page, 'biblioteca');
      await page.getByRole('checkbox', { name: /^Elegir / }).first().click();
      await page.getByRole('checkbox', { name: /^Elegir / }).nth(1).click();
      const bar = page.getByTestId('library-selection-bar');
      await expect(bar).toContainText('2 elegidos');
      for (const id of ['bulk-move', 'bulk-tag', 'bulk-download', 'bulk-delete']) await expect(page.getByTestId(id)).toBeVisible();
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);
    });

    test('biblioteca: la ficha abierta cabe y no tapa la lista en pantalla ancha', async ({ page }) => {
      await open(page, 'ficha');
      const panel = page.getByTestId('asset-panel');
      await expect(panel).toBeVisible();
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
      if (size.width >= 1280) {
        // Al lado de la rejilla, no encima.
        const grid = (await page.getByTestId('library-scroll').boundingBox())!;
        expect(grid.x + grid.width).toBeLessThanOrEqual(box.x + 1);
      } else if (size.width < 640) {
        // Móvil: ocupa toda la pantalla.
        expect(box.width).toBeGreaterThanOrEqual(size.width - 1);
      }
      // Dentro hay acciones claras y su cuerpo hace scroll, no la página.
      await expect(panel.getByTestId('asset-use-post')).toBeVisible();
      await expect(panel.getByTestId('asset-usage')).toContainText('Menú de otoño');
      await page.getByTestId('asset-close').click();
      await expect(panel).toHaveCount(0);
    });

    test('resultados: frase, tres cifras, gráfico, las tres mejores y una nota al pie, sin scroll de página', async ({
      page,
    }) => {
      await open(page, 'analitica');
      await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible();
      await expect(page.getByTestId('analytics-sentence')).toContainText('llegaste a');
      await expect(page.getByTestId('analytics-kpis').getByRole('button')).toHaveCount(3);
      await expect(page.getByTestId('analytics-kpis')).not.toContainText('Veces que te han visto');
      await expect(page.getByTestId('analytics-kpis')).not.toContainText(/Provisional|Estimación de Meta|sin comparación/);
      await expect(page.getByTestId('analytics-footnote')).toContainText('Cifras de Meta.');
      await expect(page.getByTestId('analytics-chart')).toBeVisible();
      await expect(page.getByTestId('analytics-top-posts').getByRole('listitem')).toHaveCount(3);
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);
      // El gráfico cabe en su tarjeta.
      const chart = (await page.getByTestId('chart-area').boundingBox())!;
      expect(chart.x + chart.width).toBeLessThanOrEqual(size.width + 1);
      // «Más detalle» está plegado y, al abrirlo, el scroll es interno.
      await expect(page.getByTestId('analytics-comparison')).toBeHidden();
      await page.getByTestId('analytics-more').locator('summary').first().click();
      await expect(page.getByTestId('analytics-comparison')).toBeVisible();
      await expect(page.getByTestId('analytics-more-figures')).toContainText('Veces que te han visto');
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);
    });

    test('resultados con pocos datos: se lee bien y cabe', async ({ page }) => {
      await open(page, 'pocas');
      await expect(page.getByTestId('analytics-sentence')).toContainText('llegaste a 12 personas');
      await expect(page.getByTestId('analytics-kpis').getByRole('button')).toHaveCount(2);
      await expect(page.getByTestId('analytics-top-posts').getByRole('listitem')).toHaveCount(1);
      await expect(page.getByTestId('analytics-footnote')).toBeVisible();
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);
    });

    test('resultados: la guía del gráfico sigue al puntero y dice el valor del día', async ({ page }) => {
      await open(page, 'analitica');
      const hit = page.getByTestId('chart-hit');
      const box = (await hit.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await expect(page.getByTestId('chart-readout')).toContainText(/^\d\d\/\d\d: /);
    });

    test('resultados: sin cifras y sin cuenta lo dicen y caben', async ({ page }) => {
      await open(page, 'sin-cifras');
      await expect(page.getByText(/Todavía no hay cifras de la cuenta/)).toBeVisible();
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);
      await open(page, 'sin-cuenta');
      await expect(page.getByText('Todavía no hay nada que medir')).toBeVisible();
      await expect(page.getByTestId('analytics-connect')).toBeVisible();
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect(await spilling(page)).toEqual([]);
    });
  });
}
