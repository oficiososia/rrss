import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación de «Editar foto» (sus tres pestañas y «Fondo → Cambiar con IA»): la aplicación real con el Supabase
// simulado. La foto ya viene sin fondo (así no hace falta ningún modelo de recorte) y la IA
// responde al momento con el mismo dibujo. Parámetros: ?sector=Gimnasio y ?modo=self (autogestión).
(globalThis as { __AI_PHOTO_EDIT__?: boolean }).__AI_PHOTO_EDIT__ = true;
const params = new URLSearchParams(window.location.search);
seedWorkspace({
  orgRole: 'owner',
  // ?modo=self: organización en autogestión (sin textos de cupos).
  workMode: params.get('modo') === 'self' ? 'self' : 'agency',
  brands: [
    {
      id: BRAND_ID,
      organization_id: ORG_ID,
      name: 'Marca de prueba',
      sector: params.get('sector') ?? 'Restauración',
      website: '',
      timezone: 'Europe/Madrid',
      default_locale: 'es',
      status: 'active',
      ai_mode: 'api',
      created_by: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
    },
  ],
});

/** Una «foto» con un círculo opaco (lo principal) y el resto transparente. */
function makePhoto(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, '#d9482b');
  g.addColorStop(1, '#2b7bd9');
  c.fillStyle = g;
  c.beginPath();
  c.arc(width / 2, height / 2, height * 0.32, 0, Math.PI * 2);
  c.fill();
  return canvas.toDataURL('image/png');
}
const photo = makePhoto(600, 450);

const asset = (id: string, fileName: string, origin: string) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin,
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${fileName}`,
  file_name: fileName,
  mime_type: 'image/png',
  bytes: 1000,
  width: 600,
  height: 450,
  duration_ms: null,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: {},
  created_by: null,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
});
fake.tables.media_assets = [asset('foto-1', 'Sin fondo · foto.png', 'upload')];
fake.tables.jobs = [];
fake.tables.brand_profiles = [];

// Todas las direcciones firmadas son la misma imagen.
fake.storage.from = () =>
  ({
    download: async () => ({ data: null, error: { message: 'Object not found' } }),
    upload: async () => ({ data: null, error: null }),
    remove: async () => ({ data: null, error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: photo }, error: null }),
    createSignedUrls: (async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: photo, error: null })),
      error: null,
    })) as never,
  }) as never;

let attempt = 0;
fake.fn('ai-media', (body) => {
  const { action } = body as { action: string };
  if (action === 'photo.options') {
    return {
      status: 200,
      body: {
        action,
        edits: [
          // «Mejorar con IA» lo tiene el servidor, pero la pantalla no lo ofrece (la IA solo crea fondos).
          ...(['upscale', 'enhance'] as const).map((operation) => ({
            operation,
            model: `openai:${operation}`,
            delivery: 'sync',
            dataRegion: 'global',
            euProcessing: false,
            trainsOnInputs: 'no',
            untestedAdapter: false,
          })),
          {
            operation: 'replace_background',
            model: 'openai:gpt-image-2.5-sunburst',
            delivery: 'sync',
            dataRegion: 'global',
            euProcessing: false,
            trainsOnInputs: 'no',
            untestedAdapter: true,
            usesSubjectMask: true,
          },
        ],
      },
    };
  }
  if (action === 'photo.estimate') {
    return { status: 200, body: { action, costMicros: 200_000, model: 'openai:gpt-image-2.5-sunburst' } };
  }
  attempt += 1;
  fake.tables.media_assets = [
    ...fake.rows('media_assets').filter((r) => r.id !== 'fondo-ia'),
    asset('fondo-ia', 'Fondo nuevo · foto.png', 'generated'),
  ];
  return {
    status: 200,
    body: {
      action,
      status: 'completed',
      generationId: `gen-${attempt}`,
      costMicros: 200_000,
      asset: { id: 'fondo-ia', path: `${ORG_ID}/${BRAND_ID}/ia/gen-${attempt}-0.png` },
    },
  };
});

window.history.pushState({}, '', `${BRAND_BASE}/biblioteca`);
createRoot(document.getElementById('root')!).render(<App />);
