// Edición de fotos sin IA: ajustes, encuadre inteligente, fondo y procedencia.
import { describe, expect, it } from 'vitest';
import { canEditPhoto, canEditWithAi, upscaleFactors } from './api';
import { centeredCrop, largestBox, smartCrop } from './framing';
import {
  analyzeImage,
  applyAdjustments,
  AUTO_INTENSITIES,
  autoAdjustments,
  compositeOver,
  cropPixels,
  downscale,
  hasTransparency,
  isNeutral,
  NEUTRAL_ADJUSTMENTS,
  parseHex,
  type Pixels,
} from './pixels';
import { editedFileName, photoEditProvenance } from './provenance';

/** Imagen de prueba: cada píxel lo decide `fill(x, y)` → [r, g, b, a]. */
function image(width: number, height: number, fill: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = fill(x, y);
      data.set([r!, g!, b!, a], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const pixel = (img: Pixels, x: number, y: number) =>
  Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('ajustes de luz, color y nitidez', () => {
  it('sin ajustes, la imagen sale igual; y la de entrada nunca cambia', () => {
    const src = image(4, 4, (x, y) => [x * 50, y * 50, 100]);
    const copy = new Uint8ClampedArray(src.data);
    const out = applyAdjustments(src, NEUTRAL_ADJUSTMENTS);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
    applyAdjustments(src, { ...NEUTRAL_ADJUSTMENTS, exposure: 50, saturation: -100, sharpness: 80 });
    expect(src.data).toEqual(copy);
    expect(isNeutral(NEUTRAL_ADJUSTMENTS)).toBe(true);
  });

  it('más luz aclara, saturación -100 deja gris, más calidez sube el rojo y baja el azul', () => {
    const src = image(1, 1, () => [100, 120, 140]);
    const lighter = pixel(applyAdjustments(src, { ...NEUTRAL_ADJUSTMENTS, exposure: 50 }), 0, 0);
    expect(lighter[0]).toBeGreaterThan(100);
    const gray = pixel(applyAdjustments(src, { ...NEUTRAL_ADJUSTMENTS, saturation: -100 }), 0, 0);
    expect(gray[0]).toBe(gray[1]);
    expect(gray[1]).toBe(gray[2]);
    const warm = pixel(applyAdjustments(src, { ...NEUTRAL_ADJUSTMENTS, warmth: 60 }), 0, 0);
    expect(warm[0]).toBeGreaterThan(100);
    expect(warm[2]).toBeLessThan(140);
  });

  it('la nitidez acentúa los bordes y respeta la transparencia', () => {
    const src = image(6, 1, (x) => (x < 3 ? [80, 80, 80, 200] : [160, 160, 160, 200]));
    const out = applyAdjustments(src, { ...NEUTRAL_ADJUSTMENTS, sharpness: 100 });
    expect(pixel(out, 2, 0)[0]).toBeLessThan(80);
    expect(pixel(out, 3, 0)[0]).toBeGreaterThan(160);
    expect(pixel(out, 0, 0)[3]).toBe(200);
  });

  it('«mejorar automáticamente» estira una foto apagada, corrige la dominante y aclara si está oscura', () => {
    // Foto oscura, sin negros ni blancos y con dominante azul (hay zonas casi grises que la delatan).
    const dull = image(40, 40, (x, y) => [40 + ((x + y) % 40), 45 + ((x + y) % 40), 90 + ((x + y) % 40)]);
    const stats = analyzeImage(dull);
    expect(stats.white - stats.black).toBeLessThan(100);
    const auto = autoAdjustments(stats);
    expect(auto.levels).not.toBeNull();
    // Dominante azul: la temperatura sube (más cálida) en vez de dejarla fría.
    expect(auto.warmth).toBeGreaterThan(0);
    const out = analyzeImage(applyAdjustments(dull, auto));
    expect(out.white - out.black).toBeGreaterThan((stats.white - stats.black) * 0.9);
    // La dominante azul pesa menos (proporción azul / rojo).
    expect(out.mean[2] / Math.max(1, out.mean[0])).toBeLessThan(stats.mean[2] / stats.mean[0]);
    expect(out.meanLuma).toBeGreaterThan(stats.meanLuma * 0.95);
  });

  it('una foto oscura sube de luz y levanta sombras sin llegar a quemar', () => {
    const dark = image(48, 48, (x, y) => {
      const v = 8 + ((x * 3 + y * 2) % 60);
      return [v, v * 0.9, v * 0.8];
    });
    const auto = autoAdjustments(analyzeImage(dark));
    expect(auto.exposure).toBeGreaterThan(5);
    const out = analyzeImage(applyAdjustments(dark, auto));
    expect(out.meanLuma).toBeGreaterThan(analyzeImage(dark).meanLuma * 1.3);
    expect(out.p99).toBeLessThan(255);
  });

  it('una foto plana gana contraste y se avivan los colores apagados', () => {
    const flat = image(48, 48, (x, y) => {
      const v = 110 + ((x + y) % 30);
      return [v + 6, v, v - 6];
    });
    const stats = analyzeImage(flat);
    const auto = autoAdjustments(stats);
    expect(auto.levels).not.toBeNull();
    expect(auto.contrast).toBeGreaterThan(0);
    expect(auto.vibrance).toBeGreaterThan(auto.saturation);
    expect(analyzeImage(applyAdjustments(flat, auto)).spread).toBeGreaterThan(stats.spread * 1.5);
  });

  it('el balance de blancos no tiñe la carne: el plato se limpia y el rojo sigue siendo rojo', () => {
    // Mitad plato blanco con dominante cálida, mitad carne roja.
    const scene = image(60, 40, (x, y) =>
      y === 0 ? [12, 12, 12] : x < 30 ? [236, 222, 196] : [150 + (y % 10), 45, 50],
    );
    const stats = analyzeImage(scene);
    const auto = autoAdjustments(stats);
    expect(auto.warmth).toBeLessThan(0);
    // Se corrige solo una parte: nunca más de ±45 puntos.
    expect(auto.warmth).toBeGreaterThanOrEqual(-45);
    const out = applyAdjustments(scene, auto);
    const plate = pixel(out, 5, 5);
    expect(plate[2]! / plate[0]!).toBeGreaterThan(196 / 236);
    const meat = pixel(out, 45, 5);
    expect(meat[0]).toBeGreaterThan(meat[1]! * 2);
    expect(meat[0]).toBeGreaterThan(meat[2]! * 2);
  });

  it('la viveza sube lo apagado más que lo saturado y se contiene en el rojo', () => {
    const base = { ...NEUTRAL_ADJUSTMENTS, vibrance: 80 };
    const sat = (p: number[]) => (Math.max(...p.slice(0, 3)) - Math.min(...p.slice(0, 3))) / Math.max(...p.slice(0, 3));
    const dull = image(1, 1, () => [120, 125, 130]);
    const vivid = image(1, 1, () => [200, 40, 40]);
    const dullGain = sat(pixel(applyAdjustments(dull, base), 0, 0)) - sat(pixel(dull, 0, 0));
    const vividGain = sat(pixel(applyAdjustments(vivid, base), 0, 0)) - sat(pixel(vivid, 0, 0));
    expect(dullGain).toBeGreaterThan(0.04);
    expect(vividGain).toBeLessThan(dullGain);
  });

  it('sombras, luces y claridad hacen lo que dicen', () => {
    const src = image(
      1,
      3,
      (_x, y) =>
        [
          [25, 25, 25],
          [128, 128, 128],
          [235, 235, 235],
        ][y]!,
    );
    const lifted = applyAdjustments(src, { ...NEUTRAL_ADJUSTMENTS, shadows: 80 });
    expect(pixel(lifted, 0, 0)[0]).toBeGreaterThan(25);
    expect(Math.abs(pixel(lifted, 0, 2)[0]! - 235)).toBeLessThan(4);
    const recovered = applyAdjustments(src, { ...NEUTRAL_ADJUSTMENTS, highlights: -80 });
    expect(pixel(recovered, 0, 2)[0]).toBeLessThan(235);
    expect(Math.abs(pixel(recovered, 0, 0)[0]! - 25)).toBeLessThan(4);
    // Claridad: separa más lo claro de lo oscuro en una zona.
    const edge = image(40, 40, (x) => (x < 20 ? [100, 100, 100] : [140, 140, 140]));
    const clear = applyAdjustments(edge, { ...NEUTRAL_ADJUSTMENTS, clarity: 100 });
    expect(pixel(clear, 18, 20)[0]).toBeLessThan(100);
    expect(pixel(clear, 21, 20)[0]).toBeGreaterThan(140);
  });

  it('una foto ya correcta no sale peor: sin quemar, sin perder rango y sin pasarse', () => {
    const good = image(32, 32, (x, y) => [(x * 255) / 31, (y * 255) / 31, ((x + y) * 255) / 62]);
    const stats = analyzeImage(good);
    const auto = autoAdjustments(stats);
    expect(auto.exposure).toBe(0);
    expect(Math.abs(auto.warmth)).toBeLessThanOrEqual(8);
    const out = applyAdjustments(good, auto);
    let diff = 0;
    for (let i = 0; i < good.data.length; i += 1) diff += Math.abs(good.data[i]! - out.data[i]!);
    expect(diff / good.data.length).toBeLessThan(26);
    const after = analyzeImage(out);
    expect(after.spread).toBeGreaterThanOrEqual(stats.spread * 0.95);
    expect(after.meanLuma).toBeGreaterThan(stats.meanLuma * 0.85);
    expect(after.meanLuma).toBeLessThan(stats.meanLuma * 1.15);
  });

  it('una foto bien expuesta y con color natural no cambia de luz y su contraste no baja', () => {
    const natural = image(48, 48, (x, y) => {
      const v = 30 + ((x * 5 + y * 3) % 190);
      return [v * 1.04, v, v * 0.96];
    });
    const auto = autoAdjustments(analyzeImage(natural));
    expect(auto.exposure).toBe(0);
    expect(analyzeImage(applyAdjustments(natural, auto)).spread).toBeGreaterThan(analyzeImage(natural).spread * 0.95);
  });

  it('mide sobre el plato y no sobre el fondo liso: un plato pequeño sobre cartón naranja', () => {
    // Fondo naranja liso con algo de grano; en el centro, una bandeja gris con detalle y una dominante amarilla.
    const scene = image(120, 90, (x, y) => {
      const grain = ((x * 7 + y * 13) % 5) - 2;
      const inTray = x >= 42 && x < 78 && y >= 36 && y < 54;
      if (!inTray) return [190 + grain, 130 + grain, 40 + grain];
      const speck = (x * 31 + y * 17) % 7 < 3 ? 40 : 0;
      return [118 + speck, 108 + speck, 92 + speck];
    });
    const stats = analyzeImage(scene);
    expect(stats.subject).toBeLessThan(0.6);
    // El gris de la bandeja (no el naranja) es la referencia: sale una corrección hacia el frío.
    expect(stats.neutral).not.toBeNull();
    expect(stats.neutral!.rgb[0]).toBeLessThan(170);
    expect(autoAdjustments(stats).warmth).toBeLessThan(0);
  });

  it('con un recorte, el sujeto es lo que no es transparente', () => {
    const cut = image(40, 40, (x, y) =>
      x >= 10 && x < 30 && y >= 10 && y < 30 ? [120, 110, 95, 255] : [250, 0, 0, 0],
    );
    const stats = analyzeImage(cut);
    expect(stats.subject).toBe(1);
    expect(stats.p50).toBeLessThan(130);
  });

  it('la intensidad escala todo: suave < normal < fuerte, y 0 no cambia nada', () => {
    const dull = image(40, 40, (x, y) => [60 + ((x + y) % 50), 66 + ((x + y) % 50), 100 + ((x + y) % 50)]);
    const stats = analyzeImage(dull);
    const soft = autoAdjustments(stats, AUTO_INTENSITIES.soft);
    const normal = autoAdjustments(stats, AUTO_INTENSITIES.normal);
    const strong = autoAdjustments(stats, AUTO_INTENSITIES.strong);
    for (const key of ['clarity', 'vibrance', 'sharpness', 'contrast'] as const) {
      expect(soft[key]).toBeLessThan(normal[key]);
      expect(normal[key]).toBeLessThan(strong[key]);
    }
    expect(isNeutral(autoAdjustments(stats, 0))).toBe(true);
  });

  it('«normal» se nota de verdad y la viveza no quema el rojo', () => {
    const steak = image(40, 40, (x, y) => [185 + ((x + y) % 40), 40 + ((x * 2 + y) % 30), 38 + (y % 20)]);
    const auto = autoAdjustments(analyzeImage(steak));
    const out = applyAdjustments(steak, auto);
    let diff = 0;
    for (let i = 0; i < steak.data.length; i += 1) diff += Math.abs(steak.data[i]! - out.data[i]!);
    expect(diff / steak.data.length).toBeGreaterThan(4);
    const meat = pixel(out, 10, 10);
    // Sigue siendo rojo: el rojo domina y no se ha pasado de rosca a un color plano.
    expect(meat[0]).toBeGreaterThan(meat[1]! * 2);
    expect(meat[0]).toBeLessThanOrEqual(255);
  });
});

describe('fondo y transparencia', () => {
  it('detecta la transparencia y pone un color liso detrás', () => {
    const cutout = image(2, 1, (x) => (x === 0 ? [200, 0, 0, 255] : [0, 0, 0, 0]));
    expect(hasTransparency(cutout)).toBe(true);
    const out = compositeOver(cutout, { kind: 'color', hex: '#00FF00' });
    expect(pixel(out, 0, 0)).toEqual([200, 0, 0, 255]);
    expect(pixel(out, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(hasTransparency(out)).toBe(false);
    expect(hasTransparency(cutout)).toBe(true);
  });

  it('o una imagen del mismo tamaño, mezclando los bordes semitransparentes', () => {
    const cutout = image(1, 1, () => [255, 255, 255, 128]);
    const backdrop = image(1, 1, () => [0, 0, 0]);
    expect(pixel(compositeOver(cutout, { kind: 'image', pixels: backdrop }), 0, 0)[0]).toBe(128);
    expect(() => compositeOver(cutout, { kind: 'image', pixels: image(2, 2, () => [0, 0, 0]) })).toThrow();
    expect(() => compositeOver(cutout, { kind: 'color', hex: 'rojo' })).toThrow();
    expect(parseHex('#1a2B3c')).toEqual([26, 43, 60]);
  });
});

describe('recortes por red con encuadre inteligente', () => {
  it('la caja es la más grande con esa proporción', () => {
    expect(largestBox({ width: 4000, height: 3000 }, '1:1')).toEqual({ width: 3000, height: 3000 });
    expect(largestBox({ width: 4000, height: 3000 }, '4:5')).toEqual({ width: 2400, height: 3000 });
    expect(largestBox({ width: 1080, height: 1920 }, '9:16')).toEqual({ width: 1080, height: 1920 });
    expect(centeredCrop({ width: 400, height: 300 }, '1:1')).toEqual({ x: 50, y: 0, width: 300, height: 300 });
  });

  it('se va a donde está el detalle: un plato a la derecha sobre fondo liso', () => {
    // Fondo gris liso y un «plato» con textura y color en el tercio derecho.
    const photo = image(300, 100, (x, y) =>
      x > 220 && x < 290 && y > 20 && y < 80 ? [200 + ((x * y) % 50), 60 + (x % 30), 40] : [128, 128, 128],
    );
    const box = smartCrop(photo, '1:1');
    expect(box.width).toBe(100);
    expect(box.x).toBeGreaterThan(150);
    expect(box.x + box.width).toBeGreaterThanOrEqual(290);
    // Sin nada destacable, queda centrado.
    const flat = smartCrop(
      image(300, 100, () => [128, 128, 128]),
      '1:1',
    );
    expect(flat.x).toBe(100);
  });

  it('también en vertical, y recortar devuelve los píxeles de la caja', () => {
    const tall = image(90, 300, (x, y) => (y < 60 && x > 10 && x < 80 ? [250, 30 + (x % 20), 30] : [20, 20, 20]));
    const box = smartCrop(tall, '1:1');
    expect(box).toMatchObject({ x: 0, width: 90, height: 90 });
    expect(box.y).toBeLessThan(40);
    const piece = cropPixels(tall, { x: 0, y: 0, width: 2, height: 2 });
    expect(piece.width).toBe(2);
    expect(pixel(piece, 1, 1)).toEqual(pixel(tall, 1, 1));
    expect(downscale(tall, 30)).toMatchObject({ width: 9, height: 30 });
  });
});

describe('procedencia y nombre del resultado', () => {
  it('apunta al original, dice qué se hizo y cabe en la columna', () => {
    const json = photoEditProvenance({
      sourceAssetId: 'a5e1f3b0-0000-4000-8000-000000000001',
      steps: [
        {
          kind: 'adjust',
          adjustments: { ...NEUTRAL_ADJUSTMENTS, exposure: 12, balance: [1.04321, 1, 0.9] },
          auto: true,
        },
        { kind: 'crop', aspect: '4:5', box: { x: 10.4, y: 0, width: 800.2, height: 1000 }, smart: true },
        { kind: 'background', background: { type: 'color', hex: '#aa0000' } },
      ],
      width: 800,
      height: 1000,
      editedAt: new Date('2026-11-20T10:00:00Z'),
    });
    expect(json).toMatchObject({
      type: 'photo_edit',
      source_asset_id: 'a5e1f3b0-0000-4000-8000-000000000001',
      width: 800,
      height: 1000,
      edited_at: '2026-11-20T10:00:00.000Z',
      steps: [
        { kind: 'adjust', auto: true, exposure: 12, balance: [1.043, 1, 0.9] },
        { kind: 'crop', aspect: '4:5', box: { x: 10, width: 800 } },
        { kind: 'background', color: '#AA0000' },
      ],
    });
    expect(new TextEncoder().encode(JSON.stringify(json)).length).toBeLessThan(2048);
  });

  it('nombres legibles a partir del original', () => {
    const adjust = { kind: 'adjust' as const, adjustments: NEUTRAL_ADJUSTMENTS, auto: true };
    const crop = {
      kind: 'crop' as const,
      aspect: '9:16' as const,
      box: { x: 0, y: 0, width: 1, height: 1 },
      smart: true,
    };
    expect(editedFileName('Chuletón.jpg', [adjust], 'jpg')).toBe('Mejorada · Chuletón.jpg');
    expect(editedFileName('Chuletón.jpg', [crop], 'jpg')).toBe('Recorte 9:16 · Chuletón.jpg');
    expect(editedFileName('Chuletón.jpg', [adjust, crop], 'jpg')).toBe('Mejorada 9:16 · Chuletón.jpg');
    expect(
      editedFileName('a/b.png', [{ kind: 'background', background: { type: 'color', hex: '#FFFFFF' } }], 'png'),
    ).toBe('Fondo nuevo · a b.png');
  });
});

describe('qué se puede editar', () => {
  const base = {
    kind: 'image' as const,
    mime_type: 'image/jpeg',
    storage_path: 'o/b/media/x.jpg',
    width: 1200,
    height: 900,
  };
  it('fotos y logotipos JPEG, PNG o WebP; con IA, además, fuera de Drive y con medidas', () => {
    expect(canEditPhoto(base)).toBe(true);
    expect(canEditPhoto({ ...base, mime_type: 'image/gif' })).toBe(false);
    expect(canEditPhoto({ ...base, kind: 'video' as never })).toBe(false);
    expect(canEditWithAi(base)).toBe(true);
    expect(
      canEditWithAi({
        ...base,
        storage_path: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/drive/abcdefghijkl',
      }),
    ).toBe(false);
    expect(canEditWithAi({ ...base, width: null })).toBe(false);
  });

  it('ampliar solo hasta 4096 px por lado', () => {
    expect(upscaleFactors(1000, 800)).toEqual([2, 4]);
    expect(upscaleFactors(1500, 800)).toEqual([2]);
    expect(upscaleFactors(3000, 2000)).toEqual([]);
    expect(upscaleFactors(null, 800)).toEqual([]);
  });
});
