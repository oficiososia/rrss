import { Images, Search } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, EmptyState, ErrorState, Input, Skeleton, Spinner } from '@/components/ui';
import { useAssets, useAssetsByIds, useSignedUrls } from '@/features/library/api';
import type { MediaAssetRow } from '@/lib/database.types';

interface PickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (asset: MediaAssetRow) => void;
}

function AssetGrid({
  assets,
  onPick,
  testId,
}: {
  assets: MediaAssetRow[];
  onPick: (asset: MediaAssetRow) => void;
  testId: string;
}) {
  const paths = useMemo(() => assets.map((a) => a.storage_path), [assets]);
  const urls = useSignedUrls(paths);
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid={testId}>
      {assets.map((asset) => {
        const url = urls.data?.get(asset.storage_path);
        return (
          <li key={asset.id}>
            <button
              type="button"
              onClick={() => onPick(asset)}
              className="block w-full overflow-hidden rounded-lg border border-border bg-surface text-left hover:shadow-pop"
              data-testid="picker-asset"
            >
              <span className="block aspect-square bg-subtle">
                {url ? (
                  <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" />
                ) : (
                  <Skeleton className="h-full w-full rounded-none" />
                )}
              </span>
              <span className="block truncate px-2 py-1.5 text-xs">{asset.file_name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Elegir una imagen de la biblioteca de la marca. */
export function ImagePickerDialog({
  brandId,
  libraryPath,
  open,
  onOpenChange,
  onPick,
}: PickerProps & { brandId: string; libraryPath: string }) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const filters = useMemo(() => ({ kind: 'image' as const, tag: '', folder: '', search: deferred }), [deferred]);
  const assets = useAssets(brandId, filters);
  const rows = useMemo(() => assets.data?.pages.flat() ?? [], [assets.data]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Añadir imagen"
      description="Fotos de la biblioteca de la marca."
      size="lg"
    >
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Buscar imagen por nombre"
          placeholder="Buscar por nombre"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {assets.isPending ? (
        <Spinner />
      ) : assets.isError ? (
        <ErrorState error={assets.error} onRetry={() => void assets.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Images}
          title={deferred.trim() ? 'Ninguna imagen con ese nombre' : 'No hay imágenes en la biblioteca'}
          description="Sube las fotos de la marca en la Biblioteca y vuelve aquí."
          action={
            <Link to={libraryPath}>
              <Button variant="secondary">Ir a la biblioteca</Button>
            </Link>
          }
        />
      ) : (
        <>
          <AssetGrid assets={rows} onPick={onPick} testId="image-picker" />
          {assets.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void assets.fetchNextPage()}
                loading={assets.isFetchingNextPage}
              >
                Cargar más
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** Elegir uno de los logotipos del perfil de marca. */
export function LogoPickerDialog({
  brandId,
  logoIds,
  profilePath,
  open,
  onOpenChange,
  onPick,
}: PickerProps & { brandId: string; logoIds: string[]; profilePath: string }) {
  const logos = useAssetsByIds(brandId, logoIds);
  const rows = useMemo(() => {
    const byId = new Map((logos.data ?? []).map((a) => [a.id, a]));
    return logoIds.map((id) => byId.get(id)).filter((a): a is MediaAssetRow => Boolean(a));
  }, [logos.data, logoIds]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Añadir logotipo"
      description="Los logotipos del perfil de marca."
    >
      {logoIds.length === 0 ? (
        <EmptyState
          icon={Images}
          title="La marca no tiene logotipos"
          description="Añádelos en Marca, en la sección de identidad visual."
          action={
            <Link to={profilePath}>
              <Button variant="secondary">Ir al perfil de marca</Button>
            </Link>
          }
        />
      ) : logos.isPending ? (
        <Spinner />
      ) : logos.isError ? (
        <ErrorState error={logos.error} onRetry={() => void logos.refetch()} />
      ) : (
        <AssetGrid assets={rows} onPick={onPick} testId="logo-picker" />
      )}
    </Dialog>
  );
}
