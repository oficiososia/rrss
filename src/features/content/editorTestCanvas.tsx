import { useLayoutEffect } from 'react';
import { TextEditOverlay } from './editor/canvas/TextEditOverlay';
import type { CanvasViewProps } from './editor/canvas/types';
import { rememberCanvasProps } from './editorTestKit';

/**
 * Doble del lienzo de Konva para las pruebas de componentes (ver editorTestKit.ts):
 * cada capa es un botón (clic = elegir; en un marco vacío, además, pedir su foto;
 * doble clic = escribir o encuadrar), enseña la barra flotante tal cual y, con un
 * texto en edición, el campo de verdad.
 */
export function CanvasStub(props: CanvasViewProps) {
  // Tras cada pintado (dentro del `act` de la prueba), lo último queda a mano en `canvas()`.
  useLayoutEffect(() => rememberCanvasProps(props));
  const editing = props.document.layers.find((layer) => layer.id === props.editingTextId);
  return (
    <div
      data-testid="canvas-stub"
      data-selected={props.selectedIds.join(',')}
      data-editing={props.editingTextId ?? ''}
      data-framing={props.framingId ?? ''}
      data-layers={props.document.layers.length}
    >
      {props.document.layers.map((layer) => (
        <button
          key={layer.id}
          type="button"
          data-testid={`stub-${layer.id}`}
          data-type={layer.type}
          data-source={layer.type === 'image' ? layer.source.kind : ''}
          data-x={layer.x}
          data-y={layer.y}
          onClick={(event) => {
            props.onSelect(layer.id, { toggle: event.shiftKey });
            // Como el lienzo de verdad: un clic en un marco vacío pide su foto.
            if (layer.type === 'image' && layer.source.kind === 'empty' && !event.shiftKey)
              props.onFrameClick?.(layer.id);
          }}
          onDoubleClick={() => (layer.type === 'text' ? props.onEditText(layer.id) : props.onEditImage?.(layer.id))}
        >
          {layer.type === 'text' ? layer.text : layer.id}
        </button>
      ))}
      {/* La barra flotante del elemento elegido, tal cual (el lienzo de verdad solo la coloca). */}
      <div data-testid="stub-toolbar">{props.toolbar}</div>
      {/* La fila del zoom: lo que el editor pone a sus lados (capas, zonas seguras, copiloto). */}
      <div data-testid="stub-footer">
        {props.footerStart}
        {props.footerEnd}
      </div>
      {editing?.type === 'text' && (
        <TextEditOverlay
          layer={editing}
          scale={1}
          onCommit={(text, next) => props.onTextCommit(editing.id, text, next)}
        />
      )}
    </div>
  );
}
