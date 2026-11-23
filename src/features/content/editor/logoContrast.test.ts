import { describe, expect, it } from 'vitest';
import { buildCatalogWith } from '../../../../agency/catalogo/construir';
import { NEUTRAL_THEME } from '../../../../agency/catalogo/index';
import { createEmptyDocument, validateDocumentFromAnyVersion, type ContentDocument, type Layer } from '../document';
import {
  backdropLuminance,
  bestLogoVariant,
  faintLogos,
  fixLogoContrast,
  LOGO_MIN_CONTRAST,
  luminanceOfPixels,
} from './logoContrast';

// Logotipo legible sobre su fondo (F65): la historia «Tapa del día» pone el primer logotipo del kit
// (el oscuro) sobre su cabecera oscura y no se ve.

const DARK = '33333333-3333-4333-8333-333333333333';
const LIGHT = '44444444-4444-4444-8444-444444444444';
const TONES = new Map([
  [DARK, 0.01],
  [LIGHT, 0.95],
]);

function tapaDelDia(logo = DARK): ContentDocument {
  const built = buildCatalogWith('restaurante', { ...NEUTRAL_THEME, logo }, [
    'corte-ritmico',
    'fundido-suave',
    'pase-lateral',
  ]);
  const template = built.stories!.templates.find((t) => t.key === 'rest-historia-tapa-del-dia')!;
  const parsed = validateDocumentFromAnyVersion(template.document);
  if (!parsed.ok) throw new Error('no válida');
  return parsed.document;
}

const logoOf = (document: ContentDocument) =>
  document.pages[0]!.layers.find((layer): layer is Extract<Layer, { type: 'logo' }> => layer.type === 'logo')!;

describe('logotipo legible sobre su fondo', () => {
  it('Tapa del día: el logotipo oscuro de la plantilla pasa a ser el claro sobre la cabecera oscura', () => {
    const document = tapaDelDia();
    const logo = logoOf(document);
    expect(backdropLuminance(document.pages[0]!.layers, logo, document.canvas.backgroundColor)).toBeLessThan(0.05);
    const result = fixLogoContrast(document, new Set([logo.id]), [DARK, LIGHT], TONES);
    expect(result.swapped).toEqual([logo.id]);
    expect(logoOf(result.document).assetId).toBe(LIGHT);
    // Lo demás no cambia.
    expect(logoOf(result.document)).toEqual({ ...logo, assetId: LIGHT });
    expect(faintLogos(result.document, TONES)).toEqual([]);
  });

  it('el claro sobre fondo claro pasa a ser el oscuro', () => {
    const doc = createEmptyDocument({ aspectRatio: '1:1' });
    const logo: Layer = {
      id: 'logo',
      type: 'logo',
      name: 'Logotipo',
      assetId: LIGHT,
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      anchor: { x: 'center', y: 'center' },
    };
    const document = { ...doc, pages: [{ ...doc.pages[0]!, layers: [logo] }] };
    const result = fixLogoContrast(document, new Set(['logo']), [LIGHT, DARK], TONES);
    expect(logoOf(result.document).assetId).toBe(DARK);
  });

  it('si ya se ve, o si la capa no la puso la plantilla, no se toca', () => {
    const document = tapaDelDia(LIGHT);
    expect(fixLogoContrast(document, new Set([logoOf(document).id]), [LIGHT, DARK], TONES).swapped).toEqual([]);
    const dark = tapaDelDia();
    expect(fixLogoContrast(dark, new Set(), [DARK, LIGHT], TONES).document).toBe(dark);
  });

  it('con una sola variante que no contrasta, se avisa (y se dice que es oscura)', () => {
    const document = tapaDelDia();
    const result = fixLogoContrast(document, new Set([logoOf(document).id]), [DARK], TONES);
    expect(result.swapped).toEqual([]);
    const faint = faintLogos(result.document, TONES);
    expect(faint).toHaveLength(1);
    expect(faint[0]!.logoIsDark).toBe(true);
  });

  it('sobre una foto no se sabe el fondo: ni se cambia ni se avisa', () => {
    const document = tapaDelDia();
    const page = document.pages[0]!;
    const logo = logoOf(document);
    // La cabecera, una foto.
    const layers = page.layers.map((layer) =>
      layer.id === 'h1-cabecera'
        ? ({
            ...layer,
            type: 'image',
            source: { kind: 'asset', assetId: '55555555-5555-4555-8555-555555555555' },
            fit: 'cover',
            focus: { x: 0.5, y: 0.5 },
          } as Layer)
        : layer,
    );
    const withPhoto = { ...document, pages: [{ ...page, layers }] };
    expect(fixLogoContrast(withPhoto, new Set([logo.id]), [DARK, LIGHT], TONES).swapped).toEqual([]);
    expect(faintLogos(withPhoto, TONES)).toEqual([]);
  });

  it('elige la variante que más contrasta y solo si mejora', () => {
    const tones = new Map([
      ['a', 0.02],
      ['b', 0.3],
      ['c', 0.9],
      ['d', null],
    ]);
    expect(bestLogoVariant('a', ['a', 'b', 'c', 'd'], tones, 0.01)).toBe('c');
    expect(bestLogoVariant('c', ['a', 'b', 'c'], tones, 0.01)).toBe('c');
    expect(bestLogoVariant('d', ['a', 'c'], tones, 0.01)).toBe('d');
    expect(LOGO_MIN_CONTRAST).toBe(3);
  });

  it('la luminancia de un logotipo cuenta solo la tinta (los píxeles transparentes no)', () => {
    // Dos píxeles negros opacos y dos blancos transparentes.
    const pixels = [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 255, 255, 255, 0];
    expect(luminanceOfPixels(pixels)).toBe(0);
    expect(luminanceOfPixels([255, 255, 255, 255])).toBeCloseTo(1);
    expect(luminanceOfPixels([0, 0, 0, 0])).toBeNull();
  });
});
