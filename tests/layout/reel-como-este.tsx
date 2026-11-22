import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace } from '@/test/fixtures';
import { buildReelLikeResult, parseMeasurement } from '../../supabase/functions/_shared/reels/like';

// Banco de maquetación de «Hacer un reel como este»: la aplicación real con el
// Supabase simulado. Parámetro `?vista=`:
//   inicio     subir o pegar el enlace, con el coste máximo
//   progreso   el vídeo midiéndose (pasos)
//   resultado  las cuatro salidas
//   editor     el borrador abierto en el editor de reels, con su guion
const view = new URLSearchParams(window.location.search).get('vista') ?? 'inicio';
const REF = '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a41';
const DIR = `${ORG_ID}/${BRAND_ID}/referencias/${REF}`;

const measurement = {
  reference: { id: REF },
  source: { kind: 'link', host: 'www.instagram.com', durationSeconds: 21.4, width: 1080, height: 1920, fps: 30, hasAudio: true },
  shots: [2.1, 1.6, 3.2, 2.4, 4.8, 2.2, 5.1].map((seconds, index, all) => {
    const start = all.slice(0, index).reduce((sum, s) => sum + s, 0);
    return {
      index,
      start,
      end: start + seconds,
      seconds,
      motion: index % 2 ? 0 : 0.9,
      still: index % 2 === 1,
      ...(index > 0 ? { transitionIn: index === 6 ? { type: 'fade', seconds: 0.5 } : { type: 'cut', seconds: 0 } } : {}),
    };
  }),
  frames: [0, 1, 2, 3, 4, 5, 6].map((shot) => ({ path: `${DIR}/f-0${shot + 1}.jpg`, at: shot, shot })),
  audio: { present: true, silent: false, bpm: 118, confidence: 0.7, cutsOnBeat: 0.83, beatsPerCut: 4, speech: [] },
  warnings: [],
};

const kinds = ['detalle', 'general', 'persona', 'detalle', 'persona', 'texto', 'general'];
const whats = [
  'El chuletón entrando en la brasa, muy de cerca',
  'El comedor lleno un sábado al mediodía, desde la entrada',
  'El parrillero dando la vuelta a la pieza con las pinzas',
  'El corte al trinchar, con el punto rosado a la vista',
  'Una mesa brindando mientras llega la bandeja al centro',
  'Rótulo a pantalla completa con el nombre del plato y su precio de carta',
  'La fachada del restaurante al atardecer, con el letrero encendido',
];
const result = buildReelLikeResult(
  parseMeasurement(measurement)!,
  {
    name: 'Gancho de producto + ambiente + proceso + cierre con llamada',
    summary:
      'Abre con el producto en acción para parar el dedo, alterna ambiente y manos trabajando para sostener la atención y cierra con una invitación clara.',
    pace: 'medio',
    audioKind: 'musica',
    title: 'El chuletón de los sábados, de la brasa a la mesa',
    idea: 'Enseñar el recorrido del plato estrella un sábado cualquiera: brasa, sala y mesa, para que apetezca reservar.',
    shots: whats.map((what, index) => ({
      index: index + 1,
      kind: kinds[index]!,
      media: index % 2 ? 'foto' : 'video',
      description: `Plano de ${kinds[index]} con movimiento suave de cámara`,
      what,
      tip: 'Graba en vertical, con luz natural y el móvil apoyado para que no tiemble; mejor tres segundos de más que de menos.',
      search: ['brasa', 'chuleton', 'sala'].slice(0, (index % 3) + 1),
    })),
    texts: [
      { role: 'gancho', position: 'top', size: 'grande', fromShot: 1, toShot: 1, value: 'Así empieza el sábado en casa' },
      { role: 'paso', position: 'bottom', size: 'normal', fromShot: 3, toShot: 4, value: 'Brasa de encina y cuarenta días de maduración' },
      { role: 'llamada', position: 'center', size: 'normal', fromShot: 7, toShot: 7, value: 'Reserva tu mesa para el sábado' },
    ],
    hook: 'Así empieza el sábado en casa: con la brasa encendida desde las once.',
    caption:
      'Los sábados la brasa manda. Vaca madurada cuarenta días, encina y el punto que tú pidas.\n\nReserva tu mesa y ven con hambre.',
    hashtags: ['chuleton', 'brasa', 'carnemadurada', 'restaurante', 'sabado'],
    coverShot: 4,
    coverNote: 'El corte con el punto rosado, sin texto encima',
  },
  { transcriptUsed: false, notes: ['No se ha transcrito la voz: la transcripción no está configurada.'] },
);

const asset = (id: string, kind: string, fileName: string, extra: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind,
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${fileName}`,
  file_name: fileName,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  bytes: 1000,
  width: 1080,
  height: 1920,
  duration_ms: kind === 'video' ? 9000 : null,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: null,
  created_by: null,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
  ...extra,
});

seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
fake.fn('ai-reel-like', () => ({
  status: 200,
  body: {
    available: true,
    speechAvailable: true,
    estimate: { textMicros: 61_500, speechMicros: 9_900, speechMicrosPerSecond: 82.5, maxMicros: 71_400 },
    limits: { maxSeconds: 180, maxUploadBytes: 50 * 1024 * 1024, maxSpeechSeconds: 120, maxFrames: 12 },
  },
}));
fake.rpc('brand_reel_font_info', () => []);
fake.tables.media_assets = [
  asset('clip-1', 'video', 'IMG_20261114_brasa_chuleton_definitivo_v2.mp4', { tags: ['brasa', 'chuletón'] }),
  asset('foto-1', 'image', 'sala-sabado.jpg', { folder: 'Sala' }),
  asset('clip-2', 'video', 'parrillero.mp4', { tags: ['brasa'] }),
];
fake.tables.jobs = [];
fake.tables.brand_fonts = [];
fake.tables.brand_reel_templates = [];
fake.tables.content_versions = [];
fake.tables.content_items = [
  {
    id: 'reel-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'El chuletón de los sábados, de la brasa a la mesa',
    network: 'instagram',
    format: 'reel',
    status: 'idea',
    current_version: 0,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-22T10:00:00Z',
    updated_at: '2026-11-22T10:00:00Z',
  },
];
const base = {
  id: REF,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  job_id: 'job-1',
  source_kind: 'link',
  source_host: 'www.instagram.com',
  source_path: null,
  keep_source: false,
  speech: true,
  idea: '',
  error: null,
  cost_micros: 0,
  generation_ids: [],
  content_id: null,
  files_released_at: null,
  ai_started_at: null,
  created_by: ME.id,
  created_at: '2026-11-22T10:00:00Z',
  updated_at: '2026-11-22T10:00:00Z',
};
fake.tables.reel_references =
  view === 'progreso'
    ? [{ ...base, status: 'analyzing', measurement: null, result: null }]
    : [{ ...base, status: 'ready', measurement, result, cost_micros: 38_200, files_released_at: '2026-11-22T10:03:00Z' }];

const path =
  view === 'inicio'
    ? `${BRAND_BASE}/biblioteca/reels/como-este`
    : view === 'editor'
      ? `${BRAND_BASE}/contenidos/reel-1?referencia=${REF}`
      : `${BRAND_BASE}/biblioteca/reels/como-este/${REF}`;
window.history.pushState({}, '', path);
createRoot(document.getElementById('root')!).render(<App />);
