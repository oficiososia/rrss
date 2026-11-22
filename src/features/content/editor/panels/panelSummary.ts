import type { ImageLayer, Layer, ShapeLayer, TextLayer } from '../../document';
import { isNeutralAdjust } from '../../document';
import { FILTER_LABEL } from '../imageEffects/filters';

// Resumen corto del valor de ahora de cada sección del panel, para enseñarlo en la
// cabecera con la sección plegada. Funciones puras: sin React, fáciles de probar.

const pct = (value: number) => `${Math.round(value)} %`;
const num = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',');

export function adjustSummary(layer: ImageLayer): string {
  if (isNeutralAdjust(layer.adjust)) return 'Sin cambios';
  const adjust = layer.adjust!;
  const sliders = (['brightness', 'contrast', 'saturation', 'temperature', 'sharpness'] as const).filter(
    (key) => adjust[key] !== 0,
  ).length;
  const parts: string[] = [];
  if (adjust.filter) parts.push(FILTER_LABEL[adjust.filter]);
  if (sliders > 0) parts.push(sliders === 1 ? '1 ajuste' : `${sliders} ajustes`);
  return parts.join(' · ');
}

export function geometrySummary(layer: ImageLayer): string {
  const parts: string[] = [];
  if (layer.turn) parts.push(`girada ${layer.turn}°`);
  if (layer.flipX || layer.flipY) parts.push('volteada');
  if (layer.straighten) parts.push('enderezada');
  if (layer.crop) parts.push('recortada');
  if (parts.length === 0) return 'Sin cambios';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const BACKDROP_TEXT = { color: 'Color', gradient: 'Degradado', blur: 'Foto desenfocada' } as const;

export function backdropSummary(layer: ImageLayer): string {
  const parts = [layer.backdrop ? `Fondo: ${BACKDROP_TEXT[layer.backdrop.kind].toLowerCase()}` : 'Sin fondo'];
  if (layer.shadow) parts.push('con sombra');
  return parts.join(' · ');
}

export function focusSummary(layer: ImageLayer): string {
  const { x, y } = layer.focus;
  if (Math.abs(x - 0.5) < 0.005 && Math.abs(y - 0.5) < 0.005) return 'Centro';
  return `${pct(x * 100)} · ${pct(y * 100)}`;
}

export function blurSummary(layer: ImageLayer): string {
  return layer.blur ? pct(layer.blur) : 'Sin desenfoque';
}

export function opacitySummary(layer: Layer): string {
  const parts = [pct(layer.opacity * 100)];
  if (!layer.visible) parts.push('oculta');
  if (layer.locked) parts.push('bloqueada');
  return parts.join(' · ');
}

export function positionSummary(layer: Layer): string {
  return `${Math.round(layer.width)} × ${Math.round(layer.height)} en ${Math.round(layer.x)}, ${Math.round(layer.y)}`;
}

const ANCHOR_X_SHORT = { left: 'izquierda', center: 'centro', right: 'derecha', stretch: 'se estira' } as const;
const ANCHOR_Y_SHORT = { top: 'arriba', center: 'centro', bottom: 'abajo', stretch: 'se estira' } as const;

export function anchorSummary(layer: Layer): string {
  return `${ANCHOR_X_SHORT[layer.anchor.x]} · ${ANCHOR_Y_SHORT[layer.anchor.y]}`;
}

export function nameSummary(layer: Layer): string {
  return layer.name.trim() || 'Sin nombre';
}

export function textEffectsSummary(layer: TextLayer): string {
  const parts: string[] = [];
  if (layer.outline) parts.push('contorno');
  if (layer.shadow) parts.push('sombra');
  if (layer.background) parts.push('fondo');
  if (parts.length === 0) return 'Sin efectos';
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function textSpacingSummary(layer: TextLayer): string {
  return `Interlineado ${num(layer.lineHeight)}${layer.italic ? ' · cursiva' : ''}`;
}

export function shapeExtrasSummary(layer: ShapeLayer): string {
  const parts: string[] = [];
  if (layer.shape === 'rectangle')
    parts.push(layer.cornerRadius > 0 ? `esquinas ${Math.round(layer.cornerRadius)}` : 'esquinas rectas');
  parts.push(layer.shadow ? 'con sombra' : 'sin sombra');
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
