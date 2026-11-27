import { ExternalLink, Send, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Dialog, Field, Input } from '@/components/ui';
import { networkLabel } from '@/features/content/labels';
import { translateError } from '@/lib/errors';
import { useCancelPublication, type CalendarEntry } from './api';
import { FormatIcon } from './CalendarEntryCard';
import { formatLabel } from './formatLabel';
import { DISPLAY_LABEL, DISPLAY_TONE, displayState, fromLocalInput, isEntryEditable, toLocalInput } from './calendar';
import type { HoldAdvice } from './holdAdvice';
import { PublicationPreview } from './preview';
import { formatDateTimeIn, zoneLabel } from './zone';

interface CalendarQuickViewProps {
  brandId: string;
  entry: CalendarEntry | null;
  zone: string;
  canEdit: boolean;
  /** ¿Está activa la publicación en redes en este entorno? («Publicar ahora» solo existe con ella). */
  publishing: boolean;
  advice: HoldAdvice | null;
  /** El botón que arregla el motivo de una publicación detenida (el mismo del aviso del calendario). */
  fix: ReactNode;
  onClose: () => void;
  onOpenFicha: (entry: CalendarEntry) => void;
  onPublishNow: (entry: CalendarEntry) => void;
  /** Mover a otro día y hora (el calendario comprueba, guarda y ofrece deshacer). */
  onMove: (entry: CalendarEntry, scheduledAt: string) => void;
  moving: boolean;
}

/**
 * Vista rápida de una publicación: lo que se publicará (imagen y pie de foto),
 * cuándo, en qué estado y las acciones de todos los días. La ficha completa
 * (intentos, comentarios, aprobar) queda en «Abrir».
 */
export function CalendarQuickView({
  brandId,
  entry,
  zone,
  canEdit,
  publishing,
  advice,
  fix,
  onClose,
  onOpenFicha,
  onPublishNow,
  onMove,
  moving,
}: CalendarQuickViewProps) {
  const cancel = useCancelPublication(brandId);
  const [when, setWhen] = useState(() => (entry ? toLocalInput(entry.scheduled_at, zone) : ''));
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!entry) return null;

  const state = displayState(entry, entry.content?.status ?? null);
  const editable = canEdit && isEntryEditable(entry);
  const manual = entry.manual;
  const title = entry.content?.title ?? 'Pieza';

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={`${formatDateTimeIn(entry.scheduled_at, zone)} · ${networkLabel(entry.network)} · ${formatLabel(entry.network, entry.format)}`}
      size="lg"
      footer={
        <>
          {editable &&
            (confirmCancel ? (
              <>
                <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
                  No cancelar
                </Button>
                <Button
                  variant="danger"
                  loading={cancel.isPending}
                  onClick={() =>
                    cancel.mutate(entry.id, {
                      onSuccess: () => {
                        toast.success('Cancelada');
                        onClose();
                      },
                      onError: (e) => toast.error(translateError(e)),
                    })
                  }
                  data-testid="calendar-quick-cancel-confirm"
                >
                  Sí, cancelar la publicación
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmCancel(true)} data-testid="calendar-quick-cancel">
                <XCircle className="h-4 w-4" aria-hidden />
                Cancelar la publicación
              </Button>
            ))}
          {publishing && editable && entry.status === 'scheduled' && (
            <Button variant="secondary" onClick={() => onPublishNow(entry)} data-testid="calendar-quick-publish-now">
              <Send className="h-4 w-4" aria-hidden />
              Publicar ahora
            </Button>
          )}
          {manual && entry.external_url && (
            <a
              href={entry.external_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium text-primary hover:bg-subtle"
              data-testid="calendar-quick-instagram"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              Ver en Instagram
            </a>
          )}
          <Button onClick={() => onOpenFicha(entry)} data-testid="calendar-quick-open">
            <ExternalLink className="h-4 w-4" aria-hidden />
            {manual ? 'Abrir el reel' : 'Abrir'}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="calendar-quick">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={DISPLAY_TONE[state]}>{DISPLAY_LABEL[state]}</Badge>
          <span className="inline-flex items-center gap-1 text-muted">
            <FormatIcon format={entry.format} className="h-4 w-4" />
            {formatLabel(entry.network, entry.format)}
          </span>
        </p>

        {advice && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm"
            data-testid="calendar-quick-hold"
          >
            <span className="min-w-0 flex-1 text-warning">{advice.short}</span>
            {fix}
          </div>
        )}

        <PublicationPreview brandId={brandId} entry={entry} />

        {editable && (
          <div className="flex flex-wrap items-end gap-2" data-testid="calendar-quick-move">
            <Field label="Mover a" hint={`En la ${zoneLabel(zone)}.`}>
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="w-auto"
                />
              )}
            </Field>
            <Button
              variant="secondary"
              loading={moving}
              onClick={() => {
                const at = fromLocalInput(when, zone);
                if (!at) return void toast.error('Indica el día y la hora.');
                onMove(entry, at);
              }}
            >
              Mover
            </Button>
          </div>
        )}
        {!editable && entry.status === 'published' && !manual && (
          <p className="text-sm text-muted">Ya está publicada: no se puede mover.</p>
        )}
        {manual && (
          <p className="text-sm text-muted" data-testid="calendar-quick-manual">
            {manual.status === 'published'
              ? `Se publicó a mano en Instagram${manual.source === 'import' ? ' (la encontramos en la cuenta)' : ''}.${
                  entry.external_url ? '' : ' Sin enlace todavía: añádelo desde «Exportar» en el reel.'
                }`
              : 'Se mandó al móvil para publicarlo en Instagram y todavía no consta como publicado. Cuando salga, márcalo con «Ya lo publiqué» en «Exportar» del reel.'}
          </p>
        )}
      </div>
    </Dialog>
  );
}
