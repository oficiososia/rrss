import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Notice, Select } from '@/components/ui';
import { targetLabel } from '@/features/content/labels';
import { STATUS_LABEL } from '@/features/content/status';
import { translateError } from '@/lib/errors';
import {
  exportsOf,
  useSavePublication,
  usePublishableMedia,
  useSchedulableContents,
  useSocialAccounts,
  videosOf,
} from './api';
import {
  defaultScheduleDate,
  fromLocalInput,
  HOLD_REASON_TEXT,
  isPast,
  PUBLISHABLE_TARGETS,
  toLocalInput,
} from './calendar';
import { PublishNowDialog } from './PublishNowDialog';

interface ScheduleDialogProps {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Día en el que se abrió (a las 10:00 si no trae hora). */
  initialDate?: Date | null;
}

/**
 * Poner una pieza en el calendario. La base de datos decide si queda
 * «Programada» (aprobada, con su exportación y una cuenta) o en espera, y dice
 * por qué: aquí solo se ayuda a elegir bien.
 */
export function ScheduleDialog({ brandId, open, onOpenChange, initialDate }: ScheduleDialogProps) {
  const contents = useSchedulableContents(brandId, open);
  const accounts = useSocialAccounts(brandId);
  const media = usePublishableMedia(brandId, open);
  const save = useSavePublication(brandId);

  const [contentId, setContentId] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(defaultScheduleDate(initialDate)));
  // null = la primera cuenta conectada de la red de la pieza.
  const [accountChoice, setAccountChoice] = useState<string | null>(null);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // «Cuándo»: en un día y hora, o ahora mismo (pide confirmación en otro diálogo).
  const [mode, setMode] = useState<'later' | 'now'>('later');
  const [nowOpen, setNowOpen] = useState(false);

  const content = contents.data?.find((c) => c.id === contentId) ?? null;
  const target = content ? `${content.network}:${content.format}` : '';
  const supported = PUBLISHABLE_TARGETS.has(target);
  const liveAccounts = (accounts.data ?? []).filter((a) => a.network === content?.network);
  const accountId = accountChoice ?? liveAccounts.find((a) => a.status === 'active')?.id ?? '';

  const chooseContent = (id: string) => {
    setContentId(id);
    setAccountChoice(null);
    setAssetIds([]);
  };

  const choices = useMemo(() => {
    if (!content || !media.data) return [];
    if (content.format === 'reel') return videosOf(media.data);
    return content.current_version > 0 ? exportsOf(media.data, content.id, content.current_version) : [];
  }, [content, media.data]);

  const toggle = (id: string) =>
    setAssetIds((prev) =>
      content?.format === 'reel' || content?.format === 'post'
        ? prev[0] === id
          ? []
          : [id]
        : prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id],
    );

  const publishNow = () => {
    setError(null);
    if (!content) return setError('Elige qué contenido se publica.');
    if (content.status !== 'approved') return setError('Solo se publica lo aprobado.');
    setNowOpen(true);
  };

  const submit = () => {
    if (mode === 'now') return publishNow();
    setError(null);
    const scheduledAt = fromLocalInput(when);
    if (!content) return setError('Elige qué contenido se publica.');
    if (!scheduledAt) return setError('Indica el día y la hora.');
    if (isPast(scheduledAt)) return setError('La fecha ya ha pasado.');
    save.mutate(
      {
        publicationId: null,
        contentId: content.id,
        scheduledAt,
        accountId: accountId || null,
        mediaAssetIds: assetIds,
        contentVersion: content.status === 'approved' ? content.current_version : null,
      },
      {
        onSuccess: (pub) => {
          if (pub.status === 'scheduled') toast.success('Programada');
          else
            toast.info(
              `En el calendario, pero aún no se publicará. ${pub.hold_reason ? HOLD_REASON_TEXT[pub.hold_reason] : ''}`,
            );
          onOpenChange(false);
        },
        onError: (e) => setError(translateError(e)),
      },
    );
  };

  return (
    <>
      <Dialog
        open={open && !nowOpen}
        onOpenChange={onOpenChange}
        title="Programar una publicación"
        description="Solo se publica lo aprobado, en la versión aprobada y con la imagen exportada de esa versión."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={save.isPending} data-testid="schedule-submit">
              {mode === 'now' ? 'Publicar ahora…' : 'Guardar en el calendario'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Contenido">
            {(props) => (
              <Select
                {...props}
                value={contentId}
                onChange={(e) => chooseContent(e.target.value)}
                data-testid="schedule-content"
              >
                <option value="">Elige un contenido</option>
                {(contents.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {targetLabel(c.network, c.format)} · {STATUS_LABEL[c.status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {content && !supported && (
            <Notice tone="warning">Este formato todavía no se publica automáticamente: solo quedará apuntado.</Notice>
          )}
          {content && content.status !== 'approved' && (
            <Notice>
              Está en «{STATUS_LABEL[content.status]}». Quedará en el calendario y se programará en cuanto se apruebe
              (con su exportación elegida).
            </Notice>
          )}

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Cuándo</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="schedule-mode"
                  checked={mode === 'later'}
                  onChange={() => setMode('later')}
                  data-testid="schedule-mode-later"
                />
                Día y hora
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="schedule-mode"
                  checked={mode === 'now'}
                  onChange={() => setMode('now')}
                  data-testid="schedule-mode-now"
                />
                Ahora
              </label>
            </div>
          </fieldset>

          {mode === 'later' ? (
            <Field label="Día y hora" hint="En la hora de este dispositivo.">
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  data-testid="schedule-when"
                />
              )}
            </Field>
          ) : (
            <Notice>
              Se publica en el momento, sin esperar al reloj. Pedirá confirmación y solo sale lo aprobado, en su versión
              aprobada.
            </Notice>
          )}

          {content && supported && (
            <Field
              label="Cuenta"
              hint={
                liveAccounts.length === 0
                  ? 'No hay ninguna cuenta conectada: conéctala en Marca → Cuentas conectadas.'
                  : undefined
              }
            >
              {(props) => (
                <Select
                  {...props}
                  value={accountId}
                  onChange={(e) => setAccountChoice(e.target.value)}
                  data-testid="schedule-account"
                >
                  <option value="">Sin cuenta todavía</option>
                  {liveAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username || a.external_id}
                      {a.status === 'needs_reauth' ? ' (hay que volver a conectarla)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {content && supported && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                {content.format === 'reel'
                  ? 'Vídeo del reel'
                  : content.format === 'carousel'
                    ? 'Imágenes del carrusel (de 2 a 10, en orden)'
                    : 'Imagen'}
              </legend>
              {choices.length === 0 ? (
                <p className="text-sm text-muted" data-testid="schedule-no-media">
                  {content.format === 'reel'
                    ? 'No hay vídeos en la biblioteca de la marca.'
                    : content.current_version > 0
                      ? `No hay ninguna exportación JPEG de la versión ${content.current_version}: expórtala desde el editor (Exportar → JPEG, guardar en la biblioteca).`
                      : 'La pieza todavía no tiene diseño guardado.'}
                </p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {choices.map((a) => {
                    const index = assetIds.indexOf(a.id);
                    return (
                      <li key={a.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={index >= 0}
                            onChange={() => toggle(a.id)}
                            data-testid="schedule-asset"
                          />
                          <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
                          {index >= 0 && content.format === 'carousel' && (
                            <span className="text-xs text-muted">{index + 1}.ª</span>
                          )}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
          )}

          {error && (
            <p className="text-sm text-danger" role="alert" data-testid="schedule-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      {content && (
        <PublishNowDialog
          brandId={brandId}
          open={open && nowOpen}
          onOpenChange={(next) => {
            setNowOpen(next);
            if (!next) onOpenChange(false);
          }}
          contentId={content.id}
          accountId={accountId || undefined}
          assetIds={assetIds.length > 0 ? assetIds : undefined}
        />
      )}
    </>
  );
}
