import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { buildCatalogWith } from '../../agency/catalogo/construir.ts';
import { NEUTRAL_THEME } from '../../agency/catalogo/index.ts';
import {
  createEmptyDocument,
  DOCUMENT_SCHEMA_VERSION,
  validateDocumentFromAnyVersion,
  type ContentDocument,
  type Layer,
} from '@/features/content/document';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco del editor de piezas con una pieza «como recién salida de una plantilla»:
// un marco de foto vacío a sangre, un velo y un titular encima (el caso difícil:
// el hueco queda debajo de todo), y otro marco pequeño. La biblioteca tiene dos
// fotos de verdad (dibujadas aquí), para poder poner una y verla dentro del marco.
// Lo usan editor-marcos.spec.ts y editor-acciones.spec.ts. Parámetros:
//   ?caso=titular|dos|oferta|grande|tapa  (oferta: «Oferta de la semana» con la foto puesta; grande: una
//                                     foto que sobresale del lienzo; tapa: la historia «Tapa del día» del
//                                     catálogo, con el logotipo OSCURO de la marca sobre su cabecera oscura)
//   ?logos=dos|uno            (tapa: la marca tiene la variante oscura y la clara, o solo la oscura)
//   ?modo=self|agency         (cómo trabaja la organización; por defecto, agencia)

const params = new URLSearchParams(window.location.search);
const caso = params.get('caso') ?? 'titular';
const modo = params.get('modo') === 'self' ? 'self' : 'agency';

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
const PHOTO_IDS = PHOTOS.map((p) => p.id);
const urls = new Map(PHOTOS.map((p) => [`${ORG_ID}/${BRAND_ID}/${p.id}.jpg`, makePhoto(p.width, p.height, p.tint)]));

/** Un logotipo sintético: letras de un color sobre fondo transparente. */
function makeLogo(color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 200;
  const c = canvas.getContext('2d')!;
  c.fillStyle = color;
  c.font = 'bold 120px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('CASA', 300, 100);
  return canvas.toDataURL('image/png');
}

// Logotipos de la marca: el primero, el que ponen las plantillas, es el OSCURO.
const LOGOS = [
  { id: '33333333-3333-4333-8333-333333333333', name: 'Logotipo oscuro.png', color: '#141414' },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Logotipo claro.png', color: '#FAFAFA' },
].slice(0, params.get('logos') === 'uno' ? 1 : 2);
for (const logo of LOGOS) urls.set(`${ORG_ID}/${BRAND_ID}/${logo.id}.png`, makeLogo(logo.color));

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

const shape = (
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  ellipse = false,
): Layer => ({
  ...base,
  id,
  type: 'shape',
  name,
  x,
  y,
  width,
  height,
  anchor: { x: 'center', y: 'center' },
  shape: ellipse ? 'ellipse' : 'rectangle',
  fill,
  stroke: null,
  cornerRadius: 0,
});

const label = (
  id: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  size: number,
  color: string,
): Layer => ({
  ...(text(id, value, y, size) as Extract<Layer, { type: 'text' }>),
  x,
  width,
  height,
  color,
  align: 'left',
});

/** Como `oferta()` del catálogo (agency/catalogo/publicaciones.ts): foto arriba, panel abajo y un sello con el precio. */
const oferta: Layer[] = [
  {
    ...(frame('foto', 'Foto', 0, 0, W, 830) as Extract<Layer, { type: 'image' }>),
    source: { kind: 'asset', assetId: PHOTOS[0]!.id },
  },
  shape('panel', 'Panel', 0, 830, W, 520, '#1F2937'),
  shape('sello', 'Sello', 760, 690, 260, 260, '#F59E0B', true),
  { ...label('sello-texto', '00 €', 770, 772, 240, 100, 72, '#111827'), align: 'center' } as Layer,
  label('antetitulo', 'ESTA SEMANA', 72, 890, 660, 40, 28, '#F59E0B'),
  label('titular', 'Nombre del menú o del plato', 72, 990, W - 144, 170, 72, '#FFFFFF'),
  label(
    'condiciones',
    'De lunes a viernes, a mediodía. Bebida y postre incluidos.',
    72,
    1200,
    W - 144,
    90,
    30,
    '#FFFFFF',
  ),
];

/** Una foto agrandada más allá del lienzo (sobresale por la izquierda y por la derecha) y un titular. */
const grande: Layer[] = [
  {
    ...base,
    id: 'foto',
    type: 'image',
    name: 'Foto',
    x: -400,
    y: 300,
    width: W + 800,
    height: 700,
    anchor: { x: 'center', y: 'center' },
    source: { kind: 'asset', assetId: PHOTO_IDS[0]! },
    fit: 'cover',
    focus: { x: 0.5, y: 0.5 },
  },
  label('titular', 'Chuletón de vaca madurada', 72, 1100, W - 144, 170, 72, '#111827'),
];

/** La historia «Tapa del día» del catálogo, armada con el logotipo oscuro de la marca. */
function tapaDelDia(): ContentDocument {
  const built = buildCatalogWith('restaurante', { ...NEUTRAL_THEME, logo: LOGOS[0]!.id }, [
    'corte-ritmico',
    'fundido-suave',
    'pase-lateral',
  ]);
  const template = built.stories?.templates.find((t) => t.key === 'rest-historia-tapa-del-dia');
  const parsed = validateDocumentFromAnyVersion(template?.document);
  if (!parsed.ok) throw new Error('La historia «Tapa del día» no es válida');
  return parsed.document;
}

const layers: Layer[] =
  caso === 'grande'
    ? grande
    : caso === 'oferta'
      ? oferta
      : caso === 'dos'
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

seedWorkspace({ orgRole: 'owner', workMode: modo });
const doc = createEmptyDocument({ aspectRatio: '4:5' });
const document_ =
  caso === 'tapa'
    ? tapaDelDia()
    : {
        ...doc,
        pages: [{ ...doc.pages[0]!, layers }],
        copy: { ...doc.copy, captionHint: 'Qué es, cuánto cuesta y hasta cuándo. Una sola llamada al final.' },
      };

// Solo «tapa» trae perfil de marca con logotipos: los demás casos se quedan como estaban.
fake.tables.brand_profiles =
  caso !== 'tapa'
    ? []
    : [
        {
          id: 'perfil-1',
          brand_id: BRAND_ID,
          organization_id: ORG_ID,
          version: 1,
          status: 'active',
          schema_version: 1,
          data: { visual: { colors: [], fonts: [], logoAssetIds: LOGOS.map((logo) => logo.id) } },
          provenance: {},
          change_note: '',
          created_by: ME.id,
          created_at: '2026-11-01T10:00:00Z',
        },
      ];

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
fake.tables.media_assets.push(
  ...(caso === 'tapa' ? LOGOS : []).map((logo) => ({
    id: logo.id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    kind: 'logo',
    origin: 'upload',
    storage_path: `${ORG_ID}/${BRAND_ID}/${logo.id}.png`,
    thumb_path: null,
    file_name: logo.name,
    mime_type: 'image/png',
    bytes: 1000,
    width: 600,
    height: 200,
    duration_ms: null,
    sha256: null,
    folder: 'Logotipos',
    tags: [],
    rights: {},
    provenance: {},
    created_by: ME.id,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
  })),
);
fake.tables.content_items = [
  {
    id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: caso === 'oferta' ? 'Oferta de la semana' : caso === 'tapa' ? 'Tapa del día' : 'Chuletón de la casa',
    network: 'instagram',
    format: caso === 'tapa' ? 'story' : 'post',
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
