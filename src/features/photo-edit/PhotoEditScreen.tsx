// «Editar foto» a PANTALLA COMPLETA dentro de la propia página (no es una
// ventana emergente), desde la ficha de la biblioteca o desde una capa de imagen
// del editor (docs/edicion-fotos.md, §11 y §15). La foto, lo más grande posible, y
// los ajustes en una columna a la derecha; en el móvil, las pestañas arriba, la
// foto en medio y los ajustes en una hoja baja (sin scroll de página). Tres
// pestañas, y cada acción en un solo sitio:
//   · Ajustar   «Mejorar automáticamente» con su intensidad; Luz, Contraste,
//               Color y Calidez a la vista y el resto en «Más ajustes», SIN IA;
//   · Recortar  la foto entera, 1:1, 4:5 o 9:16, siempre con encuadre
//               inteligente, SIN IA (y «Ampliar con IA» si el servidor puede).
//               Ajustar y Recortar van juntos: se guardan en una sola copia;
//   · Fondo     Quitar (en el navegador, gratis; o con IA) y poner uno liso, de
//               la marca o de la biblioteca; Desenfocar (modo retrato); y
//               Cambiar con IA (el resultado se ve antes de aplicarlo).
// «Mejorar con IA» no se ofrece (la IA solo crea fondos): ver HIDDEN_AI_OPERATIONS.
// Lo de IA solo sale con `VITE_AI_PHOTO_EDIT_ENABLED` y si el servidor tiene
// modelo para esa acción. Cada resultado es un recurso NUEVO de la biblioteca,
// con su procedencia; la foto original no se toca nunca. Desde el editor, el
// botón principal es «Aplicar a la capa» (la capa pasa a usar la copia y se
// deshace con Ctrl+Z); desde la biblioteca, «Guardar copia», con «Deshacer».
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Eraser,
  Eye,
  ImagePlus,
  Maximize2,
  Paintbrush,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Badge, Button, Notice, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { DictableField } from '@/features/ai/DictableField';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { useGenerationProgress } from '@/features/ai/imageApi';
import { formatMicros } from '@/features/ai/money';
import { useActiveProfile } from '@/features/brand/api';
import { BrandContext, OrgContext } from '@/features/orgs/context';
import { useWorkMode } from '@/features/orgs/workMode';
import { parseProfile } from '@/features/brand/profile';
import { ImagePickerDialog } from '@/features/content/editor/AssetPickerDialog';
import { assetKeys, deleteAssets, useSignedUrls } from '@/features/library/api';
import type { MediaAssetRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  AI_OPERATION_LABEL,
  blobToBase64,
  canEditWithAi,
  fetchAsset,
  signedUrlFor,
  upscaleFactors,
  useAiEdit,
  useAiEditEstimate,
  useAiEditOptions,
  useSaveEdit,
  type AiEditChoice,
  type AiEditInput,
  type AiPhotoOperation,
} from './api';
import { encodePixels, loadCoverPixels, loadPixels, paint, PhotoLoadError } from './canvas';
import { interestMap, NETWORK_ASPECT_LABEL, NETWORK_ASPECTS, smartCrop, type Box, type NetworkAspect } from './framing';
import {
  analyzeImage,
  applyAdjustments,
  AUTO_INTENSITIES,
  autoAdjustments,
  type AutoIntensity,
  cropPixels,
  downscale,
  isNeutral,
  NEUTRAL_ADJUSTMENTS,
  type Adjustments,
  type Pixels,
} from './pixels';
import { EMPTY_AI_REVIEW, existingSubject, spentMicros, type AiCandidate, type AiReview } from './aiBackground';
import { CutoutProgressBar } from './CutoutProgressBar';
import { removalPrivacyNote } from './progressText';
import { aiSubjectFor, backgroundSuggestionsFor, mentionsFood, sectorKindOf, type SectorKind } from './sector';
import { composeCutout } from './cutout/composition';
import { alphaOf, restorePlate, sameAspect, subjectMaskPixels } from './cutout/plate';
import {
  removalSupport,
  describeRemovalError,
  isRemovalCancelled,
  removeBackground,
  type CutoutProgress,
} from './cutout/remover';
import { editedFileName, photoEditProvenance, type PhotoEditStep } from './provenance';
import { portraitBlur, PORTRAIT_DEFAULTS, type PortraitOptions } from './portrait/blur';
import {
  applyStrokes,
  BRUSH_MAX_RADIUS,
  paintSegment,
  veilOver,
  withAlpha,
  type BrushMode,
  type BrushStroke,
} from './portrait/brush';
import { renderRetouch } from './portrait/retouch';

/** Las tres pestañas: Ajustar, Recortar y Fondo. */
type Tab = 'enhance' | 'crops' | 'background';
/**
 * Con qué se abre la pantalla. «ai» y «upscale» son nombres de antes, cuando eran pestañas
 * propias: abren «Fondo → Cambiar con IA» y «Recortar» (donde está «Ampliar con IA»).
 */
export type PhotoEditInitialTab = Tab | 'ai' | 'upscale';
/** Qué se hace con el fondo, dentro de la pestaña «Fondo». */
type BackgroundMode = 'remove' | 'blur' | 'ai';

const TAB_LABEL: Record<Tab, string> = { enhance: 'Ajustar', crops: 'Recortar', background: 'Fondo' };

/**
 * Ediciones con IA que el servidor sabe hacer pero esta pantalla NO ofrece.
 * «Mejorar con IA» (`enhance`) puede cambiar el plato o el producto y choca con la regla de que
 * la IA solo crea fondos (decisión del dueño, 23/11/2026). Su código (aquí y la tarea del
 * servidor en `ai-media`) se conserva: para recuperarla basta con quitarla de esta lista.
 */
const HIDDEN_AI_OPERATIONS: ReadonlySet<AiPhotoOperation> = new Set<AiPhotoOperation>(['enhance']);

/** Nombre del proveedor para la línea «Usa IA (…)», sacado del modelo (`proveedor:modelo`). */
const AI_PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', comfyui: 'servidor propio' };
function aiProviderOf(model: string): string {
  const id = model.split(':')[0] ?? model;
  return AI_PROVIDER_LABEL[id] ?? id;
}

/** Una línea a la vista y el resto plegado detrás de «Más información». */
function MoreInfo({ line, children, testId }: { line: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {line}{' '}
        <span className="whitespace-nowrap font-medium text-fg underline underline-offset-2">Más información</span>
      </summary>
      <div className="mt-1 space-y-1" data-testid={testId}>
        {children}
      </div>
    </details>
  );
}

/** Tipo de negocio de la marca (por su sector y, si hace falta, su descripción), para no suponer siempre un restaurante. */
function useSectorKind(brandId: string): SectorKind {
  const org = useContext(OrgContext);
  const current = useContext(BrandContext);
  const profile = useActiveProfile(brandId);
  const sector =
    current?.brand.id === brandId ? current.brand.sector : org?.brands.find((b) => b.id === brandId)?.sector;
  const description = profile.data ? parseProfile(profile.data.data).business.description : '';
  return useMemo(() => sectorKindOf(sector, description), [sector, description]);
}

export interface PhotoEditScreenProps {
  asset: MediaAssetRow;
  /** Dirección firmada de la foto (si ya se tiene). */
  url?: string;
  /** Vuelve a lo que había antes (la ficha o el editor). */
  onClose: () => void;
  /**
   * Desde el editor: la capa pasa a usar la foto editada. Si se da, el botón
   * principal es «Aplicar a la capa» y quien llama cierra esta pantalla.
   */
  onApply?: (row: MediaAssetRow) => void;
  /** Desde la biblioteca: qué hacer con un resultado (abrirlo en la biblioteca). */
  onResult?: (asset: MediaAssetRow) => void;
  resultLabel?: string;
  /**
   * Máscara del sujeto (el plato), OPCIONAL: devuelve un PNG con las MISMAS
   * medidas que la foto original, donde lo opaco es el plato y lo transparente
   * el fondo. La da quien tenga un recorte (en el navegador o en el servidor).
   * Si no se pasa, «Cambiar el fondo con IA» la saca del recorte del navegador
   * (IS-Net, docs/edicion-fotos.md §9) y, además, vuelve a pegar el plato original
   * sobre el resultado. Si se pasa, se usa esa máscara y el plato no se vuelve a
   * pegar (no hay su recorte aquí). Sin recorte posible, avisa de que la IA puede
   * retocar el plato.
   */
  getSubjectMask?: (asset: MediaAssetRow) => Promise<Blob | null>;
  /** Pestaña con la que se abre (por defecto, «Ajustar»). */
  initialTab?: PhotoEditInitialTab;
  /** En la pestaña «Fondo», con «Desenfocar» (modo retrato) ya elegido. */
  initialPortrait?: boolean;
}

/** El recorte hecho aquí (o el de quien llama) y los retoques a mano de su selección. */
interface CutoutState {
  pixels: Pixels;
  model: string;
  quality?: 'high' | 'basic';
  /** Trazos del pincel sobre la selección del plato (vacío o ausente: sin retoques). */
  strokes?: BrushStroke[];
}
const NO_STROKES: BrushStroke[] = [];

/** Lado mayor de la vista previa: se ve grande y los ajustes siguen siendo instantáneos. */
const PREVIEW_SIDE = 1000;
interface Slider {
  key:
    'exposure' | 'contrast' | 'saturation' | 'warmth' | 'sharpness' | 'shadows' | 'highlights' | 'clarity' | 'vibrance';
  label: string;
  min: number;
}
/** Los cuatro a la vista en «Ajustar». */
const MAIN_SLIDERS: Slider[] = [
  { key: 'exposure', label: 'Luz', min: -100 },
  { key: 'contrast', label: 'Contraste', min: -100 },
  { key: 'saturation', label: 'Color', min: -100 },
  { key: 'warmth', label: 'Calidez', min: -100 },
];
/** Los de «Más ajustes» (plegados). */
const MORE_SLIDERS: Slider[] = [
  { key: 'sharpness', label: 'Nitidez', min: 0 },
  { key: 'shadows', label: 'Sombras (aclarar lo oscuro)', min: -100 },
  { key: 'highlights', label: 'Luces (recuperar lo claro)', min: -100 },
  { key: 'clarity', label: 'Claridad (relieve)', min: -100 },
  { key: 'vibrance', label: 'Viveza (sin pasarse en la carne)', min: -100 },
];

/** Lo de «Ajustar» y «Recortar»: vive en la pantalla para que las dos pestañas guarden UNA copia. */
interface LookState {
  adjustments: Adjustments;
  /** La mejora automática está puesta (y no se ha tocado a mano). */
  auto: boolean;
  /** Lo que había antes de pulsar «Mejorar automáticamente», para volver en un clic. */
  beforeAuto: Adjustments | null;
  /** Cuánto de lo calculado se aplica: suave, normal o fuerte. */
  intensity: AutoIntensity;
  /** Formato del recorte ('' = la foto entera), siempre con encuadre inteligente. */
  framing: NetworkAspect | '';
}
const NEUTRAL_LOOK: LookState = {
  adjustments: NEUTRAL_ADJUSTMENTS,
  auto: false,
  beforeAuto: null,
  intensity: 'normal',
  framing: '',
};

/** Cuadrícula de ajedrez para que se note lo transparente. */
const CHECKER_STYLE = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,.28) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.28) 75%), linear-gradient(45deg, rgba(128,128,128,.28) 25%, transparent 25%, transparent 75%, rgba(128,128,128,.28) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
} as const;

/** Lienzo que pinta unos píxeles (vista previa). */
function PixelsCanvas({
  pixels,
  className,
  testId,
  checker,
}: {
  pixels: Pixels | null;
  className?: string;
  testId?: string;
  checker?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && pixels) paint(ref.current, pixels);
  }, [pixels]);
  return (
    <canvas
      ref={ref}
      className={cn('block h-auto max-w-full', className)}
      style={checker ? CHECKER_STYLE : undefined}
      data-testid={testId}
    />
  );
}

/** Formato del resultado: PNG si hay transparencia o el original lo era; si no, JPEG. */
function outputFormat(
  transparent: boolean,
  sourceMime: string,
): { mime: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg' } {
  return transparent || sourceMime === 'image/png'
    ? { mime: 'image/png', ext: 'png' }
    : { mime: 'image/jpeg', ext: 'jpg' };
}

// ─────────────────────── Lo que comparten la pantalla y sus pestañas ───────────────────────

/** Lo que la pestaña activa ofrece al botón principal de la barra de arriba. */
interface CommitState {
  disabled: boolean;
  /** Hay cambios sin guardar: pedir confirmación antes de salir. */
  dirty: boolean;
  busy: boolean;
  run: () => Promise<void>;
  /** Descarta lo que se lleva hecho en la pestaña. */
  reset: () => void;
}

interface ScreenContextValue {
  /** Donde se pinta la foto grande. */
  stage: HTMLElement | null;
  /** Se mantiene pulsado «Ver la original». */
  comparing: boolean;
  /** La foto original, en el tamaño de la vista previa. */
  before: Pixels;
  setCommit: (commit: CommitState | null) => void;
}

const ScreenContext = createContext<ScreenContextValue | null>(null);

function useScreen(): ScreenContextValue {
  const value = useContext(ScreenContext);
  if (!value) throw new Error('Falta la pantalla de edición');
  return value;
}

/**
 * La pestaña activa dice qué hace el botón principal y si hay cambios sin guardar.
 * Con `enabled` a falso no hay botón principal (p. ej. «Fondo → Cambiar con IA», que decide con
 * sus propios botones «Usar esta» / «Probar otra vez»).
 */
function useCommit(commit: CommitState, enabled = true) {
  const { setCommit } = useScreen();
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  const { disabled, dirty, busy } = commit;
  useEffect(() => {
    if (!enabled) return;
    setCommit({
      disabled,
      dirty,
      busy,
      run: () => latest.current.run(),
      reset: () => latest.current.reset(),
    });
    return () => setCommit(null);
  }, [enabled, disabled, dirty, busy, setCommit]);
}

/** La foto grande: se pinta en el escenario de la pantalla; mantener «Ver la original» enseña la de antes. */
function Stage({ pixels, testId, checker }: { pixels: Pixels | null; testId?: string; checker?: boolean }) {
  const { stage, comparing, before } = useScreen();
  if (!stage) return null;
  return createPortal(
    <PixelsCanvas
      pixels={comparing ? before : (pixels ?? before)}
      className="h-full w-full object-contain"
      testId={testId}
      checker={checker}
    />,
    stage,
  );
}

/** Guarda lo hecho y lo entrega (aplicar a la capa o dejarlo como copia en la biblioteca). */
type SaveEditResult = (pixels: Pixels, steps: PhotoEditStep[], copyMessage: string) => Promise<MediaAssetRow>;

// ─────────────────────────────── La pantalla ───────────────────────────────

export function PhotoEditScreen({
  asset: initial,
  url: initialUrl,
  onClose,
  onApply,
  onResult,
  resultLabel,
  getSubjectMask,
  initialTab,
  initialPortrait,
}: PhotoEditScreenProps) {
  // Se puede pasar a editar un resultado (p. ej., la foto sin fondo para ponerle otro).
  const [asset, setAsset] = useState(initial);
  const signed = useSignedUrls(initialUrl && asset.id === initial.id ? [] : [asset.storage_path]);
  const url = asset.id === initial.id && initialUrl ? initialUrl : signed.data?.get(asset.storage_path);

  // Lo cargado va con su dirección: al cambiar de foto, lo anterior deja de valer sin tocar el estado.
  const [load, setLoad] = useState<{
    url: string;
    result?: { pixels: Pixels; reduced: boolean };
    error?: string;
  } | null>(null);
  const loaded = load && load.url === url ? (load.result ?? null) : null;
  const loadError = load && load.url === url ? (load.error ?? null) : null;
  const [tab, setTab] = useState<Tab>(
    initialTab === 'ai' || initialPortrait
      ? 'background'
      : initialTab === 'upscale'
        ? 'crops'
        : (initialTab ?? 'enhance'),
  );
  // «Fondo»: Quitar, Desenfocar o Cambiar con IA (se conserva al cambiar de pestaña).
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(
    initialPortrait ? 'blur' : initialTab === 'ai' ? 'ai' : 'remove',
  );
  // «Ajustar» y «Recortar» comparten lo hecho: se guarda en una sola copia.
  const [look, setLook] = useState<LookState>(NEUTRAL_LOOK);
  // En el móvil los ajustes son una hoja baja que se puede ocultar para ver la foto entera.
  const [sheetOpen, setSheetOpen] = useState(true);
  const [results, setResults] = useState<Array<{ row: MediaAssetRow; undoable: boolean }>>([]);
  const [commit, setCommit] = useState<CommitState | null>(null);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [comparing, setComparing] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  // El recorte del fondo vive aquí para no perderlo al cambiar de pestaña.
  const [cutout, setCutout] = useState<CutoutState | null>(null);
  // «Fondo con IA»: intentos hechos y el resultado que se está mirando (se conserva al cambiar de pestaña).
  const [aiReview, setAiReview] = useState<AiReview>(EMPTY_AI_REVIEW);
  const sector = useSectorKind(asset.brand_id);
  const save = useSaveEdit(asset.brand_id);
  const queryClient = useQueryClient();
  const aiOptions = useAiEditOptions(asset.brand_id, canEditWithAi(asset));
  const aiChoice = (operation: AiPhotoOperation) =>
    HIDDEN_AI_OPERATIONS.has(operation) ? undefined : aiOptions.data?.find((c) => c.operation === operation);
  const rootRef = useRef<HTMLDivElement>(null);
  const applyMode = Boolean(onApply);

  // Pantalla propia: lo de debajo no recibe foco ni lectores de pantalla; al volver, el foco regresa donde estaba.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.getElementById('root');
    if (app) app.inert = true;
    rootRef.current?.focus();
    return () => {
      if (app) app.inert = false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    loadPixels(url).then(
      (result) => alive && setLoad({ url, result: { pixels: result.pixels, reduced: result.reduced } }),
      (error: unknown) =>
        alive &&
        setLoad({
          url,
          error: error instanceof PhotoLoadError ? error.message : 'No se ha podido abrir la foto para editarla.',
        }),
    );
    return () => {
      alive = false;
    };
  }, [url]);

  const stats = useMemo(() => (loaded ? analyzeImage(loaded.pixels) : null), [loaded]);
  const preview = useMemo(() => (loaded ? downscale(loaded.pixels, PREVIEW_SIDE) : null), [loaded]);
  const map = useMemo(() => (loaded ? interestMap(loaded.pixels) : null), [loaded]);

  const addResult = (row: MediaAssetRow, undoable = false) => {
    setResults((current) => [{ row, undoable }, ...current.filter((r) => r.row.id !== row.id)]);
  };

  /** Codifica y guarda en la biblioteca un resultado hecho en el navegador. */
  const store = async (pixels: Pixels, steps: PhotoEditStep[]) => {
    const transparent = analyzeImage(pixels).transparent;
    const format = outputFormat(transparent, asset.mime_type);
    const blob = await encodePixels(pixels, format.mime);
    return save.mutateAsync({
      source: asset,
      blob,
      fileName: editedFileName(asset.file_name, steps, format.ext),
      width: pixels.width,
      height: pixels.height,
      provenance: photoEditProvenance({ sourceAssetId: asset.id, steps, width: pixels.width, height: pixels.height }),
    });
  };

  const commitEdit: SaveEditResult = async (pixels, steps, copyMessage) => {
    const row = await store(pixels, steps);
    if (onApply) {
      // La copia queda también en «Ediciones»; la capa pasa a usarla.
      onApply(row);
    } else {
      addResult(row, true);
      toast.success(copyMessage);
    }
    return row;
  };

  async function undoResult(row: MediaAssetRow) {
    try {
      await deleteAssets([row.id]);
      setResults((current) => current.filter((r) => r.row.id !== row.id));
      await queryClient.invalidateQueries({ queryKey: assetKeys.all(asset.brand_id) });
      toast.success('Copia deshecha: ya no está en la biblioteca. La original no ha cambiado.');
    } catch (error) {
      toast.error(translateError(error));
    }
  }

  const switchTo = (row: MediaAssetRow) => {
    setAsset(row);
    setCutout(null);
    setAiReview(EMPTY_AI_REVIEW);
    setLook(NEUTRAL_LOOK);
    setTab('background');
    setBackgroundMode('remove');
  };

  const requestClose = () => {
    if (commit?.dirty) setAskDiscard(true);
    else onClose();
  };

  // Si el botón que tenía el foco desaparece (p. ej. «Quitar el fondo» al terminar), el navegador deja el
  // foco en la página y Esc no llegaría a esta pantalla. Dos redes: se devuelve el foco a la pantalla y,
  // si aun así Esc llega al documento con el foco perdido, también cierra.
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });
  useEffect(() => {
    const lost = () => {
      const active = document.activeElement;
      return !active || active === document.body || active === document.documentElement;
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !lost()) return;
      event.preventDefault();
      requestCloseRef.current();
    };
    const root = rootRef.current;
    const onFocusOut = (event: FocusEvent) => {
      // Sin destino = el foco se ha ido a la página (el elemento se quitó o se desactivó).
      if (event.relatedTarget) return;
      setTimeout(() => {
        if (root?.isConnected && lost()) root.focus({ preventScroll: true });
      }, 0);
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    root?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
      root?.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Lo que se teclea aquí no es del editor de debajo (Ctrl+Z, Supr, flechas…).
    event.stopPropagation();
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      requestClose();
    }
  };

  const context = useMemo<ScreenContextValue | null>(
    () => (preview ? { stage, comparing, before: preview, setCommit } : null),
    [stage, comparing, preview],
  );
  const resultAction = onApply ?? onResult;
  const busy = Boolean(commit?.busy) || save.isPending;
  const ready = Boolean(!loadError && loaded && stats && preview && map && context);
  // «Cambiar con IA» solo si el servidor tiene modelo (mientras se pregunta, «Quitar»).
  const effectiveMode: BackgroundMode =
    backgroundMode === 'ai' && !aiChoice('replace_background') ? 'remove' : backgroundMode;

  const body = (
    <div
      ref={rootRef}
      role="region"
      aria-label="Editar foto"
      tabIndex={-1}
      className="fixed inset-0 z-[45] flex flex-col bg-bg text-fg outline-none"
      data-testid="photo-edit"
      onKeyDown={onKeyDown}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Button variant="ghost" size="sm" onClick={requestClose} data-testid="photo-edit-back" title="Volver (Esc)">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver
        </Button>
        <div className="hidden min-w-0 flex-1 sm:block">
          <h2 className="truncate text-sm font-semibold">Editar foto · {asset.file_name}</h2>
          <p className="truncate text-xs text-muted">
            {applyMode
              ? 'Al aplicar, la capa usa la foto editada (se deshace con Ctrl+Z). La original no cambia.'
              : 'La original no cambia: cada resultado se guarda aparte en la carpeta «Ediciones».'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => commit?.reset()}
            disabled={!commit?.dirty || busy}
            data-testid="photo-edit-cancel"
          >
            Cancelar
          </Button>
          {commit && (
            <Button
              size="sm"
              onClick={() => void commit.run()}
              disabled={commit.disabled}
              loading={busy}
              data-testid="photo-edit-save"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {applyMode ? 'Aplicar a la capa' : 'Guardar copia'}
            </Button>
          )}
        </div>
      </header>

      {askDiscard && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 border-b border-border bg-subtle px-3 py-2 text-sm"
          data-testid="photo-edit-discard"
        >
          <span className="mr-auto">Hay cambios sin guardar. ¿Quieres salir y descartarlos?</span>
          <Button size="sm" variant="secondary" onClick={() => setAskDiscard(false)}>
            Seguir editando
          </Button>
          <Button size="sm" onClick={onClose} data-testid="photo-edit-discard-confirm">
            Descartar y volver
          </Button>
        </div>
      )}

      {results.length > 0 && (
        <section
          className="max-h-24 space-y-1 overflow-y-auto border-b border-border bg-primary-soft px-3 py-2"
          aria-label="Guardado en la biblioteca"
          data-testid="photo-edit-results"
        >
          <ul className="space-y-1">
            {results.map(({ row, undoable }) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
                data-testid="photo-edit-result"
              >
                <span className="min-w-0 truncate">
                  <span className="text-muted">Guardado en la biblioteca: </span>
                  {row.file_name}
                </span>
                <span className="flex gap-1">
                  {resultAction && (
                    <Button size="sm" variant="ghost" onClick={() => resultAction(row)} data-testid="photo-edit-use">
                      {onApply ? 'Usar en la capa' : (resultLabel ?? 'Abrir')}
                    </Button>
                  )}
                  {undoable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void undoResult(row)}
                      title="Borra esta copia de la biblioteca"
                      data-testid="photo-edit-undo-save"
                    >
                      <Undo2 className="h-4 w-4" aria-hidden />
                      Deshacer
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Ancho: la foto a la izquierda y, a la derecha, las pestañas encima de los ajustes.
        Móvil: las pestañas arriba, la foto en medio y los ajustes en una hoja baja (hasta el 45 %
        del alto) que se oculta para ver la foto entera. Nunca hay scroll de página: solo se
        desplaza el interior de la hoja (o de la columna).
      */}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[auto_minmax(0,1fr)]"
      >
        <div
          className="flex shrink-0 items-center gap-1 bg-surface px-2 lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border"
          data-testid="photo-edit-tabs"
        >
          {ready && (
            <>
              <div className="min-w-0 flex-1">
                <TabsList label="Ediciones">
                  {(Object.keys(TAB_LABEL) as Tab[]).map((value) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="max-lg:min-h-[2.75rem]"
                      onClick={() => setSheetOpen(true)}
                    >
                      {TAB_LABEL[value]}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 lg:hidden"
                aria-expanded={sheetOpen}
                aria-label={sheetOpen ? 'Ocultar los ajustes' : 'Ver los ajustes'}
                title={sheetOpen ? 'Ocultar los ajustes' : 'Ver los ajustes'}
                onClick={() => setSheetOpen((open) => !open)}
                data-testid="photo-edit-sheet-toggle"
              >
                {sheetOpen ? (
                  <ChevronDown className="h-4 w-4" aria-hidden />
                ) : (
                  <ChevronUp className="h-4 w-4" aria-hidden />
                )}
              </Button>
            </>
          )}
        </div>

        <div className="relative min-h-0 flex-1 bg-subtle lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div
            ref={setStage}
            className="absolute inset-3 flex items-center justify-center"
            data-testid="photo-edit-stage"
          />
          {context && (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="absolute bottom-3 left-3 touch-none select-none"
                aria-pressed={comparing}
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                onPointerCancel={() => setComparing(false)}
                onBlur={() => setComparing(false)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') setComparing(true);
                }}
                onKeyUp={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') setComparing(false);
                }}
                data-testid="photo-edit-compare"
              >
                <Eye className="h-4 w-4" aria-hidden />
                Ver la original (mantén pulsado)
              </Button>
              {comparing && (
                <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs text-white" role="status">
                  Original
                </span>
              )}
            </>
          )}
          {!loadError && !context && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner label="Abriendo la foto…" />
            </div>
          )}
        </div>

        <aside
          className={cn(
            'min-h-0 flex-col border-t border-border bg-surface lg:col-start-2 lg:row-start-2 lg:flex lg:border-l lg:border-t-0',
            sheetOpen ? 'flex max-h-[45dvh] lg:max-h-none' : 'hidden',
          )}
          aria-label="Ajustes"
          data-testid="photo-edit-sheet"
        >
          {/* Una sola zona de desplazamiento: los ajustes. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6" data-testid="photo-edit-panel">
            {loadError ? (
              <div className="pt-4">
                <Notice tone="warning">{loadError}</Notice>
              </div>
            ) : !loaded || !stats || !preview || !map || !context ? null : (
              <ScreenContext.Provider value={context}>
                {loaded.reduced && (
                  <div className="pt-3">
                    <Notice tone="warning">
                      La foto es muy grande: se edita reducida a {loaded.pixels.width} × {loaded.pixels.height} px.
                    </Notice>
                  </div>
                )}
                <TabsContent value="enhance" className="pt-4">
                  <LookTab
                    view="adjust"
                    look={look}
                    setLook={setLook}
                    pixels={loaded.pixels}
                    preview={preview}
                    stats={stats}
                    map={map}
                    onSave={commitEdit}
                    extra={
                      // Oculto (HIDDEN_AI_OPERATIONS): «Mejorar con IA» se queda en el código para poder recuperarlo.
                      aiChoice('enhance') && (
                        <AiAction
                          asset={asset}
                          operation="enhance"
                          choice={aiChoice('enhance')!}
                          onDone={addResult}
                          sector={sector}
                        />
                      )
                    }
                  />
                </TabsContent>
                <TabsContent value="crops" className="pt-4">
                  <LookTab
                    view="crop"
                    look={look}
                    setLook={setLook}
                    pixels={loaded.pixels}
                    preview={preview}
                    stats={stats}
                    map={map}
                    onSave={commitEdit}
                    extra={
                      aiChoice('upscale') && (
                        <section
                          className="space-y-2 border-t border-border pt-4"
                          aria-label="Ampliar con IA"
                          data-testid="photo-edit-upscale"
                        >
                          <h3 className="text-sm font-medium">Ampliar con IA</h3>
                          <AiAction
                            asset={asset}
                            operation="upscale"
                            choice={aiChoice('upscale')!}
                            onDone={addResult}
                            sector={sector}
                          />
                        </section>
                      )
                    }
                  />
                </TabsContent>
                <TabsContent value="background" className="pt-4">
                  <BackgroundTab
                    key={asset.id}
                    asset={asset}
                    pixels={loaded.pixels}
                    transparent={stats.transparent}
                    onSave={commitEdit}
                    cutout={cutout}
                    setCutout={setCutout}
                    mode={effectiveMode}
                    setMode={setBackgroundMode}
                    ai={aiChoice('remove_background')}
                    sector={sector}
                    onAiResult={(row) => {
                      addResult(row);
                      switchTo(row);
                    }}
                    aiSection={
                      aiChoice('replace_background') && (
                        <div className="space-y-6">
                          <Stage
                            pixels={
                              aiReview.candidate && !aiReview.candidate.showBefore ? aiReview.candidate.preview : null
                            }
                            testId="photo-edit-ai-preview"
                          />
                          <AiAction
                            asset={asset}
                            operation="replace_background"
                            choice={aiChoice('replace_background')!}
                            onDone={addResult}
                            getSubjectMask={getSubjectMask}
                            pixels={loaded.pixels}
                            transparent={stats.transparent}
                            cutout={cutout}
                            setCutout={setCutout}
                            sector={sector}
                            review={aiReview}
                            setReview={setAiReview}
                          />
                        </div>
                      )
                    }
                  />
                </TabsContent>
              </ScreenContext.Provider>
            )}
          </div>
        </aside>
      </Tabs>
    </div>
  );

  return createPortal(body, document.body);
}

// ─────────────────────────────── Ajustar y Recortar ───────────────────────────────

/** Nombre corto de cada formato en «Recortar» (el largo va en la ayuda del botón). */
const CROP_HINT: Record<NetworkAspect, string> = { '1:1': 'Cuadrado', '4:5': 'Vertical', '9:16': 'Historia' };

/** Caja de la foto completa pasada al tamaño de la vista previa. */
function scaleBox(box: Box, scale: number): Box {
  return { x: box.x * scale, y: box.y * scale, width: box.width * scale, height: box.height * scale };
}

/** Un deslizador de «Ajustar». */
function AdjustSlider({
  slider,
  value,
  onChange,
}: {
  slider: Slider;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between">
        {slider.label}
        <span className="tabular-nums text-muted">{value}</span>
      </span>
      <input
        type="range"
        min={slider.min}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
        data-testid={`photo-edit-${slider.key}`}
      />
    </label>
  );
}

/**
 * «Ajustar» (`view="adjust"`) y «Recortar» (`view="crop"`): las dos miran y cambian el mismo
 * `LookState` de la pantalla, así que lo ajustado se ve recortado y se guarda en UNA copia.
 */
function LookTab({
  view,
  look,
  setLook,
  pixels,
  preview,
  stats,
  map,
  onSave,
  extra,
}: {
  view: 'adjust' | 'crop';
  look: LookState;
  setLook: Dispatch<SetStateAction<LookState>>;
  pixels: Pixels;
  preview: Pixels;
  stats: ReturnType<typeof analyzeImage>;
  map: ReturnType<typeof interestMap>;
  onSave: SaveEditResult;
  /** Lo de IA que va en esta pestaña (Recortar: «Ampliar con IA»). */
  extra?: ReactNode;
}) {
  const { adjustments, auto, intensity, framing } = look;
  const [busy, setBusy] = useState(false);
  // Los controles responden al instante; la foto grande se rehace en cuanto puede.
  const live = useDeferredValue(adjustments);
  const adjusted = useMemo(() => applyAdjustments(preview, live), [preview, live]);
  const scale = preview.width / pixels.width;
  const box = useMemo(() => (framing ? smartCrop(pixels, framing, map) : null), [pixels, map, framing]);
  const shown = useMemo(() => (box ? cropPixels(adjusted, scaleBox(box, scale)) : adjusted), [adjusted, box, scale]);
  const unchanged = isNeutral(adjustments) && !framing;

  // Miniaturas de cada formato (solo en «Recortar»), con lo ajustado.
  const boxes = useMemo(
    () =>
      view === 'crop'
        ? (Object.fromEntries(NETWORK_ASPECTS.map((a) => [a, smartCrop(pixels, a, map)])) as Record<NetworkAspect, Box>)
        : null,
    [view, pixels, map],
  );
  const thumbs = useMemo(() => {
    if (!boxes) return null;
    const entries = NETWORK_ASPECTS.map((a) => [a, downscale(cropPixels(adjusted, scaleBox(boxes[a], scale)), 160)]);
    return { whole: downscale(adjusted, 160), ...(Object.fromEntries(entries) as Record<NetworkAspect, Pixels>) };
  }, [boxes, adjusted, scale]);

  const reset = useCallback(() => {
    // La intensidad elegida se queda: es una preferencia, no un cambio de la foto.
    setLook((current) => ({ ...NEUTRAL_LOOK, intensity: current.intensity }));
  }, [setLook]);

  /** Cambia la intensidad; si la mejora automática está puesta, se recalcula al momento. */
  function chooseIntensity(next: AutoIntensity) {
    setLook((current) => ({
      ...current,
      intensity: next,
      adjustments: current.auto ? autoAdjustments(stats, AUTO_INTENSITIES[next]) : current.adjustments,
    }));
  }

  function toggleAuto() {
    setLook((current) =>
      current.auto
        ? { ...current, adjustments: current.beforeAuto ?? NEUTRAL_ADJUSTMENTS, beforeAuto: null, auto: false }
        : {
            ...current,
            beforeAuto: current.adjustments,
            adjustments: autoAdjustments(stats, AUTO_INTENSITIES[current.intensity]),
            auto: true,
          },
    );
  }

  function setSlider(key: Slider['key'], value: number) {
    // A mano ya no es la mejora automática tal cual.
    setLook((current) => ({ ...current, adjustments: { ...current.adjustments, [key]: value }, auto: false }));
  }

  async function submit() {
    setBusy(true);
    try {
      const adjust = !isNeutral(adjustments);
      let result = adjust ? applyAdjustments(pixels, adjustments) : pixels;
      const steps: PhotoEditStep[] = [];
      if (adjust) steps.push({ kind: 'adjust', adjustments, auto });
      if (framing && box) {
        result = cropPixels(result, box);
        steps.push({ kind: 'crop', aspect: framing, box, smart: true });
      }
      await onSave(
        result,
        steps,
        adjust && framing
          ? 'Foto ajustada y recortada guardada en la biblioteca. La original no ha cambiado.'
          : framing
            ? 'Recorte guardado en la biblioteca. La original no ha cambiado.'
            : 'Foto mejorada guardada en la biblioteca. La original no ha cambiado.',
      );
      // La siguiente edición parte de cero: nada se arrastra de esta.
      reset();
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  }

  useCommit({ run: submit, disabled: unchanged, dirty: !unchanged, busy, reset });

  if (view === 'crop') {
    const options: Array<{
      value: NetworkAspect | '';
      label: string;
      hint: string;
      title: string;
      thumb: Pixels | undefined;
    }> = [
      {
        value: '',
        label: 'Entera',
        hint: 'Sin recortar',
        title: `Sin recortar (${pixels.width} × ${pixels.height} px)`,
        thumb: thumbs?.whole,
      },
      ...NETWORK_ASPECTS.map((a) => ({
        value: a,
        label: a,
        hint: CROP_HINT[a],
        title: `${NETWORK_ASPECT_LABEL[a]}${boxes ? ` (${boxes[a].width} × ${boxes[a].height} px)` : ''}`,
        thumb: thumbs?.[a],
      })),
    ];
    return (
      <div className="space-y-4">
        <Stage pixels={shown} testId="photo-edit-crop-preview" />
        <MoreInfo line="Se encuadra solo, donde hay más detalle." testId="photo-edit-crop-info">
          <p>
            Es el recorte más grande que cabe en cada formato, colocado donde hay más detalle y color. No usa IA: no
            reconoce objetos, así que con fondos muy cargados mira la vista previa. Para guardar otro formato, repite.
          </p>
        </MoreInfo>
        <fieldset className="grid grid-cols-4 gap-2">
          <legend className="sr-only">Formato del recorte</legend>
          {options.map((option) => {
            const checked = framing === option.value;
            return (
              <label
                key={option.value || 'whole'}
                className={cn(
                  'flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg border p-1.5 text-xs',
                  checked ? 'border-primary bg-primary-soft' : 'border-border',
                )}
                title={option.title}
              >
                <span className="flex h-16 w-full items-center justify-center">
                  <PixelsCanvas pixels={option.thumb ?? null} className="max-h-16 rounded" />
                </span>
                <span className="flex items-center gap-1 font-medium">
                  <input
                    type="radio"
                    name="crop-aspect"
                    checked={checked}
                    onChange={() => setLook((current) => ({ ...current, framing: option.value }))}
                    aria-label={option.title}
                    data-testid={`photo-edit-crop-${option.value || 'none'}`}
                  />
                  {option.label}
                </span>
                <span className="truncate text-muted">{option.hint}</span>
              </label>
            );
          })}
        </fieldset>
        {extra}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Stage pixels={shown} testId="photo-edit-preview" />
      <Button
        variant={auto ? 'primary' : 'secondary'}
        onClick={toggleAuto}
        aria-pressed={auto}
        className="w-full"
        data-testid="photo-edit-auto"
      >
        {auto ? <Undo2 className="h-4 w-4" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}
        {auto ? 'Quitar la mejora automática' : 'Mejorar automáticamente'}
      </Button>
      <div role="radiogroup" aria-label="Intensidad de la mejora" className="flex items-center gap-1 text-sm">
        <span className="mr-1 text-muted">Intensidad</span>
        {(
          [
            ['soft', 'Suave'],
            ['normal', 'Normal'],
            ['strong', 'Fuerte'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={intensity === value ? 'primary' : 'secondary'}
            role="radio"
            aria-checked={intensity === value}
            onClick={() => chooseIntensity(value)}
            data-testid={`photo-edit-intensity-${value}`}
          >
            {label}
          </Button>
        ))}
      </div>
      {MAIN_SLIDERS.map((slider) => (
        <AdjustSlider
          key={slider.key}
          slider={slider}
          value={adjustments[slider.key]}
          onChange={(value) => setSlider(slider.key, value)}
        />
      ))}
      <details className="group space-y-4" data-testid="photo-edit-more-adjustments">
        <summary className="cursor-pointer text-sm font-medium text-muted hover:text-fg">Más ajustes</summary>
        <div className="space-y-4 pt-3">
          {MORE_SLIDERS.map((slider) => (
            <AdjustSlider
              key={slider.key}
              slider={slider}
              value={adjustments[slider.key]}
              onChange={(value) => setSlider(slider.key, value)}
            />
          ))}
        </div>
      </details>
      {extra}
    </div>
  );
}

// ─────────────────────────────── Fondo ───────────────────────────────

/** Qué se pone detrás del plato al quitar el fondo. */
type BackdropChoice =
  { type: 'none' } | { type: 'color'; hex: string } | { type: 'asset'; asset: MediaAssetRow; cover: Pixels };
/** Lo que de verdad se hace: un fondo nuevo, o el modo retrato (desenfocar). */
type BackgroundChoice = BackdropChoice | { type: 'portrait' };

const BACKGROUND_MODE_LABEL: Record<BackgroundMode, string> = {
  remove: 'Quitar',
  blur: 'Desenfocar',
  ai: 'Cambiar con IA',
};

function BackgroundTab({
  asset,
  pixels,
  transparent,
  onSave,
  cutout,
  setCutout,
  mode,
  setMode,
  ai,
  sector,
  onAiResult,
  aiSection,
}: {
  asset: MediaAssetRow;
  pixels: Pixels;
  transparent: boolean;
  onSave: SaveEditResult;
  cutout: CutoutState | null;
  setCutout: (cutout: CutoutState | null) => void;
  /** Quitar, Desenfocar o Cambiar con IA (vive en la pantalla: se conserva al cambiar de pestaña). */
  mode: BackgroundMode;
  setMode: (mode: BackgroundMode) => void;
  /** Quitar el fondo con IA (si el servidor tiene modelo). */
  ai: AiEditChoice | undefined;
  sector: SectorKind;
  onAiResult: (row: MediaAssetRow) => void;
  /** «Cambiar con IA» ya montado (vacío si el servidor no tiene modelo: entonces no se ofrece). */
  aiSection: ReactNode;
}) {
  const profile = useActiveProfile(asset.brand_id);
  const brandColors = useMemo(
    () =>
      (profile.data ? parseProfile(profile.data.data).visual.colors : []).map((c) => ({
        hex: c.hex.toUpperCase(),
        name: c.name,
      })),
    [profile.data],
  );
  const support = useMemo(() => removalSupport(), []);
  const [engine, setEngine] = useState<'browser' | 'ai'>(support.ok || !ai ? 'browser' : 'ai');
  const [progress, setProgress] = useState<CutoutProgress | null>(null);
  const [cutting, setCutting] = useState(false);
  const [cutError, setCutError] = useState<string | null>(null);
  const [shadow, setShadow] = useState(false);
  const [color, setColor] = useState('#FFFFFF');
  const [choice, setChoice] = useState<BackdropChoice>({ type: 'color', hex: '#FFFFFF' });
  const [portrait, setPortrait] = useState<PortraitOptions>(PORTRAIT_DEFAULTS);
  const deferredPortrait = useDeferredValue(portrait);
  const [retouching, setRetouching] = useState(false);
  const [brushMode, setBrushMode] = useState<BrushMode>('add');
  const [brushSize, setBrushSize] = useState(4);
  const [veil, setVeil] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  // La foto con la que se trabaja: la que ya no tiene fondo, o el recorte hecho aquí.
  const hasSubject = transparent || Boolean(cutout);
  // La selección del plato se puede retocar y usar en modo retrato solo con un recorte hecho aquí
  // (necesita los colores de la foto original y un recorte con sus mismas medidas).
  const selectable =
    !transparent && cutout !== null && cutout.pixels.width === pixels.width && cutout.pixels.height === pixels.height;
  const strokes = cutout?.strokes ?? NO_STROKES;
  const modes: BackgroundMode[] = aiSection ? ['remove', 'blur', 'ai'] : ['remove', 'blur'];
  // Desenfocar necesita la selección hecha aquí; una foto que ya viene sin fondo no tiene nada que desenfocar.
  const blurUnavailable = mode === 'blur' && hasSubject && !selectable;
  const effectiveChoice = useMemo<BackgroundChoice>(
    () => (mode === 'blur' && selectable ? { type: 'portrait' } : choice),
    [mode, selectable, choice],
  );
  // Desenfocar se hace siempre en este navegador: el recorte con IA da una foto nueva sin fondo, sin nada que desenfocar.
  const engineNow = mode === 'blur' ? 'browser' : engine;
  const retouched = selectable && strokes.length > 0;
  const prefix: PhotoEditStep[] =
    !transparent && cutout
      ? [
          { kind: 'remove_background', engine: 'browser', model: cutout.model },
          ...(retouched ? [{ kind: 'retouch_selection', strokes: strokes.length } as const] : []),
        ]
      : [];
  const previewOriginal = useMemo(() => downscale(pixels, PREVIEW_SIDE), [pixels]);
  const cutoutPixels = cutout?.pixels ?? null;
  const previewBase = useMemo(
    () => (selectable && cutoutPixels ? downscale(cutoutPixels, PREVIEW_SIDE) : null),
    [selectable, cutoutPixels],
  );
  const previewBaseAlpha = useMemo(() => (previewBase ? alphaOf(previewBase) : null), [previewBase]);
  /** Selección del plato (0-255) con los retoques, en el tamaño de la vista previa. */
  const previewAlpha = useMemo(
    () =>
      previewBase && previewBaseAlpha
        ? applyStrokes(previewBaseAlpha, previewBase.width, previewBase.height, strokes)
        : null,
    [previewBase, previewBaseAlpha, strokes],
  );
  /** El plato a tamaño completo: el recorte tal cual, o con los retoques (colores de la foto original). */
  const fullSubject = (): Pixels => {
    if (transparent) return pixels;
    if (!retouched) return cutout!.pixels;
    return withAlpha(pixels, applyStrokes(alphaOf(cutout!.pixels), pixels.width, pixels.height, strokes));
  };
  const small = useMemo(() => {
    if (!hasSubject) return null;
    if (transparent) return downscale(pixels, PREVIEW_SIDE);
    return retouched && previewAlpha
      ? withAlpha(previewOriginal, previewAlpha)
      : downscale(cutoutPixels!, PREVIEW_SIDE);
  }, [hasSubject, transparent, pixels, retouched, previewAlpha, previewOriginal, cutoutPixels]);
  // La vista previa enseña lo ELEGIDO (color, imagen, retrato o transparente), no un fondo fijo.
  const shown = useMemo(() => {
    if (!small) return null;
    if (effectiveChoice.type === 'none') return small;
    if (effectiveChoice.type === 'portrait') {
      return previewAlpha ? portraitBlur(previewOriginal, previewAlpha, deferredPortrait) : small;
    }
    const backdrop =
      effectiveChoice.type === 'color'
        ? ({ kind: 'color', hex: effectiveChoice.hex } as const)
        : ({ kind: 'image', pixels: downscale(effectiveChoice.cover, PREVIEW_SIDE) } as const);
    return composeCutout(small, backdrop, { shadow });
  }, [small, effectiveChoice, shadow, previewAlpha, previewOriginal, deferredPortrait]);

  /** Atajos del pincel (con el foco en la foto o en el panel): [ y ] tamaño, X cambia añadir/quitar, Ctrl+Z deshace un trazo. */
  const retouchShortcut = (event: ReactKeyboardEvent): boolean => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (strokes.length > 0) setCutout({ ...cutout!, strokes: strokes.slice(0, -1) });
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      setBrushSize((size) => Math.min(15, Math.max(1, size + (event.key === ']' ? 1 : -1))));
      return true;
    }
    if (event.key.toLowerCase() === 'x') {
      event.preventDefault();
      setBrushMode((mode) => (mode === 'add' ? 'remove' : 'add'));
      return true;
    }
    return false;
  };

  const cutAbort = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  async function cut() {
    const abort = new AbortController();
    cutAbort.current = abort;
    setCutting(true);
    setCutError(null);
    setProgress(null);
    try {
      const result = await removeBackground(pixels, setProgress, abort.signal, {
        brandId: asset.brand_id,
        source: asset,
      });
      setCutout({ pixels: result.pixels, model: result.model, quality: result.quality });
    } catch (error) {
      if (!isRemovalCancelled(error)) setCutError(describeRemovalError(error));
    } finally {
      cutAbort.current = null;
      setCutting(false);
      setProgress(null);
      // El recorte en el servidor pasa por la biblioteca (deja y borra un archivo intermedio): se redibuja sola.
      void queryClient.invalidateQueries({ queryKey: assetKeys.all(asset.brand_id) });
    }
  }
  // Salir del diálogo con el recorte en marcha lo cancela (y corta la descarga).
  useEffect(() => () => cutAbort.current?.abort(), []);

  function chooseColor(hex: string) {
    setColor(hex);
    setChoice({ type: 'color', hex });
  }

  async function chooseImage(row: MediaAssetRow, url: string) {
    if (!hasSubject) return;
    setBusy(true);
    try {
      setChoice({ type: 'asset', asset: row, cover: await loadCoverPixels(url, pixels.width, pixels.height) });
    } catch (error) {
      toast.error(error instanceof PhotoLoadError ? error.message : translateError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!hasSubject) return;
    setBusy(true);
    try {
      if (effectiveChoice.type === 'portrait') {
        // El desenfoque se calcula con la foto entera y la selección a tamaño completo, en un worker
        // (una foto de 12 MP son varios segundos de cálculo: en el hilo principal congelaría la pantalla).
        const options = { amount: portrait.amount, progressive: portrait.progressive, dim: portrait.dim };
        const blurred = await renderRetouch({
          kind: 'portrait',
          image: pixels,
          baseAlpha: alphaOf(cutout!.pixels),
          strokes: [...strokes],
          options,
        });
        await onSave(
          blurred,
          [...prefix, { kind: 'portrait_blur', ...options }],
          'Foto en modo retrato guardada en la biblioteca. La original no ha cambiado.',
        );
        return;
      }
      const subject = retouched
        ? await renderRetouch({
            kind: 'subject',
            image: pixels,
            baseAlpha: alphaOf(cutout!.pixels),
            strokes: [...strokes],
          })
        : fullSubject();
      if (effectiveChoice.type === 'none') {
        await onSave(
          subject,
          prefix,
          'Foto sin fondo guardada en la biblioteca (PNG transparente). La original no ha cambiado.',
        );
        return;
      }
      const backdrop =
        effectiveChoice.type === 'color'
          ? ({ kind: 'color', hex: effectiveChoice.hex } as const)
          : ({ kind: 'image', pixels: effectiveChoice.cover } as const);
      await onSave(
        composeCutout(subject, backdrop, { shadow }),
        [
          ...prefix,
          {
            kind: 'background',
            background:
              effectiveChoice.type === 'color'
                ? { type: 'color', hex: effectiveChoice.hex }
                : { type: 'asset', assetId: effectiveChoice.asset.id },
            ...(shadow ? { shadow: true } : {}),
          },
        ],
        'Foto con fondo nuevo guardada en la biblioteca. La original no ha cambiado.',
      );
    } catch (error) {
      toast.error(error instanceof PhotoLoadError ? error.message : translateError(error));
    } finally {
      setBusy(false);
    }
  }

  const reset = useCallback(() => {
    setCutout(null);
    setChoice({ type: 'color', hex: '#FFFFFF' });
    setColor('#FFFFFF');
    setShadow(false);
    setPortrait(PORTRAIT_DEFAULTS);
    setRetouching(false);
  }, [setCutout]);

  useCommit(
    {
      run: submit,
      // Ya sin fondo y sin elegir otro (o sin nada que desenfocar): no hay nada que guardar.
      disabled: !hasSubject || blurUnavailable || (effectiveChoice.type === 'none' && !cutout),
      dirty: Boolean(cutout) && !transparent,
      busy,
      reset,
    },
    // «Cambiar con IA» decide con sus propios botones.
    mode !== 'ai',
  );

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Qué hacer con el fondo" className="flex gap-1">
        {modes.map((value) => (
          <Button
            key={value}
            size="sm"
            role="radio"
            aria-checked={mode === value}
            variant={mode === value ? 'primary' : 'secondary'}
            className="flex-auto whitespace-nowrap px-3"
            onClick={() => setMode(value)}
            disabled={busy || cutting}
            data-testid={`photo-edit-bg-mode-${value}`}
          >
            {BACKGROUND_MODE_LABEL[value]}
          </Button>
        ))}
      </div>
      {mode === 'ai' && aiSection}
      {mode !== 'ai' && !hasSubject && (
        <div className="space-y-3" data-testid="photo-edit-cutout">
          <Stage pixels={null} />
          <p className="text-sm">
            {mode === 'blur'
              ? 'Para desenfocar el fondo, primero se separa lo principal de la foto.'
              : 'Primero se separa lo principal de la foto del fondo.'}
          </p>
          {ai && mode === 'remove' && (
            <fieldset className="space-y-1 text-sm">
              <legend className="sr-only">Cómo quitar el fondo</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cutout-engine"
                  checked={engine === 'browser'}
                  onChange={() => setEngine('browser')}
                  data-testid="photo-edit-engine-browser"
                />
                En este navegador (gratis, sin IA)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="cutout-engine"
                  checked={engine === 'ai'}
                  onChange={() => setEngine('ai')}
                  data-testid="photo-edit-engine-ai"
                />
                Con IA (tiene coste)
              </label>
            </fieldset>
          )}
          {engineNow === 'browser' && (
            <div className="space-y-2" data-testid="photo-edit-cutout-browser">
              {support.ok ? (
                <>
                  <MoreInfo line="Gratis. No usa IA.">
                    <p data-testid="photo-edit-cutout-privacy">{removalPrivacyNote()}</p>
                  </MoreInfo>
                  {cutError && <Notice tone="warning">{cutError}</Notice>}
                  {cutting && <CutoutProgressBar progress={progress} onCancel={() => cutAbort.current?.abort()} />}
                  {!cutting && (
                    <Button onClick={() => void cut()} data-testid="photo-edit-cutout-run">
                      <Eraser className="h-4 w-4" aria-hidden />
                      {mode === 'blur' ? 'Desenfocar el fondo' : 'Quitar el fondo'}
                    </Button>
                  )}
                </>
              ) : (
                <Notice tone="warning">
                  <span data-testid="photo-edit-cutout-unsupported">{support.reason}</span>
                </Notice>
              )}
            </div>
          )}
          {engineNow === 'ai' && ai && (
            <AiAction asset={asset} operation="remove_background" choice={ai} onDone={onAiResult} sector={sector} />
          )}
        </div>
      )}
      {mode !== 'ai' && hasSubject && (
        <div className="space-y-3" data-testid="photo-edit-backgrounds">
          {retouching && selectable && previewBaseAlpha && previewAlpha ? (
            <RetouchStage
              original={previewOriginal}
              baseAlpha={previewBaseAlpha}
              strokes={strokes}
              mode={brushMode}
              radius={Math.min(BRUSH_MAX_RADIUS, brushSize / 100)}
              veil={veil}
              onStroke={(stroke) => setCutout({ ...cutout!, strokes: [...strokes, stroke] })}
              onShortcut={retouchShortcut}
            />
          ) : (
            <Stage pixels={shown} testId="photo-edit-cutout-preview" checker={effectiveChoice.type === 'none'} />
          )}
          {mode === 'remove' && (
            <p className="text-sm">
              {transparent && !cutout ? 'Esta foto ya no tiene fondo.' : 'Fondo quitado.'} Elige uno nuevo:
            </p>
          )}
          {blurUnavailable && (
            <Notice tone="info">
              <span data-testid="photo-edit-blur-unavailable">
                Esta foto ya no tiene fondo: no hay nada que desenfocar. En «Quitar» puedes ponerle uno nuevo.
              </span>
            </Notice>
          )}
          {cutout?.quality === 'basic' && !transparent && (
            <div data-testid="photo-edit-cutout-basic">
              <MoreInfo line="Calidad básica: los bordes finos pueden salir menos limpios.">
                <p>
                  Este navegador no tiene aceleración gráfica (WebGPU) suficiente para el recorte fino, así que se ha
                  usado el modelo ligero. Los bordes de pelo, cristal o salsa pueden salir menos limpios; en Chrome o
                  Edge recientes, con tarjeta gráfica, sale mejor.
                </p>
              </MoreInfo>
            </div>
          )}
          {selectable && (
            <div className="space-y-3" data-testid="photo-edit-portrait">
              {mode === 'blur' && (
                <div className="space-y-3" data-testid="photo-edit-portrait-controls">
                  <label className="block text-sm">
                    <span className="flex justify-between">
                      Intensidad del desenfoque
                      <span className="tabular-nums text-muted">{portrait.amount}</span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={portrait.amount}
                      onChange={(e) => setPortrait((current) => ({ ...current, amount: Number(e.target.value) }))}
                      className="mt-1 w-full"
                      data-testid="photo-edit-portrait-amount"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={portrait.progressive}
                      onChange={(e) => setPortrait((current) => ({ ...current, progressive: e.target.checked }))}
                      data-testid="photo-edit-portrait-progressive"
                    />
                    Más borroso cuanto más lejos de lo principal
                  </label>
                  <label className="block text-sm">
                    <span className="flex justify-between">
                      Resaltar lo principal (oscurece el fondo)
                      <span className="tabular-nums text-muted">{portrait.dim}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={portrait.dim}
                      onChange={(e) => setPortrait((current) => ({ ...current, dim: Number(e.target.value) }))}
                      className="mt-1 w-full"
                      data-testid="photo-edit-portrait-dim"
                    />
                  </label>
                  <p className="text-xs text-muted">
                    Lo principal no se toca. Si el borde no sale bien, retoca la selección.
                  </p>
                </div>
              )}
              <Button
                size="sm"
                variant={retouching ? 'primary' : 'secondary'}
                aria-pressed={retouching}
                onClick={() => setRetouching((on) => !on)}
                disabled={busy}
                data-testid="photo-edit-retouch-toggle"
              >
                <Paintbrush className="h-4 w-4" aria-hidden />
                Retocar la selección
              </Button>
              {retouching && (
                <div
                  className="space-y-3"
                  data-testid="photo-edit-retouch"
                  onKeyDown={(event) => {
                    // Los atajos no se roban a quien escribe en un campo de texto.
                    if (event.target instanceof HTMLInputElement && event.target.type === 'text') return;
                    retouchShortcut(event);
                  }}
                >
                  <p className="text-xs text-muted">Pinta sobre la foto: lo rosa es lo principal; lo demás, fondo.</p>
                  <details className="text-xs text-muted" data-testid="photo-edit-retouch-keys">
                    <summary className="cursor-pointer">Pintar con el teclado</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      <li>Entra en la foto con la tecla Tab: las flechas mueven el pincel (con Mayús, a saltos).</li>
                      <li>Espacio o Intro baja el lápiz y empieza a pintar; otra vez, lo levanta.</li>
                      <li>[ y ] cambian el tamaño del pincel; X cambia entre añadir y quitar.</li>
                      <li>Ctrl+Z deshace el último trazo. Esc levanta el lápiz.</li>
                    </ul>
                  </details>
                  <div role="radiogroup" aria-label="Qué hace el pincel" className="flex flex-wrap gap-1">
                    {(
                      [
                        ['add', 'Añadir a la selección'],
                        ['remove', 'Quitar de la selección'],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        size="sm"
                        role="radio"
                        aria-checked={brushMode === value}
                        variant={brushMode === value ? 'primary' : 'secondary'}
                        onClick={() => setBrushMode(value)}
                        data-testid={`photo-edit-brush-${value}`}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <label className="block text-sm">
                    <span className="flex justify-between">
                      Tamaño del pincel
                      <span className="tabular-nums text-muted">{brushSize}</span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={15}
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      className="mt-1 w-full"
                      data-testid="photo-edit-brush-size"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={veil}
                      onChange={(e) => setVeil(e.target.checked)}
                      data-testid="photo-edit-retouch-veil"
                    />
                    Ver la selección como un velo de color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={strokes.length === 0}
                      onClick={() => setCutout({ ...cutout!, strokes: strokes.slice(0, -1) })}
                      data-testid="photo-edit-retouch-undo"
                    >
                      <Undo2 className="h-4 w-4" aria-hidden />
                      Deshacer el último trazo
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={strokes.length === 0}
                      onClick={() => setCutout({ ...cutout!, strokes: [] })}
                      data-testid="photo-edit-retouch-clear"
                    >
                      Borrar los retoques
                    </Button>
                    <Button size="sm" onClick={() => setRetouching(false)} data-testid="photo-edit-retouch-done">
                      Listo
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {mode === 'remove' && (
            <>
              {brandColors.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Colores de la marca">
                  {brandColors.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-subtle',
                        choice.type === 'color' && choice.hex === c.hex
                          ? 'border-primary bg-primary-soft'
                          : 'border-border',
                      )}
                      aria-pressed={choice.type === 'color' && choice.hex === c.hex}
                      onClick={() => chooseColor(c.hex)}
                      disabled={busy}
                      data-testid="photo-edit-brand-color"
                    >
                      <span
                        className="h-4 w-4 rounded border border-border"
                        style={{ backgroundColor: c.hex }}
                        aria-hidden
                      />
                      {c.name || c.hex}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  Color liso
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => chooseColor(e.target.value.toUpperCase())}
                    data-testid="photo-edit-color"
                  />
                </label>
                <Button size="sm" variant="secondary" onClick={() => setPicking(true)} disabled={busy}>
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  Imagen de la biblioteca
                </Button>
                {choice.type === 'asset' && <Badge tone="neutral">{choice.asset.file_name}</Badge>}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={shadow}
                  onChange={(e) => setShadow(e.target.checked)}
                  disabled={effectiveChoice.type === 'none' || effectiveChoice.type === 'portrait'}
                  data-testid="photo-edit-shadow"
                />
                Sombra suave (para que no parezca flotar)
              </label>
              {cutout && !transparent && (
                <Button
                  size="sm"
                  variant={choice.type === 'none' ? 'primary' : 'ghost'}
                  aria-pressed={choice.type === 'none'}
                  onClick={() => setChoice({ type: 'none' })}
                  disabled={busy}
                  data-testid="photo-edit-cutout-save"
                >
                  Dejarlo sin fondo (PNG transparente)
                </Button>
              )}
            </>
          )}
          <BackgroundPicker
            brandId={asset.brand_id}
            organizationId={asset.organization_id}
            open={picking}
            onOpenChange={setPicking}
            onPick={(row, url) => {
              setPicking(false);
              void chooseImage(row, url);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * La foto grande para retocar la selección: se pinta con un velo de color sobre el plato y
 * el pincel (dedo, lápiz o ratón) añade o quita. Pinta sobre la marcha en una máscara de
 * trabajo y, al soltar, entrega el trazo (coordenadas 0-1) para guardarlo.
 */
function RetouchStage({
  original,
  baseAlpha,
  strokes,
  mode,
  radius,
  veil,
  onStroke,
  onShortcut,
}: {
  original: Pixels;
  baseAlpha: Uint8Array;
  strokes: BrushStroke[];
  mode: BrushMode;
  /** Fracción del lado menor. */
  radius: number;
  veil: boolean;
  onStroke: (stroke: BrushStroke) => void;
  /** Atajos de tamaño, modo y deshacer (los mismos con el foco en el panel o en la foto). */
  onShortcut: (event: ReactKeyboardEvent) => boolean;
}) {
  const { stage } = useScreen();
  const { width, height } = original;
  const wrap = useRef<HTMLDivElement>(null);
  const work = useRef<Uint8Array>(new Uint8Array(0));
  const current = useRef<BrushStroke | null>(null);
  const raf = useRef(0);
  const [frame, setFrame] = useState<Pixels>(original);
  const [ring, setRing] = useState<{ x: number; y: number; size: number } | null>(null);

  const render = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setFrame(veil ? veilOver(original, work.current) : withAlpha(original, work.current));
  }, [original, veil]);

  // La máscara de trabajo es la base con los trazos ya guardados (también tras deshacer).
  useEffect(() => {
    work.current = applyStrokes(baseAlpha, width, height, strokes);
    render();
  }, [baseAlpha, strokes, width, height, render]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /** Posición del puntero en la foto (píxeles) y en pantalla (para el aro del pincel). */
  const locate = (event: { clientX: number; clientY: number }) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    const scale = Math.min(box.width / width, box.height / height);
    const x = (event.clientX - box.left - (box.width - width * scale) / 2) / scale;
    const y = (event.clientY - box.top - (box.height - height * scale) / 2) / scale;
    return { x, y, scale, screenX: event.clientX - box.left, screenY: event.clientY - box.top };
  };
  const radiusPx = radius * Math.min(width, height);

  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(render);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const at = locate(event);
    if (!at) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    current.current = { mode, radius, points: [[at.x / width, at.y / height]] };
    paintSegment(work.current, width, height, [at.x, at.y], [at.x, at.y], radiusPx, mode);
    schedule();
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const at = locate(event);
    if (!at) return;
    setRing({ x: at.screenX, y: at.screenY, size: radiusPx * at.scale * 2 });
    const stroke = current.current;
    if (!stroke) return;
    const last = stroke.points[stroke.points.length - 1]!;
    const from: [number, number] = [last[0] * width, last[1] * height];
    // Puntos a un píxel o más unos de otros: un trazo largo no se llena de puntos de sobra.
    if (Math.hypot(at.x - from[0], at.y - from[1]) < 1) return;
    stroke.points.push([at.x / width, at.y / height]);
    paintSegment(work.current, width, height, from, [at.x, at.y], radiusPx, stroke.mode);
    schedule();
  };
  const finish = () => {
    const stroke = current.current;
    current.current = null;
    setPenDown(false);
    if (stroke) onStroke(stroke);
  };

  // Pintar con el teclado: las flechas mueven el pincel y Espacio (o Intro) baja o levanta el lápiz.
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const [penDown, setPenDown] = useState(false);
  const showRingAt = (x: number, y: number) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const scale = Math.min(box.width / width, box.height / height);
    setRing({
      x: (box.width - width * scale) / 2 + x * scale,
      y: (box.height - height * scale) / 2 + y * scale,
      size: radiusPx * scale * 2,
    });
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      onShortcut(event);
      return;
    }
    const at = (cursor.current ??= { x: width / 2, y: height / 2 });
    const arrow = (
      { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
        string,
        [number, number] | undefined
      >
    )[event.key];
    if (arrow) {
      event.preventDefault();
      const step = Math.max(1, Math.min(width, height) * 0.01) * (event.shiftKey ? 5 : 1);
      const from = { ...at };
      at.x = Math.min(width - 1, Math.max(0, at.x + arrow[0] * step));
      at.y = Math.min(height - 1, Math.max(0, at.y + arrow[1] * step));
      const stroke = current.current;
      if (stroke) {
        stroke.points.push([at.x / width, at.y / height]);
        paintSegment(work.current, width, height, [from.x, from.y], [at.x, at.y], radiusPx, stroke.mode);
        schedule();
      }
      showRingAt(at.x, at.y);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (current.current) finish();
      else {
        current.current = { mode, radius, points: [[at.x / width, at.y / height]] };
        paintSegment(work.current, width, height, [at.x, at.y], [at.x, at.y], radiusPx, mode);
        setPenDown(true);
        schedule();
      }
    } else if (event.key === 'Escape' && current.current) {
      // Esc con el lápiz bajado solo lo levanta (no cierra la pantalla).
      event.preventDefault();
      finish();
    } else if (onShortcut(event)) {
      showRingAt(at.x, at.y);
    }
  };

  if (!stage) return null;
  return createPortal(
    <div
      ref={wrap}
      role="application"
      tabIndex={0}
      aria-label="Foto para retocar la selección. Pasa el dedo o el ratón por encima para pintar. Con el teclado, las flechas mueven el pincel y Espacio empieza o termina de pintar."
      className="relative h-full w-full cursor-crosshair touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      onKeyDown={onKeyDown}
      onFocus={() => {
        const at = (cursor.current ??= { x: width / 2, y: height / 2 });
        showRingAt(at.x, at.y);
      }}
      onBlur={() => {
        if (current.current) finish();
        setRing(null);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => setRing(null)}
      data-testid="photo-edit-retouch-canvas"
    >
      <PixelsCanvas
        pixels={frame}
        className="pointer-events-none h-full w-full object-contain"
        testId="photo-edit-cutout-preview"
        checker={!veil}
      />
      {ring && (
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.7)]"
          style={{ left: ring.x - ring.size / 2, top: ring.y - ring.size / 2, width: ring.size, height: ring.size }}
        />
      )}
      <span className="sr-only" role="status">
        {penDown ? 'Pintando: mueve el pincel con las flechas; Espacio para terminar el trazo.' : ''}
      </span>
    </div>,
    stage,
  );
}

/** Elegir la imagen de fondo en la biblioteca y conseguir su dirección firmada. */
function BackgroundPicker({
  brandId,
  organizationId,
  open,
  onOpenChange,
  onPick,
}: {
  brandId: string;
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (asset: MediaAssetRow, url: string) => void;
}) {
  const pick = (asset: MediaAssetRow) => {
    signedUrlFor(asset.storage_path).then(
      (url) => (url ? onPick(asset, url) : toast.error('No se ha podido abrir esa imagen.')),
      (error: unknown) => toast.error(translateError(error)),
    );
  };
  return (
    <ImagePickerDialog
      brandId={brandId}
      libraryPath={`/o/${organizationId}/m/${brandId}/biblioteca`}
      open={open}
      onOpenChange={onOpenChange}
      title="Imagen de fondo"
      onPick={pick}
    />
  );
}

// ─────────────────────────────── Con IA ───────────────────────────────

/** Lo necesario para volver a pegar lo principal de la foto original sobre el resultado de la IA. */
interface PlateProtection {
  original: Pixels;
  /** Alfa del recorte (0–255) con las medidas de `original`. */
  alpha: Uint8Array;
  maskModel: string;
  prompt: string;
}

/** Una edición con IA: coste máximo, tratamiento de los datos, lanzar y esperar. */
function AiAction({
  asset,
  operation,
  choice,
  onDone,
  getSubjectMask,
  pixels,
  transparent = false,
  cutout = null,
  setCutout,
  sector,
  review = EMPTY_AI_REVIEW,
  setReview,
}: {
  asset: MediaAssetRow;
  operation: AiPhotoOperation;
  choice: AiEditChoice;
  onDone: (row: MediaAssetRow) => void;
  getSubjectMask?: (asset: MediaAssetRow) => Promise<Blob | null>;
  /** La foto original ya cargada (para sacar el recorte y volver a pegar lo principal). */
  pixels?: Pixels;
  /** La foto ya viene sin fondo (su propio alfa sirve de recorte). */
  transparent?: boolean;
  /** El recorte ya hecho en esta pantalla (de la pestaña «Fondo» o de un intento anterior). */
  cutout?: CutoutState | null;
  /** Guarda el recorte nuevo para no repetirlo en ninguna pestaña. */
  setCutout?: (cutout: CutoutState | null) => void;
  /** Tipo de negocio de la marca: ideas de fondo y qué se le dice a la IA que no toque. */
  sector: SectorKind;
  /** Intentos hechos y resultado en revisión (solo «Cambiar el fondo»). */
  review?: AiReview;
  setReview?: (update: AiReview | ((current: AiReview) => AiReview)) => void;
}) {
  // En autogestión no hay cupos de por medio: solo se dice el coste (docs/modo-de-trabajo.md).
  const { selfManaged } = useWorkMode();
  const factors = operation === 'upscale' ? upscaleFactors(asset.width, asset.height) : [];
  const [scale, setScale] = useState<2 | 4>(factors[0] ?? 2);
  const isBackground = operation === 'replace_background';
  const [background, setBackground] = useState(review.attempts[review.attempts.length - 1]?.prompt ?? '');
  // Hay selección de lo principal: la da quien integra el diálogo, ya existe (esta sesión o foto sin fondo)
  // o se puede recortar en este navegador / en el servidor.
  const hasExisting = Boolean(
    pixels &&
    (transparent || (cutout && cutout.pixels.width === pixels.width && cutout.pixels.height === pixels.height)),
  );
  const browserCutout = useMemo(() => removalSupport().ok && Boolean(pixels), [pixels]);
  const withMask =
    isBackground && (Boolean(getSubjectMask) || hasExisting || browserCutout) && choice.usesSubjectMask !== false;
  // Solo se puede volver a pegar con el recorte propio.
  const canProtect = withMask && !getSubjectMask;
  const [protect, setProtect] = useState(true);
  const [maskProgress, setMaskProgress] = useState<CutoutProgress | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const maskAbort = useRef<AbortController | null>(null);
  const plate = useRef<PlateProtection | null>(null);
  const queryClient = useQueryClient();
  const saveEdit = useSaveEdit(asset.brand_id);
  const suggestions = backgroundSuggestionsFor(sector);
  const subject = aiSubjectFor(sector);
  const food = mentionsFood(sector);
  // Para estimar basta un texto cualquiera: el coste no depende de lo que se pida.
  const input = useMemo<AiEditInput>(
    () => ({
      assetId: asset.id,
      operation,
      ...(operation === 'upscale' ? { scale } : {}),
      ...(isBackground ? { prompt: 'fondo', ...(withMask ? { maskPresent: true } : {}) } : {}),
    }),
    [asset.id, operation, scale, isBackground, withMask],
  );
  const possible = operation !== 'upscale' || factors.length > 0;
  const estimate = useAiEditEstimate(asset.brand_id, input, possible);
  const edit = useAiEdit(asset.brand_id);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const progress = useGenerationProgress(asset.brand_id, pendingId);
  const delivered = useRef<string | null>(null);
  const finished = progress.data?.status === 'completed' ? progress.data.asset : null;
  const finishedCost = progress.data?.status === 'completed' ? progress.data.costMicros : null;
  const candidate = review.candidate;
  const reviewing = isBackground && candidate !== null;

  // Salir con el recorte previo en marcha lo cancela.
  useEffect(() => () => maskAbort.current?.abort(), []);

  /** Quita de la biblioteca un resultado que no se quiere (si no se pudiera borrar, se queda). */
  const dropRow = useCallback(
    async (rowId: string) => {
      await deleteAssets([rowId]).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: assetKeys.all(asset.brand_id) });
    },
    [asset.brand_id, queryClient],
  );

  /** Entrega un resultado que no se revisa (quitar el fondo, mejorar, ampliar). */
  const deliverPlain = useCallback(
    (row: MediaAssetRow) => {
      toast.success(`${AI_OPERATION_LABEL[operation]}: listo. Está en la biblioteca; la original no ha cambiado.`);
      onDone(row);
    },
    [onDone, operation],
  );

  /**
   * «Cambiar el fondo»: el resultado se ENSEÑA antes de aplicarlo. Si hay selección de lo principal,
   * se vuelve a pegar el original encima (en memoria) y se enseña eso; no se guarda nada más hasta «Usar esta».
   */
  const presentCandidate = useCallback(
    async (row: MediaAssetRow, costMicros: number | null) => {
      const protection = plate.current;
      plate.current = null;
      const prompt = protection?.prompt ?? background.trim();
      try {
        const url = await signedUrlFor(row.storage_path);
        if (!url) throw new Error('sin dirección');
        setFinalizing(true);
        const generated = (await loadPixels(url)).pixels;
        let merged: Pixels | null = null;
        if (protection) {
          try {
            if (!sameAspect(generated, protection.original)) throw new Error('proporción');
            merged = restorePlate(generated, protection.original, protection.alpha);
          } catch {
            toast.warning(
              'La IA cambió el fondo, pero no se ha podido volver a pegar lo principal de tu foto. Se enseña el resultado de la IA tal cual: revisa que no haya cambiado.',
            );
          }
        }
        const next: AiCandidate = {
          row,
          preview: downscale(merged ?? generated, PREVIEW_SIDE),
          merged,
          maskModel: protection?.maskModel ?? null,
          showBefore: false,
          costMicros,
          prompt,
          protectedPlate: merged !== null,
        };
        setReview?.((current) => ({ attempts: [...current.attempts, { prompt, costMicros }], candidate: next }));
      } catch {
        toast.warning('No se ha podido preparar la vista previa. El resultado está en la biblioteca.');
        onDone(row);
      } finally {
        setFinalizing(false);
      }
    },
    [background, onDone, setReview],
  );

  // Lo último que se ha de hacer con un resultado que llega tarde (trabajo asíncrono).
  const arrival = useRef<(row: MediaAssetRow, cost: number | null) => void>(() => undefined);
  useEffect(() => {
    arrival.current = (row, cost) => {
      if (isBackground) void presentCandidate(row, cost);
      else deliverPlain(row);
    };
  });
  useEffect(() => {
    if (!finished || delivered.current === finished.id) return;
    delivered.current = finished.id;
    arrival.current(finished, finishedCost);
  }, [finished, finishedCost]);
  const running =
    preparing ||
    finalizing ||
    saveEdit.isPending ||
    edit.isPending ||
    (pendingId !== null && progress.data?.status !== 'completed' && progress.data?.status !== 'failed');

  async function run(promptOverride?: string) {
    setPendingId(null);
    const prompt = (promptOverride ?? background).trim();
    let request: AiEditInput = { ...input, ...(operation === 'upscale' ? {} : { subject }) };
    plate.current = null;
    if (isBackground) {
      request = { assetId: asset.id, operation, prompt, subject };
      if (withMask) {
        try {
          if (getSubjectMask) {
            const mask = await getSubjectMask(asset);
            if (mask) request = { ...request, subjectMask: await blobToBase64(mask) };
          } else if (pixels) {
            setPreparing(true);
            setMaskProgress(null);
            // Un solo recorte por foto: si ya hay uno (de esta sesión, o la foto ya viene sin fondo) se reutiliza.
            let found = existingSubject({
              pixels,
              transparent,
              cutout: cutout ? { pixels: cutout.pixels, model: cutout.model, strokes: cutout.strokes } : null,
              provenance: asset.provenance,
            });
            if (!found) {
              const abort = new AbortController();
              maskAbort.current = abort;
              const cut = await removeBackground(pixels, setMaskProgress, abort.signal, {
                brandId: asset.brand_id,
                source: asset,
              });
              setCutout?.({ pixels: cut.pixels, model: cut.model, quality: cut.quality });
              found = {
                alpha: alphaOf(cut.pixels),
                width: cut.pixels.width,
                height: cut.pixels.height,
                model: cut.model,
                from: 'session',
              };
            }
            const mask = subjectMaskPixels(
              found.alpha,
              found.width,
              found.height,
              asset.width ?? pixels.width,
              asset.height ?? pixels.height,
            );
            request = { ...request, subjectMask: await blobToBase64(await encodePixels(mask, 'image/png')) };
            if (protect) {
              plate.current = { original: pixels, alpha: found.alpha, maskModel: found.model, prompt };
            }
          }
        } catch (error) {
          if (!isRemovalCancelled(error)) {
            toast.error(
              getSubjectMask
                ? 'No se ha podido preparar la selección de lo principal. Inténtalo de nuevo.'
                : `No se ha podido recortar la foto para protegerla. ${describeRemovalError(error)}`,
            );
          }
          return;
        } finally {
          maskAbort.current = null;
          setPreparing(false);
          setMaskProgress(null);
          void queryClient.invalidateQueries({ queryKey: assetKeys.all(asset.brand_id) });
        }
      }
    }
    edit.mutateAsync(request).then(
      async (result) => {
        if (result.status === 'pending') {
          setPendingId(result.generationId);
          return;
        }
        const row = await fetchAsset(asset.brand_id, result.asset.id).catch(() => null);
        if (!row) {
          plate.current = null;
          toast.error('La foto se editó y está en la biblioteca, pero no se ha podido abrir aquí.');
          return;
        }
        if (isBackground) await presentCandidate(row, result.costMicros);
        else deliverPlain(row);
      },
      () => undefined,
    );
  }

  /** «Usar esta»: se queda con el resultado (si se pegó lo principal original, se guarda esa versión). */
  async function accept() {
    if (!candidate) return;
    const { row, merged } = candidate;
    try {
      if (merged) {
        const format = outputFormat(false, asset.mime_type);
        const steps: PhotoEditStep[] = [
          {
            kind: 'ai_background',
            prompt: candidate.prompt,
            model: choice.model,
            maskModel: candidate.maskModel ?? 'recorte',
            plateProtected: true,
          },
        ];
        const saved = await saveEdit.mutateAsync({
          source: asset,
          blob: await encodePixels(merged, format.mime),
          fileName: editedFileName(asset.file_name, steps, format.ext),
          width: merged.width,
          height: merged.height,
          provenance: photoEditProvenance({
            sourceAssetId: asset.id,
            steps,
            width: merged.width,
            height: merged.height,
          }),
        });
        // La versión sin proteger ya sobra; si no se pudiera borrar, queda en la biblioteca.
        await dropRow(row.id);
        toast.success(
          `${AI_OPERATION_LABEL[operation]}: listo, con lo principal de tu foto intacto. La original no ha cambiado.`,
        );
        setReview?.(EMPTY_AI_REVIEW);
        onDone(saved);
        return;
      }
      toast.success(`${AI_OPERATION_LABEL[operation]}: listo. Está en la biblioteca; la original no ha cambiado.`);
      setReview?.(EMPTY_AI_REVIEW);
      onDone(row);
    } catch (error) {
      toast.error(translateError(error));
    }
  }

  /** Descarta el resultado que se miraba (se borra de la biblioteca); el historial de intentos se conserva. */
  async function discardCandidate() {
    if (!candidate) return;
    const { row, prompt } = candidate;
    setBackground(prompt);
    setReview?.((current) => ({ ...current, candidate: null }));
    await dropRow(row.id);
  }

  async function retrySame() {
    if (!candidate) return;
    const prompt = candidate.prompt;
    await discardCandidate();
    await run(prompt);
  }

  async function changePrompt() {
    await discardCandidate();
    setTimeout(() => document.getElementById(`photo-edit-ai-bg-${asset.id}`)?.focus(), 50);
  }

  const setShowBefore = (showBefore: boolean) =>
    setReview?.((current) =>
      current.candidate ? { ...current, candidate: { ...current.candidate, showBefore } } : current,
    );

  const Icon = operation === 'upscale' ? Maximize2 : isBackground || operation === 'enhance' ? Sparkles : Eraser;
  const spent = spentMicros(review.attempts);
  const maxCost = estimate.data ? formatMicros(estimate.data.costMicros) : null;
  const provider = aiProviderOf(choice.model);
  return (
    <div className="space-y-3" data-testid={`photo-edit-ai-${operation}`}>
      {operation === 'upscale' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {factors.length === 0 ? (
            <Notice tone="warning">Esta foto ya es grande: ampliada pasaría de 4096 px por lado.</Notice>
          ) : (
            factors.map((factor) => (
              <label key={factor} className="flex items-center gap-1">
                <input type="radio" name="upscale" checked={scale === factor} onChange={() => setScale(factor)} />×
                {factor} ({(asset.width ?? 0) * factor} × {(asset.height ?? 0) * factor} px)
              </label>
            ))
          )}
        </div>
      )}
      {reviewing && candidate && (
        <section
          className="space-y-3 rounded-md border border-border p-3"
          aria-label="Resultado de la IA"
          data-testid="photo-edit-ai-review"
        >
          <h3 className="text-sm font-semibold">Intento {review.attempts.length}: mira el resultado</h3>
          <div role="group" aria-label="Comparar" className="flex gap-1">
            <Button
              size="sm"
              variant={candidate.showBefore ? 'secondary' : 'primary'}
              aria-pressed={!candidate.showBefore}
              onClick={() => setShowBefore(false)}
              data-testid="photo-edit-ai-after"
            >
              Después
            </Button>
            <Button
              size="sm"
              variant={candidate.showBefore ? 'primary' : 'secondary'}
              aria-pressed={candidate.showBefore}
              onClick={() => setShowBefore(true)}
              data-testid="photo-edit-ai-before"
            >
              Antes
            </Button>
          </div>
          <p className="text-xs text-muted" role="status" data-testid="photo-edit-ai-attempt-cost">
            {candidate.costMicros === null
              ? 'Este intento: el coste no está disponible todavía.'
              : `Este intento ha costado ${formatMicros(candidate.costMicros)}.`}
            {review.attempts.length > 1 &&
              ` En total llevas ${formatMicros(spent)} en ${review.attempts.length} intentos.`}
          </p>
          {candidate.protectedPlate ? (
            <p className="text-xs text-muted">
              Lo principal de tu foto se ha vuelto a pegar tal cual sobre el nuevo fondo.
            </p>
          ) : (
            <Notice tone="warning">
              Es el resultado de la IA sin retocar: puede haber cambiado detalles de lo principal. Compáralo con el
              «Antes».
            </Notice>
          )}
          <p className="text-xs text-muted">
            Todavía no está aplicado. Si sales sin elegir, el resultado se queda en la biblioteca.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void accept()} loading={saveEdit.isPending} data-testid="photo-edit-ai-use">
              Usar esta
            </Button>
            <Button
              variant="secondary"
              onClick={() => void retrySame()}
              disabled={running}
              data-testid="photo-edit-ai-retry"
            >
              Probar otra vez{maxCost ? ` (como máximo ${maxCost})` : ''}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void changePrompt()}
              disabled={running}
              data-testid="photo-edit-ai-change"
            >
              Cambiar la indicación
            </Button>
          </div>
        </section>
      )}
      {isBackground && !reviewing && (
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor={`photo-edit-ai-bg-${asset.id}`}>
            ¿Qué fondo quieres?
          </label>
          <DictableField
            as="input"
            brandId={asset.brand_id}
            id={`photo-edit-ai-bg-${asset.id}`}
            type="text"
            maxLength={500}
            value={background}
            onValueChange={setBackground}
            placeholder={`Por ejemplo: ${suggestions[0]}`}
            className="h-auto rounded-md py-2"
            data-testid="photo-edit-ai-background-text"
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Sugerencias de fondo">
            {suggestions.map((idea) => (
              <button
                key={idea}
                type="button"
                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-subtle"
                onClick={() => setBackground(idea)}
                data-testid="photo-edit-ai-background-idea"
              >
                {idea}
              </button>
            ))}
          </div>
          {review.attempts.length > 0 && (
            <p className="text-xs text-muted" data-testid="photo-edit-ai-attempts">
              Intentos hechos: {review.attempts.length}. Llevas gastado {formatMicros(spent)}.
            </p>
          )}
          {withMask ? (
            <div className="space-y-2">
              <MoreInfo
                line={
                  canProtect && protect
                    ? `Usa IA (${provider}) solo para el fondo: lo principal de tu foto se vuelve a pegar tal cual.`
                    : `Usa IA (${provider}) para el fondo; se le pide que no toque lo principal.`
                }
                testId="photo-edit-ai-mask-info"
              >
                <p>
                  {hasExisting
                    ? 'Se usa el recorte que ya tiene esta foto (no se vuelve a recortar). Se le dice a la IA que no toque lo principal y, al terminar, se vuelve a pegar encima el original.'
                    : `Primero se recorta lo principal de la foto, una sola vez (después se reutiliza en «Quitar» y «Desenfocar»). ${removalPrivacyNote()} Para pintar el fondo, la foto sí se envía al proveedor de IA, y al terminar se vuelve a pegar encima lo principal del original.`}
                </p>
                {choice.untestedAdapter && <p>Proveedor sin probar todavía.</p>}
              </MoreInfo>
              {canProtect && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={protect}
                    onChange={(e) => setProtect(e.target.checked)}
                    data-testid="photo-edit-ai-protect"
                  />
                  Proteger lo principal de la foto original
                </label>
              )}
              {preparing && <CutoutProgressBar progress={maskProgress} onCancel={() => maskAbort.current?.abort()} />}
            </div>
          ) : (
            <Notice tone="warning">
              No hay recorte de la foto: la IA puede retocar también lo principal
              {food ? ' (forma, colores, guarnición)' : ' (forma, colores, detalles)'}. Revisa el resultado; la original
              no cambia.
            </Notice>
          )}
        </div>
      )}
      {operation === 'enhance' && (
        <p className="text-sm">
          Mejora la luz y el color con IA. Puede cambiar detalles {food ? 'del plato' : 'de lo principal de la foto'}:
          revisa el resultado. Si solo quieres ajustar luz y color, la pestaña «Ajustar» lo hace sin IA y sin tocar nada
          más.
        </p>
      )}
      {!withMask &&
        (choice.untestedAdapter ? (
          <MoreInfo line={`Usa IA (${provider}).`}>
            <p>Proveedor sin probar todavía.</p>
          </MoreInfo>
        ) : (
          <p className="text-xs text-muted">Usa IA ({provider}).</p>
        ))}
      {/* Antes de gastar, siempre a la vista: dónde se procesa y el coste máximo. */}
      {!choice.euProcessing && (
        <div className="text-xs">
          <Badge tone="warning">Se procesa fuera de la UE o en región desconocida</Badge>
        </div>
      )}
      {possible && !reviewing && (
        <p className="text-xs text-muted" data-testid="photo-edit-ai-cost">
          {estimate.isPending
            ? 'Calculando el coste…'
            : estimate.data
              ? `${review.attempts.length > 0 ? 'Un intento más costará' : 'Coste'} máximo: ${formatMicros(estimate.data.costMicros)}${selfManaged ? '.' : ' (se descuenta del cupo de IA de la organización).'}`
              : null}
        </p>
      )}
      {estimate.isError && <AiErrorNotice error={estimate.error} />}
      {edit.isError && <AiErrorNotice error={edit.error} onRetry={() => void run()} />}
      {progress.data?.status === 'failed' && <Notice tone="warning">{progress.data.message}</Notice>}
      {finalizing && <Spinner label="Preparando la vista previa del resultado…" />}
      {pendingId && running && !finalizing && (
        <Spinner label="La IA está trabajando. Puedes cerrar: el resultado llegará igualmente a la biblioteca." />
      )}
      {!reviewing && (
        <Button
          onClick={() => void run()}
          disabled={!possible || running || (isBackground && background.trim() === '')}
          loading={edit.isPending}
          data-testid={`photo-edit-ai-run-${operation}`}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {operation === 'upscale'
            ? `Ampliar ×${scale}`
            : isBackground
              ? review.attempts.length > 0
                ? 'Cambiar el fondo otra vez'
                : 'Cambiar el fondo'
              : operation === 'enhance'
                ? 'Mejorar con IA'
                : 'Quitar el fondo'}
        </Button>
      )}
    </div>
  );
}
