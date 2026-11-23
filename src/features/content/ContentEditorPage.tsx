import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Circle,
  CloudOff,
  Download,
  History,
  Image as ImageIcon,
  LayoutTemplate,
  Mic,
  NotebookPen,
  PencilLine,
  Redo2,
  ScanEye,
  Save,
  Send,
  SendHorizontal,
  SearchX,
  Share2,
  Sparkles,
  Square,
  Stamp,
  ShieldAlert,
  Type,
  Undo2,
} from 'lucide-react';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  MenuContent,
  MenuItem,
  MenuSeparator,
  Notice,
  MoreMenu,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type MoreAction,
  type MoreMenuItem,
} from '@/components/ui';
import { aiVoiceCopilotEnabled } from '@/config/app';
import { AiBrandCheck } from '@/features/ai/AiBrandCheck';
import { GenerateCaptionDialog } from '@/features/ai/GenerateCaptionDialog';
import { GenerateImageDialog } from '@/features/ai/GenerateImageDialog';
import { useImageAgencyBlock } from '@/features/ai/imageApi';
import { nearestImageRatio } from '@/features/ai/useAiImage';
import {
  canEditPhoto,
  canEditWithAi,
  useAiEditOptions,
  useOriginalAsset,
  useSaveEdit,
} from '@/features/photo-edit/api';
import { canRemoveBackground, describeRemovalError } from '@/features/photo-edit/cutout/remover';
import { runQuickEdit } from '@/features/photo-edit/quickEdit';
import { PhotoEditScreen } from '@/features/photo-edit/PhotoEditScreen';
import type { PhotoToolsContext } from './editor/panels/PhotoPanel';
import { AskAgencyButton, ContentRequestOrigin } from '@/features/requests/ContentRequestPanel';
import { useActiveProfile } from '@/features/brand/api';
import { orderFontOptions } from '@/features/brand/fonts';
import { loadBrandFonts, useBrandFontFaces } from '@/features/brand/fontsApi';
import { publishedText } from '@/features/brandcheck/text';
import type { FindingTarget } from '@/features/brandcheck/types';
import { parseProfile } from '@/features/brand/profile';
import { assetKeys, previewPath, uploadAsset, useAssetsByIds, useSignedUrls } from '@/features/library/api';
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
import { aiContentReasons, describeAiReasons } from './aiLabel';
import { toneOfPalette } from './copilot/legibility';
import { createCopilotPlanHost } from './copilot/planHost';
import type { CopilotHost } from './copilot/VoiceCopilot';
import {
  allLayers,
  createEmptyDocument,
  DocumentError,
  isEmptyFrame,
  MAX_LAYERS,
  pageLimits,
  pageView,
  type ContentDocument,
  type DocumentIssue,
} from './document';
import { ImagePickerDialog, LogoPickerDialog } from './editor/AssetPickerDialog';
import { BRAND_CHECK_PANEL } from './editor/brandCheckSlot';
import { imageFilesOf, type DraggedAsset } from './editor/assetDrag';
import { assetIdsOf } from './editor/canvas/nodes';
import { MissingAssetsNotice, useMissingAssetFrames } from './editor/missingAssets';
import type { CanvasDrop, CanvasViewProps, SafeZoneOverlay } from './editor/canvas/types';
import { canPaste, clipboardIds, copyLayers, pasteLayers } from './editor/clipboard';
import { discardDraft, fetchDraft, useDraftAutosave, type LoadedDraft } from './editor/drafts';
import { emptyFramesOf, frameToFill, newPhotoLayer, replacePhotoPatch } from './editor/frames';
import { activeLayers, activePageIndex, editorReducer, initEditor, type EditorAction } from './editor/history';
import { AddStickerSelect } from './editor/panels/AddStickerSelect';
import { newImageLayer, newLogoLayer, newShapeLayer, newTextLayer } from './editor/layers';
import { MultiSelectionPanel } from './editor/panels/ArrangeControls';
import { BrandPhotos } from './editor/panels/BrandPhotos';
import { CropDialog } from './editor/panels/CropDialog';
import { PointMenu } from './editor/PointMenu';
import { selectionMenuItems } from './editor/selectionMenu';
import { SelectionToolbar } from './editor/SelectionToolbar';
import { CopyPanel } from './editor/panels/CopyPanel';
import { LayersPanel } from './editor/panels/LayersPanel';
import { PageStrip } from './editor/panels/PageStrip';
import { PropertiesPanel, type BrandStyle } from './editor/panels/PropertiesPanel';
import { PieceSettingsDialog } from './editor/PieceSettingsDialog';
import { NetworkPreviewDialog } from './editor/preview/NetworkPreviewDialog';
import { SaveVersionDialog } from './editor/SaveVersionDialog';
import { imageUrlOf, mainImageLayer, useImagePalette } from './editor/useImagePalette';
import { VersionsDialog } from './editor/VersionsDialog';
import { ApplyTemplateDialog } from './templates/ApplyTemplateDialog';
import { SaveTemplateDialog } from './templates/SaveTemplateDialog';
import { PublishNowDialog } from '@/features/social/PublishNowDialog';
import { ScheduleDialog } from '@/features/social/ScheduleDialog';
import { EXPORT_PARAM } from '@/features/social/links';
import { PUBLISHABLE_TARGETS } from '@/features/social/calendar';
import { ExportImageDialog } from './export/ExportImageDialog';
import { exportForPublishing } from './export/exportForPublishing';
import { contentPaths, networkLabel, targetLabel } from './labels';
import { allowedCanvasRatios, getFormatSpec, recommendedCanvasRatio, type NetworkFormatSpec } from './networks';
import { safeZoneFor } from './safeZones';
import {
  editorPrimaryAction,
  STATUS_LABEL,
  STATUS_TONE,
  statusActions,
  statusChangedMessage,
  type StatusAction,
} from './status';
import { useFeature, useTextTask } from '@/features/platform/integrations/useFeature';
import { useWorkspaceMode } from '@/layout/workspace';
import { cn } from '@/lib/utils';

// El lienzo (y Konva con él) se descarga aparte, solo al abrir el editor.
const CanvasView = lazy(() => import('./editor/canvas/KonvaCanvas'));
// El editor de reels (piezas de formato reel), aparte: solo se descarga al abrir una.
const ReelEditor = lazy(() => import('@/features/reels/editor/ReelEditor').then((m) => ({ default: m.ReelEditor })));
// El copiloto por voz, también aparte: solo se descarga al pulsar «Dictar».
const VoiceCopilot = lazy(() => import('./copilot/VoiceCopilot').then((m) => ({ default: m.VoiceCopilot })));

/**
 * Documento de partida de una idea sin diseño: la proporción que recomienda la
 * red, si es una de las del lienzo, y las páginas mínimas del formato (un
 * carrusel empieza con dos).
 */
function startingDocument(spec: NetworkFormatSpec | undefined): ContentDocument {
  const media = spec?.media.includes('image') ? 'image' : spec?.media[0];
  const recommended = spec ? recommendedCanvasRatio(spec, media) : null;
  const allowed = spec ? allowedCanvasRatios(spec, media) : null;
  const aspectRatio = recommended?.ratio ?? (allowed?.ratios.includes('1:1') ? '1:1' : allowed?.ratios[0]) ?? '1:1';
  return createEmptyDocument({ aspectRatio, pages: pageLimits(spec).min });
}

/** Cambios de estado que hacen avanzar la pieza (el resto la devuelven atrás). */
const FORWARD_STATUSES = new Set<ContentStatus>(['in_review', 'approved']);

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
  const [searchParams] = useSearchParams();
  // El borrador que se guardó solo la última vez (si lo hay): se lee una vez, al abrir. Nunca falla:
  // sin borrador (o sin poder leerlo) se abre la última versión, como siempre.
  const asReel = content.data?.item.format === 'reel' && searchParams.get('editor') !== 'imagen';
  const draft = useQuery({
    queryKey: ['brand', brand.id, 'content-draft', contentId],
    queryFn: () => fetchDraft(contentId),
    enabled: content.isSuccess && !asReel,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  if (content.isPending || (content.isSuccess && !asReel && draft.isPending)) return <Spinner />;
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
  // Un reel se monta en el editor de reels; un diseño por capas antiguo se puede abrir con ?editor=imagen.
  if (content.data.item.format === 'reel' && searchParams.get('editor') !== 'imagen') {
    return (
      <Suspense fallback={<Spinner />}>
        <ReelEditor
          key={`${contentId}:${session}`}
          item={content.data.item}
          version={content.data.current?.row ?? null}
          onReopen={() => setSession((n) => n + 1)}
        />
      </Suspense>
    );
  }
  return (
    <Editor
      key={`${contentId}:${session}`}
      content={content.data}
      // Tras reabrir (se ha restaurado otra versión), el borrador leído al principio ya no vale.
      draft={session === 0 ? (draft.data ?? null) : null}
      onReopen={() => setSession((n) => n + 1)}
    />
  );
}

/**
 * El editor de una pieza. El documento se toma de `content` solo al montarse:
 * después manda el estado del editor, y los refrescos de la pieza (estado,
 * archivado) no pisan los cambios sin guardar.
 */
function Editor({
  content,
  draft,
  onReopen,
}: {
  content: LoadedContent;
  /** Borrador sin guardar de la última vez; null si no hay. */
  draft: LoadedDraft | null;
  onReopen: () => void;
}) {
  const initial = content;
  const queryClient = useQueryClient();
  // Pantalla de trabajo: la página mide justo la ventana y solo hacen scroll los paneles.
  useWorkspaceMode();
  const { org } = useOrg();
  const { brand, can, role } = useBrand();
  const navigate = useNavigate();
  // `?exportar=1`: se llega desde un aviso del calendario («Falta la imagen exportada → Exportar»).
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [versionDocument] = useState(() => initial.current?.document ?? startingDocument(spec));
  // Con un borrador propio se sigue donde se dejó; la referencia para «hay cambios» sigue siendo la versión.
  const [resumed] = useState(() => (draft && !readOnly && !unreadable ? draft : null));
  const [initialDocument] = useState(() => resumed?.document ?? versionDocument);
  const [state, dispatch] = useReducer(editorReducer, initialDocument, initEditor);
  const [baseline, setBaseline] = useState(() => JSON.stringify(versionDocument));
  /** Versión sobre la que se trabaja: la que se manda como «esperada» al guardar, restaurar o cambiar de estado. */
  const [expectedVersion, setExpectedVersion] = useState(initial.item.current_version);
  const dirty = useMemo(() => JSON.stringify(state.document) !== baseline, [state.document, baseline]);
  // Lo que aún no es una versión se guarda solo, como borrador, cada pocos segundos (ver editor/drafts.ts).
  const autosave = useDraftAutosave({
    contentId,
    document: state.document,
    baseVersion: expectedVersion,
    dirty,
    enabled: !readOnly && !unreadable,
    startsSaved: resumed !== null,
  });
  /** Lo último todavía no está guardado en ningún sitio (ni como versión ni como borrador). */
  const unsaved = dirty && autosave.status !== 'saved';

  const [panel, setPanel] = useState('layer');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveIssues, setSaveIssues] = useState<DocumentIssue[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(() => searchParams.has(EXPORT_PARAM));
  useEffect(() => {
    if (searchParams.has(EXPORT_PARAM)) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);
  const [publishNowOpen, setPublishNowOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [imagePicker, setImagePicker] = useState(false);
  const [logoPicker, setLogoPicker] = useState(false);
  const [imageAi, setImageAi] = useState(false);
  const [photoEditing, setPhotoEditing] = useState(false);
  const [photoEditTab, setPhotoEditTab] = useState<'enhance' | 'ai' | 'portrait'>('enhance');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  /** En pantallas estrechas, los paneles son una hoja inferior que se abre con las pestañas. */
  const [sheetOpen, setSheetOpen] = useState(false);
  // Un borrador empezado sobre una versión anterior: otra persona guardó después. Se dice igual que un conflicto.
  const [conflict, setConflict] = useState(() => Boolean(resumed && resumed.baseVersion !== initial.item.current_version));
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<LoadedVersion | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busyStatus, setBusyStatus] = useState<ContentStatus | null>(null);
  /** Texto que se está escribiendo directamente sobre el lienzo. */
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [focusText, setFocusText] = useState(0);
  /** Campo del texto de la publicación que hay que enfocar (al pulsar un hallazgo del verificador). */
  const [focusCopy, setFocusCopy] = useState<{ field: string; range?: FindingTarget['range']; n: number } | null>(null);
  // Con la marca en modo agencia no se redacta con el servicio de IA: se pide a la agencia.
  // Cada botón sale solo si SU tarea tiene proveedor, modelo y precio en el servidor.
  const captionTask = useTextTask('post.caption');
  const brandCheckTask = useTextTask('brand.check');
  const copilotTask = useTextTask('editor.copilot');
  const captionAi = captionTask && brand.ai_mode !== 'agency';
  const brandCheckAi = brandCheckTask && brand.ai_mode !== 'agency';
  // La imagen con IA es otro servicio, independiente del texto: depende solo de su interruptor.
  const aiImageOn = useFeature('aiImage');
  // En modo agencia la imagen con IA es del personal de la agencia, no de los miembros de la marca.
  const imageAgencyBlocked = useImageAgencyBlock(brand.id, aiImageOn && brand.ai_mode === 'agency');
  const aiImage = aiImageOn && !imageAgencyBlocked;
  // Copiloto del editor: IA de texto configurada en el servidor + su interruptor.
  // Las órdenes se dictan o se escriben, así que sale también en navegadores sin
  // dictado. No redacta (coloca lo dictado), por eso sí sale en marcas en modo
  // agencia (decisión provisional, docs/ESTADO.md).
  const [copilotEnabled] = useState(() => aiVoiceCopilotEnabled());
  const voiceCopilot = copilotEnabled && copilotTask;
  const [copilotOpen, setCopilotOpen] = useState(false);
  /** Foto (capa) a la que el copiloto ha pedido quitar el fondo; se hace cuando su recurso está listo. */
  const pendingCutout = useRef<string | null>(null);
  const [cutoutRequest, setCutoutRequest] = useState(0);
  /** Capa cuya foto se va a poner o a cambiar por otra de la biblioteca (un marco, «Sustituir», el copiloto). */
  const [replaceLayerId, setReplaceLayerId] = useState<string | null>(null);
  /** Foto que se está encuadrando dentro de su caja, sobre el lienzo. */
  const [framingId, setFramingId] = useState<string | null>(null);
  /** Foto que se está recortando (desde la barra flotante). */
  const [cropLayerId, setCropLayerId] = useState<string | null>(null);
  /** Menú del botón derecho: dónde se abre. */
  const [pointMenu, setPointMenu] = useState<{ x: number; y: number } | null>(null);
  const saveEdit = useSaveEdit(brand.id);
  // El estado al día también fuera del ciclo de React: el copiloto encadena
  // órdenes (deshacer y, acto seguido, otra) sin esperar a que se repinte.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  /** Despacha una acción determinista (deshacer, sustituir, ir a una página) y devuelve cómo queda. */
  const run = (action: EditorAction) => {
    stateRef.current = editorReducer(stateRef.current, action);
    dispatch(action);
    return stateRef.current;
  };

  // Página activa: la que se ve en el lienzo y la que cambian las órdenes de capas.
  const pageIndex = activePageIndex(state);
  const page = useMemo(() => pageView(state.document, pageIndex), [state.document, pageIndex]);
  const layers = page.layers;
  // Las capas nuevas no repiten identificador con las de ninguna página.
  const everyLayer = allLayers(state.document);
  const pageRange = pageLimits(spec);
  const showPages = pageRange.max > 1 || state.document.pages.length > 1;
  const selected = layers.find((layer) => layer.id === state.selectedId) ?? null;
  const selectedLayers = useMemo(() => {
    const ids = new Set(state.selectedIds);
    return layers.filter((layer) => ids.has(layer.id));
  }, [layers, state.selectedIds]);

  // ── Zona segura de la red (orientativa) ──
  const safeZone = useMemo(() => safeZoneFor(spec, state.document.canvas), [spec, state.document.canvas]);
  const safeZoneOverlay: SafeZoneOverlay | null = useMemo(
    () => (showSafeZone && safeZone ? { unsafe: safeZone.unsafe, safe: safeZone.safe } : null),
    [showSafeZone, safeZone],
  );

  // ── Marca: paleta, tipografías y logotipos del perfil ──
  const profileRow = useActiveProfile(brand.id);
  const profile = useMemo(() => (profileRow.data ? parseProfile(profileRow.data.data) : null), [profileRow.data]);
  // Tipografías subidas por la marca: se cargan con FontFace antes de dibujar y se ofrecen las primeras.
  const brandFonts = useBrandFontFaces(brand.id);
  const brandFontFamilies = JSON.stringify(brandFonts.families);
  const brandStyle: BrandStyle = useMemo(
    () => ({
      palette: (profile?.visual.colors ?? []).map((c) => ({ hex: c.hex.toUpperCase(), name: c.name })),
      fonts: orderFontOptions(
        JSON.parse(brandFontFamilies) as string[],
        (profile?.visual.fonts ?? []).map((f) => f.family),
        [],
      ),
    }),
    [profile, brandFontFamilies],
  );
  const logoIds = profile?.visual.logoAssetIds ?? [];

  // ── Imágenes del documento: recurso → dirección firmada ──
  const assetIdsKey = assetIdsOf(state.document).join(',');
  const assetIds = useMemo(() => (assetIdsKey ? assetIdsKey.split(',') : []), [assetIdsKey]);
  const assets = useAssetsByIds(brand.id, assetIds);
  // Fotos y logotipos borrados de la biblioteca: pasan a ser marcos vacíos «Poner foto» (editor/missingAssets.tsx).
  const missingAssets = useMissingAssetFrames({ document: state.document, assetIds, found: assets.data, readOnly, dispatch });
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

  // La tira de páginas solo pinta miniaturas: firma las ligeras (el lienzo usa los originales).
  const stripPaths = useMemo(() => (assets.data ?? []).map(previewPath).sort(), [assets.data]);
  const stripSigned = useSignedUrls(stripPaths);
  const stripImages = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets.data ?? []) {
      const url = stripSigned.data?.get(previewPath(asset));
      if (url) map.set(asset.id, url);
    }
    return map;
  }, [assets.data, stripSigned.data]);

  // «Esta foto» para el copiloto: la imagen elegida en el lienzo, si la hay.
  const selectedImage = useMemo(() => {
    if (selected?.type !== 'image' || selected.source.kind !== 'asset') return null;
    const assetId = selected.source.assetId;
    const row = (assets.data ?? []).find((asset) => asset.id === assetId);
    return row ? { id: row.id, name: row.file_name, width: row.width, height: row.height } : null;
  }, [selected, assets.data]);

  // «Editar foto» de la capa elegida: el recurso de la biblioteca y su dirección.
  const editablePhoto = useMemo(() => {
    if (selected?.type !== 'image' || selected.source.kind !== 'asset') return null;
    const assetId = selected.source.assetId;
    const row = (assets.data ?? []).find((asset) => asset.id === assetId);
    return row && canEditPhoto(row) ? { layerId: selected.id, row, url: images.get(row.id) } : null;
  }, [selected, assets.data, images]);

  // Ediciones de foto de la capa elegida que crean una foto nueva (quitar el fondo…) y, si el
  // servidor tiene IA para ello, «Cambiar el fondo con IA». Sin IA configurada, ese botón no sale.
  // «Volver a la original»: la foto de la que sale la de la capa, si es una edición y la original sigue en la biblioteca.
  const originalQuery = useOriginalAsset(brand.id, editablePhoto?.row ?? null);
  const originalPhoto = useMemo(() => {
    if (!editablePhoto) return null;
    return originalQuery.data ? { layerId: editablePhoto.layerId, assetId: originalQuery.data.id } : null;
  }, [editablePhoto, originalQuery.data]);
  const aiPhotoOptions = useAiEditOptions(brand.id, Boolean(editablePhoto) && canEditWithAi(editablePhoto!.row));
  const aiBackgroundAvailable = Boolean(
    aiPhotoOptions.data?.some((choice) => choice.operation === 'replace_background'),
  );
  const photoTools: PhotoToolsContext | undefined = editablePhoto
    ? {
        row: editablePhoto.row,
        url: editablePhoto.url,
        onUseResult: (row, fit) =>
          dispatch({
            type: 'update',
            id: editablePhoto.layerId,
            patch: { source: { kind: 'asset', assetId: row.id }, fit },
          }),
        onPortrait: () => {
          setPhotoEditTab('portrait');
          setPhotoEditing(true);
        },
        onAiBackground:
          aiBackgroundAvailable && editablePhoto.url
            ? () => {
                setPhotoEditTab('ai');
                setPhotoEditing(true);
              }
            : undefined,
      }
    : undefined;

  // «Quita el fondo» dicho al copiloto: lo mismo que el botón del panel de la foto.
  useEffect(() => {
    if (!editablePhoto || editablePhoto.layerId !== pendingCutout.current || !editablePhoto.url) return;
    pendingCutout.current = null;
    const { row, url, layerId } = editablePhoto;
    const notice = toast.loading('Quitando el fondo…');
    runQuickEdit({ asset: row, url, edit: { kind: 'cutout' }, save: (input) => saveEdit.mutateAsync(input) }).then(
      (result) => {
        dispatch({ type: 'update', id: layerId, patch: { source: { kind: 'asset', assetId: result.id }, fit: 'contain' } });
        toast.success('Fondo quitado. La foto original sigue en la biblioteca y se deshace con Ctrl+Z.', { id: notice });
      },
      (error: unknown) => toast.error(describeRemovalError(error) || translateError(error), { id: notice }),
    );
    // `saveEdit` cambia en cada pintado: basta con la petición y la foto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutoutRequest, editablePhoto]);

  // Marca de contenido generado con IA: la calcula la base de datos al guardar
  // (`item.ai_generated`); aquí se adelanta con lo que hay en pantalla.
  const aiReasons = useMemo(() => aiContentReasons(state.document, assets.data ?? []), [state.document, assets.data]);
  const aiLabel = aiReasons.length > 0 || (!dirty && item.ai_generated === true);

  // Avisar antes de cerrar la pestaña solo si lo último aún no ha llegado a guardarse (ni como borrador).
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Al abrir con un borrador: se dice, y se ofrece volver a la versión guardada.
  useEffect(() => {
    if (!resumed) return;
    toast.message('Sigues donde lo dejaste: hemos recuperado tus cambios sin guardar.', {
      duration: 10_000,
      action: {
        label: 'Descartarlos',
        onClick: () => {
          dispatch({ type: 'load', document: versionDocument });
          setConflict(false);
          void discardDraft(contentId).catch(() => undefined);
        },
      },
    });
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const paletteLayer = mainImageLayer(page);
  const palette = useImagePalette(imageUrlOf(paletteLayer, images));
  // Tono medio de esa imagen: el copiloto lo usa para que los textos se lean encima.
  const paletteAssetId = paletteLayer?.source.kind === 'asset' ? paletteLayer.source.assetId : null;
  const imageTones = useMemo(() => {
    const tone = palette.status === 'ready' ? toneOfPalette(palette.palette) : null;
    return tone && paletteAssetId ? new Map([[paletteAssetId, tone]]) : undefined;
  }, [palette, paletteAssetId]);

  /** Al pulsar un hallazgo del verificador: elegir la capa o llevar al campo señalado. */
  function selectTarget(target: FindingTarget) {
    if (target.part === 'textLayer' && target.layerId) {
      dispatch({ type: 'select', id: target.layerId, exact: true });
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
  /** Quita la selección y enseña las opciones del documento (proporción, fondo) en el panel «Diseño». */
  const deselect = () => {
    dispatch({ type: 'select', id: null });
    setPanel('layer');
  };
  const onSelect: CanvasViewProps['onSelect'] = (id, options) =>
    id === null ? deselect() : dispatch({ type: 'select', id, toggle: options?.toggle });
  const onSelectMany: CanvasViewProps['onSelectMany'] = (ids, additive) =>
    dispatch({ type: 'selectMany', ids, additive });
  const onChange: CanvasViewProps['onChange'] = (changes) => dispatch({ type: 'updateMany', changes });
  /** Doble clic o Intro en un texto: se escribe encima del lienzo. Sin permiso de edición, se enseña su campo. */
  const onEditText = (id: string) => {
    dispatch({ type: 'select', id, exact: true });
    setPanel('layer');
    if (readOnly) setFocusText((n) => n + 1);
    else setEditingTextId(id);
  };
  const onTextCommit: CanvasViewProps['onTextCommit'] = (id, text) => {
    setEditingTextId(null);
    const layer = layers.find((l) => l.id === id);
    if (layer?.type === 'text' && layer.text !== text) dispatch({ type: 'update', id, patch: { text } });
    // El foco vuelve al lienzo, para seguir con el teclado.
    canvasRef.current?.focus();
  };
  const onTextCancel = () => {
    setEditingTextId(null);
    canvasRef.current?.focus();
  };

  // ── Fotos: marcos, sustituir, soltar y pegar ──
  /**
   * Pone una foto de la biblioteca en el diseño. Va al marco indicado; si no se indica ninguno ni un
   * punto, al marco vacío elegido o al primero vacío de la página; si no hay marcos, es una capa nueva
   * (a lienzo completo solo si la página está vacía: encima de un diseño entra más pequeña, sin taparlo).
   */
  function placePhoto(asset: DraggedAsset, target: { frameId?: string | null; at?: { x: number; y: number } | null } = {}) {
    const current = stateRef.current;
    const pageLayers = activeLayers(current);
    const frame = target.frameId
      ? pageLayers.find((layer) => layer.id === target.frameId)
      : target.at
        ? undefined
        : (frameToFill(pageLayers, current.selectedIds) ?? undefined);
    if (frame?.type === 'image') {
      run({ type: 'update', id: frame.id, patch: replacePhotoPatch(asset.id) });
      run({ type: 'select', id: frame.id, exact: true });
      setPanel('layer');
      return;
    }
    if (pageLayers.length >= MAX_LAYERS) {
      toast.error(`La página ya tiene el máximo de ${MAX_LAYERS} capas.`);
      return;
    }
    const everything = allLayers(current.document);
    const size = current.document.canvas;
    run({
      type: 'add',
      layer:
        pageLayers.length === 0
          ? newImageLayer(size, everything, asset)
          : newPhotoLayer(size, everything, asset, target.at ?? undefined),
    });
    setPanel('layer');
  }

  /** Sube fotos del dispositivo a la biblioteca de la marca y las pone en el diseño (soltar o pegar). */
  async function uploadAndPlace(files: File[], target: { frameId?: string | null; at?: { x: number; y: number } | null } = {}) {
    if (files.length === 0) return;
    const notice = toast.loading(
      files.length === 1 ? 'Subiendo la foto a la biblioteca…' : `Subiendo ${files.length} fotos a la biblioteca…`,
    );
    try {
      for (const [index, file] of files.entries()) {
        const row = await uploadAsset({ organizationId: org.id, brandId: brand.id, file, kind: 'image' });
        // La primera va donde se soltó; las demás, a los siguientes marcos vacíos o como capas nuevas.
        placePhoto(
          { id: row.id, name: row.file_name, width: row.width, height: row.height },
          index === 0 ? target : {},
        );
      }
      await queryClient.invalidateQueries({ queryKey: assetKeys.all(brand.id) });
      toast.success(
        files.length === 1
          ? 'Foto añadida. Queda también en la biblioteca.'
          : `${files.length} fotos añadidas. Quedan también en la biblioteca.`,
        { id: notice },
      );
    } catch (error) {
      toast.error(translateError(error), { id: notice });
    }
  }

  const onDropOnCanvas = (drop: CanvasDrop) => {
    const target = { frameId: drop.frameId, at: drop.at };
    if (drop.asset) placePhoto(drop.asset, target);
    else if (drop.files.length > 0) void uploadAndPlace(drop.files, target);
    if (drop.rejected > 0 && !drop.asset) toast.error('Solo se pueden soltar fotos JPG, PNG o WebP.');
  };

  /** Doble clic (o Intro) en una foto: encuadrarla dentro de su caja. Solo con el encaje «Llenar». */
  const startFraming = (id: string) => {
    const layer = activeLayers(stateRef.current).find((l) => l.id === id);
    if (!layer || layer.type !== 'image' || layer.locked || readOnly) return;
    if (isEmptyFrame(layer)) {
      setReplaceLayerId(id);
      return;
    }
    run({ type: 'select', id, exact: true });
    if (layer.fit !== 'cover') {
      toast.message('Para moverla dentro del marco, pon su encaje en «Llenar» (panel Diseño).');
      return;
    }
    // Toda la sesión de encuadre es un solo paso de deshacer.
    run({ type: 'checkpoint' });
    setFramingId(id);
  };
  const endFraming = () => {
    setFramingId(null);
    dispatch({ type: 'checkpoint' });
    canvasRef.current?.focus();
  };
  // Si la foto que se encuadraba deja de estar a la vista (otra página, deshacer, borrarla), no hay encuadre.
  const activeFramingId =
    framingId !== null && layers.some((layer) => layer.id === framingId && layer.type === 'image') ? framingId : null;

  // ── Copiar, pegar y duplicar ──
  const copySelection = () => {
    const chosen = activeLayers(stateRef.current).filter((layer) => stateRef.current.selectedIds.includes(layer.id));
    return copyLayers(brand.id, chosen);
  };
  const pasteClipboard = () => {
    const current = stateRef.current;
    const pageLayers = activeLayers(current);
    const samePage = clipboardIds().some((id) => pageLayers.some((layer) => layer.id === id));
    const copies = pasteLayers(brand.id, allLayers(current.document), current.document.canvas, samePage);
    if (copies.length === 0) return false;
    if (pageLayers.length + copies.length > MAX_LAYERS) {
      toast.error(`No caben: la página admite como mucho ${MAX_LAYERS} capas.`);
      return true;
    }
    run({ type: 'addMany', layers: copies });
    return true;
  };

  // Pegar: una imagen del portapapeles del sistema (se sube a la biblioteca) o, si no la hay, lo copiado aquí.
  const pasteHandler = useRef<(event: ClipboardEvent) => void>(() => undefined);
  useLayoutEffect(() => {
    pasteHandler.current = (event) => {
      if (readOnly || isTypingTarget(event.target)) return;
      const origin = event.target as Node | null;
      if (origin !== document.body && !rootRef.current?.contains(origin)) return;
      const images = imageFilesOf(event.clipboardData?.files);
      if (images.length > 0) {
        event.preventDefault();
        void uploadAndPlace(images);
      } else if (pasteClipboard()) {
        event.preventDefault();
      }
    };
  });
  useEffect(() => {
    const listener = (event: ClipboardEvent) => pasteHandler.current(event);
    document.addEventListener('paste', listener);
    return () => document.removeEventListener('paste', listener);
  }, []);

  // ── Teclado: deshacer, rehacer, guardar y, con una capa elegida, mover, borrar y soltar ──
  // Se escucha en el documento y no solo en el editor: tras cerrar un diálogo (elegir o editar una foto)
  // el foco puede quedar en la página y los atajos deben seguir funcionando. Lo que llega desde un
  // diálogo abierto (portal) o desde fuera del editor (menú lateral) no es del editor.
  function onKeyDown(event: globalThis.KeyboardEvent) {
    const origin = event.target as Node | null;
    if (origin !== document.body && !rootRef.current?.contains(origin)) return;
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
      if (!readOnly) saveNow();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (mod && key === 'g') {
      event.preventDefault();
      if (!readOnly) dispatch({ type: event.shiftKey ? 'ungroup' : 'group' });
      return;
    }
    if (mod && key === 'a') {
      event.preventDefault();
      dispatch({ type: 'selectMany', ids: layers.filter((l) => l.visible && !l.locked).map((l) => l.id) });
      return;
    }
    if (state.selectedIds.length === 0) return;
    if (event.key === 'Escape') {
      deselect();
      return;
    }
    // Copiar vale también en solo lectura (pegar, no). Con texto seleccionado en la página, manda el navegador.
    if (mod && key === 'c') {
      if (window.getSelection()?.toString()) return;
      if (copySelection() > 0) event.preventDefault();
      return;
    }
    if (readOnly) return;
    if (mod && key === 'x') {
      if (copySelection() > 0) {
        event.preventDefault();
        dispatch({ type: 'removeSelection' });
      }
      return;
    }
    if (mod && key === 'd') {
      event.preventDefault();
      dispatch({ type: 'duplicateSelection' });
      return;
    }
    // Intro con un texto elegido, desde el lienzo: escribir encima (lo mismo que el doble clic).
    if (event.key === 'Enter' && event.target === canvasRef.current && selected?.type === 'text' && !selected.locked) {
      event.preventDefault();
      onEditText(selected.id);
      return;
    }
    // Intro con una foto o un marco elegido: poner la foto (marco vacío) o encuadrarla (lo mismo que el doble clic).
    if (event.key === 'Enter' && event.target === canvasRef.current && selected?.type === 'image' && !selected.locked) {
      event.preventDefault();
      startFraming(selected.id);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      dispatch({ type: 'removeSelection' });
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
      dispatch({ type: 'nudgeSelection', dx: move[0], dy: move[1] });
    }
  }

  const keyHandler = useRef(onKeyDown);
  useLayoutEffect(() => {
    keyHandler.current = onKeyDown;
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => keyHandler.current(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  // ── Guardar, restaurar y estados ──
  function handleConflictOr(error: unknown) {
    if (isVersionConflict(error)) {
      setConflict(true);
      toast.error('Otra persona guardó una versión más reciente. Tus cambios siguen aquí.');
    } else {
      toast.error(translateError(error));
    }
  }

  /**
   * Guarda una versión nueva. Devuelve su número, o null si no se ha podido guardar (ya se ha avisado).
   * Con `showIssues`, si el diseño no se puede guardar se abre el diálogo de guardar con los motivos.
   */
  function save(
    note: string,
    expected = expectedVersion,
    showIssues = false,
    document = state.document,
  ): Promise<number | null> {
    setSaveIssues([]);
    return mutations.saveVersion.mutateAsync({ contentId, document, note, expectedVersion: expected }).then(
      (row) => {
        setBaseline(JSON.stringify(document));
        setExpectedVersion(row.version);
        setConflict(false);
        setSaveOpen(false);
        toast.success(`Versión ${row.version} guardada`);
        return row.version;
      },
      (error: unknown) => {
        if (error instanceof DocumentError) {
          setSaveIssues(error.issues.length ? error.issues : [{ path: '', message: error.message }]);
          if (showIssues) setSaveOpen(true);
          return null;
        }
        setSaveOpen(false);
        handleConflictOr(error);
        return null;
      },
    );
  }

  /** «Guardar versión» (botón o Ctrl+S): guarda al momento, sin preguntar nada. La nota, opcional, está en «⋯». */
  function saveNow() {
    if (mutations.saveVersion.isPending) return;
    if (JSON.stringify(stateRef.current.document) === baseline && expectedVersion > 0) {
      toast.message('No hay cambios que guardar.');
      return;
    }
    void save('', undefined, true, stateRef.current.document);
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

  /** Cambia el estado. Devuelve la pieza ya cambiada, o null si no se ha podido (ya se ha avisado). */
  function changeStatus(to: ContentStatus, version = expectedVersion, quiet = false) {
    setBusyStatus(to);
    return mutations.setStatus
      .mutateAsync({ contentId, status: to, expectedVersion: version })
      .then(
        (row) => {
          if (!quiet) toast.success(statusChangedMessage(to));
          return row;
        },
        (error: unknown) => {
          handleConflictOr(error);
          return null;
        },
      )
      .finally(() => setBusyStatus(null));
  }

  /**
   * Lo que hay en pantalla, guardado como versión: la que ya hay si no ha cambiado nada, o una nueva.
   * Devuelve su número, o null si no se ha podido guardar (ya se ha avisado).
   */
  async function ensureVersion(): Promise<number | null> {
    const document = stateRef.current.document;
    if (JSON.stringify(document) === baseline && expectedVersion > 0) return expectedVersion;
    return save('', undefined, true, document);
  }

  /** Un cambio de estado pedido por la persona: si hay cambios sin versión, primero se guardan. */
  async function advance(action: StatusAction) {
    const needsSave = dirty || (action.needsVersion && expectedVersion === 0);
    const version = needsSave ? await ensureVersion() : expectedVersion;
    if (version === null) return;
    await changeStatus(action.to, version);
  }

  /**
   * Antes de publicar o programar desde el editor: deja la pieza guardada y aprobada. Solo se llama
   * cuando la persona puede aprobar; lo dice el propio botón («Aprobar y publicar ahora…»).
   */
  async function approveForPublishing(): Promise<boolean> {
    const version = await ensureVersion();
    if (version === null) return false;
    // Guardar una versión nueva retira la aprobación: se aprueba la que se va a publicar.
    if (item.status === 'approved' && !dirty) return true;
    const row = await changeStatus('approved', version, true);
    return row?.status === 'approved';
  }

  async function openPublishNow() {
    if (needsApproval && !(await approveForPublishing())) return;
    setPublishNowOpen(true);
  }

  async function openSchedule() {
    if (needsApproval && !(await approveForPublishing())) return;
    setScheduleOpen(true);
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

  /** Renombrar la pieza o cambiar su red y formato. Devuelve el mensaje de error, o null si ha ido bien. */
  async function saveSettings(changes: { title?: string; target?: { network: string; format: string } }) {
    try {
      const row = await mutations.update.mutateAsync({ contentId, ...changes });
      setSettingsOpen(false);
      const backToDraft = changes.target && item.status === 'approved' && row.status === 'draft';
      toast.success(backToDraft ? 'Guardado. Ha vuelto a borrador: hay que aprobarla otra vez.' : 'Guardado');
      return null;
    } catch (error) {
      return translateError(error);
    }
  }

  /** Salir del editor: si queda algo sin guardar, se guarda el borrador antes; solo si no se puede, se pregunta. */
  /** La versión guardada, exportada a JPEG y subida a la biblioteca: lo que el calendario acepta para publicar. */
  const exportApprovedVersion = () =>
    exportForPublishing({
      document: state.document,
      images,
      title: item.title,
      contentId,
      orgId: org.id,
      brandId: brand.id,
      version: expectedVersion,
      prepareFonts: () => loadBrandFonts(brandFonts.fonts).then(() => undefined),
    });

  function leave(event: MouseEvent<HTMLAnchorElement>) {
    if (!unsaved) return;
    event.preventDefault();
    void autosave.flush().then((saved) => {
      if (saved) navigate(paths.list);
      else setConfirmLeave(true);
    });
  }

  /**
   * Lo que un plan del copiloto puede gastar o leer. La imagen con IA solo se
   * ofrece si el servidor la tiene configurada y esta persona puede usarla en
   * la marca; si no, el plan lo dice y propone un fondo de color (sin simular nada).
   */
  const copilotPlanHost = createCopilotPlanHost({
    brandId: brand.id,
    imageAi: aiImage
      ? { available: true }
      : {
          available: false,
          reason: imageAgencyBlocked
            ? 'En modo agencia, la imagen con IA la usa solo el personal de la agencia.'
            : 'La imagen con IA no está configurada.',
        },
    saveEdit: (input) => saveEdit.mutateAsync(input),
    onLibraryChange: () => void queryClient.invalidateQueries({ queryKey: assetKeys.all(brand.id) }),
  });

  /** Lo que el copiloto pide al editor que no es cambiar el documento. */
  const copilotHost: CopilotHost = {
    history: (kind) => {
      const before = stateRef.current;
      const next = run({ type: kind });
      return next === before ? null : { document: next.document, pageIndex: activePageIndex(next) };
    },
    goToPage: (index) => void run({ type: 'selectPage', index }),
    // Con el documento al día (el de la orden que se acaba de aplicar, aunque aún no se haya pintado).
    save: () => {
      const document = stateRef.current.document;
      if (JSON.stringify(document) === baseline) toast.message('No hay cambios que guardar.');
      else void save('', undefined, true, document);
    },
    openTemplates: () => setTemplateOpen(true),
    photoFlow: (flow, layerId) => {
      const layer = allLayers(stateRef.current.document).find((l) => l.id === layerId);
      if (!layer || layer.type !== 'image' || layer.source.kind !== 'asset') {
        return 'Esa foto no es de la biblioteca: no se puede editar desde aquí.';
      }
      const assetId = layer.source.assetId;
      run({ type: 'select', id: layerId, exact: true });
      setPanel('layer');
      if (flow === 'replace') {
        setReplaceLayerId(layerId);
        return null;
      }
      const row = (assets.data ?? []).find((asset) => asset.id === assetId);
      if (!row) return 'La foto aún se está cargando: repite la orden en un momento.';
      if (!canEditPhoto(row)) return 'Esa foto no se puede editar.';
      if (flow === 'remove_background') {
        if (!canRemoveBackground()) return 'Este navegador no puede quitar el fondo.';
        pendingCutout.current = layerId;
        setCutoutRequest((n) => n + 1);
        return null;
      }
      setPhotoEditTab(flow === 'portrait' ? 'portrait' : 'enhance');
      setPhotoEditing(true);
      return null;
    },
    // Órdenes que montan una pieza: el fondo con `ai-media`, las fotos de la biblioteca y el recorte de siempre.
    plan: copilotPlanHost,
  };

  const canvas = state.document.canvas;
  const full = layers.length >= MAX_LAYERS;
  /** Huecos de foto todavía vacíos (de todas las páginas): no salen en la imagen. */
  const emptyFrames = useMemo(() => emptyFramesOf(state.document), [state.document]);

  // ── Barra de acciones sobre lo elegido y menú del botón derecho (la misma lista para los dos) ──
  const selectionMenu = selectionMenuItems({
    layers: selectedLayers,
    pageLayers: layers,
    dispatch,
    canPaste: canPaste(brand.id),
    onCopy: () => {
      if (copySelection() > 0) toast.message('Copiado. Pégalo con Ctrl+V, aquí o en otra página.');
    },
    onPaste: () => void pasteClipboard(),
    onFramePhoto: startFraming,
    onMoreOptions: () => {
      setPanel('layer');
      setSheetOpen(true);
    },
  });
  const selectedPhotoUrl =
    selected?.type === 'image' && selected.source.kind === 'asset' ? images.get(selected.source.assetId) : undefined;
  const selectionToolbar =
    !readOnly && selectedLayers.length > 0 ? (
      <SelectionToolbar
        layers={selectedLayers}
        brandStyle={brandStyle}
        dispatch={dispatch}
        onPickPhoto={setReplaceLayerId}
        onEditPhoto={
          editablePhoto?.url
            ? () => {
                setPhotoEditTab('enhance');
                setPhotoEditing(true);
              }
            : undefined
        }
        onCropPhoto={selected && selectedPhotoUrl ? () => setCropLayerId(selected.id) : undefined}
        onRemoveBackground={
          editablePhoto?.url && canRemoveBackground()
            ? () => {
                pendingCutout.current = editablePhoto.layerId;
                setCutoutRequest((n) => n + 1);
              }
            : undefined
        }
        onEditText={onEditText}
        menu={selectionMenu}
      />
    ) : undefined;
  const cropLayer = layers.find((layer) => layer.id === cropLayerId);
  const cropUrl =
    cropLayer?.type === 'image' && cropLayer.source.kind === 'asset' ? images.get(cropLayer.source.assetId) : undefined;
  const replaceLayer = layers.find((layer) => layer.id === replaceLayerId);
  const actions = statusActions(item, { edit: canEdit, approve: canApprove });
  const allowed = spec ? allowedCanvasRatios(spec, spec.media.includes('image') ? 'image' : spec.media[0]) : null;
  const publishingOn = useFeature('publishing');
  const canPublishNow =
    publishingOn &&
    canEdit &&
    !item.archived_at &&
    item.status === 'approved' &&
    PUBLISHABLE_TARGETS.has(`${item.network}:${item.format}`);
  const BrandCheck = BRAND_CHECK_PANEL;
  const videoOnly = spec !== undefined && !spec.media.includes('image');
  const canSchedule = publishingOn && canEdit && !item.archived_at && item.status === 'approved';
  // Publicar y programar se ofrecen también antes de aprobar a quien puede aprobar: el mismo botón
  // guarda la versión, la aprueba y sigue. Con cambios después de aprobar pasa lo mismo.
  const publishable = publishingOn && canEdit && !item.archived_at;
  const needsApproval = item.status !== 'approved' || dirty;
  const canApproveNow = canApprove && (item.status === 'draft' || item.status === 'in_review' || dirty || item.status === 'approved');
  const offerPublishNow =
    publishable && PUBLISHABLE_TARGETS.has(`${item.network}:${item.format}`) && (!needsApproval || canApproveNow);
  const offerSchedule = publishable && (!needsApproval || canApproveNow);
  // El botón principal de la cabecera solo cambia el estado (o recupera): publicar y programar van en «Publicar o compartir».
  const primary = editorPrimaryAction(item, actions, { edit: canEdit, publishNow: false, schedule: false });

  /** Por qué no se puede cambiar de estado ahora (o undefined si se puede). Con cambios sin versión, se guardan antes. */
  const statusBlocked = (action: StatusAction) =>
    action.needsVersion && expectedVersion === 0 && !dirty && allLayers(state.document).length === 0
      ? 'El diseño está vacío'
      : undefined;

  const primaryButton = (() => {
    if (!primary) return null;
    switch (primary.kind) {
      case 'restore':
        return (
          <Button size="sm" onClick={toggleArchive} loading={mutations.archive.isPending} data-testid="editor-archive">
            <ArchiveRestore className="h-4 w-4" aria-hidden />
            <span className="max-sm:sr-only">Recuperar</span>
          </Button>
        );
      case 'publishNow':
      case 'schedule':
        return null;
      case 'status': {
        const { action } = primary;
        const blocked = statusBlocked(action);
        return (
          <Button
            // Con la pieza sin aprobar, lo principal es avanzar su estado; «Publicar o compartir» va al lado, en secundario.
            size="sm"
            disabled={Boolean(blocked) || busyStatus !== null || mutations.saveVersion.isPending}
            loading={busyStatus === action.to}
            title={blocked ?? (dirty ? 'Guarda los cambios como versión y sigue' : undefined)}
            onClick={() => void advance(action)}
            data-testid={`status-${action.to}`}
          >
            {action.to === 'approved' ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            ) : (
              <SendHorizontal className="h-4 w-4" aria-hidden />
            )}
            <span className="max-sm:sr-only">{action.label}</span>
          </Button>
        );
      }
    }
  })();

  // Lo que no es la acción principal, en «⋯», por grupos: ver, avanzar, ajustar y, al final, lo que deshace.
  const primaryStatus = primary?.kind === 'status' ? primary.action.to : null;
  const forward = actions.filter((a) => a.to !== primaryStatus && FORWARD_STATUSES.has(a.to));
  const backward = actions.filter((a) => a.to !== primaryStatus && !FORWARD_STATUSES.has(a.to));
  const statusItem = (action: StatusAction): MoreAction => {
    const blocked = statusBlocked(action);
    return {
      id: `status-${action.to}`,
      label: action.label,
      icon: FORWARD_STATUSES.has(action.to) ? SendHorizontal : Undo2,
      onSelect: () => void advance(action),
      disabled: Boolean(blocked) || busyStatus !== null,
      hint: blocked,
      testId: `status-${action.to}`,
    };
  };
  const when = <T,>(condition: boolean, item: T): T[] => (condition ? [item] : []);
  const moreActions: MoreMenuItem[] = [
    ...when<MoreAction>(!readOnly, {
      id: 'save-note',
      label: 'Guardar versión con una nota…',
      icon: NotebookPen,
      onSelect: () => setSaveOpen(true),
      hint: 'Qué has cambiado, para quien revise después',
      testId: 'editor-save-note',
    }),
    {
      id: 'history',
      label: 'Historial',
      icon: History,
      onSelect: () => setHistoryOpen(true),
      testId: 'editor-history',
    },
    null,
    ...forward.map(statusItem),
    null,
    ...when<MoreAction>(canEdit && !item.archived_at, {
      id: 'settings',
      label: 'Nombre y red',
      icon: PencilLine,
      onSelect: () => setSettingsOpen(true),
      hint: 'Cambiar el nombre, la red o el formato',
      testId: 'editor-settings',
    }),
    ...when<MoreAction>(!readOnly, {
      id: 'template',
      label: 'Desde una plantilla',
      icon: LayoutTemplate,
      onSelect: () => setTemplateOpen(true),
      hint: 'Sustituir el diseño por una plantilla de la marca',
      testId: 'editor-from-template',
    }),
    ...when<MoreAction>(!readOnly, {
      id: 'save-template',
      label: 'Guardar como plantilla…',
      icon: LayoutTemplate,
      onSelect: () => setSaveTemplateOpen(true),
      hint: 'Guardar este diseño para empezar otras piezas con él',
      disabled: allLayers(state.document).length === 0,
      testId: 'editor-save-template',
    }),
    null,
    ...backward.map(statusItem),
    ...when<MoreAction>(canEdit && !item.archived_at, {
      id: 'archive',
      label: 'Archivar',
      icon: Archive,
      onSelect: () => setConfirmArchive(true),
      destructive: true,
      testId: 'editor-archive',
    }),
  ];

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
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col gap-2" data-testid="editor-root">
      {/* Cabecera en una línea: dónde estoy, estado y versión; a la derecha, guardar, la acción principal y «⋯» */}
      <header className="flex shrink-0 items-center gap-2" data-testid="editor-header">
        <Link
          to={paths.list}
          onClick={leave}
          className="inline-flex shrink-0 items-center gap-0.5 text-sm text-muted hover:text-fg"
          data-testid="editor-back"
          aria-label="Volver a Contenidos"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="max-md:sr-only">Contenidos</span>
        </Link>
        <h1 className="min-w-0 shrink truncate text-base font-semibold" data-testid="editor-title">
          {item.title}
        </h1>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted">
          <span className="hidden md:inline">{targetLabel(item.network, item.format)}</span>
          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
          {item.archived_at && <Badge tone="warning">Archivada</Badge>}
          {aiLabel && (
            <span
              title={describeAiReasons(aiReasons) || 'Lleva contenido generado con IA.'}
              data-testid="editor-ai-label"
              className="hidden sm:inline"
            >
              <Badge tone="primary">Generado con IA</Badge>
            </span>
          )}
          <span className="hidden lg:inline">
            <ContentRequestOrigin item={item} />
          </span>
          <span data-testid="editor-version" className="hidden sm:inline">
            {expectedVersion > 0 ? `Versión ${expectedVersion}` : 'Sin versiones todavía'}
          </span>
          {/* Qué pasa con lo último que se ha hecho: se guarda solo. */}
          {!readOnly &&
            (dirty ? (
              <span
                role="status"
                // En el móvil va lo primero y solo con el icono: es lo que no debe quedar recortado.
                className={cn(
                  'flex shrink-0 items-center gap-1 max-sm:order-first',
                  autosave.status === 'error' && 'font-medium text-warning',
                )}
                title={
                  autosave.status === 'error'
                    ? 'No se ha podido guardar el borrador. Comprueba la conexión; «Guardar versión» también lo intenta.'
                    : 'Tus cambios se guardan solos como borrador. «Guardar versión» los deja en el historial: es lo que se aprueba y se publica.'
                }
                data-testid="editor-dirty"
                data-state={autosave.status}
              >
                {autosave.status === 'error' ? (
                  <>
                    <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="max-sm:sr-only">Sin guardar</span>
                    <button
                      type="button"
                      className="rounded underline underline-offset-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={autosave.retry}
                      data-testid="editor-save-retry"
                    >
                      Reintentar
                    </button>
                  </>
                ) : autosave.status === 'saved' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="max-sm:sr-only">Borrador guardado</span>
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-current motion-reduce:animate-none" aria-hidden />
                    <span className="max-sm:sr-only">Guardando…</span>
                  </>
                )}
              </span>
            ) : (
              expectedVersion > 0 && (
                <span
                  role="status"
                  className="flex shrink-0 items-center gap-1 max-sm:order-first"
                  data-testid="editor-saved"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="max-sm:sr-only">Guardado</span>
                </span>
              )
            ))}
          {emptyFrames.length > 0 && !readOnly && (
            <button
              type="button"
              className="hidden shrink-0 rounded-full bg-warning-soft px-2 py-0.5 font-medium text-warning hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:inline"
              title="Un hueco de foto vacío no sale en la imagen. Pulsa para ir a él."
              onClick={() => {
                dispatch({ type: 'select', id: emptyFrames[0]!.layer.id, exact: true });
                setPanel('layer');
              }}
              data-testid="editor-empty-frames"
            >
              {emptyFrames.length === 1 ? 'Falta 1 foto' : `Faltan ${emptyFrames.length} fotos`}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5" data-testid="page-actions">
          {!readOnly && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2.5"
              onClick={saveNow}
              loading={mutations.saveVersion.isPending}
              disabled={!dirty && expectedVersion > 0}
              title={
                !dirty && expectedVersion > 0
                  ? 'No hay cambios que guardar'
                  : 'Guarda una versión en el historial (Ctrl+S). Es lo que se aprueba y se publica.'
              }
              data-testid="editor-save"
            >
              <Save className="h-4 w-4" aria-hidden />
              <span className="max-sm:sr-only">Guardar versión</span>
            </Button>
          )}
          {primaryButton}
          {/* Lo que se hace al terminar, en un solo sitio: ver cómo queda, descargarla, programarla o publicarla. */}
          <Dropdown.Root modal={false}>
            <Dropdown.Trigger asChild>
              <Button
                variant={primaryButton ? 'secondary' : 'primary'}
                size="sm"
                className="h-8 px-2.5"
                data-testid="editor-share"
                title="Vista previa, descargar, programar y publicar"
              >
                <Share2 className="h-4 w-4" aria-hidden />
                <span className="max-md:sr-only">Publicar o compartir</span>
                <ChevronDown className="h-3.5 w-3.5 max-md:hidden" aria-hidden />
              </Button>
            </Dropdown.Trigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => setPreviewOpen(true)} data-testid="editor-preview">
                <ScanEye className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">Ver cómo quedará</span>
              </MenuItem>
              <MenuItem onSelect={() => setExportOpen(true)} data-testid="editor-export">
                <Download className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">Descargar la imagen</span>
              </MenuItem>
              {(offerSchedule || offerPublishNow) && <MenuSeparator />}
              {offerSchedule && (
                <MenuItem
                  onSelect={() => void openSchedule()}
                  disabled={busyStatus !== null || mutations.saveVersion.isPending}
                  title={needsApproval ? 'Guarda la versión, la aprueba y abre el calendario' : undefined}
                  data-testid="editor-schedule"
                >
                  <CalendarPlus className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{needsApproval ? 'Aprobar y programar…' : 'Programar…'}</span>
                </MenuItem>
              )}
              {offerPublishNow && (
                <MenuItem
                  onSelect={() => void openPublishNow()}
                  disabled={busyStatus !== null || mutations.saveVersion.isPending}
                  title={
                    needsApproval
                      ? 'Guarda la versión, la aprueba y pide confirmación antes de publicar'
                      : 'Pide confirmación antes de publicar'
                  }
                  data-testid="editor-publish-now"
                >
                  <Send className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{needsApproval ? 'Aprobar y publicar ahora…' : 'Publicar ahora…'}</span>
                </MenuItem>
              )}
              {publishable && !offerSchedule && (
                <p className="max-w-[16rem] px-2.5 py-1.5 text-xs text-muted" data-testid="editor-share-note">
                  Para programarla o publicarla, antes tiene que aprobarla alguien con permiso.
                </p>
              )}
            </MenuContent>
          </Dropdown.Root>
          <MoreMenu items={moreActions} label="Más acciones de la pieza" testId="editor-more" size="sm" />
        </div>
      </header>

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
      <MissingAssetsNotice count={missingAssets} readOnly={readOnly} />
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
        <div
          className="flex shrink-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
          role="toolbar"
          aria-label="Herramientas del editor"
        >
          <span className="mr-1 text-xs font-medium text-muted">Añadir</span>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-2.5"
            disabled={full}
            onClick={() =>
              dispatch({
                type: 'add',
                layer: newTextLayer(canvas, everyLayer, {
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
            className="h-8 px-2.5"
            disabled={full}
            onClick={() => setImagePicker(true)}
            data-testid="add-image"
          >
            <ImageIcon className="h-4 w-4" aria-hidden />
            Imagen
          </Button>
          {aiImage && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8 px-2.5"
              disabled={full}
              onClick={() => setImageAi(true)}
              data-testid="add-image-ai"
              title="Generar una imagen con IA"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Con IA
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-2.5"
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
            className="h-8 px-2.5"
            disabled={full}
            onClick={() =>
              dispatch({
                type: 'add',
                layer: newShapeLayer(canvas, everyLayer, 'rectangle', brandStyle.palette[1]?.hex),
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
            className="h-8 px-2.5"
            disabled={full}
            onClick={() =>
              dispatch({
                type: 'add',
                layer: newShapeLayer(canvas, everyLayer, 'ellipse', brandStyle.palette[1]?.hex),
              })
            }
            data-testid="add-ellipse"
          >
            <Circle className="h-4 w-4" aria-hidden />
            Elipse
          </Button>
          <AddStickerSelect
            disabled={full}
            onAdd={(shape) =>
              dispatch({
                type: 'add',
                layer: newShapeLayer(canvas, everyLayer, shape, brandStyle.palette[1]?.hex),
              })
            }
          />
          {voiceCopilot && (
            <Button
              variant={copilotOpen ? 'primary' : 'secondary'}
              size="sm"
              className="h-8 px-2.5"
              aria-pressed={copilotOpen}
              onClick={() => setCopilotOpen((open) => !open)}
              data-testid="copilot-open"
              title="Dicta o escribe lo que quieres cambiar: textos, fotos, capas, páginas…"
            >
              <Mic className="h-4 w-4" aria-hidden />
              Copiloto
            </Button>
          )}
          <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
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
            className="h-8 w-8"
            aria-label="Rehacer"
            title="Rehacer (Ctrl+Mayús+Z)"
            disabled={state.future.length === 0}
            onClick={() => dispatch({ type: 'redo' })}
            data-testid="redo"
          >
            <Redo2 className="h-4 w-4" aria-hidden />
          </Button>
          {full && (
            <span className="text-xs text-muted">
              Has llegado al máximo de {MAX_LAYERS} capas{state.document.pages.length > 1 ? ' en esta página' : ''}.
            </span>
          )}
        </div>
      )}
      {!readOnly && imageAgencyBlocked && (
        <p className="shrink-0 text-xs text-muted" data-testid="image-ai-agency-note">
          En modo agencia, la imagen con IA la usa solo el personal de la agencia: pide la imagen desde «Encargos».
        </p>
      )}
      {!readOnly && voiceCopilot && copilotOpen && (
        <Suspense fallback={<Spinner label="Preparando el copiloto…" />}>
          <VoiceCopilot
            orgId={org.id}
            brandId={brand.id}
            brandName={brand.name}
            document={state.document}
            pageIndex={pageIndex}
            selectedIds={state.selectedIds}
            pageLimits={pageRange}
            allowedRatios={allowed?.ratios ?? null}
            documentAssets={(assets.data ?? []).map((asset) => ({
              id: asset.id,
              name: asset.file_name,
              width: asset.width,
              height: asset.height,
            }))}
            host={copilotHost}
            brand={{
              palette: (profile?.visual.colors ?? []).map((c) => ({ hex: c.hex.toUpperCase(), role: c.role })),
              fonts: brandStyle.fonts,
            }}
            imageTones={imageTones}
            logoIds={logoIds}
            selectedImage={selectedImage}
            libraryPath={`${brandBase}/biblioteca`}
            onApply={(document, touched, index) => {
              // Una orden = un paso de deshacer (y la página en la que deja).
              run({ type: 'replace', document, select: touched, pageId: document.pages[index]?.id });
              setPanel('layer');
            }}
            onClose={() => setCopilotOpen(false)}
          />
        </Suspense>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-3">
        <section
          ref={canvasRef}
          tabIndex={0}
          // Un clic en el margen del lienzo (fuera del documento) quita la selección.
          onPointerDown={(event) => event.target === event.currentTarget && deselect()}
          aria-label="Lienzo. Con capas elegidas, usa las flechas para moverlas y Supr para borrarlas; con un texto elegido, Intro para escribir en él; con una foto, Intro para encuadrarla o, si es un hueco vacío, para ponerle la foto."
          className="flex min-h-0 flex-1 flex-col rounded-xl bg-subtle p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {safeZone && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="safe-zone-bar">
              <Button
                variant={showSafeZone ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={showSafeZone}
                onClick={() => setShowSafeZone((on) => !on)}
                data-testid="safe-zone-toggle"
              >
                <ShieldAlert className="h-4 w-4" aria-hidden />
                Zonas seguras
              </Button>
              {showSafeZone && (
                <span data-testid="safe-zone-note">
                  {safeZone.unsafe.length > 0 && safeZone.safe.top === 0 && safeZone.safe.bottom >= state.document.canvas.height
                    ? `En rojo, lo que se recorta en la rejilla del perfil de ${networkLabel(item.network)}.`
                    : `En rojo, lo que puede tapar la interfaz de ${networkLabel(item.network)}.`}
                  {safeZone.provenance === 'unverified' ? ' Orientativo: la red no publica la cifra.' : ''}
                </span>
              )}
            </div>
          )}
          <div
            className="relative min-h-0 flex-1"
            onPointerDown={(event) => event.target === event.currentTarget && deselect()}
          >
            {brandFonts.status === 'loading' ? (
              <Spinner label="Cargando las tipografías de la marca…" />
            ) : (
              <Suspense fallback={<Spinner label="Preparando el lienzo…" />}>
                <CanvasView
                  document={page}
                  selectedIds={state.selectedIds}
                  readOnly={readOnly}
                  images={images}
                  onSelect={onSelect}
                  onSelectMany={onSelectMany}
                  onChange={onChange}
                  onEditText={onEditText}
                  editingTextId={editingTextId}
                  onTextCommit={onTextCommit}
                  onTextCancel={onTextCancel}
                  onFrameClick={(id) => !readOnly && setReplaceLayerId(id)}
                  onEditImage={startFraming}
                  framingId={activeFramingId}
                  onFrameChange={(id, patch) => dispatch({ type: 'update', id, patch, key: `framing:${id}` })}
                  onFramingEnd={endFraming}
                  toolbar={selectionToolbar}
                  onContextMenu={(target) => {
                    if (target.id && !stateRef.current.selectedIds.includes(target.id)) {
                      run({ type: 'select', id: target.id });
                    } else if (!target.id) {
                      run({ type: 'select', id: null });
                    }
                    setPointMenu({ x: target.clientX, y: target.clientY });
                  }}
                  onDrop={onDropOnCanvas}
                  safeZone={safeZoneOverlay}
                  label={
                    state.document.pages.length > 1
                      ? `Diseño de ${item.title}, página ${pageIndex + 1} de ${state.document.pages.length}, ${layers.length} capas`
                      : `Diseño de ${item.title}, ${layers.length} capas`
                  }
                />
              </Suspense>
            )}
          </div>
          {showPages && (
            <PageStrip
              document={state.document}
              activePageId={state.activePageId}
              limits={pageRange}
              readOnly={readOnly}
              images={stripImages}
              dispatch={dispatch}
            />
          )}
        </section>

        <aside
          className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface px-3 pt-1 lg:shrink lg:px-4"
          aria-label="Paneles del editor"
          data-testid="editor-panels"
          data-open={sheetOpen}
        >
          <Tabs value={panel} onValueChange={setPanel} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <TabsList label="Paneles del editor">
                  <TabsTrigger
                    value="layer"
                    className="px-2.5 max-lg:min-h-[2.75rem]"
                    onClick={() => setSheetOpen(true)}
                  >
                    Diseño
                  </TabsTrigger>
                  <TabsTrigger
                    value="layers"
                    className="px-2.5 max-lg:min-h-[2.75rem]"
                    onClick={() => setSheetOpen(true)}
                  >
                    Capas ({layers.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="copy"
                    className="px-2.5 max-lg:min-h-[2.75rem]"
                    onClick={() => setSheetOpen(true)}
                  >
                    Publicación
                  </TabsTrigger>
                  {BrandCheck && (
                    <TabsTrigger
                      value="brand"
                      className="px-2.5 max-lg:min-h-[2.75rem]"
                      onClick={() => setSheetOpen(true)}
                    >
                      Marca
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>
              {sheetOpen && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 lg:hidden"
                  aria-label="Ocultar el panel"
                  title="Ocultar el panel"
                  onClick={() => setSheetOpen(false)}
                  data-testid="editor-panels-close"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
            {/* Solo este bloque se desplaza: en pantallas estrechas es la hoja abierta (40 % del alto), en anchas, la columna entera. */}
            <div
              className={cn(
                'relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3',
                sheetOpen ? 'max-h-[40dvh] lg:max-h-none' : 'hidden lg:block',
              )}
              data-testid="editor-panel-scroll"
            >
              <TabsContent value="layer" className="space-y-4 pt-3">
                {selectedLayers.length > 1 ? (
                  readOnly ? (
                    <p className="text-sm text-muted">{selectedLayers.length} capas elegidas.</p>
                  ) : (
                    <MultiSelectionPanel layers={selectedLayers} dispatch={dispatch} />
                  )
                ) : (
                  <>
                    <PropertiesPanel
                      layer={selected}
                      canvas={canvas}
                      readOnly={readOnly}
                      dispatch={dispatch}
                      brandStyle={brandStyle}
                      allowedRatios={allowed?.ratios ?? null}
                      textRef={textRef}
                      onEditPhoto={
                        editablePhoto?.url
                          ? () => {
                              setPhotoEditTab('enhance');
                              setPhotoEditing(true);
                            }
                          : undefined
                      }
                      photoTools={photoTools}
                      onPickPhoto={readOnly ? undefined : setReplaceLayerId}
                      onRestoreOriginal={
                        originalPhoto
                          ? () => {
                              dispatch({
                                type: 'update',
                                id: originalPhoto.layerId,
                                patch: { source: { kind: 'asset', assetId: originalPhoto.assetId } },
                              });
                              toast.success('La capa vuelve a la foto original. Se deshace con Ctrl+Z.');
                            }
                          : undefined
                      }
                    />
                    {/* Sin nada elegido, o con un hueco vacío elegido, las fotos de la marca están ahí mismo. */}
                    {!readOnly && (selected === null || isEmptyFrame(selected)) && (
                      <BrandPhotos
                        hint={
                          selected
                            ? 'Toca una foto para ponerla en este hueco.'
                            : 'Toca una foto para ponerla en el diseño, o arrástrala al lienzo o a un hueco.'
                        }
                        onPick={(asset) => {
                          placePhoto(
                            { id: asset.id, name: asset.file_name, width: asset.width, height: asset.height },
                            selected ? { frameId: selected.id } : {},
                          );
                          // En el móvil la hoja tapa medio lienzo: se cierra para ver cómo ha quedado.
                          setSheetOpen(false);
                        }}
                      />
                    )}
                  </>
                )}
              </TabsContent>
              <TabsContent value="layers" className="pt-4">
                <LayersPanel layers={layers} selectedIds={state.selectedIds} readOnly={readOnly} dispatch={dispatch} />
              </TabsContent>
              <TabsContent value="copy" className="space-y-4 pt-4">
                <AskAgencyButton item={item} />
                {captionAi && !readOnly && (
                  <GenerateCaptionDialog
                    brandId={brand.id}
                    network={item.network}
                    format={item.format}
                    currentCopy={state.document.copy}
                    // Un solo paso de deshacer: el texto anterior vuelve con Ctrl+Z.
                    onApply={(copy) => {
                      // Marca de contenido generado con IA (ver content/aiLabel.ts).
                      dispatch({ type: 'setCopy', patch: { ...copy, aiGenerated: true } });
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
                        No se han podido leer los colores de la imagen (el navegador no lo permite para este archivo):
                        la comparación con la paleta de la marca se omite.
                      </Notice>
                    </div>
                  )}
                  {brandCheckAi && (
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
            </div>
          </Tabs>
        </aside>
      </div>

      {previewOpen && (
        <NetworkPreviewDialog
          open
          onOpenChange={setPreviewOpen}
          document={state.document}
          images={images}
          spec={spec}
          targetName={targetLabel(item.network, item.format)}
          accountName={brand.name}
        />
      )}
      {settingsOpen && (
        <PieceSettingsDialog
          open
          onOpenChange={setSettingsOpen}
          current={{ title: item.title, network: item.network, format: item.format }}
          status={item.status}
          canvasRatio={canvas.aspectRatio}
          saving={mutations.update.isPending}
          onSave={saveSettings}
        />
      )}
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
      {canSchedule && scheduleOpen && (
        <ScheduleDialog
          brandId={brand.id}
          open
          onOpenChange={setScheduleOpen}
          initialContentId={contentId}
          // La imagen que se publica se prepara sola al guardar en el calendario, como en «Publicar ahora».
          exportVersion={
            (item.format === 'post' || item.format === 'carousel') && !dirty
              ? { contentId, run: exportApprovedVersion }
              : undefined
          }
        />
      )}
      {canPublishNow && (
        <PublishNowDialog
          brandId={brand.id}
          open={publishNowOpen}
          onOpenChange={setPublishNowOpen}
          contentId={contentId}
          exportVersion={
            (item.format === 'post' || item.format === 'carousel') && !dirty ? exportApprovedVersion : undefined
          }
        />
      )}
      <ExportImageDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        document={state.document}
        images={images}
        title={item.title}
        contentId={contentId}
        orgId={org.id}
        brandId={brand.id}
        version={expectedVersion}
        dirty={dirty}
        canSaveToLibrary={canEdit}
        canSaveVersion={!readOnly}
        onSaveVersion={(note) => save(note)}
        prepareFonts={() => loadBrandFonts(brandFonts.fonts).then(() => undefined)}
        libraryPath={`${brandBase}/biblioteca`}
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
        <ApplyTemplateDialog
          orgId={org.id}
          brandId={brand.id}
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          target={{ network: item.network, format: item.format }}
          currentRatio={canvas.aspectRatio}
          canDelete={canEdit}
          hasDesign={allLayers(state.document).length > 0}
          onApply={(document, template, changes) => {
            dispatch({ type: 'replace', document });
            toast.success(
              changes.length > 0
                ? `Plantilla «${template.name}» adaptada y aplicada. Revisa la composición: ${changes.join(' ')}`
                : `Plantilla «${template.name}» aplicada. Sustituye las fotos y ajusta el texto.`,
              changes.length > 0 ? { duration: 12_000 } : undefined,
            );
          }}
        />
      )}
      {!readOnly && saveTemplateOpen && (
        <SaveTemplateDialog
          open
          onOpenChange={setSaveTemplateOpen}
          brandId={brand.id}
          defaultName={item.title}
          network={item.network}
          format={item.format}
          document={state.document}
          onSaved={(name) => toast.success(`Plantilla «${name}» guardada. La verás en «Desde una plantilla».`)}
        />
      )}
      {!readOnly && (
        <>
          <ImagePickerDialog
            brandId={brand.id}
            libraryPath={`${brandBase}/biblioteca`}
            uploadTo={{ organizationId: org.id }}
            aiRatio={aiImage ? canvas.aspectRatio : undefined}
            open={imagePicker}
            onOpenChange={setImagePicker}
            onPick={(asset) => {
              setImagePicker(false);
              // Con un hueco de foto vacío en la página, la foto va al hueco; si no, es una capa nueva.
              placePhoto({ id: asset.id, name: asset.file_name, width: asset.width, height: asset.height });
            }}
          />
          {/* Poner la foto de un marco o sustituir la de una capa (barra flotante, clic en el hueco, copiloto):
              la caja y los efectos se quedan; lo que era de la foto anterior (recorte, encuadre) se quita. */}
          <ImagePickerDialog
            brandId={brand.id}
            libraryPath={`${brandBase}/biblioteca`}
            uploadTo={{ organizationId: org.id }}
            title={replaceLayer && isEmptyFrame(replaceLayer) ? 'Poner foto' : 'Sustituir la foto'}
            aiRatio={aiImage && replaceLayer ? nearestImageRatio(replaceLayer.width, replaceLayer.height) : undefined}
            open={replaceLayerId !== null}
            onOpenChange={(open) => {
              if (!open) setReplaceLayerId(null);
            }}
            onPick={(asset) => {
              if (replaceLayer?.type === 'image') {
                dispatch({
                  type: 'update',
                  id: replaceLayer.id,
                  patch: {
                    ...replacePhotoPatch(asset.id),
                    // Un marco conserva su nombre («Foto de antes»); una foto suelta toma el del archivo.
                    ...(replaceLayer.frame ? {} : { name: asset.file_name.slice(0, 120) }),
                  },
                });
                dispatch({ type: 'select', id: replaceLayer.id, exact: true });
              }
              setReplaceLayerId(null);
            }}
          />
          {cropLayer?.type === 'image' && cropUrl && (
            <CropDialog
              layer={cropLayer}
              url={cropUrl}
              onClose={() => setCropLayerId(null)}
              onApply={(patch) => {
                dispatch({ type: 'update', id: cropLayer.id, patch });
                dispatch({ type: 'checkpoint' });
                setCropLayerId(null);
              }}
            />
          )}
          <PointMenu
            at={pointMenu}
            items={selectionMenu}
            label="Acciones de lo elegido"
            onClose={() => setPointMenu(null)}
          />
          {aiImage && (
            <GenerateImageDialog
              brandId={brand.id}
              open={imageAi}
              onOpenChange={setImageAi}
              canvasRatio={canvas.aspectRatio}
              // Una capa más: se deshace con Ctrl+Z como cualquier otra; la imagen queda en la biblioteca.
              onGenerated={(image) => {
                setImageAi(false);
                placePhoto(image);
                toast.success('Imagen generada y añadida al diseño. Está también en la biblioteca.');
              }}
            />
          )}
          {photoEditing && editablePhoto && (
            <PhotoEditScreen
              initialTab={photoEditTab === 'portrait' ? 'background' : photoEditTab}
              initialPortrait={photoEditTab === 'portrait'}
              asset={editablePhoto.row}
              url={editablePhoto.url}
              onClose={() => setPhotoEditing(false)}
              // La capa pasa a la foto editada al momento; se deshace con Ctrl+Z o «Volver a la original».
              onApply={(row) => {
                dispatch({
                  type: 'update',
                  id: editablePhoto.layerId,
                  patch: { source: { kind: 'asset', assetId: row.id } },
                });
                setPhotoEditing(false);
                toast.success(
                  'La capa usa ahora la foto editada. Se deshace con Ctrl+Z; la original sigue en la biblioteca.',
                  {
                    action: { label: 'Deshacer', onClick: () => dispatch({ type: 'undo' }) },
                  },
                );
              }}
            />
          )}
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
                layer: newLogoLayer(canvas, everyLayer, {
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
        description="No se ha podido guardar el borrador (¿sin conexión?). Si sales ahora, se pierden los últimos cambios."
        confirmLabel="Salir sin guardar"
        onConfirm={() => {
          setConfirmLeave(false);
          navigate(paths.list);
        }}
      />
    </div>
  );
}
