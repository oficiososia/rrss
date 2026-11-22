import { Clapperboard } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Notice, Select, Spinner, Textarea } from '@/components/ui';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { formatMicros, moneyEstimateNote } from '@/features/ai/money';
import type { MediaAssetRow } from '@/lib/database.types';
import { cn } from '@/lib/utils';
import { useSignedUrls } from './api';
import {
  MAX_MOTION_CHARS,
  MOVEMENTS,
  motionText,
  useAnimateEstimate,
  useAnimateOptions,
  useAnimatePhoto,
  useAnimateProgress,
  type AnimateModelChoice,
  type MovementId,
} from './animateApi';

const DURATIONS = [5, 8, 10];

function regionLabel(model: AnimateModelChoice): string {
  if (model.euProcessing) return 'Procesa en la UE';
  return model.dataRegion === 'unknown' ? 'Región sin confirmar (fuera de la UE)' : 'Fuera de la UE';
}

interface AnimateDialogProps {
  asset: MediaAssetRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abre la ficha del vídeo ya hecho. */
  onOpenAsset?: (assetId: string) => void;
}

/** Ventana de «Animar con IA…» sobre una foto de la biblioteca. */
export function AnimateDialog({ asset, open, onOpenChange, onOpenAsset }: AnimateDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Animar esta foto con IA"
      description="Un clip corto a partir de la foto, para usarlo en un reel. Se guarda en la biblioteca, en «Vídeos con IA»; tu foto no se modifica."
    >
      {open && <Animator asset={asset} onOpenAsset={onOpenAsset} />}
    </Dialog>
  );
}

function Animator({ asset, onOpenAsset }: { asset: MediaAssetRow; onOpenAsset?: (assetId: string) => void }) {
  const brandId = asset.brand_id;
  const options = useAnimateOptions(brandId);
  const animate = useAnimatePhoto(brandId);
  const [movement, setMovement] = useState<MovementId | null>('push-in');
  const [free, setFree] = useState('');
  const [seconds, setSeconds] = useState(5);
  const [modelId, setModelId] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const progress = useAnimateProgress(brandId, pendingId);

  const data = options.data;
  const choices = useMemo(() => data?.models ?? [], [data]);
  const selected = choices.find((m) => m.id === modelId) ?? choices.find((m) => m.default) ?? choices[0];
  const durations = useMemo(
    () => DURATIONS.filter((d) => d >= (selected?.minSeconds ?? 1) && d <= (selected?.maxSeconds ?? 10)),
    [selected],
  );
  const chosenSeconds = durations.includes(seconds) ? seconds : (durations[0] ?? 5);
  const estimate = useAnimateEstimate(
    brandId,
    { assetId: asset.id, motion: '', seconds: chosenSeconds, model: selected?.id },
    Boolean(selected),
  );

  const motion = motionText(movement, free);
  const finished = progress.data?.status === 'completed' ? progress.data.asset : null;
  const failed = progress.data?.status === 'failed';
  const busy = animate.isPending || (pendingId !== null && !failed && !finished);
  const canSubmit = motion.length >= 3 && free.length <= MAX_MOTION_CHARS && Boolean(selected) && !busy && !finished;
  const urls = useSignedUrls(finished ? [finished.storage_path] : []);
  const previewUrl = finished ? urls.data?.get(finished.storage_path) : undefined;

  function run() {
    setPendingId(null);
    animate.mutateAsync({ assetId: asset.id, motion, seconds: chosenSeconds, model: selected?.id }).then(
      (result) => setPendingId(result.generationId),
      () => {
        // El error queda en `animate.error` y se enseña abajo.
      },
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) run();
  }

  if (options.isPending) return <Spinner label="Comprobando si se puede animar…" />;
  if (options.isError) return <AiErrorNotice error={options.error} onRetry={() => void options.refetch()} />;
  if (!data?.available || choices.length === 0) {
    return (
      <Notice tone="warning">
        {data?.reason === 'agency_mode' || data?.agencyMode
          ? 'Esta marca trabaja en modo agencia: el vídeo con IA lo usa solo el personal de la agencia. Pídelo desde «Encargos».'
          : data?.reason === 'ai_paused'
            ? 'La IA de pago está en pausa este mes por el tope global de la plataforma.'
            : data?.reason === 'quota_exhausted' || data?.reason === 'no_quota'
              ? 'No queda cupo de IA este mes para animar fotos.'
              : data?.reason === 'plan'
                ? 'Tu plan no incluye el vídeo con IA.'
                : data?.reason === 'no_permission'
                  ? 'No tienes permiso para generar con IA en esta marca.'
                  : 'Animar fotos con IA no está disponible ahora mismo.'}
      </Notice>
    );
  }

  return (
    <div className="space-y-4" data-testid="animate-dialog">
      <Notice tone="warning">
        La IA puede alterar el plato: cambiar su forma, las cantidades, los adornos o la vajilla. Revisa el vídeo antes
        de usarlo y no lo presentes como una grabación real: queda marcado como generado con IA.
      </Notice>

      <form onSubmit={submit} className="space-y-4">
        <fieldset className="space-y-2" disabled={busy || Boolean(finished)}>
          <legend className="text-sm font-medium">Movimiento</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Movimiento">
            {MOVEMENTS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={movement === m.id}
                onClick={() => setMovement(movement === m.id ? null : m.id)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60',
                  movement === m.id ? 'border-primary bg-primary-soft ring-2 ring-primary' : 'border-border',
                )}
                data-testid={`animate-movement-${m.id}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Field
          label="Indicación propia"
          optional
          hint={`Por ejemplo: «que se vea el vapor del arroz». ${free.length} / ${MAX_MOTION_CHARS}`}
          error={free.length > MAX_MOTION_CHARS ? 'La indicación es demasiado larga.' : null}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={free}
              disabled={busy || Boolean(finished)}
              onChange={(e) => setFree(e.target.value)}
              data-testid="animate-free"
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Duración">
            {(p) => (
              <Select
                {...p}
                value={chosenSeconds}
                disabled={busy || Boolean(finished)}
                onChange={(e) => setSeconds(Number(e.target.value))}
                data-testid="animate-seconds"
              >
                {durations.map((d) => (
                  <option key={d} value={d}>
                    {d} segundos
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Modelo" hint={selected ? regionLabel(selected) : undefined}>
            {(p) => (
              <Select
                {...p}
                value={selected?.id ?? ''}
                disabled={busy || Boolean(finished) || choices.length < 2}
                onChange={(e) => setModelId(e.target.value)}
                data-testid="animate-model"
              >
                {choices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {selected && !selected.euProcessing && (
          <p className="text-xs text-muted" data-testid="animate-region">
            La foto se envía a fal.ai y a la empresa que hace el modelo, que no garantizan tratar los datos en la UE. No
            uses fotos con personas reconocibles.
          </p>
        )}
        {selected?.untestedAdapter && (
          <p className="text-xs text-muted" data-testid="animate-untested">
            Este modelo todavía no se ha probado en la plataforma contra el servicio real.
          </p>
        )}
        {estimate.data && !estimate.data.exactAspect && (
          <p className="text-xs text-muted" data-testid="animate-aspect">
            El vídeo saldrá con la misma forma que la foto, que no es vertical 9:16, 4:5 ni cuadrada. Si lo quieres para
            un reel, recorta antes la foto.
          </p>
        )}

        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-subtle px-3.5 py-3"
          data-testid="animate-estimate"
        >
          <div className="text-sm">
            {estimate.isPending ? (
              <span className="text-muted">Calculando el coste…</span>
            ) : estimate.isError ? (
              <span className="text-danger">No se ha podido calcular el coste.</span>
            ) : (
              <>
                <span className="font-medium">Coste máximo: {formatMicros(estimate.data.costMicros)}</span>
                <span className="block text-xs text-muted">
                  {chosenSeconds} s × {formatMicros(selected?.pricePerSecondMicros ?? 0)} por segundo.{' '}
                  {moneyEstimateNote()}
                </span>
              </>
            )}
          </div>
          <Button type="submit" disabled={!canSubmit} loading={animate.isPending} data-testid="animate-submit">
            <Clapperboard className="h-4 w-4" aria-hidden />
            Animar
          </Button>
        </div>
      </form>

      {pendingId && !failed && !finished && (
        <div data-testid="animate-status" data-state={progress.data?.status ?? 'queued'}>
          <Spinner
            label={
              progress.data?.status === 'running'
                ? 'Generando el vídeo… Suele tardar uno o dos minutos. Si cierras esta ventana, el vídeo aparecerá igualmente en la biblioteca.'
                : 'En cola, esperando turno… Si cierras esta ventana, el vídeo aparecerá igualmente en la biblioteca.'
            }
          />
        </div>
      )}
      {failed && progress.data?.status === 'failed' && (
        <div role="alert" className="rounded-lg bg-danger-soft px-3.5 py-3 text-sm text-danger" data-testid="ai-error">
          <p>{progress.data.message}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={run} disabled={!canSubmit && busy}>
            Reintentar
          </Button>
        </div>
      )}
      {finished && (
        <div className="space-y-3" data-testid="animate-done">
          <p className="text-sm font-medium">Listo. Revisa el resultado:</p>
          {previewUrl ? (
            <video src={previewUrl} controls loop className="max-h-80 w-full rounded-lg bg-subtle" />
          ) : (
            <Spinner label="Preparando la vista previa…" />
          )}
          <p className="text-xs text-muted">
            Guardado en la biblioteca, carpeta «Vídeos con IA». Ya se puede elegir como clip al montar un reel.
          </p>
          {onOpenAsset && (
            <Button variant="secondary" size="sm" onClick={() => onOpenAsset(finished.id)}>
              Abrir en la biblioteca
            </Button>
          )}
        </div>
      )}
      {animate.isError && <AiErrorNotice error={animate.error} onRetry={run} />}
    </div>
  );
}
