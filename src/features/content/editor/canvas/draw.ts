import type { Context } from 'konva/lib/Context';
import type { Shape } from 'konva/lib/Shape';
import { containBox, coverCrop } from '../geometry';
import type { NodeSpec } from './nodes';

// Dibujo de cada tipo de nodo, común al lienzo del editor (`scene.ts`) y a la
// exportación (`exporter.ts`): así lo que se exporta se dibuja con el mismo
// código que lo que se ve. Sin estado ni interacción.

/** Una imagen ya cargada, 'error' si falló, o undefined si aún no se ha pedido. */
export type LoadedImage = HTMLImageElement | 'error' | undefined;

/** Atributos de Konva que corresponden a la descripción del nodo. */
export function applySpecAttrs(node: Shape, spec: NodeSpec): void {
  node.setAttrs({
    ...spec.box,
    scaleX: 1,
    scaleY: 1,
    opacity: spec.opacity,
    visible: spec.visible,
    draggable: spec.editable,
  });
  if (spec.kind === 'text') {
    node.setAttrs({
      text: spec.text,
      fontFamily: spec.fontFamily,
      fontSize: spec.fontSize,
      fontStyle: spec.fontStyle,
      fill: spec.fill,
      align: spec.align,
      lineHeight: spec.lineHeight,
      wrap: 'word',
      verticalAlign: 'top',
    });
  } else if (spec.kind === 'rect') {
    node.setAttrs({
      fill: spec.fill ?? undefined,
      stroke: spec.stroke?.color,
      strokeWidth: spec.stroke?.width ?? 0,
      strokeEnabled: Boolean(spec.stroke),
      cornerRadius: spec.cornerRadius,
    });
  } else if (spec.kind === 'ellipse') {
    node.setAttrs({
      fill: spec.fill ?? undefined,
      stroke: spec.stroke?.color,
      strokeWidth: spec.stroke?.width ?? 0,
      strokeEnabled: Boolean(spec.stroke),
    });
  }
}

/** Dibujo de las elipses y de las imágenes (con su recorte o su encaje). */
export function drawSpecShape(context: Context, shape: Shape, spec: NodeSpec, image: LoadedImage): void {
  const width = shape.width();
  const height = shape.height();
  if (spec.kind === 'ellipse') {
    context.beginPath();
    context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.closePath();
    context.fillStrokeShape(shape);
    return;
  }
  if (spec.kind !== 'image') return;
  if (image instanceof HTMLImageElement && image.naturalWidth > 0) {
    if (spec.blur > 0) {
      drawBlurredImage(context._context, image, spec, width, height);
      return;
    }
    const natural = { width: image.naturalWidth, height: image.naturalHeight };
    if (spec.fit === 'cover') {
      const crop = coverCrop(natural, { width, height }, spec.focus);
      context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    } else {
      const box = containBox(natural, { width, height });
      context.drawImage(image, box.x, box.y, box.width, box.height);
    }
    return;
  }
  // Marcador mientras la imagen no está (cargando, sin acceso o generación sin conectar).
  const native = context._context;
  native.save();
  native.fillStyle = 'rgba(148, 163, 184, 0.35)';
  native.fillRect(0, 0, width, height);
  native.strokeStyle = 'rgba(100, 116, 139, 0.8)';
  native.setLineDash([12, 8]);
  native.lineWidth = 2;
  native.strokeRect(1, 1, width - 2, height - 2);
  native.fillStyle = 'rgba(51, 65, 85, 0.9)';
  native.font = `${Math.max(14, Math.min(width, height) / 10)}px sans-serif`;
  native.textAlign = 'center';
  native.textBaseline = 'middle';
  const label = image === 'error' ? `${spec.placeholder} no disponible` : spec.placeholder;
  native.fillText(label, width / 2, height / 2, width * 0.9);
  native.restore();
}

/** Escala del contexto respecto a las unidades del lienzo (zoom del editor × densidad de la pantalla). */
function contextScale(native: CanvasRenderingContext2D): number {
  const matrix = typeof native.getTransform === 'function' ? native.getTransform() : null;
  return matrix ? Math.hypot(matrix.a, matrix.b) || 1 : 1;
}

/** ¿Admite el navegador `filter` en el lienzo 2D? (Safari antiguo no.) */
function supportsCanvasFilter(native: CanvasRenderingContext2D): boolean {
  return typeof native.filter === 'string';
}

/**
 * Imagen desenfocada dentro de su caja. El desenfoque oscurece y transparenta
 * los bordes; para que no se note, la imagen se dibuja un poco más grande que
 * la caja (el doble del radio por cada lado) y se recorta a la caja.
 *
 * El radio va en unidades del lienzo; el filtro del navegador trabaja en
 * píxeles reales, así que se multiplica por la escala del contexto (el mismo
 * dibujo vale para el editor ampliado y para la exportación a 2160 px). Sin
 * `filter` (Safari antiguo), se aproxima reduciendo y volviendo a ampliar.
 */
function drawBlurredImage(
  native: CanvasRenderingContext2D,
  image: HTMLImageElement,
  spec: Extract<NodeSpec, { kind: 'image' }>,
  width: number,
  height: number,
): void {
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const margin = spec.blur * 2;
  const outer = { width: width + margin * 2, height: height + margin * 2 };
  native.save();
  native.beginPath();
  native.rect(0, 0, width, height);
  native.clip();
  const scale = contextScale(native);
  const draw = (target: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    if (spec.fit === 'cover') {
      const crop = coverCrop(natural, { width: w, height: h }, spec.focus);
      target.drawImage(image, crop.x, crop.y, crop.width, crop.height, x, y, w, h);
    } else {
      const box = containBox(natural, { width: w, height: h });
      target.drawImage(image, x + box.x, y + box.y, box.width, box.height);
    }
  };
  if (supportsCanvasFilter(native)) {
    native.filter = `blur(${Math.max(0.5, spec.blur * scale).toFixed(2)}px)`;
    draw(native, -margin, -margin, outer.width, outer.height);
  } else {
    // Aproximación: a 1/(radio) del tamaño y de vuelta, con suavizado.
    const factor = Math.max(1, spec.blur * scale);
    const small = window.document.createElement('canvas');
    small.width = Math.max(1, Math.round((outer.width * scale) / factor));
    small.height = Math.max(1, Math.round((outer.height * scale) / factor));
    const smallContext = small.getContext('2d');
    if (smallContext) {
      draw(smallContext, 0, 0, small.width, small.height);
      native.imageSmoothingEnabled = true;
      native.drawImage(small, -margin, -margin, outer.width, outer.height);
    }
  }
  native.restore();
}
