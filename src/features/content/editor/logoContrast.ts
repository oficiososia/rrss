// Que el logotipo se vea sobre su fondo. Las plantillas (historias y publicaciones
// del catálogo) ponen el primer logotipo del kit de la marca; si ese es el oscuro
// y la zona es oscura (la cabecera de «Tapa del día»), no se ve. Aquí se mide la
// luminancia del logotipo (sus píxeles con tinta) y la del color que hay debajo
// (las formas lisas que lo tapan, o el fondo del lienzo) y se elige la variante
// del kit que más contrasta. Si ninguna contrasta, el editor lo avisa.
//
// Puro y sin DOM (lo usa también el cierre de los reels, reels/quality.ts): el editor
// (useLogoContrast.tsx) carga las imágenes, las mide y llama a esto.
import { parseHex, relativeLuminance, type Rgb } from '@/features/brandcheck/color';
import type { ContentDocument, Layer, LogoLayer } from '../document/schema';

/** Contraste mínimo de un elemento gráfico con su fondo (WCAG 2.x, 1.4.11: 3:1). */
export const LOGO_MIN_CONTRAST = 3;

/** Luminancia relativa (0-1) de cada logotipo medido; null si no se ha podido leer. */
export type LogoTones = ReadonlyMap<string, number | null>;

/** ¿Está el punto dentro de la caja de la capa, contando su giro? (Como `layerContains` de frames.ts, sin arrastrar el editor.) */
function layerContains(
  layer: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  point: { x: number; y: number },
) {
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - (layer.x + layer.width / 2);
  const dy = point.y - (layer.y + layer.height / 2);
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(lx) <= layer.width / 2 && Math.abs(ly) <= layer.height / 2;
}

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

// ───────────────────── Variante por nombre (sin medir) ─────────────────────

const word = (words: string) => new RegExp(`(^|[^a-záéíóúüñ])(${words})([^a-záéíóúüñ]|$)`);
/** Nombres de archivo o etiquetas que dicen que un logotipo es la versión clara (o la oscura). */
const LIGHT_LOGO = word('claro|clara|blanco|blanca|white|light|negativo|negativa|inverso|inversa|reverse|reversed');
const DARK_LOGO = word('oscuro|oscura|negro|negra|black|dark');

/** Lo que hace falta de un logotipo de la biblioteca para saber su tono por el nombre. */
export interface NamedLogo {
  id: string;
  storage_path: string;
  file_name?: string;
  tags?: readonly string[] | null;
}

/** Lo que dice de su tono el nombre del archivo (o su ruta, que lo lleva) o sus etiquetas. */
export function namedLogoTone(asset: NamedLogo): 'light' | 'dark' | null {
  const file = asset.storage_path.slice(asset.storage_path.lastIndexOf('/') + 1);
  const words = `${asset.file_name ?? ''} ${file} ${(asset.tags ?? []).join(' ')}`.toLocaleLowerCase('es');
  if (LIGHT_LOGO.test(words)) return 'light';
  if (DARK_LOGO.test(words)) return 'dark';
  return null;
}

/** Por debajo de esta luminancia, un fondo contrasta más con el blanco que con el negro (≈ 0,18). */
export const DARK_BACKDROP_BELOW = Math.sqrt(1.05 * 0.05) - 0.05;

/**
 * La variante del kit para un fondo, con la regla del editor y del cierre de los reels:
 *  - si el logotipo de partida está medido (`tones`), `bestLogoVariant` (la que llega a 3:1 o,
 *    si ninguna, la que más contrasta);
 *  - si no, por el nombre o las etiquetas: sobre un fondo oscuro, la que se llama clara («claro»,
 *    «blanco», «white»…) salvo que la de partida ya lo sea; sobre uno claro, si la de partida se
 *    llama clara, la que se llama oscura (o, si no hay, una que no se llame clara).
 * Si nada indica otra cosa, la de partida.
 */
export function logoVariantFor(
  current: string,
  variants: readonly string[],
  assets: ReadonlyMap<string, NamedLogo>,
  tones: LogoTones | undefined,
  backdrop: number,
): string {
  const measured = tones?.get(current);
  if (tones && measured !== undefined && measured !== null) return bestLogoVariant(current, variants, tones, backdrop);
  const tone = (id: string) => {
    const asset = assets.get(id);
    return asset ? namedLogoTone(asset) : null;
  };
  const others = variants.filter((id) => id !== current && assets.has(id));
  if (backdrop < DARK_BACKDROP_BELOW) {
    if (tone(current) === 'light') return current;
    return others.find((id) => tone(id) === 'light') ?? current;
  }
  if (tone(current) !== 'light') return current;
  return others.find((id) => tone(id) === 'dark') ?? others.find((id) => tone(id) === null) ?? current;
}

/**
 * Las miniaturas de las plantillas (selector y Marca → Plantillas) con el logotipo que se ve: cada
 * capa de logotipo del kit de la marca pasa a la variante que contrasta con lo que tiene debajo
 * (`logoVariantFor`). Lo que no se sabe (una foto debajo) se deja como está. Devuelve el mismo
 * documento si no cambia nada.
 */
export function templateLogos(
  document: ContentDocument,
  logoIds: readonly string[],
  assets: ReadonlyMap<string, NamedLogo>,
  tones?: LogoTones,
): ContentDocument {
  if (logoIds.length < 2) return document;
  const kit = new Set(logoIds);
  let changed = false;
  const pages = document.pages.map((page) => {
    let pageChanged = false;
    const layers = page.layers.map((layer) => {
      if (layer.type !== 'logo' || !kit.has(layer.assetId)) return layer;
      const backdrop = backdropLuminance(page.layers, layer, document.canvas.backgroundColor);
      if (backdrop === null) return layer;
      const next = logoVariantFor(layer.assetId, logoIds, assets, tones, backdrop);
      if (next === layer.assetId) return layer;
      pageChanged = true;
      return { ...layer, assetId: next };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, layers };
  });
  return changed ? { ...document, pages } : document;
}
