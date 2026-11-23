// «Exportar → Terminar en Instagram (para poner música)» (docs/editor-reels.md §12).
//
// La API de Instagram no crea borradores ni pone canciones de su biblioteca, así que el reel sale sin
// música (como al publicar desde aquí) y se termina en el móvil:
//   · En el móvil: se copia el pie y se comparte el MP4 con el diálogo del sistema, donde está Instagram.
//   · En un ordenador: se descarga el MP4, se copia el pie y se enseña un código QR con un enlace firmado
//     de corta duración al vídeo, para abrirlo en el móvil.
// Al mandarlo, la pieza queda «Pendiente de publicar en Instagram» (`manual_publications`). Después se
// marca «Ya lo publiqué» (con el enlace si se tiene) o la aplicación la reconoce sola entre las últimas
// publicaciones de la cuenta conectada (`ManualPublicationLine`).
import { Download, ExternalLink, Loader2, Search, Share2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Field, Input, Notice } from '@/components/ui';
import { signStoragePaths } from '@/features/storage/api';
import type { ManualPublicationRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';
import { canShareVideo, instagramCaption, normalizeInstagramUrl } from './manualFlow';
import type { FindOutcome } from './manualApi';
import { notify } from './notify';
import type { ReelCopy } from './project';
import { QrCode } from './QrCode';

/** Lo que dura el enlace del código QR (en el almacén de Supabase; R2 firma por una hora). */
export const QR_LINK_SECONDS = 15 * 60;

export interface FinishInInstagramProps {
  /** El vídeo montado de lo que se ve. */
  video: { storagePath: string } | null;
  copy: ReelCopy;
  /** Pie y hashtags (los mismos campos que «Publicar o programar»). */
  copyFields: ReactNode;
  /** En modo agencia, el estado y su siguiente paso. */
  approval?: ReactNode;
  /** Por qué no se puede (sin permiso, sin aprobar…). */
  blocked?: string;
  /**
   * Deja la pieza lista y la marca como pendiente: guarda la versión si hay cambios, la aprueba en
   * autogestión y llama a `start_manual_publication`. Devuelve false si no se pudo (ya lo ha dicho).
   */
  onSent: (caption: string) => Promise<boolean>;
  /** Ya estaba pendiente (se vuelve a mandar). */
  pending: boolean;
  /** ¿Hay una cuenta de Instagram conectada? (sin ella, la aplicación no puede buscar el reel al volver). */
  hasAccount?: boolean;
  /** Para las pruebas: ¿móvil con el diálogo de compartir? */
  shareMode?: 'share' | 'download';
}

type Step = 'idle' | 'sent';

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function FinishInInstagram(props: FinishInInstagramProps) {
  const [mode] = useState<'share' | 'download'>(() => props.shareMode ?? (canShareVideo() ? 'share' : 'download'));
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);
  const download = useRef<HTMLAnchorElement>(null);
  const text = instagramCaption(props.copy);
  const path = props.video?.storagePath ?? null;

  // El enlace firmado al vídeo (para descargarlo y para el QR) y, en el móvil, el archivo ya bajado: el
  // diálogo de compartir tiene que abrirse en el mismo toque, sin esperar a la descarga.
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const signed = (await signStoragePaths([path], QR_LINK_SECONDS)).get(path);
        if (cancelled) return;
        if (!signed) throw new Error('No se pudo preparar el enlace del vídeo.');
        setUrl(signed);
        if (mode === 'share') {
          const response = await fetch(signed);
          if (!response.ok) throw new Error('No se pudo bajar el vídeo.');
          const blob = await response.blob();
          if (!cancelled) setFile(new File([blob], 'reel.mp4', { type: 'video/mp4' }));
        }
      } catch (e) {
        if (!cancelled) setProblem(e instanceof Error ? e.message : 'No se pudo preparar el vídeo.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, mode]);

  const afterSend = async () => {
    setBusy(true);
    try {
      if (await props.onSent(text)) setStep('sent');
    } finally {
      setBusy(false);
    }
  };

  /** Móvil: el pie al portapapeles y el vídeo al diálogo de compartir (en el mismo toque). */
  const share = async () => {
    if (!file) return;
    const copied = copyText(text);
    // El error se recoge ya (para no dejar una promesa rechazada sin atender mientras se copia el pie).
    let shared: Promise<unknown>;
    try {
      shared = navigator.share({ files: [file] }).then(
        () => null,
        (e: unknown) => e ?? new Error('share'),
      );
    } catch (e) {
      shared = Promise.resolve(e);
    }
    if (await copied) notify.success('Pie copiado: pégalo en Instagram');
    const failure = await shared;
    if (failure) {
      // Cerrar el diálogo sin elegir nada no es un error: no se marca nada.
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      notify.error('No se pudo compartir el vídeo. Descárgalo y ábrelo desde Instagram.');
      return;
    }
    await afterSend();
  };

  /** Ordenador: descargar, copiar el pie y enseñar el QR. */
  const sendToPhone = async () => {
    if (!url) return;
    const copied = copyText(text);
    download.current?.click();
    if (await copied) notify.success('Pie copiado: pégalo en Instagram');
    await afterSend();
  };

  const ready = mode === 'share' ? Boolean(file) : Boolean(url);
  const disabled = Boolean(props.blocked) || !ready || busy;

  return (
    <div className="space-y-4" data-testid="reel-instagram-panel" data-mode={mode}>
      <p className="text-sm text-muted">
        Instagram no deja poner su música desde otras aplicaciones: el vídeo sale sin música y se la pones tú en
        Instagram, con su pie.
      </p>

      {props.copyFields}
      {props.approval}
      {props.hasAccount === false && (
        <Notice tone="info">
          Sin una cuenta conectada, al volver lo marcas tú con «Ya lo publiqué»: la aplicación no puede buscarlo en
          Instagram.
        </Notice>
      )}

      {problem && (
        <p className="text-sm text-danger" role="alert">
          {problem}
        </p>
      )}
      {props.blocked && (
        <p className="text-sm text-danger" role="alert" data-testid="reel-instagram-blocked">
          {props.blocked}
        </p>
      )}

      {mode === 'share' ? (
        <Button
          className="w-full"
          onClick={() => void share()}
          disabled={disabled}
          loading={busy}
          data-testid="reel-instagram-share"
        >
          {ready || problem ? (
            <Share2 className="h-4 w-4" aria-hidden />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          )}
          {ready || problem ? 'Compartir con Instagram' : 'Preparando el vídeo…'}
        </Button>
      ) : null}
      {mode === 'share' && url && (
        // Si el diálogo de compartir falla (o no sale Instagram), el vídeo se guarda y se elige desde Instagram.
        <a
          href={url}
          download="reel.mp4"
          target="_blank"
          rel="noreferrer"
          className="block text-center text-sm text-muted underline hover:text-fg"
          data-testid="reel-instagram-download"
        >
          O guarda el vídeo y elígelo desde Instagram
        </a>
      )}
      {mode === 'share' ? null : (
        <>
          <Button
            className="w-full"
            onClick={() => void sendToPhone()}
            disabled={disabled}
            loading={busy}
            data-testid="reel-instagram-send"
          >
            <Download className="h-4 w-4" aria-hidden />
            {props.pending ? 'Descargar y copiar el pie otra vez' : 'Descargar, copiar el pie y abrir en el móvil'}
          </Button>
          {url && (
            <a ref={download} href={url} download="reel.mp4" className="hidden" aria-hidden tabIndex={-1}>
              reel.mp4
            </a>
          )}
        </>
      )}

      {step === 'sent' && mode === 'download' && url && (
        <div
          className="flex flex-col items-center gap-3 sm:flex-row sm:items-start"
          data-testid="reel-instagram-qr-box"
        >
          <QrCode
            value={url}
            label="Código QR para abrir el vídeo en el móvil"
            className="h-48 w-48 shrink-0 rounded-lg border border-border"
          />
          <div className="min-w-0 space-y-2 text-sm">
            <p className="font-medium">Escanéalo con la cámara del móvil y guarda el vídeo.</p>
            <Steps />
            <p className="text-xs text-muted">
              El enlace caduca en poco tiempo y no lleva datos tuyos. El pie se ha copiado en este ordenador: si no lo
              tienes en el móvil, abre este reel en la aplicación desde el móvil y usa «Terminar en Instagram» allí.
            </p>
          </div>
        </div>
      )}
      {step === 'sent' && mode === 'share' && <Steps />}
      {step === 'sent' && text && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copyText(text).then((ok) => ok && notify.success('Pie copiado: pégalo en Instagram'))}
          data-testid="reel-instagram-copy-again"
        >
          Copiar el pie otra vez
        </Button>
      )}

      <MusicHelp />
    </div>
  );
}

/** Los pasos en Instagram, en tres líneas. */
function Steps() {
  return (
    <ol className="list-decimal space-y-0.5 pl-5 text-sm" data-testid="reel-instagram-steps">
      <li>Abre Instagram y crea un reel.</li>
      <li>Elige el vídeo.</li>
      <li>Añade música y pega el pie. Después, comparte.</li>
    </ol>
  );
}

/** Lo que cambia según el tipo de cuenta, sin prometer lo que no se puede comprobar desde aquí. */
function MusicHelp() {
  return (
    <details className="group rounded-xl border border-border text-sm" data-testid="reel-instagram-help">
      <summary className="cursor-pointer list-none px-3 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
        ¿No te sale la canción que quieres?
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-2.5 text-muted">
        <p>
          <span className="font-medium text-fg">Cuenta de creador:</span> suele tener la biblioteca de música de
          Instagram.
        </p>
        <p>
          <span className="font-medium text-fg">Cuenta de empresa:</span> a veces solo tiene la música libre de Meta
          («Sound Collection»), y no todas las canciones salen. Si la que buscas no aparece, elige otra de la lista.
        </p>
        <p>Qué canciones hay lo decide Instagram (cambia con el país y la cuenta); desde aquí no se puede saber.</p>
      </div>
    </details>
  );
}

export interface ManualPublicationLineProps {
  row: ManualPublicationRow;
  canEdit: boolean;
  find: { searchable: boolean; busy: boolean; outcome: FindOutcome | null; run: () => void };
  onConfirm: (url: string | null) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}

const FIND_TEXT: Record<'none' | 'ambiguous', string> = {
  none: 'Todavía no aparece en la cuenta. Si ya lo has publicado, pulsa «Ya lo publiqué».',
  ambiguous: 'Hay varios reels que se le parecen: márcalo tú con «Ya lo publiqué» y su enlace.',
};

/** «Pendiente de publicar en Instagram» con «Ya lo publiqué», o «Publicada» si ya salió. */
export function ManualPublicationLine(props: ManualPublicationLineProps) {
  const { row } = props;
  const [form, setForm] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const published = row.status === 'published';

  const save = async () => {
    const url = normalizeInstagramUrl(link);
    if (url === 'invalid') return setError('Pega el enlace del reel en instagram.com, o déjalo vacío.');
    setError(null);
    try {
      await props.onConfirm(url);
      setForm(false);
    } catch (e) {
      setError(translateError(e));
    }
  };

  return (
    <div className="space-y-2" data-testid="reel-manual" data-status={row.status}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {published ? (
          <Badge tone="success">Publicada</Badge>
        ) : (
          <Badge tone="warning">
            <span data-testid="reel-manual-pending">Pendiente de publicar en Instagram</span>
          </Badge>
        )}
        <span className="text-muted">
          {published && row.published_at
            ? `el ${formatDateTime(row.published_at)}`
            : `mandado al móvil el ${formatDateTime(row.handed_off_at)}`}
        </span>
        {published && row.external_url && (
          <a
            href={row.external_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            data-testid="reel-manual-link"
          >
            Ver en Instagram
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
        {published && row.match_source === 'manual' && <span className="text-xs text-muted">(marcada a mano)</span>}
      </p>

      {props.canEdit && !form && (
        <div className="flex flex-wrap items-center gap-2">
          {!published && (
            <Button size="sm" onClick={() => setForm(true)} data-testid="reel-manual-done">
              Ya lo publiqué
            </Button>
          )}
          {published && row.match_source === 'manual' && !row.external_url && (
            <Button size="sm" variant="secondary" onClick={() => setForm(true)} data-testid="reel-manual-add-link">
              Añadir el enlace
            </Button>
          )}
          {props.find.searchable && (
            <Button
              size="sm"
              variant="secondary"
              onClick={props.find.run}
              loading={props.find.busy}
              data-testid="reel-manual-find"
            >
              <Search className="h-4 w-4" aria-hidden />
              Buscar en Instagram
            </Button>
          )}
          {!published && (
            <button
              type="button"
              className="text-sm text-muted hover:text-fg hover:underline"
              onClick={props.onCancel}
              disabled={props.busy}
              data-testid="reel-manual-cancel"
            >
              No lo voy a publicar
            </button>
          )}
        </div>
      )}

      {props.find.outcome && props.find.outcome.kind !== 'found' && !props.find.busy && (
        <p className="text-xs text-muted" role="status" data-testid="reel-manual-find-result">
          {props.find.outcome.kind === 'error' ? props.find.outcome.message : FIND_TEXT[props.find.outcome.kind]}
        </p>
      )}

      {form && (
        <div className="space-y-2 rounded-xl border border-border p-3" data-testid="reel-manual-form">
          <Field label="Enlace del reel (opcional)" hint="Lo copias desde el reel en Instagram.">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="url"
                inputMode="url"
                value={link}
                placeholder="https://www.instagram.com/reel/…"
                onChange={(e) => setLink(e.target.value)}
                data-testid="reel-manual-url"
              />
            )}
          </Field>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save()} loading={props.busy} data-testid="reel-manual-save">
              {published ? 'Guardar el enlace' : 'Marcar como publicada'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
