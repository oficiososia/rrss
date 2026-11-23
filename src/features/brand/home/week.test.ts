import { describe, expect, it } from 'vitest';
import { groupByDay, weekDays, weekProgress, weekRange } from './week';

const ZONE = 'Europe/Madrid';

describe('la semana del inicio', () => {
  it('es la semana de lunes a domingo, con hoy marcado y los días pasados señalados', () => {
    // Domingo 22: la semana empezó el lunes 16.
    const days = weekDays(new Date('2026-11-22T12:00:00Z'), ZONE);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ key: '2026-11-16', weekday: 'lun', today: false, past: true });
    expect(days[6]).toMatchObject({ key: '2026-11-22', day: 22, weekday: 'dom', today: true, past: false });
    // Lunes 23: empieza una semana nueva.
    const monday = weekDays(new Date('2026-11-23T08:00:00Z'), ZONE);
    expect(monday[0]).toMatchObject({ key: '2026-11-23', today: true, past: false });
    expect(monday[6]!.key).toBe('2026-11-29');
  });

  it('cuenta el día en la hora de la marca, no en la del dispositivo', () => {
    // A las 23:30 en Madrid ya es lunes; en UTC todavía son las 22:30 del domingo.
    const sunday = weekDays(new Date('2026-11-22T22:30:00Z'), ZONE);
    expect(sunday.find((d) => d.today)!.key).toBe('2026-11-22');
    const late = weekDays(new Date('2026-11-22T23:30:00Z'), ZONE);
    expect(late[0]).toMatchObject({ key: '2026-11-23', today: true });
  });

  it('el intervalo va de la medianoche del lunes a la del lunes siguiente', () => {
    const { from, to } = weekRange(new Date('2026-11-22T12:00:00Z'), ZONE);
    expect(from.toISOString()).toBe('2026-11-15T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-22T23:00:00.000Z');
  });

  it('«N de M publicadas»: lo programado no cuenta como publicado y lo cancelado no cuenta', () => {
    expect(
      weekProgress([{ status: 'published' }, { status: 'scheduled' }, { status: 'failed' }, { status: 'cancelled' }]),
    ).toEqual({ published: 1, total: 3 });
    expect(weekProgress([])).toEqual({ published: 0, total: 0 });
  });

  it('agrupa por día de la marca', () => {
    const map = groupByDay(
      [
        { scheduled_at: '2026-11-22T09:00:00Z' },
        { scheduled_at: '2026-11-22T21:30:00Z' },
        { scheduled_at: '2026-11-22T23:30:00Z' },
      ],
      ZONE,
    );
    expect(map.get('2026-11-22')).toHaveLength(2);
    expect(map.get('2026-11-23')).toHaveLength(1);
  });
});
