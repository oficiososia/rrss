import { expect, test, type Page } from '@playwright/test';

// «Hacer un reel como este» en un navegador real, sin Supabase (banco de
// tests/layout/reel-como-este.tsx): que quepa en un móvil de 375 px sin scroll
// lateral, con textos largos, en sus cuatro pantallas.

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'portátil 1366×768', width: 1366, height: 768 },
];

const open = (page: Page, view: string) => page.goto(`/reel-como-este.html?vista=${view}`);

/** Cuánto se sale la página por la derecha y qué elementos visibles lo provocan. */
const overflow = (page: Page) =>
  page.evaluate(() => {
    const width = window.innerWidth;
    const spilling = [...document.querySelectorAll('main *')]
      .filter((el) => {
        if (el.classList.contains('sr-only')) return false;
        // Lo que vive dentro de una zona con su propio scroll lateral (la línea de tiempo) no cuenta.
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'hidden') return false;
        }
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

    test('subir o pegar el enlace: cabe, con el coste máximo y el botón a la vista', async ({ page }) => {
      await open(page, 'inicio');
      await expect(page.getByRole('heading', { name: 'Hacer un reel como este' })).toBeVisible();
      await expect(page.getByTestId('reel-like-cost')).toContainText('Coste máximo estimado');
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
      await page.getByTestId('reel-like-mode-link').click();
      await page.getByTestId('reel-like-url').fill('https://www.instagram.com/reel/C8xYz1234567890abcdefghijklmnopqrstuvwxyz/?igsh=abcdefghijklmnop');
      await expect(page.getByTestId('reel-like-start')).toBeEnabled();
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
      // Los controles se pueden tocar con el dedo.
      for (const id of ['reel-like-mode-file', 'reel-like-mode-link', 'reel-like-start']) {
        expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    });

    test('progreso por pasos: cabe', async ({ page }) => {
      await open(page, 'progreso');
      await expect(page.getByTestId('reel-like-steps')).toBeVisible();
      await expect(page.getByTestId('reel-like-steps').getByRole('listitem')).toHaveCount(4);
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
    });

    test('resultado: las cuatro salidas caben, con textos largos', async ({ page }) => {
      await open(page, 'resultado');
      await expect(page.getByTestId('reel-like-result')).toBeVisible();
      for (const id of ['reel-like-template', 'reel-like-script', 'reel-like-draft', 'reel-like-texts']) {
        await expect(page.getByTestId(id)).toBeVisible();
      }
      await expect(page.getByTestId('reel-like-draft-summary')).toContainText('planos con material de tu biblioteca');
      expect(await overflow(page)).toEqual({ horizontal: 0, spilling: [] });
      // Los dos botones principales, enteros dentro de la pantalla.
      for (const id of ['reel-like-open-editor', 'reel-like-save-template']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      // La barra de planos reparte el ancho según la duración de cada uno.
      const bar = (await page.getByTestId('reel-like-shot-bar').boundingBox())!;
      expect(bar.x + bar.width).toBeLessThanOrEqual(size.width + 1);
      await page.getByTestId('reel-like-save-template').click();
      await expect(page.getByTestId('reel-like-template-name')).toBeVisible();
      expect((await overflow(page)).horizontal).toBe(0);
    });

    test('el borrador en el editor: el guion con sus huecos cabe', async ({ page }) => {
      await open(page, 'editor');
      await expect(page.getByTestId('reel-editor')).toBeVisible();
      await expect(page.getByTestId('reel-guide')).toBeVisible();
      await expect(page.getByTestId('reel-guide-summary')).toContainText('por grabar de 7');
      await expect(page.getByTestId('reel-like-draft-notice')).toBeVisible();
      expect((await overflow(page)).horizontal).toBe(0);
      const guide = (await page.getByTestId('reel-guide').boundingBox())!;
      expect(guide.x).toBeGreaterThanOrEqual(0);
      expect(guide.x + guide.width).toBeLessThanOrEqual(size.width + 1);
    });
  });
}
