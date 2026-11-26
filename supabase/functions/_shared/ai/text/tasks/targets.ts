// Nombres de red y formato tal como los escribe un modelo real («Reels»,
// «Instagram», «publicación», «ig»…) llevados a los destinos que sí se
// enviaron. Lo usan `campaign.brief` (el reparto) y `campaign.plan` (las piezas).
import type { CampaignTarget } from './campaign-plan.ts';

export const canon = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    : '';

export const NETWORK_ALIASES: Record<string, string> = {
  ig: 'instagram',
  insta: 'instagram',
  fb: 'facebook',
  twitter: 'x',
  google: 'google_business',
  google_my_business: 'google_business',
  perfil_de_empresa_de_google: 'google_business',
  yt: 'youtube',
};

/** Grupos de nombres que significan lo mismo, y los formatos del catálogo a los que equivalen. */
export const FORMAT_GROUPS: Array<{ words: string[]; formats: string[] }> = [
  { words: ['reel', 'reels', 'video', 'videos', 'short', 'shorts', 'clip', 'clips'], formats: ['reel', 'video', 'short'] },
  {
    words: ['post', 'posts', 'publicacion', 'publicaciones', 'foto', 'fotos', 'imagen', 'imagenes', 'page_post', 'photo', 'pin'],
    formats: ['post', 'page_post', 'photo', 'pin'],
  },
  { words: ['carousel', 'carrusel', 'carruseles', 'carousels'], formats: ['carousel'] },
  { words: ['story', 'stories', 'historia', 'historias'], formats: ['story'] },
];

/**
 * Un modelo real copia el destino tal como lo ve en el prompt: «instagram/post» en
 * `network` (y a veces también en `format`). Prueba de calidad del 24/11/2026: las 10
 * respuestas «que no se pueden usar» de «Preparar el plan» traían así todas las piezas.
 */
function targetParts(value: unknown): { network: string; format: string } | null {
  if (typeof value !== 'string' || !/[/·|>]/.test(value)) return null;
  const [network = '', ...rest] = value.split(/\s*[/·|>]\s*/);
  return { network, format: rest.join(' ') };
}

/** La red del catálogo a la que se refiere `value` («Instagram», «ig», «instagram/post»…), o null. */
export function resolveNetwork(value: unknown, targets: CampaignTarget[]): string | null {
  const key = canon(targetParts(value)?.network ?? value);
  if (!key) return null;
  const wanted = NETWORK_ALIASES[key] ?? key;
  return targets.find((t) => t.network === wanted)?.network ?? null;
}

/** El formato del catálogo (de esa red) al que se refiere `value` («Reels», «publicación», «instagram/reel»…), o null. */
export function resolveFormat(network: string, value: unknown, targets: CampaignTarget[]): string | null {
  const own = targets.filter((t) => t.network === network);
  const key = canon(targetParts(value)?.format || value);
  if (!key) return null;
  const exact = own.find((t) => canon(t.format) === key);
  if (exact) return exact.format;
  const group = FORMAT_GROUPS.find((g) => g.words.includes(key));
  if (!group) return null;
  return own.find((t) => group.formats.includes(t.format))?.format ?? null;
}

