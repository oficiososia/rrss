// Editor de reels: una pieza de formato reel cuyas versiones son montajes
// (proyecto con el plan v2). Pantalla como la de CapCut (docs/editor-reels.md
// §10 y §11): vista previa grande arriba, línea de tiempo debajo con el
// cabezal fijo y una sola barra de herramientas que cambia con lo elegido;
// cada herramienta abre solo su ajuste (panel estrecho al lado en escritorio,
// hoja en móvil). Arriba, lo mínimo: volver, nombre, guardado (automático),
// deshacer y un único «Exportar», que monta el vídeo si hace falta y reúne
// descargar, biblioteca y publicar o programar. En móvil ocupa la pantalla
// entera, sin la cabecera ni la barra de la aplicación.
//
// Aprobación: en autogestión (`organizations.work_mode = 'self'`) no se ve;
// «Publicar o programar» aprueba por debajo con los pasos que exige la base
// de datos. En modo agencia se conserva el flujo de siempre (enviar a
// revisión, aprobar), en «⋯» y en la hoja «Exportar».
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronLeft,
  CloudOff,
  History,
  Loader2,
  Maximize2,
  PencilLine,
  Redo2,
  Save,
  ScanLine,
  SendHorizontal,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { notify } from './notify';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Field,
  Input,
  MoreMenu,
  Notice,
  Select,
  Skeleton,
  type MoreMenuItem,
} from '@/components/ui';
import { mediaWorkerEnabled } from '@/config/app';
import { useActiveProfile } from '@/features/brand/api';
import { useBrandFontFaces, useReelFont } from '@/features/brand/fontsApi';
import { parseProfile } from '@/features/brand/profile';
import {
  fetchContentVersion,
  isVersionConflict,
  useContentMutations,
  useContentVersions,
} from '@/features/content/api';
import { SaveVersionDialog } from '@/features/content/editor/SaveVersionDialog';
import { contentPaths } from '@/features/content/labels';
import {
  editorPrimaryAction,
  STATUS_LABEL,
  STATUS_TONE,
  statusActions,
  statusChangedMessage,
  type StatusAction,
} from '@/features/content/status';
import { assetKeys, uploadAsset, useSignedUrls } from '@/features/library/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useWorkMode } from '@/features/orgs/workMode';
import { useFeature } from '@/features/platform/integrations/useFeature';
import {
  socialKeys,
  useContentPublication,
  useSavePublication,
  useSocialAccounts,
} from '@/features/social/api';
import { PublishNowDialog } from '@/features/social/PublishNowDialog';
import { useTextTask } from '@/features/platform/integrations/useFeature';
import { useWorkspaceMode } from '@/layout/workspace';
import type { ContentItemRow, ContentStatus, ContentVersionRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { cn, formatDateTime } from '@/lib/utils';
import { reelKeys, useRequestReel, useReelSources, type ReelSourceAsset } from '../api';
import { describeJob, isActive } from '../plan';
import { REEL_TEMPLATES, type ReelTemplateSummary } from '../templates';
import { buildReelFromTemplate, describeNeeds, reelTemplateNeeds } from '../reelTemplate';
import {
  jobContentVersion,
  pieceJobKeys,
  renderOfVersion,
  useBrandReelTemplates,
  usePieceJobs,
  useReelDraft,
  useSaveReelVersion,
  type BrandReelTemplate,
  type ReelDraft,
} from './api';
import { createClock, useClockValue, type PlayClock } from './clock';
import {
  fileNameOf,
  missingItems,
  missingSummary,
  planPaths,
  replaceClipAndCover,
  useMissingPaths,
  type MissingItem,
} from './missing';
import { MissingNotice, MissingOverlay } from './MissingMedia';
import { previewWarnings } from './compose';
import { barKind, ContextBar, contextActions, panelTitle, type BarAction } from './ContextBar';
import { ExportSheet, type PreviousRender } from './ExportSheet';
import { exportState, renderOfPlan, selfApprovalSteps, shouldRenderOnExport } from './exportFlow';
import { EMPTY_COPY, parseHashtags, PublishedLine, PublishPanel, type PublishInput } from './PublishPanel';
import { editorReducer, initEditor, type Selection } from './history';
import { Inspector, type Apply, type BrandFontOption } from './Inspector';
import {
  addClip,
  addText,
  brandTextStyle,
  canSplitAt,
  clipIndexAt,
  duplicateClip,
  duplicateText,
  moveClip,
  moveText,
  newId,
  removeClip,
  removeMusic,
  removeText,
  setCover,
  setMusic,
  setTextOffset,
  setTextSize,
  splitClip,
  startReel,
  toggleClipMute,
  trimClip,
  trimText,
  updateText,
} from './ops';
import {
  applyTemplate,
  buildRenderRequest,
  emptyProject,
  isReelProject,
  parseProject,
  planTimeline,
  projectProblems,
  ProjectError,
  REEL_CAPTION_MAX,
  REEL_MAX_CLIPS,
  REEL_MAX_SECONDS,
  type ReelProject,
} from './project';
import { MediaPicker } from './MediaPicker';
import { ReelPlayer } from './ReelPlayer';
import { Starter } from './Starter';
import { TemplateCards } from './TemplateCards';
import { CoverPicker } from './CoverPicker';
import { reelBeats } from './rhythm';
import { clampZoom, Timeline, ZOOM, ZOOM_STEP } from './Timeline';
import { AUTOSAVE_LABEL, useAutosave } from './useAutosave';
import { useBeats } from './useBeats';
import { useQueryClient } from '@tanstack/react-query';
import { fillGuideShot } from '../like/draft';
import { GuidePanel } from '../like/GuidePanel';
import { useReelLikeDraft } from '../like/useDraft';
import { useReelReference } from '../like/api';
import { parseReelLikeResult } from '../../../../supabase/functions/_shared/reels/like';

const DEFAULT_TEMPLATE_ID = 'fundido-suave';
const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);
const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
/** Un control que ya usa Espacio para activarse (fuera de la línea de tiempo y de la vista previa, donde Espacio reproduce). */
const usesSpace = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest('button, a, summary, [role="radio"], [role="slider"], [role="menuitem"], [role="tab"]')) &&
  !target.closest('[data-reel-keys]');

const defaultTemplate = (): ReelTemplateSummary =>
  REEL_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) ?? REEL_TEMPLATES[0]!;

type Start =
  | { kind: 'project'; project: ReelProject }
  | { kind: 'empty'; previous: 'none' | 'design' }
  | { kind: 'unreadable'; message: string };

/** Con qué se abre el editor: el montaje de la versión vigente, uno vacío o el aviso de que no se puede leer. */
export function startOf(version: ContentVersionRow | null): Start {
  if (!version) return { kind: 'empty', previous: 'none' };
  if (!isReelProject(version.data)) return { kind: 'empty', previous: 'design' };
  try {
    return { kind: 'project', project: parseProject(version.data) };
  } catch (error) {
    return { kind: 'unreadable', message: error instanceof ProjectError ? error.message : 'El montaje no es válido.' };
  }
}

export interface ReelEditorProps {
  item: ContentItemRow;
  version: ContentVersionRow | null;
  /** Vuelve a cargar la pieza desde cero (tras restaurar una versión). */
  onReopen: () => void;
}

/** Con qué arranca la pantalla, decidido una vez al abrirla. */
interface Boot {
  /** El montaje que se ve al abrir. */
  initial: ReelProject;
  /** El de la versión guardada (o vacío): con lo que se compara para saber si hay cambios. */
  saved: ReelProject;
  /** Se ha abierto con el borrador automático: cuándo se guardó. */
  recoveredAt: string | null;
  /** El borrador con el que se abre ya está en el servidor (si salió de la copia de este navegador, hay que subirlo). */
  draftOnServer: boolean;
  /** Hay un borrador, pero de una versión anterior a la vigente: se ofrece recuperarlo. */
  staleDraft: ReelDraft | null;
  /** ¿Se puede guardar solo? (no, si la tabla de borradores no responde: se edita como antes). */
  autosave: boolean;
}

export function ReelEditor({ item, version, onReopen }: ReelEditorProps) {
  // Pantalla de trabajo: la página mide justo la ventana y solo se desplazan la línea de tiempo y los paneles.
  useWorkspaceMode();
  const [start] = useState(() => startOf(version));
  const [forceNew, setForceNew] = useState(false);
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const paths = contentPaths(org.id, brand.id);
  const editable = can('edit') && !item.archived_at;
  // «Hacer un reel como este»: una pieza todavía sin versiones puede abrirse con el borrador
  // de un análisis (`?referencia=<id>`).
  const [params] = useSearchParams();
  const referenceId = params.get('referencia');
  const fresh = start.kind === 'empty' && start.previous === 'none';
  const like = useReelLikeDraft(brand.id, fresh && referenceId ? referenceId : null);
  // El borrador automático de la pieza: lo que se dejó a medias la última vez.
  const draft = useReelDraft(brand.id, item.id, editable);
  const [openedAt] = useState(item.current_version);

  if (start.kind === 'unreadable' && !forceNew) {
    return (
      <div className="space-y-4">
        <Link to={paths.list} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Contenidos
        </Link>
        <Card>
          <CardBody className="space-y-3">
            <ErrorState error={new Error(start.message)} />
            <Button onClick={() => setForceNew(true)}>Empezar un montaje nuevo</Button>
          </CardBody>
        </Card>
      </div>
    );
  }
  if (like.loading || (editable && draft.isPending)) {
    return (
      <div className="space-y-4" data-testid="reel-like-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const saved = start.kind === 'project' ? start.project : emptyProject(defaultTemplate());
  const stored = draft.data ?? null;
  const usable = stored && stored.baseVersion === openedAt ? stored : null;
  const boot: Boot = {
    initial: usable?.project ?? (start.kind === 'project' ? start.project : (like.draft?.project ?? saved)),
    saved,
    recoveredAt: usable?.updatedAt ?? null,
    draftOnServer: usable?.source === 'server',
    staleDraft: stored && !usable ? stored : null,
    autosave: editable && !draft.isError,
  };
  return (
    <Editor
      item={item}
      boot={boot}
      previousDesign={start.kind === 'empty' && start.previous === 'design'}
      onReopen={onReopen}
      likeDraft={
        usable
          ? undefined
          : like.draft
            ? { notes: like.draft.notes, filled: like.draft.filled, gaps: like.draft.gaps }
            : like.missing
              ? 'missing'
              : undefined
      }
    />
  );
}

function Editor({
  item,
  boot: bootProp,
  previousDesign,
  onReopen,
  likeDraft,
}: {
  item: ContentItemRow;
  boot: Boot;
  previousDesign: boolean;
  onReopen: () => void;
  /** El proyecto de partida es un borrador de «Hacer un reel como este» (aún sin guardar), o no se pudo leer. */
  likeDraft?: { notes: string[]; filled: number; gaps: number } | 'missing';
}) {
  // Lo que se decidió al abrir no cambia aunque la pieza se refresque por debajo.
  const [boot] = useState(bootProp);
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const queryClient = useQueryClient();
  const paths = contentPaths(org.id, brand.id);
  const canEdit = can('edit');
  const canApprove = can('approve');
  // Autogestión: sin paso de aprobación a la vista ni textos de cupo.
  const { selfManaged } = useWorkMode();
  const readOnly = !canEdit || Boolean(item.archived_at);
  const [state, dispatch] = useReducer(editorReducer, boot.initial, initEditor);
  const { project, selection } = state;
  const snapshot = useMemo(() => JSON.stringify(project), [project]);
  const [baseline, setBaseline] = useState(() => ({ project: boot.saved, snapshot: JSON.stringify(boot.saved) }));
  const [expectedVersion, setExpectedVersion] = useState(item.current_version);
  const dirty = snapshot !== baseline.snapshot;
  const [clock] = useState<PlayClock>(() => createClock(0));
  const [playing, setPlaying] = useState(false);
  const [stopAt, setStopAt] = useState<number | null>(null);
  const [pps, setPps] = useState<number>(ZOOM.initial);
  /** Ajuste abierto desde la barra (panel estrecho al lado en escritorio; hoja en móvil). Null = ninguno. */
  const [panel, setPanel] = useState<string | null>(() => (boot.initial.guide ? 'guide' : null));
  const [saveOpen, setSaveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Selector de fotos y clips: para añadir o para sustituir un elemento. */
  const [media, setMedia] = useState<{ mode: 'add' } | { mode: 'replace'; id: string } | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  /** Hoja «Exportar»: abierta, con la portada desplegada (para arreglarla) o en «Publicar o programar». */
  const [exportOpen, setExportOpen] = useState<false | 'open' | 'cover' | 'publish'>(false);
  /** «Publicar ahora» con la cuenta elegida en la hoja (el diálogo que publica y enseña cómo va). */
  const [publishNow, setPublishNow] = useState<{ accountId: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmRepublish, setConfirmRepublish] = useState(false);
  /** Versión cuyo montaje se acaba de encargar (hasta que el trabajo aparece en la lista). */
  const [requestedVersion, setRequestedVersion] = useState<number | null>(null);
  /** Se ha pulsado «Exportar»: se monta en cuanto se sepa si hace falta (al llegar la lista de montajes). */
  const exportWanted = useRef(false);
  const [safeZones, setSafeZones] = useState(false);
  const narrow = useNarrow();
  const [busyStatus, setBusyStatus] = useState<ContentStatus | null>(null);
  /** «Estilo»: los estilos de la aplicación o las plantillas de reel de la marca. */
  const [styleOpen, setStyleOpen] = useState<false | 'styles' | 'templates'>(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [staleDraft, setStaleDraft] = useState(boot.staleDraft);
  const [recoveredAt, setRecoveredAt] = useState(boot.recoveredAt);
  /** Texto de apertura escrito en la pantalla de salida, para ponerlo al elegir las fotos. */
  const [openingText, setOpeningText] = useState('');
  /** Plantilla de reel elegida en la pantalla de salida: el selector pide el material de sus planos. */
  const [startTemplate, setStartTemplate] = useState<BrandReelTemplate | null>(null);
  /** «Nueva idea → Reel» puede traer ya la plantilla elegida (`?plantilla=<clave>`): se atiende una vez. */
  const [params] = useSearchParams();
  const askedTemplate = params.get('plantilla');
  const [templateAsked, setTemplateAsked] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const timelineBoxRef = useRef<HTMLDivElement>(null);

  const template = REEL_TEMPLATES.find((t) => t.id === project.template.id) ?? defaultTemplate();
  const sources = useReelSources(brand.id);
  const byPath = useMemo(() => new Map((sources.data ?? []).map((a) => [a.storage_path, a])), [sources.data]);
  // Sin recurso (borrado, o fuera de los 300 más recientes): el nombre del archivo, sin el identificador delante.
  const labelOf = useCallback((path: string) => byPath.get(path)?.file_name ?? fileNameOf(path), [byPath]);
  const fileSecondsOf = useCallback(
    (path: string) => {
      const ms = byPath.get(path)?.duration_ms;
      return typeof ms === 'number' && ms > 0 ? ms / 1000 : null;
    },
    [byPath],
  );
  const timeline = useMemo(
    () => planTimeline(project.plan.clips, template, (c) => fileSecondsOf(c.path)),
    [project.plan.clips, template, fileSecondsOf],
  );

  // Direcciones firmadas de todo lo que suena o se ve en el reel.
  const usedPaths = useMemo(() => planPaths(project.plan), [project.plan]);
  // Lo que se borró de la biblioteca después de ponerlo en el reel (sin saberlo todavía, nada).
  const missingPaths = useMissingPaths(brand.id, usedPaths);
  const isMissing = useCallback((path: string) => missingPaths?.has(path) ?? false, [missingPaths]);
  const missing = useMemo(() => missingItems(project.plan, isMissing), [project.plan, isMissing]);
  const missingText = missingSummary(missing);
  const signed = useSignedUrls(usedPaths);
  const urls = useMemo(() => signed.data ?? new Map<string, string>(), [signed.data]);
  const urlOf = useCallback((path: string) => urls.get(path), [urls]);
  // Miniaturas (las de la biblioteca) para las tiras de la línea de tiempo.
  const thumbPaths = useMemo(
    () =>
      [
        ...new Set(
          project.plan.clips.map((c) => byPath.get(c.path)?.thumb_path).filter((p): p is string => Boolean(p)),
        ),
      ].sort(),
    [project.plan.clips, byPath],
  );
  const signedThumbs = useSignedUrls(thumbPaths);
  const thumbOf = useCallback(
    (path: string) => {
      const thumb = byPath.get(path)?.thumb_path;
      return thumb ? signedThumbs.data?.get(thumb) : undefined;
    },
    [byPath, signedThumbs.data],
  );
  // Ritmo de la música: se analiza solo al pedir «Ajustar los cortes a la música».
  const beats = useBeats(project.plan.music?.path, project.plan.music ? urls.get(project.plan.music.path) : undefined);
  const beatTimes = useMemo(
    () =>
      beats.analysis && project.plan.music ? reelBeats(beats.analysis.beats, project.plan.music.startAt) : [],
    [beats.analysis, project.plan.music],
  );

  // Marca: paleta del perfil y tipografías .ttf/.otf (las que puede usar el trabajador).
  const profileRow = useActiveProfile(brand.id);
  const profile = useMemo(() => (profileRow.data ? parseProfile(profileRow.data.data) : null), [profileRow.data]);
  const palette = useMemo(
    () => (profile?.visual.colors ?? []).map((c) => ({ hex: c.hex.toUpperCase(), name: c.name })),
    [profile],
  );
  const fontFaces = useBrandFontFaces(brand.id);
  const reelFont = useReelFont(brand.id);
  const fonts: BrandFontOption[] = useMemo(
    () =>
      fontFaces.fonts
        .filter((f) => f.format === 'ttf' || f.format === 'otf')
        .map((f) => ({
          path: f.storage_path,
          family: f.family,
          label: `${f.family} ${f.weight}${f.style === 'italic' ? ' cursiva' : ''}`,
        })),
    [fontFaces.fonts],
  );

  const autoSubtitles = useFeature('reelSubtitles');
  const publishingOn = useFeature('publishing');
  const worker = mediaWorkerEnabled();
  const jobs = usePieceJobs(brand.id, item.id);
  const brandTemplates = useBrandReelTemplates(brand.id);
  if (askedTemplate && !templateAsked && brandTemplates.data) {
    setTemplateAsked(true);
    const chosen = brandTemplates.data.find((t) => t.key === askedTemplate);
    // Solo en un reel todavía vacío y editable: se abre el selector pidiendo el material de sus planos.
    if (chosen && !readOnly && project.plan.clips.length === 0 && !project.guide) {
      setStartTemplate(chosen);
      setMedia({ mode: 'add' });
    }
  }
  // ¿Se está esperando a la plantilla pedida en la dirección (`?plantilla=`) para pedir sus fotos?
  const awaitingTemplate =
    Boolean(askedTemplate) &&
    !templateAsked &&
    brandTemplates.isPending &&
    !readOnly &&
    project.plan.clips.length === 0 &&
    !project.guide;
  const request = useRequestReel(brand.id);
  const navigate = useNavigate();
  const accounts = useSocialAccounts(brand.id, exportOpen !== false);
  const publication = useContentPublication(brand.id, item.id);
  const savePublication = useSavePublication(brand.id);
  const captionTask = useTextTask('post.caption');
  // El pie que propuso «Hacer un reel como este» (si el reel sale de un análisis y todavía no tiene pie).
  const reference = useReelReference(brand.id, project.copy ? undefined : project.guide?.referenceId);
  const suggestedCopy = useMemo(() => {
    const result = parseReelLikeResult(reference.data?.status === 'ready' ? reference.data.result : null);
    if (!result?.texts.caption.trim()) return null;
    return {
      caption: [...result.texts.caption].slice(0, REEL_CAPTION_MAX).join(''),
      hashtags: parseHashtags(result.texts.hashtags.join(' ')),
    };
  }, [reference.data]);
  const saveReel = useSaveReelVersion(brand.id);
  const mutations = useContentMutations(org.id, brand.id);

  const problems = projectProblems(project, template, { fileSeconds: fileSecondsOf });
  // En «Avisos», lo que falta va primero; no desactiva «Montar el vídeo»: al pulsarlo se explica y se va a ello.
  const notices = missingText ? [missingText, ...problems] : problems;
  const warnings = previewWarnings(project.plan, template, {
    loadedFamilies: fontFaces.families,
    brandReelFont: Boolean(reelFont.data),
    mimeOf: (path) => byPath.get(path)?.mime_type ?? null,
  });
  const render = renderOfVersion(jobs.data ?? [], expectedVersion);
  // Montando: hay un trabajo en marcha de la versión vigente, o se acaba de encargar y aún no ha llegado a la lista.
  const versionJob = (jobs.data ?? []).find((j) => jobContentVersion(j) === expectedVersion && expectedVersion > 0);
  const versionView = versionJob ? describeJob(versionJob) : null;
  const rendering =
    (jobs.data ?? []).some((j) => isActive(j) && jobContentVersion(j) === expectedVersion) ||
    (requestedVersion === expectedVersion && !versionJob);

  // Guardado automático: el borrador de la pieza, un momento después de cada cambio.
  const autosaveOn = boot.autosave && !readOnly;
  const [draftSnapshot] = useState(() => (boot.draftOnServer ? JSON.stringify(boot.initial) : null));
  const autosave = useAutosave({
    contentId: item.id,
    project,
    snapshot,
    dirty,
    baseVersion: expectedVersion,
    enabled: autosaveOn,
    initialSnapshot: draftSnapshot,
  });

  const apply: Apply = useCallback((change, merge) => dispatch({ type: 'change', change, merge }), [dispatch]);
  // Elegir algo cambia la barra y cierra el ajuste abierto. Una transición solo tiene un ajuste: se abre ya.
  const select = useCallback((next: Selection) => {
    dispatch({ type: 'select', selection: next });
    setPanel(next?.kind === 'transition' ? 'transition' : null);
  }, [dispatch, setPanel]);
  const commit = useCallback(() => dispatch({ type: 'commit' }), [dispatch]);

  const seek = useCallback(
    (seconds: number) => {
      setPlaying(false);
      setStopAt(null);
      clock.set(Math.max(0, Math.min(seconds, timeline.total)));
    },
    [clock, timeline.total],
  );
  const changePlaying = useCallback((next: boolean) => {
    setPlaying(next);
    if (!next) setStopAt(null);
  }, []);
  /** Reproduce desde un segundo (y, si se da, hasta otro): para ver una animación o una transición. */
  const playFrom = useCallback(
    (from: number, until?: number) => {
      clock.set(Math.max(0, from));
      setStopAt(until ?? null);
      setPlaying(true);
    },
    [clock],
  );

  // ── Lo elegido y lo que se le puede hacer ──
  const selectedClipIndex = selection?.kind === 'clip' ? project.plan.clips.findIndex((c) => c.id === selection.id) : -1;
  const takenIds = () => [...project.plan.clips.map((c) => c.id), ...project.plan.texts.map((t) => t.id)];

  /** Divide en el cabezal: el clip elegido si el cabezal está dentro; si no, el que se ve en ese instante. */
  const split = () => {
    const t = clock.get();
    const index =
      selectedClipIndex >= 0 && canSplitAt(project, timeline, selectedClipIndex, t)
        ? selectedClipIndex
        : clipIndexAt(timeline, t);
    const clip = project.plan.clips[index];
    if (!clip || !canSplitAt(project, timeline, index, t)) {
      notify.info('Para dividir, lleva el cabezal dentro del clip, a más de medio segundo de sus extremos.');
      return;
    }
    const secondId = newId('c', takenIds());
    dispatch({
      type: 'change',
      change: (p) => splitClip(p, clip.id, t - timeline.starts[index]!, fileSecondsOf(clip.path)),
      select: { kind: 'clip', id: secondId },
    });
  };
  const duplicate = () => {
    if (selection?.kind === 'clip') {
      dispatch({
        type: 'change',
        change: (p) => duplicateClip(p, selection.id),
        select: { kind: 'clip', id: newId('c', takenIds()) },
      });
    } else if (selection?.kind === 'text') {
      dispatch({
        type: 'change',
        change: (p) => duplicateText(p, selection.id),
        select: { kind: 'text', id: newId('t', takenIds()) },
      });
    }
  };
  const remove = () => {
    if (selection?.kind === 'clip') apply((p) => removeClip(p, selection.id));
    else if (selection?.kind === 'text') apply((p) => removeText(p, selection.id));
    else if (selection?.kind === 'music') apply((p) => removeMusic(p));
    else return;
    setPanel(null);
  };

  /** Lleva a lo que falta: elige el clip (y pone el cabezal en él), la música o la portada. */
  const goToMissing = (target: MissingItem | undefined = missing[0]) => {
    if (!target) return;
    if (target.kind === 'clip') {
      const index = project.plan.clips.findIndex((c) => c.id === target.id);
      if (index >= 0) seek(timeline.starts[index]! + timeline.transitions[index]!);
      dispatch({ type: 'select', selection: { kind: 'clip', id: target.id } });
      setPanel(null);
    } else if (target.kind === 'music') {
      dispatch({ type: 'select', selection: { kind: 'music' } });
      setPanel(null);
    } else {
      // La portada se elige al exportar.
      dispatch({ type: 'select', selection: null });
      setPanel(null);
      setExportOpen('cover');
    }
  };
  const replaceMissing = (target: MissingItem) => {
    if (target.kind === 'clip') setMedia({ mode: 'replace', id: target.id });
    else if (target.kind === 'music') setMusicOpen(true);
    else goToMissing(target);
  };
  const removeMissing = (target: MissingItem) => {
    if (target.kind === 'clip') apply((p) => removeClip(p, target.id));
    else if (target.kind === 'music') apply((p) => removeMusic(p));
    else apply((p) => setCover(p, undefined));
  };

  // Teclado (fuera de los campos): Espacio reproduce, S divide, Supr borra, flechas mueven un fotograma,
  // Ctrl+Z/Y deshacen y rehacen, Ctrl+D duplica, Esc suelta lo elegido.
  const keys = useRef({ split, duplicate, remove });
  useEffect(() => {
    keys.current = { split, duplicate, remove };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const frame = 1 / template.canvas.fps;
      if (mod && key === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (mod && key === 'd') {
        if (readOnly) return;
        event.preventDefault();
        keys.current.duplicate();
      } else if (mod || event.altKey) {
        return;
      } else if (event.key === ' ') {
        if (usesSpace(event.target)) return;
        event.preventDefault();
        setPlaying((p) => !p);
        setStopAt(null);
      } else if (key === 's') {
        if (readOnly) return;
        event.preventDefault();
        keys.current.split();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (readOnly) return;
        event.preventDefault();
        keys.current.remove();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = (event.shiftKey ? 1 : frame) * (event.key === 'ArrowRight' ? 1 : -1);
        seek(clock.get() + step);
      } else if (event.key === 'Home') {
        event.preventDefault();
        seek(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        seek(timeline.total);
      } else if (event.key === 'Escape') {
        dispatch({ type: 'select', selection: null });
        setPanel(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clock, seek, readOnly, template.canvas.fps, timeline.total]);

  // Aviso al cerrar la pestaña: solo si hay algo que el servidor todavía no tiene.
  const unsaved = autosaveOn ? autosave.state === 'pending' || autosave.state === 'saving' || autosave.state === 'error' : dirty;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Al salir por un enlace de la aplicación (menú, «Contenidos», otra pieza):
  //  * Lo normal: el borrador se guarda solo al salir; se dice, para que se sepa que no se ha perdido nada.
  //  * Si el borrador no se puede guardar (sin conexión, o sin guardado automático): se pregunta antes de salir.
  const atRisk = !readOnly && dirty && (!autosaveOn || autosave.state === 'error');
  useEffect(() => {
    if (!atRisk) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return;
      if (link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      const leave = window.confirm(
        'Los últimos cambios de este reel no se han podido guardar. Si sales ahora, puedes perderlos. ¿Salir de todos modos?',
      );
      if (!leave) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [atRisk]);
  const leaving = useRef({ announce: false, title: item.title });
  useEffect(() => {
    leaving.current = { announce: autosaveOn && dirty && autosave.state !== 'error', title: item.title };
  });
  useEffect(
    () => () => {
      if (leaving.current.announce) {
        notify.info(`«${leaving.current.title}» queda guardado como borrador: al volver estará como lo has dejado.`);
      }
    },
    [],
  );

  // En escritorio, al pedir una sección desde la barra, el panel se desplaza hasta ella.
  useEffect(() => {
    if (!panel) return;
    const section = asideRef.current?.querySelector<HTMLElement>(`[data-section="${panel}"]`);
    section?.scrollIntoView?.({ block: 'nearest' });
  }, [panel, selection]);

  /** Guarda lo que se ve como versión nueva. `announce`: decirlo (al marcarla a mano; al exportar, no hace falta). */
  async function save(note: string, announce = true): Promise<number | null> {
    try {
      const row = await saveReel.mutateAsync({ contentId: item.id, project, note, expectedVersion });
      setExpectedVersion(row.version);
      setBaseline({ project, snapshot });
      // La base de datos borra el borrador al guardar una versión.
      autosave.markVersionSaved();
      setRecoveredAt(null);
      setStaleDraft(null);
      dispatch({ type: 'commit' });
      setSaveOpen(false);
      if (announce) notify.success(`Versión ${row.version} guardada.`);
      return row.version;
    } catch (error) {
      notify.error(
        isVersionConflict(error)
          ? 'Otra persona ha guardado una versión más reciente. Vuelve a abrir la pieza antes de guardar.'
          : error instanceof ProjectError
            ? error.message
            : translateError(error),
      );
      return null;
    }
  }

  async function changeStatus(to: ContentStatus) {
    setBusyStatus(to);
    try {
      await mutations.setStatus.mutateAsync({ contentId: item.id, status: to, expectedVersion });
      notify.success(statusChangedMessage(to));
    } catch (error) {
      notify.error(translateError(error));
    } finally {
      setBusyStatus(null);
    }
  }

  /** Encarga el montaje de la versión indicada (la guardada, o la que se acaba de guardar). */
  function renderVideo(version: number) {
    if (problems.length > 0) return;
    request.mutate(
      {
        request: buildRenderRequest(project, { id: item.id, version }),
        idempotencyKey: crypto.randomUUID(),
      },
      {
        // Cómo avanza se ve en la hoja «Exportar» (y en el botón, si se cierra).
        onSuccess: () => {
          setRequestedVersion(version);
          void queryClient.invalidateQueries({ queryKey: pieceJobKeys(brand.id, item.id) });
        },
        onError: (error) => notify.error(translateError(error)),
      },
    );
  }

  /** Monta lo que se ve: si hay cambios, los guarda antes como versión nueva. */
  async function saveAndRender() {
    if (problems.length > 0 || rendering) return;
    // Con un archivo borrado no se encarga: el servidor lo rechazaría. Se dice qué pasa y se va a él.
    if (missingText) {
      notify.error(missingText);
      setExportOpen(false);
      goToMissing();
      return;
    }
    let version = expectedVersion;
    if (dirty || version === 0) {
      const saved = await save('Exportado', false);
      if (saved === null) return;
      version = saved;
    }
    renderVideo(version);
  }

  async function rename(title: string) {
    try {
      await mutations.update.mutateAsync({ contentId: item.id, title });
      setRenameOpen(false);
      notify.success('Nombre cambiado');
    } catch (error) {
      notify.error(translateError(error));
    }
  }

  function toggleArchive() {
    const archived = !item.archived_at;
    mutations.archive.mutateAsync({ contentId: item.id, archived }).then(
      () => {
        setConfirmArchive(false);
        notify.success(archived ? 'Contenido archivado' : 'Contenido recuperado');
      },
      (error: unknown) => {
        setConfirmArchive(false);
        notify.error(translateError(error));
      },
    );
  }

  async function restore(versionNumber: number) {
    try {
      const row = await mutations.restore.mutateAsync({ contentId: item.id, version: versionNumber, expectedVersion });
      const loaded = await fetchContentVersion(item.id, row.version);
      if (isReelProject(loaded.row.data)) {
        const restored = parseProject(loaded.row.data);
        dispatch({ type: 'reset', project: restored });
        setBaseline({ project: restored, snapshot: JSON.stringify(restored) });
        autosave.markVersionSaved();
        setExpectedVersion(row.version);
      } else {
        onReopen();
      }
      setHistoryOpen(false);
      notify.success(`Versión ${versionNumber} restaurada como versión ${row.version}.`);
    } catch (error) {
      notify.error(translateError(error));
    }
  }

  /** Vuelve a la versión guardada y tira el borrador automático. */
  function discardDraft() {
    dispatch({ type: 'reset', project: baseline.project });
    autosave.discard();
    setRecoveredAt(null);
    seek(0);
  }

  const brandFont = () => fonts.find((f) => reelFont.data && f.family === reelFont.data.family);
  const newTextStyle = () => {
    const defaultFont = brandFont();
    return brandTextStyle(template, {
      fontPath: defaultFont?.path,
      fontFamily: defaultFont?.family,
      color: palette[0]?.hex,
    });
  };
  /** Aspecto de la marca para los textos del guion (tipografía del reel y color principal). */
  const guideLook = () => {
    const defaultFont = brandFont();
    return {
      colors: palette.map((c) => c.hex),
      ...(defaultFont ? { font: { path: defaultFont.path, family: defaultFont.family } } : {}),
    };
  };
  /** Las piezas elegidas entran en el orden de la elección; en un reel vacío, con el estilo y el texto de partida. */
  const addMedia = (assets: ReelSourceAsset[]) => {
    if (assets.length === 0) return;
    if (media?.mode === 'replace') {
      const id = media.id;
      // Con su duración, movimiento, filtro y transición; si era la foto de la portada, la portada la sigue.
      apply((p) => replaceClipAndCover(p, id, assets[0]!, template));
      return;
    }
    if (project.plan.clips.length === 0 && startTemplate) {
      // Con una plantilla: cada pieza ocupa un plano, con su duración, su movimiento y sus textos de muestra.
      const chosen = startTemplate;
      const style = REEL_TEMPLATES.find((t) => t.id === chosen.template.style.id) ?? template;
      const font = brandFont();
      dispatch({
        type: 'change',
        change: () =>
          buildReelFromTemplate(chosen.template, assets, style, {
            ...(font ? { font: { path: font.path, family: font.family } } : {}),
          }),
        select: { kind: 'clip', id: 'c1' },
      });
      const music = chosen.template.music?.suggestion;
      notify.success(
        `Reel montado con «${chosen.name}». Cambia los textos de muestra por los tuyos.${music ? ` Música que le va: ${music}` : ''}`,
      );
      setStartTemplate(null);
      setOpeningText('');
      return;
    }
    if (project.plan.clips.length === 0) {
      dispatch({
        type: 'change',
        change: (p) =>
          startReel(p, assets, template, openingText.trim() ? { text: openingText, style: newTextStyle() } : null),
        select: { kind: 'clip', id: 'c1' },
      });
      setOpeningText('');
      return;
    }
    dispatch({
      type: 'change',
      change: (p) => assets.reduce((acc, asset) => addClip(acc, asset, template), p),
      select: { kind: 'clip', id: newId('c', takenIds()) },
    });
  };
  const newText = () => {
    dispatch({
      type: 'change',
      change: (p) => addText(p, template, clock.get(), newTextStyle(), timeline.total),
      select: { kind: 'text', id: newId('t', takenIds()) },
    });
    setPanel('edit');
  };
  /** Reparte el material que ya tiene el reel en los planos de una plantilla de la marca (se puede deshacer). */
  const applyBrandTemplate = (chosen: BrandReelTemplate) => {
    const assets = project.plan.clips
      .map((c) => byPath.get(c.path))
      .filter((a): a is ReelSourceAsset => Boolean(a))
      .slice(0, reelTemplateNeeds(chosen.template).max);
    if (assets.length === 0) return;
    const style = REEL_TEMPLATES.find((t) => t.id === chosen.template.style.id) ?? template;
    const font = brandFont();
    dispatch({
      type: 'change',
      change: (p) => {
        const built = buildReelFromTemplate(chosen.template, assets, style, {
          ...(font ? { font: { path: font.path, family: font.family } } : {}),
        });
        return {
          ...built,
          plan: { ...built.plan, ...(p.plan.music ? { music: p.plan.music } : {}) },
          ...(p.guide ? { guide: p.guide } : {}),
        };
      },
      select: null,
    });
    setStyleOpen(false);
    seek(0);
    const music = chosen.template.music?.suggestion;
    notify.success(
      `Plantilla «${chosen.name}» aplicada. Cambia los textos de muestra por los tuyos.${music ? ` Música que le va: ${music}` : ''}`,
    );
  };

  const actions = statusActions(item, { edit: canEdit, approve: canApprove });
  const empty = project.plan.clips.length === 0;

  // ── Exportar: en qué punto está el vídeo de lo que se ve ──
  // El vídeo que vale para lo que se ve: el del mismo montaje, aunque sea de otra versión (cambiar el pie no
  // pide montar otra vez). Para publicar vale cualquier vídeo de la marca (publication_media_problem).
  const planRender = useMemo(() => renderOfPlan(jobs.data ?? [], project), [jobs.data, project]);
  const exportNow = exportState({
    empty,
    // Un archivo borrado también impide montar: va primero.
    problems: notices,
    worker,
    checking: worker && jobs.isPending,
    busy: saveReel.isPending || request.isPending,
    rendering,
    renderLabel: versionView?.label,
    dirty,
    anyRender: (jobs.data ?? []).some((j) => describeJob(j).assetId),
    version: expectedVersion,
    render: planRender,
    failed: versionView?.tone === 'danger' ? { detail: versionView.detail } : null,
  });
  /** «Exportar»: abre la hoja y monta el vídeo si lo que se ve todavía no lo tiene. */
  function openExport() {
    setPlaying(false);
    setExportOpen('open');
    if (readOnly) return;
    exportWanted.current = true;
    if (jobsKnown) exportStep.current();
  }
  // En cuanto se sabe si lo que se ve ya tiene vídeo, se monta si hace falta (una vez por pulsación).
  const exportStep = useRef<() => void>(() => {});
  useEffect(() => {
    exportStep.current = () => {
      if (!exportWanted.current) return;
      exportWanted.current = false;
      if (shouldRenderOnExport(exportNow)) void saveAndRender();
    };
  });
  const jobsKnown = !jobs.isPending;
  useEffect(() => {
    if (jobsKnown) exportStep.current();
  }, [jobsKnown]);

  /**
   * «Publicar o programar» (desde la hoja «Exportar»): guarda lo que se ve como versión si hace falta (el pie va
   * en ella), en autogestión la aprueba por debajo (la base de datos solo publica lo aprobado) y después la
   * programa o la publica ya con el vídeo de este montaje. En modo agencia el estado lo decide quien revisa: lo
   * que no está aprobado queda en el calendario en espera.
   */
  async function submitPublish(input: PublishInput) {
    if (!planRender) return;
    setPublishing(true);
    try {
      let version = expectedVersion;
      let status = item.status;
      if (dirty || version === 0) {
        const saved = await save('Para publicar', false);
        if (saved === null) return;
        version = saved;
        // Una versión nueva vuelve a borrador una idea o una pieza aprobada (save_content_version).
        if (status === 'idea' || status === 'approved') status = 'draft';
      }
      if (selfManaged) {
        for (const to of selfApprovalSteps(status)) {
          await mutations.setStatus.mutateAsync({ contentId: item.id, status: to, expectedVersion: version });
          status = to;
        }
      }
      await Promise.all(
        [
          socialKeys.contentItem(brand.id, item.id),
          socialKeys.contentPublication(brand.id, item.id),
          socialKeys.candidates(brand.id),
          socialKeys.media(brand.id),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      if (input.mode === 'now') {
        setExportOpen(false);
        setPublishNow({ accountId: input.accountId });
        return;
      }
      const saved = await savePublication.mutateAsync({
        publicationId: publication.data && publication.data.status !== 'published' ? publication.data.id : null,
        contentId: item.id,
        scheduledAt: input.scheduledAt!,
        accountId: input.accountId,
        mediaAssetIds: [planRender],
        contentVersion: status === 'approved' ? version : null,
      });
      void queryClient.invalidateQueries({ queryKey: socialKeys.contentPublication(brand.id, item.id) });
      setExportOpen(false);
      notify.success(
        saved.status === 'scheduled'
          ? `Programada para el ${formatDateTime(saved.scheduled_at)}.`
          : `En el calendario para el ${formatDateTime(saved.scheduled_at)}; se programará al aprobarla.`,
      );
    } catch (error) {
      notify.error(translateError(error));
    } finally {
      setPublishing(false);
    }
  }

  /** «Publicar otra vez» una pieza ya publicada: una copia (la base de datos publica cada pieza una sola vez). */
  async function republish() {
    try {
      const copy = await mutations.duplicate.mutateAsync(item.id);
      setConfirmRepublish(false);
      setExportOpen(false);
      notify.success('Copia hecha: exporta y publica desde aquí.');
      navigate(paths.item((copy as { id: string }).id));
    } catch (error) {
      setConfirmRepublish(false);
      notify.error(translateError(error));
    }
  }

  /** Al abrir «Publicar o programar» sin pie, el que propuso «Hacer un reel como este», si lo hay. */
  function openPublish() {
    if (!project.copy && suggestedCopy && !readOnly) apply((p) => ({ ...p, copy: suggestedCopy }));
    setExportOpen('publish');
  }

  const previousRenders: PreviousRender[] = (jobs.data ?? []).map((job) => {
    const view = describeJob(job);
    return {
      id: job.id,
      version: jobContentVersion(job),
      label: view.label,
      tone: view.tone,
      createdAt: job.created_at,
      detail: view.detail,
      assetId: view.assetId,
    };
  });
  const publishHint = !publishingOn
    ? 'Publicar no está activado en esta instalación.'
    : !canEdit || item.archived_at
      ? 'No puedes publicar este reel.'
      : selfManaged && !canApprove
        ? 'Tu papel en la marca no deja publicar: pídeselo a quien la gestiona.'
        : undefined;
  const published = publication.data?.status === 'published' ? publication.data : null;
  const scheduled = publication.data && publication.data.status !== 'published' ? publication.data : null;
  // En modo agencia, «Publicar ahora» solo con la pieza aprobada y sin cambios (lo demás queda en espera).
  const nowBlocked =
    !selfManaged && (item.status !== 'approved' || dirty)
      ? 'Para publicarla ya tiene que estar aprobada, sin cambios después. Puedes programarla: saldrá al aprobarla.'
      : undefined;

  // ── Aprobación (solo en modo agencia): el siguiente paso, en «Exportar»; los demás, en «⋯» ──
  const primary = selfManaged
    ? null
    : editorPrimaryAction(item, actions, { edit: canEdit, publishNow: false, schedule: false });
  const primaryStatus = primary?.kind === 'status' ? primary.action : null;
  const statusBlocked = (action: StatusAction) =>
    dirty
      ? 'Antes, exporta los cambios'
      : action.needsVersion && expectedVersion === 0
        ? 'Antes, exporta el reel'
        : undefined;
  const FORWARD = new Set<ContentStatus>(['in_review', 'approved']);
  const statusItem = (action: StatusAction) => ({
    id: `status-${action.to}`,
    label: action.label,
    icon: FORWARD.has(action.to) ? SendHorizontal : Undo2,
    onSelect: () => void changeStatus(action.to),
    disabled: Boolean(statusBlocked(action)) || busyStatus !== null,
    hint: statusBlocked(action),
    testId: `reel-status-${action.to}`,
  });
  const menuStatus = selfManaged ? [] : actions.filter((a) => a.to !== primaryStatus?.to);
  const approval = selfManaged ? undefined : (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl bg-subtle px-3 py-2 text-sm"
      data-testid="reel-approval"
    >
      <span className="text-muted">Estado:</span>
      <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
      {primaryStatus && (
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => void changeStatus(primaryStatus.to)}
          disabled={Boolean(statusBlocked(primaryStatus)) || busyStatus !== null}
          loading={busyStatus === primaryStatus.to}
          title={statusBlocked(primaryStatus)}
          data-testid={`reel-status-${primaryStatus.to}`}
        >
          {primaryStatus.to === 'approved' ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden />
          )}
          {primaryStatus.label}
        </Button>
      )}
    </div>
  );

  // ── «⋯» de la cabecera: lo que se usa poco ──
  const moreActions: MoreMenuItem[] = [
    // En un móvil no cabe «Rehacer» junto a «Deshacer».
    ...(narrow && !readOnly
      ? [
          {
            id: 'redo',
            label: 'Rehacer',
            icon: Redo2,
            onSelect: () => dispatch({ type: 'redo' }),
            disabled: state.future.length === 0,
            testId: 'reel-redo-menu',
          },
        ]
      : []),
    {
      id: 'history',
      label: 'Historial',
      icon: History,
      onSelect: () => setHistoryOpen(true),
      testId: 'reel-history',
    },
    {
      id: 'safe-zones',
      label: safeZones ? 'Ocultar lo que tapa Instagram' : 'Ver lo que tapa Instagram',
      icon: ScanLine,
      onSelect: () => setSafeZones((v) => !v),
      testId: 'reel-safe-toggle',
    },
    ...(canEdit && !item.archived_at
      ? [
          {
            id: 'rename',
            label: 'Cambiar el nombre',
            icon: PencilLine,
            onSelect: () => setRenameOpen(true),
            testId: 'reel-rename',
          },
        ]
      : []),
    null,
    ...menuStatus.map(statusItem),
    ...(canEdit && !item.archived_at
      ? [
          {
            id: 'archive',
            label: 'Archivar',
            icon: Archive,
            onSelect: () => setConfirmArchive(true),
            destructive: true,
            testId: 'reel-archive',
          },
        ]
      : []),
  ];

  // ── Barra de herramientas: lo que se puede hacer con lo elegido ──
  const kind = barKind(project, selection);
  const bar = contextActions({
    project,
    selection,
    readOnly,
    canSplit: true,
    full: project.plan.clips.length >= REEL_MAX_CLIPS,
  });
  const onBar = (action: BarAction) => {
    switch (action.id) {
      case 'add':
        setMedia({ mode: 'add' });
        return;
      case 'text':
        newText();
        return;
      case 'music':
        if (project.plan.music) dispatch({ type: 'select', selection: { kind: 'music' } });
        else setMusicOpen(true);
        return;
      case 'change-music':
        setMusicOpen(true);
        return;
      case 'style':
        setStyleOpen('styles');
        return;
      case 'subtitles':
        dispatch({ type: 'select', selection: { kind: 'subtitles' } });
        setPanel('subtitles');
        return;
      case 'split':
        split();
        return;
      case 'mute':
        if (selection?.kind === 'clip') apply((p) => toggleClipMute(p, selection.id, template));
        return;
      case 'replace':
        if (selection?.kind === 'clip') setMedia({ mode: 'replace', id: selection.id });
        return;
      case 'duplicate':
        duplicate();
        return;
      case 'delete':
        remove();
        return;
      default:
        if (action.panel) setPanel((current) => (current === action.panel ? null : action.panel!));
    }
  };
  const replacing = media?.mode === 'replace' ? project.plan.clips.find((c) => c.id === media.id) : undefined;

  const zoomFit = () => {
    const width = timelineBoxRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0 && timeline.total > 0) setPps(clampZoom((width * 0.9) / timeline.total));
  };

  // Estado del guardado: con el guardado automático, lo que dice; sin él (tabla sin migrar), si hay cambios.
  const autosaveText = !autosaveOn
    ? dirty && !readOnly
      ? 'Sin guardar'
      : ''
    : autosave.state === 'clean' || autosave.state === 'saved'
      ? expectedVersion > 0 || !empty
        ? 'Guardado'
        : ''
      : AUTOSAVE_LABEL[autosave.state];
  const autosaveState = autosaveOn ? autosave.state : 'error';

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative flex min-h-0 flex-1 flex-col gap-2',
        // Móvil y tableta: a pantalla completa, por encima de la cabecera y de la barra de la aplicación.
        'max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:bg-bg max-lg:px-2',
        'max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-lg:pt-[max(0.5rem,env(safe-area-inset-top))]',
      )}
      data-testid="reel-editor"
    >
      {/* ── Cabecera: volver, nombre, guardado, deshacer, «⋯» y un único «Exportar» ── */}
      <header className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Link
          to={paths.list}
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg pr-1 text-sm text-muted hover:text-fg"
          aria-label="Volver a Contenidos"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          <span className="max-lg:hidden">Contenidos</span>
        </Link>
        <h1 className="min-w-0 truncate text-base font-semibold lg:text-xl" title={item.title}>
          {item.title}
        </h1>
        {/* En modo agencia, el estado de la pieza (en autogestión no hay aprobación a la vista). */}
        {!selfManaged && !published && (
          <Badge tone={STATUS_TONE[item.status]} className="shrink-0 max-sm:hidden">
            <span data-testid="reel-status">{STATUS_LABEL[item.status]}</span>
          </Badge>
        )}
        {item.archived_at && <Badge tone="warning">Archivado</Badge>}
        {published && (
          <Badge tone="success" className="shrink-0">
            <span data-testid="reel-published-badge">Publicada</span>
          </Badge>
        )}
        {autosaveText && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 text-xs text-muted',
              autosaveState === 'error' && 'text-danger',
            )}
            role="status"
            aria-live="polite"
            title={
              !autosaveOn
                ? 'Se guarda al exportar, o desde «⋯» → Historial.'
                : autosave.state === 'error'
                  ? 'No se ha podido guardar: se reintenta solo. Revisa la conexión.'
                  : 'El reel se guarda solo mientras editas.'
            }
            data-testid="reel-autosave"
            data-state={autosaveState}
          >
            {autosaveState === 'error' ? (
              <CloudOff className="h-3.5 w-3.5" aria-hidden />
            ) : autosaveState === 'pending' || autosaveState === 'saving' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
            )}
            <span className="max-sm:sr-only">{autosaveText}</span>
          </span>
        )}
        <span className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-1" data-testid="page-actions">
          {!readOnly && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Deshacer"
                aria-keyshortcuts="Control+Z"
                title="Deshacer (Ctrl+Z)"
                disabled={state.past.length === 0}
                onClick={() => dispatch({ type: 'undo' })}
                data-testid="reel-undo"
              >
                <Undo2 className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="max-sm:hidden"
                aria-label="Rehacer"
                aria-keyshortcuts="Control+Y"
                title="Rehacer (Ctrl+Y)"
                disabled={state.future.length === 0}
                onClick={() => dispatch({ type: 'redo' })}
                data-testid="reel-redo"
              >
                <Redo2 className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )}
          <MoreMenu items={moreActions} label="Más acciones del reel" testId="reel-more" size="sm" />
          {item.archived_at && canEdit ? (
            <Button size="sm" onClick={toggleArchive} loading={mutations.archive.isPending} data-testid="reel-restore">
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              Recuperar
            </Button>
          ) : (
            <Button size="sm" onClick={openExport} disabled={empty && !render} data-testid="reel-export">
              {exportNow.kind === 'rendering' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              Exportar
            </Button>
          )}
        </div>
      </header>

      {/* ── Avisos de la pieza (pocas líneas; si hay muchos, se desplazan dentro) ── */}
      <div className="max-h-24 shrink-0 space-y-1 overflow-y-auto empty:hidden">
        {missingText && (
          <MissingNotice text={missingText} first={missing[0]} readOnly={readOnly} onGo={() => goToMissing()} />
        )}
        {item.archived_at && (
          <Notice tone="warning">Está archivado: se puede ver, pero no cambiar hasta recuperarlo.</Notice>
        )}
        {previousDesign && (
          <Notice>
            La versión vigente de esta pieza es un diseño por capas. Aquí empiezas un montaje de vídeo: al guardarlo será
            una versión nueva. El diseño sigue en el historial y se puede abrir{' '}
            <Link to="?editor=imagen" className="font-medium text-primary underline">
              en el editor de imagen
            </Link>
            .
          </Notice>
        )}
        {likeDraft === 'missing' && (
          <Notice tone="warning">
            No se ha podido leer el análisis del que salía este reel: empiezas con un reel vacío.
          </Notice>
        )}
        {likeDraft && likeDraft !== 'missing' && !expectedVersion && (
          <div data-testid="reel-like-draft-notice">
            <Notice>
              Borrador hecho a partir de un vídeo de referencia:{' '}
              {likeDraft.filled === 1 ? '1 plano' : `${likeDraft.filled} planos`} con material de tu biblioteca y{' '}
              {likeDraft.gaps === 1 ? '1 por grabar' : `${likeDraft.gaps} por grabar`}. Revísalo y guarda la versión
              {likeDraft.filled === 0 ? ' cuando añadas el primer plano' : ''}.
              {likeDraft.notes.map((note) => ` ${note}`).join('')}
            </Notice>
          </div>
        )}
        {recoveredAt && dirty && (
          <div data-testid="reel-draft-recovered">
            <Notice>
              Has vuelto a lo que dejaste a medias (guardado solo el {formatDateTime(recoveredAt)}). Todavía no es una
              versión.{' '}
              <button type="button" className="font-medium text-primary underline" onClick={discardDraft}>
                Descartarlo y volver a {expectedVersion > 0 ? `la versión ${expectedVersion}` : 'empezar'}
              </button>
            </Notice>
          </div>
        )}
        {staleDraft && !readOnly && (
          <div data-testid="reel-draft-stale">
            <Notice tone="warning">
              Hay un borrador sin guardar del {formatDateTime(staleDraft.updatedAt)}, de antes de la versión vigente.{' '}
              <button
                type="button"
                className="font-medium text-primary underline"
                onClick={() => {
                  const draftProject = staleDraft.project;
                  dispatch({ type: 'change', change: () => draftProject, select: null });
                  setStaleDraft(null);
                }}
              >
                Recuperarlo
              </button>{' '}
              ·{' '}
              <button
                type="button"
                className="font-medium text-primary underline"
                onClick={() => {
                  setStaleDraft(null);
                  if (!dirty) autosave.discard();
                }}
              >
                Descartarlo
              </button>
            </Notice>
          </div>
        )}
      </div>

      {empty ? (
        /* ── Reel vacío: el guion (si viene de un vídeo de referencia) o empezar en tres pasos ── */
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {project.guide && (
            <GuidePanel
              project={project}
              sources={sources.data ?? []}
              loading={sources.isPending}
              error={sources.error}
              readOnly={readOnly}
              labelOf={labelOf}
              onFill={(shotId, asset) => apply((p) => fillGuideShot(p, shotId, asset, template, guideLook()))}
              onSelectClip={(id) => select({ kind: 'clip', id })}
            />
          )}
          {/* «Nuevo reel → Desde una plantilla»: mientras llegan las plantillas de la marca no se enseña la
              galería otra vez; en cuanto llegan se piden las fotos de la elegida. */}
          {awaitingTemplate && (
            <div role="status" aria-label="Preparando la plantilla" data-testid="reel-template-loading">
              <Skeleton className="h-64 w-full" />
            </div>
          )}
          {!readOnly && !project.guide && !awaitingTemplate && !(startTemplate && media) && (
            <Starter
              templates={REEL_TEMPLATES}
              templateId={template.id}
              onTemplate={(id) => {
                const next = REEL_TEMPLATES.find((t) => t.id === id);
                if (next) apply((p) => applyTemplate(p, next));
              }}
              onPickMedia={(text) => {
                setStartTemplate(null);
                setOpeningText(text);
                setMedia({ mode: 'add' });
              }}
              brandTemplates={brandTemplates.data ?? []}
              onBrandTemplate={(chosen) => {
                setStartTemplate(chosen);
                setMedia({ mode: 'add' });
              }}
            />
          )}
        </div>
      ) : (
        <>
          <div
            className={cn(
              'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3',
              // El ajuste de la herramienta, estrecho y al lado, solo mientras está abierto.
              panel !== null && 'lg:grid-cols-[minmax(0,1fr)_20rem]',
            )}
          >
            {/* ── Vista previa ── */}
            <div className="relative flex min-h-0 flex-col" data-reel-keys>
              {missing.length > 0 && (
                <MissingOverlay
                  clock={clock}
                  timeline={timeline}
                  missing={missing}
                  readOnly={readOnly}
                  onReplace={replaceMissing}
                  onRemove={removeMissing}
                />
              )}
              <ReelPlayer
                plan={project.plan}
                timeline={timeline}
                template={template}
                urls={urls}
                defaultFamily={reelFont.data?.family ?? null}
                clock={clock}
                playing={playing}
                onPlayingChange={changePlaying}
                onSeek={seek}
                stopAt={stopAt}
                selection={selection}
                readOnly={readOnly}
                onSelect={(next) => dispatch({ type: 'select', selection: next })}
                onTextOffset={(id, offset, key) => apply((p) => setTextOffset(p, id, offset), key)}
                onTextSize={(id, size, key) => apply((p) => setTextSize(p, id, size), key)}
                onTextChange={(id, text, key) => apply((p) => updateText(p, id, { text }), key)}
                onGestureEnd={commit}
                safeZones={safeZones}
              />
            </div>

            {/* ── Ajuste de la herramienta elegida: panel estrecho al lado en escritorio; hoja en móvil ── */}
            <aside
              ref={asideRef}
              aria-label={panelTitle(bar, panel)}
              className={cn(
                'min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-3',
                'max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:max-h-[58%] max-lg:rounded-b-none max-lg:shadow-pop',
                panel === null && 'hidden',
              )}
              data-testid="reel-panel"
              data-open={panel !== null}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{panelTitle(bar, panel)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPanel(null)}
                  aria-label="Cerrar el ajuste"
                  data-testid="reel-panel-close"
                >
                  <X className="h-4 w-4" aria-hidden />
                  <span className="lg:sr-only">Listo</span>
                </Button>
              </div>
              {selection ? (
                <Inspector
                  project={project}
                  selection={selection}
                  template={template}
                  readOnly={readOnly}
                  apply={apply}
                  onSelect={select}
                  labelOf={labelOf}
                  fileSecondsOf={fileSecondsOf}
                  urlOf={urlOf}
                  palette={palette}
                  fonts={fonts}
                  autoSubtitles={autoSubtitles}
                  brandId={brand.id}
                  beats={beats}
                  onPlayFrom={playFrom}
                  section={panel}
                  startOf={(id) => {
                    const index = project.plan.clips.findIndex((c) => c.id === id);
                    return index >= 0 ? timeline.starts[index]! + timeline.transitions[index]! : null;
                  }}
                />
              ) : (
                project.guide &&
                panel === 'guide' && (
                  <GuidePanel
                    project={project}
                    sources={sources.data ?? []}
                    loading={sources.isPending}
                    error={sources.error}
                    readOnly={readOnly}
                    labelOf={labelOf}
                    onFill={(shotId, asset) => apply((p) => fillGuideShot(p, shotId, asset, template, guideLook()))}
                    onSelectClip={(id) => select({ kind: 'clip', id })}
                  />
                )
              )}
            </aside>
          </div>

          {/* ── La única barra de herramientas: cambia con lo elegido (en móvil, abajo del todo) ── */}
          <div className="shrink-0 max-lg:order-last">
            <ContextBar kind={kind} actions={bar} activePanel={panel} onAction={onBar} onBack={() => select(null)} />
          </div>

          {/* ── Línea de tiempo, con su duración y su zoom (en móvil, el zoom es el pellizco) ── */}
          <div className="shrink-0 space-y-1" data-reel-keys data-testid="reel-timeline-area">
            <div className="flex items-center gap-2 text-xs text-muted max-lg:hidden">
              <span className="min-w-0 flex-1 truncate" data-testid="reel-duration">
                {fmt(timeline.total)} s de {REEL_MAX_SECONDS} s como máximo
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Alejar la línea de tiempo"
                disabled={pps <= ZOOM.min}
                onClick={() => setPps((z) => clampZoom(z / ZOOM_STEP))}
                data-testid="reel-zoom-out"
              >
                <ZoomOut className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Ver el reel entero en la línea de tiempo"
                title="Ajustar: el reel entero a la vista"
                onClick={zoomFit}
                data-testid="reel-zoom-fit"
              >
                <Maximize2 className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Acercar la línea de tiempo"
                disabled={pps >= ZOOM.max}
                onClick={() => setPps((z) => clampZoom(z * ZOOM_STEP))}
                data-testid="reel-zoom-in"
              >
                <ZoomIn className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div ref={timelineBoxRef}>
              <Timeline
                plan={project.plan}
                timeline={timeline}
                pxPerSecond={pps}
                onZoom={setPps}
                clock={clock}
                selection={selection}
                readOnly={readOnly}
                labelOf={labelOf}
                isMissing={isMissing}
                fileSecondsOf={fileSecondsOf}
                urlOf={urlOf}
                thumbOf={thumbOf}
                onSeek={seek}
                onSelect={select}
                onMoveClip={(from, to) => apply((p) => moveClip(p, from, to))}
                onTrimClip={(id, edge, value, key) => {
                  const clip = project.plan.clips.find((c) => c.id === id);
                  apply((p) => trimClip(p, id, edge, value, clip ? fileSecondsOf(clip.path) : null), key);
                }}
                onMoveText={(id, value, key) => apply((p) => moveText(p, id, value), key)}
                onTrimText={(id, edge, value, key) => apply((p) => trimText(p, id, edge, value), key)}
                onDragEnd={commit}
                beats={beatTimes}
                onAddMedia={() => setMedia({ mode: 'add' })}
                onAddText={newText}
                onAddMusic={() => setMusicOpen(true)}
              />
            </div>
          </div>
        </>
      )}

      <SaveVersionDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        saving={saveReel.isPending}
        issues={[]}
        onSave={(note) => void save(note)}
      />
      {media && (
        <MediaPicker
          open
          onOpenChange={(open) => {
            if (!open) {
              setMedia(null);
              setStartTemplate(null);
            }
          }}
          sources={(sources.data ?? []).filter((a) => a.kind === 'image' || a.kind === 'video')}
          loading={sources.isPending}
          error={sources.error}
          room={
            media.mode === 'replace'
              ? 1
              : empty && startTemplate
                ? reelTemplateNeeds(startTemplate.template).max
                : REEL_MAX_CLIPS - project.plan.clips.length
          }
          {...(media.mode === 'replace'
            ? {
                title: 'Sustituir por otra foto o clip',
                description: `Entra en el sitio de «${replacing ? labelOf(replacing.path) : ''}», con su duración, su transición y sus efectos.`,
              }
            : empty && startTemplate
              ? {
                  title: `«${startTemplate.name}»: elige el material`,
                  description:
                    'Toca las fotos y los clips en el orden de los planos. Si eliges menos, se quitan los planos que sobran.',
                  guide: {
                    steps: startTemplate.template.slots.map((slot) => slot.label),
                    wanted: reelTemplateNeeds(startTemplate.template).min,
                  },
                }
              : {})}
          confirmLabel={(n) =>
            media.mode === 'replace'
              ? 'Sustituir'
              : empty
                ? n === 0
                  ? startTemplate
                    ? 'Montar el reel'
                    : 'Crear el reel'
                  : `${startTemplate ? 'Montar' : 'Crear'} el reel con ${n}`
                : `Añadir ${n}`
          }
          onConfirm={addMedia}
        />
      )}
      <Dialog
        open={styleOpen !== false}
        onOpenChange={(open) => setStyleOpen(open ? 'styles' : false)}
        title="Estilo del reel"
        description={
          styleOpen === 'templates'
            ? 'Reparte las fotos y los clips del reel, en su orden, en los planos de una plantilla de la marca, con sus textos de muestra. La música se conserva. Se puede deshacer.'
            : 'Ritmo, transiciones y letra. No toca el orden, los recortes ni lo que escribiste.'
        }
        size="lg"
      >
        {(brandTemplates.data ?? []).length > 0 && (
          <div className="mb-3 flex gap-1 rounded-lg bg-subtle p-1" role="tablist" aria-label="Estilo o plantilla">
            {(
              [
                ['styles', 'Estilos'],
                ['templates', 'Plantillas de la marca'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={styleOpen === value}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium',
                  styleOpen === value ? 'bg-surface shadow-card' : 'text-muted hover:text-fg',
                )}
                onClick={() => setStyleOpen(value)}
                data-testid={`reel-style-tab-${value}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {styleOpen === 'templates' ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {(brandTemplates.data ?? []).map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={readOnly || empty}
                  className="h-full w-full rounded-xl border border-border p-3 text-left hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  onClick={() => applyBrandTemplate(entry)}
                  data-testid="reel-apply-template"
                >
                  <span className="block text-sm font-semibold">{entry.name}</span>
                  <span className="block text-xs text-muted">{entry.template.purpose}</span>
                  <span className="mt-1 block text-xs">Necesita: {describeNeeds(entry.template)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <TemplateCards
            templates={REEL_TEMPLATES}
            value={template.id}
            disabled={readOnly}
            onChange={(id) => {
              const next = REEL_TEMPLATES.find((t) => t.id === id);
              if (next) apply((p) => applyTemplate(p, next));
              setStyleOpen(false);
            }}
          />
        )}
      </Dialog>
      {renameOpen && (
        <RenameDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          current={item.title}
          saving={mutations.update.isPending}
          onSave={(title) => void rename(title)}
        />
      )}
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`¿Archivar «${item.title}»?`}
        description="No se borra: queda en «Archivadas», con su historial, y se puede recuperar."
        confirmLabel="Archivar"
        loading={mutations.archive.isPending}
        onConfirm={toggleArchive}
      />
      <MusicPicker
        open={musicOpen}
        onOpenChange={setMusicOpen}
        organizationId={org.id}
        brandId={brand.id}
        canUpload={!readOnly}
        audios={(sources.data ?? []).filter((a) => a.kind === 'audio')}
        onPick={(asset, note) => {
          apply((p) => setMusic(p, asset.storage_path, template, note));
          dispatch({ type: 'select', selection: { kind: 'music' } });
          setPanel('volume');
          setMusicOpen(false);
        }}
      />
      <VersionsDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        brandId={brand.id}
        contentId={item.id}
        current={expectedVersion}
        dirty={dirty}
        onMark={
          readOnly || empty
            ? undefined
            : () => {
                setHistoryOpen(false);
                setSaveOpen(true);
              }
        }
        canRestore={!readOnly}
        restoring={mutations.restore.isPending}
        onRestore={(v) => void restore(v)}
      />
      <ExportSheet
        open={exportOpen !== false}
        onOpenChange={(open) => setExportOpen(open ? 'open' : false)}
        title={exportOpen === 'publish' ? 'Publicar o programar' : 'Exportar'}
        key={exportOpen === 'cover' ? 'cover' : 'sheet'}
        coverOpen={exportOpen === 'cover'}
        brandId={brand.id}
        state={exportNow}
        canRender={!readOnly}
        onRender={() => void saveAndRender()}
        onFix={
          missing.length > 0
            ? () => {
                setExportOpen(false);
                goToMissing();
              }
            : undefined
        }
        libraryPathOf={(assetId) => `/o/${org.id}/m/${brand.id}/biblioteca?recurso=${assetId}`}
        warnings={warnings}
        publish={
          published
            ? {
                label: 'Publicar otra vez',
                detail: 'Saldrá repetido en Instagram: se hace una copia del reel.',
                disabled: Boolean(publishHint),
                hint: publishHint,
                busy: mutations.duplicate.isPending,
                onPublish: () => setConfirmRepublish(true),
              }
            : {
                detail: scheduled ? `Programada para el ${formatDateTime(scheduled.scheduled_at)}.` : undefined,
                disabled: Boolean(publishHint),
                hint: publishHint,
                busy: false,
                onPublish: openPublish,
              }
        }
        published={published ? <PublishedLine publication={published} /> : undefined}
        publishView={
          exportOpen === 'publish' && planRender ? (
            <PublishPanel
              brandId={brand.id}
              network={item.network}
              format={item.format}
              copy={project.copy ?? EMPTY_COPY}
              onCopy={(copy) => apply((p) => ({ ...p, copy }), 'copy')}
              readOnly={readOnly}
              captionAi={captionTask && brand.ai_mode !== 'agency'}
              accounts={accounts.data}
              accountsPath={`/o/${org.id}/m/${brand.id}/marca?seccion=datos`}
              publication={publication.data ?? null}
              blocked={publishHint}
              nowBlocked={nowBlocked}
              approval={approval}
              busy={publishing}
              onSubmit={(input) => void submitPublish(input)}
            />
          ) : undefined
        }
        onBack={() => setExportOpen('open')}
        approval={approval}
        cover={
          <CoverSection
            clock={clock}
            project={project}
            total={timeline.total}
            readOnly={readOnly}
            urlOf={urlOf}
            labelOf={labelOf}
            apply={apply}
            onSeek={seek}
          />
        }
        previous={previousRenders}
      />
      {publishNow && planRender && (
        <PublishNowDialog
          brandId={brand.id}
          open
          onOpenChange={(open) => {
            if (!open) {
              setPublishNow(null);
              void queryClient.invalidateQueries({ queryKey: socialKeys.contentPublication(brand.id, item.id) });
            }
          }}
          contentId={item.id}
          accountId={publishNow.accountId}
          assetIds={[planRender]}
          editorPath={paths.item(item.id)}
        />
      )}
      <ConfirmDialog
        open={confirmRepublish}
        onOpenChange={setConfirmRepublish}
        title="¿Publicar otra vez?"
        description="Este reel ya está publicado. Se hace una copia para publicarla: en Instagram saldrá dos veces."
        confirmLabel="Hacer una copia"
        loading={mutations.duplicate.isPending}
        onConfirm={() => void republish()}
      />
    </div>
  );
}

/** Portada: «el fotograma de ahora» es el del cabezal en el momento de pulsar. */
function CoverSection({
  clock,
  project,
  total,
  readOnly,
  urlOf,
  labelOf,
  apply,
  onSeek,
}: {
  clock: PlayClock;
  project: ReelProject;
  total: number;
  readOnly: boolean;
  urlOf: (path: string) => string | undefined;
  labelOf: (path: string) => string;
  apply: Apply;
  onSeek: (seconds: number) => void;
}) {
  const playhead = useClockValue(clock, 0.1);
  return (
    <CoverPicker
      plan={project.plan}
      playhead={playhead}
      total={total}
      readOnly={readOnly}
      urlOf={urlOf}
      labelOf={labelOf}
      onChange={(cover) =>
        apply((p) =>
          setCover(p, cover?.type === 'frame' ? { type: 'frame', at: Number(Math.min(clock.get(), total).toFixed(2)) } : cover),
        )
      }
      onSeek={onSeek}
    />
  );
}

/**
 * Elegir la música: una pista de la biblioteca o un audio que se sube ahí mismo, con el aviso de
 * licencia y la confirmación obligatoria, que queda en el plan y en la procedencia.
 */
function MusicPicker({
  open,
  onOpenChange,
  organizationId,
  brandId,
  canUpload,
  audios,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  brandId: string;
  canUpload: boolean;
  audios: ReelSourceAsset[];
  onPick: (asset: ReelSourceAsset, note: string) => void;
}) {
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);
  /** Lo subido desde aquí, mientras la lista de la biblioteca se refresca. */
  const [uploaded, setUploaded] = useState<ReelSourceAsset[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const all = [...uploaded.filter((u) => !audios.some((a) => a.id === u.id)), ...audios];
  const asset = all.find((a) => a.id === choice);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      notify.error('Elige un archivo de audio (MP3, M4A o WAV).');
      return;
    }
    setUploading(true);
    try {
      // Un audio no tiene medidas que leer (ancho, alto): se dice, y no se abre el archivo para buscarlas.
      const row = await uploadAsset({
        organizationId,
        brandId,
        file,
        kind: 'audio',
        dimensions: { width: null, height: null, durationMs: null },
      });
      setUploaded((current) => [row, ...current]);
      setChoice(row.id);
      void queryClient.invalidateQueries({ queryKey: reelKeys.sources(brandId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.all(brandId) });
      notify.success(`«${row.file_name}» está en la biblioteca. Confirma la licencia para usarla.`);
    } catch (error) {
      notify.error(translateError(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const uploadButton = canUpload && (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/wav,.mp3,.m4a,.wav"
        className="sr-only"
        tabIndex={-1}
        aria-label="Archivo de audio"
        onChange={(e) => void upload(e.target.files?.[0])}
        data-testid="reel-music-file"
      />
      <Button
        variant="secondary"
        onClick={() => fileRef.current?.click()}
        loading={uploading}
        data-testid="reel-music-upload"
      >
        <Upload className="h-4 w-4" aria-hidden />
        Subir un audio
      </Button>
    </>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirmed(false);
          setNote('');
        }
        onOpenChange(next);
      }}
      title="Música del reel"
      description="Una pista de audio de la biblioteca de la marca, o una que subas ahora (MP3, M4A o WAV)."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!asset || !confirmed}
            onClick={() => asset && onPick(asset, note)}
            data-testid="reel-music-add"
          >
            Usar esta música
          </Button>
        </>
      }
    >
      {/* También se puede soltar aquí la pista desde el ordenador. */}
      <div
        onDragOver={(e) => {
          if (canUpload && Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!canUpload || !Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          void upload(e.dataTransfer.files[0]);
        }}
        data-testid="reel-music-drop"
      >
      {all.length === 0 ? (
        <div className="space-y-3" data-testid="reel-music-empty">
          <p className="text-sm text-muted">
            Todavía no hay audios en la biblioteca de la marca. Sube la pista aquí mismo: se queda en la biblioteca
            para otros reels.
          </p>
          {uploadButton}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">{uploadButton}</div>
          <Select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Pista"
            data-testid="reel-music-choice"
          >
            <option value="">Elige una pista</option>
            {all.map((a) => (
              <option key={a.id} value={a.id}>
                {a.file_name}
              </option>
            ))}
          </Select>
          <div data-testid="reel-music-license">
            <Notice tone="warning">
              La licencia de la música es responsabilidad de la marca. Publicar música sin permiso puede hacer que la
              red silencie o retire el vídeo. Confírmalo solo si la marca tiene derecho a usarla en redes sociales.
            </Notice>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              data-testid="reel-music-confirm"
            />
            La marca tiene licencia para usar esta música en sus redes.
          </label>
          <Input
            placeholder="De dónde sale la licencia (opcional): biblioteca, contrato…"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Nota sobre la licencia"
          />
        </div>
      )}
      </div>
    </Dialog>
  );
}

function VersionsDialog({
  open,
  onOpenChange,
  brandId,
  contentId,
  current,
  dirty,
  onMark,
  canRestore,
  restoring,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  contentId: string;
  current: number;
  /** Lo que se ve tiene cambios que no están en ninguna versión. */
  dirty: boolean;
  /** Guarda lo que se ve como versión con una nota (para poder volver a ella). */
  onMark?: () => void;
  canRestore: boolean;
  restoring: boolean;
  onRestore: (version: number) => void;
}) {
  const versions = useContentVersions(brandId, contentId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Historial de versiones">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 text-muted" data-testid="reel-version">
          {current > 0 ? `Ahora: versión ${current}` : 'Todavía sin versiones'}
          {dirty && ' · con cambios sin marcar como versión'}
        </span>
        {onMark && (
          <Button variant="secondary" size="sm" onClick={onMark} disabled={!dirty && current > 0} data-testid="reel-save">
            <Save className="h-4 w-4" aria-hidden />
            Marcar esta versión
          </Button>
        )}
      </div>
      {current === 0 ? null : versions.isPending ? (
        <Skeleton className="h-24" />
      ) : versions.isError ? (
        <ErrorState error={versions.error} />
      ) : (
        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto" data-testid="reel-versions">
          {versions.data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className={cn('font-medium', v.version === current && 'text-primary')}>Versión {v.version}</span>
              <span className="text-xs text-muted">
                {v.author} · {formatDateTime(v.created_at)}
              </span>
              {v.change_note && <span className="w-full text-xs">{v.change_note}</span>}
              {canRestore && v.version !== current && (
                <Button variant="ghost" size="sm" loading={restoring} onClick={() => onRestore(v.version)}>
                  Restaurar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  current,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
  saving: boolean;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(current);
  const clean = title.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cambiar el nombre"
      description="Es el nombre con el que lo ves en Contenidos; no sale en la red."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!clean || clean === current}
            loading={saving}
            onClick={() => onSave(clean)}
            data-testid="reel-rename-save"
          >
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Nombre">
        {(fieldProps) => (
          <Input {...fieldProps} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}

/** ¿Pantalla de móvil (menos de 640 px)? Ahí «Rehacer» pasa al «⋯» para que la cabecera quepa. */
function useNarrow(): boolean {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const onChange = () => setNarrow(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
