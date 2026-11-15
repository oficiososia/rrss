import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STORAGE_BUCKET } from '@/config/app';
import type { AssetKind, Json, MediaAssetRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { assetKindFromMime, buildStoragePath, readMediaDimensions, sha256Hex, validateFile } from '@/lib/files';
import { supabase } from '@/lib/supabase';

export const ASSET_PAGE_SIZE = 48;

export interface AssetFilters {
  kind: AssetKind | '';
  tag: string;
  folder: string;
  search: string;
}

export const assetKeys = {
  all: (brandId: string) => ['brand', brandId, 'assets'] as const,
  list: (brandId: string, filters: AssetFilters) => ['brand', brandId, 'assets', 'list', filters] as const,
  facets: (brandId: string) => ['brand', brandId, 'assets', 'facets'] as const,
  count: (brandId: string) => ['brand', brandId, 'assets', 'count'] as const,
  byIds: (brandId: string, ids: string[]) => ['brand', brandId, 'assets', 'ids', ids] as const,
  signed: (paths: string[]) => ['signed-urls', paths] as const,
};

/** Escapa los comodines de LIKE para buscar el texto tal cual. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function useAssets(brandId: string, filters: AssetFilters) {
  return useInfiniteQuery({
    queryKey: assetKeys.list(brandId, filters),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<MediaAssetRow[]> => {
      let query = supabase
        .from('media_assets')
        .select('*')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(pageParam, pageParam + ASSET_PAGE_SIZE - 1);
      if (filters.kind) query = query.eq('kind', filters.kind);
      if (filters.tag) query = query.contains('tags', [filters.tag]);
      if (filters.folder) query = query.eq('folder', filters.folder);
      if (filters.search.trim()) query = query.ilike('file_name', likePattern(filters.search.trim()));
      return unwrap(await query);
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < ASSET_PAGE_SIZE ? undefined : pages.length * ASSET_PAGE_SIZE,
  });
}

/** Etiquetas y carpetas en uso (para los filtros). Se limita a los 1000 recursos más recientes. */
export function useAssetFacets(brandId: string) {
  return useQuery({
    queryKey: assetKeys.facets(brandId),
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('media_assets')
          .select('tags, folder')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(1000),
      );
      const tags = new Set<string>();
      const folders = new Set<string>();
      for (const row of rows) {
        row.tags.forEach((t) => tags.add(t));
        if (row.folder) folders.add(row.folder);
      }
      const sort = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b, 'es'));
      return { tags: sort(tags), folders: sort(folders) };
    },
  });
}

export function useAssetCount(brandId: string) {
  return useQuery({
    queryKey: assetKeys.count(brandId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('media_assets')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useAssetsByIds(brandId: string, ids: string[]) {
  return useQuery({
    queryKey: assetKeys.byIds(brandId, ids),
    enabled: ids.length > 0,
    queryFn: async () => unwrap(await supabase.from('media_assets').select('*').eq('brand_id', brandId).in('id', ids)),
  });
}

/** URL firmadas (1 h) para previsualizar archivos del cubo privado. */
export function useSignedUrls(paths: string[]) {
  return useQuery({
    queryKey: assetKeys.signed(paths),
    enabled: paths.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(paths, 3600);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const item of data ?? []) {
        if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
      }
      return map;
    },
  });
}

export async function findDuplicate(brandId: string, sha256: string): Promise<MediaAssetRow | null> {
  const rows = unwrap(
    await supabase.from('media_assets').select('*').eq('brand_id', brandId).eq('sha256', sha256).limit(1),
  );
  return rows[0] ?? null;
}

export interface UploadInput {
  organizationId: string;
  brandId: string;
  file: File;
  kind?: AssetKind;
  folder?: string;
  tags?: string[];
  /** Huella ya calculada (para no leer el archivo dos veces). */
  sha256?: string;
}

/**
 * Sube un archivo a la biblioteca: objeto en Storage + fila en media_assets.
 * Si la fila no se puede crear, se borra el objeto para no dejar huérfanos.
 */
export async function uploadAsset(input: UploadInput): Promise<MediaAssetRow> {
  const { organizationId, brandId, file } = input;
  const invalid = validateFile(file);
  if (invalid) throw new Error(invalid);

  const [sha256, dimensions] = await Promise.all([input.sha256 ?? sha256Hex(file), readMediaDimensions(file)]);
  const path = buildStoragePath(organizationId, brandId, 'media', file.name);

  const upload = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type });
  if (upload.error) throw upload.error;

  const inserted = await supabase
    .from('media_assets')
    .insert({
      brand_id: brandId,
      organization_id: organizationId,
      kind: input.kind ?? assetKindFromMime(file.type),
      storage_path: path,
      file_name: file.name.slice(0, 255),
      mime_type: file.type,
      bytes: file.size,
      width: dimensions.width,
      height: dimensions.height,
      duration_ms: dimensions.durationMs,
      sha256,
      folder: input.folder ?? '',
      tags: input.tags ?? [],
    })
    .select('*')
    .single();

  if (inserted.error) {
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    throw inserted.error;
  }
  return inserted.data;
}

export interface AssetPatch {
  kind: AssetKind;
  file_name: string;
  folder: string;
  tags: string[];
  rights: Json;
}

export function useAssetMutations(brandId: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: assetKeys.all(brandId) });

  const update = useMutation({
    mutationFn: async (input: { id: string; patch: AssetPatch }) => {
      const rows = unwrap(await supabase.from('media_assets').update(input.patch).eq('id', input.id).select('id'));
      if (rows.length === 0) throw { code: '42501', message: 'permission denied' };
    },
    onSuccess,
  });

  const remove = useMutation({
    mutationFn: async (asset: Pick<MediaAssetRow, 'id' | 'storage_path'>) => {
      // Primero la fila (es lo que ve la app); después el objeto.
      const rows = unwrap(await supabase.from('media_assets').delete().eq('id', asset.id).select('id'));
      if (rows.length === 0) throw { code: '42501', message: 'permission denied' };
      const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([asset.storage_path]);
      if (error) throw error;
    },
    onSuccess,
  });

  return { update, remove };
}
