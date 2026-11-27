import { expect, test, type Page } from '@playwright/test';

// Logotipo legible sobre su fondo (F65), en Chromium real: el editor mide los píxeles de los
// logotipos de la marca. Banco tests/layout/marcos.tsx, caso «tapa»: la historia «Tapa del día»
// del catálogo con el logotipo OSCURO de la marca (el primero del kit) sobre su cabecera oscura.

const DARK = '33333333-3333-4333-8333-333333333333';
const LIGHT = '44444444-4444-4444-8444-444444444444';

async function open(page: Page, logos: 'dos' | 'uno') {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/marcos.html?caso=tapa&modo=self&logos=${logos}`);
  await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
}

const lastDraftLogo = (page: Page) =>
  page.evaluate(() => {
    const drafts = (window as unknown as { drafts: () => unknown[] }).drafts() as {
      data?: { pages?: { layers?: { type: string; assetId?: string }[] }[] };
    }[];
    return drafts.at(-1)?.data?.pages?.[0]?.layers?.find((layer) => layer.type === 'logo')?.assetId ?? null;
  });

test('con la variante clara en el kit, al abrir la pieza el logotipo oscuro pasa a ser el claro', async ({ page }) => {
  await open(page, 'dos');
  await expect.poll(() => lastDraftLogo(page)).toBe(LIGHT);
  await expect(page.getByTestId('editor-logo-contrast')).toHaveCount(0);
  // Ctrl+Z vuelve al oscuro (la versión guardada: el borrador desaparece) y no se cambia otra vez;
  // entonces sí se avisa.
  await page.getByTestId('editor-stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('editor-logo-contrast')).toBeVisible();
  await page.waitForTimeout(1500);
  expect([DARK, null]).toContain(await lastDraftLogo(page));
});

test('con una sola variante que no se ve, el editor avisa «El logotipo apenas se ve sobre este fondo»', async ({
  page,
}) => {
  await open(page, 'uno');
  await expect(page.getByTestId('editor-logo-contrast')).toContainText('El logotipo apenas se ve sobre este fondo');
  await expect(page.getByTestId('editor-logo-contrast')).toContainText('versión clara');
});
