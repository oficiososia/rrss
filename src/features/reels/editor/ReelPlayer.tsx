// Vista previa del reel en el navegador: un lienzo 9:16 que se compone en cada
// fotograma con lo que dice compose.ts. Los clips se reproducen con elementos
// <video> (sincronizados con el cabezal, con su volumen), las fotos con el
// movimiento de la plantilla, y la música con un <audio> cuyo volumen sigue la
// entrada y la salida suaves. No hay FFmpeg aquí: es una aproximación fiel a
// las cuentas del trabajador, y lo que se verá distinto se avisa aparte.
import { Pause, Play, ScanLine, SkipBack } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ReelTemplateSummary } from '../templates';
import { frameAt, musicGain, type FrameText } from './compose';
import { textLayout, type DraftPlan, type PlanTimeline } from './project';

export const PREVIEW_WIDTH = 360;
export const PREVIEW_HEIGHT = 640;
/** Cada cuánto se avisa del avance al resto de la pantalla mientras se reproduce. */
const TICK_MS = 66;
/** Desfase tolerado entre un clip y el cabezal antes de recolocarlo. */
const MAX_DRIFT = 0.25;

export interface ReelPlayerProps {
  plan: DraftPlan;
  timeline: PlanTimeline;
  template: ReelTemplateSummary;
  /** Dirección firmada de cada ruta del cubo. */
  urls: Map<string, string>;
  /** Familia de la tipografía por defecto de la marca para los reels, si la hay. */
  defaultFamily: string | null;
  playhead: number;
  playing: boolean;
  onTime: (seconds: number) => void;
  onPlayingChange: (playing: boolean) => void;
  /** Segundos máximos de un reel, para la barra de duración. */
  maxSeconds?: number;
}

/** Desviación del desenfoque en el lienzo (la misma cuenta que `blurSigma` del trabajador). */
export function previewBlur(blur: number | undefined, width: number, height: number): number {
  if (!blur || blur <= 0) return 0;
  return (Math.min(blur, 100) / 100) * 0.05 * Math.min(width, height);
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

export function ReelPlayer(props: ReelPlayerProps) {
  const { plan, timeline, urls, playhead, playing } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const images = useRef(new Map<string, HTMLImageElement>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const clock = useRef({ base: playhead, started: 0, lastTick: 0 });
  const [safeZones, setSafeZones] = useState(false);

  // ── Elementos de medios: uno por clip y uno por foto ──
  const mediaKey = useMemo(
    () =>
      plan.clips.map((c) => `${c.id}:${c.path}:${urls.get(c.path) ? 1 : 0}`).join('|') + `|${plan.music?.path ?? ''}`,
    [plan.clips, plan.music?.path, urls],
  );
  useEffect(() => {
    const wanted = new Set<string>();
    for (const clip of plan.clips) {
      const url = urls.get(clip.path);
      if (!url) continue;
      if (clip.type === 'video') {
        wanted.add(clip.id);
        let video = videos.current.get(clip.id);
        if (!video) {
          video = document.createElement('video');
          video.preload = 'auto';
          video.playsInline = true;
          video.addEventListener('seeked', () => draw(latest.current.playhead));
          video.addEventListener('loadeddata', () => draw(latest.current.playhead));
          videos.current.set(clip.id, video);
        }
        if (video.dataset.src !== url) {
          video.src = url;
          video.dataset.src = url;
        }
      } else if (!images.current.has(clip.path)) {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => draw(latest.current.playhead);
        image.src = url;
        images.current.set(clip.path, image);
      }
    }
    for (const [id, video] of videos.current) {
      if (!wanted.has(id)) {
        video.pause();
        videos.current.delete(id);
      }
    }
    const musicUrl = plan.music ? urls.get(plan.music.path) : undefined;
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
    draw(latest.current.playhead);
    // `mediaKey` resume los clips y las direcciones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  useEffect(
    () => () => {
      for (const video of videos.current.values()) video.pause();
      audio.current?.pause();
    },
    [],
  );

  /** Coloca cada clip y la música en el segundo `t` (al reproducir, solo si se han desfasado). */
  function syncMedia(t: number, live: boolean) {
    const p = latest.current;
    const frame = frameAt(t, p.plan, p.timeline, p.template, { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
    const active = new Map(frame.layers.map((l) => [p.plan.clips[l.clip]!.id, l]));
    for (const clip of p.plan.clips) {
      if (clip.type !== 'video') continue;
      const video = videos.current.get(clip.id);
      if (!video) continue;
      const layer = active.get(clip.id);
      if (!layer || layer.sourceTime === null) {
        if (!video.paused) video.pause();
        continue;
      }
      video.volume = Math.min(1, Math.max(0, clip.volume));
      video.muted = clip.volume === 0 || !live;
      if (Math.abs(video.currentTime - layer.sourceTime) > (live ? MAX_DRIFT : 0.04)) {
        try {
          video.currentTime = layer.sourceTime;
        } catch {
          // Todavía sin datos: se colocará al cargar.
        }
      }
      if (live && video.paused) void video.play()?.catch(() => undefined);
      if (!live && !video.paused) video.pause();
    }
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
  }

  function draw(t: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    if (!canvas || !ctx) return;
    const p = latest.current;
    const W = PREVIEW_WIDTH;
    const H = PREVIEW_HEIGHT;
    const frame = frameAt(t, p.plan, p.timeline, p.template, { width: W, height: H });
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const layer of frame.layers) {
      const clip = p.plan.clips[layer.clip]!;
      const source: CanvasImageSource | undefined =
        clip.type === 'video' ? videos.current.get(clip.id) : images.current.get(clip.path);
      const sw0 =
        source instanceof HTMLVideoElement
          ? source.videoWidth
          : source instanceof HTMLImageElement
            ? source.naturalWidth
            : 0;
      const sh0 =
        source instanceof HTMLVideoElement
          ? source.videoHeight
          : source instanceof HTMLImageElement
            ? source.naturalHeight
            : 0;
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
      if (sigma > 0) ctx.filter = `blur(${sigma.toFixed(1)}px)`;
      ctx.drawImage(source, zx, zy, zw, zh, layer.dx * W, layer.dy * H, W, H);
      ctx.restore();
    }
    if (frame.black > 0) {
      ctx.fillStyle = `rgba(0,0,0,${frame.black.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    for (const item of [...frame.texts, ...frame.subtitles]) drawText(ctx, item, W, H, p.defaultFamily);
    ctx.restore();
  }

  // Reproducción: un bucle de fotogramas mientras `playing`.
  useEffect(() => {
    if (!playing) {
      syncMedia(playhead, false);
      draw(playhead);
      return;
    }
    let raf = 0;
    const startAt = playhead >= timeline.total - 0.05 ? 0 : playhead;
    clock.current = { base: startAt, started: performance.now(), lastTick: 0 };
    const tick = (now: number) => {
      const p = latest.current;
      const t = clock.current.base + (now - clock.current.started) / 1000;
      if (t >= p.timeline.total) {
        p.onTime(p.timeline.total);
        p.onPlayingChange(false);
        return;
      }
      syncMedia(t, true);
      draw(t);
      if (now - clock.current.lastTick > TICK_MS) {
        clock.current.lastTick = now;
        p.onTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      syncMedia(latest.current.playhead, false);
    };
    // Solo arranca o para; el resto se lee de `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Parado: cada cambio del cabezal o del montaje se vuelve a dibujar.
  useEffect(() => {
    if (playing) return;
    syncMedia(playhead, false);
    draw(playhead);
  }, [playhead, plan, timeline, playing, props.defaultFamily]);

  const max = props.maxSeconds ?? 90;
  const used = Math.min(1, timeline.total / max);
  return (
    <div className="space-y-2">
      <div className="relative mx-auto aspect-[9/16] h-[min(54svh,32rem)] max-w-full overflow-hidden rounded-xl bg-black shadow-card">
        <canvas
          ref={canvasRef}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          className="h-full w-full"
          role="img"
          aria-label="Vista previa del reel"
          data-testid="reel-preview"
        />
        {safeZones && (
          <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="reel-safe-zones">
            <div className="absolute inset-x-0 top-0 h-[12%] border-b border-dashed border-white/70 bg-red-500/25" />
            <div className="absolute inset-x-0 bottom-0 h-[22%] border-t border-dashed border-white/70 bg-red-500/25" />
            <div className="absolute bottom-[22%] right-0 top-[12%] w-[14%] border-l border-dashed border-white/70 bg-red-500/25" />
            <span className="absolute inset-x-0 top-[4%] text-center text-[10px] font-medium text-white">
              Lo tapa Instagram
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Volver al principio"
          onClick={() => {
            props.onPlayingChange(false);
            props.onTime(0);
          }}
        >
          <SkipBack className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          aria-label={playing ? 'Pausar la vista previa' : 'Reproducir la vista previa'}
          onClick={() => props.onPlayingChange(!playing)}
          disabled={timeline.total <= 0}
          data-testid="reel-play"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </Button>
        <span className="w-24 text-center text-sm tabular-nums" data-testid="reel-time">
          {fmt(Math.min(playhead, timeline.total))} / {fmt(timeline.total)} s
        </span>
        <Button
          variant={safeZones ? 'primary' : 'ghost'}
          size="icon"
          aria-label="Zonas que tapa Instagram"
          aria-pressed={safeZones}
          title="Zonas que tapa Instagram (arriba, abajo y a la derecha)"
          onClick={() => setSafeZones((v) => !v)}
          data-testid="reel-safe-toggle"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div
        className="mx-auto h-1.5 w-full max-w-[18rem] overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-label="Duración del reel"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(timeline.total * 10) / 10}
      >
        <div
          className={cn('h-full rounded-full', used >= 1 ? 'bg-danger' : used > 0.8 ? 'bg-warning' : 'bg-primary')}
          style={{ width: `${used * 100}%` }}
        />
      </div>
    </div>
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
