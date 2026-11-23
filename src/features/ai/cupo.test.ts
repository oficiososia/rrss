import { describe, expect, it } from 'vitest';
import { costSentence, plainCostText, quotaShareText } from './cupo';
import type { MoneyDisplay } from './money';

const EUR: MoneyDisplay = { currency: 'EUR', locale: 'es-ES' };
const CREDITS: MoneyDisplay = { currency: null, locale: 'es-ES' };
/** Los espacios de los importes son de no separación: se comparan como espacios normales. */
const plain = (text: string | null) => text?.replace(/\s/g, ' ') ?? null;

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

describe('coste de la IA en llano (autogestión)', () => {
  it('con moneda: céntimos sin decimales raros', () => {
    expect(plainCostText(4_000, EUR)).toBe('menos de un céntimo');
    expect(plainCostText(52_000, EUR)).toBe('unos céntimos');
    expect(plainCostText(199_000, EUR)).toBe('unos 20 céntimos');
    expect(plain(plainCostText(1_499_000, EUR))).toBe('unos 1,50 €');
  });

  it('sin moneda fijada cuenta en créditos y no inventa céntimos', () => {
    expect(plain(plainCostText(199_000, CREDITS))).toBe('unos 0,20 créditos');
    expect(plain(plainCostText(4_000, CREDITS))).toBe('menos de 0,01 créditos');
  });

  it('sin coste no dice nada', () => {
    expect(plainCostText(0, EUR)).toBeNull();
    expect(plainCostText(Number.NaN, EUR)).toBeNull();
  });
});

describe('la frase del coste máximo', () => {
  it('en autogestión dice lo que cuesta y nunca menciona el cupo', () => {
    const self = (micros: number, display = EUR) =>
      plain(costSentence(micros, { selfManaged: true, limitMicros: 5_200_000, display }));
    expect(self(52_000)).toBe('Cuesta unos céntimos.');
    expect(self(4_000)).toBe('Cuesta menos de un céntimo.');
    expect(self(199_000)).toBe('Cuesta como mucho unos 20 céntimos.');
    expect(self(1_499_000)).toBe('Cuesta como mucho unos 1,50 €.');
    expect(self(199_000, CREDITS)).toBe('Cuesta como mucho unos 0,20 créditos.');
    for (const micros of [4_000, 52_000, 199_000, 1_499_000]) expect(self(micros)).not.toMatch(/cupo|%/);
  });

  it('con agencia, una frase bien escrita con la parte del cupo', () => {
    const agency = (micros: number, limitMicros: number | null) =>
      plain(costSentence(micros, { selfManaged: false, limitMicros, display: CREDITS }));
    // Antes: «Gasta como mucho menos del 1 % del cupo de este mes.»
    expect(agency(50_000, 10_000_000)).toBe('Gasta menos del 1 % del cupo de este mes.');
    expect(agency(200_000, 10_000_000)).toBe('Gasta como mucho un 2 % del cupo de este mes.');
    // Sin saber el cupo (quien no administra la organización no lo lee), el importe.
    expect(agency(52_000, null)).toBe('Gasta como mucho 0,052 créditos.');
  });

  it('sin coste no hay frase', () => {
    expect(costSentence(0, { selfManaged: true })).toBeNull();
    expect(costSentence(0, { selfManaged: false, limitMicros: 1 })).toBeNull();
  });
});
