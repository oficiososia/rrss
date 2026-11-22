import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación de Biblioteca y Analítica: la aplicación real con el
// Supabase simulado. Parámetro `?vista=`:
//   biblioteca   ~270 archivos en carpetas «Platos / Mariscos», «Vinos / Tintos»…
//   ficha        igual, con la ficha de un archivo abierta (?recurso=)
//   analitica    cifras de 56 días y tres publicaciones
//   sin-cifras   la cuenta conectada, sin ninguna cifra todavía
//   sin-cuenta   ninguna cuenta conectada
const view = new URLSearchParams(window.location.search).get('vista') ?? 'biblioteca';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

seedWorkspace({ orgRole: 'owner' });
fake.rpc('asset_facets', () => [{ tags: ['marisco', 'tinto'], folders: [] }]);

// ── Biblioteca ──
const FOLDERS = [
  'Platos / Mariscos',
  'Platos / Carnes',
  'Platos / Postres',
  'Vinos / Tintos',
  'Vinos / Blancos',
  'Local / Sala',
  'Local / Terraza',
  'Equipo',
];
const assets = Array.from({ length: 270 }, (_, i) => ({
  id: `asset-${String(i).padStart(3, '0')}`,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: i % 40 === 0 ? 'video' : i % 55 === 0 ? 'logo' : 'image',
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/foto-${i}.jpg`,
  thumb_path: `${ORG_ID}/${BRAND_ID}/thumbs/foto-${i}.jpg`,
  file_name: `IMG_2026${String(i).padStart(4, '0')}_${i % 3 ? 'langostinos_de_la_bahia_al_ajillo' : 'chuleta'}.jpg`,
  mime_type: i % 40 === 0 ? 'video/mp4' : 'image/jpeg',
  bytes: 1_000_000,
  width: 4000,
  height: 3000,
  duration_ms: null,
  sha256: null,
  folder: i % 9 === 0 ? '' : FOLDERS[i % FOLDERS.length]!,
  tags: i % 4 === 0 ? ['marisco'] : [],
  rights: {},
  provenance: {},
  created_by: null,
  created_at: new Date(Date.now() - i * 3_600_000).toISOString(),
  updated_at: '2026-11-18T09:00:00Z',
}));
fake.tables.media_assets = assets;
fake.rpc('asset_usage', () => [
  {
    asset_id: assets[1]!.id,
    content_id: 'c1',
    title: 'Menú de otoño',
    network: 'instagram',
    format: 'post',
    status: 'draft',
    archived: false,
  },
]);

// ── Analítica ──
const def = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  network: 'instagram',
  scope: 'account',
  api_name: 'x',
  api_source: 'insights',
  label,
  description: '',
  unit: 'count',
  aggregation: 'daily',
  media_types: [],
  estimated: false,
  in_development: false,
  status: 'captured',
  status_note: '',
  delay_hours: 48,
  source_url: 'https://developers.facebook.com/',
  verified_on: '2026-11-18',
  sort: 10,
  ...extra,
});
fake.tables.analytics_metric_definitions = [
  def('instagram.account.followers', 'Seguidores', { aggregation: 'snapshot', sort: 1 }),
  def('instagram.account.reach', 'Alcance', { estimated: true, sort: 2 }),
  def('instagram.account.views', 'Visualizaciones', { sort: 3 }),
  def('instagram.account.total_interactions', 'Interacciones', { sort: 4 }),
];
const noAccount = view === 'sin-cuenta';
fake.tables.social_accounts = noAccount
  ? []
  : [
      {
        id: 'acc-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        network: 'instagram',
        username: 'casa_demo',
        status: 'active',
        created_at: '2026-11-01T00:00:00Z',
      },
    ];
const metricRows: Array<Record<string, unknown>> = [];
if (view === 'analitica') {
  for (let i = -56; i < 0; i++) {
    const wave = 1 + 0.3 * Math.sin(i / 4);
    for (const [metric, base] of [
      ['instagram.account.reach', 150],
      ['instagram.account.views', 420],
      ['instagram.account.total_interactions', 38],
    ] as const) {
      metricRows.push({
        brand_id: BRAND_ID,
        metric_id: metric,
        metric_date: day(i),
        value: String(Math.round(base * wave * (i < -28 ? 0.8 : 1))),
        provisional: i > -3,
      });
    }
  }
  metricRows.push({
    brand_id: BRAND_ID,
    metric_id: 'instagram.account.followers',
    metric_date: day(-1),
    value: 12_345,
    provisional: false,
  });
}
fake.tables.account_metrics_daily = metricRows;
fake.tables.analytics_capture_runs = [];
fake.tables.analytics_reports = [];
fake.tables.scheduled_publications = [];
fake.rpc('analytics_media_summary', () =>
  view === 'analitica'
    ? [90, 70, 50, 30, 20, 10].map((n, i) => ({
        publication_id: `p${i}`,
        title: i === 0 ? 'Chuletón de vaca madurada con patatas panaderas y pimientos del piquillo' : `Publicación ${i}`,
        format: 'post',
        network: 'instagram',
        media_product_type: i % 2 ? 'REELS' : 'FEED',
        published_at: `${day(-3 - i)}T10:00:00Z`,
        external_url: 'https://instagram.simulado.invalid/p/1/',
        provisional: false,
        metrics: { 'instagram.media.total_interactions': n * 3, 'instagram.media.reach': n * 40 },
      }))
    : [],
);
fake.tables.content_items = [];
fake.tables.content_versions = [];
fake.tables.jobs = [];
fake.tables.brand_profiles = [];

const path =
  view === 'ficha'
    ? `${BRAND_BASE}/biblioteca?recurso=${assets[1]!.id}`
    : view === 'biblioteca'
      ? `${BRAND_BASE}/biblioteca`
      : `${BRAND_BASE}/analitica`;
void ME;
window.history.pushState({}, '', path);
createRoot(document.getElementById('root')!).render(<App />);
