import { CalendarPlus, ClipboardCopy, Download, ImageOff, Send, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Dialog } from '@/components/ui';

// Hoja «Compartir» del editor de piezas: el ÚNICO camino para sacar la pieza.
// Reúne la vista previa en la red, el texto de la publicación (pie, hashtags,
// menciones, texto alternativo), la revisión de marca en una línea que se abre y
// las cuatro salidas: Descargar, Publicar ahora, Programar… y Copiar el texto.
//
// En autogestión no hay paso de aprobación a la vista: «Publicar ahora» y
// «Programar…» guardan la versión y la aprueban por debajo (lo hace el editor).
// En modo agencia el flujo es el de siempre y su estado sale arriba (`review`).
// Programado no es publicado: la hoja lo dice al lado del botón.

export interface ShareAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

export interface ShareSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Así se verá en la red (`NetworkPreview`). */
  preview: ReactNode;
  /** El texto de la publicación y lo que ayuda a escribirlo. */
  text: ReactNode;
  /** La revisión de marca, plegada en una línea (null si no hay verificador). */
  brandCheck?: ReactNode;
  /** Modo agencia: el estado de la pieza y cómo avanzarlo. En autogestión, nada. */
  review?: ReactNode;
  /** Lleva contenido generado con IA (el motivo), o null. */
  aiNote?: string | null;
  /** Huecos de foto vacíos: no salen en la imagen. */
  missingPhotos: number;
  onGoToMissing: () => void;
  /** null: no se ofrece (la red no se publica sola, la publicación no está configurada…). */
  publishNow: ShareAction | null;
  schedule: ShareAction | null;
  /** Por qué no se puede publicar ni programar ahora (sin permiso, sin aprobar…), o null. */
  blockedNote?: string | null;
  onDownload: () => void;
  onCopyText: () => void;
}

export function ShareSheet({
  open,
  onOpenChange,
  preview,
  text,
  brandCheck,
  review,
  aiNote,
  missingPhotos,
  onGoToMissing,
  publishNow,
  schedule,
  blockedNote,
  onDownload,
  onCopyText,
}: ShareSheetProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Compartir"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2" data-testid="share-actions">
          <Button variant="ghost" size="sm" onClick={onDownload} data-testid="share-download">
            <Download className="h-4 w-4" aria-hidden />
            Descargar
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopyText} data-testid="share-copy-text">
            <ClipboardCopy className="h-4 w-4" aria-hidden />
            Copiar el texto
          </Button>
          <span className="flex-1" aria-hidden />
          {schedule && (
            <Button
              variant="secondary"
              size="sm"
              onClick={schedule.onClick}
              disabled={schedule.disabled}
              title={schedule.title}
              data-testid="share-schedule"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden />
              {schedule.label}
            </Button>
          )}
          {publishNow && (
            <Button
              size="sm"
              onClick={publishNow.onClick}
              disabled={publishNow.disabled}
              title={publishNow.title}
              data-testid="share-publish-now"
              data-autofocus
            >
              <Send className="h-4 w-4" aria-hidden />
              {publishNow.label}
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" data-testid="share-sheet">
        <div className="space-y-1" data-testid="share-preview">
          <p className="text-xs text-muted">Así se verá (aproximado)</p>
          {preview}
        </div>
        <div className="min-w-0 space-y-4">
          {review}
          {missingPhotos > 0 && (
            <p
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning"
              role="status"
              data-testid="share-missing-photos"
            >
              <ImageOff className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {missingPhotos === 1
                  ? 'Falta 1 foto: ese hueco no sale en la imagen.'
                  : `Faltan ${missingPhotos} fotos: esos huecos no salen en la imagen.`}
              </span>
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={onGoToMissing}
                data-testid="share-go-to-missing"
              >
                Ir al hueco
              </button>
            </p>
          )}
          {text}
          {brandCheck && (
            <details className="group rounded-lg border border-border" data-testid="share-brand-check">
              <summary className="flex min-h-[2.5rem] cursor-pointer list-none items-center gap-2 px-3 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
                <ShieldCheck className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">Revisión de marca</span>
                <span className="text-muted transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
              </summary>
              <div className="border-t border-border px-3 pb-3 pt-2">{brandCheck}</div>
            </details>
          )}
          {aiNote && (
            <p className="text-xs text-muted" data-testid="editor-ai-label">
              Se publica con la etiqueta de contenido generado con IA: {aiNote}
            </p>
          )}
          {schedule && (
            <p className="text-xs text-muted" data-testid="share-schedule-note">
              «Programar…» la deja en el calendario: no se publica hasta el día y la hora que elijas, y solo si entonces
              sale bien.
            </p>
          )}
          {blockedNote && (
            <p className="text-xs text-muted" data-testid="editor-share-note">
              {blockedNote}
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
