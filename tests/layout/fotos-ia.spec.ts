import { expect, test, type Page } from '@playwright/test';

// «Editar foto → Fondo → Cambiar con IA» en un navegador real, sin Supabase (banco de tests/layout/fotos-ia.tsx):
// que el resultado se vea en la vista previa con «Antes / Después», que los botones de decidir se puedan
// tocar con el dedo, que nada se salga de 375 px y que «Probar otra vez» deje un segundo intento con su coste.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

const overflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="photo-edit"]')!;
    const width = window.innerWidth;
    const spilling = [...root.querySelectorAll('*')]
      .filter((el) => {
        if (el.classList.contains('sr-only')) return false;
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

    test('el resultado se ve antes de aplicarlo, se compara, se repite y todo cabe y se toca', async ({ page }) => {
      await page.goto('/fotos-ia.html');
      await page.getByTestId('library-asset').first().click();
      await page.getByTestId('asset-edit-photo').click();
      const screen = page.getByTestId('photo-edit');
      await expect(screen.getByTestId('photo-edit-preview')).toBeVisible();
      await screen.getByRole('tab', { name: 'Fondo', exact: true }).click();
      await screen.getByRole('radio', { name: 'Cambiar con IA' }).click();
      const panel = screen.getByTestId('photo-edit-ai-replace_background');
      // La foto ya viene sin fondo: no se vuelve a recortar.
      await expect(panel).toContainText('no se vuelve a recortar');
      await panel.getByTestId('photo-edit-ai-background-idea').first().click();
      expect(await overflow(page)).toMatchObject({ horizontal: 0, spilling: [] });

      await panel.getByTestId('photo-edit-ai-run-replace_background').click();
      const review = screen.getByTestId('photo-edit-ai-review');
      await expect(review).toBeVisible();
      await expect(review.getByTestId('photo-edit-ai-attempt-cost')).toContainText('Este intento ha costado');
      // La foto grande sigue a la vista (la vista previa del resultado) y el resultado no está aplicado aún.
      await expect(screen.getByTestId('photo-edit-ai-preview')).toBeVisible();
      await expect(screen.getByTestId('photo-edit-result')).toHaveCount(0);
      expect(await overflow(page)).toMatchObject({ horizontal: 0, spilling: [] });

      await review.getByTestId('photo-edit-ai-before').click();
      await expect(review.getByTestId('photo-edit-ai-before')).toHaveAttribute('aria-pressed', 'true');
      await review.getByTestId('photo-edit-ai-after').click();
      await expect(review.getByTestId('photo-edit-ai-after')).toHaveAttribute('aria-pressed', 'true');

      // Los botones de decidir se pueden tocar con el dedo.
      for (const id of ['photo-edit-ai-use', 'photo-edit-ai-retry', 'photo-edit-ai-change', 'photo-edit-ai-before']) {
        await review.getByTestId(id).scrollIntoViewIfNeeded();
        const box = (await review.getByTestId(id).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
        expect(box.height).toBeGreaterThanOrEqual(32);
      }

      await review.getByTestId('photo-edit-ai-retry').click();
      await expect(review.getByTestId('photo-edit-ai-attempt-cost')).toContainText('En total llevas');
      await expect(review).toContainText('Intento 2');
      expect(await overflow(page)).toMatchObject({ horizontal: 0, spilling: [] });
    });
  });
}
