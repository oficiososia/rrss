// Lo que añade el editor «como los de móvil» (docs/editor-reels.md §10), sin
// pantalla: el plan ampliado (velocidad, filtro, texto colocado) contado igual
// que el trabajador, las operaciones nuevas (dividir, sustituir, velocidad,
// silenciar, duplicar), los estilos de texto, la barra según lo elegido, el
// borrador automático que se sabe leer, y las cuentas de la vista previa y de
// la línea de tiempo (cabezal, miniaturas, onda).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REEL_TEMPLATES } from '../templates';
import { createClock } from './clock';
import { frameAt, prepareFrames, previewWarnings } from './compose';
import { barKind, contextActions, type BarContext } from './ContextBar';
import { editorReducer, initEditor } from './history';
import {
  addClip,
  addText,
  canSplitAt,
  clipIndexAt,
  duplicateText,
  NEW_TEXT_SECONDS,
  replaceClip,
  setAllTransitions,
  setClipSpeed,
  setTextOffset,
  setTextSize,
  splitClip,
  toggleClipMute,
} from './ops';
import {
  emptyProject,
  finalizeProject,
  parseDraftProject,
  planSchema,
  planTimeline,
  projectSchema,
  templateTextStyle,
  timelineSubtitles,
  type ReelProject,
  type VideoClip,
} from './project';
import { fitCutsToBeats } from './rhythm';
import { snapOffset, textBox } from './TextOverlay';
import { applyTextPreset, presetOf, TEXT_PRESETS, withTextPreset } from './textPresets';
import { frameKey, frameTime, stripTimes } from './thumbs';
import { computePeaks, peakAt } from './waveform';

const template = (id: string) => REEL_TEMPLATES.find((t) => t.id === id)!;
const fundido = template('fundido-suave');
/** Ejemplo compartido con el trabajador (worker/tests/reel-editor-pro.test.ts). */
const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'worker/tests/fixtures/plan-v2-pro.json'), 'utf8'),
);
const asset = (id: string, kind: 'image' | 'video', durationMs: number | null = null) => ({
  id,
  kind,
  storage_path: `o/m/media/${id}`,
  file_name: id,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  duration_ms: durationMs,
});

function sample(): ReelProject {
  let p = emptyProject(fundido);
  p = addClip(p, asset('a.jpg', 'image'), fundido);
  p = addClip(p, asset('b.mp4', 'video', 10_000), fundido);
  p = addClip(p, asset('c.jpg', 'image'), fundido);
  return addText(p, fundido, 0, templateTextStyle(fundido), 8);
}
const timelineOf = (p: ReelProject) => planTimeline(p.plan.clips, fundido, () => 10);
const video = (p: ReelProject, id = 'c2') => p.plan.clips.find((c) => c.id === id) as VideoClip;

describe('plan v2 ampliado: el ejemplo compartido con el trabajador', () => {
  it('es válido y la línea de tiempo cuenta la velocidad igual que el motor', () => {
    expect(planSchema.safeParse(fixture).success).toBe(true);
    const clips = planSchema.parse(fixture).clips;
    const timeline = planTimeline(clips, fundido, () => 3);
    expect(timeline).toEqual({
      durations: [1.4, 0.8, 1.5],
      transitions: [0, 0, 0.3],
      starts: [0, 1.4, 1.9],
      total: 3.4,
    });
    expect(timelineSubtitles(clips, timeline).map((c) => [c.start, c.end, c.text])).toEqual([
      [1.65, 2.15, 'Va al doble'],
    ]);
  });

  it('rechaza velocidades fuera de 0,5–2, filtros inventados, desplazamientos exagerados y los nulos', () => {
    const withClip = (patch: Record<string, unknown>) => ({ ...fixture, clips: [{ ...fixture.clips[0], ...patch }] });
    expect(planSchema.safeParse(withClip({ speed: 0.5, filter: 'drama' })).success).toBe(true);
    expect(planSchema.safeParse(withClip({ speed: 2.1 })).success).toBe(false);
    expect(planSchema.safeParse(withClip({ speed: null })).success).toBe(false);
    expect(planSchema.safeParse(withClip({ filter: 'neon' })).success).toBe(false);
    expect(planSchema.safeParse({ ...fixture, clips: [{ ...fixture.clips[2], speed: 2 }] }).success).toBe(false);
    const withOffset = (offset: unknown) => ({ ...fixture, texts: [{ ...fixture.texts[0], offset }] });
    expect(planSchema.safeParse(withOffset({ x: 0.5, y: -0.5 })).success).toBe(true);
    expect(planSchema.safeParse(withOffset({ x: 0.51, y: 0 })).success).toBe(false);
    expect(planSchema.safeParse(withOffset(null)).success).toBe(false);
  });

  it('la vista previa lee el archivo a la velocidad del clip y dibuja el texto desplazado', () => {
    const plan = planSchema.parse(fixture);
    const timeline = planTimeline(plan.clips, fundido, () => 3);
    const size = { width: 360, height: 640 };
    // 0,2 s dentro de c2 (que empieza en 1,4 y va al doble): 0,4 s más allá de su entrada (1,4).
    const frame = frameAt(1.6, plan, timeline, fundido, size);
    expect(frame.layers).toHaveLength(1);
    expect(frame.layers[0]).toMatchObject({ clip: 1 });
    expect(frame.layers[0]!.sourceTime).toBeCloseTo(1.8, 5);
    // El subtítulo del clip (1,9–2,9 de archivo) todavía no ha entrado; a los 1,8 s del reel, sí.
    expect(frame.subtitles).toHaveLength(0);
    expect(frameAt(1.8, plan, timeline, fundido, size).subtitles.map((s) => s.lines.join(' '))).toEqual([
      'Va al doble',
    ]);
    const text = frameAt(0.8, plan, timeline, fundido, size).texts[0]!;
    expect(text).toMatchObject({ dx: 0.1, dy: -0.25 });
    // Preparado una vez, da lo mismo que calculado de cero en cada fotograma.
    const frames = prepareFrames(plan, timeline, fundido, size);
    for (const t of [0, 0.8, 1.6, 2, 3.2]) expect(frames(t)).toEqual(frameAt(t, plan, timeline, fundido, size));
    expect(previewWarnings(plan, fundido, { loadedFamilies: [], brandReelFont: true, mimeOf: () => null })).toContain(
      'Los filtros de color se ven aquí aproximados: en el vídeo el tono puede cambiar un poco.',
    );
  });
});

describe('dividir en el cabezal', () => {
  it('parte un clip en dos tramos seguidos del mismo archivo; el reel dura lo mismo y la segunda parte entra con corte', () => {
    const p = sample();
    const before = timelineOf(p);
    const start = before.starts[1]!;
    expect(clipIndexAt(before, start + 1.5)).toBe(1);
    expect(canSplitAt(p, before, 1, start + 1.5)).toBe(true);
    const split = splitClip(p, 'c2', 1.5, 10);
    expect(split.plan.clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c4', 'c3']);
    expect(video(split)).toMatchObject({ in: 0, out: 1.5, transition: { type: 'fade', seconds: 0.5 } });
    expect(video(split, 'c4')).toMatchObject({ in: 1.5, out: 4, volume: 0, transition: { type: 'cut', seconds: 0 } });
    expect(timelineOf(split).total).toBeCloseTo(before.total, 5);
    // El original no cambia (el historial lo guarda para «Deshacer»).
    expect(p.plan.clips).toHaveLength(3);
    expect(() => finalizeProject(split)).not.toThrow();
  });

  it('a otra velocidad, el corte cae en el segundo del archivo que se está viendo', () => {
    const p = setClipSpeed(sample(), 'c2', 2);
    // El clip toma 4 s de archivo y dura 2 s en el reel: a 0,5 s de reel se va por el segundo 1 del archivo.
    const split = splitClip(p, 'c2', 0.5, 10);
    expect(video(split)).toMatchObject({ in: 0, out: 1, speed: 2 });
    expect(video(split, 'c4')).toMatchObject({ in: 1, out: 4, speed: 2 });
  });

  it('una foto se parte en dos fotos con sus segundos; cerca de un extremo no se divide', () => {
    const p = sample();
    const split = splitClip(p, 'c1', 1);
    expect(split.plan.clips.slice(0, 2)).toMatchObject([
      { id: 'c1', type: 'photo', seconds: 1 },
      { id: 'c4', type: 'photo', seconds: 1.5, transition: { type: 'cut', seconds: 0 } },
    ]);
    const timeline = timelineOf(p);
    expect(canSplitAt(p, timeline, 0, 0.2)).toBe(false);
    expect(splitClip(p, 'c1', 0.2)).toBe(p);
    expect(splitClip(p, 'c2', 3.8, 10)).toBe(p);
    expect(clipIndexAt(timeline, 99)).toBe(-1);
  });
});

describe('sustituir, velocidad, volumen y transiciones', () => {
  it('sustituir conserva el sitio, la duración y los efectos; lo que era del archivo anterior se quita', () => {
    let p = sample();
    p = {
      ...p,
      plan: {
        ...p.plan,
        clips: p.plan.clips.map((c) =>
          c.id === 'c2'
            ? ({
                ...c,
                in: 2,
                out: 5,
                volume: 0.7,
                speed: 1.5,
                filter: 'vivid',
                blur: 20,
                focalPoint: { x: 0.2, y: 0.2 },
                subtitles: [{ start: 2.2, end: 3, text: 'Hola' }],
              } as VideoClip)
            : c,
        ),
      },
    };
    const same = replaceClip(p, 'c2', asset('otro.mp4', 'video', 20_000), fundido).plan.clips[1]!;
    expect(same).toEqual({
      id: 'c2',
      type: 'video',
      path: 'o/m/media/otro.mp4',
      in: 2,
      out: 5,
      volume: 0.7,
      speed: 1.5,
      filter: 'vivid',
      blur: 20,
      transition: { type: 'fade', seconds: 0.5 },
    });
    // Un archivo más corto: el mismo largo, tomado del final que cabe.
    expect(replaceClip(p, 'c2', asset('corto.mp4', 'video', 4000), fundido).plan.clips[1]).toMatchObject({
      in: 1,
      out: 4,
    });
    // Por una foto: dura lo que duraba el tramo en el reel (3 s de archivo a 1,5× = 2 s).
    expect(replaceClip(p, 'c2', asset('foto.jpg', 'image'), fundido).plan.clips[1]).toEqual({
      id: 'c2',
      type: 'photo',
      path: 'o/m/media/foto.jpg',
      seconds: 2,
      filter: 'vivid',
      blur: 20,
      transition: { type: 'fade', seconds: 0.5 },
    });
    // Una foto por un clip: su duración, desde el principio del archivo, con el volumen del estilo.
    expect(replaceClip(p, 'c1', asset('otro.mp4', 'video', 20_000), fundido).plan.clips[0]).toMatchObject({
      type: 'video',
      in: 0,
      out: 2.5,
      volume: fundido.audio.clipVolume,
    });
  });

  it('la velocidad acorta o alarga el tramo en el reel y a 1× el campo no se guarda', () => {
    const p = sample();
    const fast = setClipSpeed(p, 'c2', 2);
    expect(video(fast).speed).toBe(2);
    expect(timelineOf(fast).durations[1]).toBe(2);
    expect(timelineOf(setClipSpeed(p, 'c2', 0.5)).durations[1]).toBe(8);
    expect(video(setClipSpeed(p, 'c2', 9)).speed).toBe(2);
    expect(video(setClipSpeed(p, 'c2', 0.1)).speed).toBe(0.5);
    expect(video(setClipSpeed(fast, 'c2', 1))).not.toHaveProperty('speed');
    // Una foto no tiene velocidad.
    expect(setClipSpeed(p, 'c1', 2).plan.clips[0]).not.toHaveProperty('speed');
  });

  it('ajustar los cortes a la música cuenta con la velocidad del clip', () => {
    let p = setClipSpeed(sample(), 'c2', 2);
    p = { ...p, plan: { ...p.plan, music: { path: 'o/m/media/m.m4a', startAt: 0, volume: 0.3, fadeInSeconds: 0, fadeOutSeconds: 0 } } };
    const beats = Array.from({ length: 40 }, (_, i) => Number((i * 0.5).toFixed(2)));
    const fit = fitCutsToBeats(p, fundido, { bpm: 120, beats }, { fileSeconds: () => 10, beatsPerCut: 4 })!;
    const clip = fit.project.plan.clips[1] as VideoClip;
    const timeline = planTimeline(fit.project.plan.clips, fundido, () => 10);
    // Lo que dura en el reel × la velocidad = el tramo de archivo que se toma.
    expect(clip.out - clip.in).toBeCloseTo(timeline.durations[1]! * 2, 1);
  });

  it('silenciar y devolver el sonido; la misma transición en todos los cortes', () => {
    const corte = template('corte-ritmico');
    const p = sample();
    // El estilo «fundido suave» silencia los clips: al devolver el sonido, el original entero.
    expect(video(p).volume).toBe(0);
    const loud = toggleClipMute(p, 'c2', fundido);
    expect(video(loud).volume).toBe(1);
    expect(video(toggleClipMute(loud, 'c2', fundido)).volume).toBe(0);
    expect(toggleClipMute(p, 'c1', corte)).toEqual(p);
    const all = setAllTransitions(p, { type: 'slideup', seconds: 0.333 });
    expect(all.plan.clips.map((c) => c.transition)).toEqual(
      Array.from({ length: 3 }, () => ({ type: 'slideup', seconds: 0.33 })),
    );
  });
});

describe('textos: colocar, escalar, duplicar y estilos prediseñados', () => {
  it('un texto nuevo dura 2,5 s aunque el cabezal esté al final (se adelanta para caber)', () => {
    const p = addClip(emptyProject(fundido), asset('a.jpg', 'image'), fundido);
    const style = templateTextStyle(fundido);
    expect(addText(p, fundido, 1, style, 8).plan.texts[0]).toMatchObject({ start: 1, end: 1 + NEW_TEXT_SECONDS });
    expect(addText(p, fundido, 7.9, style, 8).plan.texts[0]).toMatchObject({ start: 5.5, end: 8 });
    // En un reel más corto que eso, dura lo que el reel.
    expect(addText(p, fundido, 1.4, style, 1.5).plan.texts[0]).toMatchObject({ start: 0, end: 1.5 });
  });

  it('colocar y escalar guardan el desplazamiento y el tamaño dentro de sus límites; en su sitio, sin campo', () => {
    const p = sample();
    expect(setTextOffset(p, 't1', { x: 0.1234, y: -0.2 }).plan.texts[0]!.offset).toEqual({ x: 0.123, y: -0.2 });
    expect(setTextOffset(p, 't1', { x: 2, y: -2 }).plan.texts[0]!.offset).toEqual({ x: 0.5, y: -0.5 });
    const back = setTextOffset(setTextOffset(p, 't1', { x: 0.1, y: 0.1 }), 't1', { x: 0, y: 0 });
    expect(back.plan.texts[0]).not.toHaveProperty('offset');
    expect(setTextSize(p, 't1', 0.5).plan.texts[0]!.style.sizeRatio).toBe(0.15);
    expect(setTextSize(p, 't1', 0.001).plan.texts[0]!.style.sizeRatio).toBe(0.02);
    expect(() => finalizeProject(setTextOffset(p, 't1', { x: 0.1, y: 0.1 }))).not.toThrow();
  });

  it('las guías de centro atraen al texto cuando pasa cerca', () => {
    const text = sample().plan.texts[0]!;
    const rest = textBox(text).restCenterY;
    const near = snapOffset({ x: 0.01, y: 0.5 - rest + 0.008 }, rest);
    expect(near).toEqual({ offset: { x: 0, y: 0.5 - rest }, vertical: true, horizontal: true });
    const far = snapOffset({ x: 0.2, y: 0.3 }, 0.1);
    expect(far).toEqual({ offset: { x: 0.2, y: 0.3 }, vertical: false, horizontal: false });
    // La caja sigue al desplazamiento.
    const moved = textBox({ ...text, offset: { x: 0.25, y: 0 } });
    expect(moved.left - textBox(text).left).toBeCloseTo(90, 5);
  });

  it('duplicar copia el texto un poco más abajo, con otro identificador', () => {
    const copy = duplicateText(sample(), 't1');
    expect(copy.plan.texts).toHaveLength(2);
    expect(copy.plan.texts[1]).toMatchObject({ id: 't2', text: 'Texto', offset: { x: 0, y: 0.08 } });
    expect(duplicateText(sample(), 'no-existe').plan.texts).toHaveLength(1);
  });

  it('los cuatro estilos prediseñados dejan un texto válido para el trabajador, conservan su color y se reconocen', () => {
    const p = sample();
    const base = p.plan.texts[0]!;
    for (const preset of TEXT_PRESETS) {
      const styled = applyTextPreset(setTextOffset(p, 't1', { x: 0.2, y: 0.2 }), 't1', preset, '#C2410C');
      const text = styled.plan.texts[0]!;
      expect(presetOf(text)).toBe(preset);
      expect(text.style.color).toBe(base.style.color);
      expect(text.text).toBe(base.text);
      // Vuelve a su sitio y lleva su animación.
      expect(text).not.toHaveProperty('offset');
      expect(text.animation).toBeDefined();
      expect(projectSchema.safeParse(JSON.parse(JSON.stringify(styled))).success).toBe(true);
    }
    // El precio va sobre una franja del color de acento de la marca; sin acento, negra.
    expect(withTextPreset(base, 'price', '#c2410c').style.box).toMatchObject({ color: '#C2410C', opacity: 1 });
    expect(withTextPreset(base, 'price').style.box).toMatchObject({ color: '#000000' });
    expect(withTextPreset(base, 'headline').style).toMatchObject({ box: null, sizeRatio: 0.095 });
  });
});

describe('barra de herramientas según lo elegido', () => {
  const context = (patch: Partial<BarContext> = {}): BarContext => ({
    project: sample(),
    selection: null,
    readOnly: false,
    canSplit: true,
    hasBrandTemplates: true,
    hasRenders: false,
    full: false,
    ...patch,
  });
  const labels = (c: BarContext) => contextActions(c).map((a) => a.label);

  it('sin nada elegido ofrece lo que se puede añadir', () => {
    expect(labels(context())).toEqual(['Añadir', 'Texto', 'Música', 'Estilo', 'Plantilla', 'Subtítulos', 'Portada']);
    expect(contextActions(context({ hasBrandTemplates: false })).find((a) => a.id === 'template')).toMatchObject({
      disabled: true,
    });
    expect(labels(context({ hasRenders: true }))).toContain('Montajes');
  });

  it('con un clip elegido: dividir, recortar, velocidad, volumen, silenciar, filtro, sustituir, duplicar y borrar', () => {
    const clip = context({ selection: { kind: 'clip', id: 'c2' } });
    expect(barKind(clip.project, clip.selection)).toBe('clip');
    expect(labels(clip)).toEqual([
      'Dividir',
      'Recortar',
      'Velocidad',
      'Volumen',
      // El estilo de partida silencia los clips: el botón ofrece devolverle el sonido.
      'Con sonido',
      'Filtro',
      'Sustituir',
      'Duplicar',
      'Subtítulos',
      'Borrar',
    ]);
    // Una foto no tiene velocidad ni volumen: tiene movimiento de cámara.
    expect(labels(context({ selection: { kind: 'clip', id: 'c1' } }))).toEqual([
      'Dividir',
      'Recortar',
      'Movimiento',
      'Filtro',
      'Sustituir',
      'Duplicar',
      'Borrar',
    ]);
    const blocked = contextActions(context({ selection: { kind: 'clip', id: 'c2' }, canSplit: false, full: true }));
    expect(blocked.find((a) => a.id === 'split')).toMatchObject({ disabled: true });
    expect(blocked.find((a) => a.id === 'duplicate')).toMatchObject({ disabled: true });
  });

  it('con un texto: editar, estilo, animación, duración, duplicar y borrar; con la música y una transición, lo suyo', () => {
    expect(labels(context({ selection: { kind: 'text', id: 't1' } }))).toEqual([
      'Editar',
      'Estilo',
      'Animación',
      'Duración',
      'Duplicar',
      'Borrar',
    ]);
    const music = { path: 'o/m/media/m.m4a', startAt: 0, volume: 0.3, fadeInSeconds: 0, fadeOutSeconds: 0 };
    const withMusic = { ...sample(), plan: { ...sample().plan, music } };
    expect(labels(context({ project: withMusic, selection: { kind: 'music' } }))).toEqual([
      'Volumen',
      'Al ritmo',
      'Cambiar',
      'Quitar',
    ]);
    expect(labels(context({ selection: { kind: 'transition', id: 'c2' } }))).toEqual(['Transición']);
    // Lo elegido que ya no existe cuenta como nada elegido.
    expect(barKind(sample(), { kind: 'clip', id: 'borrado' })).toBe('none');
  });

  it('en solo lectura solo quedan los paneles que se pueden mirar', () => {
    const actions = contextActions(context({ selection: { kind: 'clip', id: 'c2' }, readOnly: true }));
    expect(actions.every((a) => a.panel)).toBe(true);
    expect(actions.map((a) => a.id)).not.toContain('delete');
  });

  it('la transición de un corte se puede elegir; la del primer elemento no existe', () => {
    const state = initEditor(sample());
    const chosen = editorReducer(state, { type: 'select', selection: { kind: 'transition', id: 'c2' } });
    expect(chosen.selection).toEqual({ kind: 'transition', id: 'c2' });
    expect(editorReducer(state, { type: 'select', selection: { kind: 'transition', id: 'c1' } }).selection).toBeNull();
  });
});

describe('borrador automático', () => {
  it('se lee tal cual estaba: sin clips todavía o con un texto vacío', () => {
    const empty = emptyProject(fundido);
    expect(parseDraftProject(JSON.parse(JSON.stringify(empty)))).toEqual(empty);
    const p = sample();
    const halfway = { ...p, plan: { ...p.plan, texts: [{ ...p.plan.texts[0]!, text: '' }] } };
    // Como versión no vale (un texto vacío), como borrador sí.
    expect(projectSchema.safeParse(JSON.parse(JSON.stringify(halfway))).success).toBe(false);
    expect(parseDraftProject(JSON.parse(JSON.stringify(halfway)))?.plan.texts[0]!.text).toBe('');
    // Lo nuevo (velocidad, filtro, desplazamiento) viaja en el borrador.
    const pro = setTextOffset(setClipSpeed(p, 'c2', 2), 't1', { x: 0.1, y: 0.1 });
    expect(parseDraftProject(JSON.parse(JSON.stringify(pro)))).toEqual(pro);
  });

  it('lo que no es un montaje de reel, o no se podría abrir, no se usa', () => {
    expect(parseDraftProject(null)).toBeNull();
    expect(parseDraftProject({ kind: 'otro' })).toBeNull();
    expect(parseDraftProject({ kind: 'reel', template: { id: 'x' }, plan: { version: 2 } })).toBeNull();
    const broken = { ...sample(), plan: { ...sample().plan, clips: [{ id: 'c1', type: 'video', path: 'o/m/a/x.mp4' }] } };
    expect(parseDraftProject(JSON.parse(JSON.stringify(broken)))).toBeNull();
  });
});

describe('cabezal, miniaturas y onda', () => {
  it('el reloj avisa a quien lo sigue, sin repetir el mismo valor', () => {
    const clock = createClock(1);
    const listener = vi.fn();
    const stop = clock.subscribe(listener);
    clock.set(1);
    expect(listener).not.toHaveBeenCalled();
    clock.set(2.5);
    clock.set(Number.NaN);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.get()).toBe(2.5);
    stop();
    clock.set(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('los fotogramas se piden por medios segundos del archivo, así que sirven a cualquier zoom', () => {
    expect(frameTime(1.26)).toBe(1.5);
    expect(frameKey('o/m/a.mp4', 1.26)).toBe('o/m/a.mp4@1.5');
    // Cuatro casillas sobre el tramo 2–6 s: el centro de cada una.
    expect(stripTimes(2, 6, 4)).toEqual([2.5, 3.5, 4.5, 5.5]);
    // Al ampliar (más casillas) se reutilizan los mismos fotogramas.
    expect(new Set(stripTimes(2, 6, 16)).size).toBeLessThanOrEqual(9);
    expect(stripTimes(0, 0, 0)).toEqual([0]);
  });

  it('la onda son los picos de la canción, y sigue a la música cuando se repite', () => {
    const samples = new Float32Array(1000);
    for (let i = 500; i < 750; i += 1) samples[i] = i % 2 ? 0.5 : -0.5;
    for (let i = 750; i < 1000; i += 1) samples[i] = i % 2 ? 0.25 : -0.25;
    const peaks = computePeaks(samples, 4);
    expect([...peaks]).toEqual([0, 0, 1, 0.5]);
    const wave = { peaks, duration: 4 };
    expect(peakAt(wave, 0, 2.5)).toBe(1);
    // Empezando en el segundo 2 de la canción, el segundo 0 del reel cae en su tercer tramo.
    expect(peakAt(wave, 2, 0.5)).toBe(1);
    // Pasado el final, la canción vuelve a empezar.
    expect(peakAt(wave, 0, 6.5)).toBe(1);
    expect(peakAt({ peaks: new Float32Array(0), duration: 0 }, 0, 1)).toBe(0);
    expect([...computePeaks(new Float32Array(8), 2)]).toEqual([0, 0]);
  });
});
