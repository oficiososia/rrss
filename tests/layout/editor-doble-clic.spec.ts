import { expect, test, type Page } from '@playwright/test';

// Doble clic en un texto del lienzo: entra a escribir en él, como en Canva, esté
// elegido o no; Esc sale y conserva lo escrito. En Chromium real: el doble clic
// de Konva no se reproduce en jsdom.
//
// El fallo (F65): con un ratón o un panel táctil de verdad la mano se mueve unos
// píxeles al pulsar. Konva empieza a arrastrar a partir de 3 px y, si la primera
// pulsación se convierte en un arrastre, su detector de doble clic no lo ve: había
// que elegir el texto y pulsar «Escribir». Aquí se pulsa con ese temblor.
// Banco de tests/layout/marcos.tsx con la historia «Tapa del día» del catálogo y
// con la plantilla «Oferta de la semana».

async function open(page: Page, caso: 'tapa' | 'oferta', size = { width: 1366, height: 768 }) {
  await page.setViewportSize(size);
  await page.goto(`/marcos.html?caso=${caso}&modo=self`);
  await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await page.getByTestId('editor-stage').boundingBox())!.width).toBeGreaterThan(100);
}

/** Punto de la pantalla para unas coordenadas del lienzo (1080 de ancho; `height`, el alto del lienzo). */
async function at(page: Page, x: number, y: number, height: number) {
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  return { x: stage.x + (x / 1080) * stage.width, y: stage.y + (y / height) * stage.height };
}

/** Doble clic como el de una persona: la primera pulsación se mueve `jitter` px antes de soltar. */
async function humanDoubleClick(page: Page, point: { x: number; y: number }, jitter = 5) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + jitter, point.y + 1, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

const lastDraftText = (page: Page, layerId: string) =>
  page.evaluate((id) => {
    const drafts = (window as unknown as { drafts: () => unknown[] }).drafts() as {
      data?: { pages?: { layers?: { id: string; text?: string }[] }[] };
    }[];
    return drafts.at(-1)?.data?.pages?.[0]?.layers?.find((layer) => layer.id === id)?.text ?? null;
  }, layerId);

// «Nombre de la tapa» (h1-nombre): x 80, y 1296, 920 × 222, en un lienzo de 1080 × 1920.
const NOMBRE = { x: 300, y: 1340 };

for (const [name, size] of [
  ['ordenador', { width: 1366, height: 768 }],
  ['móvil', { width: 402, height: 874 }],
] as const) {
  test(`Tapa del día (${name}): doble clic en el nombre sin elegir entra a escribir; Esc sale y conserva lo escrito`, async ({
    page,
  }) => {
    await open(page, 'tapa', size);
    await humanDoubleClick(page, await at(page, NOMBRE.x, NOMBRE.y, 1920));
    const field = page.getByTestId('canvas-text-editor');
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Nombre de la tapa');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Croqueta de jamón');
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect.poll(() => lastDraftText(page, 'h1-nombre')).toBe('Croqueta de jamón');
  });

  test(`Tapa del día (${name}): doble clic en el nombre ya elegido entra a escribir`, async ({ page }) => {
    await open(page, 'tapa', size);
    const point = await at(page, NOMBRE.x, NOMBRE.y, 1920);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('bar-edit-text')).toBeVisible();
    await page.waitForTimeout(600);
    await humanDoubleClick(page, point);
    await expect(page.getByTestId('canvas-text-editor')).toBeVisible();
    await expect(page.getByTestId('canvas-text-editor')).toHaveValue('Nombre de la tapa');
  });
}

test('Oferta de la semana: doble clic en el titular sin elegir entra a escribir', async ({ page }) => {
  await open(page, 'oferta');
  // El titular: x 72, y 990, 936 × 170, en un lienzo de 1080 × 1350.
  await humanDoubleClick(page, await at(page, 540, 1060, 1350));
  await expect(page.getByTestId('canvas-text-editor')).toHaveValue('Nombre del menú o del plato');
});
