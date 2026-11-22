// Editor de reels: una pieza de formato reel cuyas versiones son montajes
// (proyecto con el plan v2). Línea de tiempo, vista previa al momento en el
// navegador, textos y subtítulos, música con su licencia, guardado con
// versiones, aprobación y montaje del vídeo por el trabajador de medios.
import {
  Archive,
  ArchiveRestore,
  Captions,
  CheckCircle2,
  ChevronLeft,
  Clapperboard,
  History,
  Images,
  Music2,
  Palette,
  PencilLine,
  Redo2,
  Save,
  Send,
  SendHorizontal,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  Notice,
  PageHeader,
  Select,
  Skeleton,
  Spinner,
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
import { useSignedUrls } from '@/features/library/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useFeature } from '@/features/platform/integrations/useFeature';
import { PUBLISHABLE_TARGETS } from '@/features/social/calendar';
import { PublishNowDialog } from '@/features/social/PublishNowDialog';
import type { ContentItemRow, ContentStatus, ContentVersionRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { cn, formatDateTime } from '@/lib/utils';
import { useRequestReel, useReelSources, type ReelSourceAsset } from '../api';
import { describeJob, isActive } from '../plan';
import { REEL_TEMPLATES, type ReelTemplateSummary } from '../templates';
import { buildReelFromTemplate, reelTemplateNeeds } from '../reelTemplate';
import {
  jobContentVersion,
  pieceJobKeys,
  renderOfVersion,
  useBrandReelTemplates,
  usePieceJobs,
  useSaveReelVersion,
  type BrandReelTemplate,
} from './api';
import { previewWarnings } from './compose';
import { editorReducer, initEditor, type Selection } from './history';
import { Inspector, type Apply, type BrandFontOption } from './Inspector';
import {
  addClip,
  addText,
  brandTextStyle,
  moveClip,
  setCover,
  moveText,
  newId,
  setMusic,
  startReel,
  trimClip,
  trimText,
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
import { Timeline, ZOOM_LEVELS } from './Timeline';
import { useBeats } from './useBeats';
import { useQueryClient } from '@tanstack/react-query';
import { fillGuideShot } from '../like/draft';
import { GuidePanel } from '../like/GuidePanel';
import { useReelLikeDraft } from '../like/useDraft';

const DEFAULT_TEMPLATE_ID = 'fundido-suave';
const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);
const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

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

export function ReelEditor({ item, version, onReopen }: ReelEditorProps) {
  const [start] = useState(() => startOf(version));
  const [forceNew, setForceNew] = useState(false);
  const { org } = useOrg();
  const { brand } = useBrand();
  const paths = contentPaths(org.id, brand.id);
  // «Hacer un reel como este»: una pieza todavía sin versiones puede abrirse con el borrador
  // de un análisis (`?referencia=<id>`).
  const [params] = useSearchParams();
  const referenceId = params.get('referencia');
  const fresh = start.kind === 'empty' && start.previous === 'none';
  const like = useReelLikeDraft(brand.id, fresh && referenceId ? referenceId : null);

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
  if (like.loading) {
    return (
      <div className="space-y-4" data-testid="reel-like-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const initial =
    start.kind === 'project' ? start.project : (like.draft?.project ?? emptyProject(defaultTemplate()));
  return (
    <Editor
      item={item}
      initial={initial}
      previousDesign={start.kind === 'empty' && start.previous === 'design'}
      onReopen={onReopen}
      likeDraft={
        like.draft
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
  initial,
  previousDesign,
  onReopen,
  likeDraft,
}: {
  item: ContentItemRow;
  initial: ReelProject;
  previousDesign: boolean;
  onReopen: () => void;
  /** El proyecto de partida es un borrador de «Hacer un reel como este» (aún sin guardar), o no se pudo leer. */
  likeDraft?: { notes: string[]; filled: number; gaps: number } | 'missing';
}) {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const queryClient = useQueryClient();
  const paths = contentPaths(org.id, brand.id);
  const canEdit = can('edit');
  const canApprove = can('approve');
  const readOnly = !canEdit || Boolean(item.archived_at);
  const [state, dispatch] = useReducer(editorReducer, initial, initEditor);
  const { project, selection } = state;
  // Un borrador recién montado todavía no está guardado: cuenta como cambios sin guardar.
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(likeDraft && likeDraft !== 'missing' ? emptyProject(defaultTemplate()) : initial),
  );
  const [expectedVersion, setExpectedVersion] = useState(item.current_version);
  const dirty = JSON.stringify(project) !== baseline;
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(2);
  const [saveOpen, setSaveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [busyStatus, setBusyStatus] = useState<ContentStatus | null>(null);
  const [styleOpen, setStyleOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  /** Texto de apertura escrito en la pantalla de salida, para ponerlo al elegir las fotos. */
  const [openingText, setOpeningText] = useState('');
  /** Plantilla de reel elegida en la pantalla de salida: el selector pide el material de sus planos. */
  const [startTemplate, setStartTemplate] = useState<BrandReelTemplate | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const apply: Apply = useCallback((change, merge) => dispatch({ type: 'change', change, merge }), []);
  const select = useCallback((next: Selection) => dispatch({ type: 'select', selection: next }), []);

  // Teclado: deshacer y rehacer, y espacio para reproducir (fuera de los campos).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      } else if (event.key === ' ' && rootRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const seek = useCallback(
    (seconds: number) => {
      setPlaying(false);
      setPlayhead(Math.max(0, Math.min(seconds, timeline.total)));
    },
    [timeline.total],
  );

  async function save(note: string): Promise<number | null> {
    try {
      const row = await saveReel.mutateAsync({ contentId: item.id, project, note, expectedVersion });
      setExpectedVersion(row.version);
      setBaseline(JSON.stringify(project));
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
        setBaseline(JSON.stringify(restored));
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

  // El identificador del elemento nuevo se calcula antes, para elegirlo en el mismo paso.
  const takenIds = () => [...project.plan.clips.map((c) => c.id), ...project.plan.texts.map((t) => t.id)];
  const newTextStyle = () => {
    const defaultFont = fonts.find((f) => reelFont.data && f.family === reelFont.data.family);
    return brandTextStyle(template, {
      fontPath: defaultFont?.path,
      fontFamily: defaultFont?.family,
      color: palette[0]?.hex,
    });
  };
  /** Aspecto de la marca para los textos del guion (tipografía del reel y color principal). */
  const guideLook = () => {
    const defaultFont = fonts.find((f) => reelFont.data && f.family === reelFont.data.family);
    return {
      colors: palette.map((c) => c.hex),
      ...(defaultFont ? { font: { path: defaultFont.path, family: defaultFont.family } } : {}),
    };
  };
  /** Las piezas elegidas entran en el orden de la elección; en un reel vacío, con el estilo y el texto de partida. */
  const addMedia = (assets: ReelSourceAsset[]) => {
    if (assets.length === 0) return;
    if (project.plan.clips.length === 0 && startTemplate) {
      // Con una plantilla: cada pieza ocupa un plano, con su duración, su movimiento y sus textos de muestra.
      const chosen = startTemplate;
      const style = REEL_TEMPLATES.find((t) => t.id === chosen.template.style.id) ?? template;
      const font = fonts.find((f) => reelFont.data && f.family === reelFont.data.family);
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
      change: (p) => addText(p, template, playhead, newTextStyle(), timeline.total),
      select: { kind: 'text', id: newId('t', takenIds()) },
    });
  };

  const actions = statusActions(item, { edit: canEdit, approve: canApprove });
  const canPublish =
    publishingOn &&
    canEdit &&
    !item.archived_at &&
    item.status === 'approved' &&
    PUBLISHABLE_TARGETS.has(`${item.network}:${item.format}`);
  const pps = ZOOM_LEVELS[zoom]!;
  const empty = project.plan.clips.length === 0;

  // ── Cabecera: una acción principal; lo demás, en «⋯» ──
  const primary = editorPrimaryAction(item, actions, { edit: canEdit, publishNow: canPublish, schedule: false });
  const statusBlocked = (action: StatusAction) =>
    dirty
      ? 'Guarda los cambios antes'
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
      ? 'Arregla antes lo que se marca en rojo bajo la línea de tiempo.'
      : null;

  return (
    <div ref={rootRef} className="space-y-4" data-testid="reel-editor">
      <PageHeader
        compact
        back={
          <Link to={paths.list} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Contenidos
          </Link>
        }
        title={item.title}
        meta={
          <>
            <Badge tone={STATUS_TONE[item.status]}>
              <span data-testid="reel-status">{STATUS_LABEL[item.status]}</span>
            </Badge>
            {item.archived_at && <Badge tone="warning">Archivado</Badge>}
            <span data-testid="reel-version">
              {expectedVersion > 0 ? `Versión ${expectedVersion}` : 'Sin guardar'}
              {dirty ? ' · cambios sin guardar' : ''}
            </span>
          </>
        }
        secondary={
          !readOnly && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSaveOpen(true)}
              disabled={!dirty || empty}
              data-testid="reel-save"
            >
              <Save className="h-4 w-4" aria-hidden />
              Guardar<span className="max-sm:sr-only"> versión</span>
            </Button>
          )
        }
        action={primaryButton}
        more={moreActions}
        moreLabel="Más acciones del reel"
        moreTestId="reel-more"
      />

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
      {!worker && (
        <Notice>
          Puedes montar, previsualizar, guardar y aprobar el reel. El vídeo final lo monta el trabajador de medios, que
          no está disponible en este entorno.
        </Notice>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ── Vista previa y estado del montaje ── */}
        <div className="order-1 space-y-3 lg:row-span-2">
          <ReelPlayer
            plan={project.plan}
            timeline={timeline}
            template={template}
            urls={urls}
            defaultFamily={reelFont.data?.family ?? null}
            playhead={playhead}
            playing={playing}
            onTime={setPlayhead}
            onPlayingChange={setPlaying}
            maxSeconds={REEL_MAX_SECONDS}
          />
          {!empty && (
            <Card>
              <CardBody>
                <CoverPicker
                  plan={project.plan}
                  playhead={playhead}
                  total={timeline.total}
                  readOnly={readOnly}
                  urlOf={(path) => urls.get(path)}
                  labelOf={labelOf}
                  onChange={(cover) => apply((p) => setCover(p, cover))}
                  onSeek={seek}
                />
              </CardBody>
            </Card>
          )}
          <p className="text-center text-xs text-muted" data-testid="reel-limits">
            {timeline.total > template.timing.maxTotalSeconds
              ? `Dura ${fmt(timeline.total)} s; este estilo está pensado para hasta ${fmt(template.timing.maxTotalSeconds)} s. El máximo es ${REEL_MAX_SECONDS} s.`
              : `Máximo ${REEL_MAX_SECONDS} s; este estilo va bien hasta ${fmt(template.timing.maxTotalSeconds)} s.`}
          </p>
          {warnings.length > 0 && !empty && (
            <div data-testid="reel-preview-warnings">
              <Notice tone="warning">
                <span className="font-medium">Se verá distinto en el vídeo:</span>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Notice>
            </div>
          )}
          {worker && (
            <Card>
              <CardBody className="space-y-2" data-testid="reel-render-panel">
                <h2 className="text-sm font-semibold">Vídeo final</h2>
                {rendering ? (
                  <div className="flex items-center gap-2 text-sm" role="status" data-testid="reel-render-state">
                    <Spinner label="Montando" />
                    <span>{versionView?.label ?? 'Montando'}… Se actualiza solo; puedes seguir editando.</span>
                  </div>
                ) : versionView?.assetId ? (
                  <p className="text-sm" data-testid="reel-render-state">
                    <Badge tone="success">Listo</Badge>{' '}
                    <Link
                      to={`/o/${org.id}/m/${brand.id}/biblioteca?recurso=${versionView.assetId}`}
                      className="font-medium text-primary hover:underline"
                      data-testid="reel-render-view"
                    >
                      Ver el vídeo
                    </Link>
                  </p>
                ) : versionView?.tone === 'danger' ? (
                  <p className="text-sm text-danger" role="alert" data-testid="reel-render-state">
                    No se pudo montar: {versionView.detail}
                  </p>
                ) : (
                  <p className="text-sm text-muted" data-testid="reel-render-state">
                    {dirty
                      ? 'Hay cambios sin guardar. Al montar se guardan como versión nueva.'
                      : 'Todavía no se ha montado esta versión.'}
                  </p>
                )}
                {!readOnly && (
                  <>
                    <Button
                      className="w-full"
                      onClick={() => void saveAndRender()}
                      disabled={Boolean(renderBlockedBy) || rendering}
                      loading={request.isPending || saveReel.isPending}
                      data-testid="reel-render"
                    >
                      <Clapperboard className="h-4 w-4" aria-hidden />
                      {rendering
                        ? 'Montando…'
                        : dirty || expectedVersion === 0
                          ? 'Guardar y montar el vídeo'
                          : versionView?.assetId || versionView?.tone === 'danger'
                            ? 'Montar otra vez'
                            : 'Montar el vídeo'}
                    </Button>
                    {renderBlockedBy && <p className="text-xs text-muted">{renderBlockedBy}</p>}
                  </>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Añadir ── */}
        <div className="order-2 space-y-3">
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
          {empty ? (
            !readOnly &&
            !project.guide && (
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
                  setMediaOpen(true);
                }}
                brandTemplates={brandTemplates.data ?? []}
                onBrandTemplate={(chosen) => {
                  setStartTemplate(chosen);
                  setMediaOpen(true);
                }}
              />
            )
          ) : (
            <>
              {!readOnly && (
                <div className="grid grid-cols-5 gap-2" data-testid="reel-toolbar">
                  {[
                    {
                      id: 'reel-add-media',
                      icon: Images,
                      label: 'Fotos y clips',
                      onClick: () => setMediaOpen(true),
                      disabled: project.plan.clips.length >= REEL_MAX_CLIPS,
                    },
                    { id: 'reel-add-text', icon: Type, label: 'Texto', onClick: newText, disabled: false },
                    {
                      id: 'reel-add-music',
                      icon: Music2,
                      label: 'Música',
                      onClick: () => (project.plan.music ? select({ kind: 'music' }) : setMusicOpen(true)),
                      disabled: false,
                    },
                    {
                      id: 'reel-subtitles',
                      icon: Captions,
                      label: 'Subtítulos',
                      onClick: () => select({ kind: 'subtitles' }),
                      disabled: false,
                    },
                    {
                      id: 'reel-template',
                      icon: Palette,
                      label: 'Estilo',
                      onClick: () => setStyleOpen(true),
                      disabled: false,
                    },
                  ].map((b) => (
                    <Button
                      key={b.id}
                      variant="secondary"
                      className="h-auto min-w-0 flex-col gap-1 px-1 py-2 text-xs"
                      onClick={b.onClick}
                      disabled={b.disabled}
                      data-testid={b.id}
                    >
                      <b.icon className="h-5 w-5" aria-hidden />
                      <span className="max-w-full truncate">{b.label}</span>
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                {!readOnly && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={state.past.length === 0}
                      onClick={() => dispatch({ type: 'undo' })}
                      data-testid="reel-undo"
                    >
                      <Undo2 className="h-4 w-4" aria-hidden />
                      Deshacer
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={state.future.length === 0}
                      onClick={() => dispatch({ type: 'redo' })}
                      data-testid="reel-redo"
                    >
                      <Redo2 className="h-4 w-4" aria-hidden />
                      Rehacer
                    </Button>
                  </>
                )}
                <span className="ml-auto text-xs text-muted">Estilo: {template.name}</span>
              </div>
            </>
          )}
        </div>

        {/* ── Propiedades del elemento elegido ── */}
        {!empty && (
          <div className="order-4 lg:order-3">
            <Card>
              <CardBody>
                <Inspector
                  project={project}
                  selection={selection}
                  template={template}
                  readOnly={readOnly}
                  apply={apply}
                  onSelect={select}
                  labelOf={labelOf}
                  fileSecondsOf={fileSecondsOf}
                  urlOf={(path) => urls.get(path)}
                  palette={palette}
                  fonts={fonts}
                  autoSubtitles={autoSubtitles}
                  brandId={brand.id}
                  beats={beats}
                  onPlayFrom={(seconds) => {
                    setPlayhead(Math.max(0, seconds));
                    setPlaying(true);
                  }}
                />
              </CardBody>
            </Card>
          </div>
        )}

        {/* ── Línea de tiempo ── */}
        {!empty && (
          <div className="order-3 space-y-2 lg:order-4 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Línea de tiempo</span>
              <span className="text-muted" data-testid="reel-duration">
                {fmt(timeline.total)} s de {REEL_MAX_SECONDS} s como máximo
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Alejar la línea de tiempo"
                  disabled={zoom === 0}
                  onClick={() => setZoom((z) => z - 1)}
                >
                  <ZoomOut className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Acercar la línea de tiempo"
                  disabled={zoom === ZOOM_LEVELS.length - 1}
                  onClick={() => setZoom((z) => z + 1)}
                  data-testid="reel-zoom-in"
                >
                  <ZoomIn className="h-4 w-4" aria-hidden />
                </Button>
              </span>
            </div>
            <Timeline
              plan={project.plan}
              timeline={timeline}
              pxPerSecond={pps}
              playhead={playhead}
              selection={selection}
              readOnly={readOnly}
              labelOf={labelOf}
              fileSecondsOf={fileSecondsOf}
              onSeek={seek}
              onSelect={select}
              onMoveClip={(from, to) => apply((p) => moveClip(p, from, to))}
              onTrimClip={(id, edge, value, key) => {
                const clip = project.plan.clips.find((c) => c.id === id);
                apply((p) => trimClip(p, id, edge, value, clip ? fileSecondsOf(clip.path) : null), key);
              }}
              onMoveText={(id, value, key) => apply((p) => moveText(p, id, value), key)}
              onTrimText={(id, edge, value, key) => apply((p) => trimText(p, id, edge, value), key)}
              onDragEnd={() => dispatch({ type: 'commit' })}
              beats={beatTimes}
            />
            {problems.length > 0 && (
              <ul className="space-y-1 text-sm text-danger" data-testid="reel-problems">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Montajes de la pieza ── */}
      {worker && (jobs.data ?? []).length > 0 && (
        <Card>
          <CardBody className="space-y-2">
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
                      <Link
                        to={`/o/${org.id}/m/${brand.id}/biblioteca?recurso=${view.assetId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        Ver el vídeo
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}

      <SaveVersionDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        saving={saveReel.isPending}
        issues={[]}
        onSave={(note) => void save(note)}
      />
      {mediaOpen && (
        <MediaPicker
          open={mediaOpen}
          onOpenChange={(open) => {
            setMediaOpen(open);
            if (!open) setStartTemplate(null);
          }}
          sources={(sources.data ?? []).filter((a) => a.kind === 'image' || a.kind === 'video')}
          loading={sources.isPending}
          error={sources.error}
          room={
            empty && startTemplate
              ? reelTemplateNeeds(startTemplate.template).max
              : REEL_MAX_CLIPS - project.plan.clips.length
          }
          {...(empty && startTemplate
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
            empty
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
        audios={(sources.data ?? []).filter((a) => a.kind === 'audio')}
        onPick={(asset, note) => {
          apply((p) => setMusic(p, asset.storage_path, template, note));
          select({ kind: 'music' });
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

/** Elegir la música: aviso de licencia y confirmación obligatoria, que queda en el plan y en la procedencia. */
function MusicPicker({
  open,
  onOpenChange,
  audios,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audios: ReelSourceAsset[];
  onPick: (asset: ReelSourceAsset, note: string) => void;
}) {
  const [choice, setChoice] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const asset = audios.find((a) => a.id === choice);
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
      description="Una pista de audio de la biblioteca de la marca."
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
      {audios.length === 0 ? (
        <p className="text-sm text-muted">No hay audios en la biblioteca. Sube primero la pista.</p>
      ) : (
        <div className="space-y-3">
          <Select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Pista"
            data-testid="reel-music-choice"
          >
            <option value="">Elige una pista</option>
            {audios.map((a) => (
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
