import { describe, expect, it } from 'vitest';
import type { SourceAsset } from './editor/ops';
import { finalizeProject, planTimeline } from './editor/project';
import {
  buildReelFromTemplate,
  describeNeeds,
  reelTemplateNeeds,
  slotsFor,
  validateReelTemplate,
  validateReelTemplatesDelivery,
  type ReelTemplateInput,
} from './reelTemplate';
import { REEL_TEMPLATES } from './templates';

// Plantilla de reel con estructura: el formato compartido entre el catálogo de
// la agencia, «un reel como este» y el paso «Empieza tu reel» del editor.

const STYLE_IDS = REEL_TEMPLATES.map((t) => t.id);
const style = (id: string) => REEL_TEMPLATES.find((t) => t.id === id)!;

const sample = (patch: Partial<ReelTemplateInput> = {}): ReelTemplateInput => ({
  kind: 'rrss.reel-template',
  schemaVersion: 1,
  purpose: 'Enseñar un producto con el resultado como gancho',
  whenToUse: 'Para el producto estrella',
  material: '3 a 5 fotos o clips',
  style: { id: 'corte-ritmico' },
  slots: [
    { id: 'resultado', label: 'Resultado', seconds: 2, motion: 'zoom-in', motionAmount: 0.15 },
    { id: 'paso1', label: 'Paso 1', seconds: 2, transition: { type: 'cut', seconds: 0 } },
    { id: 'paso2', label: 'Paso 2', seconds: 2, optional: true },
    { id: 'paso3', label: 'Paso 3', kind: 'video', seconds: 4, volume: 0.8, optional: true },
    { id: 'final', label: 'Cierre', seconds: 3, transition: { type: 'fade', seconds: 0.4 } },
  ],
  texts: [
    {
      id: 'gancho',
      role: 'hook',
      text: 'Así se hace',
      from: 'resultado',
      position: 'center',
      style: { sizeRatio: 0.09, color: '#ffffff', outline: { color: '#000000', widthRatio: 0.08 } },
      animation: { in: 'zoom', out: 'fade', seconds: 0.4 },
    },
    { id: 'rotulo', role: 'step', text: 'Tercer paso', from: 'paso3', offset: 0.2, position: 'top' },
    { id: 'cierre', role: 'cta', text: 'Ven a probarlo', from: 'final', offset: 0.5, position: 'bottom' },
  ],
  music: { suggestion: 'Instrumental con pulso marcado', bpm: { min: 100, max: 120 }, cutsOnBeat: true },
  cover: { slot: 'resultado', offset: 1 },
  ...patch,
});

const parse = (patch: Partial<ReelTemplateInput> = {}) => {
  const result = validateReelTemplate(sample(patch), STYLE_IDS);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.template;
};

const photo = (n: number): SourceAsset => ({
  id: `f${n}`,
  kind: 'image',
  storage_path: `org/marca/media/foto-${n}.jpg`,
  file_name: `foto-${n}.jpg`,
  mime_type: 'image/jpeg',
  duration_ms: null,
});
const clip = (n: number, seconds: number): SourceAsset => ({
  id: `v${n}`,
  kind: 'video',
  storage_path: `org/marca/media/clip-${n}.mp4`,
  file_name: `clip-${n}.mp4`,
  mime_type: 'video/mp4',
  duration_ms: seconds * 1000,
});

describe('plantilla de reel: el formato', () => {
  it('acepta una plantilla completa y dice lo que necesita', () => {
    const template = parse();
    expect(reelTemplateNeeds(template)).toEqual({ min: 3, max: 5, seconds: 13 });
    expect(describeNeeds(template)).toBe('3 a 5 fotos o clips · unos 13 s');
    expect(
      describeNeeds(
        parse({ slots: [{ id: 'a', label: 'Una', kind: 'photo', seconds: 2 }], texts: [], cover: undefined }),
      ),
    ).toBe('1 foto · unos 2 s');
  });

  it('rechaza lo que no encaja: campos de más, archivos, planos repetidos, textos sin plano y estilos que no existen', () => {
    const issues = (patch: unknown) => {
      const result = validateReelTemplate({ ...sample(), ...(patch as object) }, STYLE_IDS);
      return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
    };
    expect(issues({ extra: 1 }).join()).toMatch(/Unrecognized key/);
    // Una plantilla no lleva archivos: ni música ni tipografías.
    expect(issues({ music: { suggestion: 'x', path: 'org/marca/a.mp3' } }).join()).toMatch(/music/);
    expect(
      issues({
        texts: [{ id: 't', text: 'a', from: 'final', position: 'top', style: { fontPath: 'org/marca/f.ttf' } }],
      }).join(),
    ).toMatch(/texts\.0\.style/);
    expect(issues({ slots: [sample().slots[0], sample().slots[0]] }).join()).toMatch(/mismo identificador/);
    expect(
      issues({ slots: [{ id: 'a', label: 'A', seconds: 2, optional: true }], texts: [], cover: undefined }).join(),
    ).toMatch(/no puede ser opcional/);
    expect(issues({ texts: [{ id: 't', text: 'a', from: 'no-existe', position: 'top' }] }).join()).toMatch(/no existe/);
    expect(issues({ texts: [{ id: 't', text: 'a', from: 'final', to: 'resultado', position: 'top' }] }).join()).toMatch(
      /antes de entrar/,
    );
    expect(issues({ cover: { slot: 'no-existe' } }).join()).toMatch(/no existe/);
    expect(issues({ style: { id: 'inventado' } }).join()).toMatch(/no existe/);
    expect(issues({ schemaVersion: 2 }).length).toBeGreaterThan(0);
    expect(
      issues({ slots: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: 'Largo', seconds: 10 })) }).join(),
    ).toMatch(/más de 90 s/);
  });

  it('el archivo de entrega lleva clave, nombre y documento, sin claves repetidas', () => {
    const ok = validateReelTemplatesDelivery(
      {
        format: 'rrss.agency-reel-templates',
        version: 1,
        note: 'Prueba',
        templates: [{ key: 'asi-se-hace', name: 'Así se hace', document: sample() }],
      },
      STYLE_IDS,
    );
    expect(ok.ok && ok.templates[0]!.document.slots[1]!.kind).toBe('any');
    const bad = validateReelTemplatesDelivery({
      format: 'otra-cosa',
      version: 1,
      templates: [
        { key: 'Mala', name: '', document: sample() },
        { key: 'a', name: 'A', document: sample() },
        { key: 'a', name: 'B', document: { ...sample(), slots: [] }, sobra: true },
      ],
    });
    expect(bad.ok).toBe(false);
    const paths = bad.ok ? [] : bad.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'format',
        'templates[0].key',
        'templates[0].name',
        'templates[2].key',
        'templates[2].sobra',
        'templates[2].document.slots',
      ]),
    );
  });
});

describe('plantilla de reel: tipo de plano (ampliación compatible de la versión 1)', () => {
  it('un plano puede decir qué tipo de plano es; sin él, la plantilla vale igual', () => {
    const typed = parse({
      slots: [
        { id: 'a', label: 'Producto', seconds: 2, shot: 'detail' },
        { id: 'b', label: 'Local', seconds: 2, shot: 'wide' },
        { id: 'c', label: 'Equipo', seconds: 2, shot: 'person' },
        { id: 'd', label: 'Rótulo', seconds: 2, shot: 'text' },
      ],
      texts: [],
      cover: { slot: 'a' },
    });
    expect(typed.slots.map((slot) => slot.shot)).toEqual(['detail', 'wide', 'person', 'text']);
    // Las plantillas de antes (sin tipo de plano) siguen siendo válidas y no lo ganan por defecto.
    expect(parse().slots.every((slot) => slot.shot === undefined)).toBe(true);
    const invented = validateReelTemplate(
      sample({ slots: [{ id: 'a', label: 'Plano', seconds: 2, shot: 'dron' as never }], texts: [], cover: { slot: 'a' } }),
      STYLE_IDS,
    );
    expect(invented.ok).toBe(false);
    // Solo informa: el reel se monta igual con o sin él.
    const asset: SourceAsset = { id: 'f', kind: 'image', storage_path: 'o/m/media/f.jpg', file_name: 'f.jpg', mime_type: 'image/jpeg', duration_ms: null };
    const built = buildReelFromTemplate(typed, [asset, asset, asset, asset], style('corte-ritmico'));
    expect(JSON.stringify(built)).not.toContain('shot');
  });
});

describe('plantilla de reel: qué planos se usan según el material', () => {
  const template = parse();
  const ids = (count: number) => slotsFor(template, count).map((s) => s.id);

  it('con todo el material, todos los planos; si falta, se quitan primero los opcionales del final', () => {
    expect(ids(5)).toEqual(['resultado', 'paso1', 'paso2', 'paso3', 'final']);
    expect(ids(9)).toHaveLength(5);
    expect(ids(4)).toEqual(['resultado', 'paso1', 'paso2', 'final']);
    expect(ids(3)).toEqual(['resultado', 'paso1', 'final']);
  });

  it('con menos del mínimo se conservan el gancho y el cierre', () => {
    expect(ids(2)).toEqual(['resultado', 'final']);
    expect(ids(1)).toEqual(['resultado']);
    expect(ids(0)).toEqual([]);
  });
});

describe('plantilla de reel: montar el reel', () => {
  const template = parse();

  it('cada pieza ocupa un plano con su duración, movimiento y transición, y los textos entran con su plano', () => {
    const project = buildReelFromTemplate(
      template,
      [photo(1), photo(2), photo(3), clip(4, 20), photo(5)],
      style('corte-ritmico'),
      {
        font: { path: 'org/marca/fonts/marca.ttf', family: 'Marca' },
      },
    );
    const ready = finalizeProject(project);
    expect(ready.template.id).toBe('corte-ritmico');
    expect(ready.plan.clips.map((c) => [c.id, c.type])).toEqual([
      ['c1', 'photo'],
      ['c2', 'photo'],
      ['c3', 'photo'],
      ['c4', 'video'],
      ['c5', 'photo'],
    ]);
    expect(ready.plan.clips[0]).toMatchObject({ seconds: 2, motion: 'zoom-in', motionAmount: 0.15 });
    // Sin transición propia, la del estilo; el clip usa el tramo del plano y su volumen.
    expect(ready.plan.clips[2]).toMatchObject({ transition: { type: 'cut', seconds: 0 } });
    expect(ready.plan.clips[3]).toMatchObject({ in: 0, out: 4, volume: 0.8 });
    expect(ready.plan.clips[4]).toMatchObject({ seconds: 3, transition: { type: 'fade', seconds: 0.4 } });

    const timeline = planTimeline(ready.plan.clips, style('corte-ritmico'));
    expect(timeline.total).toBe(12.6);
    const [hook, step, cta] = ready.plan.texts;
    expect(hook).toMatchObject({
      text: 'Así se hace',
      start: 0,
      end: 2,
      position: 'center',
      animation: { in: 'zoom' },
    });
    // El estilo del texto: el del estilo base, lo que cambia la plantilla y la tipografía de la marca.
    expect(hook!.style).toMatchObject({
      sizeRatio: 0.09,
      color: '#FFFFFF',
      fontPath: 'org/marca/fonts/marca.ttf',
      fontFamily: 'Marca',
      maxWidthRatio: style('corte-ritmico').text.maxWidthRatio,
    });
    expect(step).toMatchObject({ text: 'Tercer paso', start: 6.2, end: 10 });
    expect(cta).toMatchObject({ text: 'Ven a probarlo', start: 10.1, end: 12.6 });
    expect(ready.plan.cover).toEqual({ type: 'frame', at: 1 });
    expect(ready.plan.music).toBeUndefined();
  });

  it('con menos material se quitan planos y sus textos, y el cierre sigue en su sitio', () => {
    const project = finalizeProject(
      buildReelFromTemplate(template, [photo(1), photo(2), photo(3)], style('corte-ritmico')),
    );
    expect(project.plan.clips).toHaveLength(3);
    expect(project.plan.texts.map((t) => t.text)).toEqual(['Así se hace', 'Ven a probarlo']);
    const { total } = planTimeline(project.plan.clips, style('corte-ritmico'));
    expect(project.plan.texts[1]!.end).toBe(total);
  });

  it('un clip más corto que su plano se usa entero y una foto en un plano largo no pasa de 10 s', () => {
    const long = parse({
      slots: [
        { id: 'habla', label: 'Habla a cámara', kind: 'video', seconds: 14, volume: 1 },
        { id: 'final', label: 'Cierre', seconds: 3 },
      ],
      texts: [
        { id: 'quien', role: 'detail', text: 'Nombre', from: 'habla', offset: 0.5, endOffset: -9, position: 'top' },
      ],
      cover: { slot: 'habla', offset: 2 },
    });
    const withShortClip = finalizeProject(buildReelFromTemplate(long, [clip(1, 6), photo(2)], style('fundido-suave')));
    expect(withShortClip.plan.clips[0]).toMatchObject({ in: 0, out: 6, volume: 1 });
    // El texto pedía salir 9 s antes del final de un plano de 14 s: en uno de 6 s dura lo mínimo.
    expect(withShortClip.plan.texts[0]).toMatchObject({ start: 0.5, end: 1 });
    const withPhoto = finalizeProject(buildReelFromTemplate(long, [photo(1), photo(2)], style('fundido-suave')));
    expect(withPhoto.plan.clips[0]).toMatchObject({ type: 'photo', seconds: 10 });
  });
});
