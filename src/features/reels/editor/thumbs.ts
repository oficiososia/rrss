// Fotogramas de los clips para la tira de miniaturas de la línea de tiempo.
//
// Cada fotograma se saca UNA vez (un <video> oculto por archivo, que salta al
// segundo pedido y se copia a un lienzo pequeño) y se guarda por archivo y
// segundo, así que ampliar la línea, recortar o dividir un clip reutiliza lo ya
// sacado. Se piden solo los de las tiras que están a la vista (lo decide quien
// llama, con IntersectionObserver) y de uno en uno, y la cola se para mientras
// se reproduce la vista previa para no quitarle el decodificador.
//
// El lienzo queda «manchado» si el archivo viene de otro origen sin CORS: da
// igual, porque solo se dibuja (nunca se lee de vuelta).

/** Tamaño de cada fotograma guardado (3:4, recortado al centro). */
export const FRAME_WIDTH = 72;
export const FRAME_HEIGHT = 96;
/** Los segundos se redondean a este paso: un fotograma sirve para cualquier zoom. */
export const FRAME_STEP = 0.5;
const MAX_FRAMES = 400;
const MAX_VIDEOS = 2;
const SEEK_TIMEOUT_MS = 5000;

type Listener = () => void;
interface Request {
  key: string;
  path: string;
  url: string;
  time: number;
}

const frames = new Map<string, HTMLCanvasElement>();
const waiting = new Map<string, Set<Listener>>();
const queue: Request[] = [];
const videos = new Map<string, HTMLVideoElement>();
const failed = new Set<string>();
let busy = false;
let paused = false;

/** Segundo del archivo al que corresponde un fotograma pedido en `time`. */
export const frameTime = (time: number) => Math.max(0, Math.round(time / FRAME_STEP) * FRAME_STEP);
export const frameKey = (path: string, time: number) => `${path}@${frameTime(time).toFixed(1)}`;

/** Para la cola mientras se reproduce (y la reanuda al parar). */
export function setThumbsPaused(value: boolean): void {
  paused = value;
  if (!paused) pump();
}

/** El fotograma si ya está sacado. */
export function cachedFrame(path: string, time: number): HTMLCanvasElement | null {
  return frames.get(frameKey(path, time)) ?? null;
}

/**
 * Pide un fotograma. Si ya está, lo devuelve; si no, lo encola y llama a `onReady`
 * cuando esté (para que la tira se vuelva a dibujar). Devuelve cómo dejar de esperar.
 */
export function requestFrame(path: string, url: string, time: number, onReady: Listener): () => void {
  const key = frameKey(path, time);
  if (frames.has(key) || failed.has(path) || typeof document === 'undefined') return () => undefined;
  let listeners = waiting.get(key);
  if (!listeners) {
    listeners = new Set();
    waiting.set(key, listeners);
    queue.push({ key, path, url, time: frameTime(time) });
  }
  listeners.add(onReady);
  pump();
  return () => {
    waiting.get(key)?.delete(onReady);
  };
}

function videoFor(request: Request): HTMLVideoElement {
  let video = videos.get(request.path);
  if (video) {
    // Lo más reciente, al final: se suelta el que lleva más sin usarse.
    videos.delete(request.path);
    videos.set(request.path, video);
    return video;
  }
  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = request.url;
  videos.set(request.path, video);
  while (videos.size > MAX_VIDEOS) {
    const [oldest, element] = videos.entries().next().value as [string, HTMLVideoElement];
    element.removeAttribute('src');
    element.load();
    videos.delete(oldest);
  }
  return video;
}

function seek(video: HTMLVideoElement, time: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadeddata', onLoaded);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    const go = () => {
      const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration - 0.05 : time;
      const target = Math.max(0, Math.min(time, limit));
      if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) finish(true);
      else video.currentTime = target;
    };
    const onLoaded = () => go();
    const timer = window.setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    if (video.readyState >= 1) go();
    else video.addEventListener('loadeddata', onLoaded);
  });
}

function capture(video: HTMLVideoElement): HTMLCanvasElement | null {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH;
  canvas.height = FRAME_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // Recorte centrado que cubre el fotograma.
  const scale = Math.max(FRAME_WIDTH / w, FRAME_HEIGHT / h);
  const sw = FRAME_WIDTH / scale;
  const sh = FRAME_HEIGHT / scale;
  ctx.drawImage(video, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  return canvas;
}

function pump(): void {
  if (busy || paused) return;
  // Lo pedido lo último es lo que está a la vista ahora.
  let request = queue.pop();
  while (request && (waiting.get(request.key)?.size ?? 0) === 0) {
    waiting.delete(request.key);
    request = queue.pop();
  }
  if (!request) return;
  const current = request;
  busy = true;
  void (async () => {
    try {
      const video = videoFor(current);
      const ok = await seek(video, current.time);
      const frame = ok ? capture(video) : null;
      if (frame) {
        frames.set(current.key, frame);
        if (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value as string);
      } else if (video.error) {
        // El navegador no puede con este archivo: no se insiste.
        failed.add(current.path);
      }
    } finally {
      const listeners = waiting.get(current.key);
      waiting.delete(current.key);
      busy = false;
      for (const listener of listeners ?? []) listener();
      window.setTimeout(pump, 0);
    }
  })();
}

/** Segundos del archivo de cada casilla de una tira de `tiles` casillas sobre el tramo [from, to]. */
export function stripTimes(from: number, to: number, tiles: number): number[] {
  const n = Math.max(1, Math.floor(tiles));
  return Array.from({ length: n }, (_, i) => frameTime(from + ((i + 0.5) / n) * Math.max(0, to - from)));
}
