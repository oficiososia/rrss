// «Hacer un reel como este»: mide un vídeo de referencia SIN IA
// (`media.reel.analyze`, docs/reel-como-este.md).
//
//   * duración, tamaño y fotogramas por segundo (ffprobe);
//   * cortes y transiciones → planos con su duración (FFmpeg `scdet`);
//   * un fotograma por plano (JPEG pequeño) para que después los mire el modelo
//     de visión; aquí no se reconoce nada de lo que sale en ellos;
//   * sonido: volumen a lo largo del tiempo, golpes y tempo, y cómo caen los
//     cortes respecto al compás; si se pide, trozos de sonido para transcribir.
//
// El vídeo de referencia SOLO se mide: de él no sale ningún recurso para la
// biblioteca. Si llegó por enlace, se baja a la carpeta temporal del trabajo y
// nunca se guarda. Los fotogramas y los trozos de sonido van a la carpeta
// privada del análisis (`<org>/<marca>/referencias/<id>/`), que el servidor
// borra en cuanto termina la parte de IA.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { chunkSegments, loudnessEnvelope, rhythmOfCuts, SILENT_PEAK, soundSegments } from '../analyze/audio.ts';
import { downloadReference, siteName } from '../analyze/download.ts';
import { ANALYSIS_RATE, detectBeats, MIN_CONFIDENCE } from '../analyze/rhythm.ts';
import { buildShots, detectCuts, parseScdet, pickFrameTimes } from '../analyze/scenes.ts';
import { PermanentError } from '../errors.ts';
import type { NetPolicy } from '../extract/net.ts';
import { probeMedia } from '../ffmpeg/probe.ts';
import { num, runFfmpeg } from '../ffmpeg/run.ts';
import type { Handler } from '../handler.ts';
import type { JsonObject } from '../queue.ts';
import { assertOutputPaths, fetchInput, parsePayload, storagePathSchema, storeOutput, type MediaDeps } from './shared.ts';

export const REEL_ANALYZE_KIND = 'media.reel.analyze';

/** Topes del análisis. Los mismos números salen en la pantalla y en docs/reel-como-este.md. */
export const REEL_ANALYZE_LIMITS = {
  /** Duración máxima del vídeo de referencia. */
  maxSeconds: 180,
  /** Peso máximo del vídeo bajado de un enlace (el de un archivo subido lo limita el almacenamiento). */
  maxDownloadBytes: 50 * 1024 * 1024,
  /** Planos como mucho (el máximo de elementos de un reel del editor). */
  maxShots: 30,
  /** Fotogramas que se guardan para el modelo de visión. */
  maxFrames: 12,
  /** Lado mayor de cada fotograma. */
  frameSize: 512,
  /** Sonido que se prepara para transcribir. */
  speech: { maxChunkSeconds: 20, maxTotalSeconds: 120, maxChunks: 12 },
} as const;

export const reelAnalyzePayloadSchema = z.strictObject({
  /** Análisis al que pertenece (`reel_references.id`). */
  reference: z.strictObject({ id: z.uuid() }),
  /** El archivo subido (ruta privada de la marca) o el enlace pegado. */
  source: z.union([z.strictObject({ path: storagePathSchema }), z.strictObject({ url: z.string().min(8).max(2000) })]),
  /** ¿Preparar el sonido para transcribir lo que se dice? */
  speech: z.boolean().default(false),
  /** Carpeta privada del análisis, la pone la base de datos. */
  output: z.strictObject({ dir: storagePathSchema }),
});
export type ReelAnalyzePayload = z.input<typeof reelAnalyzePayloadSchema>;

export interface ReelAnalyzeDeps extends MediaDeps {
  /** Política de red para bajar enlaces (en pruebas, un servidor local). */
  netPolicy?: NetPolicy;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function createReelAnalyzeHandler(deps: ReelAnalyzeDeps): Handler {
  return {
    kind: REEL_ANALYZE_KIND,
    async run(context) {
      const payload = parsePayload(reelAnalyzePayloadSchema, context.job.payload);
      const limits = REEL_ANALYZE_LIMITS;
      const dir = payload.output.dir.replace(/\/+$/, '');
      assertOutputPaths(context, [`${dir}/f-01.jpg`]);
      const run = (args: string[]) => runFfmpeg(deps.tools, args, { signal: context.signal });
      const warnings: string[] = [];

      // 1. El archivo: subido o bajado del enlace (a la carpeta temporal).
      const downloadStarted = Date.now();
      let file: string;
      let origin: JsonObject;
      if ('url' in payload.source) {
        file = path.join(context.workDir, 'referencia');
        const downloaded = await downloadReference(payload.source.url, file, {
          policy: deps.netPolicy,
          maxBytes: limits.maxDownloadBytes,
          timeoutMs: 90_000,
          signal: context.signal,
        });
        origin = { kind: 'link', host: downloaded.host, site: siteName(downloaded.host), via: downloaded.via };
      } else {
        file = await fetchInput(context, payload.source.path, 'referencia');
        origin = { kind: 'upload' };
      }
      const downloadMs = Date.now() - downloadStarted;

      // 2. Qué es.
      const analyzeStarted = Date.now();
      const info = await probeMedia(deps.tools, file, context.signal);
      if (!info.video || info.durationSeconds <= 0) {
        throw new PermanentError('El archivo no es un vídeo. Sube un MP4, MOV o WebM.');
      }
      if (info.durationSeconds < 1) throw new PermanentError('El vídeo dura menos de un segundo: no hay nada que estudiar.');
      if (info.durationSeconds > limits.maxSeconds + 0.5) {
        throw new PermanentError(
          `El vídeo dura ${Math.round(info.durationSeconds)} s y el máximo son ${limits.maxSeconds} s (3 minutos). Recórtalo y vuelve a subirlo.`,
        );
      }
      const { video } = info;
      const duration = info.durationSeconds;

      // 3. Cortes y planos. A poca resolución y, como mucho, a 30 fotogramas por segundo.
      const scdet = await run([
        '-i',
        file,
        '-an',
        '-vf',
        `${video.fps > 31 ? 'fps=30,' : ''}scale=160:-2,scdet=threshold=10,metadata=print:file=-`,
        '-f',
        'null',
        '-',
      ]);
      const frames = parseScdet(scdet);
      const cuts = detectCuts(frames);
      const { shots, truncated } = buildShots(cuts, duration, frames, { maxShots: limits.maxShots });
      if (truncated) {
        warnings.push(
          `El vídeo tiene más de ${limits.maxShots} cortes: se han dejado los ${limits.maxShots - 1} más claros.`,
        );
      }
      if (frames.length === 0) warnings.push('No se han podido medir los cortes: se trata como un solo plano.');

      // 4. Sonido: volumen, compás y, si se pide, trozos para transcribir.
      let audio: JsonObject = { present: false };
      let speechChunks: Array<{ start: number; end: number }> = [];
      if (info.audio) {
        const raw = path.join(context.workDir, 'sonido.f32');
        await run(['-i', file, '-vn', '-ac', '1', '-ar', String(ANALYSIS_RATE), '-t', num(limits.maxSeconds), '-f', 'f32le', raw]);
        const bytes = await readFile(raw);
        const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
        const loudness = loudnessEnvelope(samples, ANALYSIS_RATE);
        if (loudness.peak < SILENT_PEAK) {
          audio = { present: true, silent: true };
        } else {
          const beats = detectBeats(samples, ANALYSIS_RATE, limits.maxSeconds);
          const steady = beats.confidence >= MIN_CONFIDENCE;
          const cutTimes = shots.slice(1).map((shot) => shot.start);
          const segments = soundSegments(samples, ANALYSIS_RATE);
          audio = {
            present: true,
            silent: false,
            energy: loudness.energy,
            energyWindowSeconds: 0.5,
            bpm: steady ? beats.bpm : null,
            confidence: beats.confidence,
            beats: steady ? beats.beats.slice(0, 600) : [],
            ...(steady ? rhythmOfCuts(cutTimes, beats.beats, beats.bpm) : { cutsOnBeat: 0, beatsPerCut: null }),
            // Parte del vídeo en la que suena algo (no distingue la voz de la música).
            soundSeconds: Number(segments.reduce((sum, s) => sum + (s.end - s.start), 0).toFixed(2)),
          };
          if (payload.speech) {
            const chunked = chunkSegments(segments, limits.speech);
            speechChunks = chunked.chunks;
            if (chunked.truncated) {
              warnings.push(
                `Solo se prepara para transcribir el sonido de los primeros ${limits.speech.maxTotalSeconds} s con sonido.`,
              );
            }
          }
        }
      }

      // 5. Fotogramas para el modelo de visión (uno por plano; no se reconoce nada aquí).
      const picks = pickFrameTimes(shots, limits.maxFrames);
      const frameFiles: Array<{ local: string; object: string; at: number; shot: number }> = [];
      for (const [index, pick] of picks.entries()) {
        const local = path.join(context.workDir, `f-${pad(index + 1)}.jpg`);
        const at = Math.min(pick.at, Math.max(0, duration - 0.05));
        await run([
          '-ss',
          num(at),
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          `scale='min(${limits.frameSize},iw)':'min(${limits.frameSize},ih)':force_original_aspect_ratio=decrease`,
          '-c:v',
          'mjpeg',
          '-q:v',
          '5',
          local,
        ]);
        frameFiles.push({ local, object: `${dir}/f-${pad(index + 1)}.jpg`, at, shot: pick.shot });
      }
      const speechFiles: Array<{ local: string; object: string; start: number; seconds: number }> = [];
      for (const [index, chunk] of speechChunks.entries()) {
        const local = path.join(context.workDir, `a-${pad(index + 1)}.m4a`);
        const seconds = chunk.end - chunk.start;
        await run([
          '-ss',
          num(chunk.start),
          '-t',
          num(seconds),
          '-i',
          file,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'aac',
          '-b:a',
          '48k',
          local,
        ]);
        speechFiles.push({ local, object: `${dir}/a-${pad(index + 1)}.m4a`, start: chunk.start, seconds });
      }
      const analyzeMs = Date.now() - analyzeStarted;

      // 6. A la carpeta privada del análisis.
      const uploadStarted = Date.now();
      const storedFrames: JsonObject[] = [];
      for (const frame of frameFiles) {
        const bytes = await storeOutput(context, frame.local, frame.object, 'image/jpeg');
        storedFrames.push({ path: frame.object, at: Number(frame.at.toFixed(3)), shot: frame.shot, bytes });
      }
      const storedSpeech: JsonObject[] = [];
      for (const chunk of speechFiles) {
        const bytes = await storeOutput(context, chunk.local, chunk.object, 'audio/mp4');
        storedSpeech.push({
          path: chunk.object,
          start: Number(chunk.start.toFixed(2)),
          seconds: Number(chunk.seconds.toFixed(2)),
          bytes,
        });
      }
      const uploadMs = Date.now() - uploadStarted;

      return {
        reference: { id: payload.reference.id },
        source: {
          ...origin,
          durationSeconds: Number(duration.toFixed(3)),
          width: video.width,
          height: video.height,
          fps: Number(video.fps.toFixed(3)),
          hasAudio: Boolean(info.audio),
          bytes: (await stat(file)).size,
        },
        shots: shots as unknown as JsonObject[],
        frames: storedFrames,
        audio: { ...audio, speech: storedSpeech },
        warnings,
        timings: { downloadMs, analyzeMs, uploadMs },
      };
    },
  };
}
