// Reel por plantilla: fotos y clips reales + textos con tiempos + música
// opcional → vídeo vertical 9:16 en H.264, montado con FFmpeg.
import { existsSync } from 'node:fs';
import { copyFile, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PermanentError } from '../errors.ts';
import { orientationFilters, orientationSwapsAxes, takeJpegOrientation } from '../ffmpeg/exif.ts';
import { findLabelFont } from '../ffmpeg/fonts.ts';
import { readFontMetrics, type FontMetrics } from '../ffmpeg/fontmetrics.ts';
import { probeMedia } from '../ffmpeg/probe.ts';
import { num, runFfmpeg } from '../ffmpeg/run.ts';
import type { Handler, HandlerContext } from '../handler.ts';
import { buildReel, type ResolvedClip, type ResolvedOutro, type ResolvedPlan } from '../reel/build.ts';
import { planAsV2, reelPayloadSchema, type ReelTemplate } from '../reel/schema.ts';
import { detectSubject, subjectFromMask, type Subject } from '../reel/subject.ts';
import { findTemplate, loadTemplates } from '../reel/templates.ts';
import {
  assertOutputPaths,
  CENTER,
  fetchInput,
  focalCropExpr,
  parsePayload,
  storeOutput,
  type MediaDeps,
} from './shared.ts';

export const REEL_TEMPLATE_KIND = 'media.reel.template';

const FONT_NAME = 'font.ttf';
const LABEL_FONT_NAME = 'font-label.ttf';

/** Firma de un archivo TrueType u OpenType (lo que lee FFmpeg con FreeType sin sorpresas). */
export function isTrueTypeOrOpenType(head: Uint8Array): boolean {
  if (head.length < 4) return false;
  const tag = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!);
  return (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) || ['OTTO', 'true', 'ttcf'].includes(tag);
}

/** De dónde sale la tipografía de los textos del reel. */
export type ReelFontSource = 'brand' | 'template' | 'default' | 'none';

async function readHead(file: string): Promise<Uint8Array> {
  const handle = await open(file, 'r');
  const head = new Uint8Array(4);
  try {
    await handle.read(head, 0, 4, 0);
  } finally {
    await handle.close();
  }
  return head;
}

/** Baja la tipografía propia de un texto; null si el archivo no es TrueType ni OpenType. */
async function prepareOwnFont(context: HandlerContext, fontPath: string, index: number): Promise<string | null> {
  const file = await fetchInput(context, fontPath, `text-font-${index}`);
  if (!isTrueTypeOrOpenType(await readHead(file))) return null;
  const name = `font-${index}.ttf`;
  await copyFile(file, path.join(context.workDir, name));
  return name;
}

/** Deja la tipografía en la carpeta de trabajo y devuelve su nombre relativo y su origen. */
async function prepareFont(
  context: HandlerContext,
  deps: MediaDeps,
  template: ReelTemplate,
  brandFontPath: string | undefined,
): Promise<{ file?: string; source: ReelFontSource; warning?: string }> {
  const target = path.join(context.workDir, FONT_NAME);
  let warning: string | undefined;
  if (brandFontPath) {
    // fetchInput comprueba que la ruta es de la marca del trabajo.
    const file = await fetchInput(context, brandFontPath, 'brand-font');
    if (isTrueTypeOrOpenType(await readHead(file))) {
      await copyFile(file, target);
      return { file: FONT_NAME, source: 'brand' };
    }
    warning = 'El archivo de la tipografía de la marca no es TrueType ni OpenType: se usa la de reserva';
  }
  let source = deps.defaultFontFile;
  let origin: ReelFontSource = 'default';
  if (template.text.font !== 'default') {
    const installed = ['.ttf', '.otf']
      .map((extension) => path.join(deps.fontsDir ?? '', `${template.text.font}${extension}`))
      .find((file) => deps.fontsDir && existsSync(file));
    if (!installed) {
      throw new PermanentError(`La tipografía «${template.text.font}» no está instalada en el trabajador`);
    }
    source = installed;
    origin = 'template';
  }
  if (!source || !existsSync(source)) return { source: 'none', warning };
  await copyFile(source, target);
  return { file: FONT_NAME, source: origin, warning };
}

export function createReelTemplateHandler(deps: MediaDeps): Handler {
  const templates = loadTemplates();
  return {
    kind: REEL_TEMPLATE_KIND,
    async run(context) {
      const payload = parsePayload(reelPayloadSchema, context.job.payload);
      assertOutputPaths(context, [payload.output.path, payload.output.posterPath]);
      const template =
        'schemaVersion' in payload.template ? payload.template : findTemplate(templates, payload.template.id);
      const isV2 = 'version' in payload.plan;
      const plan = planAsV2(payload.plan, template);

      // ── Bajar y medir los elementos ────────────────────────────────────
      const downloadStartedAt = Date.now();
      const clips: ResolvedClip[] = [];
      const subjectWarnings: string[] = [];
      for (const [index, item] of plan.clips.entries()) {
        const file = await fetchInput(context, item.path, `media-${index}`);
        const orientation = item.type === 'photo' ? await takeJpegOrientation(file) : 1;
        const info = await probeMedia(deps.tools, file, context.signal);
        if (!info.video) throw new PermanentError(`La pieza ${index + 1} no tiene imagen`);
        const name = path.basename(file);
        if (item.type === 'photo') {
          const swap = orientationSwapsAxes(orientation);
          const sourceSize = {
            width: swap ? info.video.height : info.video.width,
            height: swap ? info.video.width : info.video.height,
          };
          // Lo principal de la foto: la máscara del recorte si la hay; si no, saliencia.
          let subject: Subject | null = null;
          if (item.subjectMaskPath) {
            const mask = await fetchInput(context, item.subjectMaskPath, `mask-${index}`);
            subject = await subjectFromMask(mask, sourceSize.width / sourceSize.height);
            if (!subject) subjectWarnings.push(`La máscara de la pieza ${index + 1} no es de esa foto: se encuadra sola`);
          }
          if (!subject) subject = await detectSubject(file, orientation);
          clips.push({
            type: 'photo',
            file: name,
            orientation,
            focalPoint: item.focalPoint,
            blur: item.blur,
            seconds: item.seconds,
            motion: item.motion,
            motionAmount: item.motionAmount,
            transition: item.transition,
            filter: item.filter,
            sourceSize,
            subject,
          });
        } else {
          if (info.durationSeconds <= 0) throw new PermanentError(`La pieza ${index + 1} no es un vídeo`);
          clips.push({
            type: 'video',
            file: name,
            focalPoint: item.focalPoint,
            blur: item.blur,
            in: item.in,
            out: item.out,
            volume: item.volume,
            speed: item.speed,
            filter: item.filter,
            transition: item.transition,
            subtitles: item.subtitles,
            durationSeconds: info.durationSeconds,
            hasAudio: Boolean(info.audio),
          });
        }
      }
      let music: ResolvedPlan['music'];
      if (plan.music) {
        const file = await fetchInput(context, plan.music.path, 'music');
        const info = await probeMedia(deps.tools, file, context.signal);
        if (!info.audio) throw new PermanentError('El archivo de música no tiene sonido');
        if (plan.music.startAt >= info.durationSeconds) {
          throw new PermanentError('La música empieza después de su propio final');
        }
        music = {
          file: path.basename(file),
          startAt: plan.music.startAt,
          volume: plan.music.volume,
          fadeInSeconds: plan.music.fadeInSeconds,
          fadeOutSeconds: plan.music.fadeOutSeconds,
        };
      }
      const hasSubtitles =
        plan.subtitles?.enabled === true &&
        plan.clips.some((c) => c.type === 'video' && (c.subtitles?.length ?? 0) > 0);
      // Cierre con la marca: el logotipo se baja (y se gira) como una foto más.
      let outro: ResolvedOutro | null = null;
      if (plan.outro) {
        let logo: ResolvedOutro['logo'] = null;
        if (plan.outro.logoPath) {
          const file = await fetchInput(context, plan.outro.logoPath, 'logo');
          const orientation = await takeJpegOrientation(file);
          const info = await probeMedia(deps.tools, file, context.signal);
          if (!info.video) throw new PermanentError('El logotipo del cierre no es una imagen');
          logo = { file: path.basename(file), orientation };
        }
        outro = { ...plan.outro, logo };
      }
      const needsText = plan.texts.length > 0 || hasSubtitles || Boolean(outro);
      const font = needsText ? await prepareFont(context, deps, template, plan.fontPath) : undefined;
      // Tipografías propias de cada texto (de la marca: fetchInput lo comprueba).
      const fontFiles: Record<string, string> = {};
      const fontWarnings: string[] = [];
      const ownFonts = [
        ...plan.texts.map((t) => t.style.fontPath),
        ...(hasSubtitles ? [plan.subtitles?.style.fontPath] : []),
      ].filter((p): p is string => Boolean(p));
      for (const fontPath of [...new Set(ownFonts)]) {
        if (fontPath === plan.fontPath && font?.source === 'brand') {
          fontFiles[fontPath] = FONT_NAME;
          continue;
        }
        const local = await prepareOwnFont(context, fontPath, Object.keys(fontFiles).length);
        if (local) fontFiles[fontPath] = local;
        else fontWarnings.push('Una tipografía elegida no es TrueType ni OpenType: se usa la de reserva');
      }
      const fontFile = font?.file;
      // Sin tipografía de la marca, rótulos y subtítulos con la versión menos gruesa de la del trabajador.
      let labelFontFile: string | undefined;
      const bundledLabel = findLabelFont();
      if (font && font.source === 'default' && bundledLabel && !deps.defaultFontFile?.includes('DejaVu')) {
        await copyFile(bundledLabel, path.join(context.workDir, LABEL_FONT_NAME));
        labelFontFile = LABEL_FONT_NAME;
      }
      // Medidas reales de cada tipografía, para partir las líneas y apilar los textos sin pisarse.
      const fontMetrics: Record<string, FontMetrics | null> = {};
      for (const name of new Set([fontFile, labelFontFile, ...Object.values(fontFiles)])) {
        if (name) fontMetrics[name] = await readFontMetrics(path.join(context.workDir, name));
      }
      const downloadMs = Date.now() - downloadStartedAt;

      // ── Montar ─────────────────────────────────────────────────────────
      const outputName = 'reel.mp4';
      const build = buildReel({
        template,
        plan: { clips, texts: plan.texts, subtitles: plan.subtitles, music, outro, grade: plan.grade },
        fontFile,
        labelFontFile,
        fontFiles,
        fontMetrics,
        maxTotalSeconds: isV2 ? undefined : template.timing.maxTotalSeconds,
        outputWidth: payload.output.width,
        outputFile: outputName,
      });
      for (const file of build.textFiles) await writeFile(path.join(context.workDir, file.name), file.content, 'utf8');
      const renderStartedAt = Date.now();
      // Dentro de la carpeta de trabajo: todas las rutas del grafo son relativas.
      await runFfmpeg(deps.tools, build.args, { cwd: context.workDir, signal: context.signal });
      const renderMs = Date.now() - renderStartedAt;

      // ── Comprobar y subir ──────────────────────────────────────────────
      const outputFile = path.join(context.workDir, outputName);
      const info = await probeMedia(deps.tools, outputFile, context.signal);
      if (!info.video) throw new Error('FFmpeg no ha producido un vídeo con imagen');
      if (build.audio !== 'none' && !info.audio) throw new Error('FFmpeg no ha producido el sonido del reel');
      const uploadStartedAt = Date.now();
      const bytes = await storeOutput(context, outputFile, payload.output.path, 'video/mp4');

      let poster: Record<string, unknown> | undefined;
      const posterWarnings: string[] = [];
      if (payload.output.posterPath) {
        const posterFile = path.join(context.workDir, 'poster.jpg');
        const cover = plan.cover;
        let source: 'auto' | 'frame' | 'photo' = 'auto';
        let at: number | undefined;
        if (cover?.type === 'photo') {
          // Una foto de la marca como portada: se gira según su EXIF y se recorta a 9:16 sobre lo principal.
          const file = await fetchInput(context, cover.path, 'cover');
          const orientation = await takeJpegOrientation(file);
          const w = build.width;
          const h = build.height;
          const focal = (await detectSubject(file, orientation))?.focal ?? CENTER;
          const crop = `crop=${w}:${h}:${focalCropExpr('w', w, focal.x)}:${focalCropExpr('h', h, focal.y)}`;
          await runFfmpeg(
            deps.tools,
            [
              ...['-noautorotate', '-i', file],
              ...['-vf', [...orientationFilters(orientation), `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`, crop].join(',')],
              ...['-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '2', posterFile],
            ],
            { signal: context.signal },
          );
          source = 'photo';
        } else {
          if (cover?.type === 'frame') {
            source = 'frame';
            const limit = Math.max(0, info.durationSeconds - 0.1);
            at = Math.min(cover.at, limit);
            if (cover.at > limit + 0.05) {
              posterWarnings.push('La portada estaba después del final del vídeo: se ha tomado el último fotograma');
            }
          } else {
            // Pasada la primera transición, para que la portada no salga a medio fundido.
            at = Math.min(build.durationSeconds / 2, Math.max(0.5, build.transitionSeconds + 0.5));
          }
          await runFfmpeg(
            deps.tools,
            ['-ss', num(at), '-i', outputFile, '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '3', posterFile],
            { signal: context.signal },
          );
        }
        const posterBytes = await storeOutput(context, posterFile, payload.output.posterPath, 'image/jpeg');
        poster = {
          path: payload.output.posterPath,
          source,
          ...(at !== undefined ? { atSeconds: Number(at.toFixed(3)) } : {}),
          width: build.width,
          height: build.height,
          bytes: posterBytes,
        };
      }
      const uploadMs = Date.now() - uploadStartedAt;

      return {
        template: { id: template.id, schemaVersion: template.schemaVersion },
        plan: { version: isV2 ? 2 : 1 },
        ...(payload.content ? { content: payload.content } : {}),
        output: {
          path: payload.output.path,
          width: info.video.width,
          height: info.video.height,
          fps: Number(info.video.fps.toFixed(3)),
          durationSeconds: Number(info.durationSeconds.toFixed(3)),
          videoCodec: info.video.codec,
          audioCodec: info.audio?.codec ?? null,
          // De dónde sale el sonido: música, solo los clips o ninguno (la pantalla dice «Sin música»).
          audio: build.audio,
          bytes,
        },
        ...(poster ? { poster } : {}),
        timeline: build.timeline,
        framing: build.framing,
        ...(outro ? { outro: { seconds: outro.seconds, logo: Boolean(outro.logo) } } : {}),
        ...(build.subtitles.length > 0 ? { subtitles: build.subtitles.length } : {}),
        ...(font ? { font: { source: font.source } } : {}),
        warnings: [
          ...(font?.warning ? [font.warning] : []),
          ...fontWarnings,
          ...subjectWarnings,
          ...build.warnings,
          ...posterWarnings,
        ],
        timings: { downloadMs, renderMs, uploadMs },
      };
    },
  };
}
