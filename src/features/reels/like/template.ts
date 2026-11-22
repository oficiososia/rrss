// «Guardar como plantilla»: de la estructura de un análisis a una PLANTILLA DE
// REEL DE LA MARCA en el formato compartido (`rrss.reel-template`,
// src/features/reels/reelTemplate.ts), el mismo del catálogo de la agencia y
// del paso «Empieza tu reel» del editor. Se entrega con
// `deliver_reel_templates(…, 'reference')`.
//
// La plantilla lleva la estructura (planos con su duración, tipo y transición;
// textos con su plano, posición y tamaño; ritmo como sugerencia de música;
// portada) y, como textos de muestra, los que ya se escribieron PARA LA MARCA.
// Del vídeo de referencia no lleva nada: ni archivos, ni frases, ni su enlace
// (solo se anota de qué sitio venía).
//
// Todo es puro: sin red ni React.
import {
  AUDIO_KIND_LABEL,
  PACE_LABEL,
  SHOT_KIND_LABEL,
  type ReelLikeResult,
  type ShotKind,
  type TextRole as LikeTextRole,
  type TextSize,
} from '../../../../supabase/functions/_shared/reels/like';
import { MAX_CLIP_SEGMENT_SECONDS, MIN_SEGMENT_SECONDS, REEL_MAX_CLIPS, REEL_MAX_SECONDS } from '../editor/project';
import {
  REEL_TEMPLATE_KIND,
  REEL_TEMPLATE_SCHEMA_VERSION,
  validateReelTemplate,
  type ReelTemplate,
  type ReelTemplateInput,
  type SlotShot,
  type TextRole,
} from '../reelTemplate';
import type { ReelTemplateSummary } from '../templates';
import { baseTemplate } from './draft';

/** Nombre de una plantilla de reel de la marca: hasta 80 caracteres (el tope de la tabla). */
export const TEMPLATE_NAME_MAX = 80;

const SHOT: Record<ShotKind, SlotShot> = { detalle: 'detail', general: 'wide', persona: 'person', texto: 'text' };
const ROLE: Record<LikeTextRole, TextRole> = { gancho: 'hook', dato: 'detail', paso: 'step', llamada: 'cta', otro: 'detail' };
const SIZE_RATIO: Record<TextSize, number> = { grande: 0.085, normal: 0.06, pequeno: 0.045 };

const round = (n: number, decimals = 2) => Number(n.toFixed(decimals));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const clip = (text: string, max: number) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return [...clean].length > max ? `${[...clean].slice(0, max - 1).join('').trimEnd()}…` : clean;
};
const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);

export interface TemplateOrigin {
  /** De dónde vino el vídeo de referencia: un archivo subido o un enlace (solo su dominio). */
  kind: 'upload' | 'link';
  host?: string | null;
}

/**
 * La plantilla de reel (formato compartido) de un análisis. Si la referencia es
 * más larga que un reel del editor, se queda con los planos que caben. Lanza si
 * lo que sale no pasa el validador compartido (no debería).
 */
export function toReelTemplate(
  result: ReelLikeResult,
  options: { styles: ReelTemplateSummary[]; origin?: TemplateOrigin },
): ReelTemplate {
  const structure = result.template;
  const style = baseTemplate(result, options.styles);

  // Planos: los que caben en un reel (90 s y 30 elementos).
  const slots: ReelTemplateInput['slots'] = [];
  const starts: number[] = [];
  let total = 0;
  for (const [index, shot] of structure.shots.entries()) {
    const seconds = round(clamp(shot.seconds, MIN_SEGMENT_SECONDS, MAX_CLIP_SEGMENT_SECONDS));
    if (slots.length >= REEL_MAX_CLIPS || total + seconds > REEL_MAX_SECONDS + 1e-6) break;
    const script = result.script.shots[index];
    const hint = clip(script?.tip || script?.what || '', 160);
    starts.push(total);
    total += seconds;
    slots.push({
      id: shot.id,
      label: clip(shot.description || SHOT_KIND_LABEL[shot.kind], 60),
      ...(hint ? { hint } : {}),
      kind: shot.media === 'foto' ? 'photo' : 'video',
      shot: SHOT[shot.kind],
      seconds,
      ...(index > 0
        ? {
            transition:
              shot.transition.type === 'fade'
                ? { type: 'fade' as const, seconds: round(clamp(shot.transition.seconds || 0.4, 0.1, 2)) }
                : { type: 'cut' as const, seconds: 0 },
          }
        : {}),
    });
  }
  const kept = new Set(slots.map((slot) => slot.id));
  const last = slots[slots.length - 1]!.id;

  // Textos de muestra: los escritos para la marca, anclados a su plano.
  const values = new Map(result.texts.onScreen.map((entry) => [entry.text, entry.value]));
  const texts: NonNullable<ReelTemplateInput['texts']> = [];
  for (const text of structure.texts) {
    const value = values.get(text.id);
    if (!value || !kept.has(text.fromShot)) continue;
    const to = kept.has(text.toShot) ? text.toShot : last;
    texts.push({
      id: text.id,
      role: ROLE[text.role],
      text: clip(value, 200),
      from: text.fromShot,
      ...(to !== text.fromShot ? { to } : {}),
      position: text.position,
      style: { sizeRatio: SIZE_RATIO[text.size] },
    });
  }

  // Ritmo: una sugerencia de música escrita (la plantilla nunca lleva una canción).
  const audio = structure.audio;
  const bpm = audio.bpm !== undefined ? Math.round(audio.bpm) : null;
  const music: ReelTemplateInput['music'] =
    audio.kind === 'silencio'
      ? undefined
      : {
          suggestion: clip(
            audio.kind === 'voz'
              ? 'La referencia va con voz: graba una voz en off o deja el sonido de los clips.'
              : `${AUDIO_KIND_LABEL[audio.kind]} con ritmo ${PACE_LABEL[structure.pace].toLowerCase()}${bpm ? `, de unas ${bpm} pulsaciones por minuto` : ''}. Elige una canción con licencia para la marca.`,
            300,
          ),
          ...(bpm ? { bpm: { min: clamp(bpm - 5, 40, 220), max: clamp(bpm + 5, 40, 220) } } : {}),
          ...(bpm ? { cutsOnBeat: (audio.cutsOnBeat ?? 0) >= 0.6 } : {}),
        };

  // Portada: el plano en el que cae su segundo.
  let coverIndex = 0;
  starts.forEach((start, index) => {
    if (start <= structure.cover.at + 1e-6) coverIndex = index;
  });
  const coverSlot = slots[coverIndex]!;
  const cover = {
    slot: coverSlot.id,
    offset: round(clamp(structure.cover.at - starts[coverIndex]!, 0, coverSlot.seconds)),
  };

  const count = slots.length === 1 ? '1 plano' : `${slots.length} planos`;
  const order = slots.map((slot) => slot.label.toLowerCase()).join(', ');
  const where =
    options.origin?.kind === 'link' && options.origin.host ? ` (enlace de ${options.origin.host})` : '';
  const document: ReelTemplateInput = {
    kind: REEL_TEMPLATE_KIND,
    schemaVersion: REEL_TEMPLATE_SCHEMA_VERSION,
    purpose: clip(structure.summary || `Reel de ${count} con la estructura de un vídeo de referencia.`, 200),
    whenToUse: clip(
      `Cuando quieras repetir esta estructura: ${count} en ${fmt(total)} s, ritmo ${PACE_LABEL[structure.pace].toLowerCase()}.`,
      240,
    ),
    material: clip(`${slots.length === 1 ? '1 foto o clip' : `${slots.length} fotos o clips`}, en este orden: ${order}.`, 240),
    style: { id: style.id },
    slots,
    texts,
    ...(music ? { music } : {}),
    cover,
    origin: { note: clip(`Sacada de un vídeo de referencia${where} con «Hacer un reel como este».`, 300) },
  };
  const checked = validateReelTemplate(
    document,
    options.styles.map((s) => s.id),
  );
  if (!checked.ok) {
    const issue = checked.issues[0];
    throw new Error(`La plantilla no se puede guardar (${issue?.path || 'raíz'}: ${issue?.message}).`);
  }
  return checked.template;
}

/**
 * Clave nueva para la plantilla: sale del nombre y lleva un sufijo propio, para
 * no pisar otra plantilla de la marca (entregar la misma clave la actualizaría).
 */
export function templateKey(name: string, suffix: string = crypto.randomUUID().slice(0, 8)): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
    .replace(/-+$/g, '');
  return `ref-${slug || 'reel'}-${suffix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'x'}`;
}
