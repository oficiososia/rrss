import { expect, test, type Page } from '@playwright/test';

// El editor de piezas en un navegador de verdad (con Konva), con una pieza recién
// salida de una plantilla: marcos de foto, barra de acciones sobre lo elegido,
// encuadre con doble clic, Esc al escribir, guardado automático y zoom con la
// rueda. A 375 px y en escritorio, y siempre sin scroll de página.
// Con CAPTURAS=<carpeta> guarda capturas para revisarlas a ojo.

const W = 1080;
const H = 1350;

async function open(page: Page, caso: 'titular' | 'dos', size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(`/marcos.html?caso=${caso}`);
  await expect(page.getByTestId('editor-stage')).toBeVisible();
  // El lienzo ya tiene su tamaño definitivo (no el de 1 px con que nace).
  await expect.poll(async () => (await page.getByTestId('editor-stage').boundingBox())!.width).toBeGreaterThan(100);
}

/** Punto de la pantalla que corresponde a un punto del lienzo (en sus unidades). */
async function at(page: Page, x: number, y: number) {
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  return { x: stage.x + (x / W) * stage.width, y: stage.y + (y / H) * stage.height };
}

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

interface DraftLayer {
  id: string;
  type: string;
  text?: string;
  source?: { kind: string; assetId?: string };
  frame?: boolean;
  focus?: { x: number; y: number };
  zoom?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Capas del borrador que el editor ha guardado solo (se espera a que exista). */
async function draftLayers(page: Page): Promise<DraftLayer[]> {
  await expect(page.getByTestId('editor-dirty')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  return page.evaluate(() => {
    const rows = (window as unknown as { drafts: () => { data: { pages: { layers: unknown[] }[] } }[] }).drafts();
    return rows[0]!.data.pages[0]!.layers as never;
  });
}

async function shot(page: Page, name: string) {
  if (process.env.CAPTURAS) await page.screenshot({ path: `${process.env.CAPTURAS}/${name}.png` });
}

/** La barra flotante está entera dentro del área del lienzo. */
async function barInsideCanvas(page: Page) {
  const bar = (await page.getByTestId('selection-toolbar').boundingBox())!;
  const area = (await page.getByTestId('editor-canvas-area').boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(bar.y).toBeGreaterThanOrEqual(area.y - 1);
  expect(bar.x + bar.width).toBeLessThanOrEqual(area.x + area.width + 1);
  expect(bar.y + bar.height).toBeLessThanOrEqual(area.y + area.height + 1);
  return bar;
}

test('escritorio: el hueco bajo un velo y un titular ofrece «Poner foto», la foto rellena el marco y se encuadra con doble clic', async ({
  page,
}) => {
  await open(page, 'titular', { width: 1366, height: 768 });
  await expect(page.getByTestId('editor-empty-frames')).toHaveText('Falta 1 foto');
  await shot(page, 'marco-vacio-escritorio');

  // El botón «Poner foto» está encima de todo y esquiva el titular (que ocupa el centro): arriba, al 20 %.
  const pill = await at(page, W / 2, H * 0.2);
  await page.mouse.click(pill.x, pill.y);
  const picker = page.getByRole('dialog', { name: 'Poner foto' });
  await expect(picker).toBeVisible();
  await picker.getByTestId('picker-asset').first().click();
  await expect(picker).toBeHidden();

  // La foto está DENTRO del marco: misma caja, sigue siendo un marco y debajo del velo y del titular.
  const layers = await draftLayers(page);
  expect(layers.map((l) => l.id)).toEqual(['foto', 'velo', 'titular']);
  expect(layers[0]).toMatchObject({ type: 'image', frame: true, x: 0, y: 0, width: W, height: H });
  expect(layers[0]!.source).toMatchObject({ kind: 'asset' });
  await expect(page.getByTestId('editor-empty-frames')).toHaveCount(0);

  // Con la foto elegida, la barra flotante ofrece lo suyo y no se sale del lienzo.
  await expect(page.getByTestId('bar-replace-photo')).toBeVisible();
  await expect(page.getByTestId('bar-duplicate')).toBeVisible();
  await expect(page.getByTestId('bar-delete')).toBeVisible();
  await barInsideCanvas(page);
  await shot(page, 'marco-con-foto-escritorio');

  // Doble clic donde está la foto (aunque encima haya un velo): encuadrar. Arrastrar la mueve dentro del marco.
  const spot = await at(page, W / 2, H * 0.85);
  await page.mouse.dblclick(spot.x, spot.y);
  const surface = page.getByTestId('frame-adjust-surface');
  await expect(surface).toBeVisible();
  await page.getByTestId('frame-zoom-in').click();
  await page.getByTestId('frame-zoom-in').click();
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + 80, spot.y + 40, { steps: 4 });
  await page.mouse.up();
  await shot(page, 'encuadre-escritorio');
  await page.getByTestId('frame-adjust-done').click();
  await expect(surface).toBeHidden();
  const framed = (await draftLayers(page))[0]!;
  expect(framed.zoom).toBeGreaterThan(1);
  // Arrastrar a la derecha y abajo enseña lo que había a la izquierda y arriba.
  expect(framed.focus!.x).toBeLessThan(0.5);
  expect(framed.focus!.y).toBeLessThan(0.5);
  // La caja no ha cambiado: se mueve la foto, no el marco.
  expect(framed).toMatchObject({ x: 0, y: 0, width: W, height: H });

  expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
  expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
});

test('móvil 375 px: tocar el hueco pone la foto y la barra de acciones queda a la vista, sin scroll de página', async ({
  page,
}) => {
  await open(page, 'dos', { width: 375, height: 812 });
  await expect(page.getByTestId('editor-empty-frames')).toBeHidden(); // en móvil no cabe en la cabecera
  await shot(page, 'marcos-vacios-movil');

  const first = await at(page, W / 2, 331);
  await page.mouse.click(first.x, first.y);
  const picker = page.getByRole('dialog', { name: 'Poner foto' });
  await expect(picker).toBeVisible();
  await picker.getByTestId('picker-asset').nth(1).click();
  await expect(picker).toBeHidden();

  const layers = await draftLayers(page);
  expect(layers.find((l) => l.id === 'foto-antes')!.source).toMatchObject({ kind: 'asset' });
  expect(layers.find((l) => l.id === 'foto-despues')!.source).toMatchObject({ kind: 'empty' });

  // La barra de la foto, entera en pantalla y sin tapar la foto elegida.
  const bar = await barInsideCanvas(page);
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(375);
  const frameBottom = (await at(page, 0, 663)).y;
  expect(bar.y).toBeGreaterThanOrEqual(frameBottom);
  // Botones para el dedo, y todos a la vista (también «⋯», el último): nada queda cortado por la derecha.
  const replace = (await page.getByTestId('bar-replace-photo').boundingBox())!;
  expect(replace.height).toBeGreaterThanOrEqual(40);
  const more = (await page.getByTestId('bar-more').boundingBox())!;
  expect(more.x + more.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
  await shot(page, 'barra-foto-movil');

  // Con un texto elegido, la barra cambia a lo del texto.
  const title = await at(page, W / 2, 640);
  await page.mouse.click(title.x, title.y);
  await expect(page.getByTestId('bar-size-up')).toBeVisible();
  await page.getByTestId('bar-size-up').click();
  const textBar = await barInsideCanvas(page);
  const textMore = (await page.getByTestId('bar-more').boundingBox())!;
  expect(textMore.x + textMore.width).toBeLessThanOrEqual(textBar.x + textBar.width + 1);
  await shot(page, 'barra-texto-movil');
  expect((await draftLayers(page)).find((l) => l.id === 'titulo')).toMatchObject({ type: 'text' });

  expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
  expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
});

test('Esc al escribir en el lienzo conserva lo escrito y el borrador se guarda solo', async ({ page }) => {
  await open(page, 'titular', { width: 1366, height: 768 });
  const title = await at(page, W / 2, 600);
  await page.mouse.dblclick(title.x, title.y);
  const field = page.getByTestId('canvas-text-editor');
  await expect(field).toBeFocused();
  await page.keyboard.type('Menú de otoño');
  await page.keyboard.press('Escape');
  await expect(field).toBeHidden();
  // Lo escrito sigue ahí (antes, Esc lo borraba) y ya está guardado como borrador.
  const layers = await draftLayers(page);
  expect(layers.find((l) => l.id === 'titular')!.text).toBe('Menú de otoño');
  await expect(page.getByTestId('editor-dirty')).toHaveText('Borrador guardado');
});

test('la rueda del ratón acerca hacia el cursor y, con Espacio, se arrastra la vista', async ({ page }) => {
  await open(page, 'titular', { width: 1366, height: 768 });
  const before = await page.getByTestId('zoom-value').innerText();
  const point = await at(page, W * 0.75, H * 0.25);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  await expect(page.getByTestId('zoom-value')).not.toHaveText(before);
  await expect(page.getByTestId('zoom-out')).toBeEnabled();
  // Con Espacio pulsado aparece la mano; al soltarlo, desaparece.
  await page.locator('section[aria-label^="Lienzo"]').focus();
  await page.keyboard.down('Space');
  await expect(page.getByTestId('canvas-hand')).toBeVisible();
  await page.keyboard.up('Space');
  await expect(page.getByTestId('canvas-hand')).toBeHidden();
  expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
});

test('el botón derecho abre el menú de lo elegido (duplicar, orden, bloquear…)', async ({ page }) => {
  await open(page, 'dos', { width: 1366, height: 768 });
  const title = await at(page, W / 2, 640);
  await page.mouse.click(title.x, title.y, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('menu-duplicate')).toBeVisible();
  await expect(menu.getByTestId('menu-lock')).toBeVisible();
  await menu.getByTestId('menu-duplicate').click();
  await expect(page.getByRole('tab', { name: 'Capas (4)' })).toBeVisible();
});

test('móvil 375 px: «Diseño» tiene las fotos de la marca a mano y tocar una rellena el hueco', async ({ page }) => {
  await open(page, 'titular', { width: 375, height: 812 });
  await page.getByRole('tab', { name: 'Diseño' }).click();
  const photos = page.getByTestId('editor-photos');
  await expect(photos.getByTestId('photo-panel')).toBeVisible();
  // La hoja se desplaza por dentro; la página, no.
  expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
  await shot(page, 'fotos-movil');
  await photos.getByTestId('photo-panel-item').first().click();
  const layers = await draftLayers(page);
  expect(layers.find((l) => l.id === 'foto')!.source).toMatchObject({ kind: 'asset' });
  expect(layers).toHaveLength(3);
  // Al poner la foto la hoja se cierra: el lienzo se ve entero, con la barra de la foto.
  await expect(page.getByTestId('editor-panel-scroll')).toBeHidden();
  await expect(page.getByTestId('bar-replace-photo')).toBeVisible();
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  expect(stage.width).toBeGreaterThan(375 * 0.5);
  await shot(page, 'fotos-movil-puesta');
});

test('escritorio: las cuatro pestañas del panel caben a la vista y las fotos de la marca salen sin elegir nada', async ({
  page,
}) => {
  await open(page, 'titular', { width: 1366, height: 768 });
  const panels = (await page.getByTestId('editor-panels').boundingBox())!;
  for (const name of ['Diseño', /Capas/, 'Publicación', 'Marca']) {
    const tab = (await page.getByRole('tab', { name }).boundingBox())!;
    expect(tab.x + tab.width).toBeLessThanOrEqual(panels.x + panels.width);
  }
  await expect(page.getByTestId('editor-photos').getByTestId('photo-panel-item').first()).toBeVisible();
  await shot(page, 'fotos-escritorio');
});

test('«Publicar o compartir» reúne ver, descargar y publicar, y cabe en el móvil', async ({ page }) => {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 375, height: 812 },
  ]) {
    await open(page, 'titular', size);
    await page.getByTestId('editor-share').click();
    const menu = page.getByRole('menu');
    await expect(menu.getByTestId('editor-preview')).toBeVisible();
    await expect(menu.getByTestId('editor-export')).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    await shot(page, `compartir-${size.width}`);
    await page.keyboard.press('Escape');
    // La cabecera entera cabe: nada se sale por la derecha.
    const actions = (await page.getByTestId('page-actions').boundingBox())!;
    expect(actions.x + actions.width).toBeLessThanOrEqual(size.width);
    expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  }
});
