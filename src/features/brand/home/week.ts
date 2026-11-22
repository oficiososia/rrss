import { dayKey } from '@/features/social/calendar';
import { fromZoned, toZoned } from '@/features/social/zone';

// La semana del inicio: hoy y los seis días siguientes, en la hora de la marca. Sin React.

export interface WeekDay {
  key: string;
  /** «lun», «mar»… */
  weekday: string;
  day: number;
  today: boolean;
}

/** Medianoche de hoy en la zona de la marca, como fecha de pared. */
function wallToday(now: Date, zone: string): Date {
  const wall = toZoned(now, zone);
  return new Date(wall.getFullYear(), wall.getMonth(), wall.getDate());
}

export function weekDays(now: Date, zone: string): WeekDay[] {
  const start = wallToday(now, zone);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      key: dayKey(d),
      weekday: d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', ''),
      day: d.getDate(),
      today: i === 0,
    };
  });
}

/** Instantes [desde, hasta) que cubren los siete días. */
export function weekRange(now: Date, zone: string): { from: Date; to: Date } {
  const start = wallToday(now, zone);
  return {
    from: fromZoned(start, zone),
    to: fromZoned(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7), zone),
  };
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
