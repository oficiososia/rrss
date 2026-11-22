// Zona horaria de la marca para el calendario y la programación.
//
// Hasta ahora todo se veía y se escribía en la hora del dispositivo: quien
// gestiona una marca de Madrid desde otro país programaba «a las 10:00» y salía
// a otra hora. La hora que cuenta es la de la marca (`brands.timezone`).
//
// Truco para no reescribir la aritmética de fechas del calendario: una «fecha
// de pared» es un `Date` cuyos campos LOCALES (año, mes, día, hora…) son los de
// la pared de la zona de la marca. `toZoned` convierte un instante real a fecha
// de pared y `fromZoned` hace lo contrario. Con ellas, las funciones de
// calendar.ts (inicio de semana, día, mover de día…) siguen valiendo. Solo hay
// que convertir en los bordes: al pedir datos (instantes reales) y al guardar.
// Límite conocido: una hora de pared que cae en el salto de horario del
// DISPOSITIVO (no el de la marca) se desplaza una hora al calcularla.
// Sin dependencias: se prueba aparte.

export const DEFAULT_ZONE = 'Europe/Madrid';

const formatters = new Map<string, Intl.DateTimeFormat>();

/** ¿Es una zona que este navegador conoce? */
export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** La zona de la marca, o la de por defecto si falta o no se conoce. */
export function safeZone(zone: string | null | undefined): string {
  return isValidZone(zone) ? zone : DEFAULT_ZONE;
}

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Campos de pared de un instante en una zona. */
export function wallParts(ms: number, zone: string) {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(zone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! === 24 ? 0 : parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Cuánto se adelanta la pared de la zona sobre UTC en ese instante (ms). */
export function zoneOffsetMs(ms: number, zone: string): number {
  const w = wallParts(ms, zone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

/** Instante real → fecha de pared de la zona (campos locales = pared). */
export function toZoned(value: string | number | Date, zone: string): Date {
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  const w = wallParts(ms, zone);
  return new Date(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** Fecha de pared (campos locales) → instante real en esa zona. */
export function fromZoned(wall: Date, zone: string): Date {
  const asUtc = Date.UTC(
    wall.getFullYear(),
    wall.getMonth(),
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    wall.getSeconds(),
  );
  // Dos pasadas: la segunda corrige el caso en que el desfase cambia entre la estimación y el resultado.
  let utc = asUtc - zoneOffsetMs(asUtc, zone);
  utc = asUtc - zoneOffsetMs(utc, zone);
  return new Date(utc);
}

/** «Ahora» como fecha de pared de la zona. */
export function nowInZone(zone: string, now: number = Date.now()): Date {
  return toZoned(now, zone);
}

/** Nombre de la zona para enseñarlo, sin jerga: «hora de Madrid». */
export function zoneLabel(zone: string): string {
  const city = (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
  return `hora de ${city}`;
}

/** ¿La zona de la marca es distinta de la del dispositivo ahora mismo? */
export function differsFromDevice(zone: string, at: number = Date.now()): boolean {
  return zoneOffsetMs(at, zone) !== -new Date(at).getTimezoneOffset() * 60_000;
}

export function formatTimeIn(iso: string, zone: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zone });
}

export function formatDateTimeIn(iso: string, zone: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  });
}

export function formatDateIn(iso: string, zone: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone });
}
