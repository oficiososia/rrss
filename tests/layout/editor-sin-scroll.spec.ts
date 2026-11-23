import { expect, test, type Page } from '@playwright/test';

// Regla de la casa: en el editor de piezas el alto de la página es el alto de la
// pantalla; el scroll solo existe dentro de los paneles (cajones, capas, ajustes). Se vigila en los tamaños
// que se usan (escritorio, portátil, tablet y móvil) y con el lienzo entero a la vista.

const SIZES = [
  { name: 'escritorio 1920×1080', width: 1920, height: 1080 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
  { name: 'tablet 1024×768', width: 1024, height: 768 },
  { name: 'móvil 375×812', width: 375, height: 812 },
];

async function openEditor(page: Page, ratio: string, extra = '') {
  await page.goto(`/layout.html?ratio=${ratio}${extra}`);
  await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
}

const noPageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

/** Elementos visibles del panel de ajustes que se salen por la derecha (los textos solo para lector de pantalla no cuentan). */
const spillingRight = (page: Page) =>
  page.getByTestId('side-panel-settings-scroll').evaluate((panel) => {
    const edge = panel.getBoundingClientRect().right + 1;
    return [...panel.querySelectorAll('*')]
      .filter((el) => !el.classList.contains('sr-only') && el.getBoundingClientRect().right > edge)
      .map((el) => `${el.tagName}.${el.className}`.slice(0, 80));
  });

for (const size of SIZES) {
  for (const ratio of ['4:5', '9:16', '16:9']) {
    test(`${size.name}, lienzo ${ratio}: sin scroll de página y lienzo entero a la vista`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openEditor(page, ratio);
      const scroll = await noPageScroll(page);
      expect(scroll.vertical).toBeLessThanOrEqual(0);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);
      // El pie legal no aparece dentro del editor.
      await expect(page.getByTestId('legal-footer')).toHaveCount(0);
      // El lienzo cabe entero dentro de su marco y de la ventana.
      const stage = (await page.getByTestId('editor-stage').boundingBox())!;
      const area = (await page.getByTestId('editor-canvas-area').boundingBox())!;
      expect(stage.x).toBeGreaterThanOrEqual(area.x - 1);
      expect(stage.y).toBeGreaterThanOrEqual(area.y - 1);
      expect(stage.x + stage.width).toBeLessThanOrEqual(area.x + area.width + 1);
      expect(stage.y + stage.height).toBeLessThanOrEqual(area.y + area.height + 1);
      expect(stage.y + stage.height).toBeLessThanOrEqual(size.height);
      // En móvil el lienzo ocupa el ancho disponible (no una miniatura).
      if (size.width < 500) expect(stage.width).toBeGreaterThan(size.width * 0.5);
    });
  }
}

test('con muchas capas y varias páginas, solo hace scroll el panel', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openEditor(page, '4:5', '&pages=4&format=carousel');
  expect((await noPageScroll(page)).vertical).toBeLessThanOrEqual(0);
  await page.getByTestId('editor-layers').click();
  await expect(page.getByTestId('side-panel-layers')).toBeVisible();
  expect((await noPageScroll(page)).vertical).toBeLessThanOrEqual(0);
});

test('en móvil las capas son una hoja que se abre y se cierra, sin mover la página ni encoger el lienzo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openEditor(page, '9:16');
  const panel = page.getByTestId('side-panel-layers');
  await expect(panel).toHaveCount(0);
  const before = (await page.getByTestId('editor-stage').boundingBox())!;
  await page.getByTestId('editor-layers').click();
  await expect(panel).toBeVisible();
  expect((await noPageScroll(page)).vertical).toBeLessThanOrEqual(0);
  // El lienzo sigue entero con la hoja abierta, y con un tamaño útil (no al 2 %).
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  const sheet = (await panel.boundingBox())!;
  expect(stage.y + stage.height).toBeLessThanOrEqual(sheet.y + 1);
  expect(stage.height).toBeGreaterThan(120);
  await page.getByTestId('side-close').click();
  await expect(panel).toHaveCount(0);
  // Al cerrarla vuelve a su tamaño, solo.
  await expect
    .poll(async () => Math.round((await page.getByTestId('editor-stage').boundingBox())!.width))
    .toBe(Math.round(before.width));
  // Y otra vez: abrir y cerrar no lo va encogiendo.
  await page.getByTestId('editor-layers').click();
  await page.getByTestId('side-close').click();
  await expect
    .poll(async () => Math.round((await page.getByTestId('editor-stage').boundingBox())!.width))
    .toBe(Math.round(before.width));
});

test('el zoom acerca el lienzo y «ajustar» lo devuelve entero', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openEditor(page, '4:5');
  const before = (await page.getByTestId('editor-stage').boundingBox())!;
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  const zoomed = (await page.getByTestId('editor-stage').boundingBox())!;
  expect(zoomed.width).toBeGreaterThan(before.width * 1.4);
  expect((await noPageScroll(page)).vertical).toBeLessThanOrEqual(0);
  await page.getByTestId('zoom-fit').click();
  const fit = (await page.getByTestId('editor-stage').boundingBox())!;
  expect(Math.abs(fit.width - before.width)).toBeLessThan(2);
});

test('el menú lateral se pliega con el botón y con Ctrl+B', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openEditor(page, '4:5');
  const shell = page.getByTestId('app-shell');
  await expect(shell).toHaveAttribute('data-sidebar', 'expanded');
  await page.getByTestId('sidebar-toggle').click();
  await expect(shell).toHaveAttribute('data-sidebar', 'collapsed');
  await page.keyboard.press('Control+b');
  await expect(shell).toHaveAttribute('data-sidebar', 'expanded');
});

test('en un portátil estrecho el editor pliega el menú solo, sin perder la preferencia', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openEditor(page, '4:5');
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
  const stored = await page.evaluate(() => window.localStorage.getItem('rrss.sidebar.collapsed'));
  expect(stored).toBeNull();
});

for (const size of [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
]) {
  test(`${size.name}: con una capa elegida, la barra flotante cabe entera y sus ajustes no se salen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await openEditor(page, '4:5');
    await page.getByTestId('editor-layers').click();
    await page.getByTestId('layer-item').first().click();
    const bar = page.getByTestId('selection-toolbar');
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    for (const button of await bar.getByRole('button').all()) {
      const b = (await button.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(b.width).toBeGreaterThanOrEqual(36);
    }
    // Los ajustes finos, en un panel que se abre desde «⋯».
    await page.getByTestId('bar-more').click();
    await page.getByTestId('menu-more-options').click();
    await expect(page.getByTestId('side-panel-settings')).toBeVisible();
    expect(await spillingRight(page)).toEqual([]);
    // Una sección plegada se abre con un toque y deja el panel sin scroll lateral.
    await page.getByTestId('section-summary').first().click();
    expect(await spillingRight(page)).toEqual([]);
    expect((await noPageScroll(page)).vertical).toBeLessThanOrEqual(0);
    expect((await noPageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  });
}
