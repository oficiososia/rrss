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
import { ArrowLeft, Eraser, Eye, ImagePlus, Maximize2, Sparkles, Undo2, Wand2 } from 'lucide-react';
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
  autoAdjustments,
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
}

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
  const [cutout, setCutout] = useState<{ pixels: Pixels; model: string; quality?: 'high' | 'basic' } | null>(null);
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

  function toggleAuto() {
    if (auto) {
      setAdjustments(beforeAuto ?? NEUTRAL_ADJUSTMENTS);
      setBeforeAuto(null);
      setAuto(false);
    } else {
      setBeforeAuto(adjustments);
      setAdjustments(autoAdjustments(stats));
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
  { type: 'none' } | { type: 'color'; hex: string } | { type: 'asset'; asset: MediaAssetRow; cover: Pixels };

function BackgroundTab({
  asset,
  pixels,
  transparent,
  onSave,
  cutout,
  setCutout,
  ai,
  onAiResult,
}: {
  asset: MediaAssetRow;
  pixels: Pixels;
  transparent: boolean;
  onSave: SaveEditResult;
  cutout: { pixels: Pixels; model: string; quality?: 'high' | 'basic' } | null;
  setCutout: (cutout: { pixels: Pixels; model: string; quality?: 'high' | 'basic' } | null) => void;
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
  const [choice, setChoice] = useState<BackgroundChoice>({ type: 'color', hex: '#FFFFFF' });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  // La foto con la que se trabaja: la que ya no tiene fondo, o el recorte hecho aquí.
  const subject = transparent ? pixels : (cutout?.pixels ?? null);
  const prefix: PhotoEditStep[] =
    !transparent && cutout ? [{ kind: 'remove_background', engine: 'browser', model: cutout.model }] : [];
  const small = useMemo(() => (subject ? downscale(subject, PREVIEW_SIDE) : null), [subject]);
  // La vista previa enseña lo ELEGIDO (color, imagen o transparente), no un fondo fijo.
  const shown = useMemo(() => {
    if (!small) return null;
    if (choice.type === 'none') return small;
    const backdrop =
      choice.type === 'color'
        ? ({ kind: 'color', hex: choice.hex } as const)
        : ({ kind: 'image', pixels: downscale(choice.cover, PREVIEW_SIDE) } as const);
    return composeCutout(small, backdrop, { shadow });
  }, [small, choice, shadow]);

  const cutAbort = useRef<AbortController | null>(null);
  async function cut() {
    const abort = new AbortController();
    cutAbort.current = abort;
    setCutting(true);
    setCutError(null);
    setProgress(null);
    try {
      const result = await removeBackground(pixels, setProgress, abort.signal);
      setCutout({ pixels: result.pixels, model: result.model, quality: result.quality });
    } catch (error) {
      if (!isRemovalCancelled(error)) setCutError(describeRemovalError(error));
    } finally {
      cutAbort.current = null;
      setCutting(false);
      setProgress(null);
    }
  }
  // Salir del diálogo con el recorte en marcha lo cancela (y corta la descarga).
  useEffect(() => () => cutAbort.current?.abort(), []);

  function chooseColor(hex: string) {
    setColor(hex);
    setChoice({ type: 'color', hex });
  }

  async function chooseImage(row: MediaAssetRow, url: string) {
    if (!subject) return;
    setBusy(true);
    try {
      setChoice({ type: 'asset', asset: row, cover: await loadCoverPixels(url, subject.width, subject.height) });
    } catch (error) {
      toast.error(error instanceof PhotoLoadError ? error.message : translateError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!subject) return;
    setBusy(true);
    try {
      if (choice.type === 'none') {
        await onSave(
          subject,
          prefix,
          'Foto sin fondo guardada en la biblioteca (PNG transparente). La original no ha cambiado.',
        );
        return;
      }
      const backdrop =
        choice.type === 'color'
          ? ({ kind: 'color', hex: choice.hex } as const)
          : ({ kind: 'image', pixels: choice.cover } as const);
      await onSave(
        composeCutout(subject, backdrop, { shadow }),
        [
          ...prefix,
          {
            kind: 'background',
            background:
              choice.type === 'color'
                ? { type: 'color', hex: choice.hex }
                : { type: 'asset', assetId: choice.asset.id },
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
  }, [setCutout]);

  useCommit({
    run: submit,
    // Ya sin fondo y sin elegir otro: no hay nada que guardar.
    disabled: !subject || (choice.type === 'none' && !cutout),
    dirty: Boolean(cutout) && !transparent,
    busy,
    reset,
  });

  return (
    <div className="space-y-4">
      {!subject && (
        <div className="space-y-3" data-testid="photo-edit-cutout">
          <Stage pixels={null} />
          <p className="text-sm">Para cambiar el fondo, primero hay que quitarlo.</p>
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
                    recorte (de 85 a 220 MB según tu navegador; queda guardado); después tarda unos segundos.
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
      {subject && (
        <div className="space-y-3" data-testid="photo-edit-backgrounds">
          <Stage pixels={shown} testId="photo-edit-cutout-preview" checker={choice.type === 'none'} />
          <p className="text-sm">
            {transparent && !cutout ? 'Esta foto ya no tiene fondo.' : 'Fondo quitado.'} Elige uno nuevo (sin IA):
          </p>
          {cutout?.quality === 'basic' && !transparent && (
            <p className="text-xs text-muted" data-testid="photo-edit-cutout-basic">
              Calidad básica: este navegador no tiene aceleración gráfica (WebGPU) suficiente para el recorte fino, así
              que se ha usado el modelo ligero. Los bordes de pelo, cristal o salsa pueden salir menos limpios; en
              Chrome o Edge recientes, con tarjeta gráfica, sale mejor.
            </p>
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
              disabled={choice.type === 'none'}
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

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0);

/** Progreso del recorte en el navegador: descarga del modelo (la 1ª vez), preparación y recorte. */
function CutoutProgressBar({ progress }: { progress: CutoutProgress | null }) {
  const downloading = progress?.phase === 'downloading';
  const pct = downloading ? Math.min(100, Math.round((progress.received / Math.max(1, progress.total)) * 100)) : null;
  const label = downloading
    ? `Descargando el modelo de recorte (${megabytes(progress.total)} MB, solo la primera vez): ${megabytes(progress.received)} de ${megabytes(progress.total)} MB`
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
            const cut = await removeBackground(pixels, setMaskProgress);
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
