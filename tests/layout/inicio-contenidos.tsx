import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { createEmptyDocument, DOCUMENT_SCHEMA_VERSION, type Layer } from '@/features/content/document';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación del Inicio de la marca y de la lista de Contenidos: la aplicación real con el
// Supabase simulado. Parámetros: ?vista=inicio|contenidos|vacia   &largos=1 (títulos larguísimos)
const params = new URLSearchParams(window.location.search);
const view = params.get('vista') ?? 'inicio';
const long = params.get('largos') === '1';

const base = { rotation: 0, opacity: 1, visible: true, locked: false, anchor: { x: 'center', y: 'center' } } as const;

function documentFor(ratio: '4:5' | '9:16', title: string, color: string) {
  const doc = createEmptyDocument({ aspectRatio: ratio });
  const { width, height } = doc.canvas;
  const layers = [
    { ...base, id: 'fondo', type: 'shape', name: 'Fondo', x: 0, y: 0, width, height, shape: 'rectangle', fill: color, stroke: null, cornerRadius: 0 },
    {
      ...base,
      id: 'titulo',
      type: 'text',
      name: '',
      x: width * 0.08,
      y: height * 0.4,
      width: width * 0.84,
      height: height * 0.2,
      text: title,
      fontFamily: 'Georgia',
      fontSize: 72,
      fontWeight: 700,
      italic: false,
      color: '#1F2937',
      align: 'center',
      lineHeight: 1.2,
    },
  ] as Layer[];
  return { ...doc, pages: doc.pages.map((page) => ({ ...page, layers })) };
}

seedWorkspace({ orgRole: 'owner' });
const COLORS = ['#E9DCC3', '#CFE3D4', '#F4D6CC', '#D5DEF0', '#F1E7A8'];
const FORMATS = ['post', 'carousel', 'reel', 'story'] as const;
const NAMES = [
  'Chuletón de la casa',
  'Menú de otoño',
  'Reel del vermut',
  'Historia del sábado',
  'Brindis de Navidad',
  'Postre de temporada',
  'Cata de vinos',
  'Tapas del día',
  'Arroz del domingo',
  'Terraza abierta',
];
const LONG = 'Una publicación con un nombre larguísimo que nadie querría leer entero en una tarjeta pequeña';
const stages = ['idea', 'draft', 'in_review', 'approved', 'approved', 'approved', 'draft', 'idea', 'approved', 'draft'] as const;

const items =
  view === 'vacia'
    ? []
    : NAMES.map((name, i) => {
        const format = FORMATS[i % 4]!;
        const empty = i === 7 || i === 9;
        return {
          id: `c${i}`,
          brand_id: BRAND_ID,
          organization_id: ORG_ID,
          title: long ? `${LONG} ${i}` : name,
          network: 'instagram',
          format,
          status: stages[i]!,
          current_version: empty ? 0 : 1,
          archived_at: null,
          created_by: ME.id,
          created_at: '2026-11-10T09:00:00Z',
          updated_at: `2026-11-${String(20 - i).padStart(2, '0')}T09:00:00Z`,
        };
      });
fake.tables.content_items = items;
fake.tables.content_versions = items
  .filter((i) => i.current_version > 0 && i.format !== 'reel')
  .map((i, n) => ({
    id: `v${n}`,
    content_id: i.id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    schema_version: DOCUMENT_SCHEMA_VERSION,
    data: documentFor(i.format === 'story' ? '9:16' : '4:5', i.title.slice(0, 40), COLORS[n % COLORS.length]!),
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  }));
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const publication = (id: string, contentId: string, patch: Record<string, unknown>) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  content_id: contentId,
  content_version: 1,
  social_account_id: null,
  network: 'instagram',
  format: 'post',
  media_asset_ids: [],
  hold_reason: null,
  generation: 1,
  attempt_count: 0,
  last_error_code: null,
  last_error: null,
  container_id: null,
  container_created_at: null,
  external_id: null,
  external_url: null,
  published_at: null,
  ...patch,
});
// La semana del inicio va de lunes a domingo: lo programado se coloca dentro de ella (si el día ya
// no cabe antes del domingo, más tarde hoy), para que el banco sirva cualquier día de la semana.
const endOfWeek = (() => {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7).getTime() - 3_600_000;
})();
const inWeek = (n: number) => {
  const at = Date.now() + n * 86_400_000;
  return new Date(at < endOfWeek ? at : Date.now() + (n + 1) * 60_000).toISOString();
};
fake.tables.scheduled_publications =
  view === 'vacia'
    ? []
    : [
        publication('p1', 'c3', { status: 'scheduled', scheduled_at: inWeek(0.01) }),
        publication('p2', 'c4', { status: 'scheduled', scheduled_at: inWeek(1.2) }),
        publication('p3', 'c5', { status: 'scheduled', scheduled_at: inWeek(1.3) }),
        publication('p4', 'c8', { status: 'scheduled', scheduled_at: inWeek(1.4) }),
        publication('p5', 'c0', { status: 'scheduled', scheduled_at: inDays(3), hold_reason: 'no_account' }),
        publication('p6', 'c1', {
          status: 'published',
          scheduled_at: inDays(-3),
          published_at: inDays(-3),
          external_url: 'https://instagram.simulado.invalid/p/1/',
        }),
        publication('p7', 'c2', { status: 'published', scheduled_at: inDays(-6), published_at: inDays(-6) }),
      ];
fake.tables.social_accounts = [];
fake.tables.media_assets = [];
fake.tables.campaigns = [];
fake.tables.campaign_contents = [];
fake.tables.brand_design_templates = [];
fake.tables.brand_reel_templates = ['asi-se-hace', 'corte-ritmico-marca', 'antes-y-despues', 'tres-pasos', 'el-plato-estrella', 'ambiente'].map(
  (key, i) => ({
    id: `rt-${i}`,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    template_key: key,
    name: `Plantilla de reel número ${i + 1} con un nombre largo`,
    source: 'catalog',
    document: {
      kind: 'rrss.reel-template',
      schemaVersion: 1,
      purpose: 'Enseñar un producto con el resultado como gancho.',
      whenToUse: 'Para el producto estrella.',
      material: '2 fotos o clips: resultado y cierre.',
      style: { id: 'corte-ritmico' },
      slots: [
        { id: 'resultado', label: 'Resultado', kind: 'any', seconds: 1.8 },
        { id: 'final', label: 'Cierre', kind: 'any', seconds: 3 },
      ],
      texts: [],
    },
  }),
);
fake.rpc('analytics_media_summary', () => [
  {
    publication_id: 'p6',
    title: 'Menú de otoño',
    format: 'post',
    network: 'instagram',
    media_product_type: 'FEED',
    published_at: inDays(-3),
    external_url: null,
    provisional: false,
    metrics: { 'instagram.media.reach': 12840, 'instagram.media.total_interactions': 932 },
  },
]);

const path = view === 'inicio' ? `${BRAND_BASE}/inicio` : `${BRAND_BASE}/contenidos`;
window.history.pushState({}, '', path);
createRoot(document.getElementById('root')!).render(<App />);
