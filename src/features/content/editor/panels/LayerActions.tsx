import { ArrowDown, ArrowUp, BringToFront, Copy, SendToBack, Trash2, type LucideIcon } from 'lucide-react';
import type { Dispatch } from 'react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Layer } from '../../document';
import { ALIGN_LABEL } from '../arrange';
import type { EditorAction, ReorderTarget } from '../history';
import { layerLabel, LAYER_TYPE_LABEL } from '../layers';
import { ALIGN_ICONS } from './alignIcons';

const ORDER: { to: ReorderTarget; label: string; Icon: LucideIcon }[] = [
  { to: 'front', label: 'Traer al frente', Icon: BringToFront },
  { to: 'forward', label: 'Subir un nivel', Icon: ArrowUp },
  { to: 'backward', label: 'Bajar un nivel', Icon: ArrowDown },
  { to: 'back', label: 'Llevar al fondo', Icon: SendToBack },
];

const ICON_BUTTON = 'h-9 w-9 max-lg:h-10 max-lg:w-10';

/**
 * Cabecera fija del panel «Diseño» con una capa elegida: qué es y una barra de
 * iconos con lo que más se hace (duplicar, borrar, orden y alineación). Cada
 * icono lleva su nombre para el lector de pantalla y como ayuda al pasar el ratón.
 */
export function LayerActions({
  layer,
  readOnly,
  dispatch,
}: {
  layer: Layer;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
}) {
  const id = layer.id;
  const label = layerLabel(layer);
  const arrangeLocked = layer.locked;
  return (
    <div className="sticky top-0 z-10 space-y-2 bg-surface pb-2" data-testid="layer-actions">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{label}</h3>
        <p className="text-xs text-muted">{LAYER_TYPE_LABEL[layer.type]}</p>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-x-3 gap-y-1" role="toolbar" aria-label={`Acciones de ${label}`}>
          <div className="flex gap-1" role="group" aria-label="Copiar y borrar">
            <Button
              variant="secondary"
              size="icon"
              className={ICON_BUTTON}
              aria-label="Duplicar"
              title="Duplicar"
              onClick={() => dispatch({ type: 'duplicate', id })}
              data-testid="layer-duplicate"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className={cn(ICON_BUTTON, 'text-danger')}
              aria-label="Borrar"
              title="Borrar"
              onClick={() => dispatch({ type: 'remove', id })}
              data-testid="layer-delete"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <div className="flex gap-1" role="group" aria-label="Orden">
            {ORDER.map(({ to, label: text, Icon }) => (
              <Button
                key={to}
                variant="secondary"
                size="icon"
                className={ICON_BUTTON}
                aria-label={text}
                title={text}
                onClick={() => dispatch({ type: 'reorder', id, to })}
                data-testid={`layer-order-${to}`}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </Button>
            ))}
          </div>
          {!arrangeLocked && (
            <div className="flex gap-1" role="group" aria-label="Alinear con el lienzo" data-testid="arrange-controls">
              {ALIGN_ICONS.map(([to, Icon]) => (
                <Button
                  key={to}
                  variant="secondary"
                  size="icon"
                  className={ICON_BUTTON}
                  aria-label={`${ALIGN_LABEL[to]} del lienzo`}
                  title={`${ALIGN_LABEL[to]} del lienzo`}
                  onClick={() => dispatch({ type: 'align', to })}
                  data-testid={`align-${to}`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
