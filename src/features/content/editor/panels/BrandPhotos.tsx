import { lazy, Suspense, useState } from 'react';
import { Spinner } from '@/components/ui';
import type { MediaAssetRow } from '@/lib/database.types';
import { writeAssetDrag } from '../assetDrag';
import { recalledSection, rememberSection } from './sectionMemory';

// El panel de fotos de la biblioteca (carpetas, buscador, «Subir») se descarga aparte y solo si la
// sección está abierta: lee toda la biblioteca de la marca.
const PhotoPanel = lazy(() => import('@/features/library/PhotoPanel').then((m) => ({ default: m.PhotoPanel })));

const SECTION = 'editor.photos';

/**
 * Las fotos de la marca a mano en el panel «Diseño», sin abrir un diálogo que tape el diseño:
 * tocar una la pone (en el hueco elegido, o en el primero vacío, o como capa nueva) y también se
 * puede arrastrar al lienzo o a un marco concreto. Plegable; el navegador recuerda cómo se dejó.
 */
export function BrandPhotos({ hint, onPick }: { hint: string; onPick: (asset: MediaAssetRow) => void }) {
  const [open, setOpen] = useState(() => recalledSection(SECTION) ?? true);
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        rememberSection(SECTION, next);
      }}
      className="group border-t border-border"
      data-testid="editor-photos"
      data-section={SECTION}
    >
      <summary className="flex min-h-[2.5rem] cursor-pointer list-none items-center gap-2 rounded text-sm font-medium text-fg marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-lg:min-h-[2.75rem] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">Fotos de la marca</span>
        <span
          aria-hidden
          className="mr-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-base leading-none text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      {open && (
        <div className="space-y-2 pb-3 pt-1">
          <p className="text-xs text-muted">{hint}</p>
          <Suspense fallback={<Spinner label="Cargando las fotos…" />}>
            <PhotoPanel
              onPick={onPick}
              // Al arrastrar, se añaden las medidas al dato del panel: así, soltada fuera de un marco, la
              // foto entra con su proporción.
              onDragStart={(asset, event) =>
                writeAssetDrag(event.dataTransfer, {
                  id: asset.id,
                  name: asset.file_name,
                  width: asset.width,
                  height: asset.height,
                })
              }
            />
          </Suspense>
        </div>
      )}
    </details>
  );
}
