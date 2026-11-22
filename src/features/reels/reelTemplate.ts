// Plantilla de reel con estructura: qué planos lleva, cuánto dura cada uno,
// qué textos salen y cuándo, con qué animación, y qué música le va. Es el
// formato COMPARTIDO de las plantillas de reel de una marca
// (`brand_reel_templates.document`): lo escribe el catálogo de la agencia
// (agency/catalogo), lo podrá escribir «un reel como este» (a partir de un
// vídeo de referencia) y lo lee el paso «Empieza tu reel» del editor.
//
// Una plantilla NO lleva archivos (ni fotos, ni clips, ni música): solo huecos
// (`slots`) que se rellenan con el material que elige la persona. Con N fotos o
// clips, `buildReelFromTemplate` devuelve un proyecto de reel normal (plan v2),
// que se edita y se monta como cualquier otro.
//
// Los «estilos» del trabajador (worker/templates/*.json: lienzo, exportación,
// volúmenes y estilo de texto por defecto) siguen siendo la base: cada
// plantilla dice sobre cuál se monta (`style.id`).
//
// Todo es puro (sin red, sin React, sin Vite): lo usan la aplicación y agency/.
import { z } from 'zod';
import type { ReelTemplateSummary } from './templates';
import type { SourceAsset } from './editor/ops';
import {
  MAX_CLIP_SEGMENT_SECONDS,
  MIN_SEGMENT_SECONDS,
  PHOTO_MOTIONS,
  PHOTO_SECONDS,
  PROJECT_KIND,
  REEL_MAX_CLIPS,
  REEL_MAX_SECONDS,
  REEL_MAX_TEXTS,
  REEL_PLAN_VERSION,
  REEL_TEXT_MAX_LENGTH,
  TEXT_POSITIONS,
  planTimeline,
  templateTextStyle,
  templateTransition,
  textAnimationSchema,
  transitionSchema,
  type Clip,
  type ReelProject,
  type ReelText,
  type TextStyle,
} from './editor/project';

export const REEL_TEMPLATE_KIND = 'rrss.reel-template';
export const REEL_TEMPLATE_SCHEMA_VERSION = 1;
/** Plantillas de reel por marca, como mucho (lo comprueba también la base de datos). */
export const MAX_BRAND_REEL_TEMPLATES = 60;
/** Plantillas por entrega (una llamada a `deliver_reel_templates`). */
export const MAX_REEL_TEMPLATES_PER_DELIVERY = 12;
export const REEL_TEMPLATE_SOURCES = ['catalog', 'reference', 'editor'] as const;
export type ReelTemplateSource = (typeof REEL_TEMPLATE_SOURCES)[number];

/** Qué material le va mejor a un hueco. Es una pista para quien elige: no obliga. */
export const SLOT_KINDS = ['any', 'photo', 'video'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
/** Papel de un texto: para que la interfaz diga qué es cada uno. */
export const TEXT_ROLES = ['hook', 'title', 'step', 'detail', 'cta'] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB');
const elementId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const line = (max: number) => z.string().trim().min(1).max(max);

/** Un hueco: un plano del reel, que se llena con una foto o un clip. */
export const reelSlotSchema = z
  .object({
    id: elementId,
    /** Qué va aquí, en dos o tres palabras: «Plato terminado». */
    label: line(60),
    /** Cómo grabarlo o qué foto elegir. */
    hint: z.string().trim().max(160).optional(),
    kind: z.enum(SLOT_KINDS).default('any'),
    /** Lo que dura el plano. Una foto no pasa de 10 s; un clip puede llegar a 60 s. */
    seconds: z.number().min(MIN_SEGMENT_SECONDS).max(MAX_CLIP_SEGMENT_SECONDS),
    /** Si falta material, este plano es de los que se quitan. */
    optional: z.literal(true).optional(),
    /** Movimiento de cámara si se llena con una foto (el del estilo si falta). */
    motion: z.enum(PHOTO_MOTIONS).optional(),
    motionAmount: z.number().min(0).max(0.3).optional(),
    /** Transición con la que entra (la del estilo si falta). */
    transition: transitionSchema.optional(),
    /** Sonido del clip, de 0 a 1 (el del estilo si falta). */
    volume: z.number().min(0).max(1).optional(),
  })
  .strict();
export type ReelSlot = z.infer<typeof reelSlotSchema>;

/** Lo que una plantilla puede cambiar del estilo de texto de su estilo base. Sin tipografía: es la de la marca. */
export const reelTemplateTextStyleSchema = z
  .object({
    sizeRatio: z.number().min(0.02).max(0.15),
    color: hexColor,
    marginRatio: z.number().min(0).max(0.4),
    maxWidthRatio: z.number().min(0.4).max(1),
    lineHeight: z.number().min(1).max(2),
    box: z
      .object({ color: hexColor, opacity: z.number().min(0).max(1), paddingRatio: z.number().min(0).max(1) })
      .strict()
      .nullable(),
    outline: z
      .object({ color: hexColor, widthRatio: z.number().min(0).max(0.2) })
      .strict()
      .nullable(),
    fadeSeconds: z.number().min(0).max(1),
  })
  .partial()
  .strict();

/** Un texto de muestra: quien usa la plantilla lo cambia por el suyo. */
export const reelTemplateTextSchema = z
  .object({
    id: elementId,
    role: z.enum(TEXT_ROLES).default('detail'),
    text: line(REEL_TEXT_MAX_LENGTH),
    /** Entra con este plano… */
    from: elementId,
    /** …tantos segundos después de que empiece (0 si falta)… */
    offset: z.number().min(0).max(MAX_CLIP_SEGMENT_SECONDS).optional(),
    /** …y sale con este (el mismo si falta)… */
    to: elementId.optional(),
    /** …tantos segundos antes de que acabe (0 o negativo). */
    endOffset: z.number().min(-MAX_CLIP_SEGMENT_SECONDS).max(0).optional(),
    position: z.enum(TEXT_POSITIONS),
    style: reelTemplateTextStyleSchema.optional(),
    animation: textAnimationSchema.optional(),
  })
  .strict();
export type ReelTemplateText = z.infer<typeof reelTemplateTextSchema>;

export const reelTemplateSchema = z
  .object({
    kind: z.literal(REEL_TEMPLATE_KIND),
    schemaVersion: z.literal(REEL_TEMPLATE_SCHEMA_VERSION),
    /** Para qué sirve, en una frase. */
    purpose: line(200),
    /** Cuándo usarla. */
    whenToUse: line(240),
    /** Qué material hace falta, dicho en claro: «4 a 6 fotos o clips: …». */
    material: line(240),
    /** Estilo del trabajador sobre el que se monta (worker/templates). */
    style: z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/) }).strict(),
    slots: z.array(reelSlotSchema).min(1).max(REEL_MAX_CLIPS),
    texts: z.array(reelTemplateTextSchema).max(REEL_MAX_TEXTS).default([]),
    /** Música que le va. Solo una sugerencia escrita: la plantilla nunca lleva una canción. */
    music: z
      .object({
        suggestion: line(300),
        /** Pulsaciones por minuto orientativas. */
        bpm: z
          .object({ min: z.number().int().min(40).max(220), max: z.number().int().min(40).max(220) })
          .strict()
          .refine((b) => b.max >= b.min, 'El máximo no puede ser menor que el mínimo')
          .optional(),
        /** Si los cortes piden ir al golpe de la música («Ajustar los cortes a la música»). */
        cutsOnBeat: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Portada: un fotograma del plano indicado. */
    cover: z
      .object({ slot: elementId, offset: z.number().min(0).max(MAX_CLIP_SEGMENT_SECONDS).optional() })
      .strict()
      .optional(),
    /** De dónde sale (un vídeo de referencia, un estudio…). Solo informa. */
    origin: z
      .object({
        note: z.string().trim().max(300).optional(),
        url: z
          .string()
          .url()
          .max(500)
          .regex(/^https:\/\//, 'Solo enlaces https')
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((template, ctx) => {
    const ids = new Set<string>();
    template.slots.forEach((slot, index) => {
      if (ids.has(slot.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', index, 'id'],
          message: 'Hay dos planos con el mismo identificador',
        });
      }
      ids.add(slot.id);
    });
    if (template.slots.every((slot) => slot.optional)) {
      ctx.addIssue({ code: 'custom', path: ['slots'], message: 'Al menos un plano no puede ser opcional' });
    }
    const total = template.slots.reduce((sum, slot) => sum + slot.seconds, 0);
    if (total > REEL_MAX_SECONDS) {
      ctx.addIssue({ code: 'custom', path: ['slots'], message: `La plantilla dura más de ${REEL_MAX_SECONDS} s` });
    }
    const order = new Map(template.slots.map((slot, index) => [slot.id, index]));
    const textIds = new Set<string>();
    template.texts.forEach((text, index) => {
      if (textIds.has(text.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['texts', index, 'id'],
          message: 'Hay dos textos con el mismo identificador',
        });
      }
      textIds.add(text.id);
      const from = order.get(text.from);
      const to = order.get(text.to ?? text.from);
      if (from === undefined) {
        ctx.addIssue({ code: 'custom', path: ['texts', index, 'from'], message: 'Ese plano no existe' });
      }
      if (to === undefined) {
        ctx.addIssue({ code: 'custom', path: ['texts', index, 'to'], message: 'Ese plano no existe' });
      }
      if (from !== undefined && to !== undefined && to < from) {
        ctx.addIssue({
          code: 'custom',
          path: ['texts', index, 'to'],
          message: 'El texto no puede salir antes de entrar',
        });
      }
    });
    if (template.cover && !order.has(template.cover.slot)) {
      ctx.addIssue({ code: 'custom', path: ['cover', 'slot'], message: 'Ese plano no existe' });
    }
  });

export type ReelTemplate = z.infer<typeof reelTemplateSchema>;
export type ReelTemplateInput = z.input<typeof reelTemplateSchema>;

export interface ReelTemplateIssue {
  path: string;
  message: string;
}

/** Valida una plantilla de reel. `styleIds`, si se da, comprueba que el estilo base existe. */
export function validateReelTemplate(
  raw: unknown,
  styleIds?: readonly string[],
): { ok: true; template: ReelTemplate } | { ok: false; issues: ReelTemplateIssue[] } {
  const parsed = reelTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  if (styleIds && !styleIds.includes(parsed.data.style.id)) {
    return {
      ok: false,
      issues: [
        { path: 'style.id', message: `El estilo «${parsed.data.style.id}» no existe (vale ${styleIds.join(', ')})` },
      ],
    };
  }
  return { ok: true, template: parsed.data };
}

// ───────────────────────────── Entrega ─────────────────────────────

export const REEL_TEMPLATES_DELIVERY_FORMAT = 'rrss.agency-reel-templates';
export const REEL_TEMPLATES_DELIVERY_VERSION = 1;
const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Una plantilla tal como se entrega y se guarda: clave estable, nombre y documento. */
export interface ReelTemplateEntry {
  key: string;
  name: string;
  document: ReelTemplate;
}

export type ReelTemplatesDeliveryParse =
  { ok: true; templates: ReelTemplateEntry[]; note: string | null } | { ok: false; issues: ReelTemplateIssue[] };

/**
 * Valida un archivo de entrega de plantillas de reel:
 *   { "format": "rrss.agency-reel-templates", "version": 1, "note": "…",
 *     "templates": [ { "key", "name", "document": <plantilla de reel> } ] }
 */
export function validateReelTemplatesDelivery(raw: unknown, styleIds?: readonly string[]): ReelTemplatesDeliveryParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', message: 'La entrega debe ser un objeto JSON.' }] };
  }
  const input = raw as Record<string, unknown>;
  const issues: ReelTemplateIssue[] = [];
  if (input.format !== REEL_TEMPLATES_DELIVERY_FORMAT) {
    issues.push({ path: 'format', message: `debe ser "${REEL_TEMPLATES_DELIVERY_FORMAT}"` });
  }
  if (input.version !== REEL_TEMPLATES_DELIVERY_VERSION) {
    issues.push({ path: 'version', message: `debe ser ${REEL_TEMPLATES_DELIVERY_VERSION}` });
  }
  for (const key of Object.keys(input)) {
    if (!['format', 'version', 'note', 'templates'].includes(key))
      issues.push({ path: key, message: 'campo no previsto' });
  }
  if (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.length > 500)) {
    issues.push({ path: 'note', message: 'texto de hasta 500 caracteres' });
  }
  const list = input.templates;
  const templates: ReelTemplateEntry[] = [];
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_REEL_TEMPLATES_PER_DELIVERY) {
    issues.push({ path: 'templates', message: `entre 1 y ${MAX_REEL_TEMPLATES_PER_DELIVERY} plantillas` });
  } else {
    const keys = new Set<string>();
    list.forEach((item: unknown, index) => {
      const at = `templates[${index}]`;
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        issues.push({ path: at, message: 'debe ser un objeto' });
        return;
      }
      const entry = item as Record<string, unknown>;
      for (const key of Object.keys(entry)) {
        if (!['key', 'name', 'document'].includes(key))
          issues.push({ path: `${at}.${key}`, message: 'campo no previsto' });
      }
      const key = typeof entry.key === 'string' && KEY.test(entry.key) ? entry.key : null;
      if (!key) issues.push({ path: `${at}.key`, message: 'clave en minúsculas, cifras y guiones (hasta 63)' });
      else if (keys.has(key)) issues.push({ path: `${at}.key`, message: 'clave repetida en la entrega' });
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name || name.length > 80) issues.push({ path: `${at}.name`, message: 'nombre de 1 a 80 caracteres' });
      const document = validateReelTemplate(entry.document, styleIds);
      if (!document.ok) {
        issues.push(...document.issues.map((i) => ({ path: `${at}.document.${i.path}`, message: i.message })));
      }
      if (key && name && name.length <= 80 && document.ok) {
        keys.add(key);
        templates.push({ key, name, document: document.template });
      }
    });
  }
  if (issues.length) return { ok: false, issues };
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  return { ok: true, templates, note };
}

// ───────────────────────────── Material ─────────────────────────────

export interface ReelTemplateNeeds {
  /** Fotos o clips que hacen falta como mínimo y los que caben. */
  min: number;
  max: number;
  /** Duración con todos los planos (sin descontar transiciones), en segundos. */
  seconds: number;
}

export function reelTemplateNeeds(template: ReelTemplate): ReelTemplateNeeds {
  const required = template.slots.filter((slot) => !slot.optional).length;
  const seconds = template.slots.reduce((sum, slot) => sum + slot.seconds, 0);
  return { min: required, max: template.slots.length, seconds: Number(seconds.toFixed(2)) };
}

const fmt = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);

/** «4 a 6 fotos o clips · unos 14 s». */
export function describeNeeds(template: ReelTemplate): string {
  const { min, max, seconds } = reelTemplateNeeds(template);
  const kinds = new Set(template.slots.map((slot) => slot.kind));
  const what =
    kinds.size === 1 && kinds.has('photo')
      ? 'fotos'
      : kinds.size === 1 && kinds.has('video')
        ? 'clips'
        : 'fotos o clips';
  const count = min === max ? `${max} ${max === 1 ? what.replace(/s\b/g, '') : what}` : `${min} a ${max} ${what}`;
  return `${count} · unos ${fmt(seconds)} s`;
}

/**
 * Qué planos se usan con `count` fotos o clips: todos si llegan; si faltan, se
 * quitan primero los opcionales (los últimos antes) y, si aun así faltan, los
 * obligatorios del medio (el primero y el último se conservan: gancho y cierre).
 */
export function slotsFor(template: ReelTemplate, count: number): ReelSlot[] {
  const slots = template.slots;
  if (count >= slots.length) return slots;
  if (count <= 0) return [];
  const required = slots.filter((slot) => !slot.optional);
  if (count >= required.length) {
    let spare = count - required.length;
    return slots.filter((slot) => {
      if (!slot.optional) return true;
      if (spare <= 0) return false;
      spare -= 1;
      return true;
    });
  }
  if (count === 1) return [required[0]!];
  return [...required.slice(0, count - 1), required[required.length - 1]!];
}

// ───────────────────────────── Montar ─────────────────────────────

const round = (n: number, decimals = 2) => Number(n.toFixed(decimals));

export interface BuildReelOptions {
  /** Tipografía de la marca para los textos (.ttf u .otf de su biblioteca). */
  font?: { path: string; family: string };
}

/**
 * Monta un reel con una plantilla y el material elegido, en el orden de la
 * elección: cada foto o clip ocupa un plano con su duración, movimiento y
 * transición, y los textos de muestra entran con su plano. El resultado es un
 * proyecto de reel normal (plan v2): sin música (solo se sugiere) y con todo
 * editable después.
 */
export function buildReelFromTemplate(
  template: ReelTemplate,
  assets: SourceAsset[],
  style: ReelTemplateSummary,
  options: BuildReelOptions = {},
): ReelProject {
  const slots = slotsFor(template, assets.length);
  const files = new Map<string, number>();
  const clips: Clip[] = slots.map((slot, index) => {
    const asset = assets[index]!;
    const id = `c${index + 1}`;
    const transition = slot.transition ? { ...slot.transition } : templateTransition(style);
    if (asset.kind === 'video') {
      const file = asset.duration_ms && asset.duration_ms > 0 ? asset.duration_ms / 1000 : null;
      if (file !== null) files.set(asset.storage_path, file);
      const out = Math.max(MIN_SEGMENT_SECONDS, file === null ? slot.seconds : Math.min(slot.seconds, file));
      return {
        id,
        type: 'video',
        path: asset.storage_path,
        in: 0,
        out: round(out),
        volume: slot.volume ?? style.audio.clipVolume,
        transition,
      };
    }
    return {
      id,
      type: 'photo',
      path: asset.storage_path,
      seconds: Math.min(slot.seconds, PHOTO_SECONDS.max),
      ...(slot.motion ? { motion: slot.motion } : {}),
      ...(slot.motionAmount !== undefined ? { motionAmount: slot.motionAmount } : {}),
      transition,
    };
  });

  const timeline = planTimeline(clips, style, (clip) => files.get(clip.path) ?? null);
  const position = new Map(slots.map((slot, index) => [slot.id, index]));
  const base = templateTextStyle(style);
  const texts: ReelText[] = [];
  for (const text of template.texts) {
    const from = position.get(text.from);
    if (from === undefined) continue; // su plano se quitó por falta de material
    const to = position.get(text.to ?? text.from) ?? from;
    const start = timeline.starts[from]! + (text.offset ?? 0);
    const end = timeline.starts[to]! + timeline.durations[to]! + (text.endOffset ?? 0);
    const safeStart = round(Math.max(0, Math.min(start, timeline.total - 0.5)));
    const safeEnd = round(Math.min(timeline.total, Math.max(end, safeStart + 0.5)));
    if (!(safeEnd > safeStart)) continue;
    const textStyle: TextStyle = {
      ...base,
      ...(text.style ?? {}),
      ...(options.font ? { fontPath: options.font.path, fontFamily: options.font.family } : {}),
    };
    textStyle.color = textStyle.color.toUpperCase();
    texts.push({
      id: `t${texts.length + 1}`,
      text: text.text,
      start: safeStart,
      end: safeEnd,
      position: text.position,
      style: textStyle,
      ...(text.animation ? { animation: { ...text.animation } } : {}),
    });
  }

  const coverSlot = template.cover ? position.get(template.cover.slot) : undefined;
  const cover =
    coverSlot === undefined
      ? null
      : round(Math.min(timeline.total, timeline.starts[coverSlot]! + (template.cover!.offset ?? 0)));

  return {
    kind: PROJECT_KIND,
    template: { id: style.id },
    plan: {
      version: REEL_PLAN_VERSION,
      clips,
      texts,
      ...(cover !== null && clips.length > 0 ? { cover: { type: 'frame' as const, at: cover } } : {}),
    },
  };
}
