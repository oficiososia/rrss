import Konva from 'konva/lib/Core';
import type { Context } from 'konva/lib/Context';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from 'konva/lib/Shape';
import { Line } from 'konva/lib/shapes/Line';
import { Rect } from 'konva/lib/shapes/Rect';
import { Text } from 'konva/lib/shapes/Text';
import { Transformer } from 'konva/lib/shapes/Transformer';
import type { Rect as Bounds } from '../../safeZones';
import { layersInRect, normalizeRect, snapBox, snapGroup, snapTargets } from '../arrange';
import { framePillSpot, layerContains } from '../frames';
import { layerToNodeBox, nodeToLayerBox, type Guides } from '../geometry';
import type { LayerPatch } from '../history';
import { ImageStore } from './imageStore';
import { editKey, editNeedsPixels } from '../imageEffects/imageEdit';
import { BitmapCache, EDITOR_BITMAP_SIDE, prepareBitmap } from '../imageEffects/prepare';
import { applySpecAttrs, drawFramePill, drawSpecShape, FRAME_PILL, framePillWidth, type LoadedImage } from './draw';
import type { NodeSpec } from './nodes';
import type { SafeZoneOverlay, SelectOptions } from './types';

// Dibujo con Konva, sin React. Recibe la descripción plana de cada capa
// (nodes.ts) y crea o actualiza sus nodos; de vuelta, informa de lo que hace la
// persona (seleccionar, arrastrar, transformar) como cambios del documento.
// No guarda estado propio del documento: cada `render` deja los nodos igual que
// la descripción que recibe.

export interface SceneCallbacks {
  onSelect: (id: string | null, options?: SelectOptions) => void;
  onSelectMany: (ids: string[], additive: boolean) => void;
  onChange: (changes: { id: string; patch: LayerPatch }[]) => void;
  onEditText: (id: string) => void;
  /** Clic (sin arrastrar) en un marco de foto vacío: poner su foto. */
  onFrameClick?: (id: string) => void;
  /** Doble clic en una foto: recolocarla o ampliarla dentro de su caja. */
  onEditImage?: (id: string) => void;
  /** Botón derecho (o pulsación larga): `id` es la capa bajo el puntero, o null en el fondo. */
  onContextMenu?: (target: { id: string | null; clientX: number; clientY: number }) => void;
  /** Empieza o termina un arrastre, giro o cambio de tamaño (para esconder lo que flota encima). */
  onGesture?: (active: boolean) => void;
}

export interface SceneInput {
  nodes: NodeSpec[];
  canvas: { width: number; height: number; backgroundColor: string };
  selectedIds: string[];
  /** Texto que se edita encima del lienzo: su nodo no se dibuja mientras tanto. */
  editingId: string | null;
  safeZone: SafeZoneOverlay | null;
  readOnly: boolean;
  /** Escala de pantalla: píxeles por unidad del lienzo. */
  scale: number;
  /** Marco sobre el que se está arrastrando una foto (se resalta); null si ninguno. */
  dropTargetId?: string | null;
  /**
   * Margen alrededor del lienzo, en píxeles de pantalla, en el que se ve lo que sobresale (como en
   * Canva): velado, con su caja y sus tiradores, y se puede agarrar. Lo que se exporta sigue siendo
   * solo el lienzo. Sin margen, como antes.
   */
  bleed?: { x: number; y: number };
  /** Color del velo de fuera del lienzo (el del fondo del área), en CSS. */
  veil?: string;
}

type AnyNode = Shape;

const SELECTION = '#2563EB';
const GUIDE = '#EC4899';
const UNSAFE = 'rgba(220, 38, 38, 0.18)';
const UNSAFE_LINE = 'rgba(220, 38, 38, 0.85)';
/** Distancia, en píxeles, del tirador de girar al borde de abajo de la selección. */
export const ROTATE_ANCHOR_OFFSET = 28;

const boxOf = (node: AnyNode) =>
  nodeToLayerBox({
    x: node.x(),
    y: node.y(),
    width: node.width(),
    height: node.height(),
    rotation: node.rotation(),
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
  });

const specBox = (spec: NodeSpec) => ({
  x: spec.box.x - spec.box.offsetX,
  y: spec.box.y - spec.box.offsetY,
  width: spec.box.width,
  height: spec.box.height,
  rotation: spec.box.rotation,
});

const withModifier = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
  const native = event.evt as MouseEvent;
  return Boolean(native.shiftKey || native.ctrlKey || native.metaKey);
};

export class Scene {
  private stage: Konva.Stage;
  private background: Rect;
  private content: Konva.Layer;
  private overlay: Konva.Layer;
  private transformer: Transformer;
  private guides: Line[] = [];
  private dragStart: { origin: { x: number; y: number }; ids: Set<string>; boxes: ReturnType<typeof boxOf>[] } | null =
    null;
  private zone: Konva.Shape[] = [];
  private dropMark: Rect;
  /** Botón «Poner foto» de cada marco vacío: va en la capa de encima para que nada lo tape. */
  private pills = new Map<string, Konva.Shape>();
  private marquee: Rect;
  private marqueeStart: { x: number; y: number; additive: boolean } | null = null;
  private nodes = new Map<string, AnyNode>();
  private specs = new Map<string, NodeSpec>();
  private images = new ImageStore(() => this.content.batchDraw());
  private bitmaps = new BitmapCache();
  private input: SceneInput | null = null;
  private pendingEmit = false;
  /** Velo de lo que queda fuera del lienzo: se ve, pero se nota que no sale en la imagen. */
  private veil: Konva.Shape;

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
      anchorSize: typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 22 : 10,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      // El tirador de girar va debajo: encima queda libre para la barra de acciones del elemento.
      rotateAnchorAngle: 180,
      rotateAnchorOffset: ROTATE_ANCHOR_OFFSET,
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 ? oldBox : newBox),
    });
    // Konva avisa del final de la transformación al transformador y a cada nodo:
    // se escucha solo aquí para mandar un único cambio con todas las capas.
    this.transformer.on('transformstart', () => this.callbacks.onGesture?.(true));
    this.transformer.on('transformend', () => {
      this.callbacks.onGesture?.(false);
      this.emitNodes(this.transformer.nodes() as AnyNode[]);
    });
    this.dropMark = new Rect({ visible: false, stroke: SELECTION, fill: 'rgba(37, 99, 235, 0.14)', listening: false });
    this.marquee = new Rect({
      visible: false,
      fill: 'rgba(37, 99, 235, 0.08)',
      stroke: SELECTION,
      dash: [6, 4],
      listening: false,
    });
    this.veil = new Konva.Shape({
      listening: false,
      sceneFunc: (context) => {
        const input = this.input;
        const bleed = input?.bleed;
        if (!input || !bleed || (bleed.x <= 0 && bleed.y <= 0)) return;
        const scale = Math.max(input.scale, 0.0001);
        const bx = bleed.x / scale;
        const by = bleed.y / scale;
        const { width, height } = input.canvas;
        const ctx = context._context;
        ctx.save();
        ctx.fillStyle = input.veil ?? 'rgba(241, 243, 246, 0.72)';
        ctx.beginPath();
        // Todo el margen menos el lienzo (regla par-impar): queda un marco velado alrededor.
        ctx.rect(-bx, -by, width + 2 * bx, height + 2 * by);
        ctx.rect(0, 0, width, height);
        ctx.fill('evenodd');
        ctx.restore();
      },
    });
    this.overlay.add(this.veil, this.transformer, this.dropMark, this.marquee);
    this.stage.add(this.content, this.overlay);

    // Botón derecho: menú de la capa bajo el puntero (o del lienzo, en el fondo).
    this.stage.on('contextmenu', (event) => {
      if (!this.callbacks.onContextMenu) return;
      event.evt.preventDefault();
      const id = this.nodes.has(event.target.id()) ? event.target.id() : null;
      this.callbacks.onContextMenu({ id, clientX: event.evt.clientX, clientY: event.evt.clientY });
    });

    // En el vacío o en el fondo: rectángulo de selección; un clic sin arrastrar quita la selección.
    this.stage.on('mousedown touchstart', (event) => {
      if (event.target !== this.stage && event.target !== this.background) return;
      const point = this.pointer();
      if (!point) return;
      this.marqueeStart = { ...point, additive: withModifier(event) };
    });
    this.stage.on('mousemove touchmove', () => {
      if (!this.marqueeStart) return;
      const point = this.pointer();
      if (!point) return;
      const rect = normalizeRect(this.marqueeStart, point);
      const strokeWidth = 1 / Math.max(this.input?.scale ?? 1, 0.05);
      this.marquee.setAttrs({
        visible: true,
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        strokeWidth,
        dash: [6 * strokeWidth, 4 * strokeWidth],
      });
      this.overlay.batchDraw();
    });
    this.stage.on('mouseup touchend', () => this.finishMarquee());
  }

  render(input: SceneInput): void {
    this.input = input;
    const { canvas, scale } = input;
    const bleed = input.bleed ?? { x: 0, y: 0 };
    this.stage.size({
      width: Math.round(canvas.width * scale + 2 * bleed.x),
      height: Math.round(canvas.height * scale + 2 * bleed.y),
    });
    this.stage.scale({ x: scale, y: scale });
    // El lienzo empieza tras el margen: (0, 0) del documento queda en (bleed.x, bleed.y) de la pantalla.
    this.stage.position({ x: bleed.x, y: bleed.y });
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
      // Mientras se edita encima, el texto del lienzo no se ve (lo sustituye el campo).
      if (spec.id === input.editingId) node.visible(false);
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

    this.renderSelection(input);
    this.renderSafeZone(input);
    this.renderFramePills(input);
    this.renderDropTarget(input);
    this.content.batchDraw();
    this.overlay.batchDraw();
  }

  /**
   * Lo que se ve ahora (sin selección ni guías si no las hay) a una escala dada. Lo usan las pruebas de
   * navegador para comparar el lienzo con la exportación.
   */
  snapshot(pixelRatio = 1): HTMLCanvasElement {
    const bleed = this.input?.bleed ?? { x: 0, y: 0 };
    const scale = this.input?.scale ?? 1;
    const canvas = this.input?.canvas ?? { width: this.stage.width(), height: this.stage.height() };
    // Solo el lienzo, sin el margen ni su velo.
    this.veil.visible(false);
    try {
      return this.stage.toCanvas({
        pixelRatio,
        x: bleed.x,
        y: bleed.y,
        width: Math.round(canvas.width * scale),
        height: Math.round(canvas.height * scale),
      });
    } finally {
      this.veil.visible(true);
    }
  }

  /**
   * Proporción (ancho / alto) de la foto de una capa tal como se dibuja (ya
   * girada o recortada); null si aún no se ha cargado. La usa el encuadre dentro del marco.
   */
  imageAspect(id: string): number | null {
    const spec = this.specs.get(id);
    if (!spec) return null;
    const image = this.imageFor(spec);
    if (image instanceof HTMLImageElement) {
      return image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : null;
    }
    if (image instanceof HTMLCanvasElement)
      return image.width > 0 && image.height > 0 ? image.width / image.height : null;
    return null;
  }

  destroy(): void {
    this.stage.destroy();
    this.pills.clear();
    this.nodes.clear();
    this.specs.clear();
    this.bitmaps.clear();
    this.images.destroy();
  }

  // ── Selección y zona segura ────────────────────────────────────────────

  private renderSelection(input: SceneInput): void {
    const chosen = input.selectedIds
      .filter((id) => id !== input.editingId)
      .flatMap((id) => {
        const node = this.nodes.get(id);
        const spec = this.specs.get(id);
        return node && spec?.visible ? [{ node, spec }] : [];
      });
    // Con varias, las bloqueadas no entran en el transformador (no deben moverse con las demás).
    const attached = chosen.length > 1 ? chosen.filter((item) => item.spec.editable) : chosen;
    this.transformer.nodes(attached.map((item) => item.node));
    const editable = attached.length > 0 && attached.every((item) => item.spec.editable);
    this.transformer.setAttrs({
      resizeEnabled: editable,
      rotateEnabled: editable,
      borderDash: editable ? [] : [6, 4],
    });
  }

  /**
   * El botón «Poner foto» de cada marco vacío, encima de todo el diseño: en una
   * plantilla de «titular sobre foto» el hueco queda debajo de un velo y de los
   * textos, y ahí dentro no se vería ni se podría pulsar. Mide lo mismo en
   * pantalla con cualquier zoom; si el hueco es muy pequeño, queda solo la cruz.
   */
  private renderFramePills(input: SceneInput): void {
    const unit = 1 / Math.max(input.scale, 0.05);
    const wanted = new Set<string>();
    input.nodes.forEach((spec, index) => {
      if (spec.kind !== 'image' || spec.frame !== 'empty' || !spec.visible || !spec.editable) return;
      wanted.add(spec.id);
      const frame = specBox(spec);
      // Ancho aproximado del texto (se mide de verdad al dibujar): basta para decidir si cabe.
      const full = framePillWidth(FRAME_PILL.font * 5.4, false) * unit;
      const compact = full > frame.width * 0.94;
      const width = (compact ? FRAME_PILL.height : full / unit) * unit;
      const height = FRAME_PILL.height * unit;
      const covering = input.nodes
        .slice(index + 1)
        .filter((other) => other.kind === 'text' && other.visible)
        .map(specBox);
      const spot = framePillSpot(frame, covering, { width, height });
      let pill = this.pills.get(spec.id);
      if (!pill) {
        pill = new Konva.Shape({
          name: 'frame-pill',
          sceneFunc: (context, shape) =>
            drawFramePill(context._context, shape.getAttr('unit'), shape.getAttr('compact')),
          hitFunc: (context, shape) => {
            context.beginPath();
            context.rect(-shape.width() / 2, -shape.height() / 2, shape.width(), shape.height());
            context.closePath();
            context.fillStrokeShape(shape);
          },
        });
        const id = spec.id;
        pill.on('click tap', (event) => {
          if ((event.evt as MouseEvent).button > 0) return;
          this.callbacks.onSelect(id);
          this.callbacks.onFrameClick?.(id);
        });
        pill.on('mouseenter', () => (this.stage.container().style.cursor = 'pointer'));
        pill.on('mouseleave', () => (this.stage.container().style.cursor = ''));
        this.pills.set(spec.id, pill);
        this.overlay.add(pill);
      }
      // El desplazamiento respecto al centro del marco se guarda para que el botón lo siga al arrastrarlo.
      const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
      pill.setAttrs({
        x: spot.x,
        y: spot.y,
        width,
        height,
        unit,
        compact,
        dx: spot.x - center.x,
        dy: spot.y - center.y,
        visible: spec.id !== input.dropTargetId,
      });
      pill.moveToBottom();
    });
    for (const [id, pill] of this.pills) {
      if (!wanted.has(id)) {
        pill.destroy();
        this.pills.delete(id);
      }
    }
  }

  /** Mientras se arrastra o se transforma un marco vacío, su botón va con él. */
  private followPill(node: AnyNode): void {
    const pill = this.pills.get(node.id());
    if (!pill) return;
    pill.position({ x: node.x() + (pill.getAttr('dx') ?? 0), y: node.y() + (pill.getAttr('dy') ?? 0) });
  }

  /** La foto (con encaje «llenar» y sin bloquear) que hay justo debajo de una capa en ese punto, si la hay. */
  private imageBelow(id: string, point: { x: number; y: number }): string | null {
    const order = this.input?.nodes ?? [];
    const from = order.findIndex((spec) => spec.id === id);
    for (let index = from - 1; index >= 0; index--) {
      const spec = order[index]!;
      if (spec.kind !== 'image' || !spec.visible || !spec.editable) continue;
      if (layerContains(specBox(spec), point)) return spec.id;
    }
    return null;
  }

  /** Resalta el marco que va a recibir la foto que se está arrastrando. */
  private renderDropTarget(input: SceneInput): void {
    const spec = input.dropTargetId ? this.specs.get(input.dropTargetId) : undefined;
    if (!spec) {
      this.dropMark.visible(false);
      return;
    }
    this.dropMark.setAttrs({
      ...spec.box,
      visible: true,
      strokeWidth: 4 / Math.max(input.scale, 0.05),
    });
    this.dropMark.moveToTop();
  }

  private renderSafeZone(input: SceneInput): void {
    for (const shape of this.zone) shape.destroy();
    this.zone = [];
    if (!input.safeZone) return;
    const strokeWidth = 2 / Math.max(input.scale, 0.05);
    for (const rect of input.safeZone.unsafe) {
      this.zone.push(
        new Rect({
          x: rect.left,
          y: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          fill: UNSAFE,
          listening: false,
        }),
      );
    }
    const safe = input.safeZone.safe;
    this.zone.push(
      new Rect({
        x: safe.left,
        y: safe.top,
        width: safe.right - safe.left,
        height: safe.bottom - safe.top,
        stroke: UNSAFE_LINE,
        strokeWidth,
        dash: [8 * strokeWidth, 6 * strokeWidth],
        listening: false,
      }),
    );
    for (const shape of this.zone) {
      this.overlay.add(shape);
      shape.moveToBottom();
    }
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

    node.on('mousedown touchstart', (event) => {
      const selected = this.input?.selectedIds ?? [];
      if (withModifier(event)) {
        // Con Mayúsculas no se arrastra: solo se añade o se quita de la selección.
        node.stopDrag();
        this.callbacks.onSelect(spec.id, { toggle: true });
      } else if (!selected.includes(spec.id)) {
        this.callbacks.onSelect(spec.id);
      }
    });
    node.on('dblclick dbltap', () => {
      const current = this.specs.get(spec.id);
      if (!current?.editable) return;
      if (current.kind === 'text') this.callbacks.onEditText(spec.id);
      else if (current.kind === 'image') {
        if (current.frame !== 'empty') this.callbacks.onEditImage?.(spec.id);
      } else {
        // Doble clic en una forma (el velo de una plantilla) que tapa una foto: es la foto lo que se quiere encuadrar.
        const point = this.pointer();
        const below = point ? this.imageBelow(spec.id, point) : null;
        if (below) this.callbacks.onEditImage?.(below);
      }
    });
    // Un clic sin arrastrar en un marco vacío pide su foto (arrastrarlo lo mueve, como cualquier capa).
    node.on('click tap', (event) => {
      const current = this.specs.get(spec.id);
      if ((event.evt as MouseEvent).button > 0 || withModifier(event)) return;
      if (current?.kind === 'image' && current.frame === 'empty' && current.editable) {
        this.callbacks.onFrameClick?.(spec.id);
      }
    });
    node.on('dragstart', () => {
      this.callbacks.onGesture?.(true);
      this.startGroupDrag(node);
    });
    node.on('dragmove', () => {
      this.snap(node);
      this.followPill(node);
    });
    node.on('dragend', () => {
      this.callbacks.onGesture?.(false);
      this.dragStart = null;
      this.clearGuides();
      const attached = this.transformer.nodes() as AnyNode[];
      // Con varias, Konva arrastra todas y avisa por cada una: un solo cambio con todas.
      this.emitNodes(attached.length > 1 && attached.includes(node) ? attached : [node]);
    });
    // Durante la transformación la escala se pasa a ancho y alto, para que el texto no se deforme.
    node.on('transform', () => {
      const next = layerToNodeBox(boxOf(node));
      node.setAttrs({ ...next, scaleX: 1, scaleY: 1 });
      this.followPill(node);
    });
    return node;
  }

  private apply(node: AnyNode, spec: NodeSpec): void {
    applySpecAttrs(node, spec);
  }

  private drawShape(context: Context, shape: Shape): void {
    const spec = this.specs.get(shape.id());
    if (!spec) return;
    drawSpecShape(context, shape, spec, this.imageFor(spec));
  }

  /** La foto de la capa: tal cual, o ya editada con el mismo código que usa la exportación. */
  private imageFor(spec: NodeSpec): LoadedImage {
    if (spec.kind !== 'image' || !spec.url) return undefined;
    const base = this.images.get(spec.url);
    if (!(base instanceof HTMLImageElement) || !spec.edit) return base;
    if (editNeedsPixels(spec.edit) && !this.images.isReadable(spec.url)) return base;
    const key = `${spec.url}|${editKey(spec.edit)}`;
    let bitmap = this.bitmaps.get(key);
    if (!bitmap) {
      try {
        bitmap = prepareBitmap(base, spec.edit, EDITOR_BITMAP_SIDE);
      } catch {
        // El navegador no deja leer la foto: se ve sin editar (la exportación avisará).
        return base;
      }
      this.bitmaps.set(key, bitmap);
    }
    return bitmap;
  }

  // ── Interacción ────────────────────────────────────────────────────────

  /** Manda las cajas de varios nodos como un solo cambio; si llegan varios avisos seguidos, solo el primero. */
  private emitNodes(nodes: AnyNode[]): void {
    if (nodes.length === 0 || this.pendingEmit) return;
    this.pendingEmit = true;
    queueMicrotask(() => {
      this.pendingEmit = false;
    });
    // Al soltar, la posición y el tamaño quedan en números enteros (sin 12,3456 en el panel).
    this.callbacks.onChange(
      nodes.map((node) => {
        const box = boxOf(node);
        return {
          id: node.id(),
          patch: {
            ...box,
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.max(1, Math.round(box.width)),
            height: Math.max(1, Math.round(box.height)),
          },
        };
      }),
    );
  }

  private pointer(): { x: number; y: number } | null {
    if (!this.input) return null;
    // En unidades del documento, descontando el margen y la escala del escenario.
    return this.stage.getRelativePointerPosition();
  }

  private finishMarquee(): void {
    const start = this.marqueeStart;
    this.marqueeStart = null;
    if (!start) return;
    const end = this.pointer() ?? start;
    this.marquee.visible(false);
    this.overlay.batchDraw();
    const rect: Bounds = normalizeRect(start, end);
    const dragged = rect.right - rect.left >= 4 || rect.bottom - rect.top >= 4;
    if (!dragged) {
      if (!start.additive) this.callbacks.onSelect(null);
      return;
    }
    const layers = [...this.specs.values()].map((spec) => ({
      id: spec.id,
      ...specBox(spec),
      visible: spec.visible,
      locked: !spec.editable,
    }));
    this.callbacks.onSelectMany(layersInRect(layers, rect), start.additive);
  }

  /** Con varias capas elegidas, dónde estaban todas al empezar a arrastrar (para calcular su caja conjunta). */
  private startGroupDrag(node: AnyNode): void {
    const attached = this.transformer.nodes() as AnyNode[];
    this.dragStart =
      attached.length > 1 && attached.includes(node)
        ? {
            origin: { x: node.x(), y: node.y() },
            ids: new Set(attached.map((n) => n.id())),
            boxes: attached.map(boxOf),
          }
        : null;
  }

  /**
   * Guías de ajuste mientras se arrastra: se pega a los bordes y al centro del lienzo y de las demás
   * capas visibles. Con varias elegidas se ajusta la CAJA CONJUNTA (sus bordes y su centro) y todas se
   * mueven a la vez; las capas elegidas no cuentan como destino.
   */
  private snap(node: AnyNode): void {
    if (!this.input) return;
    const group = this.dragStart;
    const attached = this.transformer.nodes();
    if (!group && attached.length > 1 && attached.includes(node)) return;
    const threshold = 8 / Math.max(this.input.scale, 0.05);
    const skip = group?.ids ?? new Set([node.id()]);
    const others = [...this.specs.values()].filter((spec) => !skip.has(spec.id) && spec.visible).map(specBox);
    const targets = snapTargets(this.input.canvas, others);
    const snapped = group
      ? snapGroup(group.boxes, { x: node.x() - group.origin.x, y: node.y() - group.origin.y }, targets, threshold)
      : snapBox(boxOf(node), targets, threshold);
    // Mover el nodo arrastrado mueve a las demás con él (Konva reparte el desplazamiento).
    node.position({ x: node.x() + snapped.dx, y: node.y() + snapped.dy });
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
