// «Exportar → Publicar o programar» del editor de reels: el pie y los hashtags
// (como en las publicaciones), la cuenta, y cuándo (ahora o un día y una hora),
// con el vídeo recién montado ya elegido. Lo que no se puede se dice antes de
// pulsar (sin cuenta conectada, sin permiso…), nunca después de aprobar.
//
// Sin texto alternativo: Instagram no lo admite en los reels (el publicador solo
// lo manda con las imágenes; ver supabase/functions/_shared/social/meta-graph.ts).
import { CalendarClock, ExternalLink, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { GenerateCaptionDialog } from '@/features/ai/GenerateCaptionDialog';
import { defaultScheduleDate, fromLocalInput, isPast, toLocalInput } from '@/features/social/calendar';
import { useBrandZone } from '@/features/social/useBrandZone';
import { differsFromDevice, zoneLabel } from '@/features/social/zone';
import type { ScheduledPublicationRow, SocialAccountRow } from '@/lib/database.types';
import { formatDateTime } from '@/lib/utils';
import { REEL_CAPTION_MAX, REEL_HASHTAGS_MAX, type ReelCopy } from './project';

export const EMPTY_COPY: ReelCopy = { caption: '', hashtags: [] };

/** «#pan, #obrador horno» → ['pan', 'obrador', 'horno'] (sin repetir y sin lo que no vale). */
export function parseHashtags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const tag = raw.replace(/^#+/, '').trim();
    if (!tag || !/^[\p{L}\p{N}_]{1,100}$/u.test(tag)) continue;
    const key = tag.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.slice(0, REEL_HASHTAGS_MAX);
}

export interface PublishInput {
  mode: 'now' | 'schedule';
  /** ISO, si se programa. */
  scheduledAt: string | null;
  accountId: string;
}

export interface PublishPanelProps {
  brandId: string;
  network: string;
  format: string;
  copy: ReelCopy;
  onCopy: (copy: ReelCopy) => void;
  readOnly: boolean;
  /** ¿Se ofrece «Redactar con IA»? (tarea configurada y la marca no está en modo agencia). */
  captionAi: boolean;
  /** Cuentas conectadas de la marca (undefined mientras llegan). */
  accounts: SocialAccountRow[] | undefined;
  /** Dónde se conecta una cuenta. */
  accountsPath: string;
  /** La publicación de la pieza, si ya la hay (programada, en espera o fallida). */
  publication: ScheduledPublicationRow | null;
  /** Por qué no se puede publicar ni programar desde aquí (permiso, publicar apagado…). */
  blocked?: string;
  /** Por qué no se puede «Publicar ahora» (en modo agencia, si aún no está aprobada). */
  nowBlocked?: string;
  /** En modo agencia, el estado y su siguiente paso. */
  approval?: ReactNode;
  busy: boolean;
  onSubmit: (input: PublishInput) => void;
}

export function PublishPanel(props: PublishPanelProps) {
  const zone = useBrandZone();
  const pending = props.publication && props.publication.status !== 'published' ? props.publication : null;
  const [mode, setMode] = useState<'now' | 'schedule'>(pending ? 'schedule' : 'now');
  const [when, setWhen] = useState(() =>
    pending ? toLocalInput(new Date(pending.scheduled_at), zone) : toLocalInput(defaultScheduleDate(null), zone),
  );
  const [error, setError] = useState<string | null>(null);

  const live = (props.accounts ?? []).filter((a) => a.network === props.network && a.status === 'active');
  const [choice, setChoice] = useState<string | null>(null);
  const accountId = choice ?? pending?.social_account_id ?? live[0]?.id ?? '';
  const noAccount = props.accounts !== undefined && live.length === 0;
  const blocker = props.blocked ?? (noAccount ? 'No hay ninguna cuenta conectada.' : undefined);
  const nowBlocker = mode === 'now' ? props.nowBlocked : undefined;

  const submit = () => {
    setError(null);
    if (mode === 'schedule') {
      const at = fromLocalInput(when, zone);
      if (!at) return setError('Indica el día y la hora.');
      if (isPast(at)) return setError('Esa hora ya ha pasado.');
      props.onSubmit({ mode, scheduledAt: at, accountId });
    } else {
      props.onSubmit({ mode, scheduledAt: null, accountId });
    }
  };

  return (
    <div className="space-y-4" data-testid="reel-publish-panel">
      {pending && (
        <p className="text-sm" data-testid="reel-publish-pending">
          {pending.status === 'scheduled'
            ? `Programada para el ${formatDateTime(pending.scheduled_at)}. Puedes cambiar la hora o publicarla ya.`
            : `En el calendario para el ${formatDateTime(pending.scheduled_at)}, todavía sin programar.`}
        </p>
      )}

      {/* Texto de la publicación: lo mismo que en las publicaciones (pie y hashtags). */}
      <CopyFields
        brandId={props.brandId}
        network={props.network}
        format={props.format}
        copy={props.copy}
        onCopy={props.onCopy}
        readOnly={props.readOnly}
        captionAi={props.captionAi}
      />

      {props.approval}

      {noAccount ? (
        <div data-testid="reel-publish-no-account">
          <Notice tone="warning">
            No hay ninguna cuenta conectada.{' '}
            <Link to={props.accountsPath} className="font-medium underline">
              Conéctala en Marca → Cuentas conectadas
            </Link>
            .
          </Notice>
        </div>
      ) : (
        live.length > 1 && (
          <Field label="Cuenta">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={accountId}
                onChange={(e) => setChoice(e.target.value)}
                data-testid="reel-publish-account"
              >
                {live.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.username || a.external_id}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )
      )}

      <fieldset className="space-y-2" disabled={Boolean(blocker)}>
        <legend className="text-sm font-medium">Cuándo</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cuándo se publica">
          {(
            [
              ['now', 'Ahora', Send],
              ['schedule', 'Programar…', CalendarClock],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={
                mode === value
                  ? 'flex items-center justify-center gap-2 rounded-lg border border-primary bg-primary-soft px-3 py-2 text-sm font-medium text-primary'
                  : 'flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-subtle'
              }
              data-testid={`reel-publish-mode-${value}`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        {mode === 'schedule' && (
          <Field
            label="Día y hora"
            hint={`En la ${zoneLabel(zone)}, la de la marca${differsFromDevice(zone) ? ' (no la de tu dispositivo)' : ''}.`}
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                data-testid="reel-publish-when"
              />
            )}
          </Field>
        )}
      </fieldset>

      {(error || blocker || nowBlocker) && (
        <p className="text-sm text-danger" role="alert" data-testid="reel-publish-blocker">
          {error ?? (blocker === 'No hay ninguna cuenta conectada.' ? null : blocker) ?? nowBlocker}
        </p>
      )}

      <Button
        className="w-full"
        onClick={submit}
        loading={props.busy}
        disabled={Boolean(blocker) || Boolean(nowBlocker) || !accountId}
        data-testid="reel-publish-submit"
      >
        {mode === 'now' ? (
          <>
            <Send className="h-4 w-4" aria-hidden />
            Publicar ahora
          </>
        ) : (
          <>
            <CalendarClock className="h-4 w-4" aria-hidden />
            {pending ? 'Cambiar la hora' : 'Programar'}
          </>
        )}
      </Button>
    </div>
  );
}

export interface CopyFieldsProps {
  brandId: string;
  network: string;
  format: string;
  copy: ReelCopy;
  onCopy: (copy: ReelCopy) => void;
  readOnly: boolean;
  /** ¿Se ofrece «Redactar con IA»? (tarea configurada y la marca no está en modo agencia). */
  captionAi: boolean;
}

/** El pie y los hashtags del reel (con «Redactar con IA»): en «Publicar o programar» y en «Terminar en Instagram». */
export function CopyFields(props: CopyFieldsProps) {
  const [tagsText, setTagsText] = useState(() => props.copy.hashtags.map((t) => `#${t}`).join(' '));
  // Si los hashtags cambian desde fuera con la hoja abierta (el pie propuesto que llega tarde,
  // deshacer), el campo los enseña. Lo que se está escribiendo no se toca: solo se reescribe si dice
  // otra cosa que lo guardado.
  const tagsKey = props.copy.hashtags.join(' ');
  const [seenTags, setSeenTags] = useState(tagsKey);
  if (tagsKey !== seenTags) {
    setSeenTags(tagsKey);
    if (parseHashtags(tagsText).join(' ') !== tagsKey) setTagsText(props.copy.hashtags.map((t) => `#${t}`).join(' '));
  }
  const [aiOpen, setAiOpen] = useState(false);
  const length = [...props.copy.caption].length;
  return (
    <fieldset className="space-y-3" disabled={props.readOnly}>
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-medium">Texto</legend>
        {props.captionAi && !props.readOnly && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setAiOpen(true)} data-testid="ai-caption-open">
              Redactar con IA
            </Button>
            <GenerateCaptionDialog
              brandId={props.brandId}
              network={props.network}
              format={props.format}
              open={aiOpen}
              onOpenChange={setAiOpen}
              currentCopy={{
                caption: props.copy.caption,
                hashtags: props.copy.hashtags,
                mentions: [],
                altText: '',
                callToAction: { label: '', url: '' },
              }}
              onApply={(copy) => {
                const hashtags = parseHashtags(copy.hashtags.join(' '));
                setTagsText(hashtags.map((t) => `#${t}`).join(' '));
                props.onCopy({
                  caption: [...copy.caption].slice(0, REEL_CAPTION_MAX).join(''),
                  hashtags,
                  aiGenerated: true,
                });
              }}
            />
          </>
        )}
      </div>
      <Field label="Pie" hint={`${length} de ${REEL_CAPTION_MAX} caracteres.`}>
        {(fieldProps) => (
          <Textarea
            {...fieldProps}
            rows={4}
            maxLength={REEL_CAPTION_MAX}
            value={props.copy.caption}
            placeholder="Qué se ve, por qué venir y cuándo."
            onChange={(e) => props.onCopy({ ...props.copy, caption: e.target.value, aiGenerated: undefined })}
            data-testid="reel-caption"
          />
        )}
      </Field>
      <Field label="Hashtags" hint="Separados por espacios. Se añaden al final del pie si no están ya.">
        {(fieldProps) => (
          <Input
            {...fieldProps}
            value={tagsText}
            placeholder="#crevillent #arroz"
            onChange={(e) => setTagsText(e.target.value)}
            onBlur={() => props.onCopy({ ...props.copy, hashtags: parseHashtags(tagsText) })}
            data-testid="reel-hashtags"
          />
        )}
      </Field>
    </fieldset>
  );
}

/** «Publicada» con su fecha y el enlace a Instagram. */
export function PublishedLine({ publication }: { publication: ScheduledPublicationRow }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="reel-published">
      <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Publicada</span>
      {publication.published_at && <span className="text-muted">el {formatDateTime(publication.published_at)}</span>}
      {publication.external_url && (
        <a
          href={publication.external_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          data-testid="reel-published-link"
        >
          Ver en Instagram
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </p>
  );
}
