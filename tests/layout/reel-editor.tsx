import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación del EDITOR DE REELS: la aplicación real con el Supabase
// simulado y una pieza de formato reel ya montada. Los archivos son de verdad
// (un clip diminuto en tests/layout/media —13 KB, el único binario: un MP4 no se
// puede fabricar en el navegador—, y fotos y música hechas aquí al vuelo), así
// que en el navegador se ven las miniaturas, se reproduce la vista previa y se
// dibuja la onda de la música.
// Parámetros: ?clips=12 (elementos del reel) · ?musica=1 · ?vacio=1 (reel nuevo) · ?modo=propio (autogestión)
//   · ?borrada=1 (la foto del primer elemento se ha borrado de la biblioteca)
const params = new URLSearchParams(window.location.search);
const count = Math.max(1, Math.min(30, Number(params.get('clips') ?? '12')));
const withMusic = params.get('musica') === '1';
const empty = params.get('vacio') === '1';
const deleted = params.get('borrada') === '1';

const path = (name: string) => `${ORG_ID}/${BRAND_ID}/media/${name}`;
const COLORS = ['#8B3A1E', '#1F4E5F', '#6B4E9B', '#2E6B3A', '#A0522D', '#3B3B6D'];

/** Una «foto» dibujada: un degradado con su número, como imagen SVG incrustada. */
function photoUrl(index: number): string {
  const color = COLORS[index % COLORS.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#F2D16B"/></linearGradient></defs>
    <rect width="900" height="1200" fill="url(#g)"/>
    <circle cx="450" cy="600" r="260" fill="#ffffff" fill-opacity="0.18"/>
    <text x="450" y="680" font-family="Arial" font-size="260" font-weight="700" text-anchor="middle" fill="#ffffff">${index + 1}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Una «canción»: 6 s de un tono con un golpe cada medio segundo, en WAV (8 kHz, mono, 16 bits). */
function musicUrl(): string {
  const rate = 8000;
  const samples = rate * 6;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const beat = t % 0.5 < 0.08 ? 1 : 0.2;
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 220 * t) * beat * 0.6 * 32767, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
const MUSIC_URL = musicUrl();

const asset = (id: string, kind: string, fileName: string, mime: string, durationMs: number | null = null) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind,
  origin: 'upload',
  storage_path: path(fileName),
  thumb_path: null,
  file_name: fileName,
  mime_type: mime,
  bytes: 1000,
  width: 1080,
  height: 1920,
  duration_ms: durationMs,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: null,
  created_by: null,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
});

const STYLE = {
  sizeRatio: 0.07,
  color: '#FFFFFF',
  marginRatio: 0.2,
  maxWidthRatio: 0.84,
  lineHeight: 1.3,
  box: null,
  outline: { color: '#000000', widthRatio: 0.06 },
  fadeSeconds: 0.25,
};

// Cada tercer elemento es un clip (todos del mismo archivo, de 4 s); el resto, fotos.
const clips = Array.from({ length: count }, (_, i) =>
  i % 3 === 1
    ? {
        id: `c${i + 1}`,
        type: 'video',
        path: path(`clip-${i + 1}.mp4`),
        in: 0.5,
        out: 3.5,
        volume: 0.8,
        transition: { type: 'cut', seconds: 0 },
        ...(i === 1 ? { subtitles: [{ start: 1, end: 2.5, text: 'Recién salido de la brasa' }] } : {}),
      }
    : {
        id: `c${i + 1}`,
        type: 'photo',
        path: path(`foto-${i + 1}.jpg`),
        seconds: 2,
        transition: i === 0 ? { type: 'cut', seconds: 0 } : { type: 'fade', seconds: 0.4 },
      },
);
const project = {
  kind: 'reel',
  template: { id: 'fundido-suave' },
  plan: {
    version: 2,
    clips,
    texts: [
      { id: 't1', text: 'Menú de otoño', start: 0, end: 3, position: 'center', style: STYLE },
      { id: 't2', text: 'Reserva tu mesa', start: 2, end: 5, position: 'bottom', style: { ...STYLE, sizeRatio: 0.05 } },
    ],
    subtitles: { enabled: true, position: 'bottom', style: { ...STYLE, sizeRatio: 0.045, marginRatio: 0.12 } },
    ...(withMusic
      ? {
          music: {
            path: path('musica.wav'),
            startAt: 0,
            volume: 0.4,
            fadeInSeconds: 0.5,
            fadeOutSeconds: 1,
            license: { confirmed: true },
          },
        }
      : {}),
  },
};

// ?modo=propio: organización en autogestión (sin aprobación a la vista); si no, modo agencia.
seedWorkspace({ orgRole: 'member', brandRole: 'editor', workMode: params.get('modo') === 'propio' ? 'self' : 'agency' });
fake.rpc('brand_reel_font_info', () => []);
fake.rpc('save_reel_draft', () => '2026-11-22T12:00:00Z');
fake.rpc('discard_reel_draft', () => null);
// «Exportar»: el montaje se encarga y queda en cola (aquí no hay trabajador que lo monte).
fake.rpc('request_media_job', (args) => {
  const job = {
    id: `job-${(fake.tables.jobs ?? []).length + 1}`,
    organization_id: ORG_ID,
    brand_id: BRAND_ID,
    kind: 'media.reel.template',
    payload: args.p_input,
    status: 'queued',
    attempts: 0,
    max_attempts: 3,
    last_error: null,
    result: null,
    created_at: '2026-11-22T12:00:00Z',
  };
  fake.tables.jobs = [...(fake.tables.jobs ?? []), job];
  return job;
});
fake.tables.media_assets = [
  ...clips.map((clip, i) =>
    clip.type === 'video'
      ? asset(`clip-${i + 1}`, 'video', `clip-${i + 1}.mp4`, 'video/mp4', 4000)
      : asset(`foto-${i + 1}`, 'image', `foto-${i + 1}.jpg`, 'image/jpeg'),
  ),
  asset('audio-1', 'audio', 'musica.wav', 'audio/wav'),
].filter((row) => !(deleted && row.id === 'foto-1'));
fake.tables.jobs = [];
fake.tables.reel_drafts = [];
fake.tables.brand_fonts = [];
fake.tables.brand_reel_templates = [];
fake.tables.content_items = [
  {
    id: 'reel-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Reel del menú de otoño, con la brasa y la sala',
    network: 'instagram',
    format: 'reel',
    status: 'draft',
    current_version: empty ? 0 : 1,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  },
];
fake.tables.content_versions = empty
  ? []
  : [
      {
        id: 'v-1',
        content_id: 'reel-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        version: 1,
        schema_version: 2,
        data: project,
        change_note: '',
        restored_from: null,
        created_by: ME.id,
        created_at: '2026-11-11T09:00:00Z',
      },
    ];

// Las «direcciones firmadas» apuntan a los archivos de verdad del banco.
const urlOf = (storagePath: string): string => {
  const name = storagePath.split('/').pop() ?? '';
  if (name.endsWith('.mp4')) return '/tests/layout/media/clip.mp4';
  if (name.endsWith('.wav')) return MUSIC_URL;
  const index = Number(/foto-(\d+)/.exec(name)?.[1] ?? '1') - 1;
  return photoUrl(index);
};
const storage = fake.storage.from();
fake.storage.from = (() => ({
  ...storage,
  createSignedUrl: async (storagePath: string) => ({ data: { signedUrl: urlOf(storagePath) }, error: null }),
  createSignedUrls: async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: urlOf(p), error: null })),
    error: null,
  }),
})) as unknown as typeof fake.storage.from;

window.history.pushState({}, '', `${BRAND_BASE}/contenidos/reel-1`);
createRoot(document.getElementById('root')!).render(<App />);
