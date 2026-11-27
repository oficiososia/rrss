import {
  adaptDocument,
  duplicatePage,
  pageLimits,
  removePage,
  type AspectRatio,
  type ContentDocument,
} from '../document';
import { targetLabel } from '../labels';
import { allowedCanvasRatios, getFormatSpec, recommendedCanvasRatio } from '../networks';
import { templateFits, type BrandTemplate } from './api';

// Usar una plantilla en una pieza de OTRA proporción o con OTRO número de páginas:
// en vez de rechazarla, se adapta con las reglas de siempre (los anclajes de cada
// capa, `document/adapt.ts`) y se dice con claridad qué cambia.

export interface TemplateFit {
  document: ContentDocument;
  /** Qué se ha cambiado respecto a la plantilla, en frases para la persona. Vacío si encaja tal cual. */
  changes: string[];
}

/**
 * La plantilla lista para una red y un formato. Si ya encaja, tal cual. Si no:
 *  · proporción que la red no admite → se pasa a la de la pieza (si la admite) o a la
 *    recomendada por la red, recolocando las capas según su anclaje;
 *  · más páginas de las que admite → se usan las primeras;
 *  · menos de las que pide (un carrusel necesita 2) → se copia la última.
 * Devuelve null solo si el formato no se conoce o no admite ninguna proporción del lienzo.
 */
export function fitTemplate(
  template: BrandTemplate,
  target: { network: string; format: string },
  currentRatio?: AspectRatio,
): TemplateFit | null {
  const source = template.document;
  const spec = getFormatSpec(target.network, target.format);
  if (!source || !spec) return null;
  if (templateFits(template, target.network, target.format)) return { document: source, changes: [] };

  let document = source;
  const changes: string[] = [];
  const name = targetLabel(target.network, target.format);

  const media = spec.media.includes('image') ? 'image' : spec.media[0]!;
  const allowed = allowedCanvasRatios(spec, media);
  if (allowed && !allowed.ratios.includes(document.canvas.aspectRatio)) {
    const wanted =
      currentRatio && allowed.ratios.includes(currentRatio)
        ? currentRatio
        : (recommendedCanvasRatio(spec, media)?.ratio ?? allowed.ratios[0]);
    if (!wanted) return null;
    const from = document.canvas.aspectRatio;
    document = adaptDocument(document, wanted);
    changes.push(
      `La proporción pasa de ${from} a ${wanted} porque ${name} no admite ${from}: las capas se recolocan según su anclaje, así que revisa la composición.`,
    );
  }

  const limits = pageLimits(spec);
  const count = document.pages.length;
  if (count > limits.max) {
    let next = document;
    while (next.pages.length > limits.max) next = removePage(next, next.pages.length - 1)?.document ?? next;
    document = next;
    changes.push(
      limits.max === 1
        ? `La plantilla tiene ${count} páginas y ${name} lleva una sola: se usa la primera y las otras ${count - 1} no se aplican.`
        : `La plantilla tiene ${count} páginas y ${name} admite ${limits.max}: se usan las primeras ${limits.max}.`,
    );
  } else if (count < limits.min) {
    let next = document;
    while (next.pages.length < limits.min) {
      const copied = duplicatePage(next, next.pages.length - 1);
      if (!copied) break;
      next = copied.document;
    }
    document = next;
    changes.push(
      `La plantilla tiene ${count === 1 ? 'una página' : `${count} páginas`} y ${name} pide al menos ${limits.min}: se copia la última hasta llegar a ${limits.min}.`,
    );
  }
  return { document, changes };
}
