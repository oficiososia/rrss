// Reels con calidad de profesional (docs/reels-calidad.md):
//  * textos: cortes de línea equilibrados, tamaño mínimo por papel, zonas
//    seguras de Instagram y NUNCA dos textos encima uno de otro;
//  * encuadre sobre el sujeto (máscara o saliencia), no sobre el centro;
//  * codificación (High, ~9 Mbps, +faststart) y vídeo sin pista de
//    audio cuando no hay sonido;
//  * cierre con la marca;
//  * y, con FFmpeg real, que todo eso sale así en el MP4.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BUNDLED_DISPLAY_FONT } from '../src/ffmpeg/fonts.ts';
import { lineBoxHeight, measureText, parseFontMetrics, type FontMetrics } from '../src/ffmpeg/fontmetrics.ts';
import { createReelTemplateHandler } from '../src/handlers/reel-template.ts';
import { buildReel, photoFraming, reelVideoArgs, type ResolvedClip, type ResolvedPlanText } from '../src/reel/build.ts';
import { reelPlanV2Schema } from '../src/reel/schema.ts';
import { maskSubjectFromAlpha, orientPoint, saliencySubject } from '../src/reel/subject.ts';
import {
  balancedLines,
  inferRole,
  layoutText,
  measurer,
  placeTexts,
  safeArea,
  SAFE_ZONE,
} from '../src/reel/textlayout.ts';
import { loadTemplates } from '../src/reel/templates.ts';
import { createBucket, deps, inBrand, mp4Boxes, probe, runHandler, tools, type Bucket } from './helpers/media.ts';

const exec = promisify(execFile);
const templates = loadTemplates();
const fundido = templates.get('fundido-suave')!;
const corte = templates.get('corte-ritmico')!;
let metrics: FontMetrics;

beforeAll(async () => {
  metrics = parseFontMetrics(await readFile(BUNDLED_DISPLAY_FONT))!;
});

const STYLE = {
  sizeRatio: 0.06,
  color: '#FFFFFF',
  marginRatio: 0.2,
  maxWidthRatio: 0.84,
  lineHeight: 1.3,
  box: null,
  outline: null,
  fadeSeconds: 0.25,
};
const text = (id: string, value: string, start: number, end: number, extra: Partial<ResolvedPlanText> = {}) =>
  ({ id, text: value, start, end, position: 'center', style: STYLE, ...extra }) as ResolvedPlanText;
const photo = (file: string, seconds = 3, extra: Partial<Extract<ResolvedClip, { type: 'photo' }>> = {}): ResolvedClip => ({
  type: 'photo',
  file,
  orientation: 1,
  seconds,
  ...extra,
});
const overlaps = (a: { start: number; end: number; top: number; bottom: number }, b: typeof a) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.02 && a.top < b.bottom && b.top < a.bottom;

describe('tipografía del trabajador', () => {
  it('la tipografía incluida se lee y mide de verdad (ancho por letra, alto de línea)', () => {
    expect(metrics.unitsPerEm).toBeGreaterThan(0);
    const wide = measureText(metrics, 'MMMM', 100);
    const narrow = measureText(metrics, 'iiii', 100);
    expect(wide).toBeGreaterThan(narrow * 2);
    expect(lineBoxHeight(metrics, 100)).toBeGreaterThan(100);
    expect(parseFontMetrics(Buffer.from('no es una tipografía'))).toBeNull();
  });
});

describe('composición de los textos', () => {
  const m = () => measurer(metrics);

  it('corta las líneas equilibradas y sin dejar «de la» colgando', () => {
    const lines = balancedLines('Lo que sale de la cocina', 860, (s) => measureText(metrics, s, 92));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.split(' ').at(-1)).not.toMatch(/^(de|la)$/);
    expect(lines).toEqual(['Lo que sale', 'de la cocina']);
  });

  it('cada papel tiene su tamaño mínimo: un titular nunca sale a 60 px', () => {
    const headline = layoutText({ text: 'Chuletón para el fin de semana', style: STYLE, position: 'center', role: 'headline' }, 1080, 1920, m());
    expect(headline.fontSize).toBeGreaterThanOrEqual(Math.round(0.085 * 1080 * 0.9));
    const label = layoutText({ text: 'A la brasa', style: { ...STYLE, sizeRatio: 0.03 }, position: 'bottom', role: 'label' }, 1080, 1920, m());
    expect(label.fontSize).toBeGreaterThanOrEqual(Math.round(0.056 * 1080));
  });

  it('nada en las zonas que tapa Instagram, aunque el plan lo ponga ahí', () => {
    const area = safeArea(1080, 1920);
    expect(area).toEqual({ top: 250, bottom: 1520, left: 60, right: 1020 });
    for (const position of ['top', 'center', 'bottom'] as const) {
      for (const offset of [-0.5, 0, 0.5]) {
        const laid = layoutText(
          { text: 'Reserva tu mesa este fin de semana', style: { ...STYLE, marginRatio: 0 }, position, offset: { x: 0, y: offset } },
          1080,
          1920,
          m(),
        );
        expect(laid.extent[0]).toBeGreaterThanOrEqual(area.top);
        expect(laid.extent[1]).toBeLessThanOrEqual(area.bottom);
        expect(laid.blockWidth).toBeLessThanOrEqual(area.right - area.left + 1);
      }
    }
    expect(SAFE_ZONE.top * 1920).toBeCloseTo(250);
    expect(SAFE_ZONE.bottom * 1920).toBeCloseTo(400);
  });

  it('dos textos a la vez en el mismo sitio se apilan; si no caben, se encadenan', () => {
    const lay = (value: string) => layoutText({ text: value, style: STYLE, position: 'center', role: 'headline' }, 1080, 1920, m());
    const stacked = placeTexts(
      [
        { index: 0, start: 2.4, end: 6.4, laid: lay('Vaca madurada 60 días'), position: 'center' },
        { index: 1, start: 2.4, end: 6.4, laid: lay('A la brasa'), position: 'center' },
      ],
      1080,
      1920,
    );
    expect(stacked.placed).toHaveLength(2);
    expect(stacked.placed[1]!.resolved).toBe('stacked');
    const [a, b] = stacked.placed.map((p) => ({ start: p.start, end: p.end, top: p.laid.extent[0], bottom: p.laid.extent[1] }));
    expect(overlaps(a!, b!)).toBe(false);
    // Tres titulares largos a la vez no caben apilados: el tercero entra cuando el primero se va.
    const long = 'Un titular larguísimo que ocupa tres líneas enteras';
    const many = placeTexts(
      [0, 1, 2, 3].map((i) => ({ index: i, start: 0, end: 6, laid: lay(long), position: 'center' as const })),
      1080,
      1920,
    );
    const boxes = many.placed.map((p) => ({ start: p.start, end: p.end, top: p.laid.extent[0], bottom: p.laid.extent[1] }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) expect(overlaps(boxes[i]!, boxes[j]!), `${i} y ${j}`).toBe(false);
    }
    expect(many.placed.some((p) => p.resolved === 'chained')).toBe(true);
  });

  it('deduce el papel: gancho al principio, llamada al final, precio con euros', () => {
    expect(inferRole({ text: 'Lo que sale de la cocina', start: 0, end: 2 }, 0, 12, 0)).toBe('headline');
    expect(inferRole({ text: 'Reserva tu mesa', start: 9, end: 12 }, 3, 12, 0)).toBe('cta');
    expect(inferRole({ text: 'Menú · 18 €', start: 4, end: 6 }, 2, 12, 0)).toBe('price');
    expect(inferRole({ text: 'A la brasa', start: 3, end: 6 }, 1, 12, 0)).toBe('label');
  });
});

describe('el reel de las pruebas del 23/11: ningún texto pisa a otro', () => {
  it('«Vaca madurada 60 días» y «A la brasa» a la vez en el centro salen separados y dentro de la zona segura', () => {
    const build = buildReel({
      template: fundido,
      plan: {
        clips: [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')],
        texts: [
          text('t1', 'Chuletón para el fin de semana', 0, 2.4),
          text('t2', 'Vaca madurada 60 días', 2.4, 6.4),
          text('t3', 'A la brasa', 2.4, 6.4),
          text('t4', 'Reservar mesa', 6.4, 8),
        ],
      },
      fontFile: 'font.ttf',
      fontMetrics: { 'font.ttf': metrics },
      outputFile: 'r.mp4',
    });
    const placed = build.texts;
    expect(placed).toHaveLength(4);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) expect(overlaps(placed[i]!, placed[j]!), `${i} y ${j}`).toBe(false);
      expect(placed[i]!.top).toBeGreaterThanOrEqual(250);
      expect(placed[i]!.bottom).toBeLessThanOrEqual(1520);
      expect(placed[i]!.width).toBeLessThanOrEqual(960);
    }
    // El primero es el gancho, a tamaño de titular; ninguno por debajo de ~54 px.
    expect(placed[0]).toMatchObject({ role: 'headline' });
    expect(placed[0]!.fontSize).toBeGreaterThanOrEqual(83);
    expect(Math.min(...placed.map((p) => p.fontSize))).toBeGreaterThanOrEqual(54);
    // Todos con `y_align=font` y algo para leerse: caja o contorno con sombra.
    const draws = build.filterGraph.match(/drawtext=[^,\]]+(?:,(?!drawtext|format)[^,\]]+)*/g) ?? [];
    expect(draws.length).toBeGreaterThan(0);
    for (const d of build.filterGraph.split('drawtext=').slice(1)) {
      expect(d).toContain('y_align=font');
      expect(/box=1|borderw=/.test(d)).toBe(true);
    }
    expect(build.warnings.join(' ')).toMatch(/coincidía con otro/);
  });
});

describe('encuadre sobre el sujeto', () => {
  it('con máscara, la cámara va hacia lo opaco y no al centro de la foto', () => {
    // Foto 1600 × 900 con el plato (la máscara) a la derecha.
    const alpha = new Uint8Array(160 * 90);
    for (let y = 30; y < 70; y += 1) for (let x = 100; x < 140; x += 1) alpha[y * 160 + x] = 255;
    const subject = maskSubjectFromAlpha(alpha, 160, 90)!;
    expect(subject.source).toBe('mask');
    expect(subject.focal.x).toBeCloseTo(0.75, 1);
    const frame = photoFraming({ sourceSize: { width: 1600, height: 900 }, subject }, 2160, 3840);
    expect(frame.mode).toBe('cover');
    expect(frame.focal.x).toBeCloseTo(0.75, 1);
    expect(frame.source).toBe('mask');
    // Sin sujeto, el centro (como antes).
    expect(photoFraming({ sourceSize: { width: 1600, height: 900 } }, 2160, 3840).focal).toEqual({ x: 0.5, y: 0.5 });
    // El punto guardado por la persona manda sobre la máscara.
    expect(photoFraming({ sourceSize: { width: 1600, height: 900 }, subject, focalPoint: { x: 0.2, y: 0.5 } }, 2160, 3840).source).toBe('plan');
  });

  it('solo una foto muy apaisada (panorámica) se ve sobre su copia ampliada y desenfocada a sangre, con sombra', () => {
    const subject = { focal: { x: 0.5, y: 0.6 }, box: { x: 0.05, y: 0.35, w: 0.9, h: 0.4 }, source: 'saliency' as const };
    const frame = photoFraming({ sourceSize: { width: 2400, height: 900 }, subject }, 2160, 3840);
    expect(frame.mode).toBe('fit');
    expect(frame.fit!.fgW).toBeLessThan(2400 * (3840 / 900));
    // La foto ocupa al menos el 80 % del alto: nada de una franja estrecha.
    expect(frame.fit!.cropH).toBeGreaterThanOrEqual(3840 * 0.8 - 2);
    const build = buildReel({
      template: fundido,
      plan: { clips: [photo('a.jpg', 3, { sourceSize: { width: 2400, height: 900 }, subject })], texts: [] },
      outputFile: 'r.mp4',
      outputWidth: 540,
    });
    expect(build.framing[0]).toMatchObject({ mode: 'fit', source: 'saliency' });
    expect(build.filterGraph).toMatch(/split=2\[pb0\]\[pf0\]/);
    expect(build.filterGraph).toMatch(/overlay=\d+:\d+,/);
    expect(build.filterGraph).toMatch(/drawbox=[^,]*color=black@0\.55:t=fill,gblur/);
  });

  it('la saliencia encuentra lo que se aparta del fondo (un plato rojo descentrado)', () => {
    const w = 128;
    const h = 72;
    const data = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 3;
        const inside = (x - 92) ** 2 + (y - 40) ** 2 < 15 ** 2;
        data[i] = inside ? 200 : 120;
        data[i + 1] = inside ? 40 : 118;
        data[i + 2] = inside ? 40 : 112;
      }
    }
    const subject = saliencySubject(data, w, h, 3)!;
    expect(subject.focal.x).toBeGreaterThan(0.6);
    expect(subject.focal.x).toBeLessThan(0.82);
    expect(subject.focal.y).toBeGreaterThan(0.4);
    expect(subject.box.x).toBeGreaterThan(0.45);
    // La orientación EXIF 6 (girar a la derecha) lleva la esquina de arriba a la izquierda a la de arriba a la derecha.
    expect(orientPoint({ x: 0, y: 0 }, 6)).toEqual({ x: 1, y: 0 });
    expect(orientPoint({ x: 0, y: 0 }, 8)).toEqual({ x: 0, y: 1 });
  });
});

describe('ritmo y variedad de encuadre', () => {
  it('una foto horizontal normal llena el 9:16 recortando sobre el sujeto: sin bandas', () => {
    // Un plato que ocupa la mitad de una foto 4:3: a pantalla llena se ve casi entero.
    const subject = { focal: { x: 0.6, y: 0.55 }, box: { x: 0.35, y: 0.3, w: 0.5, h: 0.5 }, source: 'saliency' as const };
    expect(photoFraming({ sourceSize: { width: 1200, height: 900 }, subject }, 2160, 3840).mode).toBe('cover');
    // Ni siquiera con un plato que ocupa casi todo el ancho de una foto 4:3.
    const wide = { ...subject, box: { x: 0.05, y: 0.3, w: 0.9, h: 0.5 } };
    expect(photoFraming({ sourceSize: { width: 1200, height: 900 }, subject: wide }, 2160, 3840).mode).toBe('cover');
  });

  it('un plano de foto de 1,6 s o más corta a mitad a un detalle del sujeto; los cortes secos entran con golpe de zoom', () => {
    const big = { width: 3000, height: 4000 };
    const build = buildReel({
      template: corte,
      plan: {
        clips: [
          photo('a.jpg', 1.8, { motion: 'zoom-in', sourceSize: big }),
          photo('b.jpg', 1.2, { motion: 'zoom-in', sourceSize: big }),
          photo('c.jpg', 1.8, { motion: 'zoom-in', sourceSize: { width: 500, height: 500 } }),
        ],
        texts: [],
      },
      outputFile: 'r.mp4',
      outputWidth: 540,
    });
    const chain = (i: number) => build.filterGraph.split(';\n').find((c) => c.startsWith(`[${i}:v]`))!;
    // 1,8 s = 54 fotogramas: a los 27, el detalle (×1,55) con su golpe.
    expect(chain(0)).toContain('if(lt(on,27),');
    expect(chain(0)).toContain('1.55+');
    expect(chain(0)).toContain('pow(max(0,1-on/8),2)');
    // Plano corto: sin detalle, pero con golpe; foto pequeña: sin detalle (se vería borrosa).
    expect(chain(1)).not.toContain('if(lt(on');
    expect(chain(1)).toContain('pow(max(0,1-on/8),2)');
    expect(chain(2)).not.toContain('1.55+');
  });
});

describe('encuadre ceñido y detalle con resolución (F67: zapatillas a la vista y tortitas borrosas)', () => {
  // Foto de móvil vertical con el plato pequeño en el centro y la encimera (y unos pies) alrededor.
  const plate = { focal: { x: 0.5, y: 0.45 }, box: { x: 0.3, y: 0.32, w: 0.4, h: 0.26 }, source: 'saliency' as const };

  it('con el plato localizado, se acerca a él: lo que sobra alrededor queda fuera', () => {
    const frame = photoFraming({ sourceSize: { width: 3024, height: 4032 }, subject: plate }, 2160, 3840);
    expect(frame.mode).toBe('cover');
    expect(frame.tighten).toBeGreaterThan(1.3);
    expect(frame.tighten).toBeLessThanOrEqual(1.5);
    // El plato pasa a ocupar mucho más del cuadro (antes, ~40 % del ancho) y lo de abajo (los pies) sale.
    expect(frame.subjectBox!.w).toBeGreaterThan(0.55);
    expect(frame.subjectBox!.y + frame.subjectBox!.h).toBeLessThan(0.8);
    // Con máscara se puede ceñir más; con el punto que eligió la persona, no se toca.
    const masked = photoFraming({ sourceSize: { width: 3024, height: 4032 }, subject: { ...plate, source: 'mask' } }, 2160, 3840);
    expect(masked.tighten).toBeGreaterThanOrEqual(frame.tighten);
    expect(
      photoFraming({ sourceSize: { width: 3024, height: 4032 }, subject: plate, focalPoint: { x: 0.5, y: 0.5 } }, 2160, 3840)
        .tighten,
    ).toBe(1);
    // En el filtro: la foto se escala más que a pantalla llena antes del recorte.
    const build = buildReel({
      template: corte,
      plan: { clips: [photo('a.jpg', 1.8, { motion: 'zoom-in', sourceSize: { width: 3024, height: 4032 }, subject: plate })], texts: [] },
      outputFile: 'r.mp4',
      outputWidth: 540,
    });
    const scale = /scale=(\d+):(\d+):force_original_aspect_ratio=increase:flags=lanczos/.exec(build.filterGraph)!;
    expect(Number(scale[1])).toBeGreaterThan(1080 * 1.3);
    expect(build.framing[0]!.tighten).toBe(frame.tighten);
  });

  it('nunca amplía por debajo de ~1000 px de la foto a lo ancho: con poca resolución, ni se ciñe ni hay corte a detalle', () => {
    const small = { width: 1200, height: 1600 };
    const frame = photoFraming({ sourceSize: small, subject: plate }, 2160, 3840);
    expect(frame.tighten).toBe(1);
    expect(frame.room).toBeLessThan(1);
    const medium = { width: 1536, height: 2048 };
    const build = buildReel({
      template: corte,
      plan: {
        clips: [
          photo('tortitas.jpg', 1.8, { motion: 'zoom-in', sourceSize: small, subject: plate }),
          photo('whatsapp.jpg', 1.8, { motion: 'zoom-in', sourceSize: medium }),
          photo('grande.jpg', 1.8, { motion: 'zoom-in', sourceSize: { width: 3000, height: 4000 } }),
        ],
        texts: [],
      },
      outputFile: 'r.mp4',
      outputWidth: 540,
    });
    expect(build.framing.map((f) => f.detail)).toEqual([0, 0, 1.55]);
    const chain = (i: number) => build.filterGraph.split(';\n').find((c) => c.startsWith(`[${i}:v]`))!;
    expect(chain(0)).not.toContain('if(lt(on');
    expect(chain(1)).not.toContain('if(lt(on');
    // Con la foto ceñida, el detalle se queda en lo que aguanta la resolución (menos de ×1,55) o no se hace.
    const tight = photoFraming({ sourceSize: { width: 3024, height: 4032 }, subject: plate }, 2160, 3840);
    expect(tight.room).toBeGreaterThanOrEqual(1.1);
  });

  it('el detalle no se sale del plato: la ventana se queda dentro de su caja', () => {
    const build = buildReel({
      template: corte,
      plan: {
        clips: [photo('a.jpg', 1.8, { motion: 'zoom-in', sourceSize: { width: 4000, height: 6000 }, subject: plate })],
        texts: [],
      },
      outputFile: 'r.mp4',
      outputWidth: 540,
    });
    const chain = build.filterGraph.split(';\n').find((c) => c.startsWith('[0:v]'))!;
    expect(build.framing[0]!.detail).toBeGreaterThanOrEqual(1.25);
    // x e y del detalle: dentro de la caja del sujeto (o centrados en ella si es más pequeña que la ventana).
    expect(chain).toMatch(/x='if\(lt\(on,27\),[^']*if\(gt\(iw\/zoom,/);
    expect(chain).toMatch(/y='if\(lt\(on,27\),[^']*if\(gt\(ih\/zoom,/);
  });
});

describe('codificación, sonido y cierre', () => {
  it('H.264 High a ~9 Mbps, fotograma clave cada 2 s y +faststart', () => {
    const args = reelVideoArgs(corte);
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(at('-profile:v')).toBe('high');
    expect(at('-b:v')).toBe('9000k');
    expect(Number.parseInt(at('-maxrate')!, 10)).toBeGreaterThan(9000);
    expect(at('-preset')).toBe('medium');
    expect(at('-pix_fmt')).toBe('yuv420p');
    expect(at('-movflags')).toBe('+faststart');
    expect(at('-g')).toBe('60');
    expect(corte.export.audioBitrateKbps).toBeGreaterThanOrEqual(128);
    expect(corte.export.audioBitrateKbps).toBeLessThanOrEqual(192);
  });

  it('sin música ni sonido de clips no hay pista de audio (nada de una pista muda)', () => {
    const build = buildReel({ template: fundido, plan: { clips: [photo('a.jpg')], texts: [] }, outputFile: 'r.mp4' });
    expect(build.audio).toBe('none');
    expect(build.args).toContain('-an');
    expect(build.filterGraph).not.toContain('anullsrc');
    expect(build.args).not.toContain('[aout]');
    const withMusic = buildReel({
      template: fundido,
      plan: {
        clips: [photo('a.jpg')],
        texts: [],
        music: { file: 'm.m4a', startAt: 0, volume: 0.4, fadeInSeconds: 0.5, fadeOutSeconds: 1 },
      },
      outputFile: 'r.mp4',
    });
    expect(withMusic.audio).toBe('music');
    expect(withMusic.args[withMusic.args.indexOf('-b:a') + 1]).toBe('160k');
  });

  it('el cierre con la marca dura lo pedido, entra con un fundido y lleva la llamada en grande', () => {
    const build = buildReel({
      template: corte,
      plan: {
        clips: [photo('a.jpg', 2), photo('b.jpg', 2)],
        texts: [text('t1', 'Reserva tu mesa', 2.5, 4)],
        outro: { seconds: 2, cta: 'Reserva tu mesa', handle: '@marca', address: 'Calle Mayor 1', accent: '#C9A14A' },
      },
      fontFile: 'font.ttf',
      fontMetrics: { 'font.ttf': metrics },
      outputFile: 'r.mp4',
    });
    expect(build.durationSeconds).toBeCloseTo(4 - 0.4 + 2, 3);
    expect(build.timeline.at(-1)).toMatchObject({ type: 'outro', seconds: 2 });
    const outro = build.texts.filter((t) => t.kind === 'outro');
    expect(outro.map((t) => t.lines.join(' '))).toEqual(['Reserva tu mesa', '@marca', 'Calle Mayor 1']);
    expect(outro[0]!.fontSize).toBeGreaterThanOrEqual(78);
    // Los textos del plan no entran en el cierre.
    const own = build.texts.find((t) => t.kind === 'text')!;
    expect(own.end).toBeLessThanOrEqual(build.timeline.at(-1)!.start + 1e-6);
    for (const t of build.texts) {
      expect(t.top).toBeGreaterThanOrEqual(250);
      expect(t.bottom).toBeLessThanOrEqual(1520);
    }
    expect(build.filterGraph).toContain('xfade=transition=fade:duration=0.4:offset=3.6');
  });

  it('el esquema admite los campos nuevos como opcionales (null = ausente) y rechaza lo inventado', () => {
    const base = { version: 2, clips: [{ id: 'c1', type: 'photo', path: inBrand('a.jpg'), seconds: 2 }] };
    const parsed = reelPlanV2Schema.parse(base);
    expect(parsed).toMatchObject({ outro: null, grade: null });
    expect(parsed.clips[0]).toMatchObject({ subjectMaskPath: null });
    expect(reelPlanV2Schema.safeParse({ ...base, grade: 'warm', outro: { cta: 'Reserva' } }).success).toBe(true);
    expect(reelPlanV2Schema.safeParse({ ...base, grade: 'neon' }).success).toBe(false);
    expect(reelPlanV2Schema.safeParse({ ...base, outro: { cta: 'Reserva', musica: 1 } }).success).toBe(false);
  });
});

describe('con FFmpeg real', () => {
  const handler = createReelTemplateHandler(deps);
  let bucket: Bucket;

  beforeAll(async () => {
    bucket = await createBucket();
    // Foto horizontal gris con el «plato» (un círculo rojo) a la derecha: si se recortara por el centro, no saldría.
    await exec(tools.ffmpeg, [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x787670:s=1600x900',
      '-vf', "geq=r='if(lt(hypot(X-1240,Y-470),150),210,120)':g='if(lt(hypot(X-1240,Y-470),150),40,118)':b='if(lt(hypot(X-1240,Y-470),150),40,112)'",
      '-frames:v', '1', bucket.file(inBrand('plato.jpg')),
    ]);
    await exec(tools.ffmpeg, [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=1', '-frames:v', '1', bucket.file(inBrand('sala.jpg')),
    ]);
  });
  afterAll(async () => {
    await bucket?.cleanup();
  });

  it('encuadra el plato, no pisa textos, cierra con la marca y sale sin pista de audio, en High y con +faststart', async () => {
    const result = await runHandler(handler, bucket, {
      template: { id: 'corte-ritmico' },
      plan: {
        version: 2,
        clips: [
          { id: 'c1', type: 'photo', path: inBrand('plato.jpg'), seconds: 2 },
          { id: 'c2', type: 'photo', path: inBrand('sala.jpg'), seconds: 1.5 },
        ],
        texts: [
          { id: 't1', text: 'Vaca madurada 60 días', start: 0, end: 2, position: 'center', style: STYLE },
          { id: 't2', text: 'A la brasa', start: 0, end: 2, position: 'center', style: STYLE, role: 'label' },
        ],
        outro: { cta: 'Reserva tu mesa', handle: '@marca', seconds: 1.5 },
      },
      output: { path: inBrand('salida/reel.mp4'), width: 540 },
    });
    const output = result.output as Record<string, unknown>;
    expect(output).toMatchObject({ audio: 'none', audioCodec: null, width: 540, height: 960 });
    const framing = result.framing as Array<{ target: { x: number }; source: string }>;
    expect(framing[0]!.source).toBe('saliency');
    const info = await probe(bucket.file(inBrand('salida/reel.mp4')));
    expect(info.audio).toBeUndefined();
    expect(info.durationSeconds).toBeCloseTo(2 + 1.5 + 1.5 - 0.4, 1);
    const { stdout } = await exec(tools.ffprobe, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=profile', '-of', 'json',
      bucket.file(inBrand('salida/reel.mp4')),
    ]);
    expect(JSON.parse(stdout).streams[0]).toMatchObject({ profile: 'High' });
    const boxes = await mp4Boxes(bucket.file(inBrand('salida/reel.mp4')));
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
    // El plato rojo está en el cuadro (por el centro de la foto solo se vería gris).
    const { stdout: raw } = await exec(
      tools.ffmpeg,
      ['-v', 'error', '-ss', '0.1', '-i', bucket.file(inBrand('salida/reel.mp4')), '-frames:v', '1', '-vf', 'scale=54:96', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { encoding: 'buffer', maxBuffer: 1 << 20 },
    );
    const pixels = raw as unknown as Buffer;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 3) if (pixels[i]! > 150 && pixels[i + 1]! < 90) red += 1;
    expect(red / (pixels.length / 3)).toBeGreaterThan(0.1);
    expect((result.warnings as string[]).join(' ')).toMatch(/coincidía con otro/);
  });
});
