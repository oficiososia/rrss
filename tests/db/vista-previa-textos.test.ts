// La vista previa del editor de reels y el trabajador colocan los textos con la
// MISMA cuenta (src/features/reels/editor/textFit.ts repite
// worker/src/reel/textlayout.ts, que lee las tipografías con node:fs y no puede
// ir al navegador). Aquí se comparan con los mismos datos para que no se separen,
// y se comprueba que un reel creado por el camino del editor (plantilla +
// calidad + cierre de la marca) lo acepta el esquema del trabajador.
import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../../src/features/brand/profile';
import { finalizeProject } from '../../src/features/reels/editor/project';
import {
  fallbackMeasurer,
  inferRole,
  layoutText,
  placeTexts,
  ROLE_RULES,
  SAFE_ZONE,
} from '../../src/features/reels/editor/textFit';
import { brandReelKit } from '../../src/features/reels/quality';
import { buildBrandReel, validateReelTemplate } from '../../src/features/reels/reelTemplate';
import { REEL_TEMPLATES } from '../../src/features/reels/templates';
import { reelPlanV2Schema } from '../../worker/src/reel/schema';
import * as worker from '../../worker/src/reel/textlayout';

const W = 1080;
const H = 1920;
const style = (patch: Record<string, unknown> = {}) => ({
  sizeRatio: 0.05,
  marginRatio: 0.2,
  maxWidthRatio: 0.84,
  lineHeight: 1.2,
  box: null as { paddingRatio: number } | null,
  ...patch,
});

const CASES = [
  { text: 'Lo que sale de la cocina', style: style(), position: 'center' as const, role: 'headline' as const },
  {
    text: 'Vaca madurada 60 días a la brasa de encina',
    style: style({ sizeRatio: 0.09 }),
    position: 'top' as const,
    role: 'headline' as const,
  },
  {
    text: 'Croquetas caseras',
    style: style({ box: { paddingRatio: 0.3 } }),
    position: 'bottom' as const,
    role: 'label' as const,
  },
  {
    text: 'Menú del día 14,50 €',
    style: style({ sizeRatio: 0.03 }),
    position: 'bottom' as const,
    role: 'price' as const,
  },
  {
    text: 'Reserva tu mesa',
    style: style({ box: { paddingRatio: 0.4 } }),
    position: 'center' as const,
    role: 'cta' as const,
  },
  {
    text: 'Un texto sin papel que la persona escribió a mano\ny con salto',
    style: style(),
    position: 'top' as const,
    role: null,
  },
  { text: 'Desplazado', style: style(), position: 'bottom' as const, role: null, offset: { x: 0.1, y: -0.3 } },
];

describe('la vista previa y el trabajador colocan los textos igual', () => {
  it('mismas líneas, tamaño, alto de línea y sitio, a cualquier tamaño de lienzo', () => {
    expect(SAFE_ZONE).toEqual(worker.SAFE_ZONE);
    expect(ROLE_RULES).toEqual(worker.ROLE_RULES);
    for (const [w, h] of [
      [W, H],
      [360, 640],
      [720, 1280],
    ] as const) {
      for (const input of CASES) {
        const app = layoutText({ ...input, maxLines: 6 }, w, h, fallbackMeasurer);
        const theirs = worker.layoutText({ ...input, maxLines: 6 }, w, h, worker.measurer(null));
        expect(app, `${input.text} a ${w}×${h}`).toEqual(theirs);
      }
    }
  });

  it('mismos apilados y encadenados cuando dos textos coinciden', () => {
    const laid = CASES.slice(0, 5).map((input) => layoutText({ ...input, maxLines: 6 }, W, H));
    const items = [
      { index: 0, start: 0, end: 3, laid: laid[0]!, position: 'center' as const },
      { index: 1, start: 0.5, end: 3, laid: laid[4]!, position: 'center' as const },
      { index: 2, start: 1, end: 2.5, laid: laid[2]!, position: 'bottom' as const },
      { index: 3, start: 1.2, end: 2.4, laid: laid[3]!, position: 'bottom' as const },
      { index: 4, start: 2.9, end: 4, laid: laid[1]!, position: 'top' as const },
    ];
    const clone = () => items.map((i) => ({ ...i, laid: structuredClone(i.laid) }));
    expect(placeTexts(clone(), W, H)).toEqual(worker.placeTexts(clone(), W, H).placed);
  });

  it('mismo papel deducido', () => {
    const texts = [
      { text: 'Lo nuevo', start: 0.2, end: 2 },
      { text: 'Desde 12 €', start: 2, end: 4 },
      { text: 'Reserva en el enlace de la bio', start: 6, end: 8 },
      { text: 'Hecho en casa', start: 3, end: 5 },
    ];
    texts.forEach((t, i) => expect(inferRole(t, i, 8, 0.2)).toBe(worker.inferRole(t, i, 8, 0.2)));
  });
});

describe('un reel creado por el camino del editor lo acepta el trabajador', () => {
  it('plantilla del catálogo + material + perfil: papeles, máscaras, puntos y cierre válidos', () => {
    const parsed = validateReelTemplate({
      kind: 'rrss.reel-template',
      schemaVersion: 1,
      purpose: 'Prueba',
      whenToUse: 'Prueba',
      material: '3 fotos',
      style: { id: 'corte-ritmico' },
      slots: [
        { id: 'a', label: 'A', seconds: 1.2 },
        { id: 'b', label: 'B', seconds: 1.6 },
        { id: 'c', label: 'C', seconds: 1.6 },
      ],
      texts: [
        { id: 'g', role: 'hook', text: 'Lo que sale de la cocina', from: 'a', position: 'center' },
        { id: 'l', role: 'cta', text: 'Reserva tu mesa', from: 'c', position: 'bottom' },
      ],
      music: { suggestion: 'Instrumental', bpm: { min: 110, max: 130 }, cutsOnBeat: true },
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const p = (name: string) =>
      `00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/media/${name}`;
    const library = ['Arroz negro.jpg', 'Croquetas.jpg', 'Sala.jpg'].map((name) => ({
      id: name,
      kind: 'image',
      storage_path: p(name),
      file_name: name,
      mime_type: 'image/jpeg',
      duration_ms: null,
    }));
    const profile = emptyProfile();
    profile.visual.colors = [{ name: 'Dorado', role: 'acento', hex: '#C9A227' }];
    profile.channels = [{ platform: 'Instagram', handle: 'casa', url: '' }];
    const style = REEL_TEMPLATES.find((t) => t.id === 'corte-ritmico')!;
    const project = buildBrandReel(parsed.template, library, style, {
      kit: brandReelKit(profile, p('logo.png')),
      library: [
        ...library,
        {
          ...library[0]!,
          id: 'mask',
          storage_path: p('mask.png'),
          file_name: 'Sin fondo.png',
          provenance: { kind: 'media.cutout', sources: [{ path: p('Arroz negro.jpg') }] },
        },
      ],
    });
    const plan = finalizeProject(project).plan;
    expect(plan.outro).toMatchObject({ cta: 'Reserva tu mesa', handle: '@casa', logoPath: p('logo.png') });
    const result = reelPlanV2Schema.safeParse(plan);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data!.texts.map((t) => t.role)).toEqual(['headline', 'label', 'label']);
    expect(result.data!.clips[0]).toMatchObject({ subjectMaskPath: p('mask.png') });
  });
});
