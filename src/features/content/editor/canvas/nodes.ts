import type { ContentDocument, Layer } from '../../document';
import { layerToNodeBox, type NodeBox } from '../geometry';

// Descripción plana, sin Konva, de lo que hay que dibujar por cada capa. Es la
// mitad «documento → nodos» de la traducción: `scene.ts` crea y actualiza los
// nodos de Konva a partir de esto. Al ser datos puros, se prueba sin lienzo y
// sirve igual al dibujo del servidor cuando llegue.

/** De dónde sale la dirección web de cada recurso de la biblioteca (por id). */
export type ImageLookup = ReadonlyMap<string, string>;

interface NodeCommon {
  id: string;
  box: NodeBox;
  opacity: number;
  visible: boolean;
  /** Se puede arrastrar y transformar (no está bloqueada y el editor no es de solo lectura). */
  editable: boolean;
}

export type NodeSpec =
  | (NodeCommon & {
      kind: 'text';
      text: string;
      fontFamily: string;
      fontSize: number;
      /** Como lo entiende Konva y el lienzo: «italic 700», «400»… */
      fontStyle: string;
      fill: string;
      align: 'left' | 'center' | 'right';
      lineHeight: number;
    })
  | (NodeCommon & {
      kind: 'image';
      /** null si todavía no hay dirección (recurso sin cargar o generación de IA aún sin conectar). */
      url: string | null;
      fit: 'cover' | 'contain';
      focus: { x: number; y: number };
      /** Texto del marcador mientras no hay imagen. */
      placeholder: string;
    })
  | (NodeCommon & {
      kind: 'rect' | 'ellipse';
      fill: string | null;
      stroke: { color: string; width: number } | null;
      cornerRadius: number;
    });

export function fontStyleOf(weight: number, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${weight}`;
}

export function describeLayer(layer: Layer, images: ImageLookup, readOnly = false): NodeSpec {
  const common: NodeCommon = {
    id: layer.id,
    box: layerToNodeBox(layer),
    opacity: layer.opacity,
    visible: layer.visible,
    editable: !readOnly && !layer.locked,
  };
  switch (layer.type) {
    case 'text':
      return {
        ...common,
        kind: 'text',
        text: layer.text,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize,
        fontStyle: fontStyleOf(layer.fontWeight, layer.italic),
        fill: layer.color,
        align: layer.align,
        lineHeight: layer.lineHeight,
      };
    case 'image':
      return {
        ...common,
        kind: 'image',
        url: layer.source.kind === 'asset' ? (images.get(layer.source.assetId) ?? null) : null,
        fit: layer.fit,
        focus: layer.focus,
        placeholder: layer.source.kind === 'asset' ? 'Imagen' : 'Imagen generada',
      };
    case 'logo':
      return {
        ...common,
        kind: 'image',
        url: images.get(layer.assetId) ?? null,
        fit: 'contain',
        focus: { x: 0.5, y: 0.5 },
        placeholder: 'Logotipo',
      };
    case 'shape':
      return {
        ...common,
        kind: layer.shape === 'ellipse' ? 'ellipse' : 'rect',
        fill: layer.fill,
        stroke: layer.stroke,
        cornerRadius: layer.shape === 'rectangle' ? layer.cornerRadius : 0,
      };
  }
}

/** Nodos del documento, del fondo al frente (el orden del array de capas). */
export function describeDocument(document: ContentDocument, images: ImageLookup, readOnly = false): NodeSpec[] {
  return document.layers.map((layer) => describeLayer(layer, images, readOnly));
}

/** Identificadores de la biblioteca que el documento necesita para dibujarse. */
export function assetIdsOf(document: ContentDocument): string[] {
  const ids = new Set<string>();
  for (const layer of document.layers) {
    if (layer.type === 'image' && layer.source.kind === 'asset') ids.add(layer.source.assetId);
    if (layer.type === 'logo') ids.add(layer.assetId);
  }
  return [...ids].sort();
}
