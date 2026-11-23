// Copiloto del editor por TECLADO: el campo de texto funciona sin micrófono; las
// órdenes frecuentes se resuelven en el navegador (sin IA) y el resto va a
// `editor.copilot`, cuyas operaciones se aplican como un solo cambio. La IA está
// simulada (`requestEditorCopilot`): ninguna prueba llama a ningún servicio.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, withPageLayers, type ContentDocument, type ImageLayer, type TextLayer } from '../document';
import { newImageLayer, newTextLayer } from '../editor/layers';
import { NOTE_NOTHING_SELECTED } from './localCommands';
import { COPILOT_SIZE_STEP } from './operations';
import { VoiceCopilot, type CopilotHost } from './VoiceCopilot';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  transcriberConfigured: false,
  canRecord: false,
}));

vi.mock('@/features/ai/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/ai/api')>()),
  requestEditorCopilot: mocks.request,
}));
vi.mock('./transcriber', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./transcriber')>()),
  useTranscriberConfigured: () => mocks.transcriberConfigured,
}));
vi.mock('./recording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recording')>()),
  recordingAvailable: () => mocks.canRecord,
}));

const GENERATION = '55555555-5555-4555-8555-555555555555';
const PHOTO = '11111111-1111-4111-8111-111111111111';

const starts = vi.fn();
class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult = null;
  onerror = null;
  onend = null;
  start = () => starts();
  stop = () => undefined;
  abort = () => undefined;
}
const withSpeech = () => {
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
};

/** Documento con un título (y, si se pide, una foto de fondo y más páginas). */
function documentWith(options: { photo?: boolean; pages?: number } = {}): ContentDocument {
  const empty = createEmptyDocument({ aspectRatio: '4:5', pages: options.pages ?? 1 });
  const title: TextLayer = {
    ...newTextLayer(empty.canvas, [], { fontFamily: 'Marca Titulares', color: '#111111' }),
    id: 'titulo',
    text: 'Menú del día',
    fontSize: 80,
    height: 100,
    y: 150,
  };
  const photo: ImageLayer = { ...newImageLayer(empty.canvas, [], { id: PHOTO, name: 'mesa.jpg' }), id: 'fondo' };
  return withPageLayers(empty, 0, options.photo ? [photo, title] : [title]);
}

function makeHost(overrides: Partial<CopilotHost> = {}): CopilotHost & { [K in keyof CopilotHost]: ReturnType<typeof vi.fn> } {
  return {
    history: vi.fn(() => null),
    goToPage: vi.fn(),
    save: vi.fn(),
    openTemplates: vi.fn(),
    photoFlow: vi.fn(() => null),
    ...overrides,
  } as CopilotHost & { [K in keyof CopilotHost]: ReturnType<typeof vi.fn> };
}

interface HarnessProps {
  initial: ContentDocument;
  selectedIds?: string[];
  host?: CopilotHost;
  onApply: (document: ContentDocument, touched: string[], pageIndex: number) => void;
}

/** El copiloto con un «editor» mínimo alrededor: guarda el documento y la página que le aplican. */
function Harness({ initial, selectedIds = [], host, onApply }: HarnessProps) {
  const [document, setDocument] = useState(initial);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState(selectedIds);
  return (
    <VoiceCopilot
      orgId="org"
      brandId="marca"
      brandName="Marca"
      document={document}
      pageIndex={pageIndex}
      selectedIds={selected}
      brand={{ palette: [{ hex: '#A3122A', role: 'principal' }], fonts: ['Marca Titulares'] }}
      logoIds={[]}
      selectedImage={null}
      libraryPath="/biblioteca"
      host={host}
      onApply={(next, touched, index) => {
        onApply(next, touched, index);
        setDocument(next);
        setSelected(touched);
        setPageIndex(index);
      }}
      onClose={() => undefined}
    />
  );
}

function renderCopilot(props: Partial<HarnessProps> = {}) {
  const onApply = props.onApply ?? vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness initial={props.initial ?? documentWith()} selectedIds={props.selectedIds} host={props.host} onApply={onApply} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onApply: onApply as ReturnType<typeof vi.fn> };
}

const input = () => screen.getByTestId<HTMLInputElement>('copilot-text-input');
/** Escribe una orden y la envía con Enter. */
async function order(text: string) {
  await userEvent.type(input(), `${text}{Enter}`);
}
/** La orden más reciente (la lista va de la última a la primera), cuando ya ha terminado. */
async function lastOrder(status: string) {
  await waitFor(() => expect(screen.getAllByTestId('copilot-order')[0]).toHaveAttribute('data-status', status));
  return screen.getAllByTestId('copilot-order')[0]!;
}
const answer = (operations: unknown[], extra: Record<string, unknown> = {}) => ({
  action: 'editor.copilot',
  generationId: GENERATION,
  operations,
  discarded: [],
  note: '',
  ...extra,
});
const titleOf = (document: ContentDocument) => document.pages[0]!.layers.find((layer) => layer.id === 'titulo') as TextLayer;

beforeEach(() => {
  mocks.request.mockReset();
  mocks.transcriberConfigured = false;
  mocks.canRecord = false;
  starts.mockClear();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});
afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('copiloto por teclado: sin micrófono', () => {
  it('sin dictado del navegador ni grabación, el panel sale, dice que se escriba y el campo envía con Enter y con el botón', async () => {
    renderCopilot({ selectedIds: ['titulo'] });
    expect(screen.getByTestId('copilot-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Copiloto' })).toBeInTheDocument();
    expect(screen.getByTestId('copilot-voice-status')).toHaveTextContent('Este navegador no puede dictar: escribe la orden.');
    // Ni micrófono, ni aviso de voz, ni selector de motor: no hay voz que avisar.
    expect(screen.queryByTestId('copilot-mic')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copilot-voice-engine')).not.toBeInTheDocument();
    expect(screen.queryByTestId('copilot-interim')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Escribe una orden')).toBe(input());

    // Vacío no se envía.
    const send = screen.getByTestId('copilot-text-send');
    expect(send).toBeDisabled();
    await userEvent.type(input(), '   {Enter}');
    expect(screen.queryByTestId('copilot-order')).not.toBeInTheDocument();
    await userEvent.clear(input());

    // Enter envía y el campo se vacía.
    await order('más grande');
    expect(input()).toHaveValue('');
    expect(await lastOrder('applied')).toHaveTextContent('«más grande»');
    // El botón también.
    await userEvent.type(input(), 'más pequeño');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(input()).toHaveValue('');
    expect(await lastOrder('applied')).toHaveTextContent('«más pequeño»');
    expect(screen.getAllByTestId('copilot-order')).toHaveLength(2);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('para escribir no sale el aviso de voz: solo al pulsar el micrófono, y sin aceptarlo no se escucha', async () => {
    withSpeech();
    const host = makeHost();
    renderCopilot({ host });
    // Al abrir: ni aviso ni micrófono abierto; el campo de texto funciona.
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    expect(input()).toBeEnabled();
    await order('deshaz');
    await lastOrder('nothing');
    expect(host.history).toHaveBeenCalledWith('undo');
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    expect(starts).not.toHaveBeenCalled();
    // Al pulsar el micrófono por primera vez: el aviso, compacto, y todavía sin escuchar.
    expect(screen.getByTestId('copilot-mic')).toHaveTextContent('Dictar');
    await userEvent.click(screen.getByTestId('copilot-mic'));
    expect(screen.getByTestId('copilot-voice-notice')).toHaveTextContent('Google');
    expect(screen.getByTestId('copilot-voice-notice-ok')).toHaveTextContent('Entendido, dictar');
    expect(screen.getByLabelText('No volver a mostrar')).toBe(screen.getByTestId('copilot-voice-notice-hide'));
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toBeInTheDocument();
    expect(starts).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('copilot-voice-notice-ok'));
    expect(starts).toHaveBeenCalledTimes(1);
  });

  it('con el transcriptor disponible sale el selector de motor y su aviso nombra a OpenAI', async () => {
    withSpeech();
    mocks.transcriberConfigured = true;
    mocks.canRecord = true;
    renderCopilot();
    const selector = screen.getByTestId<HTMLSelectElement>('copilot-voice-engine');
    expect(within(selector).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Transcriptor (OpenAI)',
      'Dictado del navegador',
    ]);
    // Por defecto, el transcriptor; su aviso (al pulsar el micrófono) dice adónde va el audio.
    expect(selector).toHaveValue('transcriber');
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('copilot-mic')).toHaveTextContent('Pulsar para hablar');
    await userEvent.click(screen.getByTestId('copilot-mic'));
    const notice = screen.getByTestId('copilot-voice-notice');
    expect(notice).toHaveTextContent('OpenAI');
    expect(notice).toHaveTextContent('cada dictado cuenta para el cupo');
    expect(notice).not.toHaveTextContent('Google');
    // Al cambiar de motor se cierra; el aviso del otro es el suyo (no vale haber leído uno para el otro).
    await userEvent.selectOptions(selector, 'browser');
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('copilot-mic'));
    expect(screen.getByTestId('copilot-voice-notice')).toHaveTextContent('Google');
    expect(screen.getByTestId('copilot-voice-notice')).not.toHaveTextContent('OpenAI');
    expect(starts).not.toHaveBeenCalled();
    await userEvent.selectOptions(selector, 'transcriber');
    expect(screen.getByTestId('copilot-voice-status')).toHaveTextContent('Escribe la orden o pulsa para hablar.');
    expect(starts).not.toHaveBeenCalled();
  });

  it('solo con el transcriptor (sin dictado del navegador) no hay selector y el aviso es el suyo', async () => {
    mocks.transcriberConfigured = true;
    mocks.canRecord = true;
    const first = renderCopilot();
    expect(screen.queryByTestId('copilot-voice-engine')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('copilot-mic'));
    expect(screen.getByTestId('copilot-voice-notice')).toHaveTextContent('OpenAI');
    expect(first.onApply).not.toHaveBeenCalled();
  });

  it('el navegador puede grabar pero el transcriptor no está configurado: solo teclado', () => {
    mocks.canRecord = true;
    renderCopilot();
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('copilot-voice-status')).toHaveTextContent('escribe la orden');
  });
});

describe('copiloto por teclado: órdenes frecuentes, sin IA', () => {
  it('«deshaz»: se resuelve en el navegador, llama al editor y no gasta cupo', async () => {
    const previous = documentWith({ photo: true });
    const host = makeHost({ history: vi.fn(() => ({ document: previous, pageIndex: 0 })) });
    const { onApply } = renderCopilot({ host });
    await order('deshaz');
    const item = await lastOrder('applied');
    expect(item).toHaveAttribute('data-source', 'local');
    expect(item).toHaveTextContent('Sin IA');
    expect(item).toHaveTextContent('Aplicada');
    expect(within(item).getByTestId('copilot-changes')).toHaveTextContent('Deshecho el último cambio');
    expect(host.history).toHaveBeenCalledTimes(1);
    expect(host.history).toHaveBeenCalledWith('undo');
    // Deshacer lo hace el editor: el copiloto no aplica ningún documento.
    expect(onApply).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();

    await order('rehaz');
    await lastOrder('applied');
    expect(host.history).toHaveBeenLastCalledWith('redo');
    expect(screen.getAllByTestId('copilot-changes')[0]).toHaveTextContent('Rehecho el cambio');
  });

  it('«deshaz» sin nada que deshacer lo dice; sin editor detrás, tampoco se inventa', async () => {
    const host = makeHost();
    renderCopilot({ host });
    await order('deshaz');
    const item = await lastOrder('nothing');
    expect(item).toHaveAttribute('data-source', 'local');
    expect(within(item).getByTestId('copilot-notes')).toHaveTextContent('No hay nada que deshacer.');
    expect(item).toHaveTextContent('Sin cambios');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('«más grande» con una capa elegida: se aplica al momento como un solo cambio', async () => {
    const initial = documentWith();
    const { onApply } = renderCopilot({ initial, selectedIds: ['titulo'] });
    await order('más grande');
    const item = await lastOrder('applied');
    expect(item).toHaveAttribute('data-source', 'local');
    expect(item).toHaveTextContent('Sin IA');
    expect(within(item).getByTestId('copilot-changes')).toHaveTextContent('«Menú del día», más grande');
    expect(onApply).toHaveBeenCalledTimes(1);
    const [document, touched, pageIndex] = onApply.mock.calls[0] as [ContentDocument, string[], number];
    expect(titleOf(document).fontSize).toBe(Math.round(80 * COPILOT_SIZE_STEP));
    expect(touched).toEqual(['titulo']);
    expect(pageIndex).toBe(0);
    // El documento de partida no se toca.
    expect(titleOf(initial).fontSize).toBe(80);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('sin nada elegido, «más grande» da la nota sin llamar a la IA', async () => {
    const { onApply } = renderCopilot();
    await order('más grande');
    const item = await lastOrder('nothing');
    expect(item).toHaveAttribute('data-source', 'local');
    expect(within(item).getByTestId('copilot-notes')).toHaveTextContent(NOTE_NOTHING_SELECTED);
    expect(within(item).queryByTestId('copilot-changes')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('dos órdenes seguidas van en orden, cada una sobre el documento que dejó la anterior', async () => {
    const { onApply } = renderCopilot({ selectedIds: ['titulo'] });
    await userEvent.type(input(), 'más grande{Enter}más grande{Enter}');
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    const second = (onApply.mock.calls[1] as [ContentDocument])[0];
    expect(titleOf(second).fontSize).toBe(Math.round(Math.round(80 * COPILOT_SIZE_STEP) * COPILOT_SIZE_STEP));
    expect(screen.getAllByTestId('copilot-order')).toHaveLength(2);
  });

  it('«guarda», «abre las plantillas» y «siguiente página» llaman al editor; sin editor se dice dónde hacerlo', async () => {
    const host = makeHost();
    const { onApply } = renderCopilot({ host, initial: documentWith({ pages: 2 }) });
    await order('guarda');
    expect(within(await lastOrder('applied')).getByTestId('copilot-changes')).toHaveTextContent('Guardando una versión…');
    expect(host.save).toHaveBeenCalledTimes(1);
    await order('abre las plantillas');
    expect(within(await lastOrder('applied')).getByTestId('copilot-changes')).toHaveTextContent('Abiertas las plantillas');
    expect(host.openTemplates).toHaveBeenCalledTimes(1);
    // Ir a otra página no cambia el documento: se le pide al editor, sin paso de deshacer.
    await order('siguiente página');
    const item = await lastOrder('applied');
    expect(within(item).getByTestId('copilot-changes')).toHaveTextContent('Página 2');
    expect(host.goToPage).toHaveBeenCalledWith(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    for (const element of screen.getAllByTestId('copilot-order')) expect(element).toHaveAttribute('data-source', 'local');
  });

  it('sin editor detrás (`host`), guardar y las plantillas se dicen como no disponibles aquí', async () => {
    renderCopilot();
    await order('guarda');
    const item = await lastOrder('nothing');
    expect(within(item).getByTestId('copilot-notes')).toHaveTextContent('Eso hay que hacerlo desde el editor.');
    await order('abre las plantillas');
    expect(within(await lastOrder('nothing')).getByTestId('copilot-notes')).toHaveTextContent(
      'Eso hay que hacerlo desde el editor.',
    );
  });
});

describe('copiloto por teclado: lo demás va a la IA', () => {
  it('una orden no frecuente llama a la IA con lo elegido y la página, y aplica sus operaciones de una vez', async () => {
    mocks.request.mockResolvedValue(
      answer([
        // Como las manda el servidor: las de siempre con sus campos; las nuevas, compactas.
        { op: 'add_text', target: null, text: 'Menú de otoño', style: 'subtitle', assetId: null, position: 'lower', align: null, color: null, font: null, blur: null },
        { op: 'resize_layer', target: 'titulo', steps: 1 },
        { op: 'set_effect', target: 'titulo', effect: 'shadow', on: true },
      ]),
    );
    const initial = documentWith({ pages: 2 });
    const { onApply } = renderCopilot({ initial, selectedIds: ['titulo', 'no-existe'] });
    await order('Pon debajo Menú de otoño, agranda el título y ponle sombra');
    const item = await lastOrder('applied');
    expect(item).toHaveAttribute('data-source', 'ai');
    expect(item).not.toHaveTextContent('Sin IA');

    expect(mocks.request).toHaveBeenCalledTimes(1);
    const [brandId, sent] = mocks.request.mock.calls[0] as [string, { transcript: string; document: Record<string, unknown>; assets: unknown[] }];
    expect(brandId).toBe('marca');
    expect(sent.transcript).toBe('Pon debajo Menú de otoño, agranda el título y ponle sombra');
    // Lo elegido (solo lo que existe en la página) y la página activa viajan en el resumen.
    expect(sent.document.selected).toEqual(['titulo']);
    expect(sent.document.page).toEqual({ index: 1, count: 2 });
    expect(sent.document.layers).toEqual([expect.objectContaining({ id: 'titulo', type: 'text', text: 'Menú del día' })]);
    expect(sent.assets).toEqual([]);
    expect(sent).not.toHaveProperty('mode');

    // Tres operaciones = una sola aplicación (un paso de deshacer en el editor).
    expect(onApply).toHaveBeenCalledTimes(1);
    const [document, touched, pageIndex] = onApply.mock.calls[0] as [ContentDocument, string[], number];
    const layers = document.pages[0]!.layers;
    expect(layers).toHaveLength(2);
    expect(layers[1]).toMatchObject({ type: 'text', text: 'Menú de otoño' });
    expect(titleOf(document)).toMatchObject({ fontSize: Math.round(80 * COPILOT_SIZE_STEP) });
    expect(titleOf(document).shadow).toBeDefined();
    expect([...touched].sort()).toEqual([layers[1]!.id, 'titulo'].sort());
    expect(pageIndex).toBe(0);
    const changes = within(item).getByTestId('copilot-changes');
    expect(within(changes).getAllByRole('listitem')).toHaveLength(3);
  });

  it('acciones del editor y flujos de foto que pide la IA llegan al editor; lo que este no puede, se dice', async () => {
    mocks.request.mockResolvedValue(
      answer([
        { op: 'photo_flow', action: 'remove_background' },
        { op: 'photo_flow', target: 'fondo', action: 'portrait' },
        { op: 'editor', action: 'save' },
        { op: 'editor', action: 'template' },
      ]),
    );
    const host = makeHost({
      photoFlow: vi.fn((flow: string) => (flow === 'portrait' ? 'Esa foto no se puede editar.' : null)),
    });
    const { onApply } = renderCopilot({ host, initial: documentWith({ photo: true }) });
    await order('Quítale el fondo a la foto, ponla en modo retrato, guarda y enséñame las plantillas');
    const item = await lastOrder('applied');
    expect(item).toHaveAttribute('data-source', 'ai');
    expect(host.photoFlow).toHaveBeenNthCalledWith(1, 'remove_background', 'fondo');
    expect(host.photoFlow).toHaveBeenNthCalledWith(2, 'portrait', 'fondo');
    expect(host.save).toHaveBeenCalledTimes(1);
    expect(host.openTemplates).toHaveBeenCalledTimes(1);
    const changes = within(item).getByTestId('copilot-changes');
    expect(changes).toHaveTextContent('Quitando el fondo de la foto…');
    expect(changes).toHaveTextContent('Guardando una versión…');
    expect(changes).toHaveTextContent('Abiertas las plantillas');
    expect(within(item).getByTestId('copilot-notes')).toHaveTextContent('Esa foto no se puede editar.');
    // Nada de esto cambia el documento.
    expect(onApply).not.toHaveBeenCalled();
  });

  it('sin editor detrás, lo que pide la IA al editor se dice como «hay que hacerlo desde el editor»', async () => {
    mocks.request.mockResolvedValue(
      answer([
        { op: 'photo_flow', action: 'edit' },
        { op: 'editor', action: 'save' },
        { op: 'editor', action: 'undo' },
      ]),
    );
    const { onApply } = renderCopilot({ initial: documentWith({ photo: true }) });
    await order('Edita la foto y guarda, y deshaz lo de antes');
    const item = await lastOrder('nothing');
    const notes = within(within(item).getByTestId('copilot-notes')).getAllByRole('listitem').map((note) => note.textContent);
    expect(notes).toEqual([
      // Sin cambios, se dice con todas las letras antes de los motivos.
      'No he cambiado nada.',
      'No hay nada que deshacer.',
      'Eso hay que hacerlo desde el editor.',
      'Eso hay que hacerlo desde el editor.',
    ]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('lo que descartó el servidor se enseña, la nota de la IA que dice haber hecho algo no; un texto no dictado no llega al diseño', async () => {
    mocks.request.mockResolvedValue(
      answer(
        [
          { op: 'add_text', target: null, text: 'APROBADO Y PUBLICADO', style: 'title', assetId: null, position: null, align: null, color: null, font: null, blur: null },
          { op: 'style_layer', target: 'titulo', opacity: 50 },
        ],
        { note: 'He bajado la opacidad del título.', discarded: [{ index: 2, op: 'publish', reason: 'La IA ha pedido una operación que no existe.' }] },
      ),
    );
    const { onApply } = renderCopilot();
    await order('Baja la opacidad del título a la mitad y publícalo');
    const item = await lastOrder('applied');
    const notes = within(item).getByTestId('copilot-notes');
    // Lo hecho lo cuenta el editor con lo que de verdad ha aplicado, no la nota de la IA (fallo 6 de la prueba real).
    expect(notes).not.toHaveTextContent('He bajado la opacidad del título.');
    expect(within(item).getByTestId('copilot-changes')).toHaveTextContent('opacidad');
    expect(notes).toHaveTextContent('La IA ha pedido una operación que no existe.');
    expect(notes).toHaveTextContent('Se ha quitado un texto que no estaba en lo dictado: el copiloto no redacta.');
    const [document] = onApply.mock.calls[0] as [ContentDocument];
    expect(document.pages[0]!.layers).toHaveLength(1);
    expect(titleOf(document).opacity).toBe(0.5);
    expect(JSON.stringify(document)).not.toContain('APROBADO');
  });

  it('pregunta de la IA sin operaciones: «Sin cambios», con la pregunta a la vista', async () => {
    mocks.request.mockResolvedValue(answer([], { note: '¿Qué texto es el subtítulo?' }));
    const { onApply } = renderCopilot();
    await order('Pon el subtítulo en granate');
    const item = await lastOrder('nothing');
    expect(item).toHaveTextContent('Sin cambios');
    expect(within(item).getByTestId('copilot-notes')).toHaveTextContent('¿Qué texto es el subtítulo?');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('respuesta no válida de la IA: «No aplicada» y no cambia nada', async () => {
    const { onApply } = renderCopilot();
    for (const bad of [
      answer([{ op: 'publish' }]),
      answer([{ op: 'style_layer', target: 'titulo', opacity: 50, approve: true }]),
      answer([{ op: 'resize_layer', target: 'titulo', steps: 40 }]),
      { ...answer([]), status: 'approved' },
      { action: 'editor.copilot' },
      null,
    ]) {
      mocks.request.mockResolvedValueOnce(bad);
      await order('Haz algo que no es de las frecuentes con el título');
      const item = await lastOrder('failed');
      expect(item).toHaveTextContent('No aplicada');
      expect(item).toHaveAttribute('data-source', 'ai');
      expect(within(item).getByTestId('copilot-notes')).toHaveTextContent(
        'La respuesta de la IA no es válida: no se ha cambiado nada.',
      );
    }
    expect(onApply).not.toHaveBeenCalled();
  });

  it('si la IA falla, la orden queda «No aplicada» con el error, y la siguiente orden sigue funcionando', async () => {
    mocks.request.mockRejectedValueOnce(new Error('sin red'));
    const { onApply } = renderCopilot({ selectedIds: ['titulo'] });
    await order('Pon el título en un sitio mejor para esta foto');
    const item = await lastOrder('failed');
    expect(within(item).getByRole('alert')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await order('más grande');
    await lastOrder('applied');
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('una operación sobre una capa que ya no existe se salta y se dice; el resto de la orden se aplica', async () => {
    mocks.request.mockResolvedValue(
      answer([
        { op: 'style_layer', target: 'no-existe', opacity: 10 },
        { op: 'style_layer', target: 'titulo', rotation: 15 },
      ]),
    );
    const { onApply } = renderCopilot();
    await order('Gira un poco el título y baja la opacidad de la estrella');
    const item = await lastOrder('applied');
    expect(within(item).getByTestId('copilot-notes')).toHaveTextContent('No se encuentra la capa que hay que cambiar.');
    expect(titleOf((onApply.mock.calls[0] as [ContentDocument])[0]).rotation).toBe(15);
  });
});
