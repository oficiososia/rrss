import { Film, GalleryHorizontal, Image as ImageIcon, Smartphone } from 'lucide-react';

/** El icono de un formato, decorativo (el nombre va siempre en el texto de al lado). */
export function FormatIcon({ format, className }: { format: string; className?: string }) {
  if (format === 'carousel') return <GalleryHorizontal className={className} aria-hidden />;
  if (format === 'story') return <Smartphone className={className} aria-hidden />;
  if (format === 'reel' || format === 'video' || format === 'short') return <Film className={className} aria-hidden />;
  return <ImageIcon className={className} aria-hidden />;
}
