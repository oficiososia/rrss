import { expect, test, type Page } from '@playwright/test';

// Regla de la casa: en el editor de piezas el alto de la página es el alto de la
// pantalla; el scroll solo existe dentro de los paneles. Se vigila en los tamaños
// que se usan (escritorio, portátil, tablet y móvil) y con el lienzo entero a la vista.

const SIZES = [
  { name: 'escritorio 1920×1080', width: 1920, height: 1080 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
  { name: 'tablet 1024×768', width: 1024, height: 768 },
  { name: 'móvil 375×812', width: 375, height: 812 },
];

async function openEditor(page: Page, ratio: string, extra = '') {
  await page.goto(`/layout.html?ratio=${ratio}${extra}`);
  await expect(page.getByTestId('editor-stage')).toBeVisible();
}

const noPageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

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
  await page.getByRole('tab', { name: /Capas/ }).click();
  expect((await noPageScroll(page)).vertical).toBeLessThanOrEqual(0);
});

test('en móvil los paneles son una hoja que se abre y se cierra, sin mover la página', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openEditor(page, '9:16');
  const panel = page.getByTestId('editor-panel-scroll');
  await expect(panel).toBeHidden();
  await page.getByRole('tab', { name: /Capas/ }).click();
  await expect(panel).toBeVisible();
  expect((await noPageScroll(page)).vertical).toBeLessThanOrEqual(0);
  // El lienzo sigue entero con la hoja abierta.
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  const sheet = (await page.getByTestId('editor-panels').boundingBox())!;
  expect(stage.y + stage.height).toBeLessThanOrEqual(sheet.y + 1);
  await page.getByTestId('editor-panels-close').click();
  await expect(panel).toBeHidden();
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
