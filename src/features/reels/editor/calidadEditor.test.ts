// La calidad de los reels conectada al editor (docs/reels-calidad.md y
// docs/editor-reels.md §12): el plan guarda los campos nuevos del plan v2,
// crear desde una plantilla va por el camino de calidad, el material se ordena,
// el aviso «Sin música» y una vista previa con los mismos mínimos de texto que el vídeo.
import { describe, expect, it } from 'vitest';
import { emptyProfile } from '@/features/brand/profile';
import { brandReelKit, orderForSlots, reelLogoPath, type RankableAsset } from '../quality';
import { buildBrandReel, validateReelTemplate, type ReelTemplate } from '../reelTemplate';
import { REEL_TEMPLATES } from '../templates';
import { audioNoticeText } from './AudioNotice';
import { fittedTexts, frameAt, previewTotal } from './compose';
import { dropMissingHelpers, planHelperPaths, planPaths } from './missing';
import { applySavedFraming } from './ops';
import {
  buildRenderRequest,
  finalizeProject,
  outroSpan,
  planSchema,
  planTimeline,
  projectProblems,
  type ReelProject,
  type TextStyle,
} from './project';
import { layoutText, ROLE_RULES } from './textFit';

const style = REEL_TEMPLATES.find((t) => t.id === 'corte-ritmico')!;
const path = (name: string) => `org/marca/media/${name}`;
const asset = (name: string, patch: Partial<RankableAsset> = {}) => ({
  id: name,
  kind: 'image',
  storage_path: path(name),
  file_name: name,
  mime_type: 'image/jpeg',
  duration_ms: null,
  ...patch,
});

const plain: TextStyle = {
  sizeRatio: 0.05,
  color: '#FFFFFF',
  marginRatio: 0.2,
  maxWidthRatio: 0.84,
  lineHeight: 1.2,
  box: null,
  outline: null,
  fadeSeconds: 0.2,
};

function template(): ReelTemplate {
  const parsed = validateReelTemplate({
    kind: 'rrss.reel-template',
    schemaVersion: 1,
    purpose: 'Prueba',
    whenToUse: 'Prueba',
    material: '3 fotos',
    style: { id: 'corte-ritmico' },
    slots: [
      { id: 'a', label: 'Resultado', seconds: 1.2 },
      { id: 'b', label: 'Ambiente', shot: 'wide', seconds: 1.6 },
      { id: 'c', label: 'Cierre', seconds: 1.6 },
    ],
    texts: [
      { id: 'g', role: 'hook', text: 'Lo que sale de la cocina', from: 'a', position: 'center' },
      { id: 'l', role: 'cta', text: 'Reserva tu mesa', from: 'c', position: 'bottom' },
    ],
    music: { suggestion: 'Instrumental', bpm: { min: 110, max: 130 }, cutsOnBeat: true },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.template;
}

function profile() {
  const p = emptyProfile();
  p.visual.colors = [
    { name: 'Dorado', role: 'acento', hex: '#C9A227' },
    { name: 'Carbón', role: 'fondo', hex: '#1A1A1A' },
  ];
  p.channels = [{ platform: 'Instagram', handle: 'casa.prueba', url: '' }];
  p.business.locations = ['Calle Mayor 1'];
  return p;
}

describe('el plan guarda los campos nuevos del plan v2', () => {
  const base = {
    version: 2,
    clips: [{ id: 'c1', type: 'photo', path: path('a.jpg'), seconds: 2, subjectMaskPath: path('a-sin-fondo.png') }],
    texts: [{ id: 't1', text: 'Hola', start: 0, end: 1, position: 'top', style: plain, role: 'headline' }],
    outro: { cta: 'Reserva tu mesa', seconds: 2, handle: '@casa', logoPath: path('logo.png'), accent: '#C9A227' },
    grade: 'warm',
  };

  it('admite papel, máscara, cierre y gradación, y los manda al trabajador tal cual', () => {
    expect(planSchema.safeParse(base).success).toBe(true);
    const project: ReelProject = { kind: 'reel', template: { id: style.id }, plan: planSchema.parse(base) };
    const request = buildRenderRequest(project, { id: 'pieza', version: 3 }) as { plan: typeof base };
    expect(request.plan.outro).toEqual(base.outro);
    expect(request.plan.grade).toBe('warm');
    expect(request.plan.texts[0]!.role).toBe('headline');
    expect(request.plan.clips[0]!.subjectMaskPath).toBe(path('a-sin-fondo.png'));
  });

  it('rechaza papeles y gradaciones inventados, cierres fuera de medida y los nulos', () => {
    const bad = (patch: Record<string, unknown>) => planSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({ grade: 'sepia' })).toBe(false);
    expect(bad({ grade: null })).toBe(false);
    expect(bad({ outro: { cta: '' } })).toBe(false);
    expect(bad({ outro: { cta: 'Ven', seconds: 4 } })).toBe(false);
    expect(bad({ outro: { cta: 'Ven', handle: null } })).toBe(false);
    expect(bad({ outro: { cta: 'Ven', accent: 'dorado' } })).toBe(false);
    expect(bad({ texts: [{ ...base.texts[0], role: 'title' }] })).toBe(false);
    expect(bad({ clips: [{ ...base.clips[0], subjectMaskPath: null }] })).toBe(false);
    // La máscara es solo de las fotos.
    expect(
      bad({
        clips: [
          { id: 'v', type: 'video', path: path('v.mp4'), in: 0, out: 2, volume: 1, subjectMaskPath: path('m.png') },
        ],
      }),
    ).toBe(false);
  });

  it('el cierre alarga el vídeo como el motor: entra fundido con el último plano y cuenta para el máximo', () => {
    const plan = planSchema.parse(base);
    const timeline = planTimeline(plan.clips, style);
    const span = outroSpan(plan, timeline, style)!;
    expect(span).toEqual({ start: 1.6, seconds: 2, fade: 0.4, total: 3.6 });
    expect(previewTotal(plan, timeline, style)).toBe(3.6);
    const long = planSchema.parse({
      ...base,
      clips: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, type: 'photo', path: path(`${i}.jpg`), seconds: 10 })),
    });
    const project: ReelProject = { kind: 'reel', template: { id: style.id }, plan: long };
    expect(projectProblems(project, style)).toContain('El reel duraría 91,6 s y el máximo es 90 s.');
  });
});

describe('crear desde una plantilla con calidad', () => {
  const library = [
    asset('flojita.jpg', { width: 640, height: 480, bytes: 20_000 }),
    asset('arroz.jpg', { width: 1080, height: 1920, bytes: 800_000 }),
    asset('sala.mp4', { kind: 'video', mime_type: 'video/mp4', duration_ms: 8000 } as Partial<RankableAsset>),
    asset('Sin fondo arroz.png', {
      mime_type: 'image/png',
      provenance: { kind: 'media.cutout', sources: [{ path: path('arroz.jpg') }] },
    }),
    asset('recorte.jpg', {
      provenance: {
        kind: 'media.image.process',
        focal_point: { x: 0.2, y: 0.7 },
        sources: [{ path: path('flojita.jpg') }],
      },
    }),
  ];
  const chosen = [library[0]!, library[1]!, library[2]!];

  it('la mejor abre, el vídeo va al plano de ambiente, rótulos, pulsos, encuadre y cierre con la marca', () => {
    const kit = brandReelKit(profile(), path('logo.png'));
    const project = buildBrandReel(template(), chosen, style, { kit, library });
    const { plan } = project;
    expect(plan.clips.map((c) => c.path)).toEqual([path('arroz.jpg'), path('sala.mp4'), path('flojita.jpg')]);
    expect(plan.clips[0]).toMatchObject({ subjectMaskPath: path('Sin fondo arroz.png') });
    expect(plan.clips[2]).toMatchObject({ focalPoint: { x: 0.2, y: 0.7 } });
    // Pulsos enteros del tempo medio (120 ppm = 0,5 s).
    expect(plan.clips[0]).toMatchObject({ seconds: 1 });
    // El gancho y un rótulo en cada plano sin texto (del nombre del archivo); la llamada pasa al cierre y su
    // plano se queda con su rótulo, que acaba cuando entra el cierre.
    expect(plan.texts.map((t) => [t.text, t.role])).toEqual([
      ['Lo que sale de la cocina', 'headline'],
      ['Sala', 'label'],
      ['Flojita', 'label'],
    ]);
    expect(plan.texts.at(-1)!.end).toBe(outroSpan(plan, planTimeline(plan.clips, style), style)!.start);
    expect(plan.outro).toEqual({
      seconds: 2,
      cta: 'Reserva tu mesa',
      handle: '@casa.prueba',
      address: 'Calle Mayor 1',
      logoPath: path('logo.png'),
      accent: '#C9A227',
      accentText: '#141414',
    });
    expect(() => finalizeProject(project)).not.toThrow();
  });

  it('sin perfil, el reel sale igual pero sin cierre', () => {
    const project = buildBrandReel(template(), chosen, style, { library });
    expect(project.plan.outro).toBeUndefined();
    expect(project.plan.texts.at(-1)).toMatchObject({ text: 'Reserva tu mesa', role: 'cta' });
  });

  it('los planos sin preferencia conservan el orden; los que piden algo, lo suyo', () => {
    const v = { kind: 'video', n: 'v' };
    const f1 = { kind: 'image', n: 'f1' };
    const f2 = { kind: 'image', n: 'f2' };
    expect(orderForSlots([{ kind: 'any' }, {}, {}], [v, f1, f2]).map((a) => a.n)).toEqual(['v', 'f1', 'f2']);
    expect(orderForSlots([{ shot: 'detail' }, { shot: 'person' }, {}], [v, f1, f2]).map((a) => a.n)).toEqual([
      'f1',
      'v',
      'f2',
    ]);
  });

  it('el logotipo del cierre es el primero del perfil que se puede superponer (un SVG no)', () => {
    const logos = [
      { id: 'a', kind: 'logo', storage_path: path('logo.svg'), mime_type: 'image/svg+xml' },
      { id: 'b', kind: 'logo', storage_path: path('logo.png'), mime_type: 'image/png' },
    ];
    expect(reelLogoPath(['a', 'b'], logos)).toBe(path('logo.png'));
    expect(reelLogoPath(['a'], logos)).toBeUndefined();
  });
});

describe('fotos añadidas a mano y archivos de ayuda borrados', () => {
  const project: ReelProject = {
    kind: 'reel',
    template: { id: style.id },
    plan: {
      version: 2,
      clips: [
        { id: 'c1', type: 'photo', path: path('a.jpg'), seconds: 2 },
        { id: 'c2', type: 'photo', path: path('b.jpg'), seconds: 2, focalPoint: { x: 0.9, y: 0.9 } },
      ],
      texts: [],
      outro: { cta: 'Ven', logoPath: path('logo.png') },
    },
  };

  it('pone el punto y la máscara guardados solo en las fotos que no los tienen', () => {
    const next = applySavedFraming(
      project,
      new Map([
        [path('a.jpg'), { x: 0.1, y: 0.2 }],
        [path('b.jpg'), { x: 0.5, y: 0.5 }],
      ]),
      new Map([[path('a.jpg'), path('a-mask.png')]]),
    );
    expect(next.plan.clips[0]).toMatchObject({ focalPoint: { x: 0.1, y: 0.2 }, subjectMaskPath: path('a-mask.png') });
    expect(next.plan.clips[1]).toMatchObject({ focalPoint: { x: 0.9, y: 0.9 } });
    expect(applySavedFraming(project, new Map(), new Map())).toBe(project);
  });

  it('una máscara o un logotipo borrados se quitan (no impiden montar); el resto, no', () => {
    const withMask = applySavedFraming(project, new Map(), new Map([[path('a.jpg'), path('a-mask.png')]]));
    expect(planPaths(withMask.plan)).toContain(path('logo.png'));
    expect(planHelperPaths(withMask.plan)).toEqual([path('a-mask.png')]);
    const cleaned = dropMissingHelpers(withMask.plan, (p) => p === path('a-mask.png') || p === path('logo.png'));
    expect(cleaned.clips[0]).not.toHaveProperty('subjectMaskPath');
    expect(cleaned.outro).toEqual({ cta: 'Ven' });
    expect(dropMissingHelpers(withMask.plan, () => false)).toBe(withMask.plan);
  });
});

describe('aviso «Sin música»', () => {
  const clips = [{ type: 'photo' }];
  it('remite a «Terminar en Instagram» si existe y, si no, dice dónde se pone la música', () => {
    expect(audioNoticeText({ clips })).toBe(
      'Sin música: el vídeo saldrá sin sonido. La música se pone en la app de Instagram antes de publicar.',
    );
    expect(audioNoticeText({ clips }, true)).toBe(
      'Sin música: el vídeo saldrá sin sonido. Pon la música en Instagram con «Terminar en Instagram».',
    );
    expect(audioNoticeText({ clips, music: { path: 'x' } })).toBeNull();
  });
});

describe('vista previa con los mínimos de texto del vídeo', () => {
  const size = { width: 1080, height: 1920 };
  const text = (id: string, value: string, start: number, end: number, patch: Record<string, unknown> = {}) => ({
    id,
    text: value,
    start,
    end,
    position: 'bottom' as const,
    style: plain,
    ...patch,
  });
  const plan = (texts: ReturnType<typeof text>[]) =>
    planSchema.parse({
      version: 2,
      clips: [
        { id: 'c1', type: 'photo', path: path('a.jpg'), seconds: 3 },
        { id: 'c2', type: 'photo', path: path('b.jpg'), seconds: 3 },
      ],
      texts,
    });

  it('tamaño mínimo por papel y caja o contorno para que se lea', () => {
    const p = plan([
      text('t1', 'Lo que sale de la cocina', 0, 2, { role: 'headline', position: 'center' }),
      text('t2', 'Croquetas', 2.5, 4, { role: 'label' }),
    ]);
    const fits = fittedTexts(p, planTimeline(p.clips, style), style, size);
    const headline = fits.find((f) => f.key === 't1')!;
    const label = fits.find((f) => f.key === 't2')!;
    expect(headline.laid.fontSize).toBeGreaterThanOrEqual(Math.round(ROLE_RULES.headline.minSizeRatio * 1080 * 0.9));
    expect(headline.style.outline).not.toBeNull();
    expect(label.laid.fontSize).toBeGreaterThanOrEqual(Math.round(ROLE_RULES.label.minSizeRatio * 1080 * 0.9));
    // Un rótulo pequeño sin caja lleva una caja translúcida (como en el vídeo).
    expect(label.style.box).toEqual({ color: '#000000', opacity: 0.62, paddingRatio: 0.3 });
    // El titular del principio entra en el primer segundo.
    expect(headline.start).toBe(0);
  });

  it('dos textos a la vez en la misma franja no se pisan: se apilan dentro de la zona segura', () => {
    const p = plan([text('t1', 'Vaca madurada', 0.5, 3), text('t2', 'A la brasa, 60 días', 0.5, 3)]);
    const timeline = planTimeline(p.clips, style);
    const frame = frameAt(1.5, p, timeline, style, size);
    expect(frame.texts).toHaveLength(2);
    const [a, b] = frame.texts.map((t) => t.laid.extent);
    expect(a![1] <= b![0] || b![1] <= a![0]).toBe(true);
    for (const t of frame.texts) {
      expect(t.laid.extent[0]).toBeGreaterThanOrEqual(250);
      expect(t.laid.extent[1]).toBeLessThanOrEqual(1920 - 400);
    }
  });

  it('las líneas se equilibran y no dejan «de» al final', () => {
    const laid = layoutText(
      { text: 'Lo que sale de la cocina', style: plain, position: 'center', role: 'headline' },
      1080,
      1920,
    );
    expect(laid.lines).toEqual(['Lo que sale', 'de la cocina']);
  });

  it('con cierre, los textos se cortan al entrar el cierre y el cierre se ve al final', () => {
    const p = {
      ...plan([text('t1', 'Hasta el final', 4, 6)]),
      outro: { cta: 'Reserva tu mesa', handle: '@casa' },
    };
    const timeline = planTimeline(p.clips, style);
    const span = outroSpan(p, timeline, style)!;
    expect(fittedTexts(p, timeline, style, size)[0]!.end).toBe(span.start);
    const end = frameAt(span.total - 0.1, p, timeline, style, size);
    expect(end.outro?.texts.map((t) => t.lines.join(' '))).toEqual(['Reserva tu mesa', '@casa']);
    expect(end.texts).toHaveLength(0);
  });
});
