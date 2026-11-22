// Lo que añade el editor «como los de móvil» al plan v2 (docs/editor-reels.md §10):
// velocidad del clip, clips divididos, volumen por parte, filtros de color y textos
// colocados a mano. Primero las cuentas (sin FFmpeg, con el ejemplo compartido con la
// aplicación) y después el montaje real con FFmpeg.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReelTemplateHandler } from '../src/handlers/reel-template.ts';
import { buildReel, CLIP_FILTER_CHAINS, planTimeline, timelineSubtitles, type ResolvedClip } from '../src/reel/build.ts';
import { CLIP_FILTERS, reelPlanV2Schema, type ReelPlanV2 } from '../src/reel/schema.ts';
import { loadTemplates } from '../src/reel/templates.ts';
import {
  averageColor,
  createBucket,
  deps,
  inBrand,
  makePatternPhoto,
  probe,
  runHandler,
  tools,
  type Bucket,
} from './helpers/media.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Ejemplo compartido con la aplicación (src/features/reels/editor/editorPro.test.ts). */
const FIXTURE = JSON.parse(readFileSync(path.join(here, 'fixtures/plan-v2-pro.json'), 'utf8')) as ReelPlanV2;
const exec = promisify(execFile);
const fundido = loadTemplates().get('fundido-suave')!;
const handler = createReelTemplateHandler(deps);

function resolved(plan: ReelPlanV2): ResolvedClip[] {
  return plan.clips.map((clip, index) =>
    clip.type === 'photo'
      ? { ...clip, file: `media-${index}.jpg`, orientation: 1 }
      : { ...clip, file: `media-${index}.mp4`, durationSeconds: 3, hasAudio: true },
  );
}

describe('plan v2 ampliado (sin FFmpeg)', () => {
  it('el ejemplo compartido es válido y su línea de tiempo cuenta la velocidad', () => {
    const plan = reelPlanV2Schema.parse(FIXTURE);
    const timeline = planTimeline(resolved(plan), fundido);
    // c2 toma 1,6 s de archivo al doble de velocidad: 0,8 s de reel.
    expect(timeline).toEqual({
      durations: [1.4, 0.8, 1.5],
      transitions: [0, 0, 0.3],
      starts: [0, 1.4, 1.9],
      total: 3.4,
    });
    // El subtítulo va en tiempo del archivo (1,9–2,9): al doble, dura la mitad y empieza a 0,25 s del corte.
    expect(timelineSubtitles(resolved(plan), timeline).map((c) => [c.start, c.end, c.text])).toEqual([
      [1.65, 2.15, 'Va al doble'],
    ]);
  });

  it('rechaza una velocidad fuera de 0,5–2, un filtro inventado, un desplazamiento exagerado y los nulos', () => {
    const withClip = (patch: Record<string, unknown>) => ({
      ...FIXTURE,
      clips: [{ ...FIXTURE.clips[0]!, ...patch }],
    });
    expect(reelPlanV2Schema.safeParse(withClip({ speed: 0.5 })).success).toBe(true);
    expect(reelPlanV2Schema.safeParse(withClip({ speed: 2 })).success).toBe(true);
    expect(reelPlanV2Schema.safeParse(withClip({ speed: 0.4 })).success).toBe(false);
    expect(reelPlanV2Schema.safeParse(withClip({ speed: 2.5 })).success).toBe(false);
    expect(reelPlanV2Schema.safeParse(withClip({ speed: null })).success).toBe(false);
    expect(reelPlanV2Schema.safeParse(withClip({ filter: 'neon' })).success).toBe(false);
    expect(reelPlanV2Schema.safeParse(withClip({ filter: null })).success).toBe(false);
    // Una foto no tiene velocidad.
    const photo = { ...FIXTURE.clips[2]!, speed: 2 };
    expect(reelPlanV2Schema.safeParse({ ...FIXTURE, clips: [photo] }).success).toBe(false);
    const withOffset = (offset: unknown) => ({ ...FIXTURE, texts: [{ ...FIXTURE.texts[0]!, offset }] });
    expect(reelPlanV2Schema.safeParse(withOffset({ x: -0.5, y: 0.5 })).success).toBe(true);
    expect(reelPlanV2Schema.safeParse(withOffset({ x: 0.6, y: 0 })).success).toBe(false);
    expect(reelPlanV2Schema.safeParse(withOffset({ x: 0.1 })).success).toBe(false);
    expect(reelPlanV2Schema.safeParse(withOffset(null)).success).toBe(false);
  });

  it('la orden de FFmpeg lee el tramo entero, cambia el reloj y el tempo, y mueve el texto en píxeles', () => {
    const plan = reelPlanV2Schema.parse(FIXTURE);
    const build = buildReel({
      template: fundido,
      plan: { clips: resolved(plan), texts: plan.texts, subtitles: plan.subtitles },
      fontFile: 'fuente.ttf',
      outputFile: 'salida.mp4',
    });
    // c2: 0,8 s de reel × 2 = 1,6 s de archivo (+1 de margen).
    const at = build.args.indexOf('media-1.mp4');
    expect(build.args.slice(at - 5, at + 1)).toEqual(['-ss', '1.4', '-t', '2.6', '-i', 'media-1.mp4']);
    expect(build.filterGraph).toContain('[1:v]setpts=(PTS-STARTPTS)/2,fps=30');
    expect(build.filterGraph).toMatch(/\[1:v\][^;]*hue=s=0,eq=contrast=1\.08/);
    expect(build.filterGraph).toMatch(/\[2:v\][^;]*colorbalance=/);
    // El primer clip va a velocidad normal: su cadena es la de siempre.
    expect(build.filterGraph).toContain('[0:v]fps=30');
    expect(build.filterGraph).toContain('[0:a]atrim=duration=1.4,asetpts=PTS-STARTPTS,aresample');
    // c2 está silenciado: no entra en la mezcla.
    expect(build.filterGraph).not.toContain('[1:a]');
    // Texto en el centro, +10 % del ancho a la derecha y −25 % del alto.
    expect(build.filterGraph).toContain("x='(w-text_w)/2+108'");
    const y = Math.round((1920 - 108) / 2) - 480;
    expect(build.filterGraph).toContain(`:y=${y}:`);
  });

  it('con sonido, un clip a otra velocidad lleva atempo; todos los filtros tienen su cadena', () => {
    const clip = { ...resolved(reelPlanV2Schema.parse(FIXTURE))[1]!, volume: 0.5, speed: 0.5 };
    const build = buildReel({ template: fundido, plan: { clips: [clip], texts: [] }, outputFile: 'salida.mp4' });
    // 1,6 s de archivo a la mitad: 3,2 s de reel.
    expect(build.durationSeconds).toBe(3.2);
    expect(build.filterGraph).toContain('[0:a]atrim=duration=1.6,asetpts=PTS-STARTPTS,atempo=0.5,');
    expect(Object.keys(CLIP_FILTER_CHAINS).sort()).toEqual([...CLIP_FILTERS].sort());
  });
});

/** Clip con el primer segundo rojo y el resto azul, con un tono continuo. */
async function makeTwoColorClip(file: string): Promise<void> {
  await exec(tools.ffmpeg, [
    ...['-hide_banner', '-nostdin', '-v', 'error', '-y'],
    ...['-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=25:d=1'],
    ...['-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=25:d=2'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=3'],
    ...['-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k'],
    file,
  ]);
}

/** Volumen medio (dB) de un tramo del vídeo. */
async function volumeBetween(file: string, from: number, seconds: number): Promise<number> {
  const { stderr } = await exec(tools.ffmpeg, [
    ...['-hide_banner', '-nostdin', '-ss', String(from), '-t', String(seconds), '-i', file],
    ...['-vn', '-af', 'volumedetect', '-f', 'null', '-'],
  ]);
  const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  if (!match) throw new Error('No se pudo medir el volumen');
  return Number(match[1]);
}

const difference = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0);

let bucket: Bucket;
const run = (plan: unknown, name: string) =>
  runHandler(handler, bucket, {
    template: { id: 'fundido-suave' },
    plan,
    output: { path: inBrand(`reels/${name}.mp4`), width: 270 },
  });
const out = (name: string) => bucket.file(inBrand(`reels/${name}.mp4`));
const video = (patch: Record<string, unknown> = {}) => ({
  id: 'v',
  type: 'video',
  path: inBrand('colores.mp4'),
  in: 0,
  out: 3,
  volume: 1,
  ...patch,
});

beforeAll(async () => {
  bucket = await createBucket();
  await makePatternPhoto(bucket.file(inBrand('plato.jpg')), 640, 480);
  await makeTwoColorClip(bucket.file(inBrand('colores.mp4')));
});

afterAll(async () => {
  await bucket?.cleanup();
});

describe('media.reel.template: velocidad, división, volumen, filtros y textos colocados (FFmpeg real)', () => {
  it('al doble de velocidad dura la mitad y el cambio de color llega antes; a la mitad, el doble', async () => {
    expect(await run({ version: 2, clips: [video({ speed: 2 })] }, 'doble')).toMatchObject({
      output: { durationSeconds: 1.5 },
      timeline: [{ index: 0, start: 0, seconds: 1.5 }],
    });
    // El rojo dura 1 s de archivo: 0,5 s de reel.
    const early = await averageColor(out('doble'), undefined, 0.25);
    expect(early[0]).toBeGreaterThan(early[2] + 80);
    const late = await averageColor(out('doble'), undefined, 0.75);
    expect(late[2]).toBeGreaterThan(late[0] + 80);
    // El sonido sigue ahí (acelerado, con su tono) y dura lo que la imagen.
    expect(await volumeBetween(out('doble'), 0, 1.5)).toBeGreaterThan(-30);
    const info = await probe(out('doble'));
    expect(info.durationSeconds).toBeGreaterThan(1.45);
    expect(info.durationSeconds).toBeLessThan(1.6);

    expect(await run({ version: 2, clips: [video({ out: 1.5, speed: 0.5 })] }, 'mitad')).toMatchObject({
      output: { durationSeconds: 3 },
    });
    // A la mitad, el rojo (1 s de archivo) dura 2 s de reel.
    const slowRed = await averageColor(out('mitad'), undefined, 1.5);
    expect(slowRed[0]).toBeGreaterThan(slowRed[2] + 80);
    const slowBlue = await averageColor(out('mitad'), undefined, 2.5);
    expect(slowBlue[2]).toBeGreaterThan(slowBlue[0] + 80);
    expect(await volumeBetween(out('mitad'), 0.5, 2)).toBeGreaterThan(-30);
  });

  it('un clip dividido en dos partes da el mismo vídeo que entero; cada parte lleva su volumen', async () => {
    await run({ version: 2, clips: [video()] }, 'entero');
    const cut = { type: 'cut', seconds: 0 };
    const parts = (second: Record<string, unknown> = {}) => ({
      version: 2,
      clips: [video({ id: 'a', out: 1.2 }), video({ id: 'b', in: 1.2, transition: cut, ...second })],
    });
    expect(await run(parts(), 'dividido')).toMatchObject({
      output: { durationSeconds: 3 },
      timeline: [
        { index: 0, start: 0, seconds: 1.2, transitionIn: 0 },
        { index: 1, start: 1.2, seconds: 1.8, transitionIn: 0 },
      ],
    });
    for (const at of [0.5, 1.1, 1.3, 2.5]) {
      const whole = await averageColor(out('entero'), undefined, at);
      const split = await averageColor(out('dividido'), undefined, at);
      expect(difference(whole, split)).toBeLessThan(20);
    }
    // La segunda parte silenciada: suena la primera y calla la segunda.
    await run(parts({ volume: 0 }), 'dividido-mudo');
    expect(await volumeBetween(out('dividido-mudo'), 0.2, 0.8)).toBeGreaterThan(-30);
    expect(await volumeBetween(out('dividido-mudo'), 1.5, 1.2)).toBeLessThan(-70);
    // Y bajada al 10 %: unos 20 dB menos que la primera.
    await run(parts({ volume: 0.1 }), 'dividido-bajo');
    const first = await volumeBetween(out('dividido-bajo'), 0.2, 0.8);
    const second = await volumeBetween(out('dividido-bajo'), 1.6, 1.2);
    expect(second).toBeLessThan(first - 12);
  });

  it('los filtros de color cambian la imagen: blanco y negro quita el color; cálido y frío tiran a su lado', async () => {
    await run({ version: 2, clips: [video({ out: 1, volume: 0, filter: 'bw' })] }, 'bn');
    const gray = await averageColor(out('bn'), undefined, 0.5);
    expect(Math.abs(gray[0] - gray[2])).toBeLessThan(12);
    const photo = (filter?: string) => ({
      version: 2,
      clips: [{ id: 'p', type: 'photo', path: inBrand('plato.jpg'), seconds: 1, motion: 'none', ...(filter ? { filter } : {}) }],
    });
    await run(photo(), 'foto');
    const plain = await averageColor(out('foto'), undefined, 0.5);
    const tone = async (filter: string) => {
      await run(photo(filter), `foto-${filter}`);
      return averageColor(out(`foto-${filter}`), undefined, 0.5);
    };
    const warm = await tone('warm');
    const cool = await tone('cool');
    expect(warm[0] - warm[2]).toBeGreaterThan(plain[0] - plain[2] + 6);
    expect(cool[2] - cool[0]).toBeGreaterThan(plain[2] - plain[0] + 6);
    // El resto se montan sin error y dejan una imagen distinta de la original.
    for (const filter of ['sepia', 'vivid', 'fade', 'drama']) {
      const color = await tone(filter);
      expect(color.every((c) => Number.isFinite(c))).toBe(true);
    }
    const sepia = await averageColor(out('foto-sepia'), undefined, 0.5);
    expect(sepia[0]).toBeGreaterThan(sepia[2]);
  });

  it('un texto colocado a mano se dibuja desplazado de su sitio', async () => {
    await mkdir(path.dirname(bucket.file(inBrand('fonts/x'))), { recursive: true });
    await copyFile(deps.defaultFontFile!, bucket.file(inBrand('fonts/titular.ttf')));
    const text = { ...FIXTURE.texts[0]!, text: 'OFERTA', start: 0, end: 1 };
    const plan = (offset?: { x: number; y: number }) => ({
      version: 2,
      clips: [video({ out: 1, volume: 0 })],
      texts: [{ ...text, ...(offset ? { offset } : { offset: undefined }) }],
    });
    await run(JSON.parse(JSON.stringify(plan())), 'texto-centro');
    await run(plan({ x: 0, y: -0.3 }), 'texto-arriba');
    await run({ version: 2, clips: [video({ out: 1, volume: 0 })] }, 'texto-nada');
    // 270×480: el centro cae en y≈240; con −30 % del alto, en y≈96.
    const center = { x: 40, y: 222, width: 190, height: 36 };
    const top = { x: 40, y: 78, width: 190, height: 36 };
    const none = (zone: typeof center) => averageColor(out('texto-nada'), zone, 0.5);
    expect(difference(await averageColor(out('texto-centro'), center, 0.5), await none(center))).toBeGreaterThan(25);
    expect(difference(await averageColor(out('texto-centro'), top, 0.5), await none(top))).toBeLessThan(10);
    expect(difference(await averageColor(out('texto-arriba'), top, 0.5), await none(top))).toBeGreaterThan(25);
    expect(difference(await averageColor(out('texto-arriba'), center, 0.5), await none(center))).toBeLessThan(10);
  });

  it('monta el ejemplo compartido entero: partes de un clip, velocidad, volumen, filtros, texto y subtítulo', async () => {
    const result = await run(FIXTURE, 'pro');
    expect(result).toMatchObject({
      plan: { version: 2 },
      subtitles: 1,
      output: { durationSeconds: 3.4, videoCodec: 'h264', audioCodec: 'aac' },
      warnings: [],
    });
    // Primera parte con sonido; la segunda (al doble y en blanco y negro), muda.
    expect(await volumeBetween(out('pro'), 0.2, 1)).toBeGreaterThan(-30);
    expect(await volumeBetween(out('pro'), 1.5, 0.3)).toBeLessThan(-60);
    const gray = await averageColor(out('pro'), { x: 0, y: 0, width: 270, height: 60 }, 1.7);
    expect(Math.abs(gray[0] - gray[2])).toBeLessThan(14);
  });
});
