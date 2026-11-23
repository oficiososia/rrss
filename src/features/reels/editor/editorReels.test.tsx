import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chooseMoreAction, openMoreMenu } from '@/test/moreMenu';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ContentVersionRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { buildReelLikeResult, parseMeasurement } from '../../../../supabase/functions/_shared/reels/like';
import { buildRenderRequest, parseProject } from './project';

// Editor de reels en una pieza de formato reel: línea de tiempo (ordenar
// arrastrando, recortar por los extremos, deshacer y rehacer), guardado como
// versión, música con su licencia, subtítulos con su interruptor y montaje
// unido a la pieza. La vista previa dibuja en un lienzo, que jsdom no tiene:
// aquí se comprueba el resto.

const EDITOR = `${BRAND_BASE}/contenidos/reel-1`;
const path = (name: string) => `${ORG_ID}/${BRAND_ID}/media/${name}`;

beforeAll(() => {
  // jsdom no trae PointerEvent: un MouseEvent con el mismo nombre basta para estas pruebas.
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerType = 'mouse';
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const asset = (id: string, kind: string, fileName: string, mime: string, durationMs: number | null = null) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind,
  origin: 'upload',
  storage_path: path(fileName),
  file_name: fileName,
  mime_type: mime,
  bytes: 1000,
  width: null,
  height: null,
  duration_ms: durationMs,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: null,
  created_by: null,
  created_at: `2026-11-18T09:00:0${id.length % 10}Z`,
  updated_at: '2026-11-18T09:00:00Z',
});

const STYLE = {
  sizeRatio: 0.06,
  color: '#FFFFFF',
  marginRatio: 0.2,
  maxWidthRatio: 0.84,
  lineHeight: 1.3,
  box: null,
  outline: null,
  fadeSeconds: 0.25,
};

/** La carga de un montaje como la guarda la base de datos: el estilo, el plan y la pieza. */
const renderPayload = (data: unknown, version = 1) =>
  buildRenderRequest(parseProject(data), { id: 'reel-1', version }) as Record<string, unknown>;

const project = {
  kind: 'reel',
  template: { id: 'fundido-suave' },
  plan: {
    version: 2,
    clips: [
      { id: 'c1', type: 'photo', path: path('plato.jpg'), seconds: 2 },
      {
        id: 'c2',
        type: 'video',
        path: path('cocina.mp4'),
        in: 0.5,
        out: 3.5,
        volume: 0.6,
        transition: { type: 'fade', seconds: 0.5 },
        subtitles: [{ start: 1, end: 2, text: 'Hola desde la cocina' }],
      },
      { id: 'c3', type: 'photo', path: path('local.jpg'), seconds: 2, transition: { type: 'cut', seconds: 0 } },
    ],
    texts: [{ id: 't1', text: 'Menú del día', start: 0, end: 2, position: 'top', style: STYLE }],
    subtitles: { enabled: true, position: 'bottom', style: STYLE },
  },
};

function seed(
  options: { status?: ContentItemRow['status']; data?: unknown; version?: number; workMode?: 'self' | 'agency' } = {},
) {
  seedWorkspace({ orgRole: 'owner', workMode: options.workMode });
  const item: ContentItemRow = {
    id: 'reel-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Reel de la semana',
    network: 'instagram',
    format: 'reel',
    status: options.status ?? 'draft',
    current_version: options.version ?? 1,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  } as ContentItemRow;
  const version = {
    id: 'v-1',
    content_id: 'reel-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: options.version ?? 1,
    schema_version: 2,
    data: options.data ?? project,
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  } as unknown as ContentVersionRow;
  fake.tables.content_items = [item];
  fake.tables.content_versions = options.version === 0 ? [] : [version];
  fake.tables.media_assets = [
    asset('foto-1', 'image', 'plato.jpg', 'image/jpeg'),
    asset('foto-2', 'image', 'local.jpg', 'image/jpeg'),
    asset('clip-1', 'video', 'cocina.mp4', 'video/mp4', 6000),
    asset('audio-1', 'audio', 'musica.m4a', 'audio/mp4'),
  ];
  fake.tables.jobs = [];
  fake.tables.reel_drafts = [];
  fake.tables.brand_fonts = [];
  // Borrador automático: una fila por pieza, como en la base de datos.
  fake.rpc('save_reel_draft', (args) => {
    fake.tables.reel_drafts = [
      {
        content_id: args.p_content_id,
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        data: structuredClone(args.p_data),
        base_version: args.p_base_version,
        updated_by: ME.id,
        updated_at: '2026-11-22T12:00:00Z',
      },
    ];
    return '2026-11-22T12:00:00Z';
  });
  fake.rpc('discard_reel_draft', () => {
    fake.tables.reel_drafts = [];
    return null;
  });
  fake.rpc('brand_reel_font_info', () => []);
  fake.rpc('save_content_version', (args) => {
    const row = {
      ...version,
      id: `v-${Number(args.p_expected_version) + 1}`,
      version: Number(args.p_expected_version) + 1,
      data: args.p_data,
    };
    fake.tables.content_versions!.push(row);
    // Como el disparador de la base de datos: una versión guardada borra el borrador.
    fake.tables.reel_drafts = [];
    return row;
  });
}

/**
 * Con la máquina cargada, el editor (que se carga aparte) y las respuestas simuladas pueden tardar más
 * de un segundo: se espera a lo que de verdad hace falta, con este tope, y nunca un tiempo fijo.
 */
const SLOW = { timeout: 10_000 };

async function open() {
  const app = renderApp(EDITOR);
  await screen.findByTestId('reel-editor', {}, SLOW);
  return app;
}

/** «⋯ → Historial → Marcar esta versión» (lo que antes era «Guardar versión» en la cabecera). */
async function markVersion() {
  const user = userEvent.setup();
  await chooseMoreAction(user, 'reel-more', 'reel-history');
  fireEvent.click(await screen.findByTestId('reel-save'));
  const dialog = await screen.findByRole('dialog', { name: /Guardar/ });
  fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));
}
/** Pulsa una herramienta del «Más» (⋯) de la barra. */
const chooseBarMore = (testId: string) => chooseMoreAction(userEvent.setup(), 'reel-bar-more', testId);
/** Lo que el guardado automático dice que está pasando. */
const autosaveState = () => screen.getByTestId('reel-autosave').getAttribute('data-state');

const clipLabels = () =>
  screen.getAllByTestId('reel-clip').map((c) => within(c).getAllByRole('button')[0]!.getAttribute('aria-label'));
const clipButton = (index: number) => within(screen.getAllByTestId('reel-clip')[index]!).getAllByRole('button')[0]!;
const barLabels = () =>
  within(screen.getByTestId('reel-toolbar'))
    .getAllByRole('button')
    .filter((b) => !['reel-bar-back', 'reel-bar-more'].includes(b.getAttribute('data-testid') ?? ''))
    .map((b) => b.textContent);
/** Lo que va en el «Más» de la barra (lo dice su nombre accesible). */
const barMore = () => screen.queryByTestId('reel-bar-more')?.getAttribute('aria-label') ?? null;
/** Lleva el cabezal al segundo `t` tocando la regla (60 px por segundo). */
const seekTo = (t: number) => fireEvent.click(screen.getByTestId('reel-ruler'), { clientX: t * 60 });
const draftCalls = () => fake.callsTo('save_reel_draft', 'rpc');
const savedDraft = () =>
  draftCalls().at(-1)!.payload as { p_content_id: string; p_base_version: number; p_data: typeof project };

describe('editor de reels', () => {
  it('una pieza de formato reel se abre en el editor de reels con su línea de tiempo y sus pistas', async () => {
    seed();
    await open();
    expect(clipLabels()).toEqual(['1. Foto plato.jpg, 2 s', '2. Clip cocina.mp4, 3 s', '3. Foto local.jpg, 2 s']);
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(1);
    expect(screen.getAllByTestId('reel-cue-block').map((c) => c.textContent)).toEqual(['Hola desde la cocina']);
    // 2 + 3 + 2 − 0,5 de fundido.
    expect(screen.getByTestId('reel-duration')).toHaveTextContent('6,5 s de 90 s como máximo');
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Guardado');
    expect(screen.getByTestId('reel-preview')).toBeInTheDocument();
    // Cabecera mínima: volver, nombre, guardado, deshacer y rehacer, «⋯» y un único «Exportar».
    expect(within(screen.getByTestId('page-actions')).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Deshacer',
      'Rehacer',
      'Más acciones del reel',
      'Exportar',
    ]);
  });

  it('se ordena arrastrando un elemento y se deshace y rehace', async () => {
    seed();
    await open();
    const first = within(screen.getAllByTestId('reel-clip')[0]!).getAllByRole('button')[0]!;
    // Zoom por defecto: 60 px por segundo. Se suelta pasado el final (6,5 s → 390 px).
    fireEvent.pointerDown(first, { clientX: 20, button: 0 });
    fireEvent.pointerMove(window, { clientX: 200 });
    fireEvent.pointerMove(window, { clientX: 420 });
    fireEvent.pointerUp(window, { clientX: 420 });
    await waitFor(() => expect(clipLabels()[2]).toBe('3. Foto plato.jpg, 2 s'));
    expect(clipLabels()[0]).toBe('1. Clip cocina.mp4, 3 s');
    expect(autosaveState()).toBe('pending');

    fireEvent.click(screen.getByTestId('reel-undo'));
    expect(clipLabels()[0]).toBe('1. Foto plato.jpg, 2 s');
    fireEvent.click(screen.getByTestId('reel-redo'));
    expect(clipLabels()[0]).toBe('1. Clip cocina.mp4, 3 s');
    // Con el teclado: Alt + flecha mueve el elemento con el foco.
    const nowFirst = within(screen.getAllByTestId('reel-clip')[0]!).getAllByRole('button')[0]!;
    fireEvent.keyDown(nowFirst, { key: 'ArrowRight', altKey: true });
    expect(clipLabels()[1]).toBe('2. Clip cocina.mp4, 3 s');
  });

  it('recorta el final de un clip arrastrando su extremo, en un solo paso de deshacer', async () => {
    seed();
    await open();
    // Las asas salen en el clip elegido.
    fireEvent.click(clipButton(1));
    const clip = screen.getAllByTestId('reel-clip')[1]!;
    const handle = within(clip).getByTestId('reel-handle-end');
    // −1 s a 60 px por segundo, en varios movimientos.
    fireEvent.pointerDown(handle, { clientX: 300, button: 0 });
    fireEvent.pointerMove(window, { clientX: 270 });
    fireEvent.pointerMove(window, { clientX: 240 });
    fireEvent.pointerUp(window, { clientX: 240 });
    await waitFor(() => expect(clipLabels()[1]).toBe('2. Clip cocina.mp4, 2 s'));
    expect(screen.getByTestId('reel-clip-out')).toHaveValue(2.5);
    // El principio, con el campo exacto del panel.
    fireEvent.change(screen.getByTestId('reel-clip-in'), { target: { value: '1' } });
    expect(clipLabels()[1]).toBe('2. Clip cocina.mp4, 1,5 s');
    fireEvent.click(screen.getByTestId('reel-undo'));
    expect(clipLabels()[1]).toBe('2. Clip cocina.mp4, 2 s');
    fireEvent.click(screen.getByTestId('reel-undo'));
    expect(clipLabels()[1]).toBe('2. Clip cocina.mp4, 3 s');
  });

  it('guarda el montaje como versión nueva de la pieza (⋯ → Historial → Marcar esta versión)', async () => {
    seed();
    await open();
    fireEvent.click(within(screen.getAllByTestId('reel-clip')[0]!).getAllByRole('button')[0]!);
    fireEvent.change(screen.getByTestId('reel-photo-seconds'), { target: { value: '3' } });
    await markVersion();
    expect(await screen.findByText('Versión 2 guardada.')).toBeInTheDocument();
    const call = fake.callsTo('save_content_version', 'rpc')[0]!.payload as Record<string, unknown>;
    expect(call).toMatchObject({ p_content_id: 'reel-1', p_schema_version: 2, p_expected_version: 1 });
    const data = call.p_data as { kind: string; plan: { version: number; clips: unknown[] } };
    expect(data).toMatchObject({ kind: 'reel', plan: { version: 2 } });
    expect(data.plan.clips[0]).toMatchObject({ id: 'c1', seconds: 3 });
  });

  it('la música exige confirmar la licencia y queda con su volumen y entrada y salida suaves', async () => {
    seed();
    await open();
    fireEvent.click(screen.getByTestId('reel-bar-music'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('reel-music-license')).toHaveTextContent(/responsabilidad de la marca/);
    fireEvent.change(within(dialog).getByTestId('reel-music-choice'), { target: { value: 'audio-1' } });
    expect(within(dialog).getByTestId('reel-music-add')).toBeDisabled();
    fireEvent.click(within(dialog).getByTestId('reel-music-confirm'));
    fireEvent.click(within(dialog).getByTestId('reel-music-add'));
    await screen.findByTestId('reel-inspector-music');
    expect(screen.getByTestId('reel-music-block')).toHaveTextContent('musica.m4a');
    expect(screen.getByTestId('reel-inspector-music')).toHaveTextContent('Licencia confirmada por la marca');
  });

  it('subtítulos: se corrigen a mano y el botón automático sale solo con su interruptor', async () => {
    seed();
    await open();
    fireEvent.click(within(screen.getAllByTestId('reel-clip')[1]!).getAllByRole('button')[0]!);
    expect(screen.queryByTestId('reel-auto-subtitles')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('reel-cue-text'), { target: { value: 'Hola desde el obrador' } });
    expect(screen.getAllByTestId('reel-cue-block').map((c) => c.textContent)).toEqual(['Hola desde el obrador']);
  });

  it('con el interruptor y OpenAI en el servidor, ofrece los subtítulos automáticos con su coste', async () => {
    vi.stubEnv('VITE_REEL_SUBTITLES_ENABLED', 'true');
    seed();
    fake.fn('ai-transcribe', () => ({ status: 200, body: { available: true, microsPerSecond: 100 } }));
    await open();
    fireEvent.click(within(screen.getAllByTestId('reel-clip')[1]!).getAllByRole('button')[0]!);
    fireEvent.click(await screen.findByTestId('reel-auto-subtitles'));
    expect(await screen.findByTestId('reel-auto-subtitles-cost')).toHaveTextContent('Tramo de 3 s');
  });

  it('«Exportar» monta la versión guardada unida a la pieza y, mientras se monta, no encarga otro', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seed();
    fake.rpc('request_media_job', (args) => {
      const job = {
        id: 'job-1',
        organization_id: ORG_ID,
        brand_id: BRAND_ID,
        kind: 'media.reel.template',
        payload: args.p_input,
        status: 'queued',
        attempts: 0,
        max_attempts: 3,
        last_error: null,
        result: null,
        created_at: '2026-11-21T10:00:00Z',
      };
      fake.tables.jobs!.push(job);
      return job;
    });
    await open();
    fireEvent.click(screen.getByTestId('reel-export'));
    await waitFor(() => expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(1));
    // Sin cambios: no hace falta guardar otra versión.
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(0);
    const input = (fake.callsTo('request_media_job', 'rpc')[0]!.payload as { p_input: Record<string, unknown> })
      .p_input;
    expect(input).toMatchObject({
      template: { id: 'fundido-suave' },
      content: { id: 'reel-1', version: 1 },
      plan: { version: 2 },
    });
    const sheet = screen.getByTestId('reel-export-sheet');
    await waitFor(() => expect(within(sheet).getByTestId('reel-render-state')).toHaveTextContent(/puedes cerrar esto y seguir editando/i));
    // Las tres salidas esperan al vídeo.
    expect(within(sheet).getByTestId('reel-export-download')).toBeDisabled();
    expect(within(sheet).getByTestId('reel-export-publish')).toBeDisabled();

    // Volver a pulsar «Exportar» mientras se monta no encarga otro.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByTestId('reel-export'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(1);
  });

  it('con cambios, «Exportar» guarda la versión nueva y la monta en un solo paso', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seed();
    fake.rpc('request_media_job', (args) => ({
      id: 'job-2',
      organization_id: ORG_ID,
      brand_id: BRAND_ID,
      kind: 'media.reel.template',
      payload: args.p_input,
      status: 'queued',
      attempts: 0,
      max_attempts: 3,
      last_error: null,
      result: null,
      created_at: '2026-11-21T10:00:00Z',
    }));
    await open();
    fireEvent.click(screen.getByTestId('reel-bar-text'));
    fireEvent.click(screen.getByTestId('reel-export'));
    await waitFor(() => expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1);
    const input = (fake.callsTo('request_media_job', 'rpc')[0]!.payload as { p_input: Record<string, unknown> })
      .p_input;
    expect(input).toMatchObject({ content: { id: 'reel-1', version: 2 } });
  });

  it('la hoja «Exportar» dice cómo va el vídeo: listo (descargar, biblioteca, publicar), fallo o montándose', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seed();
    const job = (status: string, extra: Record<string, unknown> = {}) => ({
      id: `job-${status}`,
      organization_id: ORG_ID,
      brand_id: BRAND_ID,
      kind: 'media.reel.template',
      payload: renderPayload(project),
      status,
      attempts: 1,
      max_attempts: 3,
      last_error: null,
      result: null,
      created_at: '2026-11-21T10:00:00Z',
      ...extra,
    });
    fake.tables.jobs = [job('succeeded', { result: { assets: [{ id: 'asset-9' }] } })];
    fake.tables.media_assets!.push({
      ...asset('asset-9', 'video', 'reel-final.mp4', 'video/mp4', 6500),
      storage_path: path('reels/reel-final.mp4'),
    });
    fake.rpc('request_media_job', () => {
      throw new Error('no debería montarse');
    });
    const first = await open();
    fireEvent.click(screen.getByTestId('reel-export'));
    const sheet = await screen.findByTestId('reel-export-sheet');
    // Ya está montado: no se monta otra vez.
    expect(within(sheet).getByTestId('reel-render-state')).toHaveTextContent('El vídeo está montado');
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(0);
    expect(within(sheet).getByTestId('reel-viewer')).toBeInTheDocument();
    expect(within(sheet).getByTestId('reel-export-library')).toHaveAttribute(
      'href',
      expect.stringContaining('recurso=asset-9'),
    );
    expect(within(sheet).getByTestId('reel-export-publish')).toHaveTextContent('Publicar o programar');
    first.unmount();

    fake.tables.jobs = [job('failed', { last_error: 'Sin espacio' })];
    const second = await open();
    fireEvent.click(screen.getByTestId('reel-export'));
    expect(await screen.findByText(/No se pudo montar: Sin espacio/)).toBeInTheDocument();
    // Un fallo no se repite solo: se ofrece probar otra vez.
    expect(screen.getByTestId('reel-render')).toHaveTextContent('Probar otra vez');
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(0);
    second.unmount();

    fake.tables.jobs = [job('running')];
    await open();
    fireEvent.click(screen.getByTestId('reel-export'));
    await waitFor(() => expect(screen.getByTestId('reel-render-state')).toHaveTextContent(/seguir editando/));
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(0);
  });

  it('un reel vacío ofrece empezar en un paso: estilo, texto de apertura y varias fotos en el orden elegido', async () => {
    seed({ data: { schemaVersion: 4, canvas: {}, pages: [] } });
    await open();
    expect(screen.getAllByTestId('reel-template-card').length).toBeGreaterThanOrEqual(3);
    fireEvent.click(screen.getByRole('radio', { name: /Corte rítmico/ }));
    fireEvent.change(screen.getByTestId('reel-starter-text'), { target: { value: 'Menú de otoño' } });
    fireEvent.click(screen.getByTestId('reel-starter-pick'));
    const dialog = await screen.findByRole('dialog');
    // Se eligen la segunda foto y después la primera: entran en ese orden.
    fireEvent.click(within(dialog).getByRole('button', { name: /«local.jpg»/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /«plato.jpg»/ }));
    expect(
      within(dialog)
        .getAllByTestId('reel-media-order')
        .map((n) => n.textContent),
    ).toEqual(['2', '1']);
    expect(within(dialog).getByTestId('reel-media-count')).toHaveTextContent('2 elegidas');
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() => expect(clipLabels()).toEqual(['1. Foto local.jpg, 1,5 s', '2. Foto plato.jpg, 1,5 s']));
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(1);
  });

  it('con plantillas de reel de la marca: se elige una, pide el material de sus planos y deja el reel montado', async () => {
    seed({ data: { schemaVersion: 4, canvas: {}, pages: [] } });
    const row = (key: string, name: string, document: unknown) => ({
      id: `plantilla-${key}`,
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      template_key: key,
      name,
      source: 'catalog',
      document,
    });
    fake.tables.brand_reel_templates = [
      row('asi-se-hace', 'Así se hace', {
        kind: 'rrss.reel-template',
        schemaVersion: 1,
        purpose: 'Enseñar un producto con el resultado como gancho.',
        whenToUse: 'Para el producto estrella.',
        material: '2 a 3 fotos o clips: resultado, proceso y cierre.',
        style: { id: 'corte-ritmico' },
        slots: [
          { id: 'resultado', label: 'Resultado', kind: 'any', seconds: 1.8, motion: 'zoom-in', motionAmount: 0.15 },
          { id: 'proceso', label: 'Proceso', kind: 'video', seconds: 2, volume: 0.7, optional: true },
          { id: 'final', label: 'Cierre', kind: 'any', seconds: 3, transition: { type: 'fade', seconds: 0.3 } },
        ],
        texts: [
          {
            id: 'gancho',
            role: 'hook',
            text: 'Así se hace',
            from: 'resultado',
            position: 'center',
            animation: { in: 'zoom', out: 'fade' },
          },
          {
            id: 'cierre',
            role: 'cta',
            text: 'Ven a probarlo',
            from: 'final',
            offset: 0.4,
            position: 'bottom',
            style: { marginRatio: 0.37 },
          },
        ],
        music: { suggestion: 'Instrumental con el pulso marcado.' },
        cover: { slot: 'resultado', offset: 0.9 },
      }),
      // Una fila que la aplicación no sabe montar (estilo que no existe) no se ofrece.
      row('rota', 'Rota', { kind: 'rrss.reel-template', schemaVersion: 1, style: { id: 'no-existe' }, slots: [] }),
    ];
    await open();
    const cards = await screen.findAllByTestId('reel-brand-template');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent('Así se hace');
    expect(cards[0]).toHaveTextContent('Necesita: 2 a 3 fotos o clips · unos 6,8 s');
    expect(cards[0]).toHaveTextContent('Instrumental con el pulso marcado.');
    // Los tres pasos de siempre siguen debajo.
    expect(screen.getByTestId('reel-starter-pick')).toBeInTheDocument();

    fireEvent.click(cards[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('reel-media-guide')).toHaveTextContent('1. Resultado2. Proceso3. Cierre');
    fireEvent.click(within(dialog).getByRole('button', { name: /«plato.jpg»/ }));
    expect(within(dialog).getByTestId('reel-media-count')).toHaveTextContent('faltan 1 para la plantilla entera');
    fireEvent.click(within(dialog).getByRole('button', { name: /«cocina.mp4»/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /«local.jpg»/ }));
    expect(within(dialog).getByTestId('reel-media-count')).toHaveTextContent('3 elegidas (todos los planos)');
    expect(within(dialog).getByTestId('reel-media-confirm')).toHaveTextContent('Montar el reel con 3');
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));

    // Cada pieza en su plano, con la duración de la plantilla, los dos textos de muestra y, en el plano que
    // no tiene texto, su rótulo sacado del nombre del archivo (docs/reels-calidad.md).
    await waitFor(() =>
      expect(clipLabels()).toEqual(['1. Foto plato.jpg, 1,8 s', '2. Clip cocina.mp4, 2 s', '3. Foto local.jpg, 3 s']),
    );
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual([
      'Así se hace',
      'Cocina',
      'Ven a probarlo',
    ]);
    expect(await screen.findByText(/Reel montado con «Así se hace»/)).toBeInTheDocument();

    // Se guarda como un reel normal: plan v2 sobre el estilo de la plantilla, con portada y sin música.
    await markVersion();
    await waitFor(() => expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1));
    const saved = fake.callsTo('save_content_version', 'rpc')[0]!.payload as {
      p_data: {
        template: { id: string };
        plan: {
          clips: unknown[];
          cover: unknown;
          music?: unknown;
          outro?: unknown;
          texts: Array<{ text: string; role?: string; style: { marginRatio: number } }>;
        };
      };
    };
    expect(saved.p_data.template).toEqual({ id: 'corte-ritmico' });
    expect(saved.p_data.plan.clips).toHaveLength(3);
    expect(saved.p_data.plan.cover).toEqual({ type: 'frame', at: 0.9 });
    expect(saved.p_data.plan.music).toBeUndefined();
    // Cada texto lleva su papel (el trabajador le da su tamaño mínimo y su animación); la llamada conserva su sitio.
    expect(saved.p_data.plan.texts.map((t) => [t.text, t.role])).toEqual([
      ['Así se hace', 'headline'],
      ['Cocina', 'label'],
      ['Ven a probarlo', 'cta'],
    ]);
    expect(saved.p_data.plan.texts[2]!.style.marginRatio).toBe(0.37);
    // Sin perfil de la marca no hay cierre (no hay logotipo, usuario ni colores que poner).
    expect(saved.p_data.plan.outro).toBeUndefined();
  });

  it('el selector filtra por fotos y vídeos', async () => {
    seed();
    await open();
    fireEvent.click(screen.getByTestId('reel-bar-add'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByTestId('reel-media-option')).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vídeos' }));
    expect(within(dialog).getAllByTestId('reel-media-option')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fotos' }));
    expect(within(dialog).getAllByTestId('reel-media-option')).toHaveLength(2);
  });

  it('se archiva desde el menú «⋯» y las zonas de Instagram se enseñan y se ocultan', async () => {
    seed();
    fake.tables.content_items![0] = { ...fake.tables.content_items![0]!, archived_at: null };
    await open();
    const user = userEvent.setup();
    // Las zonas que tapa Instagram se encienden y apagan desde «⋯» (y salen solas al arrastrar un texto).
    expect(screen.queryByTestId('reel-safe-zones')).not.toBeInTheDocument();
    await chooseMoreAction(user, 'reel-more', 'reel-safe-toggle');
    expect(screen.getByTestId('reel-safe-zones')).toBeInTheDocument();
    await chooseMoreAction(user, 'reel-more', 'reel-safe-toggle');
    expect(screen.queryByTestId('reel-safe-zones')).not.toBeInTheDocument();

    fake.rpc('archive_content_item', (args) => ({
      ...fake.tables.content_items![0]!,
      archived_at: args.p_archived ? '2026-11-21T10:00:00Z' : null,
    }));
    await chooseMoreAction(user, 'reel-more', 'reel-archive');
    await user.click(await screen.findByTestId('confirm-action'));
    await waitFor(() => expect(fake.callsTo('archive_content_item', 'rpc')).toHaveLength(1));
  });

  it('una pieza reel con un diseño por capas avisa y empieza un montaje vacío', async () => {
    seed({ data: { schemaVersion: 4, canvas: {}, pages: [] } });
    await open();
    expect(screen.getByText(/es un diseño por capas/)).toBeInTheDocument();
    expect(screen.getByText('Empieza tu reel en tres pasos')).toBeInTheDocument();
  });
});

describe('editor de reels: barra de herramientas según lo elegido', () => {
  it('sin nada elegido ofrece añadir; con un clip, sus herramientas; con un texto, las del texto; «volver» lo suelta', async () => {
    seed();
    await open();
    const bar = screen.getByTestId('reel-toolbar');
    expect(bar).toHaveAttribute('data-kind', 'none');
    expect(bar).toHaveAccessibleName('Añadir al reel');
    expect(barLabels()).toEqual(['Añadir', 'Texto', 'Música', 'Subtítulos', 'Estilo']);
    expect(barMore()).toBeNull();

    fireEvent.click(clipButton(1));
    expect(bar).toHaveAttribute('data-kind', 'clip');
    expect(barLabels()).toEqual(['Dividir', 'Duración', 'Velocidad', 'Filtro', 'Sustituir']);
    expect(barMore()).toBe('Más: volumen, silenciar, subtítulos, duplicar, borrar');
    // Una foto: movimiento de cámara en lugar de velocidad.
    fireEvent.click(clipButton(0));
    expect(barLabels()).toEqual(['Dividir', 'Duración', 'Movimiento', 'Filtro', 'Sustituir']);
    expect(barMore()).toBe('Más: duplicar, borrar');

    fireEvent.click(within(screen.getByTestId('reel-text-block')).getAllByRole('button')[0]!);
    expect(bar).toHaveAttribute('data-kind', 'text');
    expect(barLabels()).toEqual(['Editar', 'Estilo', 'Animación', 'Duración']);
    expect(barMore()).toBe('Más: duplicar, borrar');

    fireEvent.click(screen.getByTestId('reel-bar-back'));
    expect(bar).toHaveAttribute('data-kind', 'none');
    // Esc también suelta lo elegido.
    fireEvent.click(clipButton(0));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(bar).toHaveAttribute('data-kind', 'none');
  });

  it('cada herramienta abre solo su ajuste (panel al lado o hoja en móvil) y «Listo» lo cierra', async () => {
    seed();
    await open();
    const panel = screen.getByTestId('reel-panel');
    expect(panel).toHaveAttribute('data-open', 'false');
    // Elegir un clip cambia la barra, pero no abre nada todavía.
    fireEvent.click(clipButton(1));
    expect(panel).toHaveAttribute('data-open', 'false');
    fireEvent.click(screen.getByTestId('reel-bar-speed'));
    expect(panel).toHaveAttribute('data-open', 'true');
    expect(panel).toHaveAccessibleName('Velocidad');
    expect(screen.getByTestId('reel-bar-speed')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByTestId('reel-speed')).toBeInTheDocument();
    // Solo su sección: las demás del clip están ocultas.
    const sections = within(panel)
      .getAllByRole('heading', { level: 3 })
      .filter((h) => !h.closest('section')!.classList.contains('hidden'))
      .map((h) => h.textContent);
    expect(sections).toEqual(['Velocidad']);
    fireEvent.click(screen.getByTestId('reel-panel-close'));
    expect(panel).toHaveAttribute('data-open', 'false');
    // «Subtítulos», sin nada elegido: los subtítulos y su estilo.
    fireEvent.click(screen.getByTestId('reel-bar-back'));
    fireEvent.click(screen.getByTestId('reel-bar-subtitles'));
    expect(panel).toHaveAttribute('data-open', 'true');
    expect(within(panel).getByTestId('reel-inspector-subtitles')).toBeInTheDocument();
  });
});

describe('editor de reels: dividir, sustituir, duplicar y borrar', () => {
  it('divide el clip en el cabezal con el botón y con la tecla S, y se deshace', async () => {
    seed();
    await open();
    // El clip va de 1,5 a 4,5 s del reel (tramo 0,5–3,5 del archivo). Cabezal en el segundo 3.
    fireEvent.click(clipButton(1));
    seekTo(3);
    fireEvent.click(screen.getByTestId('reel-bar-split'));
    expect(clipLabels()).toEqual([
      '1. Foto plato.jpg, 2 s',
      '2. Clip cocina.mp4, 1,5 s',
      '3. Clip cocina.mp4, 1,5 s',
      '4. Foto local.jpg, 2 s',
    ]);
    // El reel dura lo mismo y queda elegida la segunda parte.
    expect(screen.getByTestId('reel-duration')).toHaveTextContent('6,5 s de 90 s');
    expect(clipButton(2)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('reel-clip-in')).toHaveValue(2);
    expect(screen.getByTestId('reel-clip-out')).toHaveValue(3.5);
    // Entre las dos partes, corte seco.
    expect(screen.getAllByTestId('reel-transition')[1]).toHaveAccessibleName('Transición entre 2 y 3: corte seco');

    // Con el teclado: S divide lo que se ve en el cabezal (la foto del principio, en su segundo 1).
    fireEvent.click(screen.getByTestId('reel-bar-back'));
    seekTo(1);
    fireEvent.keyDown(document.body, { key: 's' });
    expect(clipLabels().slice(0, 2)).toEqual(['1. Foto plato.jpg, 1 s', '2. Foto plato.jpg, 1 s']);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(clipLabels()).toEqual(['1. Foto plato.jpg, 2 s', '2. Clip cocina.mp4, 3 s', '3. Foto local.jpg, 2 s']);
    // Demasiado cerca del borde no se divide (y se explica).
    seekTo(0.2);
    fireEvent.keyDown(document.body, { key: 's' });
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
    expect(await screen.findByText(/lleva el cabezal dentro del clip/)).toBeInTheDocument();
  });

  it('sustituye un elemento por otro archivo conservando su sitio, su duración y su transición', async () => {
    seed();
    await open();
    fireEvent.click(clipButton(2));
    fireEvent.click(screen.getByTestId('reel-bar-replace'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Sustituir por otra foto o clip');
    expect(dialog).toHaveTextContent('«local.jpg»');
    fireEvent.click(within(dialog).getByRole('button', { name: /«plato.jpg»/ }));
    // Solo una: es un cambio por otra.
    fireEvent.click(within(dialog).getByRole('button', { name: /«cocina.mp4»/ }));
    expect(within(dialog).getByTestId('reel-media-count')).toHaveTextContent('1 elegida');
    expect(within(dialog).getByTestId('reel-media-confirm')).toHaveTextContent('Sustituir');
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() => expect(clipLabels()[2]).toBe('3. Foto plato.jpg, 2 s'));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
    expect(screen.getAllByTestId('reel-transition')[1]).toHaveAccessibleName('Transición entre 2 y 3: corte seco');
  });

  it('duplica con Ctrl+D y con el botón, y borra con Supr y con el botón', async () => {
    seed();
    await open();
    fireEvent.click(clipButton(0));
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
    expect(clipLabels().slice(0, 2)).toEqual(['1. Foto plato.jpg, 2 s', '2. Foto plato.jpg, 2 s']);
    // La copia queda elegida: Supr la borra.
    expect(clipButton(1)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
    // Los textos, igual.
    fireEvent.click(within(screen.getByTestId('reel-text-block')).getAllByRole('button')[0]!);
    await chooseBarMore('reel-bar-duplicate');
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(2);
    await chooseBarMore('reel-bar-delete');
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(1);
    // Escribiendo en un campo, las teclas son del campo.
    fireEvent.click(within(screen.getByTestId('reel-text-block')).getAllByRole('button')[0]!);
    fireEvent.keyDown(screen.getByTestId('reel-text-content'), { key: 'Delete' });
    fireEvent.keyDown(screen.getByTestId('reel-text-content'), { key: 's' });
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(1);
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
  });

  it('las flechas mueven el cabezal un fotograma (con Mayús, un segundo) y Espacio reproduce', async () => {
    seed();
    await open();
    seekTo(2);
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByTestId('reel-time')).toHaveTextContent('3,0 / 6,5 s');
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    // Tres fotogramas a 30 por segundo: una décima menos.
    expect(screen.getByTestId('reel-time')).toHaveTextContent('2,9 / 6,5 s');
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(screen.getByTestId('reel-time')).toHaveTextContent('6,5 / 6,5 s');
    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(screen.getByTestId('reel-time')).toHaveTextContent('0,0 / 6,5 s');
    const play = screen.getByTestId('reel-play');
    expect(play).toHaveAccessibleName('Reproducir la vista previa');
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(play).toHaveAccessibleName('Pausar la vista previa');
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(play).toHaveAccessibleName('Reproducir la vista previa');
  });
});

describe('editor de reels: velocidad, volumen, filtro y transición', () => {
  it('cambia la velocidad del clip, lo silencia y le pone un filtro; todo viaja en la versión guardada', async () => {
    seed();
    await open();
    fireEvent.click(clipButton(1));
    fireEvent.click(screen.getByTestId('reel-bar-speed'));
    fireEvent.click(within(screen.getByTestId('reel-speed')).getByRole('radio', { name: '2×' }));
    // 3 s de archivo al doble: 1,5 s de reel.
    expect(clipLabels()[1]).toBe('2. Clip cocina.mp4, 1,5 s');
    expect(screen.getByTestId('reel-clip-speed-badge')).toHaveTextContent('2×');
    expect(screen.getByTestId('reel-inspector-clip')).toHaveTextContent(/dura 1,5 s en el reel/);
    // El subtítulo del clip sigue a la imagen: ahora dura la mitad.
    expect(screen.getAllByTestId('reel-cue-block')).toHaveLength(1);

    expect(barMore()).toContain('silenciar');
    await chooseBarMore('reel-bar-mute');
    expect(barMore()).toContain('con sonido');
    expect(screen.getByTestId('reel-clip-volume')).toHaveValue('0');

    fireEvent.click(screen.getByTestId('reel-bar-filter'));
    fireEvent.click(within(screen.getByTestId('reel-filter')).getByRole('radio', { name: 'Blanco y negro' }));
    expect(within(screen.getByTestId('reel-filter')).getByRole('radio', { name: 'Blanco y negro' })).toBeChecked();
    // Los filtros se ven aproximados: se avisa al exportar, en una línea.
    fireEvent.click(screen.getByTestId('reel-export'));
    expect(await screen.findByTestId('reel-export-warnings')).toHaveTextContent('Los filtros de color se ven aquí aproximados');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }));

    await markVersion();
    await waitFor(() => expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1));
    const saved = fake.callsTo('save_content_version', 'rpc')[0]!.payload as { p_data: typeof project };
    expect(saved.p_data.plan.clips[1]).toMatchObject({ id: 'c2', speed: 2, volume: 0, filter: 'bw', in: 0.5, out: 3.5 });
    // A velocidad normal el campo no se guarda (nada de nulos: la base de datos los quitaría).
    expect(saved.p_data.plan.clips[0]).not.toHaveProperty('speed');
  });

  it('el botón entre dos clips abre la transición de ese corte; se cambia, se previsualiza y se pone en todos', async () => {
    seed();
    await open();
    const transitions = screen.getAllByTestId('reel-transition');
    expect(transitions.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Transición entre 1 y 2: fundido',
      'Transición entre 2 y 3: corte seco',
    ]);
    fireEvent.click(transitions[1]!);
    expect(screen.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'transition');
    const panel = screen.getByTestId('reel-inspector-transition');
    expect(panel).toHaveTextContent('Transición entre 2 y 3');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Fundido a negro' }));
    expect(screen.getAllByTestId('reel-transition')[1]).toHaveAccessibleName('Transición entre 2 y 3: fundido a negro');
    // Con una transición los dos planos se solapan: el reel dura algo menos.
    expect(screen.getByTestId('reel-duration')).toHaveTextContent('6,1 s de 90 s');
    // La vista previa arranca sola un poco antes del corte.
    await waitFor(() => expect(screen.getByTestId('reel-play')).toHaveAccessibleName('Pausar la vista previa'));
    fireEvent.click(screen.getByTestId('reel-play'));
    fireEvent.click(within(panel).getByTestId('reel-transition-all'));
    expect(screen.getAllByTestId('reel-transition').map((t) => t.getAttribute('aria-label'))).toEqual([
      'Transición entre 1 y 2: fundido a negro',
      'Transición entre 2 y 3: fundido a negro',
    ]);
  });
});

describe('editor de reels: textos sobre la vista previa', () => {
  it('se arrastra para colocarlo (con guías de centro), se estira para el tamaño y se edita con dos toques', async () => {
    seed();
    await open();
    // El texto «Menú del día» se ve del segundo 0 al 2: en el cabezal (0) tiene su caja sobre el vídeo.
    const box = screen.getByTestId('reel-text-box');
    expect(box).toHaveAccessibleName(/^Texto 1: Menú del día/);
    // Arrastrar: 36 px de 360 de ancho y 64 de 640 de alto = +10 % y +10 %.
    fireEvent.pointerDown(box, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(box, { clientX: 136, clientY: 164 });
    // Mientras se arrastra se ven las zonas que tapa Instagram.
    expect(screen.getByTestId('reel-safe-zones')).toBeInTheDocument();
    expect(screen.queryByTestId('reel-guide-vertical')).not.toBeInTheDocument();
    // Al volver cerca del centro, la guía vertical lo atrae.
    fireEvent.pointerMove(box, { clientX: 103, clientY: 164 });
    expect(screen.getByTestId('reel-guide-vertical')).toBeInTheDocument();
    fireEvent.pointerMove(box, { clientX: 136, clientY: 164 });
    fireEvent.pointerUp(box, { clientX: 136, clientY: 164 });
    expect(screen.queryByTestId('reel-safe-zones')).not.toBeInTheDocument();
    expect(screen.getByTestId('reel-toolbar')).toHaveAttribute('data-kind', 'text');

    // Con el teclado: flechas para colocarlo y + para agrandarlo.
    fireEvent.keyDown(box, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(box, { key: '+' });
    fireEvent.keyUp(box, { key: '+' });

    // Dos toques: se escribe ahí mismo.
    fireEvent.doubleClick(screen.getByTestId('reel-text-box'));
    const inline = screen.getByTestId('reel-text-inline');
    fireEvent.change(inline, { target: { value: 'Menú de otoño' } });
    fireEvent.blur(inline);
    expect(screen.getByTestId('reel-text-block')).toHaveTextContent('Menú de otoño');

    await markVersion();
    await waitFor(() => expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1));
    const text = (fake.callsTo('save_content_version', 'rpc')[0]!.payload as { p_data: typeof project }).p_data.plan
      .texts[0] as unknown as { text: string; offset: { x: number; y: number }; style: { sizeRatio: number } };
    expect(text.text).toBe('Menú de otoño');
    expect(text.offset).toEqual({ x: 0.05, y: 0.1 });
    expect(text.style.sizeRatio).toBe(0.065);
    // Deshacer: el arrastre entero es UN paso.
    fireEvent.click(screen.getByTestId('reel-undo')); // el texto escrito
    fireEvent.click(screen.getByTestId('reel-undo')); // el tamaño, con el teclado
    fireEvent.click(screen.getByTestId('reel-undo')); // la flecha
    fireEvent.click(screen.getByTestId('reel-undo')); // el arrastre
    expect(screen.getByTestId('reel-undo')).toBeDisabled();
  });

  it('los estilos prediseñados (titular, rótulo, precio, subtítulo) se ponen con un toque', async () => {
    seed();
    await open();
    fireEvent.click(within(screen.getByTestId('reel-text-block')).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByTestId('reel-bar-text-style'));
    const presets = screen.getByTestId('reel-text-presets');
    expect(within(presets).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Titular'),
      expect.stringContaining('Rótulo'),
      expect.stringContaining('Precio'),
      expect.stringContaining('Subtítulo'),
    ]);
    fireEvent.click(screen.getByTestId('reel-text-preset-headline'));
    expect(screen.getByTestId('reel-text-preset-headline')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Posición')).toHaveValue('center');
    expect(screen.getByLabelText('Cómo entra el texto')).toHaveValue('zoom');
    fireEvent.click(screen.getByTestId('reel-text-preset-label'));
    expect(screen.getByLabelText('Posición')).toHaveValue('bottom');
    expect(screen.getByTestId('reel-text-preset-headline')).toHaveAttribute('aria-pressed', 'false');
  });

  it('un texto nuevo entra en el cabezal, dura 2,5 s y se abre para escribirlo', async () => {
    seed();
    await open();
    seekTo(6.4);
    fireEvent.click(screen.getByTestId('reel-bar-text'));
    expect(screen.getByTestId('reel-panel')).toHaveAttribute('data-open', 'true');
    // Con el cabezal casi al final, se adelanta para caber entero: de 4 a 6,5 s.
    expect(screen.getByTestId('reel-text-start')).toHaveValue(4);
    expect(screen.getByTestId('reel-text-end')).toHaveValue(6.5);
  });
});

describe('editor de reels: guardado automático', () => {
  it('guarda solo el borrador un momento después de cada cambio y lo dice', async () => {
    seed();
    await open();
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Guardado');
    expect(draftCalls()).toHaveLength(0);
    fireEvent.click(clipButton(0));
    fireEvent.change(screen.getByTestId('reel-photo-seconds'), { target: { value: '3' } });
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Guardando…');
    await waitFor(() => expect(draftCalls()).toHaveLength(1), { timeout: 5000 });
    expect(savedDraft()).toMatchObject({ p_content_id: 'reel-1', p_base_version: 1 });
    expect(savedDraft().p_data.plan.clips[0]).toMatchObject({ id: 'c1', seconds: 3 });
    await waitFor(() => expect(autosaveState()).toBe('saved'));
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Guardado');
    // No es una versión: el historial sigue igual.
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(0);

    // Marcar la versión deja el borrador sin sentido (lo borra la base de datos) y todo queda «Guardado».
    await markVersion();
    expect(await screen.findByText('Versión 2 guardada.')).toBeInTheDocument();
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Guardado');
    expect(screen.getByTestId('reel-autosave')).toHaveAttribute('data-state', 'clean');
  });

  it('al salir por un enlace de la aplicación se guarda en el acto, y al volver el reel está como se dejó', async () => {
    seed();
    const first = await open();
    fireEvent.click(clipButton(2));
    fireEvent.keyDown(document.body, { key: 'Delete' });
    fireEvent.click(screen.getByTestId('reel-bar-text'));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(2);
    // Sin esperar al guardado automático: se sale por «Contenidos».
    expect(draftCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Contenidos' }));
    await waitFor(() => expect(screen.queryByTestId('reel-editor')).not.toBeInTheDocument(), SLOW);
    await waitFor(() => expect(draftCalls()).toHaveLength(1), SLOW);
    expect(savedDraft().p_data.plan.clips.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(await screen.findByText(/queda guardado como borrador/, {}, SLOW)).toBeInTheDocument();
    first.unmount();
    // El borrador está en el servidor antes de volver a abrir (lo que se lee al entrar).
    await waitFor(() => expect(fake.tables.reel_drafts).toHaveLength(1), SLOW);

    // Al volver: el montaje a medias, no la versión guardada, y se dice.
    await open();
    await waitFor(() => expect(screen.getAllByTestId('reel-clip')).toHaveLength(2), SLOW);
    expect(clipLabels()).toEqual(['1. Foto plato.jpg, 2 s', '2. Clip cocina.mp4, 3 s']);
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(2);
    expect(screen.getByTestId('reel-draft-recovered')).toHaveTextContent('Has vuelto a lo que dejaste a medias');
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Guardado');
    // Se puede descartar: vuelve la versión guardada y el borrador se borra del servidor.
    fireEvent.click(within(screen.getByTestId('reel-draft-recovered')).getByRole('button'));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
    await waitFor(() => expect(fake.callsTo('discard_reel_draft', 'rpc')).toHaveLength(1), SLOW);
    expect(screen.queryByTestId('reel-draft-recovered')).not.toBeInTheDocument();
  });

  it('un reel nuevo que nunca tuvo versión tampoco se pierde al salir', async () => {
    seed({ version: 0 });
    const first = await open();
    fireEvent.click(screen.getByTestId('reel-starter-pick'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /«plato.jpg»/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /«local.jpg»/ }));
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() => expect(screen.getAllByTestId('reel-clip')).toHaveLength(2));
    first.unmount();
    await waitFor(() => expect(draftCalls()).toHaveLength(1));
    expect(savedDraft()).toMatchObject({ p_base_version: 0 });

    await open();
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(2);
    expect(screen.getByTestId('reel-draft-recovered')).toBeInTheDocument();
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(0);
  });

  it('si el borrador no se puede guardar, lo dice, pregunta antes de salir y deja copia en el navegador', async () => {
    seed();
    fake.rpc('save_reel_draft', () => {
      throw { message: 'sin conexión' };
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const first = await open();
    fireEvent.click(clipButton(0));
    fireEvent.change(screen.getByTestId('reel-photo-seconds'), { target: { value: '4' } });
    await waitFor(() => expect(screen.getByTestId('reel-autosave')).toHaveAttribute('data-state', 'error'), {
      timeout: 5000,
    });
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Sin guardar');
    // Salir por un enlace pregunta; con «Cancelar» se sigue en el editor.
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Contenidos' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatch(/no se han podido guardar/);
    expect(screen.getByTestId('reel-editor')).toBeInTheDocument();
    // Aunque el servidor no lo tenga, queda en este navegador y se recupera al volver.
    first.unmount();
    expect(fake.tables.reel_drafts).toEqual([]);
    await open();
    expect(clipLabels()[0]).toBe('1. Foto plato.jpg, 4 s');
    expect(screen.getByTestId('reel-draft-recovered')).toBeInTheDocument();
  });

  it('un borrador de antes de la versión vigente no se abre solo: se ofrece recuperarlo o descartarlo', async () => {
    seed({ version: 2 });
    fake.tables.reel_drafts = [
      {
        content_id: 'reel-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        data: { ...project, plan: { ...project.plan, clips: project.plan.clips.slice(0, 1) } },
        base_version: 1,
        updated_by: ME.id,
        updated_at: '2026-11-20T10:00:00Z',
      },
    ];
    await open();
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
    const notice = screen.getByTestId('reel-draft-stale');
    fireEvent.click(within(notice).getByRole('button', { name: 'Recuperarlo' }));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(1);
    expect(screen.queryByTestId('reel-draft-stale')).not.toBeInTheDocument();
    // Es un paso más: se puede deshacer.
    fireEvent.click(screen.getByTestId('reel-undo'));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
  });

  it('quien solo mira no guarda nada', async () => {
    seed();
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
    await open();
    expect(screen.queryByTestId('reel-autosave')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reel-undo')).not.toBeInTheDocument();
    expect(barLabels()).toEqual(['Subtítulos']);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(draftCalls()).toHaveLength(0);
  });
});

describe('editor de reels: música sin salir del editor', () => {
  it('sin audios en la biblioteca, se sube la pista desde el propio diálogo y queda elegida', async () => {
    seed();
    fake.tables.media_assets = fake.tables.media_assets!.filter((a) => a.kind !== 'audio');
    await open();
    fireEvent.click(screen.getByTestId('reel-bar-music'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('reel-music-empty')).toHaveTextContent('Sube la pista aquí mismo');
    expect(within(dialog).getByTestId('reel-music-upload')).toBeEnabled();
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'Mi canción.mp3', { type: 'audio/mpeg' });
    fireEvent.change(within(dialog).getByTestId('reel-music-file'), { target: { files: [file] } });
    await waitFor(() => expect(within(dialog).getByTestId('reel-music-choice')).not.toHaveValue(''));
    const row = fake.rows('media_assets').find((a) => a.file_name === 'Mi canción.mp3')!;
    expect(row).toMatchObject({ kind: 'audio', mime_type: 'audio/mpeg', brand_id: BRAND_ID });
    // La licencia sigue siendo obligatoria.
    expect(within(dialog).getByTestId('reel-music-add')).toBeDisabled();
    fireEvent.click(within(dialog).getByTestId('reel-music-confirm'));
    fireEvent.click(within(dialog).getByTestId('reel-music-add'));
    expect(await screen.findByTestId('reel-music-block')).toHaveTextContent('Mi canción.mp3');
    // La barra de la música lleva «ajustar los cortes al ritmo».
    expect(barLabels()).toEqual(['Volumen', 'Al ritmo', 'Cambiar', 'Quitar']);
    fireEvent.click(screen.getByTestId('reel-bar-rhythm'));
    expect(screen.getByTestId('reel-panel')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('reel-bar-rhythm')).toHaveAttribute('aria-pressed', 'true');
  });

  it('un archivo que no es audio no se sube', async () => {
    seed();
    await open();
    fireEvent.click(screen.getByTestId('reel-bar-music'));
    const dialog = await screen.findByRole('dialog');
    const before = fake.rows('media_assets').length;
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    fireEvent.change(within(dialog).getByTestId('reel-music-file'), { target: { files: [file] } });
    expect(await screen.findByText(/Elige un archivo de audio/)).toBeInTheDocument();
    expect(fake.rows('media_assets')).toHaveLength(before);
  });
});

describe('editor de reels: plantilla elegida antes de entrar («Nueva idea → Reel»)', () => {
  const template = (key: string, name: string) => ({
    id: `plantilla-${key}`,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    template_key: key,
    name,
    source: 'catalog',
    document: {
      kind: 'rrss.reel-template',
      schemaVersion: 1,
      purpose: 'Enseñar un producto.',
      whenToUse: 'Para el producto estrella.',
      material: '2 fotos o clips.',
      style: { id: 'corte-ritmico' },
      slots: [
        { id: 'a', label: 'Resultado', kind: 'any', seconds: 1.8 },
        { id: 'b', label: 'Cierre', kind: 'any', seconds: 3 },
      ],
      texts: [{ id: 'gancho', role: 'hook', text: 'Así se hace', from: 'a', position: 'center' }],
    },
  });

  it('con `?plantilla=<clave>` abre directamente el selector de esa plantilla y monta el reel con ella', async () => {
    seed({ version: 0 });
    fake.tables.brand_reel_templates = [template('otra', 'Otra plantilla'), template('asi-se-hace', 'Así se hace')];
    renderApp(`${EDITOR}?plantilla=asi-se-hace`);
    await screen.findByTestId('reel-editor', {}, SLOW);
    // La plantilla ya se eligió al crear el reel: no se vuelve a enseñar la galería, se piden las fotos.
    expect(screen.queryByText('Empieza tu reel en tres pasos')).not.toBeInTheDocument();
    const dialog = await screen.findByRole('dialog', {}, SLOW);
    expect(dialog).toHaveTextContent('«Así se hace»: elige el material');
    expect(screen.queryByText('Empieza tu reel en tres pasos')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('reel-media-guide')).toHaveTextContent('1. Resultado2. Cierre');
    fireEvent.click(within(dialog).getByRole('button', { name: /«plato.jpg»/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /«local.jpg»/ }));
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() => expect(clipLabels()).toEqual(['1. Foto plato.jpg, 1,8 s', '2. Foto local.jpg, 3 s']));
    // El segundo plano no tiene texto de muestra: lleva su rótulo, del nombre del archivo.
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual(['Así se hace', 'Local']);
  });

  it('una clave que no existe, o un reel que ya tiene material, no abren nada', async () => {
    seed({ version: 0 });
    fake.tables.brand_reel_templates = [template('asi-se-hace', 'Así se hace')];
    const first = renderApp(`${EDITOR}?plantilla=no-existe`);
    await screen.findByTestId('reel-editor');
    await screen.findAllByTestId('reel-brand-template');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    first.unmount();

    seed();
    fake.tables.brand_reel_templates = [template('asi-se-hace', 'Así se hace')];
    renderApp(`${EDITOR}?plantilla=asi-se-hace`);
    await screen.findByTestId('reel-editor');
    // Espera a que lleguen las plantillas de la marca (se ofrecen dentro de «Estilo»).
    fireEvent.click(screen.getByTestId('reel-bar-style'));
    await screen.findByTestId('reel-style-tab-templates');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
  });
});

describe('editor de reels: plantilla de la marca sobre un reel que ya tiene material', () => {
  it('reparte las fotos y los clips en los planos de la plantilla y se puede deshacer', async () => {
    seed();
    fake.tables.brand_reel_templates = [
      {
        id: 'plantilla-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        template_key: 'tres-planos',
        name: 'Tres planos',
        source: 'catalog',
        document: {
          kind: 'rrss.reel-template',
          schemaVersion: 1,
          purpose: 'Enseñar un producto.',
          whenToUse: 'Para el producto estrella.',
          material: '3 fotos o clips.',
          style: { id: 'corte-ritmico' },
          slots: [
            { id: 'a', label: 'Resultado', kind: 'any', seconds: 1.8 },
            { id: 'b', label: 'Proceso', kind: 'any', seconds: 2 },
            { id: 'c', label: 'Cierre', kind: 'any', seconds: 3 },
          ],
          texts: [{ id: 'gancho', role: 'hook', text: 'Así se hace', from: 'a', position: 'center' }],
        },
      },
    ];
    await open();
    // «Estilo» lleva dentro las plantillas de la marca.
    fireEvent.click(screen.getByTestId('reel-bar-style'));
    fireEvent.click(await screen.findByTestId('reel-style-tab-templates'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Necesita: 3 fotos o clips');
    fireEvent.click(within(dialog).getByTestId('reel-apply-template'));
    // El plano más fuerte abre (un vídeo real del sitio cuenta más que una foto sin medidas) y los
    // planos sin texto de muestra llevan su rótulo, del nombre del archivo.
    await waitFor(() =>
      expect(clipLabels()).toEqual(['1. Clip cocina.mp4, 1,8 s', '2. Foto plato.jpg, 2 s', '3. Foto local.jpg, 3 s']),
    );
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual([
      'Así se hace',
      'Plato',
      'Local',
    ]);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(clipLabels()).toEqual(['1. Foto plato.jpg, 2 s', '2. Clip cocina.mp4, 3 s', '3. Foto local.jpg, 2 s']);
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual(['Menú del día']);
  });
});

describe('editor de reels: «Publicar o programar» desde «Exportar»', () => {
  /** Un reel con su vídeo ya montado (versión 1), una cuenta de Instagram y lo necesario para publicar. */
  function seedReady(options: {
    workMode: 'self' | 'agency';
    accounts?: boolean;
    published?: boolean;
    data?: unknown;
  }) {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed({ workMode: options.workMode, data: options.data });
    fake.tables.jobs = [
      {
        id: 'job-ok',
        organization_id: ORG_ID,
        brand_id: BRAND_ID,
        kind: 'media.reel.template',
        payload: renderPayload(options.data ?? project),
        status: 'succeeded',
        attempts: 1,
        max_attempts: 3,
        last_error: null,
        result: { assets: [{ id: 'asset-9' }] },
        created_at: '2026-11-21T10:00:00Z',
      },
    ];
    fake.tables.media_assets!.push({
      ...asset('asset-9', 'video', 'reel-final.mp4', 'video/mp4', 6500),
      storage_path: path('reels/reel-final.mp4'),
    });
    fake.tables.social_accounts =
      options.accounts === false
        ? []
        : [
            {
              id: 'cuenta-1',
              brand_id: BRAND_ID,
              organization_id: ORG_ID,
              network: 'instagram',
              external_id: '1784',
              username: 'casa.demo',
              status: 'active',
              created_at: '2026-11-01T09:00:00Z',
            },
          ];
    fake.tables.scheduled_publications = options.published
      ? [
          {
            id: 'pub-1',
            brand_id: BRAND_ID,
            organization_id: ORG_ID,
            content_id: 'reel-1',
            content_version: 1,
            social_account_id: 'cuenta-1',
            media_asset_ids: ['asset-9'],
            scheduled_at: '2026-11-22T10:00:00Z',
            status: 'published',
            hold_reason: null,
            external_id: '1799',
            external_url: 'https://www.instagram.com/reel/AbC123/',
            published_at: '2026-11-22T10:01:00Z',
          },
        ]
      : [];
    fake.rpc('set_content_status', (args) => {
      const row = { ...fake.tables.content_items![0]!, status: args.p_status };
      fake.tables.content_items![0] = row;
      return row;
    });
    fake.rpc('save_publication', (args) => ({
      id: 'pub-2',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      content_id: args.p_content_id,
      content_version: args.p_content_version,
      social_account_id: args.p_social_account_id,
      media_asset_ids: args.p_media_asset_ids,
      scheduled_at: args.p_scheduled_at,
      status: args.p_content_version ? 'scheduled' : 'planned',
      hold_reason: args.p_content_version ? null : 'not_approved',
    }));
  }

  async function openPublish() {
    fireEvent.click(screen.getByTestId('reel-export'));
    const sheet = await screen.findByTestId('reel-export-sheet');
    await waitFor(() => expect(sheet).toHaveAttribute('data-state', 'ready'), SLOW);
    const publish = within(sheet).getByTestId('reel-export-publish');
    await waitFor(() => expect(publish).toBeEnabled(), SLOW);
    fireEvent.click(publish);
    return screen.findByTestId('reel-publish-panel');
  }

  it('en autogestión: pie y hashtags, programar con el vídeo montado y aprobar por debajo, sin elegir nada', async () => {
    seedReady({ workMode: 'self' });
    await open();
    // Ni el estado en la cabecera ni «Enviar a revisión», «Aprobar» o «Pasar a borrador» en «⋯».
    expect(screen.queryByTestId('reel-status')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await openMoreMenu(user, 'reel-more');
    expect(screen.queryByTestId(/^reel-status-/)).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    const panel = await openPublish();
    expect(within(panel).queryByTestId('reel-approval')).not.toBeInTheDocument();
    fireEvent.change(within(panel).getByTestId('reel-caption'), { target: { value: 'Pan recién hecho, ven a por él.' } });
    fireEvent.change(within(panel).getByTestId('reel-hashtags'), { target: { value: '#pan obrador, #pan' } });
    fireEvent.blur(within(panel).getByTestId('reel-hashtags'));
    fireEvent.click(within(panel).getByTestId('reel-publish-mode-schedule'));
    fireEvent.change(within(panel).getByTestId('reel-publish-when'), { target: { value: '2030-05-04T13:00' } });
    fireEvent.click(within(panel).getByTestId('reel-publish-submit'));

    await waitFor(() => expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(1), SLOW);
    // El pie va en una versión nueva (sin montar otra vez: es el mismo montaje)…
    const saved = fake.callsTo('save_content_version', 'rpc')[0]!.payload as { p_data: { copy: unknown } };
    expect(saved.p_data.copy).toEqual({ caption: 'Pan recién hecho, ven a por él.', hashtags: ['pan', 'obrador'] });
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(0);
    // …que se aprueba por debajo (la versión nueva vuelve a borrador) y se programa con el vídeo ya montado.
    expect(fake.callsTo('set_content_status', 'rpc').map((c) => c.payload)).toEqual([
      expect.objectContaining({ p_status: 'approved', p_expected_version: 2 }),
    ]);
    expect(fake.callsTo('save_publication', 'rpc')[0]!.payload).toMatchObject({
      p_content_id: 'reel-1',
      p_social_account_id: 'cuenta-1',
      p_media_asset_ids: ['asset-9'],
      p_content_version: 2,
    });
    expect(await screen.findByText(/^Programada para el/)).toBeInTheDocument();
  });

  it('sin cuenta conectada lo dice antes, con el enlace, y no aprueba nada', async () => {
    seedReady({ workMode: 'self', accounts: false });
    await open();
    const panel = await openPublish();
    const warning = await within(panel).findByTestId('reel-publish-no-account');
    expect(warning).toHaveTextContent('No hay ninguna cuenta conectada');
    expect(within(warning).getByRole('link')).toHaveAttribute('href', expect.stringContaining('/marca?seccion=datos'));
    expect(within(panel).getByTestId('reel-publish-submit')).toBeDisabled();
    expect(fake.callsTo('set_content_status', 'rpc')).toHaveLength(0);
  });

  it('el pie que propuso «Hacer un reel como este» llega solo al abrir «Publicar o programar»', async () => {
    const REF = '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a41';
    const data = {
      ...project,
      guide: {
        referenceId: REF,
        shots: [{ id: 's1', label: 'La hogaza', kind: 'detalle', media: 'foto', seconds: 2, clipId: 'c1' }],
        texts: [],
      },
    };
    seedReady({ workMode: 'self', data });
    const result = buildReelLikeResult(
      parseMeasurement({
        reference: { id: REF },
        source: { kind: 'upload', durationSeconds: 2, width: 540, height: 960, fps: 30, hasAudio: false },
        shots: [{ index: 0, start: 0, end: 2, seconds: 2, motion: 0, still: true }],
        frames: [{ path: `${ORG_ID}/${BRAND_ID}/referencias/${REF}/f-01.jpg`, at: 0.5, shot: 0 }],
        audio: { present: false, silent: true, bpm: null, confidence: 0, cutsOnBeat: 0, beatsPerCut: 0, speech: [] },
        warnings: [],
      })!,
      {
        name: 'Un plano',
        summary: 'Un plano y ya.',
        pace: 'medio',
        audioKind: 'musica',
        title: 'La hogaza',
        idea: 'El pan.',
        shots: [
          { index: 1, kind: 'detalle', media: 'foto', description: 'El pan', what: 'La hogaza', tip: '', search: ['pan'] },
        ],
        texts: [],
        hook: 'El pan',
        caption: 'Así se hace nuestra hogaza.',
        hashtags: ['pan'],
        coverShot: 1,
        coverNote: 'La hogaza',
      },
      { transcriptUsed: false },
    );
    fake.tables.reel_references = [
      { id: REF, brand_id: BRAND_ID, organization_id: ORG_ID, status: 'ready', result },
    ];
    await open();
    const panel = await openPublish();
    await waitFor(() => expect(within(panel).getByTestId('reel-caption')).toHaveValue('Así se hace nuestra hogaza.'), SLOW);
    expect(within(panel).getByTestId('reel-hashtags')).toHaveValue('#pan');
  });

  it('ya publicada: «Publicada» con fecha y enlace, y «Publicar otra vez» avisa de que saldrá repetida', async () => {
    seedReady({ workMode: 'self', published: true });
    await open();
    expect(await screen.findByTestId('reel-published-badge')).toHaveTextContent('Publicada');
    fireEvent.click(screen.getByTestId('reel-export'));
    const sheet = await screen.findByTestId('reel-export-sheet');
    expect(within(sheet).getByTestId('reel-published')).toHaveTextContent('Publicada');
    expect(within(sheet).getByTestId('reel-published-link')).toHaveAttribute(
      'href',
      'https://www.instagram.com/reel/AbC123/',
    );
    const publish = within(sheet).getByTestId('reel-export-publish');
    expect(publish).toHaveTextContent('Publicar otra vez');
    expect(publish).not.toHaveTextContent('Publicar o programar');
    await waitFor(() => expect(publish).toBeEnabled(), SLOW);
    fireEvent.click(publish);
    expect(await screen.findByRole('dialog', { name: '¿Publicar otra vez?' })).toHaveTextContent(/saldrá dos veces/);
  });

  it('en modo agencia se conserva el flujo: el estado y su siguiente paso, y lo no aprobado queda en espera', async () => {
    seedReady({ workMode: 'agency' });
    await open();
    expect(screen.getByTestId('reel-status')).toHaveTextContent('Borrador');
    // Lo que no es el siguiente paso, en «⋯».
    const user = userEvent.setup();
    await openMoreMenu(user, 'reel-more');
    expect(screen.getByTestId('reel-status-in_review')).toBeInTheDocument();
    expect(screen.queryByTestId('reel-status-approved')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    const panel = await openPublish();
    const approval = within(panel).getByTestId('reel-approval');
    expect(approval).toHaveTextContent('Borrador');
    expect(within(approval).getByTestId('reel-status-approved')).toHaveTextContent('Aprobar');
    // Ahora no se puede (no está aprobada); programar sí, y queda en espera hasta aprobarla.
    expect(within(panel).getByTestId('reel-publish-submit')).toBeDisabled();
    fireEvent.click(within(panel).getByTestId('reel-publish-mode-schedule'));
    fireEvent.change(within(panel).getByTestId('reel-publish-when'), { target: { value: '2030-05-04T13:00' } });
    fireEvent.click(within(panel).getByTestId('reel-publish-submit'));
    await waitFor(() => expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(1), SLOW);
    expect(fake.callsTo('save_publication', 'rpc')[0]!.payload).toMatchObject({
      p_media_asset_ids: ['asset-9'],
      p_content_version: null,
    });
    expect(fake.callsTo('set_content_status', 'rpc')).toHaveLength(0);
  });
});

describe('editor de reels: desde una plantilla, con la calidad de las muestras (docs/reels-calidad.md)', () => {
  const LOGO_ID = '00000000-0000-4000-8000-0000000000aa';
  const sized = (id: string, fileName: string, width: number, height: number, bytes: number) => ({
    ...asset(id, 'image', fileName, 'image/jpeg'),
    width,
    height,
    bytes,
  });

  function seedBrand() {
    seed({ version: 0 });
    fake.tables.media_assets = [
      sized('foto-1', 'Croquetas caseras.jpg', 640, 480, 20_000),
      sized('foto-2', 'arroz-negro.jpg', 1080, 1920, 800_000),
      asset('foto-3', 'image', 'local.jpg', 'image/jpeg'),
      { ...asset(LOGO_ID, 'logo', 'logo.png', 'image/png'), folder: 'Marca' },
      // El recorte de «Quitar el fondo» del arroz y un recorte con su punto de interés del local.
      {
        ...asset('cutout-1', 'image', 'Sin fondo · arroz.png', 'image/png'),
        provenance: { kind: 'media.cutout', sources: [{ path: path('arroz-negro.jpg') }] },
      },
      {
        ...asset('crop-1', 'image', 'local 9x16.jpg', 'image/jpeg'),
        provenance: {
          kind: 'media.image.process',
          focal_point: { x: 0.3, y: 0.6 },
          sources: [{ path: path('local.jpg') }],
        },
      },
    ];
    fake.tables.brand_profiles = [
      {
        id: 'perfil-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        status: 'active',
        version: 1,
        data: {
          visual: {
            colors: [
              { name: 'Dorado', role: 'acento', hex: '#C9A227' },
              { name: 'Carbón', role: 'fondo', hex: '#1A1A1A' },
            ],
            logoAssetIds: [LOGO_ID],
          },
          channels: [{ platform: 'Instagram', handle: 'casa.prueba', url: '' }],
          business: { locations: ['Calle Mayor 1, Pueblo'] },
          voice: { callsToAction: ['Reserva tu mesa'] },
        },
      },
    ];
    fake.tables.brand_reel_templates = [
      {
        id: 'plantilla-plato',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        template_key: 'plato-estrella',
        name: 'Plato estrella',
        source: 'catalog',
        document: {
          kind: 'rrss.reel-template',
          schemaVersion: 1,
          purpose: 'Enseñar un plato.',
          whenToUse: 'Para el plato de la semana.',
          material: '3 fotos.',
          style: { id: 'corte-ritmico' },
          slots: [
            { id: 'a', label: 'Resultado', kind: 'any', seconds: 1.8 },
            { id: 'b', label: 'Detalle', kind: 'any', seconds: 1.6 },
            { id: 'c', label: 'Cierre', kind: 'any', seconds: 2 },
          ],
          texts: [
            { id: 'gancho', role: 'hook', text: 'Lo que sale de la cocina', from: 'a', position: 'center' },
            { id: 'llamada', role: 'cta', text: 'Reserva ya', from: 'c', position: 'bottom' },
          ],
        },
      },
    ];
  }

  type SavedPlan = {
    clips: Array<Record<string, unknown>>;
    texts: Array<{ role?: string; style: { box: { color: string } | null } }>;
    outro?: unknown;
  };
  const savedPlan = () =>
    (fake.callsTo('save_content_version', 'rpc')[0]!.payload as { p_data: { plan: SavedPlan } }).p_data.plan;

  it('ordena el material, abre con la mejor foto, pone rótulos, papeles, encuadre y el cierre de la marca', async () => {
    seedBrand();
    renderApp(`${EDITOR}?plantilla=plato-estrella`);
    await screen.findByTestId('reel-editor', {}, SLOW);
    const dialog = await screen.findByRole('dialog', {}, SLOW);
    // El selector enseña primero lo que mejor queda en un reel vertical; los recortes sin fondo, al final.
    const names = within(dialog)
      .getAllByTestId('reel-media-option')
      .map((o) => o.getAttribute('aria-label'));
    expect(names[0]).toBe('Elegir «arroz-negro.jpg»');
    expect(names[names.length - 1]).toBe('Elegir «Sin fondo · arroz.png»');
    // Se eligen en otro orden: la mejor abre el reel igualmente.
    fireEvent.click(within(dialog).getByRole('button', { name: /«Croquetas caseras.jpg»/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /«arroz-negro.jpg»/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /«local.jpg»/ }));
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() =>
      expect(clipLabels().map((l) => l?.replace(/, [\d,]+ s$/, ''))).toEqual([
        '1. Foto arroz-negro.jpg',
        '2. Foto Croquetas caseras.jpg',
        '3. Foto local.jpg',
      ]),
    );
    // El gancho y el rótulo del plato; la llamada de la plantilla pasa al cierre (no sale dos veces).
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual([
      'Lo que sale de la cocina',
      'Croquetas caseras',
    ]);
    // Junto a «Exportar», el aviso de que sale sin música.
    const notice = screen.getByTestId('reel-audio-notice');
    expect(notice).toHaveTextContent('Sin música');
    expect(notice).toHaveAttribute(
      'title',
      'Sin música: el vídeo saldrá sin sonido. La música se pone en la app de Instagram antes de publicar.',
    );

    await markVersion();
    await waitFor(() => expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1));
    const plan = savedPlan();
    expect(plan.clips[0]).toMatchObject({
      path: path('arroz-negro.jpg'),
      subjectMaskPath: path('Sin fondo · arroz.png'),
    });
    expect(plan.clips[2]).toMatchObject({ path: path('local.jpg'), focalPoint: { x: 0.3, y: 0.6 } });
    expect(plan.texts.map((t) => t.role)).toEqual(['headline', 'label']);
    // El rótulo va en la caja oscura de la marca.
    expect(plan.texts[1]!.style.box?.color).toBe('#1A1A1A');
    expect(plan.outro).toEqual({
      seconds: 2,
      cta: 'Reserva ya',
      handle: '@casa.prueba',
      address: 'Calle Mayor 1, Pueblo',
      logoPath: path('logo.png'),
      accent: '#C9A227',
      accentText: '#141414',
    });
  });

  it('el cierre se puede quitar y volver a poner desde «⋯»', async () => {
    seedBrand();
    renderApp(`${EDITOR}?plantilla=plato-estrella`);
    await screen.findByTestId('reel-editor', {}, SLOW);
    const dialog = await screen.findByRole('dialog', {}, SLOW);
    fireEvent.click(within(dialog).getByRole('button', { name: /«arroz-negro.jpg»/ }));
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() => expect(clipLabels()).toHaveLength(1));
    const user = userEvent.setup();
    await openMoreMenu(user, 'reel-more');
    expect(await screen.findByTestId('reel-outro-toggle')).toHaveTextContent('Quitar el cierre con la marca');
    await user.click(screen.getByTestId('reel-outro-toggle'));
    await openMoreMenu(user, 'reel-more');
    expect(await screen.findByTestId('reel-outro-toggle')).toHaveTextContent('Poner el cierre con la marca');
  });
});
