import { describe, expect, it } from 'vitest';
import { listPieces, usageWarning } from './usageText';

const row = (content_id: string, title: string, archived = false) => ({ content_id, title, archived });

describe('aviso al eliminar archivos usados en piezas', () => {
  it('nombra hasta tres piezas y cuenta el resto', () => {
    expect(listPieces(['A'])).toBe('«A»');
    expect(listPieces(['A', 'B'])).toBe('«A» y «B»');
    expect(listPieces(['A', 'B', 'C'])).toBe('«A», «B» y «C»');
    expect(listPieces(['A', 'B', 'C', 'D', 'E'])).toBe('«A», «B», «C» y 2 más');
  });

  it('sin repetir piezas, sin las archivadas, y con lo que les pasará', () => {
    expect(usageWarning([])).toBeNull();
    expect(usageWarning([row('c1', 'Viejo', true)])).toBeNull();
    expect(usageWarning([row('c1', 'Reel nuevo'), row('c1', 'Reel nuevo')])).toBe(
      'Se usa en «Reel nuevo»: esa pieza quedará con un hueco que se puede sustituir por otra foto desde el editor.',
    );
    expect(
      usageWarning([row('1', 'Uno'), row('2', 'Dos'), row('3', 'Tres'), row('4', 'Cuatro'), row('5', '  ')], 2),
    ).toBe(
      'Se usan en «Uno», «Dos», «Tres» y 2 más: esas piezas quedarán con un hueco que se puede sustituir por otra foto desde el editor.',
    );
  });
});
