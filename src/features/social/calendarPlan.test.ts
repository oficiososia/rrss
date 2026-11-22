import { describe, expect, it } from 'vitest';
import { dayKey } from './calendar';
import {
  campaignSpans,
  clampGoal,
  daysOfWeek,
  DEFAULT_WEEKLY_GOAL,
  gapDays,
  gapSentence,
  isPastDay,
  isPastWeek,
  weekProgress,
} from './calendarPlan';

// Huecos, objetivo semanal y franjas de campañas: cuentas sin IA ni red.

const week = daysOfWeek(new Date(2026, 10, 18)); // semana del lunes 16 al domingo 22 de noviembre de 2026
const wed = new Date(2026, 10, 18, 11, 0);

describe('huecos de la semana', () => {
  it('son los días de hoy en adelante sin nada; los pasados no cuentan', () => {
    const planned = new Map([
      [dayKey(week[2]!), 1], // miércoles (hoy)
      [dayKey(week[4]!), 2], // viernes
    ]);
    const gaps = gapDays(week, planned, wed);
    expect(gaps.map((d) => d.getDate())).toEqual([19, 21, 22]); // jueves, sábado y domingo
    expect(gapSentence(gaps)).toBe('Sin nada el jueves, el sábado y el domingo');
    expect(gapSentence([gaps[0]!, gaps[1]!])).toBe('Sin nada el jueves y el sábado');
    expect(gapSentence([gaps[0]!])).toBe('Sin nada el jueves');
    expect(gapSentence([])).toBeNull();
  });

  it('una semana ya pasada no tiene huecos', () => {
    expect(gapDays(week, new Map(), new Date(2026, 10, 30))).toEqual([]);
    expect(isPastWeek(week, new Date(2026, 10, 30))).toBe(true);
    expect(isPastWeek(week, wed)).toBe(false);
    expect(isPastDay(week[0]!, wed)).toBe(true);
    expect(isPastDay(week[2]!, wed)).toBe(false);
  });
});

describe('objetivo semanal', () => {
  it('«2 de 3», con el aviso de que se ha llegado', () => {
    expect(weekProgress(2, 3)).toMatchObject({ text: '2 de 3', reached: false });
    expect(weekProgress(3, 3).reached).toBe(true);
    expect(weekProgress(5, 3).ratio).toBe(1);
  });

  it('el objetivo se mantiene entre 1 y 21 y vuelve al de siempre si no es un número', () => {
    expect(clampGoal(0)).toBe(1);
    expect(clampGoal(99)).toBe(21);
    expect(clampGoal('4')).toBe(4);
    expect(clampGoal('mucho')).toBe(DEFAULT_WEEKLY_GOAL);
  });
});

describe('franjas de campañas', () => {
  const c = (id: string, starts_on: string, ends_on: string) => ({ id, title: id, starts_on, ends_on });

  it('cubren solo los días de la semana que toca y dicen si siguen fuera de ella', () => {
    const spans = campaignSpans(
      [c('larga', '2026-11-10', '2026-11-19'), c('corta', '2026-11-20', '2026-11-20'), c('otra', '2026-12-01', '2026-12-05')],
      week,
    );
    expect(spans.map((s) => [s.campaign.id, s.start, s.end, s.continuesBefore, s.continuesAfter])).toEqual([
      ['larga', 1, 4, true, false],
      ['corta', 5, 5, false, false],
    ]);
  });
});
