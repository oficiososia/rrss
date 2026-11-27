import { LayoutTemplate } from 'lucide-react';
import type { Canvas, Layer } from '../document';
import type { ImageLookup } from '../editor/canvas/nodes';
import { PageThumb } from '../editor/panels/PageThumb';
import type { TemplatePreview } from './useTemplatePreviews';

interface TemplateThumbProps {
  canvas: Canvas | null;
  preview: TemplatePreview;
  /** Esquema ligero por si no se puede dibujar la vista real. */
  fallback: { canvas: Canvas; layers: Layer[]; images: ImageLookup } | null;
}

/**
 * Miniatura de una plantilla: esqueleto mientras se dibuja, la vista previa real cuando llega y,
 * si no se pudo dibujar, el esquema de capas. Decorativa: el nombre va en el texto de la tarjeta.
 */
export function TemplateThumb({ canvas, preview, fallback }: TemplateThumbProps) {
  if (!canvas || !fallback) {
    return (
      <span className="flex aspect-square items-center justify-center rounded-md bg-subtle" aria-hidden>
        <LayoutTemplate className="h-5 w-5 text-muted" />
      </span>
    );
  }
  if (preview.status === 'error') {
    return <PageThumb canvas={fallback.canvas} layers={fallback.layers} images={fallback.images} />;
  }
  return (
    <span
      className="relative block w-full overflow-hidden rounded bg-subtle"
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
      data-testid="template-thumb"
      data-state={preview.status}
      aria-hidden
    >
      {preview.status === 'ready' ? (
        <img src={preview.url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-border/60" />
      )}
    </span>
  );
}
