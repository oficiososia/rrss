import { expect, test, type Page } from '@playwright/test';

// Plantillas de menús en un navegador real, sin Supabase (banco tests/layout/menus.tsx): cada una
// en historia y en publicación, con un menú corto y uno largo, por la interfaz de verdad. Los textos
// se miden con Konva en el navegador: ninguno se sale de su caja (si no, pisaría al siguiente).

const TIPOS = ['menu-dia', 'tapas', 'tapa-semana', 'vinos', 'evento'] as const;

async function open(page: Page) {
  await page.goto('/menus.html');
  await expect(page.getByTestId('menus-page')).toBeVisible();
  await expect(page.getByTestId('menus-vista').locator('img')).toBeVisible();
}

const audit = (page: Page, tipo: string, formato: string, largo: boolean) =>
  page.evaluate(
    ([t, f, l]) =>
      (window as unknown as { auditarMenu: (a: string, b: string, c: boolean) => Promise<{ cortas: string[]; textos: number; paginas: number; desborda: boolean }> })
        .auditarMenu(t as string, f as string, l as boolean),
    [tipo, formato, largo] as const,
  );

for (const tipo of TIPOS) {
  for (const formato of ['story', 'post'] as const) {
    for (const largo of [false, true]) {
      test(`${tipo} · ${formato} · ${largo ? 'largo' : 'corto'}: ningún texto se sale de su caja`, async ({ page }) => {
        await open(page);
        const r = await audit(page, tipo, formato, largo);
        expect(r.textos).toBeGreaterThan(0);
        expect(r.cortas).toEqual([]);
        if (!largo) {
          expect(r.paginas).toBe(1);
          expect(r.desborda).toBe(false);
        }
      });
    }
  }
}

test('cada plantilla enseña su vista previa, en historia y en publicación', async ({ page }) => {
  await open(page);
  for (const id of ['menu-dia', 'tapas', 'tapa-semana', 'vinos']) {
    await page.getByTestId(`menus-tipo-${id}`).click();
    for (const f of ['story', 'post']) {
      await page.getByTestId(`menus-formato-${f}`).click();
      await expect(page.getByTestId('menus-vista').locator('img')).toBeVisible();
      await expect(page.getByTestId('menus-publicar')).toBeEnabled();
    }
  }
  for (const id of ['nochevieja', 'navidad', 'san-valentin', 'otro']) {
    await page.getByTestId(`menus-evento-${id}`).click();
    await expect(page.getByTestId('menus-vista').locator('img')).toBeVisible();
    await expect(page.getByTestId('menus-publicar')).toBeEnabled();
  }
});

test('un menú largo: la historia avisa y no se publica; la publicación se reparte en un carrusel', async ({ page }) => {
  await open(page);
  await page.getByTestId('menus-tipo-menu-dia').click();
  const largo = Array.from({ length: 9 }, (_, i) => `Plato número ${i + 1} con su guarnición de temporada`).join('\n');
  await page.getByTestId('menus-seccion-1').getByLabel('Platos').fill(largo);
  await page.getByTestId('menus-seccion-2').getByLabel('Platos').fill(largo);
  await page.getByTestId('menus-formato-story').click();
  await expect(page.getByTestId('menus-aviso-largo')).toBeVisible();
  await expect(page.getByTestId('menus-publicar')).toBeDisabled();
  await page.getByTestId('menus-formato-post').click();
  await expect(page.getByTestId('menus-paginas')).toContainText('Página 1 de');
  await expect(page.getByTestId('menus-publicar')).toBeEnabled();
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.getByTestId('menus-paginas')).toContainText('Página 2 de');
});

test('flujo: escribir, elegir la foto, ver la vista previa y abrir «Compartir»', async ({ page }) => {
  await open(page);
  await page.getByTestId('menus-tipo-menu-dia').click();
  await page.getByLabel('Título', { exact: true }).fill('Menú del día');
  await page.getByRole('button', { name: /Elegir: Foto de fondo/ }).click();
  await page.getByTestId('picker-asset').first().click();
  await expect(page.getByRole('button', { name: /Cambiar: Foto de fondo/ })).toBeVisible();
  await expect(page.getByTestId('menus-vista').locator('img')).toBeVisible();
  await page.getByTestId('menus-publicar').click();
  await expect(page).toHaveURL(/\/contenidos\/.+/);
  await expect(page.getByTestId('share-actions')).toBeVisible();
});
