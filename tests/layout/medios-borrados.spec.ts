import { expect, test, type Page } from '@playwright/test';

// Un reel con una foto borrada de la biblioteca (banco tests/layout/reel-editor.tsx con
// ?borrada=1), en un navegador real a 375 y 1366 px: el aviso de una línea y la marca de la
// vista previa se ven sin desplazar la página, y en el selector de material «Subir» está a la
// vista sin scroll lateral.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

const inside = async (page: Page, testId: string, size: { width: number; height: number }) => {
  const box = (await page.getByTestId(testId).first().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height + 0.5);
};

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/reel-editor.html?clips=6&borrada=1');
      await expect(page.getByTestId('reel-editor')).toBeVisible();
    });

    test('el aviso y la marca de la vista previa se ven, sin scroll de página', async ({ page }) => {
      const notice = page.getByTestId('reel-missing-notice');
      await expect(notice).toHaveText(
        /1 foto de este reel se ha borrado de la biblioteca\. Sustitúyela para poder montarlo\./,
      );
      await inside(page, 'reel-missing-notice', size);
      await expect(page.getByTestId('reel-preview-missing')).toContainText('Falta esta foto');
      await inside(page, 'reel-missing-replace', size);
      await inside(page, 'reel-missing-remove', size);
      await expect(page.getByTestId('reel-clip').first()).toHaveAttribute('data-missing', 'true');
      const scroll = await pageScroll(page);
      expect(scroll.vertical).toBeLessThanOrEqual(0);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);
    });

    test('«Sustituir» abre la biblioteca con «Subir» a la vista y sin scroll lateral', async ({ page }) => {
      await page.getByTestId('reel-missing-replace').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Sustituir por otra foto o clip');
      await expect(dialog.getByTestId('picker-upload')).toBeVisible();
      await inside(page, 'picker-upload', size);
      // Ninguna zona del diálogo que se pueda desplazar lo hace de lado (lo truncado con «…» no cuenta).
      const overflow = await dialog.evaluate((node) => {
        const all = [node as HTMLElement, ...Array.from(node.querySelectorAll<HTMLElement>('*'))];
        const scrollable = all.filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX));
        return Math.max(0, ...scrollable.map((el) => el.scrollWidth - el.clientWidth));
      });
      expect(overflow).toBeLessThanOrEqual(1);
      await inside(page, 'picker-dropzone', size);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
    });
  });
}
