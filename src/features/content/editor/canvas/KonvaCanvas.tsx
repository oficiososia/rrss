import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fitScale } from '../geometry';
import { describeDocument } from './nodes';
import { Scene } from './scene';
import type { CanvasViewProps } from './types';

// Envoltorio de React del lienzo de Konva (sin react-konva). Crea la escena una
// vez, le pasa el documento en cada cambio y mide el hueco disponible para
// escalar el lienzo. Se carga aparte (import perezoso) con Konva dentro.

export default function KonvaCanvas({
  document,
  selectedId,
  readOnly,
  images,
  onSelect,
  onChange,
  onEditText,
  label,
}: CanvasViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const callbacks = useRef({ onSelect, onChange, onEditText });
  const [available, setAvailable] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    callbacks.current = { onSelect, onChange, onEditText };
  });

  useEffect(() => {
    if (!stageRef.current) return;
    const scene = new Scene(stageRef.current, {
      onSelect: (id) => callbacks.current.onSelect(id),
      onChange: (id, patch) => callbacks.current.onChange(id, patch),
      onEditText: (id) => callbacks.current.onEditText(id),
    });
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setAvailable({ width: frame.clientWidth, height: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const nodes = useMemo(() => describeDocument(document, images, readOnly), [document, images, readOnly]);
  const scale = fitScale(document.canvas, available);

  useEffect(() => {
    sceneRef.current?.render({ nodes, canvas: document.canvas, selectedId, readOnly, scale });
  }, [nodes, document.canvas, selectedId, readOnly, scale]);

  return (
    <div ref={frameRef} className="flex h-full w-full items-center justify-center overflow-hidden">
      <div
        ref={stageRef}
        role="img"
        aria-label={label}
        className="shadow-pop ring-1 ring-border"
        data-testid="editor-stage"
      />
    </div>
  );
}
