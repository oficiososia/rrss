import Konva from 'konva/lib/Core';
import type { Context } from 'konva/lib/Context';
import type { Shape } from 'konva/lib/Shape';
import { Line } from 'konva/lib/shapes/Line';
import { Rect } from 'konva/lib/shapes/Rect';
import { Text } from 'konva/lib/shapes/Text';
import { Transformer } from 'konva/lib/shapes/Transformer';
import { containBox, coverCrop, layerToNodeBox, nodeToLayerBox, snapToCanvas, type Guides } from '../geometry';
import type { LayerPatch } from '../history';
import type { NodeSpec } from './nodes';

// Dibujo con Konva, sin React. Recibe la descripción plana de cada capa
// (nodes.ts) y crea o actualiza sus nodos; de vuelta, informa de lo que hace la
// persona (seleccionar, arrastrar, transformar) como cambios del documento.
// No guarda estado propio del documento: cada `render` deja los nodos igual que
// la descripción que recibe.

export interface SceneCallbacks {
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: LayerPatch) => void;
  onEditText: (id: string) => void;
}

export interface SceneInput {
  nodes: NodeSpec[];
  canvas: { width: number; height: number; backgroundColor: string };
  selectedId: string | null;
  readOnly: boolean;
  /** Escala de pantalla: píxeles por unidad del lienzo. */
  scale: number;
}

type AnyNode = Shape;

const SELECTION = '#2563EB';
const GUIDE = '#EC4899';

export class Scene {
  private stage: Konva.Stage;
  private background: Rect;
  private content: Konva.Layer;
  private overlay: Konva.Layer;
  private transformer: Transformer;
  private guides: Line[] = [];
  private nodes = new Map<string, AnyNode>();
  private specs = new Map<string, NodeSpec>();
  private images = new Map<string, HTMLImageElement | 'error'>();
  private input: SceneInput | null = null;

  constructor(
    container: HTMLDivElement,
    private readonly callbacks: SceneCallbacks,
  ) {
    this.stage = new Konva.Stage({ container, width: 1, height: 1 });
    this.content = new Konva.Layer();
    this.overlay = new Konva.Layer();
    this.background = new Rect({ x: 0, y: 0, name: 'background' });
    this.content.add(this.background);
    this.transformer = new Transformer({
      rotateEnabled: true,
      keepRatio: false,
      flipEnabled: false,
      borderStroke: SELECTION,
      anchorStroke: SELECTION,
      anchorSize: 10,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 ? oldBox : newBox),
    });
    this.overlay.add(this.transformer);
    this.stage.add(this.content, this.overlay);

    // Clic en el vacío o en el fondo: quitar la selección.
    this.stage.on('click tap', (event) => {
      if (event.target === this.stage || event.target === this.background) this.callbacks.onSelect(null);
    });
  }

  render(input: SceneInput): void {
    this.input = input;
    const { canvas, scale } = input;
    this.stage.size({ width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) });
    this.stage.scale({ x: scale, y: scale });
    this.background.setAttrs({ width: canvas.width, height: canvas.height, fill: canvas.backgroundColor });

    const seen = new Set<string>();
    input.nodes.forEach((spec, index) => {
      seen.add(spec.id);
      let node = this.nodes.get(spec.id);
      const previous = this.specs.get(spec.id);
      if (!node || !previous || previous.kind !== spec.kind) {
        node?.destroy();
        node = this.create(spec);
        this.nodes.set(spec.id, node);
        this.content.add(node);
      }
      this.specs.set(spec.id, spec);
      this.apply(node, spec);
      // El fondo ocupa la posición 0.
      node.zIndex(index + 1);
    });
    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.destroy();
        this.nodes.delete(id);
        this.specs.delete(id);
      }
    }

    const selected = input.selectedId ? this.nodes.get(input.selectedId) : undefined;
    const selectedSpec = input.selectedId ? this.specs.get(input.selectedId) : undefined;
    if (selected && selectedSpec?.visible) {
      this.transformer.nodes([selected]);
      const editable = selectedSpec.editable;
      this.transformer.setAttrs({
        resizeEnabled: editable,
        rotateEnabled: editable,
        borderDash: editable ? [] : [6, 4],
      });
    } else {
      this.transformer.nodes([]);
    }
    this.content.batchDraw();
    this.overlay.batchDraw();
  }

  destroy(): void {
    this.stage.destroy();
    this.nodes.clear();
    this.specs.clear();
  }

  // ── Nodos ──────────────────────────────────────────────────────────────

  private create(spec: NodeSpec): AnyNode {
    const node: AnyNode =
      spec.kind === 'text'
        ? new Text({ id: spec.id })
        : spec.kind === 'rect'
          ? new Rect({ id: spec.id })
          : new Konva.Shape({
              id: spec.id,
              sceneFunc: (context, shape) => this.drawShape(context, shape),
              hitFunc: (context, shape) => {
                context.beginPath();
                context.rect(0, 0, shape.width(), shape.height());
                context.closePath();
                context.fillStrokeShape(shape);
              },
            });

    node.on('mousedown touchstart', () => {
      if (this.input?.selectedId !== spec.id) this.callbacks.onSelect(spec.id);
    });
    node.on('dblclick dbltap', () => {
      if (this.specs.get(spec.id)?.kind === 'text') this.callbacks.onEditText(spec.id);
    });
    node.on('dragmove', () => this.snap(node));
    node.on('dragend', () => {
      this.clearGuides();
      this.emitBox(spec.id, node);
    });
    // Durante la transformación la escala se pasa a ancho y alto, para que el texto no se deforme.
    node.on('transform', () => {
      const box = nodeToLayerBox({
        x: node.x(),
        y: node.y(),
        width: node.width(),
        height: node.height(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
      });
      const next = layerToNodeBox(box);
      node.setAttrs({ ...next, scaleX: 1, scaleY: 1 });
    });
    node.on('transformend', () => this.emitBox(spec.id, node));
    return node;
  }

  private apply(node: AnyNode, spec: NodeSpec): void {
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
    } else if (spec.kind === 'image' && spec.url) {
      this.loadImage(spec.url);
    }
  }

  /** Dibujo de las elipses y de las imágenes (con su recorte o su encaje). */
  private drawShape(context: Context, shape: Shape): void {
    const spec = this.specs.get(shape.id());
    if (!spec) return;
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
    const image = spec.url ? this.images.get(spec.url) : undefined;
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

  private loadImage(url: string): void {
    if (this.images.has(url)) return;
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    this.images.set(url, image);
    image.onload = () => this.content.batchDraw();
    image.onerror = () => {
      this.images.set(url, 'error');
      this.content.batchDraw();
    };
    image.src = url;
  }

  // ── Interacción ────────────────────────────────────────────────────────

  private emitBox(id: string, node: AnyNode): void {
    const box = nodeToLayerBox({
      x: node.x(),
      y: node.y(),
      width: node.width(),
      height: node.height(),
      rotation: node.rotation(),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
    });
    this.callbacks.onChange(id, box);
  }

  /** Guías de ajuste mientras se arrastra: la capa se pega al centro y a los bordes del lienzo. */
  private snap(node: AnyNode): void {
    if (!this.input) return;
    const box = nodeToLayerBox({
      x: node.x(),
      y: node.y(),
      width: node.width(),
      height: node.height(),
      rotation: node.rotation(),
    });
    const threshold = 8 / Math.max(this.input.scale, 0.05);
    const snapped = snapToCanvas(box, this.input.canvas, threshold);
    const center = layerToNodeBox({ ...box, x: snapped.x, y: snapped.y });
    node.position({ x: center.x, y: center.y });
    this.drawGuides(snapped.guides);
  }

  private drawGuides(guides: Guides): void {
    this.clearGuides(false);
    if (!this.input) return;
    const { width, height } = this.input.canvas;
    const strokeWidth = 1 / Math.max(this.input.scale, 0.05);
    for (const x of guides.vertical) {
      this.guides.push(new Line({ points: [x, 0, x, height], stroke: GUIDE, strokeWidth, dash: [6, 4] }));
    }
    for (const y of guides.horizontal) {
      this.guides.push(new Line({ points: [0, y, width, y], stroke: GUIDE, strokeWidth, dash: [6, 4] }));
    }
    for (const line of this.guides) this.overlay.add(line);
    this.overlay.batchDraw();
  }

  private clearGuides(draw = true): void {
    for (const line of this.guides) line.destroy();
    this.guides = [];
    if (draw) this.overlay.batchDraw();
  }
}
