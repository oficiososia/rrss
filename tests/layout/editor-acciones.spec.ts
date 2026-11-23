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
  await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
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
  // Cabecera (volver, tipo de pieza, deshacer, rehacer —en el móvil no—, «⋯», Compartir) + 5 cajones + barra de la foto
  // (Sustituir, Editar foto, Recortar, «⋯») + fila del lienzo (capas, zonas seguras, zoom y copiloto).
  ['ordenador 1366×768', DESKTOP, { empty: 17, photo: 21 }],
  ['móvil 375×812', MOBILE, { empty: 13, photo: 17 }],
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
  // El lienzo se reajusta (mide su hueco) y queda entero encima de la hoja.
  const sheetBox = (await sheet.boundingBox())!;
  await expect
    .poll(async () => {
      const stage = (await page.getByTestId('editor-stage').boundingBox())!;
      return stage.y + stage.height;
    })
    .toBeLessThanOrEqual(sheetBox.y + 1);
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
    // Descargar y copiar el texto, siempre; publicar y programar, si la publicación está activa en el
    // entorno (en este banco no lo está) y hay cuenta conectada.
    for (const id of ['share-download', 'share-copy-text']) await expect(sheet.getByTestId(id)).toBeVisible();
    if (await sheet.getByTestId('share-schedule').count()) {
      await expect(sheet.getByTestId('share-publish-now')).toBeVisible();
      // Programado no es publicado: la hoja lo dice.
      await expect(sheet.getByTestId('share-schedule-note')).toContainText('no se publica hasta');
    }
    // En autogestión no hay paso de aprobación a la vista.
    await expect(sheet.getByText(/Aprobar|Enviar a revisión|Aprobada/)).toHaveCount(0);
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
    await shot(page, `compartir-${size.width}`);
    expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  });
}

test('ordenador: una foto agrandada más allá del lienzo se ve fuera, velada, y se agarra por lo que sobresale', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/marcos.html?caso=grande&modo=self');
  await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await page.getByTestId('editor-stage').boundingBox())!.width).toBeGreaterThan(100);
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  // Un punto de la foto FUERA del lienzo (a su izquierda), dentro del área.
  const outside = await at(page, -200, 650);
  expect(outside.x).toBeLessThan(stage.x);
  // Lo que sobresale se pinta (velado): el píxel no es el fondo liso del área.
  const color = await page.evaluate(({ x, y }) => {
    const canvases = [...document.querySelectorAll('[data-testid="editor-konva"] canvas')] as HTMLCanvasElement[];
    const content = canvases[0]!;
    const box = content.getBoundingClientRect();
    const ratio = content.width / box.width;
    const pixel = content.getContext('2d')!.getImageData((x - box.left) * ratio, (y - box.top) * ratio, 1, 1).data;
    return [...pixel];
  }, outside);
  expect(color[3]).toBeGreaterThan(0);
  await shot(page, 'foto-sobresale');

  // Se elige y se arrastra agarrándola por fuera del lienzo.
  await page.mouse.click(outside.x, outside.y);
  await expect(page.getByTestId('bar-replace-photo')).toBeVisible();
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.down();
  await page.mouse.move(outside.x + 60, outside.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('editor-dirty')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
  const moved = await page.evaluate(() => {
    const rows = (
      window as unknown as { drafts: () => { data: { pages: { layers: { id: string; x: number }[] }[] } }[] }
    ).drafts();
    return rows[0]!.data.pages[0]!.layers.find((l) => l.id === 'foto')!.x;
  });
  expect(moved).toBeGreaterThan(-400);
  await shot(page, 'foto-sobresale-movida');
});

test('ordenador: el divisor entre el cajón y el lienzo se arrastra, va con flechas, vuelve con doble clic y se recuerda', async ({
  page,
}) => {
  await open(page, { width: 1872, height: 1000 });
  await page.getByTestId('drawer-photos').click();
  const panel = page.getByTestId('drawer-panel-photos');
  const divider = page.getByTestId('drawer-panel-photos-divider');
  await expect(divider).toBeVisible();
  const before = (await panel.boundingBox())!.width;
  const stageBefore = (await page.getByTestId('editor-stage').boundingBox())!.width;
  // Arrastrar el tirador 120 px a la derecha agranda el cajón; el lienzo se reajusta.
  const handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 120, handle.y + handle.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before + 120));
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.round(before + 120)));
  const stage = (await page.getByTestId('editor-stage').boundingBox())!;
  const area = (await page.getByTestId('editor-canvas-area').boundingBox())!;
  expect(stage.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(stage.x + stage.width).toBeLessThanOrEqual(area.x + area.width + 1);
  expect(stageBefore).toBeGreaterThan(0);
  await shot(page, 'divisor-arrastrado');
  // Con el teclado: flechas de 16 en 16, y nunca por encima del máximo ni por debajo del mínimo.
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.round(before + 104)));
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '560');
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '240');
  // Se recuerda al volver a abrir el editor.
  await page.reload();
  await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('drawer-photos').click();
  await expect(page.getByTestId('drawer-panel-photos-divider')).toHaveAttribute('aria-valuenow', '240');
  // Doble clic: el de siempre.
  await page.getByTestId('drawer-panel-photos-divider').dblclick();
  await expect(page.getByTestId('drawer-panel-photos-divider')).toHaveAttribute(
    'aria-valuenow',
    String(Math.round(before)),
  );
  expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
});

test('móvil: no hay divisor (los cajones son hojas)', async ({ page }) => {
  await open(page, MOBILE);
  await page.getByTestId('drawer-photos').click();
  await expect(page.getByTestId('drawer-panel-photos-divider')).toBeHidden();
});

test.describe('móvil 375 px: los fallos de la prueba real (informe e2e, fallo 13 y 12)', () => {
  test('«Poner foto» sale en el hueco de «Titular sobre foto», bajo el velo y el titular', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/marcos.html?caso=titular&modo=self');
    await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
    // El botón del hueco esquiva el titular del centro: arriba, al 20 %.
    const pill = await at(page, W / 2, H * 0.2);
    await page.mouse.click(pill.x, pill.y);
    await expect(page.getByRole('dialog', { name: 'Poner foto' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Y el aviso «Falta 1 foto» se ve (abajo, junto a «Capas»).
    await expect(page.getByTestId('editor-empty-frames-mobile')).toBeVisible();
    await expect(page.getByTestId('editor-empty-frames-mobile')).toBeInViewport();
  });

  test('escribir un texto con «Capas» abierta no cambia de panel; el copiloto está a la vista y abre al primer toque', async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/marcos.html?caso=titular&modo=self');
    await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
    await page.getByTestId('editor-layers').click();
    await expect(page.getByTestId('side-panel-layers')).toBeVisible();
    const title = await at(page, W / 2, 600);
    await page.mouse.dblclick(title.x, title.y);
    const field = page.getByTestId('canvas-text-editor');
    await expect(field).toBeFocused();
    await page.keyboard.type(' de otoño');
    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    await expect(page.getByTestId('side-panel-layers')).toBeVisible();
    await page.getByTestId('side-close').click();

    const copilot = page.getByTestId('copilot-open');
    await expect(copilot).toBeInViewport({ ratio: 1 });
    await copilot.click();
    await expect(page.getByTestId('copilot-panel')).toBeVisible();
    expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  });

  test('un aviso flotante no tapa los botones de la cabecera', async ({ page }) => {
    await open(page, MOBILE);
    // «Copiar el texto» sin pie: sale el aviso «Todavía no hay texto…» (y sigue al cerrar la hoja).
    await page.getByTestId('editor-share').click();
    await page.getByTestId('share-copy-text').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Compartir' })).toBeHidden();
    const notice = page.getByText('Todavía no hay texto de la publicación que copiar.');
    await expect(notice).toBeVisible();
    // «Compartir» se puede tocar con el aviso a la vista (nada lo tapa).
    await page.getByTestId('editor-share').click({ trial: true, timeout: 3000 });
    const toast = (await notice.boundingBox())!;
    const header = (await page.getByTestId('editor-header').boundingBox())!;
    expect(toast.y).toBeGreaterThanOrEqual(header.y + header.height - 2);
  });
});
