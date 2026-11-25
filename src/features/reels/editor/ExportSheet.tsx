// Hoja «Exportar» del editor de reels: el único sitio donde se saca el vídeo,
// como el «Exportar» de CapCut. Al abrirla, el editor monta el vídeo si hace
// falta (guardando antes la versión); aquí se ve cómo va y, cuando está listo,
// se descarga, se abre en la biblioteca, se publica o programa, o se termina en
// Instagram para ponerle música (§12). También
// están la portada, los vídeos anteriores y los avisos de la vista previa, en
// una línea. En móvil el diálogo ya es una hoja que sube desde abajo.
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Loader2,
  Music,
  TriangleAlert,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Dialog, ErrorState, Skeleton } from '@/components/ui';
import { useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { cn, formatDateTime } from '@/lib/utils';
import type { ExportState } from './exportFlow';

export interface PreviousRender {
  id: string;
  version: number | null;
  label: string;
  tone: 'success' | 'danger' | 'progress' | 'neutral';
  createdAt: string;
  detail: string | null;
  assetId: string | null;
}

export interface ExportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Exportar», o «Publicar o programar» cuando se enseña `publishView`. */
  title?: string;
  /** El paso «Publicar o programar» (pie, cuenta y cuándo): sustituye al resto de la hoja. */
  publishView?: ReactNode;
  /** Vuelve de «Publicar o programar» a la hoja. */
  onBack?: () => void;
  /** «Publicada», con su fecha y el enlace (si la pieza ya está en Instagram). */
  published?: ReactNode;
  brandId: string;
  state: ExportState;
  /** ¿Puede montar quien mira? (no, en solo lectura). */
  canRender: boolean;
  /** Monta lo que se ve (guarda antes la versión si hace falta). */
  onRender: () => void;
  /** Lleva a lo primero que impide montar (un archivo que se borró de la biblioteca). */
  onFix?: () => void;
  /** Dirección de un recurso en la biblioteca. */
  libraryPathOf: (assetId: string) => string;
  /** Lo que la vista previa enseña distinto del vídeo. */
  warnings: string[];
  publish: {
    /** «Publicar o programar», o «Publicar otra vez» si ya está publicada. */
    label?: string;
    /** Lo que se dice debajo cuando hay vídeo (programada para…, saldrá repetido…). */
    detail?: string;
    disabled: boolean;
    hint?: string;
    busy: boolean;
    onPublish: () => void;
  };
  /**
   * «Terminar en Instagram (para poner música)»: mandar el vídeo y su pie al móvil y publicarlo allí
   * (docs/editor-reels.md §12). Sin esto (ya publicada) no se ofrece.
   */
  finish?: {
    disabled: boolean;
    hint?: string;
    detail?: string;
    onFinish: () => void;
  };
  /** En modo agencia: el estado de la pieza y su siguiente paso (enviar a revisión, aprobar…). */
  approval?: ReactNode;
  /** Elegir la portada. */
  cover: ReactNode;
  /** Abrir con la portada desplegada (para arreglar una que se borró de la biblioteca). */
  coverOpen?: boolean;
  previous: PreviousRender[];
}

const TONE = { success: 'success', danger: 'danger', progress: 'primary', neutral: 'neutral' } as const;

export function ExportSheet(props: ExportSheetProps) {
  const { state } = props;
  /** Un vídeo anterior que se está mirando en lugar del de ahora. */
  const [viewing, setViewing] = useState<string | null>(null);
  const current = viewing ?? (state.kind === 'ready' ? state.assetId : null);
  const assets = useAssetsByIds(props.brandId, current ? [current] : []);
  const asset = current ? assets.data?.find((a) => a.id === current) : undefined;
  const signed = useSignedUrls(asset ? [asset.storage_path] : []);
  const url = asset ? signed.data?.get(asset.storage_path) : undefined;
  const ready = Boolean(current);
  const older = props.previous.filter((p) => p.assetId !== (state.kind === 'ready' ? state.assetId : null));

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setViewing(null);
        props.onOpenChange(open);
      }}
      title={props.title ?? 'Exportar'}
      size="lg"
    >
      {props.publishView ? (
        <div className="space-y-3" data-testid="reel-export-sheet" data-state={state.kind} data-step="publish">
          {props.onBack && (
            <button
              type="button"
              onClick={props.onBack}
              className="-ml-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
              data-testid="reel-publish-back"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Volver
            </button>
          )}
          {props.publishView}
        </div>
      ) : (
        <div className="space-y-4" data-testid="reel-export-sheet" data-state={state.kind}>
          {props.published}
          <StateLine {...props} viewing={viewing !== null} onBack={() => setViewing(null)} />

          {current && (
            <div className="flex justify-center" data-testid="reel-viewer">
              {assets.isError || signed.isError ? (
                <ErrorState error={assets.error ?? signed.error} />
              ) : url ? (
                <video
                  src={url}
                  controls
                  playsInline
                  className="aspect-[9/16] max-h-[40dvh] rounded-xl bg-black"
                  aria-label="Vídeo montado del reel"
                  data-testid="reel-viewer-video"
                />
              ) : assets.isSuccess && !asset ? (
                <p className="text-sm text-muted">El vídeo ya no está en la biblioteca.</p>
              ) : (
                <Skeleton className="aspect-[9/16] h-[30dvh]" />
              )}
            </div>
          )}

          {/* Las tres salidas: siempre en el mismo orden; se encienden cuando hay vídeo. */}
          <ul className="divide-y divide-border rounded-xl border border-border" data-testid="reel-export-actions">
            <li>
              {url ? (
                <a
                  href={url}
                  download={asset?.file_name ?? 'reel.mp4'}
                  target="_blank"
                  rel="noreferrer"
                  className={rowClass(true)}
                  data-testid="reel-export-download"
                >
                  <Row
                    icon={<Download className="h-5 w-5" aria-hidden />}
                    title="Descargar"
                    detail="El vídeo en tu dispositivo."
                  />
                </a>
              ) : (
                <button type="button" disabled className={rowClass(false)} data-testid="reel-export-download">
                  <Row
                    icon={<Download className="h-5 w-5" aria-hidden />}
                    title="Descargar"
                    detail="Cuando el vídeo esté listo."
                  />
                </button>
              )}
            </li>
            <li>
              {current ? (
                <Link to={props.libraryPathOf(current)} className={rowClass(true)} data-testid="reel-export-library">
                  <Row
                    icon={<FolderOpen className="h-5 w-5" aria-hidden />}
                    title="Guardar en la biblioteca"
                    detail="Ya se guarda solo, en la carpeta «Reels». Ábrelo allí."
                  />
                </Link>
              ) : (
                <button type="button" disabled className={rowClass(false)} data-testid="reel-export-library">
                  <Row
                    icon={<FolderOpen className="h-5 w-5" aria-hidden />}
                    title="Guardar en la biblioteca"
                    detail="Se guarda solo al montarlo."
                  />
                </button>
              )}
            </li>
            <li>
              <button
                type="button"
                onClick={props.publish.onPublish}
                disabled={!ready || viewing !== null || props.publish.disabled || props.publish.busy}
                title={props.publish.hint}
                className={rowClass(ready && viewing === null && !props.publish.disabled)}
                data-testid="reel-export-publish"
              >
                <Row
                  icon={
                    props.publish.busy ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    ) : (
                      <CalendarClock className="h-5 w-5" aria-hidden />
                    )
                  }
                  title={props.publish.label ?? 'Publicar o programar'}
                  detail={
                    !ready
                      ? 'Cuando el vídeo esté listo.'
                      : viewing !== null
                        ? 'Se publica el vídeo de ahora, no uno anterior.'
                        : (props.publish.hint ??
                          props.publish.detail ??
                          'Ahora o el día y la hora que elijas, con su pie.')
                  }
                />
              </button>
            </li>
            {props.finish && (
              <li>
                <button
                  type="button"
                  onClick={props.finish.onFinish}
                  disabled={!ready || viewing !== null || props.finish.disabled}
                  title={props.finish.hint}
                  className={rowClass(ready && viewing === null && !props.finish.disabled)}
                  data-testid="reel-export-instagram"
                >
                  <Row
                    icon={<Music className="h-5 w-5" aria-hidden />}
                    title="Terminar en Instagram (para poner música)"
                    detail={
                      !ready
                        ? 'Cuando el vídeo esté listo.'
                        : viewing !== null
                          ? 'Se manda el vídeo de ahora, no uno anterior.'
                          : (props.finish.hint ??
                            props.finish.detail ??
                            'Manda el vídeo y el pie al móvil y ponle la música en Instagram.')
                    }
                  />
                </button>
              </li>
            )}
          </ul>

          {props.approval}

          {props.warnings.length > 0 && <Warnings warnings={props.warnings} />}

          <details
            className="group rounded-xl border border-border"
            open={props.coverOpen}
            data-testid="reel-export-cover"
          >
            <summary className={summaryClass}>
              Portada
              <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <div className="border-t border-border p-3">{props.cover}</div>
          </details>

          {older.length > 0 && (
            <details className="group rounded-xl border border-border" data-testid="reel-export-previous">
              <summary className={summaryClass}>
                Vídeos anteriores ({older.length})
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <ul className="divide-y divide-border border-t border-border px-3" data-testid="reel-piece-jobs">
                {older.map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-sm"
                    data-testid="reel-piece-job"
                  >
                    <span>Versión {job.version ?? '?'}</span>
                    <Badge tone={TONE[job.tone]}>{job.label}</Badge>
                    <span className="text-xs text-muted">{formatDateTime(job.createdAt)}</span>
                    {job.detail && <span className="w-full text-xs text-danger">{job.detail}</span>}
                    {job.assetId && (
                      <button
                        type="button"
                        className="ml-auto font-medium text-primary hover:underline"
                        onClick={() => setViewing(job.assetId)}
                      >
                        Ver
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}

const summaryClass =
  'flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden';

const rowClass = (enabled: boolean) =>
  cn(
    'flex w-full items-center gap-3 px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
    enabled ? 'hover:bg-subtle' : 'cursor-not-allowed opacity-50',
  );

function Row({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <>
      <span className="shrink-0 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </>
  );
}

/** En qué punto está el vídeo, en una línea, con el único botón que haga falta. */
function StateLine({
  state,
  canRender,
  onRender,
  onFix,
  viewing,
  onBack,
}: ExportSheetProps & { viewing: boolean; onBack: () => void }) {
  if (viewing) {
    return (
      <p className="text-sm" data-testid="reel-render-state">
        Estás viendo un vídeo anterior.{' '}
        <button type="button" className="font-medium text-primary hover:underline" onClick={onBack}>
          Volver al de ahora
        </button>
      </p>
    );
  }
  switch (state.kind) {
    case 'empty':
      return (
        <p className="text-sm text-muted" data-testid="reel-render-state">
          Añade fotos o clips para montar el vídeo.
        </p>
      );
    case 'problems':
      return (
        <div className="space-y-1" data-testid="reel-render-state">
          <p className="text-sm font-medium text-danger">Antes de montarlo, arregla esto:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-danger" data-testid="reel-problems">
            {state.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {onFix && canRender && (
            <Button size="sm" variant="secondary" onClick={onFix} data-testid="reel-export-fix">
              Ir a lo que falta
            </Button>
          )}
        </div>
      );
    case 'checking':
      return (
        <p className="flex items-center gap-2 text-sm text-muted" role="status" data-testid="reel-render-state">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Comprobando…
        </p>
      );
    case 'unavailable':
      return (
        <p className="text-sm text-muted" data-testid="reel-render-state">
          En esta instalación no se puede montar el vídeo.
        </p>
      );
    case 'rendering':
      return (
        <div className="space-y-1" role="status" data-testid="reel-render-state">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
            <span>
              {state.label === 'Montando' ? 'Montando el vídeo' : `Montando el vídeo (${state.label.toLowerCase()})`}…
              Puedes cerrar esto y seguir editando.
            </span>
          </p>
          {state.detail && (
            <p className="pl-6 text-xs text-muted" data-testid="reel-render-detail">
              {state.detail}
            </p>
          )}
        </div>
      );
    case 'failed':
      return (
        <div className="flex flex-wrap items-center gap-2" data-testid="reel-render-state">
          <p className="min-w-0 flex-1 text-sm text-danger" role="alert">
            No se pudo montar{state.detail ? `: ${state.detail}` : '.'}
          </p>
          {canRender && (
            <Button size="sm" onClick={onRender} data-testid="reel-render">
              Probar otra vez
            </Button>
          )}
        </div>
      );
    case 'changed':
      return (
        <div className="flex flex-wrap items-center gap-2" data-testid="reel-render-state">
          <p className="min-w-0 flex-1 text-sm text-muted">
            {state.first || !canRender
              ? 'Todavía no hay vídeo de este reel.'
              : 'El vídeo todavía no tiene los últimos cambios.'}
          </p>
          {canRender && (
            <Button size="sm" onClick={onRender} data-testid="reel-render">
              {state.first ? 'Montar el vídeo' : 'Montar con los cambios'}
            </Button>
          )}
        </div>
      );
    case 'ready':
      return (
        <p className="flex items-center gap-2 text-sm" data-testid="reel-render-state">
          <Badge tone="success">Listo</Badge>
          El vídeo está montado.
        </p>
      );
  }
}

/** Los avisos de la vista previa: el primero a la vista y el resto al pedirlos. */
function Warnings({ warnings }: { warnings: string[] }) {
  const [all, setAll] = useState(false);
  const [first, ...rest] = warnings;
  return (
    <div className="flex gap-2 text-xs text-muted" data-testid="reel-export-warnings">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p>
          {first}
          {rest.length > 0 && !all && (
            <>
              {' '}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setAll(true)}>
                {rest.length === 1 ? 'Y 1 aviso más' : `Y ${rest.length} avisos más`}
              </button>
            </>
          )}
        </p>
        {all && rest.map((w) => <p key={w}>{w}</p>)}
      </div>
    </div>
  );
}
