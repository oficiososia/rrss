import { z } from 'zod';
import { ASPECT_RATIOS, IMAGE_FILTERS, SHAPE_KINDS, type PageView } from '../document';

// Contrato de la respuesta del copiloto del editor (`editor.copilot` de
// `ai-generate`, docs/copiloto-voz.md) visto desde el navegador. El servidor ya
// valida y sanea las operaciones; aquí se vuelven a validar con un esquema
// ESTRICTO antes de que nada toque el documento: una respuesta que no cumpla
// no se aplica (ni una parte).
//
// Una operación es `op` + los campos que usa; los demás, null. Las órdenes
// frecuentes que resuelve el intérprete local (localCommands.ts) producen estas
// mismas operaciones, sin pasar por la IA.

/** Las ocho operaciones de la primera versión (las únicas que conoce la ruta JSON del servidor). */
export const COPILOT_LEGACY_OPS = [
  'add_text',
  'update_text',
  'set_background_image',
  'blur_image',
  'add_logo',
  'move_layer',
  'remove_layer',
  'set_background_color',
] as const;

export const COPILOT_OPS = [
  ...COPILOT_LEGACY_OPS,
  // Capas
  'resize_layer',
  'arrange_layer',
  'duplicate_layer',
  'style_layer',
  'set_effect',
  // Formas
  'add_shape',
  'style_shape',
  // Fotos
  'add_image',
  'adjust_image',
  'transform_image',
  'image_backdrop',
  'photo_flow',
  // Lienzo y páginas
  'set_canvas_ratio',
  'page',
  // Acciones del editor (no cambian el documento: deshacer, rehacer, guardar, plantilla)
  'editor',
] as const;
export type CopilotOp = (typeof COPILOT_OPS)[number];

export const COPILOT_TEXT_STYLES = ['title', 'subtitle', 'body', 'small'] as const;
export const COPILOT_POSITIONS = ['top', 'upper', 'middle', 'lower', 'bottom'] as const;
export const COPILOT_ALIGNS = ['left', 'center', 'right'] as const;
export const COPILOT_EFFECTS = ['outline', 'shadow', 'background'] as const;
export const COPILOT_ORDERS = ['front', 'forward', 'backward', 'back'] as const;
export const COPILOT_FLIPS = ['horizontal', 'vertical'] as const;
export const COPILOT_FITS = ['cover', 'contain'] as const;
export const COPILOT_CROPS = ['1:1', '4:5', '9:16', '16:9', '3:2', 'none'] as const;
export const COPILOT_BACKDROPS = ['none', 'color', 'gradient', 'blur'] as const;
export const COPILOT_FILTERS = [...IMAGE_FILTERS, 'none'] as const;
export const COPILOT_DIRECTIONS = ['next', 'previous', 'first', 'last'] as const;
/**
 * Valores de `action`, según la operación:
 *  - `page`: add, duplicate, remove, move (a `page`), go (a `page` o `direction`);
 *  - `photo_flow`: remove_background, portrait, edit, replace (lanzan el flujo que ya tiene el editor);
 *  - `editor`: undo, redo, save, template.
 */
export const COPILOT_PAGE_ACTIONS = ['add', 'duplicate', 'remove', 'move', 'go'] as const;
export const COPILOT_PHOTO_FLOWS = ['remove_background', 'portrait', 'edit', 'replace'] as const;
export const COPILOT_EDITOR_ACTIONS = ['undo', 'redo', 'save', 'template'] as const;
export const COPILOT_ACTIONS = [...COPILOT_PAGE_ACTIONS, ...COPILOT_PHOTO_FLOWS, ...COPILOT_EDITOR_ACTIONS] as const;

/** Pasos máximos de un movimiento relativo (igual que `MAX_MOVE_STEPS` del servidor). */
export const COPILOT_MAX_MOVE_STEPS = 6;
/** Un paso de movimiento relativo: el 5 % del lado del lienzo. */
export const COPILOT_MOVE_STEP = 0.05;
/** Pasos máximos de un cambio de tamaño («más grande» = 1; «mucho más» = 2). */
export const COPILOT_MAX_SIZE_STEPS = 4;
/** Un paso de tamaño: un 15 % más grande (o más pequeño). */
export const COPILOT_SIZE_STEP = 1.15;

export type CopilotTextStyle = (typeof COPILOT_TEXT_STYLES)[number];
export type CopilotPosition = (typeof COPILOT_POSITIONS)[number];
export type CopilotAlign = (typeof COPILOT_ALIGNS)[number];
export type CopilotPhotoFlow = (typeof COPILOT_PHOTO_FLOWS)[number];
export type CopilotEditorAction = (typeof COPILOT_EDITOR_ACTIONS)[number];

const layerId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const slider = z.number().finite().min(-100).max(100);
/** Campo que puede no venir (un servidor anterior no lo conoce): vale null. */
const opt = <T extends z.ZodTypeAny>(schema: T) => schema.nullable().default(null);

export const copilotOperationSchema = z.strictObject({
  op: z.enum(COPILOT_OPS),
  /** Capa existente a la que se refiere. */
  target: opt(layerId),
  text: opt(z.string().max(1000)),
  style: opt(z.enum(COPILOT_TEXT_STYLES)),
  assetId: opt(z.string().uuid()),
  position: opt(z.enum(COPILOT_POSITIONS)),
  align: opt(z.enum(COPILOT_ALIGNS)),
  color: opt(hex),
  /** Segundo color: borde de una forma o final de un degradado. */
  color2: opt(hex),
  font: opt(z.string().max(120)),
  blur: opt(z.number().finite().min(0).max(100)),
  // Movimiento relativo de move_layer, en pasos (un paso = 5 % del lienzo).
  dx: opt(z.number().int().min(-COPILOT_MAX_MOVE_STEPS).max(COPILOT_MAX_MOVE_STEPS)),
  dy: opt(z.number().int().min(-COPILOT_MAX_MOVE_STEPS).max(COPILOT_MAX_MOVE_STEPS)),
  /** resize_layer: pasos de tamaño (cada uno, un 15 %). */
  steps: opt(z.number().int().min(-COPILOT_MAX_SIZE_STEPS).max(COPILOT_MAX_SIZE_STEPS)),
  bold: opt(z.boolean()),
  italic: opt(z.boolean()),
  /** set_effect: qué efecto y si se pone o se quita. */
  effect: opt(z.enum(COPILOT_EFFECTS)),
  on: opt(z.boolean()),
  order: opt(z.enum(COPILOT_ORDERS)),
  shape: opt(z.enum(SHAPE_KINDS)),
  /** style_layer. La opacidad, de 0 a 100. */
  opacity: opt(z.number().finite().min(0).max(100)),
  rotation: opt(z.number().finite().min(-180).max(180)),
  visible: opt(z.boolean()),
  locked: opt(z.boolean()),
  /** adjust_image. */
  filter: opt(z.enum(COPILOT_FILTERS)),
  brightness: opt(slider),
  contrast: opt(slider),
  saturation: opt(slider),
  temperature: opt(slider),
  sharpness: opt(z.number().finite().min(0).max(100)),
  /** transform_image. */
  turn: opt(z.boolean()),
  flip: opt(z.enum(COPILOT_FLIPS)),
  fit: opt(z.enum(COPILOT_FITS)),
  crop: opt(z.enum(COPILOT_CROPS)),
  backdrop: opt(z.enum(COPILOT_BACKDROPS)),
  ratio: opt(z.enum(ASPECT_RATIOS)),
  action: opt(z.enum(COPILOT_ACTIONS)),
  /** Número de página, desde 1. */
  page: opt(z.number().int().min(1).max(10)),
  direction: opt(z.enum(COPILOT_DIRECTIONS)),
});
export type CopilotOperation = z.infer<typeof copilotOperationSchema>;

/** Operación con todo a null menos lo que se indique (para el intérprete local y las pruebas). */
export function copilotOp(fields: Partial<CopilotOperation> & Pick<CopilotOperation, 'op'>): CopilotOperation {
  return copilotOperationSchema.parse(fields);
}

export const copilotResponseSchema = z.strictObject({
  action: z.literal('editor.copilot'),
  generationId: z.string().uuid(),
  operations: z.array(copilotOperationSchema).max(20),
  discarded: z
    .array(z.strictObject({ index: z.number().int().min(0), op: z.string().max(40), reason: z.string().max(300) }))
    .max(40),
  note: z.string().max(300),
});
export type CopilotResponse = z.infer<typeof copilotResponseSchema>;

/** Valida la respuesta del servidor. `null` si no cumple el contrato: no se aplica nada. */
export function parseCopilotResponse(value: unknown): CopilotResponse | null {
  const result = copilotResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Capa tal como se le enseña a la IA: lo justo para referirse a ella. */
export interface CopilotLayerSummary {
  id: string;
  type: 'image' | 'text' | 'logo' | 'shape';
  name?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  blur?: number;
}

export interface CopilotDocumentSummary {
  canvas: { aspectRatio: string; width: number; height: number; backgroundColor: string };
  layers: CopilotLayerSummary[];
  /** Capas elegidas en el editor («esto», «eso»). */
  selected?: string[];
  /** Página activa (desde 1) y cuántas hay. */
  page?: { index: number; count: number };
}

/**
 * Estado de la página activa que viaja a la IA (sin direcciones, recursos de
 * otros ni el texto de la publicación): el copiloto solo ve esa página, qué
 * capas están elegidas y cuántas páginas hay.
 */
export function summarizeDocument(
  document: Pick<PageView, 'canvas' | 'layers'>,
  extra: { selectedIds?: readonly string[]; pageIndex?: number; pageCount?: number } = {},
): CopilotDocumentSummary {
  const present = new Set(document.layers.map((layer) => layer.id));
  const selected = (extra.selectedIds ?? []).filter((id) => present.has(id));
  return {
    canvas: {
      aspectRatio: document.canvas.aspectRatio,
      width: document.canvas.width,
      height: document.canvas.height,
      backgroundColor: document.canvas.backgroundColor.toUpperCase(),
    },
    layers: document.layers.map((layer) => ({
      id: layer.id,
      type: layer.type,
      ...(layer.name ? { name: layer.name } : {}),
      ...(layer.type === 'text' ? { text: layer.text } : {}),
      x: Math.round(layer.x),
      y: Math.round(layer.y),
      width: Math.round(layer.width),
      height: Math.round(layer.height),
      ...(layer.locked ? { locked: true } : {}),
      ...(layer.type === 'image' && layer.blur ? { blur: layer.blur } : {}),
    })),
    ...(selected.length > 0 ? { selected } : {}),
    ...(extra.pageCount !== undefined
      ? { page: { index: (extra.pageIndex ?? 0) + 1, count: extra.pageCount } }
      : {}),
  };
}

/** Palabras de un texto: minúsculas, sin signos ni espacios repetidos. Las tildes y los números cuentan. */
export function dictationWords(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Sonidos de titubeo: no son palabras de ningún texto. */
const HESITATIONS = new Set(['eh', 'ehh', 'em', 'emm', 'ehm', 'mm', 'mmm', 'hmm', 'um', 'uh', 'uhm']);

/**
 * Lo dictado sin titubeos: fuera los sonidos («eh», «mmm») y las palabras
 * repetidas seguidas («el el título»). Igual que en el servidor.
 */
export function withoutHesitations(words: string): string {
  const out: string[] = [];
  for (const word of words.split(' ')) {
    if (!word || HESITATIONS.has(word) || out[out.length - 1] === word) continue;
    out.push(word);
  }
  return out.join(' ');
}

/**
 * ¿Está el texto en lo dictado? (misma regla que el servidor: cada línea con las
 * mismas palabras y en el mismo orden; se perdonan mayúsculas, puntuación y los
 * titubeos del habla). El navegador lo comprueba otra vez: la IA no redacta.
 */
export function isDictated(text: string, transcript: string): boolean {
  const words = dictationWords(transcript);
  const haystacks = [` ${words} `, ` ${withoutHesitations(words)} `];
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  return (
    lines.length > 0 &&
    lines.every((line) => {
      const needle = dictationWords(line);
      return needle !== '' && haystacks.some((haystack) => haystack.includes(` ${needle} `));
    })
  );
}

/** Quita las operaciones con texto que no se ha dictado. Devuelve las que quedan y cuántas se han quitado. */
export function keepDictated(
  operations: CopilotOperation[],
  transcript: string,
): { operations: CopilotOperation[]; removed: number } {
  const kept = operations.filter((op) => op.text === null || isDictated(op.text, transcript));
  return { operations: kept, removed: operations.length - kept.length };
}
