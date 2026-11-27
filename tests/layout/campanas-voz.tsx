import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, brandRow, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación del diálogo «Preparar un plan con IA»: la aplicación real
// con el Supabase simulado. Las funciones responden con textos largos a propósito.
seedWorkspace({ orgRole: 'member', brandRole: 'editor', brands: [brandRow({ ai_mode: 'api' })] });
for (const table of [
  'campaigns',
  'campaign_plans',
  'campaign_contents',
  'content_items',
  'content_versions',
  'content_requests',
  'media_assets',
  'brand_knowledge_sources',
  'brand_design_templates',
  'brand_reel_templates',
]) {
  fake.tables[table] = [];
}
fake.tables.social_accounts = ['instagram', 'facebook'].map((network, i) => ({
  id: `acc-${i}`,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  network,
  status: 'active',
  external_id: `${i}`,
  username: `cuenta_${i}`,
}));

const start = '2026-12-07';
fake.fn('ai-generate', () => ({
  status: 200,
  body: {
    action: 'campaign.brief',
    generationId: '11111111-1111-4111-8111-111111111111',
    status: 'proposal',
    question: null,
    notes: ['La IA no eligió ninguna red de las de la marca: he dejado la primera.'],
    costMicros: 1200,
    proposal: {
      title: 'Menú de otoño con producto de temporada de la huerta cercana y su cocina de brasa',
      objective: 'Dar a conocer el menú de otoño y llenar las mesas de entre semana durante las semanas previas a Navidad.',
      networks: ['instagram', 'facebook'],
      startDate: start,
      endDate: '2026-12-27',
      perWeek: 5,
      mix: [
        { network: 'instagram', format: 'reel', perWeek: 2 },
        { network: 'instagram', format: 'carousel', perWeek: 1 },
        { network: 'instagram', format: 'story', perWeek: 1 },
        { network: 'facebook', format: 'page_post', perWeek: 1 },
      ],
      weeks: [
        { title: 'Anuncio del menú', focus: 'Se presenta el menú de otoño con sus platos principales y precios.' },
        { title: 'Platos de temporada', focus: 'Un plato por día con su historia y su productor, uno a uno.' },
        { title: 'Cierre y reservas', focus: 'Últimos días, mesas libres y llamada a reservar para las comidas de empresa.' },
      ],
      why: 'Te propongo 3 semanas porque el menú necesita una semana para anunciarse, otra para enseñar los platos y una última para cerrar las reservas antes de las fiestas.',
    },
  },
}));

window.history.pushState({}, '', `${BRAND_BASE}/campanas`);
createRoot(document.getElementById('root')!).render(<App />);
