// Piezas del panel de propiedades que no caben en Inspector.tsx: la tarjeta de
// un movimiento de cámara (con la foto moviéndose en bucle) y el botón
// «Ajustar los cortes a la música».
import { useState } from 'react';
import { Button, Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ReelTemplateSummary } from '../templates';
import type { PHOTO_MOTIONS, ReelProject } from './project';
import { MIN_CONFIDENCE, fitCutsToBeats } from './rhythm';
import type { BeatsState } from './useBeats';

/** Tarjeta de un movimiento de cámara: la foto (o un degradado) se mueve en bucle para ver el efecto. */
export function MotionChoice({
  label,
  motion,
  url,
  selected,
  onPick,
}: {
  label: string;
  motion: (typeof PHOTO_MOTIONS)[number] | undefined;
  url: string | undefined;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onPick}
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg border p-1 text-[10px] leading-tight',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:bg-subtle',
      )}
      data-testid={`reel-motion-${motion ?? 'template'}`}
    >
      <span className="relative block aspect-[9/16] w-full overflow-hidden rounded bg-subtle">
        <span
          className={cn('absolute inset-0 bg-cover bg-center', motion && `reel-motion-${motion}`)}
          style={{ backgroundImage: url ? `url("${url}")` : 'linear-gradient(135deg, #cbd5e1, #64748b)' }}
          aria-hidden
        />
      </span>
      <span className="text-center">{label}</span>
    </button>
  );
}

/** «Ajustar los cortes a la música»: analiza el ritmo y reparte las duraciones en los golpes. */
export function RhythmSection({
  project,
  template,
  beats,
  apply,
  fileSecondsOf,
}: {
  project: ReelProject;
  template: ReelTemplateSummary;
  beats: BeatsState;
  apply: (change: (project: ReelProject) => ReelProject, merge?: string) => void;
  fileSecondsOf: (path: string) => number | null;
}) {
  const [every, setEvery] = useState('auto');
  const [note, setNote] = useState<string | null>(null);
  if (!project.plan.music) return null;
  const run = async () => {
    setNote(null);
    const analysis = await beats.analyze();
    if (!analysis) return;
    if (analysis.beats.length < 2) {
      setNote('No se han encontrado golpes en esta música: los cortes se quedan como están.');
      return;
    }
    const result = fitCutsToBeats(project, template, analysis, {
      beatsPerCut: every === 'auto' ? undefined : Number(every),
      fileSeconds: fileSecondsOf,
    });
    if (!result) {
      setNote('No se han podido ajustar los cortes.');
      return;
    }
    apply(() => result.project);
    const parts = [
      `Cortes ajustados a la música (unas ${Math.round(analysis.bpm)} pulsaciones por minuto): ${result.cuts} de ${project.plan.clips.length} caen en un golpe.`,
    ];
    if (result.short.length > 0)
      parts.push(`El clip ${result.short.join(', ')} no llega a su golpe porque su archivo se acaba antes.`);
    if (analysis.confidence < MIN_CONFIDENCE)
      parts.push('Esta música no tiene un pulso claro: puede que no suene bien.');
    parts.push('Puedes deshacerlo con «Deshacer».');
    setNote(parts.join(' '));
  };
  return (
    <section className="space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cortes al ritmo</h3>
      <p className="text-xs text-muted">
        Detecta el compás de la música y reparte la duración de las fotos y los clips para que cada corte caiga en un
        golpe. Cambia las duraciones; el orden no.
      </p>
      <label className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-sm">
        <span className="text-muted">Cortar cada</span>
        <Select value={every} onChange={(e) => setEvery(e.target.value)} aria-label="Cada cuántos golpes se corta">
          <option value="auto">Lo más parecido a ahora</option>
          <option value="1">Cada golpe</option>
          <option value="2">Cada 2 golpes</option>
          <option value="4">Cada 4 golpes (un compás)</option>
        </Select>
      </label>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={() => void run()}
        disabled={beats.busy || project.plan.clips.length === 0}
        data-testid="reel-fit-beats"
      >
        {beats.busy ? 'Analizando la música…' : 'Ajustar los cortes a la música'}
      </Button>
      {beats.error && (
        <p className="text-xs text-danger" role="alert">
          {beats.error}
        </p>
      )}
      {note && (
        <p className="text-xs" role="status" data-testid="reel-fit-note">
          {note}
        </p>
      )}
    </section>
  );
}
