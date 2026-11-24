import { describe, expect, it } from 'vitest';
import { boxBlur } from '../cutout/composition';
import type { Pixels } from '../pixels';
import { applyStrokes, paintSegment, veilOver, withAlpha, type BrushStroke } from './brush';
import { portraitBlur } from './blur';

/** El método ingenuo que había antes: difuminar toda la foto (los colores del plato se mezclan con el fondo). */
function blurPixels(image: Pixels, radius: number): Pixels {
  const out = new Uint8ClampedArray(image.data);
  for (let c = 0; c < 3; c += 1) {
    const plane = new Float32Array(image.width * image.height);
    for (let p = 0; p < plane.length; p += 1) plane[p] = image.data[p * 4 + c]!;
    const blurred = boxBlur(plane, image.width, image.height, radius);
    for (let p = 0; p < blurred.length; p += 1) out[p * 4 + c] = blurred[p]!;
  }
  return { data: out, width: image.width, height: image.height };
}

type RGB = readonly [number, number, number];

/** Escena: fondo (función de la posición) con un disco rojo (el plato) en el centro. */
function scene(size: number, background: (x: number, y: number) => RGB, subject: RGB = [220, 30, 30]) {
  const data = new Uint8ClampedArray(size * size * 4);
  const alpha = new Uint8Array(size * size);
  const c = size / 2;
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const i = y * size + x;
      const inside = d <= radius;
      const color = inside ? subject : background(x / size, y / size);
      data.set([color[0], color[1], color[2], 255], i * 4);
      alpha[i] = inside ? 255 : 0;
    }
  }
  return { image: { data, width: size, height: size } as Pixels, alpha, radius, center: c };
}

const stripes = (u: number): RGB => (Math.floor(u * 40) % 2 === 0 ? [240, 240, 240] : [20, 60, 20]);
const flat: RGB = [60, 100, 180];

function at(image: Pixels, x: number, y: number): [number, number, number] {
  const o = (y * image.width + x) * 4;
  return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!];
}

/** Desviación típica del canal verde en los píxeles de fondo que cumplen `keep`. */
function spread(image: Pixels, alpha: Uint8Array, keep: (x: number, y: number) => boolean) {
  const values: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (alpha[y * image.width + x] === 0 && keep(x, y)) values.push(image.data[(y * image.width + x) * 4 + 1]!);
    }
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

describe('modo retrato: el desenfoque', () => {
  it('el plato no cambia y el fondo sí', () => {
    const { image, alpha, center, radius } = scene(240, (u) => stripes(u));
    const out = portraitBlur(image, alpha, { amount: 70, progressive: true, dim: 0 });
    // Dentro del plato (lejos del borde): idéntico.
    for (const [dx, dy] of [
      [0, 0],
      [20, -10],
      [-30, 25],
      [radius - 8, 0],
    ] as const) {
      expect(at(out, Math.round(center + dx), Math.round(center + dy))).toEqual(
        at(image, Math.round(center + dx), Math.round(center + dy)),
      );
    }
    // El fondo (rayas muy marcadas) queda mucho menos contrastado.
    const before = spread(image, alpha, () => true);
    const after = spread(out, alpha, () => true);
    expect(before).toBeGreaterThan(80);
    expect(after).toBeLessThan(before * 0.35);
    // Y es una imagen nueva, opaca y de las mismas medidas.
    expect(out).not.toBe(image);
    expect(out.width).toBe(image.width);
    expect(out.data[3]).toBe(255);
  });

  it('no modifica sus entradas', () => {
    const { image, alpha } = scene(120, (u) => stripes(u));
    const copy = new Uint8ClampedArray(image.data);
    const alphaCopy = new Uint8Array(alpha);
    portraitBlur(image, alpha, { amount: 100 });
    expect(image.data).toEqual(copy);
    expect(alpha).toEqual(alphaCopy);
  });

  it('sin halo: el fondo junto al plato no coge el color del plato (un gaussiano plano sí)', () => {
    const { image, alpha, center, radius } = scene(240, () => flat);
    const out = portraitBlur(image, alpha, { amount: 100, progressive: false, dim: 0 });
    // Anillo de fondo pegado al plato, justo fuera de su borde.
    const ring: Array<[number, number]> = [];
    for (let a = 0; a < 360; a += 5) {
      const rad = (a * Math.PI) / 180;
      for (const gap of [2, 4, 8]) {
        ring.push([
          Math.round(center + Math.cos(rad) * (radius + gap)),
          Math.round(center + Math.sin(rad) * (radius + gap)),
        ]);
      }
    }
    const worst = Math.max(
      ...ring.map(([x, y]) => {
        const [r, g, b] = at(out, x, y);
        return Math.max(Math.abs(r - flat[0]), Math.abs(g - flat[1]), Math.abs(b - flat[2]));
      }),
    );
    expect(worst).toBeLessThanOrEqual(3);

    // El método ingenuo (difuminar toda la foto y pegar el plato) sí deja halo.
    const naive = blurPixels(image, 0.04 * 240);
    let naiveWorst = 0;
    for (const [x, y] of ring) {
      const [r] = at(naive, x, y);
      naiveWorst = Math.max(naiveWorst, Math.abs(r - flat[0]));
    }
    expect(naiveWorst).toBeGreaterThan(30);
  });

  it('con el plato en el borde de la foto o sin fondo no falla ni da valores raros', () => {
    const size = 100;
    const image = scene(size, () => flat, flat).image;
    const all = new Uint8Array(size * size).fill(255);
    const none = new Uint8Array(size * size);
    expect(portraitBlur(image, all).data).toEqual(image.data);
    const noSubject = portraitBlur(image, none, { amount: 50 });
    for (const v of at(noSubject, 50, 50)) expect(Number.isFinite(v)).toBe(true);
    expect(at(noSubject, 50, 50)).toEqual([...flat]);
  });

  it('más intensidad, más desenfoque', () => {
    const { image, alpha } = scene(240, (u) => stripes(u));
    const soft = spread(portraitBlur(image, alpha, { amount: 10, progressive: false }), alpha, () => true);
    const strong = spread(portraitBlur(image, alpha, { amount: 100, progressive: false }), alpha, () => true);
    expect(strong).toBeLessThan(soft);
  });

  it('progresivo: junto al plato queda más nítido que lejos', () => {
    const { image, alpha, center, radius } = scene(300, (u) => stripes(u));
    const out = portraitBlur(image, alpha, { amount: 100, progressive: true });
    const near = spread(out, alpha, (x, y) => Math.hypot(x - center, y - center) < radius + 20);
    const far = spread(out, alpha, (x, y) => Math.hypot(x - center, y - center) > radius * 2.2);
    expect(near).toBeGreaterThan(far);
  });

  it('«Resaltar el plato» oscurece el fondo y no toca el plato', () => {
    const { image, alpha, center } = scene(160, () => flat);
    const plain = portraitBlur(image, alpha, { amount: 50, dim: 0 });
    const dim = portraitBlur(image, alpha, { amount: 50, dim: 100 });
    expect(at(dim, 5, 5)[2]).toBeLessThan(at(plain, 5, 5)[2]! * 0.6);
    expect(at(dim, center, center)).toEqual(at(image, center, center));
  });

  it('el borde del plato se mezcla de forma suave (sin escalón)', () => {
    const { image, alpha, center, radius } = scene(240, (u) => stripes(u));
    const out = portraitBlur(image, alpha, { amount: 80 });
    // Recorre una línea horizontal que cruza el borde: el salto entre vecinos del
    // rojo no pasa del que ya había (el borde es un escalón de 1 px en la entrada).
    const y = Math.round(center);
    const edge = Math.round(center + radius);
    let maxStep = 0;
    for (let x = edge - 4; x < edge + 4; x += 1)
      maxStep = Math.max(maxStep, Math.abs(at(out, x + 1, y)[0]! - at(out, x, y)[0]!));
    expect(maxStep).toBeLessThan(220 - 20);
  });

  // Desenfoca de verdad una foto de 900×900 (y otra de 300×300) en JavaScript: con la máquina libre,
  // un segundo; con la máquina cargada se ha medido más de 5 s, el límite por defecto. Es cálculo,
  // no una espera: límite propio.
  it('vista previa y archivo guardado salen igual: la misma foto a dos tamaños da el mismo resultado', { timeout: 60_000 }, () => {
    const bg = (u: number, v: number): RGB => [
      Math.round(60 + 140 * u),
      Math.round(200 - 120 * v),
      Math.floor(u * 6) % 2 ? 90 : 160,
    ];
    const small = scene(300, bg);
    const large = scene(900, bg);
    const a = portraitBlur(small.image, small.alpha, { amount: 60, progressive: true, dim: 20 });
    const b = portraitBlur(large.image, large.alpha, { amount: 60, progressive: true, dim: 20 });
    // Se reduce la grande a 300 por promedio y se compara con la pequeña.
    let total = 0;
    let count = 0;
    for (let y = 0; y < 300; y += 1) {
      for (let x = 0; x < 300; x += 1) {
        if (small.alpha[y * 300 + x] !== 0) continue;
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          for (let dy = 0; dy < 3; dy += 1)
            for (let dx = 0; dx < 3; dx += 1) sum += b.data[((y * 3 + dy) * 900 + x * 3 + dx) * 4 + c]!;
          total += Math.abs(sum / 9 - a.data[(y * 300 + x) * 4 + c]!);
          count += 1;
        }
      }
    }
    expect(total / count).toBeLessThan(4);
  });

  it('rechaza una selección de otro tamaño', () => {
    const { image } = scene(50, () => flat);
    expect(() => portraitBlur(image, new Uint8Array(10))).toThrow(/medidas/);
  });
});

describe('retocar la selección: el pincel', () => {
  const W = 80;
  const H = 60;
  const empty = () => new Uint8Array(W * H);

  it('añadir pinta el plato y quitar lo borra', () => {
    const base = empty();
    const add: BrushStroke = { mode: 'add', radius: 0.1, points: [[0.5, 0.5]] };
    const withAdd = applyStrokes(base, W, H, [add]);
    expect(withAdd[30 * W + 40]).toBe(255);
    expect(withAdd[0]).toBe(0);
    const solid = new Uint8Array(W * H).fill(255);
    const withRemove = applyStrokes(solid, W, H, [{ mode: 'remove', radius: 0.1, points: [[0.5, 0.5]] }]);
    expect(withRemove[30 * W + 40]).toBe(0);
    expect(withRemove[0]).toBe(255);
  });

  it('no modifica la máscara base y el orden de los trazos importa', () => {
    const base = empty();
    const a: BrushStroke = {
      mode: 'add',
      radius: 0.2,
      points: [
        [0.3, 0.5],
        [0.7, 0.5],
      ],
    };
    const r: BrushStroke = { mode: 'remove', radius: 0.05, points: [[0.5, 0.5]] };
    const out = applyStrokes(base, W, H, [a, r]);
    expect(base.every((v) => v === 0)).toBe(true);
    expect(out[30 * W + 40]).toBe(0); // quitado después
    expect(out[30 * W + 24]).toBe(255); // el resto del trazo sigue
    expect(applyStrokes(base, W, H, [r, a])[30 * W + 40]).toBe(255);
  });

  it('el borde del pincel es suave (valores intermedios)', () => {
    const out = applyStrokes(empty(), W, H, [{ mode: 'add', radius: 0.3, points: [[0.5, 0.5]] }]);
    const middle = Array.from(out).filter((v) => v > 0 && v < 255);
    expect(middle.length).toBeGreaterThan(10);
  });

  it('los trazos valen a cualquier resolución (mismo resultado reducido o grande)', () => {
    const strokes: BrushStroke[] = [
      {
        mode: 'add',
        radius: 0.12,
        points: [
          [0.2, 0.3],
          [0.6, 0.7],
        ],
      },
    ];
    const small = applyStrokes(new Uint8Array(40 * 30), 40, 30, strokes);
    const big = applyStrokes(new Uint8Array(160 * 120), 160, 120, strokes);
    let diff = 0;
    for (let y = 0; y < 30; y += 1)
      for (let x = 0; x < 40; x += 1) diff += Math.abs(small[y * 40 + x]! - big[(y * 4 + 2) * 160 + x * 4 + 2]!);
    expect(diff / (40 * 30)).toBeLessThan(12);
  });

  it('pintar tramo a tramo da lo mismo que repetir el trazo entero', () => {
    const stroke: BrushStroke = {
      mode: 'add',
      radius: 0.1,
      points: [
        [0.1, 0.2],
        [0.5, 0.5],
        [0.9, 0.3],
      ],
    };
    const live = empty();
    for (let i = 1; i < stroke.points.length; i += 1) {
      const p = stroke.points[i - 1]!;
      const q = stroke.points[i]!;
      paintSegment(live, W, H, [p[0] * W, p[1] * H], [q[0] * W, q[1] * H], stroke.radius * Math.min(W, H), 'add');
    }
    expect(live).toEqual(applyStrokes(empty(), W, H, [stroke]));
  });

  it('con el plato retocado el recorte usa los colores de la foto y el velo señala la selección', () => {
    const image: Pixels = { data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]), width: 2, height: 1 };
    const subject = withAlpha(image, [255, 0]);
    expect(Array.from(subject.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 0]);
    const veil = veilOver(image, [255, 0]);
    expect(veil.data[0]).toBeGreaterThan(10);
    expect(Array.from(veil.data.slice(4, 8))).toEqual([40, 50, 60, 255]);
  });
});
