// «Hacer un reel como este» (docs/reel-como-este.md).
//
// Una persona sube un reel o un vídeo que le gusta (o pega su enlace) y el
// sistema lo estudia y lo rehace con las ideas y el material de la marca:
//
//   1. subir o pegar el enlace, con el coste máximo a la vista;
//   2. progreso por pasos: medir (sin IA) y mirar y escribir (IA);
//   3. resultado: plantilla, guion y lista de planos, borrador con la
//      biblioteca y textos; «Abrir en el editor» y «Guardar como plantilla».
//
// El vídeo de referencia solo se estudia: no entra en la biblioteca, no se usa
// en ninguna pieza y se borra al terminar (salvo que se pida guardarlo como
// referencia privada). Sin un modelo con visión en el servidor, esta pantalla
// no se ofrece: nada se simula.
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Copy,
  Film,
  FolderOpen,
  Link2,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Field,
  Input,
  Notice,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { DictableField } from '@/features/ai/DictableField';
import { reelLikeEnabled, STORAGE_BUCKET } from '@/config/app';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { formatMicros, moneyEstimateNote } from '@/features/ai/money';
import { useContentMutations } from '@/features/content/api';
import { contentPaths } from '@/features/content/labels';
import { useBrand, useOrg } from '@/features/orgs/context';
import type { ReelReferenceRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { cn, formatDateTime } from '@/lib/utils';
import {
  AUDIO_KIND_LABEL,
  PACE_LABEL,
  parseReelLikeResult,
  SHOT_KIND_LABEL,
  TEXT_ROLE_LABEL,
  type ReelLikeResult,
  type ReelStructure,
} from '../../../../supabase/functions/_shared/reels/like';
import {
  closedNetwork,
  fetchLibraryVideo,
  isWorking,
  libraryVideoProblem,
  linkReferenceContent,
  looksLikeUrl,
  NAME_PARAM,
  reelLikePaths,
  referenceFileProblem,
  useLibraryVideos,
  useLinkedPiece,
  withName,
  useDiscardReference,
  useRecentReferences,
  useReelLikeOptions,
  useReelReference,
  useSaveReferenceTemplate,
  useStartAnalysis,
  useStudyReference,
  type LibraryVideo,
  type ReelLikeOptions,
} from './api';
import { TEMPLATE_NAME_MAX } from './template';
import { useReelLikeDraft } from './useDraft';
import { videoSeconds } from './videoFile';

const seconds = (value: number) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(value)} s`;
const POSITION_LABEL = { top: 'arriba', center: 'en el centro', bottom: 'abajo' } as const;
const SIZE_LABEL = { grande: 'grande', normal: 'normal', pequeno: 'pequeño' } as const;
const STATUS_LABEL: Record<ReelReferenceRow['status'], string> = {
  analyzing: 'Midiendo',
  measured: 'Medido',
  ready: 'Listo',
  failed: 'No se pudo',
  expired: 'Caducado',
};

export function ReelLikePage() {
  const { org } = useOrg();
  const { brand } = useBrand();
  const { referenceId } = useParams();
  const paths = reelLikePaths(org.id, brand.id);
  const options = useReelLikeOptions(brand.id, reelLikeEnabled());
  if (!reelLikeEnabled()) return <Navigate to={paths.reels} replace />;

  return (
    <>
      <PageHeader
        title="Hacer un reel como este"
        description={`Sube un reel o un vídeo que te guste, o elígelo de tu biblioteca. Lo estudiamos y lo rehacemos con las ideas y el material de ${brand.name}.`}
        back={
          <Link to={paths.reels} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Reels
          </Link>
        }
      />
      {options.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !options.data?.available ? (
        <Unavailable options={options.data} />
      ) : referenceId ? (
        <ReferenceScreen referenceId={referenceId} options={options.data} />
      ) : (
        <StartScreen options={options.data} />
      )}
    </>
  );
}

function Unavailable({ options }: { options: ReelLikeOptions | undefined }) {
  const { org } = useOrg();
  const { brand } = useBrand();
  return (
    <div data-testid="reel-like-unavailable">
      <Notice tone="warning">
        {options?.reason === 'agency_mode' ? (
          'Esta marca trabaja por encargo a la agencia: «Hacer un reel como este» lo usa el equipo de la agencia.'
        ) : options?.reason === 'profile_missing' ? (
          <>
            Esta marca todavía no tiene perfil, y sin él no podemos escribir con su tono.{' '}
            <Link to={`/o/${org.id}/m/${brand.id}/marca`} className="font-medium underline">
              Completa el perfil de la marca
            </Link>
            .
          </>
        ) : (
          '«Hacer un reel como este» no está disponible ahora mismo: falta configurar la IA en la plataforma. Avisa a quien la administra.'
        )}
      </Notice>
    </div>
  );
}

// ───────────────────────────── 1. Subir o pegar el enlace ─────────────────────────────

function StartScreen({ options }: { options: ReelLikeOptions }) {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const navigate = useNavigate();
  const paths = reelLikePaths(org.id, brand.id);
  const start = useStartAnalysis(brand.id);
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'file' | 'library' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  /** El nombre que se escribió en «Nuevo reel» (o aquí): será el de la pieza que se cree. */
  const [name, setName] = useState(() => params.get(NAME_PARAM) ?? '');
  const videos = useLibraryVideos(brand.id, mode === 'library');
  const [chosen, setChosen] = useState<LibraryVideo | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [url, setUrl] = useState('');
  const [idea, setIdea] = useState('');
  const [speech, setSpeech] = useState(options.speechAvailable);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = can('edit');
  const { limits, estimate } = options;

  const fileProblem = file
    ? (referenceFileProblem(file, limits.maxUploadBytes) ??
      (duration !== null && duration > limits.maxSeconds + 0.5
        ? `El vídeo dura ${Math.round(duration)} s y el máximo son ${limits.maxSeconds} s (3 minutos). Recórtalo y vuelve a subirlo.`
        : null))
    : null;
  // Instagram, TikTok, YouTube y Facebook no dejan descargar: se dice al pegar, sin mandar nada a estudiar.
  const closed = mode === 'link' && looksLikeUrl(url) ? closedNetwork(url) : null;
  const linkProblem =
    mode !== 'link' || url.trim() === ''
      ? null
      : !looksLikeUrl(url)
        ? 'Pega la dirección completa, empezando por https://'
        : closed
          ? `${closed} no deja descargar sus vídeos desde un enlace. Descarga el vídeo en tu móvil y súbelo, o elígelo de tu biblioteca.`
          : null;
  const chosenProblem = mode === 'library' && chosen ? libraryVideoProblem(chosen, limits) : null;
  const ready =
    mode === 'file'
      ? Boolean(file) && !fileProblem
      : mode === 'library'
        ? Boolean(chosen) && !chosenProblem
        : looksLikeUrl(url) && !closed;

  // Coste máximo: mirar y escribir + la voz que se vaya a transcribir (si se sabe cuánto dura, solo eso).
  const knownSeconds =
    mode === 'file' ? duration : mode === 'library' && chosen?.duration_ms ? chosen.duration_ms / 1000 : null;
  const speechSeconds = Math.min(
    knownSeconds !== null ? Math.ceil(knownSeconds) : limits.maxSpeechSeconds,
    limits.maxSpeechSeconds,
  );
  const speechMicros =
    speech && estimate?.speechMicrosPerSecond ? Math.ceil(estimate.speechMicrosPerSecond * speechSeconds) : 0;
  const maxMicros = (estimate?.textMicros ?? 0) + speechMicros;

  async function pick(next: File | null) {
    setFile(next);
    setDuration(null);
    if (next) setDuration(await videoSeconds(next));
  }

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      // Un vídeo de la biblioteca se estudia como uno subido: se copia a la carpeta privada de referencias
      // (y se borra al terminar); el de la biblioteca no se toca.
      const source =
        mode === 'file' ? { file: file! } : mode === 'library' ? { file: await fetchLibraryVideo(chosen!) } : { url };
      const created = await start.mutateAsync({
        organizationId: org.id,
        ...source,
        speech: speech && options.speechAvailable,
        keepSource: mode === 'file' && keep,
        idea,
      });
      navigate(withName(paths.reference(created.referenceId), name));
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="space-y-6">
        <Notice>Solo quien edita la marca puede estudiar un vídeo. Aquí puedes ver los análisis ya hechos.</Notice>
        <RecentAnalyses />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardBody className="space-y-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-label="Cómo nos das el vídeo">
            {(
              [
                { id: 'file', label: 'Subir el vídeo', icon: Upload },
                { id: 'library', label: 'De la biblioteca', icon: FolderOpen },
                { id: 'link', label: 'Pegar un enlace', icon: Link2 },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                onClick={() => setMode(tab.id)}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium',
                  mode === tab.id ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-subtle',
                )}
                data-testid={`reel-like-mode-${tab.id}`}
              >
                <tab.icon className="h-4 w-4 shrink-0" aria-hidden />
                {tab.label}
              </button>
            ))}
          </div>

          {mode === 'file' ? (
            <Field
              label="El vídeo que te gusta"
              hint={`MP4, MOV o WebM · hasta ${limits.maxSeconds / 60} minutos y ${Math.round(limits.maxUploadBytes / (1024 * 1024))} MB.`}
              error={fileProblem}
            >
              {(props) => (
                <input
                  {...props}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-subtle file:px-4 file:text-sm file:font-medium"
                  onChange={(event) => void pick(event.target.files?.[0] ?? null)}
                  data-testid="reel-like-file"
                />
              )}
            </Field>
          ) : mode === 'library' ? (
            <LibraryVideoPicker
              videos={videos.data ?? []}
              loading={videos.isPending}
              chosen={chosen}
              onChoose={setChosen}
              problem={chosenProblem}
            />
          ) : (
            <>
              {/* Antes de pegar nada: qué enlaces no se pueden descargar y qué hacer en su lugar. */}
              <div data-testid="reel-like-link-notice">
                <Notice tone="warning">
                  Los enlaces de Instagram, TikTok, YouTube y Facebook no se pueden descargar: esas redes no lo
                  permiten. Descarga el vídeo en tu móvil y súbelo, o elígelo de tu biblioteca. Aquí valen los enlaces
                  directos a un archivo de vídeo.
                </Notice>
              </div>
              <Field
                label="Enlace del vídeo"
                hint="Un enlace directo a un archivo de vídeo (MP4, MOV o WebM)."
                error={linkProblem}
              >
                {(props) => (
                  <Input
                    {...props}
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    data-testid="reel-like-url"
                  />
                )}
              </Field>
            </>
          )}

          <Field label="Nombre del reel" optional hint="Solo lo ve el equipo. Si lo dejas vacío, el del guion.">
            {(props) => (
              <Input
                {...props}
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                data-testid="reel-like-name"
              />
            )}
          </Field>

          <Field
            label="¿De qué quieres que vaya tu reel?"
            optional
            hint="Si no lo sabes, te proponemos una idea a partir del perfil de la marca."
          >
            {(props) => (
              <DictableField
                {...props}
                brandId={brand.id}
                rows={2}
                maxLength={600}
                value={idea}
                onValueChange={setIdea}
                placeholder="Por ejemplo: cómo preparamos el menú del día"
                data-testid="reel-like-idea"
              />
            )}
          </Field>

          <div className="space-y-3">
            {options.speechAvailable && (
              <Check2
                checked={speech}
                onChange={setSpeech}
                label="Transcribir lo que se dice"
                hint="Para entender el guion cuando alguien habla. Si solo hay música, desmárcalo."
                testId="reel-like-speech"
              />
            )}
            {mode === 'file' && (
              <Check2
                checked={keep}
                onChange={setKeep}
                label="Guardar el vídeo como referencia privada"
                hint="Si no lo marcas, el vídeo se borra en cuanto termina el análisis."
                testId="reel-like-keep"
              />
            )}
          </div>

          <div className="rounded-lg bg-subtle p-3 text-sm" data-testid="reel-like-cost">
            <p className="font-medium">
              Coste máximo estimado: <span data-testid="reel-like-cost-max">{formatMicros(maxMicros)}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              Mirar el vídeo y escribir tu versión: hasta {formatMicros(estimate?.textMicros ?? 0)}.
              {speech && options.speechAvailable
                ? ` Transcribir la voz (hasta ${speechSeconds} s): hasta ${formatMicros(speechMicros)}.`
                : ' Sin transcribir la voz.'}{' '}
              Medir los cortes y el ritmo no usa IA. Lo normal es que cueste menos: se descuenta de tu cupo solo lo que
              se use.
            </p>
            <p className="mt-1 text-xs text-muted">{moneyEstimateNote()}</p>
          </div>

          <Notice>
            El vídeo solo se estudia para entender cómo está hecho. No se copian sus imágenes, su música ni sus textos,
            y nunca entra en tu biblioteca.
          </Notice>

          <Button
            onClick={() => void submit()}
            disabled={!ready}
            loading={busy}
            className="w-full sm:w-auto"
            data-testid="reel-like-start"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {busy && mode === 'file' ? 'Subiendo el vídeo…' : 'Estudiar este vídeo'}
          </Button>
        </CardBody>
      </Card>
      <RecentAnalyses />
    </div>
  );
}

function Check2({
  checked,
  onChange,
  label,
  hint,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  testId: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 rounded border-border"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid={testId}
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  );
}

function LibraryVideoPicker({
  videos,
  loading,
  chosen,
  onChoose,
  problem,
}: {
  videos: LibraryVideo[];
  loading: boolean;
  chosen: LibraryVideo | null;
  onChoose: (video: LibraryVideo) => void;
  problem: string | null;
}) {
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (videos.length === 0) {
    return (
      <div data-testid="reel-like-library-empty">
        <Notice>No hay vídeos en tu biblioteca. Súbelo como archivo o añádelo antes a la biblioteca.</Notice>
      </div>
    );
  }
  return (
    <fieldset className="space-y-2" data-testid="reel-like-library">
      <legend className="mb-1 text-sm font-medium">Elige un vídeo de tu biblioteca</legend>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {videos.map((video) => (
          <li key={video.id}>
            <label
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                chosen?.id === video.id ? 'border-primary bg-primary-soft' : 'border-border hover:bg-subtle',
              )}
            >
              <input
                type="radio"
                name="reel-like-library-video"
                className="h-4 w-4 shrink-0"
                checked={chosen?.id === video.id}
                onChange={() => onChoose(video)}
                data-testid="reel-like-library-video"
              />
              <Film className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 break-all">{video.file_name}</span>
              {video.duration_ms !== null && (
                <span className="shrink-0 text-xs text-muted">{seconds(video.duration_ms / 1000)}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="text-sm text-danger" data-testid="reel-like-library-problem">
          {problem}
        </p>
      )}
      <p className="text-xs text-muted">Se estudia una copia: el vídeo de tu biblioteca no cambia ni se borra.</p>
    </fieldset>
  );
}

function sourceLabel(row: ReelReferenceRow): string {
  return row.source_kind === 'link' ? `Enlace de ${row.source_host ?? 'una web'}` : 'Vídeo subido';
}

function RecentAnalyses() {
  const { org } = useOrg();
  const { brand } = useBrand();
  const paths = reelLikePaths(org.id, brand.id);
  const recent = useRecentReferences(brand.id);
  const rows = recent.data ?? [];
  if (recent.isPending || rows.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Análisis recientes" />
      <ul className="divide-y divide-border" data-testid="reel-like-recent">
        {rows.map((row) => {
          const title = parseReelLikeResult(row.result)?.script.title;
          return (
            <li key={row.id} className="px-5 py-3 text-sm">
              <Link to={paths.reference(row.id)} className="block min-h-11 hover:underline">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words font-medium">{title ?? sourceLabel(row)}</span>
                  <Badge
                    tone={
                      row.status === 'ready'
                        ? 'success'
                        : row.status === 'failed' || row.status === 'expired'
                          ? 'danger'
                          : 'primary'
                    }
                  >
                    {STATUS_LABEL[row.status]}
                  </Badge>
                </span>
                <span className="text-xs text-muted">{formatDateTime(row.created_at)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ───────────────────────────── 2. Progreso por pasos ─────────────────────────────

type StepState = 'done' | 'active' | 'pending' | 'failed';

function Step({ state, title, detail }: { state: StepState; title: string; detail?: ReactNode }) {
  return (
    <li className="flex gap-3" data-state={state}>
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
          state === 'done' && 'border-success bg-success-soft text-success',
          state === 'active' && 'border-primary bg-primary-soft text-primary',
          state === 'failed' && 'border-danger bg-danger-soft text-danger',
          state === 'pending' && 'border-border text-muted',
        )}
        aria-hidden
      >
        {state === 'done' ? (
          <Check className="h-4 w-4" />
        ) : state === 'active' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : state === 'failed' ? (
          <XCircle className="h-4 w-4" />
        ) : null}
      </span>
      <div className="min-w-0 pt-0.5 text-sm">
        <p className={cn('font-medium', state === 'pending' && 'text-muted')}>
          {title}
          <span className="sr-only">
            {state === 'done'
              ? ' (hecho)'
              : state === 'active'
                ? ' (en marcha)'
                : state === 'failed'
                  ? ' (no se pudo)'
                  : ' (pendiente)'}
          </span>
        </p>
        {detail && <div className="mt-0.5 break-words text-xs text-muted">{detail}</div>}
      </div>
    </li>
  );
}

function ReferenceScreen({ referenceId, options }: { referenceId: string; options: ReelLikeOptions }) {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const navigate = useNavigate();
  const paths = reelLikePaths(org.id, brand.id);
  const reference = useReelReference(brand.id, referenceId);
  const study = useStudyReference(brand.id);
  const discard = useDiscardReference(brand.id);
  const [aiError, setAiError] = useState<unknown>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const started = useRef<string | null>(null);
  const canEdit = can('edit');
  const row = reference.data ?? null;
  const { mutateAsync: studyReference, isPending: studying } = study;
  const refetch = reference.refetch;

  const runAi = useMemo(
    () => async (id: string) => {
      setAiError(null);
      try {
        await studyReference(id);
      } catch (error) {
        // Puede haber terminado en el servidor aunque la respuesta no llegara: manda lo guardado.
        const fresh = await refetch();
        if (fresh.data?.status !== 'ready') setAiError(error);
      }
    },
    [studyReference, refetch],
  );

  // En cuanto el vídeo está medido, la parte de IA empieza sola (una vez): el coste ya se enseñó antes.
  const status = row?.status;
  const working = isWorking(row);
  useEffect(() => {
    if (!canEdit || status !== 'measured' || working || studying || started.current === referenceId) return;
    started.current = referenceId;
    void runAi(referenceId);
  }, [canEdit, status, working, studying, referenceId, runAi]);

  if (reference.isPending) return <Skeleton className="h-64 w-full" />;
  if (reference.isError) return <ErrorState error={reference.error} onRetry={() => void reference.refetch()} />;
  if (!row) {
    return (
      <div className="space-y-4">
        <Notice tone="warning">Este análisis ya no existe (se descartó o caducó).</Notice>
        <Link to={paths.start} className="text-sm font-medium text-primary hover:underline">
          Estudiar otro vídeo
        </Link>
      </div>
    );
  }

  const result = row.status === 'ready' ? parseReelLikeResult(row.result) : null;
  const closed = row.status === 'failed' || row.status === 'expired';
  const measured = row.status === 'measured' || row.status === 'ready';
  const writing = row.status === 'measured' && (studying || working);
  const shotCount = (row.measurement as { shots?: unknown[] } | null)?.shots?.length;

  async function doDiscard() {
    try {
      await discard.mutateAsync(row!.id);
      toast.success('Análisis descartado.');
      navigate(paths.start);
    } catch (error) {
      toast.error(translateError(error));
    }
  }

  return (
    <div className="space-y-6">
      {!result && (
        <Card>
          <CardBody className="space-y-4">
            <ol className="space-y-3" data-testid="reel-like-steps" aria-live="polite">
              <Step
                state="done"
                title={row.source_kind === 'link' ? 'Enlace recibido' : 'Vídeo recibido'}
                detail={sourceLabel(row)}
              />
              <Step
                state={measured ? 'done' : closed ? 'failed' : 'active'}
                title="Medir los cortes, los planos y el ritmo"
                detail={
                  measured
                    ? `Sin IA. ${shotCount === 1 ? '1 plano' : `${shotCount ?? '…'} planos`} encontrados.`
                    : closed
                      ? undefined
                      : row.source_kind === 'link'
                        ? 'Sin IA. Primero intentamos descargar el vídeo; suele tardar menos de un minuto.'
                        : 'Sin IA. Suele tardar menos de un minuto.'
                }
              />
              <Step
                state={result ? 'done' : aiError ? 'failed' : writing ? 'active' : 'pending'}
                title="Mirar los planos y escribir tu versión"
                detail={
                  writing
                    ? 'Con IA. Puede tardar un par de minutos; no cierres la página.'
                    : 'Con IA: es el único paso que gasta cupo.'
                }
              />
              <Step state="pending" title="Plantilla, guion, borrador y textos" />
            </ol>

            {closed && (
              <div className="space-y-3" data-testid="reel-like-failed">
                <div role="alert" className="rounded-lg bg-danger-soft px-3.5 py-3 text-sm text-danger">
                  {row.error ?? 'No se ha podido estudiar el vídeo.'}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={paths.start}
                    className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg"
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    {row.source_kind === 'link' ? 'Subir el archivo' : 'Probar con otro vídeo'}
                  </Link>
                </div>
              </div>
            )}
            {aiError !== null && (
              <AiErrorNotice error={aiError} onRetry={canEdit ? () => void runAi(row.id) : undefined} />
            )}
            {row.status === 'measured' && !writing && aiError === null && !canEdit && (
              <Notice>El vídeo ya está medido. Quien edita la marca puede terminar el análisis.</Notice>
            )}
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(true)} data-testid="reel-like-discard">
                <Trash2 className="h-4 w-4" aria-hidden />
                {row.status === 'analyzing' ? 'Cancelar y descartar' : 'Descartar este análisis'}
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {result && (
        <ResultView
          row={row}
          result={result}
          options={options}
          onDiscard={canEdit ? () => setConfirmDiscard(true) : undefined}
        />
      )}

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar el análisis"
        description="Se borra el análisis y, si lo guardaste, el vídeo de referencia. Las plantillas y los reels que ya hiciste con él no cambian."
        confirmLabel="Descartar"
        destructive
        loading={discard.isPending}
        onConfirm={() => void doDiscard()}
      />
    </div>
  );
}

// ───────────────────────────── 3. Resultado ─────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  if (!text) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => toast.success('Copiado.'))
          .catch(() => toast.error('No se ha podido copiar.'));
      }}
      aria-label={label}
    >
      <Copy className="h-4 w-4" aria-hidden />
      Copiar
    </Button>
  );
}

/** Los planos a escala: cuánto ocupa cada uno del reel. */
function ShotBar({ template }: { template: ReelStructure }) {
  return (
    <div
      className="flex h-9 w-full overflow-hidden rounded-lg border border-border"
      aria-hidden
      data-testid="reel-like-shot-bar"
    >
      {template.shots.map((shot, index) => (
        <div
          key={shot.id}
          style={{ flexGrow: shot.seconds, flexBasis: 0 }}
          className={cn(
            'flex min-w-0 items-center justify-center text-[11px] font-medium',
            index % 2 === 0 ? 'bg-primary-soft text-primary' : 'bg-subtle text-fg',
            index > 0 &&
              (shot.transition.type === 'fade' ? 'border-l-2 border-dashed border-primary' : 'border-l border-border'),
          )}
        >
          <span className="truncate px-0.5">{index + 1}</span>
        </div>
      ))}
    </div>
  );
}

function ResultView({
  row,
  result,
  options,
  onDiscard,
}: {
  row: ReelReferenceRow;
  result: ReelLikeResult;
  options: ReelLikeOptions;
  onDiscard?: () => void;
}) {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { create } = useContentMutations(org.id, brand.id);
  // La pieza que ya se hizo con este análisis, si sigue viva (no archivada): se puede volver a ella.
  const previous = useLinkedPiece(brand.id, row.content_id);
  const saveTemplate = useSaveReferenceTemplate(brand.id);
  const draft = useReelLikeDraft(brand.id, row.id);
  const [opening, setOpening] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState(result.template.name.slice(0, TEMPLATE_NAME_MAX));
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const canEdit = can('edit');
  const { template, script, texts } = result;
  const values = new Map(texts.onScreen.map((entry) => [entry.text, entry.value]));
  const matches = new Map((draft.draft?.matches ?? []).map((match) => [match.shot, match]));
  const paths = contentPaths(org.id, brand.id);

  /**
   * Crea SIEMPRE una pieza nueva con el borrador del análisis (antes abría la que ya estaba
   * apuntada, aunque estuviera archivada). El nombre, el escrito en «Nuevo reel» o el del guion.
   */
  async function openEditor() {
    setOpening(true);
    try {
      const title = (params.get(NAME_PARAM)?.trim() || script.title || 'Reel nuevo').slice(0, 200);
      const item = await create.mutateAsync({ title, network: 'instagram', format: 'reel' });
      await linkReferenceContent(row.id, item.id).catch(() => undefined);
      navigate(`${paths.item(item.id)}?referencia=${row.id}`);
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setOpening(false);
    }
  }

  async function saveAsTemplate() {
    try {
      const saved = await saveTemplate.mutateAsync({
        name: templateName,
        result,
        origin: { kind: row.source_kind, host: row.source_host },
      });
      setSavedAs(saved.name);
      setTemplateOpen(false);
      toast.success('Plantilla guardada.');
    } catch (error) {
      toast.error(translateError(error));
    }
  }

  async function viewSource() {
    if (!row.source_path) return;
    const signed = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(row.source_path, 600);
    if (signed.error || !signed.data?.signedUrl) toast.error('No se ha podido abrir el vídeo de referencia.');
    else window.open(signed.data.signedUrl, '_blank', 'noopener');
  }

  return (
    <div className="space-y-6" data-testid="reel-like-result">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold">{script.title}</h2>
              {script.idea && <p className="mt-1 break-words text-sm text-muted">{script.idea}</p>}
            </div>
            {canEdit && (
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <Button
                  onClick={() => void openEditor()}
                  loading={opening}
                  className="flex-1 sm:flex-none"
                  data-testid="reel-like-open-editor"
                >
                  <Clapperboard className="h-4 w-4" aria-hidden />
                  {row.content_id ? 'Hacer otro reel con esto' : 'Abrir en el editor'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setTemplateOpen(true)}
                  className="flex-1 sm:flex-none"
                  data-testid="reel-like-save-template"
                >
                  <Save className="h-4 w-4" aria-hidden />
                  Guardar como plantilla
                </Button>
              </div>
            )}
          </div>
          {previous && (
            <p className="text-sm" data-testid="reel-like-previous">
              Ya hiciste un reel con este análisis:{' '}
              <Link to={paths.item(previous.id)} className="font-medium text-primary underline">
                {previous.title}
              </Link>
              .
            </p>
          )}
          {savedAs && (
            <p className="text-sm text-success" role="status" data-testid="reel-like-template-saved">
              Guardada como «{savedAs}» en las plantillas de reel de la marca: la tienes en «Empieza con una plantilla»
              al crear un reel con el editor.
            </p>
          )}
          <p className="text-xs text-muted" data-testid="reel-like-cost-real">
            Ha costado {formatMicros(Number(row.cost_micros) || 0)} de tu cupo de IA
            {options.estimate ? ` (el máximo era ${formatMicros(options.estimate.maxMicros)})` : ''}.{' '}
            {row.keep_source && row.source_path
              ? 'El vídeo de referencia está guardado en privado: no está en tu biblioteca ni se usa en tus piezas.'
              : 'El vídeo de referencia y sus fotogramas ya se han borrado.'}
          </p>
          {row.keep_source && row.source_path && (
            <Button variant="ghost" size="sm" onClick={() => void viewSource()}>
              <Film className="h-4 w-4" aria-hidden />
              Ver el vídeo de referencia
            </Button>
          )}
          {result.notes.length > 0 && (
            <Notice>
              <ul className="list-disc space-y-1 pl-4">
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Notice>
          )}
        </CardBody>
      </Card>

      {/* 1 · Plantilla */}
      <Card>
        <CardHeader title="1 · Plantilla del reel" description="La estructura, para repetirla cuando quieras." />
        <CardBody className="space-y-4" data-testid="reel-like-template">
          <div>
            <p className="break-words font-medium">{template.name}</p>
            {template.summary && <p className="mt-1 break-words text-sm text-muted">{template.summary}</p>}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="neutral">{template.shots.length === 1 ? '1 plano' : `${template.shots.length} planos`}</Badge>
            <Badge tone="neutral">{seconds(template.totalSeconds)}</Badge>
            <Badge tone="neutral">Ritmo {PACE_LABEL[template.pace].toLowerCase()}</Badge>
            <Badge tone="neutral">{AUDIO_KIND_LABEL[template.audio.kind]}</Badge>
            {template.audio.bpm !== undefined && (
              <Badge tone="neutral">{Math.round(template.audio.bpm)} pulsaciones/min</Badge>
            )}
            {template.audio.bpm !== undefined && template.audio.cutsOnBeat !== undefined && (
              <Badge tone="neutral">{Math.round(template.audio.cutsOnBeat * 100)} % de cortes al compás</Badge>
            )}
          </div>
          <ShotBar template={template} />
          <ol className="divide-y divide-border text-sm">
            {template.shots.map((shot, index) => (
              <li key={shot.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2">
                <span className="font-medium">Plano {index + 1}</span>
                <span>{SHOT_KIND_LABEL[shot.kind]}</span>
                <span className="text-muted">
                  · {seconds(shot.seconds)} · {shot.media === 'foto' ? 'foto' : 'vídeo'}
                  {index > 0 &&
                    ` · entra ${shot.transition.type === 'fade' ? `con transición suave (${seconds(shot.transition.seconds)})` : 'por corte'}`}
                </span>
                {shot.description && <span className="w-full break-words text-xs text-muted">{shot.description}</span>}
              </li>
            ))}
          </ol>
          {template.texts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Textos en pantalla</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {template.texts.map((text) => (
                  <li key={text.id} className="break-words">
                    <span className="font-medium">{TEXT_ROLE_LABEL[text.role]}</span>{' '}
                    <span className="text-muted">
                      · {POSITION_LABEL[text.position]} · letra {SIZE_LABEL[text.size]} · del segundo{' '}
                      {seconds(text.start)} al {seconds(text.end)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="break-words text-sm">
            <span className="font-semibold">Portada:</span> el segundo {seconds(template.cover.at)}
            {template.cover.note ? `. ${template.cover.note}` : ''}
          </p>
        </CardBody>
      </Card>

      {/* 2 · Guion */}
      <Card>
        <CardHeader title="2 · Guion y lista de planos" description="Qué grabar y en qué orden." />
        <CardBody>
          <ol className="space-y-3" data-testid="reel-like-script">
            {script.shots.map((entry, index) => {
              const shot = template.shots[index]!;
              return (
                <li key={entry.shot} className="text-sm">
                  <p className="font-medium">
                    {index + 1}. <span className="break-words">{entry.what}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {SHOT_KIND_LABEL[shot.kind]} · {seconds(shot.seconds)} · {shot.media === 'foto' ? 'foto' : 'vídeo'}
                  </p>
                  {entry.tip && <p className="mt-0.5 break-words text-xs">Consejo: {entry.tip}</p>}
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>

      {/* 3 · Borrador */}
      <Card>
        <CardHeader
          title="3 · Borrador con tu biblioteca"
          description="Las fotos y los clips de la marca que encajan con cada plano (por tipo, etiquetas y carpeta)."
        />
        <CardBody className="space-y-3" data-testid="reel-like-draft">
          {draft.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : !draft.draft ? (
            <Notice tone="warning">No se ha podido preparar el borrador.</Notice>
          ) : (
            <>
              <p className="text-sm" data-testid="reel-like-draft-summary">
                {draft.draft.filled} de {draft.draft.filled + draft.draft.gaps} planos con material de tu biblioteca
                {draft.draft.gaps > 0
                  ? `; ${draft.draft.gaps === 1 ? 'falta 1 por grabar' : `faltan ${draft.draft.gaps} por grabar`}.`
                  : '.'}
              </p>
              <ol className="space-y-2 text-sm">
                {draft.draft.project.guide?.shots.map((shot, index) => {
                  const match = matches.get(shot.id);
                  return (
                    <li
                      key={shot.id}
                      className={cn(
                        'rounded-lg border p-2.5',
                        match?.asset ? 'border-border' : 'border-dashed border-warning bg-warning-soft/40',
                      )}
                      data-testid={`reel-like-draft-shot-${shot.id}`}
                    >
                      <span className="font-medium">Plano {index + 1}: </span>
                      {match?.asset ? (
                        <>
                          <span className="break-all">{match.asset.file_name}</span>
                          <span className="block text-xs text-muted">Encaja por {match.reasons.join(', ')}.</span>
                        </>
                      ) : (
                        <span className="break-words">Falta grabar: {shot.label}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
              {draft.draft.notes.map((note) => (
                <p key={note} className="text-xs text-muted">
                  {note}
                </p>
              ))}
              <p className="text-xs text-muted">
                En el editor puedes cambiar cualquier plano, rellenar los huecos cuando grabes y ajustar los textos.
              </p>
            </>
          )}
        </CardBody>
      </Card>

      {/* 4 · Textos */}
      <Card>
        <CardHeader title="4 · Textos" description={`Con el tono de ${brand.name}.`} />
        <CardBody className="space-y-4 text-sm" data-testid="reel-like-texts">
          {texts.hook && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Gancho</h3>
                <CopyButton text={texts.hook} label="Copiar el gancho" />
              </div>
              <p className="break-words">{texts.hook}</p>
            </div>
          )}
          {texts.onScreen.length > 0 && (
            <div>
              <h3 className="font-semibold">Textos en pantalla</h3>
              <ul className="mt-1 space-y-1.5">
                {template.texts.map((text) =>
                  values.get(text.id) ? (
                    <li key={text.id} className="break-words">
                      «{values.get(text.id)}»{' '}
                      <span className="text-xs text-muted">
                        ({TEXT_ROLE_LABEL[text.role].toLowerCase()}, {POSITION_LABEL[text.position]}, del{' '}
                        {seconds(text.start)} al {seconds(text.end)})
                      </span>
                    </li>
                  ) : null,
                )}
              </ul>
            </div>
          )}
          {texts.caption && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Pie de foto</h3>
                <CopyButton
                  text={[texts.caption, texts.hashtags.join(' ')].filter(Boolean).join('\n\n')}
                  label="Copiar el pie de foto"
                />
              </div>
              <p className="whitespace-pre-line break-words">{texts.caption}</p>
              {texts.hashtags.length > 0 && <p className="mt-1 break-words text-primary">{texts.hashtags.join(' ')}</p>}
            </div>
          )}
        </CardBody>
      </Card>

      {onDiscard && (
        <Button variant="ghost" size="sm" onClick={onDiscard} data-testid="reel-like-discard">
          <Trash2 className="h-4 w-4" aria-hidden />
          Descartar este análisis
        </Button>
      )}

      <Dialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        title="Guardar como plantilla"
        description="Se guarda la estructura (planos, duraciones, textos de muestra y ritmo) para montar otro reel igual desde «Empieza tu reel». No guarda nada del vídeo de referencia."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTemplateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void saveAsTemplate()}
              loading={saveTemplate.isPending}
              disabled={!templateName.trim()}
              data-testid="reel-like-template-confirm"
            >
              Guardar
            </Button>
          </>
        }
      >
        <Field label="Nombre de la plantilla">
          {(props) => (
            <Input
              {...props}
              value={templateName}
              maxLength={TEMPLATE_NAME_MAX}
              onChange={(event) => setTemplateName(event.target.value)}
              data-testid="reel-like-template-name"
            />
          )}
        </Field>
      </Dialog>
    </div>
  );
}
