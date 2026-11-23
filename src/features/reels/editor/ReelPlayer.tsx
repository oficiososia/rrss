// Vista previa del reel en el navegador: un lienzo 9:16 que ocupa todo el alto
// disponible y se compone en cada fotograma con lo que dice compose.ts. Los
// clips se reproducen con elementos <video> (sincronizados con el cabezal, con
// su volumen y su velocidad), las fotos con el movimiento de la plantilla, y la
// música con un <audio> cuyo volumen sigue la entrada y la salida suaves. No
// hay FFmpeg aquí: es una aproximación fiel a las cuentas del trabajador, y lo
// que se verá distinto se avisa aparte.
//
// Para que no dé saltos con 10-15 clips:
//  * El cabezal no es estado de React (clock.ts): reproducir no repinta la pantalla.
//  * Lo que no depende del instante se prepara una vez por montaje (`prepareFrames`).
//  * Los <video> se crean cuando hacen falta (el que se ve y el siguiente, que se
//    deja colocado en su punto de entrada antes del corte) y se sueltan los lejanos.
//  * Las fotos se reducen al cargarlas (hasta 1600 px de alto): dibujar 12 megapíxeles
//    en cada fotograma es lo que más pesa.
import { Pause, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import type { ReelTemplateSummary } from '../templates';
import { useClockValue, type PlayClock } from './clock';
import { musicGain, prepareFrames, type Frame, type FrameText } from './compose';
import type { Selection } from './history';
import { textLayout, type ClipFilter, type DraftPlan, type PlanTimeline, type VideoClip } from './project';
import { TextOverlay } from './TextOverlay';
import { setThumbsPaused } from './thumbs';

export const PREVIEW_WIDTH = 360;
export const PREVIEW_HEIGHT = 640;
/** El lienzo sigue al tamaño en pantalla (por la densidad de píxeles) hasta este alto. */
const MAX_CANVAS_HEIGHT = 1280;
/** Desfase tolerado entre un clip y el cabezal antes de recolocarlo. */
const MAX_DRIFT = 0.25;
/** Con cuánta antelación se prepara el clip siguiente. */
const WARM_SECONDS = 1.5;
/** Elementos <video> vivos a la vez (los móviles limitan los decodificadores). */
const MAX_VIDEOS = 4;
const MAX_PHOTO_HEIGHT = 1600;

/** Cómo se aproxima cada filtro de color en el lienzo del navegador (en el vídeo lo hace FFmpeg). */
export const PREVIEW_FILTERS: Record<ClipFilter, string> = {
  bw: 'grayscale(1) contrast(1.08)',
  sepia: 'sepia(1)',
  vivid: 'saturate(1.35) contrast(1.12)',
  warm: 'sepia(0.28) saturate(1.2)',
  cool: 'saturate(0.92) hue-rotate(-12deg) brightness(1.02)',
  fade: 'contrast(0.82) brightness(1.08) saturate(0.78)',
  drama: 'contrast(1.3) saturate(0.88) brightness(0.95)',
};

export interface ReelPlayerProps {
  plan: DraftPlan;
  timeline: PlanTimeline;
  template: ReelTemplateSummary;
  /** Dirección firmada de cada ruta del cubo. */
  urls: Map<string, string>;
  /** Familia de la tipografía por defecto de la marca para los reels, si la hay. */
  defaultFamily: string | null;
  clock: PlayClock;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  /** Mueve el cabezal (y para la reproducción). */
  onSeek: (seconds: number) => void;
  /** Si se da, la reproducción se para al llegar a ese segundo (vista previa de una transición). */
  stopAt?: number | null;
  selection: Selection;
  readOnly: boolean;
  onSelect: (selection: Selection) => void;
  onTextOffset: (id: string, offset: { x: number; y: number }, key: string) => void;
  onTextSize: (id: string, sizeRatio: number, key: string) => void;
  onTextChange: (id: string, text: string, key: string) => void;
  onGestureEnd: () => void;
  /** Botones a la derecha del transporte (si hacen falta). */
  extra?: ReactNode;
  /** Enseña las zonas que tapa Instagram (se encienden y apagan desde el «⋯» del editor). */
  safeZones?: boolean;
}

/** Desviación del desenfoque en el lienzo (la misma cuenta que `blurSigma` del trabajador). */
export function previewBlur(blur: number | undefined, width: number, height: number): number {
  if (!blur || blur <= 0) return 0;
  return (Math.min(blur, 100) / 100) * 0.05 * Math.min(width, height);
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

type Picture = HTMLImageElement | ImageBitmap;

export function ReelPlayer(props: ReelPlayerProps) {
  const { plan, timeline, template, clock, playing } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const photos = useRef(new Map<string, Picture | 'loading'>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const safeZones = props.safeZones ?? false;
  const [draggingText, setDraggingText] = useState(false);
  const [size, setSize] = useState({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  const scheduled = useRef(0);

  // Lo que no cambia de un fotograma a otro, preparado una vez por montaje.
  const frames = useMemo(
    () => prepareFrames(plan, timeline, template, size),
    [plan, timeline, template, size],
  );
  const framesRef = useRef(frames);
  useLayoutEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  // El lienzo sigue al tamaño con el que se ve (nítido en pantallas densas, sin pasarse).
  useEffect(() => {
    const element = frameRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const cssHeight = entries[0]?.contentRect.height ?? 0;
      if (cssHeight <= 0) return;
      const wanted = Math.min(MAX_CANVAS_HEIGHT, Math.max(PREVIEW_HEIGHT, cssHeight * (window.devicePixelRatio || 1)));
      const height = Math.round(wanted / 32) * 32;
      setSize((current) => (current.height === height ? current : { width: (height * 9) / 16, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const redrawSoon = () => {
    if (scheduled.current || typeof requestAnimationFrame === 'undefined') return;
    scheduled.current = requestAnimationFrame(() => {
      scheduled.current = 0;
      if (latest.current.playing) return;
      const t = latest.current.clock.get();
      syncMedia(t, false);
      draw(t);
    });
  };

  // ── Medios: se crean cuando hacen falta ──

  function photoFor(path: string): Picture | null {
    const known = photos.current.get(path);
    if (known) return known === 'loading' ? null : known;
    const url = latest.current.urls.get(path);
    if (!url) return null;
    photos.current.set(path, 'loading');
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      photos.current.set(path, image);
      redrawSoon();
      // Una copia reducida: dibujar la foto entera en cada fotograma es lo que más pesa.
      if (typeof createImageBitmap === 'function' && image.naturalHeight > MAX_PHOTO_HEIGHT) {
        createImageBitmap(image, { resizeHeight: MAX_PHOTO_HEIGHT, resizeQuality: 'medium' }).then(
          (bitmap) => {
            if (photos.current.get(path) === image) photos.current.set(path, bitmap);
          },
          () => undefined,
        );
      }
    };
    // Si no carga, se queda marcada: no se vuelve a pedir en cada fotograma.
    image.src = url;
    return null;
  }

  function videoFor(clip: VideoClip): HTMLVideoElement | null {
    const url = latest.current.urls.get(clip.path);
    if (!url) return null;
    let video = videos.current.get(clip.id);
    if (!video) {
      video = document.createElement('video');
      video.preload = 'auto';
      video.playsInline = true;
      video.addEventListener('seeked', redrawSoon);
      video.addEventListener('loadeddata', redrawSoon);
      videos.current.set(clip.id, video);
    } else {
      // Lo más reciente, al final: se sueltan los que llevan más sin usarse.
      videos.current.delete(clip.id);
      videos.current.set(clip.id, video);
    }
    if (video.dataset.src !== url) {
      video.src = url;
      video.dataset.src = url;
    }
    return video;
  }

  function release(keep: Set<string>) {
    for (const [id, video] of videos.current) {
      if (videos.current.size <= MAX_VIDEOS) break;
      if (keep.has(id)) continue;
      video.pause();
      video.removeAttribute('src');
      video.load();
      videos.current.delete(id);
    }
  }

  // Al cambiar el montaje: fuera los <video> de clips que ya no están y la música que toque.
  const mediaKey = useMemo(
    () => plan.clips.map((c) => `${c.id}:${c.path}`).join('|') + `|${plan.music?.path ?? ''}|${props.urls.size}`,
    [plan.clips, plan.music?.path, props.urls],
  );
  useEffect(() => {
    const ids = new Set(plan.clips.map((c) => c.id));
    for (const [id, video] of videos.current) {
      if (ids.has(id)) continue;
      video.pause();
      video.removeAttribute('src');
      video.load();
      videos.current.delete(id);
    }
    const musicUrl = plan.music ? props.urls.get(plan.music.path) : undefined;
    if (musicUrl) {
      if (!audio.current) audio.current = new Audio();
      if (audio.current.dataset.src !== musicUrl) {
        audio.current.src = musicUrl;
        audio.current.dataset.src = musicUrl;
        audio.current.loop = true;
      }
    } else if (audio.current) {
      audio.current.pause();
      audio.current = null;
    }
    redrawSoon();
    // `mediaKey` resume los clips y las direcciones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  useEffect(() => {
    const all = videos.current;
    return () => {
      for (const video of all.values()) video.pause();
      audio.current?.pause();
      setThumbsPaused(false);
      if (scheduled.current) cancelAnimationFrame(scheduled.current);
    };
  }, []);

  /** Coloca cada clip y la música en el segundo `t` (al reproducir, solo si se han desfasado). */
  function syncMedia(t: number, live: boolean): Frame {
    const p = latest.current;
    const frame = framesRef.current(t);
    const active = new Set<string>();
    let last = -1;
    for (const layer of frame.layers) {
      last = Math.max(last, layer.clip);
      const clip = p.plan.clips[layer.clip];
      if (!clip || clip.type !== 'video' || layer.sourceTime === null) continue;
      const video = videoFor(clip);
      if (!video) continue;
      active.add(clip.id);
      const speed = clip.speed ?? 1;
      video.volume = Math.min(1, Math.max(0, clip.volume));
      video.muted = clip.volume === 0 || !live;
      if (video.playbackRate !== speed) video.playbackRate = speed;
      if (Math.abs(video.currentTime - layer.sourceTime) > (live ? MAX_DRIFT * Math.max(1, speed) : 0.04)) {
        try {
          video.currentTime = layer.sourceTime;
        } catch {
          // Todavía sin datos: se colocará al cargar.
        }
      }
      if (live && video.paused) void video.play()?.catch(() => undefined);
      if (!live && !video.paused) video.pause();
    }
    // El siguiente, preparado antes del corte: su vídeo ya colocado en el punto de entrada, o su foto cargada.
    const next = p.plan.clips[last + 1];
    if (next && p.timeline.starts[last + 1]! - t < WARM_SECONDS) {
      if (next.type === 'photo') photoFor(next.path);
      else if (!active.has(next.id)) {
        const video = videoFor(next);
        if (video) {
          active.add(next.id);
          video.muted = true;
          if (!video.paused) video.pause();
          if (Math.abs(video.currentTime - next.in) > 0.05) {
            try {
              video.currentTime = next.in;
            } catch {
              // sin datos todavía
            }
          }
        }
      }
    }
    for (const [id, video] of videos.current) if (!active.has(id) && !video.paused) video.pause();
    release(active);

    const music = p.plan.music;
    const track = audio.current;
    if (music && track) {
      if (live) {
        const duration = Number.isFinite(track.duration) && track.duration > 0 ? track.duration : null;
        const desired = duration ? (music.startAt + t) % duration : music.startAt + t;
        if (Math.abs(track.currentTime - desired) > 0.3) {
          try {
            track.currentTime = desired;
          } catch {
            // sin datos todavía
          }
        }
        track.volume = musicGain(t, p.timeline.total, music);
        if (track.paused) void track.play()?.catch(() => undefined);
      } else if (!track.paused) track.pause();
    }
    return frame;
  }

  function draw(t: number, ready?: Frame) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    const p = latest.current;
    const W = canvas.width;
    const H = canvas.height;
    const frame = ready ?? framesRef.current(t);
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const layer of frame.layers) {
      const clip = p.plan.clips[layer.clip];
      if (!clip) continue;
      const source: CanvasImageSource | null | undefined =
        clip.type === 'video' ? videos.current.get(clip.id) : photoFor(clip.path);
      const sw0 =
        source instanceof HTMLVideoElement ? source.videoWidth : source ? (source as { width: number }).width : 0;
      const sh0 =
        source instanceof HTMLVideoElement ? source.videoHeight : source ? (source as { height: number }).height : 0;
      if (!source || !sw0 || !sh0) continue;
      // Recorte 9:16 que cubre el lienzo, centrado en el punto de interés.
      const focal = clip.focalPoint ?? { x: 0.5, y: 0.5 };
      const scale = Math.max(W / sw0, H / sh0);
      const cw = W / scale;
      const ch = H / scale;
      const cx = Math.min(Math.max(focal.x * sw0 - cw / 2, 0), sw0 - cw);
      const cy = Math.min(Math.max(focal.y * sh0 - ch / 2, 0), sh0 - ch);
      // Movimiento de la foto (como zoompan): se recorta una parte y se amplía.
      const zw = cw / layer.zoom;
      const zh = ch / layer.zoom;
      const zx = cx + (cw - zw) * layer.panX;
      const zy = cy + (ch - zh) * layer.panY;
      ctx.save();
      ctx.globalAlpha = layer.alpha;
      const sigma = previewBlur(clip.blur, W, H);
      const filters = [
        ...(sigma > 0 ? [`blur(${sigma.toFixed(1)}px)`] : []),
        ...(clip.filter ? [PREVIEW_FILTERS[clip.filter]] : []),
      ];
      if (filters.length > 0) ctx.filter = filters.join(' ');
      ctx.drawImage(source, zx, zy, zw, zh, layer.dx * W, layer.dy * H, W, H);
      ctx.restore();
    }
    if (frame.black > 0) {
      ctx.fillStyle = `rgba(0,0,0,${frame.black.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    for (const item of frame.texts) drawText(ctx, item, W, H, p.defaultFamily);
    for (const item of frame.subtitles) drawText(ctx, item, W, H, p.defaultFamily);
    ctx.restore();
  }

  // Reproducción: un bucle de fotogramas mientras `playing`. El cabezal avanza en el reloj, no en React.
  useEffect(() => {
    setThumbsPaused(playing);
    if (!playing) {
      redrawSoon();
      return;
    }
    let raf = 0;
    const from = clock.get();
    const startAt = from >= latest.current.timeline.total - 0.05 ? 0 : from;
    const started = performance.now();
    const tick = (now: number) => {
      const p = latest.current;
      const t = startAt + (now - started) / 1000;
      const limit = Math.min(p.timeline.total, p.stopAt ?? Infinity);
      if (t >= limit) {
        p.clock.set(limit);
        p.onPlayingChange(false);
        return;
      }
      draw(t, syncMedia(t, true));
      p.clock.set(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      syncMedia(latest.current.clock.get(), false);
    };
    // Solo arranca o para; el resto se lee de `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Parado: cada cambio del cabezal o del montaje se vuelve a dibujar (como mucho, una vez por fotograma).
  // `redrawSoon` solo lee referencias: vale la de cualquier pintado.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => clock.subscribe(redrawSoon), [clock]);
  useEffect(() => {
    redrawSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, props.defaultFamily, props.urls]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="relative min-h-[9rem] flex-1 [container-type:size]" data-testid="reel-stage">
        <div
          ref={frameRef}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-black shadow-card"
          style={{ width: 'min(100cqw, calc(100cqh * 9 / 16))', height: 'min(100cqh, calc(100cqw * 16 / 9))' }}
          data-testid="reel-frame"
        >
          <canvas
            ref={canvasRef}
            width={size.width}
            height={size.height}
            className="h-full w-full"
            role="img"
            aria-label="Vista previa del reel"
            data-testid="reel-preview"
          />
          {(safeZones || draggingText) && (
            <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="reel-safe-zones">
              <div className="absolute inset-x-0 top-0 h-[12%] border-b border-dashed border-white/70 bg-red-500/25" />
              <div className="absolute inset-x-0 bottom-0 h-[22%] border-t border-dashed border-white/70 bg-red-500/25" />
              <div className="absolute bottom-[22%] right-0 top-[12%] w-[14%] border-l border-dashed border-white/70 bg-red-500/25" />
              <span className="absolute inset-x-0 top-[4%] text-center text-[10px] font-medium text-white">
                Lo tapa Instagram
              </span>
            </div>
          )}
          {!playing && (
            <TextOverlay
              plan={plan}
              total={timeline.total}
              clock={clock}
              selection={props.selection}
              readOnly={props.readOnly}
              onSelect={props.onSelect}
              onTextOffset={props.onTextOffset}
              onTextSize={props.onTextSize}
              onTextChange={props.onTextChange}
              onGestureEnd={props.onGestureEnd}
              onDragging={setDraggingText}
            />
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-center gap-1">
        {/* Como en CapCut: solo reproducir y el reloj. Volver al principio es la tecla Inicio o deslizar la línea. */}
        <Button
          variant="secondary"
          size="icon"
          aria-label={playing ? 'Pausar la vista previa' : 'Reproducir la vista previa'}
          aria-keyshortcuts="Space"
          title="Reproducir o pausar (Espacio)"
          onClick={() => props.onPlayingChange(!playing)}
          disabled={timeline.total <= 0}
          data-testid="reel-play"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </Button>
        <TimeLabel clock={clock} total={timeline.total} />
        {props.extra}
      </div>
    </div>
  );
}

/** El reloj: lo único de la vista previa que se repinta al avanzar el cabezal (cada décima). */
function TimeLabel({ clock, total }: { clock: PlayClock; total: number }) {
  const time = useClockValue(clock, 0.1);
  return (
    <span className="w-24 text-center text-sm tabular-nums" data-testid="reel-time">
      {fmt(Math.min(time, total))} / {fmt(total)} s
    </span>
  );
}

function drawText(ctx: CanvasRenderingContext2D, item: FrameText, W: number, H: number, defaultFamily: string | null) {
  const { style } = item;
  const layout = textLayout(style, item.position, item.lines.length, W, H);
  const family = style.fontFamily ?? (style.fontPath ? null : defaultFamily);
  // Con el zoom la letra crece del 60 % al 100 % y el texto sigue centrado en su línea.
  const size = layout.fontSize * item.scale;
  ctx.save();
  ctx.globalAlpha = item.alpha;
  ctx.font = `${size}px ${family ? `"${family}", ` : ''}"DejaVu Sans", Arial, sans-serif`;
  // Máquina de escribir: alineada a la izquierda del ancho útil (como en el vídeo).
  const left = Math.round(((1 - style.maxWidthRatio) * W) / 2);
  ctx.textAlign = item.typewriter ? 'left' : 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  const originX = (item.typewriter ? left : W / 2) + item.dx * W;
  item.lines.forEach((line, index) => {
    if (!line) return;
    const y = layout.top + index * layout.lineStep + (layout.fontSize - size) / 2 + item.dy * H;
    const width = ctx.measureText(line).width;
    if (style.box) {
      const pad = Math.round(style.box.paddingRatio * layout.fontSize);
      const boxX = item.typewriter ? originX : originX - width / 2;
      ctx.fillStyle = hexToRgba(style.box.color, style.box.opacity);
      ctx.fillRect(boxX - pad, y - pad, width + pad * 2, size + pad * 2);
    }
    if (style.outline) {
      ctx.lineWidth = Math.max(1, Math.round(style.outline.widthRatio * layout.fontSize)) * 2;
      ctx.strokeStyle = style.outline.color;
      ctx.strokeText(line, originX, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, originX, y);
  });
  ctx.restore();
}

function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
