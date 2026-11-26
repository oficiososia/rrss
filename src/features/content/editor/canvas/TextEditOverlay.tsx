import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TextLayer } from '../../document';
import { layerLabel } from '../layers';
import { textEditStyle } from './textEditStyle';

// Campo para escribir el texto de una capa directamente sobre el lienzo. Se
// coloca encima del nodo de Konva (que se oculta mientras tanto) con la misma
// caja, giro, tipografía, cuerpo, color, alineación e interlineado, escalados a
// la pantalla. Intro, Escape o un clic fuera terminan y CONSERVAN lo escrito
// (como en cualquier editor); Mayúsculas+Intro es un salto de línea. Lo escrito
// se deshace con Ctrl+Z, como cualquier otro cambio.

interface TextEditOverlayProps {
  layer: TextLayer;
  scale: number;
  /** `next`: el elemento que se lleva el foco si se termina con un clic fuera (null con el teclado). */
  onCommit: (text: string, next?: Element | null) => void;
  /** Se conserva por compatibilidad: el teclado ya no cancela. */
  onCancel?: () => void;
}

export function TextEditOverlay({ layer, scale, onCommit }: TextEditOverlayProps) {
  const [value, setValue] = useState(layer.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Salir con el teclado también provoca el blur al desmontar: que no confirme dos veces.
  const done = useRef(false);

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus();
    field.select();
  }, []);

  const finish = (next: Element | null = null) => {
    if (done.current) return;
    done.current = true;
    if (next) onCommit(value, next);
    else onCommit(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Lo que se teclea aquí es del campo, no del editor (ni deshacer del documento ni mover la capa).
    event.stopPropagation();
    if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      finish();
    }
  };

  return (
    <textarea
      ref={ref}
      value={value}
      maxLength={2000}
      aria-label={`Texto de la capa «${layerLabel(layer)}». Intro o Escape para terminar (se conserva lo escrito), Mayúsculas+Intro para otra línea.`}
      spellCheck
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={(event) => finish(event.relatedTarget instanceof Element ? event.relatedTarget : null)}
      className="outline outline-2 outline-offset-2 outline-primary"
      style={textEditStyle(layer, scale)}
      data-testid="canvas-text-editor"
    />
  );
}
