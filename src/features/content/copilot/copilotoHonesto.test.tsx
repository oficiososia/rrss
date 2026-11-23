// Lo que dice el copiloto coincide con lo que hace (prueba real en staging del 23/11/2026,
// fallos 6, 7 y 16; docs/copiloto-voz.md §16):
//  - la nota de la IA que dice haber hecho algo no se enseña: lo hecho sale de lo aplicado;
//  - «que la foto llene todo» llena el lienzo de verdad;
//  - «Sin IA» solo sale cuando no se ha gastado nada; si se gasta, se dice cuánto;
//  - «hazme algo bonito» sin pedir un fondo usa una foto real a sangre, con el fondo con IA como opción.
// La IA, el generador, la biblioteca y el recorte están SIMULADOS.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiRequestError } from '@/features/ai/api';
import { createEmptyDocument, withPageLayers, type ContentDocument, type ImageLayer, type TextLayer } from '../document';
import { newImageLayer, newTextLayer } from '../editor/layers';
import type { CopilotAssetInfo, CopilotBrandStyle } from './apply';
import type { MeasuredTone } from './legibility';
import { BACKGROUND_PROMPT_SUFFIX, type CopilotPlanHost } from './plan';
import { VoiceCopilot, type CopilotHost } from './VoiceCopilot';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  /** Lo que «elige» la persona en el selector de fotos (simulado). */
  picks: [] as { id: string; file_name: string; width: number; height: number }[],
}));

/** La biblioteca y la cadena de recorte que usa el recorte de verdad del editor (planHost.ts), simuladas. */
const library = vi.hoisted(() => ({ fetchAsset: vi.fn(), fetchPhotoEdits: vi.fn(), signedUrlFor: vi.fn(), runQuickEdit: vi.fn() }));

vi.mock('@/features/photo-edit/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/photo-edit/api')>()),
  fetchAsset: library.fetchAsset,
  fetchPhotoEdits: library.fetchPhotoEdits,
  signedUrlFor: library.signedUrlFor,
}));
vi.mock('@/features/photo-edit/quickEdit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/photo-edit/quickEdit')>()),
  runQuickEdit: library.runQuickEdit,
}));
vi.mock('@/features/photo-edit/cutout/remover', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/photo-edit/cutout/remover')>()),
  canRemoveBackground: () => true,
}));
vi.mock('@/features/ai/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/ai/api')>()),
  requestEditorCopilot: mocks.request,
}));
vi.mock('./transcriber', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./transcriber')>()),
  useTranscriberConfigured: () => false,
}));
vi.mock('./recording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recording')>()),
  recordingAvailable: () => false,
}));
// El selector de fotos de la biblioteca, reducido a un botón que elige la siguiente de `mocks.picks`.
vi.mock('../editor/AssetPickerDialog', () => ({
  ImagePickerDialog: ({ open, onPick }: { open: boolean; onPick: (asset: unknown) => void }) =>
    open ? (
      <button type="button" data-testid="fake-picker" onClick={() => onPick(mocks.picks.shift())}>
        Elegir del selector
      </button>
    ) : null,
}));

const GENERATION = '55555555-5555-4555-8555-555555555555';
const BACKGROUND: CopilotAssetInfo = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'IA · fondo otoñal.png', width: 1024, height: 1280 };
const photo = (n: number, name: string): CopilotAssetInfo => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`, name, width: 1200, height: 900 });
const SOUP = photo(1, 'crema-calabaza.jpg');
const STEW = photo(2, 'guiso-setas.jpg');
const cutOf = (source: CopilotAssetInfo): CopilotAssetInfo => ({ ...source, id: source.id.replace(/^a{8}/, 'cccccccc'), name: `${source.name} (sin fondo).png` });
/** El tono de un fondo CLARO (un crema), como lo mide el editor: el medio y por zonas. */
const LIGHT: MeasuredTone = { mean: '#DDDDDD', grid: { columns: 1, rows: 1, cells: [0.72], aspect: 1 } };
/** Una foto como fila de la biblioteca. */
const libraryRow = (info: CopilotAssetInfo) => ({
  id: info.id,
  brand_id: 'marca',
  organization_id: 'org',
  kind: 'image',
  origin: 'uploaded',
  storage_path: `org/marca/media/${info.id}.jpg`,
  file_name: info.name,
  mime_type: 'image/jpeg',
  bytes: 100,
  width: info.width ?? null,
  height: info.height ?? null,
  duration_ms: null,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: {} as Record<string, unknown>,
});

const ORDER = 'haz el menú de otoño: crea un fondo que parezca otoñal y pon los platos en el centro';
const PROMPT = 'Mesa de madera con hojas secas y luz cálida de otoño';
const PLAN_OPERATIONS = [
  { op: 'generate_background', prompt: PROMPT },
  { op: 'find_photos', query: 'platos de otoño', count: 3 },
  { op: 'place_photos', layout: 'center', cutout: true, on: true },
  { op: 'add_text', text: 'menú de otoño', style: 'title', position: 'top' },
];
const answer = (operations: unknown[], extra: Record<string, unknown> = {}) => ({
  action: 'editor.copilot',
  generationId: GENERATION,
  operations,
  discarded: [],
  note: '',
  ...extra,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type PlanHostMock = {
  [K in keyof CopilotPlanHost]: NonNullable<CopilotPlanHost[K]> extends (...args: never[]) => unknown ? ReturnType<typeof vi.fn> : CopilotPlanHost[K];
};

/** Lo que el editor ofrece a un plan, simulado: IA de imagen a 0,14 créditos, dos platos en la biblioteca, recorte y un fondo que sale claro. */
function makePlanHost(overrides: Partial<PlanHostMock> = {}): PlanHostMock {
  return {
    imageAi: { available: true },
    canCutout: true,
    estimateBackground: vi.fn(async () => 140_000),
    generateBackground: vi.fn(async () => BACKGROUND),
    searchLibrary: vi.fn(async () => [SOUP, STEW]),
    cutout: vi.fn(async (source: CopilotAssetInfo) => ({ asset: cutOf(source), created: true })),
    measureTone: vi.fn(async () => LIGHT),
    ...overrides,
  };
}

function makeHost(plan?: PlanHostMock): CopilotHost {
  return {
    history: vi.fn(() => null),
    goToPage: vi.fn(),
    save: vi.fn(),
    openTemplates: vi.fn(),
    photoFlow: vi.fn(() => null),
    ...(plan ? { plan: plan as unknown as CopilotPlanHost } : {}),
  };
}

const BRAND: CopilotBrandStyle = {
  palette: [
    { hex: '#A3122A', role: 'principal' },
    { hex: '#F4E9D8', role: 'fondo' },
  ],
  fonts: ['Marca Titulares'],
};

function documentWith(): ContentDocument {
  const empty = createEmptyDocument({ aspectRatio: '4:5' });
  const footer: TextLayer = {
    ...newTextLayer(empty.canvas, [], { fontFamily: 'Marca Titulares', color: '#111111' }),
    id: 'pie',
    text: 'Reserva ya',
    fontSize: 40,
    height: 60,
    y: 1230,
  };
  return withPageLayers(empty, 0, [footer]);
}

interface HarnessProps {
  initial: ContentDocument;
  host?: CopilotHost;
  brand?: CopilotBrandStyle;
  selectedIds?: string[];
  onApply: (document: ContentDocument, touched: string[], pageIndex: number) => void;
}

function Harness({ initial, host, brand = BRAND, selectedIds = [], onApply }: HarnessProps) {
  const [document, setDocument] = useState(initial);
  const [selected, setSelected] = useState(selectedIds);
  return (
    <VoiceCopilot
      orgId="org"
      brandId="marca"
      brandName="Marca"
      document={document}
      pageIndex={0}
      selectedIds={selected}
      brand={brand}
      logoIds={[]}
      selectedImage={null}
      libraryPath="/biblioteca"
      host={host}
      onApply={(next, touched, index) => {
        onApply(next, touched, index);
        setDocument(next);
        setSelected(touched);
      }}
      onClose={() => undefined}
    />
  );
}

function renderCopilot(props: Partial<HarnessProps> & { plan?: PlanHostMock | null } = {}) {
  const onApply = vi.fn();
  const plan = props.plan === null ? undefined : (props.plan ?? makePlanHost());
  const initial = props.initial ?? documentWith();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness initial={initial} host={props.host ?? makeHost(plan)} brand={props.brand} selectedIds={props.selectedIds} onApply={onApply} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onApply, plan: plan as PlanHostMock, initial };
}

const input = () => screen.getByTestId<HTMLInputElement>('copilot-text-input');
async function order(text: string) {
  await userEvent.type(input(), `${text}{Enter}`);
}
/** La orden con ese texto, cuando llega a ese estado. */
async function orderOf(text: string, status: string) {
  const find = () => screen.getAllByTestId('copilot-order').find((item) => item.textContent?.includes(`«${text}»`));
  await waitFor(() => expect(find()).toHaveAttribute('data-status', status));
  return find()!;
}
/** La tarjeta del plan, lista para confirmar. */
async function planReady() {
  await waitFor(() => expect(screen.getByTestId('copilot-plan')).toHaveAttribute('data-phase', 'ready'));
  return screen.getByTestId('copilot-plan');
}
const step = (id: string) => screen.getAllByTestId('copilot-plan-step').find((item) => item.getAttribute('data-step') === id)!;
const layersOf = (document: ContentDocument) => document.pages[0]!.layers;
const imagesOf = (document: ContentDocument) => layersOf(document).filter((layer): layer is ImageLayer => layer.type === 'image');
const sourceOf = (layer: ImageLayer) => (layer.source.kind === 'asset' ? layer.source.assetId : '');


beforeEach(() => {
  mocks.request.mockReset();
  mocks.picks = [];
  for (const mock of Object.values(library)) mock.mockReset();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

/** Un post 1:1 blanco con la foto de un plato con márgenes (como en la prueba real). */
function framedDocument(): ContentDocument {
  const empty = createEmptyDocument({ aspectRatio: '1:1', backgroundColor: '#FFFFFF' });
  const dish: ImageLayer = {
    ...newImageLayer(empty.canvas, [], { id: SOUP.id, name: SOUP.name }),
    id: 'foto',
    x: 108,
    y: 108,
    width: 864,
    height: 864,
    anchor: { x: 'center', y: 'center' },
    fit: 'contain',
  };
  return withPageLayers(empty, 0, [dish]);
}

const notesOf = (item: HTMLElement) =>
  within(item)
    .queryAllByTestId('copilot-notes')
    .flatMap((list) => within(list).getAllByRole('listitem').map((note) => note.textContent ?? ''));

describe('la nota coincide con lo aplicado', () => {
  it('sin cambios no dice «Añadí…»: dice que no ha cambiado nada y por qué', async () => {
    const said = 'ponle un título que invite a venir el finde, con nuestros colores';
    mocks.request.mockResolvedValue(
      answer([], {
        note: 'Añadí el título «Ven a disfrutar este finde». El copiloto no redacta.',
        discarded: [
          {
            index: 0,
            op: 'add_text',
            reason:
              'No he puesto «Ven a disfrutar este finde»: no lo has dicho tú y el copiloto no redacta. Dicta el texto tal cual («pon de título: …») o usa «Redactar con IA».',
          },
        ],
      }),
    );
    const { onApply } = renderCopilot({ initial: framedDocument() });
    await order(said);
    const item = await orderOf(said, 'nothing');
    expect(item).toHaveTextContent('Sin cambios');
    const notes = notesOf(item);
    expect(notes[0]).toBe('No he cambiado nada.');
    expect(notes.join(' ')).not.toMatch(/Añadí/);
    expect(notes.join(' ')).toMatch(/No he puesto «Ven a disfrutar este finde»: no lo has dicho tú/);
    expect(notes).toContain('El copiloto no redacta.');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('«que la foto llene todo»: la foto llena el lienzo de borde a borde, y lo dice lo aplicado, no la IA', async () => {
    const said = 'que la foto llene todo';
    // La IA pide «llenar su caja» y dice que ya llena el lienzo: el editor lo entiende como el lienzo entero.
    mocks.request.mockResolvedValue(answer([{ op: 'transform_image', target: 'foto', fit: 'cover' }], { note: 'La foto ahora llena el lienzo.' }));
    const { onApply } = renderCopilot({ initial: framedDocument() });
    await order(said);
    const item = await orderOf(said, 'applied');
    const [document] = onApply.mock.calls.at(-1) as [ContentDocument];
    const photoLayer = imagesOf(document)[0]!;
    expect(photoLayer).toMatchObject({ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height, fit: 'cover' });
    expect(within(item).getByTestId('copilot-changes')).toHaveTextContent('llenando todo el lienzo, de borde a borde');
    expect(notesOf(item).join(' ')).not.toMatch(/ahora llena/);
  });
});

describe('«Sin IA» solo sin gasto', () => {
  it('el «sí» a un plan con fondo con IA dice lo que ha costado, nunca «Sin IA»', async () => {
    mocks.request.mockResolvedValue(answer(PLAN_OPERATIONS));
    const plan = makePlanHost({ generateBackground: vi.fn(async () => ({ ...BACKGROUND, costMicros: 140_000 })) });
    renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await order('sí');
    await orderOf(ORDER, 'applied');
    const yes = await orderOf('sí', 'applied');
    expect(within(yes).queryByTestId('copilot-order-free')).toBeNull();
    await waitFor(() => expect(within(yes).getByTestId('copilot-order-cost')).toHaveTextContent('Con IA: 0,14'));
    expect(plan.generateBackground).toHaveBeenCalledTimes(1);
  });

  it('con «Sí, hazlo», el gasto se anota en la orden del plan', async () => {
    mocks.request.mockResolvedValue(answer(PLAN_OPERATIONS));
    const plan = makePlanHost({ generateBackground: vi.fn(async () => ({ ...BACKGROUND, costMicros: 140_000 })) });
    renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const item = await orderOf(ORDER, 'applied');
    expect(within(item).getByTestId('copilot-order-cost')).toHaveTextContent('Con IA: 0,14');
  });

  it('una orden resuelta en el navegador, sin gasto, sí es «Sin IA»', async () => {
    renderCopilot({ initial: framedDocument() });
    await order('deshaz');
    const item = await orderOf('deshaz', 'nothing');
    expect(within(item).getByTestId('copilot-order-free')).toHaveTextContent('Sin IA');
    expect(within(item).queryByTestId('copilot-order-cost')).toBeNull();
  });
});

describe('«hazme algo bonito» sin pedir un fondo', () => {
  const NICE = 'hazme algo para el finde que quede bonito';
  const AS_IN_STAGING = [
    { op: 'generate_background', prompt: 'Mesa de madera con luz cálida de tarde' },
    { op: 'find_photos', query: 'platos', count: 2 },
    { op: 'place_photos', layout: 'center', cutout: true, on: false },
  ];

  it('usa una foto real que llena el lienzo y el titular de la ocasión; el fondo con IA es opcional y no se gasta', async () => {
    // Como en la prueba real: la IA propone un fondo con IA; el editor no lo pone primero.
    mocks.request.mockResolvedValue(answer(AS_IN_STAGING));
    const { onApply, plan } = renderCopilot({ initial: createEmptyDocument({ aspectRatio: '4:5' }) });
    await order(NICE);
    await planReady();
    expect(screen.getByTestId('copilot-plan-ai-background')).not.toBeChecked();
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent('Coste: nada.');
    expect(screen.getByTestId('copilot-plan')).toHaveTextContent('Poner el titular «Este finde» (propuesto');
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const item = await orderOf(NICE, 'applied');
    // La orden la interpretó la IA de texto, pero el plan no ha gastado en IA de imagen: sin coste anotado.
    expect(within(item).queryByTestId('copilot-order-cost')).toBeNull();
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(plan.cutout).not.toHaveBeenCalled();
    const [document] = onApply.mock.calls.at(-1) as [ContentDocument];
    const [background] = imagesOf(document);
    expect(sourceOf(background!)).toBe(SOUP.id);
    expect(background).toMatchObject({ x: 0, y: 0, width: document.canvas.width, height: document.canvas.height });
    expect(layersOf(document).filter((layer) => layer.type === 'text').map((layer) => (layer as TextLayer).text)).toEqual(['Este finde']);
  });

  it('con el interruptor marcado vuelve el fondo con IA, con su coste, y las fotos recortadas encima', async () => {
    mocks.request.mockResolvedValue(answer(AS_IN_STAGING));
    renderCopilot({ initial: createEmptyDocument({ aspectRatio: '4:5' }) });
    await order(NICE);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-ai-background'));
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent('Coste máximo: 0,14 créditos');
    expect(step('background')).toHaveTextContent('Crear el fondo con IA');
    expect(screen.getByTestId('copilot-plan-cutout')).toBeChecked();
  });
});
