import { expect, test, type Page } from '@playwright/test';

// El editor de reels en un navegador real, sin Supabase (banco de
// tests/layout/reel-editor.tsx, con un clip y una pista de verdad).
//
// Regla de la casa: la página mide lo que la ventana y no se desplaza; el vídeo,
// las herramientas y la línea de tiempo están siempre a la vista, en escritorio
// y en un móvil de 375 px (ahí, a pantalla completa, sin la barra de la
// aplicación). Como CapCut: pocas acciones a la vista (se cuentan) y un solo
// «Exportar». Y lo que jsdom no puede comprobar: que la vista
// previa se reproduce, que la línea de tiempo se desliza bajo el cabezal fijo,
// que salen las miniaturas de los clips y la onda de la música, y que un texto
// se arrastra sobre el vídeo.

const SIZES = [
  { name: 'escritorio 1440×900', width: 1440, height: 900, mobile: false },
  { name: 'portátil 1366×768', width: 1366, height: 768, mobile: false },
  { name: 'móvil 375×812', width: 375, height: 812, mobile: true },
];

const open = async (page: Page, query = '') => {
  await page.goto(`/reel-editor.html${query ? `?${query}` : ''}`);
  await expect(page.getByTestId('reel-editor')).toBeVisible();
};

const pageScroll = (page: Page) =>
  page.evaluate(() => ({
    vertical: document.scrollingElement!.scrollHeight - window.innerHeight,
    horizontal: document.scrollingElement!.scrollWidth - window.innerWidth,
  }));

const box = async (page: Page, testId: string) => (await page.getByTestId(testId).first().boundingBox())!;

/**
 * Acciones a la vista en el editor (botones, enlaces y campos), sin contar la línea de tiempo (sus
 * elementos y su zoom) ni lo que hay sobre el vídeo (los textos que se arrastran). Las de un menú «⋯»
 * cerrado no cuentan: no se ven.
 */
const visibleActions = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="reel-editor"]')!;
    const skip = '[data-testid="reel-timeline-area"], [data-testid="reel-stage"]';
    return [...root.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type="hidden"]), textarea')]
      .filter((el) => {
        if (el.closest(skip)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .map((el) => el.getAttribute('aria-label') || el.textContent?.trim() || el.tagName);
  });

/** Lo que marca el reloj de la vista previa, en segundos. */
const time = async (page: Page) =>
  Number(((await page.getByTestId('reel-time').textContent()) ?? '0').split('/')[0]!.trim().replace(',', '.'));

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test('con 12 elementos: sin scroll de página y vídeo, barra y línea de tiempo a la vista', async ({ page }) => {
      await open(page, 'clips=12&musica=1');
      await expect(page.getByTestId('reel-clip')).toHaveCount(12);
      const scroll = await pageScroll(page);
      expect(scroll.vertical).toBeLessThanOrEqual(0);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);
      await expect(page.getByTestId('legal-footer')).toHaveCount(0);

      // La vista previa es 9:16 de verdad y cabe entera.
      const frame = await box(page, 'reel-frame');
      expect(frame.width / frame.height).toBeCloseTo(9 / 16, 1);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(size.height);
      // Grande: al menos un tercio del alto de la pantalla (en móvil, más de la mitad).
      expect(frame.height).toBeGreaterThan(size.height * (size.mobile ? 0.45 : 0.33));
      // La cabecera cabe en una línea: volver, nombre, guardado, deshacer, «⋯» y «Exportar».
      const back = await box(page, 'page-actions');
      const exportButton = await box(page, 'reel-export');
      expect(exportButton.x + exportButton.width).toBeLessThanOrEqual(size.width + 1);
      expect(Math.abs(back.y + back.height / 2 - (exportButton.y + exportButton.height / 2))).toBeLessThan(4);
      if (size.mobile) {
        // A pantalla completa: el editor tapa la cabecera de la marca y la barra de la aplicación.
        const editor = await box(page, 'reel-editor');
        expect(editor.y).toBeLessThanOrEqual(0);
        expect(editor.height).toBeGreaterThanOrEqual(size.height - 1);
        const onTop = await page.evaluate(
          ([x, y]) => Boolean(document.elementFromPoint(x!, y!)?.closest('[data-testid="reel-editor"]')),
          [size.width / 2, size.height - 4],
        );
        expect(onTop).toBe(true);
        // La barra inferior de la aplicación (con «＋ Crear») queda debajo: ni se ve ni se puede tocar.
        const nav = page.getByTestId('mobile-nav');
        if ((await nav.count()) > 0) {
          const bar = (await nav.boundingBox())!;
          const covered = await page.evaluate(
            ([x, y]) => Boolean(document.elementFromPoint(x!, y!)?.closest('[data-testid="reel-editor"]')),
            [bar.x + bar.width / 2, bar.y + bar.height / 2],
          );
          expect(covered).toBe(true);
        }
      }

      // La línea de tiempo y la barra de herramientas, enteras dentro de la ventana.
      const timeline = await box(page, 'reel-timeline-frame');
      const bar = await box(page, 'reel-toolbar');
      for (const part of [timeline, bar]) {
        expect(part.x).toBeGreaterThanOrEqual(0);
        expect(part.x + part.width).toBeLessThanOrEqual(size.width + 1);
        expect(part.y + part.height).toBeLessThanOrEqual(size.height + 1);
      }
      expect(frame.y + frame.height).toBeLessThanOrEqual(timeline.y + 1);
      // En móvil la barra va abajo del todo (bajo la línea de tiempo); en escritorio, entre el vídeo y la línea.
      if (size.mobile) expect(bar.y).toBeGreaterThanOrEqual(timeline.y + timeline.height - 1);
      else expect(bar.y + bar.height).toBeLessThanOrEqual(timeline.y + 1);

      // El cabezal está fijo en el centro de la línea de tiempo.
      const playhead = await box(page, 'reel-playhead');
      expect(Math.abs(playhead.x + playhead.width / 2 - (timeline.x + timeline.width / 2))).toBeLessThan(2);

      // «Exportar» y el estado del guardado, a un toque arriba.
      expect(exportButton.y + exportButton.height).toBeLessThan(frame.y + 1);
      await expect(page.getByTestId('reel-autosave')).toHaveText('Guardado');
      await page.screenshot({ path: `test-results/reel-editor-${size.width}.png` });
    });

    test(`con un clip elegido hay ${size.mobile ? 12 : 13} acciones a la vista como mucho`, async ({ page }) => {
      await open(page, 'clips=6&musica=1');
      await page.getByTestId('reel-clip').nth(1).getByRole('button').first().click();
      await expect(page.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'clip');
      const actions = await visibleActions(page);
      // Antes de simplificarlo eran 52 en el portátil y 22 en el móvil (más las 7 de la aplicación).
      expect(actions.length, actions.join(' · ')).toBeLessThanOrEqual(size.mobile ? 12 : 13);
      expect(actions).toContain('Exportar');
      expect(actions.filter((a) => a === 'Exportar')).toHaveLength(1);
      // Nada de lo que se quitó: ni guardar versión, ni enviar a revisión, ni montar, ni ver el vídeo.
      expect(actions.join(' ')).not.toMatch(/Guardar versión|Enviar a revisión|Montar|Ver el vídeo/);
      const scroll = await pageScroll(page);
      expect(scroll.vertical).toBeLessThanOrEqual(0);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);
    });

    test('elegir un clip cambia la barra; cada herramienta abre solo su ajuste sin mover la página', async ({ page }) => {
      await open(page, 'clips=12');
      await expect(page.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'none');
      await page.getByTestId('reel-clip').nth(1).getByRole('button').first().click();
      await expect(page.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'clip');
      // Los botones de la barra son grandes (al menos 44 px de alto en móvil) y el primero se ve.
      const split = await box(page, 'reel-bar-split');
      expect(split.height).toBeGreaterThanOrEqual(size.mobile ? 44 : 40);
      expect(split.x).toBeGreaterThanOrEqual(0);

      // Elegir no abre nada: el vídeo sigue grande hasta que se pide una herramienta.
      const panel = page.getByTestId('reel-panel');
      await expect(panel).toBeHidden();
      await page.getByTestId('reel-bar-speed').click();
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('reel-speed')).toBeVisible();
      // Solo su ajuste: ni el tiempo ni el filtro del clip.
      await expect(panel.locator('[data-section="trim"]')).toBeHidden();
      await expect(panel.locator('[data-section="filter"]')).toBeHidden();
      expect((await pageScroll(page)).vertical).toBeLessThanOrEqual(0);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      const sheet = (await panel.boundingBox())!;
      expect(sheet.x).toBeGreaterThanOrEqual(0);
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(size.width + 1);
      expect(sheet.y + sheet.height).toBeLessThanOrEqual(size.height + 1);
      if (size.mobile) {
        // La hoja sube desde abajo y deja a la vista buena parte del vídeo.
        const frame = await box(page, 'reel-frame');
        expect(sheet.y).toBeGreaterThan(frame.y + frame.height * 0.3);
        await page.screenshot({ path: `test-results/reel-editor-${size.width}-hoja.png` });
        await page.getByTestId('reel-panel-close').click();
        await expect(panel).toBeHidden();
      } else {
        // En escritorio, un panel estrecho al lado del vídeo.
        const frame = await box(page, 'reel-frame');
        expect(sheet.x).toBeGreaterThan(frame.x + frame.width);
        expect(sheet.width).toBeLessThan(size.width * 0.3);
      }
      // Al doble de velocidad el clip ocupa la mitad en la línea de tiempo.
      const before = (await page.getByTestId('reel-clip').nth(1).boundingBox())!.width;
      if (size.mobile) await page.getByTestId('reel-bar-speed').click();
      await page.getByTestId('reel-speed').getByRole('radio', { name: '2×' }).click();
      const after = (await page.getByTestId('reel-clip').nth(1).boundingBox())!.width;
      expect(after).toBeLessThan(before * 0.6);
    });

    test('«Exportar» abre la hoja con descargar, biblioteca y publicar o programar, sin salirse', async ({ page }) => {
      await open(page, 'clips=6');
      await page.getByTestId('reel-export').click();
      const sheet = page.getByTestId('reel-export-sheet');
      await expect(sheet).toBeVisible();
      for (const id of ['reel-export-download', 'reel-export-library', 'reel-export-publish']) {
        const row = await box(page, id);
        expect(row.x).toBeGreaterThanOrEqual(0);
        expect(row.x + row.width).toBeLessThanOrEqual(size.width + 1);
      }
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/reel-editor-${size.width}-exportar.png` });
    });

    test('«Publicar o programar»: pie, hashtags y cuándo, con el vídeo ya montado y sin salirse', async ({ page }) => {
      await open(page, 'clips=6&montado=1&modo=propio');
      await page.getByTestId('reel-export').click();
      const sheet = page.getByTestId('reel-export-sheet');
      await expect(sheet).toHaveAttribute('data-state', 'ready');
      await page.getByTestId('reel-export-publish').click();
      await expect(page.getByTestId('reel-publish-panel')).toBeVisible();
      await page.getByTestId('reel-caption').fill('Menú de otoño: ven este finde.');
      await page.getByTestId('reel-publish-mode-schedule').click();
      await expect(page.getByTestId('reel-publish-when')).toBeVisible();
      for (const id of ['reel-caption', 'reel-hashtags', 'reel-publish-when', 'reel-publish-submit']) {
        const part = await box(page, id);
        expect(part.x).toBeGreaterThanOrEqual(0);
        expect(part.x + part.width).toBeLessThanOrEqual(size.width + 1);
      }
      await expect(page.getByTestId('reel-publish-submit')).toBeEnabled();
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/reel-editor-${size.width}-publicar.png` });
    });

    test('«Terminar en Instagram»: pie, botón, código QR, pasos y ayuda, sin salirse', async ({ page }) => {
      // A 375 y 1366 px (lo que pide el caso); a 1440 cabe con más motivo.
      test.skip(size.width === 1440, 'basta con 375 y 1366 px');
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await open(page, 'clips=6&montado=1&modo=propio');
      await page.getByTestId('reel-export').click();
      await expect(page.getByTestId('reel-export-sheet')).toHaveAttribute('data-state', 'ready');
      const row = page.getByTestId('reel-export-instagram');
      await expect(row).toContainText('Terminar en Instagram (para poner música)');
      const rowBox = await box(page, 'reel-export-instagram');
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(size.width + 1);
      await row.click();
      const panel = page.getByTestId('reel-instagram-panel');
      await expect(panel).toBeVisible();
      // En Chromium de escritorio (sin pantalla táctil) se descarga y se enseña el QR.
      await expect(panel).toHaveAttribute('data-mode', 'download');
      await page.getByTestId('reel-caption').fill('Menú de otoño: ven este finde.');
      const send = page.getByTestId('reel-instagram-send');
      await expect(send).toBeEnabled();
      const download = page.waitForEvent('download');
      await send.click();
      expect((await download).suggestedFilename()).toBe('reel.mp4');
      await expect(page.getByTestId('reel-instagram-qr')).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Menú de otoño: ven este finde.');
      await page.getByTestId('reel-instagram-help').locator('summary').click();
      for (const id of ['reel-caption', 'reel-instagram-send', 'reel-instagram-qr', 'reel-instagram-steps']) {
        const part = await box(page, id);
        expect(part.x, id).toBeGreaterThanOrEqual(0);
        expect(part.x + part.width, id).toBeLessThanOrEqual(size.width + 1);
      }
      // El QR se lee: al menos 140 px de lado.
      expect((await box(page, 'reel-instagram-qr')).width).toBeGreaterThanOrEqual(140);
      expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/reel-editor-${size.width}-instagram.png` });
    });

    test('un aviso no tapa la cabecera ni la barra de herramientas', async ({ page }) => {
      await open(page, 'clips=6');
      // Con el cabezal al principio no se puede dividir: sale un aviso.
      await page.getByTestId('reel-clip').first().getByRole('button').first().click();
      await page.keyboard.press('Home');
      await page.keyboard.press('s');
      const toast = page.locator('[data-sonner-toast]').first();
      await expect(toast).toBeVisible();
      // Espera a que termine de entrar (deja de moverse).
      await expect
        .poll(async () => {
          const a = (await toast.boundingBox())!.y;
          await page.waitForTimeout(150);
          return Math.abs((await toast.boundingBox())!.y - a);
        })
        .toBeLessThan(1);
      const note = (await toast.boundingBox())!;
      const header = await box(page, 'reel-export');
      const bar = await box(page, 'reel-toolbar');
      if (size.mobile) expect(note.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(note.y + note.height).toBeLessThanOrEqual(bar.y);
      // Y «Exportar» sigue respondiendo con el aviso a la vista.
      await page.getByTestId('reel-export').click();
      await expect(page.getByTestId('reel-export-sheet')).toBeVisible();
    });

    test('un reel nuevo: «Empieza tu reel» cabe y solo se desplaza por dentro', async ({ page }) => {
      await open(page, 'vacio=1');
      await expect(page.getByText('Empieza tu reel en tres pasos')).toBeVisible();
      const scroll = await pageScroll(page);
      expect(scroll.vertical).toBeLessThanOrEqual(0);
      expect(scroll.horizontal).toBeLessThanOrEqual(0);
    });
  });
}

test.describe('lo que solo se ve en un navegador', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
  });

  test('desplazar la línea mueve el cabezal; al reproducir, la línea se desliza sola y el reloj avanza', async ({
    page,
  }) => {
    await open(page, 'clips=12');
    const scroller = page.getByTestId('reel-timeline');
    expect(await time(page)).toBe(0);
    // 180 px a 60 px por segundo: el cabezal va al segundo 3.
    await scroller.evaluate((el) => {
      el.scrollLeft = 180;
    });
    await expect.poll(() => time(page)).toBeCloseTo(3, 1);

    // En el segundo 3 se ve un clip: su fotograma está dibujado en la vista previa (no negro).
    const colour = () =>
      page.getByTestId('reel-preview').evaluate((canvas: HTMLCanvasElement) => {
        const { data } = canvas.getContext('2d')!.getImageData(canvas.width / 2, 20, 1, 1);
        return data[0]! + data[1]! + data[2]!;
      });
    await expect.poll(colour).toBeGreaterThan(90);

    await page.getByTestId('reel-play').click();
    // Sin límite propio: el reloj solo avanza cuando el vídeo tiene el fotograma, y con la máquina
    // cargada se midió 0,9 s de reproducción en 10 s. Vale el de playwright.layout.config.ts (30 s).
    await expect.poll(() => time(page)).toBeGreaterThan(4);
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(230);
    await page.getByTestId('reel-play').click();
    const stopped = await time(page);
    await page.waitForTimeout(400);
    expect(await time(page)).toBe(stopped);

    // Reproducir no repinta la pantalla entera: en medio segundo, la barra de herramientas no cambia de nodo.
    await page.keyboard.press('Home');
    expect(await time(page)).toBe(0);
    // Espacio reproduce y vuelve a parar.
    await page.keyboard.press('Space');
    await expect(page.getByTestId('reel-play')).toHaveAccessibleName('Pausar la vista previa');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('reel-play')).toHaveAccessibleName('Reproducir la vista previa');
  });

  test('reproduce 15 elementos sin dar saltos (los fotogramas llegan a buen ritmo)', async ({ page }) => {
    await open(page, 'clips=15&musica=1');
    await expect(page.getByTestId('reel-clip')).toHaveCount(15);
    await page.getByTestId('reel-play').click();
    // Fotogramas de animación durante 3 s de reproducción, pasando por fotos, clips y transiciones.
    const stats = await page.evaluate(
      () =>
        new Promise<{ frames: number; worst: number }>((resolve) => {
          let frames = 0;
          let worst = 0;
          let last = performance.now();
          const start = last;
          const tick = (now: number) => {
            frames += 1;
            worst = Math.max(worst, now - last);
            last = now;
            if (now - start < 3000) requestAnimationFrame(tick);
            else resolve({ frames, worst });
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.getByTestId('reel-play').click();
    // Con holgura para una máquina de pruebas cargada: más de 20 fotogramas por segundo y ningún parón de medio segundo.
    expect(stats.frames).toBeGreaterThan(60);
    expect(stats.worst).toBeLessThan(500);
    expect(await time(page)).toBeGreaterThan(2);
  });

  test('las tiras de la línea de tiempo llevan miniaturas de verdad y la música su forma de onda', async ({ page }) => {
    await open(page, 'clips=6&musica=1');
    // Foto: su imagen de fondo, repetida.
    const photo = page.getByTestId('reel-clip').first().getByTestId('reel-strip');
    await expect
      .poll(() => photo.evaluate((el) => getComputedStyle(el).backgroundImage))
      .toContain('data:image/svg+xml');
    // Clip: fotogramas sacados del archivo (píxeles con color en su lienzo).
    const strip = page.getByTestId('reel-clip').nth(1).locator('canvas');
    await expect
      .poll(() =>
        strip.evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted += 1;
          return painted / (data.length / 4);
        }),
      )
      .toBeGreaterThan(0.9);
    // Música: la onda aparece cuando el archivo se ha decodificado.
    await expect(page.getByTestId('reel-waveform')).toBeVisible();
    // Elegir algo de la línea no mueve el cabezal: ni la música (más ancha que la pantalla) ni un clip a medias.
    await page.getByTestId('reel-timeline').evaluate((el) => {
      el.scrollLeft = 180;
    });
    await expect.poll(() => time(page)).toBeCloseTo(3, 1);
    await page.getByTestId('reel-music-block').click({ position: { x: 300, y: 10 } });
    await expect(page.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'music');
    await page.getByTestId('reel-clip').nth(3).getByRole('button').first().click();
    await expect(page.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'clip');
    expect(await time(page)).toBeCloseTo(3, 1);
    await page.screenshot({ path: 'test-results/reel-editor-miniaturas.png' });
  });

  test('Ctrl + rueda y los botones amplían la línea de tiempo; «ajustar» enseña el reel entero', async ({ page }) => {
    await open(page, 'clips=12');
    const first = page.getByTestId('reel-clip').first();
    const before = (await first.boundingBox())!.width;
    await page.getByTestId('reel-timeline').hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await first.boundingBox())!.width).toBeGreaterThan(before * 1.3);
    await page.getByTestId('reel-zoom-out').click();
    await page.getByTestId('reel-zoom-out').click();
    await expect.poll(async () => (await first.boundingBox())!.width).toBeLessThan(before);
    await page.getByTestId('reel-zoom-fit').click();
    // El reel entero cabe en el ancho de la línea de tiempo.
    const frame = await box(page, 'reel-timeline-frame');
    const widths = await page.getByTestId('reel-clip').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(frame.width);
    expect((await pageScroll(page)).horizontal).toBeLessThanOrEqual(0);
  });

  test('dividir en el cabezal y deshacer; un texto se arrastra sobre el vídeo', async ({ page }) => {
    await open(page, 'clips=6');
    await page.getByTestId('reel-clip').first().getByRole('button').first().click();
    await page.getByTestId('reel-timeline').evaluate((el) => {
      el.scrollLeft = 60;
    });
    await expect.poll(() => time(page)).toBeCloseTo(1, 1);
    await page.getByTestId('reel-bar-split').click();
    await expect(page.getByTestId('reel-clip')).toHaveCount(7);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('reel-clip')).toHaveCount(6);

    // El texto «Menú de otoño» está en el centro: se arrastra hacia arriba.
    const text = page.getByTestId('reel-text-box').first();
    const from = (await text.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 30, from.y - 80, { steps: 6 });
    await expect(page.getByTestId('reel-safe-zones')).toBeVisible();
    await page.mouse.up();
    const to = (await text.boundingBox())!;
    expect(to.y).toBeLessThan(from.y - 50);
    expect(to.x).toBeGreaterThan(from.x + 15);
    await expect(page.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'text');
    // Dos clics: se escribe sobre el vídeo.
    await text.dblclick();
    await page.getByTestId('reel-text-inline').fill('Menú de invierno');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('reel-text-block').first()).toContainText('Menú de invierno');
    await page.screenshot({ path: 'test-results/reel-editor-texto.png' });
  });
});
