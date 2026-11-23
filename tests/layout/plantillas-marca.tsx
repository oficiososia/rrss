import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { createEmptyDocument } from '@/features/content/document';
import type { BrandDesignTemplateRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación de Marca → Identidad visual → «Plantillas de la marca»: la aplicación real
// con el Supabase simulado y unas plantillas de historia y de publicación, como tras cargar las del
// catálogo. Lo usa plantillas-marca.spec.ts (el nombre no puede salir partido letra a letra en el móvil).

seedWorkspace({ orgRole: 'owner', workMode: 'self' });
fake.tables.brand_fonts = [];

function row(id: string, name: string, format: 'post' | 'story'): BrandDesignTemplateRow {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    template_key: id,
    name,
    network: 'instagram',
    format,
    document: createEmptyDocument({
      aspectRatio: format === 'story' ? '9:16' : '4:5',
    }) as unknown as BrandDesignTemplateRow['document'],
    analysis: {},
    source: 'manual',
    created_by: null,
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:00:00Z',
  };
}

fake.tables.brand_design_templates = [
  row('t-1', 'Dos tapas', 'post'),
  row('t-2', 'Tapa del día', 'story'),
  row('t-3', 'Menú del día con primeros, segundos y postre', 'story'),
  row('t-4', 'Oferta de la semana', 'post'),
];

window.history.pushState({}, '', `${BRAND_BASE}/marca?seccion=visual`);
createRoot(document.getElementById('root')!).render(<App />);
