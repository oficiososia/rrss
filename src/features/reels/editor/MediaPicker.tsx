// Elegir fotos y clips de la biblioteca para el reel: varias de una vez, con
// miniatura (también de los clips), filtro «Fotos / Vídeos», buscador y el
// orden en que se eligen marcado con un número. Se enseñan por tandas para no
// firmar ni dibujar cientos de direcciones de golpe.
//
// Lo que la aplicación ya diseñó o montó (exportaciones con titulares, reels,
// portadas) no es material: se oculta salvo con «Ver también diseños y
// montajes». Las fotos con IA y las ediciones sí salen. «Subir», soltar archivos
// y «Crear con IA» (`PickerUpload`) dejan lo nuevo elegido en el acto.
//
// Orden: primero lo que mejor queda en un reel vertical (`rankReelAssets`:
// resolución, nitidez, proporción, vídeos reales; sin repetidos) y, a igualdad,
// lo más reciente. Lo recién subido o creado aquí, siempre lo primero.
import { Clapperboard, Film, Image as ImageIcon, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, ErrorState, Input, Skeleton } from '@/components/ui';
import { previewPath, useSignedUrls } from '@/features/library/api';
import { isAppDesign } from '@/features/library/filters';
import { PickerUpload } from '@/features/library/PickerUpload';
import type { MediaAssetRow } from '@/lib/database.types';
import { cn } from '@/lib/utils';
import type { ReelSourceAsset } from '../api';
import { rankReelAssets } from '../quality';

const PAGE = 48;
type Filter = 'all' | 'image' | 'video';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'image', label: 'Fotos' },
  { id: 'video', label: 'Vídeos' },
];

export interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: ReelSourceAsset[];
  loading: boolean;
  error: unknown;
  /** Cuántas piezas caben todavía en el reel. */
  room: number;
  title?: string;
  description?: string;
  /** Texto del botón, con el número de elegidas: «Añadir 3». */
  confirmLabel?: (count: number) => string;
  /**
   * Con una plantilla: qué va en cada plano, en orden (se marca el que toca
   * elegir). `wanted` son los que hacen falta para la plantilla entera.
   */
  guide?: { steps: string[]; wanted: number };
  onConfirm: (assets: ReelSourceAsset[]) => void;
}

/** Primer fotograma de un clip, solo cuando la casilla llega a verse en pantalla. */
function VideoFrame({ url }: { url: string | undefined }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={ref} className="relative flex h-full w-full items-center justify-center bg-subtle">
      {visible && url ? (
        <video
          src={`${url}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          aria-hidden
          className="h-full w-full object-cover"
          data-testid="reel-media-video-frame"
        />
      ) : (
        <Clapperboard className="h-6 w-6 text-muted" aria-hidden />
      )}
      <Film className="absolute bottom-1 left-1 h-4 w-4 rounded bg-black/60 p-0.5 text-white" aria-hidden />
    </span>
  );
}

export function MediaPicker({
  open,
  onOpenChange,
  sources,
  loading,
  error,
  room,
  title = 'Elige fotos y clips',
  description = 'De la biblioteca de la marca. Toca varias: entran en el reel en el orden en que las eliges.',
  confirmLabel = (n) => (n === 1 ? 'Añadir 1' : `Añadir ${n}`),
  guide,
  onConfirm,
}: MediaPickerProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  const [chosen, setChosen] = useState<string[]>([]);
  const [designs, setDesigns] = useState(false);
  /** Lo subido o creado aquí mismo: sale el primero y ya elegido, aunque la lista aún no se haya refrescado. */
  const [added, setAdded] = useState<ReelSourceAsset[]>([]);

  // Se monta al abrirse (ReelEditor), así que siempre parte de cero.

  const ranked = useMemo(() => rankReelAssets(sources), [sources]);
  const all = useMemo(() => {
    const fresh = new Set(added.map((a) => a.id));
    return [...added, ...ranked.filter((s) => !fresh.has(s.id))];
  }, [added, ranked]);
  const hiddenDesigns = useMemo(() => all.filter((s) => isAppDesign(s)).length, [all]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const fresh = new Set(added.map((a) => a.id));
    return all.filter(
      (s) =>
        (filter === 'all' || s.kind === filter) &&
        (!needle || s.file_name.toLowerCase().includes(needle)) &&
        (designs || fresh.has(s.id) || !isAppDesign(s)),
    );
  }, [all, added, filter, query, designs]);
  const page = useMemo(() => visible.slice(0, shown), [visible, shown]);
  const pagePaths = useMemo(() => (open ? page.map(previewPath).sort() : []), [open, page]);
  const urls = useSignedUrls(pagePaths);
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const full = chosen.length >= room;
  /** Lo nuevo (subido o con IA) entra elegido; con un solo hueco (sustituir), en lugar del elegido. */
  const onAdded = (row: MediaAssetRow) => {
    if (row.kind !== 'image' && row.kind !== 'video') return;
    setAdded((current) => [row, ...current.filter((a) => a.id !== row.id)]);
    setChosen((current) =>
      current.includes(row.id)
        ? current
        : room === 1
          ? [row.id]
          : current.length >= room
            ? current
            : [...current, row.id],
    );
  };

  const toggle = (id: string) =>
    setChosen((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : current.length >= room ? current : [...current, id],
    );
  const confirm = () => {
    onConfirm(chosen.map((id) => byId.get(id)).filter((a): a is ReelSourceAsset => Boolean(a)));
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-muted" data-testid="reel-media-count">
            {chosen.length === 0 ? 'Ninguna elegida' : `${chosen.length} elegida${chosen.length === 1 ? '' : 's'}`}
            {full ? (guide ? ' (todos los planos)' : ' (el máximo del reel)') : ''}
            {guide && chosen.length > 0 && chosen.length < guide.wanted
              ? ` · faltan ${guide.wanted - chosen.length} para la plantilla entera`
              : ''}
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={chosen.length === 0} onClick={confirm} data-testid="reel-media-confirm">
            {confirmLabel(chosen.length)}
          </Button>
        </>
      }
    >
      {guide && (
        <ol
          className="mb-3 flex flex-wrap gap-1.5 text-xs"
          aria-label="Planos de la plantilla"
          data-testid="reel-media-guide"
        >
          {guide.steps.map((step, index) => (
            <li
              key={`${index}-${step}`}
              aria-current={index === chosen.length ? 'step' : undefined}
              className={cn(
                'rounded-full border px-2 py-0.5',
                index < chosen.length
                  ? 'border-primary bg-primary text-primary-fg'
                  : index === chosen.length
                    ? 'border-primary bg-primary-soft font-medium'
                    : 'border-border text-muted',
              )}
            >
              {index + 1}. {step}
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-40">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder="Buscar por nombre"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            aria-label="Buscar"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Qué enseñar">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? 'primary' : 'secondary'}
              aria-pressed={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setShown(PAGE);
              }}
            >
              {f.id === 'image' && <ImageIcon className="h-3.5 w-3.5" aria-hidden />}
              {f.id === 'video' && <Film className="h-3.5 w-3.5" aria-hidden />}
              {f.label}
            </Button>
          ))}
        </div>
      </div>
      {(hiddenDesigns > 0 || designs) && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted" data-testid="reel-media-designs">
          <input type="checkbox" checked={designs} onChange={(e) => setDesigns(e.target.checked)} />
          Ver también diseños y montajes{!designs && hiddenDesigns > 0 ? ` (${hiddenDesigns})` : ''}
        </label>
      )}
      <PickerUpload
        className="mt-3"
        accept={['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']}
        noun="fotos o vídeos"
        aiRatio="9:16"
        onAdded={onAdded}
      >
        {loading ? (
          <Skeleton className="mt-3 h-24" />
        ) : error ? (
          <ErrorState error={error} />
        ) : visible.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {all.length === 0
              ? 'No hay fotos ni clips todavía. Pulsa «Subir» o suéltalos aquí.'
              : 'No hay nada con ese nombre o de ese tipo.'}
          </p>
        ) : (
          <>
            <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="reel-media-picker">
              {page.map((asset) => {
                const url = urls.data?.get(previewPath(asset));
                const order = chosen.indexOf(asset.id);
                const selected = order >= 0;
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${selected ? 'Quitar' : 'Elegir'} «${asset.file_name}»`}
                      disabled={!selected && full}
                      onClick={() => toggle(asset.id)}
                      className={cn(
                        'relative block w-full overflow-hidden rounded-lg border bg-subtle text-left disabled:opacity-40',
                        selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:shadow-pop',
                      )}
                      data-testid="reel-media-option"
                    >
                      <span className="block aspect-square overflow-hidden">
                        {asset.kind === 'video' ? (
                          <VideoFrame url={url} />
                        ) : url ? (
                          <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <Skeleton className="h-full w-full rounded-none" />
                        )}
                      </span>
                      {selected && (
                        <span
                          className="absolute right-1 top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-fg"
                          data-testid="reel-media-order"
                        >
                          {order + 1}
                        </span>
                      )}
                      <span className="block truncate px-2 py-1 text-xs">{asset.file_name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {visible.length > page.length && (
              <div className="mt-3 text-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShown((n) => n + PAGE)}
                  data-testid="reel-media-more"
                >
                  Ver más ({visible.length - page.length})
                </Button>
              </div>
            )}
          </>
        )}
      </PickerUpload>
    </Dialog>
  );
}
