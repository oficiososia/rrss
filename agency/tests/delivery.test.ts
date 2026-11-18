// Archivo de entrega: validación con el esquema del documento y `PostCopy` de
// la aplicación, documento final y verificador de marca. Sin red.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildDocument,
  canvasRatioFor,
  checkDelivery,
  parseDelivery,
  variantsComment,
  type Delivery,
} from '../src/delivery.ts';
import { getFormatSpec } from '../../src/features/content/networks.ts';
import { createEmptyDocument } from '../../src/features/content/document/index.ts';

const example = async () =>
  JSON.parse(await readFile(new URL('../ejemplos/entrega.json', import.meta.url), 'utf8')) as Record<string, unknown>;

const ok = (input: unknown): Delivery => {
  const parsed = parseDelivery(input);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.delivery;
};

describe('parseDelivery', () => {
  it('el ejemplo documentado es una entrega válida', async () => {
    const delivery = ok(await example());
    expect(delivery.title).toBe('Menú de otoño · post');
    expect(delivery.variants).toHaveLength(1);
    // El documento lleva el texto de `copy`, normalizado como en el editor.
    expect(delivery.document?.copy.caption).toMatch(/guiso de la casa/);
    expect(delivery.document?.layers.map((l) => l.id)).toEqual(['foto', 'franja', 'titular']);
  });

  it('normaliza el texto igual que el editor: hashtags y menciones sin símbolo', () => {
    const delivery = ok({
      format: 'rrss.agency-delivery',
      version: 1,
      copy: { caption: 'Hola', hashtags: ['#otoño'], mentions: ['@casa'] },
    });
    expect(delivery.copy).toMatchObject({ hashtags: ['otoño'], mentions: ['casa'], altText: '' });
    expect(delivery.document).toBeNull();
  });

  it('dice qué falla y dónde', () => {
    const parsed = parseDelivery({
      format: 'otra-cosa',
      version: 2,
      copy: { caption: '  ', hashtags: ['con espacio'] },
      variants: [{ caption: 'v', mentions: ['a b'] }],
      document: { schemaVersion: 1, canvas: { aspectRatio: '1:1', width: 1080, height: 500 }, layers: [] },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const paths = parsed.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'format',
        'version',
        'copy.hashtags.0',
        'variants.0.mentions.0',
        'document.canvas.width',
      ]),
    );
  });

  it('rechaza lo que no es una entrega y demasiadas variantes', () => {
    expect(parseDelivery([]).ok).toBe(false);
    const many = Array.from({ length: 6 }, () => ({ caption: 'x' }));
    const parsed = parseDelivery({
      format: 'rrss.agency-delivery',
      version: 1,
      copy: { caption: 'a' },
      variants: many,
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('buildDocument', () => {
  const textOnly = ok({ format: 'rrss.agency-delivery', version: 1, copy: { caption: 'Solo texto' } });

  it('sin documento ni pieza: lienzo vacío con la proporción recomendada por la red', () => {
    const reel = buildDocument(textOnly, {
      network: 'instagram',
      format: 'reel',
      mediaKind: null,
      currentDocument: null,
    });
    expect(reel.canvas.aspectRatio).toBe('9:16');
    expect(reel.layers).toEqual([]);
    expect(reel.copy.caption).toBe('Solo texto');
  });

  it('con pieza enlazada: conserva su lienzo y sus capas y cambia el texto', () => {
    const current = { ...createEmptyDocument({ aspectRatio: '16:9' }) };
    const doc = buildDocument(textOnly, { network: 'x', format: 'post', mediaKind: null, currentDocument: current });
    expect(doc.canvas.aspectRatio).toBe('16:9');
    expect(doc.copy.caption).toBe('Solo texto');
  });

  it('una red desconocida no rompe: 1:1', () => {
    expect(canvasRatioFor(getFormatSpec('nada', 'nada'), null)).toBe('1:1');
  });
});

describe('checkDelivery con el verificador de marca', () => {
  it('detecta palabras vetadas por el perfil y hashtags obligatorios ausentes', () => {
    const delivery = ok({
      format: 'rrss.agency-delivery',
      version: 1,
      copy: { caption: 'La mejor oferta barata de la ciudad' },
      variants: [{ caption: 'Ven a probarlo #otoño', hashtags: ['casa'] }],
    });
    const document = buildDocument(delivery, {
      network: 'instagram',
      format: 'post',
      mediaKind: 'image',
      currentDocument: null,
    });
    const profile = { voice: { forbiddenPhrases: ['barata'], hashtags: { required: ['casa'] } } };
    const result = checkDelivery(document, delivery.variants, 'instagram', 'post', profile);
    expect(result.main.verdict).toBe('fail');
    const codes = result.main.findings.map((f) => f.check);
    expect(codes).toContain('forbidden-phrases');
    expect(codes).toContain('brand-hashtags');
    // La variante no tiene la palabra vetada y lleva el hashtag obligatorio.
    expect(result.variants[0]!.findings.map((f) => f.check)).not.toContain('forbidden-phrases');
  });

  it('las variantes viajan como comentario legible', () => {
    const comment = variantsComment([
      { caption: 'Otra', hashtags: ['a'], mentions: [], altText: '', callToAction: { label: '', url: '' } },
    ]);
    expect(comment).toContain('Variante 2:\nOtra\n#a');
    expect(variantsComment([])).toBe('');
  });
});
