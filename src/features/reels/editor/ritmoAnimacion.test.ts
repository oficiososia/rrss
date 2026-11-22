import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REEL_TEMPLATES } from '../templates';
import { textAnimState, type TextAnimation } from './animation';
import { frameAt, photoTransform } from './compose';
import { addClip, addText, setCover, setMusic, setTextAnimation, updateClip } from './ops';
import { emptyProject, finalizeProject, planTimeline, projectProblems, templateTextStyle, type ReelProject } from './project';
import { autoBeatsPerCut, detectBeats, fitCutsToBeats } from './rhythm';

const fundido = REEL_TEMPLATES.find((t) => t.id === 'fundido-suave')!;
const asset = (id: string, kind: 'image' | 'video', ms: number | null = null) => ({
  id,
  kind,
  storage_path: `o/m/media/${id}`,
  file_name: id,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  duration_ms: ms,
});

describe('animaciones de texto: la misma cuenta que el trabajador', () => {
  interface Case {
    animation?: TextAnimation;
    fadeSeconds: number;
    start: number;
    end: number;
    chars: number;
    samples: Array<{ t: number; state: Record<string, number> }>;
  }
  // Ejemplo compartido con worker/tests/reel-animation.test.ts.
  const cases = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'worker/tests/fixtures/text-animation.json'), 'utf8'),
  ) as Case[];

  it('da los mismos números que el ejemplo compartido', () => {
    for (const c of cases) {
      for (const sample of c.samples) {
        const state = textAnimState(c.animation, { fadeSeconds: c.fadeSeconds }, sample.t, c.start, c.end, c.chars);
        for (const [key, value] of Object.entries(sample.state)) {
          expect(Number((state as unknown as Record<string, number>)[key]!.toFixed(5)), `${key} en ${sample.t}`).toBe(value);
        }
      }
    }
  });

  it('la vista previa dibuja el texto animado: máquina de escribir a la izquierda y letras que crecen', () => {
    let p: ReelProject = addClip(emptyProject(fundido), asset('a.jpg', 'image'), fundido);
    p = addText(p, fundido, 0, templateTextStyle(fundido), 2.5);
    const id = p.plan.texts[0]!.id;
    p = { ...p, plan: { ...p.plan, texts: [{ ...p.plan.texts[0]!, text: 'Hola mundo', end: 2.4 }] } };
    p = setTextAnimation(p, id, { in: 'typewriter', out: 'none', seconds: 1 });
    const timeline = planTimeline(p.plan.clips, fundido);
    const size = { width: 360, height: 640 };
    const early = frameAt(0.3, p.plan, timeline, fundido, size).texts[0]!;
    const late = frameAt(1.5, p.plan, timeline, fundido, size).texts[0]!;
    expect(early.typewriter).toBe(true);
    expect(early.lines.join('').length).toBeLessThan(late.lines.join('').length);
    expect(late.lines.join(' ')).toBe('Hola mundo');
    // Subir: más abajo al principio.
    p = setTextAnimation(p, id, { in: 'rise', out: 'fall', seconds: 0.6 });
    expect(frameAt(0.1, p.plan, timeline, fundido, size).texts[0]!.dy).toBeGreaterThan(0.02);
    expect(frameAt(1.2, p.plan, timeline, fundido, size).texts[0]!.dy).toBe(0);
    // Quitar la animación vuelve al fundido.
    expect(setTextAnimation(p, id, undefined).plan.texts[0]).not.toHaveProperty('animation');
  });

  it('subir y bajar la cámara de una foto recorren la altura', () => {
    expect(photoTransform('pan-up', 0.1, 0)).toMatchObject({ panY: 1, panX: 0.5, zoom: 1.1 });
    expect(photoTransform('pan-up', 0.1, 1).panY).toBe(0);
    expect(photoTransform('pan-down', 0.1, 1).panY).toBe(1);
  });
});

describe('portada y movimientos en el proyecto', () => {
  const base = () => {
    let p = addClip(emptyProject(fundido), asset('a.jpg', 'image'), fundido);
    p = addClip(p, asset('b.mp4', 'video', 6000), fundido);
    return p;
  };

  it('se guarda la portada, la animación y la intensidad, y se validan', () => {
    let p = setCover(base(), { type: 'frame', at: 1.5 });
    p = updateClip(p, 'c1', { motion: 'pan-down', motionAmount: 0.15 });
    p = addText(p, fundido, 0, templateTextStyle(fundido), 5);
    p = setTextAnimation(p, p.plan.texts[0]!.id, { in: 'zoom', out: 'slide' });
    const ready = finalizeProject(p);
    expect(ready.plan.cover).toEqual({ type: 'frame', at: 1.5 });
    expect(ready.plan.clips[0]).toMatchObject({ motion: 'pan-down', motionAmount: 0.15 });
    expect(ready.plan.texts[0]!.animation).toEqual({ in: 'zoom', out: 'slide' });
    expect(() => finalizeProject(setCover(base(), { type: 'frame', at: 500 }))).toThrow();
    expect(setCover(p, undefined).plan).not.toHaveProperty('cover');
  });

  it('avisa de una portada fuera del vídeo o de una foto que ya no está', () => {
    const late = projectProblems(setCover(base(), { type: 'frame', at: 80 }), fundido);
    expect(late.join(' ')).toMatch(/portada/i);
    const gone = projectProblems(setCover(base(), { type: 'photo', path: 'o/m/media/otra.jpg' }), fundido);
    expect(gone.join(' ')).toMatch(/portada/i);
    expect(projectProblems(setCover(base(), { type: 'photo', path: 'o/m/media/a.jpg' }), fundido)).toEqual([]);
  });
});

// ───────────────────────────── Ritmo ─────────────────────────────

/** Señal con un golpe seco cada `period` segundos, empezando en `offset`. */
function clickTrack(bpm: number, seconds: number, offset: number, rate = 22050): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * rate));
  const period = 60 / bpm;
  for (let t = offset; t < seconds; t += period) {
    const at = Math.round(t * rate);
    for (let i = 0; i < 400 && at + i < samples.length; i += 1) {
      samples[at + i] = Math.sin((2 * Math.PI * 900 * i) / rate) * Math.exp(-i / 90);
    }
  }
  // Un poco de ruido para que no sea un caso de laboratorio.
  for (let i = 0; i < samples.length; i += 1) samples[i] = samples[i]! + (Math.sin(i * 12.9898) * 0.003);
  return samples;
}

describe('detectar el compás', () => {
  it('encuentra el tempo y los golpes de una pista a 120 pulsaciones', () => {
    const result = detectBeats(clickTrack(120, 16, 0.25), 22050);
    expect(result.bpm).toBeGreaterThan(117);
    expect(result.bpm).toBeLessThan(123);
    expect(result.confidence).toBeGreaterThan(0.25);
    // Los golpes caen cada 0,5 s, desfasados 0,25 s, con holgura de dos ventanas (24 ms).
    const near = (t: number) => Math.min(...result.beats.map((b) => Math.abs(b - t)));
    for (const t of [0.25, 1.25, 4.25, 9.75]) expect(near(t)).toBeLessThan(0.05);
  });

  it('distingue otro tempo (90 pulsaciones) y no inventa golpes en el silencio', () => {
    const slow = detectBeats(clickTrack(90, 20, 0.1), 22050);
    expect(Math.abs(slow.bpm - 90)).toBeLessThan(4);
    expect(detectBeats(new Float32Array(22050 * 10), 22050)).toEqual({ bpm: 0, beats: [], confidence: 0 });
  });

  it('elige cada cuántos golpes cortar según el ritmo de ahora', () => {
    expect(autoBeatsPerCut(0.5, 0.5)).toBe(1);
    expect(autoBeatsPerCut(2.4, 0.5)).toBe(4);
    expect(autoBeatsPerCut(1, 0.5)).toBe(2);
  });
});

describe('ajustar los cortes a la música', () => {
  const beats = Array.from({ length: 60 }, (_, i) => Number((0.25 + i * 0.5).toFixed(3)));
  const project = (): ReelProject => {
    let p = emptyProject(fundido);
    p = addClip(p, asset('a.jpg', 'image'), fundido);
    p = addClip(p, asset('b.mp4', 'video', 10_000), fundido);
    p = addClip(p, asset('c.jpg', 'image'), fundido);
    p = addClip(p, asset('d.jpg', 'image'), fundido);
    return setMusic(p, 'o/m/media/musica.m4a', fundido);
  };

  /** Instantes de corte (centro de cada transición) de un proyecto. */
  const cutsOf = (p: ReelProject, fileSeconds: (path: string) => number | null = () => null) => {
    const t = planTimeline(p.plan.clips, fundido, (c) => fileSeconds(c.path));
    return p.plan.clips.slice(1).map((_, i) => Number((t.starts[i + 1]! + t.transitions[i + 1]! / 2).toFixed(2)));
  };

  it('deja cada corte en un golpe y es una función pura (deshacer = el proyecto de antes)', () => {
    const before = project();
    const snapshot = JSON.stringify(before);
    const result = fitCutsToBeats(before, fundido, { bpm: 120, beats }, { beatsPerCut: 4, fileSeconds: () => 10 })!;
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(result.beatsPerCut).toBe(4);
    expect(result.short).toEqual([]);
    const cuts = cutsOf(result.project, () => 10);
    for (const cut of cuts) {
      const off = Math.min(...beats.map((b) => Math.abs(b - cut)));
      expect(off, `corte en ${cut}`).toBeLessThan(0.07);
    }
    // En orden y sin que ninguna pieza quede por debajo de 0,5 s.
    cuts.forEach((c, i) => expect(c).toBeGreaterThan(i === 0 ? 0 : cuts[i - 1]!));
    const timeline = planTimeline(result.project.plan.clips, fundido, () => 10);
    expect(Math.min(...timeline.durations)).toBeGreaterThanOrEqual(0.5);
    // El orden de los clips no cambia.
    expect(result.project.plan.clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('el clip de vídeo cambia de salida y no de entrada, y respeta lo que dura su archivo', () => {
    const p = project();
    const ok = fitCutsToBeats(p, fundido, { bpm: 120, beats }, { beatsPerCut: 4, fileSeconds: () => 10 })!;
    const video = ok.project.plan.clips[1]!;
    expect(video).toMatchObject({ type: 'video', in: 0 });
    // Con un archivo de 1,2 s no puede llegar a su golpe: se avisa y se queda con lo que hay.
    const short = fitCutsToBeats(p, fundido, { bpm: 120, beats }, { beatsPerCut: 4, fileSeconds: () => 1.2 })!;
    expect(short.short).toContain(2);
    expect((short.project.plan.clips[1] as { out: number }).out).toBeLessThanOrEqual(1.2);
  });

  it('no hace nada sin música o sin golpes', () => {
    const noMusic = { ...project(), plan: { ...project().plan, music: undefined } };
    expect(fitCutsToBeats(noMusic, fundido, { bpm: 120, beats })).toBeNull();
    expect(fitCutsToBeats(project(), fundido, { bpm: 120, beats: [1] })).toBeNull();
  });
});
