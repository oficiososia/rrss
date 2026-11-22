import { cn } from '@/lib/utils';

// Medidor del nivel del micrófono del copiloto: se ve si el micrófono oye algo
// mientras se graba (recording.ts da el nivel de 0 a 1).

function describe(percent: number, active: boolean): string {
  if (!active) return 'Micrófono apagado';
  if (percent < 8) return 'Sin sonido';
  if (percent < 35) return 'Sonido bajo';
  if (percent < 80) return 'Sonido normal';
  return 'Sonido alto';
}

export interface MicLevelProps {
  /** Nivel de 0 a 1. */
  level: number;
  /** ¿Se está grabando? Apagado, el medidor queda a cero y lo dice. */
  active?: boolean;
  className?: string;
}

export function MicLevel({ level, active = true, className }: MicLevelProps) {
  const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const percent = active ? Math.round(safe * 100) : 0;
  return (
    <div
      role="meter"
      aria-label="Nivel del micrófono"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={describe(percent, active)}
      data-testid="copilot-mic-level"
      data-active={active ? 'true' : 'false'}
      className={cn('h-2 w-24 shrink-0 overflow-hidden rounded-full bg-subtle', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-75', percent >= 80 ? 'bg-danger' : 'bg-primary')}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
