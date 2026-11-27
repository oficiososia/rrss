import {
  adaptDocument,
  addPage,
  clampPageIndex,
  duplicatePage,
  MAX_LAYERS,
  MAX_PAGES,
  movePage,
  pageView,
  removePage,
  validateDocument,
  type AspectRatio,
  type Canvas,
  type ContentDocument,
  type DocumentIssue,
  type ImageAdjust,
  type ImageBackdrop,
  type ImageLayer,
  type Layer,
  type PageLimits,
  type PageView,
  type TextLayer,
} from '../document';
import { dropLoneGroups } from '../editor/arrange';
import { applyLayerPatch, duplicateLayer, reorderLayers, type LayerPatch } from '../editor/history';
import { fitBoxAround } from '../editor/imageEffects/cropMath';
import { FILTER_LABEL } from '../editor/imageEffects/filters';
import { flipPhoto, largestCrop, orientedSize, turnQuarter } from '../editor/imageEffects/imageEdit';
import { DEFAULT_SHADOW } from '../editor/imageEffects/shadowDefaults';
import { FALLBACK_FONTS, layerLabel, newImageLayer, newLayerId, newLogoLayer, newShapeLayer } from '../editor/layers';
import { backdropAt, contrastOf, legibleTextColor, preferredTextColor, type CopilotBrandColor, type ToneGrid } from './legibility';
import {
  COPILOT_MOVE_STEP,
  COPILOT_SIZE_STEP,
  type CopilotAlign,
  type CopilotEditorAction,
  type CopilotOperation,
  type CopilotPhotoFlow,
  type CopilotPosition,
  type CopilotTextStyle,
} from './operations';

// Aplica las operaciones del copiloto por voz al documento, de forma pura y
// determinista: la IA dice QUÉ (un texto de título arriba, la foto de fondo
// difuminada), y aquí se decide DÓNDE y CÓMO con las tipografías y colores del
// perfil de marca (el color de un texto, por el uso de cada color y legible
// sobre lo que tiene debajo: ver legibility.ts). El resultado se valida con el esquema del documento; si no
// cumple, no se aplica nada. El editor lo mete en el historial como UN paso de
// deshacer (acción `replace`).

/** Desenfoque cuando se pide difuminar sin decir cuánto. */
export const DEFAULT_BLUR = 40;

export type { CopilotBrandColor } from './legibility';

export interface CopilotBrandStyle {
  /** Colores del perfil, en su orden, con su uso («Principal», «fondo», «texto»…). */
  palette: CopilotBrandColor[];
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
  /**
   * Tono medio (#RRGGBB) de las fotos ya analizadas, por id de recurso. Una
   * foto sin tono conocido se supone media oscura (ver legibility.ts).
   */
  imageTones?: ReadonlyMap<string, string>;
  /**
   * Tono POR ZONAS de las fotos medidas así (el fondo que acaba de generar un
   * plan), por id de recurso: manda sobre el tono medio para saber qué hay
   * justo debajo de cada texto.
   */
  imageZones?: ReadonlyMap<string, ToneGrid>;
  /**
   * Fotos cuyo tono se ha intentado medir y NO se ha podido (el navegador no
   * deja leer sus píxeles, o la carga ha fallado). No se adivina: los textos
   * que quedan encima conservan su color y llevan un contorno del color
   * contrario, que se lee sobre cualquier fondo; y se dice.
   */
  unmeasuredImages?: ReadonlySet<string>;
  /** Página sobre la que actúa (la activa del editor). Por omisión, la primera. */
  pageIndex?: number;
  /** Capas elegidas en el editor: «esta foto» sin decir cuál. */
  selectedIds?: readonly string[];
  /** Páginas que admite el formato de la pieza (un post, una; un carrusel, de 2 a 10). */
  pageLimits?: PageLimits;
  /** Proporciones que admite la red de la pieza; sin ellas no se avisa. */
  allowedRatios?: readonly AspectRatio[] | null;
}

/**
 * Sitio exacto de una foto que coloca un plan (plan.ts): la caja donde debe
 * caber, su giro y si lleva sombra. No viaja por el contrato del servidor: lo
 * calcula el editor (`layoutBoxes`).
 */
export interface CopilotPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Grados, en sentido horario. */
  rotation?: number;
  /** Sombra suave (la estándar del editor). */
  shadow?: boolean;
  /**
   * Parte de la foto que se enseña (fracciones 0–1): en un recorte, la zona que
   * ocupa lo recortado, sin el aire transparente de alrededor.
   */
  crop?: { x: number; y: number; width: number; height: number };
}

/**
 * Operación del copiloto con lo que le añade un plan (plan.ts) y no viaja por
 * el contrato del servidor: en `add_image`, el sitio de la foto; en
 * `move_layer`, el sitio exacto al que va la capa (de `place` solo cuentan `x`
 * e `y`) y, en `say`, cómo se cuenta ese cambio a la persona.
 */
export type PlacedCopilotOperation = CopilotOperation & { place?: CopilotPlacement; say?: string };

/** Flujo del editor que una orden pide abrir para una foto («quita el fondo», «modo retrato»…). */
export interface CopilotFlowRequest {
  flow: CopilotPhotoFlow;
  layerId: string;
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
      /** Página que queda activa (una orden puede añadir una página o pasar a otra). */
      pageIndex: number;
      /** Flujos de foto que hay que abrir después (no cambian el documento aquí). */
      flows: CopilotFlowRequest[];
      /** Acciones del editor para después de aplicar: guardar, abrir plantillas. */
      after: CopilotEditorAction[];
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
export function backgroundImageOf(document: Pick<PageView, 'canvas' | 'layers'>): ImageLayer | null {
  const found = document.layers.find((layer) => layer.type === 'image' && coversCanvas(layer, document.canvas));
  return (found as ImageLayer | undefined) ?? null;
}

const wantsPhoto = (op: CopilotOperation) => op.op === 'set_background_image' || op.op === 'add_image';

/** ¿Hay alguna orden que pide una foto sin decir cuál? (el editor abre el selector). */
export function needsPhotoPick(operations: CopilotOperation[]): boolean {
  return operations.some((op) => wantsPhoto(op) && op.assetId === null);
}

/** Rellena «esta foto» con la elegida. */
export function withPickedPhoto<T extends CopilotOperation>(operations: T[], assetId: string | null): T[] {
  return operations.flatMap((op) => {
    if (!wantsPhoto(op) || op.assetId !== null) return [op];
    return assetId ? [{ ...op, assetId }] : [];
  });
}

/** Órdenes de deshacer y rehacer de una respuesta, en su orden (las ejecuta el editor antes que nada). */
export function historyActions(operations: CopilotOperation[]): ('undo' | 'redo')[] {
  return operations.flatMap((op) =>
    op.op === 'editor' && (op.action === 'undo' || op.action === 'redo') ? [op.action] : [],
  );
}

const NEUTRAL_ADJUST: ImageAdjust = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 };
const CROP_RATIO: Record<string, number> = { '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16, '16:9': 16 / 9, '3:2': 3 / 2 };
/** Blanco o negro: el que más contrasta con un color. */
const contrasting = (color: string) =>
  contrastOf(color, '#000000') >= contrastOf(color, '#FFFFFF') ? '#000000' : '#FFFFFF';

/** Sitio de una caja nueva (figura o foto suelta): centrada salvo que se diga otra cosa. */
function placeBox(
  canvas: Canvas,
  box: { width: number; height: number },
  position: CopilotPosition | null,
  align: CopilotAlign | null,
): { x: number; y: number } {
  const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.05);
  const maxY = Math.max(0, canvas.height - box.height - margin);
  const y =
    position === 'top'
      ? margin
      : position === 'upper'
        ? Math.min(maxY, Math.round(canvas.height * SLOT.upper))
        : position === 'lower'
          ? Math.min(maxY, Math.round(canvas.height * SLOT.lower))
          : position === 'bottom'
            ? maxY
            : Math.round((canvas.height - box.height) / 2);
  const x =
    align === 'left'
      ? margin
      : align === 'right'
        ? canvas.width - box.width - margin
        : Math.round((canvas.width - box.width) / 2);
  return { x, y };
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
function placeY(document: Pick<PageView, 'canvas' | 'layers'>, height: number, position: CopilotPosition | null, after: Layer | null) {
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

const isHeading = (style: CopilotTextStyle) => style === 'title' || style === 'subtitle';

function fontFor(brand: CopilotBrandStyle, style: CopilotTextStyle) {
  return (isHeading(style) ? brand.fonts[0] : (brand.fonts[1] ?? brand.fonts[0])) ?? FALLBACK_FONTS[0]!;
}

/**
 * El texto con la primera letra en mayúscula («este finde…» → «Este finde…»),
 * saltando los signos de apertura. Lo demás, tal cual se dictó.
 */
export function capitalizeFirst(text: string): string {
  return text.replace(/^([\s¿¡"'«“(]*)(\p{Ll})/u, (_, lead: string, letter: string) => `${lead}${letter.toLocaleUpperCase('es')}`);
}

/** Contraste que se pide a un texto sobre su fondo de etiqueta (liso): AA para texto grande. */
const LABEL_CONTRAST = 4.5;

/**
 * Aspecto de un titular nuevo: siempre con los colores de la marca y legible.
 *
 *  1. Si viene un color (de la marca: el servidor quita los que no lo son) y se
 *     lee sobre lo que tiene debajo, ese.
 *  2. Sin color: el de la marca por su uso o el más legible de la marca, si se
 *     lee (legibleTextColor).
 *  3. Si ningún color de la marca se lee encima, el color de la marca va de
 *     FONDO DE ETIQUETA (el pedido, o el de títulos o el principal) y el texto,
 *     en el color (de la marca, blanco o negro) que más contrasta con él. Así
 *     un titular nunca sale en negro o blanco «sin marca» si la marca tiene
 *     colores.
 */
export function headingLook(
  palette: readonly CopilotBrandColor[],
  backdrop: ReturnType<typeof backdropAt>,
  given: string | null,
): { color: string; label?: string } {
  if (given && contrastOf(given, backdrop.hex) >= backdrop.required) return { color: given.toUpperCase() };
  if (!given) {
    const legible = legibleTextColor(palette, true, backdrop);
    if (palette.some((entry) => entry.hex.toUpperCase() === legible)) return { color: legible };
  }
  const label = (given ?? preferredTextColor(palette, true))?.toUpperCase();
  if (!label) return { color: given?.toUpperCase() ?? legibleTextColor(palette, true, backdrop) };
  const candidates = [...palette.map((entry) => entry.hex.toUpperCase()), '#FFFFFF', '#000000'].filter((hex) => hex !== label);
  const best = candidates.reduce(
    (winner, hex) => {
      const ratio = contrastOf(hex, label);
      // Un color de la marca vale si llega; blanco o negro, solo si ninguno de la marca llega.
      const brand = hex !== '#FFFFFF' && hex !== '#000000';
      const score = ratio >= LABEL_CONTRAST && brand ? ratio + 100 : ratio;
      return score > winner.score ? { hex, score } : winner;
    },
    { hex: contrasting(label), score: 0 },
  );
  return { color: best.hex, label };
}

/** Un texto ya puesto «es de título» si va en negrita (los títulos y subtítulos del copiloto van a 600 o más). */
const looksHeading = (layer: TextLayer) => layer.fontWeight >= 600;

const layerName = (layer: Layer) =>
  layer.type === 'text'
    ? `«${layer.text.split('\n')[0]!.slice(0, 40)}»`
    : layer.name || (layer.type === 'shape' ? `la figura (${layerLabel(layer).toLowerCase()})` : 'la capa');

/**
 * Aplica las operaciones en orden sobre una copia de UNA página del documento
 * (`context.pageIndex`, la activa del editor) y valida el documento entero. Las
 * demás páginas no se tocan; el color de fondo del lienzo es común a todas.
 */
export function applyCopilotOperations(
  input: ContentDocument,
  operations: PlacedCopilotOperation[],
  context: CopilotApplyContext,
): CopilotApplyResult {
  // El documento entero en curso y la página que se está cambiando. Las órdenes
  // de capas actúan sobre `document` (la vista de esa página); las de páginas y
  // de proporción, sobre `working`, pasando antes lo hecho en la página.
  let working: ContentDocument = input;
  let pageIndex = clampPageIndex(input, context.pageIndex ?? 0);
  let document!: PageView;
  let canvas!: Canvas;
  // Las capas nuevas no repiten identificador con las de otras páginas.
  let otherLayers: Layer[] = [];
  const load = () => {
    const view = pageView(working, pageIndex);
    document = { ...view, canvas: { ...view.canvas }, layers: [...view.layers] };
    canvas = document.canvas;
    otherLayers = working.pages.flatMap((page, index) => (index === pageIndex ? [] : page.layers));
  };
  const flush = () => {
    working = {
      ...working,
      canvas: document.canvas,
      pages: working.pages.map((page, index) => (index === pageIndex ? { ...page, layers: document.layers } : page)),
    };
  };
  load();
  /** Página de la que parte la orden («esta») y páginas vacías añadidas en la propia orden. */
  const originPageId = working.pages[pageIndex]!.id;
  const addedPages = new Set<string>();
  const taken = () => [...otherLayers, ...document.layers];
  const changes: string[] = [];
  const skipped: string[] = [];
  const touched = new Set<string>();
  const flows: CopilotFlowRequest[] = [];
  const after: CopilotEditorAction[] = [];
  const limits = context.pageLimits ?? { min: 1, max: MAX_PAGES };
  const palette = context.brand.palette;
  let lastText: Layer | null = null;
  /** Textos con el color dictado en esta orden: ese color se respeta. */
  const dictatedColor = new Set<string>();

  /**
   * Tras «duplica la página», las capas de la copia llevan identificadores nuevos
   * y lo que sigue en la misma orden («…y cambia el título») las nombra con los
   * de la original: aquí, de cada capa original a su copia.
   */
  const renamed = new Map<string, string>();
  const find = (id: string | null) => {
    const real = id ? (renamed.get(id) ?? id) : null;
    return real ? (document.layers.find((layer) => layer.id === real) ?? null) : null;
  };
  const replaceLayer = (next: Layer) => {
    document = { ...document, layers: document.layers.map((layer) => (layer.id === next.id ? next : layer)) };
    touched.add(next.id);
  };
  const patch = (layer: Layer, change: LayerPatch) => replaceLayer(applyLayerPatch(layer, change));
  /**
   * Añade una capa: delante de todo, al fondo (`bottom`) o justo por debajo de
   * los textos y logotipos (`under-texts`: las fotos que coloca un plan).
   */
  const add = (layer: Layer, where: boolean | 'under-texts' = false) => {
    if (document.layers.length >= MAX_LAYERS) {
      skipped.push(`No caben más capas (máximo ${MAX_LAYERS}).`);
      return false;
    }
    const firstText = where === 'under-texts' ? document.layers.findIndex((l) => l.type === 'text' || l.type === 'logo') : -1;
    const layers =
      where === true
        ? [layer, ...document.layers]
        : firstText >= 0
          ? [...document.layers.slice(0, firstText), layer, ...document.layers.slice(firstText)]
          : [...document.layers, layer];
    document = { ...document, layers };
    touched.add(layer.id);
    return true;
  };
  /** La foto de una orden: la que dice, la elegida en el editor, la de fondo o la única que hay. */
  const imageFor = (op: CopilotOperation): ImageLayer | null => {
    if (op.target) {
      const layer = find(op.target);
      return layer?.type === 'image' ? layer : null;
    }
    const chosen = (context.selectedIds ?? []).map((id) => find(id)).find((layer) => layer?.type === 'image');
    if (chosen?.type === 'image') return chosen;
    const background = backgroundImageOf(document);
    if (background) return background;
    const images = document.layers.filter((layer): layer is ImageLayer => layer.type === 'image');
    return images.length === 1 ? images[0]! : null;
  };
  /** La capa de una orden, si existe y se puede tocar; si no, deja dicho por qué. */
  const editable = (id: string | null, what: string): Layer | null => {
    const layer = find(id);
    if (!layer) {
      skipped.push(`No se encuentra la capa que hay que ${what}.`);
      return null;
    }
    if (layer.locked) {
      skipped.push(`${layerName(layer)} está bloqueada.`);
      return null;
    }
    return layer;
  };
  const editableImage = (op: CopilotOperation): ImageLayer | null => {
    const layer = imageFor(op);
    if (!layer) {
      skipped.push('No hay ninguna foto a la que aplicarlo: elige una o di cuál.');
      return null;
    }
    if (layer.locked) {
      skipped.push(`${layerName(layer)} está bloqueada.`);
      return null;
    }
    return layer;
  };

  /**
   * Tras cambiar el fondo, los textos sin color dictado en esta orden que ya no
   * se leen pasan a un color legible (el de la marca por su uso, el más legible
   * de la marca, o blanco o negro). Los bloqueados no se tocan. Con `only`, se
   * revisan solo esas capas (las que un plan acaba de recolocar). Sobre una
   * foto cuyo tono no se ha podido medir no se adivina el color: esos textos
   * llevan contorno (`outlineOverUnmeasured`).
   */
  const keepTextsReadable = (only?: ReadonlySet<string>) => {
    document.layers.forEach((layer, index) => {
      if (layer.type !== 'text' || layer.locked || dictatedColor.has(layer.id)) return;
      if (only && !only.has(layer.id)) return;
      const backdrop = backdropAt(document.canvas, document.layers.slice(0, index), layer, context.imageTones, context.imageZones);
      if (backdrop.assetId && context.unmeasuredImages?.has(backdrop.assetId)) return;
      if (contrastOf(layer.color, backdrop.hex) >= backdrop.required) return;
      const color = legibleTextColor(context.brand.palette, looksHeading(layer), backdrop);
      if (color === layer.color.toUpperCase()) return;
      patch(layer, { color });
      changes.push(`Texto ${layerName(layer)} en ${color} para que se lea sobre el fondo`);
    });
  };

  /**
   * Respaldo cuando el tono de una foto no se ha podido medir: cada texto que
   * queda encima (los que había y los nuevos) lleva un contorno fino del color
   * contrario al suyo, que se lee sobre un fondo claro y sobre uno oscuro. Es
   * lo que menos cambia el diseño: ni el color ni el sitio del texto. No se
   * tocan los bloqueados ni los que ya llevan contorno o fondo de etiqueta.
   */
  const outlineOverUnmeasured = () => {
    const unmeasured = context.unmeasuredImages;
    if (!unmeasured || unmeasured.size === 0) return;
    document.layers.forEach((layer, index) => {
      if (layer.type !== 'text' || layer.locked || !layer.visible || layer.outline || layer.background) return;
      const backdrop = backdropAt(document.canvas, document.layers.slice(0, index), layer);
      if (!backdrop.assetId || !unmeasured.has(backdrop.assetId)) return;
      patch(layer, { outline: { color: contrasting(layer.color), width: Math.max(2, Math.round(layer.fontSize * 0.06)) } });
      changes.push(`Texto ${layerName(layer)} con contorno: no he podido medir el tono del fondo nuevo y así se lee sobre cualquiera`);
    });
  };
  /** Capas que un plan ha recolocado en esta orden: al final se revisa que sigan leyéndose en su sitio nuevo. */
  const relocated = new Set<string>();

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
          const layer = newImageLayer(canvas, taken(), { id: op.assetId, name });
          if (!add(blur ? { ...layer, blur } : layer, true)) break;
        }
        changes.push(op.blur ? `Foto de fondo «${name}», difuminada (${op.blur} %)` : `Foto de fondo «${name}»`);
        keepTextsReadable();
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
        const base = newLogoLayer(canvas, taken(), asset);
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
        // Que no pise un texto: si choca, se reduce (hasta la mitad, sin deformar)
        // hacia su borde para caber en el hueco; si ni así, se pone y se avisa.
        let { width, height } = base;
        const clashWith = () =>
          document.layers.find(
            (l) => l.type === 'text' && l.visible && x < l.x + l.width && l.x < x + width && y < l.y + l.height && l.y < y + height,
          );
        let clash = clashWith();
        if (clash) {
          const gap = Math.round(canvas.height * 0.02);
          const onTop = y + height / 2 < clash.y + clash.height / 2;
          const room = onTop ? clash.y - gap - y : y + height - (clash.y + clash.height + gap);
          if (room >= height / 2) {
            const scale = room / height;
            const centerX = x + width / 2;
            if (!onTop) y += height - Math.round(height * scale);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            if (op.align === 'right') x += base.width - width;
            else if (op.align !== 'left') x = Math.round(centerX - width / 2);
            clash = clashWith();
          }
        }
        const anchorY = y < canvas.height / 3 ? 'top' : y > (canvas.height * 2) / 3 ? 'bottom' : 'center';
        const anchorX = op.align === 'left' ? 'left' : op.align === 'right' ? 'right' : op.position ? 'center' : 'right';
        if (add({ ...base, x, y, width, height, anchor: { x: anchorX, y: anchorY } })) {
          changes.push(width < base.width ? 'Logotipo de la marca (más pequeño, para no pisar el texto)' : 'Logotipo de la marca');
          if (clash) skipped.push(`El logotipo pisa ${layerName(clash)}: muévelo o quita ese texto.`);
        }
        break;
      }
      case 'add_text': {
        if (!op.text) break;
        const style = op.style ?? 'body';
        // Un titular dictado empieza con mayúscula aunque el dictado llegue en minúscula.
        const text = isHeading(style) ? capitalizeFirst(op.text) : op.text;
        const fontSize = Math.round(Math.min(canvas.width, canvas.height) * TEXT_SIZE[style].size);
        const box = textBox(canvas, text, fontSize);
        const y = placeY(document, box.height, op.position, lastText);
        const x = xFor(canvas, box.width, null);
        const backdrop = backdropAt(
          document.canvas,
          document.layers,
          { x, y, width: box.width, height: box.height },
          context.imageTones,
          context.imageZones,
        );
        // Titulares: siempre con los colores de la marca y legibles (headingLook). El resto, como siempre.
        const look = isHeading(style)
          ? headingLook(context.brand.palette, backdrop, op.color)
          : { color: op.color ?? legibleTextColor(context.brand.palette, false, backdrop) };
        const color = look.color;
        const layer: TextLayer = {
          id: newLayerId(taken()),
          type: 'text',
          name: '',
          x,
          y,
          width: box.width,
          height: box.height,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          anchor: { x: 'center', y: y < canvas.height / 3 ? 'top' : y > (canvas.height * 2) / 3 ? 'bottom' : 'center' },
          text,
          fontFamily: op.font ?? fontFor(context.brand, style),
          fontSize,
          fontWeight: TEXT_SIZE[style].weight,
          italic: false,
          color,
          align: op.align ?? 'center',
          lineHeight: LINE_HEIGHT,
          ...(look.label
            ? {
                background: {
                  color: look.label,
                  opacity: 1,
                  padding: Math.round(fontSize * 0.25),
                  radius: Math.round(fontSize * 0.2),
                },
              }
            : {}),
        };
        if (add(layer)) {
          lastText = layer;
          // Con fondo de etiqueta el texto ya se lee sobre cualquier cosa: no se le cambia el color después.
          if (op.color || look.label) dictatedColor.add(layer.id);
          changes.push(
            look.label
              ? `Texto ${layerName(layer)} sobre una etiqueta ${look.label} de la marca, para que se lea`
              : `Texto ${layerName(layer)}`,
          );
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
        if (op.color) {
          change.color = op.color;
          dictatedColor.add(layer.id);
        }
        if (op.font) change.fontFamily = op.font;
        if (op.align) change.align = op.align;
        // Negrita y cursiva («ponlo en negrita», «quita la cursiva»): mandan sobre el peso del estilo.
        if (op.bold !== null) change.fontWeight = op.bold ? 700 : 400;
        if (op.italic !== null) change.italic = op.italic;
        if (Object.keys(change).length === 0) {
          skipped.push(`No dice qué cambiar de ${layerName(layer)}.`);
          break;
        }
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
        // En cada eje: a un sitio concreto o, si no, unos pasos (5 % del lienzo cada uno), sin salirse.
        const clampY = (y: number) => Math.round(Math.min(Math.max(y, 0), Math.max(0, canvas.height - layer.height)));
        const clampX = (x: number) => Math.round(Math.min(Math.max(x, 0), Math.max(0, canvas.width - layer.width)));
        const change: LayerPatch = {};
        if (op.place) {
          // Sitio exacto que le da un plan al apartar un texto para dejar sitio a las fotos.
          change.x = clampX(op.place.x);
          change.y = clampY(op.place.y);
        } else {
          if (op.position) change.y = clampY(canvas.height * SLOT[op.position]);
          else if (op.dy) change.y = clampY(layer.y + op.dy * COPILOT_MOVE_STEP * canvas.height);
          if (op.align) change.x = xFor(canvas, layer.width, op.align);
          else if (op.dx) change.x = clampX(layer.x + op.dx * COPILOT_MOVE_STEP * canvas.width);
        }
        if ((change.y === undefined || change.y === layer.y) && (change.x === undefined || change.x === layer.x)) {
          skipped.push(
            op.dx || op.dy ? `${layerName(layer)} ya está en el borde.` : `${layerName(layer)} ya está ahí.`,
          );
          break;
        }
        patch(layer, change);
        changes.push(op.say ?? `Movida ${layerName(layer)}`);
        if (op.place) relocated.add(layer.id);
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
        canvas = document.canvas;
        changes.push(`Color de fondo ${op.color.toUpperCase()}`);
        keepTextsReadable();
        break;
      }
      case 'resize_layer': {
        const layer = editable(op.target, 'cambiar de tamaño');
        if (!layer || !op.steps) break;
        const factor = COPILOT_SIZE_STEP ** op.steps;
        if (layer.type === 'text') {
          const fontSize = Math.min(2000, Math.max(8, Math.round(layer.fontSize * factor)));
          if (fontSize === layer.fontSize) {
            skipped.push(`${layerName(layer)} ya no puede cambiar más de tamaño.`);
            break;
          }
          // La caja crece con la letra para que el texto no se corte.
          patch(layer, { fontSize, height: Math.max(1, Math.round((layer.height * fontSize) / layer.fontSize)) });
        } else {
          const width = Math.max(8, Math.round(layer.width * factor));
          const height = Math.max(8, Math.round(layer.height * factor));
          patch(layer, {
            x: Math.round(layer.x - (width - layer.width) / 2),
            y: Math.round(layer.y - (height - layer.height) / 2),
            width,
            height,
          });
        }
        changes.push(`${layerName(layer)}, más ${op.steps > 0 ? 'grande' : 'pequeño'}`);
        break;
      }
      case 'arrange_layer': {
        const layer = editable(op.target, 'reordenar');
        if (!layer || !op.order) break;
        const next = reorderLayers(document.layers, layer.id, op.order);
        if (next === document.layers) {
          skipped.push(`${layerName(layer)} ya está ahí.`);
          break;
        }
        document = { ...document, layers: next };
        touched.add(layer.id);
        changes.push(
          `${layerName(layer)}, ${op.order === 'front' ? 'al frente' : op.order === 'back' ? 'al fondo' : op.order === 'forward' ? 'un nivel más arriba' : 'un nivel más abajo'}`,
        );
        break;
      }
      case 'duplicate_layer': {
        const layer = find(op.target);
        if (!layer) {
          skipped.push('No se encuentra la capa que hay que duplicar.');
          break;
        }
        if (add(duplicateLayer(layer, taken()))) changes.push(`Duplicada ${layerName(layer)}`);
        break;
      }
      case 'style_layer': {
        const layer = find(op.target);
        if (!layer) {
          skipped.push('No se encuentra la capa que hay que cambiar.');
          break;
        }
        if (layer.locked && op.locked !== false) {
          skipped.push(`${layerName(layer)} está bloqueada.`);
          break;
        }
        const change: LayerPatch = {};
        const done: string[] = [];
        if (op.opacity !== null) {
          change.opacity = op.opacity / 100;
          done.push(`opacidad ${Math.round(op.opacity)} %`);
        }
        if (op.rotation !== null) {
          change.rotation = op.rotation;
          done.push(`giro ${Math.round(op.rotation)}°`);
        }
        if (op.visible !== null) {
          change.visible = op.visible;
          done.push(op.visible ? 'visible' : 'oculta');
        }
        if (op.locked !== null) {
          change.locked = op.locked;
          done.push(op.locked ? 'bloqueada' : 'desbloqueada');
        }
        if (done.length === 0) break;
        patch(layer, change);
        changes.push(`${layerName(layer)}: ${done.join(', ')}`);
        break;
      }
      case 'set_effect': {
        const layer = editable(op.target, 'cambiar');
        if (!layer || !op.effect) break;
        const on = op.on ?? true;
        if (op.effect === 'shadow') {
          if (layer.type === 'logo') {
            skipped.push('El logotipo no admite sombra.');
            break;
          }
          patch(layer, { shadow: on ? { ...DEFAULT_SHADOW, ...(op.color ? { color: op.color } : {}) } : undefined });
          changes.push(`${layerName(layer)}, ${on ? 'con' : 'sin'} sombra`);
          break;
        }
        if (layer.type !== 'text') {
          skipped.push('El contorno y el fondo de etiqueta son solo para textos.');
          break;
        }
        const size = layer.fontSize;
        if (op.effect === 'outline') {
          patch(layer, {
            outline: on
              ? { color: op.color ?? contrasting(layer.color), width: Math.max(2, Math.round(size * 0.06)) }
              : undefined,
          });
          changes.push(`${layerName(layer)}, ${on ? 'con' : 'sin'} contorno`);
        } else {
          patch(layer, {
            background: on
              ? {
                  color: op.color ?? contrasting(layer.color),
                  opacity: 1,
                  padding: Math.round(size * 0.25),
                  radius: Math.round(size * 0.2),
                }
              : undefined,
          });
          changes.push(`${layerName(layer)}, ${on ? 'con' : 'sin'} fondo de etiqueta`);
        }
        break;
      }
      case 'add_shape': {
        if (!op.shape) break;
        const base = newShapeLayer(canvas, taken(), op.shape, op.color ?? palette[1]?.hex ?? palette[0]?.hex);
        const layer = { ...base, ...placeBox(canvas, base, op.position, op.align) };
        if (add(layer)) changes.push(`Añadida ${layerName(layer)}`);
        break;
      }
      case 'style_shape': {
        const layer = editable(op.target, 'cambiar');
        if (!layer) break;
        if (layer.type !== 'shape') {
          skipped.push('Solo las figuras tienen relleno y borde.');
          break;
        }
        const change: LayerPatch = {};
        // Una línea solo tiene borde: su color es el del trazo.
        if (op.color && layer.shape === 'line') change.stroke = { color: op.color, width: layer.stroke?.width ?? 8 };
        else if (op.color) change.fill = op.color;
        if (op.color2) change.stroke = { color: op.color2, width: layer.stroke?.width ?? 4 };
        if (Object.keys(change).length === 0) break;
        patch(layer, change);
        changes.push(`Cambiado el color de ${layerName(layer)}`);
        break;
      }
      case 'add_image': {
        if (!op.assetId) {
          skipped.push('Falta elegir la foto.');
          break;
        }
        const asset = context.assets.get(op.assetId);
        const name = asset?.name ?? 'Foto';
        // Con sitio dado por un plan: la foto, con sus proporciones, dentro de esa caja y centrada en ella.
        // Un recorte (foto sin su fondo) viene con la zona que ocupa lo recortado (`crop`): se encaja ESO,
        // no la foto entera con su aire transparente, para que no quede diminuto.
        const place = op.place;
        const crop = place?.crop;
        const aspect =
          asset?.width && asset?.height ? (asset.width * (crop?.width ?? 1)) / (asset.height * (crop?.height ?? 1)) : 1;
        const cell = place
          ? { width: place.width, height: place.height }
          : { width: Math.min(canvas.width, canvas.height) * 0.6, height: Math.min(canvas.width, canvas.height) * 0.6 };
        const scale = Math.min(cell.width / aspect, cell.height);
        const box = { width: Math.max(8, Math.round(scale * aspect)), height: Math.max(8, Math.round(scale)) };
        const layer: ImageLayer = {
          ...newImageLayer(canvas, taken(), { id: op.assetId, name }),
          ...box,
          ...(place
            ? {
                x: Math.round(place.x + (place.width - box.width) / 2),
                y: Math.round(place.y + (place.height - box.height) / 2),
                rotation: place.rotation ?? 0,
                ...(place.shadow ? { shadow: { ...DEFAULT_SHADOW } } : {}),
                ...(crop ? { crop: { ...crop } } : {}),
              }
            : placeBox(canvas, box, op.position, op.align)),
          anchor: { x: 'center', y: 'center' },
          fit: 'contain',
        };
        // Las fotos de un plan van encima del fondo y por debajo de los textos y el logotipo.
        if (add(layer, place ? 'under-texts' : false)) changes.push(`Foto «${name}» añadida encima`);
        break;
      }
      case 'adjust_image': {
        const layer = editableImage(op);
        if (!layer) break;
        const adjust: ImageAdjust = { ...NEUTRAL_ADJUST, ...layer.adjust };
        for (const key of ['brightness', 'contrast', 'saturation', 'temperature', 'sharpness'] as const) {
          if (op[key] !== null) adjust[key] = op[key];
        }
        if (op.filter === 'none') delete adjust.filter;
        else if (op.filter) adjust.filter = op.filter;
        patch(layer, { adjust });
        changes.push(
          op.filter && op.filter !== 'none'
            ? `Filtro «${FILTER_LABEL[op.filter]}» en la foto`
            : op.filter === 'none'
              ? 'Foto sin filtro'
              : 'Luz y color de la foto ajustados',
        );
        break;
      }
      case 'transform_image': {
        const layer = editableImage(op);
        if (!layer) break;
        let current: ImageLayer = layer;
        const done: string[] = [];
        const step = (change: LayerPatch) => {
          current = applyLayerPatch(current, change) as ImageLayer;
        };
        if (op.turn) {
          step(turnQuarter(current));
          done.push('girada 90°');
        }
        if (op.flip) {
          step(flipPhoto(current, op.flip === 'horizontal' ? 'x' : 'y'));
          done.push(op.flip === 'horizontal' ? 'volteada en horizontal' : 'volteada en vertical');
        }
        let filledCanvas = false;
        if (op.fit === 'canvas') {
          // «Que la foto llene todo»: la caja pasa a ser el lienzo entero, la foto lo llena de borde a
          // borde (recortando lo que sobre) y va al fondo, detrás de todo lo demás.
          step({ x: 0, y: 0, width: canvas.width, height: canvas.height, rotation: 0, fit: 'cover', crop: undefined });
          current = { ...current, anchor: { x: 'stretch', y: 'stretch' } };
          done.push('llenando todo el lienzo, de borde a borde (se recorta lo que sobra)');
          filledCanvas = true;
        } else if (op.fit) {
          step({ fit: op.fit });
          done.push(op.fit === 'cover' ? 'llenando su caja' : 'entera');
        }
        if (op.crop === 'none') {
          step({ crop: undefined });
          done.push('sin recorte');
        } else if (op.crop) {
          const asset = current.source.kind === 'asset' ? context.assets.get(current.source.assetId) : undefined;
          if (!asset?.width || !asset.height) {
            skipped.push('No se conocen las medidas de la foto: recórtala desde «Recortar…».');
          } else {
            const ratio = CROP_RATIO[op.crop]!;
            const frame = orientedSize(asset.width, asset.height, current.turn);
            // La caja toma la proporción del recorte, con el mismo centro.
            step({ crop: largestCrop(frame, ratio, current.focus), ...fitBoxAround(current, ratio) });
            done.push(`recortada a ${op.crop}`);
          }
        }
        if (done.length === 0) break;
        replaceLayer(current);
        if (filledCanvas) {
          // Detrás de todo: si ya había una foto de fondo, esta pasa a ser la de fondo (encima de ella).
          const others = document.layers.filter((layer) => layer.id !== current.id);
          const previous = backgroundImageOf({ canvas, layers: others });
          const at = previous ? others.indexOf(previous) + 1 : 0;
          document = { ...document, layers: [...others.slice(0, at), current, ...others.slice(at)] };
        }
        changes.push(`Foto ${done.join(', ')}`);
        if (filledCanvas) keepTextsReadable();
        break;
      }
      case 'image_backdrop': {
        const layer = editableImage(op);
        if (!layer || !op.backdrop) break;
        if (op.backdrop === 'none') {
          patch(layer, { backdrop: undefined });
          changes.push('Foto sin nada detrás');
          break;
        }
        const first = op.color ?? palette[0]?.hex ?? '#FFFFFF';
        const backdrop: ImageBackdrop =
          op.backdrop === 'color'
            ? { kind: 'color', color: first }
            : op.backdrop === 'gradient'
              ? { kind: 'gradient', from: first, to: op.color2 ?? palette[1]?.hex ?? '#000000', angle: 180 }
              : { kind: 'blur', blur: 60 };
        // El fondo solo se ve donde la foto no llega: la foto pasa a verse entera.
        patch(layer, { backdrop, fit: 'contain' });
        changes.push(
          op.backdrop === 'color'
            ? `Color ${first} detrás de la foto`
            : op.backdrop === 'gradient'
              ? 'Degradado detrás de la foto'
              : 'La misma foto, desenfocada, detrás',
        );
        break;
      }
      case 'photo_flow': {
        const layer = imageFor(op);
        const flow = op.action as CopilotPhotoFlow | null;
        if (!flow) break;
        if (!layer) {
          skipped.push('No hay ninguna foto a la que aplicarlo: elige una o di cuál.');
          break;
        }
        if (layer.locked) {
          skipped.push(`${layerName(layer)} está bloqueada.`);
          break;
        }
        flows.push({ flow, layerId: layer.id });
        break;
      }
      case 'set_canvas_ratio': {
        if (!op.ratio) break;
        if (op.ratio === canvas.aspectRatio) {
          skipped.push(`El lienzo ya es ${op.ratio}.`);
          break;
        }
        flush();
        working = adaptDocument(working, op.ratio);
        load();
        changes.push(`Lienzo en ${op.ratio} (las capas se han recolocado: revísalo)`);
        if (context.allowedRatios && !context.allowedRatios.includes(op.ratio)) {
          skipped.push(`Ojo: la red de esta pieza no admite ${op.ratio}.`);
        }
        break;
      }
      case 'page': {
        const count = working.pages.length;
        const goTo = (index: number, done: string, copies?: ReadonlyMap<string, string>) => {
          pageIndex = index;
          load();
          touched.clear();
          // En otra página, los identificadores de la anterior ya no valen (salvo los de su copia).
          renamed.clear();
          copies?.forEach((copy, original) => renamed.set(original, copy));
          changes.push(done);
        };
        if (op.action === 'add' || op.action === 'duplicate') {
          if (count >= limits.max) {
            skipped.push(
              limits.max === 1 ? 'Esta pieza es de una sola página.' : `Este formato admite ${limits.max} páginas como mucho.`,
            );
            break;
          }
          flush();
          // «Añade una página y duplica esta»: «esta» es la página de la que se partía, no la
          // recién añadida (vacía). Si la activa se ha creado en esta misma orden, se duplica la de origen.
          const origin = working.pages.findIndex((page) => page.id === originPageId);
          const source =
            op.action === 'duplicate' && addedPages.has(working.pages[pageIndex]!.id) && origin >= 0 ? origin : pageIndex;
          const change = op.action === 'add' ? addPage(working, pageIndex) : duplicatePage(working, source);
          if (!change) break;
          if (op.action === 'add') addedPages.add(change.document.pages[change.index]!.id);
          // La copia conserva el orden de las capas: la primera de una es la primera de la otra.
          const originals = working.pages[source]!.layers;
          const copied = change.document.pages[change.index]!.layers;
          const copies =
            op.action === 'duplicate'
              ? new Map(originals.flatMap((layer, i) => (copied[i] ? [[layer.id, copied[i].id] as const] : [])))
              : undefined;
          working = change.document;
          goTo(
            change.index,
            op.action === 'add' ? `Página ${change.index + 1} nueva` : `Página duplicada (ahora, la ${change.index + 1})`,
            copies,
          );
        } else if (op.action === 'remove') {
          flush();
          const change = removePage(working, pageIndex);
          if (!change) {
            skipped.push('Una pieza tiene al menos una página.');
            break;
          }
          const removed = pageIndex + 1;
          working = change.document;
          goTo(change.index, `Borrada la página ${removed}`);
        } else if (op.action === 'move' && op.page !== null) {
          flush();
          const change = movePage(working, pageIndex, op.page - 1);
          if (!change) {
            skipped.push('La página ya está en ese puesto.');
            break;
          }
          working = change.document;
          goTo(change.index, `Página movida al puesto ${change.index + 1}`, new Map(renamed));
        } else if (op.action === 'go') {
          const target =
            op.page !== null
              ? op.page - 1
              : op.direction === 'next'
                ? pageIndex + 1
                : op.direction === 'previous'
                  ? pageIndex - 1
                  : op.direction === 'first'
                    ? 0
                    : count - 1;
          if (target < 0 || target >= count) {
            skipped.push(target < 0 ? 'Ya estás en la primera página.' : count === 1 ? 'Solo hay una página.' : 'Esa página no existe.');
            break;
          }
          if (target === pageIndex) {
            skipped.push('Ya estás en esa página.');
            break;
          }
          flush();
          goTo(target, `Página ${target + 1}`);
        }
        break;
      }
      case 'editor': {
        // Deshacer y rehacer los ejecuta el editor antes de aplicar; aquí, lo que va después.
        if (op.action === 'save' || op.action === 'template') after.push(op.action);
        break;
      }
      case 'generate_background':
      case 'find_photos':
      case 'place_photos': {
        // Los pasos de plan no se aplican aquí: el copiloto los convierte antes en
        // operaciones normales (plan.ts), con la confirmación de la persona.
        skipped.push('Ese paso es de un plan: hay que confirmarlo en el copiloto.');
        break;
      }
    }
  }

  // Lo que un plan ha recolocado tiene que seguir leyéndose donde ha quedado; y sobre un
  // fondo cuyo tono no se ha podido medir, los textos llevan su respaldo.
  if (relocated.size > 0) keepTextsReadable(relocated);
  outlineOverUnmeasured();

  flush();
  // Sin cambios en el documento (solo ir a otra página, abrir un flujo…): el mismo, sin tocar.
  if (JSON.stringify(working) === JSON.stringify(input)) {
    return { ok: true, document: input, changes, skipped, touched: [], pageIndex, flows, after };
  }
  const checked = validateDocument(working);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  const present = new Set(checked.document.pages[pageIndex]!.layers.map((layer) => layer.id));
  return {
    ok: true,
    document: checked.document,
    changes,
    skipped,
    touched: [...touched].filter((id) => present.has(id)),
    pageIndex,
    flows,
    after,
  };
}
