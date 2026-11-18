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
