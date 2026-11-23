import { CheckCircle2, Circle, ImagePlus, Loader2, MinusCircle, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { formatMicros } from '@/features/ai/money';
import type { CopilotAssetInfo } from './apply';
import { COPILOT_MAX_PLAN_PHOTOS } from './operations';
import { describePlan, type CopilotPlan, type PlanStepStatus } from './plan';
import { planCost, planProblems } from './planCost';

// Tarjeta del plan del copiloto (docs/copiloto-voz.md §15): lo que se va a
// hacer, paso a paso y en lenguaje llano, con la indicación del fondo ENTERA y
// el coste máximo ANTES de gastar. Hasta que la persona dice que sí no se
// genera, no se recorta y no se cambia el diseño.

/** Un plan a la espera de confirmación o en marcha. */
export interface PendingPlan {
  orderId: number;
  transcript: string;
  plan: CopilotPlan;
  /** Lo que dijo la IA al interpretar la orden (su nota y lo descartado): se enseña al terminar. */
  notes: string[];
  /** «Esta foto» cuando se dio la orden: la elegida en el lienzo y las del copiloto. */
  chosen: CopilotAssetInfo[];
  /** Fotos que se colocarán: las encontradas en la biblioteca y las elegidas a mano. */
  photos: CopilotAssetInfo[];
  /** Búsquedas que no han encontrado nada. */
  missing: string[];
  /** Coste del fondo con IA: `undefined` mientras se calcula, `null` si no se puede saber antes. */
  backgroundMicros: number | null | undefined;
  /** `preparing`: buscando y calculando; `ready`: esperando el «sí»; `running`: haciéndose. */
  phase: 'preparing' | 'ready' | 'running';
  /** Se ha pedido cancelar y se está parando. */
  cancelling?: boolean;
  statuses: Record<string, PlanStepStatus>;
  /** Lo que ha pasado en un paso (encontradas 2 de 3, no se pudo recortar…). */
  stepNotes: Record<string, string>;
}

const STATUS_TEXT: Record<PlanStepStatus, string> = {
  pending: 'Pendiente',
  running: 'En curso…',
  done: 'Hecho',
  failed: 'Fallido',
  skipped: 'Saltado',
};

function StatusIcon({ status }: { status: PlanStepStatus }) {
  const className = 'mt-0.5 h-4 w-4 shrink-0';
  if (status === 'running') return <Loader2 className={`${className} animate-spin`} aria-hidden />;
  if (status === 'done') return <CheckCircle2 className={`${className} text-success`} aria-hidden />;
  if (status === 'failed') return <XCircle className={`${className} text-danger`} aria-hidden />;
  if (status === 'skipped') return <MinusCircle className={`${className} text-muted`} aria-hidden />;
  return <Circle className={`${className} text-muted`} aria-hidden />;
}

export interface PlanCardProps {
  pending: PendingPlan;
  onConfirm: () => void;
  onCancel: () => void;
  /** Abre el selector de fotos de la biblioteca para añadir una al plan. */
  onPick: () => void;
  onRemovePhoto: (id: string) => void;
  /** El interruptor «Recortar las fotos»: recortadas (sin su fondo) o enteras. Solo cambia algo antes del «sí». */
  onCutoutChange: (cutout: boolean) => void;
  /**
   * El interruptor «Crear el fondo con IA» cuando la orden no pedía un fondo: lo
   * primero es una foto real que llena el lienzo; el fondo con IA es opcional.
   */
  onAiBackgroundChange?: (on: boolean) => void;
}

export function PlanCard({ pending, onConfirm, onCancel, onPick, onRemovePhoto, onCutoutChange, onAiBackgroundChange }: PlanCardProps) {
  const { plan, phase } = pending;
  // Una foto que llena el lienzo es UNA: la primera que casa (quitándola, se ve la siguiente).
  const photos = plan.placement?.layout === 'fill' ? pending.photos.slice(0, 1) : pending.photos;
  const known = phase === 'preparing' ? undefined : photos.length;
  const steps = describePlan(plan, known);
  const cost = planCost(plan, known, pending.backgroundMicros);
  const problems = planProblems(plan, photos.length, pending.backgroundMicros);
  const ready = phase === 'ready';
  const notes = [...pending.notes, ...plan.notes];
  // Cuántas fotos se querían: lo pedido al buscar o, si se colocan las elegidas a mano, las que quepan.
  const target = plan.wanted > 0 ? plan.wanted : COPILOT_MAX_PLAN_PHOTOS;
  const canPick = ready && plan.placement !== null && photos.length < COPILOT_MAX_PLAN_PHOTOS;

  return (
    <div
      role="group"
      aria-label="Plan del copiloto"
      aria-live="polite"
      className="space-y-2 rounded-lg border border-primary bg-subtle p-3 text-sm"
      data-testid="copilot-plan"
      data-phase={phase}
    >
      <p className="font-semibold">
        {phase === 'running' ? 'Haciendo el plan' : 'Esto es lo que voy a hacer'}{' '}
        <span className="font-normal text-muted">para «{pending.transcript}»</span>
      </p>
      <ol className="space-y-1.5">
        {steps.map((step) => {
          const status = pending.statuses[step.id] ?? 'pending';
          return (
            <li key={step.id} className="flex items-start gap-2" data-testid="copilot-plan-step" data-step={step.id} data-status={status}>
              <StatusIcon status={status} />
              <div className="min-w-0 flex-1">
                <p>
                  {step.label} <span className="text-xs text-muted">· {STATUS_TEXT[status]}</span>
                </p>
                {step.detail && (
                  <p className="text-xs text-muted" data-testid="copilot-plan-detail">
                    {step.detail}
                  </p>
                )}
                {pending.stepNotes[step.id] && <p className="text-xs text-muted">{pending.stepNotes[step.id]}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {plan.placement && phase !== 'preparing' && (
        <div className="space-y-1.5" data-testid="copilot-plan-photos">
          {pending.missing.map((query) => (
            <p key={query} role="status" data-testid="copilot-plan-missing">
              No encuentro fotos de «{query}» en la biblioteca. Elige tú cuáles usar.
            </p>
          ))}
          {photos.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Fotos del plan">
              {photos.map((photo) => (
                <li key={photo.id} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5">
                  {photo.name}
                  {ready && (
                    <button type="button" aria-label={`No usar ${photo.name}`} onClick={() => onRemovePhoto(photo.id)}>
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            ready && <p className="text-xs text-muted">Sin fotos, el paso de colocarlas se salta.</p>
          )}
          {canPick && (
            <Button size="sm" variant="secondary" onClick={onPick} data-testid="copilot-plan-pick">
              <ImagePlus className="h-4 w-4" aria-hidden />
              Elegir fotos ({photos.length} de {Math.max(target, photos.length)})
            </Button>
          )}
        </div>
      )}

      {/* La orden no pedía un fondo: va una foto real; el fondo creado con IA es opcional y se marca aquí. */}
      {plan.aiAlternative && onAiBackgroundChange && (
        <div className="space-y-0.5">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={plan.aiAlternative.active}
              disabled={!ready}
              aria-describedby="copilot-plan-ai-hint"
              onChange={(event) => onAiBackgroundChange(event.target.checked)}
              data-testid="copilot-plan-ai-background"
            />
            Crear el fondo con IA en vez de usar tu foto
            {typeof pending.backgroundMicros === 'number' && ` (≈ ${formatMicros(pending.backgroundMicros)})`}
          </label>
          <p id="copilot-plan-ai-hint" className="pl-[1.375rem] text-xs text-muted">
            {plan.aiAlternative.active
              ? 'Se crea un fondo con IA (sin comida ni productos) y tus fotos van encima, recortadas.'
              : 'Sin marcar, no se gasta nada: una foto tuya llena el lienzo de borde a borde.'}
          </p>
        </div>
      )}

      {/* Recortadas (lo normal sobre una imagen de fondo) o enteras: se decide aquí, antes del «sí». */}
      {plan.placement && plan.placement.layout !== 'fill' && plan.canCutout && (
        <div className="space-y-0.5">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={plan.placement.cutout}
              disabled={!ready}
              aria-describedby="copilot-plan-cutout-hint"
              onChange={(event) => onCutoutChange(event.target.checked)}
              data-testid="copilot-plan-cutout"
            />
            Recortar las fotos (quitarles su fondo)
          </label>
          <p id="copilot-plan-cutout-hint" className="pl-[1.375rem] text-xs text-muted" data-testid="copilot-plan-cutout-hint">
            {plan.placement.cutout
              ? 'Se colocan recortadas, sin su fondo. Si ya hay un recorte de una foto en la biblioteca, se usa ese. Desmárcalo para colocarlas enteras.'
              : plan.overImage
                ? 'Se colocan enteras: sobre el fondo se verá un rectángulo con el fondo de cada foto.'
                : 'Se colocan enteras, tal como están en la biblioteca.'}
          </p>
        </div>
      )}

      {/* Lo que no se va a hacer y por qué: lo que dijo o descartó la IA y lo que ha quitado el plan. */}
      {notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted" data-testid="copilot-plan-notes">
          {notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      )}

      <p data-testid="copilot-plan-cost">
        <span className="font-medium">{cost.headline}</span>
        {cost.summary && <span className="block text-xs text-muted">{cost.summary}</span>}
      </p>
      {problems.map((problem) => (
        <p key={problem} role="alert" className="text-danger" data-testid="copilot-plan-blocked">
          {problem}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        {phase !== 'running' && (
          <Button
            size="sm"
            disabled={!ready || problems.length > 0}
            onClick={onConfirm}
            data-testid="copilot-plan-confirm"
          >
            Sí, hazlo
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={pending.cancelling}
          onClick={onCancel}
          data-testid="copilot-plan-cancel"
        >
          {phase === 'running' ? (pending.cancelling ? 'Cancelando…' : 'Cancelar') : 'No, descartar'}
        </Button>
        {phase !== 'running' && (
          <span className="text-xs text-muted">
            También vale decir o escribir «sí» o «no». Cualquier otra orden descarta este plan. Hasta que digas que sí no
            se gasta ni se cambia nada.
          </span>
        )}
        {phase === 'running' && (
          <span className="text-xs text-muted">Si cancelas, el diseño no cambia; lo ya creado queda en la biblioteca.</span>
        )}
      </div>
    </div>
  );
}
