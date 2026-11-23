import { expect, test, type Page } from '@playwright/test';

// Integraciones en un navegador real, sin Supabase (banco tests/layout/integraciones.tsx). A 375 y
// 1366 px: la lista tiene como mucho 11 controles a la vista, no hay scroll lateral, y la hoja de un
// servicio (con «Opciones avanzadas» abierto) cabe a lo ancho.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

/** Controles visibles: lo que se puede tocar o enfocar. */
const visibleControls = (page: Page) =>
  page.evaluate(() => {
    const all = document.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"]',
    );
    // Lo de dentro de un <details> cerrado no se ve (Chrome lo deja con caja, pero oculto).
    const folded = (el: HTMLElement) => {
      const details = el.closest('details');
      return Boolean(details && !details.open && el.tagName !== 'SUMMARY' && el.closest('summary') === null);
    };
    return [...all]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && el.checkVisibility({ visibilityProperty: true }) && !folded(el);
      })
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}»`,
      );
  });

const horizontalScroll = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    for (const mode of ['agency', 'self'] as const) {
      test(`lista (${mode === 'self' ? 'uso interno' : 'con agencia'}): una fila por función, ≤ 11 controles y sin scroll lateral`, async ({
        page,
      }) => {
        await page.goto(`/integraciones.html${mode === 'self' ? '?modo=self' : ''}`);
        const rows = page.getByTestId('integration-rows');
        await expect(rows).toBeVisible();
        await expect(page.getByTestId('working-now')).toContainText('funciones listas');
        const expected = ['openai', 'meta', 'storage', 'video', 'drive', ...(mode === 'self' ? [] : ['stripe'])];
        await expect(rows.getByRole('button')).toHaveCount(expected.length);
        // En uso interno no salen pagos, cupos, márgenes ni planes.
        if (mode === 'self') {
          await expect(page.getByTestId('integration-row-stripe')).toHaveCount(0);
          await expect(page.locator('main')).not.toContainText(/Stripe|Cobrar|cupo|margen|planes/i);
        }
        // Los opcionales, plegados.
        await expect(page.getByTestId('integration-row-claude')).toBeHidden();
        const controls = await visibleControls(page);
        expect(controls.length, controls.join(' | ')).toBeLessThanOrEqual(11);
        expect(await horizontalScroll(page)).toBeLessThanOrEqual(0);
        // Cada fila cabe a lo ancho.
        for (const id of expected) {
          const box = (await page.getByTestId(`integration-row-${id}`).boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
        }
      });
    }

    test('hoja de OpenAI: clave, «Guardar y probar» y «Opciones avanzadas» sin scroll lateral', async ({ page }) => {
      await page.goto('/integraciones.html');
      await page.getByTestId('integration-row-openai').click();
      const dialog = page.getByRole('dialog', { name: 'OpenAI' });
      await expect(dialog).toBeVisible();
      const save = dialog.getByTestId('integration-save');
      await expect(save).toHaveText('Guardar y probar');
      // El botón se ve sin bajar, dentro de la pantalla.
      const button = (await save.boundingBox())!;
      expect(button.y + button.height).toBeLessThanOrEqual(size.height + 1);
      expect(button.x + button.width).toBeLessThanOrEqual(size.width + 1);

      const fits = () =>
        dialog.evaluate((el) => {
          const box = el.getBoundingClientRect();
          // Lo que se desplaza dentro de la hoja tampoco se sale a lo ancho.
          const wide = [...el.querySelectorAll<HTMLElement>('*')].filter(
            (child) => child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).overflowX !== 'visible',
          );
          return { left: box.left, right: box.right, overflow: el.scrollWidth - el.clientWidth, wide: wide.length };
        });
      let f = await fits();
      expect(f.left).toBeGreaterThanOrEqual(0);
      expect(f.right).toBeLessThanOrEqual(size.width + 1);
      expect(f.overflow).toBeLessThanOrEqual(0);

      await dialog.getByTestId('advanced-openai').locator('summary').click();
      await expect(dialog.getByTestId('ai-advisor-openai')).toBeVisible();
      await expect(dialog.getByTestId('ai-use-prices-openai')).toBeVisible();
      f = await fits();
      expect(f.right).toBeLessThanOrEqual(size.width + 1);
      expect(f.overflow).toBeLessThanOrEqual(0);
      expect(f.wide).toBe(0);
      expect(await horizontalScroll(page)).toBeLessThanOrEqual(0);
    });
  });
}
