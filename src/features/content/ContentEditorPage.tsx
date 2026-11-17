import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Circle,
  History,
  Image as ImageIcon,
  Redo2,
  Save,
  SearchX,
  Square,
  Stamp,
  Type,
  Undo2,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Notice,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { aiTextEnabled } from '@/config/app';
import { AiBrandCheck } from '@/features/ai/AiBrandCheck';
import { GenerateCaptionDialog } from '@/features/ai/GenerateCaptionDialog';
import { useActiveProfile } from '@/features/brand/api';
import { publishedText } from '@/features/brandcheck/text';
import type { FindingTarget } from '@/features/brandcheck/types';
import { parseProfile } from '@/features/brand/profile';
import { useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import type { ContentStatus } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import {
  fetchContent,
  isVersionConflict,
  useContent,
  useContentMutations,
  type LoadedContent,
  type LoadedVersion,
} from './api';
import { createEmptyDocument, DocumentError, MAX_LAYERS, type ContentDocument, type DocumentIssue } from './document';
import { ImagePickerDialog, LogoPickerDialog } from './editor/AssetPickerDialog';
import { BRAND_CHECK_PANEL } from './editor/brandCheckSlot';
import { assetIdsOf } from './editor/canvas/nodes';
import type { CanvasViewProps } from './editor/canvas/types';
import { editorReducer, initEditor } from './editor/history';
import { newImageLayer, newLogoLayer, newShapeLayer, newTextLayer } from './editor/layers';
import { CopyPanel } from './editor/panels/CopyPanel';
import { LayersPanel } from './editor/panels/LayersPanel';
import { PropertiesPanel, type BrandStyle } from './editor/panels/PropertiesPanel';
import { SaveVersionDialog } from './editor/SaveVersionDialog';
import { imageUrlOf, mainImageLayer, useImagePalette } from './editor/useImagePalette';
import { VersionsDialog } from './editor/VersionsDialog';
import { contentPaths, networkLabel, targetLabel } from './labels';
import { allowedCanvasRatios, getFormatSpec, recommendedCanvasRatio, type NetworkFormatSpec } from './networks';
import { STATUS_LABEL, STATUS_TONE, statusActions, statusChangedMessage } from './status';

// El lienzo (y Konva con él) se descarga aparte, solo al abrir el editor.
const CanvasView = lazy(() => import('./editor/canvas/KonvaCanvas'));

/** Documento de partida de una idea sin diseño: la proporción que recomienda la red, si es una de las del lienzo. */
function startingDocument(spec: NetworkFormatSpec | undefined): ContentDocument {
  const media = spec?.media.includes('image') ? 'image' : spec?.media[0];
  const recommended = spec ? recommendedCanvasRatio(spec, media) : null;
  const allowed = spec ? allowedCanvasRatios(spec, media) : null;
  const aspectRatio = recommended?.ratio ?? (allowed?.ratios.includes('1:1') ? '1:1' : allowed?.ratios[0]) ?? '1:1';
  return createEmptyDocument({ aspectRatio });
}

/** Campo del panel «Publicación» al que lleva cada parte del texto señalada por el verificador. */
const COPY_FIELD: Partial<Record<FindingTarget['part'], string>> = {
  caption: 'copy-caption',
  hashtags: 'copy-hashtags',
  mentions: 'copy-mentions',
  altText: 'copy-alt',
};

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

export function ContentEditorPage() {
  const { org } = useOrg();
  const { brand } = useBrand();
  const { contentId = '' } = useParams();
  const content = useContent(brand.id, contentId);
  const paths = contentPaths(org.id, brand.id);
  // Volver a abrir el editor desde cero con los datos ya refrescados (tras restaurar una versión ilegible).
  const [session, setSession] = useState(0);

  if (content.isPending) return <Spinner />;
  if (content.isError) {
    const missing = (content.error as { code?: string } | null)?.code === 'PGRST116';
    return (
      <Card>
        {missing ? (
          <EmptyState
            icon={SearchX}
            title="No encontramos este contenido"
            description="Puede que no exista o que no tengas acceso a él."
            action={
              <Link to={paths.list}>
                <Button>Ver los contenidos</Button>
              </Link>
            }
          />
        ) : (
          <ErrorState error={content.error} onRetry={() => void content.refetch()} />
        )}
      </Card>
    );
  }
  return <Editor key={`${contentId}:${session}`} content={content.data} onReopen={() => setSession((n) => n + 1)} />;
}

/**
 * El editor de una pieza. El documento se toma de `content` solo al montarse:
 * después manda el estado del editor, y los refrescos de la pieza (estado,
 * archivado) no pisan los cambios sin guardar.
 */
function Editor({ content, onReopen }: { content: LoadedContent; onReopen: () => void }) {
  const initial = content;
  const { org } = useOrg();
  const { brand, can, role } = useBrand();
  const navigate = useNavigate();
  const item = content.item;
  const contentId = item.id;
  const paths = contentPaths(org.id, brand.id);
  const brandBase = `/o/${org.id}/m/${brand.id}`;
  const spec = getFormatSpec(item.network, item.format);
  const canEdit = can('edit');
  const canApprove = can('approve');
  const readOnly = !canEdit || Boolean(item.archived_at);
  const mutations = useContentMutations(org.id, brand.id);

  // El documento con el que se abre: la versión vigente o, en una idea sin diseño, uno vacío.
  const [unreadable] = useState(() => (initial.current && !initial.current.document ? initial.current : null));
  const [initialDocument] = useState(() => initial.current?.document ?? startingDocument(spec));
  const [state, dispatch] = useReducer(editorReducer, initialDocument, initEditor);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialDocument));
  /** Versión sobre la que se trabaja: la que se manda como «esperada» al guardar, restaurar o cambiar de estado. */
  const [expectedVersion, setExpectedVersion] = useState(initial.item.current_version);
  const dirty = useMemo(() => JSON.stringify(state.document) !== baseline, [state.document, baseline]);

  const [panel, setPanel] = useState('layer');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveIssues, setSaveIssues] = useState<DocumentIssue[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [imagePicker, setImagePicker] = useState(false);
  const [logoPicker, setLogoPicker] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<LoadedVersion | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busyStatus, setBusyStatus] = useState<ContentStatus | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [focusText, setFocusText] = useState(0);
  /** Campo del texto de la publicación que hay que enfocar (al pulsar un hallazgo del verificador). */
  const [focusCopy, setFocusCopy] = useState<{ field: string; range?: FindingTarget['range']; n: number } | null>(null);
  const aiEnabled = aiTextEnabled();

  const selected = state.document.layers.find((layer) => layer.id === state.selectedId) ?? null;

  // ── Marca: paleta, tipografías y logotipos del perfil ──
  const profileRow = useActiveProfile(brand.id);
  const profile = useMemo(() => (profileRow.data ? parseProfile(profileRow.data.data) : null), [profileRow.data]);
  const brandStyle: BrandStyle = useMemo(
    () => ({
      palette: (profile?.visual.colors ?? []).map((c) => ({ hex: c.hex.toUpperCase(), name: c.name })),
      fonts: (profile?.visual.fonts ?? []).map((f) => f.family),
    }),
    [profile],
  );
  const logoIds = profile?.visual.logoAssetIds ?? [];

  // ── Imágenes del documento: recurso → dirección firmada ──
  const assetIdsKey = assetIdsOf(state.document).join(',');
  const assetIds = useMemo(() => (assetIdsKey ? assetIdsKey.split(',') : []), [assetIdsKey]);
  const assets = useAssetsByIds(brand.id, assetIds);
  const storagePaths = useMemo(() => (assets.data ?? []).map((a) => a.storage_path).sort(), [assets.data]);
  const signed = useSignedUrls(storagePaths);
  const images = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets.data ?? []) {
      const url = signed.data?.get(asset.storage_path);
      if (url) map.set(asset.id, url);
    }
    return map;
  }, [assets.data, signed.data]);

  // Avisar antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // El foco se pone en el siguiente fotograma: si a la vez cambia la pestaña, su
  // contenido se monta después de este efecto.
  useEffect(() => {
    if (!focusText) return;
    const frame = requestAnimationFrame(() => textRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusText]);

  useEffect(() => {
    if (!focusCopy) return;
    const frame = requestAnimationFrame(() => {
      const field = rootRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[data-testid="${focusCopy.field}"]`,
      );
      if (!field) return;
      field.focus();
      if (focusCopy.range) field.setSelectionRange(focusCopy.range.start, focusCopy.range.end);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusCopy]);

  // ── Paleta de la imagen principal, para el verificador ──
  const paletteLayer = mainImageLayer(state.document);
  const palette = useImagePalette(imageUrlOf(paletteLayer, images));

  /** Al pulsar un hallazgo del verificador: elegir la capa o llevar al campo señalado. */
  function selectTarget(target: FindingTarget) {
    if (target.part === 'textLayer' && target.layerId) {
      dispatch({ type: 'select', id: target.layerId });
      setPanel('layer');
      setFocusText((n) => n + 1);
      return;
    }
    if (target.part === 'image' && paletteLayer) {
      dispatch({ type: 'select', id: paletteLayer.id });
      setPanel('layer');
      return;
    }
    const field = COPY_FIELD[target.part];
    if (field) {
      setPanel('copy');
      setFocusCopy((prev) => ({ field, range: target.range, n: (prev?.n ?? 0) + 1 }));
    }
  }

  // ── Lienzo (el envoltorio guarda estas funciones en una referencia: no hace falta memorizarlas) ──
  const onSelect = (id: string | null) => dispatch({ type: 'select', id });
  const onChange: CanvasViewProps['onChange'] = (id, patch) => dispatch({ type: 'update', id, patch });
  const onEditText = (id: string) => {
    dispatch({ type: 'select', id });
    setPanel('layer');
    setFocusText((n) => n + 1);
  };

  // ── Teclado: deshacer, rehacer, guardar y, con una capa elegida, mover, borrar y soltar ──
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Lo que llega desde un diálogo (portal) no es del editor.
    if (!rootRef.current?.contains(event.target as Node)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      if (readOnly) return;
      event.preventDefault();
      dispatch({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (mod && key === 's') {
      event.preventDefault();
      if (!readOnly) setSaveOpen(true);
      return;
    }
    if (isTypingTarget(event.target) || !selected) return;
    if (event.key === 'Escape') {
      dispatch({ type: 'select', id: null });
      return;
    }
    if (readOnly) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && !selected.locked) {
      event.preventDefault();
      dispatch({ type: 'remove', id: selected.id });
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      dispatch({ type: 'nudge', id: selected.id, dx: move[0], dy: move[1] });
    }
  }

  // ── Guardar, restaurar y estados ──
  function handleConflictOr(error: unknown) {
    if (isVersionConflict(error)) {
      setConflict(true);
      toast.error('Otra persona guardó una versión más reciente. Tus cambios siguen aquí.');
    } else {
      toast.error(translateError(error));
    }
  }

  function save(note: string, expected = expectedVersion) {
    const document = state.document;
    setSaveIssues([]);
    return mutations.saveVersion.mutateAsync({ contentId, document, note, expectedVersion: expected }).then(
      (row) => {
        setBaseline(JSON.stringify(document));
        setExpectedVersion(row.version);
        setConflict(false);
        setSaveOpen(false);
        toast.success(`Versión ${row.version} guardada`);
      },
      (error: unknown) => {
        if (error instanceof DocumentError) {
          setSaveIssues(error.issues.length ? error.issues : [{ path: '', message: error.message }]);
          return;
        }
        setSaveOpen(false);
        handleConflictOr(error);
      },
    );
  }

  /** Tras un conflicto: guardar lo mío encima de la última versión (la otra sigue en el historial). */
  async function saveOverLatest() {
    try {
      const fresh = await fetchContent(contentId);
      await save('', fresh.item.current_version);
    } catch (error) {
      toast.error(translateError(error));
    }
  }

  /** Tras un conflicto: descartar lo mío y abrir la última versión guardada. */
  async function loadLatest() {
    try {
      const fresh = await fetchContent(contentId);
      const document = fresh.current?.document ?? startingDocument(spec);
      dispatch({ type: 'load', document });
      setBaseline(JSON.stringify(document));
      setExpectedVersion(fresh.item.current_version);
      setConflict(false);
      toast.success('Abierta la última versión');
    } catch (error) {
      toast.error(translateError(error));
    }
  }

  function restore(version: LoadedVersion) {
    const document = version.document;
    if (!document) return;
    setPendingRestore(null);
    mutations.restore
      .mutateAsync({
        contentId,
        version: version.row.version,
        note: `Restaurada la versión ${version.row.version}`,
        expectedVersion,
      })
      .then(
        (row) => {
          dispatch({ type: 'load', document });
          setBaseline(JSON.stringify(document));
          setExpectedVersion(row.version);
          setHistoryOpen(false);
          toast.success(`Versión ${version.row.version} restaurada como versión ${row.version}`);
        },
        (error: unknown) => {
          setHistoryOpen(false);
          handleConflictOr(error);
        },
      );
  }

  function changeStatus(to: ContentStatus) {
    setBusyStatus(to);
    mutations.setStatus
      .mutateAsync({ contentId, status: to, expectedVersion })
      .then(
        () => toast.success(statusChangedMessage(to)),
        (error: unknown) => handleConflictOr(error),
      )
      .finally(() => setBusyStatus(null));
  }

  function toggleArchive() {
    const archived = !item.archived_at;
    mutations.archive.mutateAsync({ contentId, archived }).then(
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

  function leave(event: MouseEvent<HTMLAnchorElement>) {
    if (!dirty) return;
    event.preventDefault();
    setConfirmLeave(true);
  }

  const canvas = state.document.canvas;
  const full = state.document.layers.length >= MAX_LAYERS;
  const actions = statusActions(item, { edit: canEdit, approve: canApprove });
  const allowed = spec ? allowedCanvasRatios(spec, spec.media.includes('image') ? 'image' : spec.media[0]) : null;
  const BrandCheck = BRAND_CHECK_PANEL;
  const videoOnly = spec !== undefined && !spec.media.includes('image');

  if (unreadable) {
    return (
      <div className="space-y-4">
        <Link to={paths.list} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Contenidos
        </Link>
        <h1 className="text-2xl">{item.title}</h1>
        <Notice tone="warning">
          No se puede abrir la versión vigente: {unreadable.documentError} Puedes restaurar otra desde el historial.
        </Notice>
        <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
          <History className="h-4 w-4" aria-hidden />
          Historial
        </Button>
        <VersionsDialog
          brandId={brand.id}
          contentId={contentId}
          currentVersion={expectedVersion}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          canRestore={canEdit && !item.archived_at}
          restoring={mutations.restore.isPending}
          images={images}
          onRestore={(version) => {
            mutations.restore
              .mutateAsync({ contentId, version: version.row.version, expectedVersion })
              .then(onReopen, handleConflictOr);
          }}
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="flex flex-col gap-3 lg:h-[calc(100dvh-6rem)]">
      {/* Cabecera: dónde estoy, estado y acciones de la pieza */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={paths.list}
            onClick={leave}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
            data-testid="editor-back"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Contenidos
          </Link>
          <h1 className="truncate text-xl" data-testid="editor-title">
            {item.title}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{targetLabel(item.network, item.format)}</span>
            <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
            {item.archived_at && <Badge tone="warning">Archivada</Badge>}
            <span data-testid="editor-version">
              {expectedVersion > 0 ? `Versión ${expectedVersion}` : 'Sin guardar todavía'}
            </span>
            {dirty && (
              <span className="font-medium text-warning" data-testid="editor-dirty">
                · Cambios sin guardar
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)} data-testid="editor-history">
            <History className="h-4 w-4" aria-hidden />
            Historial
          </Button>
          {!readOnly && (
            <Button
              size="sm"
              onClick={() => setSaveOpen(true)}
              disabled={!dirty && expectedVersion > 0}
              data-testid="editor-save"
            >
              <Save className="h-4 w-4" aria-hidden />
              Guardar versión
            </Button>
          )}
          {actions.map((action) => {
            const missingVersion = action.needsVersion && expectedVersion === 0;
            return (
              <Button
                key={action.to}
                variant={action.to === 'approved' ? 'primary' : 'secondary'}
                size="sm"
                disabled={dirty || missingVersion || busyStatus !== null}
                loading={busyStatus === action.to}
                title={
                  dirty
                    ? 'Guarda los cambios antes'
                    : missingVersion
                      ? 'Hace falta guardar una versión antes'
                      : undefined
                }
                onClick={() => changeStatus(action.to)}
                data-testid={`status-${action.to}`}
              >
                {action.label}
              </Button>
            );
          })}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (item.archived_at ? toggleArchive() : setConfirmArchive(true))}
              loading={mutations.archive.isPending}
              data-testid="editor-archive"
            >
              {item.archived_at ? (
                <>
                  <ArchiveRestore className="h-4 w-4" aria-hidden />
                  Recuperar
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" aria-hidden />
                  Archivar
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {conflict && (
        <div
          role="alert"
          className="rounded-lg bg-warning-soft px-3.5 py-3 text-sm text-warning"
          data-testid="editor-conflict"
        >
          <p className="font-medium">Otra persona ha guardado una versión más reciente mientras editabas.</p>
          <p>Tus cambios siguen aquí, sin guardar. Elige qué hacer:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void saveOverLatest()}
              loading={mutations.saveVersion.isPending}
              data-testid="conflict-save-mine"
            >
              Guardar la mía como versión nueva
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void loadLatest()} data-testid="conflict-load-latest">
              Descartar mis cambios y abrir la última
            </Button>
          </div>
          <p className="mt-2 text-xs">
            La versión de la otra persona no se pierde en ningún caso: queda en el historial.
          </p>
        </div>
      )}
      {item.archived_at && (
        <Notice tone="warning">Está archivada: se puede ver, pero no cambiar hasta recuperarla.</Notice>
      )}
      {!canEdit && (
        <Notice>
          {canApprove
            ? 'Puedes revisarla y cambiar su estado, pero no editarla.'
            : `Solo lectura: con tu rol (${role === 'viewer' ? 'solo lectura' : role}) no se puede editar.`}
        </Notice>
      )}
      {videoOnly && (
        <Notice>
          Es un formato de vídeo. Aquí se prepara la imagen (portada o fotograma); el vídeo llegará más adelante.
        </Notice>
      )}

      {/* Barra de herramientas */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Herramientas del editor">
          <span className="mr-1 text-xs font-medium text-muted">Añadir</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={full}
            onClick={() =>
              dispatch({
                type: 'add',
                layer: newTextLayer(canvas, state.document.layers, {
                  fontFamily: brandStyle.fonts[0],
                  color: brandStyle.palette[0]?.hex,
                }),
              })
            }
            data-testid="add-text"
          >
            <Type className="h-4 w-4" aria-hidden />
            Texto
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={full}
            onClick={() => setImagePicker(true)}
            data-testid="add-image"
          >
            <ImageIcon className="h-4 w-4" aria-hidden />
            Imagen
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={full}
            onClick={() => setLogoPicker(true)}
            data-testid="add-logo"
          >
            <Stamp className="h-4 w-4" aria-hidden />
            Logotipo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={full}
            onClick={() =>
              dispatch({
                type: 'add',
                layer: newShapeLayer(canvas, state.document.layers, 'rectangle', brandStyle.palette[1]?.hex),
              })
            }
            data-testid="add-rectangle"
          >
            <Square className="h-4 w-4" aria-hidden />
            Rectángulo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={full}
            onClick={() =>
              dispatch({
                type: 'add',
                layer: newShapeLayer(canvas, state.document.layers, 'ellipse', brandStyle.palette[1]?.hex),
              })
            }
            data-testid="add-ellipse"
          >
            <Circle className="h-4 w-4" aria-hidden />
            Elipse
          </Button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Deshacer"
            title="Deshacer (Ctrl+Z)"
            disabled={state.past.length === 0}
            onClick={() => dispatch({ type: 'undo' })}
            data-testid="undo"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Rehacer"
            title="Rehacer (Ctrl+Mayús+Z)"
            disabled={state.future.length === 0}
            onClick={() => dispatch({ type: 'redo' })}
            data-testid="redo"
          >
            <Redo2 className="h-4 w-4" aria-hidden />
          </Button>
          {full && <span className="text-xs text-muted">Has llegado al máximo de {MAX_LAYERS} capas.</span>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          tabIndex={0}
          aria-label="Lienzo. Con una capa elegida, usa las flechas para moverla y Supr para borrarla."
          className="h-[55dvh] min-h-[16rem] rounded-xl bg-subtle p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:h-auto"
        >
          <Suspense fallback={<Spinner label="Preparando el lienzo…" />}>
            <CanvasView
              document={state.document}
              selectedId={state.selectedId}
              readOnly={readOnly}
              images={images}
              onSelect={onSelect}
              onChange={onChange}
              onEditText={onEditText}
              label={`Diseño de ${item.title}, ${state.document.layers.length} capas`}
            />
          </Suspense>
        </section>

        <aside
          className="min-h-0 overflow-y-auto rounded-xl border border-border bg-surface p-4"
          aria-label="Paneles del editor"
        >
          <Tabs value={panel} onValueChange={setPanel}>
            <TabsList label="Paneles del editor">
              <TabsTrigger value="layer">Diseño</TabsTrigger>
              <TabsTrigger value="layers">Capas ({state.document.layers.length})</TabsTrigger>
              <TabsTrigger value="copy">Publicación</TabsTrigger>
              {BrandCheck && <TabsTrigger value="brand">Marca</TabsTrigger>}
            </TabsList>
            <TabsContent value="layer" className="pt-4">
              <PropertiesPanel
                layer={selected}
                canvas={canvas}
                readOnly={readOnly}
                dispatch={dispatch}
                brandStyle={brandStyle}
                allowedRatios={allowed?.ratios ?? null}
                textRef={textRef}
              />
            </TabsContent>
            <TabsContent value="layers" className="pt-4">
              <LayersPanel
                layers={state.document.layers}
                selectedId={state.selectedId}
                readOnly={readOnly}
                dispatch={dispatch}
              />
            </TabsContent>
            <TabsContent value="copy" className="space-y-4 pt-4">
              {aiEnabled && !readOnly && (
                <GenerateCaptionDialog
                  brandId={brand.id}
                  network={item.network}
                  format={item.format}
                  currentCopy={state.document.copy}
                  // Un solo paso de deshacer: el texto anterior vuelve con Ctrl+Z.
                  onApply={(copy) => {
                    dispatch({ type: 'setCopy', patch: copy });
                    toast.success('Texto aplicado. Puedes deshacerlo con Ctrl+Z.');
                  }}
                />
              )}
              <CopyPanel
                copy={state.document.copy}
                spec={spec}
                networkName={networkLabel(item.network)}
                readOnly={readOnly}
                dispatch={dispatch}
              />
            </TabsContent>
            {BrandCheck && (
              <TabsContent value="brand" className="pt-4">
                <Suspense fallback={<Spinner label="Cargando el verificador…" />}>
                  <BrandCheck
                    document={state.document}
                    network={item.network}
                    format={item.format}
                    brandId={brand.id}
                    imagePalette={palette.status === 'ready' ? palette.palette : undefined}
                    onSelectTarget={selectTarget}
                  />
                </Suspense>
                {palette.status === 'unavailable' && (
                  <div className="mt-3" data-testid="brandcheck-palette-unavailable">
                    <Notice tone="warning">
                      No se han podido leer los colores de la imagen (el navegador no lo permite para este archivo): la
                      comparación con la paleta de la marca se omite.
                    </Notice>
                  </div>
                )}
                {aiEnabled && (
                  <div className="mt-6 space-y-2 border-t border-border pt-4">
                    <h2 className="text-base font-semibold">Tono con IA</h2>
                    <p className="text-xs text-muted">
                      Revisa el tono y los temas vetados del texto de la publicación. Ayuda a revisar; no aprueba.
                    </p>
                    <AiBrandCheck
                      brandId={brand.id}
                      text={publishedText(state.document.copy.caption, state.document.copy.hashtags)}
                    />
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </aside>
      </div>

      <SaveVersionDialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (!open) setSaveIssues([]);
        }}
        saving={mutations.saveVersion.isPending}
        issues={saveIssues}
        onSave={(note) => void save(note)}
      />
      <VersionsDialog
        brandId={brand.id}
        contentId={contentId}
        currentVersion={expectedVersion}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canRestore={!readOnly}
        restoring={mutations.restore.isPending}
        images={images}
        onRestore={(version) => (dirty ? setPendingRestore(version) : restore(version))}
      />
      {!readOnly && (
        <>
          <ImagePickerDialog
            brandId={brand.id}
            libraryPath={`${brandBase}/biblioteca`}
            open={imagePicker}
            onOpenChange={setImagePicker}
            onPick={(asset) => {
              setImagePicker(false);
              dispatch({
                type: 'add',
                layer: newImageLayer(canvas, state.document.layers, { id: asset.id, name: asset.file_name }),
              });
            }}
          />
          <LogoPickerDialog
            brandId={brand.id}
            logoIds={logoIds}
            profilePath={`${brandBase}/marca`}
            open={logoPicker}
            onOpenChange={setLogoPicker}
            onPick={(asset) => {
              setLogoPicker(false);
              dispatch({
                type: 'add',
                layer: newLogoLayer(canvas, state.document.layers, {
                  id: asset.id,
                  name: asset.file_name,
                  width: asset.width,
                  height: asset.height,
                }),
              });
            }}
          />
        </>
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
      <ConfirmDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => !open && setPendingRestore(null)}
        title="¿Restaurar y descartar tus cambios?"
        description="Tienes cambios sin guardar que se perderán. La versión restaurada se guarda como versión nueva."
        confirmLabel="Restaurar"
        loading={mutations.restore.isPending}
        onConfirm={() => pendingRestore && restore(pendingRestore)}
      />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="¿Salir sin guardar?"
        description="Los cambios que no has guardado como versión se perderán."
        confirmLabel="Salir sin guardar"
        onConfirm={() => {
          setConfirmLeave(false);
          navigate(paths.list);
        }}
      />
    </div>
  );
}
