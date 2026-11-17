// Motor del reel por plantilla: convierte plantilla + plan (ya con los
// archivos en disco y sus duraciones medidas) en una orden de FFmpeg.
//
// Es una función pura —no toca disco ni lanza procesos—, así que se prueba
// sin FFmpeg. Trampas que evita:
//  * Rutas y textos NO viajan dentro del grafo de filtros: FFmpeg se ejecuta
//    en la carpeta del trabajo y todo se nombra con rutas relativas simples;
//    el texto va en archivos (`textfile`). Así no hay que escapar «C:\…», ni
//    dos puntos, comas, comillas o «%» (en Windows es donde más duele).
//  * Cada línea de texto es un `drawtext` propio y centrado: no depende de
//    `text_align`, que solo existe en versiones recientes.
//  * Las fotos se giran aquí según su EXIF, con `-noautorotate`.
//  * Las fotos JPEG vienen en rango completo de color; se pasan a rango de
//    vídeo (`out_range=tv`) para que el H.264 salga en `yuv420p` normal.
import { PermanentError } from '../errors.ts';
import { orientationFilters } from '../ffmpeg/exif.ts';
import { num } from '../ffmpeg/run.ts';
import { CENTER, focalCropExpr, h264Args, type FocalPoint } from '../handlers/shared.ts';
import type { ReelTemplate } from './schema.ts';

export type ResolvedMedia =
  | { type: 'photo'; file: string; orientation: number; focalPoint?: FocalPoint; seconds?: number }
  | {
      type: 'video';
      file: string;
      focalPoint?: FocalPoint;
      startAt: number;
      seconds?: number;
      /** Duración real del clip y si trae sonido, según ffprobe. */
      durationSeconds: number;
      hasAudio: boolean;
    };

export interface ResolvedText {
  text: string;
  start: number;
  end: number;
  position?: 'top' | 'center' | 'bottom';
}

export interface ReelBuildInput {
  template: ReelTemplate;
  media: ResolvedMedia[];
  texts: ResolvedText[];
  music?: { file: string; startAt: number; volume?: number };
  /** Archivo de tipografía (relativo a la carpeta de trabajo). Obligatorio si hay textos. */
  fontFile?: string;
  /** Ancho de salida; por defecto, el del lienzo. */
  outputWidth?: number;
  outputFile: string;
}

export interface TimelineSegment {
  index: number;
  type: 'photo' | 'video';
  /** Segundo del reel en el que empieza a verse. */
  start: number;
  seconds: number;
}

export interface ReelBuild {
  /** Argumentos de FFmpeg (sin el nombre del programa). */
  args: string[];
  filterGraph: string;
  /** Archivos de texto que hay que escribir en la carpeta de trabajo antes de lanzar FFmpeg. */
  textFiles: Array<{ name: string; content: string }>;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  transitionSeconds: number;
  timeline: TimelineSegment[];
  warnings: string[];
}

/** Las fotos se preparan al doble del lienzo para que el zoom no tiemble. */
const SUPERSAMPLE = 2;
const MOTION_CYCLE = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'] as const;
const MIN_SEGMENT_SECONDS = 0.5;
const MAX_TEXT_LINES = 6;
/** Ancho medio de un carácter respecto al tamaño de letra, para partir líneas. */
const AVERAGE_GLYPH_WIDTH = 0.56;

const hex = (color: string, opacity = 1) =>
  `0x${color.slice(1).toUpperCase()}${opacity < 1 ? `@${num(opacity, 2)}` : ''}`;

/** Parte un texto en líneas que quepan en el ancho dado. Respeta los saltos de línea. */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  // Sin caracteres de control: un salto dentro de `textfile` se dibujaría como un recuadro.
  const clean = text.replace(/\r/g, '').replace(/[^\S\n]+/g, ' ');
  for (const paragraph of clean.split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(' ')) {
      if (!word) continue;
      if (line && line.length + 1 + word.length > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function buildReel(input: ReelBuildInput): ReelBuild {
  const { template, media, texts } = input;
  const warnings: string[] = [];
  const fps = template.canvas.fps;
  const width = input.outputWidth ?? template.canvas.width;
  if (width > template.canvas.width) throw new PermanentError('El ancho de salida no puede superar el del lienzo');
  const height = Math.round((width * 16) / 9 / 2) * 2;
  const frames = (seconds: number) => Math.max(1, Math.round(seconds * fps));
  const snap = (seconds: number) => frames(seconds) / fps;

  // ── Línea de tiempo ──────────────────────────────────────────────────
  const durations = media.map((item, index) => {
    if (item.type === 'photo') return snap(item.seconds ?? template.timing.photoSeconds);
    const available = item.durationSeconds - item.startAt;
    if (available < MIN_SEGMENT_SECONDS) {
      throw new PermanentError(`El clip ${index + 1} no tiene ${MIN_SEGMENT_SECONDS} s a partir del segundo ${item.startAt}`);
    }
    // Por debajo, para no pedir fotogramas que el clip no tiene.
    return Math.floor(Math.min(item.seconds ?? template.timing.maxClipSeconds, available) * fps) / fps;
  });
  const shortest = Math.min(...durations);
  const transition =
    template.transition.type === 'cut' || media.length === 1
      ? 0
      : Math.floor(Math.min(template.transition.seconds, shortest / 2) * fps) / fps;
  const timeline: TimelineSegment[] = [];
  let cursor = 0;
  durations.forEach((seconds, index) => {
    timeline.push({ index, type: media[index]!.type, start: Number(cursor.toFixed(4)), seconds });
    cursor += seconds - transition;
  });
  const total = Number((cursor + transition).toFixed(4));
  if (total > template.timing.maxTotalSeconds + 1e-6) {
    throw new PermanentError(
      `El reel duraría ${num(total, 2)} s y la plantilla admite ${template.timing.maxTotalSeconds} s como máximo`,
    );
  }

  // ── Entradas ─────────────────────────────────────────────────────────
  const args: string[] = [];
  const chains: string[] = [];
  const crop = (w: number, h: number, focal: FocalPoint = CENTER) =>
    `crop=${w}:${h}:${focalCropExpr('w', w, focal.x)}:${focalCropExpr('h', h, focal.y)}`;
  const finish = 'setsar=1,format=yuv420p,settb=AVTB';
  let photoCount = 0;

  media.forEach((item, index) => {
    const seconds = durations[index]!;
    if (item.type === 'photo') {
      args.push('-noautorotate', '-i', item.file);
      const sw = width * SUPERSAMPLE;
      const sh = height * SUPERSAMPLE;
      const count = frames(seconds);
      const progress = `on/${Math.max(1, count - 1)}`;
      const amount = num(template.photoMotion.amount);
      const kind =
        template.photoMotion.type === 'alternate'
          ? MOTION_CYCLE[photoCount % MOTION_CYCLE.length]!
          : template.photoMotion.type;
      photoCount += 1;
      const centerX = 'iw/2-(iw/zoom/2)';
      const centerY = 'ih/2-(ih/zoom/2)';
      const motion = {
        none: { z: '1', x: centerX },
        'zoom-in': { z: `1+${amount}*${progress}`, x: centerX },
        'zoom-out': { z: `1+${amount}-${amount}*${progress}`, x: centerX },
        'pan-right': { z: `1+${amount}`, x: `(iw-iw/zoom)*${progress}` },
        'pan-left': { z: `1+${amount}`, x: `(iw-iw/zoom)*(1-${progress})` },
      }[kind];
      chains.push(
        `[${index}:v]${[
          // Un solo fotograma, aunque el archivo sea una imagen animada.
          'trim=end_frame=1',
          ...orientationFilters(item.orientation),
          `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos:out_range=tv`,
          crop(sw, sh, item.focalPoint),
          `zoompan=z='${motion.z}':x='${motion.x}':y='${centerY}':d=${count}:s=${width}x${height}:fps=${fps}`,
          `trim=duration=${num(seconds)}`,
          finish,
        ].join(',')}[v${index}]`,
      );
    } else {
      args.push('-ss', num(item.startAt), '-t', num(seconds + 1), '-i', item.file);
      chains.push(
        `[${index}:v]${[
          `fps=${fps}`,
          `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=bicubic:out_range=tv`,
          crop(width, height, item.focalPoint),
          // Si al clip le falta algún fotograma al final, se repite el último.
          'tpad=stop_mode=clone:stop_duration=1',
          `trim=duration=${num(seconds)}`,
          'setpts=PTS-STARTPTS',
          finish,
        ].join(',')}[v${index}]`,
      );
    }
  });

  // ── Unión de las piezas: corte o fundido ─────────────────────────────
  let videoLabel = 'v0';
  if (media.length > 1 && transition === 0) {
    chains.push(`${media.map((_, i) => `[v${i}]`).join('')}concat=n=${media.length}:v=1:a=0[joined]`);
    videoLabel = 'joined';
  } else if (media.length > 1) {
    for (let i = 1; i < media.length; i += 1) {
      const out = `x${i}`;
      chains.push(
        `[${videoLabel}][v${i}]xfade=transition=${template.transition.type}:duration=${num(transition)}:offset=${num(timeline[i]!.start)}[${out}]`,
      );
      videoLabel = out;
    }
  }

  // ── Texto superpuesto ────────────────────────────────────────────────
  const textFiles: ReelBuild['textFiles'] = [];
  const draws: string[] = [];
  const style = template.text;
  const fontSize = Math.max(8, Math.round(style.sizeRatio * width));
  const lineStep = Math.round(fontSize * style.lineHeight);
  const maxChars = Math.max(4, Math.floor((style.maxWidthRatio * width) / (fontSize * AVERAGE_GLYPH_WIDTH)));
  texts.forEach((item, index) => {
    const start = Math.min(item.start, total);
    const end = Math.min(item.end, total);
    if (end - start < 0.1) {
      warnings.push(`El texto ${index + 1} queda fuera del vídeo (${num(total, 2)} s) y no se ha puesto`);
      return;
    }
    if (item.end > total + 0.05) warnings.push(`El texto ${index + 1} se ha recortado al final del vídeo`);
    let lines = wrapText(item.text, maxChars);
    if (lines.length === 0) return;
    if (lines.length > MAX_TEXT_LINES) {
      lines = lines.slice(0, MAX_TEXT_LINES);
      warnings.push(`El texto ${index + 1} no cabe: se han dejado ${MAX_TEXT_LINES} líneas`);
    }
    const block = lineStep * (lines.length - 1) + fontSize;
    const margin = Math.round(style.marginRatio * height);
    const position = item.position ?? style.position;
    const top = position === 'top' ? margin : position === 'center' ? Math.round((height - block) / 2) : height - margin - block;
    const fade = Math.min(style.fadeSeconds, (end - start) / 2);
    lines.forEach((line, lineIndex) => {
      const name = `text-${index}-${lineIndex}.txt`;
      textFiles.push({ name, content: line });
      const options = [
        `fontfile=${input.fontFile}`,
        `textfile=${name}`,
        'expansion=none',
        `fontsize=${fontSize}`,
        `fontcolor=${hex(style.color)}`,
        'x=(w-text_w)/2',
        `y=${top + lineIndex * lineStep}`,
        `enable='between(t,${num(start)},${num(end)})'`,
      ];
      if (style.box) {
        options.push(
          'box=1',
          `boxcolor=${hex(style.box.color, style.box.opacity)}`,
          `boxborderw=${Math.round(style.box.paddingRatio * fontSize)}`,
        );
      }
      if (style.outline) {
        options.push(
          `borderw=${Math.max(1, Math.round(style.outline.widthRatio * fontSize))}`,
          `bordercolor=${hex(style.outline.color)}`,
        );
      }
      if (fade >= 0.02) {
        const f = num(fade);
        options.push(
          `alpha='if(lt(t,${num(start + fade)}),(t-${num(start)})/${f},if(gt(t,${num(end - fade)}),(${num(end)}-t)/${f},1))'`,
        );
      }
      draws.push(`drawtext=${options.join(':')}`);
    });
  });
  if (draws.length > 0 && !input.fontFile) {
    throw new Error('Hay textos pero el trabajador no tiene ninguna tipografía (WORKER_FONT_FILE)');
  }
  chains.push(`[${videoLabel}]${[...draws, 'format=yuv420p'].join(',')}[vout]`);

  // ── Sonido: silencio de base + música atenuada + sonido de los clips ──
  const audioFormat = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const mix: string[] = [];
  let nextInput = media.length;
  args.push('-f', 'lavfi', '-t', num(total), '-i', 'anullsrc=r=48000:cl=stereo');
  chains.push(`[${nextInput}:a]${audioFormat}[abase]`);
  mix.push('[abase]');
  nextInput += 1;

  if (input.music) {
    const volume = input.music.volume ?? template.audio.musicVolume;
    const fadeIn = Math.min(template.audio.fadeInSeconds, total / 2);
    const fadeOut = Math.min(template.audio.fadeOutSeconds, total / 2);
    args.push('-stream_loop', '-1', '-i', input.music.file);
    const filters = [
      `atrim=start=${num(input.music.startAt)}:end=${num(input.music.startAt + total)}`,
      'asetpts=PTS-STARTPTS',
      audioFormat,
      `volume=${num(volume, 3)}`,
    ];
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${num(fadeIn)}`);
    if (fadeOut > 0) filters.push(`afade=t=out:st=${num(total - fadeOut)}:d=${num(fadeOut)}`);
    chains.push(`[${nextInput}:a]${filters.join(',')}[amusic]`);
    mix.push('[amusic]');
    nextInput += 1;
  }

  if (template.audio.clipVolume > 0) {
    media.forEach((item, index) => {
      if (item.type !== 'video' || !item.hasAudio) return;
      const seconds = durations[index]!;
      // Fundido corto en los extremos: con la transición, o mínimo para que no chasquee.
      const edge = Math.min(Math.max(transition, 0.03), seconds / 2);
      const filters = [
        `atrim=duration=${num(seconds)}`,
        'asetpts=PTS-STARTPTS',
        audioFormat,
        `volume=${num(template.audio.clipVolume, 3)}`,
        `afade=t=in:st=0:d=${num(edge)}`,
        `afade=t=out:st=${num(seconds - edge)}:d=${num(edge)}`,
      ];
      const delay = Math.round(timeline[index]!.start * 1000);
      if (delay > 0) filters.push(`adelay=${delay}:all=1`);
      chains.push(`[${index}:a]${filters.join(',')}[aclip${index}]`);
      mix.push(`[aclip${index}]`);
    });
  }
  chains.push(
    mix.length === 1
      ? `${mix[0]}anull[aout]`
      : `${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0[aout]`,
  );

  const filterGraph = chains.join(';\n');
  args.push(
    '-filter_complex', filterGraph, '-map', '[vout]', '-map', '[aout]',
    ...h264Args({ crf: template.export.crf, preset: template.export.preset }),
    '-r', String(fps), '-c:a', 'aac', '-b:a', `${template.export.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2',
    '-t', num(total), input.outputFile,
  ); // prettier-ignore

  return {
    args,
    filterGraph,
    textFiles,
    width,
    height,
    fps,
    durationSeconds: total,
    transitionSeconds: transition,
    timeline,
    warnings,
  };
}
