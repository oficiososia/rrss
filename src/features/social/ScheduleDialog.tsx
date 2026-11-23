import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Field, Input, Notice, Select } from '@/components/ui';
import { targetLabel } from '@/features/content/labels';
import { STATUS_LABEL } from '@/features/content/status';
import { translateError } from '@/lib/errors';
import {
  exportPageOf,
  exportsOf,
  publishableExportsOf,
  socialKeys,
  useSavePublication,
  usePublishableMedia,
  useSchedulableContents,
  useSocialAccounts,
  reelRenderOf,
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
import { useBrand, useOrg } from '@/features/orgs/context';
import { useConnectedAccount } from './connectedAccount';
import { NoConnectedAccountNotice } from './NoConnectedAccountNotice';
import { publishedText, usePublishedContents } from './publishedState';
import { PublishedNotice } from './PublishedNotice';
import { useBrandZone } from './useBrandZone';
import { differsFromDevice, zoneLabel } from './zone';
import { PublishNowDialog } from './PublishNowDialog';

interface ScheduleDialogProps {
  brandId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Día en el que se abrió (a las 10:00 si no trae hora). */
  initialDate?: Date | null;
  /** Pieza ya elegida (al programar desde el editor). */
  initialContentId?: string;
  /**
   * Solo desde el editor de la pieza `contentId`: exporta su versión aprobada a
   * JPEG (una imagen por página), la guarda en la biblioteca y devuelve los
   * recursos en orden. Con ello, programar no pide exportar antes: lo hace al
   * guardar, igual que «Publicar ahora». La exportación la hace el navegador,
   * por eso el calendario (que no tiene el diseño abierto) no puede.
   */
  exportVersion?: { contentId: string; run: () => Promise<string[]> };
  /** Piezas sin fecha (las de «Programar» del calendario): salen primero, en su grupo. */
  firstIds?: string[];
}

/**
 * Poner una pieza en el calendario. La base de datos decide si queda
 * «Programada» (aprobada, con su exportación y una cuenta) o en espera, y dice
 * por qué: aquí solo se ayuda a elegir bien.
 */
export function ScheduleDialog({
  brandId,
  open,
  onOpenChange,
  initialDate,
  initialContentId,
  exportVersion,
  firstIds,
}: ScheduleDialogProps) {
  const qc = useQueryClient();
  const { org } = useOrg();
  const { can } = useBrand();
  const contents = useSchedulableContents(brandId, open);
  const accounts = useSocialAccounts(brandId);
  const published = usePublishedContents(brandId, open);
  const media = usePublishableMedia(brandId, open);
  const save = useSavePublication(brandId);
  const zone = useBrandZone();

  const [contentId, setContentId] = useState(initialContentId ?? '');
  const [when, setWhen] = useState(() =>
    // `initialDate` viene del calendario como fecha de pared de la marca; sin ella, dentro de una hora.
    initialDate ? toLocalInput(defaultScheduleDate(initialDate)) : toLocalInput(defaultScheduleDate(null), zone),
  );
  // null = la primera cuenta conectada de la red de la pieza.
  const [accountChoice, setAccountChoice] = useState<string | null>(null);
  // null = lo automático: en un carrusel, la exportación de cada página de la versión, en su orden.
  const [assetChoice, setAssetIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // «Cuándo»: en un día y hora, o ahora mismo (pide confirmación en otro diálogo).
  const [mode, setMode] = useState<'later' | 'now'>('later');
  const [nowOpen, setNowOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const content = contents.data?.find((c) => c.id === contentId) ?? null;
  const target = content ? `${content.network}:${content.format}` : '';
  const supported = PUBLISHABLE_TARGETS.has(target);
  const liveAccounts = (accounts.data ?? []).filter((a) => a.network === content?.network);
  const accountId = accountChoice ?? liveAccounts.find((a) => a.status === 'active')?.id ?? '';
  const connection = useConnectedAccount(brandId, content?.network ?? 'instagram');
  // Sin cuenta activa en la red de la pieza: se dice ANTES de nada, con el enlace para conectarla.
  const noAccount = Boolean(content && supported && !connection.isLoading && !connection.connected);
  // Ya publicada: no se vuelve a programar ni a publicar (solo «Publicar otra vez», que hace una copia).
  const publishedInfo = content ? (published.data?.get(content.id) ?? null) : null;

  const chooseContent = (id: string) => {
    setContentId(id);
    setAccountChoice(null);
    setAssetIds(null);
  };

  const choices = useMemo(() => {
    if (!content || !media.data) return [];
    if (content.format === 'reel') return videosOf(media.data);
    return content.current_version > 0 ? exportsOf(media.data, content.id, content.current_version) : [];
  }, [content, media.data]);
  /**
   * Lo que se propone sin que haya que elegirlo: en un carrusel, sus páginas en orden (la última tanda
   * exportada de la versión), si están todas; en una publicación, la imagen más reciente de la versión.
   */
  const pageSet = useMemo(
    () =>
      (content?.format === 'carousel' || content?.format === 'post') && media.data && content.current_version > 0
        ? publishableExportsOf(media.data, content.id, content.current_version, content.format)
        : null,
    [content, media.data],
  );
  /** Un reel del editor de reels: se propone el montaje de la versión vigente. */
  const reelRender = useMemo(
    () =>
      content?.format === 'reel' && media.data && content.current_version > 0
        ? reelRenderOf(media.data, content.id, content.current_version)
        : null,
    [content, media.data],
  );
  const assetIds = assetChoice ?? pageSet?.map((a) => a.id) ?? (reelRender ? [reelRender.id] : []);
  /**
   * La pieza aprobada del editor todavía no tiene la imagen que se publica (por ejemplo, se exportó en
   * PNG, que la red no admite): se prepara sola al guardar.
   */
  const autoExport =
    exportVersion !== undefined &&
    content !== null &&
    content.id === exportVersion.contentId &&
    content.status === 'approved' &&
    supported &&
    (content.format === 'post' || content.format === 'carousel') &&
    // Solo si no hay nada que proponer: quien desmarca a mano lo que había no pide otra exportación.
    assetChoice === null &&
    assetIds.length === 0;

  const toggle = (id: string) =>
    setAssetIds((choice) => {
      const prev = choice ?? assetIds;
      return content?.format === 'reel' || content?.format === 'post'
        ? prev[0] === id
          ? []
          : [id]
        : prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id];
    });

  const publishNow = () => {
    setError(null);
    if (!content) return setError('Elige qué contenido se publica.');
    if (publishedInfo) return setError('Ya está publicada.');
    if (noAccount) return setError('No hay ninguna cuenta conectada: conéctala antes de publicar.');
    if (content.status !== 'approved') return setError('Solo se publica lo aprobado.');
    setNowOpen(true);
  };

  const submit = async () => {
    if (mode === 'now') return publishNow();
    setError(null);
    const scheduledAt = fromLocalInput(when, zone);
    if (!content) return setError('Elige qué contenido se publica.');
    if (publishedInfo) return setError('Ya está publicada.');
    if (!scheduledAt) return setError('Indica el día y la hora.');
    if (isPast(scheduledAt)) return setError('La fecha ya ha pasado.');
    let mediaAssetIds = assetIds;
    if (autoExport && exportVersion) {
      setExporting(true);
      try {
        mediaAssetIds = await exportVersion.run();
        await qc.invalidateQueries({ queryKey: socialKeys.media(brandId) });
      } catch (e) {
        setError(`No se ha podido preparar la imagen: ${translateError(e)}`);
        return;
      } finally {
        setExporting(false);
      }
    }
    save.mutate(
      {
        publicationId: null,
        contentId: content.id,
        scheduledAt,
        accountId: accountId || null,
        mediaAssetIds,
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
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending || exporting}>
              Cancelar
            </Button>
            <Button
              onClick={() => void submit()}
              loading={save.isPending || exporting}
              disabled={Boolean(publishedInfo) || (mode === 'now' && noAccount)}
              data-testid="schedule-submit"
            >
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
                {(() => {
                  const option = (c: NonNullable<typeof contents.data>[number]) => {
                    const done = published.data?.get(c.id);
                    return (
                      // Lo publicado se ve (para no buscarlo), pero no se elige: ya salió.
                      <option key={c.id} value={c.id} disabled={Boolean(done) && c.id !== contentId}>
                        {c.title} · {targetLabel(c.network, c.format)} ·{' '}
                        {done ? publishedText(done, zone) : STATUS_LABEL[c.status]}
                      </option>
                    );
                  };
                  const all = contents.data ?? [];
                  if (!firstIds) return all.map(option);
                  // Desde el calendario: primero las piezas sin fecha, que es lo que se viene a programar.
                  const first = new Set(firstIds);
                  const pending = all.filter((c) => first.has(c.id));
                  const rest = all.filter((c) => !first.has(c.id));
                  return (
                    <>
                      {pending.length > 0 && <optgroup label={`Sin fecha (${pending.length})`}>{pending.map(option)}</optgroup>}
                      {rest.length > 0 && <optgroup label="Otras piezas">{rest.map(option)}</optgroup>}
                    </>
                  );
                })()}
              </Select>
            )}
          </Field>
          {content && publishedInfo && (
            <PublishedNotice
              orgId={org.id}
              brandId={brandId}
              contentId={content.id}
              title={content.title}
              info={publishedInfo}
              canRepublish={can('edit')}
              showOpen={exportVersion?.contentId !== content.id}
              testId="schedule-published"
            />
          )}
          {noAccount && !publishedInfo && (
            <NoConnectedAccountNotice
              orgId={org.id}
              brandId={brandId}
              state={connection.state}
              why={
                mode === 'now'
                  ? 'Sin cuenta no se puede publicar: no se ha aprobado ni publicado nada.'
                  : 'Puedes dejarla en el calendario, pero no se publicará hasta que conectes la cuenta.'
              }
              testId="schedule-no-account"
            />
          )}
          {!publishedInfo && (
          <>
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
            <Field label="Día y hora" hint={`En la ${zoneLabel(zone)}, la de la marca${differsFromDevice(zone) ? ' (no la de tu dispositivo)' : ''}.`}>
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
                    ? 'Imágenes del carrusel (una por página, en su orden)'
                    : 'Imagen'}
              </legend>
              {content.format === 'carousel' && (
                <p className="text-xs text-muted" data-testid="schedule-pages-hint">
                  {pageSet
                    ? `Se eligen solas las ${pageSet.length} páginas de la versión ${content.current_version}, en orden. La base de datos solo arma la publicación con una exportación de cada página, en su orden.`
                    : autoExport
                      ? `Las imágenes de las páginas de la versión ${content.current_version} se preparan solas al guardar.`
                      : `Faltan las imágenes de alguna página de la versión ${content.current_version}: abre la pieza en el editor y prográmala desde allí («Publicar o compartir»), que las prepara solas.`}
                  {pageSet && assetChoice !== null && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => setAssetIds(null)}
                        data-testid="schedule-pages-reset"
                      >
                        Volver a las páginas en orden
                      </button>
                    </>
                  )}
                </p>
              )}
              {exporting ? (
                <p role="status" className="text-sm" data-testid="schedule-exporting">
                  {content.format === 'carousel' ? 'Preparando las imágenes…' : 'Preparando la imagen…'}
                </p>
              ) : autoExport && choices.length === 0 ? (
                <p className="text-sm text-muted" data-testid="schedule-auto-export">
                  {content.format === 'carousel'
                    ? 'No hace falta exportar nada: las imágenes se preparan solas al guardar y quedan aparte, en «Exportaciones» de la biblioteca.'
                    : 'No hace falta exportar nada: la imagen se prepara sola al guardar y queda aparte, en «Exportaciones» de la biblioteca.'}
                </p>
              ) : choices.length === 0 ? (
                <p className="text-sm text-muted" data-testid="schedule-no-media">
                  {content.format === 'reel'
                    ? 'No hay vídeos en la biblioteca de la marca.'
                    : content.current_version > 0
                      ? `Falta la imagen de la versión ${content.current_version}. Abre la pieza en el editor y prográmala desde allí («Publicar o compartir»): se prepara sola.`
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
                          <span className="min-w-0 flex-1 truncate">
                            {exportPageOf(a) && (
                              <span className="mr-1 text-xs text-muted">
                                Página {exportPageOf(a)!.page}/{exportPageOf(a)!.count} ·
                              </span>
                            )}
                            {a.file_name}
                          </span>
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

          </>
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
          exportVersion={autoExport ? exportVersion?.run : undefined}
        />
      )}
    </>
  );
}
