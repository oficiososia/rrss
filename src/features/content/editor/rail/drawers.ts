/** Cajones del editor de piezas (ver EditorRail.tsx). */
export type DrawerId = 'templates' | 'elements' | 'photos' | 'uploads' | 'brand';

export const DRAWER_TITLE: Record<DrawerId, string> = {
  templates: 'Plantillas',
  elements: 'Texto y elementos',
  photos: 'Fotos de la marca',
  uploads: 'Subidas',
  brand: 'Marca',
};
