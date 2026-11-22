// «Editar foto» a PANTALLA COMPLETA dentro de la propia página (no es una
// ventana emergente), desde la ficha de la biblioteca o desde una capa de imagen
// del editor (docs/edicion-fotos.md, §11). La foto, lo más grande posible, y los
// controles en una columna (debajo en el móvil, con las pestañas fijas y la foto
// siempre a la vista). Cuatro pestañas:
//   · Mejorar   luz, color y nitidez (automático o a mano) y encuadre, SIN IA;
//   · Recortes  1:1, 4:5 y 9:16 con encuadre inteligente, SIN IA;
//   · Fondo     quitar el fondo (en el navegador, gratis; o con IA si el
//               servidor la tiene) y poner uno liso, de la marca o de la
//               biblioteca, con sombra suave opcional (sin IA);
//   · Ampliar   ×2 o ×4 (IA).
// Lo de IA solo sale con `VITE_AI_PHOTO_EDIT_ENABLED` y si el servidor tiene
// modelo para esa acción. Cada resultado es un recurso NUEVO de la biblioteca,
// con su procedencia; la foto original no se toca nunca. Desde el editor, el
// botón principal es «Aplicar a la capa» (la capa pasa a usar la copia y se
// deshace con Ctrl+Z); desde la biblioteca, «Guardar copia», con «Deshacer».
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eraser, Eye, ImagePlus, Maximize2, Paintbrush, Sparkles, Undo2, Wand2 } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Badge, Button, Notice, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { useGenerationProgress } from '@/features/ai/imageApi';
import { formatMicros } from '@/features/ai/money';
import { useActiveProfile } from '@/features/brand/api';
import { parseProfile } from '@/features/brand/profile';
import { ImagePickerDialog } from '@/features/content/editor/AssetPickerDialog';
import { assetKeys, deleteAssets, useSignedUrls } from '@/features/library/api';
import type { MediaAssetRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  AI_OPERATION_LABEL,
  BACKGROUND_SUGGESTIONS,
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
import {
  centeredCrop,
  interestMap,
  NETWORK_ASPECT_LABEL,
  NETWORK_ASPECTS,
  smartCrop,
  type Box,
  type NetworkAspect,
} from './framing';
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

type Tab = 'enhance' | 'crops' | 'background' | 'upscale' | 'ai';

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
  /** Pestaña con la que se abre (por defecto, «Mejorar»). */
  initialTab?: Tab;
  /** En la pestaña «Fondo», con el «Modo retrato» ya elegido (cuando la foto tenga recorte). */
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
const SLIDERS: Array<{
  key:
    'exposure' | 'contrast' | 'saturation' | 'warmth' | 'sharpness' | 'shadows' | 'highlights' | 'clarity' | 'vibrance';
  label: string;
  min: number;
}> = [
  { key: 'exposure', label: 'Luz', min: -100 },
  { key: 'contrast', label: 'Contraste', min: -100 },
  { key: 'saturation', label: 'Color (saturación)', min: -100 },
  { key: 'warmth', label: 'Temperatura (fría ↔ cálida)', min: -100 },
  { key: 'sharpness', label: 'Nitidez', min: 0 },
  { key: 'shadows', label: 'Sombras (aclarar lo oscuro)', min: -100 },
  { key: 'highlights', label: 'Luces (recuperar lo claro)', min: -100 },
  { key: 'clarity', label: 'Claridad (relieve)', min: -100 },
  { key: 'vibrance', label: 'Viveza (sin pasarse en la carne)', min: -100 },
];

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

/** La pestaña activa dice qué hace el botón principal y si hay cambios sin guardar. */
function useCommit(commit: CommitState) {
  const { setCommit } = useScreen();
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  const { disabled, dirty, busy } = commit;
  useEffect(() => {
    setCommit({
      disabled,
      dirty,
      busy,
      run: () => latest.current.run(),
      reset: () => latest.current.reset(),
    });
    return () => setCommit(null);
  }, [disabled, dirty, busy, setCommit]);
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
  const [tab, setTab] = useState<Tab>(initialTab ?? 'enhance');
  const [results, setResults] = useState<Array<{ row: MediaAssetRow; undoable: boolean }>>([]);
  const [commit, setCommit] = useState<CommitState | null>(null);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [comparing, setComparing] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  // El recorte del fondo vive aquí para no perderlo al cambiar de pestaña.
  const [cutout, setCutout] = useState<CutoutState | null>(null);
  const save = useSaveEdit(asset.brand_id);
  const queryClient = useQueryClient();
  const aiOptions = useAiEditOptions(asset.brand_id, canEditWithAi(asset));
  const aiChoice = (operation: AiPhotoOperation) => aiOptions.data?.find((c) => c.operation === operation);
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
    setTab('background');
  };

  const requestClose = () => {
    if (commit?.dirty) setAskDiscard(true);
    else onClose();
  };

  // Si el botón que tenía el foco desaparece (p. ej. «Quitar el fondo» al terminar), el navegador deja el
  // foco en la página y Esc no llegaría a esta pantalla. Dos redes: se devuelve el foco a la pantalla y,
  // si aun así Esc llega al documento con el foco perdido, también cierra.
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
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

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[38dvh] shrink-0 bg-subtle lg:h-auto lg:flex-1">
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
          className="flex min-h-0 flex-1 flex-col border-t border-border bg-surface lg:w-[24rem] lg:flex-none lg:border-l lg:border-t-0"
          aria-label="Controles"
        >
          {loadError ? (
            <div className="p-4">
              <Notice tone="warning">{loadError}</Notice>
            </div>
          ) : !loaded || !stats || !preview || !map || !context ? null : (
            <ScreenContext.Provider value={context}>
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as Tab)}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="shrink-0 px-2">
                  <TabsList label="Ediciones">
                    <TabsTrigger value="enhance">Mejorar</TabsTrigger>
                    <TabsTrigger value="crops">Recortes</TabsTrigger>
                    <TabsTrigger value="background">Fondo</TabsTrigger>
                    {(aiChoice('replace_background') || aiChoice('enhance')) && (
                      <TabsTrigger value="ai">Fondo con IA</TabsTrigger>
                    )}
                    {aiChoice('upscale') && <TabsTrigger value="upscale">Ampliar</TabsTrigger>}
                  </TabsList>
                </div>
                {/* Una sola zona de desplazamiento: los controles. */}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                  {loaded.reduced && (
                    <div className="pt-3">
                      <Notice tone="warning">
                        La foto es muy grande: se edita reducida a {loaded.pixels.width} × {loaded.pixels.height} px.
                      </Notice>
                    </div>
                  )}
                  <TabsContent value="enhance" className="pt-4">
                    <EnhanceTab pixels={loaded.pixels} preview={preview} stats={stats} map={map} onSave={commitEdit} />
                  </TabsContent>
                  <TabsContent value="crops" className="pt-4">
                    <CropsTab pixels={loaded.pixels} preview={preview} map={map} onSave={commitEdit} />
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
                      portraitFirst={Boolean(initialPortrait)}
                      ai={aiChoice('remove_background')}
                      onAiResult={(row) => {
                        addResult(row);
                        switchTo(row);
                      }}
                    />
                  </TabsContent>
                  {(aiChoice('replace_background') || aiChoice('enhance')) && (
                    <TabsContent value="ai" className="space-y-6 pt-4">
                      <Stage pixels={null} />
                      {aiChoice('replace_background') && (
                        <AiAction
                          asset={asset}
                          operation="replace_background"
                          choice={aiChoice('replace_background')!}
                          onDone={addResult}
                          getSubjectMask={getSubjectMask}
                          pixels={loaded.pixels}
                        />
                      )}
                      {aiChoice('enhance') && (
                        <AiAction asset={asset} operation="enhance" choice={aiChoice('enhance')!} onDone={addResult} />
                      )}
                    </TabsContent>
                  )}
                  {aiChoice('upscale') && (
                    <TabsContent value="upscale" className="pt-4">
                      <Stage pixels={null} />
                      <AiAction asset={asset} operation="upscale" choice={aiChoice('upscale')!} onDone={addResult} />
                    </TabsContent>
                  )}
                </div>
              </Tabs>
            </ScreenContext.Provider>
          )}
        </aside>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

// ─────────────────────────────── Mejorar ───────────────────────────────

function EnhanceTab({
  pixels,
  preview,
  stats,
  map,
  onSave,
}: {
  pixels: Pixels;
  preview: Pixels;
  stats: ReturnType<typeof analyzeImage>;
  map: ReturnType<typeof interestMap>;
  onSave: SaveEditResult;
}) {
  const [adjustments, setAdjustments] = useState<Adjustments>(NEUTRAL_ADJUSTMENTS);
  /** La mejora automática está puesta (y no se ha tocado a mano). */
  const [auto, setAuto] = useState(false);
  /** Lo que había antes de pulsar «Mejorar automáticamente», para volver en un clic. */
  const [beforeAuto, setBeforeAuto] = useState<Adjustments | null>(null);
  /** Cuánto de lo calculado se aplica: suave, normal o fuerte. */
  const [intensity, setIntensity] = useState<AutoIntensity>('normal');
  const [framing, setFraming] = useState<NetworkAspect | ''>('');
  const [busy, setBusy] = useState(false);
  // Los controles responden al instante; la foto grande se rehace en cuanto puede.
  const live = useDeferredValue(adjustments);
  const adjusted = useMemo(() => applyAdjustments(preview, live), [preview, live]);
  const box = useMemo(() => (framing ? smartCrop(pixels, framing, map) : null), [pixels, map, framing]);
  const shown = useMemo(() => {
    if (!box) return adjusted;
    const scale = preview.width / pixels.width;
    return cropPixels(adjusted, {
      x: box.x * scale,
      y: box.y * scale,
      width: box.width * scale,
      height: box.height * scale,
    });
  }, [adjusted, box, preview.width, pixels.width]);
  const unchanged = isNeutral(adjustments) && !framing;

  const reset = useCallback(() => {
    setAdjustments(NEUTRAL_ADJUSTMENTS);
    setAuto(false);
    setBeforeAuto(null);
    setFraming('');
  }, []);

  /** Cambia la intensidad; si la mejora automática está puesta, se recalcula al momento. */
  function chooseIntensity(next: AutoIntensity) {
    setIntensity(next);
    if (auto) setAdjustments(autoAdjustments(stats, AUTO_INTENSITIES[next]));
  }

  function toggleAuto() {
    if (auto) {
      setAdjustments(beforeAuto ?? NEUTRAL_ADJUSTMENTS);
      setBeforeAuto(null);
      setAuto(false);
    } else {
      setBeforeAuto(adjustments);
      setAdjustments(autoAdjustments(stats, AUTO_INTENSITIES[intensity]));
      setAuto(true);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      let result = applyAdjustments(pixels, adjustments);
      const steps: PhotoEditStep[] = [];
      if (!isNeutral(adjustments)) steps.push({ kind: 'adjust', adjustments, auto });
      if (framing && box) {
        result = cropPixels(result, box);
        steps.push({ kind: 'crop', aspect: framing, box, smart: true });
      }
      await onSave(result, steps, 'Foto mejorada guardada en la biblioteca. La original no ha cambiado.');
      // La siguiente edición parte de cero: nada se arrastra de esta.
      reset();
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  }

  useCommit({ run: submit, disabled: unchanged, dirty: !unchanged, busy, reset });

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
      {auto && (
        <p className="text-xs text-muted">
          Los deslizadores muestran lo que se ha ajustado; puedes retocarlos. Además se han ajustado los negros y
          blancos y el tinte, que no tienen deslizador.
        </p>
      )}
      {SLIDERS.map((slider) => (
        <label key={slider.key} className="block text-sm">
          <span className="flex justify-between">
            {slider.label}
            <span className="tabular-nums text-muted">{adjustments[slider.key]}</span>
          </span>
          <input
            type="range"
            min={slider.min}
            max={100}
            value={adjustments[slider.key]}
            onChange={(e) => {
              setAdjustments((current) => ({ ...current, [slider.key]: Number(e.target.value) }));
              // A mano ya no es la mejora automática tal cual.
              setAuto(false);
            }}
            className="mt-1 w-full"
            data-testid={`photo-edit-${slider.key}`}
          />
        </label>
      ))}
      <label className="block text-sm">
        Encuadre
        <select
          className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          value={framing}
          onChange={(e) => setFraming(e.target.value as NetworkAspect | '')}
          data-testid="photo-edit-framing"
        >
          <option value="">Como está</option>
          {NETWORK_ASPECTS.map((aspect) => (
            <option key={aspect} value={aspect}>
              {NETWORK_ASPECT_LABEL[aspect]}, encuadre inteligente
            </option>
          ))}
        </select>
      </label>
      <Button variant="ghost" size="sm" onClick={reset} disabled={unchanged} data-testid="photo-edit-reset">
        Deshacer cambios
      </Button>
      <p className="text-xs text-muted">Vista previa reducida. Se guarda a tamaño completo.</p>
    </div>
  );
}

// ─────────────────────────────── Recortes ───────────────────────────────

function CropsTab({
  pixels,
  preview,
  map,
  onSave,
}: {
  pixels: Pixels;
  preview: Pixels;
  map: ReturnType<typeof interestMap>;
  onSave: SaveEditResult;
}) {
  const [aspect, setAspect] = useState<NetworkAspect>(NETWORK_ASPECTS[0]!);
  const [smart, setSmart] = useState(true);
  const [busy, setBusy] = useState(false);
  const boxes = useMemo(
    () =>
      Object.fromEntries(
        NETWORK_ASPECTS.map((a) => [a, smart ? smartCrop(pixels, a, map) : centeredCrop(pixels, a)]),
      ) as Record<NetworkAspect, Box>,
    [pixels, map, smart],
  );
  const previews = useMemo(() => {
    const scale = preview.width / pixels.width;
    return Object.fromEntries(
      NETWORK_ASPECTS.map((a) => {
        const box = boxes[a];
        return [
          a,
          cropPixels(preview, {
            x: box.x * scale,
            y: box.y * scale,
            width: box.width * scale,
            height: box.height * scale,
          }),
        ];
      }),
    ) as Record<NetworkAspect, Pixels>;
  }, [preview, pixels.width, boxes]);
  const thumbs = useMemo(
    () =>
      Object.fromEntries(NETWORK_ASPECTS.map((a) => [a, downscale(previews[a], 220)])) as Record<NetworkAspect, Pixels>,
    [previews],
  );

  async function submit() {
    setBusy(true);
    try {
      const box = boxes[aspect];
      await onSave(
        cropPixels(pixels, box),
        [{ kind: 'crop', aspect, box, smart }],
        'Recorte guardado en la biblioteca. La original no ha cambiado.',
      );
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  }

  useCommit({
    run: submit,
    disabled: false,
    dirty: false,
    busy,
    reset: () => {
      setAspect(NETWORK_ASPECTS[0]!);
      setSmart(true);
    },
  });

  return (
    <div className="space-y-4">
      <Stage pixels={previews[aspect]} testId="photo-edit-crop-preview" />
      <p className="text-sm text-muted">
        El recorte más grande que cabe en cada formato, colocado donde hay más detalle y color (sin IA: no reconoce
        objetos; con fondos muy cargados, mira la vista previa). Elige un formato; para guardar otro, repite.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={smart}
          onChange={(e) => setSmart(e.target.checked)}
          data-testid="photo-edit-smart"
        />
        Encuadre inteligente (si no, centrado)
      </label>
      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="sr-only">Formato del recorte</legend>
        {NETWORK_ASPECTS.map((a) => {
          const checked = aspect === a;
          const box = boxes[a];
          return (
            <label
              key={a}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-2 text-xs',
                checked ? 'border-primary bg-primary-soft' : 'border-border',
              )}
            >
              <span className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="crop-aspect"
                  checked={checked}
                  onChange={() => setAspect(a)}
                  data-testid={`photo-edit-crop-${a}`}
                />
                {NETWORK_ASPECT_LABEL[a]}
              </span>
              <PixelsCanvas pixels={thumbs[a]} className="max-h-24 rounded" />
              <span className="text-muted">
                {box.width} × {box.height} px
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

// ─────────────────────────────── Fondo ───────────────────────────────

/** Qué se pone detrás del plato. */
type BackgroundChoice =
  | { type: 'none' }
  | { type: 'color'; hex: string }
  | { type: 'asset'; asset: MediaAssetRow; cover: Pixels }
  | { type: 'portrait' };

function BackgroundTab({
  asset,
  pixels,
  transparent,
  onSave,
  cutout,
  setCutout,
  portraitFirst,
  ai,
  onAiResult,
}: {
  asset: MediaAssetRow;
  pixels: Pixels;
  transparent: boolean;
  onSave: SaveEditResult;
  cutout: CutoutState | null;
  setCutout: (cutout: CutoutState | null) => void;
  /** Se abrió desde «Modo retrato»: es lo primero que se ofrece al tener el recorte. */
  portraitFirst: boolean;
  ai: AiEditChoice | undefined;
  onAiResult: (row: MediaAssetRow) => void;
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
  const [choice, setChoice] = useState<BackgroundChoice>(
    portraitFirst && !transparent ? { type: 'portrait' } : { type: 'color', hex: '#FFFFFF' },
  );
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
    !transparent &&
    cutout !== null &&
    cutout.pixels.width === pixels.width &&
    cutout.pixels.height === pixels.height;
  const strokes = cutout?.strokes ?? NO_STROKES;
  const effectiveChoice = useMemo<BackgroundChoice>(
    () => (choice.type === 'portrait' && !selectable ? { type: 'color', hex: '#FFFFFF' } : choice),
    [choice, selectable],
  );
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
    return retouched && previewAlpha ? withAlpha(previewOriginal, previewAlpha) : downscale(cutoutPixels!, PREVIEW_SIDE);
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
        // El desenfoque se calcula con la foto entera y la selección a tamaño completo.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const alpha = applyStrokes(alphaOf(cutout!.pixels), pixels.width, pixels.height, strokes);
        const options = { amount: portrait.amount, progressive: portrait.progressive, dim: portrait.dim };
        await onSave(
          portraitBlur(pixels, alpha, options),
          [...prefix, { kind: 'portrait_blur', ...options }],
          'Foto en modo retrato guardada en la biblioteca. La original no ha cambiado.',
        );
        return;
      }
      const subject = fullSubject();
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

  useCommit({
    run: submit,
    // Ya sin fondo y sin elegir otro: no hay nada que guardar.
    disabled: !hasSubject || (effectiveChoice.type === 'none' && !cutout),
    dirty: Boolean(cutout) && !transparent,
    busy,
    reset,
  });

  return (
    <div className="space-y-4">
      {!hasSubject && (
        <div className="space-y-3" data-testid="photo-edit-cutout">
          <Stage pixels={null} />
          <p className="text-sm">
            Para cambiar el fondo o desenfocarlo (modo retrato), primero hay que separar el plato del fondo. Después
            podrás retocar la selección a mano.
          </p>
          {ai && (
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
          {engine === 'browser' && (
            <div className="space-y-2" data-testid="photo-edit-cutout-browser">
              {support.ok ? (
                <>
                  <p className="text-xs text-muted">
                    Gratis y sin IA externa: la foto no sale de tu navegador. La primera vez descarga el modelo de
                    recorte (de 45 a 220 MB según tu navegador; queda guardado); después tarda unos segundos.
                  </p>
                  {cutError && <Notice tone="warning">{cutError}</Notice>}
                  {cutting && <CutoutProgressBar progress={progress} />}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void cut()} loading={cutting} data-testid="photo-edit-cutout-run">
                      <Eraser className="h-4 w-4" aria-hidden />
                      Quitar el fondo
                    </Button>
                    {cutting && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => cutAbort.current?.abort()}
                        data-testid="photo-edit-cutout-cancel"
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <Notice tone="warning">
                  <span data-testid="photo-edit-cutout-unsupported">{support.reason}</span>
                </Notice>
              )}
            </div>
          )}
          {engine === 'ai' && ai && (
            <AiAction asset={asset} operation="remove_background" choice={ai} onDone={onAiResult} />
          )}
        </div>
      )}
      {hasSubject && (
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
            />
          ) : (
            <Stage
              pixels={shown}
              testId="photo-edit-cutout-preview"
              checker={effectiveChoice.type === 'none'}
            />
          )}
          <p className="text-sm">
            {transparent && !cutout ? 'Esta foto ya no tiene fondo.' : 'Fondo quitado.'} Elige uno nuevo (sin IA) o
            usa el modo retrato:
          </p>
          {cutout?.quality === 'basic' && !transparent && (
            <p className="text-xs text-muted" data-testid="photo-edit-cutout-basic">
              Calidad básica: este navegador no tiene aceleración gráfica (WebGPU) suficiente para el recorte fino, así
              que se ha usado el modelo ligero. Los bordes de pelo, cristal o salsa pueden salir menos limpios; en
              Chrome o Edge recientes, con tarjeta gráfica, sale mejor.
            </p>
          )}
          {selectable && (
            <div className="space-y-3 rounded-md border border-border p-3" data-testid="photo-edit-portrait">
              <Button
                size="sm"
                variant={effectiveChoice.type === 'portrait' ? 'primary' : 'secondary'}
                aria-pressed={effectiveChoice.type === 'portrait'}
                onClick={() => setChoice(effectiveChoice.type === 'portrait' ? { type: 'color', hex: color } : { type: 'portrait' })}
                disabled={busy}
                data-testid="photo-edit-portrait-toggle"
              >
                Modo retrato: desenfocar solo el fondo
              </Button>
              {effectiveChoice.type === 'portrait' && (
                <div className="space-y-3">
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
                    Más borroso cuanto más lejos del plato
                  </label>
                  <label className="block text-sm">
                    <span className="flex justify-between">
                      Resaltar el plato (oscurece el fondo)
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
                    El plato queda tal cual y solo se desenfoca lo de alrededor. Si el borde no sale bien, retoca la
                    selección.
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
                <div className="space-y-3" data-testid="photo-edit-retouch">
                  <p className="text-xs text-muted">
                    Pasa el dedo o el ratón por la foto para pintar. Lo que se ve en rosa es el plato; lo demás es
                    fondo. Sirve igual para quitar el fondo, ponerle un color o el modo retrato.
                  </p>
                  <div role="radiogroup" aria-label="Qué hace el pincel" className="flex flex-wrap gap-1">
                    {(
                      [
                        ['add', 'Añadir al plato'],
                        ['remove', 'Quitar del plato'],
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
}: {
  original: Pixels;
  baseAlpha: Uint8Array;
  strokes: BrushStroke[];
  mode: BrushMode;
  /** Fracción del lado menor. */
  radius: number;
  veil: boolean;
  onStroke: (stroke: BrushStroke) => void;
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
    if (stroke) onStroke(stroke);
  };

  if (!stage) return null;
  return createPortal(
    <div
      ref={wrap}
      role="img"
      aria-label="Foto para retocar la selección. Pasa el dedo o el ratón por encima para pintar."
      className="relative h-full w-full cursor-crosshair touch-none select-none"
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
    </div>,
    stage,
  );
}

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0);

/** Progreso del recorte en el navegador: descarga del modelo (la 1ª vez), preparación y recorte. */
function CutoutProgressBar({ progress }: { progress: CutoutProgress | null }) {
  const downloading = progress?.phase === 'downloading';
  const pct = downloading ? Math.min(100, Math.round((progress.received / Math.max(1, progress.total)) * 100)) : null;
  const label = downloading
    ? `Descargando el modelo de recorte (${megabytes(progress.total)} MB, solo la primera vez): ${megabytes(progress.received)} de ${megabytes(progress.total)} MB`
    : progress?.phase === 'server-job'
      ? 'Quitando el fondo en el servidor… (suele tardar menos de un minuto)'
      : progress?.phase === 'server'
        ? 'Quitando el fondo en el servidor…'
        : progress?.phase === 'running'
          ? 'Quitando el fondo…'
          : 'Preparando el modelo…';
  return (
    <div className="space-y-1" data-testid="photo-edit-cutout-progress">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="h-2 overflow-hidden rounded bg-subtle"
      >
        <div
          className={cn('h-full bg-primary', pct === null && 'w-1/3 animate-pulse')}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted">{label}</p>
    </div>
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

/** Lo necesario para volver a pegar el plato original sobre el resultado de la IA. */
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
}: {
  asset: MediaAssetRow;
  operation: AiPhotoOperation;
  choice: AiEditChoice;
  onDone: (row: MediaAssetRow) => void;
  getSubjectMask?: (asset: MediaAssetRow) => Promise<Blob | null>;
  /** La foto original ya cargada (para sacar el recorte del plato y volver a pegarlo). */
  pixels?: Pixels;
}) {
  const factors = operation === 'upscale' ? upscaleFactors(asset.width, asset.height) : [];
  const [scale, setScale] = useState<2 | 4>(factors[0] ?? 2);
  const [background, setBackground] = useState('');
  const isBackground = operation === 'replace_background';
  // La máscara viene de quien integra el diálogo o, si no, del recorte del navegador.
  const browserCutout = useMemo(() => removalSupport().ok && Boolean(pixels), [pixels]);
  const withMask = isBackground && (Boolean(getSubjectMask) || browserCutout) && choice.usesSubjectMask !== false;
  // Solo se puede volver a pegar el plato con el recorte propio.
  const canProtect = withMask && !getSubjectMask;
  const [protect, setProtect] = useState(true);
  const [maskProgress, setMaskProgress] = useState<CutoutProgress | null>(null);
  const [preparing, setPreparing] = useState(false);
  const plate = useRef<PlateProtection | null>(null);
  const queryClient = useQueryClient();
  const saveEdit = useSaveEdit(asset.brand_id);
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
  /** Entrega el resultado; si hay plato que proteger, lo vuelve a pegar antes y guarda esa versión. */
  const deliver = useCallback(
    async (row: MediaAssetRow) => {
      const protection = plate.current;
      plate.current = null;
      if (protection) {
        try {
          const url = await signedUrlFor(row.storage_path);
          if (!url) throw new Error('sin dirección');
          const generated = await loadPixels(url);
          if (!sameAspect(generated.pixels, protection.original)) throw new Error('proporción');
          const merged = restorePlate(generated.pixels, protection.original, protection.alpha);
          const format = outputFormat(false, asset.mime_type);
          const steps: PhotoEditStep[] = [
            {
              kind: 'ai_background',
              prompt: protection.prompt,
              model: choice.model,
              maskModel: protection.maskModel,
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
          await deleteAssets([row.id]).catch(() => undefined);
          toast.success(
            `${AI_OPERATION_LABEL[operation]}: listo, con el plato original intacto. La original no ha cambiado.`,
          );
          onDone(saved);
          return;
        } catch {
          toast.warning(
            'La IA cambió el fondo, pero no se ha podido volver a pegar el plato original. Se deja el resultado de la IA: revisa el plato.',
          );
          onDone(row);
          return;
        }
      }
      toast.success(`${AI_OPERATION_LABEL[operation]}: listo. Está en la biblioteca; la original no ha cambiado.`);
      onDone(row);
    },
    [asset, choice.model, onDone, operation, saveEdit],
  );
  useEffect(() => {
    if (!finished || delivered.current === finished.id) return;
    delivered.current = finished.id;
    void deliver(finished);
  }, [finished, deliver]);
  const running =
    preparing ||
    saveEdit.isPending ||
    edit.isPending ||
    (pendingId !== null && progress.data?.status !== 'completed' && progress.data?.status !== 'failed');

  async function run() {
    setPendingId(null);
    let request: AiEditInput = input;
    plate.current = null;
    if (isBackground) {
      request = { assetId: asset.id, operation, prompt: background.trim() };
      if (withMask) {
        try {
          if (getSubjectMask) {
            const mask = await getSubjectMask(asset);
            if (mask) request = { ...request, subjectMask: await blobToBase64(mask) };
          } else if (pixels) {
            setPreparing(true);
            setMaskProgress(null);
            const cut = await removeBackground(pixels, setMaskProgress, undefined, {
              brandId: asset.brand_id,
              source: asset,
            });
            const alpha = alphaOf(cut.pixels);
            const mask = subjectMaskPixels(
              alpha,
              cut.pixels.width,
              cut.pixels.height,
              asset.width ?? pixels.width,
              asset.height ?? pixels.height,
            );
            request = { ...request, subjectMask: await blobToBase64(await encodePixels(mask, 'image/png')) };
            if (protect) {
              plate.current = { original: pixels, alpha, maskModel: cut.model, prompt: background.trim() };
            }
          }
        } catch (error) {
          toast.error(
            getSubjectMask
              ? 'No se ha podido preparar la máscara del plato. Inténtalo de nuevo.'
              : `No se ha podido recortar el plato para protegerlo. ${describeRemovalError(error)}`,
          );
          return;
        } finally {
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
        await deliver(row);
      },
      () => undefined,
    );
  }

  const Icon = operation === 'upscale' ? Maximize2 : isBackground || operation === 'enhance' ? Sparkles : Eraser;
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
      {isBackground && (
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor={`photo-edit-ai-bg-${asset.id}`}>
            ¿Qué fondo quieres?
          </label>
          <input
            id={`photo-edit-ai-bg-${asset.id}`}
            type="text"
            maxLength={500}
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            placeholder="Por ejemplo: mesa de mármol blanco con luz cálida"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            data-testid="photo-edit-ai-background-text"
          />
          <div className="flex flex-wrap gap-2" aria-label="Sugerencias de fondo">
            {BACKGROUND_SUGGESTIONS.map((idea) => (
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
          {withMask ? (
            <div className="space-y-2">
              <Notice tone="info">
                {canProtect && protect
                  ? 'Se recorta el plato en tu navegador y se le dice a la IA que no lo toque. Como la IA lo trata solo como orientación, al terminar se vuelve a pegar encima el plato original.'
                  : 'Se protege el plato con su recorte. La IA lo trata como orientación: revisa el resultado antes de usarlo.'}
              </Notice>
              {canProtect && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={protect}
                    onChange={(e) => setProtect(e.target.checked)}
                    data-testid="photo-edit-ai-protect"
                  />
                  Proteger el plato original
                </label>
              )}
              {preparing && <CutoutProgressBar progress={maskProgress} />}
            </div>
          ) : (
            <Notice tone="warning">
              No hay recorte del plato: la IA puede retocar también el plato (forma, colores, guarnición). Revisa el
              resultado; la original no cambia.
            </Notice>
          )}
        </div>
      )}
      {operation === 'enhance' && (
        <p className="text-sm">
          Mejora la luz y el color con IA. Puede cambiar detalles del plato: revisa el resultado. Si solo quieres
          ajustar luz y color, la pestaña «Mejorar» lo hace sin IA y sin tocar el plato.
        </p>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="neutral">Con IA</Badge>
        {!choice.euProcessing && <Badge tone="warning">Se procesa fuera de la UE o en región desconocida</Badge>}
        {choice.untestedAdapter && <Badge tone="neutral">Proveedor sin probar todavía</Badge>}
      </div>
      {possible && (
        <p className="text-xs text-muted" data-testid="photo-edit-ai-cost">
          {estimate.isPending
            ? 'Calculando el coste…'
            : estimate.data
              ? `Coste máximo: ${formatMicros(estimate.data.costMicros)} (se descuenta del cupo de IA de la organización).`
              : null}
        </p>
      )}
      {estimate.isError && <AiErrorNotice error={estimate.error} />}
      {edit.isError && <AiErrorNotice error={edit.error} onRetry={() => void run()} />}
      {progress.data?.status === 'failed' && <Notice tone="warning">{progress.data.message}</Notice>}
      {pendingId && running && (
        <Spinner label="La IA está trabajando. Puedes cerrar: el resultado llegará igualmente a la biblioteca." />
      )}
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
            ? 'Cambiar el fondo'
            : operation === 'enhance'
              ? 'Mejorar con IA'
              : 'Quitar el fondo'}
      </Button>
    </div>
  );
}
