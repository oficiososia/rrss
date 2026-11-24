import { expect, test, type Page } from '@playwright/test';

// Marca → Identidad visual → «Plantillas de la marca» en un navegador real (banco
// tests/layout/plantillas-marca.tsx). El fallo (F65): a 402 px el nombre salía partido
// letra a letra («Dos / tapas») junto a Renombrar, Duplicar y Borrar. En el móvil la
// miniatura y el nombre van arriba y las acciones, en «⋯»; en el ordenador, a la vista.

const MOBILE = [
  { name: 'móvil 375×812', width: 375, height: 812 },
  { name: 'móvil 402×874', width: 402, height: 874 },
];

async function open(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto('/plantillas-marca.html');
  await expect(page.getByTestId('brand-template')).toHaveCount(4);
}

/** Cuántas líneas ocupa cada nombre y qué palabra queda partida (una palabra en dos líneas). */
const nameLayout = (page: Page) =>
  page.getByTestId('brand-template-name').evaluateAll((names) =>
    names.map((el) => {
      const style = window.getComputedStyle(el);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
      const box = el.getBoundingClientRect();
      // Una palabra partida: sus letras no están todas en la misma línea.
      const range = document.createRange();
      const text = el.firstChild as Text;
      const words = (text.textContent ?? '').split(' ');
      let offset = 0;
      const broken: string[] = [];
      for (const word of words) {
        range.setStart(text, offset);
        range.setEnd(text, offset + word.length);
        if (range.getClientRects().length > 1) broken.push(word);
        offset += word.length + 1;
      }
      // Sitio que tiene el renglón del nombre (el párrafo que lo contiene), no lo que mide el texto.
      const room = el.parentElement!.getBoundingClientRect().width;
      return { name: el.textContent, lines: Math.round(box.height / lineHeight), room, broken };
    }),
  );

for (const size of MOBILE) {
  test(`${size.name}: la miniatura y el nombre arriba, sin partir el nombre, y las acciones en «⋯»`, async ({
    page,
  }) => {
    await open(page, size);
    const layout = await nameLayout(page);
    for (const item of layout) {
      expect(item.broken, `«${item.name}» sale partido`).toEqual([]);
      // Con sitio para el nombre: al menos 150 px de ancho.
      expect(item.room, `«${item.name}» sin sitio`).toBeGreaterThan(150);
    }
    expect(layout.find((item) => item.name === 'Dos tapas')!.lines).toBe(1);

    const first = page.getByTestId('brand-template').first();
    await expect(first.getByTestId('brand-template-rename')).toBeHidden();
    await expect(first.getByTestId('brand-template-duplicate')).toBeHidden();
    await expect(first.getByTestId('brand-template-delete')).toBeHidden();
    const more = first.getByTestId('brand-template-more');
    await expect(more).toBeVisible();

    // Miniatura y nombre en la misma franja de arriba; el «⋯», a la derecha y dentro de la pantalla.
    // Las tres cajas se miden de una vez y con la tarjeta ya quieta (igual en dos fotogramas seguidos):
    // medidas una tras otra, con la máquina cargada la página seguía colocándose entre una y otra y
    // salían de momentos distintos (el nombre, 124 px por debajo de la miniatura).
    type Box = { x: number; y: number; width: number; height: number };
    const [thumb, nameBox, moreBox] = await first.evaluate(async (card): Promise<[Box, Box, Box]> => {
      const box = (el: Element | null): Box => {
        const { x, y, width, height } = el!.getBoundingClientRect();
        return { x, y, width, height };
      };
      const measure = (): [Box, Box, Box] => [
        box(card.querySelector('[aria-hidden]')),
        box(card.querySelector('[data-testid="brand-template-name"]')),
        box(card.querySelector('[data-testid="brand-template-more"]')),
      ];
      let last = measure();
      for (let frame = 0; frame < 120; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = measure();
        if (JSON.stringify(now) === JSON.stringify(last)) return now;
        last = now;
      }
      return last;
    });
    expect(nameBox.y).toBeLessThan(thumb.y + thumb.height);
    expect(nameBox.x).toBeGreaterThan(thumb.x + thumb.width - 1);
    expect(moreBox.x).toBeGreaterThan(nameBox.x);
    expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(size.width);

    // El «⋯» abre Renombrar, Duplicar y Borrar; Renombrar abre el campo.
    await more.click();
    await expect(page.getByTestId('brand-template-menu-duplicate')).toBeVisible();
    await expect(page.getByTestId('brand-template-menu-delete')).toBeVisible();
    await page.getByTestId('brand-template-menu-rename').click();
    await expect(first.getByTestId('brand-template-rename-input')).toBeVisible();

    const scroll = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
    expect(scroll).toBeLessThanOrEqual(0);
  });
}

test('ordenador 1366×768: Renombrar, Duplicar y Borrar a la vista, sin «⋯»', async ({ page }) => {
  await open(page, { width: 1366, height: 768 });
  const first = page.getByTestId('brand-template').first();
  await expect(first.getByTestId('brand-template-rename')).toBeVisible();
  await expect(first.getByTestId('brand-template-duplicate')).toBeVisible();
  await expect(first.getByTestId('brand-template-delete')).toBeVisible();
  await expect(first.getByTestId('brand-template-more')).toBeHidden();
  const layout = await nameLayout(page);
  for (const item of layout) expect(item.broken).toEqual([]);
});
