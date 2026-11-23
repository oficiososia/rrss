// Datos de «Terminar en Instagram» (docs/editor-reels.md §12): la entrega de un reel para publicarlo a
// mano (`manual_publications`) y la búsqueda de esa publicación entre las últimas de la cuenta.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManualPublicationRow, SocialAccountRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { MATCH_EARLY_MS, matchReel, type MatchCandidate } from './manualFlow';

export const manualKeys = {
  content: (brandId: string, contentId: string) => ['brand', brandId, 'manual-publication', contentId] as const,
};

/** La entrega de la pieza (pendiente o publicada), o null. */
export function useManualPublication(brandId: string, contentId: string) {
  return useQuery({
    queryKey: manualKeys.content(brandId, contentId),
    queryFn: async (): Promise<ManualPublicationRow | null> => {
      const rows = unwrap(
        await supabase
          .from('manual_publications')
          .select('*')
          .eq('content_id', contentId)
          .neq('status', 'cancelled')
          .limit(1),
      );
      return rows[0] ?? null;
    },
  });
}

export function useManualMutations(brandId: string, contentId: string) {
  const qc = useQueryClient();
  const done = (row: ManualPublicationRow) => qc.setQueryData(manualKeys.content(brandId, contentId), row);
  return {
    start: useMutation({
      mutationFn: async (input: { assetId: string; caption: string }) =>
        unwrap(
          await supabase.rpc('start_manual_publication', {
            p_content_id: contentId,
            p_media_asset_id: input.assetId,
            p_caption: input.caption,
          }),
        ),
      onSuccess: done,
    }),
    confirm: useMutation({
      mutationFn: async (input: { id: string; url: string | null }) =>
        unwrap(await supabase.rpc('confirm_manual_publication', { p_id: input.id, p_url: input.url })),
      onSuccess: done,
    }),
    cancel: useMutation({
      mutationFn: async (id: string) => unwrap(await supabase.rpc('cancel_manual_publication', { p_id: id })),
      onSuccess: () => qc.setQueryData(manualKeys.content(brandId, contentId), null),
    }),
  };
}

/** Lee las últimas publicaciones de una cuenta (en el servidor, con su token). Devuelve el aviso si falla. */
async function readRecent(accountId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('social-import/recent', { body: { accountId } });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      const parsed = (await context.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (parsed?.error?.message) return parsed.error.message;
    }
    return 'No se pudo leer Instagram. Inténtalo de nuevo.';
  }
  const reply = data as { outcome?: string; message?: string | null } | null;
  return reply?.outcome === 'error' ? (reply.message ?? 'No se pudo leer Instagram.') : null;
}

export type FindOutcome =
  { kind: 'found'; row: ManualPublicationRow } | { kind: 'none' | 'ambiguous' } | { kind: 'error'; message: string };

/**
 * Busca el reel entregado entre las últimas publicaciones de las cuentas conectadas y, si lo reconoce
 * (`matchReel`), lo deja «Publicada» con su enlace.
 */
export async function findPublished(
  row: ManualPublicationRow,
  accounts: Pick<SocialAccountRow, 'id' | 'network' | 'status'>[],
): Promise<FindOutcome> {
  const live = accounts.filter((a) => a.network === 'instagram' && a.status === 'active');
  const problems = (await Promise.all(live.map((a) => readRecent(a.id)))).filter((m): m is string => m !== null);
  if (live.length > 0 && problems.length === live.length) return { kind: 'error', message: problems[0]! };

  const since = new Date(Date.parse(row.handed_off_at) - MATCH_EARLY_MS).toISOString();
  const candidates = unwrap(
    await supabase
      .from('social_imported_media')
      .select('id, external_id, caption, media_type, media_product_type, permalink, published_at')
      .eq('brand_id', row.brand_id)
      .gte('published_at', since)
      .order('published_at', { ascending: true })
      .limit(100),
  ) as MatchCandidate[];
  // Lo que ya es de otra pieza no se vuelve a usar.
  const taken = unwrap(
    await supabase
      .from('manual_publications')
      .select('imported_media_id')
      .eq('brand_id', row.brand_id)
      .neq('id', row.id)
      .not('imported_media_id', 'is', null),
  ) as Array<{ imported_media_id: string | null }>;
  const result = matchReel(row, candidates, new Set(taken.map((t) => t.imported_media_id!)));
  if (!result.match) return { kind: result.reason === 'ambiguous' ? 'ambiguous' : 'none' };
  const matched = unwrap(
    await supabase.rpc('match_manual_publication', { p_id: row.id, p_imported_media_id: result.match.id }),
  );
  return { kind: 'found', row: matched };
}

/** Entre búsquedas automáticas (al volver a la pestaña) pasa al menos esto. */
export const AUTO_FIND_EVERY_MS = 60_000;

/**
 * «Buscar en Instagram»: a mano (`run`) y sola, una vez al abrir el editor con una entrega pendiente y
 * cada vez que se vuelve a la pestaña (de Instagram, en el móvil), con una pausa entre búsquedas.
 * Solo si hay una cuenta conectada y quien mira puede editar.
 */
export function useFindPublished(
  brandId: string,
  contentId: string,
  row: ManualPublicationRow | null | undefined,
  accounts: SocialAccountRow[] | undefined,
  enabled: boolean,
) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FindOutcome | null>(null);
  const last = useRef(0);
  const searchable =
    enabled &&
    Boolean(row) &&
    (row!.status === 'pending' || (row!.match_source === 'manual' && !row!.external_url)) &&
    (accounts ?? []).some((a) => a.network === 'instagram' && a.status === 'active');

  const run = useCallback(async () => {
    if (!row || !accounts || busy) return;
    last.current = Date.now();
    setBusy(true);
    try {
      const result = await findPublished(row, accounts);
      setOutcome(result);
      if (result.kind === 'found') qc.setQueryData(manualKeys.content(brandId, contentId), result.row);
    } catch (e) {
      setOutcome({ kind: 'error', message: e instanceof Error ? e.message : 'No se pudo buscar.' });
    } finally {
      setBusy(false);
    }
  }, [accounts, brandId, busy, contentId, qc, row]);

  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const id = row?.id;
  useEffect(() => {
    if (!searchable) return;
    if (Date.now() - last.current >= AUTO_FIND_EVERY_MS) void runRef.current();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last.current >= AUTO_FIND_EVERY_MS) {
        void runRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [searchable, id]);

  return { searchable, busy, outcome, run };
}
