// Portada del reel: un fotograma del propio vídeo (el que se ve en el cabezal)
// o una de las fotos del montaje. Queda en el plan (`plan.cover`); al montar el
// vídeo, el trabajador guarda la portada como imagen en la biblioteca (carpeta
// «Reels») junto al vídeo. La publicación en Instagram todavía no envía portada
// (docs/editor-reels.md §8): aquí solo se deja elegida y guardada.
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Cover, DraftPlan } from './project';

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);

export interface CoverPickerProps {
  plan: DraftPlan;
  playhead: number;
  total: number;
  readOnly: boolean;
  urlOf: (path: string) => string | undefined;
  labelOf: (path: string) => string;
  onChange: (cover: Cover | undefined) => void;
  onSeek: (seconds: number) => void;
}

export function CoverPicker({ plan, playhead, total, readOnly, urlOf, labelOf, onChange, onSeek }: CoverPickerProps) {
  const cover = plan.cover;
  const photos = plan.clips.filter((c) => c.type === 'photo');
  const unique = [...new Set(photos.map((p) => p.path))];
  return (
    <div className="space-y-2" data-testid="reel-cover">
      <h2 className="text-sm font-semibold">Portada</h2>
      <p className="text-xs text-muted" data-testid="reel-cover-status">
        {!cover && 'Sin elegir: se usará un fotograma del principio.'}
        {cover?.type === 'frame' && `Fotograma del segundo ${fmt(cover.at)}.`}
        {cover?.type === 'photo' && `La foto «${labelOf(cover.path)}».`}
      </p>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={total <= 0}
            onClick={() => onChange({ type: 'frame', at: Number(Math.min(playhead, total).toFixed(2)) })}
            data-testid="reel-cover-frame"
          >
            Usar el fotograma de ahora ({fmt(Math.min(playhead, total))} s)
          </Button>
          {cover?.type === 'frame' && (
            <Button variant="ghost" size="sm" type="button" onClick={() => onSeek(cover.at)}>
              Ir a ese fotograma
            </Button>
          )}
          {cover && (
            <Button variant="ghost" size="sm" type="button" onClick={() => onChange(undefined)}>
              Quitar la portada
            </Button>
          )}
        </div>
      )}
      {unique.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted">O una de las fotos del reel</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Foto de portada">
            {unique.map((path) => {
              const selected = cover?.type === 'photo' && cover.path === path;
              const url = urlOf(path);
              return (
                <button
                  key={path}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Portada: ${labelOf(path)}`}
                  disabled={readOnly}
                  onClick={() => onChange({ type: 'photo', path })}
                  className={cn(
                    'h-16 w-9 shrink-0 overflow-hidden rounded border bg-subtle bg-cover bg-center',
                    selected ? 'border-primary ring-2 ring-primary' : 'border-border',
                  )}
                  style={url ? { backgroundImage: `url("${url}")` } : undefined}
                  data-testid="reel-cover-photo"
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
