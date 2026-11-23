import type { ContentItemRow, ContentStatus, ContentVersionRow, MediaAssetRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, seedWorkspace, type Workspace } from '@/test/fixtures';
import {
  createEmptyDocument,
  DOCUMENT_SCHEMA_VERSION,
  type ContentDocument,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type TextLayer,
} from './document';
import type { CanvasViewProps } from './editor/canvas/types';

// Apoyo de las pruebas del editor de piezas que no necesitan Konva: un doble
// del lienzo que enseña lo que el editor le pasa (capas, selección, barra
// flotante, texto en edición, foto en encuadre) y deja a la prueba llamar a lo
// que el lienzo de verdad avisaría (clic en un marco, soltar una foto, botón
// derecho…) con `canvas()`. Y una pieza de ejemplo con fotos en la biblioteca.
//
// Uso (el `vi.mock` tiene que ir en cada archivo de prueba):
//   vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
//     default: (await import('./editorTestCanvas')).CanvasStub,
//   }));

const probe: { props: CanvasViewProps | null } = { props: null };

/** Lo último que el editor le ha pasado al lienzo: para llamar a sus avisos desde la prueba (dentro de `act`). */
export function canvas(): CanvasViewProps {
  if (!probe.props) throw new Error('El lienzo de prueba todavía no se ha pintado');
  return probe.props;
}

/** Lo llama el doble del lienzo en cada pintado. */
export function rememberCanvasProps(props: CanvasViewProps): void {
  probe.props = props;
}

export const EDITOR = `${BRAND_BASE}/contenidos/content-1`;

/** Identificadores de recurso con forma de UUID (el documento no admite otra cosa). */
export const PHOTO_A = '11111111-1111-4111-8111-111111111111';
export const PHOTO_B = '22222222-2222-4222-8222-222222222222';

const base = {
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  anchor: { x: 'center', y: 'center' },
} as const;

export function frame(id: string, overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    ...base,
    id,
    type: 'image',
    name: 'Foto del plato',
    x: 0,
    y: 0,
    width: 1080,
    height: 700,
    source: { kind: 'empty' },
    frame: true,
    fit: 'cover',
    focus: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

export function photo(id: string, assetId = PHOTO_A, overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    ...base,
    id,
    type: 'image',
    name: 'foto.jpg',
    x: 100,
    y: 100,
    width: 600,
    height: 400,
    source: { kind: 'asset', assetId },
    fit: 'cover',
    focus: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

export function text(id: string, value: string, overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    ...base,
    id,
    type: 'text',
    name: '',
    x: 100,
    y: 760,
    width: 800,
    height: 200,
    text: value,
    fontFamily: 'sans-serif',
    fontSize: 60,
    fontWeight: 700,
    italic: false,
    color: '#111111',
    align: 'left',
    lineHeight: 1.2,
    ...overrides,
  };
}

export function shape(id: string, overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    ...base,
    id,
    type: 'shape',
    name: '',
    x: 400,
    y: 300,
    width: 200,
    height: 120,
    shape: 'rectangle',
    fill: '#E5E7EB',
    stroke: null,
    cornerRadius: 0,
    ...overrides,
  };
}

export function assetRow(id: string, overrides: Partial<MediaAssetRow> = {}): MediaAssetRow {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    kind: 'image',
    origin: 'upload',
    storage_path: `${ORG_ID}/${BRAND_ID}/${id}.jpg`,
    thumb_path: null,
    file_name: `${id.slice(0, 4)}.jpg`,
    mime_type: 'image/jpeg',
    bytes: 100,
    width: 1200,
    height: 800,
    duration_ms: null,
    sha256: null,
    folder: '',
    tags: [],
    rights: {},
    provenance: {},
    created_by: ME.id,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
    ...overrides,
  } as MediaAssetRow;
}

export interface SeedOptions {
  layers?: Layer[];
  /** Capas de una segunda página (la pieza pasa a ser un carrusel). */
  secondPage?: Layer[];
  status?: ContentStatus;
  format?: string;
  caption?: string;
  captionHint?: string;
  assets?: MediaAssetRow[];
  role?: Workspace;
}

/** Deja en el servidor simulado una pieza con una versión guardada (la 1) y fotos en la biblioteca. */
export function seedPiece(options: SeedOptions = {}): ContentDocument {
  seedWorkspace(options.role ?? { orgRole: 'owner' });
  const empty = createEmptyDocument({ aspectRatio: '4:5' });
  const document: ContentDocument = {
    ...empty,
    pages: [
      { id: 'p1', name: '', layers: options.layers ?? [frame('foto'), text('titulo', 'Nombre del plato')] },
      ...(options.secondPage ? [{ id: 'p2', name: '', layers: options.secondPage }] : []),
    ],
    copy: {
      ...empty.copy,
      caption: options.caption ?? '',
      ...(options.captionHint ? { captionHint: options.captionHint } : {}),
    },
  };
  const item: ContentItemRow = {
    id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Oferta de la semana',
    network: 'instagram',
    format: options.format ?? (options.secondPage ? 'carousel' : 'post'),
    status: options.status ?? 'draft',
    current_version: 1,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  };
  const version: ContentVersionRow = {
    id: 'v-1',
    content_id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    schema_version: DOCUMENT_SCHEMA_VERSION,
    data: document as unknown as ContentVersionRow['data'],
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  };
  fake.tables.content_items = [item];
  fake.tables.content_versions = [version];
  fake.tables.media_assets = options.assets ?? [
    assetRow(PHOTO_A, { file_name: 'chuleton.jpg' }),
    assetRow(PHOTO_B, { file_name: 'arroz.jpg', width: 800, height: 1200 }),
  ];
  // Guardar una versión: como la base de datos, sube el número y borra el borrador de quien guarda.
  fake.rpc('save_content_version', (args) => {
    const current = fake.rows('content_items')[0]!;
    const next = (current.current_version as number) + 1;
    const row = {
      ...version,
      id: `v-${next}`,
      version: next,
      data: args.p_data,
      change_note: args.p_change_note ?? '',
    };
    fake.rows('content_versions').push(row);
    current.current_version = next;
    if (current.status === 'approved' || current.status === 'idea') current.status = 'draft';
    fake.tables.content_drafts = fake.rows('content_drafts').filter((draft) => draft.content_id !== 'content-1');
    return row;
  });
  fake.rpc('set_content_status', (args) => {
    const current = fake.rows('content_items')[0]!;
    current.status = args.p_status;
    return current;
  });
  return document;
}

/** Las capas de la primera página del último borrador guardado solo (o null si no hay borrador). */
export function draftLayers(): Layer[] | null {
  const row = fake.rows('content_drafts').find((draft) => draft.content_id === 'content-1');
  return row ? (row.data as ContentDocument).pages[0]!.layers : null;
}
