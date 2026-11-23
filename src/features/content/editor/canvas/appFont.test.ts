import { describe, expect, it } from 'vitest';
import { describeLayer } from './nodes';
import { APP_FONT, withAppFont } from './appFont';

describe('letra de la aplicación como reserva de los textos', () => {
  it('una familia con nombre lleva Inter detrás (si no está cargada, no sale Times)', () => {
    expect(withAppFont('Playfair Display')).toBe(`Playfair Display, ${APP_FONT}, sans-serif`);
    expect(withAppFont('Inter')).toBe('Inter, sans-serif');
    expect(withAppFont('')).toBe('Inter, sans-serif');
  });

  it('una genérica se deja como está', () => {
    expect(withAppFont('serif')).toBe('serif');
    expect(withAppFont('sans-serif')).toBe('sans-serif');
    expect(withAppFont('Georgia, serif')).toBe('Georgia, serif');
  });

  it('el lienzo (y la exportación, que usa la misma descripción) dibujan con la reserva', () => {
    const spec = describeLayer(
      {
        id: 't',
        type: 'text',
        name: '',
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        anchor: { x: 'center', y: 'center' },
        text: 'Hola',
        fontFamily: 'Lora',
        fontSize: 20,
        fontWeight: 400,
        italic: false,
        color: '#111111',
        align: 'left',
        lineHeight: 1.2,
      },
      new Map(),
    );
    expect(spec).toMatchObject({ kind: 'text', fontFamily: 'Lora, Inter, sans-serif' });
  });
});
