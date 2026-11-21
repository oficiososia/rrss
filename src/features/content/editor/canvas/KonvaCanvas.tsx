import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fitScale } from '../geometry';
import { describeDocument } from './nodes';
import { Scene } from './scene';
import { TextEditOverlay } from './TextEditOverlay';
import type { CanvasViewProps } from './types';

/** Zoom máximo sobre el tamaño «ajustado», y el paso de los botones. */
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(1, Math.round(value * 100) / 100));

// Envoltorio de React del lienzo de Konva (sin react-konva). Crea la escena una
// vez, le pasa el documento en cada cambio y mide el hueco disponible para
// escalar el lienzo. Se carga aparte (import perezoso) con Konva dentro.

export default function KonvaCanvas({
  document,
  selectedIds,
  readOnly,
  images,
  onSelect,
  onSelectMany,
  onChange,
  onEditText,
  editingTextId,
  onTextCommit,
  onTextCancel,
  safeZone,
  label,
}: CanvasViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const callbacks = useRef({ onSelect, onSelectMany, onChange, onEditText });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  /** 1 = «ajustar»: el lienzo entero a la vista. Más: se acerca y se desplaza dentro del marco. */
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);

  useLayoutEffect(() => {
    callbacks.current = { onSelect, onSelectMany, onChange, onEditText };
    zoomRef.current = zoom;
  });

  useEffect(() => {
    if (!stageRef.current) return;
    const scene = new Scene(stageRef.current, {
      onSelect: (id, options) => callbacks.current.onSelect(id, options),
      onSelectMany: (ids, additive) => callbacks.current.onSelectMany(ids, additive),
      onChange: (changes) => callbacks.current.onChange(changes),
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

  // Ctrl + rueda y pellizco con dos dedos acercan o alejan.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => clampZoom(z * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
    };
    let startDistance = 0;
    let startZoom = 1;
    const distance = (e: TouchEvent) =>
      Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDistance = distance(e);
        startZoom = zoomRef.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDistance === 0) return;
      e.preventDefault();
      setZoom(clampZoom((startZoom * distance(e)) / startDistance));
    };
    const onTouchEnd = () => {
      startDistance = 0;
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    frame.addEventListener('touchstart', onTouchStart, { passive: true });
    frame.addEventListener('touchmove', onTouchMove, { passive: false });
    frame.addEventListener('touchend', onTouchEnd);
    return () => {
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('touchstart', onTouchStart);
      frame.removeEventListener('touchmove', onTouchMove);
      frame.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const nodes = useMemo(() => describeDocument(document, images, readOnly), [document, images, readOnly]);
  const fit = fitScale(document.canvas, available);
  // «Ajustar» nunca agranda por encima de 1; al acercar, sí se puede pasar de ahí.
  const scale = zoom === 1 ? fit : Math.min(2, fit * zoom);
  const zoomed = zoom > 1;
  const editing = document.layers.find((layer) => layer.id === editingTextId);

  useEffect(() => {
    sceneRef.current?.render({
      nodes,
      canvas: document.canvas,
      selectedIds,
      editingId: editingTextId,
      safeZone,
      readOnly,
      scale,
    });
  }, [nodes, document.canvas, selectedIds, editingTextId, safeZone, readOnly, scale]);

  const percent = Math.round(scale * 100);
  const zoomButton =
    'flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="editor-canvas-area">
      <div
        ref={frameRef}
        className="relative flex min-h-0 flex-1 overflow-auto"
        // El margen alrededor del documento también quita la selección.
        onPointerDown={(event) => event.target === event.currentTarget && callbacks.current.onSelect(null)}
      >
        <div className="relative m-auto shrink-0 shadow-pop ring-1 ring-border">
          <div ref={stageRef} role="img" aria-label={label} data-testid="editor-stage" />
          {editing?.type === 'text' && !readOnly && (
            <TextEditOverlay
              key={editing.id}
              layer={editing}
              scale={scale}
              onCommit={(text) => onTextCommit(editing.id, text)}
              onCancel={onTextCancel}
            />
          )}
        </div>
      </div>
      <div
        className="flex shrink-0 items-center justify-center gap-1 pt-1"
        role="group"
        aria-label="Zoom del lienzo"
        data-testid="zoom-controls"
      >
        <button
          type="button"
          className={zoomButton}
          aria-label="Alejar"
          title="Alejar"
          disabled={!zoomed}
          onClick={() => setZoom(clampZoom(zoom / ZOOM_STEP))}
          data-testid="zoom-out"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="flex h-8 min-w-[4.5rem] items-center justify-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-surface hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={zoomed ? 'Ajustar el lienzo a la ventana' : 'El lienzo se ve entero'}
          title="Ajustar el lienzo a la ventana"
          onClick={() => setZoom(1)}
          data-testid="zoom-fit"
        >
          <Maximize className="h-3.5 w-3.5" aria-hidden />
          <span data-testid="zoom-value">{percent} %</span>
        </button>
        <button
          type="button"
          className={zoomButton}
          aria-label="Acercar"
          title="Acercar"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom(clampZoom(zoom * ZOOM_STEP))}
          data-testid="zoom-in"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
