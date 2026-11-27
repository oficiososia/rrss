import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { hasAssetDrag, hasFileDrag, imageFilesOf, readAssetDrag } from '../assetDrag';
import { frameAt } from '../frames';
import { fitScale } from '../geometry';
import { bleedFor, veilColor } from './bleed';
import { boundsOf, placeToolbar, TEXT_WEIGHT, type ToolbarObstacle } from '../toolbarPlacement';
import { loadAppFont } from './appFont';
import { FrameAdjustOverlay } from './FrameAdjustOverlay';
import { describeDocument } from './nodes';
import { cn } from '@/lib/utils';
import { Scene } from './scene';
import { TextEditOverlay } from './TextEditOverlay';
import type { CanvasViewProps } from './types';

/** Zoom máximo sobre el tamaño «ajustado», y el paso de los botones. */
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(1, Math.round(value * 100) / 100));

/** ¿Viene la tecla de un control (un botón, un campo)? Ahí el Espacio es suyo. */
const fromControl = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest('button, a, input, textarea, select, summary, [role="menuitem"], [contenteditable="true"]'));

// Envoltorio de React del lienzo de Konva (sin react-konva). Crea la escena una
// vez, le pasa el documento en cada cambio y mide el hueco disponible para
// escalar el lienzo. Se carga aparte (import perezoso) con Konva dentro.
//
// Además de dibujar, aquí vive lo que flota sobre el lienzo y depende de dónde
// está cada cosa en pantalla: el campo para escribir un texto, el encuadre de
// una foto dentro de su marco, la barra de acciones del elemento elegido (que
// se coloca sin taparlo ni salirse), el zoom con la rueda, la mano con Espacio
// y soltar fotos encima.

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
  safeZone,
  label,
  onFrameClick,
  onEditImage,
  framingId = null,
  onFrameChange,
  onFramingEnd,
  toolbar,
  onContextMenu,
  onDrop,
  footerStart,
  footerEnd,
}: CanvasViewProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const callbacks = useRef({ onSelect, onSelectMany, onChange, onEditText, onFrameClick, onEditImage, onContextMenu });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  /** 1 = «ajustar»: el lienzo entero a la vista. Más: se acerca y se desplaza dentro del marco. */
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  /** Punto que debe quedarse bajo el cursor al cambiar el zoom con la rueda. */
  const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  /** Se está arrastrando, girando o cambiando de tamaño: la barra flotante se esconde. */
  const [gesturing, setGesturing] = useState(false);
  /** Espacio pulsado: el puntero mueve la vista en vez de las capas. */
  const [hand, setHand] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  /** La letra de la aplicación (reserva de los textos) ya está lista: hasta entonces no se dibujan textos. */
  const [appFontReady, setAppFontReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadAppFont().then(() => alive && setAppFontReady(true));
    return () => {
      alive = false;
    };
  }, []);
  const [dropping, setDropping] = useState(false);

  useLayoutEffect(() => {
    callbacks.current = { onSelect, onSelectMany, onChange, onEditText, onFrameClick, onEditImage, onContextMenu };
    zoomRef.current = zoom;
  });

  useEffect(() => {
    if (!stageRef.current) return;
    const scene = new Scene(stageRef.current, {
      onSelect: (id, options) => callbacks.current.onSelect(id, options),
      onSelectMany: (ids, additive) => callbacks.current.onSelectMany(ids, additive),
      onChange: (changes) => callbacks.current.onChange(changes),
      onEditText: (id) => callbacks.current.onEditText(id),
      onFrameClick: (id) => callbacks.current.onFrameClick?.(id),
      onEditImage: (id) => callbacks.current.onEditImage?.(id),
      onContextMenu: (target) => callbacks.current.onContextMenu?.(target),
      onGesture: setGesturing,
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
  const fit = fitScale(document.canvas, available);
  // «Ajustar» nunca agranda por encima de 1; al acercar, sí se puede pasar de ahí.
  const scale = zoom === 1 ? fit : Math.min(2, fit * zoom);
  const zoomed = zoom > 1;
  // Lo que sobresale del lienzo se ve (velado) en el hueco libre de alrededor, como en Canva.
  const bleed = bleedFor(document.canvas, scale, available);
  const scaleRef = useRef(scale);
  useLayoutEffect(() => {
    scaleRef.current = scale;
  });

  // La rueda del ratón acerca o aleja hacia donde está el cursor (con Ctrl o sin él), y el pellizco con
  // dos dedos también. El desplazamiento de un panel táctil (deltas pequeños o en horizontal) mueve la vista.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      const wheel = event.deltaX === 0 && Math.abs(event.deltaY) >= 40;
      if (!event.ctrlKey && !event.metaKey && !wheel) return;
      event.preventDefault();
      const stage = wrapperRef.current?.getBoundingClientRect();
      if (stage) {
        zoomAnchor.current = {
          x: (event.clientX - stage.left) / scaleRef.current,
          y: (event.clientY - stage.top) / scaleRef.current,
          clientX: event.clientX,
          clientY: event.clientY,
        };
      }
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

  // Tras cambiar el zoom con la rueda, el punto que estaba bajo el cursor sigue bajo el cursor.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const frame = frameRef.current;
    const wrapper = wrapperRef.current;
    zoomAnchor.current = null;
    if (!anchor || !frame || !wrapper) return;
    const box = frame.getBoundingClientRect();
    frame.scrollLeft = wrapper.offsetLeft + anchor.x * scale - (anchor.clientX - box.left);
    frame.scrollTop = wrapper.offsetTop + anchor.y * scale - (anchor.clientY - box.top);
  }, [scale]);

  // Mano: con Espacio pulsado (y el foco fuera de un control), arrastrar mueve la vista.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || fromControl(event.target)) return;
      const area = areaRef.current;
      if (
        !area ||
        !(event.target === window.document.body || area.closest('section')?.contains(event.target as Node))
      ) {
        return;
      }
      event.preventDefault();
      setHand(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === ' ') setHand(false);
    };
    const blur = () => setHand(false);
    window.document.addEventListener('keydown', down);
    window.document.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.document.removeEventListener('keydown', down);
      window.document.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const handDrag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const editing = document.layers.find((layer) => layer.id === editingTextId);
  const framing = document.layers.find((layer) => layer.id === framingId);
  const framingLayer = framing?.type === 'image' && !readOnly ? framing : null;

  useEffect(() => {
    if (!appFontReady) return;
    sceneRef.current?.render({
      nodes,
      canvas: document.canvas,
      // Mientras se encuadra una foto no hay tiradores: el puntero mueve la foto, no la capa.
      selectedIds: framingLayer ? [] : selectedIds,
      editingId: editingTextId,
      safeZone,
      readOnly,
      scale,
      dropTargetId,
      bleed,
      veil: veilColor(frameRef.current),
    });
  }, [
    nodes,
    document.canvas,
    selectedIds,
    editingTextId,
    safeZone,
    readOnly,
    scale,
    dropTargetId,
    framingLayer,
    appFontReady,
    // `bleed` se compara por sus números: un objeto nuevo en cada pintado no debe volver a dibujar.
    bleed.x,
    bleed.y,
  ]);

  // ── Barra de acciones del elemento elegido ──
  const showBar = Boolean(toolbar) && !gesturing && !editing && !framingLayer && !hand && selectedIds.length > 0;
  const selectionBounds = useMemo(() => {
    const ids = new Set(selectedIds);
    return boundsOf(document.layers.filter((layer) => ids.has(layer.id) && layer.visible));
  }, [document.layers, selectedIds]);
  // Los textos que no están elegidos: la barra busca sitio sin taparlos (el titular de una plantilla…).
  const textBounds = useMemo(() => {
    const ids = new Set(selectedIds);
    return document.layers
      .filter((layer) => layer.type === 'text' && layer.visible && !ids.has(layer.id))
      .map((layer) => boundsOf([layer])!);
  }, [document.layers, selectedIds]);

  const positionBar = () => {
    const bar = barRef.current;
    const area = areaRef.current;
    const wrapper = wrapperRef.current;
    if (!bar || !area || !wrapper || !selectionBounds) return;
    const areaBox = area.getBoundingClientRect();
    const stageBox = wrapper.getBoundingClientRect();
    const dx = stageBox.left - areaBox.left;
    const dy = stageBox.top - areaBox.top;
    // Lo que se ve del elemento (si el lienzo está ampliado, puede salirse del área).
    const target = {
      left: Math.max(0, dx + selectionBounds.left * scale),
      top: Math.max(0, dy + selectionBounds.top * scale),
      right: Math.min(areaBox.width, dx + selectionBounds.right * scale),
      bottom: Math.min(areaBox.height, dy + selectionBounds.bottom * scale),
    };
    const obstacles: ToolbarObstacle[] = textBounds.map((box) => ({
      left: dx + box.left * scale,
      top: dy + box.top * scale,
      right: dx + box.right * scale,
      bottom: dy + box.bottom * scale,
      weight: TEXT_WEIGHT,
    }));
    const place = placeToolbar(
      target,
      { width: bar.offsetWidth, height: bar.offsetHeight },
      { width: areaBox.width, height: areaBox.height },
      obstacles,
    );
    bar.style.left = `${place.left}px`;
    bar.style.top = `${place.top}px`;
    bar.style.visibility = 'visible';
    bar.dataset.side = place.side;
  };
  // Tras cada pintado: la barra cambia de contenido (y de ancho) con lo elegido.
  useLayoutEffect(() => {
    if (showBar) positionBar();
  });
  useEffect(() => {
    if (!showBar) return;
    const frame = frameRef.current;
    const bar = barRef.current;
    if (!frame || !bar) return;
    const again = () => positionBar();
    frame.addEventListener('scroll', again, { passive: true });
    const observer = new ResizeObserver(again);
    observer.observe(bar);
    observer.observe(frame);
    return () => {
      frame.removeEventListener('scroll', again);
      observer.disconnect();
    };
    // `positionBar` lee las medidas del momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBar, selectionBounds, textBounds, scale]);

  // ── Soltar una foto de la biblioteca o archivos del dispositivo ──
  const accepts = (event: DragEvent) =>
    Boolean(onDrop) && !readOnly && (hasAssetDrag(event.dataTransfer) || hasFileDrag(event.dataTransfer));
  const pointOf = (event: { clientX: number; clientY: number }) => {
    const stage = wrapperRef.current?.getBoundingClientRect();
    if (!stage) return null;
    const x = (event.clientX - stage.left) / scale;
    const y = (event.clientY - stage.top) / scale;
    return x >= 0 && y >= 0 && x <= document.canvas.width && y <= document.canvas.height ? { x, y } : null;
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const at = pointOf(event);
    const frame = at ? frameAt(document.layers, at) : null;
    setDropping(true);
    setDropTargetId(frame?.id ?? null);
  };
  const endDrag = () => {
    setDropping(false);
    setDropTargetId(null);
  };
  const onDropHere = (event: DragEvent<HTMLDivElement>) => {
    if (!accepts(event)) return;
    event.preventDefault();
    const at = pointOf(event);
    const frame = at ? frameAt(document.layers, at) : null;
    const dropped = Array.from(event.dataTransfer.files ?? []);
    const files = imageFilesOf(dropped);
    endDrag();
    onDrop?.({
      asset: readAssetDrag(event.dataTransfer),
      files,
      rejected: dropped.length - files.length,
      at,
      frameId: frame?.id ?? null,
    });
  };

  const percent = Math.round(scale * 100);
  const zoomButton =
    'flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
  return (
    <div className="absolute inset-0 flex flex-col" data-testid="editor-canvas-area">
      <div ref={areaRef} className="relative min-h-0 flex-1">
        <div
          ref={frameRef}
          // En pantallas anchas queda una franja libre encima del documento: ahí va la barra de lo elegido
          // cuando el elemento llega arriba del todo (una foto a sangre), sin tapar nada.
          className="absolute inset-x-0 bottom-0 top-0 flex overflow-auto lg:top-14"
          // El margen alrededor del documento también quita la selección.
          onPointerDown={(event) => event.target === event.currentTarget && callbacks.current.onSelect(null)}
          onDragOver={onDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) endDrag();
          }}
          onDrop={onDropHere}
          data-testid="editor-canvas-frame"
          data-dropping={dropping || undefined}
        >
          {/* El marco del lienzo (lo que se exporta) mide justo el documento; el escenario de Konva se sale por
              los lados lo que mida el margen, para enseñar y poder agarrar lo que sobresale. */}
          <div
            ref={wrapperRef}
            className="relative m-auto shrink-0 shadow-pop ring-1 ring-border"
            style={{
              width: Math.round(document.canvas.width * scale),
              height: Math.round(document.canvas.height * scale),
            }}
            role="img"
            aria-label={label}
            data-testid="editor-stage"
            // Listo para tocar: medido y con la letra cargada (las pruebas de navegador esperan a esto).
            data-ready={appFontReady && available.width > 0 ? 'true' : undefined}
          >
            <div
              ref={stageRef}
              className="absolute"
              style={{ left: -bleed.x, top: -bleed.y }}
              data-testid="editor-konva"
            />
            {editing?.type === 'text' && !readOnly && (
              <TextEditOverlay
                key={editing.id}
                layer={editing}
                scale={scale}
                onCommit={(text, next) => onTextCommit(editing.id, text, next)}
              />
            )}
            {framingLayer && (
              <FrameAdjustOverlay
                key={framingLayer.id}
                layer={framingLayer}
                scale={scale}
                imageAspect={() => sceneRef.current?.imageAspect(framingLayer.id) ?? null}
                onChange={(patch) => onFrameChange?.(framingLayer.id, patch)}
                onDone={(next) => onFramingEnd?.(next)}
              />
            )}
          </div>
        </div>
        {hand && (
          // Mano: una capa transparente recibe el puntero para que las capas del diseño no se muevan.
          <div
            className="absolute inset-0 z-10 cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={(event) => {
              const frame = frameRef.current;
              if (!frame) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              handDrag.current = { x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
            }}
            onPointerMove={(event) => {
              const start = handDrag.current;
              const frame = frameRef.current;
              if (!start || !frame) return;
              frame.scrollLeft = start.left - (event.clientX - start.x);
              frame.scrollTop = start.top - (event.clientY - start.y);
            }}
            onPointerUp={() => {
              handDrag.current = null;
            }}
            data-testid="canvas-hand"
          />
        )}
        {dropping && dropTargetId === null && (
          <p
            className="pointer-events-none absolute inset-x-0 bottom-2 z-10 mx-auto w-fit rounded-full bg-fg px-3 py-1 text-xs font-medium text-surface shadow-pop"
            role="status"
          >
            Suelta la foto para añadirla al diseño
          </p>
        )}
        {showBar && (
          <div
            ref={barRef}
            className="absolute z-20 max-w-[calc(100%-8px)]"
            style={{ left: 4, top: 4, visibility: 'hidden' }}
            data-testid="selection-toolbar-anchor"
          >
            {toolbar}
          </div>
        )}
      </div>
      {/* Fila de abajo: lo que pone el editor a los lados (capas, zonas seguras, copiloto) y el zoom en medio.
          En pantallas estrechas el zoom va con dos dedos: solo sale «ajustar» si se ha acercado. */}
      <div className="flex shrink-0 items-center gap-1 pt-1" data-testid="canvas-footer">
        <div className="flex min-w-0 flex-1 items-center gap-1">{footerStart}</div>
        <div
          className="flex shrink-0 items-center justify-center gap-1"
          role="group"
          aria-label="Zoom del lienzo"
          data-testid="zoom-controls"
        >
          <button
            type="button"
            className={cn(zoomButton, 'max-lg:hidden')}
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
            className={cn(
              'flex h-8 min-w-[4.5rem] items-center justify-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-surface hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
              !zoomed && 'max-lg:hidden',
            )}
            aria-label={zoomed ? 'Ajustar el lienzo a la ventana' : 'El lienzo se ve entero'}
            title="Ajustar el lienzo a la ventana. La rueda del ratón acerca y aleja; con Espacio pulsado, arrastrar mueve la vista."
            onClick={() => setZoom(1)}
            data-testid="zoom-fit"
          >
            <Maximize className="h-3.5 w-3.5" aria-hidden />
            <span data-testid="zoom-value">{percent} %</span>
          </button>
          <button
            type="button"
            className={cn(zoomButton, 'max-lg:hidden')}
            aria-label="Acercar"
            title="Acercar"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom(clampZoom(zoom * ZOOM_STEP))}
            data-testid="zoom-in"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">{footerEnd}</div>
      </div>
    </div>
  );
}
