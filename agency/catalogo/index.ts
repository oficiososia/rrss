// Catálogo de plantillas de la agencia: de un juego (juegos.ts) y el tema de
// una marca (tema.ts) salen dos archivos de entrega listos para validar y
// cargar:
//   · publicaciones y carruseles → `rrss.agency-templates` (documentos v5 del
//     editor con su análisis; se guardan con `deliver_design_templates`);
//   · reels → `rrss.agency-reel-templates` (plantillas de reel con estructura;
//     se guardan con `deliver_reel_templates`).
// Nada de aquí toca la red.
import { DOCUMENT_SCHEMA_VERSION, type ContentDocumentInput } from '../../src/features/content/document/schema.ts';
import {
  REEL_TEMPLATES_DELIVERY_FORMAT,
  REEL_TEMPLATES_DELIVERY_VERSION,
} from '../../src/features/reels/reelTemplate.ts';
import { TEMPLATES_DELIVERY_FORMAT, TEMPLATES_DELIVERY_VERSION } from '../../src/features/brand/templates.ts';
import { CATALOG_SETS, type CatalogSet, type PostDraft } from './juegos.ts';
import { H, W, type Look } from './publicaciones.ts';
import type { Theme } from './tema.ts';

export { CATALOG_SETS, type CatalogSet } from './juegos.ts';
export { NEUTRAL_THEME, themeFromProfile, themeOverridesSchema, type Theme, type ThemeOverrides } from './tema.ts';

export function findSet(id: string): CatalogSet | undefined {
  return CATALOG_SETS.find((set) => set.id === id);
}

type Role = 'photo' | 'background' | 'headline' | 'body' | 'logo' | 'badge' | 'overlay' | 'price' | 'date' | 'other';

function roleOf(id: string, type: string): Role {
  const name = id.slice(id.indexOf('-') + 1);
  if (name.startsWith('foto')) return 'photo';
  if (name === 'fondo') return 'background';
  if (name === 'titular' || name === 'frase' || name === 'nombre') return 'headline';
  if (name === 'sello-texto' || name.startsWith('dato')) return 'price';
  if (name === 'sello' || name.startsWith('etiqueta')) return 'badge';
  if (name === 'dia' || name === 'mes') return 'date';
  if (name === 'velo' || name === 'franja' || name === 'panel') return 'overlay';
  return type === 'text' ? 'body' : 'other';
}

function positionOf(layer: { x: number; y: number; width: number; height: number }): string {
  if (layer.width >= W * 0.9 && layer.height >= H * 0.9) return 'a sangre, ocupa todo el lienzo';
  const pick = (value: number) => (value < 1 / 3 ? 0 : value < 2 / 3 ? 1 : 2);
  const x = ['a la izquierda', 'centrado', 'a la derecha'][pick((layer.x + layer.width / 2) / W)]!;
  const y = ['arriba', 'en el centro', 'abajo'][pick((layer.y + layer.height / 2) / H)]!;
  return `${y}, ${x}`;
}

/** El análisis que acompaña a una plantilla de publicación: sale de la propia plantilla, sin inventar nada. */
function analysisOf(draft: PostDraft, document: ContentDocumentInput, theme: Theme, look: Look) {
  const first = document.pages?.[0]?.layers ?? [];
  const all = (document.pages ?? []).flatMap((page) => page.layers ?? []);
  const colors: Array<{ hex: string; role: 'background' | 'text' | 'accent' | 'overlay' | 'other'; note: string }> = [];
  const add = (hex: string | null | undefined, role: (typeof colors)[number]['role']) => {
    const value = hex?.toUpperCase();
    if (!value || colors.length >= 8 || colors.some((c) => c.hex === value)) return;
    colors.push({ hex: value, role, note: '' });
  };
  add(document.canvas.backgroundColor, 'background');
  for (const layer of all) if (layer.type === 'text') add(layer.color, 'text');
  for (const layer of all) {
    if (layer.type !== 'shape' || !layer.fill || layer.fill.toUpperCase() === theme.placeholder.toUpperCase()) continue;
    add(layer.fill, layer.fill.toUpperCase() === theme.accent.toUpperCase() ? 'accent' : 'overlay');
  }
  const hasText = all.some((layer) => layer.type === 'text');
  const pages = document.pages?.length ?? 1;
  const summary = [
    draft.purpose,
    `Cuándo: ${draft.whenToUse}`,
    `Material: ${draft.material}`,
    pages > 1 ? `${pages} páginas.` : '',
    'Del catálogo de la agencia: los textos son de muestra y las fotos, marcadores.',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
  return {
    summary,
    layers: first.slice(0, 20).map((layer) => ({
      role: roleOf(layer.id, layer.type),
      position: positionOf(layer),
      description: (layer.type === 'text' ? layer.text : (layer.name ?? '')).trim().slice(0, 300),
    })),
    typography: hasText
      ? [
          {
            role: 'headline' as const,
            family: theme.headline,
            weight: look.weight,
            case: look.upper ? ('upper' as const) : ('sentence' as const),
            note: look.italic ? 'cursiva' : '',
          },
          { role: 'body' as const, family: theme.body, weight: 400, case: 'sentence' as const, note: '' },
        ]
      : [],
    colors,
    logo: { position: 'none' as const },
    photo: { type: draft.photo, treatment: '' },
    tone: { description: draft.caption.slice(0, 400), samples: [] },
    recurrence: { count: 1, reviewed: 1 },
    examples: [],
    references: [],
  };
}

function documentOf(draft: PostDraft, theme: Theme): ContentDocumentInput {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    canvas: {
      aspectRatio: '4:5',
      width: W,
      height: H,
      backgroundColor:
        draft.background === 'accent' ? theme.accent : draft.background === 'light' ? theme.light : theme.dark,
    },
    pages: draft.pages,
    copy: { caption: draft.caption, hashtags: [], mentions: [], altText: '', callToAction: { label: '', url: '' } },
  };
}

/** Archivo de entrega de las publicaciones y carruseles de un juego, con el tema de la marca. */
export function buildPublications(set: CatalogSet, theme: Theme) {
  return {
    format: TEMPLATES_DELIVERY_FORMAT,
    version: TEMPLATES_DELIVERY_VERSION,
    source: 'manual' as const,
    note: `Catálogo de la agencia · juego «${set.name}» (${set.id})`,
    templates: set.posts(theme).map((draft) => {
      const document = documentOf(draft, theme);
      return {
        key: draft.key,
        name: draft.name,
        network: 'instagram',
        format: draft.format,
        document,
        analysis: analysisOf(draft, document, theme, set.look),
        source: 'manual' as const,
      };
    }),
  };
}

/** Archivo de entrega de las plantillas de reel de un juego, con el tema de la marca. */
export function buildReels(set: CatalogSet, theme: Theme) {
  return {
    format: REEL_TEMPLATES_DELIVERY_FORMAT,
    version: REEL_TEMPLATES_DELIVERY_VERSION,
    note: `Catálogo de la agencia · juego «${set.name}» (${set.id})`,
    templates: set.reels(theme),
  };
}
