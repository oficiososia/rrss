import { expect, test, type Page } from '@playwright/test';
import { visibleActions } from './acciones';

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
  // Lo primero que salga: una publicación o la rejilla del mes. En la vista de mes pueden salir LAS DOS
  // cosas (visto un lunes, día en que el banco siembra publicaciones para hoy): con el `.first()` dentro
  // del `.or()` la prueba fallaba por «dos elementos»; va fuera.
  await expect(page.getByTestId('calendar-entry').or(page.getByTestId('calendar-month')).first()).toBeVisible();
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

    test('«Programar» abre la hoja con las piezas sin fecha primero y cabe en la pantalla', async ({ page }) => {
      await open(page, 'week');
      await page.getByTestId('calendar-schedule').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('schedule-content').locator('optgroup').first()).toHaveAttribute(
        'label',
        /^Sin fecha \(\d+\)$/,
      );
      const box = (await dialog.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      const scroll = await pageScroll(page);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);
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

test('escritorio: los filtros (en «⋯») caben en una sola fila y la etiqueta de estado no se sale de la tarjeta', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'week');
  await expect(page.getByTestId('calendar-filters')).toHaveCount(0);
  await page.getByTestId('calendar-more').click();
  await page.getByTestId('calendar-filter-toggle').click();
  const chips = page.getByTestId('calendar-filters').locator('label');
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
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

test('escritorio: la semana ocupa el ancho y un día sin nada se programa tocando su hueco', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'week');
  const days = page.getByTestId('calendar-day');
  await expect(days).toHaveCount(7);
  const first = (await days.first().boundingBox())!;
  const last = (await days.last().boundingBox())!;
  expect(last.x + last.width - first.x).toBeGreaterThan(900);
  await expect(page.getByTestId('calendar-day-add')).toHaveCount(0);
  const slot = page.getByTestId('calendar-day-slot').first();
  if ((await slot.count()) > 0) {
    await expect(slot).toBeVisible();
    const box = (await slot.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    await slot.click();
    await expect(page.getByTestId('schedule-when')).toBeVisible();
  }
});

test('móvil: por defecto la semana como agenda, con «Programar» arriba y sin scroll de página', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await expect(page.getByTestId('calendar-view-week')).toHaveAttribute('aria-pressed', 'true');
  const week = page.getByTestId('calendar-week');
  await expect(week).toBeVisible();
  // Un día por fila: el día a la izquierda y lo programado a su lado.
  const days = page.getByTestId('calendar-day');
  const a = (await days.nth(0).boundingBox())!;
  const b = (await days.nth(1).boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
  // «Programar» arriba, por encima del calendario y dentro de la pantalla.
  const schedule = (await page.getByTestId('calendar-schedule').boundingBox())!;
  const weekBox = (await week.boundingBox())!;
  expect(schedule.y + schedule.height).toBeLessThanOrEqual(weekBox.y + 1);
  expect(schedule.x + schedule.width).toBeLessThanOrEqual(375 + 1);
  const scroll = await pageScroll(page);
  expect(scroll.vertical).toBeLessThanOrEqual(0);
  expect(scroll.horizontal).toBeLessThanOrEqual(0);
});

// Simplificación aceptada (CAMBIOS.md, apartado 8): de 33 acciones propias a 9 en ordenador y 7 en
// móvil, sin contar las pestañas «Calendario · Campañas» que llegaron después (f50). Se cuentan las
// de la pantalla (sin las publicaciones, los días ni sus huecos, que son el contenido, ni los avisos
// de cuenta, detenidas o plan propuesto). Hoy: Calendario, Campañas, Programar, «⋯», ‹, Hoy, ›,
// Semana y Mes.
for (const size of [
  { width: 1366, height: 768, max: 9 },
  { width: 375, height: 812, max: 9 },
]) {
  test(`a ${size.width} px el calendario enseña ${size.max} acciones como mucho`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await open(page, 'week');
    const actions = await visibleActions(page, '[data-testid="calendar-page"]', [
      '[data-testid="calendar-entry"]',
      '[data-testid="calendar-day-slot"]',
      '[data-testid="calendar-held"]',
      '[data-testid="account-attention"]',
      '[data-testid="calendar-proposed"]',
    ]);
    console.log(`calendario ${size.width}px: ${actions.length} acciones → ${actions.join(' | ')}`);
    expect(actions.length).toBeLessThanOrEqual(size.max);
    // Lo que sigue a la vista: «Programar», «⋯», ‹ Hoy › y Semana / Mes.
    await expect(page.getByTestId('calendar-schedule')).toBeVisible();
    await expect(page.getByTestId('calendar-more')).toBeVisible();
    await expect(page.getByTestId('calendar-tray-toggle')).toHaveCount(0);
  });
}
