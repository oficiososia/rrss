// Lo puro del motor «transcriptor»: recortar el silencio, partir lo largo, el WAV y las pistas.
import { describe, expect, it } from 'vitest';
import {
  encodeWav,
  MAX_HINT_CHARS,
  MAX_HINTS,
  MAX_HINTS_TOTAL_CHARS,
  prepareHints,
  splitForTranscription,
  trimSilence,
} from './transcriber';

const RATE = 16000;

/** Sonido de prueba: tramos de silencio (`0`) y de «voz» (un tono con esa amplitud). */
function sound(...parts: Array<[seconds: number, amplitude: number]>): Float32Array {
  const total = parts.reduce((sum, [seconds]) => sum + Math.round(seconds * RATE), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const [seconds, amplitude] of parts) {
    const length = Math.round(seconds * RATE);
    for (let i = 0; i < length; i += 1) out[at + i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE);
    at += length;
  }
  return out;
}

const seconds = (samples: Float32Array) => samples.length / RATE;

describe('recortar el silencio', () => {
  it('quita el silencio de los extremos y deja un margen', () => {
    const trimmed = trimSilence(sound([2, 0], [1, 0.3], [1.5, 0]), RATE);
    expect(seconds(trimmed)).toBeCloseTo(1.5, 1);
  });

  it('conserva las pausas de en medio: una orden es un solo trozo', () => {
    const trimmed = trimSilence(sound([1, 0], [1, 0.3], [0.8, 0], [1, 0.3], [1.5, 0]), RATE);
    expect(seconds(trimmed)).toBeCloseTo(3.3, 1);
  });

  it('todo silencio (o un ruido de fondo mínimo) no deja nada', () => {
    expect(trimSilence(sound([4, 0]), RATE)).toHaveLength(0);
    expect(trimSilence(sound([4, 0.001]), RATE)).toHaveLength(0);
    expect(trimSilence(new Float32Array(0), RATE)).toHaveLength(0);
  });

  it('un chasquido suelto no es voz', () => {
    expect(trimSilence(sound([2, 0], [0.05, 0.9], [2, 0]), RATE)).toHaveLength(0);
  });

  it('una palabra corta después de mucho silencio sí se conserva', () => {
    const trimmed = trimSilence(sound([7, 0], [0.3, 0.2], [1.5, 0]), RATE);
    expect(seconds(trimmed)).toBeGreaterThan(0.3);
    expect(seconds(trimmed)).toBeLessThan(1);
  });
});

describe('partir lo largo', () => {
  it('lo que cabe en un trozo no se parte', () => {
    const pieces = splitForTranscription(sound([6, 0.3]), RATE);
    expect(pieces).toHaveLength(1);
    expect(seconds(pieces[0]!)).toBe(6);
  });

  it('parte por la pausa y ningún trozo pasa del tope', () => {
    // 12 s de voz, una pausa y 14 s más: el corte cae en la pausa.
    const pieces = splitForTranscription(sound([12, 0.3], [0.4, 0], [14, 0.3]), RATE);
    expect(pieces).toHaveLength(2);
    expect(seconds(pieces[0]!)).toBeGreaterThanOrEqual(12);
    expect(seconds(pieces[0]!)).toBeLessThanOrEqual(12.4);
    for (const piece of pieces) expect(seconds(piece)).toBeLessThanOrEqual(15);
    expect(pieces.reduce((sum, piece) => sum + piece.length, 0)).toBe(Math.round(26.4 * RATE));
  });

  it('sin pausas corta igual, y no deja un resto de menos de medio segundo', () => {
    const pieces = splitForTranscription(sound([30, 0.3]), RATE);
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    for (const piece of pieces) {
      expect(seconds(piece)).toBeLessThanOrEqual(15);
      expect(seconds(piece)).toBeGreaterThanOrEqual(0.5);
    }
    const tight = splitForTranscription(sound([15.1, 0.3]), RATE);
    expect(tight).toHaveLength(2);
    expect(seconds(tight[1]!)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('WAV', () => {
  it('es un RIFF/WAVE de 16 bits, mono, con la frecuencia y el tamaño correctos', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), RATE);
    const view = new DataView(wav.buffer);
    const tag = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(wav).toHaveLength(44 + 8);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });
});

describe('vocabulario de pista', () => {
  it('limpia, quita repetidos y lo que no es texto', () => {
    expect(
      prepareHints([
        'Casa Lola',
        '  Arroz   a banda ',
        'casa lola',
        '<b>Título</b>',
        'x',
        null,
        undefined,
        'dos\nlíneas',
      ]),
    ).toEqual(['Casa Lola', 'Arroz a banda', 'b Título /b', 'dos líneas']);
  });

  it('respeta los topes de número, de largo y de total', () => {
    expect(prepareHints(Array.from({ length: 80 }, (_, i) => `plato ${i}`))).toHaveLength(MAX_HINTS);
    expect(prepareHints(['a'.repeat(200)])[0]).toHaveLength(MAX_HINT_CHARS);
    const long = prepareHints(Array.from({ length: 30 }, (_, i) => `${i} ${'b'.repeat(38)}`.slice(0, 40)));
    expect(long.join('').length).toBeLessThanOrEqual(MAX_HINTS_TOTAL_CHARS);
    expect(long.length).toBeLessThan(30);
  });
});
