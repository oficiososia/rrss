// Datos de «Hacer un reel como este» (docs/reel-como-este.md):
//
//   1. `useReelLikeOptions`  pregunta a la función `ai-reel-like` si la marca
//      puede usarlo y cuánto costaría como mucho (para enseñarlo ANTES).
//   2. `useStartAnalysis`    sube el vídeo a la carpeta privada de referencias
//      (o manda el enlace) y encarga `media.reel.analyze` al trabajador.
//   3. `useReelReference`    sigue el análisis (`reel_references`, RLS).
//   4. `useStudyReference`   lanza la parte de IA cuando el vídeo ya está medido.
//   5. Guardar la plantilla (formato compartido), descartar y enlazar con la pieza.
//
// Las mutaciones se exponen con `mutateAsync` (como en `ai/api.ts`).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STORAGE_BUCKET } from '@/config/app';
import { AiRequestError, toAiError } from '@/features/ai/api';
import { sweepStorageCleanup } from '@/features/library/api';
import { signedUrlFor } from '@/features/photo-edit/api';
import type { Json, MediaAssetRow, ReelReferenceRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { REFERENCE_LIMITS, type ReelLikeResult } from '../../../../supabase/functions/_shared/reels/like';
import { reelTemplateKeys } from '../editor/api';
import { REEL_TEMPLATES } from '../templates';
import type { LibraryAsset } from './draft';
import { TEMPLATE_NAME_MAX, templateKey, toReelTemplate, type TemplateOrigin } from './template';

export const FUNCTION = 'ai-reel-like';
export const ANALYZE_KIND = 'media.reel.analyze';
/** Cada cuánto se mira el análisis mientras se mide o se escribe. */
export const REFERENCE_POLL_MS = 3000;

/** Rutas de la función dentro de una marca. */
export function reelLikePaths(orgId: string, brandId: string) {
  const reels = `/o/${orgId}/m/${brandId}/biblioteca/reels`;
  return { reels, start: `${reels}/como-este`, reference: (id: string) => `${reels}/como-este/${id}` };
}

/** Parámetro con el nombre que se escribió en «Nuevo reel»: viaja hasta la pieza que se crea. */
export const NAME_PARAM = 'nombre';

/** La dirección con el nombre de la pieza, si lo hay (`?nombre=…`). */
export function withName(path: string, name: string | null | undefined): string {
  const clean = (name ?? '').trim().slice(0, 200);
  return clean ? `${path}?${NAME_PARAM}=${encodeURIComponent(clean)}` : path;
}

/**
 * Redes que no dejan descargar sus vídeos desde un enlace (sin sesión, sin
 * JavaScript): se dice ANTES de pegar el enlace y no se manda a estudiar.
 */
const CLOSED_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)(facebook\.com|fb\.watch)$/, 'Facebook'],
];

/** La red de un enlace que no deja descargar su vídeo, o null si puede que sí. */
export function closedNetwork(value: string): string | null {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return CLOSED_HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Un vídeo de la biblioteca de la marca que se puede estudiar. */
export type LibraryVideo = Pick<
  MediaAssetRow,
  'id' | 'file_name' | 'mime_type' | 'bytes' | 'duration_ms' | 'storage_path' | 'folder' | 'created_at'
>;

/** Los vídeos de la biblioteca de la marca, los más nuevos primero (para estudiar uno como referencia). */
export function useLibraryVideos(brandId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...likeKeys.library(brandId), 'videos'] as const,
    enabled,
    queryFn: async (): Promise<LibraryVideo[]> =>
      unwrap(
        await supabase
          .from('media_assets')
          .select('id, file_name, mime_type, bytes, duration_ms, storage_path, folder, created_at')
          .eq('brand_id', brandId)
          .eq('kind', 'video')
          .order('created_at', { ascending: false })
          .limit(200),
      ) as LibraryVideo[],
  });
}

/** Por qué un vídeo de la biblioteca no vale como referencia (formato, peso, duración), o null si vale. */
export function libraryVideoProblem(
  video: LibraryVideo,
  limits: { maxUploadBytes: number; maxSeconds: number },
): string | null {
  const problem = referenceFileProblem({ size: video.bytes, type: video.mime_type }, limits.maxUploadBytes);
  if (problem) return problem;
  if (video.duration_ms !== null && video.duration_ms / 1000 > limits.maxSeconds + 0.5) {
    return `Dura ${Math.round(video.duration_ms / 1000)} s y el máximo son ${limits.maxSeconds} s.`;
  }
  return null;
}

/**
 * Trae un vídeo de la biblioteca como archivo, para estudiarlo por el mismo
 * camino que uno subido: se copia a la carpeta privada de referencias y el
 * original de la biblioteca no se toca (ni se borra al terminar).
 */
export async function fetchLibraryVideo(video: LibraryVideo, signal?: AbortSignal): Promise<File> {
  const url = await signedUrlFor(video.storage_path);
  if (!url) throw new Error('No se ha podido abrir el vídeo de la biblioteca.');
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error('No se ha podido leer el vídeo de la biblioteca.');
  const blob = await response.blob();
  return new File([blob], video.file_name, { type: video.mime_type });
}

export const likeKeys = {
  all: (brandId: string) => ['brand', brandId, 'reel-like'] as const,
  options: (brandId: string) => ['brand', brandId, 'reel-like', 'options'] as const,
  reference: (brandId: string, id: string) => ['brand', brandId, 'reel-like', 'reference', id] as const,
  recent: (brandId: string) => ['brand', brandId, 'reel-like', 'recent'] as const,
  library: (brandId: string) => ['brand', brandId, 'reel-like', 'library'] as const,
};

export interface ReelLikeEstimate {
  /** Mirar los fotogramas y escribir, como mucho (micros). */
  textMicros: number;
  /** Transcribir la voz, como mucho. */
  speechMicros: number;
  speechMicrosPerSecond: number | null;
  /** Todo junto. */
  maxMicros: number;
}

export interface ReelLikeOptions {
  available: boolean;
  /** Por qué no: sin modelo con visión, modo agencia o marca sin perfil. */
  reason?: 'not_configured' | 'agency_mode' | 'profile_missing';
  speechAvailable: boolean;
  estimate: ReelLikeEstimate | null;
  limits: { maxSeconds: number; maxUploadBytes: number; maxSpeechSeconds: number; maxFrames: number };
}

const NOT_AVAILABLE: ReelLikeOptions = {
  available: false,
  reason: 'not_configured',
  speechAvailable: false,
  estimate: null,
  limits: {
    maxSeconds: REFERENCE_LIMITS.maxSeconds,
    maxUploadBytes: REFERENCE_LIMITS.maxUploadBytes,
    maxSpeechSeconds: REFERENCE_LIMITS.maxSpeechSeconds,
    maxFrames: 12,
  },
};

/** Códigos propios de `ai-reel-like`: su mensaje ya está escrito para la persona. */
const OWN_CODES = new Set([
  'not_measured',
  'busy',
  'files_missing',
  'reference_closed',
  'reference_not_found',
  'agency_mode',
]);

/** Error de la función → `AiRequestError` (el cupo y lo demás, como en el resto de la IA). */
export async function toLikeError(error: unknown): Promise<AiRequestError> {
  const context = typeof error === 'object' && error !== null ? (error as { context?: unknown }).context : undefined;
  if (context instanceof Response) {
    const body = (await context
      .clone()
      .json()
      .catch(() => null)) as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | null;
    const payload = body?.error;
    if (typeof payload?.code === 'string' && OWN_CODES.has(payload.code) && typeof payload.message === 'string') {
      return new AiRequestError('invalid_request', payload.message, {
        retryable: payload.retryable === true,
        status: context.status,
      });
    }
  }
  return toAiError(error);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FUNCTION, { body });
  if (error) throw await toLikeError(error);
  return data as T;
}

/**
 * ¿Puede esta marca usar «Hacer un reel como este» y cuánto costaría como
 * mucho? Si la función no contesta (no está desplegada), no está disponible:
 * el botón no sale.
 */
export function useReelLikeOptions(brandId: string, enabled: boolean) {
  return useQuery({
    queryKey: likeKeys.options(brandId),
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<ReelLikeOptions> => {
      try {
        const options = await invoke<ReelLikeOptions>({ action: 'options', brandId });
        return options && typeof options.available === 'boolean' ? options : NOT_AVAILABLE;
      } catch {
        return NOT_AVAILABLE;
      }
    },
  });
}

/** ¿Sigue trabajando el servidor en este análisis? (midiendo, o escribiendo hace poco). */
export function isWorking(row: Pick<ReelReferenceRow, 'status' | 'ai_started_at'> | null | undefined): boolean {
  if (!row) return false;
  if (row.status === 'analyzing') return true;
  if (row.status !== 'measured' || !row.ai_started_at) return false;
  return Date.now() - new Date(row.ai_started_at).getTime() < 5 * 60_000;
}

export function useReelReference(brandId: string, referenceId: string | undefined) {
  return useQuery({
    queryKey: likeKeys.reference(brandId, referenceId ?? ''),
    enabled: Boolean(referenceId),
    queryFn: async (): Promise<ReelReferenceRow | null> =>
      unwrap(
        await supabase.from('reel_references').select('*').eq('brand_id', brandId).eq('id', referenceId!).maybeSingle(),
      ),
    refetchInterval: (q) => (isWorking(q.state.data) ? REFERENCE_POLL_MS : false),
  });
}

/** Últimos análisis de la marca (para retomarlos). */
export function useRecentReferences(brandId: string) {
  return useQuery({
    queryKey: likeKeys.recent(brandId),
    queryFn: async (): Promise<ReelReferenceRow[]> =>
      unwrap(
        await supabase
          .from('reel_references')
          .select('*')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(8),
      ),
  });
}

/** Fotos y clips de la biblioteca con lo que hace falta para emparejarlos (los 500 más recientes). */
export function useLikeLibrary(brandId: string, enabled = true) {
  return useQuery({
    queryKey: likeKeys.library(brandId),
    enabled,
    queryFn: async (): Promise<LibraryAsset[]> =>
      unwrap(
        await supabase
          .from('media_assets')
          .select('id, kind, storage_path, file_name, mime_type, duration_ms, folder, tags, created_at')
          .eq('brand_id', brandId)
          .in('kind', ['image', 'video'])
          .order('created_at', { ascending: false })
          .limit(500),
      ),
  });
}

export interface StartAnalysisInput {
  organizationId: string;
  /** El archivo o el enlace: uno de los dos. */
  file?: File;
  url?: string;
  /** Transcribir lo que se dice. */
  speech: boolean;
  /** Guardar el vídeo subido como referencia privada (si no, se borra tras el análisis). */
  keepSource: boolean;
  /** De qué quiere la marca que vaya su reel. */
  idea: string;
}

/** Motivo por el que un archivo no vale como referencia, o null si vale. */
export function referenceFileProblem(file: { size: number; type: string }, maxBytes: number): string | null {
  if (!(file.type in REFERENCE_LIMITS.mimeTypes)) return 'Sube un vídeo en MP4, MOV o WebM.';
  if (file.size > maxBytes)
    return `El vídeo pesa más de ${Math.round(maxBytes / (1024 * 1024))} MB. Sube uno más corto o más ligero.`;
  if (file.size === 0) return 'El archivo está vacío.';
  return null;
}

/** ¿Parece una dirección web? (La comprobación de verdad la hace el servidor.) */
export function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.') && !url.username;
  } catch {
    return false;
  }
}

/**
 * Sube el vídeo (si es un archivo) a la carpeta privada de referencias de la
 * marca y encarga su análisis. Devuelve el análisis creado.
 */
export function useStartAnalysis(brandId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: StartAnalysisInput): Promise<{ referenceId: string; jobId: string }> => {
      let source: Json;
      let uploaded: string | null = null;
      if (input.file) {
        const extension = REFERENCE_LIMITS.mimeTypes[input.file.type];
        if (!extension) throw new Error('Sube un vídeo en MP4, MOV o WebM.');
        // Carpeta privada de la marca: no es un recurso de la biblioteca y no se puede usar en piezas.
        uploaded = `${input.organizationId}/${brandId}/referencias/${crypto.randomUUID()}.${extension}`;
        const upload = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(uploaded, input.file, { contentType: input.file.type });
        if (upload.error) throw upload.error;
        source = { path: uploaded };
      } else {
        source = { url: (input.url ?? '').trim() };
      }
      const requested = await supabase.rpc('request_media_job', {
        p_brand_id: brandId,
        p_kind: ANALYZE_KIND,
        p_input: {
          source,
          speech: input.speech,
          ...(uploaded && input.keepSource ? { keepSource: true } : {}),
          ...(input.idea.trim() ? { idea: input.idea.trim() } : {}),
        },
        p_idempotency_key: crypto.randomUUID(),
      });
      if (requested.error) {
        // Sin encargo, el vídeo subido no pinta nada en el almacenamiento.
        if (uploaded)
          await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([uploaded])
            .catch(() => undefined);
        throw requested.error;
      }
      const job = requested.data;
      const referenceId = (job.payload as { reference?: { id?: unknown } } | null)?.reference?.id;
      if (typeof referenceId !== 'string') throw new Error('El servidor no ha devuelto el análisis.');
      return { referenceId, jobId: job.id };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: likeKeys.all(brandId) }),
  });
  return {
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export interface StudyResult {
  status: 'ready';
  result: ReelLikeResult;
  costMicros: number;
}

/** La parte de IA: mira los fotogramas y escribe plantilla, guion y textos. */
export function useStudyReference(brandId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (referenceId: string) => invoke<StudyResult>({ action: 'create', brandId, referenceId }),
    // Salga bien o mal, lo que cuenta es lo que diga el análisis guardado.
    onSettled: (_data, _error, referenceId) =>
      queryClient.invalidateQueries({ queryKey: likeKeys.reference(brandId, referenceId) }),
  });
  return {
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

/** Descarta un análisis: lo borra y limpia sus archivos (también el vídeo guardado). */
export function useDiscardReference(brandId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (referenceId: string) => {
      unwrap(await supabase.rpc('discard_reel_reference', { p_reference_id: referenceId }));
      // Los archivos ya están en la cola de limpieza: se barren en el acto.
      await sweepStorageCleanup(brandId).catch(() => undefined);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: likeKeys.all(brandId) }),
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending, error: mutation.error };
}

/** Apunta la pieza (borrador de reel) abierta a partir del análisis. */
export async function linkReferenceContent(referenceId: string, contentId: string): Promise<void> {
  unwrap(await supabase.rpc('set_reel_reference_content', { p_reference_id: referenceId, p_content_id: contentId }));
}

/**
 * «Guardar como plantilla»: convierte la estructura del análisis al formato
 * compartido de plantillas de reel y la entrega a la marca con origen
 * `reference`. Queda en «Empieza tu reel» del editor, con las del catálogo.
 */
export function useSaveReferenceTemplate(brandId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { name: string; result: ReelLikeResult; origin: TemplateOrigin }) => {
      const name = input.name.trim().slice(0, TEMPLATE_NAME_MAX);
      if (!name) throw new Error('Ponle un nombre a la plantilla.');
      const document = toReelTemplate(input.result, { styles: REEL_TEMPLATES, origin: input.origin });
      const rows = unwrap(
        await supabase.rpc('deliver_reel_templates', {
          p_brand_id: brandId,
          p_templates: [{ key: templateKey(name), name, document }] as unknown as Json,
          p_source: 'reference',
        }),
      );
      const saved = rows[0];
      if (!saved) throw new Error('El servidor no ha devuelto la plantilla.');
      return saved;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reelTemplateKeys.all(brandId) }),
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending, error: mutation.error };
}

/**
 * La pieza que ya se hizo con un análisis, si sigue viva: ni borrada ni
 * archivada. Solo para ofrecer volver a ella; «Abrir en el editor» crea
 * siempre una nueva.
 */
export function useLinkedPiece(brandId: string, contentId: string | null) {
  const query = useQuery({
    queryKey: [...likeKeys.all(brandId), 'piece', contentId] as const,
    enabled: Boolean(contentId),
    queryFn: async (): Promise<{ id: string; title: string } | null> => {
      const row = unwrap(
        await supabase
          .from('content_items')
          .select('id, title, archived_at')
          .eq('brand_id', brandId)
          .eq('id', contentId!)
          .maybeSingle(),
      ) as { id: string; title: string; archived_at: string | null } | null;
      return row && !row.archived_at ? { id: row.id, title: row.title } : null;
    },
  });
  return query.data ?? null;
}
