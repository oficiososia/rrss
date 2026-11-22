import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { createContentItem, saveContentVersion } from '@/features/content/api';
import { createEmptyDocument } from '@/features/content/document';
import { newImageLayer } from '@/features/content/editor/layers';
import { isDrivePath, signDrivePaths } from '@/features/drive/api';
import { signStoragePaths } from '@/features/storage/api';
import type { AssetUsageRow, MediaAssetRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { assetKeys, deleteAssets } from './api';

// Biblioteca con cientos de archivos: lectura completa de la marca, en qué piezas
// se usa cada archivo y las acciones por lotes (mover, etiquetar, borrar,
// renombrar carpetas, descargar, usar en una publicación).

/** Tamaño de cada petición al leer toda la biblioteca de la marca. */
export const ALL_ASSETS_PAGE = 500;
/** Tope de seguridad: más archivos que esto no se leen enteros (la pantalla lo avisa). */
export const ALL_ASSETS_MAX = 5000;

/**
 * TODOS los archivos de la marca (hasta `ALL_ASSETS_MAX`), leídos por tandas. La
 * biblioteca filtra, ordena y cuenta en el navegador sobre esta lista: el árbol
 * de carpetas, sus contadores y los filtros por uso siempre cuadran entre sí.
 */
export function useAllAssets(brandId: string) {
  return useQuery({
    queryKey: assetKeys.everything(brandId),
    staleTime: 30_000,
    queryFn: async (): Promise<{ rows: MediaAssetRow[]; truncated: boolean }> => {
      const rows: MediaAssetRow[] = [];
      for (let from = 0; from < ALL_ASSETS_MAX; from += ALL_ASSETS_PAGE) {
        const page = unwrap(
          await supabase
            .from('media_assets')
            .select('*')
            .eq('brand_id', brandId)
            .order('created_at', { ascending: false })
            .order('id')
            .range(from, from + ALL_ASSETS_PAGE - 1),
        );
        rows.push(...page);
        if (page.length < ALL_ASSETS_PAGE) return { rows, truncated: false };
      }
      return { rows, truncated: true };
    },
  });
}

export interface AssetUsage {
  /** Piezas donde se usa cada archivo (también las archivadas). */
  byAsset: Map<string, AssetUsageRow[]>;
  /** En cuántas piezas (no archivadas) se usa cada archivo. */
  counts: Map<string, number>;
}

/**
 * En qué piezas se usa cada archivo (`asset_usage`). Si la consulta no está
 * disponible (base de datos sin la migración, fallo de red) la pantalla NO inventa
 * usos: `data` queda sin definir y se ocultan el filtro «Sin usar» y el orden por uso.
 */
export function useAssetUsage(brandId: string) {
  return useQuery({
    queryKey: assetKeys.usage(brandId),
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<AssetUsage> => {
      const rows = unwrap(await supabase.rpc('asset_usage', { p_brand_id: brandId }));
      const byAsset = new Map<string, AssetUsageRow[]>();
      const counts = new Map<string, number>();
      for (const row of rows) {
        byAsset.set(row.asset_id, [...(byAsset.get(row.asset_id) ?? []), row]);
        if (!row.archived) counts.set(row.asset_id, (counts.get(row.asset_id) ?? 0) + 1);
      }
      return { byAsset, counts };
    },
  });
}

/** Trozos de `items` de tamaño `size`: para no lanzar cientos de peticiones a la vez. */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const NO_PERMISSION = { code: '42501', message: 'permission denied' };

export function useLibraryMutations(brandId: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: assetKeys.all(brandId) });

  /** Mueve archivos a una carpeta (`''` = sacarlos de su carpeta). */
  const move = useMutation({
    mutationFn: async (input: { ids: string[]; folder: string }) => {
      for (const group of chunks(input.ids, 100)) {
        const rows = unwrap(
          await supabase.from('media_assets').update({ folder: input.folder }).in('id', group).select('id'),
        );
        if (rows.length === 0) throw NO_PERMISSION;
      }
    },
    onSuccess,
  });

  /** Añade etiquetas a varios archivos, respetando las que ya tienen. */
  const addTags = useMutation({
    mutationFn: async (input: { assets: Pick<MediaAssetRow, 'id' | 'tags'>[]; tags: string[] }) => {
      const wanted = input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
      for (const asset of input.assets) {
        const next = [...new Set([...asset.tags, ...wanted])];
        if (next.length === asset.tags.length) continue;
        const rows = unwrap(await supabase.from('media_assets').update({ tags: next }).eq('id', asset.id).select('id'));
        if (rows.length === 0) throw NO_PERMISSION;
      }
    },
    onSuccess,
  });

  /** Borra varios archivos (fila y archivo). Devuelve cuántos. */
  const removeMany = useMutation({
    mutationFn: async (assets: Pick<MediaAssetRow, 'id'>[]) => {
      const ids = assets.map((a) => a.id);
      for (const group of chunks(ids, 50)) await deleteAssets(group);
      return ids.length;
    },
    onSuccess,
  });

  /** Renombra una carpeta y las de dentro: cambia el texto de `folder` de cada archivo afectado. */
  const renameFolder = useMutation({
    mutationFn: async (renames: Array<{ from: string; to: string }>) => {
      for (const { from, to } of renames) {
        unwrap(
          await supabase.from('media_assets').update({ folder: to }).eq('brand_id', brandId).eq('folder', from).select('id'),
        );
      }
    },
    onSuccess,
  });

  return { move, addTags, removeMany, renameFolder };
}

/**
 * Carpetas vacías que la persona ha creado y todavía no tienen ningún archivo. En
 * la base de datos una carpeta existe por los archivos que contiene, así que estas
 * viven solo en este navegador hasta que se mueve algo dentro.
 */
export function useEmptyFolders(brandId: string) {
  const key = `rrss.library.folders.${brandId}`;
  const read = useCallback((): string[] => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
      return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }, [key]);
  // Lo guardado vale para esta marca; al cambiar de marca se vuelve a leer.
  const [state, setState] = useState(() => ({ key, folders: read() }));
  const folders = state.key === key ? state.folders : read();
  const save = useCallback(
    (next: string[]) => {
      setState({ key, folders: next });
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Sin almacenamiento del navegador, la carpeta dura lo que dure la pantalla.
      }
    },
    [key],
  );
  return { folders, save };
}

/** Direcciones para DESCARGAR archivos (con su nombre cuando el almacén lo permite). */
export async function downloadUrls(assets: Pick<MediaAssetRow, 'storage_path'>[]): Promise<string[]> {
  const paths = assets.map((a) => a.storage_path);
  const drive = paths.filter(isDrivePath);
  const storage = paths.filter((p) => !isDrivePath(p));
  const map = new Map<string, string>();
  if (storage.length) for (const [k, v] of await signStoragePaths(storage, 3600, { download: true })) map.set(k, v);
  if (drive.length) for (const [k, v] of await signDrivePaths(drive, 'full')) map.set(k, v);
  return paths.flatMap((p) => {
    const url = map.get(p);
    return url ? [url] : [];
  });
}

/**
 * «Usar en una publicación»: crea una idea de Instagram (publicación 4:5) con la
 * foto de fondo y devuelve el id de la pieza para abrirla en el editor.
 */
export async function createPostFromAsset(input: {
  organizationId: string;
  brandId: string;
  asset: Pick<MediaAssetRow, 'id' | 'file_name'>;
}): Promise<string> {
  const title = input.asset.file_name.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 200) || 'Publicación con foto';
  const item = await createContentItem({
    organizationId: input.organizationId,
    brandId: input.brandId,
    title,
    network: 'instagram',
    format: 'post',
  });
  const document = createEmptyDocument({ aspectRatio: '4:5' });
  const page = document.pages[0]!;
  page.layers = [newImageLayer(document.canvas, [], { id: input.asset.id, name: input.asset.file_name })];
  await saveContentVersion({ contentId: item.id, document, note: 'Creada desde la biblioteca' });
  return item.id;
}
