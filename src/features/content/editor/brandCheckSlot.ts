import type { ComponentType } from 'react';
import type { ContentDocument } from '../document';

// Hueco del panel de comprobación de marca en el editor. El panel lo construye
// otro bloque (`BrandCheckPanel`, en src/features/brandcheck/ui/); hasta que se
// conecte, este hueco está vacío y el editor no enseña la pestaña: lo que no
// existe no aparece (CLAUDE.md, honestidad del producto).
//
// Para conectarlo basta con asignar aquí el componente, por ejemplo:
//   export const BRAND_CHECK_PANEL = lazy(() =>
//     import('@/features/brandcheck/ui/BrandCheckPanel').then((m) => ({ default: m.BrandCheckPanel })));

/** Lo que el editor le pasa al panel: el documento tal como está (con los cambios sin guardar), la red, el formato y la marca. */
export interface BrandCheckPanelProps {
  document: ContentDocument;
  network: string;
  format: string;
  brandId: string;
}

export const BRAND_CHECK_PANEL: ComponentType<BrandCheckPanelProps> | null = null;
