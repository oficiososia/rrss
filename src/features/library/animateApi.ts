// «Animar esta foto con IA»: cliente de las acciones `video.*` de `ai-media`
// (docs/ia-medios.md, §15) y seguimiento de la generación leyendo
// `ai_generations` y `jobs` (RLS de siempre). El resultado es un vídeo nuevo en
// la biblioteca; la foto no se toca.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiAnimateEnabled } from '@/config/app';
import { AiRequestError, aiErrorMessage, type AsyncMutation } from '@/features/ai/api';
import { invokeAiMedia } from '@/features/ai/imageApi';
import type { AiGenerationRow, AiMediaGenerationOutput, MediaAssetRow } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { assetKeys } from './api';

export const MAX_MOTION_CHARS = 300;

/** Movimientos sugeridos, en lenguaje llano. `prompt` es lo que entiende el modelo. */
export const MOVEMENTS = [
  { id: 'push-in', label: 'Acercar despacio', prompt: 'slow smooth camera push-in towards the dish' },
  { id: 'orbit', label: 'Girar alrededor del plato', prompt: 'slow camera orbit around the dish' },
  { id: 'steam', label: 'Vapor o humo suave', prompt: 'gentle steam rising from the food, camera almost still' },
  { id: 'light', label: 'Luz que se mueve', prompt: 'soft warm light slowly moving across the dish, camera almost still' },
  { id: 'pull-back', label: 'Alejar despacio', prompt: 'slow smooth camera pull-back revealing the table' },
] as const;
export type MovementId = (typeof MOVEMENTS)[number]['id'];

/** Texto que se manda al servidor: el movimiento elegido y, si la hay, la indicación libre. */
export function motionText(movement: MovementId | null, free: string): string {
  const base = MOVEMENTS.find((m) => m.id === movement)?.prompt ?? '';
  const extra = free.trim();
  return [base, extra].filter(Boolean).join('. ');
}

export interface AnimateModelChoice {
  /** `proveedor:modelo`. */
  id: string;
  displayName: string;
  pricePerSecondMicros: number;
  priceVerified: boolean;
  minSeconds: number;
  maxSeconds: number;
  dataRegion: 'eu' | 'us' | 'global' | 'unknown';
  euProcessing: boolean;
  trainsOnInputs: 'no' | 'yes' | 'unknown';
  untestedAdapter: boolean;
  default: boolean;
}

export interface AnimateOptions {
  available: boolean;
  /** Por qué no está disponible: `not_configured`, `plan`, `no_quota`, `quota_exhausted`, `no_permission`… */
  reason: string | null;
  /** La marca está en modo agencia y quien pregunta no es personal de la agencia. */
  agencyMode?: boolean;
  remainingMicros: number;
  maxSeconds: number;
  defaultSeconds: number;
  models: AnimateModelChoice[];
}

export interface AnimateInput {
  assetId: string;
  motion: string;
  seconds: number;
  model?: string;
}

export interface AnimateEstimate {
  model: string;
  costMicros: number;
  seconds: number;
  aspectRatio: string;
  /** `false`: la foto no es 9:16, 4:5 ni 1:1 y el vídeo saldrá con su misma forma. */
  exactAspect: boolean;
  dataHandling: { dataRegion: string; euProcessing: boolean; trainsOnInputs: string; untestedAdapter: boolean };
}

export interface AnimateResult extends AnimateEstimate {
  status: 'completed' | 'pending';
  generationId: string;
  estimatedCostMicros: number;
  asset?: { id: string; path: string };
}

export const animateKeys = {
  options: (brandId: string) => ['animate', brandId, 'options'] as const,
  estimate: (brandId: string, input: AnimateInput) => ['animate', brandId, 'estimate', input] as const,
  progress: (generationId: string) => ['animate', 'generation', generationId] as const,
};

/**
 * Qué se puede hacer ahora. Sin el interruptor `VITE_AI_ANIMATE_ENABLED` ni se
 * pregunta; con él, el servidor dice si hay proveedor, modelo activo, plan y cupo.
 */
export function useAnimateOptions(brandId: string, enabled = true) {
  const on = aiAnimateEnabled() && enabled;
  return useQuery<AnimateOptions, AiRequestError>({
    queryKey: animateKeys.options(brandId),
    enabled: on,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => (await invokeAiMedia<{ animate: AnimateOptions }>('video.options', brandId)).animate,
  });
}

/** Coste máximo ANTES de generar. No reserva nada. */
export function useAnimateEstimate(brandId: string, input: AnimateInput, enabled = true) {
  return useQuery<AnimateEstimate, AiRequestError>({
    queryKey: animateKeys.estimate(brandId, { ...input, motion: '' }),
    enabled,
    staleTime: 60_000,
    retry: false,
    // El coste no depende del texto del movimiento.
    queryFn: () => invokeAiMedia<AnimateEstimate>('video.estimate', brandId, { ...input, motion: '' }),
  });
}

/** Encarga la animación. Siempre es asíncrona: el seguimiento lo hace `useAnimateProgress`. */
export function useAnimatePhoto(brandId: string): AsyncMutation<AnimateResult, AnimateInput> {
  const queryClient = useQueryClient();
  const mutation = useMutation<AnimateResult, AiRequestError, AnimateInput>({
    mutationFn: (input) => invokeAiMedia<AnimateResult>('video.animate', brandId, input),
    onSuccess: (result) => {
      if (result.status === 'completed') void queryClient.invalidateQueries({ queryKey: assetKeys.all(brandId) });
    },
  });
  const copy: Partial<typeof mutation> = { ...mutation };
  delete copy.mutate;
  return copy as AsyncMutation<AnimateResult, AnimateInput>;
}

export type AnimateProgress =
  | { status: 'queued' }
  | { status: 'running' }
  | { status: 'completed'; asset: MediaAssetRow; costMicros: number | null }
  | { status: 'failed'; message: string };

function failureMessage(row: Pick<AiGenerationRow, 'status' | 'error_code'>): string {
  if (row.status === 'expired' || row.error_code === 'never_finished') {
    return 'La IA no terminó el vídeo a tiempo. No se ha descontado nada del cupo. Vuelve a probar.';
  }
  if (row.error_code === 'moderated') {
    return 'El proveedor ha rechazado la petición por su contenido. Cambia la indicación y vuelve a probar.';
  }
  return `${aiErrorMessage('provider_failed')}`;
}

/**
 * Sigue la generación cada pocos segundos: «en cola» o «generando» según lo que
 * dice el proveedor (guardado en el trabajo de seguimiento) y, al terminar, el
 * vídeo que dejó en la biblioteca.
 */
export function useAnimateProgress(brandId: string, generationId: string | null) {
  const queryClient = useQueryClient();
  return useQuery<AnimateProgress>({
    queryKey: animateKeys.progress(generationId ?? ''),
    enabled: generationId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return !status || status === 'queued' || status === 'running' ? 4000 : false;
    },
    queryFn: async (): Promise<AnimateProgress> => {
      const generation = unwrap(
        await supabase
          .from('ai_generations')
          .select('id, status, error_code, cost_micros, output')
          .eq('id', generationId!)
          .maybeSingle(),
      ) as Pick<AiGenerationRow, 'id' | 'status' | 'error_code' | 'cost_micros' | 'output'> | null;
      if (!generation || generation.status === 'reserved') {
        const job = unwrap(
          await supabase
            .from('jobs')
            .select('last_error')
            .eq('brand_id', brandId)
            .eq('idempotency_key', `ai-media:${generationId}`)
            .maybeSingle(),
        ) as { last_error: string | null } | null;
        return { status: job?.last_error?.startsWith('Generándose') ? 'running' : 'queued' };
      }
      if (generation.status !== 'succeeded') return { status: 'failed', message: failureMessage(generation) };
      const assetId = (generation.output as AiMediaGenerationOutput | null)?.assets?.[0]?.asset_id;
      const asset = assetId
        ? (unwrap(
            await supabase.from('media_assets').select('*').eq('brand_id', brandId).eq('id', assetId).maybeSingle(),
          ) as MediaAssetRow | null)
        : null;
      if (!asset) {
        return { status: 'failed', message: 'La IA generó el vídeo, pero no se ha podido añadir a la biblioteca.' };
      }
      void queryClient.invalidateQueries({ queryKey: assetKeys.all(brandId) });
      return {
        status: 'completed',
        asset,
        costMicros: generation.cost_micros === null ? null : Number(generation.cost_micros),
      };
    },
  });
}

