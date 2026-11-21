import { LOGO_POSITIONS, templateAnalysisSchema, type TemplateAnalysis } from '@/features/brand/templates';
import { allLayers, type ContentDocument, type Layer } from '../document';
import { getFormatSpec } from '../networks';

// Guardar el diseño que se tiene abierto como plantilla de la marca (origen
// `editor`): se arma el análisis resumido a partir del propio documento, sin IA
// y sin inventar nada (qué capas hay, qué colores y tipografías usa, dónde va el
// logotipo). Lo guarda `deliver_design_templates`, la misma función de siempre.

const HORIZONTAL = ['a la izquierda', 'centrado', 'a la derecha'] as const;
const VERTICAL = ['arriba', 'en el centro', 'abajo'] as const;
const LOGO_GRID: Record<string, (typeof LOGO_POSITIONS)[number]> = {
  '0,0': 'top-left',
  '1,0': 'top-center',
  '2,0': 'top-right',
  '0,1': 'middle-left',
  '1,1': 'center',
  '2,1': 'middle-right',
  '0,2': 'bottom-left',
  '1,2': 'bottom-center',
  '2,2': 'bottom-right',
};

function cell(layer: Layer, canvas: { width: number; height: number }): [number, number] {
  const cx = (layer.x + layer.width / 2) / canvas.width;
  const cy = (layer.y + layer.height / 2) / canvas.height;
  const pick = (value: number) => (value < 1 / 3 ? 0 : value < 2 / 3 ? 1 : 2);
  return [pick(cx), pick(cy)];
}

function positionOf(layer: Layer, canvas: { width: number; height: number }): string {
  const covers = layer.width >= canvas.width * 0.9 && layer.height >= canvas.height * 0.9;
  if (covers) return 'a sangre, ocupa todo el lienzo';
  const [x, y] = cell(layer, canvas);
  return `${VERTICAL[y]}, ${HORIZONTAL[x]}`;
}

const upper = (hex: string) => hex.toUpperCase();

/** El análisis de una plantilla guardada desde el editor, validado con el mismo esquema que las demás. */
export function analyzeDocument(document: ContentDocument): TemplateAnalysis {
  const page = document.pages[0]!;
  const canvas = document.canvas;
  const layers = page.layers.slice(0, 20);
  const texts = layers.filter((layer): layer is Extract<Layer, { type: 'text' }> => layer.type === 'text');
  const biggest = texts.reduce<string | null>(
    (best, layer) =>
      best === null || layer.fontSize > (texts.find((t) => t.id === best)?.fontSize ?? 0) ? layer.id : best,
    null,
  );

  const analysisLayers = layers.map((layer) => ({
    role: (layer.type === 'image'
      ? 'photo'
      : layer.type === 'logo'
        ? 'logo'
        : layer.type === 'text'
          ? layer.id === biggest
            ? 'headline'
            : 'body'
          : 'other') as 'photo' | 'logo' | 'headline' | 'body' | 'other',
    position: positionOf(layer, canvas),
    description: layer.type === 'text' ? layer.text.trim().slice(0, 300) : '',
  }));

  const colors: { hex: string; role: 'background' | 'text' | 'accent' | 'other'; note: string }[] = [];
  const addColor = (hex: string | null | undefined, role: 'background' | 'text' | 'accent' | 'other') => {
    if (!hex || colors.length >= 8) return;
    const value = upper(hex);
    if (!colors.some((c) => c.hex === value)) colors.push({ hex: value, role, note: '' });
  };
  addColor(canvas.backgroundColor, 'background');
  for (const text of texts) addColor(text.color, 'text');
  for (const layer of layers) if (layer.type === 'shape') addColor(layer.fill, 'accent');

  const fonts: TemplateAnalysis['typography'] = [];
  for (const text of [...texts].sort((a, b) => b.fontSize - a.fontSize)) {
    if (fonts.length >= 6 || fonts.some((f) => f.family === text.fontFamily)) continue;
    fonts.push({
      role: fonts.length === 0 ? 'headline' : 'body',
      family: text.fontFamily.slice(0, 120),
      weight: text.fontWeight,
      case: 'sentence',
      note: '',
    });
  }

  const logo = layers.find((layer) => layer.type === 'logo');
  const [lx, ly] = logo ? cell(logo, canvas) : [0, 0];
  const photos = layers.filter((layer) => layer.type === 'image').length;
  const counts = [
    photos > 0 ? `${photos} ${photos === 1 ? 'foto' : 'fotos'}` : null,
    texts.length > 0 ? `${texts.length} ${texts.length === 1 ? 'texto' : 'textos'}` : null,
    layers.length - photos - texts.length > 0 ? `${layers.length - photos - texts.length} más` : null,
  ].filter(Boolean);

  return templateAnalysisSchema.parse({
    summary: `Guardada desde el editor: ${counts.join(', ') || 'sin capas'} en ${canvas.aspectRatio}${
      page.layers.length > 20 ? ' (las 20 primeras capas)' : ''
    }.`,
    layers: analysisLayers.length > 0 ? analysisLayers : [{ role: 'other', position: 'vacía', description: '' }],
    typography: fonts,
    colors: colors.length > 0 ? colors : [{ hex: '#FFFFFF', role: 'background', note: '' }],
    logo: logo
      ? {
          position: LOGO_GRID[`${lx},${ly}`] ?? 'center',
          sizePercent: Math.min(100, Math.max(0, Math.round((logo.width / canvas.width) * 100))),
        }
      : { position: 'none' },
    photo: { type: photos > 0 ? 'Foto de la propia pieza (se sustituye por otra)' : 'Sin fotos', treatment: '' },
    tone: {
      description: 'Los textos son los de la pieza de la que sale: sirven de guía, no de regla.',
      samples: texts
        .map((t) => t.text.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 3),
    },
    recurrence: { count: 1, reviewed: 1 },
    examples: [],
    references: [],
  });
}

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Clave estable y única (la misma clave actualizaría una plantilla ya guardada). */
export function newTemplateKey(name: string, random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 36 ** 5)
    .toString(36)
    .padStart(5, '0');
  return `editor-${slug(name) || 'plantilla'}-${suffix}`;
}

export interface TemplateDraft {
  key: string;
  name: string;
  network: string;
  format: string;
  document: ContentDocument;
  analysis: TemplateAnalysis;
  source: 'editor';
}

/** Lo que se manda a `deliver_design_templates`. Null si no hay nada que guardar (sin capas) o el formato no existe. */
export function buildEditorTemplate(input: {
  name: string;
  network: string;
  format: string;
  document: ContentDocument;
  key?: string;
}): TemplateDraft | null {
  const name = input.name.trim().slice(0, 120);
  if (!name || allLayers(input.document).length === 0 || !getFormatSpec(input.network, input.format)) return null;
  return {
    key: input.key ?? newTemplateKey(name),
    name,
    network: input.network,
    format: input.format,
    document: input.document,
    analysis: analyzeDocument(input.document),
    source: 'editor',
  };
}
