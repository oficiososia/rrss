// Órdenes que MONTAN una pieza (docs/copiloto-voz.md §15): el copiloto enseña el
// plan con su coste máximo y no gasta ni cambia nada hasta el «sí»; después lo
// ejecuta paso a paso y lo mete en el documento de una vez. Sobre una imagen de
// fondo las fotos van recortadas por defecto (con su interruptor en la tarjeta),
// y los textos que ya había se leen sobre el fondo nuevo y no quedan pisados.
// La IA del copiloto, el generador de imágenes, la biblioteca y el recorte están
// SIMULADOS: ninguna prueba llama a ningún servicio ni gasta nada.
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
  mocks.request.mockResolvedValue(answer(PLAN_OPERATIONS));
  mocks.picks = [];
  for (const mock of Object.values(library)) mock.mockReset();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('plan del copiloto: antes de confirmar', () => {
  it('enseña el plan en lenguaje llano, con la indicación entera y el coste máximo, y no gasta ni cambia nada', async () => {
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    const card = await planReady();
    expect(card).toHaveAttribute('aria-live', 'polite');
    expect(card).toHaveAccessibleName('Plan del copiloto');
    expect(card).toHaveTextContent(`para «${ORDER}»`);
    const steps = screen.getAllByTestId('copilot-plan-step');
    expect(steps.map((item) => item.getAttribute('data-step'))).toEqual(['background', 'find-0', 'cutout', 'place', 'op-0']);
    expect(steps[0]).toHaveTextContent('Crear el fondo con IA (4:5) · Pendiente');
    // La indicación que escribió la IA, entera y con la coletilla fija: es lo que se mandará.
    expect(within(steps[0]!).getByTestId('copilot-plan-detail')).toHaveTextContent(`${PROMPT}. ${BACKGROUND_PROMPT_SUFFIX}`);
    expect(steps[1]).toHaveAttribute('data-status', 'done');
    expect(steps[1]).toHaveTextContent('Buscar en la biblioteca hasta 3 fotos de «platos de otoño» · Hecho');
    expect(steps[1]).toHaveTextContent('Encontradas 2: «crema-calabaza.jpg», «guiso-setas.jpg»');
    expect(steps[2]).toHaveTextContent('Quitar el fondo a 2 fotos · Pendiente');
    expect(steps[3]).toHaveTextContent('Colocar las fotos en el centro, recortadas, sin su fondo, con sombra suave');
    expect(screen.getByTestId('copilot-plan-cutout')).toBeChecked();
    expect(steps[4]).toHaveTextContent('Poner el titular «menú de otoño»');
    const cost = screen.getByTestId('copilot-plan-cost');
    expect(cost).toHaveTextContent('Coste máximo: 0,14 créditos (el fondo con IA; lo demás es gratis).');
    expect(cost).toHaveTextContent('1 fondo con IA ≈ 0,14 créditos · 2 recortes gratis · 1 texto');
    expect(card).toHaveTextContent('otra orden lo descarta.');
    expect(card).toHaveTextContent('Hasta que digas «sí» no se gasta ni se cambia nada');
    expect(screen.getByTestId('copilot-plan-confirm')).toHaveAccessibleName('Sí, hazlo');
    expect(screen.getByTestId('copilot-plan-confirm')).toBeEnabled();
    expect(screen.getByTestId('copilot-plan-cancel')).toHaveAccessibleName('No, descartar');
    // La orden espera el «sí».
    expect(await orderOf(ORDER, 'plan')).toHaveTextContent('Esperando tu «sí»');

    // Buscar y pedir el precio no gastan; generar, recortar y aplicar no han ocurrido.
    expect(plan.searchLibrary).toHaveBeenCalledWith('platos de otoño', 3);
    expect(plan.estimateBackground).toHaveBeenCalledWith('4:5');
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(plan.cutout).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('«no» escrito lo descarta sin llamar a la IA: ni se gasta ni se cambia nada', async () => {
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    await planReady();
    await order('no, déjalo');
    const answered = await orderOf('no, déjalo', 'applied');
    expect(answered).toHaveAttribute('data-source', 'local');
    expect(answered).toHaveTextContent('Plan descartado');
    expect(await orderOf(ORDER, 'nothing')).toHaveTextContent('Plan descartado: no se ha gastado ni cambiado nada.');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('el botón «No, descartar» hace lo mismo', async () => {
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-cancel'));
    expect(await orderOf(ORDER, 'nothing')).toHaveTextContent('Plan descartado: no se ha gastado ni cambiado nada.');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('una orden distinta descarta el plan pendiente y sigue su camino normal', async () => {
    const { onApply, plan } = renderCopilot({ selectedIds: ['pie'] });
    await order(ORDER);
    await planReady();
    // Una orden de las frecuentes: se resuelve sin IA, sobre el documento intacto.
    await order('más grande');
    expect(await orderOf('más grande', 'applied')).toHaveAttribute('data-source', 'local');
    expect(await orderOf(ORDER, 'nothing')).toHaveTextContent('Plan descartado al dar otra orden: no se ha gastado ni cambiado nada.');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(layersOf(onApply.mock.calls[0]![0] as ContentDocument).map((layer) => layer.type)).toEqual(['text']);
    // Y un «sí» después ya no confirma nada: es una orden más, que va a la IA.
    mocks.request.mockResolvedValueOnce(answer([], { note: '¿Sí a qué?' }));
    await order('sí');
    expect(await orderOf('sí', 'nothing')).toHaveAttribute('data-source', 'ai');
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(plan.generateBackground).not.toHaveBeenCalled();
  });
});

describe('plan del copiloto: al confirmar', () => {
  it('«Sí, hazlo»: genera el fondo, recorta, y todo entra en el documento de UNA vez', async () => {
    const { onApply, plan, initial } = renderCopilot();
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const done = await orderOf(ORDER, 'applied');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();

    // Al generador llega la indicación con la coletilla fija y la proporción del lienzo.
    expect(plan.generateBackground).toHaveBeenCalledTimes(1);
    expect(plan.generateBackground.mock.calls[0]!.slice(0, 2)).toEqual([`${PROMPT}. ${BACKGROUND_PROMPT_SUFFIX}`, '4:5']);
    expect(plan.cutout.mock.calls.map((call) => (call[0] as CopilotAssetInfo).id)).toEqual([SOUP.id, STEW.id]);

    // Un solo cambio en el documento: fondo generado, los dos platos recortados y el titular.
    expect(onApply).toHaveBeenCalledTimes(1);
    const document = onApply.mock.calls[0]![0] as ContentDocument;
    expect(layersOf(document).map((layer) => layer.type)).toEqual(['image', 'image', 'image', 'text', 'text']);
    const [back, ...placed] = imagesOf(document);
    expect(back).toMatchObject({ x: 0, y: 0, width: 1080, height: 1350 });
    expect(sourceOf(back!)).toBe(BACKGROUND.id);
    // Los platos son las fotos de la biblioteca, recortadas: nunca una imagen generada.
    expect(placed.map(sourceOf)).toEqual([cutOf(SOUP).id, cutOf(STEW).id]);
    for (const layer of placed) expect(layer.shadow).toBeDefined();
    expect(layersOf(document).filter((layer) => layer.type === 'text').map((layer) => (layer as TextLayer).text).sort()).toEqual(['Menú de otoño', 'Reserva ya']); // El titular dictado en minúscula sale con mayúscula inicial.
    // Lo que había sigue ahí y el documento de partida no se ha tocado.
    expect(layersOf(initial)).toHaveLength(1);

    const changes = within(done).getByTestId('copilot-changes');
    expect(changes).toHaveTextContent('Foto de fondo «IA · fondo otoñal.png»');
    expect(changes).toHaveTextContent('Foto «crema-calabaza.jpg (sin fondo).png» añadida encima');
    expect(changes).toHaveTextContent('Texto «Menú de otoño»');
    // Lo creado queda en la biblioteca, y se dice.
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent(
      'En la biblioteca queda lo creado: el fondo «IA · fondo otoñal.png», el recorte «crema-calabaza.jpg (sin fondo).png», el recorte «guiso-setas.jpg (sin fondo).png».',
    );
  });

  it('«sí» escrito confirma sin llamar otra vez a la IA', async () => {
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    await planReady();
    await order('sí');
    const yes = await orderOf('sí', 'applied');
    expect(yes).toHaveAttribute('data-source', 'local');
    expect(yes).toHaveTextContent('Plan confirmado');
    await orderOf(ORDER, 'applied');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(plan.generateBackground).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('progreso paso a paso: cada paso pasa de pendiente a en curso y a hecho', async () => {
    const background = deferred<CopilotAssetInfo>();
    const firstCut = deferred<{ asset: CopilotAssetInfo; created: boolean }>();
    const plan = makePlanHost({
      generateBackground: vi.fn(() => background.promise),
      cutout: vi.fn((source: CopilotAssetInfo) => (source.id === SOUP.id ? firstCut.promise : Promise.resolve({ asset: cutOf(source), created: false }))),
    });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));

    await waitFor(() => expect(screen.getByTestId('copilot-plan')).toHaveAttribute('data-phase', 'running'));
    expect(step('background')).toHaveAttribute('data-status', 'running');
    expect(step('background')).toHaveTextContent('En curso…');
    expect(step('cutout')).toHaveAttribute('data-status', 'pending');
    expect(screen.queryByTestId('copilot-plan-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('copilot-plan-cancel')).toHaveAccessibleName('Cancelar');
    expect(await orderOf(ORDER, 'running')).toHaveTextContent('Haciendo el plan…');

    background.resolve(BACKGROUND);
    await waitFor(() => expect(step('background')).toHaveAttribute('data-status', 'done'));
    await waitFor(() => expect(step('cutout')).toHaveAttribute('data-status', 'running'));
    expect(step('cutout')).toHaveTextContent('0 de 2');
    expect(onApply).not.toHaveBeenCalled();

    firstCut.resolve({ asset: cutOf(SOUP), created: true });
    const done = await orderOf(ORDER, 'applied');
    expect(onApply).toHaveBeenCalledTimes(1);
    // El segundo recorte ya estaba en la biblioteca: no cuenta como creado.
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent(
      'En la biblioteca queda lo creado: el fondo «IA · fondo otoñal.png», el recorte «crema-calabaza.jpg (sin fondo).png».',
    );
  });

  it('cancelar mientras se genera el fondo: el diseño no cambia y se dice que el fondo puede terminar', async () => {
    const background = deferred<CopilotAssetInfo>();
    const plan = makePlanHost({ generateBackground: vi.fn(() => background.promise) });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await waitFor(() => expect(step('background')).toHaveAttribute('data-status', 'running'));
    await userEvent.click(screen.getByTestId('copilot-plan-cancel'));

    const cancelled = await orderOf(ORDER, 'nothing');
    const notes = within(cancelled).getByTestId('copilot-notes');
    expect(notes).toHaveTextContent('Plan cancelado: no se ha cambiado el diseño.');
    expect(notes).toHaveTextContent('El fondo que se estaba generando puede terminar igualmente: si termina, quedará en la biblioteca y contará para el cupo de IA.');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    // A quien generaba se le avisa de que ya no se espera.
    expect((plan.generateBackground.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
    expect(plan.cutout).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    // Aunque el fondo termine después, el documento sigue igual.
    background.resolve(BACKGROUND);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('cancelar a mitad de los recortes (también diciendo «cancela»): lo ya creado queda en la biblioteca y se dice', async () => {
    const secondCut = deferred<{ asset: CopilotAssetInfo; created: boolean }>();
    const plan = makePlanHost({
      cutout: vi.fn((source: CopilotAssetInfo) => (source.id === STEW.id ? secondCut.promise : Promise.resolve({ asset: cutOf(source), created: true }))),
    });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await waitFor(() => expect(step('cutout')).toHaveTextContent('1 de 2'));
    // «cancela», escrito, para el plan al momento: no es una orden más en la cola.
    await order('cancela');

    const cancelled = await orderOf(ORDER, 'nothing');
    const notes = within(cancelled).getByTestId('copilot-notes');
    expect(notes).toHaveTextContent('Plan cancelado: no se ha cambiado el diseño.');
    expect(notes).toHaveTextContent('En la biblioteca queda lo creado: el fondo «IA · fondo otoñal.png», el recorte «crema-calabaza.jpg (sin fondo).png».');
    expect(screen.getAllByTestId('copilot-order')).toHaveLength(1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('si falla la generación del fondo, el plan se para, lo dice y no toca el documento', async () => {
    const plan = makePlanHost({
      generateBackground: vi.fn(async () => {
        throw new AiRequestError('provider_failed', 'El proveedor de IA ha fallado. Inténtalo de nuevo.');
      }),
    });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const failed = await orderOf(ORDER, 'failed');
    expect(within(failed).getByTestId('copilot-notes')).toHaveTextContent(
      'No se ha podido crear el fondo: el plan se para aquí y el diseño no ha cambiado.',
    );
    expect(within(failed).getByTestId('ai-error')).toHaveTextContent('El proveedor de IA ha fallado.');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    expect(plan.cutout).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    // La siguiente orden sigue funcionando.
    await order('deshaz');
    await orderOf('deshaz', 'nothing');
  });

  it('si una foto no se puede recortar, se coloca tal cual y se dice; el plan termina', async () => {
    const plan = makePlanHost({
      cutout: vi.fn(async (source: CopilotAssetInfo) => {
        if (source.id === STEW.id) throw new Error('No se ha encontrado nada que recortar.');
        return { asset: cutOf(source), created: true };
      }),
    });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const done = await orderOf(ORDER, 'applied');
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent('No se ha podido quitar el fondo de «guiso-setas.jpg»: se coloca tal cual.');
    const placed = imagesOf(onApply.mock.calls[0]![0] as ContentDocument).slice(1);
    expect(placed.map(sourceOf)).toEqual([cutOf(SOUP).id, STEW.id]);
  });
});

describe('plan del copiloto: las fotos van recortadas sobre una imagen de fondo', () => {
  /** Lo que mandó el modelo en la prueba real del 23/11/2026: fotos en fila y SIN recortar (`cutout: false`). */
  const UNCUT_OPERATIONS = [
    { op: 'generate_background', prompt: PROMPT },
    { op: 'find_photos', query: 'platos de carne', count: 2 },
    { op: 'place_photos', layout: 'row', cutout: false, on: true },
  ];
  const cutoutSwitch = () => screen.getByTestId<HTMLInputElement>('copilot-plan-cutout');

  it('con fondo generado, la tarjeta dice «recortadas, sin su fondo» y trae el interruptor marcado, aunque la IA no lo pidiera', async () => {
    mocks.request.mockResolvedValue(answer(UNCUT_OPERATIONS));
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    await planReady();
    expect(screen.getAllByTestId('copilot-plan-step').map((item) => item.getAttribute('data-step'))).toEqual(['background', 'find-0', 'cutout', 'place']);
    expect(step('cutout')).toHaveTextContent('Quitar el fondo a 2 fotos · Pendiente');
    expect(step('place')).toHaveTextContent('Colocar las fotos en fila, recortadas, sin su fondo, con sombra suave');
    // El interruptor: una casilla con su etiqueta y su explicación, marcada.
    expect(cutoutSwitch()).toBeChecked();
    expect(cutoutSwitch()).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Recortar las fotos (quitarles su fondo)' })).toBe(cutoutSwitch());
    expect(cutoutSwitch()).toHaveAccessibleDescription('Si ya hay un recorte en la biblioteca, se usa ese.');
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent('2 recortes gratis');
    expect(plan.cutout).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await orderOf(ORDER, 'applied');
    expect(plan.cutout.mock.calls.map((call) => (call[0] as CopilotAssetInfo).id)).toEqual([SOUP.id, STEW.id]);
    // En el documento, los recortes: no las fotos enteras con su fondo.
    expect(imagesOf(onApply.mock.calls[0]![0] as ContentDocument).slice(1).map(sourceOf)).toEqual([cutOf(SOUP).id, cutOf(STEW).id]);
  });

  it('desmarcarlo coloca las fotos enteras: cambian el paso y el coste, y no se llama al recorte', async () => {
    mocks.request.mockResolvedValue(answer(UNCUT_OPERATIONS));
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    await planReady();
    await userEvent.click(cutoutSwitch());
    expect(cutoutSwitch()).not.toBeChecked();
    expect(screen.getAllByTestId('copilot-plan-step').map((item) => item.getAttribute('data-step'))).toEqual(['background', 'find-0', 'place']);
    expect(step('place')).toHaveTextContent('Colocar las fotos en fila, enteras, con su fondo, con sombra suave');
    expect(screen.getByTestId('copilot-plan-cutout-hint')).toHaveTextContent('Enteras: se verá el fondo de cada foto.');
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent('2 fotos de la biblioteca');
    expect(screen.getByTestId('copilot-plan-cost')).not.toHaveTextContent('recorte');
    // Cambiarlo no gasta ni toca nada, y se puede volver atrás.
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(cutoutSwitch());
    expect(step('place')).toHaveTextContent('recortadas, sin su fondo');
    await userEvent.click(cutoutSwitch());

    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const done = await orderOf(ORDER, 'applied');
    expect(plan.cutout).not.toHaveBeenCalled();
    expect(imagesOf(onApply.mock.calls[0]![0] as ContentDocument).slice(1).map(sourceOf)).toEqual([SOUP.id, STEW.id]);
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent('En la biblioteca queda lo creado: el fondo «IA · fondo otoñal.png».');
  });

  it('con un recorte de la foto ya guardado en la biblioteca no se recorta de nuevo: se usa ese', async () => {
    // El recorte de verdad del editor (planHost.ts) sobre una biblioteca simulada: de la crema ya hay
    // un recorte guardado; del guiso, no.
    const saved = { ...libraryRow(SOUP), id: cutOf(SOUP).id, file_name: cutOf(SOUP).name, provenance: { type: 'photo_edit', source_asset_id: SOUP.id, steps: [{ kind: 'remove_background' }] } };
    const fresh = { ...libraryRow(STEW), id: cutOf(STEW).id, file_name: cutOf(STEW).name, provenance: { type: 'photo_edit', source_asset_id: STEW.id, steps: [{ kind: 'remove_background' }] } };
    library.fetchAsset.mockImplementation(async (_brand: string, id: string) => [libraryRow(SOUP), libraryRow(STEW)].find((row) => row.id === id) ?? null);
    library.fetchPhotoEdits.mockImplementation(async (_brand: string, id: string) => (id === SOUP.id ? [saved] : []));
    library.signedUrlFor.mockResolvedValue('https://archivos.test/foto.jpg');
    library.runQuickEdit.mockResolvedValue(fresh);
    // `planHost` ya está cargado (lo precarga la preparación de las pruebas con el editor): se carga de
    // nuevo para que use la biblioteca y el recorte simulados de este archivo.
    vi.resetModules();
    const { createCopilotPlanHost } = await import('./planHost');
    const real = createCopilotPlanHost({ brandId: 'marca', imageAi: { available: true }, saveEdit: vi.fn() });
    expect(real.canCutout).toBe(true);
    mocks.request.mockResolvedValue(answer(UNCUT_OPERATIONS));
    const plan = makePlanHost({ cutout: vi.fn(real.cutout) });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    expect(cutoutSwitch()).toBeChecked();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const done = await orderOf(ORDER, 'applied');

    // Las dos van recortadas, pero solo se ha recortado la que no tenía recorte.
    expect(imagesOf(onApply.mock.calls[0]![0] as ContentDocument).slice(1).map(sourceOf)).toEqual([saved.id, fresh.id]);
    expect(library.runQuickEdit).toHaveBeenCalledTimes(1);
    expect(library.runQuickEdit.mock.calls[0]![0]).toMatchObject({ asset: { id: STEW.id }, edit: { kind: 'cutout' } });
    // Y lo creado es solo eso: el recorte que ya estaba no se cuenta como nuevo.
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent(
      'En la biblioteca queda lo creado: el fondo «IA · fondo otoñal.png», el recorte «guiso-setas.jpg (sin fondo).png».',
    );
  });

  it('con una foto de fondo ya puesta en la pieza también van recortadas por defecto; sobre un lienzo liso manda la IA', async () => {
    const placing = [
      { op: 'find_photos', query: 'platos de carne', count: 2 },
      { op: 'place_photos', layout: 'row', cutout: false, on: false },
    ];
    mocks.request.mockResolvedValue(answer(placing));
    // 1. Lienzo de color liso: se respeta el «sin recortar» de la IA; el interruptor está, sin marcar.
    const plain = renderCopilot();
    await order(ORDER);
    await planReady();
    expect(cutoutSwitch()).not.toBeChecked();
    expect(step('place')).toHaveTextContent('Colocar las fotos en fila · Pendiente');
    expect(screen.getByTestId('copilot-plan-cutout-hint')).toHaveTextContent('Enteras, como están en la biblioteca.');
    expect(screen.queryByText(/Quitar el fondo a/)).not.toBeInTheDocument();
    // Marcarlo las recorta.
    await userEvent.click(cutoutSwitch());
    expect(step('cutout')).toHaveTextContent('Quitar el fondo a 2 fotos');
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await orderOf(ORDER, 'applied');
    expect(plain.plan.cutout).toHaveBeenCalledTimes(2);
    cleanup();

    // 2. La pieza ya tiene una foto de fondo: recortadas, sin que la IA lo pida.
    const empty = createEmptyDocument({ aspectRatio: '4:5' });
    const back: ImageLayer = { ...newImageLayer(empty.canvas, [], { id: BACKGROUND.id, name: 'salón.jpg' }), id: 'fondo' };
    const over = renderCopilot({ initial: withPageLayers(empty, 0, [back]) });
    await order(ORDER);
    await planReady();
    expect(cutoutSwitch()).toBeChecked();
    expect(step('place')).toHaveTextContent('Colocar las fotos en fila, recortadas, sin su fondo');
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await orderOf(ORDER, 'applied');
    expect(over.plan.cutout).toHaveBeenCalledTimes(2);
    expect(over.plan.generateBackground).not.toHaveBeenCalled();
  });

  it('donde no se puede quitar el fondo no hay interruptor: se colocan enteras y se dice', async () => {
    mocks.request.mockResolvedValue(answer(UNCUT_OPERATIONS));
    const plan = makePlanHost({ canCutout: false });
    renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    expect(screen.queryByTestId('copilot-plan-cutout')).not.toBeInTheDocument();
    expect(step('place')).toHaveTextContent('Colocar las fotos en fila, enteras, con su fondo');
    expect(screen.getByTestId('copilot-plan-notes')).toHaveTextContent('Aquí no se puede quitar el fondo de las fotos: se colocan tal cual.');
  });

  it('con el plan en marcha, el interruptor ya no se puede cambiar', async () => {
    const background = deferred<CopilotAssetInfo>();
    mocks.request.mockResolvedValue(answer(UNCUT_OPERATIONS));
    const plan = makePlanHost({ generateBackground: vi.fn(() => background.promise) });
    renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await waitFor(() => expect(screen.getByTestId('copilot-plan')).toHaveAttribute('data-phase', 'running'));
    expect(cutoutSwitch()).toBeDisabled();
    expect(cutoutSwitch()).toBeChecked();
    background.resolve(BACKGROUND);
    await orderOf(ORDER, 'applied');
  });
});

describe('plan del copiloto: los textos que ya había se leen y no se pisan', () => {
  /** El caso real: «…crea un fondo que parezca otoñal y pon dos platos de carne en el centro». */
  const CENTER_OPERATIONS = [
    { op: 'generate_background', prompt: PROMPT },
    { op: 'find_photos', query: 'platos de carne', count: 2 },
    { op: 'place_photos', layout: 'center', cutout: false, on: true },
  ];
  /** Una pieza 1:1 con un título blanco y centrado, como la de la prueba real. */
  function withWhiteTitle(): ContentDocument {
    const empty = createEmptyDocument({ aspectRatio: '1:1' });
    const title: TextLayer = { ...newTextLayer(empty.canvas, [], { fontFamily: 'Marca Titulares', color: '#FFFFFF' }), id: 'titulo', text: 'Menú de otoño' };
    return withPageLayers(empty, 0, [title]);
  }
  const titleOf = (document: ContentDocument) => layersOf(document).find((layer): layer is TextLayer => layer.id === 'titulo')!;
  const overlap = (a: ImageLayer | TextLayer, b: ImageLayer | TextLayer) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it('mide el tono del fondo generado: el título blanco sube, pasa a un color que se lee y las fotos ocupan el centro; se dice', async () => {
    mocks.request.mockResolvedValue(answer(CENTER_OPERATIONS));
    const initial = withWhiteTitle();
    const { onApply, plan } = renderCopilot({ initial });
    await order(ORDER);
    await planReady();
    expect(plan.measureTone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const done = await orderOf(ORDER, 'applied');

    // Se mide el fondo que se acaba de generar (leer no gasta), no otra cosa.
    expect(plan.measureTone).toHaveBeenCalledTimes(1);
    expect((plan.measureTone!.mock.calls[0]![0] as CopilotAssetInfo).id).toBe(BACKGROUND.id);
    // Todo en un solo cambio del documento.
    expect(onApply).toHaveBeenCalledTimes(1);
    const document = onApply.mock.calls[0]![0] as ContentDocument;
    const title = titleOf(document);
    expect(titleOf(initial)).toMatchObject({ y: 449, color: '#FFFFFF' });
    expect(title).toMatchObject({ y: 54, color: '#A3122A' });
    expect(title.outline).toBeUndefined();
    const placed = imagesOf(document).slice(1);
    expect(placed).toHaveLength(2);
    for (const layer of placed) expect(overlap(layer, title)).toBe(false);
    // Las dos fotos, agrupadas en el centro del lienzo (1080 × 1080).
    const top = Math.min(...placed.map((layer) => layer.y));
    const bottom = Math.max(...placed.map((layer) => layer.y + layer.height));
    expect(Math.abs((top + bottom) / 2 - 540)).toBeLessThanOrEqual(2);

    const changes = within(done).getByTestId('copilot-changes');
    expect(changes).toHaveTextContent('He subido el título «Menú de otoño» para dejar el centro a las fotos');
    expect(changes).toHaveTextContent('Texto «Menú de otoño» en #A3122A para que se lea sobre el fondo');
  });

  it('si el tono del fondo no se puede medir, el título conserva su color y lleva un contorno; y se dice', async () => {
    mocks.request.mockResolvedValue(answer(CENTER_OPERATIONS));
    // No se puede leer la imagen (CORS, fallo de carga…): el editor devuelve null. Lo mismo si el fallo es una excepción.
    for (const measureTone of [vi.fn(async () => null), vi.fn(async () => Promise.reject(new Error('lienzo manchado')))]) {
      const { onApply } = renderCopilot({ plan: makePlanHost({ measureTone }), initial: withWhiteTitle() });
      await order(ORDER);
      await planReady();
      await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
      const done = await orderOf(ORDER, 'applied');
      expect(measureTone).toHaveBeenCalledTimes(1);
      const title = titleOf(onApply.mock.calls[0]![0] as ContentDocument);
      expect(title).toMatchObject({ y: 54, color: '#FFFFFF', outline: { color: '#000000' } });
      expect(within(done).getByTestId('copilot-changes')).toHaveTextContent(
        'Texto «Menú de otoño» con contorno: no he podido medir el tono del fondo nuevo y así se lee sobre cualquiera',
      );
      cleanup();
    }
  });

  it('cancelar mientras se mide el tono: el diseño no cambia', async () => {
    mocks.request.mockResolvedValue(answer(CENTER_OPERATIONS));
    const tone = deferred<MeasuredTone | null>();
    const plan = makePlanHost({ measureTone: vi.fn(() => tone.promise), cutout: vi.fn(async (source: CopilotAssetInfo) => ({ asset: cutOf(source), created: false })) });
    const { onApply } = renderCopilot({ plan, initial: withWhiteTitle() });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await waitFor(() => expect(step('cutout')).toHaveAttribute('data-status', 'done'));
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('copilot-plan-cancel'));
    const cancelled = await orderOf(ORDER, 'nothing');
    expect(within(cancelled).getByTestId('copilot-notes')).toHaveTextContent('Plan cancelado: no se ha cambiado el diseño.');
    tone.resolve(LIGHT);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('plan del copiloto: cuando falta algo', () => {
  it('sin fotos en la biblioteca: lo dice, pide elegirlas con el selector y sigue con las elegidas', async () => {
    const plan = makePlanHost({ searchLibrary: vi.fn(async () => []) });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    const card = await planReady();
    expect(screen.getByTestId('copilot-plan-missing')).toHaveTextContent('No encuentro fotos de «platos de otoño» en la biblioteca. Elige tú cuáles usar.');
    expect(step('find-0')).toHaveAttribute('data-status', 'failed');
    expect(step('find-0')).toHaveTextContent('No hay ninguna foto que case.');
    expect(card).toHaveTextContent('Sin fotos, el paso de colocarlas se salta.');
    const pick = screen.getByTestId('copilot-plan-pick');
    expect(pick).toHaveAccessibleName('Elegir fotos (0 de 3)');

    // Se elige dos veces, una foto cada vez.
    mocks.picks = [
      { id: SOUP.id, file_name: SOUP.name, width: 1200, height: 900 },
      { id: STEW.id, file_name: STEW.name, width: 1200, height: 900 },
    ];
    await userEvent.click(pick);
    await userEvent.click(screen.getByTestId('fake-picker'));
    expect(screen.getByTestId('copilot-plan-pick')).toHaveAccessibleName('Elegir fotos (1 de 3)');
    await userEvent.click(screen.getByTestId('copilot-plan-pick'));
    await userEvent.click(screen.getByTestId('fake-picker'));
    expect(screen.getByTestId('copilot-plan-pick')).toHaveAccessibleName('Elegir fotos (2 de 3)');
    expect(within(screen.getByLabelText('Fotos del plan')).getAllByRole('listitem').map((item) => item.textContent)).toEqual([SOUP.name, STEW.name]);
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent('2 recortes gratis');
    // Elegir no gasta ni cambia nada, y las fotos no pasan a ser «esta foto» del copiloto.
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByTestId('copilot-photos')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await orderOf(ORDER, 'applied');
    const placed = imagesOf(onApply.mock.calls[0]![0] as ContentDocument).slice(1);
    expect(placed.map(sourceOf)).toEqual([cutOf(SOUP).id, cutOf(STEW).id]);
  });

  it('una foto que no se quiere se quita del plan antes de confirmar', async () => {
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByRole('button', { name: 'No usar guiso-setas.jpg' }));
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent('1 recorte gratis');
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await orderOf(ORDER, 'applied');
    expect(plan.cutout).toHaveBeenCalledTimes(1);
    expect(imagesOf(onApply.mock.calls[0]![0] as ContentDocument).slice(1).map(sourceOf)).toEqual([cutOf(SOUP).id]);
  });

  it('sin fotos y sin elegir: ese paso se salta y se dice; el resto del plan se hace', async () => {
    const plan = makePlanHost({ searchLibrary: vi.fn(async () => []) });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const done = await orderOf(ORDER, 'applied');
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent('No hay fotos que colocar: ese paso se ha saltado.');
    expect(plan.cutout).not.toHaveBeenCalled();
    const document = onApply.mock.calls[0]![0] as ContentDocument;
    expect(imagesOf(document).map(sourceOf)).toEqual([BACKGROUND.id]);
  });

  it('sin IA de imagen: no se ofrece generar; propone el color de fondo de la marca y lo dice claro', async () => {
    const plan = makePlanHost({ imageAi: { available: false, reason: 'La imagen con IA no está configurada.' } });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    expect(step('background')).toHaveTextContent('Poner de fondo un color liso de la marca (#F4E9D8)');
    expect(step('background')).toHaveTextContent('La imagen con IA no está configurada. En su lugar, un color liso: no se genera nada.');
    expect(screen.getByTestId('copilot-plan')).not.toHaveTextContent('Crear el fondo con IA');
    const cost = screen.getByTestId('copilot-plan-cost');
    expect(cost).toHaveTextContent('Coste: nada. Este plan no usa IA de pago.');
    expect(cost).toHaveTextContent('1 fondo de color gratis · 2 recortes gratis · 1 texto');
    expect(plan.estimateBackground).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    await orderOf(ORDER, 'applied');
    expect(plan.generateBackground).not.toHaveBeenCalled();
    const document = onApply.mock.calls[0]![0] as ContentDocument;
    expect(document.canvas.backgroundColor).toBe('#F4E9D8');
    expect(imagesOf(document).map(sourceOf)).toEqual([cutOf(SOUP).id, cutOf(STEW).id]);
  });

  it('si el coste no se puede saber antes de generar, se dice con honestidad y se deja decidir', async () => {
    const unknown = makePlanHost({ estimateBackground: vi.fn(async () => null) });
    const first = renderCopilot({ plan: unknown });
    await order(ORDER);
    await planReady();
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent(
      'No se ha podido calcular el coste del fondo con IA antes de generarlo: se verá al generar y contará para el cupo de IA.',
    );
    expect(screen.getByTestId('copilot-plan-confirm')).toBeEnabled();
    await userEvent.click(screen.getByTestId('copilot-plan-cancel'));
    await orderOf(ORDER, 'nothing');
    expect(first.onApply).not.toHaveBeenCalled();
  });

  it('un plan por encima del tope de coste no se puede confirmar, ni con el botón ni diciendo «sí»', async () => {
    const plan = makePlanHost({ estimateBackground: vi.fn(async () => 2_500_000) });
    const { onApply } = renderCopilot({ plan });
    await order(ORDER);
    await planReady();
    expect(screen.getByTestId('copilot-plan-blocked')).toHaveTextContent(
      'El fondo con IA cuesta ≈ 2,50 créditos y el tope por plan es 1,00 crédito: no se ejecuta tal cual.',
    );
    expect(screen.getByTestId('copilot-plan-confirm')).toBeDisabled();
    await order('sí');
    expect(await orderOf('sí', 'nothing')).toHaveTextContent('el tope por plan es 1,00 crédito');
    expect(screen.getByTestId('copilot-plan')).toBeInTheDocument();
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('un fondo que nombra comida no se genera aunque llegue del servidor: lo demás es una orden normal', async () => {
    mocks.request.mockResolvedValue(
      answer([
        { op: 'generate_background', prompt: 'Un plato de paella humeante sobre la mesa' },
        { op: 'add_text', text: 'menú de otoño', style: 'title' },
      ]),
    );
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    const done = await orderOf(ORDER, 'applied');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent('La IA solo crea el fondo: los platos y productos son fotos de la biblioteca.');
    expect(plan.estimateBackground).not.toHaveBeenCalled();
    expect(plan.generateBackground).not.toHaveBeenCalled();
    expect(imagesOf(onApply.mock.calls[0]![0] as ContentDocument)).toEqual([]);
  });

  it('si el servidor descartó el fondo por nombrar comida, la tarjeta lo dice ANTES de confirmar y el plan sigue sin fondo', async () => {
    const reason = 'La IA solo crea el fondo: los platos y productos son fotos de la biblioteca.';
    mocks.request.mockResolvedValue(
      answer(PLAN_OPERATIONS.slice(1), {
        discarded: [{ index: 0, op: 'generate_background', reason }],
        note: 'No puedo generar el plato: uso tus fotos.',
      }),
    );
    const { onApply, plan } = renderCopilot();
    await order(ORDER);
    await planReady();
    const notes = screen.getByTestId('copilot-plan-notes');
    expect(notes).toHaveTextContent('No puedo generar el plato: uso tus fotos.');
    expect(notes).toHaveTextContent(reason);
    expect(screen.getAllByTestId('copilot-plan-step').map((item) => item.getAttribute('data-step'))).toEqual(['find-0', 'cutout', 'place', 'op-0']);
    expect(screen.getByTestId('copilot-plan-cost')).toHaveTextContent('Coste: nada. Este plan no usa IA de pago.');
    expect(plan.estimateBackground).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('copilot-plan-confirm'));
    const done = await orderOf(ORDER, 'applied');
    expect(within(done).getByTestId('copilot-notes')).toHaveTextContent(reason);
    expect(plan.generateBackground).not.toHaveBeenCalled();
    // Solo las fotos de la biblioteca, recortadas: ninguna imagen generada.
    expect(imagesOf(onApply.mock.calls[0]![0] as ContentDocument).map(sourceOf)).toEqual([cutOf(SOUP).id, cutOf(STEW).id]);
  });

  it('sin editor detrás, montar una pieza se dice como no disponible y no se hace nada', async () => {
    const { onApply } = renderCopilot({ plan: null });
    await order(ORDER);
    expect(await orderOf(ORDER, 'nothing')).toHaveTextContent('Montar una pieza por pasos hay que hacerlo desde el editor.');
    expect(screen.queryByTestId('copilot-plan')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});
