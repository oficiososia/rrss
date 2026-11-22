import { describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, type ContentDocument, type Layer } from '../document';
import type { BrandTemplate } from './api';
import { cachedPreview, clearPreviewCache, PLACEHOLDER_ASSET_ID, withSamplePhotos } from './preview';
import { hasDetail, photosLine, shortSummary, templateDetail } from './summary';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function photo(id: string): Layer {
  return {
    id,
    type: 'image',
    name: '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    anchor: { x: 'center', y: 'center' },
    source: { kind: 'asset', assetId: A },
    fit: 'cover',
    focus: { x: 0.1, y: 0.9 },
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    turn: 90,
  } as unknown as Layer;
}

function doc(layers: Layer[]): ContentDocument {
  const base = createEmptyDocument({ aspectRatio: '1:1' });
  return { ...base, pages: [{ id: 'p', name: '', layers }] };
}

describe('withSamplePhotos', () => {
  it('rellena cada hueco con una foto de ejemplo en ciclo y quita recorte y giro', () => {
    const out = withSamplePhotos(doc([photo('a'), photo('b'), photo('c')]), [A, B]);
    const sources = out.pages[0]!.layers.map((l) => (l as { source: { assetId: string } }).source.assetId);
    expect(sources).toEqual([A, B, A]);
    expect(out.pages[0]!.layers[0]).not.toHaveProperty('crop');
    expect(out.pages[0]!.layers[0]).not.toHaveProperty('turn');
  });
  it('sin fotos de ejemplo usa el marcador neutro', () => {
    const out = withSamplePhotos(doc([photo('a')]), []);
    expect((out.pages[0]!.layers[0] as { source: { assetId: string } }).source.assetId).toBe(PLACEHOLDER_ASSET_ID);
  });
});

describe('cachedPreview', () => {
  it('dibuja una sola vez por clave y no recuerda los fallos', async () => {
    clearPreviewCache();
    const draw = vi.fn().mockResolvedValue('blob:x');
    expect(await Promise.all([cachedPreview('k', draw), cachedPreview('k', draw)])).toEqual(['blob:x', 'blob:x']);
    expect(draw).toHaveBeenCalledTimes(1);
    const bad = vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue('blob:y');
    expect(await cachedPreview('f', bad)).toBeNull();
    expect(await cachedPreview('f', bad)).toBe('blob:y');
  });
});

describe('textos de la tarjeta', () => {
  const long =
    'PROPUESTA de la agencia (no observada en el feed): Mejora de marca para destacados. Va con la foto a sangre y un titular grande.';
  it('quita la etiqueta de la agencia y se queda con una frase', () => {
    expect(shortSummary(long)).toBe('Mejora de marca para destacados.');
    expect(shortSummary('a'.repeat(300))).toHaveLength(100);
  });
  it('dice cuántas fotos pide sin jerga', () => {
    expect(photosLine(0)).toBe('Solo texto y formas');
    expect(photosLine(2)).toBe('Con hueco para 2 fotos');
  });
  it('el texto largo y la repetición van al detalle', () => {
    const template = {
      source: 'instagram_import',
      analysis: { summary: long, photo: { type: 'foto cenital' }, recurrence: { count: 12, reviewed: 12 } },
    } as unknown as BrandTemplate;
    const detail = templateDetail(template);
    expect(detail.proposal).toBe(true);
    expect(detail.summary).toContain('titular grande');
    expect(detail.repeats).toBe('La marca ya usa este diseño en 12 de 12 publicaciones revisadas.');
    expect(hasDetail(detail)).toBe(true);
  });
});
