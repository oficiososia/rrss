import { describe, expect, it } from 'vitest';
import { cutoutModelFromProvenance, existingSubject, spentMicros } from './aiBackground';
import type { Pixels } from './pixels';
import { describeProgress, removalPrivacyNote } from './progressText';
import { aiSubjectFor, backgroundSuggestionsFor, mentionsFood, sectorKindOf } from './sector';

function image(width: number, height: number, alpha = 255): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = alpha;
  return { data, width, height };
}

describe('sector de la marca', () => {
  it('reconoce restaurante, coctelería y gimnasio, y lo demás es genérico (nunca comida por defecto)', () => {
    expect(sectorKindOf('Restauración')).toBe('restaurant');
    expect(sectorKindOf('Cafetería y pastelería')).toBe('restaurant');
    expect(sectorKindOf('Coctelería')).toBe('cocktail');
    expect(sectorKindOf('Bar de copas')).toBe('cocktail');
    expect(sectorKindOf('Gimnasio')).toBe('gym');
    expect(sectorKindOf('CrossFit')).toBe('gym');
    expect(sectorKindOf('Moda')).toBe('generic');
    expect(sectorKindOf('')).toBe('generic');
    expect(sectorKindOf(undefined)).toBe('generic');
  });

  it('si el sector no dice nada, mira la descripción del perfil', () => {
    expect(sectorKindOf('', 'Somos un gimnasio de barrio con clases dirigidas')).toBe('gym');
    expect(sectorKindOf('Moda', 'Tienda de ropa')).toBe('generic');
  });

  it('cada negocio tiene sus fondos y lo que se le dice a la IA que no toque', () => {
    for (const kind of ['restaurant', 'cocktail', 'gym', 'generic'] as const) {
      expect(backgroundSuggestionsFor(kind)).toHaveLength(4);
    }
    expect(backgroundSuggestionsFor('restaurant')).toContain('mesa de mármol blanco con luz cálida');
    expect(backgroundSuggestionsFor('gym').join(' ')).not.toMatch(/mármol|mantel/);
    expect(backgroundSuggestionsFor('generic').join(' ')).not.toMatch(/plato|mantel|pizarra/);
    expect(aiSubjectFor('restaurant')).toBe('food');
    expect(aiSubjectFor('cocktail')).toBe('drink');
    expect(aiSubjectFor('gym')).toBe('other');
    expect(aiSubjectFor('generic')).toBe('other');
    expect(mentionsFood('restaurant')).toBe(true);
    expect(mentionsFood('generic')).toBe(false);
  });
});

describe('recorte que ya se tiene', () => {
  it('reutiliza el recorte de la sesión (con sus retoques) si tiene las medidas de la foto', () => {
    const photo = image(4, 3);
    const cut = image(4, 3, 0);
    cut.data[3] = 255;
    const found = existingSubject({ pixels: photo, transparent: false, cutout: { pixels: cut, model: 'ben2' } });
    expect(found).toMatchObject({ from: 'session', model: 'ben2', width: 4, height: 3 });
    expect(found!.alpha[0]).toBe(255);
    expect(found!.alpha[1]).toBe(0);
    // Con otras medidas no vale: se recortaría de nuevo.
    expect(
      existingSubject({ pixels: photo, transparent: false, cutout: { pixels: image(2, 2, 0), model: 'x' } }),
    ).toBeNull();
  });

  it('una foto que ya viene sin fondo usa su alfa y el modelo de su procedencia', () => {
    const provenance = { steps: [{ kind: 'background' }, { kind: 'remove_background', model: 'ben2-base-fp16' }] };
    expect(cutoutModelFromProvenance(provenance)).toBe('ben2-base-fp16');
    expect(cutoutModelFromProvenance({})).toBeNull();
    const found = existingSubject({ pixels: image(3, 3, 0), transparent: true, cutout: null, provenance });
    expect(found).toMatchObject({ from: 'transparent', model: 'ben2-base-fp16' });
  });

  it('sin recorte ni transparencia hay que recortar', () => {
    expect(existingSubject({ pixels: image(3, 3), transparent: false, cutout: null })).toBeNull();
  });

  it('suma el gasto de los intentos que dicen su coste', () => {
    expect(
      spentMicros([
        { prompt: 'a', costMicros: 200_000 },
        { prompt: 'b', costMicros: null },
        { prompt: 'c', costMicros: 200_000 },
      ]),
    ).toBe(400_000);
  });
});

describe('progreso del recorte', () => {
  it('en el servidor cuenta cuatro pasos', () => {
    const steps = (['sending', 'queued', 'running', 'receiving'] as const).map((state) =>
      describeProgress({ phase: 'server-job', state }),
    );
    expect(steps.map((s) => s.step?.index)).toEqual([1, 2, 3, 4]);
    expect(steps.every((s) => s.where === 'server' && s.step?.total === 4)).toBe(true);
    expect(steps[2]!.label).toBe('Recortando en el servidor…');
    expect(steps[3]!.label).toBe('Descargando el resultado…');
  });

  it('en el navegador, descargando el modelo da el porcentaje y recortando dice cuánto suele tardar', () => {
    const download = describeProgress({ phase: 'downloading', received: 42_000_000, total: 84_000_000 });
    expect(download.pct).toBe(50);
    expect(download.label).toContain('42 de 84 MB');
    const running = describeProgress({ phase: 'running' });
    expect(running).toMatchObject({ where: 'browser', pct: null });
    expect(running.expected).toMatch(/segundos/);
  });

  it('si el servidor no llegó, cada frase del motor siguiente empieza diciéndolo', () => {
    const running = describeProgress({ phase: 'running', after: 'server-timeout' });
    expect(running.label).toBe(
      'El servidor no ha respondido a tiempo; se termina con el recorte de calidad básica. Recortando en tu equipo…',
    );
    expect(running).toMatchObject({ where: 'browser', step: null });
    expect(describeProgress({ phase: 'loading', after: 'server-timeout' }).label).toMatch(
      /^El servidor no ha respondido a tiempo.*Preparando el recorte en tu equipo…$/,
    );
    const download = describeProgress({ phase: 'downloading', received: 1, total: 2, after: 'server-failed' });
    expect(download.label).toMatch(/^El servidor no ha podido quitar el fondo.*Descargando el modelo/);
    expect(download.pct).toBe(50);
    // Sin ese motivo, el texto de siempre.
    expect(describeProgress({ phase: 'running' }).label).toBe('Recortando en tu equipo…');
  });

  it('un solo texto de privacidad según lo que haya encendido', () => {
    expect(removalPrivacyNote(false)).toMatch(/la foto no sale de él/);
    expect(removalPrivacyNote(false)).not.toMatch(/servidor/);
    expect(removalPrivacyNote(true)).toMatch(/servidor de la aplicación/);
  });
});
