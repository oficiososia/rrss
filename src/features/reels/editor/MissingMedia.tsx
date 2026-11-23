// Archivos del reel que se borraron de la biblioteca: el aviso de una línea de arriba y la
// marca sobre la vista previa, con «Sustituir» y «Quitar». Componentes aparte del editor para
// tocar lo mínimo su pantalla; qué falta lo dice `missing.ts`.
import { TriangleAlert } from 'lucide-react';
import { Button, Notice } from '@/components/ui';
import { useClockValue, type PlayClock } from './clock';
import { missingLabel, type MissingItem } from './missing';
import { clipIndexAt } from './ops';
import type { PlanTimeline } from './project';

/** Aviso de una línea encima del editor, con un enlace que lleva a lo primero que falta. */
export function MissingNotice({
  text,
  first,
  readOnly,
  onGo,
}: {
  text: string;
  first: MissingItem | undefined;
  readOnly: boolean;
  onGo: () => void;
}) {
  return (
    <div role="alert" data-testid="reel-missing-notice">
      <Notice tone="warning">
        {text}{' '}
        {!readOnly && (
          <button type="button" className="font-medium underline" onClick={onGo} data-testid="reel-missing-go">
            {first?.kind === 'clip' ? 'Ir a la primera' : 'Ir a ella'}
          </button>
        )}
      </Notice>
    </div>
  );
}

/**
 * Sobre la vista previa: si en el cabezal hay un elemento cuyo archivo se borró (que se ve negro),
 * lo dice y ofrece «Sustituir» y «Quitar». Si lo que falta es la música, lo mismo en cualquier instante.
 */
export function MissingOverlay({
  clock,
  timeline,
  missing,
  readOnly,
  onReplace,
  onRemove,
}: {
  clock: PlayClock;
  timeline: PlanTimeline;
  missing: MissingItem[];
  readOnly: boolean;
  onReplace: (item: MissingItem) => void;
  onRemove: (item: MissingItem) => void;
}) {
  const t = useClockValue(clock);
  const index = clipIndexAt(timeline, Math.min(t, Math.max(0, timeline.total - 1e-3)));
  const here =
    missing.find((m) => m.kind === 'clip' && m.index === index) ?? missing.find((m) => m.kind === 'music') ?? null;
  if (!here || here.kind === 'cover') return null;
  const label = here.kind === 'clip' ? missingLabel(here.media) : 'Falta esta música';
  return (
    <div
      className="pointer-events-none absolute inset-x-2 top-2 z-20 flex justify-center"
      data-testid="reel-preview-missing"
    >
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-lg bg-surface/95 px-3 py-2 text-sm shadow-pop">
        <TriangleAlert className="h-4 w-4 shrink-0 text-danger" aria-hidden />
        <span className="font-medium text-danger">{label}</span>
        <span className="text-xs text-muted max-sm:hidden">Se ha borrado de la biblioteca.</span>
        {!readOnly && (
          <span className="flex gap-1">
            <Button size="sm" onClick={() => onReplace(here)} data-testid="reel-missing-replace">
              {here.kind === 'music' ? 'Cambiar' : 'Sustituir'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onRemove(here)} data-testid="reel-missing-remove">
              Quitar
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
