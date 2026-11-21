import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import {
  createEmptyDocument,
  DOCUMENT_SCHEMA_VERSION,
  type AspectRatio,
  type Layer,
} from '@/features/content/document';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación: la aplicación real con el Supabase simulado y UNA pieza
// ya creada. Parámetros: ?ratio=4:5&pages=1&network=instagram&format=post
const params = new URLSearchParams(window.location.search);
const ratio = (params.get('ratio') ?? '4:5') as AspectRatio;
const pages = Number(params.get('pages') ?? '1');

const base = {
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  anchor: { x: 'center', y: 'center' },
} as const;

function layersFor(width: number, height: number, n: number): Layer[] {
  return [
    {
      ...base,
      id: `fondo${n}`,
      type: 'shape',
      name: 'Fondo',
      x: 0,
      y: 0,
      width,
      height,
      shape: 'rectangle',
      fill: '#E9DCC3',
      stroke: null,
      cornerRadius: 0,
    },
    {
      ...base,
      id: `titulo${n}`,
      type: 'text',
      name: '',
      x: width * 0.08,
      y: height * 0.82,
      width: width * 0.84,
      height: height * 0.12,
      text: 'Chuletón de vaca madurada',
      fontFamily: 'Georgia',
      fontSize: 56,
      fontWeight: 700,
      italic: false,
      color: '#1F2937',
      align: 'center',
      lineHeight: 1.2,
    },
  ] as Layer[];
}

seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
const doc = createEmptyDocument({ aspectRatio: ratio, pages });
const full = {
  ...doc,
  pages: doc.pages.map((page, n) => ({ ...page, layers: layersFor(doc.canvas.width, doc.canvas.height, n) })),
};
fake.tables.content_items = [
  {
    id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Chuletón de la casa',
    network: params.get('network') ?? 'instagram',
    format: params.get('format') ?? 'post',
    status: 'draft',
    current_version: 1,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  },
];
fake.tables.content_versions = [
  {
    id: 'v-1',
    content_id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    schema_version: DOCUMENT_SCHEMA_VERSION,
    data: full,
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  },
];
window.history.pushState({}, '', `${BRAND_BASE}/contenidos/content-1${window.location.search}`);
createRoot(document.getElementById('root')!).render(<App />);
