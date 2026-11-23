import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import type { ContentItemRow, ScheduledPublicationRow, SocialAccountRow } from '@/lib/database.types';
import { safeZone } from '@/features/social/zone';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, brandRow, ORG_ID, seedWorkspace } from '@/test/fixtures';
import { seedWeek } from '@/test/semana';

// Banco de maquetación del Calendario: la aplicación real con el Supabase simulado y una
// semana CARGADA (la de hoy): un día con ocho piezas, dos el mismo día con títulos largos,
// una detenida con su motivo, una fallida, publicadas, una campaña y piezas por programar.

seedWorkspace({ orgRole: 'owner' });

// La semana de hoy EN LA ZONA DE LA MARCA y con las funciones del calendario (src/test/semana.ts).
// Calculada en UTC, entre las 00:00 y la 01:00 (o las 02:00 en verano) de un lunes en Madrid salía
// la semana anterior y el calendario quedaba vacío.
const week = seedWeek(safeZone(brandRow().timezone));
const at = (day: number, hour: number) => week.at(day, hour);

const titles = [
  'Chuletón de la casa con patatas panaderas y pimientos del padrón',
  'Menú del día: crema de calabaza, bacalao a la brasa y tarta de queso',
  'Vermut de domingo en la terraza',
  'Reel: del fuego a la mesa',
  'Carrusel de postres de otoño',
  'Nuevo horario de las fiestas de diciembre y cómo reservar mesa con tiempo',
  'Tapas de temporada',
  'Cata de vinos del Alicante',
];

const items: ContentItemRow[] = [];
const pubs: ScheduledPublicationRow[] = [];
let n = 0;
function add(day: number, hour: number, patch: Partial<ScheduledPublicationRow> = {}, format = 'post') {
  const id = `c-${n}`;
  const when = at(day, hour);
  const past = when.getTime() < Date.now();
  items.push({
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: titles[n % titles.length]!,
    network: 'instagram',
    format,
    status: 'approved',
    current_version: 1,
    archived_at: null,
    created_by: null,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  } as ContentItemRow);
  pubs.push({
    id: `p-${n}`,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    content_id: id,
    content_version: 1,
    social_account_id: 'acc-1',
    network: 'instagram',
    format,
    scheduled_at: when.toISOString(),
    media_asset_ids: ['asset-1'],
    status: past ? 'published' : 'scheduled',
    hold_reason: null,
    generation: 1,
    attempt_count: 0,
    last_error_code: null,
    last_error: null,
    container_id: null,
    container_created_at: null,
    external_id: past ? `179${n}` : null,
    external_url: null,
    published_at: past ? when.toISOString() : null,
    locked_by: null,
    locked_until: null,
    created_by: null,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    ...patch,
  } as ScheduledPublicationRow);
  n += 1;
}
add(0, 9);
add(0, 17, {}, 'carousel');
for (let h = 8; h < 16; h += 1) add(2, h, {}, h % 3 === 0 ? 'reel' : 'post'); // un día con ocho
add(3, 10, { status: 'planned', hold_reason: 'no_account', social_account_id: null });
add(4, 12, { status: 'failed', last_error: 'Instagram lo rechazó' });
add(5, 11, {}, 'carousel');

fake.tables.content_items = items;
fake.tables.scheduled_publications = pubs;
fake.tables.publication_attempts = [];
fake.tables.content_comments = [];
fake.tables.content_versions = [];
fake.tables.social_accounts = [
  {
    id: 'acc-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    network: 'instagram',
    provider: 'meta',
    external_id: '1784',
    username: 'casa_demo',
    display_name: 'Casa Demo',
    page_id: '1',
    status: 'active',
    scopes: [],
    token_expires_at: null,
    token_checked_at: null,
    quota_usage: null,
    quota_total: null,
    quota_checked_at: null,
    last_error: null,
    connected_by: null,
    connected_at: '2026-11-10T09:00:00Z',
    disconnected_at: null,
    connection_method: 'oauth',
    token_renewed_at: null,
    renewal_attempted_at: null,
    renewal_error: null,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  } as SocialAccountRow,
];
fake.tables.media_assets = [];
fake.tables.campaigns = [
  {
    id: 'camp-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Menú de otoño con producto de proximidad',
    instruction: '',
    networks: ['instagram'],
    starts_on: week.dayKey(1),
    ends_on: week.dayKey(4),
    origin: 'ai',
    status: 'accepted',
    current_plan_version: 1,
    accepted_plan_version: 1,
    created_by: null,
    accepted_by: null,
    accepted_at: null,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  },
];
fake.tables.campaign_contents = [];
// Piezas por programar (sin publicación).
for (const [id, title, status] of [
  ['c-t1', 'Tapas de otoño', 'approved'],
  ['c-t2', 'Idea para Nochevieja con un título bastante largo para comprobar que no se sale', 'draft'],
] as const) {
  items.push({
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title,
    network: 'instagram',
    format: 'post',
    status,
    current_version: 1,
    archived_at: null,
    created_by: null,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  } as ContentItemRow);
}

window.history.pushState({}, '', `${BRAND_BASE}/calendario`);
createRoot(document.getElementById('root')!).render(<App />);
