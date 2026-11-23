import { FileText, Film, Music } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { Badge, Skeleton } from '@/components/ui';
import { isDriveAsset } from '@/features/drive/api';
import type { MediaAssetRow } from '@/lib/database.types';
import { cn } from '@/lib/utils';
import { previewPath } from './api';
import { DRAG_ASSETS } from './FolderTree';
import { ASSET_KIND_LABEL } from './labels';
import { AssetName } from './AssetName';
import { distinctNames, NAME_CHARS, type DistinctName } from './assetNames';
import { readableName } from './readableName';
import { ThumbImage } from './ThumbImage';
import { useLongPress, useNameReveal } from './useNameReveal';

/** Cuántas miniaturas se pintan de golpe; al llegar al final de la lista se añaden otras tantas. */
export const GRID_BATCH = 96;

function Thumbnail({ asset, url }: { asset: MediaAssetRow; url: string | undefined }) {
  if (asset.mime_type.startsWith('image/')) {
    return url ? <ThumbImage url={url} /> : <Skeleton className="h-full w-full rounded-none" />;
  }
  const Icon = asset.mime_type.startsWith('video/') ? Film : asset.mime_type.startsWith('audio/') ? Music : FileText;
  return (
    <span className="flex h-full w-full items-center justify-center text-muted">
      <Icon className="h-8 w-8" aria-hidden />
    </span>
  );
}

const RevealContext = createContext(false);

/** El botón de la tarjeta: con el ratón, el nombre entero en el título; en el móvil, manteniendo pulsado. */
function GridTileButton({
  assetName,
  onLongPress,
  children,
  onClick,
  ...props
}: { assetName: DistinctName | undefined; onLongPress?: () => void } & ButtonHTMLAttributes<HTMLButtonElement>) {
  // En la biblioteca, mantener pulsado empieza a elegir varias (el nombre ya es legible); en
  // quien solo mira, enseña el nombre entero.
  const reveal = useNameReveal();
  const choose = useLongPress(() => onLongPress?.());
  const handlers = onLongPress ? choose : reveal.handlers;
  return (
    <button type="button" {...props} onClick={onClick} {...handlers} onBlur={reveal.hide} data-testid="library-asset">
      <RevealContext.Provider value={reveal.revealed && Boolean(assetName)}>{children}</RevealContext.Provider>
    </button>
  );
}

function NameSlot({ name, fallback }: { name: DistinctName | undefined; fallback: string }) {
  const revealed = useContext(RevealContext);
  if (!name) return <span className="min-w-0 truncate text-xs font-medium">{fallback}</span>;
  return <AssetName name={name} revealed={revealed} className="flex-1" />;
}

export interface AssetGridProps {
  assets: readonly MediaAssetRow[];
  /** Ruta firmada de cada miniatura (por `previewPath`). */
  urls: ReadonlyMap<string, string> | undefined;
  /** Lado mínimo de cada miniatura, en píxeles. */
  tile: number;
  selection: ReadonlySet<string>;
  openId: string | null;
  canSelect: boolean;
  /**
   * Casillas a la vista (B2): solo al «Elegir varias» (o con algo ya elegido). Si no, la miniatura
   * va limpia; con el ratón, Ctrl/⌘ o Mayús siguen eligiendo.
   */
  showChecks?: boolean;
  /** Pulsación larga en una pantalla táctil: empieza a elegir varias con esa. */
  onLongPress?: (id: string) => void;
  canDrag: boolean;
  onOpen: (id: string) => void;
  /** `range`: con Mayús, desde la última elegida; `toggle`: casilla o Ctrl/⌘. */
  onSelect: (id: string, mode: 'toggle' | 'range') => void;
  /** Cuántas se pintan; lo gestiona quien usa la rejilla para pedir solo esas miniaturas. */
  visible: number;
  onShowMore: () => void;
}

/**
 * Rejilla de miniaturas. Pinta por tandas (`visible`) y pide más al acercarse al
 * final, con carga perezosa de las imágenes: fluida con cientos de archivos.
 */
export function AssetGrid({
  assets,
  urls,
  tile,
  selection,
  openId,
  canSelect,
  showChecks = false,
  onLongPress,
  canDrag,
  onOpen,
  onSelect,
  visible,
  onShowMore,
}: AssetGridProps) {
  const sentinel = useRef<HTMLLIElement>(null);
  const selecting = selection.size > 0 || showChecks;
  const shown = assets.slice(0, visible);
  const [dragging, setDragging] = useState<string | null>(null);
  // Nombres legibles (B4: «Portada reel», no «portada-reel-20261123-085833.jpg») que además se
  // distinguen entre sí (tres «Arroz meloso…» no pueden verse iguales).
  const names = useMemo(() => distinctNames(assets, NAME_CHARS, (a) => readableName(a.file_name)), [assets]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || visible >= assets.length) return;
    // Sin IntersectionObserver (entornos antiguos o de prueba) se pinta todo.
    if (typeof IntersectionObserver === 'undefined') {
      onShowMore();
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onShowMore(), {
      rootMargin: '600px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, assets.length, onShowMore]);

  function click(event: MouseEvent, asset: MediaAssetRow) {
    if (canSelect && event.shiftKey) {
      event.preventDefault();
      onSelect(asset.id, 'range');
    } else if (canSelect && (event.ctrlKey || event.metaKey || selecting)) {
      event.preventDefault();
      onSelect(asset.id, 'toggle');
    } else {
      onOpen(asset.id);
    }
  }

  function dragStart(event: DragEvent, asset: MediaAssetRow) {
    // Arrastrar una de las elegidas lleva todas; una que no lo está, solo ella.
    const ids = selection.has(asset.id) ? [...selection] : [asset.id];
    event.dataTransfer.setData(DRAG_ASSETS, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
    setDragging(asset.id);
  }

  return (
    <ul
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${tile}px, 100%), 1fr))` }}
      data-testid="library-grid"
    >
      {shown.map((asset) => {
        const chosen = selection.has(asset.id);
        return (
          <li key={asset.id} className="group relative">
            <GridTileButton
              assetName={names.get(asset.id)}
              onLongPress={canSelect && onLongPress ? () => onLongPress(asset.id) : undefined}
              title={asset.file_name}
              onClick={(event) => click(event, asset)}
              draggable={canDrag}
              onDragStart={(event) => dragStart(event, asset)}
              onDragEnd={() => setDragging(null)}
              aria-pressed={canSelect && selecting ? chosen : undefined}
              aria-current={openId === asset.id ? 'true' : undefined}
              className={cn(
                'block w-full overflow-hidden rounded-xl border bg-surface text-left shadow-card transition-shadow hover:shadow-pop',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                chosen || openId === asset.id ? 'border-primary ring-2 ring-primary' : 'border-border',
                dragging === asset.id && 'opacity-50',
              )}
            >
              <span className="block aspect-square overflow-hidden bg-subtle">
                <Thumbnail asset={asset} url={urls?.get(previewPath(asset))} />
              </span>
              <span className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <NameSlot name={names.get(asset.id)} fallback={asset.file_name} />
                {isDriveAsset(asset) ? (
                  <span data-testid="library-asset-drive" className="shrink-0">
                    <Badge>Drive</Badge>
                  </span>
                ) : (
                  asset.kind !== 'image' && (
                    <Badge className="shrink-0">{ASSET_KIND_LABEL[asset.kind]}</Badge>
                  )
                )}
              </span>
            </GridTileButton>
            {canSelect && (
              <label
                className={cn(
                  'absolute left-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-surface/90 shadow-card',
                  // Sin casilla en cada miniatura (B2): solo al elegir varias. Con teclado, al enfocarla.
                  chosen || selecting ? 'opacity-100' : 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100',
                )}
              >
                <input
                  type="checkbox"
                  checked={chosen}
                  onChange={() => undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(asset.id, event.shiftKey ? 'range' : 'toggle');
                  }}
                  aria-label={`Elegir ${asset.file_name}`}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            )}
          </li>
        );
      })}
      {visible < assets.length && <li ref={sentinel} aria-hidden className="col-span-full h-8" />}
    </ul>
  );
}
