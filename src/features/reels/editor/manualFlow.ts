// «Terminar en Instagram (para poner música)»: la parte que no pinta nada
// (docs/editor-reels.md §12). La API de Instagram no crea borradores ni pone
// canciones de su biblioteca: el reel montado y su pie van al móvil, allí se le
// pone la música y se publica, y después la aplicación lo reconoce.
import { composeCaption } from '../../../../supabase/functions/_shared/social/caption';
import type { ManualPublicationRow, SocialImportedMediaRow } from '@/lib/database.types';
import type { ReelCopy } from './project';

/** El texto que se pega en Instagram: el pie y, al final, los hashtags que no estén ya (como al publicar). */
export function instagramCaption(copy: ReelCopy | null | undefined): string {
  if (!copy) return '';
  return composeCaption({ caption: copy.caption, hashtags: copy.hashtags, altText: '' }).trim();
}

/**
 * ¿Se manda el vídeo con el diálogo de compartir del sistema (móvil)? Hace falta `navigator.share` con
 * archivos y una pantalla táctil: en un ordenador con Windows o macOS el navegador también sabe compartir
 * archivos, pero ese diálogo no lleva a Instagram, así que allí se descarga y se enseña el código QR.
 */
export function canShareVideo(
  nav: Pick<Navigator, 'share' | 'canShare'> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  touch: boolean = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false),
): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || !touch) return false;
  try {
    return nav.canShare({ files: [new File([new Uint8Array(1)], 'reel.mp4', { type: 'video/mp4' })] });
  } catch {
    return false;
  }
}

const INSTAGRAM_URL = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_./?=&%-]+$/;

/**
 * El enlace que pega la persona: vacío = sin enlace (vale), uno de instagram.com = ese (con https y sin
 * espacios), otra cosa = `invalid`. La base de datos aplica la misma regla.
 */
export function normalizeInstagramUrl(text: string): string | null | 'invalid' {
  let url = text.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/^http:\/\//i, 'https://');
  if (url.length > 500 || !INSTAGRAM_URL.test(url)) return 'invalid';
  return url;
}

export type MatchCandidate = Pick<
  SocialImportedMediaRow,
  'id' | 'external_id' | 'caption' | 'media_type' | 'media_product_type' | 'permalink' | 'published_at'
>;

/** Antes de mandarlo al móvil no puede estar publicado (con un margen por los relojes). */
export const MATCH_EARLY_MS = 10 * 60_000;
/** Sin pie, solo vale un único vídeo publicado poco después. */
export const MATCH_NO_CAPTION_WINDOW_MS = 2 * 86_400_000;
/** Lo que se busca: hasta un mes después de mandarlo al móvil. */
export const MATCH_WINDOW_MS = 30 * 86_400_000;

const isVideo = (m: MatchCandidate) => m.media_type === 'VIDEO' || m.media_product_type === 'REELS';

/** Palabras del texto, sin mayúsculas, tildes, signos ni emojis. */
function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .split(/[^\p{L}\p{N}_#]+/u)
    .filter((w) => w.length > 1);
}

/** Cuánto se parecen dos pies (0–1): palabras en común sobre las del pie más corto. */
export function captionSimilarity(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

export interface MatchResult {
  match: MatchCandidate | null;
  /** Por qué no (para decírselo a la persona). */
  reason: 'found' | 'none' | 'ambiguous';
}

/**
 * Cuál de las publicaciones leídas de la cuenta es el reel que se mandó al móvil. La Graph API no da la
 * duración de un vídeo (referencia de IG Media consultada el 23/11/2026), así que se empareja por:
 *   · tipo: un vídeo o un reel;
 *   · fecha: publicado después de mandarlo al móvil (10 min de margen) y como mucho un mes después;
 *   · pie: el que se copió, que es lo que se pega en Instagram (al menos el 60 % de sus palabras).
 * Si el reel no tenía pie, solo vale un único vídeo publicado en los dos días siguientes. Varias
 * publicaciones igual de buenas: no se elige ninguna (se dice, y se marca a mano).
 */
export function matchReel(
  handoff: Pick<ManualPublicationRow, 'handed_off_at' | 'caption'>,
  candidates: MatchCandidate[],
  taken: ReadonlySet<string> = new Set(),
): MatchResult {
  const from = Date.parse(handoff.handed_off_at) - MATCH_EARLY_MS;
  const inWindow = (m: MatchCandidate, span: number) => {
    const at = m.published_at ? Date.parse(m.published_at) : NaN;
    return Number.isFinite(at) && at >= from && at <= from + MATCH_EARLY_MS + span;
  };
  const pool = candidates.filter((m) => isVideo(m) && !taken.has(m.id) && inWindow(m, MATCH_WINDOW_MS));

  if (!handoff.caption.trim()) {
    const near = pool.filter((m) => inWindow(m, MATCH_NO_CAPTION_WINDOW_MS) && !(m.caption ?? '').trim());
    const loose = near.length > 0 ? near : pool.filter((m) => inWindow(m, MATCH_NO_CAPTION_WINDOW_MS));
    if (loose.length === 1) return { match: loose[0]!, reason: 'found' };
    return { match: null, reason: loose.length > 1 ? 'ambiguous' : 'none' };
  }

  const scored = pool
    .map((m) => ({ m, score: captionSimilarity(handoff.caption, m.caption ?? '') }))
    .filter((s) => s.score >= 0.6)
    .sort((a, b) => b.score - a.score || Date.parse(a.m.published_at!) - Date.parse(b.m.published_at!));
  if (scored.length === 0) return { match: null, reason: 'none' };
  const best = scored[0]!;
  const tie = scored.filter((s) => s.score === best.score);
  if (tie.length > 1) return { match: null, reason: 'ambiguous' };
  return { match: best.m, reason: 'found' };
}
