import { describe, expect, it } from 'vitest';
import { quotaShareText } from './cupo';

describe('coste de la IA como parte del cupo', () => {
  it('lo dice en porcentaje del cupo del mes', () => {
    expect(quotaShareText(200_000, 10_000_000)).toBe('≈ 2 % del cupo de este mes');
    expect(quotaShareText(50_000, 10_000_000)).toBe('menos del 1 % del cupo de este mes');
  });

  it('sin cupo conocido o sin coste, no dice nada', () => {
    expect(quotaShareText(200_000, null)).toBeNull();
    expect(quotaShareText(200_000, 0)).toBeNull();
    expect(quotaShareText(0, 10_000_000)).toBeNull();
  });

});
