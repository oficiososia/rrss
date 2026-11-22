import { expect, test, type Page } from '@playwright/test';

// «Preparar un plan con IA» en un navegador real, sin Supabase (banco de
// tests/layout/campanas-voz.tsx): que el diálogo quepa en un móvil de 375 px sin
// scroll lateral, con una propuesta de textos largos, y que lo esencial se pueda tocar.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

const overflow = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!;
    const width = window.innerWidth;
    const spilling = [...dialog.querySelectorAll('*')]
      .filter((el) => {
        if (el.classList.contains('sr-only')) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.right > width + 1;
      })
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    return {
      horizontal: document.scrollingElement!.scrollWidth - width,
      dialogScroll: (dialog as HTMLElement).scrollWidth - (dialog as HTMLElement).clientWidth,
      spilling: spilling.slice(0, 5),
    };
  });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('lo esencial arriba, la propuesta y los detalles caben y se pueden tocar', async ({ page }) => {
      await page.goto('/campanas-voz.html');
      await page.getByTestId('campaign-new').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('campaign-instruction')).toBeVisible();
      expect(await overflow(page)).toMatchObject({ horizontal: 0, dialogScroll: 0, spilling: [] });

      await dialog
        .getByTestId('campaign-instruction')
        .fill('Prepárame la campaña del menú de otoño, que dure hasta navidades, sobre todo reels');
      await dialog.getByTestId('campaign-brief-ask').click();
      await expect(dialog.getByTestId('campaign-brief-why')).toContainText('Te propongo 3 semanas');
      expect(await overflow(page)).toMatchObject({ horizontal: 0, dialogScroll: 0, spilling: [] });

      await dialog.getByTestId('campaign-details-toggle').click();
      await expect(dialog.getByTestId('campaign-starts')).toHaveValue('2026-12-07');
      expect(await overflow(page)).toMatchObject({ horizontal: 0, dialogScroll: 0, spilling: [] });

      // Los controles principales se pueden tocar con el dedo.
      for (const id of ['campaign-brief-shorter', 'campaign-brief-longer', 'campaign-details-toggle', 'campaign-submit']) {
        const box = (await dialog.getByTestId(id).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
        expect(box.height).toBeGreaterThanOrEqual(36);
      }
    });
  });
}
