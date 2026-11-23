import { describe, expect, it } from 'vitest';
import type { BrandReelTemplate } from '@/features/reels/editor/api';
import { validateReelTemplate } from '@/features/reels/reelTemplate';
import { REEL_TEMPLATES } from '@/features/reels/templates';
import { canvasRatioForPiece, draftTitle, planToDrafts } from './engine';
import type { CampaignPiece } from './plan';
import { basicReelTemplate, buildCampaignReels, isReelMaterial, pickReelMaterial, type CampaignMaterial } from './reelPieces';

// Prueba de calidad del 23/11/2026, fallos 3 y 15: los reels de una campaña
// llegaban vacíos y lo que prometía el plan (4:5, titular) no llegaba a la pieza.

const STYLE = REEL_TEMPLATES[0]!.id;
let seq = 0;
const asset = (name: string, extra: Partial<CampaignMaterial> = {}): CampaignMaterial => {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    kind: 'image',
    storage_path: `marca/biblioteca/${seq}-${name}.jpg`,
    file_name: `${name}.jpg`,
    mime_type: 'image/jpeg',
    duration_ms: null,
    created_at: `2026-11-${String(10 + (seq % 10)).padStart(2, '0')}T10:00:00Z`,
    provenance: null,
    folder: '',
    tags: [],
    ...extra,
  };
};

const piece = (over: Partial<CampaignPiece> = {}): CampaignPiece => ({
  network: 'instagram',
  format: 'reel',
  date: '2026-12-01',
  idea: 'Reel del arroz meloso de la carta',
  caption: 'Ven a probarlo. Reserva tu mesa.',
  hashtags: [],
  assetIds: [],
  why: '',
  ...over,
});

const brandTemplate = (name: string): BrandReelTemplate => {
  const parsed = validateReelTemplate({
    kind: 'rrss.reel-template',
    schemaVersion: 1,
    purpose: `Plantilla ${name}`,
    whenToUse: 'Para enseñar platos.',
    material: '3 fotos.',
    style: { id: STYLE },
    slots: [
      { id: 'a', label: 'Gancho', seconds: 2 },
      { id: 'b', label: 'Plato', seconds: 2 },
      { id: 'c', label: 'Cierre', seconds: 2 },
    ],
    texts: [
      { id: 't1', role: 'hook', text: 'Texto de muestra', from: 'a', position: 'center' },
      { id: 't2', role: 'detail', text: 'La zona de clases', from: 'b', position: 'bottom' },
      { id: 't3', role: 'cta', text: 'Te esperamos', from: 'c', position: 'bottom' },
    ],
  });
  if (!parsed.ok) throw new Error('plantilla mal hecha');
  return { id: `tpl-${name}`, key: name, name, source: 'catalog', template: parsed.template };
};

describe('material de un reel de campaña', () => {
  it('solo fotos y vídeos originales o editados: ni exportaciones, ni reels montados, ni IA, ni recortes', () => {
    expect(isReelMaterial(asset('arroz'))).toBe(true);
    expect(isReelMaterial(asset('arroz', { folder: 'Ediciones' }))).toBe(true);
    expect(isReelMaterial(asset('pieza', { provenance: { type: 'export' } }))).toBe(false);
    expect(isReelMaterial(asset('reel', { folder: 'Reels' }))).toBe(false);
    expect(isReelMaterial(asset('fondo', { provenance: { type: 'ai_generation' } }))).toBe(false);
    expect(isReelMaterial(asset('Sin fondo · arroz'))).toBe(false);
    expect(isReelMaterial(asset('nota', { kind: 'document' }))).toBe(false);
  });

  it('elige por el tema de la pieza, primero lo que sugiere el plan, y sin repetir la misma foto', () => {
    const arroz = asset('arroz meloso');
    const duplicado = { ...asset('arroz meloso copia'), storage_path: arroz.storage_path };
    const chuleton = asset('chuletón');
    const sugerida = asset('salón');
    const exportada = asset('arroz meloso exportado', { provenance: { type: 'export' } });
    const picked = pickReelMaterial(piece({ assetIds: [sugerida.id] }), [chuleton, exportada, arroz, duplicado, sugerida], 3);
    // La sugerida, después UNA de las dos copias del arroz (misma foto) y luego otra cosa.
    expect(picked.map((a) => a.file_name)).toEqual(['salón.jpg', expect.stringMatching(/^arroz meloso/), 'chuletón.jpg']);
    expect(new Set(picked.map((a) => a.storage_path)).size).toBe(picked.length);
  });
});

describe('aceptar un plan con reels: cada reel trae plantilla y fotos sin repetir', () => {
  const library = ['arroz', 'chuletón', 'tarta', 'ensaladilla', 'salón', 'terraza', 'calamar'].map((n) => asset(n));
  const pieces = [
    piece({ title: 'El arroz', headline: 'Arroz meloso' }),
    piece({ idea: 'Reel del chuletón a la brasa', title: 'Chuletón' }),
    piece({ format: 'post', idea: 'Post de la tarta' }),
    piece({ idea: 'Reel de la terraza en invierno', title: 'Terraza' }),
  ];

  it('con plantillas de la marca: plantilla, material del tema y el titular en el gancho', () => {
    const templates = [brandTemplate('Lo nuevo'), brandTemplate('Fotos con ritmo')];
    const { reels, withoutMaterial } = buildCampaignReels({ pieces, videoIndexes: [0, 1, 3], templates, library });
    expect(withoutMaterial).toEqual([]);
    expect(reels.map((r) => r.pieceIndex)).toEqual([0, 1, 3]);
    for (const reel of reels) {
      expect(reel.project.kind).toBe('reel');
      expect(reel.project.plan.clips.length).toBeGreaterThan(0);
      // Sin repetir dentro del reel.
      expect(new Set(reel.material).size).toBe(reel.material.length);
      expect(reel.project.plan.clips.map((c) => c.path)).toEqual(reel.material);
    }
    // El primer reel abre con su tema y con el titular del plan; el texto de muestra de un plano concreto se va.
    expect(reels[0]!.material[0]).toMatch(/arroz/);
    const texts = reels[0]!.project.plan.texts.map((t) => t.text);
    expect(texts).toContain('Arroz meloso');
    expect(texts).not.toContain('La zona de clases');
    expect(texts).not.toContain('Texto de muestra');
    expect(reels[1]!.material[0]).toMatch(/chulet/);
    // La campaña reparte las plantillas en vez de repetir siempre la misma.
    expect(new Set(reels.map((r) => r.templateName)).size).toBe(2);
  });

  it('sin plantillas de la marca, una sencilla del catálogo; sin material, la pieza se queda como estaba', () => {
    const basic = buildCampaignReels({ pieces, videoIndexes: [0], templates: [], library });
    expect(basic.reels[0]!.templateName).toBe('Reel sencillo');
    expect(basic.reels[0]!.project.plan.clips.length).toBe(basicReelTemplate(STYLE).slots.length);
    const empty = buildCampaignReels({ pieces, videoIndexes: [0, 1], templates: [], library: [] });
    expect(empty).toEqual({ reels: [], withoutMaterial: [0, 1] });
  });
});

describe('lo que promete el plan llega a la pieza', () => {
  const frame = { networks: ['instagram'], starts_on: '2026-11-23', ends_on: '2026-11-30' };
  const post = (over: Partial<CampaignPiece> = {}) =>
    piece({ format: 'post', idea: 'Arroz meloso de langosta en 4:5, con franja pizarra y titular. Para el martes.', ...over });

  it('formato 4:5: el lienzo es 4:5, no 1:1 (si la red lo admite)', () => {
    expect(canvasRatioForPiece(post({ aspect: '4:5' }))).toBe('4:5');
    const { drafts } = planToDrafts(
      { objective: 'o', summary: '', reasoning: { observed: [], dataBacked: [], hypotheses: [], dataNote: '' }, pieces: [post({ date: '2026-11-24', aspect: '4:5' })] },
      frame,
    );
    expect(drafts[0]!.data.canvas.aspectRatio).toBe('4:5');
    expect(drafts[0]!.data.canvas.height).toBe(1350);
  });

  it('el titular prometido va en la pieza, sobre una franja con el color de la marca', () => {
    const { drafts } = planToDrafts(
      {
        objective: 'o',
        summary: '',
        reasoning: { observed: [], dataBacked: [], hypotheses: [], dataNote: '' },
        pieces: [post({ date: '2026-11-27', headline: 'Semana del arroz', title: 'Arroz meloso' })],
      },
      frame,
      new Map(),
      { colors: ['#2F3A40'], fontFamily: 'Playfair Display' },
    );
    const layers = drafts[0]!.data.pages[0]!.layers;
    const text = layers.find((l) => l.type === 'text');
    const band = layers.find((l) => l.type === 'shape');
    expect(text).toMatchObject({ text: 'Semana del arroz', fontFamily: 'Playfair Display', color: '#FFFFFF' });
    expect(band).toMatchObject({ fill: '#2F3A40' });
    // Y la pieza se llama con su título corto.
    expect(drafts[0]!.title).toBe('Arroz meloso');
  });

  it('un plan antiguo sin título: el principio de la idea, no la descripción entera', () => {
    // Hasta la primera frase y, si pasa de 60 caracteres, cortado por una palabra entera.
    expect(draftTitle(post())).toBe('Arroz meloso de langosta en 4:5, con franja pizarra y…');
    expect(draftTitle(piece({ idea: 'Tarta de queso. Con su historia y la receta de la abuela.' }))).toBe('Tarta de queso');
  });
});
