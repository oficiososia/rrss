import Konva from 'konva';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import { emptyProfile } from '@/features/brand/profile';
import { loadAppFont, withAppFont } from '@/features/content/editor/canvas/appFont';
import { construirMenu } from '@/features/menus/disenos';
import { datosIniciales, type FormatoMenu, type TipoMenu } from '@/features/menus/modelos';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, seedWorkspace } from '@/test/fixtures';

// Banco de maquetación de «Menús»: la aplicación real con el Supabase simulado, una paleta de marca
// (pizarra y oro) y una biblioteca de fotos. Las fotos las pone la prueba en `window.__FOTOS__`
// (direcciones data: de fotos reales, fuera del repositorio); sin ellas, fotos sintéticas.
const params = new URLSearchParams(window.location.search);
const given = (window as unknown as { __FOTOS__?: string[] }).__FOTOS__ ?? [];
const COUNT = Math.max(given.length, 8);

function synthetic(n: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 800, 600);
  g.addColorStop(0, `hsl(${(n * 47) % 360} 55% 55%)`);
  g.addColorStop(1, `hsl(${(n * 47 + 50) % 360} 60% 30%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 800, 600);
  return canvas.toDataURL('image/jpeg', 0.8);
}
const photos = Array.from({ length: COUNT }, (_, i) => given[i] ?? synthetic(i));
const idOf = (i: number) => `00000000-0000-4000-8000-0000000000${String(i + 10)}`;

seedWorkspace({ orgRole: 'member', brandRole: 'editor', workMode: 'self' });
fake.tables.media_assets = photos.map((_, i) => ({
  id: idOf(i),
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/foto-${i}.jpg`,
  file_name: `Foto ${i + 1}.jpg`,
  mime_type: 'image/jpeg',
  bytes: 1000,
  width: 800,
  height: 600,
  duration_ms: null,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: {},
  created_by: null,
  created_at: `2026-11-18T09:${String(59 - i).padStart(2, '0')}:00Z`,
  updated_at: '2026-11-18T09:00:00Z',
}));
fake.tables.jobs = [];
const profile = emptyProfile();
profile.visual.colors = [
  { name: 'Pizarra', hex: '#394147', role: 'principal' },
  { name: 'Oro', hex: '#b6852f', role: 'acento' },
  { name: 'Marfil', hex: '#f3ede2', role: 'fondo' },
  { name: 'Oro claro', hex: '#d4ae63', role: 'acento sobre oscuro' },
];
fake.tables.brand_profiles = [
  {
    id: 'profile-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    status: 'active',
    data: profile,
    provenance: {},
    change_note: '',
    created_by: null,
    created_at: '2026-11-01T09:00:00Z',
  },
];
fake.tables.content_items = [];
fake.tables.content_versions = [];
fake.tables.social_accounts = [];
fake.tables.scheduled_publications = [];
fake.tables.campaigns = [];
fake.tables.campaign_contents = [];
fake.tables.brand_design_templates = [];

const urlByPath = (path: string) => photos[Number(/foto-(\d+)\.jpg/.exec(path)?.[1] ?? 0)] ?? photos[0]!;
fake.storage.from = () =>
  ({
    download: async () => ({ data: null, error: { message: 'Object not found' } }),
    upload: async () => ({ data: null, error: null }),
    remove: async () => ({ data: null, error: null }),
    createSignedUrl: async (path: string) => ({ data: { signedUrl: urlByPath(path) }, error: null }),
    createSignedUrls: (async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: urlByPath(path), error: null })),
      error: null,
    })) as never,
  }) as never;

// «Publicar o programar»: la pieza se crea y se guarda su primera versión.
fake.rpc('save_content_version', (args) => {
  const row = {
    id: `v-${args.p_content_id}`,
    content_id: args.p_content_id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    data: args.p_data,
    schema_version: args.p_schema_version,
    change_note: args.p_change_note,
    created_by: null,
    created_at: new Date().toISOString(),
  };
  fake.tables.content_versions = [...(fake.tables.content_versions ?? []), row];
  fake.tables.content_items = (fake.tables.content_items ?? []).map((item) =>
    item.id === args.p_content_id ? { ...item, current_version: 1 } : item,
  );
  return row;
});

// Medición con el motor real: cada texto del diseño, dibujado con Konva en el navegador, no debe salirse
// de su caja (si lo hiciera, pisaría al siguiente). Devuelve las cajas que se quedan cortas.
(window as unknown as { auditarMenu: unknown }).auditarMenu = async (tipo: TipoMenu, formato: FormatoMenu, largo: boolean) => {
  await loadAppFont();
  await document.fonts.ready;
  const datos = datosIniciales(tipo);
  const platos = Array.from({ length: 9 }, (_, i) => `Plato ${i + 1} con salsa de Santa Pola y guarnición de temporada`).join('\n');
  if (largo && tipo === 'tapas') datos.tapas = Array.from({ length: 12 }, (_, i) => ({ nombre: `Tapa ${i + 1} de jamón ibérico 5J`, precio: '3,50 €', foto: null }));
  else if (largo && tipo === 'tapa-semana') datos.descripcion = 'Una descripción muy larga de la tapa, con su guarnición. '.repeat(8);
  else if (largo) datos.secciones = ['Primeros', 'Segundos', 'Postres', 'Bodega'].map((titulo) => ({ titulo, texto: platos }));
  const r = construirMenu(tipo, datos, formato, { dark: '#394147', light: '#F3EDE2', accent: '#B6852F', accentOnDark: '#D4AE63', onDark: '#F3EDE2', onLight: '#394147', onAccent: '#FFFFFF', placeholder: '#666666', headline: 'Libre Baskerville', body: 'Libre Baskerville' });
  const cortas: string[] = [];
  let textos = 0;
  for (const page of r.document.pages ?? []) {
    for (const layer of page.layers as Array<Record<string, unknown>>) {
      if (layer.type !== 'text') continue;
      textos++;
      const node = new Konva.Text({
        text: layer.text as string,
        width: layer.width as number,
        fontFamily: withAppFont(layer.fontFamily as string),
        fontSize: layer.fontSize as number,
        fontStyle: String(layer.fontWeight),
        lineHeight: layer.lineHeight as number,
        wrap: 'word',
      });
      if (node.height() > (layer.height as number) + 1) cortas.push(`${String(layer.id)}: ${node.height()} > ${String(layer.height)}`);
    }
  }
  return { cortas, textos, paginas: r.paginas, desborda: r.desborda };
};

(window as unknown as { photoIds: string[] }).photoIds = photos.map((_, i) => idOf(i));
window.history.pushState({}, '', `${BRAND_BASE}/menus${params.get('q') ?? ''}`);
createRoot(document.getElementById('root')!).render(<App />);
