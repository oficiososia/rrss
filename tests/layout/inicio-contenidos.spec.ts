import { expect, test, type Page } from '@playwright/test';

// Inicio de la marca y lista de Contenidos en un navegador real, sin Supabase (banco de
// tests/layout/inicio-contenidos.tsx): sin scroll lateral a 375 px ni en tablet y portátil, con títulos
// larguísimos, miniaturas dibujadas de verdad, accesos que se pueden tocar y la ventana «Nueva idea» entera.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'tablet 768×1024', width: 768, height: 1024 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

const open = (page: Page, query: string) => page.goto(`/inicio-contenidos.html?${query}`);

/** Cuánto se sale la página por la derecha y qué elementos visibles lo provocan. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const width = window.innerWidth;
    const spilling = [...document.querySelectorAll('main *')]
      .filter((el) => {
        if (el.classList.contains('sr-only')) return false;
        // Lo que vive dentro de una zona con su propio scroll lateral (las pestañas) no cuenta.
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'hidden') return false;
        }
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.right > width + 1;
      })
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    return { horizontal: document.scrollingElement!.scrollWidth - width, spilling: spilling.slice(0, 5) };
  });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('inicio: semana, lo parado y lo último publicado, sin scroll lateral', async ({ page }) => {
      await open(page, 'vista=inicio');
      // Crear ya no se repite aquí: está en «＋ Crear» (tests/layout/menu.spec.ts).
      await expect(page.getByTestId('home-tiles')).toHaveCount(0);
      await expect(page.getByTestId('home-day')).toHaveCount(7);
      await expect(page.getByTestId('home-week-piece').first()).toBeVisible();
      await expect(page.getByTestId('home-stalled-item')).toHaveCount(1);
      await expect(page.getByTestId('home-published-figures')).toContainText('personas');
      // Ficha «N de M publicadas» y enlace a Instagram de lo publicado; sin «Tu rol».
      await expect(page.getByTestId('home-week-count')).toContainText(/\d+ de \d+/);
      await expect(page.getByTestId('home-published-link')).toHaveCount(1);
      await expect(page.getByText(/Tu rol/)).toHaveCount(0);
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
      // El arreglo de lo parado también, y el enlace a Instagram se puede tocar con el dedo.
      expect((await page.getByTestId('home-stalled-fix').boundingBox())!.height).toBeGreaterThanOrEqual(40);
      expect((await page.getByTestId('home-published-link').boundingBox())!.height).toBeGreaterThanOrEqual(40);
    });

    test('contenidos: rejilla con miniaturas reales, pestañas con contador y sin scroll lateral', async ({ page }) => {
      await open(page, 'vista=contenidos&largos=1');
      await expect(page.getByTestId('content-list')).toBeVisible();
      await expect(page.getByTestId('content-count-ready')).toBeVisible();
      await page.getByTestId('content-tab-scheduled').click();
      await expect(page.getByTestId('content-card').first()).toBeVisible();
      // Las piezas con diseño se dibujan con el motor del lienzo (no el esquema ni el icono).
      await expect(page.locator('[data-testid="piece-thumb"][data-thumb="image"]').first()).toBeVisible();
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
      for (const id of ['content-new', 'content-search', 'content-format-filter']) {
        expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(40);
      }
    });

    test('contenidos en lista compacta: cabe con títulos largos', async ({ page }) => {
      await open(page, 'vista=contenidos&largos=1&lista=1');
      await expect(page.getByTestId('content-row').first()).toBeVisible();
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
    });

    test('contenidos vacíos: invita a «Nueva idea»', async ({ page }) => {
      await open(page, 'vista=vacia');
      await expect(page.getByTestId('content-empty-new')).toBeVisible();
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
    });

    test('«Nueva idea»: las cuatro tarjetas de formato caben y se elige con un toque', async ({ page }) => {
      await open(page, 'vista=contenidos');
      await page.getByTestId('content-new').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (const format of ['post', 'carousel', 'reel', 'story']) {
        await expect(page.getByTestId(`create-content-format-${format}`)).toBeVisible();
      }
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      await page.getByTestId('create-content-format-reel').click();
      await expect(page.getByTestId('create-content-format-reel').locator('input')).toBeChecked();
      expect((await page.getByTestId('create-content-submit').boundingBox())!.height).toBeGreaterThanOrEqual(40);
    });

    test('«Nueva idea → Reel»: plantillas de la marca con muestra grande y el botón de crear siempre a la vista', async ({
      page,
    }) => {
      await open(page, 'vista=contenidos');
      await page.getByTestId('content-new').click();
      await page.getByTestId('create-content-format-reel').click();
      await page.getByTestId('create-content-from-template').check();
      await expect(page.getByTestId('create-content-reel-template')).toHaveCount(6);
      await expect(page.getByText(/llegará más adelante/)).toHaveCount(0);
      // La muestra del montaje no es una miniatura de 96 px.
      const sample = (await page.getByTestId('reel-template-sample').first().boundingBox())!;
      expect(sample.width).toBeGreaterThanOrEqual(size.width < 500 ? 100 : 120);
      // Aunque la lista sea larga, «Crear y abrir» se ve sin bajar.
      const submit = (await page.getByTestId('create-content-submit').boundingBox())!;
      expect(submit.y + submit.height).toBeLessThanOrEqual(size.height);
      expect(submit.height).toBeGreaterThanOrEqual(40);
      const box = (await page.getByRole('dialog').boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
    });

    test('«Nueva idea → Reel»: la barra de «Cancelar / Crear y abrir» tapa hasta el borde de abajo', async ({
      page,
    }) => {
      await open(page, 'vista=contenidos');
      await page.getByTestId('content-new').click();
      await page.getByTestId('create-content-format-reel').click();
      await page.getByTestId('create-content-from-template').check();
      await expect(page.getByTestId('create-content-reel-template')).toHaveCount(6);
      /** Hueco (px) entre la barra y el borde de abajo de la zona que se desplaza, y qué asoma por él. */
      const gap = () =>
        page.evaluate(() => {
          const bar = document.querySelector('[data-testid="create-content-actions"]')!;
          let area = bar.parentElement!;
          while (getComputedStyle(area).overflowY !== 'auto') area = area.parentElement!;
          const barBox = bar.getBoundingClientRect();
          const bottom = area.getBoundingClientRect().bottom;
          // Lo que se ve en la última fila de píxeles de la zona, a lo ancho.
          const under = [0.2, 0.5, 0.8].map((f) => {
            const el = document.elementFromPoint(barBox.left + barBox.width * f, bottom - 2);
            return el !== null && bar.contains(el);
          });
          return {
            px: Math.round(bottom - barBox.bottom),
            barOnTop: under.every(Boolean),
            scrollable: area.scrollHeight > area.clientHeight + 1,
          };
        });
      const scrollTo = (fraction: number) =>
        page.evaluate((f) => {
          let area = document.querySelector('[data-testid="create-content-actions"]')!.parentElement!;
          while (getComputedStyle(area).overflowY !== 'auto') area = area.parentElement!;
          area.scrollTop = (area.scrollHeight - area.clientHeight) * f;
        }, fraction);
      // Arriba, a media lista y al final: nunca queda una franja por la que asomen las plantillas.
      for (const fraction of [0, 0.5, 1]) {
        await scrollTo(fraction);
        const seen = await gap();
        expect(seen.px, `hueco bajo la barra al ${fraction * 100} %`).toBeLessThanOrEqual(0);
        expect(seen.barOnTop, `la barra tapa el borde al ${fraction * 100} %`).toBe(true);
      }
    });
  });
}

test('en escritorio y tablet el inicio cabe en la pantalla sin bajar la página', async ({ page }) => {
  for (const [width, height] of [
    [1366, 768],
    [1024, 768],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page, 'vista=inicio');
    await expect(page.getByTestId('home-day')).toHaveCount(7);
    await expect(page.getByTestId('home-published-figures')).toBeVisible();
    await expect(page.getByTestId('home-stalled-item')).toBeVisible();
    const extra = await page.evaluate(() => {
      const main = document.getElementById('contenido')!;
      const footer = main.querySelector('footer');
      const bottom = (footer ?? main).getBoundingClientRect().top;
      return Math.round(bottom - window.innerHeight);
    });
    // Lo que importa (todo menos el pie legal) acaba dentro de la ventana.
    expect(extra, `${width}×${height}`).toBeLessThanOrEqual(0);
  }
});
