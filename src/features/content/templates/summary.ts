import { photoCount, type BrandTemplate } from './api';

// Textos de las tarjetas de plantilla: una frase corta de para qué sirve, y el resto
// (texto largo de la agencia, tipo de foto, cuántas veces se repite) en «Ver más».
// Sin campo nuevo ni migración: la frase corta es la primera del resumen del análisis.

/** «PROPUESTA de la agencia (no observada en el feed): …». */
const AGENCY_PREFIX = /^\s*propuesta de la agencia\b[^:]*:\s*/i;

function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/s.exec(text);
  return (match ? match[0] : text).trim();
}

/** Resumen sin la etiqueta de la agencia y con la primera letra en mayúscula. */
export function cleanSummary(summary: string): string {
  const text = summary.replace(AGENCY_PREFIX, '').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Una frase corta (hasta `max` caracteres) de para qué sirve la plantilla; '' si no hay resumen. */
export function shortSummary(summary: string | undefined, max = 100): string {
  if (!summary) return '';
  const sentence = firstSentence(cleanSummary(summary));
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/** Cuántas fotos pide, dicho sin jerga. */
export function photosLine(count: number): string {
  if (count === 0) return 'Solo texto y formas';
  return count === 1 ? 'Con hueco para 1 foto' : `Con hueco para ${count} fotos`;
}

export interface TemplateDetail {
  /** El resumen completo, si dice más que la frase corta. */
  summary: string | null;
  /** Es una propuesta de la agencia y no algo visto en las publicaciones de la marca. */
  proposal: boolean;
  photo: string | null;
  repeats: string | null;
}

/** Lo que va en «Ver más». Todo null si no hay nada más que contar. */
export function templateDetail(template: BrandTemplate): TemplateDetail {
  const analysis = template.analysis;
  if (!analysis || template.source === 'editor') return { summary: null, proposal: false, photo: null, repeats: null };
  const full = cleanSummary(analysis.summary);
  const short = shortSummary(analysis.summary);
  const recurrence = template.source === 'instagram_import' ? analysis.recurrence : null;
  return {
    summary: full && full !== short ? full : null,
    proposal: AGENCY_PREFIX.test(analysis.summary),
    photo: analysis.photo.type.trim() || null,
    repeats: recurrence
      ? `La marca ya usa este diseño en ${recurrence.count} de ${recurrence.reviewed} publicaciones revisadas.`
      : null,
  };
}

export function hasDetail(detail: TemplateDetail): boolean {
  return Boolean(detail.summary || detail.photo || detail.repeats);
}

/** Frase corta de la tarjeta: la del análisis o, si no hay, cuántas fotos y textos lleva. */
export function templateBlurb(template: BrandTemplate): string {
  const short = shortSummary(template.analysis?.summary);
  if (short) return short;
  const document = template.document;
  if (!document) return '';
  const photos = photoCount(document);
  const texts = document.pages[0]?.layers.filter((layer) => layer.type === 'text').length ?? 0;
  return [
    photos > 0 ? `${photos} ${photos === 1 ? 'foto' : 'fotos'}` : '',
    texts > 0 ? `${texts} ${texts === 1 ? 'texto' : 'textos'}` : '',
  ]
    .filter(Boolean)
    .join(' y ');
}
