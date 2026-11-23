import { addDays, dayKey, startOfWeek } from '@/features/social/calendar';
import { fromZoned, nowInZone } from '@/features/social/zone';

// «La semana de hoy» para sembrar datos de prueba (bancos de maquetación y pruebas): la MISMA semana que
// pinta el calendario, calculada con sus mismas funciones (`nowInZone` + `startOfWeek`, en la zona de la
// marca). Antes el banco del calendario calculaba el lunes en UTC: entre las 00:00 y la 01:00 (invierno)
// o las 02:00 (verano) de un lunes en Madrid, UTC sigue en domingo, sembraba la semana anterior y la
// pantalla salía vacía.

export interface SeedWeek {
  /** Instante real de las `hour`:00 (hora de la marca) del día `day` de la semana (0 = lunes). */
  at(day: number, hour?: number): Date;
  /** Ese día como AAAA-MM-DD en la zona de la marca (para columnas de fecha: campañas…). */
  dayKey(day: number): string;
}

/** La semana (de lunes a domingo) en la que cae `now` en la zona de la marca. */
export function seedWeek(zone: string, now: number = Date.now()): SeedWeek {
  // Fecha «de pared»: sus campos locales son los del reloj de la zona (ver zone.ts).
  const monday = startOfWeek(nowInZone(zone, now));
  const wall = (day: number, hour = 0) => {
    const d = addDays(monday, day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour);
  };
  return {
    at: (day, hour = 0) => fromZoned(wall(day, hour), zone),
    dayKey: (day) => dayKey(wall(day)),
  };
}
