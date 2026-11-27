// Animaciones de texto, movimientos de cámara y portada del reel.
//  * La cuenta de cada animación (animation.ts) coincide con el ejemplo
//    compartido con la aplicación (fixtures/text-animation.json).
//  * El esquema admite lo nuevo y rechaza lo mal formado.
//  * Con FFmpeg real, el texto está donde dice la cuenta (el mismo modelo que
//    dibuja la vista previa) y la portada sale como JPEG.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReelTemplateHandler } from '../src/handlers/reel-template.ts';
import { animationDurations, textAnimState, type TextAnimation } from '../src/reel/animation.ts';
import { reelPayloadSchema, reelPlanV2Schema } from '../src/reel/schema.ts';
import { createBucket, deps, inBrand, makePatternPhoto, runHandler, tools, type Bucket } from './helpers/media.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const handler = createReelTemplateHandler(deps);

interface Case {
  animation?: TextAnimation;
  fadeSeconds: number;
  start: number;
  end: number;
  chars: number;
  samples: Array<{ t: number; state: Record<string, number> }>;
}
const CASES = JSON.parse(readFileSync(path.join(here, 'fixtures/text-animation.json'), 'utf8')) as Case[];

describe('cuenta de las animaciones de texto', () => {
  it('da los mismos números que el ejemplo compartido con la vista previa', () => {
    for (const c of CASES) {
      for (const sample of c.samples) {
        const state = textAnimState(c.animation, { fadeSeconds: c.fadeSeconds }, sample.t, c.start, c.end, c.chars);
        for (const [key, value] of Object.entries(sample.state)) {
          expect(Number((state as unknown as Record<string, number>)[key]!.toFixed(5)), `${key} en ${sample.t}`).toBe(value);
        }
      }
    }
  });

  it('sin animación es el fundido de siempre y las duraciones respetan la vida del texto', () => {
    expect(animationDurations(undefined, { fadeSeconds: 0.25 }, 0, 3, 10)).toMatchObject({ inSeconds: 0.25, outSeconds: 0.25 });
    // Un texto de 0,5 s no puede tener entrada y salida de 0,4 s cada una.
    const d = animationDurations({ in: 'rise', out: 'fall' }, { fadeSeconds: 0.25 }, 0, 0.5, 10);
    expect(d.inSeconds + d.outSeconds).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(animationDurations({ in: 'typewriter', out: 'none' }, { fadeSeconds: 0.25 }, 0, 4, 40).steps).toBeGreaterThan(5);
  });
});

describe('esquema del plan con animación, movimiento y portada', () => {
  const style = {
    sizeRatio: 0.06, color: '#FFFFFF', marginRatio: 0.2, maxWidthRatio: 0.84, lineHeight: 1.3, fadeSeconds: 0.25,
  };
  const plan = (extra: Record<string, unknown>) => ({
    version: 2,
    clips: [{ id: 'c1', type: 'photo', path: inBrand('a.jpg'), seconds: 2, motion: 'pan-up', motionAmount: 0.15 }],
    texts: [{ id: 't1', text: 'Hola', start: 0, end: 2, position: 'top', style, animation: { in: 'zoom', out: 'slide' } }],
    ...extra,
  });

  it('admite lo nuevo y no pone nulos (request_media_job los quita)', () => {
    const parsed = reelPlanV2Schema.parse(plan({ cover: { type: 'frame', at: 1.5 } }));
    expect(parsed.cover).toEqual({ type: 'frame', at: 1.5 });
    expect(parsed.texts[0]!.animation).toEqual({ in: 'zoom', out: 'slide' });
    // Un plan antiguo (sin nada de esto) sigue siendo válido.
    expect(reelPlanV2Schema.safeParse({ version: 2, clips: [{ id: 'c1', type: 'photo', path: inBrand('a.jpg'), seconds: 2 }] }).success).toBe(true);
  });

  it('rechaza animaciones, movimientos y portadas que no existen', () => {
    const bad = (p: unknown) => expect(reelPlanV2Schema.safeParse(p).success).toBe(false);
    bad(plan({ texts: [{ id: 't1', text: 'x', start: 0, end: 1, position: 'top', style, animation: { in: 'giro', out: 'fade' } }] }));
    bad(plan({ clips: [{ id: 'c1', type: 'photo', path: inBrand('a.jpg'), seconds: 2, motion: 'vuelo' }] }));
    bad(plan({ cover: { type: 'frame', at: 200 } }));
    bad(plan({ cover: { type: 'photo' } }));
  });

  it('la carga admite la ruta de la portada', () => {
    const payload = { template: { id: 'fundido-suave' }, plan: plan({}), output: { path: inBrand('r.mp4'), posterPath: inBrand('r-cover.jpg') } };
    expect(reelPayloadSchema.safeParse(payload).success).toBe(true);
  });
});

// ───────────────────────────── Con FFmpeg real ─────────────────────────────

const W = 270;
const H = 480;
const STYLE = {
  sizeRatio: 0.12, color: '#FFFFFF', marginRatio: 0.3, maxWidthRatio: 0.9, lineHeight: 1.3, box: null, outline: null, fadeSeconds: 0.25,
};
let bucket: Bucket;

async function makeBlackPhoto(file: string) {
  await exec(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x568', '-frames:v', '1', file]);
}

const render = (name: string, plan: Record<string, unknown>, output: Record<string, unknown> = {}) =>
  runHandler(handler, bucket, {
    template: { id: 'fundido-suave' },
    plan: { version: 2, clips: [{ id: 'c1', type: 'photo', path: inBrand('negro.jpg'), seconds: 4, motion: 'none' }], ...plan },
    output: { path: inBrand(`reels/${name}.mp4`), width: W, ...output },
  });

/** Caja que ocupan los píxeles claros del fotograma en `t`. */
async function textBox(name: string, t: number) {
  const { stdout } = await exec(
    tools.ffmpeg,
    ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(t), '-i', bucket.file(inBrand(`reels/${name}.mp4`)), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { encoding: 'buffer', maxBuffer: 10_000_000 },
  );
  const px = stdout as unknown as Buffer;
  let minX = W, maxX = -1, minY = H, maxY = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (px[y * W + x]! > 40) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  return maxX < 0 ? null : { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, w: maxX - minX, h: maxY - minY };
}

const text = (animation: TextAnimation | undefined, extra: Record<string, unknown> = {}) => ({
  texts: [{ id: 't1', text: 'Hola mundo', start: 0.5, end: 3.5, position: 'center', style: STYLE, ...(animation ? { animation } : {}), ...extra }],
});

beforeAll(async () => {
  bucket = await createBucket();
  await makeBlackPhoto(bucket.file(inBrand('negro.jpg')));
  await makePatternPhoto(bucket.file(inBrand('plato.jpg')), 640, 480);
  // Degradado de negro (arriba) a blanco (abajo): se nota hacia dónde mira la cámara.
  await exec(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=360x640,format=gray,geq=lum=255*Y/H', '-frames:v', '1', bucket.file(inBrand('gradiente.jpg'))]);
});
afterAll(async () => {
  await bucket?.cleanup();
});

describe('textos animados con FFmpeg: donde dice la cuenta', () => {
  it('deslizar: el texto entra desde la izquierda y vuelve al centro', async () => {
    const animation = { in: 'slide', out: 'none', seconds: 0.8 } as const;
    await render('slide', text(animation));
    const t = 0.5 + 0.4;
    const expected = textAnimState(animation, STYLE, t, 0.5, 3.5, 10);
    const early = await textBox('slide', t);
    const settled = await textBox('slide', 2);
    expect(early).not.toBeNull();
    expect(settled!.cx).toBeGreaterThan(W / 2 - 6);
    expect(settled!.cx).toBeLessThan(W / 2 + 6);
    expect(early!.cx - settled!.cx).toBeCloseTo(expected.dx * W, -1);
    expect(early!.cx).toBeLessThan(settled!.cx - 10);
  });

  it('subir: empieza más abajo y termina en su sitio', async () => {
    const animation = { in: 'rise', out: 'none', seconds: 0.8 } as const;
    await render('rise', text(animation));
    const t = 0.5 + 0.3;
    const expected = textAnimState(animation, STYLE, t, 0.5, 3.5, 10);
    const early = await textBox('rise', t);
    const settled = await textBox('rise', 2);
    expect(early!.minY - settled!.minY).toBeCloseTo(expected.dy * H, -1);
    expect(early!.minY).toBeGreaterThan(settled!.minY + 2);
  });

  it('zoom: la letra crece hasta su tamaño', async () => {
    const animation = { in: 'zoom', out: 'none', seconds: 0.8 } as const;
    await render('zoom', text(animation));
    const t = 0.5 + 0.25;
    const expected = textAnimState(animation, STYLE, t, 0.5, 3.5, 10);
    const early = await textBox('zoom', t);
    const settled = await textBox('zoom', 2);
    const ratio = early!.w / settled!.w;
    expect(ratio).toBeGreaterThan(expected.scale - 0.12);
    expect(ratio).toBeLessThan(expected.scale + 0.12);
    expect(ratio).toBeLessThan(0.95);
  });

  it('máquina de escribir: el texto crece letra a letra desde la izquierda', async () => {
    const animation = { in: 'typewriter', out: 'none', seconds: 1 } as const;
    const result = await render('typewriter', text(animation));
    expect(result).toBeTruthy();
    const a = await textBox('typewriter', 0.5 + 0.3);
    const b = await textBox('typewriter', 0.5 + 0.7);
    const done = await textBox('typewriter', 2);
    expect(a!.w).toBeLessThan(b!.w);
    expect(b!.w).toBeLessThan(done!.w + 1);
    // Alineado a la izquierda del bloque centrado (con el ancho real del texto), sin moverse mientras escribe.
    for (const box of [a!, b!]) expect(Math.abs(box.minX - done!.minX)).toBeLessThan(4);
    expect(Math.abs(done!.cx - W / 2)).toBeLessThan(8);
    // La cuenta del modelo dice cuántas letras hay en esos instantes.
    const chars = (t: number) => textAnimState(animation, STYLE, t, 0.5, 3.5, 10).visibleChars;
    expect(chars(0.8)).toBeLessThan(chars(1.2));
    expect(chars(2)).toBe(10);
  });

  it('bajar al salir: el texto baja mientras se desvanece', async () => {
    const animation = { in: 'none', out: 'fall', seconds: 0.8 } as const;
    await render('fall', text(animation));
    const t = 3.5 - 0.4;
    const expected = textAnimState(animation, STYLE, t, 0.5, 3.5, 10);
    const settled = await textBox('fall', 2);
    const late = await textBox('fall', t);
    expect(late).not.toBeNull();
    expect(late!.minY - settled!.minY).toBeCloseTo(expected.dy * H, -1);
  });

  it('sin animación el texto está entero desde que aparece el fundido', async () => {
    await render('plano', text(undefined));
    expect(await textBox('plano', 0.5 + 0.2)).not.toBeNull();
  });
});

describe('movimientos de cámara y portada con FFmpeg', () => {
  it('subir y bajar la cámara producen vídeos distintos entre sí', async () => {
    const clip = (motion: string) => ({ clips: [{ id: 'c1', type: 'photo', path: inBrand('gradiente.jpg'), seconds: 2, motion, motionAmount: 0.2 }] });
    await render('up', clip('pan-up'));
    await render('down', clip('pan-down'));
    // Media del fotograma (en gris) en la mitad de arriba y la de abajo: subir la cámara enseña
    // primero lo de abajo de la foto; bajarla, lo de arriba. La foto de prueba cambia de arriba abajo.
    const half = async (name: string, t: number, top: boolean) => {
      const { stdout } = await exec(
        tools.ffmpeg,
        ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(t), '-i', bucket.file(inBrand(`reels/${name}.mp4`)),
          '-vf', `crop=${W}:${H / 2}:0:${top ? 0 : H / 2},scale=1:1:flags=area,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'],
        { encoding: 'buffer' },
      );
      return (stdout as unknown as Buffer)[0]!;
    };
    const up0 = [await half('up', 0.05, true), await half('up', 0.05, false)];
    const up1 = [await half('up', 1.9, true), await half('up', 1.9, false)];
    const down0 = [await half('down', 0.05, true), await half('down', 0.05, false)];
    // La cámara se mueve (el reparto cambia entre el principio y el final) y los dos sentidos empiezan distinto.
    expect(Math.abs(up0[0]! - up1[0]!) + Math.abs(up0[1]! - up1[1]!)).toBeGreaterThan(10);
    expect(up0[0]!).toBeGreaterThan(down0[0]!);
  });

  it('la portada sale como JPEG: de un fotograma o de una foto, y avisa si se pasa del final', async () => {
    const poster = inBrand('reels/frame-cover.jpg');
    const frame = await render('frame-cover', { cover: { type: 'frame', at: 1.5 } }, { posterPath: poster });
    expect(frame.poster).toMatchObject({ path: poster, source: 'frame', atSeconds: 1.5, width: W, height: H });
    expect((await stat(bucket.file(poster))).size).toBeGreaterThan(500);

    const photoPoster = inBrand('reels/photo-cover.jpg');
    const photo = await render('photo-cover', { cover: { type: 'photo', path: inBrand('plato.jpg') } }, { posterPath: photoPoster });
    expect(photo.poster).toMatchObject({ path: photoPoster, source: 'photo' });
    expect((await stat(bucket.file(photoPoster))).size).toBeGreaterThan(500);

    const late = await render('late-cover', { cover: { type: 'frame', at: 80 } }, { posterPath: inBrand('reels/late-cover.jpg') });
    expect(late.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/portada/i)]));
  });
});
