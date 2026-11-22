// Datos del editor de reels: guardar el montaje como versión de la pieza y
// seguir los montajes (trabajos del trabajador) que salen de ella.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { contentKeys } from '@/features/content/api';
import { assetKeys } from '@/features/library/api';
import type { BrandReelTemplateRow, ContentVersionRow, Json } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { JOB_POLL_MS, REEL_KIND } from '../api';
import { describeJob, isActive, type MediaJobSummary } from '../plan';
import { validateReelTemplate, type ReelTemplate } from '../reelTemplate';
import { REEL_TEMPLATES } from '../templates';
import { finalizeProject, REEL_PLAN_VERSION, type ReelProject } from './project';

export interface SaveReelInput {
  contentId: string;
  project: ReelProject;
  note?: string;
  /** Versión sobre la que se trabajaba: si otra persona guardó después, falla (CT001). */
  expectedVersion: number;
}

/** Guarda el montaje como versión nueva de la pieza. Valida antes con el esquema (lanza `ProjectError`). */
export async function saveReelVersion(input: SaveReelInput): Promise<ContentVersionRow> {
  const ready = finalizeProject(input.project);
  return unwrap(
    await supabase.rpc('save_content_version', {
      p_content_id: input.contentId,
      p_data: ready as unknown as Json,
      p_schema_version: REEL_PLAN_VERSION,
      p_change_note: input.note ?? '',
      p_expected_version: input.expectedVersion,
    }),
  );
}

export function useSaveReelVersion(brandId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveReelVersion,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentKeys.all(brandId) }),
  });
}

export const pieceJobKeys = (brandId: string, contentId: string) =>
  ['brand', brandId, 'media-jobs', 'content', contentId] as const;

/**
 * Montajes de esta pieza: los últimos trabajos de reel de la marca cuya carga
 * dice que salen de ella. Mientras alguno está en marcha se vuelve a mirar; al
 * terminar uno, se refresca la biblioteca.
 */
export function usePieceJobs(brandId: string, contentId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: pieceJobKeys(brandId, contentId),
    queryFn: async (): Promise<MediaJobSummary[]> => {
      const rows: MediaJobSummary[] = unwrap(
        await supabase
          .from('jobs')
          .select('id, kind, status, attempts, max_attempts, last_error, result, payload, created_at')
          .eq('brand_id', brandId)
          .eq('kind', REEL_KIND)
          .order('created_at', { ascending: false })
          .limit(40),
      );
      return rows.filter((job) => (job.payload as { content?: { id?: unknown } } | null)?.content?.id === contentId);
    },
    refetchInterval: (q) => (q.state.data?.some(isActive) ? JOB_POLL_MS : false),
  });
  const finished = (query.data ?? []).filter((job) => job.status === 'succeeded').length;
  const previous = useRef(finished);
  useEffect(() => {
    if (finished > previous.current) void queryClient.invalidateQueries({ queryKey: assetKeys.all(brandId) });
    previous.current = finished;
  }, [finished, brandId, queryClient]);
  return query;
}

/** Versión de la pieza de la que salió un montaje. */
export const jobContentVersion = (job: MediaJobSummary): number | null => {
  const version = (job.payload as { content?: { version?: unknown } } | null)?.content?.version;
  return typeof version === 'number' ? version : null;
};

/** El último montaje terminado de una versión (su vídeo en la biblioteca), si lo hay. */
export function renderOfVersion(jobs: MediaJobSummary[], version: number): string | null {
  for (const job of jobs) {
    if (jobContentVersion(job) !== version) continue;
    const view = describeJob(job);
    if (view.assetId) return view.assetId;
  }
  return null;
}

// ───────────────────────────── Plantillas de reel de la marca ─────────────────────────────

/** Una plantilla de reel de la marca, ya validada (ver ../reelTemplate.ts). */
export interface BrandReelTemplate {
  id: string;
  key: string;
  name: string;
  source: BrandReelTemplateRow['source'];
  template: ReelTemplate;
}

export const reelTemplateKeys = {
  all: (brandId: string) => ['brand', brandId, 'reel-templates'] as const,
};

/** Las filas que la aplicación sabe montar: las mal formadas o de un estilo que no existe se dejan fuera. */
export function readBrandReelTemplates(
  rows: Pick<BrandReelTemplateRow, 'id' | 'template_key' | 'name' | 'source' | 'document'>[],
  styleIds: readonly string[],
): BrandReelTemplate[] {
  const out: BrandReelTemplate[] = [];
  for (const row of rows) {
    const parsed = validateReelTemplate(row.document, styleIds);
    if (parsed.ok) {
      out.push({ id: row.id, key: row.template_key, name: row.name, source: row.source, template: parsed.template });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Plantillas de reel de la marca (la RLS deja verlas a quien ve la marca). */
export function useBrandReelTemplates(brandId: string) {
  return useQuery({
    queryKey: reelTemplateKeys.all(brandId),
    queryFn: async (): Promise<BrandReelTemplate[]> => {
      const rows: Pick<BrandReelTemplateRow, 'id' | 'template_key' | 'name' | 'source' | 'document'>[] = unwrap(
        await supabase
          .from('brand_reel_templates')
          .select('id, template_key, name, source, document')
          .eq('brand_id', brandId)
          .order('name')
          .limit(60),
      );
      return readBrandReelTemplates(
        rows,
        REEL_TEMPLATES.map((t) => t.id),
      );
    },
  });
}
