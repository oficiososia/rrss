// Que el logotipo se vea sobre su fondo. Las plantillas (historias y publicaciones
// del catálogo) ponen el primer logotipo del kit de la marca; si ese es el oscuro
// y la zona es oscura (la cabecera de «Tapa del día»), no se ve. Aquí se mide la
// luminancia del logotipo (sus píxeles con tinta) y la del color que hay debajo
// (las formas lisas que lo tapan, o el fondo del lienzo) y se elige la variante
// del kit que más contrasta. Si ninguna contrasta, el editor lo avisa.
//
// Puro: el editor (useLogoContrast.tsx) carga las imágenes y llama a esto.
import { parseHex, relativeLuminance, type Rgb } from '@/features/brandcheck/color';
import type { ContentDocument, Layer, LogoLayer } from '../document/schema';
import { layerContains } from './frames';

/** Contraste mínimo de un elemento gráfico con su fondo (WCAG 2.x, 1.4.11: 3:1). */
export const LOGO_MIN_CONTRAST = 3;

/** Luminancia relativa (0-1) de cada logotipo medido; null si no se ha podido leer. */
export type LogoTones = ReadonlyMap<string, number | null>;

function blend(top: Rgb, alpha: number, below: Rgb): Rgb {
  const mix = (t: number, b: number) => Math.round(t * alpha + b * (1 - alpha));
  return { r: mix(top.r, below.r), g: mix(top.g, below.g), b: mix(top.b, below.b), a: 1 };
}

function insideEllipse(layer: Layer, point: { x: number; y: number }): boolean {
  const rx = layer.width / 2;
  const ry = layer.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - (layer.x + rx);
  const dy = point.y - (layer.y + ry);
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  return (lx / rx) ** 2 + (ly / ry) ** 2 <= 1;
}

/**
 * Color que se ve en un punto con las capas `layers` (del fondo al frente) sobre el fondo del
 * lienzo. Solo cuentan las formas lisas (rectángulos y elipses con relleno); los textos y otros
 * logotipos se saltan; una foto lo hace imposible de saber (null). Un marco vacío no sale en la
 * imagen: se salta.
 */
export function colorAt(layers: readonly Layer[], point: { x: number; y: number }, background: string): Rgb | null {
  for (let index = layers.length - 1; index >= 0; index--) {
    const layer = layers[index]!;
    if (!layer.visible || layer.opacity <= 0 || !layerContains(layer, point)) continue;
    if (layer.type === 'image') {
      if (layer.source.kind === 'empty') continue;
      return null;
    }
    if (layer.type !== 'shape' || !layer.fill) continue;
    if (layer.shape !== 'rectangle' && layer.shape !== 'ellipse') continue;
    if (layer.shape === 'ellipse' && !insideEllipse(layer, point)) continue;
    const fill = parseHex(layer.fill);
    if (!fill) continue;
    const alpha = layer.opacity * fill.a;
    if (alpha >= 0.98) return { ...fill, a: 1 };
    const below = colorAt(layers.slice(0, index), point, background);
    return below ? blend(fill, alpha, below) : null;
  }
  const base = parseHex(background);
  return base ? { ...base, a: 1 } : null;
}

/** Luminancia del color que hay detrás de un logotipo (en el centro de su caja), o null si no se sabe. */
export function backdropLuminance(
  layers: readonly Layer[],
  logo: Pick<Layer, 'id' | 'x' | 'y' | 'width' | 'height'>,
  background: string,
): number | null {
  const index = layers.findIndex((layer) => layer.id === logo.id);
  const below = index >= 0 ? layers.slice(0, index) : layers;
  const color = colorAt(below, { x: logo.x + logo.width / 2, y: logo.y + logo.height / 2 }, background);
  return color ? relativeLuminance(color) : null;
}

/** Contraste WCAG entre dos luminancias. */
export function luminanceContrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * La variante del kit que mejor se ve sobre un fondo: se queda la actual si ya contrasta lo
 * bastante; si no, la que más contrasta, siempre que mejore. Las que no se han podido medir no cuentan.
 */
export function bestLogoVariant(
  current: string,
  variants: readonly string[],
  tones: LogoTones,
  backdrop: number,
): string {
  const now = tones.get(current);
  if (now === undefined || now === null) return current;
  const currentContrast = luminanceContrast(now, backdrop);
  if (currentContrast >= LOGO_MIN_CONTRAST) return current;
  let best = current;
  let bestContrast = currentContrast;
  for (const id of variants) {
    const tone = tones.get(id);
    if (tone === undefined || tone === null) continue;
    const contrast = luminanceContrast(tone, backdrop);
    if (contrast > bestContrast + 0.01) {
      best = id;
      bestContrast = contrast;
    }
  }
  return best;
}

/**
 * Cambia el logotipo de las capas `candidates` por la variante del kit que se ve sobre su fondo.
 * Devuelve el documento (el mismo si no cambia nada) y qué capas han cambiado.
 */
export function fixLogoContrast(
  document: ContentDocument,
  candidates: ReadonlySet<string>,
  variants: readonly string[],
  tones: LogoTones,
): { document: ContentDocument; swapped: string[] } {
  const swapped: string[] = [];
  const background = document.canvas.backgroundColor;
  const pages = document.pages.map((page) => {
    let changed = false;
    const layers = page.layers.map((layer) => {
      if (layer.type !== 'logo' || !candidates.has(layer.id)) return layer;
      const backdrop = backdropLuminance(page.layers, layer, background);
      if (backdrop === null) return layer;
      const next = bestLogoVariant(layer.assetId, variants, tones, backdrop);
      if (next === layer.assetId) return layer;
      changed = true;
      swapped.push(layer.id);
      return { ...layer, assetId: next };
    });
    return changed ? { ...page, layers } : page;
  });
  return { document: swapped.length > 0 ? { ...document, pages } : document, swapped };
}

/** Logotipos visibles (de cualquier página) que apenas se ven sobre su fondo, con lo que se sabe de cada uno. */
export function faintLogos(
  document: ContentDocument,
  tones: LogoTones,
): { layer: LogoLayer; pageIndex: number; logoIsDark: boolean }[] {
  const faint: { layer: LogoLayer; pageIndex: number; logoIsDark: boolean }[] = [];
  document.pages.forEach((page, pageIndex) => {
    for (const layer of page.layers) {
      if (layer.type !== 'logo' || !layer.visible || layer.opacity <= 0) continue;
      const tone = tones.get(layer.assetId);
      if (tone === undefined || tone === null) continue;
      const backdrop = backdropLuminance(page.layers, layer, document.canvas.backgroundColor);
      if (backdrop === null) continue;
      if (luminanceContrast(tone, backdrop) < LOGO_MIN_CONTRAST)
        faint.push({ layer, pageIndex, logoIsDark: tone < backdrop });
    }
  });
  return faint;
}

/**
 * Luminancia media de lo que se ve de un logotipo: los píxeles con tinta (alfa), pesados por su
 * opacidad, en una copia pequeña. Null si no tiene píxeles visibles o el navegador no deja leerlos.
 */
export function measureLogoLuminance(image: CanvasImageSource & { width: number; height: number }): number | null {
  const side = 64;
  const scale = Math.min(1, side / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    context.drawImage(image, 0, 0, width, height);
    return luminanceOfPixels(context.getImageData(0, 0, width, height).data);
  } catch {
    return null;
  }
}

/** Luminancia media de unos píxeles RGBA, pesada por el alfa; null si todos son transparentes. */
export function luminanceOfPixels(data: ArrayLike<number>): number | null {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3]! / 255;
    if (alpha < 0.1) continue;
    sum += alpha * relativeLuminance({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
    weight += alpha;
  }
  return weight > 0 ? sum / weight : null;
}
