import {
  MAX_LAYERS,
  validateDocument,
  type Canvas,
  type ContentDocument,
  type DocumentIssue,
  type ImageLayer,
  type Layer,
  type TextLayer,
} from '../document';
import { dropLoneGroups } from '../editor/arrange';
import { applyLayerPatch, type LayerPatch } from '../editor/history';
import { FALLBACK_FONTS, newImageLayer, newLayerId, newLogoLayer } from '../editor/layers';
import type { CopilotAlign, CopilotOperation, CopilotPosition, CopilotTextStyle } from './operations';

// Aplica las operaciones del copiloto por voz al documento, de forma pura y
// determinista: la IA dice QUÉ (un texto de título arriba, la foto de fondo
// difuminada), y aquí se decide DÓNDE y CÓMO con las tipografías y colores del
// perfil de marca. El resultado se valida con el esquema del documento; si no
// cumple, no se aplica nada. El editor lo mete en el historial como UN paso de
// deshacer (acción `replace`).

/** Desenfoque cuando se pide difuminar sin decir cuánto. */
export const DEFAULT_BLUR = 40;

export interface CopilotBrandStyle {
  /** Colores del perfil (#RRGGBB), en su orden. */
  palette: string[];
  /** Tipografías del perfil, en su orden (la primera, para títulos). */
  fonts: string[];
}

export interface CopilotAssetInfo {
  id: string;
  name: string;
  width?: number | null;
  height?: number | null;
}

export interface CopilotApplyContext {
  brand: CopilotBrandStyle;
  /** Fotos y logotipos conocidos (nombre y medidas), por id. */
  assets: ReadonlyMap<string, CopilotAssetInfo>;
  /** Logotipos del perfil, en su orden. */
  logoIds: readonly string[];
}

export type CopilotApplyResult =
  | {
      ok: true;
      document: ContentDocument;
      /** Lo hecho, en palabras, para la persona. */
      changes: string[];
      /** Lo que no se ha podido hacer, con su motivo. */
      skipped: string[];
      /** Capas nuevas o tocadas, para dejarlas elegidas. */
      touched: string[];
    }
  | { ok: false; issues: DocumentIssue[] };

const TEXT_SIZE: Record<CopilotTextStyle, { size: number; weight: number }> = {
  title: { size: 0.085, weight: 700 },
  subtitle: { size: 0.06, weight: 600 },
  body: { size: 0.045, weight: 400 },
  small: { size: 0.035, weight: 400 },
};
const SLOT: Record<CopilotPosition, number> = { top: 0.05, upper: 0.2, middle: 0.4, lower: 0.62, bottom: 0.82 };
const LINE_HEIGHT = 1.25;
/** Ancho medio de un carácter respecto al cuerpo de letra (para estimar cuántas líneas ocupa un texto). */
const GLYPH = 0.55;
const SIDE = 0.08;

/** ¿Cubre la imagen todo el lienzo? Es la «foto de fondo». */
function coversCanvas(layer: Layer, canvas: Canvas): boolean {
  return layer.x <= 1 && layer.y <= 1 && layer.x + layer.width >= canvas.width - 1 && layer.y + layer.height >= canvas.height - 1;
}

/** La foto de fondo: la imagen más al fondo que cubre todo el lienzo. */
export function backgroundImageOf(document: ContentDocument): ImageLayer | null {
  const found = document.layers.find((layer) => layer.type === 'image' && coversCanvas(layer, document.canvas));
  return (found as ImageLayer | undefined) ?? null;
}

/** ¿Hay alguna orden que pide una foto sin decir cuál? (el editor abre el selector). */
export function needsPhotoPick(operations: CopilotOperation[]): boolean {
  return operations.some((op) => op.op === 'set_background_image' && op.assetId === null);
}

/** Rellena «esta foto» con la elegida. */
export function withPickedPhoto(operations: CopilotOperation[], assetId: string | null): CopilotOperation[] {
  return operations.flatMap((op) => {
    if (op.op !== 'set_background_image' || op.assetId !== null) return [op];
    return assetId ? [{ ...op, assetId }] : [];
  });
}

function textBox(canvas: Canvas, text: string, fontSize: number) {
  const width = Math.round(canvas.width * (1 - SIDE * 2));
  const perLine = Math.max(1, Math.floor(width / (fontSize * GLYPH)));
  const lines = text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return { width, height: Math.round(lines * fontSize * LINE_HEIGHT) };
}

function xFor(canvas: Canvas, width: number, align: CopilotAlign | null): number {
  if (align === 'left') return Math.round(canvas.width * SIDE);
  if (align === 'right') return Math.round(canvas.width - width - canvas.width * SIDE);
  return Math.round((canvas.width - width) / 2);
}

const overlapsY = (a: { y: number; height: number }, b: { y: number; height: number }) =>
  a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Altura para un texto nuevo: la de su posición o, sin posición, debajo del
 * último texto. Si choca con otro texto o logotipo, baja hasta dejar sitio.
 */
function placeY(document: ContentDocument, height: number, position: CopilotPosition | null, after: Layer | null) {
  const { canvas } = document;
  const gap = Math.round(canvas.height * 0.02);
  let y = position ? Math.round(canvas.height * SLOT[position]) : after ? after.y + after.height + gap : Math.round(canvas.height * SLOT.upper);
  const others = document.layers.filter((layer) => layer.type === 'text' || layer.type === 'logo');
  for (let guard = 0; guard < others.length; guard += 1) {
    const hit = others.find((layer) => overlapsY({ y, height }, layer));
    if (!hit) break;
    y = hit.y + hit.height + gap;
  }
  return Math.max(0, Math.min(y, canvas.height - height - gap));
}

function textStyle(brand: CopilotBrandStyle, style: CopilotTextStyle) {
  const heading = style === 'title' || style === 'subtitle';
  const font = (heading ? brand.fonts[0] : (brand.fonts[1] ?? brand.fonts[0])) ?? FALLBACK_FONTS[0]!;
  const color = (heading ? brand.palette[0] : (brand.palette[1] ?? brand.palette[0])) ?? '#111111';
  return { font, color };
}

const layerName = (layer: Layer) =>
  layer.type === 'text' ? `«${layer.text.split('\n')[0]!.slice(0, 40)}»` : layer.name || 'la capa';

/** Aplica las operaciones en orden sobre una copia del documento y valida el resultado. */
export function applyCopilotOperations(
  input: ContentDocument,
  operations: CopilotOperation[],
  context: CopilotApplyContext,
): CopilotApplyResult {
  let document: ContentDocument = { ...input, canvas: { ...input.canvas }, layers: [...input.layers] };
  const changes: string[] = [];
  const skipped: string[] = [];
  const touched = new Set<string>();
  let lastText: Layer | null = null;

  const find = (id: string | null) => (id ? (document.layers.find((layer) => layer.id === id) ?? null) : null);
  const replaceLayer = (next: Layer) => {
    document = { ...document, layers: document.layers.map((layer) => (layer.id === next.id ? next : layer)) };
    touched.add(next.id);
  };
  const patch = (layer: Layer, change: LayerPatch) => replaceLayer(applyLayerPatch(layer, change));
  const add = (layer: Layer, atBottom = false) => {
    if (document.layers.length >= MAX_LAYERS) {
      skipped.push(`No caben más capas (máximo ${MAX_LAYERS}).`);
      return false;
    }
    document = { ...document, layers: atBottom ? [layer, ...document.layers] : [...document.layers, layer] };
    touched.add(layer.id);
    return true;
  };
  const { canvas } = document;

  for (const op of operations) {
    switch (op.op) {
      case 'set_background_image': {
        const asset = op.assetId ? context.assets.get(op.assetId) : undefined;
        if (!op.assetId) {
          skipped.push('Falta elegir la foto de fondo.');
          break;
        }
        const name = asset?.name ?? 'Foto de fondo';
        const blur = op.blur ?? undefined;
        const current = backgroundImageOf(document);
        if (current) {
          patch(current, {
            source: { kind: 'asset', assetId: op.assetId },
            name: name.slice(0, 120),
            ...(op.blur !== null ? { blur } : {}),
          });
        } else {
          const layer = newImageLayer(canvas, document.layers, { id: op.assetId, name });
          if (!add(blur ? { ...layer, blur } : layer, true)) break;
        }
        changes.push(op.blur ? `Foto de fondo «${name}», difuminada (${op.blur} %)` : `Foto de fondo «${name}»`);
        break;
      }
      case 'blur_image': {
        const layer = op.target ? find(op.target) : backgroundImageOf(document);
        if (!layer || layer.type !== 'image') {
          skipped.push('No hay ninguna foto que desenfocar.');
          break;
        }
        if (layer.locked) {
          skipped.push(`${layerName(layer)} está bloqueada.`);
          break;
        }
        const blur = op.blur ?? DEFAULT_BLUR;
        patch(layer, { blur });
        changes.push(blur > 0 ? `Desenfoque de la foto: ${blur} %` : 'Foto nítida');
        break;
      }
      case 'add_logo': {
        const id = op.assetId ?? context.logoIds[0];
        if (!id) {
          skipped.push('La marca no tiene logotipos en su perfil.');
          break;
        }
        const asset = context.assets.get(id) ?? { id, name: 'Logotipo' };
        const base = newLogoLayer(canvas, document.layers, asset);
        const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.05);
        let { x, y } = base;
        if (op.position || op.align) {
          x = xFor(canvas, base.width, op.align ?? 'center');
          if (op.align === 'left' || op.align === 'right') x = op.align === 'left' ? margin : canvas.width - base.width - margin;
          y =
            op.position === 'top' || op.position === 'upper'
              ? margin
              : op.position === 'middle'
                ? Math.round((canvas.height - base.height) / 2)
                : canvas.height - base.height - margin;
        }
        const anchorY = y < canvas.height / 3 ? 'top' : y > (canvas.height * 2) / 3 ? 'bottom' : 'center';
        const anchorX = op.align === 'left' ? 'left' : op.align === 'right' ? 'right' : op.position ? 'center' : 'right';
        if (add({ ...base, x, y, anchor: { x: anchorX, y: anchorY } })) changes.push('Logotipo de la marca');
        break;
      }
      case 'add_text': {
        if (!op.text) break;
        const style = op.style ?? 'body';
        const fontSize = Math.round(Math.min(canvas.width, canvas.height) * TEXT_SIZE[style].size);
        const defaults = textStyle(context.brand, style);
        const box = textBox(canvas, op.text, fontSize);
        const y = placeY(document, box.height, op.position, lastText);
        const layer: TextLayer = {
          id: newLayerId(document.layers),
          type: 'text',
          name: '',
          x: xFor(canvas, box.width, null),
          y,
          width: box.width,
          height: box.height,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          anchor: { x: 'center', y: y < canvas.height / 3 ? 'top' : y > (canvas.height * 2) / 3 ? 'bottom' : 'center' },
          text: op.text,
          fontFamily: op.font ?? defaults.font,
          fontSize,
          fontWeight: TEXT_SIZE[style].weight,
          italic: false,
          color: op.color ?? defaults.color,
          align: op.align ?? 'center',
          lineHeight: LINE_HEIGHT,
        };
        if (add(layer)) {
          lastText = layer;
          changes.push(`Texto ${layerName(layer)}`);
        }
        break;
      }
      case 'update_text': {
        const layer = find(op.target);
        if (!layer || layer.type !== 'text') {
          skipped.push('No se encuentra el texto que hay que cambiar.');
          break;
        }
        if (layer.locked) {
          skipped.push(`${layerName(layer)} está bloqueado.`);
          break;
        }
        const change: LayerPatch = {};
        if (op.text) {
          change.text = op.text;
          change.height = Math.max(layer.height, textBox(canvas, op.text, layer.fontSize).height);
        }
        if (op.style) {
          change.fontSize = Math.round(Math.min(canvas.width, canvas.height) * TEXT_SIZE[op.style].size);
          change.fontWeight = TEXT_SIZE[op.style].weight;
        }
        if (op.color) change.color = op.color;
        if (op.font) change.fontFamily = op.font;
        if (op.align) change.align = op.align;
        patch(layer, change);
        changes.push(`Cambiado el texto ${layerName(layer)}`);
        break;
      }
      case 'move_layer': {
        const layer = find(op.target);
        if (!layer || layer.locked) {
          skipped.push(layer ? `${layerName(layer)} está bloqueada.` : 'No se encuentra la capa que hay que mover.');
          break;
        }
        const change: LayerPatch = {};
        if (op.position) {
          change.y = Math.max(0, Math.min(Math.round(canvas.height * SLOT[op.position]), canvas.height - layer.height));
        }
        if (op.align) change.x = xFor(canvas, layer.width, op.align);
        patch(layer, change);
        changes.push(`Movida ${layerName(layer)}`);
        break;
      }
      case 'remove_layer': {
        const layer = find(op.target);
        if (!layer || layer.locked) {
          skipped.push(layer ? `${layerName(layer)} está bloqueada.` : 'No se encuentra la capa que hay que quitar.');
          break;
        }
        document = { ...document, layers: dropLoneGroups(document.layers.filter((l) => l.id !== layer.id)) };
        touched.delete(layer.id);
        changes.push(`Quitada ${layerName(layer)}`);
        break;
      }
      case 'set_background_color': {
        if (!op.color) break;
        document = { ...document, canvas: { ...document.canvas, backgroundColor: op.color.toUpperCase() } };
        changes.push(`Color de fondo ${op.color.toUpperCase()}`);
        break;
      }
    }
  }

  const checked = validateDocument(document);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  const present = new Set(checked.document.layers.map((layer) => layer.id));
  return {
    ok: true,
    document: checked.document,
    changes,
    skipped,
    touched: [...touched].filter((id) => present.has(id)),
  };
}
