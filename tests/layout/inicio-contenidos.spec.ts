import { expect, test, type Page } from '@playwright/test';

// Inicio de la marca y lista de Contenidos en un navegador real, sin Supabase (banco de
// tests/layout/inicio-contenidos.tsx): sin scroll lateral a 375 px ni en tablet y portátil, con títulos
// larguísimos, miniaturas dibujadas de verdad, accesos que se pueden tocar y «¿Qué quieres crear?» entera.

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
  /** Un formato desde «＋ Crear» del menú (la cabecera de Contenidos no lo repite): abre su galería. */
  async function createFrom(page: Page, width: number, format: string) {
    await page.getByTestId(width < 1024 ? 'create-menu-mobile' : 'create-menu').click();
    await page.getByTestId(`create-menu-${format}`).click();
  }

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

    test('contenidos: miniaturas reales (lista en el móvil), tres pestañas con contador y sin scroll lateral', async ({ page }) => {
      await open(page, 'vista=contenidos&largos=1');
      await expect(page.getByTestId('content-list')).toBeVisible();
      await expect(page.getByRole('tab')).toHaveCount(3);
      await expect(page.getByTestId('content-count-active')).toBeVisible();
      await page.getByTestId('content-tab-scheduled').click();
      // En el móvil, lista; en lo demás, rejilla. Sin botón para cambiarlo.
      await expect(page.getByTestId(size.width < 640 ? 'content-row' : 'content-card').first()).toBeVisible();
      await expect(page.getByTestId('content-view-list')).toHaveCount(0);
      // Las piezas con diseño se dibujan con el motor del lienzo (no el esquema ni el icono).
      await expect(page.locator('[data-testid="piece-thumb"][data-thumb="image"]').first()).toBeVisible();
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
      for (const id of ['content-search', 'content-format-all', 'content-format-story']) {
        expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(40);
      }
    });

    test('contenidos vacíos: invita a «Nueva idea»', async ({ page }) => {
      await open(page, 'vista=vacia');
      await expect(page.getByTestId('content-empty-new')).toBeVisible();
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
    });

    test('«¿Qué quieres crear?»: los formatos caben, se tocan con el dedo y abren su galería', async ({ page }) => {
      await open(page, 'vista=vacia');
      await page.getByTestId('content-empty-new').click();
      const dialog = page.getByRole('dialog', { name: '¿Qué quieres crear?' });
      await expect(dialog).toBeVisible();
      for (const format of ['reel', 'post', 'carousel', 'story']) {
        const tile = page.getByTestId(`create-content-format-${format}`);
        await expect(tile).toBeVisible();
        expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      }
      // «Subir fotos» solo en el móvil (en el ordenador está en la Biblioteca).
      await expect(page.getByTestId('create-content-upload')).toBeVisible({ visible: size.width < 640 });
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      await page.getByTestId('create-content-format-post').click();
      await expect(page.getByRole('dialog', { name: 'Publicación' })).toBeVisible();
      await expect(page.getByTestId('create-content-blank')).toBeVisible();
      await expect(page.getByTestId('create-content-submit')).toHaveCount(0);
    });

    test('«Crear → Reel»: «En blanco» y las plantillas de reel de la marca, con muestra grande', async ({ page }) => {
      await open(page, 'vista=contenidos');
      await createFrom(page, size.width, 'reel');
      await expect(page.getByTestId('create-content-blank')).toBeVisible();
      await expect(page.getByTestId('create-content-reel-template')).toHaveCount(6);
      await expect(page.getByText(/llegará más adelante/)).toHaveCount(0);
      // La muestra del montaje no es una miniatura de 96 px.
      const sample = (await page.getByTestId('reel-template-sample').first().boundingBox())!;
      expect(sample.width).toBeGreaterThanOrEqual(size.width < 500 ? 100 : 120);
      const box = (await page.getByRole('dialog').boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
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
