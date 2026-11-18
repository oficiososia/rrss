import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, Notice, Spinner } from '@/components/ui';
import type { ContentDocument } from '../../document';
import type { NetworkFormatSpec } from '../../networks';
import { safeZoneFor } from '../../safeZones';
import type { ImageLookup } from '../canvas/nodes';
import { captionPreview, previewFrameOf, showsCaption } from './frames';

interface NetworkPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: ContentDocument;
  images: ImageLookup;
  spec: NetworkFormatSpec | undefined;
  /** «Instagram · Historia». */
  targetName: string;
  /** Nombre que se pone como cuenta en el marco. */
  accountName: string;
}

type Render = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string };

/**
 * Dibuja el diseño como imagen (con el mismo código que exportar, a media
 * resolución). El diálogo se monta al abrirse, así que empieza siempre cargando.
 */
function useDesignImage(document: ContentDocument, images: ImageLookup): Render {
  const [render, setRender] = useState<Render>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    import('../canvas/exporter')
      .then(({ renderDocument }) =>
        renderDocument(document, images, { format: 'jpeg', quality: 0.85, pixelRatio: 0.5 }),
      )
      .then(
        (result) => {
          if (cancelled) return;
          url = URL.createObjectURL(result.blob);
          setRender({ status: 'ready', url });
        },
        (error: unknown) => {
          if (!cancelled) {
            setRender({
              status: 'error',
              message: error instanceof Error ? error.message : 'No se ha podido dibujar.',
            });
          }
        },
      );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [document, images]);
  return render;
}

/**
 * La pieza dentro de un marco parecido al de la red: muro (con el pie cortado
 * en «ver más») o pantalla completa (historia, reel). Es una aproximación y lo
 * dice: ninguna red publica su diseño y cada una lo cambia a menudo. Se monta
 * solo mientras está abierto.
 */
export function NetworkPreviewDialog({
  open,
  onOpenChange,
  document,
  images,
  spec,
  targetName,
  accountName,
}: NetworkPreviewDialogProps) {
  const render = useDesignImage(document, images);
  const frame = previewFrameOf(spec);
  const caption = captionPreview(document.copy, spec);
  const zone = safeZoneFor(spec, document.canvas);
  const ratio = `${document.canvas.width} / ${document.canvas.height}`;
  const initial = accountName.trim().charAt(0).toUpperCase() || '·';

  const image =
    render.status === 'ready' ? (
      <img
        src={render.url}
        alt={document.copy.altText || 'Diseño de la pieza'}
        className="h-full w-full object-cover"
      />
    ) : render.status === 'error' ? (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted">
        No se puede dibujar la vista previa: {render.message}
      </div>
    ) : (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Dibujando la vista previa…" />
      </div>
    );

  const captionText = (
    <p className="whitespace-pre-line break-words" data-testid="preview-caption">
      <span className="font-semibold">{accountName}</span> {caption.visible}
      {caption.truncated && <span className="text-muted">… más</span>}
    </p>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Vista previa · ${targetName}`}
      description="Aproximada: así se vería más o menos. Las redes no publican su diseño y lo cambian a menudo."
    >
      <div className="space-y-4" data-testid="network-preview" data-frame={frame}>
        {frame === 'feed' ? (
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border bg-surface text-sm">
            <div className="flex items-center gap-2 px-3 py-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-subtle font-semibold"
                aria-hidden
              >
                {initial}
              </span>
              <span className="flex-1 font-semibold">{accountName}</span>
              <MoreHorizontal className="h-4 w-4 text-muted" aria-hidden />
            </div>
            <div className="bg-subtle" style={{ aspectRatio: ratio }}>
              {image}
            </div>
            <div className="flex items-center gap-3 px-3 py-2 text-muted" aria-hidden>
              <Heart className="h-5 w-5" />
              <MessageCircle className="h-5 w-5" />
              <Send className="h-5 w-5" />
              <Bookmark className="ml-auto h-5 w-5" />
            </div>
            <div className="px-3 pb-3">{captionText}</div>
          </div>
        ) : (
          <div
            className="relative mx-auto w-full max-w-[17rem] overflow-hidden rounded-[1.75rem] border-4 border-fg bg-black text-sm text-white"
            style={{ aspectRatio: '9 / 16' }}
          >
            <div className="absolute inset-0 flex items-center">
              <div className="w-full" style={{ aspectRatio: ratio }}>
                {image}
              </div>
            </div>
            <div className="absolute inset-x-0 top-0 space-y-2 bg-gradient-to-b from-black/50 to-transparent p-3">
              <div className="h-0.5 rounded bg-white/70" aria-hidden />
              <div className="flex items-center gap-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/30 text-xs font-semibold"
                  aria-hidden
                >
                  {initial}
                </span>
                <span className="font-semibold">{accountName}</span>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/60 to-transparent p-3">
              {showsCaption(spec) ? (
                <div className="flex items-end gap-3">
                  <div className="min-w-0 flex-1 text-xs">{captionText}</div>
                  <div className="flex flex-col items-center gap-3" aria-hidden>
                    <Heart className="h-5 w-5" />
                    <MessageCircle className="h-5 w-5" />
                    <Send className="h-5 w-5" />
                  </div>
                </div>
              ) : (
                <div className="rounded-full border border-white/60 px-3 py-1.5 text-xs text-white/80" aria-hidden>
                  Enviar mensaje
                </div>
              )}
            </div>
          </div>
        )}

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          {caption.limit !== null ? (
            <li>
              Antes de «ver más» se ven unos {caption.limit} caracteres
              {caption.provenance === 'unverified' ? ' (cifra sin verificar)' : ''}; la red corta por el ancho real, así
              que puede variar.
            </li>
          ) : (
            showsCaption(spec) && <li>No sabemos dónde corta esta red el pie: se enseña entero.</li>
          )}
          {zone && (
            <li>
              Lo que cae en las franjas de arriba y abajo puede quedar tapado por la interfaz; actívalas con «Zonas
              seguras» en el lienzo (orientativas).
            </li>
          )}
          <li>El nombre de la cuenta y los iconos son de relleno.</li>
        </ul>
        {!spec && (
          <Notice tone="warning">No hay especificación de este formato: se enseña como una publicación.</Notice>
        )}
      </div>
    </Dialog>
  );
}
