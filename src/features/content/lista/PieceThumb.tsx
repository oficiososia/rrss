import { ThumbImage } from '@/features/library/ThumbImage';
import { cn } from '@/lib/utils';
import { PageThumb } from '../editor/panels/PageThumb';
import { FormatIcon } from './FormatIcon';
import type { PieceThumb } from './useContentThumbs';

/**
 * La miniatura de una pieza ocupando el hueco que le da su contenedor: la imagen real si la hay, el
 * esquema de capas si no se pudo dibujar, un fondo que late mientras llega y, si no hay nada que
 * enseñar, el icono del formato (no se inventa ninguna imagen). Decorativa: el título va al lado.
 */
export function PieceThumbView({
  thumb,
  format,
  className,
}: {
  thumb: PieceThumb | undefined;
  format: string;
  className?: string;
}) {
  const kind = thumb?.kind ?? 'loading';
  return (
    <span
      aria-hidden
      className={cn('relative flex h-full w-full items-center justify-center overflow-hidden bg-subtle text-muted', className)}
      data-testid="piece-thumb"
      data-thumb={kind}
    >
      {thumb?.kind === 'image' ? (
        <ThumbImage url={thumb.url} size={280} />
      ) : thumb?.kind === 'sketch' ? (
        <span className="block w-full">
          <PageThumb canvas={thumb.canvas} layers={thumb.layers} images={thumb.images} />
        </span>
      ) : kind === 'loading' ? (
        <span className="absolute inset-0 animate-pulse bg-border/50" />
      ) : (
        <FormatIcon format={format} className="h-8 w-8 opacity-60" />
      )}
    </span>
  );
}
