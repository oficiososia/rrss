import { describe, expect, it } from 'vitest';
import { groupByDay, weekDays, weekRange } from './week';

const ZONE = 'Europe/Madrid';

describe('la semana del inicio', () => {
  it('son siete días desde hoy, con hoy marcado', () => {
    const days = weekDays(new Date('2026-11-22T12:00:00Z'), ZONE);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ key: '2026-11-22', day: 22, today: true, weekday: 'dom' });
    expect(days[1]).toMatchObject({ key: '2026-11-23', weekday: 'lun', today: false });
    expect(days[6]!.key).toBe('2026-11-28');
  });

  it('cuenta el día en la hora de la marca, no en la del dispositivo', () => {
    // A las 23:30 en Madrid ya es lunes; en UTC todavía son las 22:30 del domingo.
    const days = weekDays(new Date('2026-11-22T22:30:00Z'), ZONE);
    expect(days[0]!.key).toBe('2026-11-22');
    const late = weekDays(new Date('2026-11-22T23:30:00Z'), ZONE);
    expect(late[0]!.key).toBe('2026-11-23');
  });

  it('el intervalo empieza a medianoche de hoy y dura siete días', () => {
    const { from, to } = weekRange(new Date('2026-11-22T12:00:00Z'), ZONE);
    expect(from.toISOString()).toBe('2026-11-21T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-11-28T23:00:00.000Z');
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
