import { expect, test, type Page } from '@playwright/test';

// El Calendario en un navegador real, sin Supabase (banco de tests/layout/calendario.tsx),
// con una semana cargada: la regla de la casa es que el alto de la página es el alto de la
// pantalla y solo se desplaza el calendario por dentro; y que nada se sale de su tarjeta.

const SIZES = [
  { name: 'escritorio 1440×900', width: 1440, height: 900 },
  { name: 'móvil 375×812', width: 375, height: 812 },
];

async function open(page: Page, view?: 'week' | 'month' | 'agenda') {
  if (view) await page.addInitScript((v) => window.localStorage.setItem('rrss.calendar.view', JSON.stringify(v)), view);
  await page.goto('/calendario.html');
  await expect(page.getByTestId('calendar-page')).toBeVisible();
  await expect(page.getByTestId('calendar-entry').first().or(page.getByTestId('calendar-month'))).toBeVisible();
}

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

/** Elementos visibles de las tarjetas que se salen de su tarjeta (los textos solo para lector no cuentan). */
const spillingCards = (page: Page) =>
  page.getByTestId('calendar-entry').evaluateAll((cards) =>
    cards.flatMap((card) => {
      const edge = card.getBoundingClientRect();
      return [...card.querySelectorAll('*')]
        .filter((el) => {
          if (el.classList.contains('sr-only')) return false;
          const box = el.getBoundingClientRect();
          return box.width > 0 && (box.right > edge.right + 1 || box.left < edge.left - 1);
        })
        .map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`);
    }),
  );

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    for (const view of ['week', 'month', 'agenda'] as const) {
      test(`vista ${view}: sin scroll de página, ni lateral, y solo se desplaza el calendario por dentro`, async ({
        page,
      }) => {
        await open(page, view);
        const scroll = await pageScroll(page);
        expect(scroll.vertical).toBeLessThanOrEqual(0);
        expect(scroll.horizontal).toBeLessThanOrEqual(0);
        // El pie legal no aparece dentro de una pantalla de trabajo.
        await expect(page.getByTestId('legal-footer')).toHaveCount(0);
        expect(await spillingCards(page)).toEqual([]);

        // El contenedor de la vista es el que se desplaza (hay más de lo que cabe).
        const region = page.getByTestId(`calendar-${view}`);
        const box = (await region.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
        if (view !== 'month') {
          expect(await region.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
        }
      });
    }

    test('con la bandeja «Por programar» abierta tampoco hay scroll de página', async ({ page }) => {
      await open(page, 'week');
      await page.getByTestId('calendar-tray-toggle').click();
      await expect(page.getByTestId('calendar-tray')).toBeVisible();
      const scroll = await pageScroll(page);
      expect(scroll.vertical).toBeLessThanOrEqual(0);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);
      const tray = (await page.getByTestId('calendar-tray').boundingBox())!;
      expect(tray.x + tray.width).toBeLessThanOrEqual(size.width + 1);
      expect(tray.y + tray.height).toBeLessThanOrEqual(size.height + 1);
    });

    test('la vista rápida cabe en la pantalla y se cierra con Escape', async ({ page }) => {
      await open(page, 'agenda');
      await page.getByTestId('calendar-entry').first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });
  });
}

test('escritorio: los filtros caben en una sola fila y la etiqueta de estado no se sale de la tarjeta', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'week');
  const chips = page.getByTestId('calendar-filters').locator('label');
  expect(await chips.count()).toBeGreaterThanOrEqual(4);
  const tops = await chips.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // Las dos piezas del mismo día, una debajo de otra, con su estado dentro.
  const monday = page.getByTestId('calendar-day').first();
  const cards = monday.getByTestId('calendar-entry');
  expect(await cards.count()).toBe(2);
  const one = (await cards.nth(0).boundingBox())!;
  const two = (await cards.nth(1).boundingBox())!;
  expect(two.y).toBeGreaterThanOrEqual(one.y + one.height - 1);
  const dayBox = (await monday.boundingBox())!;
  expect(one.x + one.width).toBeLessThanOrEqual(dayBox.x + dayBox.width + 1);
});

test('escritorio: la semana ocupa el ancho y el «+» solo aparece al pasar el ratón', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'week');
  const days = page.getByTestId('calendar-day');
  await expect(days).toHaveCount(7);
  const first = (await days.first().boundingBox())!;
  const last = (await days.last().boundingBox())!;
  expect(last.x + last.width - first.x).toBeGreaterThan(900);
  const futureDay = days.nth(6);
  const add = futureDay.getByTestId('calendar-day-add');
  if ((await add.count()) > 0) {
    await expect(add).toHaveCSS('opacity', '0');
    await futureDay.hover();
    await expect(add).toHaveCSS('opacity', '1');
  }
});

test('móvil: por defecto la lista, con el objetivo y los huecos arriba', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await expect(page.getByTestId('calendar-view-agenda')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('calendar-agenda')).toBeVisible();
  const scroll = await pageScroll(page);
  expect(scroll.vertical).toBeLessThanOrEqual(0);
  expect(scroll.horizontal).toBeLessThanOrEqual(0);
});
