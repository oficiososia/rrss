import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contentKeys } from '@/features/content/api';
import type {
  ContentCommentRow,
  ContentItemRow,
  MediaAssetRow,
  PublicationAttemptRow,
  ScheduledPublicationRow,
  SocialAccountRow,
} from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Acceso a datos de la publicación (Fase 3): cuentas conectadas, calendario,
// intentos y comentarios de la pieza. Las reglas viven en la base de datos
// (migraciones 20261119010000 a 20261119040000): aquí solo se lee y se llama a
// sus funciones. Los tokens no llegan nunca al navegador.

export const socialKeys = {
  accounts: (brandId: string) => ['brand', brandId, 'social', 'accounts'] as const,
  calendar: (brandId: string) => ['brand', brandId, 'social', 'calendar'] as const,
  range: (brandId: string, from: string, to: string) => ['brand', brandId, 'social', 'calendar', from, to] as const,
  attempts: (brandId: string, publicationId: string) => ['brand', brandId, 'social', 'attempts', publicationId] as const,
  comments: (brandId: string, contentId: string) => ['brand', brandId, 'social', 'comments', contentId] as const,
  candidates: (brandId: string) => ['brand', brandId, 'social', 'candidates'] as const,
  media: (brandId: string) => ['brand', brandId, 'social', 'media'] as const,
};

// ── Cuentas conectadas ───────────────────────────────────────────────────

export function useSocialAccounts(brandId: string) {
  return useQuery({
    queryKey: socialKeys.accounts(brandId),
    queryFn: async (): Promise<SocialAccountRow[]> =>
      unwrap(
        await supabase
          .from('social_accounts')
          .select('*')
          .eq('brand_id', brandId)
          .neq('status', 'disconnected')
          .order('created_at', { ascending: false }),
      ),
  });
}

/** Empieza la conexión: devuelve la dirección del diálogo de Meta. */
export async function startSocialConnect(brandId: string, network: 'instagram'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('social-connect/start', { body: { brandId, network } });
  if (error) {
    let message = 'No se pudo empezar la conexión. Inténtalo de nuevo.';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      const body = (await context.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (body?.error?.message) message = body.error.message;
    }
    throw new Error(message);
  }
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('Respuesta inesperada del servidor.');
  return url;
}

export function useDisconnectAccount(brandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) =>
      unwrap(await supabase.rpc('disconnect_social_account', { p_account_id: accountId })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: socialKeys.accounts(brandId) });
      void qc.invalidateQueries({ queryKey: socialKeys.calendar(brandId) });
    },
  });
}

// ── Calendario ───────────────────────────────────────────────────────────

export type CalendarContent = Pick<
  ContentItemRow,
  'id' | 'title' | 'status' | 'current_version' | 'network' | 'format' | 'archived_at'
>;

export interface CalendarEntry extends ScheduledPublicationRow {
  content: CalendarContent | null;
}

/** Publicaciones del intervalo, con su pieza. Se refresca sola mientras alguna se está publicando. */
export function useCalendar(brandId: string, from: Date, to: Date) {
  return useQuery({
    queryKey: socialKeys.range(brandId, from.toISOString(), to.toISOString()),
    queryFn: async (): Promise<CalendarEntry[]> => {
      const rows = unwrap(
        await supabase
          .from('scheduled_publications')
          .select('*')
          .eq('brand_id', brandId)
          .gte('scheduled_at', from.toISOString())
          .lt('scheduled_at', to.toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1000),
      );
      const ids = [...new Set(rows.map((r) => r.content_id))];
      const contents = ids.length
        ? unwrap(
            await supabase
              .from('content_items')
              .select('id, title, status, current_version, network, format, archived_at')
              .in('id', ids),
          )
        : [];
      const byId = new Map((contents as CalendarContent[]).map((c) => [c.id, c]));
      return rows.map((r) => ({ ...r, content: byId.get(r.content_id) ?? null }));
    },
    refetchInterval: (query) =>
      (query.state.data ?? []).some((e) => e.status === 'publishing' || e.status === 'scheduled') ? 30_000 : false,
  });
}

export function usePublicationAttempts(brandId: string, publicationId: string | null) {
  return useQuery({
    queryKey: socialKeys.attempts(brandId, publicationId ?? ''),
    enabled: Boolean(publicationId),
    queryFn: async (): Promise<PublicationAttemptRow[]> =>
      unwrap(
        await supabase
          .from('publication_attempts')
          .select('*')
          .eq('publication_id', publicationId!)
          .order('attempt_no', { ascending: false })
          .limit(50),
      ),
  });
}

/** Piezas que se pueden poner en el calendario (no archivadas). */
export function useSchedulableContents(brandId: string, enabled = true) {
  return useQuery({
    queryKey: socialKeys.candidates(brandId),
    enabled,
    queryFn: async (): Promise<CalendarContent[]> =>
      unwrap(
        await supabase
          .from('content_items')
          .select('id, title, status, current_version, network, format, archived_at')
          .eq('brand_id', brandId)
          .is('archived_at', null)
          .order('updated_at', { ascending: false })
          .limit(200),
      ) as CalendarContent[],
  });
}

/** Imágenes JPEG y vídeos de la marca, para elegir lo que se publica (se filtran por procedencia aquí). */
export function usePublishableMedia(brandId: string, enabled = true) {
  return useQuery({
    queryKey: socialKeys.media(brandId),
    enabled,
    queryFn: async (): Promise<MediaAssetRow[]> =>
      unwrap(
        await supabase
          .from('media_assets')
          .select('*')
          .eq('brand_id', brandId)
          .in('mime_type', ['image/jpeg', 'video/mp4', 'video/quicktime'])
          .order('created_at', { ascending: false })
          .limit(300),
      ),
  });
}

/** Exportaciones de una pieza en una versión concreta (lo único que se publica como imagen). */
export function exportsOf(assets: MediaAssetRow[], contentId: string, version: number): MediaAssetRow[] {
  return assets.filter((a) => {
    const p = (a.provenance ?? {}) as Record<string, unknown>;
    return (
      a.mime_type === 'image/jpeg' &&
      p.type === 'export' &&
      p.content_id === contentId &&
      p.version === version &&
      p.unsaved_changes !== true
    );
  });
}

export function videosOf(assets: MediaAssetRow[]): MediaAssetRow[] {
  return assets.filter((a) => a.kind === 'video');
}

function useCalendarMutation<TInput, TData>(brandId: string, fn: (input: TInput) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: socialKeys.calendar(brandId) });
    },
  });
}

export interface SavePublicationInput {
  publicationId: string | null;
  contentId: string;
  scheduledAt: string;
  accountId: string | null;
  mediaAssetIds: string[];
  contentVersion: number | null;
}

export function useSavePublication(brandId: string) {
  return useCalendarMutation(brandId, async (input: SavePublicationInput) =>
    unwrap(
      await supabase.rpc('save_publication', {
        p_publication_id: input.publicationId,
        p_content_id: input.contentId,
        p_scheduled_at: input.scheduledAt,
        p_social_account_id: input.accountId,
        p_media_asset_ids: input.mediaAssetIds,
        p_content_version: input.contentVersion,
      }),
    ),
  );
}

export function useReschedulePublication(brandId: string) {
  return useCalendarMutation(brandId, async (input: { publicationId: string; scheduledAt: string }) =>
    unwrap(
      await supabase.rpc('reschedule_publication', {
        p_publication_id: input.publicationId,
        p_scheduled_at: input.scheduledAt,
      }),
    ),
  );
}

export function useCancelPublication(brandId: string) {
  return useCalendarMutation(brandId, async (publicationId: string) =>
    unwrap(await supabase.rpc('cancel_publication', { p_publication_id: publicationId })),
  );
}

export function useRetryPublication(brandId: string) {
  return useCalendarMutation(brandId, async (publicationId: string) =>
    unwrap(await supabase.rpc('retry_publication', { p_publication_id: publicationId })),
  );
}

// ── Aprobaciones y comentarios de la pieza ───────────────────────────────

export interface ApprovalResult {
  content_id: string;
  ok: boolean;
  message: string | null;
}

/** Aprueba varias piezas, cada una en su versión. Devuelve qué se aprobó y qué no. */
export function useApproveContents(brandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { contentId: string; version: number }[]): Promise<ApprovalResult[]> =>
      unwrap(
        await supabase.rpc('approve_content_items', {
          p_items: items.map((i) => ({ content_id: i.contentId, version: i.version })),
        }),
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: socialKeys.calendar(brandId) });
      void qc.invalidateQueries({ queryKey: contentKeys.all(brandId) });
      void qc.invalidateQueries({ queryKey: ['brand', brandId, 'social', 'comments'] });
    },
  });
}

export interface CommentEntry extends ContentCommentRow {
  author: string;
}

export function useContentComments(brandId: string, contentId: string | null) {
  return useQuery({
    queryKey: socialKeys.comments(brandId, contentId ?? ''),
    enabled: Boolean(contentId),
    queryFn: async (): Promise<CommentEntry[]> => {
      const rows = unwrap(
        await supabase
          .from('content_comments')
          .select('*')
          .eq('content_id', contentId!)
          .order('created_at', { ascending: true })
          .limit(500),
      );
      const ids = [...new Set(rows.map((r) => r.author_id).filter((v): v is string => Boolean(v)))];
      const profiles = ids.length
        ? unwrap(await supabase.from('profiles').select('user_id, full_name, email').in('user_id', ids))
        : [];
      const names = new Map(profiles.map((p) => [p.user_id, p.full_name || p.email]));
      return rows.map((r) => ({ ...r, author: (r.author_id && names.get(r.author_id)) || 'Usuario' }));
    },
  });
}

export function useCommentContent(brandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { contentId: string; body: string; version?: number | null }) =>
      unwrap(
        await supabase.rpc('comment_content_item', {
          p_content_id: input.contentId,
          p_body: input.body,
          p_version: input.version ?? null,
        }),
      ),
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: socialKeys.comments(brandId, input.contentId) });
    },
  });
}

export function useRequestChanges(brandId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { contentId: string; message: string }) =>
      unwrap(await supabase.rpc('request_content_changes', { p_content_id: input.contentId, p_message: input.message })),
    onSettled: (_d, _e, input) => {
      void qc.invalidateQueries({ queryKey: socialKeys.calendar(brandId) });
      void qc.invalidateQueries({ queryKey: contentKeys.all(brandId) });
      void qc.invalidateQueries({ queryKey: socialKeys.comments(brandId, input.contentId) });
    },
  });
}
