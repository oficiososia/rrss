// Guion de un reel hecho con «Hacer un reel como este», dentro del editor: los
// planos en su orden, con lo que hay que grabar, cuánto dura y un consejo. Los
// que ya tienen material de la biblioteca salen como hechos; los demás, como
// «Falta grabar», con un botón para elegir el recurso cuando exista.
import { Check, Clapperboard, Images } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardBody } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SHOT_KIND_LABEL } from '../../../../supabase/functions/_shared/reels/like';
import type { ReelSourceAsset } from '../api';
import { MediaPicker } from '../editor/MediaPicker';
import type { ReelProject } from '../editor/project';
import { guideStatus } from './draft';

const seconds = (value: number) => `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(value)} s`;

export interface GuidePanelProps {
  project: ReelProject;
  sources: ReelSourceAsset[];
  loading: boolean;
  error: unknown;
  readOnly: boolean;
  /** Nombre del archivo de un recurso, por su ruta. */
  labelOf: (path: string) => string;
  onFill: (shotId: string, asset: ReelSourceAsset) => void;
  /** Elige en la línea de tiempo el clip de un plano ya hecho. */
  onSelectClip: (clipId: string) => void;
}

export function GuidePanel({ project, sources, loading, error, readOnly, labelOf, onFill, onSelectClip }: GuidePanelProps) {
  const [picking, setPicking] = useState<string | null>(null);
  const status = guideStatus(project);
  if (status.length === 0) return null;
  const gaps = status.filter((entry) => !entry.filled).length;
  const used = new Set(project.plan.clips.map((clip) => clip.path));
  const target = status.find((entry) => entry.shot.id === picking)?.shot;

  return (
    <Card>
      <CardBody className="space-y-3" data-testid="reel-guide">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">Guion: qué grabar</h2>
          <p className="text-xs text-muted" data-testid="reel-guide-summary">
            {gaps === 0
              ? 'Todos los planos tienen material.'
              : `${gaps === 1 ? 'Falta 1 plano' : `Faltan ${gaps} planos`} por grabar de ${status.length}.`}
          </p>
        </div>
        <ol className="space-y-2">
          {status.map(({ shot, filled }, index) => {
            const clip = filled ? project.plan.clips.find((c) => c.id === shot.clipId) : undefined;
            return (
              <li
                key={shot.id}
                className={cn(
                  'rounded-lg border p-3 text-sm',
                  filled ? 'border-border' : 'border-dashed border-warning bg-warning-soft/40',
                )}
                data-testid={`reel-guide-shot-${shot.id}`}
                data-filled={filled ? 'true' : 'false'}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Plano {index + 1}</span>
                  <Badge tone="neutral">{SHOT_KIND_LABEL[shot.kind]}</Badge>
                  <span className="text-xs text-muted">
                    {seconds(shot.seconds)} · {shot.media === 'foto' ? 'foto' : 'vídeo'}
                  </span>
                  {filled ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-success">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                      Hecho
                    </span>
                  ) : (
                    <span className="ml-auto text-xs font-medium text-warning">Falta grabar</span>
                  )}
                </div>
                <p className="mt-1.5 break-words">{filled ? shot.label : `Falta grabar: ${shot.label}`}</p>
                {shot.tip && <p className="mt-1 break-words text-xs text-muted">Consejo: {shot.tip}</p>}
                {clip ? (
                  <button
                    type="button"
                    className="mt-2 inline-flex min-h-9 max-w-full items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    onClick={() => onSelectClip(clip.id)}
                  >
                    <Clapperboard className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{labelOf(clip.path)}</span>
                  </button>
                ) : (
                  !readOnly && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => setPicking(shot.id)}
                      data-testid={`reel-guide-fill-${shot.id}`}
                    >
                      <Images className="h-4 w-4" aria-hidden />
                      Elegir de la biblioteca
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ol>
      </CardBody>
      {picking && target && (
        <MediaPicker
          open
          onOpenChange={(open) => !open && setPicking(null)}
          sources={sources.filter((a) => (a.kind === 'image' || a.kind === 'video') && !used.has(a.storage_path))}
          loading={loading}
          error={error}
          room={1}
          title={`Plano ${status.findIndex((entry) => entry.shot.id === picking) + 1}: ${target.label}`}
          description={`Elige ${target.media === 'foto' ? 'la foto' : 'el clip'} de este plano. Entrará en su sitio, con su duración (${seconds(target.seconds)}).`}
          confirmLabel={() => 'Usar en este plano'}
          onConfirm={(assets) => {
            const asset = assets[0];
            if (asset) onFill(picking, asset);
            setPicking(null);
          }}
        />
      )}
    </Card>
  );
}
