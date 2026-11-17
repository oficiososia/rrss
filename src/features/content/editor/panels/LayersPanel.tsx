import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import type { Dispatch } from 'react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Layer } from '../../document';
import type { EditorAction } from '../history';
import { LAYER_TYPE_LABEL, layerLabel } from '../layers';

interface LayersPanelProps {
  layers: Layer[];
  selectedId: string | null;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
}

/**
 * Lista HTML paralela al lienzo: un lienzo no es accesible por sí mismo, así
 * que aquí se selecciona, se oculta, se bloquea y se ordena cada capa con
 * teclado y lector de pantalla. Va de la capa del frente a la del fondo.
 */
export function LayersPanel({ layers, selectedId, readOnly, dispatch }: LayersPanelProps) {
  if (layers.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">El lienzo está vacío. Añade una capa para empezar.</p>;
  }
  const ordered = [...layers].reverse();
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted" id="layers-help">
        De delante a atrás. Con una capa elegida: flechas para moverla (con Mayúsculas, de 10 en 10), Supr para borrarla
        y Esc para soltarla.
      </p>
      <ul className="space-y-1" aria-describedby="layers-help" data-testid="layers-list">
        {ordered.map((layer, index) => {
          const label = layerLabel(layer);
          const selected = layer.id === selectedId;
          return (
            <li
              key={layer.id}
              className={cn(
                'flex items-center gap-1 rounded-lg border px-1 py-1',
                selected ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-subtle',
              )}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => dispatch({ type: 'select', id: selected ? null : layer.id })}
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm"
                data-testid="layer-item"
              >
                <span className={cn('block truncate font-medium', !layer.visible && 'text-muted line-through')}>
                  {label}
                </span>
                <span className="block text-xs text-muted">{LAYER_TYPE_LABEL[layer.type]}</span>
              </button>
              {!readOnly && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={layer.visible ? `Ocultar ${label}` : `Mostrar ${label}`}
                    onClick={() => dispatch({ type: 'update', id: layer.id, patch: { visible: !layer.visible } })}
                  >
                    {layer.visible ? (
                      <Eye className="h-4 w-4" aria-hidden />
                    ) : (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={layer.locked ? `Desbloquear ${label}` : `Bloquear ${label}`}
                    onClick={() => dispatch({ type: 'update', id: layer.id, patch: { locked: !layer.locked } })}
                  >
                    {layer.locked ? (
                      <Lock className="h-4 w-4" aria-hidden />
                    ) : (
                      <LockOpen className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Traer ${label} hacia delante`}
                    disabled={index === 0}
                    onClick={() => dispatch({ type: 'reorder', id: layer.id, to: 'forward' })}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Llevar ${label} hacia atrás`}
                    disabled={index === ordered.length - 1}
                    onClick={() => dispatch({ type: 'reorder', id: layer.id, to: 'backward' })}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
