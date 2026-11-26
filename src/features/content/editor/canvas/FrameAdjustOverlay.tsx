import { Check, Minus, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_FRAME_ZOOM, type ImageLayer } from '../../document';
import { panFrame, zoomFrame } from '../frames';
import type { LayerPatch } from '../history';

// Encuadrar una foto dentro de su caja, sobre el propio lienzo: se arrastra
// para recolocarla y se amplía con la rueda, el deslizador o los botones. La
// caja no cambia: solo qué parte de la foto se ve. Se coloca encima de la capa
// (con su giro) y captura el puntero mientras dura; Intro, Escape, «Listo» o un
// clic fuera terminan. Cada cambio va al documento al momento (se ve en vivo) y
// toda la sesión es un solo paso de deshacer.

interface FrameAdjustOverlayProps {
  layer: ImageLayer;
  scale: number;
  /** Proporción (ancho / alto) de la foto tal como se dibuja; null si aún no se ha cargado. */
  imageAspect: () => number | null;
  onChange: (patch: LayerPatch) => void;
  /** `next`: lo que se ha pulsado fuera para terminar (un campo, un botón…), si lo hay. */
  onDone: (next?: Element | null) => void;
}

const ZOOM_STEP = 0.25;

export function FrameAdjustOverlay({ layer, scale, imageAspect, onChange, onDone }: FrameAdjustOverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; focus: { x: number; y: number } } | null>(null);
  const zoom = layer.zoom ?? 1;
  const box = { width: layer.width, height: layer.height };

  // Lo último que hay en el documento, también dentro de los manejadores del puntero.
  const latest = useRef({ layer, zoom });
  useLayoutEffect(() => {
    latest.current = { layer, zoom };
  });

  useLayoutEffect(() => {
    root.current?.focus();
  }, []);

  // Un clic fuera de la foto (en otra capa, en el margen, en un panel) termina.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        onDone(event.target instanceof Element ? event.target : null);
      }
    };
    window.document.addEventListener('pointerdown', onDown, true);
    return () => window.document.removeEventListener('pointerdown', onDown, true);
  }, [onDone]);

  const setZoom = (next: number) => {
    const aspect = imageAspect();
    if (!aspect) return;
    const current = latest.current;
    const result = zoomFrame(aspect, box, current.layer.focus, current.zoom, next);
    onChange({ focus: result.focus, zoom: result.zoom });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, focus: latest.current.layer.focus };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const aspect = imageAspect();
    if (!start || !aspect) return;
    // Del desplazamiento en pantalla a los ejes del marco (sin su giro) y a unidades del lienzo.
    const angle = (-layer.rotation * Math.PI) / 180;
    const sx = (event.clientX - start.x) / scale;
    const sy = (event.clientY - start.y) / scale;
    const dx = sx * Math.cos(angle) - sy * Math.sin(angle);
    const dy = sx * Math.sin(angle) + sy * Math.cos(angle);
    onChange({ focus: panFrame(aspect, box, start.focus, latest.current.zoom, { dx, dy }) });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // La rueda amplía o reduce (sin mover la página ni el lienzo).
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setZoom(latest.current.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
    // `setZoom` lee siempre lo último por la referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const button =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-fg hover:bg-subtle disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="group"
      aria-label="Encuadrar la foto: arrastra (o usa las flechas) para moverla dentro del marco y amplíala con la rueda, el deslizador o las teclas más y menos. Intro o Escape para terminar."
      className="absolute outline-none"
      style={{
        left: layer.x * scale,
        top: layer.y * scale,
        width: layer.width * scale,
        height: layer.height * scale,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
      onKeyDown={(event) => {
        // Mientras se encuadra, el teclado es de esto (ni borrar la capa ni moverla con las flechas).
        event.stopPropagation();
        // En un control (el deslizador, un botón) las teclas son suyas: solo Escape termina desde cualquier sitio.
        const onControl = event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement;
        if (event.key === 'Escape' || (event.key === 'Enter' && !onControl)) {
          event.preventDefault();
          onDone();
        } else if (onControl) {
          return;
        } else if (event.key === '+' || event.key === '=') {
          setZoom(zoom + ZOOM_STEP);
        } else if (event.key === '-') {
          setZoom(zoom - ZOOM_STEP);
        } else if (event.key.startsWith('Arrow')) {
          // Sin ratón: las flechas mueven la foto dentro del marco (con Mayúsculas, más deprisa).
          const aspect = imageAspect();
          if (!aspect) return;
          event.preventDefault();
          const step = (event.shiftKey ? 0.1 : 0.02) * Math.min(layer.width, layer.height);
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          onChange({ focus: panFrame(aspect, box, layer.focus, zoom, { dx, dy }) });
        }
      }}
      data-testid="frame-adjust"
    >
      <div
        className="absolute inset-0 cursor-move touch-none outline outline-2 outline-offset-0 outline-primary"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="frame-adjust-surface"
      />
      <div
        className="absolute bottom-2 left-1/2 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-pop"
        // Dentro del marco, abajo (así no se sale del lienzo); su giro no debe girar los controles.
        style={{ transform: `translateX(-50%) rotate(${-layer.rotation}deg)` }}
      >
        <button
          type="button"
          className={button}
          aria-label="Reducir la foto"
          title="Reducir"
          disabled={zoom <= 1}
          onClick={() => setZoom(zoom - ZOOM_STEP)}
          data-testid="frame-zoom-out"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          type="range"
          min={1}
          max={MAX_FRAME_ZOOM}
          step={0.05}
          value={zoom}
          aria-label="Ampliación de la foto dentro del marco"
          className="w-24 accent-primary sm:w-32"
          onChange={(event) => setZoom(Number(event.target.value))}
          data-testid="frame-zoom"
        />
        <button
          type="button"
          className={button}
          aria-label="Ampliar la foto"
          title="Ampliar"
          disabled={zoom >= MAX_FRAME_ZOOM}
          onClick={() => setZoom(zoom + ZOOM_STEP)}
          data-testid="frame-zoom-in"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="flex h-9 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-fg hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => onDone()}
          data-testid="frame-adjust-done"
        >
          <Check className="h-4 w-4" aria-hidden />
          Listo
        </button>
      </div>
    </div>
  );
}
