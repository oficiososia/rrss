import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { CutoutProgress } from './cutout/engine';
import { describeProgress } from './progressText';
import { cn } from '@/lib/utils';

/** Segundos que lleva en pantalla (para que se vea que no está colgado). */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/**
 * Progreso real del recorte: la fase en la que va (descargando el modelo, recortando en tu equipo,
 * en cola / recortando / descargando en el servidor), lo que suele tardar, el tiempo que lleva y,
 * si se da `onCancel`, el botón para parar.
 */
export function CutoutProgressBar({
  progress,
  onCancel,
}: {
  progress: CutoutProgress | null;
  onCancel?: () => void;
}) {
  const view = describeProgress(progress);
  const elapsed = useElapsedSeconds();
  return (
    <div className="space-y-1" data-testid="photo-edit-cutout-progress">
      <div
        role="progressbar"
        aria-label={view.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.pct ?? undefined}
        aria-valuetext={view.step ? `${view.label} Paso ${view.step.index} de ${view.step.total}` : view.label}
        className="h-2 overflow-hidden rounded bg-subtle"
      >
        <div
          className={cn('h-full bg-primary', view.pct === null && 'w-1/3 animate-pulse')}
          style={view.pct === null ? undefined : { width: `${view.pct}%` }}
        />
      </div>
      <p className="text-sm" role="status" data-testid="photo-edit-cutout-phase">
        {view.step && <span className="text-muted">Paso {view.step.index} de {view.step.total}: </span>}
        {view.label}
      </p>
      <p className="text-xs text-muted" data-testid="photo-edit-cutout-elapsed">
        {view.expected} Llevas {elapsed} s.
      </p>
      {onCancel && (
        <Button variant="secondary" size="sm" onClick={onCancel} data-testid="photo-edit-cutout-cancel">
          Cancelar
        </Button>
      )}
    </div>
  );
}
