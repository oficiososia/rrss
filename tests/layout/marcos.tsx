import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { createEmptyDocument, DOCUMENT_SCHEMA_VERSION, type Layer } from '@/features/content/document';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco del editor de piezas con una pieza «como recién salida de una plantilla»:
// un marco de foto vacío a sangre, un velo y un titular encima (el caso difícil:
// el hueco queda debajo de todo), y otro marco pequeño. La biblioteca tiene dos
// fotos de verdad (dibujadas aquí), para poder poner una y verla dentro del marco.
// Lo usa editor-marcos.spec.ts. Parámetros: ?caso=titular|dos

const params = new URLSearchParams(window.location.search);
const caso = params.get('caso') ?? 'titular';

/** Una «foto» sintética con detalle en las esquinas, para ver el encuadre. */
function makePhoto(width: number, height: number, tint: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, tint);
  g.addColorStop(1, '#2b7bd9');
  c.fillStyle = g;
  c.fillRect(0, 0, width, height);
  c.fillStyle = '#111827';
  c.fillRect(0, 0, width * 0.25, height * 0.2);
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(width * 0.72, height * 0.65, height * 0.22, 0, Math.PI * 2);
  c.fill();
  return canvas.toDataURL('image/jpeg', 0.9);
}

const PHOTOS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Chuleton ternera.jpg',
    width: 1200,
    height: 800,
    tint: '#d9482b',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Arroz del senyoret.jpg',
    width: 800,
    height: 1200,
    tint: '#16a34a',
  },
];
const urls = new Map(PHOTOS.map((p) => [`${ORG_ID}/${BRAND_ID}/${p.id}.jpg`, makePhoto(p.width, p.height, p.tint)]));

// El almacenamiento simulado devuelve las fotos dibujadas aquí.
const storage = fake.storage.from();
fake.storage.from = () => ({
  ...storage,
  createSignedUrls: (async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: urls.get(path) ?? '' })).filter((row) => row.signedUrl),
    error: null,
  })) as unknown as typeof storage.createSignedUrls,
});

const base = { rotation: 0, opacity: 1, visible: true, locked: false } as const;
const W = 1080;
const H = 1350;

const frame = (id: string, name: string, x: number, y: number, width: number, height: number): Layer => ({
  ...base,
  id,
  type: 'image',
  name,
  x,
  y,
  width,
  height,
  anchor: { x: 'stretch', y: 'stretch' },
  source: { kind: 'empty' },
  frame: true,
  fit: 'cover',
  focus: { x: 0.5, y: 0.5 },
});

const text = (id: string, value: string, y: number, size: number): Layer => ({
  ...base,
  id,
  type: 'text',
  name: '',
  x: 72,
  y,
  width: W - 144,
  height: Math.round(size * 2.6),
  anchor: { x: 'center', y: 'center' },
  text: value,
  fontFamily: 'Georgia',
  fontSize: size,
  fontWeight: 700,
  italic: false,
  color: caso === 'titular' ? '#FFFFFF' : '#1F2937',
  align: 'center',
  lineHeight: 1.1,
});

const layers: Layer[] =
  caso === 'dos'
    ? [
        frame('foto-antes', 'Foto de antes', 0, 0, W, 663),
        frame('foto-despues', 'Foto de después', 0, 687, W, 663),
        text('titulo', 'Antes y después', 600, 64),
      ]
    : [
        frame('foto', 'Foto', 0, 0, W, H),
        {
          ...base,
          id: 'velo',
          type: 'shape',
          name: 'Velo',
          x: 0,
          y: 0,
          width: W,
          height: H,
          opacity: 0.5,
          anchor: { x: 'stretch', y: 'stretch' },
          shape: 'rectangle',
          fill: '#111827',
          stroke: null,
          cornerRadius: 0,
        },
        text('titular', 'Chuletón de vaca madurada', 520, 96),
      ];

seedWorkspace({ orgRole: 'owner' });
const doc = createEmptyDocument({ aspectRatio: '4:5' });
const document_ = {
  ...doc,
  pages: [{ ...doc.pages[0]!, layers }],
  copy: { ...doc.copy, captionHint: 'Qué es, cuánto cuesta y hasta cuándo. Una sola llamada al final.' },
};

fake.tables.media_assets = PHOTOS.map((p) => ({
  id: p.id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/${p.id}.jpg`,
  thumb_path: null,
  file_name: p.name,
  mime_type: 'image/jpeg',
  bytes: 1000,
  width: p.width,
  height: p.height,
  duration_ms: null,
  sha256: null,
  folder: 'Platos',
  tags: [],
  rights: {},
  provenance: {},
  created_by: ME.id,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
}));
fake.tables.content_items = [
  {
    id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Chuletón de la casa',
    network: 'instagram',
    format: 'post',
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
    data: document_,
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  },
];
// Para que las pruebas lean el documento que el editor guarda como borrador.
(window as unknown as { drafts: () => unknown[] }).drafts = () => fake.rows('content_drafts');

window.history.pushState({}, '', `${BRAND_BASE}/contenidos/content-1`);
createRoot(document.getElementById('root')!).render(<App />);
