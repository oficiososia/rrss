import {
  allLayers,
  isEmptyFrame,
  isFrame,
  MAX_FRAME_ZOOM,
  type Canvas,
  type ContentDocument,
  type ImageLayer,
  type Layer,
} from '../document';
import type { LayerPatch } from './history';
import { newLayerId } from './layers';

// Marcos de foto: el hueco de una plantilla donde va una foto. Un marco es una
// capa de imagen con encaje «llenar»: la foto se recorta dentro de su caja, se
// recoloca arrastrándola y se amplía sin cambiar la caja. Aquí están las cuentas
// (puras, sin lienzo): qué parte de la foto se ve, cómo cambia al arrastrar o
// ampliar, qué marco hay bajo un punto y qué cambia en la capa al poner otra foto.

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

export interface FrameBox {
  width: number;
  height: number;
}

/**
 * Parte de la foto que se ve en un marco (`cover`), en fracciones (0–1) de la
 * foto. `imageAspect` es ancho / alto de la foto tal como se dibuja (ya girada
 * o recortada). Hace las mismas cuentas que `coverCrop`, sin píxeles.
 */
export function visibleWindow(imageAspect: number, box: FrameBox, focus: { x: number; y: number }, zoom = 1) {
  const boxAspect = box.width / box.height;
  const z = clamp(zoom, 1, MAX_FRAME_ZOOM);
  const wider = boxAspect >= imageAspect;
  const width = (wider ? 1 : boxAspect / imageAspect) / z;
  const height = (wider ? imageAspect / boxAspect : 1) / z;
  return {
    x: clamp(focus.x - width / 2, 0, 1 - width),
    y: clamp(focus.y - height / 2, 0, 1 - height),
    width,
    height,
  };
}

/**
 * Punto de interés tras arrastrar la foto dentro del marco. `delta` va en
 * unidades del lienzo y en los ejes del marco (ya sin su giro): arrastrar a la
 * derecha enseña lo que había a la izquierda. Nunca deja ver fuera de la foto.
 */
export function panFrame(
  imageAspect: number,
  box: FrameBox,
  focus: { x: number; y: number },
  zoom: number,
  delta: { dx: number; dy: number },
): { x: number; y: number } {
  const view = visibleWindow(imageAspect, box, focus, zoom);
  const x = clamp(view.x - (delta.dx * view.width) / box.width, 0, 1 - view.width);
  const y = clamp(view.y - (delta.dy * view.height) / box.height, 0, 1 - view.height);
  return { x: round(x + view.width / 2), y: round(y + view.height / 2) };
}

/** Ampliación nueva, alrededor de lo que se ve ahora en el centro del marco. */
export function zoomFrame(
  imageAspect: number,
  box: FrameBox,
  focus: { x: number; y: number },
  zoom: number,
  next: number,
): { focus: { x: number; y: number }; zoom: number | undefined } {
  const view = visibleWindow(imageAspect, box, focus, zoom);
  const target = Math.round(clamp(next, 1, MAX_FRAME_ZOOM) * 100) / 100;
  return {
    focus: { x: round(view.x + view.width / 2), y: round(view.y + view.height / 2) },
    zoom: target > 1 ? target : undefined,
  };
}

/** ¿Está el punto (unidades del lienzo) dentro de la caja de la capa, contando su giro? */
export function layerContains(
  layer: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  point: { x: number; y: number },
): boolean {
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(localX) <= layer.width / 2 && Math.abs(localY) <= layer.height / 2;
}

/**
 * El marco que recibe una foto soltada en ese punto: el de más arriba que lo
 * contenga, visible y sin bloquear. Una imagen que no es un marco no cuenta
 * (una foto soltada sobre ella se añade aparte). Null si no hay ninguno.
 */
export function frameAt(layers: readonly Layer[], point: { x: number; y: number }): ImageLayer | null {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index]!;
    if (layer.type !== 'image' || !layer.visible || layer.locked || !isFrame(layer)) continue;
    if (layerContains(layer, point)) return layer;
  }
  return null;
}

/**
 * A qué marco va una foto que se añade sin decir dónde (botón «Imagen», pegar):
 * al marco vacío elegido o, si no hay ninguno elegido, al primer marco vacío de
 * la página (el de más al fondo). Null: se añade como capa nueva.
 */
export function frameToFill(layers: readonly Layer[], selectedIds: readonly string[]): ImageLayer | null {
  const usable = layers.filter(
    (layer): layer is ImageLayer => layer.type === 'image' && isEmptyFrame(layer) && layer.visible && !layer.locked,
  );
  return usable.find((layer) => selectedIds.includes(layer.id)) ?? usable[0] ?? null;
}

/** Marcos sin foto de todo el documento, con la página (desde 0) en que está cada uno. */
export function emptyFramesOf(document: ContentDocument): { layer: ImageLayer; page: number }[] {
  const found: { layer: ImageLayer; page: number }[] = [];
  document.pages.forEach((page, index) => {
    for (const layer of page.layers) {
      if (layer.type === 'image' && isEmptyFrame(layer) && layer.visible) found.push({ layer, page: index });
    }
  });
  return found;
}

/**
 * Cambio que pone otra foto en una capa: se conservan la caja, el encaje y los
 * efectos (luz y color, filtro, sombra, fondo, desenfoque); lo que era de la
 * foto anterior (recorte, giro, volteo, enderezado, encuadre y ampliación) se quita.
 */
export function replacePhotoPatch(assetId: string): LayerPatch {
  return {
    source: { kind: 'asset', assetId },
    focus: { x: 0.5, y: 0.5 },
    zoom: undefined,
    crop: undefined,
    turn: undefined,
    flipX: undefined,
    flipY: undefined,
    straighten: undefined,
  };
}

/** Cambio que quita la foto de una capa y deja su hueco (un marco vacío con la misma caja y efectos). */
export function emptyFramePatch(): LayerPatch {
  return {
    source: { kind: 'empty' },
    frame: true,
    fit: 'cover',
    focus: { x: 0.5, y: 0.5 },
    zoom: undefined,
    crop: undefined,
    turn: undefined,
    flipX: undefined,
    flipY: undefined,
    straighten: undefined,
  };
}

const base = { rotation: 0, opacity: 1, visible: true, locked: false } as const;

/**
 * Foto nueva encima de un diseño que ya tiene cosas: con su proporción, ocupando
 * como mucho el 70 % del lienzo y centrada en `at` (o en el centro), sin salirse.
 * Así no tapa el resto, que es lo que pasaba al entrar a lienzo completo.
 */
export function newPhotoLayer(
  canvas: Canvas,
  layers: readonly Layer[],
  asset: { id: string; name: string; width?: number | null; height?: number | null },
  at?: { x: number; y: number },
): ImageLayer {
  const aspect = asset.width && asset.height ? asset.width / asset.height : canvas.width / canvas.height;
  const maxWidth = canvas.width * 0.7;
  const maxHeight = canvas.height * 0.7;
  const width = Math.round(Math.min(maxWidth, maxHeight * aspect));
  const height = Math.round(width / aspect);
  const center = at ?? { x: canvas.width / 2, y: canvas.height / 2 };
  return {
    ...base,
    id: newLayerId(layers),
    type: 'image',
    name: asset.name.slice(0, 120),
    x: Math.round(clamp(center.x - width / 2, 0, Math.max(0, canvas.width - width))),
    y: Math.round(clamp(center.y - height / 2, 0, Math.max(0, canvas.height - height))),
    width,
    height,
    anchor: { x: 'center', y: 'center' },
    source: { kind: 'asset', assetId: asset.id },
    fit: 'cover',
    focus: { x: 0.5, y: 0.5 },
  };
}

/** Marco vacío nuevo, centrado: para preparar a mano el hueco de una plantilla. */
export function newFrameLayer(canvas: Canvas, layers: readonly Layer[]): ImageLayer {
  const side = Math.round(Math.min(canvas.width, canvas.height) * 0.6);
  return {
    ...base,
    id: newLayerId(layers),
    type: 'image',
    name: 'Foto',
    x: Math.round((canvas.width - side) / 2),
    y: Math.round((canvas.height - side) / 2),
    width: side,
    height: side,
    anchor: { x: 'center', y: 'center' },
    source: { kind: 'empty' },
    frame: true,
    fit: 'cover',
    focus: { x: 0.5, y: 0.5 },
  };
}

/** Nombre que se enseña en un marco vacío («Foto de antes», «Retrato»…); «Foto» si no tiene. */
export function frameLabel(layer: Pick<ImageLayer, 'name'>): string {
  return layer.name.trim() || 'Foto';
}

/** ¿Tiene el documento algún marco (con foto o sin ella)? */
export function hasFrames(document: ContentDocument): boolean {
  return allLayers(document).some(isFrame);
}

export interface PlainBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: PlainBox, b: PlainBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Centro del botón «Poner foto» de un marco vacío. Va en el centro del marco
 * salvo que ahí haya un texto encima (el titular de una plantilla de «titular
 * sobre foto»): entonces se prueba arriba y abajo, donde no lo tape. `covering`
 * son las cajas de los textos que están por encima del marco; `pill`, el tamaño
 * del botón, todo en unidades del lienzo.
 */
export function framePillSpot(
  frame: PlainBox,
  covering: readonly PlainBox[],
  pill: { width: number; height: number },
): { x: number; y: number } {
  const cx = frame.x + frame.width / 2;
  const at = (fraction: number) => ({ x: cx, y: frame.y + frame.height * fraction });
  const box = (spot: { x: number; y: number }): PlainBox => ({
    x: spot.x - pill.width / 2,
    y: spot.y - pill.height / 2,
    width: pill.width,
    height: pill.height,
  });
  const room = pill.height / frame.height;
  const candidates = [0.5, 0.2, 0.8, 0.1, 0.9].filter((f) => f === 0.5 || (f - room / 2 > 0.01 && f + room / 2 < 0.99));
  for (const fraction of candidates) {
    const spot = at(fraction);
    if (!covering.some((other) => overlaps(box(spot), other))) return spot;
  }
  return at(0.5);
}
