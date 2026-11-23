// Monta EN LOCAL, con FFmpeg de verdad, reels creados por el MISMO camino que el
// editor (docs/editor-reels.md §12): plantilla del catálogo de la agencia +
// material ordenado como en el selector (`rankReelAssets`) + `buildBrandReel`
// (la mejor abre, rótulos, pulsos, puntos y máscaras, colores y cierre de la
// marca) + `finalizeProject` + `buildRenderRequest`, y el manejador real del
// trabajador (`media.reel.template`) contra una carpeta que hace de cubo.
//
//   npx vite-node scripts/reels-desde-editor.ts -- --fotos <carpeta> [--fotos <carpeta>…] \
//     --logo <png> --salida <carpeta> [--perfil <json>] [--eleccion <json>]
//
// `--eleccion` dice qué toca la persona en el selector para cada plantilla, en orden
// ({ "rest-fotos-con-ritmo": ["a.jpg", …] }); sin él, las primeras que enseña el selector.
// El selector ordena como en la aplicación: los datos de cada foto y la luz y el fondo de
// su miniatura (`photoLook`, aquí medido con FFmpeg sobre una copia de 96 × 128).
// `--medidas` ({ "a.jpg": { "width": 3024, "height": 4032, "bytes": 2900000 } }) da las
// medidas del original a una foto de la que solo se tiene una copia pequeña (para ordenar
// como en la biblioteca real; el montaje usa el archivo que hay).
// `--plantillas rest-oferta-semana,…` monta solo esas.
//
// Por cada plantilla deja en <salida>: desde-editor-<clave>.mp4, su hoja de
// fotogramas (desde-editor-<clave>.jpg, 12 fotogramas repartidos) y
// desde-editor-<clave>.json con el plan y lo comprobado:
//   * textos sin solape y cuántos se ven en cada plano (la colocación del vídeo, `textFit.ts`);
//   * sin bandas (arriba y abajo de los planos no hay una franja negra y lisa);
//   * cierre con la marca (y con logotipo);
//   * sin fotos repetidas (ni en el plan ni avisos del trabajador).
// No toca Supabase ni la red.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { CATALOG_SETS, themeFromProfile } from '../agency/catalogo/index.ts';
import { emptyProfile, parseProfile, type BrandProfileData } from '../src/features/brand/profile.ts';
import { fittedTexts } from '../src/features/reels/editor/compose.ts';
import { buildRenderRequest, finalizeProject, outroSpan, planTimeline } from '../src/features/reels/editor/project.ts';
import {
  brandReelKit,
  photoLook,
  rankReelAssets,
  reelAssetScore,
  type PhotoLook,
  type RankableAsset,
} from '../src/features/reels/quality.ts';
import { buildBrandReel, reelTemplateNeeds, validateReelTemplate } from '../src/features/reels/reelTemplate.ts';
import { REEL_TEMPLATES } from '../src/features/reels/templates.ts';
import { BUNDLED_DISPLAY_FONT, findDefaultFont } from '../worker/src/ffmpeg/fonts.ts';
import { toolsFromEnv } from '../worker/src/ffmpeg/run.ts';
import { createReelTemplateHandler } from '../worker/src/handlers/reel-template.ts';
import { createMemoryLogger } from '../worker/src/logger.ts';
import { createFolderStorage } from '../worker/src/storage.ts';

const exec = promisify(execFile);
const ORG = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const inBrand = (name: string) => `${ORG}/${BRAND}/media/${name}`;

/** Las dos plantillas del catálogo de restaurante que se montan. */
const TEMPLATES = ['rest-fotos-con-ritmo', 'rest-oferta-semana'];

/** Lo que el selector mira de cada foto (la luz y el fondo), con FFmpeg en vez de un lienzo. */
async function lookOf(file: string): Promise<PhotoLook | null> {
  const { stdout } = await exec(
    toolsFromEnv().ffmpeg,
    ['-v', 'error', '-i', file, '-vf', 'scale=96:128:force_original_aspect_ratio=increase,crop=96:128', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { encoding: 'buffer', maxBuffer: 1 << 22 },
  );
  return photoLook(stdout as unknown as Buffer, 96, 128);
}

function args() {
  const out: {
    fotos: string[];
    logo?: string;
    salida?: string;
    perfil?: string;
    eleccion?: string;
    medidas?: string;
    plantillas?: string;
  } = { fotos: [] };
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!value) continue;
    if (key === '--fotos') out.fotos.push(value);
    else if (key === '--logo') out.logo = value;
    else if (key === '--salida') out.salida = value;
    else if (key === '--perfil') out.perfil = value;
    else if (key === '--eleccion') out.eleccion = value;
    else if (key === '--medidas') out.medidas = value;
    else if (key === '--plantillas') out.plantillas = value;
    else continue;
    i += 1;
  }
  if (out.fotos.length === 0 || !out.salida) {
    throw new Error('Uso: --fotos <carpeta> [--fotos <carpeta>…] --salida <carpeta> [--logo <png>] [--perfil <json>]');
  }
  return out;
}

async function probeSize(file: string) {
  const { stdout } = await exec(toolsFromEnv().ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file,
  ]);
  const s = JSON.parse(stdout).streams[0] as { width: number; height: number };
  return { width: s.width, height: s.height, bytes: (await stat(file)).size };
}

/** Fotogramas en gris pequeño (para mirar si hay bandas). */
async function framesGray(file: string, at: number[], w = 54, h = 96) {
  const tools = toolsFromEnv();
  const out: Buffer[] = [];
  for (const t of at) {
    const { stdout } = await exec(
      tools.ffmpeg,
      ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { encoding: 'buffer', maxBuffer: 1 << 22 },
    );
    out.push(stdout as unknown as Buffer);
  }
  return out;
}

async function contactSheet(video: string, duration: number, sheet: string) {
  const fps = 12 / duration;
  await exec(toolsFromEnv().ffmpeg, [
    '-v', 'error', '-y', '-i', video,
    '-vf', `fps=${fps.toFixed(5)},scale=270:480,tile=6x2:padding=4:color=white`,
    '-frames:v', '1', '-q:v', '3', sheet,
  ]);
}

async function main() {
  const options = args();
  process.env.WORKER_FONT_FILE ??= BUNDLED_DISPLAY_FONT;
  const tools = toolsFromEnv();
  const handler = createReelTemplateHandler({ tools, defaultFontFile: findDefaultFont() });
  const root = await mkdtemp(path.join(os.tmpdir(), 'rrss-reels-editor-'));
  await mkdir(path.join(root, ORG, BRAND, 'media'), { recursive: true });
  await mkdir(options.salida!, { recursive: true });

  // La biblioteca de la marca: las fotos de las carpetas dadas, con sus medidas y su peso (como `useReelSources`).
  const library: Array<RankableAsset & { duration_ms: number | null; created_at: string }> = [];
  const sizes: Record<string, { width: number; height: number; bytes: number }> = options.medidas
    ? JSON.parse(await readFile(options.medidas, 'utf8'))
    : {};
  const looks = new Map<string, PhotoLook | null>();
  for (const dir of options.fotos) {
    for (const name of (await readdir(dir)).sort()) {
      if (!/\.(jpe?g|webp|png)$/i.test(name) || name.startsWith('_')) continue;
      const file = path.join(dir, name);
      const target = inBrand(name);
      await copyFile(file, path.join(root, target));
      const size = sizes[name] ?? (await probeSize(file));
      looks.set(name, await lookOf(file));
      library.push({
        id: name,
        kind: 'image',
        storage_path: target,
        file_name: name,
        mime_type: /\.webp$/i.test(name) ? 'image/webp' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg',
        duration_ms: null,
        created_at: '2026-11-21T10:00:00Z',
        ...size,
      });
    }
  }
  let logoPath: string | undefined;
  if (options.logo) {
    logoPath = inBrand(path.basename(options.logo));
    await copyFile(options.logo, path.join(root, logoPath));
  }
  const profile: BrandProfileData = options.perfil
    ? parseProfile(JSON.parse(await readFile(options.perfil, 'utf8')))
    : emptyProfile();
  const kit = brandReelKit(profile, logoPath);
  const set = CATALOG_SETS.find((s) => s.id === 'restaurante')!;
  const catalog = set.reels(themeFromProfile(profile));
  // Lo que enseña el selector primero (las que mejor quedan): quien elige toca las primeras.
  const picker = rankReelAssets(library, looks);
  const order = picker.map((a) => ({ foto: a.file_name, nota: reelAssetScore(a, looks.get(a.id)) }));
  console.log('Orden del selector:', order.map((o) => `${o.nota} ${o.foto}`).join(' | '));
  await writeFile(path.join(options.salida!, 'orden-selector.json'), JSON.stringify(order, null, 2));
  const picks: Record<string, string[]> = options.eleccion ? JSON.parse(await readFile(options.eleccion, 'utf8')) : {};
  const report: Record<string, unknown> = {};

  for (const key of options.plantillas ? options.plantillas.split(',') : TEMPLATES) {
    const entry = catalog.find((t) => t.key === key)!;
    const parsed = validateReelTemplate(entry.document);
    if (!parsed.ok) throw new Error(`${key}: ${JSON.stringify(parsed.issues)}`);
    const template = parsed.template;
    const style = REEL_TEMPLATES.find((t) => t.id === template.style.id)!;
    const { max } = reelTemplateNeeds(template);
    const wanted = picks[key];
    const chosen = wanted
      ? wanted.map((name) => {
          const found = library.find((a) => a.file_name === name);
          if (!found) throw new Error(`${key}: no está «${name}» en las carpetas de fotos`);
          return found;
        })
      : picker.slice(0, max);
    // El camino del editor: «Desde una plantilla» → buildBrandReel → guardar (finalizeProject) → encargar.
    const project = buildBrandReel(template, chosen, style, { kit, library, looks });
    const ready = finalizeProject(project);
    const request = buildRenderRequest(ready, { id: 'pieza-prueba', version: 1 }) as { template: { id: string }; plan: unknown };
    const output = inBrand(`salida/desde-editor-${key}.mp4`);
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'rrss-reels-job-'));
    const result = (await handler.run({
      job: {
        id: key,
        organization_id: ORG,
        brand_id: BRAND,
        kind: handler.kind,
        payload: { template: request.template, plan: request.plan, output: { path: output } } as never,
        attempts: 1,
        max_attempts: 3,
      },
      signal: new AbortController().signal,
      storage: createFolderStorage(root),
      workDir,
      log: createMemoryLogger(),
    })) as Record<string, unknown> & { output: { durationSeconds: number }; warnings: string[] };
    // En Windows un archivo puede seguir abierto un momento (sharp): se reintenta y, si no, se deja.
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);

    const name = key.replace(/^rest-/, '');
    const video = path.join(options.salida!, `desde-editor-${name}.mp4`);
    await copyFile(path.join(root, output), video);
    const duration = result.output.durationSeconds;
    await contactSheet(video, duration, path.join(options.salida!, `desde-editor-${name}.jpg`));

    // ── Comprobaciones ──
    const plan = ready.plan;
    const timeline = planTimeline(plan.clips, style);
    const fits = fittedTexts(plan, timeline, style, { width: 1080, height: 1920 }).filter((f) => f.kind === 'text');
    const overlaps: string[] = [];
    fits.forEach((a, i) =>
      fits.slice(i + 1).forEach((b) => {
        const time = Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.02;
        const space = a.laid.extent[0] < b.laid.extent[1] && b.laid.extent[0] < a.laid.extent[1];
        if (time && space) overlaps.push(`${a.key}/${b.key}`);
      }),
    );
    // Uno por plano: en la mitad de cada plano, cuántos textos se ven.
    const perShot = plan.clips.map((_, i) => {
      const mid = timeline.starts[i]! + timeline.durations[i]! / 2;
      return fits.filter((f) => f.start <= mid && f.end >= mid).length;
    });
    // Sin bandas: en fotogramas repartidos por los planos (el cierre va oscurecido a propósito), las tres
    // filas de arriba y las tres de abajo no son una franja negra y lisa.
    const clipsEnd = outroSpan(plan, timeline, style)?.start ?? timeline.total;
    const at = Array.from({ length: 12 }, (_, i) => ((i + 0.5) * clipsEnd) / 12);
    const gray = await framesGray(video, at);
    const strip = (px: Buffer, from: number) => {
      const values = [...px.subarray(from * 54, (from + 3) * 54)];
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return { mean: Math.round(mean), spread: Math.max(...values) - Math.min(...values) };
    };
    const bands = gray
      .map((px, i) => ({ t: Number(at[i]!.toFixed(2)), top: strip(px, 0), bottom: strip(px, 93) }))
      .filter((r) => [r.top, r.bottom].some((band) => band.mean < 8 && band.spread < 6));
    const paths = plan.clips.map((c) => c.path);
    const checks = {
      textosSinSolape: overlaps.length === 0,
      cadaPlanoConTexto: perShot.every((n) => n >= 1),
      unTextoPorPlano: perShot.every((n) => n <= 1),
      textosPorPlano: perShot,
      sinBandas: bands.length === 0,
      fotogramasConBanda: bands,
      cierreConMarca: Boolean(result.outro) && Boolean(plan.outro),
      cierre: plan.outro ?? null,
      cierreConLogo: (result.outro as { logo?: boolean } | undefined)?.logo ?? false,
      sinFotosRepetidas: new Set(paths).size === paths.length && !result.warnings.some((w) => /varias veces/.test(w)),
      duracion: duration,
      duracionPrevista: outroSpan(plan, timeline, style)?.total ?? timeline.total,
      encuadre: result.framing,
      avisos: result.warnings,
    };
    report[name] = checks;
    await writeFile(
      path.join(options.salida!, `desde-editor-${name}.json`),
      JSON.stringify({ plantilla: entry.name, elegidas: chosen.map((a) => a.file_name), plan, comprobado: checks }, null, 2),
    );
    console.log(`${entry.name}:`, JSON.stringify({ ...checks, encuadre: undefined, cierre: undefined }));
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => undefined);
  const ok = Object.values(report).every((r) => {
    const c = r as Record<string, unknown>;
    return c.textosSinSolape && c.cadaPlanoConTexto && c.sinBandas && c.cierreConMarca && c.sinFotosRepetidas;
  });
  console.log(ok ? 'Todo comprobado.' : 'Hay comprobaciones que no pasan (mira los .json).');
  process.exitCode = ok ? 0 : 1;
}

await main();
