import { describe, expect, it } from 'vitest';
import { dayKey, fromLocalInput, toLocalInput, viewRange } from './calendar';
import {
  DEFAULT_ZONE,
  differsFromDevice,
  formatDateTimeIn,
  formatTimeIn,
  fromZoned,
  isValidZone,
  safeZone,
  toZoned,
  zoneLabel,
} from './zone';

// La hora del calendario es la de la marca, no la del dispositivo. Todo se
// comprueba con zonas explícitas: no depende de dónde se ejecute la prueba.

describe('zona horaria de la marca', () => {
  it('reconoce zonas válidas y cae en Madrid si la guardada no se conoce', () => {
    expect(isValidZone('Europe/Madrid')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
    expect(isValidZone('')).toBe(false);
    expect(safeZone('Mars/Olympus')).toBe(DEFAULT_ZONE);
    expect(safeZone(null)).toBe(DEFAULT_ZONE);
    expect(safeZone('America/Mexico_City')).toBe('America/Mexico_City');
  });

  it('pasa de un instante a la pared de la zona, con el horario de verano y de invierno', () => {
    const winter = toZoned('2026-11-22T09:00:00Z', 'Europe/Madrid');
    expect([winter.getHours(), winter.getDate(), winter.getMonth()]).toEqual([10, 22, 10]);
    const summer = toZoned('2026-07-01T08:00:00Z', 'Europe/Madrid');
    expect([summer.getHours(), summer.getDate()]).toEqual([10, 1]);
    const auckland = toZoned('2026-11-22T09:00:00Z', 'Pacific/Auckland');
    expect([auckland.getHours(), auckland.getDate()]).toEqual([22, 22]);
    const mexico = toZoned('2026-11-22T09:00:00Z', 'America/Mexico_City');
    expect([mexico.getHours(), mexico.getDate()]).toEqual([3, 22]);
  });

  it('el campo «día y hora» se escribe y se lee en la hora de la marca', () => {
    expect(toLocalInput('2026-11-22T09:00:00Z', 'Europe/Madrid')).toBe('2026-11-22T10:00');
    expect(fromLocalInput('2026-11-22T10:00', 'Europe/Madrid')).toBe('2026-11-22T09:00:00.000Z');
    expect(fromLocalInput('2026-07-01T10:00', 'Europe/Madrid')).toBe('2026-07-01T08:00:00.000Z');
    expect(fromLocalInput('2026-11-22T10:00', 'America/Mexico_City')).toBe('2026-11-22T16:00:00.000Z');
    expect(fromLocalInput('2026-12-01T10:00', 'Pacific/Auckland')).toBe('2026-11-30T21:00:00.000Z');
    expect(fromLocalInput('no es una fecha', 'Europe/Madrid')).toBeNull();
  });

  it('ida y vuelta: lo que se escribe es lo que se ve', () => {
    for (const zone of ['Europe/Madrid', 'America/Mexico_City', 'Pacific/Auckland', 'Asia/Kolkata']) {
      for (const value of ['2026-01-15T00:00', '2026-06-30T23:59', '2026-11-22T10:30']) {
        const iso = fromLocalInput(value, zone)!;
        expect(toLocalInput(iso, zone)).toBe(value);
      }
    }
  });

  it('el cambio de hora no rompe nada: la hora que no existe o se repite sigue siendo una hora cercana', () => {
    // 29/03/2026 02:30 no existe en Madrid; 25/10/2026 02:30 ocurre dos veces.
    for (const value of ['2026-03-29T02:30', '2026-10-25T02:30']) {
      const iso = fromLocalInput(value, 'Europe/Madrid')!;
      const back = toLocalInput(iso, 'Europe/Madrid');
      expect(Math.abs(Date.parse(`${back}:00Z`) - Date.parse(`${value}:00Z`))).toBeLessThanOrEqual(3_600_000);
    }
  });

  it('el día de una publicación es el de la marca, aunque en UTC sea otro', () => {
    // 23:30 UTC del 22/11 ya es el 23/11 en Madrid y en Auckland, y sigue siendo el 22/11 en México.
    expect(dayKey(toZoned('2026-11-22T23:30:00Z', 'Europe/Madrid'))).toBe('2026-11-23');
    expect(dayKey(toZoned('2026-11-22T23:30:00Z', 'America/Mexico_City'))).toBe('2026-11-22');
  });

  it('los límites de la vista vuelven a ser instantes reales de esa zona', () => {
    const anchor = toZoned('2026-11-22T09:00:00Z', 'Pacific/Auckland');
    const { from, to } = viewRange('day', anchor);
    expect(fromZoned(from, 'Pacific/Auckland').toISOString()).toBe('2026-11-21T11:00:00.000Z'); // 22/11 00:00 NZDT
    expect(fromZoned(to, 'Pacific/Auckland').toISOString()).toBe('2026-11-22T11:00:00.000Z');
  });

  it('los textos salen en la hora de la marca y sin jerga', () => {
    expect(formatTimeIn('2026-11-22T09:00:00Z', 'Europe/Madrid')).toBe('10:00');
    expect(formatTimeIn('2026-11-22T09:00:00Z', 'Pacific/Auckland')).toBe('22:00');
    expect(formatDateTimeIn('2026-11-22T23:30:00Z', 'Europe/Madrid')).toMatch(/23 nov\.? 2026/);
    expect(zoneLabel('America/Mexico_City')).toBe('hora de Mexico City');
    expect(zoneLabel('Europe/Madrid')).toBe('hora de Madrid');
  });

  it('avisa solo si la zona de la marca no es la del dispositivo', () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(differsFromDevice(device)).toBe(false);
    expect(differsFromDevice('Pacific/Kiritimati')).toBe(device === 'Pacific/Kiritimati' ? false : true);
  });
});
