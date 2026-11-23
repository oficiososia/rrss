import { expect, test, type Page } from '@playwright/test';

// El copiloto del editor no tapa el lienzo: con su panel abierto, la pieza sigue
// a la vista (columna estrecha junto al lienzo en escritorio, hoja baja en
// móvil), sin scroll de página, y el aviso del micrófono no sale hasta pulsarlo.
// Banco de tests/layout/entry.tsx (la aplicación real con el Supabase simulado).

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'tablet 1024×768', width: 1024, height: 768 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

/** El lienzo cabe en la ventana, no lo pisa el panel del copiloto y sigue teniendo un tamaño útil. */
async function expectCanvasVisible(page: Page, size: { width: number; height: number }) {
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  const panel = (await page.getByTestId('copilot-panel').boundingBox())!;
  expect(stage.x).toBeGreaterThanOrEqual(-1);
  expect(stage.y).toBeGreaterThanOrEqual(-1);
  expect(stage.x + stage.width).toBeLessThanOrEqual(size.width + 1);
  expect(stage.y + stage.height).toBeLessThanOrEqual(size.height + 1);
  const overlapX = Math.min(stage.x + stage.width, panel.x + panel.width) - Math.max(stage.x, panel.x);
  const overlapY = Math.min(stage.y + stage.height, panel.y + panel.height) - Math.max(stage.y, panel.y);
  expect(overlapX <= 1 || overlapY <= 1, 'el panel del copiloto pisa el lienzo').toBe(true);
  expect(Math.min(stage.width, stage.height)).toBeGreaterThan(120);
  const scroll = await pageScroll(page);
  expect(scroll.vertical).toBeLessThanOrEqual(0);
  expect(scroll.horizontal).toBeLessThanOrEqual(0);
}

for (const size of SIZES) {
  test(`${size.name}: con el copiloto abierto el lienzo sigue visible y la página no hace scroll`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/layout.html?ratio=4:5');
    await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');

    await page.getByTestId('copilot-open').click();
    await expect(page.getByTestId('copilot-panel')).toBeVisible();
    // Para escribir no hace falta el aviso del micrófono: no sale al abrir.
    await expect(page.getByTestId('copilot-voice-notice')).toHaveCount(0);
    await expect(page.getByTestId('copilot-text-input')).toBeVisible();
    await expectCanvasVisible(page, size);

    // Varias órdenes (resueltas en el navegador, sin IA): el historial queda plegado y el lienzo, a la vista.
    for (const order of ['siguiente página', 'deshaz', 'rehaz']) {
      await page.getByTestId('copilot-text-input').fill(order);
      await page.getByTestId('copilot-text-input').press('Enter');
      await expect(page.getByTestId('copilot-order').first()).toContainText(order);
    }
    await expect(page.getByTestId('copilot-history')).toBeVisible();
    await expect(page.getByTestId('copilot-history')).not.toHaveAttribute('open', '');
    await expectCanvasVisible(page, size);

    // Al cerrarlo, el lienzo recupera su sitio.
    await page.getByTestId('copilot-close').click();
    await expect(page.getByTestId('copilot-panel')).toHaveCount(0);
    await expect(page.getByTestId('editor-stage')).toBeVisible();
  });
}
