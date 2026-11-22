import { describe, expect, it } from 'vitest';
import {
  buildReelLikeResult,
  parseMeasurement,
  type ReelLikeAiOutput,
  type ReelLikeResult,
} from '../../../../supabase/functions/_shared/reels/like';
import { removeClip, removeText, updateText } from '../editor/ops';
import { buildRenderRequest, finalizeProject, planTimeline, type ReelProject } from '../editor/project';
import { REEL_TEMPLATES } from '../templates';
import {
  baseTemplate,
  buildDraft,
  contrast,
  draftFromReference,
  fillGuideShot,
  guideGaps,
  guideStatus,
  guideTextStyle,
  matchShots,
  normalizeWord,
  scoreAsset,
  type LibraryAsset,
} from './draft';

// Del resultado de «Hacer un reel como este» a un borrador del editor: qué
// material de la biblioteca encaja con cada plano (sin IA), cómo queda el reel
// y cómo se rellenan los huecos. El análisis es el del vídeo de ejemplo
// (4 planos: 2 s, 1,5 s, 2,25 s y 1,75 s; el último entra con un encadenado).

const REFERENCE = '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a41';
const P = 'org/marca/media';

const measurement = parseMeasurement({
  source: { kind: 'upload', durationSeconds: 7.5, width: 540, height: 960, fps: 30, hasAudio: true },
  shots: [
    { index: 0, start: 0, end: 2, seconds: 2, motion: 0.7, still: false },
    { index: 1, start: 2, end: 3.5, seconds: 1.5, motion: 0, still: true, transitionIn: { type: 'cut', seconds: 0 } },
    { index: 2, start: 3.5, end: 5.75, seconds: 2.25, motion: 0.7, still: false, transitionIn: { type: 'cut', seconds: 0 } },
    { index: 3, start: 5.75, end: 7.5, seconds: 1.75, motion: 0, still: true, transitionIn: { type: 'fade', seconds: 0.5 } },
  ],
  frames: [0, 1, 2, 3].map((shot) => ({ path: `f-${shot}.jpg`, at: shot, shot })),
  audio: { present: true, silent: false, bpm: 120, confidence: 0.8, cutsOnBeat: 0.67, beatsPerCut: 4, speech: [] },
  warnings: [],
})!;

const ai: ReelLikeAiOutput = {
  name: 'Gancho + 2 pasos + cierre',
  summary: 'Promete algo y lo cumple en dos pasos.',
  pace: 'medio',
  audioKind: 'musica',
  title: 'Así hacemos la hogaza',
  idea: 'El proceso del pan de los sábados.',
  shots: [
    { index: 1, kind: 'detalle', media: 'video', description: 'Plano cerrado del producto', what: 'La hogaza recién salida', tip: 'Luz de ventana', search: ['pan', 'hogaza'] },
    { index: 2, kind: 'general', media: 'foto', description: 'El local', what: 'El obrador entero', tip: 'Desde la puerta', search: ['obrador'] },
    { index: 3, kind: 'persona', media: 'video', description: 'Alguien trabajando', what: 'Amasando a mano', tip: 'Plano medio', search: ['amasar', 'equipo'] },
    { index: 4, kind: 'texto', media: 'foto', description: 'Cierre con rótulo', what: 'El escaparate con el horario', tip: '', search: ['escaparate'] },
  ],
  texts: [
    { role: 'gancho', position: 'top', size: 'grande', fromShot: 1, toShot: 1, value: 'El pan de los sábados' },
    { role: 'paso', position: 'bottom', size: 'normal', fromShot: 2, toShot: 3, value: 'Masa madre y paciencia' },
    { role: 'llamada', position: 'center', size: 'normal', fromShot: 4, toShot: 4, value: 'Te esperamos' },
  ],
  hook: 'El pan de los sábados',
  caption: 'Hecho hoy.',
  hashtags: ['masamadre'],
  coverShot: 1,
  coverNote: 'La hogaza',
};
const result: ReelLikeResult = buildReelLikeResult(measurement, ai, { transcriptUsed: false });

let n = 0;
const asset = (
  kind: 'image' | 'video',
  name: string,
  extra: Partial<Pick<LibraryAsset, 'tags' | 'folder' | 'duration_ms' | 'created_at'>> = {},
): LibraryAsset => ({
  id: `a${++n}`,
  kind,
  storage_path: `${P}/${name}`,
  file_name: name,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  duration_ms: kind === 'video' ? 8000 : null,
  folder: '',
  tags: [],
  created_at: '2026-11-20T10:00:00Z',
  ...extra,
});

const library = () => [
  asset('video', 'IMG_0001.mp4', { tags: ['Panes'] }),
  asset('image', 'IMG_0002.jpg', { folder: 'Obrador' }),
  asset('image', 'equipo-amasando.jpg'),
  asset('image', 'IMG_0004.jpg', { tags: ['postres'] }),
];
const options = { referenceId: REFERENCE, templates: REEL_TEMPLATES };

describe('qué material de la biblioteca encaja con cada plano', () => {
  it('compara sin acentos ni plurales', () => {
    expect(normalizeWord('Panes')).toBe('pan');
    expect(normalizeWord('Cócteles')).toBe('coctel');
    expect(normalizeWord('obrador')).toBe('obrador');
    expect(normalizeWord('más')).toBe('mas');
  });

  it('puntúa por etiqueta, carpeta y nombre; el tipo solo desempata', () => {
    const shot = { media: 'video' as const, seconds: 2, search: ['pan'] };
    expect(scoreAsset(shot, asset('video', 'a.mp4', { tags: ['Panes'] }))).toEqual({ score: 4, reasons: ['etiqueta «Panes»'] });
    expect(scoreAsset(shot, asset('image', 'a.jpg', { tags: ['pan'] })).score).toBe(3);
    expect(scoreAsset(shot, asset('image', 'a.jpg', { folder: 'El pan' }))).toEqual({ score: 2, reasons: ['carpeta «El pan»'] });
    expect(scoreAsset(shot, asset('image', 'pan-de-pueblo.jpg'))).toEqual({ score: 1, reasons: ['nombre del archivo'] });
    // Sin ninguna palabra en común no encaja, sea del tipo que sea.
    expect(scoreAsset(shot, asset('video', 'otro.mp4', { tags: ['postres'] })).score).toBe(0);
    expect(scoreAsset({ ...shot, search: [] }, asset('video', 'pan.mp4')).score).toBe(0);
    // Un clip más corto que el plano vale, pero puntúa menos.
    const short = scoreAsset(shot, asset('video', 'a.mp4', { tags: ['pan'], duration_ms: 1000 }));
    expect(short.score).toBe(3);
    expect(short.reasons).toContain('el clip es más corto que el plano');
    // Un audio o un documento no son material de un plano.
    expect(scoreAsset(shot, { ...asset('image', 'pan.jpg'), kind: 'audio' }).score).toBe(0);
  });

  it('reparte un recurso por plano y deja como hueco lo que no encaja', () => {
    const assets = library();
    const matches = matchShots(result, assets);
    expect(matches.map((m) => m.asset?.file_name ?? null)).toEqual(['IMG_0001.mp4', 'IMG_0002.jpg', 'equipo-amasando.jpg', null]);
    expect(matches[3]).toEqual({ shot: 's4', asset: null, score: 0, reasons: [] });
    // Cada recurso, una sola vez: con dos planos que piden lo mismo, el segundo se queda sin él.
    const twice = buildReelLikeResult(
      measurement,
      { ...ai, shots: ai.shots.map((s) => ({ ...s, search: ['pan'] })) },
      { transcriptUsed: false },
    );
    expect(matchShots(twice, assets).map((m) => m.asset?.file_name ?? null)).toEqual(['IMG_0001.mp4', null, null, null]);
    // A igualdad de puntos, el más reciente.
    const older = asset('image', 'viejo.jpg', { tags: ['obrador'], created_at: '2026-01-01T00:00:00Z' });
    const newer = asset('image', 'nuevo.jpg', { tags: ['obrador'], created_at: '2026-11-21T00:00:00Z' });
    expect(matchShots(result, [older, newer])[1]!.asset!.file_name).toBe('nuevo.jpg');
  });
});

describe('el borrador del reel', () => {
  it('monta los planos con material en su orden, con la duración y la transición de la plantilla', () => {
    const draft = buildDraft(result, matchShots(result, library()), options);
    expect(draft).toMatchObject({ filled: 3, gaps: 1, notes: [] });
    // Casi todo son cortes: el estilo de partida es el de cortes secos.
    expect(draft.template.id).toBe('corte-ritmico');
    expect(draft.project.template).toEqual({ id: 'corte-ritmico' });
    expect(draft.project.plan.clips).toEqual([
      { id: 'c1', type: 'video', path: `${P}/IMG_0001.mp4`, in: 0, out: 2, volume: draft.template.audio.clipVolume },
      { id: 'c2', type: 'photo', path: `${P}/IMG_0002.jpg`, seconds: 1.5, transition: { type: 'cut', seconds: 0 } },
      { id: 'c3', type: 'photo', path: `${P}/equipo-amasando.jpg`, seconds: 2.25, transition: { type: 'cut', seconds: 0 } },
    ]);
    // El guion: lo que hay que grabar en cada plano y cuál falta.
    expect(draft.project.guide).toMatchObject({ referenceId: REFERENCE });
    expect(guideStatus(draft.project).map((e) => [e.shot.id, e.shot.label, e.shot.seconds, e.filled])).toEqual([
      ['s1', 'La hogaza recién salida', 2, true],
      ['s2', 'El obrador entero', 1.5, true],
      ['s3', 'Amasando a mano', 2.25, true],
      ['s4', 'El escaparate con el horario', 1.75, false],
    ]);
    expect(draft.project.guide!.shots[3]).toMatchObject({ kind: 'texto', media: 'foto', transition: { type: 'fade', seconds: 0.5 } });
    expect(draft.project.guide!.shots[3]!.clipId).toBeUndefined();
    expect(guideGaps(draft.project)).toBe(1);
  });

  it('pone los textos sobre los planos que ya existen, con su momento; los de un hueco esperan', () => {
    const { project, template } = buildDraft(result, matchShots(result, library()), options);
    // Los tiempos salen de la línea de tiempo del motor (duraciones ajustadas a fotogramas).
    const timeline = planTimeline(project.plan.clips, template);
    expect(project.plan.texts.map((t) => [t.id, t.text, t.start, t.position])).toEqual([
      ['gt1', 'El pan de los sábados', 0, 'top'],
      ['gt2', 'Masa madre y paciencia', 2, 'bottom'],
    ]);
    expect(project.plan.texts[0]!.end).toBe(2);
    expect(project.plan.texts[1]!.end).toBeCloseTo(timeline.total, 1);
    expect(timeline.total).toBeCloseTo(5.75, 1);
    expect(project.guide!.texts.map((t) => t.id)).toEqual(['gt1', 'gt2', 'gt3']);
    // El tamaño sale del análisis; lo demás, del estilo de partida.
    expect(project.plan.texts[0]!.style.sizeRatio).toBe(0.085);
    expect(project.plan.texts[1]!.style.sizeRatio).toBe(0.06);
    expect(project.plan.texts[0]!.style.fadeSeconds).toBe(template.text.fadeSeconds);
    // La portada: el fotograma del plano que dice la plantilla.
    expect(project.plan.cover).toEqual({ type: 'frame', at: 1.2 });
  });

  it('es un proyecto válido del editor, y el guion no viaja al trabajador', () => {
    const { project } = buildDraft(result, matchShots(result, library()), options);
    const saved = finalizeProject(project);
    expect(saved.guide!.shots).toHaveLength(4);
    const request = buildRenderRequest(project, { id: 'pieza', version: 1 }) as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual(['content', 'plan', 'template']);
    expect(JSON.stringify(request)).not.toContain('guide');
    // Y leído de vuelta (una versión guardada) es el mismo.
    expect(finalizeProject(JSON.parse(JSON.stringify(saved)) as ReelProject)).toEqual(saved);
  });

  it('con mayoría de transiciones suaves parte del estilo de fundidos', () => {
    const soft = buildReelLikeResult(
      { ...measurement, shots: measurement.shots.map((s, i) => (i === 0 ? s : { ...s, transitionIn: { type: 'fade' as const, seconds: 0.4 } })) },
      ai,
      { transcriptUsed: false },
    );
    expect(baseTemplate(soft, REEL_TEMPLATES).id).toBe('fundido-suave');
    const draft = buildDraft(soft, matchShots(soft, library()), options);
    expect(draft.project.plan.clips[1]!.transition).toEqual({ type: 'fade', seconds: 0.4 });
    // El primero entra sin transición.
    expect(draft.project.plan.clips[0]!.transition).toBeUndefined();
  });

  it('usa la tipografía de la marca y su color en la franja solo si se lee', () => {
    const soft = REEL_TEMPLATES.find((t) => t.id === 'fundido-suave')!;
    const font = { path: 'org/marca/fonts/marca.ttf', family: 'Marca' };
    const dark = guideTextStyle('grande', soft, { colors: ['#1a3355'], font });
    expect(dark).toMatchObject({ fontPath: font.path, fontFamily: 'Marca', sizeRatio: 0.085 });
    if (soft.text.box) {
      expect(dark.box).toMatchObject({ color: '#1A3355' });
      // Un amarillo claro bajo letras blancas no se leería: se queda la franja del estilo.
      expect(guideTextStyle('normal', soft, { colors: ['#FFEE88'] }).box).toEqual(soft.text.box);
    }
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(contrast('#FFFFFF', '#FFEE88')).toBeLessThan(4.5);
    const draft = buildDraft(result, matchShots(result, library()), { ...options, look: { font } });
    expect(draft.project.plan.texts.every((t) => t.style.fontPath === font.path)).toBe(true);
    expect(() => finalizeProject(draft.project)).not.toThrow();
  });

  it('sin nada que encaje, el borrador es el guion de lo que hay que grabar', () => {
    const draft = draftFromReference(JSON.parse(JSON.stringify(result)), [asset('image', 'otra-cosa.jpg')], options)!;
    expect(draft.filled).toBe(0);
    expect(draft.gaps).toBe(4);
    expect(draft.project.plan.clips).toEqual([]);
    expect(draft.project.plan.texts).toEqual([]);
    expect(draft.project.plan.cover).toBeUndefined();
    expect(draft.notes[0]).toMatch(/no hay nada que encaje todavía/);
    expect(draftFromReference({ schemaVersion: 2 }, [], options)).toBeNull();
  });

  it('una referencia más larga que un reel del editor se queda en sus primeros planos', () => {
    const long = buildReelLikeResult(
      {
        ...measurement,
        shots: Array.from({ length: 12 }, (_, index) => ({
          index,
          start: index * 10,
          end: index * 10 + 10,
          seconds: 10,
          motion: 0,
          still: true,
        })),
      },
      { ...ai, shots: [], texts: [{ role: 'llamada', position: 'center', size: 'normal', fromShot: 12, toShot: 12, value: 'Fin' }] },
      { transcriptUsed: false },
    );
    const draft = buildDraft(long, [], options);
    expect(draft.project.guide!.shots).toHaveLength(9);
    expect(draft.notes.join(' ')).toMatch(/90 s\): el borrador se queda con sus 9 primeros planos/);
    // El texto de un plano que no entra tampoco.
    expect(draft.project.guide!.texts).toEqual([]);
  });
});

describe('rellenar un hueco del guion', () => {
  const start = () => buildDraft(result, matchShots(result, library()), options);

  it('pone el clip en su sitio con la duración del plano y trae su texto', () => {
    const { project, template } = start();
    const photo = asset('image', 'escaparate.jpg');
    const filled = fillGuideShot(project, 's4', photo, template);
    expect(filled.plan.clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(filled.plan.clips[3]).toEqual({
      id: 'c4',
      type: 'photo',
      path: photo.storage_path,
      seconds: 1.75,
      transition: { type: 'fade', seconds: 0.5 },
    });
    expect(guideGaps(filled)).toBe(0);
    // El texto de ese plano aparece, sobre él (el encadenado solapa medio segundo).
    const timeline = planTimeline(filled.plan.clips, template);
    const cta = filled.plan.texts.find((t) => t.id === 'gt3')!;
    expect(cta).toMatchObject({ text: 'Te esperamos', position: 'center' });
    expect(cta.start).toBeCloseTo(timeline.starts[3]!, 1);
    expect(cta.end).toBeCloseTo(timeline.total, 1);
    expect(timeline.total).toBeCloseTo(7, 1);
    expect(() => finalizeProject(filled)).not.toThrow();
    // El proyecto de antes no cambia (es un paso más de «Deshacer»).
    expect(project.plan.clips).toHaveLength(3);
    // Rellenar dos veces el mismo plano, o un plano que no existe, no hace nada.
    expect(fillGuideShot(filled, 's4', photo, template)).toBe(filled);
    expect(fillGuideShot(project, 's9', photo, template)).toBe(project);
    expect(fillGuideShot(project, 's4', { ...photo, kind: 'audio' }, template)).toBe(project);
  });

  it('un hueco del medio entra entre sus vecinos y los textos se recolocan', () => {
    const assets = library().filter((a) => a.file_name !== 'IMG_0002.jpg');
    const { project, template } = buildDraft(result, matchShots(result, assets), options);
    // Falta el plano 2 (y el 4): el texto de los planos 2-3 solo cubre el 3.
    expect(project.plan.clips.map((c) => c.path.split('/').pop())).toEqual(['IMG_0001.mp4', 'equipo-amasando.jpg']);
    expect(project.plan.texts.find((t) => t.id === 'gt2')!.start).toBe(2);
    expect(project.plan.texts.find((t) => t.id === 'gt2')!.end).toBeCloseTo(4.25, 1);
    const clip = asset('video', 'obrador.mp4', { duration_ms: 1000 });
    const filled = fillGuideShot(project, 's2', clip, template);
    expect(filled.plan.clips.map((c) => c.path.split('/').pop())).toEqual(['IMG_0001.mp4', 'obrador.mp4', 'equipo-amasando.jpg']);
    // Un clip más corto que el plano entra entero, sin estirarse.
    expect(filled.plan.clips[1]).toMatchObject({ type: 'video', in: 0, out: 1, transition: { type: 'cut', seconds: 0 } });
    // El texto de los planos 2-3 ahora empieza en el 2 y acaba con el 3.
    expect(filled.plan.texts.find((t) => t.id === 'gt2')!.start).toBe(2);
    expect(filled.plan.texts.find((t) => t.id === 'gt2')!.end).toBeCloseTo(5.25, 1);
  });

  it('respeta lo que la persona cambió: su letra se queda y lo que borró no vuelve', () => {
    const { project, template } = start();
    const edited = removeText(updateText(project, 'gt2', { text: 'Con mis palabras' }), 'gt1');
    const filled = fillGuideShot(edited, 's4', asset('image', 'escaparate.jpg'), template);
    expect(filled.plan.texts.map((t) => [t.id, t.text])).toEqual([
      ['gt2', 'Con mis palabras'],
      ['gt3', 'Te esperamos'],
    ]);
  });

  it('si se quita del reel el clip de un plano, vuelve a faltar', () => {
    const { project } = start();
    const without = removeClip(project, 'c2');
    expect(guideStatus(without).map((e) => e.filled)).toEqual([true, false, true, false]);
  });

  it('un hueco del principio entra el primero, sin transición, y el que era primero recupera la suya', () => {
    const assets = library().filter((a) => a.file_name !== 'IMG_0001.mp4');
    const { project, template } = buildDraft(result, matchShots(result, assets), options);
    expect(project.plan.clips[0]!.transition).toBeUndefined();
    const filled = fillGuideShot(project, 's1', asset('video', 'hogaza.mp4'), template);
    expect(filled.plan.clips.map((c) => c.path.split('/').pop())).toEqual(['hogaza.mp4', 'IMG_0002.jpg', 'equipo-amasando.jpg']);
    expect(filled.plan.clips[0]!.transition).toBeUndefined();
    expect(filled.plan.clips[1]!.transition).toEqual({ type: 'cut', seconds: 0 });
    expect(filled.plan.texts.find((t) => t.id === 'gt1')).toMatchObject({ start: 0, end: 2 });
  });
});
