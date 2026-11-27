import { Film, GalleryHorizontal, Image as ImageIcon, Smartphone, type LucideIcon } from 'lucide-react';

// Los cuatro formatos que se ofrecen al crear una pieza, con su proporción (para dibujarla) y un
// icono. Los demás formatos del catálogo (vídeo largo, pin…) se muestran con el icono de imagen.

export interface FormatCard {
  format: string;
  label: string;
  /** Proporción ancho / alto para dibujar el marco. */
  ratio: number;
  ratioText: string;
  hint: string;
  icon: LucideIcon;
}

export const FORMAT_CARDS: FormatCard[] = [
  { format: 'post', label: 'Publicación', ratio: 4 / 5, ratioText: '4:5', hint: 'Una imagen con su texto', icon: ImageIcon },
  { format: 'carousel', label: 'Carrusel', ratio: 4 / 5, ratioText: '4:5', hint: 'Varias páginas para deslizar', icon: GalleryHorizontal },
  { format: 'reel', label: 'Reel', ratio: 9 / 16, ratioText: '9:16', hint: 'Vídeo vertical con música', icon: Film },
  { format: 'story', label: 'Historia', ratio: 9 / 16, ratioText: '9:16', hint: 'Vertical, dura un día', icon: Smartphone },
];

export function formatIcon(format: string): LucideIcon {
  if (format === 'video' || format === 'short') return Film;
  return FORMAT_CARDS.find((f) => f.format === format)?.icon ?? ImageIcon;
}

export function formatName(format: string): string {
  return FORMAT_CARDS.find((f) => f.format === format)?.label ?? format;
}
