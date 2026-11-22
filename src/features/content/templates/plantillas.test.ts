import { describe, expect, it } from 'vitest';
import { templateAnalysisSchema } from '@/features/brand/templates';
import {
  allLayers,
  contentDocumentSchema,
  DOCUMENT_SCHEMA_VERSION,
  type ContentDocument,
  type Layer,
} from '../document';
import { allowedCanvasRatios, getFormatSpec } from '../networks';
import type { BrandTemplate } from './api';
import { analyzeDocument, buildEditorTemplate, newTemplateKey } from './build';
import { fitTemplate } from './fit';

const base = {
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
} as const;

const ASSET = '33333333-3333-4333-8333-333333333333';

function layers(prefix: string, width: number, height: number): Layer[] {
  return [
    {
      ...base,
      id: `${prefix}-foto`,
      type: 'image',
      name: '',
      x: 0,
      y: 0,
      width,
      height,
      anchor: { x: 'stretch', y: 'stretch' },
      source: { kind: 'asset', assetId: ASSET },
      fit: 'cover',
      focus: { x: 0.5, y: 0.5 },
    },
    {
      ...base,
      id: `${prefix}-titular`,
      type: 'text',
      name: '',
      x: width * 0.1,
      y: height - 220,
      width: width * 0.8,
      height: 160,
      anchor: { x: 'center', y: 'bottom' },
      text: 'Plato del día',
      fontFamily: 'Playfair Display',
      fontSize: 90,
      fontWeight: 700,
      italic: false,
      color: '#FFFFFF',
      align: 'center',
      lineHeight: 1.2,
    },
    {
      ...base,
      id: `${prefix}-logo`,
      type: 'logo',
      name: '',
      x: width - 220,
      y: 40,
      width: 180,
      height: 90,
      anchor: { x: 'right', y: 'top' },
      assetId: '44444444-4444-4444-8444-444444444444',
    },
  ] as Layer[];
}

function documentOf(ratio: '1:1' | '4:5' | '9:16' | '16:9', pages: number): ContentDocument {
  const size = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920], '16:9': [1920, 1080] }[ratio]!;
  return contentDocumentSchema.parse({
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    canvas: { aspectRatio: ratio, width: size[0], height: size[1], backgroundColor: '#112233' },
    pages: Array.from({ length: pages }, (_, i) => ({
      id: `p${i + 1}`,
      layers: layers(`p${i + 1}`, size[0]!, size[1]!),
    })),
  });
}

function template(document: ContentDocument | null, overrides: Partial<BrandTemplate> = {}): BrandTemplate {
  return {
    id: 't1',
    key: 'k',
    name: 'Plato',
    network: 'instagram',
    format: 'post',
    document,
    analysis: null,
    source: 'editor',
    ...overrides,
  };
}

const POST = { network: 'instagram', format: 'post' };
const CAROUSEL = { network: 'instagram', format: 'carousel' };

describe('Guardar como plantilla: el análisis sale del propio diseño', () => {
  it('cumple el esquema del análisis y refleja capas, colores, tipografías y logotipo', () => {
    const analysis = analyzeDocument(documentOf('4:5', 1));
    expect(templateAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(analysis.layers.map((l) => l.role)).toEqual(['photo', 'headline', 'logo']);
    expect(analysis.layers[0]!.position).toMatch(/a sangre/);
    expect(analysis.layers[1]!.description).toBe('Plato del día');
    expect(analysis.colors.map((c) => c.hex)).toEqual(['#112233', '#FFFFFF']);
    expect(analysis.typography[0]).toMatchObject({ role: 'headline', family: 'Playfair Display', weight: 700 });
    expect(analysis.logo.position).toBe('top-right');
    expect(analysis.summary).toContain('1 foto, 1 texto');
    // No presume de publicaciones que no existen.
    expect(analysis.examples).toEqual([]);
    expect(analysis.references).toEqual([]);
  });

  it('prepara lo que se manda al servidor: clave válida, origen «editor» y nombre recortado', () => {
    const draft = buildEditorTemplate({
      name: '  ¡Ñandú del día!  ',
      network: 'instagram',
      format: 'post',
      document: documentOf('1:1', 1),
    })!;
    expect(draft.key).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
    expect(draft.key.startsWith('editor-nandu-del-dia-')).toBe(true);
    expect(draft.name).toBe('¡Ñandú del día!');
    expect(draft.source).toBe('editor');
    // Dos guardados con el mismo nombre no se pisan.
    expect(newTemplateKey('Mismo', () => 0.1)).not.toBe(newTemplateKey('Mismo', () => 0.7));
    expect(newTemplateKey('¡!')).toMatch(/^editor-plantilla-[a-z0-9]{5}$/);
  });

  it('no guarda un diseño vacío, sin nombre o de un formato desconocido', () => {
    const empty = contentDocumentSchema.parse({
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      canvas: { aspectRatio: '1:1', width: 1080, height: 1080, backgroundColor: '#FFFFFF' },
      pages: [{ id: 'p1', layers: [] }],
    });
    expect(buildEditorTemplate({ name: 'x', network: 'instagram', format: 'post', document: empty })).toBeNull();
    expect(
      buildEditorTemplate({ name: '   ', network: 'instagram', format: 'post', document: documentOf('1:1', 1) }),
    ).toBeNull();
    expect(
      buildEditorTemplate({ name: 'x', network: 'instagram', format: 'inventado', document: documentOf('1:1', 1) }),
    ).toBeNull();
  });
});

describe('Usar una plantilla en otra proporción o con otro número de páginas', () => {
  it('si encaja, se usa tal cual y no hay nada que avisar', () => {
    const doc = documentOf('4:5', 1);
    const fit = fitTemplate(template(doc), POST)!;
    expect(fit.document).toBe(doc);
    expect(fit.changes).toEqual([]);
  });

  it('otra proporción: se pasa a la de la pieza (si la red la admite) recolocando las capas por sus anclajes', () => {
    const spec = getFormatSpec('instagram', 'post')!;
    const allowed = allowedCanvasRatios(spec, 'image')!.ratios;
    expect(allowed).not.toContain('9:16');
    const doc = documentOf('9:16', 1);
    const fit = fitTemplate(template(doc), POST, '1:1')!;
    expect(fit.document.canvas).toMatchObject({ aspectRatio: '1:1', width: 1080, height: 1080 });
    expect(fit.changes).toHaveLength(1);
    expect(fit.changes[0]).toContain('de 9:16 a 1:1');
    const title = allLayers(fit.document).find((l) => l.id === 'p1-titular')!;
    const original = allLayers(doc).find((l) => l.id === 'p1-titular')!;
    // Anclado abajo: conserva la distancia al borde inferior (escalada), no la posición vertical absoluta.
    expect(1080 - (title.y + title.height)).toBeCloseTo((1920 - (original.y + original.height)) * (1080 / 1920), 0);
    // La foto, estirada: sigue llenando el lienzo.
    const photo = allLayers(fit.document).find((l) => l.id === 'p1-foto')!;
    expect([photo.width, photo.height]).toEqual([1080, 1080]);
    // El original no se toca.
    expect(doc.canvas.aspectRatio).toBe('9:16');
  });

  it('sin proporción de la pieza, usa la primera que admite la red', () => {
    const fit = fitTemplate(template(documentOf('9:16', 1)), POST)!;
    expect(allowedCanvasRatios(getFormatSpec('instagram', 'post')!, 'image')!.ratios).toContain(
      fit.document.canvas.aspectRatio,
    );
    expect(fit.changes[0]).toContain('de 9:16 a');
  });

  it('más páginas de las que admite el formato: se usan las primeras y se dice cuántas se dejan', () => {
    const fit = fitTemplate(template(documentOf('4:5', 3), { format: 'carousel' }), POST)!;
    expect(fit.document.pages).toHaveLength(1);
    expect(fit.document.pages[0]!.id).toBe('p1');
    expect(fit.changes).toEqual([expect.stringContaining('tiene 3 páginas')]);
    expect(fit.changes[0]).toContain('las otras 2 no se aplican');
  });

  it('menos páginas de las que pide un carrusel: se copia la última, con capas de identificador propio', () => {
    const fit = fitTemplate(template(documentOf('4:5', 1)), CAROUSEL)!;
    expect(fit.document.pages).toHaveLength(2);
    const ids = allLayers(fit.document).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(fit.changes[0]).toContain('pide al menos 2');
    // Sigue siendo un documento válido.
    expect(contentDocumentSchema.safeParse(fit.document).success).toBe(true);
  });

  it('proporción y páginas a la vez: dos avisos', () => {
    const fit = fitTemplate(template(documentOf('9:16', 3), { format: 'carousel' }), POST)!;
    expect(fit.changes).toHaveLength(2);
    expect(fit.document.pages).toHaveLength(1);
    expect(fit.document.canvas.aspectRatio).toBe('1:1');
    expect(contentDocumentSchema.safeParse(fit.document).success).toBe(true);
  });

  it('un carrusel acepta cualquier proporción: solo se ajustan las páginas', () => {
    const fit = fitTemplate(template(documentOf('9:16', 1)), CAROUSEL)!;
    expect(fit.changes).toHaveLength(1);
    expect(fit.document.canvas.aspectRatio).toBe('9:16');
    expect(fit.document.pages).toHaveLength(2);
  });

  it('sin documento legible o con un formato desconocido, no hay adaptación posible', () => {
    expect(fitTemplate(template(null), POST)).toBeNull();
    expect(fitTemplate(template(documentOf('1:1', 1)), { network: 'instagram', format: 'inventado' })).toBeNull();
  });
});
