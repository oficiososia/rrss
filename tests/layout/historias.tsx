import { CATALOG_SETS, NEUTRAL_THEME, type Theme } from '../../agency/catalogo/index.ts';
import { buildCatalogWith } from '../../agency/catalogo/construir.ts';
import { pageView, validateDocumentFromAnyVersion, type ContentDocument } from '@/features/content/document';
import { renderDocument } from '@/features/content/editor/canvas/exporter';

// Banco de las historias del catálogo: arma una plantilla de historia con un tema, pone fotos en sus
// marcos (y el logotipo, si lo hay) y la exporta con el exportador real del editor. Lo usa
// historias.spec.ts: comprueba que salen a 1080 × 1920 y, si se le pide, deja las vistas previas.

interface Fonts {
  family: string;
  /** data: URL del archivo de la tipografía. */
  url: string;
  weight?: string;
  style?: string;
}

interface RenderInput {
  set?: string;
  key: string;
  theme?: Partial<Theme>;
  /** Una data: URL por marco, en el orden en que aparecen; si falta, el marco se queda vacío. */
  photos: string[];
  /** Imagen del logotipo (data: URL), si el tema lleva logotipo. */
  logo?: string;
  fonts?: Fonts[];
  /** Textos que cambia quien la usa (como al tocarlos en el editor): identificador de la capa → texto. */
  texts?: Record<string, string>;
}

const LOGO_ID = '99999999-9999-4999-8999-999999999999';
const photoId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function render(input: RenderInput) {
  for (const font of input.fonts ?? []) {
    const face = new FontFace(font.family, `url(${font.url})`, {
      weight: font.weight ?? '100 900',
      style: font.style ?? 'normal',
    });
    document.fonts.add(await face.load());
  }
  const theme: Theme = { ...NEUTRAL_THEME, ...input.theme, ...(input.logo ? { logo: LOGO_ID } : {}) };
  const built = buildCatalogWith(input.set ?? 'restaurante', theme, ['corte-ritmico', 'fundido-suave', 'pase-lateral']);
  const template = built.stories?.templates.find((t) => t.key === input.key);
  if (!template) throw new Error(`No hay historia «${input.key}»`);
  const parsed = validateDocumentFromAnyVersion(template.document);
  if (!parsed.ok) throw new Error('Documento no válido');
  const lookup = new Map<string, string>();
  if (input.logo) lookup.set(LOGO_ID, input.logo);
  let n = 0;
  const filled: ContentDocument = {
    ...parsed.document,
    pages: parsed.document.pages.map((page) => ({
      ...page,
      layers: page.layers.map((layer) => {
        if (layer.type === 'text' && input.texts?.[layer.id] !== undefined) return { ...layer, text: input.texts[layer.id]! };
        if (layer.type !== 'image' || layer.source.kind !== 'empty') return layer;
        const url = input.photos[n];
        n += 1;
        if (!url) return layer;
        const id = photoId(n);
        lookup.set(id, url);
        return { ...layer, source: { kind: 'asset' as const, assetId: id } };
      }),
    })),
  };
  const result = await renderDocument(pageView(filled, 0), lookup, { format: 'png', quality: 1, pixelRatio: 1 });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(result.blob);
  });
  return { width: result.width, height: result.height, frames: n, dataUrl };
}

const api = window as unknown as Record<string, unknown>;
api.renderStory = render;
api.storyKeys = (set = 'restaurante') =>
  (CATALOG_SETS.find((s) => s.id === set)?.stories?.(NEUTRAL_THEME) ?? []).map((s) => s.key);
api.ready = true;
