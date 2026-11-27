import { expect, test, type Page } from '@playwright/test';

// El primer toque en el campo del copiloto lo enfoca y no se pierde lo escrito
// (prueba de calidad del 24/11/2026, fallo 6: «el primer toque en el campo del
// copiloto no lo enfoca y el texto escrito se pierde»).
//
// La causa: si se estaba escribiendo en un texto del lienzo o encuadrando una
// foto, al tocar el campo del copiloto el editor terminaba esa edición y
// devolvía el foco al lienzo, quitándoselo al campo recién tocado. Lo que se
// tecleaba después iba al lienzo y se perdía; el segundo toque ya funcionaba.
// En Chromium real, con ratón (1366 px) y con toques (375 px).
// Banco de tests/layout/entry.tsx (la aplicación real con el Supabase simulado).

const SIZES = [
  { name: 'portátil 1366×768', width: 1366, height: 768, touch: false },
  { name: 'móvil 375×812', width: 375, height: 812, touch: true },
];

async function openEditor(page: Page) {
  await page.goto('/layout.html?ratio=4:5');
  await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
}

/** Un toque (o un clic) en el centro de lo que se ve, como lo haría una persona: sin esperas ni desplazamientos. */
async function press(page: Page, touch: boolean, box: { x: number; y: number; width: number; height: number }) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Elige el título del banco (abajo, centrado) tocándolo en el lienzo. */
async function pickTitle(page: Page, touch: boolean) {
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  await press(page, touch, {
    x: stage.x + stage.width * 0.4,
    y: stage.y + stage.height * 0.86,
    width: stage.width * 0.2,
    height: 4,
  });
  await expect(page.getByTestId('bar-edit-text')).toBeVisible();
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch });

    test('escribiendo en un texto del lienzo, el primer toque en el copiloto ya sirve y se conserva lo del lienzo', async ({
      page,
    }) => {
      await openEditor(page);
      await press(page, size.touch, (await page.getByTestId('copilot-open').boundingBox())!);
      const input = page.getByTestId('copilot-text-input');
      await expect(input).toBeVisible();

      await pickTitle(page, size.touch);
      await page.getByTestId('bar-edit-text').click();
      const field = page.getByTestId('canvas-text-editor');
      await expect(field).toBeFocused();
      await page.keyboard.press('End');
      await page.keyboard.type(' al carbón');

      // Un solo toque en el campo del copiloto y a escribir.
      await press(page, size.touch, (await input.boundingBox())!);
      await expect(field).toHaveCount(0);
      await expect(input).toBeFocused();
      await page.keyboard.type('más grande');
      await expect(input).toHaveValue('más grande');

      // Lo escrito en el lienzo se ha guardado en el título, y la orden funciona.
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('copilot-order').first()).toHaveAttribute('data-status', 'applied');
      await expect(page.getByTestId('copilot-order').first()).toContainText('Chuletón de vaca madurada al carbón');
    });

    test('con el teclado, terminar de escribir en el lienzo devuelve el foco al lienzo (como antes)', async ({
      page,
    }) => {
      await openEditor(page);
      await pickTitle(page, size.touch);
      await page.getByTestId('bar-edit-text').click();
      await expect(page.getByTestId('canvas-text-editor')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('canvas-text-editor')).toHaveCount(0);
      await expect(page.getByRole('region', { name: /^Lienzo\./ })).toBeFocused();
    });
  });
}
