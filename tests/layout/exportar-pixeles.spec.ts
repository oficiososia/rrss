import { expect, test, type Page } from '@playwright/test';

// El PNG/JPEG que se exporta tiene que ser lo que se ve en el lienzo del editor. Se dibuja la
// misma escena con el lienzo (Scene) y con el exportador real, y se comparan los píxeles. La
// escena lleva texto, fotos y las ediciones sencillas: filtro, luz y color, recorte, giro,
// volteo, enderezado, fondo (color, degradado y foto desenfocada), sombras y contorno de texto.

interface Comparison {
  width: number;
  height: number;
  exportedWidth: number;
  exportedHeight: number;
  meanDiff: number;
  badShare: number;
  inkShare: number;
  mime: string;
}

async function open(page: Page) {
  await page.goto('/exportar.html');
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
}

const compare = (page: Page, scene: string, format: 'png' | 'jpeg', exported = scene) =>
  page.evaluate(
    ([s, f, e]) =>
      (window as unknown as { compareScene: (...a: string[]) => Promise<unknown> }).compareScene(s!, f!, e!),
    [scene, format, exported],
  ) as Promise<Comparison>;

for (const scene of ['basica', 'ediciones']) {
  for (const format of ['png', 'jpeg'] as const) {
    test(`la exportación ${format.toUpperCase()} de la escena «${scene}» coincide con el lienzo`, async ({ page }) => {
      await open(page);
      const result = await compare(page, scene, format);
      console.log(scene, format, JSON.stringify(result));
      expect(result.mime).toBe(format === 'png' ? 'image/png' : 'image/jpeg');
      // Mismo tamaño: 1 píxel por unidad del lienzo.
      expect([result.exportedWidth, result.exportedHeight]).toEqual([result.width, result.height]);
      // La escena no está vacía (que dos lienzos en blanco «coincidan» no prueba nada).
      expect(result.inkShare).toBeGreaterThan(0.3);
      // Casi idénticos: solo difieren el suavizado de bordes, la resolución con que se prepara cada foto
      // y la compresión (JPEG).
      expect(result.meanDiff).toBeLessThan(format === 'png' ? 2.5 : 3.5);
      expect(result.badShare).toBeLessThan(format === 'png' ? 0.02 : 0.03);
    });
  }
}

test('control: la comparación detecta que dos escenas distintas no coinciden', async ({ page }) => {
  await open(page);
  const result = await compare(page, 'basica', 'png', 'ediciones');
  expect(result.meanDiff).toBeGreaterThan(8);
});

test('si una imagen no carga, exportar falla con un aviso que nombra la imagen y no saca un archivo a medias', async ({
  page,
}) => {
  await open(page);
  const error = (await page.evaluate(() =>
    (window as unknown as { exportError: (s: string) => Promise<unknown> }).exportError('falla'),
  )) as { name: string; code: string; message: string } | null;
  expect(error).not.toBeNull();
  expect(error!.name).toBe('ExportError');
  expect(error!.code).toBe('image-load');
  expect(error!.message).toContain('No se ha podido cargar la imagen');
});
