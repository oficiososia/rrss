import { expect, test, type Page } from '@playwright/test';

// Contenidos, «¿Qué quieres crear?» y el Copiloto tras la simplificación aceptada (apartados 6 y 7 de
// rrss-recursos-comparativa/simplificacion/CAMBIOS.md): se cuentan las acciones que se VEN a 375 px
// (móvil táctil, sin «hover») y a 1366 px, sin abrir menús, como en el recorrido de la propuesta.
// Botones, enlaces, campos, pestañas y tarjetas que se tocan; sin el pie legal ni los enlaces que abren
// cada pieza (son el contenido, no acciones de la pantalla). Escribe las cuentas en la salida y, con
// CAPTURAS=<carpeta>, guarda capturas para revisarlas a ojo.
//
// Antes (medido el 24/11/2026 con este mismo contador sobre la rama base):
//   Contenidos       375: 9 de la pantalla + 3 por pieza (casilla, Duplicar, Archivar) · 1366: 10 + 1 por pieza (casilla)
//   «Nueva idea»     10 controles (4 formatos, nombre, «En blanco» / «Desde una plantilla», Cancelar, Crear y abrir, cerrar)
//   Copiloto         6 controles y 23 palabras (innerText del panel); con el aviso de dictado, 8–10 controles y un aviso de 64 palabras

const SIZES = [
  { name: 'móvil 375×812', width: 375, height: 812, mobile: true },
  { name: 'portátil 1366×768', width: 1366, height: 768, mobile: false },
];

/** Acciones visibles dentro de `root` (sin las que están dentro de `exclude`). */
const visibleActions = (page: Page, root: string, exclude: string[]) =>
  page.evaluate(
    ({ root, exclude }) => {
      const area = document.querySelector(root);
      if (!area) return [] as string[];
      const seen: string[] = [];
      const candidates = area.querySelectorAll<HTMLElement>(
        'button, a[href], select, textarea, input:not([type="hidden"]), [role="tab"], summary, label',
      );
      for (const el of candidates) {
        // Una tarjeta que es un <label> con su radio escondido cuenta como un control.
        if (el.tagName === 'LABEL' && !el.querySelector('input.sr-only')) continue;
        if (exclude.some((sel) => el.closest(sel))) continue;
        const box = el.getBoundingClientRect();
        if (box.width < 4 || box.height < 4) continue;
        if (box.bottom <= 0 || box.right <= 0 || box.top >= window.innerHeight || box.left >= window.innerWidth) continue;
        let hidden = false;
        for (let node: HTMLElement | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (Number(style.opacity) === 0 || style.visibility === 'hidden') hidden = true;
        }
        if (hidden) continue;
        seen.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30));
      }
      return seen;
    },
    { root, exclude },
  );

async function shot(page: Page, name: string) {
  if (process.env.CAPTURAS) await page.screenshot({ path: `${process.env.CAPTURAS}/${name}.png` });
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Lo que abre una pieza y el pie legal: no son acciones de la pantalla. */
const NOT_ACTIONS = [
  '[data-testid="content-open"]',
  '[data-testid="content-title"]',
  '[data-testid="content-published-link"]',
  '[data-testid="content-row"] > a',
  '[data-testid="legal-footer"]',
];

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, isMobile: size.mobile, hasTouch: size.mobile });

    test('Contenidos: buscar, «⋯», tres pestañas y fichas de formato; cada pieza, un «⋯»', async ({ page }) => {
      await page.goto('/inicio-contenidos.html?vista=contenidos');
      await expect(page.getByTestId('content-list')).toBeVisible();
      const screenActions = await visibleActions(page, 'main', [...NOT_ACTIONS, '[data-testid="content-list"]']);
      const piece = await visibleActions(page, 'main [data-testid="content-list"] > li:first-child', NOT_ACTIONS);
      await shot(page, `contenidos-${size.width}`);
      console.log(`Contenidos ${size.width}: ${screenActions.length} de la pantalla + ${piece.length} por pieza`, screenActions, piece);
      // Buscar, «⋯», 3 pestañas y 5 fichas (Todo, Reels, Publicaciones, Carruseles, Historias): las que
      // quepan sin desplazar (en el móvil las fichas se deslizan de lado).
      expect(screenActions.length).toBeLessThanOrEqual(10);
      expect(screenActions).not.toContain('Miniaturas');
      expect(screenActions).not.toContain('Lista');
      expect(await page.getByRole('tab').count()).toBe(3);
      // En el móvil el «⋯» de cada pieza está siempre a la vista; con ratón, al pasar por encima.
      expect(piece.length).toBeLessThanOrEqual(size.mobile ? 1 : 0);
      await expect(page.getByTestId('content-select')).toHaveCount(0);
      await expect(page.getByTestId('content-duplicate')).toHaveCount(0);
    });

    test('«¿Qué quieres crear?»: un paso, sin nombre ni «Crear»', async ({ page }) => {
      await page.goto('/inicio-contenidos.html?vista=vacia');
      await page.getByTestId('content-empty-new').click();
      await expect(page.getByRole('dialog', { name: '¿Qué quieres crear?' })).toBeVisible();
      const controls = await visibleActions(page, '[role="dialog"]', []);
      await shot(page, `crear-${size.width}`);
      console.log(`¿Qué quieres crear? ${size.width}: ${controls.length}`, controls);
      // Cerrar + Reel, Publicación, Carrusel, Historia (+ «Reel como este» si el servidor puede, + «Subir fotos» en el móvil).
      expect(controls.length).toBeLessThanOrEqual(size.mobile ? 7 : 6);
      await expect(page.getByTestId('create-content-title')).toHaveCount(0);
      await expect(page.getByTestId('create-content-submit')).toHaveCount(0);
    });

    test('Copiloto: campo con un solo botón al lado, «⋯» y cerrar; aviso de una línea al pulsar el micrófono', async ({ page }) => {
      await page.goto('/layout.html?ratio=4:5');
      await expect(page.getByTestId('editor-stage')).toHaveAttribute('data-ready', 'true');
      await page.getByTestId('copilot-open').click();
      const panel = page.getByTestId('copilot-panel');
      await expect(panel).toBeVisible();
      const controls = await visibleActions(page, '[data-testid="copilot-panel"]', []);
      const text = words(await panel.innerText());
      await shot(page, `copiloto-${size.width}`);
      console.log(`Copiloto ${size.width}: ${controls.length} controles, ${text} palabras`, controls);
      // «⋯», cerrar, el campo y un botón (micrófono o enviar). El texto: «Copiloto» y los nombres para
      // lector de pantalla del campo y del botón (innerText los cuenta, como en la medida de antes).
      expect(controls.length).toBeLessThanOrEqual(4);
      expect(text).toBeLessThanOrEqual(8);
      await expect(page.getByTestId('copilot-voice-notice')).toHaveCount(0);

      if ((await page.getByTestId('copilot-mic').count()) > 0) {
        await page.getByTestId('copilot-mic').click();
        const notice = page.getByTestId('copilot-voice-notice');
        await expect(notice).toBeVisible();
        const withNotice = await visibleActions(page, '[data-testid="copilot-panel"]', []);
        const noticeWords = words(await notice.innerText());
        await shot(page, `copiloto-aviso-${size.width}`);
        console.log(`Aviso de dictado ${size.width}: ${withNotice.length} controles, ${noticeWords} palabras`, withNotice);
        expect(noticeWords).toBeLessThanOrEqual(26);
        // + «Más» (política), «Dictar» y «Ahora no».
        expect(withNotice.length).toBeLessThanOrEqual(7);
      }

      // Con texto escrito, el micrófono deja sitio a «Enviar»: nunca los dos a la vez.
      await page.getByTestId('copilot-text-input').fill('más grande');
      await expect(page.getByTestId('copilot-text-send')).toBeVisible();
      await expect(page.getByTestId('copilot-mic')).toHaveCount(0);
    });
  });
}
