// Línea de tiempo del editor de reels, organizada como la de los editores de
// móvil (docs/editor-reels.md §10):
//
//  * El cabezal está FIJO en el centro y es la pista la que se desliza debajo:
//    desplazar la línea (con el dedo y su inercia, la rueda, el panel táctil o
//    arrastrando con el ratón) es mover el cabezal.
//  * La pista principal enseña cada clip con sus fotogramas (tira de miniaturas)
//    y cada foto con su miniatura; debajo, apiladas, las pistas de textos (en
//    varias filas si se solapan), subtítulos y música (con su forma de onda y
//    los golpes del ritmo).
//  * Tocar un elemento lo elige (las herramientas salen en la barra de abajo);
//    tocar fuera lo suelta. Las asas de recorte solo salen en lo elegido.
//  * Entre dos clips hay un botón pequeño: la transición de ese corte.
//  * Zoom con pellizco, con Ctrl + rueda y con los botones de la pantalla.
//
// Se maneja con ratón, dedo (eventos de puntero) y teclado (Alt + flechas mueve
// el clip elegido; las asas son controles con flechas ±0,1 s y Mayús ±1 s).
import { Film, Image as ImageIcon, Music2, Plus, Type, VolumeX } from 'lucide-react';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import type { PlayClock } from './clock';
import { musicGain } from './compose';
import type { Selection } from './history';
import { timelineSubtitles, type Clip, type DraftPlan, type Music, type PlanTimeline, type ReelText } from './project';
import { cachedFrame, FRAME_HEIGHT, FRAME_WIDTH, requestFrame, stripTimes } from './thumbs';
import { peakAt, useWaveform } from './waveform';

/** Píxeles por segundo: límites del zoom y valor de partida. */
export const ZOOM = { min: 12, max: 320, initial: 60 } as const;
export const clampZoom = (pps: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, pps));
/** Un paso de los botones de zoom. */
export const ZOOM_STEP = 1.5;
/** Filas de la pista de textos como mucho (a partir de ahí se montan). */
const MAX_TEXT_ROWS = 3;
const TEXT_ROW_PX = 26;
/** Ancho máximo de un lienzo de la línea (los navegadores limitan su tamaño). */
const MAX_CANVAS_PX = 4096;

export interface TimelineProps {
  plan: DraftPlan;
  timeline: PlanTimeline;
  /** Píxeles por segundo. */
  pxPerSecond: number;
  /** Cambia el zoom (pellizco y Ctrl + rueda). */
  onZoom?: (pxPerSecond: number) => void;
  clock: PlayClock;
  selection: Selection;
  readOnly: boolean;
  labelOf: (path: string) => string;
  /** Duración real del archivo de un clip, si se sabe. */
  fileSecondsOf: (path: string) => number | null;
  /** Dirección firmada del archivo y de su miniatura, para las tiras. */
  urlOf?: (path: string) => string | undefined;
  thumbOf?: (path: string) => string | undefined;
  onSeek: (seconds: number) => void;
  onSelect: (selection: Selection) => void;
  onMoveClip: (from: number, to: number) => void;
  /** Recorte en curso: se llama varias veces durante el arrastre con la misma clave. */
  onTrimClip: (id: string, edge: 'start' | 'end', value: number, dragKey: string) => void;
  onMoveText: (id: string, start: number, dragKey: string) => void;
  onTrimText: (id: string, edge: 'start' | 'end', value: number, dragKey: string) => void;
  /** Fin de un arrastre: el siguiente cambio ya es otro paso del historial. */
  onDragEnd: () => void;
  /** Golpes de la música en segundos del reel (tras «Ajustar los cortes a la música»). */
  beats?: number[];
  onAddMedia?: () => void;
  onAddText?: () => void;
  onAddMusic?: () => void;
}

type Drag =
  | { kind: 'clip'; index: number; x: number; dx: number; left: number }
  | { kind: 'trim-clip'; id: string; edge: 'start' | 'end'; x: number; origin: number; key: string; speed: number }
  | { kind: 'text'; id: string; x: number; origin: number; key: string }
  | { kind: 'trim-text'; id: string; edge: 'start' | 'end'; x: number; origin: number; key: string }
  | { kind: 'pan'; x: number; scroll: number };

let dragSeed = 0;

/**
 * Para los botones de la línea de tiempo: reciben el foco sin que el navegador desplace la línea
 * para enseñarlos enteros (desplazar la línea es mover el cabezal), y su pulsación no arrastra el fondo.
 */
const quietFocus = {
  onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
  },
};

/** Lo que hay que mantener pulsado un elemento con el dedo antes de poder arrastrarlo (así el dedo sigue desplazando la línea). */
export const LONG_PRESS_MS = 350;
/** Cuánto se puede mover el dedo durante la pulsación larga sin que cuente como desplazamiento. */
const LONG_PRESS_SLOP = 8;
/** Pasos del teclado en las asas de recorte: flechas y con Mayús. */
export const KEY_STEP = 0.1;
export const KEY_STEP_BIG = 1;

/** Posición de destino de un elemento arrastrado al segundo `t`: cuántos centros de los demás quedan a su izquierda. */
export function clipTarget(from: number, t: number, timeline: Pick<PlanTimeline, 'starts' | 'durations'>): number {
  let target = 0;
  timeline.starts.forEach((start, i) => {
    if (i !== from && start + timeline.durations[i]! / 2 < t) target += 1;
  });
  return target;
}

/** Fila de cada texto en su pista: los que se solapan en el tiempo van en filas distintas. */
export function textRows(texts: Array<Pick<ReelText, 'start' | 'end'>>): { rows: number[]; count: number } {
  const order = texts.map((_, i) => i).sort((a, b) => texts[a]!.start - texts[b]!.start);
  const ends: number[] = [];
  const rows = new Array<number>(texts.length).fill(0);
  for (const index of order) {
    const text = texts[index]!;
    let row = ends.findIndex((end) => end <= text.start + 1e-6);
    if (row < 0) {
      if (ends.length < MAX_TEXT_ROWS) row = ends.length;
      else row = ends.indexOf(Math.min(...ends));
    }
    ends[row] = Math.max(ends[row] ?? 0, text.end);
    rows[index] = row;
  }
  return { rows, count: Math.max(1, ends.length) };
}

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);
const TRANSITION_NAME: Record<string, string> = {
  cut: 'corte seco',
  fade: 'fundido',
  fadeblack: 'fundido a negro',
  dissolve: 'disolver',
  slideleft: 'deslizar a la izquierda',
  slideup: 'deslizar hacia arriba',
};

export const Timeline = memo(function Timeline(props: TimelineProps) {
  const { plan, timeline, pxPerSecond: pps, clock, selection, readOnly } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Pulsación larga en curso (dedo): se convierte en arrastre al cumplirse el tiempo. */
  const pending = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Dónde ha dejado la línea el propio cabezal: un desplazamiento distinto es del usuario. */
  const expected = useRef(0);
  const panned = useRef(false);
  /** La pulsación empezó en el fondo de una pista (y no en un elemento que luego se movió de sitio). */
  const onBackground = useRef(false);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const width = Math.max(timeline.total, 0.5) * pps;

  /** Origen de la pista en pantalla (ya cuenta lo desplazado). */
  const trackLeft = () => trackRef.current?.getBoundingClientRect().left ?? 0;
  /** Segundo del reel bajo el puntero. */
  const timeAt = (clientX: number) => Math.max(0, (clientX - trackLeft()) / latest.current.pxPerSecond);

  // ── El cabezal fijo: desplazar la línea es mover el cabezal, y al revés ──
  const follow = () => {
    const element = scrollerRef.current;
    if (!element) return;
    const x = latest.current.clock.get() * latest.current.pxPerSecond;
    expected.current = x;
    if (Math.abs(element.scrollLeft - x) > 0.5) element.scrollLeft = x;
  };
  useLayoutEffect(follow);
  useEffect(() => clock.subscribe(follow), [clock]);
  const onScroll = () => {
    const element = scrollerRef.current;
    if (!element || Math.abs(element.scrollLeft - expected.current) <= 1) return;
    expected.current = element.scrollLeft;
    const p = latest.current;
    p.onSeek(Math.min(element.scrollLeft / p.pxPerSecond, p.timeline.total));
  };

  // ── Zoom: pellizco con dos dedos y Ctrl + rueda. La rueda sola desplaza la línea. ──
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    let pinch: { distance: number; pps: number } | null = null;
    const distance = (event: TouchEvent) =>
      Math.hypot(
        event.touches[0]!.clientX - event.touches[1]!.clientX,
        event.touches[0]!.clientY - event.touches[1]!.clientY,
      );
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        pinch = { distance: Math.max(1, distance(event)), pps: latest.current.pxPerSecond };
      }
    };
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      if (event.cancelable) event.preventDefault();
      latest.current.onZoom?.(clampZoom(pinch.pps * (distance(event) / pinch.distance)));
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        latest.current.onZoom?.(clampZoom(latest.current.pxPerSecond * Math.exp(-event.deltaY * 0.0025)));
      } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        element.scrollLeft += event.deltaY;
      }
    };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', end);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end);
      element.removeEventListener('wheel', wheel);
    };
  }, []);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const p = latest.current;
      const delta = (event.clientX - drag.x) / p.pxPerSecond;
      if (drag.kind === 'pan') {
        if (Math.abs(event.clientX - drag.x) > 4) panned.current = true;
        if (scrollerRef.current) scrollerRef.current.scrollLeft = drag.scroll - (event.clientX - drag.x);
      } else if (drag.kind === 'clip') setDrag({ ...drag, dx: event.clientX - drag.x });
      // Un clip a otra velocidad: un segundo de pantalla son `speed` segundos de archivo.
      else if (drag.kind === 'trim-clip') p.onTrimClip(drag.id, drag.edge, drag.origin + delta * drag.speed, drag.key);
      else if (drag.kind === 'text') p.onMoveText(drag.id, drag.origin + delta, drag.key);
      else if (drag.kind === 'trim-text') p.onTrimText(drag.id, drag.edge, drag.origin + delta, drag.key);
    };
    const up = (event: PointerEvent) => {
      const p = latest.current;
      if (drag.kind === 'clip' && Math.abs(event.clientX - drag.x) > 4) {
        const to = clipTarget(drag.index, (event.clientX - drag.left) / p.pxPerSecond, p.timeline);
        if (to !== drag.index) p.onMoveClip(drag.index, to);
      }
      setDrag(null);
      if (drag.kind !== 'pan') p.onDragEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag]);

  const cancelPending = () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  };

  // Pulsación larga: con el dedo, un elemento solo se arrastra tras mantenerlo pulsado; antes, el gesto desplaza la línea.
  const press = (event: ReactPointerEvent, next: Drag) => {
    if (event.pointerType !== 'touch') {
      start(event, next);
      return;
    }
    cancelPending();
    pending.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        pending.current = null;
        navigator.vibrate?.(15);
        setDrag(next);
      }, LONG_PRESS_MS),
    };
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const p = pending.current;
      if (p && (Math.abs(event.clientX - p.x) > LONG_PRESS_SLOP || Math.abs(event.clientY - p.y) > LONG_PRESS_SLOP)) {
        cancelPending();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cancelPending);
    window.addEventListener('pointercancel', cancelPending);
    return () => {
      cancelPending();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cancelPending);
      window.removeEventListener('pointercancel', cancelPending);
    };
  }, []);

  // Durante un arrastre con el dedo, ni la página ni la línea se desplazan.
  useEffect(() => {
    if (!drag || drag.kind === 'pan') return;
    const block = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, [drag]);

  /** Recorte con el teclado desde un asa: flechas ±0,1 s (Mayús ±1 s). */
  const trimKey = (event: KeyboardEvent, current: number, apply: (value: number, key: string) => void, id: string) => {
    if (readOnly || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    apply(Number((current + (event.key === 'ArrowRight' ? step : -step)).toFixed(2)), `kbd:${id}`);
  };

  const start = (event: ReactPointerEvent, next: Drag) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();
    event.preventDefault();
    setDrag(next);
  };

  /** Arrastrar el fondo con el ratón desplaza la línea (con el dedo lo hace el navegador, con su inercia). */
  const pan = (event: ReactPointerEvent) => {
    panned.current = false;
    onBackground.current = event.target === event.currentTarget;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    setDrag({ kind: 'pan', x: event.clientX, scroll: scrollerRef.current?.scrollLeft ?? 0 });
  };

  const onClipKey = (event: KeyboardEvent, index: number) => {
    if (readOnly || !event.altKey) return;
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      event.stopPropagation();
      props.onMoveClip(index, index - 1);
    } else if (event.key === 'ArrowRight' && index < plan.clips.length - 1) {
      event.preventDefault();
      event.stopPropagation();
      props.onMoveClip(index, index + 1);
    }
  };

  const ticks: number[] = [];
  const tickStep = pps >= 180 ? 0.25 : pps >= 90 ? 0.5 : pps >= 40 ? 1 : pps >= 20 ? 2 : 5;
  for (let s = 0; s <= timeline.total + 1e-6; s += tickStep) ticks.push(Number(s.toFixed(2)));
  const cues = timelineSubtitles(plan.clips, timeline);
  const music = plan.music;
  const { rows: textRow, count: textRowCount } = textRows(plan.texts);
  const dropTarget =
    drag?.kind === 'clip' && Math.abs(drag.dx) > 4
      ? clipTarget(drag.index, (drag.x + drag.dx - drag.left) / pps, timeline)
      : null;
  /** Tocar el fondo de una pista suelta lo elegido. */
  const deselect = (event: React.MouseEvent) => {
    if (onBackground.current && event.target === event.currentTarget && !panned.current) props.onSelect(null);
  };

  return (
    <div className="relative isolate rounded-xl border border-border bg-surface" data-testid="reel-timeline-frame">
      <div
        ref={scrollerRef}
        className="flex overflow-x-auto overscroll-x-contain [scrollbar-width:thin] [touch-action:pan-x]"
        onScroll={onScroll}
        data-testid="reel-timeline"
      >
        <div className="shrink-0 basis-1/2" aria-hidden onClick={() => props.onSelect(null)} />
        <div ref={trackRef} className="relative shrink-0 select-none" style={{ width }}>
          {/* Regla: un toque lleva el cabezal a ese segundo. */}
          <div
            className="relative h-5 cursor-pointer border-b border-border bg-subtle text-[10px] text-muted"
            onPointerDown={pan}
            onClick={(e) => {
              if (!panned.current) props.onSeek(Math.min(timeAt(e.clientX), timeline.total));
            }}
            data-testid="reel-ruler"
          >
            {ticks.map((s) => (
              <span
                key={s}
                className="pointer-events-none absolute top-0 h-full border-l border-border pl-1"
                style={{ left: s * pps }}
              >
                {Number.isInteger(s) ? `${s}s` : ''}
              </span>
            ))}
          </div>

          <Lane label="Vídeo y fotos" className="h-14" onPointerDown={pan} onClick={deselect}>
            {plan.clips.map((clip, index) => {
              const left = timeline.starts[index]! * pps;
              const w = Math.max(16, timeline.durations[index]! * pps);
              const selected = selection?.kind === 'clip' && selection.id === clip.id;
              const dragging = drag?.kind === 'clip' && drag.index === index;
              const fileSeconds = clip.type === 'video' ? props.fileSecondsOf(clip.path) : null;
              const speed = clip.type === 'video' ? (clip.speed ?? 1) : 1;
              return (
                <div
                  key={clip.id}
                  className={cn(
                    'absolute bottom-1 top-1 overflow-hidden rounded-md border bg-subtle text-xs',
                    clip.type === 'video' ? 'border-primary/40' : 'border-border',
                    selected && 'z-10 ring-2 ring-primary',
                    dragging && 'z-20 opacity-80 shadow-pop',
                  )}
                  style={{ left, width: w, transform: dragging ? `translateX(${drag.dx}px)` : undefined }}
                  data-testid="reel-clip"
                >
                  <Strip
                    clip={clip}
                    width={w}
                    seconds={timeline.durations[index]!}
                    url={props.urlOf?.(clip.path)}
                    thumb={props.thumbOf?.(clip.path)}
                  />
                  <button
                    type="button"
                    className="absolute inset-0 flex h-full w-full cursor-grab select-none items-end gap-1 p-1 text-left [-webkit-touch-callout:none] active:cursor-grabbing"
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => {
                      // El foco, sin que el navegador desplace la línea para enseñar el elemento entero
                      // (movería el cabezal y el elemento se iría de debajo del dedo).
                      e.currentTarget.focus({ preventScroll: true });
                      props.onSelect({ kind: 'clip', id: clip.id });
                      if (!readOnly) press(e, { kind: 'clip', index, x: e.clientX, dx: 0, left: trackLeft() });
                      else e.stopPropagation();
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => props.onSelect({ kind: 'clip', id: clip.id })}
                    onKeyDown={(e) => onClipKey(e, index)}
                    aria-label={`${index + 1}. ${clip.type === 'video' ? 'Clip' : 'Foto'} ${props.labelOf(clip.path)}, ${fmt(
                      timeline.durations[index]!,
                    )} s`}
                    aria-pressed={selected}
                  >
                    <span className="flex max-w-full items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[10px] leading-none text-white">
                      {clip.type === 'video' ? (
                        <Film className="h-3 w-3 shrink-0" aria-hidden />
                      ) : (
                        <ImageIcon className="h-3 w-3 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">{fmt(timeline.durations[index]!)} s</span>
                      {speed !== 1 && <span data-testid="reel-clip-speed-badge">{fmt(speed)}×</span>}
                      {clip.type === 'video' && clip.volume === 0 && (
                        <VolumeX className="h-3 w-3 shrink-0" aria-label="Sin sonido" />
                      )}
                    </span>
                  </button>
                  {!readOnly && selected && clip.type === 'video' && (
                    <Handle
                      side="start"
                      label={`Recortar el principio del clip ${index + 1}`}
                      value={clip.in}
                      onKeyDown={(e) =>
                        trimKey(e, clip.in, (v, k) => props.onTrimClip(clip.id, 'start', v, k), `${clip.id}:start`)
                      }
                      onKeyUp={() => props.onDragEnd()}
                      onPointerDown={(e) =>
                        start(e, {
                          kind: 'trim-clip',
                          id: clip.id,
                          edge: 'start',
                          x: e.clientX,
                          origin: clip.in,
                          key: `trim:${++dragSeed}`,
                          speed,
                        })
                      }
                    />
                  )}
                  {!readOnly && selected && (
                    <Handle
                      side="end"
                      label={
                        clip.type === 'video'
                          ? `Recortar el final del clip ${index + 1}`
                          : `Duración de la foto ${index + 1}`
                      }
                      value={clip.type === 'video' ? clip.out : clip.seconds}
                      onKeyDown={(e) =>
                        trimKey(
                          e,
                          clip.type === 'video' ? Math.min(clip.out, fileSeconds ?? clip.out) : clip.seconds,
                          (v, k) => props.onTrimClip(clip.id, 'end', v, k),
                          `${clip.id}:end`,
                        )
                      }
                      onKeyUp={() => props.onDragEnd()}
                      onPointerDown={(e) =>
                        start(e, {
                          kind: 'trim-clip',
                          id: clip.id,
                          edge: 'end',
                          x: e.clientX,
                          origin: clip.type === 'video' ? Math.min(clip.out, fileSeconds ?? clip.out) : clip.seconds,
                          key: `trim:${++dragSeed}`,
                          speed,
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
            {/* Transiciones: el botón entre dos elementos abre la de ese corte. */}
            {plan.clips.map((clip, index) => {
              if (index === 0) return null;
              const overlap = timeline.transitions[index]!;
              const type = clip.transition?.type ?? 'cut';
              const chosen = selection?.kind === 'transition' && selection.id === clip.id;
              return (
                <button
                  key={`tr-${clip.id}`}
                  type="button"
                  className={cn(
                    'absolute top-1/2 z-20 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded border border-border bg-surface text-[10px] font-semibold shadow-card hover:border-primary [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7',
                    overlap > 0 && 'border-warning text-warning',
                    chosen && 'border-primary ring-2 ring-primary',
                  )}
                  style={{ left: (timeline.starts[index]! + overlap / 2) * pps }}
                  {...quietFocus}
                  onClick={() => props.onSelect({ kind: 'transition', id: clip.id })}
                  aria-label={`Transición entre ${index} y ${index + 1}: ${TRANSITION_NAME[type] ?? type}`}
                  aria-pressed={chosen}
                  title="Transición de este corte"
                  data-testid="reel-transition"
                >
                  <span aria-hidden>{overlap > 0 ? '◆' : '|'}</span>
                </button>
              );
            })}
            {dropTarget !== null && (
              <span
                className="pointer-events-none absolute bottom-0 top-0 z-30 w-0.5 bg-primary"
                style={{
                  left:
                    dropTarget >= plan.clips.length - 1
                      ? timeline.total * pps
                      : timeline.starts[dropTarget + (dropTarget > (drag as { index: number }).index ? 1 : 0)]! * pps,
                }}
                data-testid="reel-drop-indicator"
              />
            )}
            {!readOnly && props.onAddMedia && (
              <button
                type="button"
                className="absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md border border-dashed border-border bg-surface text-muted hover:border-primary hover:text-fg"
                style={{ left: timeline.total * pps + 8 }}
                {...quietFocus}
                onClick={props.onAddMedia}
                aria-label="Añadir fotos o clips al final"
                data-testid="reel-add-end"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            )}
          </Lane>

          <Lane
            label="Textos"
            style={{ height: textRowCount * TEXT_ROW_PX + 4 }}
            onPointerDown={pan}
            onClick={deselect}
          >
            {plan.texts.length === 0 && !readOnly && props.onAddText && (
              <LaneHint icon={<Type className="h-3.5 w-3.5" aria-hidden />} onClick={props.onAddText}>
                Añadir texto
              </LaneHint>
            )}
            {plan.texts.map((text, index) => {
              const selected = selection?.kind === 'text' && selection.id === text.id;
              return (
                <div
                  key={text.id}
                  className={cn(
                    'absolute overflow-hidden rounded-md border border-border bg-primary-soft text-xs',
                    selected && 'z-10 ring-2 ring-primary',
                  )}
                  style={{
                    left: text.start * pps,
                    width: Math.max(12, (text.end - text.start) * pps),
                    top: 2 + textRow[index]! * TEXT_ROW_PX,
                    height: TEXT_ROW_PX - 2,
                  }}
                  data-testid="reel-text-block"
                >
                  <button
                    type="button"
                    className="flex h-full w-full cursor-grab select-none items-center gap-1 px-2 text-left [-webkit-touch-callout:none]"
                    onMouseDown={(e) => e.preventDefault()}
                    onPointerDown={(e) => {
                      e.currentTarget.focus({ preventScroll: true });
                      props.onSelect({ kind: 'text', id: text.id });
                      if (!readOnly) {
                        press(e, { kind: 'text', id: text.id, x: e.clientX, origin: text.start, key: `text:${++dragSeed}` });
                      } else e.stopPropagation();
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => props.onSelect({ kind: 'text', id: text.id })}
                    aria-label={`Texto ${index + 1}: ${text.text}`}
                    aria-pressed={selected}
                  >
                    <Type className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{text.text}</span>
                  </button>
                  {!readOnly && selected && (
                    <>
                      <Handle
                        side="start"
                        label={`Cuándo entra el texto ${index + 1}`}
                        value={text.start}
                        onKeyDown={(e) =>
                          trimKey(e, text.start, (v, k) => props.onTrimText(text.id, 'start', v, k), `${text.id}:start`)
                        }
                        onKeyUp={() => props.onDragEnd()}
                        onPointerDown={(e) =>
                          start(e, {
                            kind: 'trim-text',
                            id: text.id,
                            edge: 'start',
                            x: e.clientX,
                            origin: text.start,
                            key: `tt:${++dragSeed}`,
                          })
                        }
                      />
                      <Handle
                        side="end"
                        label={`Cuándo sale el texto ${index + 1}`}
                        value={text.end}
                        onKeyDown={(e) =>
                          trimKey(e, text.end, (v, k) => props.onTrimText(text.id, 'end', v, k), `${text.id}:end`)
                        }
                        onKeyUp={() => props.onDragEnd()}
                        onPointerDown={(e) =>
                          start(e, {
                            kind: 'trim-text',
                            id: text.id,
                            edge: 'end',
                            x: e.clientX,
                            origin: text.end,
                            key: `tt:${++dragSeed}`,
                          })
                        }
                      />
                    </>
                  )}
                </div>
              );
            })}
          </Lane>

          {(cues.length > 0 || plan.clips.some((c) => c.type === 'video')) && (
            <Lane
              label="Subtítulos"
              className="h-6"
              muted={!plan.subtitles?.enabled}
              onPointerDown={pan}
              onClick={deselect}
            >
              {cues.map((cue) => (
                <button
                  key={`${cue.clip}:${cue.cue}`}
                  type="button"
                  className="absolute bottom-0.5 top-0.5 truncate rounded border border-border bg-subtle px-1 text-left text-[10px]"
                  style={{ left: cue.start * pps, width: Math.max(8, (cue.end - cue.start) * pps) }}
                  {...quietFocus}
                  onClick={() => props.onSelect({ kind: 'subtitles' })}
                  title={cue.text}
                  data-testid="reel-cue-block"
                >
                  {cue.text}
                </button>
              ))}
            </Lane>
          )}

          <Lane label="Música" className="h-8" onPointerDown={pan} onClick={deselect}>
            {!music && !readOnly && props.onAddMusic && (
              <LaneHint icon={<Music2 className="h-3.5 w-3.5" aria-hidden />} onClick={props.onAddMusic}>
                Añadir música
              </LaneHint>
            )}
            {music && (
              <button
                type="button"
                className={cn(
                  'absolute bottom-0.5 top-0.5 flex items-center gap-1 overflow-hidden rounded-md border border-success/40 bg-success/10 px-2 text-left text-xs',
                  selection?.kind === 'music' && 'ring-2 ring-primary',
                )}
                style={{ left: 0, width: Math.max(16, timeline.total * pps) }}
                {...quietFocus}
                onClick={() => props.onSelect({ kind: 'music' })}
                aria-label={`Música: ${props.labelOf(music.path)}`}
                aria-pressed={selection?.kind === 'music'}
                data-testid="reel-music-block"
              >
                <MusicWave
                  music={music}
                  total={timeline.total}
                  width={Math.max(16, timeline.total * pps)}
                  url={props.urlOf?.(music.path)}
                />
                <Music2 className="relative h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="relative truncate">{props.labelOf(music.path)}</span>
              </button>
            )}
            {music &&
              (props.beats ?? [])
                .filter((b) => b <= timeline.total)
                .map((b) => (
                  <span
                    key={b}
                    className="pointer-events-none absolute bottom-0 z-10 h-2 w-px bg-success"
                    style={{ left: b * pps }}
                    data-testid="reel-beat"
                  />
                ))}
          </Lane>
        </div>
        <div className="shrink-0 basis-1/2" aria-hidden onClick={() => props.onSelect(null)} />
      </div>

      {/* Cabezal: fijo en el centro; la pista se desliza por debajo. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 z-40 w-0.5 -translate-x-1/2 bg-danger"
        aria-hidden
        data-testid="reel-playhead"
      >
        <span className="absolute -left-1 top-0 h-2 w-2.5 rounded-b bg-danger" />
      </div>
    </div>
  );
});

function Lane({
  label,
  muted = false,
  className,
  style,
  onPointerDown,
  onClick,
  children,
}: {
  label: string;
  muted?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (event: ReactPointerEvent) => void;
  onClick?: (event: React.MouseEvent) => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('relative border-b border-border last:border-b-0', muted && 'opacity-50', className)}
      style={style}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/** Pista vacía: lo que se puede añadir en ella, como botón. */
function LaneHint({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="absolute bottom-0.5 left-0 top-0.5 flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-border px-2 text-[11px] text-muted hover:border-primary hover:text-fg"
      {...quietFocus}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

/** ¿Está a la vista? (para no pedir miniaturas ni ondas de lo que queda fuera de la línea). */
function useVisible<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

/**
 * Fondo de un elemento de la pista principal: la miniatura de la foto repetida, o los
 * fotogramas del tramo del clip (se van pintando según se sacan; mientras, su miniatura).
 */
const Strip = memo(function Strip({
  clip,
  width,
  seconds,
  url,
  thumb,
}: {
  clip: Clip;
  width: number;
  /** Lo que dura en el reel. */
  seconds: number;
  url: string | undefined;
  thumb: string | undefined;
}) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [, repaint] = useState(0);
  const isVideo = clip.type === 'video';
  const background = visible ? (thumb ?? (isVideo ? undefined : url)) : undefined;
  const canvasWidth = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(width)));
  const from = isVideo ? clip.in : 0;
  const to = isVideo ? clip.in + seconds * (clip.speed ?? 1) : 0;
  const tiles = Math.max(1, Math.round(canvasWidth / (FRAME_HEIGHT * 0.5)));

  useEffect(() => {
    if (!isVideo || !visible || !url) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    const times = stripTimes(from, to, tiles);
    const tileWidth = canvas.width / times.length;
    const cancels: Array<() => void> = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    times.forEach((time, i) => {
      const frame = cachedFrame(clip.path, time);
      if (frame) {
        // Recorte centrado del fotograma a la casilla.
        const ratio = tileWidth / canvas.height;
        const sw = Math.min(FRAME_WIDTH, FRAME_HEIGHT * ratio);
        const sh = Math.min(FRAME_HEIGHT, FRAME_WIDTH / ratio);
        ctx.drawImage(frame, (FRAME_WIDTH - sw) / 2, (FRAME_HEIGHT - sh) / 2, sw, sh, i * tileWidth, 0, tileWidth, canvas.height);
      } else {
        cancels.push(requestFrame(clip.path, url, time, () => repaint((n) => n + 1)));
      }
    });
    return () => cancels.forEach((cancel) => cancel());
  });

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 bg-repeat-x"
      style={{
        backgroundImage: background ? `url(${JSON.stringify(background)})` : undefined,
        backgroundSize: 'auto 100%',
        backgroundPosition: 'left center',
      }}
      aria-hidden
      data-testid="reel-strip"
    >
      {isVideo && <canvas ref={canvasRef} width={canvasWidth} height={FRAME_HEIGHT / 2} className="h-full w-full" />}
    </div>
  );
});

/** Forma de onda de la música bajo su barra (con la entrada y la salida suaves). */
function MusicWave({ music, total, width, url }: { music: Music; total: number; width: number; url: string | undefined }) {
  const [ref, visible] = useVisible<HTMLCanvasElement>();
  const wave = useWaveform(music.path, url, visible);
  const canvasWidth = Math.min(MAX_CANVAS_PX, Math.max(1, Math.round(width)));
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!wave || total <= 0) return;
    ctx.fillStyle = getComputedStyle(canvas).color || '#16a34a';
    const mid = canvas.height / 2;
    for (let x = 0; x < canvas.width; x += 2) {
      const t = (x / canvas.width) * total;
      const gain = music.volume > 0 ? musicGain(t, total, music) / music.volume : 0;
      const half = Math.max(0.5, peakAt(wave, music.startAt, t) * gain * mid);
      ctx.fillRect(x, mid - half, 1.5, half * 2);
    }
  }, [ref, wave, total, canvasWidth, music]);
  return (
    <canvas
      ref={ref}
      width={canvasWidth}
      height={28}
      className="pointer-events-none absolute inset-0 h-full w-full text-success opacity-60"
      aria-hidden
      data-testid={wave ? 'reel-waveform' : 'reel-waveform-pending'}
    />
  );
}

function Handle({
  side,
  label,
  value,
  onPointerDown,
  onKeyDown,
  onKeyUp,
}: {
  side: 'start' | 'end';
  label: string;
  /** Valor actual en segundos, para los lectores de pantalla. */
  value: number;
  onPointerDown: (event: ReactPointerEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onKeyUp: () => void;
}) {
  return (
    <span
      role="slider"
      aria-label={label}
      aria-valuenow={Number(value.toFixed(2))}
      aria-valuemin={0}
      aria-valuetext={`${fmt(value)} s`}
      aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
      tabIndex={0}
      className={cn(
        'absolute bottom-0 top-0 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-primary hover:bg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-fg [@media(pointer:coarse)]:w-6',
        side === 'start' ? 'left-0 rounded-l-md' : 'right-0 rounded-r-md',
      )}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      data-testid={`reel-handle-${side}`}
    >
      <span className="h-4 w-0.5 rounded bg-white/90" aria-hidden />
    </span>
  );
}
