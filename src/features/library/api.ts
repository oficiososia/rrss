import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { STORAGE_BUCKET } from '@/config/app';
import type { AssetKind, Json, MediaAssetRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import {
  assetKindFromMime,
  buildStoragePath,
  type MediaDimensions,
  readMediaDimensions,
  sha256Hex,
  validateFile,
  xhrUpload,
} from '@/lib/files';
import { supabase, supabaseConfigured } from '@/lib/supabase';

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

/** Etiquetas y carpetas en uso de toda la marca (para los filtros). */
export function useAssetFacets(brandId: string) {
  return useQuery({
    queryKey: assetKeys.facets(brandId),
    queryFn: async () => {
      const [row] = unwrap(await supabase.rpc('asset_facets', { p_brand_id: brandId }));
      return sortFacets(row?.tags ?? [], row?.folders ?? []);
    },
  });
}

/** Ordena etiquetas y carpetas alfabéticamente (castellano), sin repetidos ni vacíos. */
export function sortFacets(tags: string[], folders: string[]) {
  const sort = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  return { tags: sort(tags), folders: sort(folders) };
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
  /** De dónde sale el recurso (p. ej. una exportación del editor). Se guarda al crearlo y no se puede cambiar. */
  provenance?: Json;
  /** Medidas ya conocidas (p. ej. una imagen exportada): evita descodificar el archivo otra vez. */
  dimensions?: MediaDimensions;
  /** Huella ya calculada (para no leer el archivo dos veces). */
  sha256?: string;
  /**
   * Provisional: se sube antes de enlazarlo (logotipo del perfil sin guardar).
   * Si nadie lo enlaza ni lo organiza, el servidor lo borra pasadas 48 horas.
   */
  provisional?: boolean;
  /** Porcentaje real (0-100) de bytes subidos del archivo. */
  onProgress?: (percent: number) => void;
}

/**
 * Sube el objeto a Storage. Con `onProgress` se usa XMLHttpRequest contra la
 * misma API REST que usa supabase-js (es lo único que mide bytes reales);
 * sin él, el cliente normal.
 */
async function uploadObject(path: string, file: File, onProgress?: (percent: number) => void): Promise<void> {
  if (!onProgress || !supabaseConfigured) {
    const upload = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type });
    if (upload.error) throw upload.error;
    return;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw { message: 'Tu sesión ha caducado. Vuelve a iniciar sesión.', statusCode: 401 };
  const base = String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '');
  await xhrUpload({
    url: `${base}/storage/v1/object/${STORAGE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY),
      'Content-Type': file.type,
      'Cache-Control': 'max-age=3600',
      'x-upsert': 'false',
    },
    body: file,
    onProgress,
  });
}

/**
 * Sube un archivo a la biblioteca: objeto en Storage + fila en media_assets.
 * Si la fila no se puede crear, se borra el objeto para no dejar huérfanos.
 */
export async function uploadAsset(input: UploadInput): Promise<MediaAssetRow> {
  const { organizationId, brandId, file } = input;
  const invalid = validateFile(file);
  if (invalid) throw new Error(invalid);

  const [sha256, dimensions] = await Promise.all([
    input.sha256 ?? sha256Hex(file),
    input.dimensions ?? readMediaDimensions(file),
  ]);
  const path = buildStoragePath(organizationId, brandId, 'media', file.name);

  await uploadObject(path, file, input.onProgress);

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
      ...(input.provenance ? { provenance: input.provenance } : {}),
      // El valor da igual: la base de datos fija el plazo.
      ...(input.provisional ? { provisional_until: new Date().toISOString() } : {}),
    })
    .select('*')
    .single();

  if (inserted.error) {
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    throw inserted.error;
  }
  return inserted.data;
}

/**
 * Borra archivos de Storage y, solo si se han borrado, sus anotaciones en la
 * cola de limpieza. Nunca lanza: devuelve si ha podido hacerlo todo.
 */
async function removeStoredFiles(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) return false;
    const cleared = await supabase.from('storage_cleanup_queue').delete().in('storage_path', paths);
    return !cleared.error;
  } catch {
    return false;
  }
}

/** Borra recursos (fila y archivo) de una vez. Lo usa quien sube y se arrepiente antes de enlazarlos. */
export async function deleteAssets(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = unwrap(await supabase.from('media_assets').delete().in('id', ids).select('id, storage_path'));
  await removeStoredFiles(rows.map((r) => r.storage_path));
}

/**
 * Limpieza de archivos huérfanos: borra de Storage los que quedaron anotados al
 * eliminar su recurso y no se pudieron borrar entonces. Devuelve cuántos
 * archivos se han procesado. Solo tienen acceso a la cola quienes editan la marca.
 */
export async function sweepStorageCleanup(brandId: string, limit = 100): Promise<number> {
  const rows = unwrap(
    await supabase
      .from('storage_cleanup_queue')
      .select('storage_path')
      .eq('brand_id', brandId)
      .order('created_at')
      .limit(limit),
  );
  const paths = rows.map((r) => r.storage_path);
  return (await removeStoredFiles(paths)) ? paths.length : 0;
}

/** Al abrir la biblioteca, reintenta los borrados pendientes (una vez por visita). Silencioso si falla. */
export function useStorageCleanup(brandId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void sweepStorageCleanup(brandId).catch(() => undefined);
  }, [brandId, enabled]);
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
      // Primero la fila (es lo que ve la app); un disparador anota la ruta en la
      // cola de limpieza. Después se intenta borrar el archivo: si falla, la
      // anotación se queda y se reintenta en la siguiente visita (no es un error
      // para quien borra, el recurso ya no existe).
      const rows = unwrap(await supabase.from('media_assets').delete().eq('id', asset.id).select('id'));
      if (rows.length === 0) throw { code: '42501', message: 'permission denied' };
      await removeStoredFiles([asset.storage_path]);
    },
    onSuccess,
  });

  return { update, remove };
}
