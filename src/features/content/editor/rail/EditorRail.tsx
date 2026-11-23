import {
  Circle,
  Heading,
  Images,
  LayoutTemplate,
  Palette,
  Shapes,
  Square,
  Type,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Skeleton, Spinner } from '@/components/ui';
import type { ImageAspectRatio } from '@/features/ai/imageApi';
import { previewPath, useAssetsByIds, useSignedUrls } from '@/features/library/api';
import { PickerUpload } from '@/features/library/PickerUpload';
import type { MediaAssetRow } from '@/lib/database.types';
import { cn } from '@/lib/utils';
import { writeAssetDrag } from '../assetDrag';
import { STICKER_LABEL, type StickerKind } from '../canvas/stickers';
import type { DrawerId } from './drawers';

// Cajones del editor de piezas, como los de Canva: un riel a la izquierda (en el
// móvil, una barra abajo) con cinco entradas. Al tocar una se abre su cajón al
// lado del lienzo (en el móvil, una hoja baja) y al volver a tocarla, se cierra.
// «Plantillas» abre la galería de plantillas de siempre (un diálogo); los demás
// son paneles: añadir texto y formas, las fotos de la marca, lo que se sube y lo
// de la marca (logotipos, colores y tipografías). Los selectores de la biblioteca
// («Subir», soltar archivos, «Crear con IA») son los de `library/PickerUpload`:
// aquí solo se llaman.

const DRAWERS: { id: DrawerId; label: string; title: string; icon: LucideIcon }[] = [
  { id: 'templates', label: 'Plantillas', title: 'Empezar desde una plantilla de la marca', icon: LayoutTemplate },
  { id: 'elements', label: 'Elementos', title: 'Texto, formas y figuras', icon: Shapes },
  { id: 'photos', label: 'Fotos', title: 'Fotos de la marca', icon: Images },
  { id: 'uploads', label: 'Subidas', title: 'Subir fotos', icon: Upload },
  { id: 'brand', label: 'Marca', title: 'Logotipos, colores y tipografías de la marca', icon: Palette },
];

/** Riel de los cajones: columna a la izquierda en pantallas anchas, barra abajo en el móvil. */
export function EditorRail({
  active,
  onToggle,
  className,
}: {
  active: DrawerId | null;
  onToggle: (id: DrawerId) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Cajones del editor"
      className={cn(
        'flex shrink-0 gap-1 border-border bg-surface',
        // Móvil: barra inferior de 5 huecos iguales. Ancho: columna estrecha.
        'max-lg:border-t max-lg:pb-[env(safe-area-inset-bottom)] lg:w-[4.75rem] lg:flex-col lg:rounded-xl lg:border lg:p-1',
        className,
      )}
      data-testid="editor-rail"
    >
      {DRAWERS.map(({ id, label, title, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={title}
          aria-pressed={active === id}
          onClick={() => onToggle(id)}
          className={cn(
            'flex min-h-[3rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-medium leading-tight text-muted touch-manipulation',
            'hover:bg-subtle hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:flex-none',
            active === id && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
          )}
          data-testid={`drawer-${id}`}
        >
          <Icon className="h-5 w-5" aria-hidden />
          {label}
        </button>
      ))}
    </nav>
  );
}

/**
 * Marco de un cajón o de un panel abierto: título, «cerrar» y su contenido, que se desplaza por dentro.
 * En pantallas anchas es una columna junto al lienzo; en el móvil, una hoja baja sobre la barra.
 */
export function EditorPanel({
  title,
  testId,
  onClose,
  closeLabel = 'Cerrar',
  closeTestId = 'drawer-close',
  wide = false,
  children,
}: {
  title: string;
  testId: string;
  onClose: () => void;
  closeLabel?: string;
  closeTestId?: string;
  /** Algo más ancha (los ajustes, con campos en dos columnas). */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface',
        'max-lg:max-h-[45dvh]',
        wide ? 'lg:w-[20rem]' : 'lg:w-[18rem]',
      )}
      data-testid={testId}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          data-testid={closeTestId}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1"
        data-testid={`${testId}-scroll`}
      >
        {children}
      </div>
    </section>
  );
}

const TILE =
  'flex min-h-[2.75rem] items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-subtle ' +
  'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

/** Cajón «Elementos»: textos, formas básicas y figuras. */
export function ElementsDrawer({
  full,
  fullNote,
  onAddText,
  onAddShape,
}: {
  /** La página ya tiene el máximo de capas. */
  full: boolean;
  fullNote: string;
  onAddText: (kind: 'heading' | 'body') => void;
  onAddShape: (shape: 'rectangle' | 'ellipse' | StickerKind) => void;
}) {
  return (
    <div className="space-y-4">
      {full && <p className="text-xs text-muted">{fullNote}</p>}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted">Texto</h3>
        <button
          type="button"
          className={cn(TILE, 'w-full')}
          disabled={full}
          onClick={() => onAddText('heading')}
          data-testid="add-heading"
        >
          <Heading className="h-4 w-4 shrink-0" aria-hidden />
          <span className="text-base font-bold">Añadir un titular</span>
        </button>
        <button
          type="button"
          className={cn(TILE, 'w-full')}
          disabled={full}
          onClick={() => onAddText('body')}
          data-testid="add-text"
        >
          <Type className="h-4 w-4 shrink-0" aria-hidden />
          Añadir un texto
        </button>
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted">Formas</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={TILE}
            disabled={full}
            onClick={() => onAddShape('rectangle')}
            data-testid="add-rectangle"
          >
            <Square className="h-4 w-4 shrink-0" aria-hidden />
            Rectángulo
          </button>
          <button
            type="button"
            className={TILE}
            disabled={full}
            onClick={() => onAddShape('ellipse')}
            data-testid="add-ellipse"
          >
            <Circle className="h-4 w-4 shrink-0" aria-hidden />
            Elipse
          </button>
          {(Object.keys(STICKER_LABEL) as StickerKind[]).map((shape) => (
            <button
              key={shape}
              type="button"
              className={TILE}
              disabled={full}
              onClick={() => onAddShape(shape)}
              data-testid={`add-sticker-${shape}`}
            >
              {STICKER_LABEL[shape]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// El panel de fotos de la biblioteca (carpetas, buscador, «Subir») se descarga aparte y solo con el cajón abierto.
const LibraryPhotos = lazy(() => import('@/features/library/PhotoPanel').then((m) => ({ default: m.PhotoPanel })));

/** Cajón «Fotos»: la biblioteca de la marca. Tocar una la pone; también se arrastra al lienzo o a un hueco. */
export function PhotosDrawer({ hint, onPick }: { hint: string; onPick: (asset: MediaAssetRow) => void }) {
  return (
    <div className="space-y-2" data-testid="editor-photos">
      <p className="text-xs text-muted">{hint}</p>
      <Suspense fallback={<Spinner label="Cargando las fotos…" />}>
        <LibraryPhotos
          onPick={onPick}
          // Al arrastrar, se añaden las medidas: soltada fuera de un marco, la foto entra con su proporción.
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
  );
}

/** Miniaturas de unos recursos de la biblioteca; tocar uno lo usa y se puede arrastrar al lienzo. */
function ThumbGrid({
  assets,
  onPick,
  testId,
  contain = false,
}: {
  assets: MediaAssetRow[];
  onPick: (asset: MediaAssetRow) => void;
  testId: string;
  contain?: boolean;
}) {
  const paths = useMemo(() => assets.map(previewPath), [assets]);
  const urls = useSignedUrls(paths);
  return (
    <ul className="grid grid-cols-3 gap-2" data-testid={testId}>
      {assets.map((asset) => {
        const url = urls.data?.get(previewPath(asset));
        return (
          <li key={asset.id}>
            <button
              type="button"
              draggable
              onDragStart={(event) =>
                writeAssetDrag(event.dataTransfer, {
                  id: asset.id,
                  name: asset.file_name,
                  width: asset.width,
                  height: asset.height,
                })
              }
              onClick={() => onPick(asset)}
              title={asset.file_name}
              aria-label={asset.file_name}
              className="block aspect-square w-full overflow-hidden rounded-lg border border-border bg-subtle hover:shadow-pop focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              data-testid={`${testId}-item`}
            >
              {url ? (
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className={cn('h-full w-full', contain ? 'object-contain p-1' : 'object-cover')}
                />
              ) : (
                <Skeleton className="h-full w-full rounded-none" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cajón «Subidas»: subir fotos del dispositivo (botón o soltar) o crearlas con IA, con el selector de
 * la biblioteca (`PickerUpload`). Cada foto nueva se pone en el diseño en cuanto está en la
 * biblioteca y queda aquí, para volver a usarla.
 */
export function UploadsDrawer({
  brandId,
  uploadedIds,
  aiRatio,
  onAdded,
  onPick,
}: {
  brandId: string;
  /** Lo subido o creado en esta sesión del editor, lo último primero. */
  uploadedIds: string[];
  aiRatio?: ImageAspectRatio;
  onAdded: (asset: MediaAssetRow) => void;
  onPick: (asset: MediaAssetRow) => void;
}) {
  const uploaded = useAssetsByIds(brandId, uploadedIds);
  const rows = useMemo(() => {
    const byId = new Map((uploaded.data ?? []).map((asset) => [asset.id, asset]));
    return uploadedIds.map((id) => byId.get(id)).filter((asset): asset is MediaAssetRow => Boolean(asset));
  }, [uploaded.data, uploadedIds]);
  return (
    <PickerUpload accept={['image/jpeg', 'image/png', 'image/webp']} aiRatio={aiRatio} onAdded={onAdded}>
      <p className="text-xs text-muted">Lo que subas queda también en la biblioteca de la marca.</p>
      {rows.length > 0 && <ThumbGrid assets={rows} onPick={onPick} testId="uploads" />}
    </PickerUpload>
  );
}

/** Cajón «Marca»: logotipos, colores y tipografías del perfil de la marca. */
export function BrandDrawer({
  brandId,
  logoIds,
  profilePath,
  palette,
  fonts,
  colorTarget,
  full,
  onAddLogo,
  onColor,
  onFont,
}: {
  brandId: string;
  logoIds: string[];
  profilePath: string;
  palette: { hex: string; name: string }[];
  fonts: string[];
  /** A qué se aplica un color: «al texto elegido», «al fondo»… */
  colorTarget: string;
  full: boolean;
  onAddLogo: (asset: MediaAssetRow) => void;
  onColor: (hex: string) => void;
  onFont: (font: string) => void;
}) {
  const logos = useAssetsByIds(brandId, logoIds);
  const rows = useMemo(() => {
    const byId = new Map((logos.data ?? []).map((asset) => [asset.id, asset]));
    return logoIds.map((id) => byId.get(id)).filter((asset): asset is MediaAssetRow => Boolean(asset));
  }, [logos.data, logoIds]);
  const empty = logoIds.length === 0 && palette.length === 0 && fonts.length === 0;
  return (
    <div className="space-y-4" data-testid="brand-drawer">
      {empty && (
        <p className="text-sm text-muted">
          La marca aún no tiene logotipos, colores ni tipografías.{' '}
          <Link to={profilePath} className="underline underline-offset-2 hover:text-fg">
            Añádelos en Marca
          </Link>
          .
        </p>
      )}
      {logoIds.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted">Logotipos</h3>
          {logos.isPending ? <Spinner /> : <ThumbGrid assets={rows} onPick={onAddLogo} testId="brand-logos" contain />}
        </div>
      )}
      {palette.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted">Colores · {colorTarget}</h3>
          <div className="flex flex-wrap gap-2">
            {palette.map((color) => (
              <button
                key={color.hex + color.name}
                type="button"
                onClick={() => onColor(color.hex)}
                title={`${color.name || 'Color de la marca'} ${color.hex}`}
                aria-label={`${color.name || 'Color de la marca'} ${color.hex}: ponerlo ${colorTarget}`}
                className="h-9 w-9 rounded-full border border-border ring-1 ring-inset ring-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                style={{ backgroundColor: color.hex }}
                data-testid="brand-color"
              />
            ))}
          </div>
        </div>
      )}
      {fonts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted">Tipografías</h3>
          {fonts.map((font) => (
            <button
              key={font}
              type="button"
              className={cn(TILE, 'w-full')}
              disabled={full}
              onClick={() => onFont(font)}
              style={{ fontFamily: font }}
              title="Añadir un texto con esta tipografía"
              data-testid="brand-font"
            >
              {font}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
