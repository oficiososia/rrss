// Archivos que un reel usa y que ya no están en la biblioteca (se borraron después
// de montarlo). El plan guarda la RUTA de cada archivo: se pregunta a la base de
// datos cuáles de esas rutas siguen teniendo recurso. Sin respuesta (cargando o
// error) no se marca nada: nunca se dice que falta algo que quizá está.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { assetKeys } from '@/features/library/api';
import type { SourceAsset } from './ops';
import { replaceClip } from './ops';
import type { DraftPlan, ReelProject } from './project';
import type { ReelTemplateSummary } from '../templates';

export type MissingItem =
  | { kind: 'clip'; id: string; index: number; media: 'photo' | 'video'; path: string }
  | { kind: 'music'; path: string }
  | { kind: 'cover'; path: string };

/** Rutas de la biblioteca que usa el plan (clips, música y foto de portada), sin repetir y ordenadas. */
export function planPaths(plan: DraftPlan): string[] {
  return [
    ...new Set([
      ...plan.clips.map((c) => c.path),
      ...(plan.music ? [plan.music.path] : []),
      ...(plan.cover?.type === 'photo' ? [plan.cover.path] : []),
    ]),
  ].sort();
}

/** Lo que falta, en el orden de la pantalla: clips, música y portada (si no es ya un clip que falta). */
export function missingItems(plan: DraftPlan, isMissing: (path: string) => boolean): MissingItem[] {
  const out: MissingItem[] = [];
  plan.clips.forEach((clip, index) => {
    if (isMissing(clip.path)) out.push({ kind: 'clip', id: clip.id, index, media: clip.type, path: clip.path });
  });
  if (plan.music && isMissing(plan.music.path)) out.push({ kind: 'music', path: plan.music.path });
  const cover = plan.cover?.type === 'photo' ? plan.cover.path : null;
  if (cover && isMissing(cover) && !plan.clips.some((c) => c.path === cover)) out.push({ kind: 'cover', path: cover });
  return out;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * El aviso de una línea: «1 foto de este reel se ha borrado de la biblioteca. Sustitúyela para
 * poder montarlo.» Null si no falta nada.
 */
export function missingSummary(items: readonly MissingItem[]): string | null {
  if (items.length === 0) return null;
  const photos = items.filter((i) => i.kind === 'clip' && i.media === 'photo').length;
  const videos = items.filter((i) => i.kind === 'clip' && i.media === 'video').length;
  const music = items.some((i) => i.kind === 'music');
  const cover = items.some((i) => i.kind === 'cover');
  const parts = [
    ...(photos ? [count(photos, 'foto', 'fotos')] : []),
    ...(videos ? [count(videos, 'vídeo', 'vídeos')] : []),
  ];
  const sentences: string[] = [];
  if (parts.length > 0) {
    const total = photos + videos;
    const what = parts.join(' y ');
    // El pronombre concuerda con lo que falta: una foto → «Sustitúyela», un vídeo → «Sustitúyelo».
    const pronoun =
      total === 1 ? (photos ? 'la' : 'lo') : videos === 0 ? 'las' : 'los';
    sentences.push(
      `${what} de este reel ${total === 1 ? 'se ha borrado' : 'se han borrado'} de la biblioteca. Sustitúye${pronoun} para poder montarlo.`,
    );
  }
  if (music) sentences.push('La música de este reel se ha borrado de la biblioteca. Cámbiala o quítala para poder montarlo.');
  if (cover) sentences.push('La foto de la portada se ha borrado de la biblioteca. Elige otra portada para poder montarlo.');
  return sentences.join(' ');
}

/** Texto de la marca en la línea de tiempo y en la vista previa. */
export const missingLabel = (media: 'photo' | 'video') => (media === 'photo' ? 'Falta esta foto' : 'Falta este vídeo');

/**
 * Sustituye el archivo de un elemento (con su duración, movimiento, filtro y transición: `replaceClip`)
 * y, si la portada era esa foto y ya no queda en el reel, la portada pasa a la nueva (o se quita si
 * lo nuevo es un vídeo).
 */
export function replaceClipAndCover(
  project: ReelProject,
  id: string,
  asset: SourceAsset,
  template: ReelTemplateSummary,
): ReelProject {
  const old = project.plan.clips.find((c) => c.id === id)?.path;
  const next = replaceClip(project, id, asset, template);
  const cover = next.plan.cover;
  if (!old || cover?.type !== 'photo' || cover.path !== old || next.plan.clips.some((c) => c.path === old)) return next;
  const plan = { ...next.plan };
  if (asset.kind === 'video') delete plan.cover;
  else plan.cover = { type: 'photo', path: asset.storage_path };
  return { ...next, plan };
}

/**
 * Qué rutas del reel ya no tienen recurso en la biblioteca de la marca. `missing` es null mientras
 * no se sabe (cargando, sin conexión): entonces no se marca nada.
 */
export function useMissingPaths(brandId: string, paths: string[]) {
  const query = useQuery({
    queryKey: [...assetKeys.all(brandId), 'paths', paths] as const,
    enabled: paths.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Set<string>> => {
      const rows = unwrap(
        await supabase.from('media_assets').select('storage_path').eq('brand_id', brandId).in('storage_path', paths),
      );
      return new Set(rows.map((r) => r.storage_path));
    },
  });
  const missing = useMemo(() => {
    if (paths.length === 0) return new Set<string>();
    if (!query.data) return null;
    return new Set(paths.filter((p) => !query.data.has(p)));
  }, [paths, query.data]);
  return missing;
}

/** Nombre legible de una ruta sin recurso: el último tramo, sin el identificador con el que se sube. */
export function fileNameOf(path: string): string {
  const last = path.split('/').pop() || path;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '') || last;
}
