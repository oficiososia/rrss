import { Film, Images, Search, Upload } from 'lucide-react';
import { useDeferredValue, useMemo, useState, type DragEvent } from 'react';
import { Button, EmptyState, ErrorState, Input, Skeleton } from '@/components/ui';
import { useBrand, useOrg } from '@/features/orgs/context';
import type { AssetKind, MediaAssetRow } from '@/lib/database.types';
import { cn } from '@/lib/utils';
import { previewPath, useSignedUrls } from './api';
import { useAllAssets } from './catalog';
import { applyFilters, countByFolder, EMPTY_FILTERS, isGenerated } from './filters';
import { folderParts } from './folders';
import { ThumbImage } from './ThumbImage';
import { UploadPanel } from './UploadPanel';

/** Tipo con el que `PhotoPanel` arrastra una foto: `{ assetId, fileName }` en texto. */
export const PHOTO_DRAG_TYPE = 'application/x-rrss-photo';

export interface PhotoPanelProps {
  /** Se llama al elegir una foto (clic, toque o Intro). */
  onPick: (asset: MediaAssetRow) => void;
  /**
   * Se llama al empezar a arrastrar una foto. Además, el panel ya deja en el arrastre
   * `PHOTO_DRAG_TYPE` con `{ assetId, fileName }`, para soltarla donde se quiera.
   */
  onDragStart?: (asset: MediaAssetRow, event: DragEvent) => void;
  /** Qué tipos de archivo se ofrecen. Por defecto, solo fotos (`['image']`). */
  kinds?: readonly AssetKind[];
  /** Enseñar también lo que generó la aplicación (exportaciones, «Sin fondo», reels…). Por defecto no. */
  includeGenerated?: boolean;
  /** Ofrecer «Subir» dentro del panel (solo si la persona puede editar la marca). Por defecto sí. */
  allowUpload?: boolean;
  /** Archivo que ya está elegido, para marcarlo. */
  selectedId?: string | null;
  className?: string;
}

/**
 * Panel de fotos para elegir material sin salir de donde se está (el editor de piezas, el de
 * reels…): carpetas de primer nivel a un toque, buscador sin tildes (nombre, etiqueta y
 * carpeta), «Subir» en el propio panel y miniaturas arrastrables. No sabe nada de quien lo
 * usa: avisa con `onPick` / `onDragStart` y ya. Ocupa el alto que le dé su contenedor y hace
 * scroll solo por dentro.
 */
export function PhotoPanel({
  onPick,
  onDragStart,
  kinds = ['image'],
  includeGenerated = false,
  allowUpload = true,
  selectedId = null,
  className,
}: PhotoPanelProps) {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const everything = useAllAssets(brand.id);
  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [uploading, setUploading] = useState(false);
  const [shown, setShown] = useState(60);

  const offered = useMemo(
    () =>
      (everything.data?.rows ?? []).filter(
        (a) => kinds.includes(a.kind) && (includeGenerated || !isGenerated(a)),
      ),
    [everything.data, kinds, includeGenerated],
  );
  // Carpetas de primer nivel, con cuántos archivos ofrecidos hay en cada una.
  const topFolders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [path, n] of countByFolder(offered)) {
      const top = folderParts(path)[0];
      if (top) counts.set(top, (counts.get(top) ?? 0) + n);
    }
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [offered]);
  const rows = useMemo(
    () => applyFilters(offered, { ...EMPTY_FILTERS, folder, search: deferred }, new Map()),
    [offered, folder, deferred],
  );
  const visible = rows.slice(0, shown);
  const urls = useSignedUrls(
    useMemo(() => visible.filter((a) => a.mime_type.startsWith('image/')).map(previewPath), [visible]),
    { variant: 'thumb' },
  );
  const canUpload = allowUpload && can('edit');
  const reset = <T,>(set: (v: T) => void) => (value: T) => {
    set(value);
    setShown(60);
  };

  return (
    <section aria-label="Fotos de la biblioteca" className={cn('flex min-h-0 flex-col gap-2', className)} data-testid="photo-panel">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            aria-label="Buscar fotos por nombre, etiqueta o carpeta"
            placeholder="Buscar fotos"
            className="pl-9"
            value={search}
            onChange={(e) => reset(setSearch)(e.target.value)}
            data-testid="photo-panel-search"
          />
        </div>
        {canUpload && (
          <Button
            variant="secondary"
            onClick={() => setUploading((v) => !v)}
            aria-expanded={uploading}
            data-testid="photo-panel-upload"
          >
            <Upload className="h-4 w-4" aria-hidden />
            Subir
          </Button>
        )}
      </div>

      {canUpload && uploading && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto">
          <UploadPanel organizationId={org.id} brandId={brand.id} folder={folder ?? ''} />
        </div>
      )}

      {topFolders.length > 0 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" role="group" aria-label="Carpetas" data-testid="photo-panel-folders">
          {[{ name: null as string | null, label: 'Todas', count: offered.length }, ...topFolders.map(([name, count]) => ({ name, label: name, count }))].map(
            (chip) => (
              <button
                key={chip.name ?? '__all'}
                type="button"
                aria-pressed={folder === chip.name}
                onClick={() => reset(setFolder)(chip.name)}
                data-testid={`photo-panel-folder-${chip.name ?? 'all'}`}
                className={cn(
                  'min-h-[2.25rem] shrink-0 rounded-full border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                  folder === chip.name ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border bg-surface hover:bg-subtle',
                )}
              >
                {chip.label} <span className="text-xs text-muted">{chip.count}</span>
              </button>
            ),
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="photo-panel-scroll">
        {everything.isPending ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : everything.isError ? (
          <ErrorState error={everything.error} onRetry={() => void everything.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Images}
            title={deferred.trim() || folder ? 'Ninguna foto coincide' : 'Todavía no hay fotos'}
            description={
              deferred.trim() || folder
                ? 'Prueba con otra búsqueda u otra carpeta.'
                : canUpload
                  ? 'Pulsa «Subir» para añadir las primeras.'
                  : 'Quien edita la marca puede subirlas desde la biblioteca.'
            }
          />
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2" data-testid="photo-panel-grid">
              {visible.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    onClick={() => onPick(asset)}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(PHOTO_DRAG_TYPE, JSON.stringify({ assetId: asset.id, fileName: asset.file_name }));
                      event.dataTransfer.effectAllowed = 'copy';
                      onDragStart?.(asset, event);
                    }}
                    aria-pressed={selectedId === asset.id}
                    title={asset.file_name}
                    data-testid="photo-panel-item"
                    className={cn(
                      'block w-full overflow-hidden rounded-lg border bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                      selectedId === asset.id ? 'border-primary ring-2 ring-primary' : 'border-border',
                    )}
                  >
                    <span className="block aspect-square">
                      {asset.mime_type.startsWith('image/') ? (
                        urls.data?.get(previewPath(asset)) ? (
                          <ThumbImage url={urls.data.get(previewPath(asset))!} size={160} />
                        ) : (
                          <Skeleton className="h-full w-full rounded-none" />
                        )
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-muted">
                          <Film className="h-6 w-6" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className="sr-only">{asset.file_name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {rows.length > shown && (
              <div className="mt-3 flex justify-center">
                <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + 60)} data-testid="photo-panel-more">
                  Ver más ({rows.length - shown})
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Lo que `PhotoPanel` deja en un arrastre; `null` si lo arrastrado no es una foto del panel. */
export function readPhotoDrag(event: DragEvent): { assetId: string; fileName: string } | null {
  try {
    const raw = event.dataTransfer.getData(PHOTO_DRAG_TYPE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { assetId?: unknown; fileName?: unknown };
    return typeof parsed.assetId === 'string'
      ? { assetId: parsed.assetId, fileName: typeof parsed.fileName === 'string' ? parsed.fileName : '' }
      : null;
  } catch {
    return null;
  }
}

/** ¿Hay una foto del panel en este arrastre? (se puede mirar mientras se arrastra, sin leer su contenido) */
export const isPhotoDrag = (event: DragEvent): boolean => event.dataTransfer.types.includes(PHOTO_DRAG_TYPE);

