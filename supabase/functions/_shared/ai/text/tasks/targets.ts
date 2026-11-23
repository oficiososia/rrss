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

/** La red del catálogo a la que se refiere `value` («Instagram», «ig»…), o null. */
export function resolveNetwork(value: unknown, targets: CampaignTarget[]): string | null {
  const key = canon(value);
  if (!key) return null;
  const wanted = NETWORK_ALIASES[key] ?? key;
  return targets.find((t) => t.network === wanted)?.network ?? null;
}

/** El formato del catálogo (de esa red) al que se refiere `value` («Reels», «publicación»…), o null. */
export function resolveFormat(network: string, value: unknown, targets: CampaignTarget[]): string | null {
  const own = targets.filter((t) => t.network === network);
  const key = canon(value);
  if (!key) return null;
  const exact = own.find((t) => canon(t.format) === key);
  if (exact) return exact.format;
  const group = FORMAT_GROUPS.find((g) => g.words.includes(key));
  if (!group) return null;
  return own.find((t) => group.formats.includes(t.format))?.format ?? null;
}

