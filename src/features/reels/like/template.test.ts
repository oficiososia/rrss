import { describe, expect, it } from 'vitest';
import {
  buildReelLikeResult,
  parseMeasurement,
  type ReelLikeAiOutput,
} from '../../../../supabase/functions/_shared/reels/like';
import type { SourceAsset } from '../editor/ops';
import { finalizeProject } from '../editor/project';
import {
  buildReelFromTemplate,
  describeNeeds,
  validateReelTemplate,
  validateReelTemplatesDelivery,
} from '../reelTemplate';
import { REEL_TEMPLATES } from '../templates';
import { templateKey, toReelTemplate } from './template';

// «Guardar como plantilla»: la estructura de un análisis pasa al formato
// compartido de plantillas de reel por marca (`rrss.reel-template`), el mismo
// del catálogo de la agencia y de «Empieza tu reel».

const STYLE_IDS = REEL_TEMPLATES.map((t) => t.id);
const style = (id: string) => REEL_TEMPLATES.find((t) => t.id === id)!;

const measurement = (shots: Array<{ seconds: number; still?: boolean; fade?: number }>, bpm: number | null = 120) =>
  parseMeasurement({
    source: { kind: 'upload', durationSeconds: shots.reduce((s, x) => s + x.seconds, 0), width: 540, height: 960, fps: 30, hasAudio: true },
    shots: shots.map((shot, index) => ({
      index,
      start: 0,
      seconds: shot.seconds,
      motion: shot.still ? 0 : 1,
      still: shot.still === true,
      ...(index > 0 ? { transitionIn: shot.fade ? { type: 'fade', seconds: shot.fade } : { type: 'cut', seconds: 0 } } : {}),
    })),
    frames: [],
    audio: { present: true, silent: bpm === null && false, bpm, confidence: 0.8, cutsOnBeat: 0.67, beatsPerCut: 4, speech: [] },
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
    { index: 1, kind: 'detalle', media: 'video', description: 'Plano cerrado del producto', what: 'La hogaza recién salida', tip: 'Luz de ventana', search: ['pan'] },
    { index: 2, kind: 'general', media: 'foto', description: 'El local', what: 'El obrador entero', tip: '', search: ['obrador'] },
    { index: 3, kind: 'persona', media: 'video', description: 'Alguien trabajando', what: 'Amasando a mano', tip: 'Plano medio', search: ['equipo'] },
    { index: 4, kind: 'texto', media: 'foto', description: '', what: 'El escaparate con el horario', tip: '', search: [] },
  ],
  texts: [
    { role: 'gancho', position: 'top', size: 'grande', fromShot: 1, toShot: 1, value: 'El pan de los sábados' },
    { role: 'paso', position: 'bottom', size: 'normal', fromShot: 2, toShot: 3, value: 'Masa madre y paciencia' },
    { role: 'llamada', position: 'center', size: 'pequeno', fromShot: 4, toShot: 4, value: 'Te esperamos' },
  ],
  hook: 'El pan de los sábados',
  caption: 'Hecho hoy.',
  hashtags: [],
  coverShot: 3,
  coverNote: 'Las manos en la masa',
};
const result = buildReelLikeResult(
  measurement([{ seconds: 2 }, { seconds: 1.5, still: true }, { seconds: 2.25 }, { seconds: 1.75, still: true, fade: 0.5 }]),
  ai,
  { transcriptUsed: false },
);
const options = { styles: REEL_TEMPLATES, origin: { kind: 'link' as const, host: 'www.instagram.com' } };

describe('de la estructura de un análisis a una plantilla de reel de la marca', () => {
  it('sale un documento válido del formato compartido, con planos, textos, ritmo y portada', () => {
    const template = toReelTemplate(result, options);
    expect(validateReelTemplate(template, STYLE_IDS)).toEqual({ ok: true, template });
    expect(template).toMatchObject({
      kind: 'rrss.reel-template',
      schemaVersion: 1,
      purpose: 'Promete algo y lo cumple en dos pasos.',
      whenToUse: 'Cuando quieras repetir esta estructura: 4 planos en 7,5 s, ritmo medio.',
      material: '4 fotos o clips, en este orden: plano cerrado del producto, el local, alguien trabajando, texto.',
      // Casi todo cortes: se monta sobre el estilo de cortes secos.
      style: { id: 'corte-ritmico' },
    });
    // Planos: duración y transición medidas; tipo de plano y de material, de lo que vio el modelo.
    expect(template.slots).toEqual([
      { id: 's1', label: 'Plano cerrado del producto', hint: 'Luz de ventana', kind: 'video', shot: 'detail', seconds: 2 },
      { id: 's2', label: 'El local', hint: 'El obrador entero', kind: 'photo', shot: 'wide', seconds: 1.5, transition: { type: 'cut', seconds: 0 } },
      { id: 's3', label: 'Alguien trabajando', hint: 'Plano medio', kind: 'video', shot: 'person', seconds: 2.25, transition: { type: 'cut', seconds: 0 } },
      { id: 's4', label: 'Texto', hint: 'El escaparate con el horario', kind: 'photo', shot: 'text', seconds: 1.75, transition: { type: 'fade', seconds: 0.5 } },
    ]);
    // Textos de muestra: los de la MARCA, con su papel, su plano, su posición y su tamaño.
    expect(template.texts).toEqual([
      { id: 't1', role: 'hook', text: 'El pan de los sábados', from: 's1', position: 'top', style: { sizeRatio: 0.085 } },
      { id: 't2', role: 'step', text: 'Masa madre y paciencia', from: 's2', to: 's3', position: 'bottom', style: { sizeRatio: 0.06 } },
      { id: 't3', role: 'cta', text: 'Te esperamos', from: 's4', position: 'center', style: { sizeRatio: 0.045 } },
    ]);
    // El compás medido, como sugerencia escrita: la plantilla no lleva ninguna canción.
    expect(template.music).toEqual({
      suggestion: 'Música con ritmo medio, de unas 120 pulsaciones por minuto. Elige una canción con licencia para la marca.',
      bpm: { min: 115, max: 125 },
      cutsOnBeat: true,
    });
    // Portada: el plano 3, a 60 % de su duración.
    expect(template.cover).toEqual({ slot: 's3', offset: 1.35 });
    // Del vídeo de referencia solo se anota de qué sitio venía: ni su dirección ni un archivo.
    expect(template.origin).toEqual({
      note: 'Sacada de un vídeo de referencia (enlace de www.instagram.com) con «Hacer un reel como este».',
    });
    expect(JSON.stringify(template)).not.toMatch(/"(path|fontPath|url)"\s*:/);
    expect(describeNeeds(template)).toBe('4 fotos o clips · unos 7,5 s');
  });

  it('vale para entregarla y para montar otro reel desde «Empieza tu reel»', () => {
    const template = toReelTemplate(result, { styles: REEL_TEMPLATES, origin: { kind: 'upload' } });
    expect(template.origin).toEqual({ note: 'Sacada de un vídeo de referencia con «Hacer un reel como este».' });
    const delivery = validateReelTemplatesDelivery(
      {
        format: 'rrss.agency-reel-templates',
        version: 1,
        templates: [{ key: templateKey('Gancho + 2 pasos', 'abc12345'), name: 'Gancho + 2 pasos', document: template }],
      },
      STYLE_IDS,
    );
    expect(delivery.ok).toBe(true);
    const asset = (n: number, kind: 'image' | 'video'): SourceAsset => ({
      id: `a${n}`,
      kind,
      storage_path: `org/marca/media/${n}`,
      file_name: `${n}`,
      mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
      duration_ms: kind === 'video' ? 9000 : null,
    });
    const project = buildReelFromTemplate(
      template,
      [asset(1, 'video'), asset(2, 'image'), asset(3, 'video'), asset(4, 'image')],
      style(template.style.id),
    );
    expect(project.plan.clips.map((c) => (c.type === 'photo' ? c.seconds : c.out - c.in))).toEqual([2, 1.5, 2.25, 1.75]);
    expect(project.plan.clips[3]!.transition).toEqual({ type: 'fade', seconds: 0.5 });
    expect(project.plan.texts.map((t) => t.text)).toEqual(['El pan de los sábados', 'Masa madre y paciencia', 'Te esperamos']);
    expect(project.plan.texts[0]!.style.sizeRatio).toBe(0.085);
    expect(() => finalizeProject(project)).not.toThrow();
  });

  it('una referencia más larga que un reel se queda en los planos que caben, con sus textos y su portada', () => {
    const long = buildReelLikeResult(
      measurement(
        Array.from({ length: 12 }, () => ({ seconds: 10, still: true, fade: 0.4 })),
        null,
      ),
      {
        ...ai,
        audioKind: 'voz',
        shots: [],
        texts: [
          { role: 'gancho', position: 'top', size: 'grande', fromShot: 1, toShot: 12, value: 'De principio a fin' },
          { role: 'llamada', position: 'center', size: 'normal', fromShot: 12, toShot: 12, value: 'Fin' },
        ],
        coverShot: 12,
      },
      { transcriptUsed: true },
    );
    const template = toReelTemplate(long, { styles: REEL_TEMPLATES });
    expect(template.slots).toHaveLength(9);
    expect(template.slots.reduce((sum, slot) => sum + slot.seconds, 0)).toBe(90);
    // Mayoría de transiciones suaves: estilo de fundidos. Sin lo que vio el modelo, el plano se llama por su tipo.
    expect(template.style.id).toBe('fundido-suave');
    expect(template.slots[0]).toMatchObject({ label: 'General', kind: 'photo', shot: 'wide' });
    expect(template.slots[0]!.hint).toBe('Plano 1 (general)');
    // El texto que cubría todo acaba en el último plano que queda; el del plano 12 no entra.
    expect(template.texts).toEqual([
      { id: 't1', role: 'hook', text: 'De principio a fin', from: 's1', to: 's9', position: 'top', style: { sizeRatio: 0.085 } },
    ]);
    expect(template.cover).toEqual({ slot: 's9', offset: 10 });
    // Con voz y sin compás claro: sugerencia sin pulsaciones.
    expect(template.music).toEqual({
      suggestion: 'La referencia va con voz: graba una voz en off o deja el sonido de los clips.',
    });
    expect(validateReelTemplate(template, STYLE_IDS).ok).toBe(true);
  });

  it('un vídeo sin sonido no sugiere música, y la clave no pisa otra plantilla', () => {
    const silent = measurement([{ seconds: 3 }], null);
    const mute = buildReelLikeResult({ ...silent, audio: { ...silent.audio, present: false, silent: true } }, { ...ai, shots: [], texts: [], coverShot: 1 }, { transcriptUsed: false });
    const template = toReelTemplate(mute, { styles: REEL_TEMPLATES });
    expect(template.music).toBeUndefined();
    expect(template.texts).toEqual([]);
    expect(template.material).toBe('1 foto o clip, en este orden: general.');

    expect(templateKey('Gancho + 3 pasos (versión Ñ)', 'ab12cd34')).toBe('ref-gancho-3-pasos-version-n-ab12cd34');
    expect(templateKey('¡¡¡', 'AB-12')).toBe('ref-reel-ab12');
    expect(templateKey('x'.repeat(200), 'ab12cd34')).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
    expect(templateKey('Mi plantilla')).not.toBe(templateKey('Mi plantilla'));
  });
});
