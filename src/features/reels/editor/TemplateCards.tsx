// Estilos (plantillas) del reel, con una vista previa que se mueve: se ve el
// ritmo, la transición y el movimiento de las fotos antes de elegir. Son dos
// fotos de muestra que se suceden con la transición de la plantilla; no usa
// nada de la marca ni del servidor.
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReelTemplateSummary } from '../templates';

const KEYFRAMES = `
@keyframes rtp-fade { 0%,40% { opacity: 0 } 55%,95% { opacity: 1 } 100% { opacity: 0 } }
@keyframes rtp-cut { 0%,49% { opacity: 0 } 50%,99% { opacity: 1 } 100% { opacity: 0 } }
@keyframes rtp-left { 0%,40% { transform: translateX(100%) } 55%,95% { transform: translateX(0) } 100% { transform: translateX(100%) } }
@keyframes rtp-up { 0%,40% { transform: translateY(100%) } 55%,95% { transform: translateY(0) } 100% { transform: translateY(100%) } }
@keyframes rtp-zoom-in { from { transform: scale(1) } to { transform: scale(1.18) } }
@keyframes rtp-zoom-out { from { transform: scale(1.18) } to { transform: scale(1) } }
@keyframes rtp-pan { from { transform: scale(1.2) translateX(-6%) } to { transform: scale(1.2) translateX(6%) } }
@media (prefers-reduced-motion: reduce) { .rtp-anim, .rtp-anim * { animation: none !important } }
`;

const TRANSITION_ANIMATION: Record<ReelTemplateSummary['transition']['type'], string> = {
  cut: 'rtp-cut',
  fade: 'rtp-fade',
  fadeblack: 'rtp-fade',
  dissolve: 'rtp-fade',
  slideleft: 'rtp-left',
  slideup: 'rtp-up',
};

const MOTION_ANIMATION: Partial<Record<ReelTemplateSummary['photoMotion']['type'], string>> = {
  'zoom-in': 'rtp-zoom-in',
  'zoom-out': 'rtp-zoom-out',
  'pan-right': 'rtp-pan',
  'pan-left': 'rtp-pan',
  alternate: 'rtp-zoom-in',
};

/** Cuánto dura cada vuelta de la muestra: más corta cuanto más rápida es la plantilla. */
const sampleCycleSeconds = (template: ReelTemplateSummary) =>
  Math.min(6, Math.max(1.6, template.timing.photoSeconds * 2));

export function TemplateSample({ template, className }: { template: ReelTemplateSummary; className?: string }) {
  const cycle = sampleCycleSeconds(template);
  const motion = MOTION_ANIMATION[template.photoMotion.type];
  const textPosition = { top: 'top-[14%]', center: 'top-[44%]', bottom: 'bottom-[16%]' }[template.text.position];
  return (
    <span
      aria-hidden
      className={cn('rtp-anim relative block aspect-[9/16] overflow-hidden rounded-md bg-black', className)}
      data-testid="reel-template-sample"
    >
      <style>{KEYFRAMES}</style>
      <span
        className="absolute inset-0 bg-gradient-to-br from-amber-500 to-rose-700"
        style={motion ? { animation: `${motion} ${cycle}s ease-in-out infinite alternate` } : undefined}
      />
      <span
        className="absolute inset-0 bg-gradient-to-tr from-sky-600 to-emerald-500"
        style={{ animation: `${TRANSITION_ANIMATION[template.transition.type]} ${cycle}s linear infinite` }}
      />
      <span
        className={cn(
          'absolute inset-x-[12%] h-[10%] rounded-sm',
          textPosition,
          template.text.box ? 'bg-black/60' : 'bg-white/80',
        )}
      />
    </span>
  );
}

export interface TemplateCardsProps {
  templates: ReelTemplateSummary[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/** Una tarjeta por estilo: muestra en movimiento, nombre, para qué sirve y duración típica. */
export function TemplateCards({ templates, value, onChange, disabled }: TemplateCardsProps) {
  return (
    <ul
      className="grid grid-cols-3 gap-2"
      role="radiogroup"
      aria-label="Estilo del reel"
      data-testid="reel-template-cards"
    >
      {templates.map((t) => {
        const selected = t.id === value;
        return (
          <li key={t.id} className="min-w-0">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(t.id)}
              className={cn(
                'flex h-full w-full flex-col gap-2 rounded-xl border p-2 text-left transition-colors',
                selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-subtle',
              )}
              data-testid="reel-template-card"
              data-template={t.id}
            >
              <TemplateSample template={t} className="mx-auto w-full max-w-[5.5rem]" />
              <span className="flex items-center gap-1 text-sm font-medium">
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
                <span className="truncate">{t.name}</span>
              </span>
              <span className="line-clamp-3 text-xs text-muted">{t.description}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
