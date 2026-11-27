import type { Page } from '@playwright/test';

// Cuántas acciones propias se VEN en una pantalla (la simplificación aceptada las cuenta así):
// botones, enlaces y controles visibles dentro de una zona, sin contar los elementos de la lista
// (publicaciones, días, miniaturas…), que son el contenido y no acciones de la pantalla.

/** Las acciones visibles dentro de `root`, sin las que están dentro de `exclude` (selectores CSS). */
export function visibleActions(page: Page, root: string, exclude: string[]): Promise<string[]> {
  return page.evaluate(
    ({ root, exclude }) => {
      const area = document.querySelector(root);
      if (!area) return [];
      const candidates = area.querySelectorAll<HTMLElement>(
        'button, a[href], select, input:not([type="hidden"]), [role="tab"], [role="treeitem"]',
      );
      return [...candidates]
        .filter((el) => {
          if (exclude.some((sel) => el.closest(sel))) return false;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          if (box.bottom < 0 || box.top > window.innerHeight || box.right < 0 || box.left > window.innerWidth) return false;
          const style = getComputedStyle(el);
          return style.visibility !== 'hidden' && style.opacity !== '0';
        })
        .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40));
    },
    { root, exclude },
  );
}
