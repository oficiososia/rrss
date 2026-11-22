// Estilos de texto prediseñados: un toque deja un texto como titular, rótulo,
// precio o subtítulo (tamaño, sitio, franja o contorno y animación). No añaden
// nada al plan: solo rellenan campos que ya tiene un texto, así que el vídeo
// los monta como cualquier otro. El color y la tipografía del texto no se
// tocan (son los de la marca), salvo en el precio, que va sobre una franja del
// color de acento de la marca si lo hay.
import type { TextAnimation } from './animation';
import type { ReelProject, ReelText, TextPosition, TextStyle } from './project';

export const TEXT_PRESETS = ['headline', 'label', 'price', 'caption'] as const;
export type TextPresetId = (typeof TEXT_PRESETS)[number];

export const TEXT_PRESET_LABEL: Record<TextPresetId, string> = {
  headline: 'Titular',
  label: 'Rótulo',
  price: 'Precio',
  caption: 'Subtítulo',
};

export const TEXT_PRESET_HINT: Record<TextPresetId, string> = {
  headline: 'Grande, en el centro, con contorno',
  label: 'Abajo, sobre una franja',
  price: 'Muy grande, sobre una franja de color',
  caption: 'Pequeño, abajo, fácil de leer',
};

interface Preset {
  position: TextPosition;
  style: Partial<TextStyle>;
  animation: TextAnimation;
}

const BLACK = '#000000';

const PRESETS: Record<TextPresetId, Preset> = {
  headline: {
    position: 'center',
    style: {
      sizeRatio: 0.095,
      maxWidthRatio: 0.86,
      lineHeight: 1.15,
      box: null,
      outline: { color: BLACK, widthRatio: 0.07 },
    },
    animation: { in: 'zoom', out: 'fade' },
  },
  label: {
    position: 'bottom',
    style: {
      sizeRatio: 0.052,
      marginRatio: 0.26,
      maxWidthRatio: 0.84,
      lineHeight: 1.3,
      box: { color: BLACK, opacity: 0.6, paddingRatio: 0.35 },
      outline: null,
    },
    animation: { in: 'slide', out: 'slide' },
  },
  price: {
    position: 'center',
    style: {
      sizeRatio: 0.12,
      maxWidthRatio: 0.7,
      lineHeight: 1.1,
      box: { color: BLACK, opacity: 0.85, paddingRatio: 0.3 },
      outline: null,
    },
    animation: { in: 'rise', out: 'fade' },
  },
  caption: {
    position: 'bottom',
    style: {
      sizeRatio: 0.045,
      marginRatio: 0.16,
      maxWidthRatio: 0.86,
      lineHeight: 1.3,
      box: { color: BLACK, opacity: 0.6, paddingRatio: 0.3 },
      outline: null,
    },
    animation: { in: 'fade', out: 'fade' },
  },
};

/** El texto con el estilo prediseñado. `accent`: color de acento de la marca (#RRGGBB), para la franja del precio. */
export function withTextPreset(text: ReelText, preset: TextPresetId, accent?: string): ReelText {
  const recipe = PRESETS[preset];
  const style: TextStyle = { ...text.style, ...recipe.style };
  if (preset === 'price' && accent && /^#[0-9a-fA-F]{6}$/.test(accent) && style.box) {
    style.box = { ...style.box, color: accent.toUpperCase(), opacity: 1 };
  }
  const next: ReelText = { ...text, position: recipe.position, style, animation: { ...recipe.animation } };
  // Un estilo prediseñado lo devuelve a su sitio: el desplazamiento a mano era del estilo anterior.
  delete next.offset;
  return next;
}

export function applyTextPreset(project: ReelProject, id: string, preset: TextPresetId, accent?: string): ReelProject {
  return {
    ...project,
    plan: { ...project.plan, texts: project.plan.texts.map((t) => (t.id === id ? withTextPreset(t, preset, accent) : t)) },
  };
}

/** ¿Qué estilo prediseñado lleva este texto ahora? (para marcarlo en el panel). Null si ninguno. */
export function presetOf(text: ReelText): TextPresetId | null {
  for (const id of TEXT_PRESETS) {
    const recipe = PRESETS[id];
    if (text.position !== recipe.position) continue;
    if (Math.abs(text.style.sizeRatio - (recipe.style.sizeRatio ?? 0)) > 1e-6) continue;
    if (Boolean(text.style.box) !== Boolean(recipe.style.box)) continue;
    if (Boolean(text.style.outline) !== Boolean(recipe.style.outline)) continue;
    return id;
  }
  return null;
}
