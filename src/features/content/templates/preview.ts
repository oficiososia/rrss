import { pageView, type ContentDocument, type Layer } from '../document';
import type { ImageLookup } from '../editor/canvas/nodes';

// Vista previa de una plantilla: se dibuja con el MISMO motor que el lienzo y la
// exportación (`editor/canvas/exporter.ts`), no con un esquema. Los huecos de foto
// se rellenan con fotos de ejemplo de la biblioteca de la marca (o, si no hay,
// con un marcador neutro) y los textos llevan el texto de muestra de la propia
// plantilla. Se dibuja pequeña (PREVIEW_SIDE px), de una en una para no bloquear
// la pantalla, y el resultado se guarda por plantilla y fotos usadas.

/** Lado largo de la vista previa, en píxeles: de sobra para una tarjeta de 100 a 160 px. */
export const PREVIEW_SIDE = 280;
export const PREVIEW_CACHE_SIZE = 80;
/** Id de recurso que no existe: es el marcador neutro que ocupa los huecos de foto si la marca no tiene fotos. */
export const PLACEHOLDER_ASSET_ID = '00000000-0000-4000-8000-00000000f034';

const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8edf3"/>' +
  '<stop offset="1" stop-color="#c3cedb"/></linearGradient></defs>' +
  '<rect width="400" height="400" fill="url(#g)"/>' +
  '<circle cx="288" cy="116" r="34" fill="#ffffff" fill-opacity=".75"/>' +
  '<path d="M0 330 L120 196 L206 290 L270 228 L400 350 L400 400 L0 400 Z" fill="#ffffff" fill-opacity=".55"/>' +
  '<path d="M0 372 L150 270 L250 350 L330 296 L400 360 L400 400 L0 400 Z" fill="#ffffff" fill-opacity=".4"/></svg>';

/** Marcador neutro para un hueco de foto cuando la marca no tiene fotos de ejemplo. */
export const PLACEHOLDER_PHOTO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`;

/**
 * La plantilla con los huecos de foto de la primera página rellenos con las fotos de ejemplo (en
 * ciclo, empezando por `offset` para que plantillas distintas no enseñen siempre la misma). Se
 * quitan el recorte y el giro de la foto original, que no valen para otra imagen; la luz y el
 * color se mantienen porque son parte del estilo. Sin fotos de ejemplo, todos llevan el marcador.
 */
export function withSamplePhotos(document: ContentDocument, sampleIds: string[], offset = 0): ContentDocument {
  const ids = sampleIds.length > 0 ? sampleIds : [PLACEHOLDER_ASSET_ID];
  let next = Math.max(0, offset);
  const swap = (layer: Layer): Layer => {
    if (layer.type !== 'image') return layer;
    const rest: Record<string, unknown> = { ...layer };
    for (const key of ['crop', 'turn', 'flipX', 'flipY', 'straighten']) delete rest[key];
    const assetId = ids[next++ % ids.length]!;
    return { ...rest, source: { kind: 'asset', assetId }, focus: { x: 0.5, y: 0.5 } } as Layer;
  };
  const [first, ...others] = document.pages;
  if (!first) return document;
  return { ...document, pages: [{ ...first, layers: first.layers.map(swap) }, ...others] };
}

/** Huella corta y estable de un texto (FNV-1a), para saber si una plantilla ha cambiado. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Dibuja la primera página y devuelve una dirección `blob:` de la imagen pequeña. Lanza si no se puede. */
export async function renderPreview(document: ContentDocument, images: ImageLookup): Promise<string> {
  const { renderDocument } = await import('../editor/canvas/exporter');
  const view = pageView(document, 0);
  const pixelRatio = PREVIEW_SIDE / Math.max(view.canvas.width, view.canvas.height);
  const rendered = await renderDocument(view, images, { format: 'jpeg', quality: 0.72, pixelRatio });
  return URL.createObjectURL(rendered.blob);
}

// Un solo dibujo a la vez, cediendo el paso al navegador entre uno y otro.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return job();
  });
  chain = run.catch(() => undefined);
  return run;
}

const cache = new Map<string, Promise<string | null>>();

/**
 * La vista previa de `key`, dibujada con `draw` si no está ya. Compartida por quien la pida a la
 * vez (una sola ejecución) y acotada (LRU). Nunca lanza: `null` si no se ha podido dibujar, y ese
 * fallo no se recuerda.
 */
export function cachedPreview(key: string, draw: () => Promise<string>): Promise<string | null> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending: Promise<string | null> = enqueue(draw).then(
    (url) => url,
    () => {
      if (cache.get(key) === pending) cache.delete(key);
      return null;
    },
  );
  cache.set(key, pending);
  while (cache.size > PREVIEW_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return pending;
}

/** Solo para las pruebas. */
export function clearPreviewCache(): void {
  cache.clear();
}
