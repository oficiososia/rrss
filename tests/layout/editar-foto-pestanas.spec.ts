import { expect, test, type Page } from '@playwright/test';

// «Editar foto» en tres pestañas (Ajustar, Recortar y Fondo) en un navegador real, sin Supabase
// (banco de tests/layout/fotos-ia.tsx, organización en autogestión). Regla de la casa: el alto de
// la pantalla es el alto de la ventana y solo se desplaza el interior de los ajustes. A 375 px las
// pestañas van arriba, la foto en medio y los ajustes en una hoja baja; a 1366 px, la foto a la
// izquierda y los ajustes a la derecha. En ninguna pestaña hay scroll de página ni nada se sale.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812, mobile: true },
  { name: 'portátil 1366×768', width: 1366, height: 768, mobile: false },
];

const TABS = [
  { name: 'Ajustar', shows: 'photo-edit-auto' },
  { name: 'Recortar', shows: 'photo-edit-crop-none' },
  { name: 'Fondo', shows: 'photo-edit-bg-mode-remove' },
];

/** Scroll de la página y de la pantalla, y lo que se sale por la derecha. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="photo-edit"]')!;
    const width = window.innerWidth;
    const spilling = [...root.querySelectorAll('*')]
      .filter((el) => {
        if (el.closest('.sr-only')) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.right > width + 1;
      })
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    return {
      pageVertical: document.scrollingElement!.scrollHeight - window.innerHeight,
      pageHorizontal: document.scrollingElement!.scrollWidth - width,
      screenVertical: root.scrollHeight - root.clientHeight,
      spilling: spilling.slice(0, 5),
    };
  });

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('tres pestañas sin scroll de página, con la foto a la vista y los ajustes dentro', async ({ page }) => {
      await page.goto('/fotos-ia.html?modo=self');
      await page.getByTestId('library-asset').first().click();
      await page.getByTestId('asset-edit-photo').click();
      const screen = page.getByTestId('photo-edit');
      await expect(screen.getByTestId('photo-edit-preview')).toBeVisible();
      await expect(screen.getByRole('tab')).toHaveText(['Ajustar', 'Recortar', 'Fondo']);

      for (const tab of TABS) {
        await screen.getByRole('tab', { name: tab.name, exact: true }).click();
        await expect(screen.getByTestId(tab.shows)).toBeVisible();
        const m = await measure(page);
        expect(m.pageVertical, `${tab.name}: scroll vertical de página`).toBeLessThanOrEqual(0);
        expect(m.pageHorizontal, `${tab.name}: scroll lateral de página`).toBeLessThanOrEqual(0);
        expect(m.screenVertical, `${tab.name}: la pantalla no se desplaza`).toBeLessThanOrEqual(0);
        expect(m.spilling, `${tab.name}: nada se sale por la derecha`).toEqual([]);

        const tabs = (await screen.getByTestId('photo-edit-tabs').boundingBox())!;
        const stage = (await screen.getByTestId('photo-edit-stage').boundingBox())!;
        const sheet = (await screen.getByTestId('photo-edit-sheet').boundingBox())!;
        // La foto se ve grande y los ajustes acaban dentro de la ventana.
        expect(stage.height).toBeGreaterThan(size.height * 0.3);
        expect(sheet.y + sheet.height).toBeLessThanOrEqual(size.height + 1);
        if (size.mobile) {
          // Pestañas arriba, foto en medio, hoja baja (como mucho el 45 % del alto).
          expect(tabs.y + tabs.height).toBeLessThanOrEqual(stage.y + 1);
          expect(stage.y + stage.height).toBeLessThanOrEqual(sheet.y + 1);
          expect(sheet.height).toBeLessThanOrEqual(size.height * 0.45 + 1);
          expect(stage.width).toBeGreaterThan(size.width * 0.8);
        } else {
          // Foto a la izquierda; pestañas y ajustes en la columna de la derecha.
          expect(stage.x + stage.width).toBeLessThanOrEqual(sheet.x + 1);
          expect(tabs.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
          expect(tabs.y + tabs.height).toBeLessThanOrEqual(sheet.y + 1);
        }
      }

      // «Mejorar con IA» no sale en ningún sitio, aunque el servidor del banco lo tenga.
      await expect(screen.getByText(/Mejorar con IA/)).toHaveCount(0);

      // Recortar lleva también «Ampliar con IA».
      await screen.getByRole('tab', { name: 'Recortar', exact: true }).click();
      await expect(screen.getByTestId('photo-edit-upscale')).toBeAttached();

      // Fondo → Cambiar con IA: antes de gastar, el coste máximo y dónde se procesa; en autogestión, sin cupos.
      await screen.getByRole('tab', { name: 'Fondo', exact: true }).click();
      await screen.getByRole('radio', { name: 'Cambiar con IA' }).click();
      const ai = screen.getByTestId('photo-edit-ai-replace_background');
      await ai.getByTestId('photo-edit-ai-cost').scrollIntoViewIfNeeded();
      await expect(ai.getByTestId('photo-edit-ai-cost')).toBeVisible();
      await expect(ai.getByTestId('photo-edit-ai-cost')).toContainText('Coste máximo');
      await expect(ai.getByTestId('photo-edit-ai-cost')).not.toContainText('cupo');
      await expect(ai.getByText('Se procesa fuera de la UE o en región desconocida')).toBeVisible();
      const m = await measure(page);
      expect(m.pageVertical).toBeLessThanOrEqual(0);
      expect(m.spilling).toEqual([]);

      if (size.mobile) {
        // La hoja se oculta para ver la foto entera y vuelve al tocar una pestaña.
        const before = (await screen.getByTestId('photo-edit-stage').boundingBox())!.height;
        await screen.getByTestId('photo-edit-sheet-toggle').click();
        await expect(screen.getByTestId('photo-edit-sheet')).toBeHidden();
        expect((await screen.getByTestId('photo-edit-stage').boundingBox())!.height).toBeGreaterThan(before);
        expect((await measure(page)).pageVertical).toBeLessThanOrEqual(0);
        await screen.getByRole('tab', { name: 'Ajustar', exact: true }).click();
        await expect(screen.getByTestId('photo-edit-sheet')).toBeVisible();
      }
    });
  });
}
