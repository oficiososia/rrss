import { expect, test, type Locator, type Page } from '@playwright/test';

// El menú de 5 secciones con «＋ Crear» en un navegador real, sin Supabase (bancos de
// tests/layout/calendario.tsx e inicio-contenidos.tsx). A 375, 1024 y 1366 px: el menú se ve, «＋ Crear»
// está al alcance sin bajar, lo que abre cabe en la pantalla y no hay scroll de página.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812, mobile: true },
  { name: 'tablet apaisada 1024×768', width: 1024, height: 768, mobile: false },
  { name: 'portátil 1366×768', width: 1366, height: 768, mobile: false },
];

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

/** Dentro de la ventana, entero, y con tamaño para el dedo. */
async function expectReachable(locator: Locator, size: { width: number; height: number }, minSide = 40) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(minSide);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('calendario: menú visible, «＋ Crear» al alcance y sin scroll de página', async ({ page }) => {
      await page.goto('/calendario.html');
      await expect(page.getByTestId('calendar-page')).toBeVisible();
      await expect(page.getByTestId('calendar-entry').or(page.getByTestId('calendar-month')).first()).toBeVisible();

      const create = page.getByTestId(size.mobile ? 'create-menu-mobile' : 'create-menu');
      if (size.mobile) {
        const nav = page.getByTestId('mobile-nav');
        await expect(nav).toBeVisible();
        await expect(nav.getByRole('link')).toHaveText(['Inicio', 'Contenidos', 'Calendario', 'Biblioteca']);
        await expect(page.locator('#menu-lateral')).toBeHidden();
      } else {
        await expect(page.locator('#menu-lateral')).toBeVisible();
        await expect(page.getByTestId('mobile-nav')).toBeHidden();
        // Cinco secciones (plegadas a iconos en el calendario por debajo de 1440 px, con su nombre).
        await expect(page.locator('#menu-lateral nav a')).toHaveCount(5);
      }
      await expectReachable(create, size);
      // Las vistas Calendario · Campañas caben en la cabecera.
      await expectReachable(page.getByTestId('calendar-tab-campaigns'), size, 36);

      const scroll = await pageScroll(page);
      expect(scroll.vertical).toBeLessThanOrEqual(0);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);

      // Lo que abre «＋ Crear» cabe entero en la pantalla.
      await create.click();
      const items = page.getByTestId('create-menu-items');
      await expect(items).toBeVisible();
      for (const id of ['post', 'carousel', 'reel', 'story', 'upload', 'plan'])
        await expect(page.getByTestId(`create-menu-${id}`)).toBeVisible();
      for (const item of await items.getByRole('menuitem').all()) await expectReachable(item, size);
      await page.keyboard.press('Escape');

      // Y el menú de la cuenta (con los ajustes) también.
      const account = page.getByTestId('user-menu').nth(size.mobile ? 1 : 0);
      await expectReachable(account, size, 32);
      await account.click();
      await expectReachable(page.getByTestId('nav-configuración'), size);
      if (size.mobile) await expectReachable(page.getByRole('menuitem', { name: 'Resultados' }), size);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
    });

    test('inicio: «＋ Crear» se ve sin bajar y abre «Nueva idea» con el formato elegido', async ({ page }) => {
      await page.goto('/inicio-contenidos.html?vista=inicio');
      await expect(page.getByTestId('home-day')).toHaveCount(7);
      const create = page.getByTestId(size.mobile ? 'create-menu-mobile' : 'create-menu');
      await expectReachable(create, size);
      if (!size.mobile) await expect(create).toHaveText('Crear');
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);

      await create.click();
      await page.getByTestId('create-menu-carousel').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // Se abre directamente la galería del carrusel, con «En blanco» la primera.
      await expect(dialog.getByRole('heading', { name: 'Carrusel' })).toBeVisible();
      await expect(page.getByTestId('create-content-blank')).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
    });
  });
}

// La barra inferior del móvil a 360 y 402 px: «Calendario» y «Biblioteca» se tocaban y se leían
// «CalendarioBiblioteca». Cada etiqueta cabe en su botón, separada de la siguiente, y el área
// táctil sigue siendo de al menos 44 px.
for (const width of [360, 402]) {
  test(`barra inferior a ${width} px: cada etiqueta cabe en su botón y no se toca con la de al lado`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/calendario.html');
    const nav = page.getByTestId('mobile-nav');
    await expect(nav).toBeVisible();
    const links = await nav.getByRole('link').all();
    expect(links).toHaveLength(4);
    const labels: { x: number; right: number }[] = [];
    for (const link of links) {
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const label = link.getByTestId('mobile-nav-label');
      const text = (await label.boundingBox())!;
      // Dentro de su botón.
      expect(text.x).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
      // Lo que se pinta no se sale de la caja de la etiqueta (si no cabe, se corta con «…»).
      const overflow = await label.evaluate((el) => el.scrollWidth - el.clientWidth);
      if (overflow > 0) await expect(label).toHaveCSS('text-overflow', 'ellipsis');
      labels.push({ x: text.x, right: text.x + text.width });
    }
    labels.sort((a, b) => a.x - b.x);
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.x - labels[i - 1]!.right).toBeGreaterThanOrEqual(4);
    await expect(nav.getByRole('link', { name: 'Calendario' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Biblioteca' })).toBeVisible();
    const scroll = await pageScroll(page);
    expect(scroll.horizontal).toBeLessThanOrEqual(0);
  });
}
