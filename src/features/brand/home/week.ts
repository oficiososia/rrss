import { dayKey } from '@/features/social/calendar';
import { fromZoned, toZoned } from '@/features/social/zone';

// La semana del inicio: de lunes a domingo, la que contiene hoy, en la hora de la marca. Sin React.
// Así «Esta semana: 1 de 3 publicadas» cuenta también lo que ya salió estos días.

export interface WeekDay {
  key: string;
  /** «lun», «mar»… */
  weekday: string;
  day: number;
  today: boolean;
  /** Ya pasó (antes de hoy). */
  past: boolean;
}

/** Medianoche de hoy en la zona de la marca, como fecha de pared. */
function wallToday(now: Date, zone: string): Date {
  const wall = toZoned(now, zone);
  return new Date(wall.getFullYear(), wall.getMonth(), wall.getDate());
}

/** Medianoche del lunes de esta semana, como fecha de pared. */
function wallMonday(now: Date, zone: string): Date {
  const today = wallToday(now, zone);
  const sinceMonday = (today.getDay() + 6) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday);
}

export function weekDays(now: Date, zone: string): WeekDay[] {
  const start = wallMonday(now, zone);
  const todayKey = dayKey(wallToday(now, zone));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(d);
    return {
      key,
      weekday: d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''),
      day: d.getDate(),
      today: key === todayKey,
      past: key < todayKey,
    };
  });
}

/** Instantes [desde, hasta) que cubren de lunes a domingo. */
export function weekRange(now: Date, zone: string): { from: Date; to: Date } {
  const start = wallMonday(now, zone);
  return {
    from: fromZoned(start, zone),
    to: fromZoned(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7), zone),
  };
}

/** Cuántas piezas tiene la semana y cuántas ya salieron (lo cancelado no cuenta). */
export function weekProgress(entries: ReadonlyArray<{ status: string }>): { published: number; total: number } {
  const live = entries.filter((e) => e.status !== 'cancelled');
  return { published: live.filter((e) => e.status === 'published').length, total: live.length };
}

/** Agrupa por día (en la zona de la marca) lo que tenga fecha. */
export function groupByDay<T extends { scheduled_at: string }>(entries: T[], zone: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const entry of entries) {
    const key = dayKey(toZoned(entry.scheduled_at, zone));
    map.set(key, [...(map.get(key) ?? []), entry]);
  }
  return map;
}
