import { describe, expect, it } from 'vitest';
import { bleedFor } from './bleed';

describe('margen para ver lo que sobresale del lienzo', () => {
  it('es el hueco libre a cada lado, sin salirse del área', () => {
    // 1080 × 1350 a 0,4 = 432 × 540 dentro de 1000 × 560.
    const bleed = bleedFor({ width: 1080, height: 1350 }, 0.4, { width: 1000, height: 560 });
    expect(bleed).toEqual({ x: 283, y: 9 });
    expect(432 + 2 * bleed.x).toBeLessThanOrEqual(1000);
    expect(540 + 2 * bleed.y).toBeLessThanOrEqual(560);
  });

  it('con el lienzo ampliado más que el área no hay margen', () => {
    expect(bleedFor({ width: 1080, height: 1080 }, 2, { width: 800, height: 600 })).toEqual({ x: 0, y: 0 });
  });
});
