// Edición directa de los textos sobre la vista previa: cada texto que se ve en
// el instante del cabezal tiene encima una caja que se puede arrastrar (lo
// coloca), estirar por la esquina o pellizcar con dos dedos (lo cambia de
// tamaño) y tocar dos veces (lo edita ahí mismo). Al arrastrar aparecen las
// guías de centro —el texto se pega a ellas— y las zonas que tapa Instagram.
//
// Con el teclado: la caja se alcanza con el tabulador; las flechas la mueven
// (Mayús = pasos grandes), + y − cambian el tamaño e Intro abre la edición.
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { useClockValue, type PlayClock } from './clock';
import type { Selection } from './history';
import {
  AVERAGE_GLYPH_WIDTH,
  MAX_TEXT_LINES,
  REEL_TEXT_MAX_LENGTH,
  textLayout,
  textLines,
  type DraftPlan,
  type ReelText,
} from './project';

/** Lienzo de referencia de las cuentas (las proporciones son las mismas a cualquier tamaño). */
const W = 360;
const H = 640;
/** A menos de esto del centro (fracción del lienzo), el texto se pega a la guía. */
export const SNAP = 0.015;
const DOUBLE_TAP_MS = 320;
const KEY_STEP = 0.01;
const KEY_STEP_BIG = 0.05;

export interface TextOverlayProps {
  plan: DraftPlan;
  total: number;
  clock: PlayClock;
  selection: Selection;
  readOnly: boolean;
  onSelect: (selection: Selection) => void;
  /** Colocar: desplazamiento desde su sitio (fracción del ancho y del alto). */
  onTextOffset: (id: string, offset: { x: number; y: number }, key: string) => void;
  onTextSize: (id: string, sizeRatio: number, key: string) => void;
  onTextChange: (id: string, text: string, key: string) => void;
  /** Fin de un gesto: el siguiente cambio ya es otro paso de «Deshacer». */
  onGestureEnd: () => void;
  /** Se está arrastrando un texto (para enseñar las zonas seguras). */
  onDragging?: (dragging: boolean) => void;
}

/** Caja de un texto sobre el lienzo de referencia, con su desplazamiento. */
export function textBox(text: ReelText) {
  const { lines } = textLines(text.text || ' ', text.style, text.position, W, H, MAX_TEXT_LINES);
  const count = Math.max(1, lines.length);
  const layout = textLayout(text.style, text.position, count, W, H);
  const longest = Math.max(2, ...lines.map((line) => line.length));
  const pad = layout.fontSize * 0.35;
  const width = Math.min(W, longest * layout.fontSize * AVERAGE_GLYPH_WIDTH + pad * 2);
  const block = layout.lineStep * (count - 1) + layout.fontSize;
  const ox = (text.offset?.x ?? 0) * W;
  const oy = (text.offset?.y ?? 0) * H;
  return {
    left: W / 2 + ox - width / 2,
    top: layout.top + oy - pad / 2,
    width,
    height: block + pad,
    /** Centro del bloque sin el desplazamiento, como fracción del alto. */
    restCenterY: (layout.top + block / 2) / H,
  };
}

/** Pega el desplazamiento a las guías de centro. Dice a cuáles se ha pegado. */
export function snapOffset(offset: { x: number; y: number }, restCenterY: number) {
  let { x, y } = offset;
  const vertical = Math.abs(x) < SNAP;
  if (vertical) x = 0;
  const centerY = restCenterY + y;
  const horizontal = Math.abs(centerY - 0.5) < SNAP;
  if (horizontal) y = 0.5 - restCenterY;
  return { offset: { x, y }, vertical, horizontal };
}

interface Gesture {
  kind: 'move' | 'scale' | 'pinch';
  id: string;
  key: string;
  startX: number;
  startY: number;
  origin: { x: number; y: number };
  size: number;
  /** Tamaño del marco en pantalla y, para escalar, distancia de partida. */
  frame: { width: number; height: number };
  distance: number;
  restCenterY: number;
  moved: boolean;
}

let gestureSeed = 0;

export function TextOverlay(props: TextOverlayProps) {
  const { plan, clock, selection, readOnly } = props;
  const time = useClockValue(clock, 0.05);
  const frameRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const [guides, setGuides] = useState<{ vertical: boolean; horizontal: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const visible = plan.texts.filter((t) => time >= t.start - 1e-6 && time <= Math.min(t.end, props.total) + 1e-6);

  const frameSize = () => {
    const rect = frameRef.current?.getBoundingClientRect();
    return { width: rect?.width || W, height: rect?.height || H };
  };

  const begin = (event: ReactPointerEvent, text: ReelText, kind: 'move' | 'scale') => {
    if (readOnly || editing === text.id) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelect({ kind: 'text', id: text.id });
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const box = textBox(text);
    const frame = frameSize();
    const current = gesture.current;
    if (current && current.id === text.id && pointers.current.size === 2) {
      // Segundo dedo: pellizco para cambiar el tamaño.
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        ...current,
        kind: 'pinch',
        key: `text-size:${++gestureSeed}`,
        size: text.style.sizeRatio,
        distance: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
        moved: true,
      };
      return;
    }
    const rect = frameRef.current?.getBoundingClientRect();
    const centerX = (rect?.left ?? 0) + ((box.left + box.width / 2) / W) * frame.width;
    const centerY = (rect?.top ?? 0) + ((box.top + box.height / 2) / H) * frame.height;
    gesture.current = {
      kind,
      id: text.id,
      key: `${kind === 'move' ? 'text-move' : 'text-size'}:${++gestureSeed}`,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: text.offset?.x ?? 0, y: text.offset?.y ?? 0 },
      size: text.style.sizeRatio,
      frame,
      distance: Math.max(1, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
      restCenterY: box.restCenterY,
      moved: false,
    };
    if (kind === 'scale') gesture.current.startX = centerX;
    if (kind === 'scale') gesture.current.startY = centerY;
  };

  const move = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      props.onTextSize(g.id, g.size * (Math.hypot(a.x - b.x, a.y - b.y) / g.distance), g.key);
      return;
    }
    if (g.kind === 'scale') {
      const distance = Math.hypot(event.clientX - g.startX, event.clientY - g.startY);
      g.moved = true;
      props.onTextSize(g.id, g.size * (distance / g.distance), g.key);
      return;
    }
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    if (!g.moved) props.onDragging?.(true);
    g.moved = true;
    const snapped = snapOffset(
      { x: g.origin.x + dx / g.frame.width, y: g.origin.y + dy / g.frame.height },
      g.restCenterY,
    );
    setGuides({ vertical: snapped.vertical, horizontal: snapped.horizontal });
    props.onTextOffset(g.id, snapped.offset, g.key);
  };

  const end = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (!g || pointers.current.size > 0) return;
    gesture.current = null;
    setGuides(null);
    props.onDragging?.(false);
    if (g.moved) {
      props.onGestureEnd();
      lastTap.current = null;
      return;
    }
    // Dos toques seguidos sin mover: editar el texto ahí mismo.
    const now = event.timeStamp;
    if (lastTap.current && lastTap.current.id === g.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
      lastTap.current = null;
      setEditing(g.id);
    } else {
      lastTap.current = { id: g.id, at: now };
    }
  };

  const onKey = (event: KeyboardEvent, text: ReelText) => {
    if (readOnly) return;
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const offset = { x: text.offset?.x ?? 0, y: text.offset?.y ?? 0 };
    const key = `text-kbd:${text.id}`;
    if (event.key === 'ArrowLeft') props.onTextOffset(text.id, { ...offset, x: offset.x - step }, key);
    else if (event.key === 'ArrowRight') props.onTextOffset(text.id, { ...offset, x: offset.x + step }, key);
    else if (event.key === 'ArrowUp') props.onTextOffset(text.id, { ...offset, y: offset.y - step }, key);
    else if (event.key === 'ArrowDown') props.onTextOffset(text.id, { ...offset, y: offset.y + step }, key);
    else if (event.key === '+') props.onTextSize(text.id, text.style.sizeRatio + 0.005, `text-kbd-size:${text.id}`);
    else if (event.key === '-') props.onTextSize(text.id, text.style.sizeRatio - 0.005, `text-kbd-size:${text.id}`);
    else if (event.key === 'Enter' || event.key === 'F2') setEditing(text.id);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div ref={frameRef} className="absolute inset-0" data-testid="reel-text-overlay">
      {guides?.vertical && (
        <span
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary"
          aria-hidden
          data-testid="reel-guide-vertical"
        />
      )}
      {guides?.horizontal && (
        <span
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary"
          aria-hidden
          data-testid="reel-guide-horizontal"
        />
      )}
      {visible.map((text) => {
        const index = plan.texts.indexOf(text);
        const box = textBox(text);
        const selected = selection?.kind === 'text' && selection.id === text.id;
        const style = {
          left: `${(box.left / W) * 100}%`,
          top: `${(box.top / H) * 100}%`,
          width: `${(box.width / W) * 100}%`,
          height: `${(box.height / H) * 100}%`,
        };
        if (editing === text.id) {
          return (
            <textarea
              key={text.id}
              autoFocus
              value={text.text}
              maxLength={REEL_TEXT_MAX_LENGTH}
              rows={Math.max(2, text.text.split('\n').length)}
              aria-label={`Texto ${index + 1}: lo que se lee en el vídeo`}
              className="absolute z-20 w-[84%] -translate-x-1/2 resize-none rounded-lg border-2 border-primary bg-black/75 p-2 text-center text-base text-white outline-none"
              style={{ left: '50%', top: style.top }}
              onChange={(e) => props.onTextChange(text.id, e.target.value, `text:${text.id}`)}
              onBlur={() => {
                setEditing(null);
                props.onGestureEnd();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) e.currentTarget.blur();
              }}
              data-testid="reel-text-inline"
            />
          );
        }
        return (
          <div
            key={text.id}
            className={cn(
              'absolute touch-none select-none rounded-md border',
              selected ? 'border-primary bg-primary/10' : 'border-transparent hover:border-white/70',
              !readOnly && 'cursor-move',
            )}
            style={style}
          >
            <button
              type="button"
              className="absolute inset-0 h-full w-full touch-none rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={`Texto ${index + 1}: ${text.text || 'vacío'}. Flechas para colocarlo, más y menos para el tamaño, Intro para editarlo.`}
              aria-pressed={selected}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - Enter"
              onPointerDown={(e) => begin(e, text, 'move')}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onDoubleClick={() => !readOnly && setEditing(text.id)}
              onClick={() => props.onSelect({ kind: 'text', id: text.id })}
              onKeyDown={(e) => onKey(e, text)}
              onKeyUp={() => props.onGestureEnd()}
              data-testid="reel-text-box"
            />
            {selected && !readOnly && (
              <span
                role="slider"
                tabIndex={-1}
                aria-label={`Tamaño del texto ${index + 1}`}
                aria-valuemin={2}
                aria-valuemax={15}
                aria-valuenow={Math.round(text.style.sizeRatio * 1000) / 10}
                className="absolute -bottom-3 -right-3 flex h-6 w-6 cursor-nwse-resize touch-none items-center justify-center rounded-full border-2 border-white bg-primary shadow-card [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8"
                onPointerDown={(e) => begin(e, text, 'scale')}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                data-testid="reel-text-scale"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
