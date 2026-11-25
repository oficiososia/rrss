import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronLeft,
  CloudOff,
  History,
  Layers,
  LayoutTemplate,
  Mic,
  NotebookPen,
  PencilLine,
  Redo2,
  Ruler,
  SearchX,
  SendHorizontal,
  Share2,
  ShieldAlert,
  Undo2,
} from 'lucide-react';
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
  Notice,
  MoreMenu,
  Spinner,
  type MoreAction,
  type MoreMenuItem,
} from '@/components/ui';
import { aiVoiceCopilotEnabled } from '@/config/app';
import { AiBrandCheck } from '@/features/ai/AiBrandCheck';
import { GenerateCaptionDialog } from '@/features/ai/GenerateCaptionDialog';
import { useImageAgencyBlock } from '@/features/ai/imageApi';
import { nearestImageRatio } from '@/features/ai/useAiImage';
import { canEditPhoto, useOriginalAsset, useSaveEdit } from '@/features/photo-edit/api';
import { canRemoveBackground, describeRemovalError } from '@/features/photo-edit/cutout/remover';
import { runQuickEdit } from '@/features/photo-edit/quickEdit';
import { PhotoEditScreen } from '@/features/photo-edit/PhotoEditScreen';
import { AskAgencyButton, ContentRequestOrigin } from '@/features/requests/ContentRequestPanel';
import { useActiveProfile } from '@/features/brand/api';
import { orderFontOptions } from '@/features/brand/fonts';
import { loadBrandFonts, useBrandFontFaces } from '@/features/brand/fontsApi';
import { publishedText } from '@/features/brandcheck/text';
import type { FindingTarget } from '@/features/brandcheck/types';
import { parseProfile } from '@/features/brand/profile';
import { assetKeys, previewPath, uploadAsset, useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useWorkMode } from '@/features/orgs/workMode';
import type { MediaAssetRow } from '@/lib/database.types';
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
import { ImagePickerDialog } from './editor/AssetPickerDialog';
import { BRAND_CHECK_PANEL } from './editor/brandCheckSlot';
import { imageFilesOf, type DraggedAsset } from './editor/assetDrag';
import { assetIdsOf } from './editor/canvas/nodes';
import { MissingAssetsNotice, useMissingAssetFrames } from './editor/missingAssets';
import { LogoContrastNotice, useLogoContrast } from './editor/useLogoContrast';
import type { CanvasDrop, CanvasViewProps, SafeZoneOverlay } from './editor/canvas/types';
import { canPaste, clipboardIds, copyLayers, pasteLayers } from './editor/clipboard';
import { discardDraft, fetchDraft, useDraftAutosave, type LoadedDraft } from './editor/drafts';
import { emptyFramesOf, frameToFill, newPhotoLayer, replacePhotoPatch } from './editor/frames';
import { activeLayers, activePageIndex, editorReducer, initEditor, type EditorAction } from './editor/history';
import { newImageLayer, newLogoLayer, newShapeLayer, newTextLayer } from './editor/layers';
import { CropDialog } from './editor/panels/CropDialog';
import { PointMenu } from './editor/PointMenu';
import { selectionMenuItems } from './editor/selectionMenu';
import { SelectionToolbar } from './editor/SelectionToolbar';
import { CopyPanel } from './editor/panels/CopyPanel';
import { LayersPanel } from './editor/panels/LayersPanel';
import { PageStrip } from './editor/panels/PageStrip';
import { PropertiesPanel, type BrandStyle } from './editor/panels/PropertiesPanel';
import { PieceSettingsDialog } from './editor/PieceSettingsDialog';
import { NetworkPreview } from './editor/preview/NetworkPreview';
import {
  BrandDrawer,
  EditorPanel,
  EditorRail,
  ElementsDrawer,
  PhotosDrawer,
  UploadsDrawer,
} from './editor/rail/EditorRail';
import { DRAWER_TITLE, type DrawerId } from './editor/rail/drawers';
import { ShareSheet, type ShareAction } from './editor/share/ShareSheet';
import { useWideScreen } from './editor/useWideScreen';
import { SaveVersionDialog } from './editor/SaveVersionDialog';
import { imageUrlOf, mainImageLayer, useImagePalette } from './editor/useImagePalette';
import { VersionsDialog } from './editor/VersionsDialog';
import { ApplyTemplateDialog } from './templates/ApplyTemplateDialog';
import { SaveTemplateDialog } from './templates/SaveTemplateDialog';
import { PublishNowDialog } from '@/features/social/PublishNowDialog';
import { ScheduleDialog } from '@/features/social/ScheduleDialog';
import { useContentPublication, useSocialAccounts } from '@/features/social/api';
import { connectedAccountsPath, EXPORT_PARAM } from '@/features/social/links';

/** `?compartir=1`: abre el editor ya en la hoja «Compartir» (lo usan las plantillas de menús). */
const SHARE_PARAM = 'compartir';
import { PUBLISHABLE_TARGETS } from '@/features/social/calendar';
import { ExportImageDialog } from './export/ExportImageDialog';
import { exportForPublishing } from './export/exportForPublishing';
import { contentPaths, networkLabel, targetLabel } from './labels';
import {
  allowedCanvasRatios,
  formatsOf,
  getFormatSpec,
  recommendedCanvasRatio,
  type NetworkFormatSpec,
} from './networks';
import { reelFromDesign } from './editor/toReel';
import { saveReelDraft } from '@/features/reels/editor/api';
import { safeZoneFor } from './safeZones';
import { STATUS_LABEL, STATUS_TONE, statusActions, statusChangedMessage, type StatusAction } from './status';
import { useFeature, useTextTask } from '@/features/platform/integrations/useFeature';
import { useWorkspaceMode } from '@/layout/workspace';
import type { StickerKind } from './editor/canvas/stickers';
import { cn, formatDateTime } from '@/lib/utils';

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

/** Campo de la hoja «Compartir» al que lleva cada parte del texto señalada por el verificador. */
const COPY_FIELD: Partial<Record<FindingTarget['part'], string>> = {
  caption: 'copy-caption',
  hashtags: 'copy-hashtags',
  mentions: 'copy-mentions',
  altText: 'copy-alt',
};

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));

/**
 * ¿Se lleva el foco lo que se ha pulsado para salir de escribir en el lienzo o de encuadrar
 * (un campo como el del copiloto, un botón…)? Entonces el foco no vuelve al lienzo: antes se lo
 * quitaba y el primer toque en el campo del copiloto no servía (prueba del 24/11/2026, fallo 6).
 */
const takesFocus = (next: Element | null | undefined): boolean =>
  next instanceof HTMLElement &&
  Boolean(next.closest('input, textarea, select, button, a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'));

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

  /** Cajón abierto a la izquierda del lienzo (en el móvil, hoja baja), o ninguno. */
  const [drawer, setDrawer] = useState<Exclude<DrawerId, 'templates'> | null>(null);
  /**
   * Panel a la derecha (en el móvil, hoja baja): los ajustes de lo elegido (se va al soltarlo), las
   * capas o el tamaño y el fondo del lienzo. Solo se abre a petición: no hay panel fijo.
   */
  const [side, setSide] = useState<'layers' | 'canvas' | null>(null);
  /** Capa cuyos ajustes están abiertos («⋯ → Ajustes…»): el panel se va en cuanto deja de ser lo elegido. */
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const wide = useWideScreen();
  /** Hoja «Compartir»: el único camino para sacar la pieza. */
  const [shareOpen, setShareOpen] = useState(() => searchParams.has(SHARE_PARAM));
  /** Lo subido (o creado con IA) desde el cajón «Subidas» en esta sesión, lo último primero. */
  const [uploadedIds, setUploadedIds] = useState<string[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveIssues, setSaveIssues] = useState<DocumentIssue[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(() => searchParams.has(EXPORT_PARAM));
  useEffect(() => {
    if (searchParams.has(EXPORT_PARAM) || searchParams.has(SHARE_PARAM)) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);
  const [publishNowOpen, setPublishNowOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [photoEditing, setPhotoEditing] = useState(false);
  const [photoEditTab, setPhotoEditTab] = useState<'enhance' | 'ai' | 'portrait'>('enhance');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  // Un borrador empezado sobre una versión anterior: otra persona guardó después. Se dice igual que un conflicto.
  const [conflict, setConflict] = useState(() =>
    Boolean(resumed && resumed.baseVersion !== initial.item.current_version),
  );
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<LoadedVersion | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busyStatus, setBusyStatus] = useState<ContentStatus | null>(null);
  /** Texto que se está escribiendo directamente sobre el lienzo. */
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  /** Campo del texto de la publicación que hay que enfocar (al pulsar un hallazgo del verificador). */
  const [focusCopy, setFocusCopy] = useState<{ field: string; range?: FindingTarget['range']; n: number } | null>(null);
  // Con la marca en modo agencia no se redacta con el servicio de IA: se pide a la agencia.
  // Cada botón sale solo si SU tarea tiene proveedor, modelo y precio en el servidor.
  const captionTask = useTextTask('post.caption');
  const brandCheckTask = useTextTask('brand.check');
  const copilotTask = useTextTask('editor.copilot');
  const captionAi = captionTask && brand.ai_mode !== 'agency';
  // Autogestión: sin paso de aprobación a la vista (ver «Compartir»). Agencia: el flujo de siempre.
  const { selfManaged } = useWorkMode();
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

  const openDrawer = (id: DrawerId) => {
    if (id === 'templates') {
      setTemplateOpen(true);
      return;
    }
    setDrawer((open) => (open === id ? null : id));
    if (!wide) {
      setSide(null);
      setSettingsFor(null);
    }
  };
  const openSide = (panel: 'layers' | 'canvas') => {
    setSide((open) => (open === panel ? null : panel));
    setSettingsFor(null);
    if (!wide) setDrawer(null);
  };
  const openSettings = (layerId: string) => {
    setSettingsFor(layerId);
    setSide(null);
    if (!wide) setDrawer(null);
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
  const logoIds = useMemo(() => profile?.visual.logoAssetIds ?? [], [profile]);
  // Logotipo que se vea sobre su fondo (editor/useLogoContrast.tsx): la variante del kit que contrasta.
  const logoContrast = useLogoContrast({
    brandId: brand.id,
    document: state.document,
    logoIds,
    profileReady: profileRow.isSuccess,
    readOnly,
    dispatch,
  });

  // ── Imágenes del documento: recurso → dirección firmada ──
  const assetIdsKey = assetIdsOf(state.document).join(',');
  const assetIds = useMemo(() => (assetIdsKey ? assetIdsKey.split(',') : []), [assetIdsKey]);
  const assets = useAssetsByIds(brand.id, assetIds);
  // Fotos y logotipos borrados de la biblioteca: pasan a ser marcos vacíos «Poner foto» (editor/missingAssets.tsx).
  const missingAssets = useMissingAssetFrames({
    document: state.document,
    assetIds,
    found: assets.data,
    readOnly,
    dispatch,
  });
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

  // «Volver a la original»: la foto de la que sale la de la capa, si es una edición y la original sigue en la biblioteca.
  const originalQuery = useOriginalAsset(brand.id, editablePhoto?.row ?? null);
  const originalPhoto = useMemo(() => {
    if (!editablePhoto) return null;
    return originalQuery.data ? { layerId: editablePhoto.layerId, assetId: originalQuery.data.id } : null;
  }, [editablePhoto, originalQuery.data]);

  // «Quita el fondo» dicho al copiloto: lo mismo que el botón del panel de la foto.
  useEffect(() => {
    if (!editablePhoto || editablePhoto.layerId !== pendingCutout.current || !editablePhoto.url) return;
    pendingCutout.current = null;
    const { row, url, layerId } = editablePhoto;
    const notice = toast.loading('Quitando el fondo…');
    runQuickEdit({ asset: row, url, edit: { kind: 'cutout' }, save: (input) => saveEdit.mutateAsync(input) }).then(
      (result) => {
        dispatch({
          type: 'update',
          id: layerId,
          patch: { source: { kind: 'asset', assetId: result.id }, fit: 'contain' },
        });
        toast.success('Fondo quitado. La foto original sigue en la biblioteca y se deshace con Ctrl+Z.', {
          id: notice,
        });
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

  // El foco se pone en el siguiente fotograma: el campo está en la hoja «Compartir», que se pinta en un portal.
  useEffect(() => {
    if (!focusCopy) return;
    const frame = requestAnimationFrame(() => {
      const field = window.document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
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

  /** Al pulsar un hallazgo del verificador: elegir la capa (se cierra la hoja para verla) o llevar al campo señalado. */
  function selectTarget(target: FindingTarget) {
    if (target.part === 'textLayer' && target.layerId) {
      setShareOpen(false);
      onEditText(target.layerId);
      return;
    }
    if (target.part === 'image' && paletteLayer) {
      setShareOpen(false);
      dispatch({ type: 'select', id: paletteLayer.id });
      return;
    }
    const field = COPY_FIELD[target.part];
    if (field) setFocusCopy((prev) => ({ field, range: target.range, n: (prev?.n ?? 0) + 1 }));
  }

  // ── Lienzo (el envoltorio guarda estas funciones en una referencia: no hace falta memorizarlas) ──
  /** Quita la selección (y, con ella, sus ajustes). */
  const deselect = () => {
    dispatch({ type: 'select', id: null });
  };
  const onSelect: CanvasViewProps['onSelect'] = (id, options) =>
    id === null ? deselect() : dispatch({ type: 'select', id, toggle: options?.toggle });
  const onSelectMany: CanvasViewProps['onSelectMany'] = (ids, additive) =>
    dispatch({ type: 'selectMany', ids, additive });
  const onChange: CanvasViewProps['onChange'] = (changes) => dispatch({ type: 'updateMany', changes });
  /** Doble clic o Intro en un texto: se escribe encima del lienzo (sin permiso de edición, solo se elige). */
  const onEditText = (id: string) => {
    dispatch({ type: 'select', id, exact: true });
    if (!readOnly) setEditingTextId(id);
  };
  const onTextCommit: CanvasViewProps['onTextCommit'] = (id, text, next) => {
    setEditingTextId(null);
    const layer = layers.find((l) => l.id === id);
    if (layer?.type === 'text' && layer.text !== text) dispatch({ type: 'update', id, patch: { text } });
    // El foco vuelve al lienzo, para seguir con el teclado; salvo si se ha pulsado otro campo o botón.
    if (!takesFocus(next)) canvasRef.current?.focus();
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
  function placePhoto(
    asset: DraggedAsset,
    target: { frameId?: string | null; at?: { x: number; y: number } | null } = {},
  ) {
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
  }

  /** Sube fotos del dispositivo a la biblioteca de la marca y las pone en el diseño (soltar o pegar). */
  async function uploadAndPlace(
    files: File[],
    target: { frameId?: string | null; at?: { x: number; y: number } | null } = {},
  ) {
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
      toast.message('Para moverla dentro del marco, pon su encaje en «Llenar» (⋯ → Ajustes…).');
      return;
    }
    // Toda la sesión de encuadre es un solo paso de deshacer.
    run({ type: 'checkpoint' });
    setFramingId(id);
  };
  const endFraming = (next?: Element | null) => {
    setFramingId(null);
    dispatch({ type: 'checkpoint' });
    if (!takesFocus(next)) canvasRef.current?.focus();
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
   * Antes de publicar o programar desde el editor: deja la pieza guardada y aprobada, con los estados
   * que exige la base de datos (set_content_status: se aprueba un borrador o algo en revisión; una idea
   * pasa antes a borrador). Solo se llama cuando la persona puede aprobar. En modo agencia lo dice el
   * propio botón («Aprobar y publicar ahora»); en autogestión no hay paso de aprobación a la vista.
   */
  async function approveForPublishing(): Promise<boolean> {
    const before = expectedVersion;
    const version = await ensureVersion();
    if (version === null) return false;
    // Guardar una versión nueva retira la aprobación (y saca de «idea»): se aprueba la que se va a publicar.
    const saved = version !== before;
    if (item.status === 'approved' && !saved) return true;
    if (item.status === 'idea' && !saved) {
      const draft = await changeStatus('draft', version, true);
      if (!draft) return false;
    }
    const row = await changeStatus('approved', version, true);
    return row?.status === 'approved';
  }

  async function openPublishNow() {
    setShareOpen(false);
    if (needsApproval && !(await approveForPublishing())) return;
    setPublishNowOpen(true);
  }

  async function openSchedule() {
    setShareOpen(false);
    if (needsApproval && !(await approveForPublishing())) return;
    setScheduleOpen(true);
  }

  /** «Copiar el texto»: el pie con sus hashtags, tal como se publicaría. */
  async function copyText() {
    const text = publishedText(state.document.copy.caption, state.document.copy.hashtags).trim();
    if (!text) {
      toast.message('Todavía no hay texto de la publicación que copiar.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Texto copiado: pégalo donde lo vayas a publicar.');
    } catch {
      toast.error('El navegador no ha dejado copiar. Selecciona el texto en el campo y cópialo a mano.');
    }
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

  /**
   * Cambiar el tipo de pieza (Publicación, Carrusel, Historia, Reel…) desde la cabecera. Las capas se
   * recolocan a la proporción del formato nuevo (como «Proporción»), en un paso que se deshace. A Reel,
   * las fotos del diseño pasan a ser los clips del montaje y se abre el editor de reels.
   */
  async function changeFormat(format: string) {
    if (format === item.format) return;
    const next = getFormatSpec(item.network, format);
    if (format === 'reel') {
      const project = reelFromDesign(stateRef.current.document, assets.data ?? []);
      try {
        // Lo hecho hasta ahora queda guardado (el diseño sigue en el historial) antes de pasar a vídeo.
        await autosave.flush();
        await mutations.update.mutateAsync({ contentId, target: { network: item.network, format } });
        if (project.plan.clips.length > 0) await saveReelDraft(contentId, project, expectedVersion);
        toast.success(
          project.plan.clips.length > 0
            ? `Ahora es un reel: sus ${project.plan.clips.length === 1 ? 'foto es el primer clip' : `${project.plan.clips.length} fotos son los clips`}.`
            : 'Ahora es un reel: añade fotos o vídeos al montaje.',
        );
        onReopen();
      } catch (error) {
        toast.error(translateError(error));
      }
      return;
    }
    const message = await saveSettings({ target: { network: item.network, format } });
    if (message) {
      toast.error(message);
      return;
    }
    const media = next?.media.includes('image') ? 'image' : next?.media[0];
    const ratio = next ? recommendedCanvasRatio(next, media)?.ratio : undefined;
    if (ratio && ratio !== stateRef.current.document.canvas.aspectRatio) {
      dispatch({ type: 'setRatio', ratio });
      toast.message(`Lienzo en ${ratio}: las capas se han recolocado. Se deshace con Ctrl+Z.`);
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
  const fullNote = `Has llegado al máximo de ${MAX_LAYERS} capas${state.document.pages.length > 1 ? ' en esta página' : ''}.`;
  /** Huecos de foto todavía vacíos (de todas las páginas): no salen en la imagen. */
  const emptyFrames = useMemo(() => emptyFramesOf(state.document), [state.document]);
  /** Ir al primer hueco vacío (desde la cabecera o desde «Compartir»). */
  const goToEmptyFrame = () => {
    const first = emptyFrames[0];
    if (!first) return;
    setShareOpen(false);
    run({ type: 'selectPage', index: first.page });
    run({ type: 'select', id: first.layer.id, exact: true });
  };

  // ── Añadir (cajones) ──
  const addText = (kind: 'heading' | 'body', fontFamily = brandStyle.fonts[0]) => {
    if (full) return void toast.error(fullNote);
    const layer = newTextLayer(canvas, everyLayer, { fontFamily, color: brandStyle.palette[0]?.hex });
    dispatch({
      type: 'add',
      layer:
        kind === 'heading'
          ? {
              ...layer,
              text: 'Titular',
              fontSize: Math.round(layer.fontSize * 1.6),
              height: Math.round(layer.height * 1.6),
              fontWeight: 700,
            }
          : layer,
    });
    if (!wide) setDrawer(null);
  };
  const addShape = (shape: 'rectangle' | 'ellipse' | StickerKind) => {
    if (full) return void toast.error(fullNote);
    dispatch({ type: 'add', layer: newShapeLayer(canvas, everyLayer, shape, brandStyle.palette[1]?.hex) });
    if (!wide) setDrawer(null);
  };
  const addLogo = (asset: MediaAssetRow) => {
    if (full) return void toast.error(fullNote);
    dispatch({
      type: 'add',
      layer: newLogoLayer(canvas, everyLayer, {
        id: asset.id,
        name: asset.file_name,
        width: asset.width,
        height: asset.height,
      }),
    });
    if (!wide) setDrawer(null);
  };
  /** Una foto del cajón: al hueco elegido, al primero vacío o como capa nueva. En el móvil, la hoja se cierra para verla. */
  const pickPhoto = (asset: MediaAssetRow) => {
    placePhoto({ id: asset.id, name: asset.file_name, width: asset.width, height: asset.height });
    if (!wide) setDrawer(null);
  };
  /** Un color de la marca: a lo elegido (texto, forma) o, sin nada elegido, al fondo del lienzo. */
  const colorTarget =
    selected?.type === 'text'
      ? 'al texto elegido'
      : selected?.type === 'shape'
        ? 'a la forma elegida'
        : selected
          ? 'al fondo (elige un texto o una forma para darle color)'
          : 'al fondo del lienzo';
  const applyBrandColor = (hex: string) => {
    if (selected?.type === 'text') dispatch({ type: 'update', id: selected.id, patch: { color: hex } });
    else if (selected?.type === 'shape') {
      dispatch({
        type: 'update',
        id: selected.id,
        patch:
          selected.fill === null && selected.stroke ? { stroke: { ...selected.stroke, color: hex } } : { fill: hex },
      });
    } else dispatch({ type: 'setBackground', color: hex });
  };

  // ── Barra de acciones sobre lo elegido y menú del botón derecho (la misma lista para los dos) ──
  /** «⋯ → Quitar el fondo»: lo mismo que pide el copiloto (se hace cuando la foto está lista). */
  function removeBackground() {
    if (!editablePhoto) return;
    pendingCutout.current = editablePhoto.layerId;
    setCutoutRequest((n) => n + 1);
  }
  // Las acciones del menú leen el estado al día (`stateRef`, `pendingCutout`) solo cuando se pulsan: es un
  // manejador de eventos, no algo que se lea al pintar.
  // eslint-disable-next-line react-hooks/refs
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
    onRemoveBackground: !readOnly && editablePhoto?.url && canRemoveBackground() ? removeBackground : undefined,
    onRestoreOriginal:
      !readOnly && originalPhoto
        ? () => {
            dispatch({
              type: 'update',
              id: originalPhoto.layerId,
              patch: { source: { kind: 'asset', assetId: originalPhoto.assetId } },
            });
            toast.success('La capa vuelve a la foto original. Se deshace con Ctrl+Z.');
          }
        : undefined,
    onMoreOptions: () => selected && openSettings(selected.id),
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
  // guarda la versión, la aprueba y sigue. Con cambios después de aprobar pasa lo mismo. En
  // autogestión eso es lo normal y no se dice; en modo agencia el botón lo dice («Aprobar y…»).
  const publishable = publishingOn && canEdit && !item.archived_at;
  const needsApproval = item.status !== 'approved' || dirty;
  const canApproveNow =
    canApprove &&
    (item.status === 'draft' ||
      item.status === 'in_review' ||
      dirty ||
      item.status === 'approved' ||
      (selfManaged && item.status === 'idea'));
  const offerPublishNow =
    publishable && PUBLISHABLE_TARGETS.has(`${item.network}:${item.format}`) && (!needsApproval || canApproveNow);
  const offerSchedule = publishable && (!needsApproval || canApproveNow);
  const sharing = busyStatus !== null || mutations.saveVersion.isPending;
  // Sin cuenta conectada de la red no se ofrece publicar ni programar (y no se aprueba nada a medias):
  // se dice antes, con el enlace para conectarla.
  const socialAccounts = useSocialAccounts(brand.id, publishable);
  const noAccount =
    publishable &&
    socialAccounts.isSuccess &&
    !socialAccounts.data.some((account) => account.network === item.network && account.status === 'active');
  // Lo que ya tiene en el calendario: publicada (no se vuelve a ofrecer publicar) o programada.
  const livePublication = useContentPublication(brand.id, contentId, publishingOn);
  const publication = livePublication.data ?? null;
  const alreadyPublished = publication?.status === 'published';
  const publicationInfo = alreadyPublished ? (
    <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success" data-testid="share-published">
      Publicada{publication.published_at ? ` el ${formatDateTime(publication.published_at)}` : ''}.{' '}
      {publication.external_url && (
        <a href={publication.external_url} target="_blank" rel="noreferrer" className="font-medium underline">
          Ver en {networkLabel(item.network)}
        </a>
      )}
      <span className="mt-1 block text-xs">
        No se vuelve a publicar desde aquí: para sacarla otra vez, duplícala en Contenidos.
      </span>
    </p>
  ) : publication?.status === 'scheduled' ? (
    <p className="rounded-lg bg-subtle px-3 py-2 text-sm" data-testid="share-scheduled">
      Programada para el {formatDateTime(publication.scheduled_at)}: todavía no está publicada.
    </p>
  ) : null;
  const sayApprove = !selfManaged && needsApproval;
  const publishNowAction: ShareAction | null =
    offerPublishNow && !noAccount && !alreadyPublished
      ? {
          label: sayApprove ? 'Aprobar y publicar ahora' : 'Publicar ahora',
          onClick: () => void openPublishNow(),
          disabled: sharing,
          title: sayApprove
            ? 'Guarda la versión, la aprueba y pide confirmación antes de publicar'
            : 'Pide confirmación antes de publicar',
        }
      : null;
  const scheduleAction: ShareAction | null =
    offerSchedule && !noAccount && !alreadyPublished
      ? {
          label: sayApprove ? 'Aprobar y programar…' : 'Programar…',
          onClick: () => void openSchedule(),
          disabled: sharing,
          title: sayApprove ? 'Guarda la versión, la aprueba y abre el calendario' : 'Elegir el día y la hora',
        }
      : null;
  const shareBlockedNote = noAccount ? (
    <span data-testid="share-no-account">
      No hay ninguna cuenta de {networkLabel(item.network)} conectada:{' '}
      <Link to={connectedAccountsPath(org.id, brand.id)} className="font-medium text-primary underline">
        conéctala en Marca → Cuentas conectadas
      </Link>
      .
    </span>
  ) : publishable && !offerSchedule && !alreadyPublished ? (
    selfManaged ? (
      'Con tu rol no se puede publicar ni programar en esta marca: pídeselo a quien la gestiona.'
    ) : (
      'Para programarla o publicarla, antes tiene que aprobarla alguien con permiso.'
    )
  ) : null;

  /** Por qué no se puede cambiar de estado ahora (o undefined si se puede). Con cambios sin versión, se guardan antes. */
  const statusBlocked = (action: StatusAction) =>
    action.needsVersion && expectedVersion === 0 && !dirty && allLayers(state.document).length === 0
      ? 'El diseño está vacío'
      : undefined;

  // Modo agencia: el estado de la pieza y sus cambios (enviar a revisión, aprobar, devolver), dentro de
  // «Compartir». En autogestión no hay paso de aprobación a la vista.
  const review =
    !selfManaged && !item.archived_at ? (
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-sm"
        data-testid="share-review"
      >
        <span className="text-muted">Estado:</span>
        <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        <span className="flex-1" aria-hidden />
        {actions.map((action) => {
          const blocked = statusBlocked(action);
          const forward = FORWARD_STATUSES.has(action.to);
          return (
            <Button
              key={action.to}
              size="sm"
              variant={forward ? 'secondary' : 'ghost'}
              disabled={Boolean(blocked) || busyStatus !== null || mutations.saveVersion.isPending}
              loading={busyStatus === action.to}
              title={blocked ?? (dirty ? 'Guarda los cambios como versión y sigue' : undefined)}
              onClick={() => void advance(action)}
              data-testid={`status-${action.to}`}
            >
              {forward ? <SendHorizontal className="h-4 w-4" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
              {action.label}
            </Button>
          );
        })}
      </div>
    ) : null;

  const when = <T,>(condition: boolean, item: T): T[] => (condition ? [item] : []);
  // «⋯» de la cabecera: lo de la pieza que no es sacarla (eso es «Compartir») ni añadir (los cajones).
  const moreActions: MoreMenuItem[] = [
    ...when<MoreAction>(!readOnly, {
      id: 'save-note',
      label: 'Guardar versión con una nota…',
      icon: NotebookPen,
      onSelect: () => setSaveOpen(true),
      hint: 'Los cambios se guardan solos; esto deja una versión con nombre en el historial',
      testId: 'editor-save-note',
    }),
    {
      id: 'history',
      label: 'Historial',
      icon: History,
      onSelect: () => setHistoryOpen(true),
      hint: expectedVersion > 0 ? `Ahora, versión ${expectedVersion}` : 'Sin versiones todavía',
      testId: 'editor-history',
    },
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
      id: 'canvas',
      label: 'Tamaño y fondo',
      icon: Ruler,
      onSelect: () => {
        deselect();
        openSide('canvas');
      },
      hint: 'Proporción del lienzo y color de fondo',
      testId: 'editor-canvas-settings',
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

  const copilotOn = !readOnly && voiceCopilot;
  // La fila del zoom: capas y zonas seguras a la izquierda, el copiloto a la derecha.
  const footerStart = (
    <>
      {/* En el móvil la cabecera no tiene sitio para el aviso de los huecos vacíos: va aquí abajo. */}
      {emptyFrames.length > 0 && !readOnly && (
        <button
          type="button"
          className="shrink-0 rounded-full bg-warning-soft px-2 py-1 text-xs font-medium text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:hidden"
          title="Un hueco de foto vacío no sale en la imagen. Pulsa para ir a él."
          onClick={goToEmptyFrame}
          data-testid="editor-empty-frames-mobile"
        >
          {emptyFrames.length === 1 ? 'Falta 1 foto' : `Faltan ${emptyFrames.length} fotos`}
        </button>
      )}
      <Button
        variant={side === 'layers' ? 'primary' : 'ghost'}
        size="sm"
        className="h-8 px-2"
        aria-pressed={side === 'layers'}
        onClick={() => openSide('layers')}
        title="Capas de la página"
        data-testid="editor-layers"
      >
        <Layers className="h-4 w-4" aria-hidden />
        <span className="max-sm:sr-only">Capas ({layers.length})</span>
      </Button>
      {safeZone && (
        <Button
          variant={showSafeZone ? 'primary' : 'ghost'}
          size="sm"
          className="h-8 px-2"
          aria-pressed={showSafeZone}
          onClick={() => setShowSafeZone((on) => !on)}
          title="Lo que puede tapar la interfaz de la red"
          data-testid="safe-zone-toggle"
        >
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <span className="max-sm:sr-only">Zonas seguras</span>
        </Button>
      )}
    </>
  );
  // Con el panel abierto, el botón redondo no sale: era un segundo micrófono junto al del panel (que ya
  // tiene su micrófono y su «cerrar»), y tapaba una esquina del lienzo.
  const footerEnd = copilotOn && !copilotOpen ? (
    <Button
      variant="secondary"
      size="icon"
      className="h-10 w-10 rounded-full shadow-pop"
      aria-label="Copiloto"
      onClick={() => setCopilotOpen(true)}
      data-testid="copilot-open"
      title="Copiloto: dicta o escribe lo que quieres cambiar (textos, fotos, capas, páginas…)"
    >
      <Mic className="h-4 w-4" aria-hidden />
    </Button>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2',
        // Móvil: a pantalla completa, por encima de la cabecera y de la barra de la app.
        'max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:bg-bg max-lg:px-2 max-lg:pt-2',
      )}
      data-testid="editor-root"
    >
      {/* Cabecera: volver, nombre, guardado (automático), deshacer y rehacer, «⋯» y «Compartir». */}
      <header className="flex shrink-0 items-center gap-1.5" data-testid="editor-header">
        <Link
          to={paths.list}
          onClick={leave}
          className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-md px-1 text-sm text-muted hover:text-fg"
          data-testid="editor-back"
          aria-label="Volver a Contenidos"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="max-md:sr-only">Contenidos</span>
        </Link>
        {/* Nombre y tipo de pieza: en una línea en pantallas anchas; en el móvil, el tipo debajo del nombre. */}
        <div className="flex min-w-0 shrink flex-col sm:flex-row sm:items-center sm:gap-1.5">
          <h1
            className="min-w-0 truncate text-base font-semibold max-sm:text-sm max-sm:leading-tight"
            data-testid="editor-title"
            title={targetLabel(item.network, item.format)}
          >
            {item.title}
          </h1>
          {/* El tipo de pieza, a la vista: cambiarlo recoloca las capas a su proporción (o abre el editor de reels). */}
          {canEdit && !item.archived_at ? (
            <label className="relative shrink-0">
              <span className="sr-only">Tipo de pieza</span>
              <select
                className={cn(
                  'cursor-pointer rounded-md text-xs font-medium text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                  'h-8 max-w-[9.5rem] border border-border bg-surface pl-2 pr-6 hover:bg-subtle',
                  'max-sm:h-6 max-sm:max-w-[9rem] max-sm:border-0 max-sm:bg-transparent max-sm:pl-0 max-sm:text-[11px] max-sm:text-muted',
                )}
                value={item.format}
                disabled={mutations.update.isPending}
                onChange={(event) => void changeFormat(event.target.value)}
                title="Tipo de pieza: al cambiarlo, las capas se recolocan a su proporción"
                data-testid="editor-format"
              >
                {formatsOf(item.network).map((option) => (
                  <option key={option.format} value={option.format}>
                    {option.label}
                    {option.format === item.format ? ` · ${canvas.aspectRatio}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="shrink-0 text-xs text-muted max-sm:text-[11px]" data-testid="editor-format-label">
              {spec?.label ?? item.format} · {canvas.aspectRatio}
            </span>
          )}
        </div>
        <span data-testid="editor-version" className="sr-only">
          {expectedVersion > 0 ? `Versión ${expectedVersion}` : 'Sin versiones todavía'}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted">
          {item.archived_at && <Badge tone="warning">Archivada</Badge>}
          <span className="hidden lg:inline">
            <ContentRequestOrigin item={item} />
          </span>
          {/* Qué pasa con lo último que se ha hecho: se guarda solo. */}
          {!readOnly &&
            (dirty ? (
              <span
                role="status"
                className={cn(
                  'flex shrink-0 items-center gap-1',
                  autosave.status === 'error' && 'font-medium text-warning',
                )}
                title={
                  autosave.status === 'error'
                    ? 'No se ha podido guardar. Comprueba la conexión.'
                    : 'Tus cambios se guardan solos.'
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
                    <span
                      className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-current motion-reduce:animate-none"
                      aria-hidden
                    />
                    <span className="max-sm:sr-only">Guardando…</span>
                  </>
                )}
              </span>
            ) : (
              expectedVersion > 0 && (
                <span role="status" className="flex shrink-0 items-center gap-1" data-testid="editor-saved">
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
              onClick={goToEmptyFrame}
              data-testid="editor-empty-frames"
            >
              {emptyFrames.length === 1 ? 'Falta 1 foto' : `Faltan ${emptyFrames.length} fotos`}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" data-testid="page-actions">
          {!readOnly && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
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
                className="h-9 w-9 max-sm:hidden"
                aria-label="Rehacer"
                title="Rehacer (Ctrl+Mayús+Z)"
                disabled={state.future.length === 0}
                onClick={() => dispatch({ type: 'redo' })}
                data-testid="redo"
              >
                <Redo2 className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )}
          <MoreMenu items={moreActions} label="Más acciones de la pieza" testId="editor-more" size="sm" />
          {item.archived_at && canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleArchive}
              loading={mutations.archive.isPending}
              data-testid="editor-archive"
            >
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              <span className="max-sm:sr-only">Recuperar</span>
            </Button>
          )}
          {/* El único camino para sacar la pieza: vista previa, texto, descargar, publicar, programar y copiar. */}
          <Button
            size="sm"
            className="h-9 px-3"
            onClick={() => setShareOpen(true)}
            data-testid="editor-share"
            title="Vista previa, texto de la publicación, descargar, publicar y programar"
          >
            <Share2 className="h-4 w-4" aria-hidden />
            Compartir
          </Button>
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
      {!readOnly && <LogoContrastNotice faint={logoContrast.faint} />}
      {item.archived_at && (
        <Notice tone="warning">Está archivada: se puede ver, pero no cambiar hasta recuperarla.</Notice>
      )}
      {!canEdit && (
        <Notice>
          {canApprove
            ? 'Puedes revisarla y cambiar su estado (en «Compartir»), pero no editarla.'
            : `Solo lectura: con tu rol (${role === 'viewer' ? 'solo lectura' : role}) no se puede editar.`}
        </Notice>
      )}
      {videoOnly && <Notice>Formato de vídeo: aquí se prepara la imagen de portada.</Notice>}
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
            }}
            onClose={() => setCopilotOpen(false)}
          />
        </Suspense>
      )}

      {/* Cuerpo: riel de cajones | cajón abierto | copiloto | lienzo | panel a petición. En el móvil, en
          columna: el lienzo arriba, las hojas debajo y la barra de cajones abajo del todo. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-3">
        {!readOnly && <EditorRail active={drawer} onToggle={openDrawer} className="max-lg:order-last max-lg:-mx-2" />}
        {!readOnly && drawer && (
          <EditorPanel
            title={DRAWER_TITLE[drawer]}
            testId={`drawer-panel-${drawer}`}
            storageKey="rrss.editor.ancho.cajon"
            onClose={() => setDrawer(null)}
            closeLabel="Cerrar el cajón"
          >
            {drawer === 'elements' && (
              <ElementsDrawer
                full={full}
                fullNote={fullNote}
                onAddText={(kind) => addText(kind)}
                onAddShape={addShape}
              />
            )}
            {drawer === 'photos' && (
              <PhotosDrawer
                hint={
                  selected && isEmptyFrame(selected)
                    ? 'Toca una foto para ponerla en el hueco elegido.'
                    : 'Toca una foto para ponerla en el diseño, o arrástrala al lienzo o a un hueco.'
                }
                onPick={pickPhoto}
              />
            )}
            {drawer === 'uploads' && (
              <UploadsDrawer
                brandId={brand.id}
                uploadedIds={uploadedIds}
                aiRatio={aiImage ? canvas.aspectRatio : undefined}
                onAdded={(asset) => {
                  setUploadedIds((ids) => [asset.id, ...ids.filter((id) => id !== asset.id)]);
                  pickPhoto(asset);
                }}
                onPick={pickPhoto}
              />
            )}
            {drawer === 'brand' && (
              <BrandDrawer
                brandId={brand.id}
                logoIds={logoIds}
                profilePath={`${brandBase}/marca`}
                palette={brandStyle.palette}
                fonts={brandStyle.fonts}
                colorTarget={colorTarget}
                full={full}
                onAddLogo={addLogo}
                onColor={applyBrandColor}
                onFont={(font) => addText('body', font)}
              />
            )}
          </EditorPanel>
        )}
        {/* Hueco del copiloto (se pinta aquí por un portal): columna junto al lienzo en escritorio, hoja baja en móvil. */}
        <div
          data-copilot-dock
          className="min-h-0 empty:hidden max-lg:max-h-[30vh] max-lg:shrink-0 lg:w-[17rem] lg:shrink-0"
        />

        <section
          ref={canvasRef}
          tabIndex={0}
          // Un clic en el margen del lienzo (fuera del documento) quita la selección.
          onPointerDown={(event) => event.target === event.currentTarget && deselect()}
          aria-label="Lienzo. Con capas elegidas, usa las flechas para moverlas y Supr para borrarlas; con un texto elegido, Intro para escribir en él; con una foto, Intro para encuadrarla o, si es un hueco vacío, para ponerle la foto."
          className="flex min-h-0 flex-1 flex-col rounded-xl bg-subtle p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-lg:order-first"
        >
          {safeZone && showSafeZone && (
            <p className="mb-2 text-xs text-muted" data-testid="safe-zone-note">
              {safeZone.unsafe.length > 0 &&
              safeZone.safe.top === 0 &&
              safeZone.safe.bottom >= state.document.canvas.height
                ? `En rojo, lo que se recorta en la rejilla del perfil de ${networkLabel(item.network)}.`
                : `En rojo, lo que puede tapar la interfaz de ${networkLabel(item.network)}.`}
              {safeZone.provenance === 'unverified' ? ' Orientativo: la red no publica la cifra.' : ''}
            </p>
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
                  footerStart={footerStart}
                  footerEnd={footerEnd}
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

        {side === 'layers' && (
          <EditorPanel
            title="Capas"
            testId="side-panel-layers"
            side="right"
            storageKey="rrss.editor.ancho.panel"
            onClose={() => setSide(null)}
            closeLabel="Cerrar las capas"
            closeTestId="side-close"
          >
            <LayersPanel layers={layers} selectedIds={state.selectedIds} readOnly={readOnly} dispatch={dispatch} />
          </EditorPanel>
        )}
        {side === 'canvas' && !readOnly && (
          <EditorPanel
            title="Tamaño y fondo"
            testId="side-panel-canvas"
            side="right"
            storageKey="rrss.editor.ancho.panel"
            onClose={() => setSide(null)}
            closeTestId="side-close"
          >
            <PropertiesPanel
              layer={null}
              canvas={canvas}
              readOnly={readOnly}
              dispatch={dispatch}
              brandStyle={brandStyle}
              allowedRatios={allowed?.ratios ?? null}
            />
          </EditorPanel>
        )}
        {/* Los ajustes de lo elegido se van al soltarlo (o al elegir varias cosas: entonces manda el «⋯»). */}
        {settingsFor !== null && selected?.id === settingsFor && selectedLayers.length === 1 && !readOnly && (
          <EditorPanel
            title="Ajustes"
            testId="side-panel-settings"
            side="right"
            storageKey="rrss.editor.ancho.panel"
            onClose={() => setSettingsFor(null)}
            closeLabel="Cerrar los ajustes"
            closeTestId="side-close"
            wide
          >
            <PropertiesPanel
              layer={selected}
              canvas={canvas}
              readOnly={readOnly}
              dispatch={dispatch}
              brandStyle={brandStyle}
              allowedRatios={allowed?.ratios ?? null}
            />
          </EditorPanel>
        )}
      </div>

      <ShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        preview={
          shareOpen ? (
            <NetworkPreview document={state.document} images={images} spec={spec} accountName={brand.name} compact />
          ) : null
        }
        text={
          <div className="space-y-3">
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
          </div>
        }
        brandCheck={
          BrandCheck ? (
            <>
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
              {brandCheckAi && (
                <div className="mt-4 space-y-2 border-t border-border pt-3">
                  <h3 className="text-sm font-semibold">Tono con IA</h3>
                  <p className="text-xs text-muted">
                    Revisa el tono y los temas vetados del texto de la publicación. Ayuda a revisar; no aprueba.
                  </p>
                  <AiBrandCheck
                    brandId={brand.id}
                    text={publishedText(state.document.copy.caption, state.document.copy.hashtags)}
                  />
                </div>
              )}
            </>
          ) : null
        }
        review={
          publicationInfo || review ? (
            <>
              {publicationInfo}
              {review}
            </>
          ) : null
        }
        aiNote={aiLabel ? describeAiReasons(aiReasons) || 'lleva contenido generado con IA.' : null}
        missingPhotos={emptyFrames.length}
        onGoToMissing={goToEmptyFrame}
        publishNow={publishNowAction}
        schedule={scheduleAction}
        blockedNote={shareBlockedNote}
        onDownload={() => {
          setShareOpen(false);
          setExportOpen(true);
        }}
        onCopyText={() => void copyText()}
      />
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
            (item.format === 'post' || item.format === 'carousel' || item.format === 'story') && !dirty
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
            (item.format === 'post' || item.format === 'carousel' || item.format === 'story') && !dirty
              ? exportApprovedVersion
              : undefined
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
            logoContrast.adopt(document);
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
          onSaved={(name) => toast.success(`Plantilla «${name}» guardada. La verás en el cajón «Plantillas».`)}
        />
      )}
      {!readOnly && (
        <>
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
