import { expect, test, type Page } from '@playwright/test';

// Editor de piezas «como Canva» (docs/ESTADO.md, F53): pocas acciones a la vista,
// cada una en un solo sitio, y la barra flotante sin tapar lo que hay debajo.
// Banco de tests/layout/marcos.tsx con la plantilla «Oferta de la semana» y la
// foto ya puesta. Se cuentan las acciones visibles como en el recorrido de la
// propuesta (rrss-recursos-comparativa/simplificacion): botones, enlaces,
// campos y pestañas que se ven en pantalla dentro del editor, sin abrir menús.
// Con CAPTURAS=<carpeta> guarda capturas para revisarlas a ojo.

const W = 1080;
const H = 1350;

const DESKTOP = { width: 1366, height: 768 };
const MOBILE = { width: 375, height: 812 };

async function open(page: Page, size: { width: number; height: number }, modo: 'self' | 'agency' = 'self') {
  await page.setViewportSize(size);
  await page.goto(`/marcos.html?caso=oferta&modo=${modo}`);
  await expect(page.getByTestId('editor-stage')).toBeVisible();
  await expect.poll(async () => (await page.getByTestId('editor-stage').boundingBox())!.width).toBeGreaterThan(100);
}

async function at(page: Page, x: number, y: number) {
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  return { x: stage.x + (x / W) * stage.width, y: stage.y + (y / H) * stage.height };
}

async function shot(page: Page, name: string) {
  if (process.env.CAPTURAS) await page.screenshot({ path: `${process.env.CAPTURAS}/${name}.png` });
}

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

/** Acciones a la vista dentro del editor (lo que se puede pulsar, elegir o escribir). Devuelve sus nombres. */
const visibleActions = (page: Page) =>
  page.getByTestId('editor-root').evaluate((root) => {
    const selector =
      'button, a[href], select, textarea, input:not([type="hidden"]):not([type="color"]):not([type="file"]), [role="tab"], summary';
    const seen: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      const box = el.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) continue; // solo para lector de pantalla
      if (box.bottom <= 0 || box.right <= 0 || box.top >= window.innerHeight || box.left >= window.innerWidth) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      // Lo que está debajo de otra cosa (tapado por una hoja) no cuenta.
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (hit && !el.contains(hit) && !hit.contains(el)) continue;
      seen.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30));
    }
    return seen;
  });

/** Se superponen dos cajas (con un píxel de tolerancia). */
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x + 1 < b.x + b.width && b.x + 1 < a.x + a.width && a.y + 1 < b.y + b.height && b.y + 1 < a.y + a.height;

for (const [name, size, limits] of [
  ['ordenador 1366×768', DESKTOP, { empty: 18, photo: 20 }],
  ['móvil 375×812', MOBILE, { empty: 16, photo: 18 }],
] as const) {
  test(`${name}: pocas acciones a la vista, sin scroll de página y cada una en un solo sitio`, async ({ page }) => {
    await open(page, size);
    const empty = await visibleActions(page);
    await shot(page, `acciones-sin-nada-${size.width}`);

    // Con la foto elegida.
    const photo = await at(page, 300, 300);
    await page.mouse.click(photo.x, photo.y);
    await expect(page.getByTestId('bar-replace-photo')).toBeVisible();
    const withPhoto = await visibleActions(page);
    await shot(page, `acciones-foto-${size.width}`);
    console.log(`${name}: ${empty.length} acciones sin nada elegido, ${withPhoto.length} con la foto elegida`);
    console.log(`  sin nada: ${empty.join(' | ')}`);
    console.log(`  con foto: ${withPhoto.join(' | ')}`);
    expect(empty.length).toBeLessThanOrEqual(limits.empty);
    expect(withPhoto.length).toBeLessThanOrEqual(limits.photo);

    // Cada acción del elemento, en un solo sitio: ni Duplicar ni Borrar se repiten a la vista.
    const repeated = withPhoto.filter((label, i) => withPhoto.indexOf(label) !== i && label !== '');
    expect(repeated).toEqual([]);
    expect(withPhoto.filter((label) => /^Duplicar|^Borrar/.test(label))).toEqual([]);
    // Ni panel de 4 pestañas, ni «Guardar versión», ni el estado de aprobación en la cabecera.
    await expect(page.getByRole('tab', { name: 'Publicación' })).toHaveCount(0);
    await expect(page.getByTestId('editor-save')).toHaveCount(0);
    await expect(page.getByTestId('editor-share')).toBeVisible();

    const scroll = await pageScroll(page);
    expect(scroll.vertical).toBeLessThanOrEqual(0);
    expect(scroll.horizontal).toBeLessThanOrEqual(0);
  });

  test(`${name}: con la foto de «Oferta de la semana» elegida, la barra flotante no tapa el titular ni la foto`, async ({
    page,
  }) => {
    await open(page, size);
    const photo = await at(page, 300, 300);
    await page.mouse.click(photo.x, photo.y);
    const bar = (await page.getByTestId('selection-toolbar').boundingBox())!;
    await shot(page, `barra-oferta-${size.width}`);
    const area = (await page.getByTestId('editor-canvas-area').boundingBox())!;
    expect(bar.x).toBeGreaterThanOrEqual(area.x - 1);
    expect(bar.y).toBeGreaterThanOrEqual(area.y - 1);
    expect(bar.x + bar.width).toBeLessThanOrEqual(area.x + area.width + 1);
    expect(bar.y + bar.height).toBeLessThanOrEqual(area.y + area.height + 1);

    // Cajas en pantalla de los textos de la plantilla y de la foto.
    const box = async (x: number, y: number, w: number, h: number) => {
      const a = await at(page, x, y);
      const b = await at(page, x + w, y + h);
      return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    };
    const texts = {
      titular: await box(72, 990, W - 144, 170),
      antetitulo: await box(72, 890, 660, 40),
      condiciones: await box(72, 1200, W - 144, 90),
      precio: await box(770, 772, 240, 100),
    };
    for (const [label, rect] of Object.entries(texts)) {
      expect(overlaps(bar, rect), `la barra tapa ${label}`).toBe(false);
    }
    // Encima del elemento elegido (la foto) tampoco, salvo que no quede otro sitio en la pantalla.
    const photoBox = await box(0, 0, W, 830);
    if (size.width > 1000) expect(overlaps(bar, photoBox), 'la barra tapa la foto elegida').toBe(false);
  });
}

test('ordenador: los cajones de la izquierda se abren y se cierran, y la página no se desplaza', async ({ page }) => {
  await open(page, DESKTOP);
  const rail = page.getByTestId('editor-rail');
  await expect(rail).toBeVisible();
  for (const drawer of ['photos', 'elements', 'uploads', 'brand']) {
    await page.getByTestId(`drawer-${drawer}`).click();
    await expect(page.getByTestId(`drawer-panel-${drawer}`)).toBeVisible();
    expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
    expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
    // El lienzo sigue entero a la vista.
    const stage = (await page.getByTestId('editor-stage').boundingBox())!;
    const area = (await page.getByTestId('editor-canvas-area').boundingBox())!;
    expect(stage.x + stage.width).toBeLessThanOrEqual(area.x + area.width + 1);
    await shot(page, `cajon-${drawer}`);
  }
  await page.getByTestId('drawer-close').click();
  await expect(page.getByTestId('drawer-panel-brand')).toHaveCount(0);
});

test('móvil: editor a pantalla completa, cajones en una barra inferior que abre hojas', async ({ page }) => {
  await open(page, MOBILE);
  // Sin la barra de navegación ni la cabecera de la app: el editor tapa la pantalla entera.
  const root = (await page.getByTestId('editor-root').boundingBox())!;
  expect(root.y).toBeLessThanOrEqual(1);
  expect(root.height).toBeGreaterThanOrEqual(MOBILE.height - 1);
  const bar = (await page.getByTestId('editor-rail').boundingBox())!;
  expect(bar.y + bar.height).toBeGreaterThanOrEqual(MOBILE.height - 2);
  await page.getByTestId('drawer-photos').click();
  const sheet = page.getByTestId('drawer-panel-photos');
  await expect(sheet).toBeVisible();
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  const sheetBox = (await sheet.boundingBox())!;
  expect(stage.y + stage.height).toBeLessThanOrEqual(sheetBox.y + 1);
  expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
  await shot(page, 'cajon-fotos-movil');
  // Tocar una foto la pone (en el hueco o como capa) y la hoja se cierra para ver cómo ha quedado.
  await sheet.getByTestId('photo-panel-item').first().click();
  await expect(sheet).toHaveCount(0);
});

for (const [name, size] of [
  ['ordenador', DESKTOP],
  ['móvil', MOBILE],
] as const) {
  test(`${name}: «Compartir» abre una hoja con la vista previa, el texto y las cuatro salidas`, async ({ page }) => {
    await open(page, size);
    await page.getByTestId('editor-share').click();
    const sheet = page.getByRole('dialog', { name: 'Compartir' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('share-preview')).toBeVisible();
    for (const id of ['share-download', 'share-publish-now', 'share-schedule', 'share-copy-text']) {
      await expect(sheet.getByTestId(id)).toBeVisible();
    }
    // Programado no es publicado: la hoja lo dice.
    await expect(sheet.getByTestId('share-schedule-note')).toContainText('no se publica hasta');
    // En autogestión no hay paso de aprobación a la vista.
    await expect(sheet.getByText(/Aprobar|Enviar a revisión|Aprobada/)).toHaveCount(0);
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
    await shot(page, `compartir-${size.width}`);
    expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  });
}
