// Editor de reels: una pieza de formato reel cuyas versiones son montajes
// (proyecto con el plan v2). Pantalla organizada como los editores de móvil
// (docs/editor-reels.md §10): vista previa grande arriba, línea de tiempo
// debajo con el cabezal fijo, y una barra de herramientas que cambia con lo
// elegido; en escritorio, además, el panel de propiedades al lado y atajos de
// teclado. El montaje se guarda solo como borrador mientras se edita; las
// versiones, la aprobación y el montaje del vídeo por el trabajador siguen
// como siempre.
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronLeft,
  Clapperboard,
  CloudOff,
  Download,
  History,
  Loader2,
  Maximize2,
  PencilLine,
  Redo2,
  Save,
  Send,
  SendHorizontal,
  TriangleAlert,
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
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
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
import { assetKeys, uploadAsset, useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useFeature } from '@/features/platform/integrations/useFeature';
import { PUBLISHABLE_TARGETS } from '@/features/social/calendar';
import { PublishNowDialog } from '@/features/social/PublishNowDialog';
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
import { previewWarnings } from './compose';
import { barKind, ContextBar, contextActions, type BarAction } from './ContextBar';
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
  replaceClip,
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
  /** Sección del panel abierta (en móvil, la hoja). */
  const [panel, setPanel] = useState<string | null>(() => (boot.initial.guide ? 'guide' : null));
  const [saveOpen, setSaveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Selector de fotos y clips: para añadir o para sustituir un elemento. */
  const [media, setMedia] = useState<{ mode: 'add' } | { mode: 'replace'; id: string } | null>(null);
  const [musicOpen, setMusicOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  /** Vídeo montado que se está viendo dentro del editor (su recurso de la biblioteca). */
  const [watching, setWatching] = useState<string | null>(null);
  const [busyStatus, setBusyStatus] = useState<ContentStatus | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
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
  const labelOf = useCallback((path: string) => byPath.get(path)?.file_name ?? path.split('/').pop() ?? path, [byPath]);
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
  const usedPaths = useMemo(
    () =>
      [
        ...new Set([
          ...project.plan.clips.map((c) => c.path),
          ...(project.plan.music ? [project.plan.music.path] : []),
          ...(project.plan.cover?.type === 'photo' ? [project.plan.cover.path] : []),
        ]),
      ].sort(),
    [project.plan.clips, project.plan.music, project.plan.cover],
  );
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
  const request = useRequestReel(brand.id);
  const saveReel = useSaveReelVersion(brand.id);
  const mutations = useContentMutations(org.id, brand.id);

  const problems = projectProblems(project, template, { fileSeconds: fileSecondsOf });
  const warnings = previewWarnings(project.plan, template, {
    loadedFamilies: fontFaces.families,
    brandReelFont: Boolean(reelFont.data),
    mimeOf: (path) => byPath.get(path)?.mime_type ?? null,
  });
  const render = renderOfVersion(jobs.data ?? [], expectedVersion);
  const rendering = (jobs.data ?? []).some((j) => isActive(j) && jobContentVersion(j) === expectedVersion);

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

  const apply: Apply = useCallback((change, merge) => dispatch({ type: 'change', change, merge }), []);
  const select = useCallback((next: Selection) => {
    dispatch({ type: 'select', selection: next });
    setPanel(null);
  }, []);
  const commit = useCallback(() => dispatch({ type: 'commit' }), []);

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
      toast.info('Para dividir, lleva el cabezal dentro del clip, a más de medio segundo de sus extremos.');
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
        toast.info(`«${leaving.current.title}» queda guardado como borrador: al volver estará como lo has dejado.`);
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

  async function save(note: string): Promise<number | null> {
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
      toast.success(`Versión ${row.version} guardada.`);
      return row.version;
    } catch (error) {
      toast.error(
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
      toast.success(statusChangedMessage(to));
    } catch (error) {
      toast.error(translateError(error));
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
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: pieceJobKeys(brand.id, item.id) });
          toast.success(
            'Montaje encargado. Aquí verás cómo avanza; el vídeo llegará a la biblioteca (carpeta «Reels»).',
          );
        },
        onError: (error) => toast.error(translateError(error)),
      },
    );
  }

  /** Un solo botón: si hay cambios los guarda como versión nueva y después monta. */
  async function saveAndRender() {
    if (problems.length > 0 || rendering) return;
    let version = expectedVersion;
    if (dirty || version === 0) {
      const saved = await save('Antes de montar el vídeo');
      if (saved === null) return;
      version = saved;
    }
    renderVideo(version);
  }

  async function rename(title: string) {
    try {
      await mutations.update.mutateAsync({ contentId: item.id, title });
      setRenameOpen(false);
      toast.success('Nombre cambiado');
    } catch (error) {
      toast.error(translateError(error));
    }
  }

  function toggleArchive() {
    const archived = !item.archived_at;
    mutations.archive.mutateAsync({ contentId: item.id, archived }).then(
      () => {
        setConfirmArchive(false);
        toast.success(archived ? 'Contenido archivado' : 'Contenido recuperado');
      },
      (error: unknown) => {
        setConfirmArchive(false);
        toast.error(translateError(error));
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
      toast.success(`Versión ${versionNumber} restaurada como versión ${row.version}.`);
    } catch (error) {
      toast.error(translateError(error));
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
      apply((p) => replaceClip(p, id, assets[0]!, template));
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
      toast.success(
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
    setTemplateOpen(false);
    seek(0);
    const music = chosen.template.music?.suggestion;
    toast.success(
      `Plantilla «${chosen.name}» aplicada. Cambia los textos de muestra por los tuyos.${music ? ` Música que le va: ${music}` : ''}`,
    );
  };

  const actions = statusActions(item, { edit: canEdit, approve: canApprove });
  const canPublish =
    publishingOn &&
    canEdit &&
    !item.archived_at &&
    item.status === 'approved' &&
    PUBLISHABLE_TARGETS.has(`${item.network}:${item.format}`);
  const empty = project.plan.clips.length === 0;

  // ── Cabecera: una acción principal; lo demás, en «⋯» ──
  const primary = editorPrimaryAction(item, actions, { edit: canEdit, publishNow: canPublish, schedule: false });
  const statusBlocked = (action: StatusAction) =>
    dirty
      ? 'Guarda antes la versión'
      : action.needsVersion && expectedVersion === 0
        ? 'Hace falta guardar una versión antes'
        : undefined;
  const FORWARD = new Set<ContentStatus>(['in_review', 'approved']);
  const primaryStatus = primary?.kind === 'status' ? primary.action.to : null;
  const statusItem = (action: StatusAction) => ({
    id: `status-${action.to}`,
    label: action.label,
    icon: FORWARD.has(action.to) ? SendHorizontal : Undo2,
    onSelect: () => void changeStatus(action.to),
    disabled: Boolean(statusBlocked(action)) || busyStatus !== null,
    hint: statusBlocked(action),
    testId: `reel-status-${action.to}`,
  });
  const moreActions: MoreMenuItem[] = [
    {
      id: 'history',
      label: 'Historial',
      icon: History,
      onSelect: () => setHistoryOpen(true),
      disabled: item.current_version === 0,
      testId: 'reel-history',
    },
    null,
    ...actions.filter((a) => a.to !== primaryStatus && FORWARD.has(a.to)).map(statusItem),
    ...(canPublish && primary?.kind !== 'publishNow'
      ? [
          {
            id: 'publish-now',
            label: 'Publicar ahora',
            icon: Send,
            onSelect: () => setPublishOpen(true),
            disabled: !render,
            hint: render ? undefined : 'Monta antes el vídeo de esta versión',
            testId: 'reel-publish-now',
          },
        ]
      : []),
    null,
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
    ...actions.filter((a) => a.to !== primaryStatus && !FORWARD.has(a.to)).map(statusItem),
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
  const primaryButton = (() => {
    if (!primary) return null;
    if (primary.kind === 'restore')
      return (
        <Button size="sm" onClick={toggleArchive} loading={mutations.archive.isPending} data-testid="reel-restore">
          <ArchiveRestore className="h-4 w-4" aria-hidden />
          Recuperar
        </Button>
      );
    if (primary.kind === 'publishNow')
      return (
        <Button
          size="sm"
          onClick={() => setPublishOpen(true)}
          disabled={!render}
          title={render ? undefined : 'Monta antes el vídeo de esta versión'}
          data-testid="reel-publish-now"
        >
          <Send className="h-4 w-4" aria-hidden />
          Publicar ahora
        </Button>
      );
    if (primary.kind === 'status') {
      const { action } = primary;
      return (
        <Button
          size="sm"
          onClick={() => void changeStatus(action.to)}
          disabled={Boolean(statusBlocked(action)) || busyStatus !== null}
          loading={busyStatus === action.to}
          title={statusBlocked(action)}
          data-testid={`reel-status-${action.to}`}
        >
          {action.to === 'approved' ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <SendHorizontal className="h-4 w-4" aria-hidden />
          )}
          {action.label}
        </Button>
      );
    }
    return null;
  })();

  // ── Estado del montaje de la versión que se ve ──
  const versionJob = (jobs.data ?? []).find((j) => jobContentVersion(j) === expectedVersion && expectedVersion > 0);
  const versionView = versionJob ? describeJob(versionJob) : null;
  const renderBlockedBy = empty
    ? 'Añade fotos o clips.'
    : problems.length > 0
      ? 'Arregla antes lo que se marca en «Avisos».'
      : null;

  // ── Barra de herramientas: lo que se puede hacer con lo elegido ──
  const kind = barKind(project, selection);
  const hasRenders = worker && (jobs.data ?? []).length > 0;
  const bar = contextActions({
    project,
    selection,
    readOnly,
    canSplit: true,
    hasBrandTemplates: (brandTemplates.data ?? []).length > 0,
    hasRenders,
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
        setStyleOpen(true);
        return;
      case 'template':
        setTemplateOpen(true);
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

  const autosaveText =
    autosave.state === 'clean'
      ? expectedVersion > 0 || !empty
        ? 'Guardado'
        : ''
      : autosave.state === 'saved'
        ? 'Borrador guardado'
        : AUTOSAVE_LABEL[autosave.state];

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col gap-2" data-testid="reel-editor">
      {/* ── Cabecera ── */}
      <header className="flex shrink-0 items-center gap-2">
        <Link
          to={paths.list}
          className="flex h-9 shrink-0 items-center gap-1 rounded-lg pr-1 text-sm text-muted hover:text-fg"
          aria-label="Volver a Contenidos"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
          <span className="max-lg:hidden">Contenidos</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold lg:text-xl">{item.title}</h1>
        <div className="flex shrink-0 items-center gap-2" data-testid="page-actions">
          {!readOnly && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSaveOpen(true)}
              disabled={!dirty || empty}
              title="Guardar una versión (para enviarla a revisión, aprobarla o montarla)"
              data-testid="reel-save"
            >
              <Save className="h-4 w-4" aria-hidden />
              <span className="max-sm:sr-only">Guardar versión</span>
            </Button>
          )}
          {primaryButton}
          <MoreMenu items={moreActions} label="Más acciones del reel" testId="reel-more" size="sm" />
        </div>
      </header>

      {/* ── Estado: guardado, avisos y «Montar el vídeo» siempre a un toque ── */}
      <div className="flex shrink-0 items-center gap-x-3 gap-y-1 text-xs text-muted sm:flex-wrap">
        <Badge tone={STATUS_TONE[item.status]}>
          <span data-testid="reel-status">{STATUS_LABEL[item.status]}</span>
        </Badge>
        {item.archived_at && <Badge tone="warning">Archivado</Badge>}
        <span className="max-sm:sr-only" data-testid="reel-version">
          {expectedVersion > 0 ? `Versión ${expectedVersion}` : 'Sin guardar'}
          {dirty && ' · cambios sin guardar como versión'}
        </span>
        {autosaveOn && autosaveText && (
          <span
            className={cn('inline-flex items-center gap-1', autosave.state === 'error' && 'text-danger')}
            role="status"
            aria-live="polite"
            title={
              autosave.state === 'error'
                ? 'No se ha podido guardar el borrador: se reintenta solo. Revisa la conexión.'
                : 'El montaje se guarda solo mientras editas. «Guardar versión» lo deja en el historial.'
            }
            data-testid="reel-autosave"
            data-state={autosave.state}
          >
            {autosave.state === 'error' ? (
              <CloudOff className="h-3.5 w-3.5" aria-hidden />
            ) : autosave.state === 'pending' || autosave.state === 'saving' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
            )}
            {autosaveText}
          </span>
        )}
        {!empty && (problems.length > 0 || warnings.length > 0) && (
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
              problems.length > 0 ? 'font-medium text-danger' : 'text-warning',
            )}
            onClick={() => {
              dispatch({ type: 'select', selection: null });
              setPanel('warnings');
            }}
            data-testid="reel-notices-chip"
          >
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
            {problems.length > 0 ? problems.length : warnings.length}
            <span className="max-sm:sr-only">
              {problems.length > 0 ? ' por arreglar' : warnings.length === 1 ? ' aviso' : ' avisos'}
            </span>
          </button>
        )}
        {worker && (
          <span className="ml-auto flex min-w-0 shrink-0 items-center gap-2" data-testid="reel-render-panel">
            {rendering ? (
              <span className="flex min-w-0 items-center gap-1" role="status" data-testid="reel-render-state">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                <span className="truncate">
                  {versionView?.label ?? 'Montando'}…
                  <span className="max-sm:sr-only"> Se actualiza solo; puedes seguir editando.</span>
                </span>
              </span>
            ) : versionView?.assetId ? (
              <span className="flex items-center gap-1" data-testid="reel-render-state">
                <Badge tone="success">Listo</Badge>
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => {
                    setPlaying(false);
                    setWatching(versionView.assetId);
                  }}
                  data-testid="reel-render-view"
                >
                  Ver el vídeo
                </button>
              </span>
            ) : versionView?.tone === 'danger' ? (
              <span className="truncate text-danger" role="alert" data-testid="reel-render-state">
                No se pudo montar: {versionView.detail}
              </span>
            ) : (
              <span className="truncate max-sm:sr-only" data-testid="reel-render-state">
                {renderBlockedBy ??
                  (dirty ? 'Al montar se guarda una versión nueva.' : 'Esta versión todavía no se ha montado.')}
              </span>
            )}
            {!readOnly && (
              <Button
                size="sm"
                onClick={() => void saveAndRender()}
                disabled={Boolean(renderBlockedBy) || rendering}
                loading={request.isPending || saveReel.isPending}
                title={renderBlockedBy ?? undefined}
                data-testid="reel-render"
              >
                <Clapperboard className="h-4 w-4" aria-hidden />
                {rendering ? (
                  'Montando…'
                ) : dirty || expectedVersion === 0 ? (
                  <>
                    <span className="max-sm:sr-only">Guardar y montar el vídeo</span>
                    <span className="sm:hidden" aria-hidden>
                      Montar
                    </span>
                  </>
                ) : versionView?.assetId || versionView?.tone === 'danger' ? (
                  'Montar otra vez'
                ) : (
                  'Montar el vídeo'
                )}
              </Button>
            )}
          </span>
        )}
      </div>

      {/* ── Avisos de la pieza (pocas líneas; si hay muchos, se desplazan dentro) ── */}
      <div className="max-h-24 shrink-0 space-y-1 overflow-y-auto empty:hidden">
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
        {!worker && (
          <Notice>
            Puedes montar, previsualizar, guardar y aprobar el reel. El vídeo final lo monta el trabajador de medios, que
            no está disponible en este entorno.
          </Notice>
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
          {!readOnly && !project.guide && (
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
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
            {/* ── Vista previa ── */}
            <div className="flex min-h-0 flex-col" data-reel-keys>
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
                extra={
                  !readOnly && (
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
                  )
                }
              />
            </div>

            {/* ── Panel: al lado en escritorio; en móvil, una hoja que sube al pedir una herramienta ── */}
            <aside
              ref={asideRef}
              aria-label="Propiedades"
              className={cn(
                'min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-3',
                'max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:max-h-[58%] max-lg:rounded-b-none max-lg:shadow-pop',
                panel === null && 'max-lg:hidden',
              )}
              data-testid="reel-panel"
              data-open={panel !== null}
            >
              <div className="mb-2 flex items-center justify-between gap-2 lg:hidden">
                <span className="text-sm font-semibold">Ajustes</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPanel(null)}
                  aria-label="Cerrar los ajustes"
                  data-testid="reel-panel-close"
                >
                  <X className="h-4 w-4" aria-hidden />
                  Listo
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
                <div className="space-y-3">
                  {project.guide && (
                    <PanelSection name="guide" active={panel}>
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
                    </PanelSection>
                  )}
                  <PanelSection name="warnings" active={panel}>
                    <h2 className="text-sm font-semibold">Avisos</h2>
                    {problems.length > 0 && (
                      <ul className="space-y-1 text-sm text-danger" data-testid="reel-problems">
                        {problems.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    )}
                    {warnings.length > 0 && (
                      <div data-testid="reel-preview-warnings">
                        <p className="text-xs font-medium">Se verá distinto en el vídeo:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
                          {warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-muted" data-testid="reel-limits">
                      {timeline.total > template.timing.maxTotalSeconds
                        ? `Dura ${fmt(timeline.total)} s; el estilo «${template.name}» está pensado para hasta ${fmt(template.timing.maxTotalSeconds)} s. El máximo es ${REEL_MAX_SECONDS} s.`
                        : `Máximo ${REEL_MAX_SECONDS} s; el estilo «${template.name}» va bien hasta ${fmt(template.timing.maxTotalSeconds)} s.`}
                    </p>
                  </PanelSection>
                  <PanelSection name="cover" active={panel}>
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
                  </PanelSection>
                  {hasRenders && (
                    <PanelSection name="renders" active={panel}>
                      <h2 className="text-sm font-semibold">Montajes</h2>
                      <ul className="divide-y divide-border" data-testid="reel-piece-jobs">
                        {(jobs.data ?? []).map((job) => {
                          const view = describeJob(job);
                          return (
                            <li
                              key={job.id}
                              className="flex flex-wrap items-center gap-2 py-2 text-sm"
                              data-testid="reel-piece-job"
                            >
                              <span>Versión {jobContentVersion(job) ?? '?'}</span>
                              <Badge
                                tone={
                                  view.tone === 'success'
                                    ? 'success'
                                    : view.tone === 'danger'
                                      ? 'danger'
                                      : view.tone === 'progress'
                                        ? 'primary'
                                        : 'neutral'
                                }
                              >
                                {view.label}
                              </Badge>
                              <span className="text-xs text-muted">{formatDateTime(job.created_at)}</span>
                              {view.detail && <span className="w-full text-xs text-danger">{view.detail}</span>}
                              {view.assetId && (
                                <button
                                  type="button"
                                  className="font-medium text-primary hover:underline"
                                  onClick={() => {
                                    setPlaying(false);
                                    setWatching(view.assetId);
                                  }}
                                >
                                  Ver el vídeo
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </PanelSection>
                  )}
                  <div className="space-y-1 border-t border-border pt-3 text-xs text-muted max-lg:hidden" data-testid="reel-inspector-empty">
                    <p>Elige un elemento de la línea de tiempo para cambiarlo.</p>
                    <p>
                      Atajos: Espacio reproduce · S divide en el cabezal · Supr borra · ← → un fotograma (Mayús, un
                      segundo) · Ctrl+Z / Ctrl+Y deshacen y rehacen · Ctrl+D duplica · Ctrl + rueda amplía la línea.
                    </p>
                  </div>
                </div>
              )}
            </aside>
          </div>

          {/* ── Barra de herramientas: cambia con lo elegido (en móvil, abajo del todo) ── */}
          <div className="flex shrink-0 items-center gap-3 max-lg:order-last">
            <div className="min-w-0 flex-1">
              <ContextBar
                kind={kind}
                actions={bar}
                activePanel={panel}
                onAction={onBar}
                onBack={() => select(null)}
              />
            </div>
            {/* Duración y zoom de la línea de tiempo (en móvil, la duración está en el reloj y el zoom es el pellizco). */}
            <div className="flex shrink-0 items-center gap-2 text-xs max-lg:hidden">
              <span className="text-right text-muted">
                <span className="block" data-testid="reel-duration">
                  {fmt(timeline.total)} s de {REEL_MAX_SECONDS} s como máximo
                </span>
                <span className="block max-xl:hidden">Estilo: {template.name}</span>
              </span>
              <span className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
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
                  aria-label="Acercar la línea de tiempo"
                  disabled={pps >= ZOOM.max}
                  onClick={() => setPps((z) => clampZoom(z * ZOOM_STEP))}
                  data-testid="reel-zoom-in"
                >
                  <ZoomIn className="h-4 w-4" aria-hidden />
                </Button>
              </span>
            </div>
          </div>

          {/* ── Línea de tiempo ── */}
          <div className="shrink-0" data-reel-keys>
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
        open={styleOpen}
        onOpenChange={setStyleOpen}
        title="Estilo del reel"
        description="Cambia el ritmo, las transiciones y el estilo del texto. Pone de nuevo la duración de las fotos y las transiciones del estilo; no toca el orden, los recortes ni lo que escribiste."
        size="lg"
      >
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
      </Dialog>
      <Dialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        title="Plantillas de reel de la marca"
        description="Reparte las fotos y los clips que ya tiene el reel, en su orden, en los planos de la plantilla: con sus duraciones, sus transiciones y sus textos de muestra (sustituyen a los textos de ahora). La música se conserva. Se puede deshacer."
        size="lg"
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {(brandTemplates.data ?? []).map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="h-full w-full rounded-xl border border-border p-3 text-left hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
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
      {watching && (
        <RenderViewer
          brandId={brand.id}
          assetId={watching}
          libraryPath={`/o/${org.id}/m/${brand.id}/biblioteca?recurso=${watching}`}
          onClose={() => setWatching(null)}
          onPublish={
            canPublish && watching === render
              ? () => {
                  setWatching(null);
                  setPublishOpen(true);
                }
              : undefined
          }
        />
      )}
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
        canRestore={!readOnly}
        restoring={mutations.restore.isPending}
        onRestore={(v) => void restore(v)}
      />
      {canPublish && render && (
        <PublishNowDialog
          brandId={brand.id}
          open={publishOpen}
          onOpenChange={setPublishOpen}
          contentId={item.id}
          assetIds={[render]}
          editorPath={paths.item(item.id)}
        />
      )}
    </div>
  );
}

/** Un bloque del panel general. En la hoja de móvil solo se ve el que se pidió desde la barra. */
function PanelSection({ name, active, children }: { name: string; active: string | null; children: ReactNode }) {
  return (
    <section
      className={cn('space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0', active !== name && 'max-lg:hidden')}
      data-section={name}
    >
      {children}
    </section>
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

/** El vídeo montado, dentro del editor: grande, con descargar, abrir en la biblioteca y publicar. */
function RenderViewer({
  brandId,
  assetId,
  libraryPath,
  onClose,
  onPublish,
}: {
  brandId: string;
  assetId: string;
  libraryPath: string;
  onClose: () => void;
  /** Solo si esta versión se puede publicar ya. */
  onPublish?: () => void;
}) {
  const assets = useAssetsByIds(brandId, [assetId]);
  const asset = assets.data?.[0];
  const signed = useSignedUrls(asset ? [asset.storage_path] : []);
  const url = asset ? signed.data?.get(asset.storage_path) : undefined;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Vídeo montado"
      description={asset?.file_name ?? 'El vídeo de esta versión, tal como ha quedado.'}
      size="lg"
      footer={
        <>
          <Link to={libraryPath} className="mr-auto self-center text-sm text-muted hover:text-fg hover:underline">
            Abrir en la biblioteca
          </Link>
          {url && (
            <a
              href={url}
              download={asset?.file_name ?? 'reel.mp4'}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-subtle"
              data-testid="reel-viewer-download"
            >
              <Download className="h-4 w-4" aria-hidden />
              Descargar
            </a>
          )}
          {onPublish && (
            <Button onClick={onPublish} data-testid="reel-viewer-publish">
              <Send className="h-4 w-4" aria-hidden />
              Publicar ahora
            </Button>
          )}
        </>
      }
    >
      <div className="flex justify-center" data-testid="reel-viewer">
        {assets.isError || signed.isError ? (
          <ErrorState error={assets.error ?? signed.error} />
        ) : url ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="aspect-[9/16] max-h-[62dvh] rounded-xl bg-black"
            aria-label="Vídeo montado del reel"
            data-testid="reel-viewer-video"
          />
        ) : assets.isSuccess && !asset ? (
          <p className="text-sm text-muted">El vídeo ya no está en la biblioteca.</p>
        ) : (
          <Skeleton className="aspect-[9/16] h-[50dvh]" />
        )}
      </div>
    </Dialog>
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
      toast.error('Elige un archivo de audio (MP3, M4A o WAV).');
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
      toast.success(`«${row.file_name}» está en la biblioteca. Confirma la licencia para usarla.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : translateError(error));
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
    </Dialog>
  );
}

function VersionsDialog({
  open,
  onOpenChange,
  brandId,
  contentId,
  current,
  canRestore,
  restoring,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  contentId: string;
  current: number;
  canRestore: boolean;
  restoring: boolean;
  onRestore: (version: number) => void;
}) {
  const versions = useContentVersions(brandId, contentId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Historial de versiones">
      {versions.isPending ? (
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
