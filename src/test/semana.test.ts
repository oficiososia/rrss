import { describe, expect, it } from 'vitest';
import { dayKey, viewRange } from '@/features/social/calendar';
import { fromZoned, nowInZone, toZoned } from '@/features/social/zone';
import { seedWeek } from './semana';

const MADRID = 'Europe/Madrid';
const at = (iso: string) => Date.parse(iso);

/** Lo que hacía el banco del calendario: el lunes en UTC. */
function mondayInUtc(now: number): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

describe('la semana de hoy para sembrar datos de prueba', () => {
  it('un lunes a las 00:20 de Madrid (invierno) ya es la semana nueva, aunque en UTC siga siendo domingo', () => {
    // 23/11/2026 00:20 en Madrid (UTC+1) = 22/11 23:20 UTC: el caso que rompía el banco.
    const now = at('2026-11-22T23:20:00Z');
    expect(mondayInUtc(now)).toBe('2026-11-16'); // el cálculo antiguo: la semana ANTERIOR
    const week = seedWeek(MADRID, now);
    expect(week.dayKey(0)).toBe('2026-11-23');
    expect(week.dayKey(6)).toBe('2026-11-29');
    // Las 09:00 del lunes en Madrid son las 08:00 UTC.
    expect(week.at(0, 9).toISOString()).toBe('2026-11-23T08:00:00.000Z');
    expect(week.at(2, 15).toISOString()).toBe('2026-11-25T14:00:00.000Z');
  });

  it('en verano el borde dura dos horas (UTC+2): a la 01:30 del lunes también es la semana nueva', () => {
    // 29/06/2026 01:30 en Madrid = 28/06 23:30 UTC.
    const now = at('2026-06-28T23:30:00Z');
    expect(mondayInUtc(now)).toBe('2026-06-22');
    const week = seedWeek(MADRID, now);
    expect(week.dayKey(0)).toBe('2026-06-29');
    expect(week.at(0, 9).toISOString()).toBe('2026-06-29T07:00:00.000Z');
  });

  it('el domingo a las 23:59 de Madrid sigue siendo la semana que acaba', () => {
    const week = seedWeek(MADRID, at('2026-11-22T22:59:00Z'));
    expect(week.dayKey(0)).toBe('2026-11-16');
    expect(week.dayKey(6)).toBe('2026-11-22');
  });

  it('lo sembrado cae dentro de la semana que pide el calendario, a cualquier hora del borde', () => {
    for (const iso of [
      '2026-11-22T22:59:00Z', // domingo 23:59
      '2026-11-22T23:00:00Z', // lunes 00:00
      '2026-11-22T23:20:00Z', // lunes 00:20
      '2026-11-23T00:30:00Z', // lunes 01:30
      '2026-11-25T12:00:00Z', // miércoles a mediodía
      '2026-06-28T22:10:00Z', // lunes 00:10 de verano
    ]) {
      const now = at(iso);
      // Lo que hace la pantalla: la semana de «ahora» en la zona de la marca, pasada a instantes reales.
      const range = viewRange('week', nowInZone(MADRID, now));
      const from = fromZoned(range.from, MADRID).getTime();
      const to = fromZoned(range.to, MADRID).getTime();
      const week = seedWeek(MADRID, now);
      for (const [day, hour] of [
        [0, 0],
        [0, 9],
        [3, 10],
        [6, 23],
      ] as const) {
        const when = week.at(day, hour).getTime();
        expect(when >= from && when < to, `${iso}: día ${day} a las ${hour}`).toBe(true);
        // Y en el día de la semana que toca (la columna en la que se pinta).
        expect(dayKey(toZoned(when, MADRID)), iso).toBe(week.dayKey(day));
      }
    }
  });

  it('con otra zona, la semana es la de esa zona', () => {
    // 22/11 23:20 UTC: en Madrid ya es lunes; en Nueva York sigue siendo domingo por la tarde.
    const now = at('2026-11-22T23:20:00Z');
    expect(seedWeek('America/New_York', now).dayKey(0)).toBe('2026-11-16');
    expect(seedWeek('UTC', now).dayKey(0)).toBe('2026-11-16');
  });
});
