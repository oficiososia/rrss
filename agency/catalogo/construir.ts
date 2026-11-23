// Montar un juego del catálogo con el tema de una marca y validarlo. Es puro
// (sin red ni sistema de archivos): lo usan la herramienta de la agencia (en
// Node) y la aplicación (en el navegador, «Cargar plantillas del catálogo»).
import { validateTemplatesDelivery, type TemplateInput } from '../../src/features/brand/templates.ts';
import { validateReelTemplatesDelivery, type ReelTemplateEntry } from '../../src/features/reels/reelTemplate.ts';
import {
  buildPublications,
  buildReels,
  buildStories,
  CATALOG_SETS,
  findSet,
  type CatalogSet,
  type Theme,
} from './index.ts';

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

export interface BuiltCatalog {
  set: CatalogSet;
  theme: Theme;
  publications: { file: unknown; templates: TemplateInput[] };
  /**
   * Historias de Instagram (9:16), si el juego las trae. Se entregan aparte de las
   * publicaciones (otra llamada a `deliver_design_templates`): cada entrega admite 12 como mucho.
   */
  stories: { file: unknown; templates: TemplateInput[] } | null;
  reels: { file: unknown; templates: ReelTemplateEntry[] };
}

/**
 * Arma un juego con el tema dado y lo valida con los mismos validadores que la entrega.
 * `styleIds` son los estilos de reel que conoce el trabajador. Lanza `CatalogError`.
 */
export function buildCatalogWith(setId: string, theme: Theme, styleIds: string[]): BuiltCatalog {
  const set = findSet(setId);
  if (!set) {
    throw new CatalogError(`No existe el juego «${setId}». Los que hay: ${CATALOG_SETS.map((s) => s.id).join(', ')}.`);
  }
  const publicationsFile = buildPublications(set, theme);
  const publications = validateTemplatesDelivery(publicationsFile, { defaultSource: 'manual' });
  if (!publications.ok) {
    throw new CatalogError(
      `Las publicaciones del juego «${set.id}» no son válidas:\n${publications.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
  }
  const storiesFile = buildStories(set, theme);
  let stories: BuiltCatalog['stories'] = null;
  if (storiesFile) {
    const checked = validateTemplatesDelivery(storiesFile, { defaultSource: 'manual' });
    if (!checked.ok) {
      throw new CatalogError(
        `Las historias del juego «${set.id}» no son válidas:\n${checked.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
      );
    }
    stories = { file: storiesFile, templates: checked.templates };
  }
  const reelsFile = buildReels(set, theme);
  const reels = validateReelTemplatesDelivery(reelsFile, styleIds);
  if (!reels.ok) {
    throw new CatalogError(
      `Los reels del juego «${set.id}» no son válidos:\n${reels.issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
    );
  }
  return {
    set,
    theme,
    publications: { file: publicationsFile, templates: publications.templates },
    stories,
    reels: { file: reelsFile, templates: reels.templates },
  };
}
