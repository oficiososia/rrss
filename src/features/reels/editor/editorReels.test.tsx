import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chooseMoreAction } from '@/test/moreMenu';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ContentVersionRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

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

function seed(options: { status?: ContentItemRow['status']; data?: unknown; version?: number } = {}) {
  seedWorkspace({ orgRole: 'owner' });
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

async function open() {
  const app = renderApp(EDITOR);
  await screen.findByTestId('reel-editor');
  return app;
}

const clipLabels = () =>
  screen.getAllByTestId('reel-clip').map((c) => within(c).getAllByRole('button')[0]!.getAttribute('aria-label'));
const clipButton = (index: number) => within(screen.getAllByTestId('reel-clip')[index]!).getAllByRole('button')[0]!;
const barLabels = () =>
  within(screen.getByTestId('reel-toolbar'))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('data-testid') !== 'reel-bar-back')
    .map((b) => b.textContent);
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
    expect(screen.getByTestId('reel-version')).toHaveTextContent('Versión 1');
    expect(screen.getByTestId('reel-preview')).toBeInTheDocument();
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
    expect(screen.getByTestId('reel-version')).toHaveTextContent('cambios sin guardar');

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

  it('guarda el montaje como versión nueva de la pieza', async () => {
    seed();
    await open();
    fireEvent.click(within(screen.getAllByTestId('reel-clip')[0]!).getAllByRole('button')[0]!);
    fireEvent.change(screen.getByTestId('reel-photo-seconds'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('reel-save'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(screen.getByTestId('reel-version')).toHaveTextContent('Versión 2'));
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

  it('monta la versión guardada unida a la pieza (con trabajador) y no deja montar cambios sin guardar', async () => {
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
    fireEvent.click(screen.getByTestId('reel-render'));
    await waitFor(() => expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(1));
    const input = (fake.callsTo('request_media_job', 'rpc')[0]!.payload as { p_input: Record<string, unknown> })
      .p_input;
    expect(input).toMatchObject({
      template: { id: 'fundido-suave' },
      content: { id: 'reel-1', version: 1 },
      plan: { version: 2 },
    });
    expect(await screen.findByTestId('reel-piece-job')).toHaveTextContent('Versión 1');

    // Mientras se monta esa versión, el botón espera.
    expect(screen.getByTestId('reel-render')).toBeDisabled();
    expect(screen.getByTestId('reel-render-state')).toHaveTextContent(/puedes seguir editando/);
  });

  it('con cambios sin guardar, un solo botón guarda la versión nueva y la monta', async () => {
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
    expect(screen.getByTestId('reel-render')).toHaveTextContent('Guardar y montar el vídeo');
    fireEvent.click(screen.getByTestId('reel-render'));
    await waitFor(() => expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1);
    const input = (fake.callsTo('request_media_job', 'rpc')[0]!.payload as { p_input: Record<string, unknown> })
      .p_input;
    expect(input).toMatchObject({ content: { id: 'reel-1', version: 2 } });
  });

  it('muestra el estado del montaje de la versión: en cola, montando, listo con enlace o fallo', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seed();
    const job = (status: string, extra: Record<string, unknown> = {}) => ({
      id: `job-${status}`,
      organization_id: ORG_ID,
      brand_id: BRAND_ID,
      kind: 'media.reel.template',
      payload: { content: { id: 'reel-1', version: 1 } },
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
    const first = await open();
    // «Ver el vídeo» lo abre dentro del editor (grande, con descargar), sin salir a la biblioteca.
    fireEvent.click(await screen.findByTestId('reel-render-view'));
    expect(screen.getByTestId('reel-render')).toHaveTextContent('Montar otra vez');
    const viewer = await screen.findByRole('dialog');
    expect(within(viewer).getByText('Vídeo montado')).toBeInTheDocument();
    expect(within(viewer).getByRole('link', { name: 'Abrir en la biblioteca' })).toHaveAttribute(
      'href',
      expect.stringContaining('recurso=asset-9'),
    );
    expect(screen.getByTestId('reel-editor')).toBeInTheDocument();
    first.unmount();

    fake.tables.jobs = [job('failed', { last_error: 'Sin espacio' })];
    const second = await open();
    expect(await screen.findByText(/No se pudo montar: Sin espacio/)).toBeInTheDocument();
    second.unmount();

    fake.tables.jobs = [job('running')];
    await open();
    await waitFor(() => expect(screen.getByTestId('reel-render-state')).toHaveTextContent(/puedes seguir editando/));
    expect(screen.getByTestId('reel-render')).toBeDisabled();
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
    expect(screen.getByTestId('reel-version')).toHaveTextContent('cambios sin guardar');
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

    // Cada pieza en su plano, con la duración de la plantilla, y los dos textos de muestra.
    await waitFor(() =>
      expect(clipLabels()).toEqual(['1. Foto plato.jpg, 1,8 s', '2. Clip cocina.mp4, 2 s', '3. Foto local.jpg, 3 s']),
    );
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual([
      'Así se hace',
      'Ven a probarlo',
    ]);
    expect(screen.getByTestId('reel-version')).toHaveTextContent('cambios sin guardar');
    expect(await screen.findByText(/Reel montado con «Así se hace»/)).toBeInTheDocument();

    // Se guarda como un reel normal: plan v2 sobre el estilo de la plantilla, con portada y sin música.
    fireEvent.click(screen.getByTestId('reel-save'));
    const saveDialog = await screen.findByRole('dialog');
    fireEvent.click(within(saveDialog).getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1));
    const saved = fake.callsTo('save_content_version', 'rpc')[0]!.payload as {
      p_data: {
        template: { id: string };
        plan: { clips: unknown[]; cover: unknown; music?: unknown; texts: Array<{ style: { marginRatio: number } }> };
      };
    };
    expect(saved.p_data.template).toEqual({ id: 'corte-ritmico' });
    expect(saved.p_data.plan.clips).toHaveLength(3);
    expect(saved.p_data.plan.cover).toEqual({ type: 'frame', at: 0.9 });
    expect(saved.p_data.plan.music).toBeUndefined();
    expect(saved.p_data.plan.texts[1]!.style.marginRatio).toBe(0.37);
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
    expect(screen.queryByTestId('reel-safe-zones')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reel-safe-toggle'));
    expect(screen.getByTestId('reel-safe-zones')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reel-safe-toggle'));
    expect(screen.queryByTestId('reel-safe-zones')).not.toBeInTheDocument();

    fake.rpc('archive_content_item', (args) => ({
      ...fake.tables.content_items![0]!,
      archived_at: args.p_archived ? '2026-11-21T10:00:00Z' : null,
    }));
    const user = userEvent.setup();
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
    expect(barLabels()).toEqual(['Añadir', 'Texto', 'Música', 'Estilo', 'Plantilla', 'Subtítulos', 'Portada']);
    // La marca no tiene plantillas de reel: el botón lo dice en vez de abrir un diálogo vacío.
    expect(screen.getByTestId('reel-bar-template')).toBeDisabled();

    fireEvent.click(clipButton(1));
    expect(bar).toHaveAttribute('data-kind', 'clip');
    expect(barLabels()).toEqual([
      'Dividir',
      'Recortar',
      'Velocidad',
      'Volumen',
      'Silenciar',
      'Filtro',
      'Sustituir',
      'Duplicar',
      'Subtítulos',
      'Borrar',
    ]);
    // Una foto: movimiento de cámara en lugar de velocidad y volumen.
    fireEvent.click(clipButton(0));
    expect(barLabels()).toEqual(['Dividir', 'Recortar', 'Movimiento', 'Filtro', 'Sustituir', 'Duplicar', 'Borrar']);

    fireEvent.click(within(screen.getByTestId('reel-text-block')).getAllByRole('button')[0]!);
    expect(bar).toHaveAttribute('data-kind', 'text');
    expect(barLabels()).toEqual(['Editar', 'Estilo', 'Animación', 'Duración', 'Duplicar', 'Borrar']);

    fireEvent.click(screen.getByTestId('reel-bar-back'));
    expect(bar).toHaveAttribute('data-kind', 'none');
    // Esc también suelta lo elegido.
    fireEvent.click(clipButton(0));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(bar).toHaveAttribute('data-kind', 'none');
  });

  it('un botón de la barra abre su sección del panel (en móvil, la hoja) y «Listo» la cierra', async () => {
    seed();
    await open();
    const panel = screen.getByTestId('reel-panel');
    expect(panel).toHaveAttribute('data-open', 'false');
    fireEvent.click(clipButton(1));
    fireEvent.click(screen.getByTestId('reel-bar-speed'));
    expect(panel).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('reel-bar-speed')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByTestId('reel-speed')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reel-panel-close'));
    expect(panel).toHaveAttribute('data-open', 'false');
    // «Portada» y «Subtítulos», sin nada elegido.
    fireEvent.click(screen.getByTestId('reel-bar-back'));
    fireEvent.click(screen.getByTestId('reel-bar-cover'));
    expect(panel).toHaveAttribute('data-open', 'true');
    expect(within(panel).getByTestId('reel-cover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('reel-bar-subtitles'));
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
    fireEvent.click(screen.getByTestId('reel-bar-duplicate'));
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('reel-bar-delete'));
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

    expect(screen.getByTestId('reel-bar-mute')).toHaveTextContent('Silenciar');
    fireEvent.click(screen.getByTestId('reel-bar-mute'));
    expect(screen.getByTestId('reel-bar-mute')).toHaveTextContent('Con sonido');
    expect(screen.getByTestId('reel-clip-volume')).toHaveValue('0');

    fireEvent.click(screen.getByTestId('reel-bar-filter'));
    fireEvent.click(within(screen.getByTestId('reel-filter')).getByRole('radio', { name: 'Blanco y negro' }));
    expect(within(screen.getByTestId('reel-filter')).getByRole('radio', { name: 'Blanco y negro' })).toBeChecked();
    // Los filtros se ven aproximados: se avisa.
    expect(screen.getByTestId('reel-notices-chip')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('reel-save'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));
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

    fireEvent.click(screen.getByTestId('reel-save'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));
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
    expect(screen.getByTestId('reel-version')).toHaveTextContent('Versión 1 · cambios sin guardar');
    await waitFor(() => expect(draftCalls()).toHaveLength(1), { timeout: 5000 });
    expect(savedDraft()).toMatchObject({ p_content_id: 'reel-1', p_base_version: 1 });
    expect(savedDraft().p_data.plan.clips[0]).toMatchObject({ id: 'c1', seconds: 3 });
    await waitFor(() => expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Borrador guardado'));
    // No es una versión: el historial sigue igual.
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(0);

    // Guardar la versión deja el borrador sin sentido (lo borra la base de datos) y todo queda «Guardado».
    fireEvent.click(screen.getByTestId('reel-save'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(screen.getByTestId('reel-version')).toHaveTextContent('Versión 2'));
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Guardado');
    expect(screen.getByTestId('reel-autosave')).toHaveAttribute('data-state', 'clean');
  });

  it('al salir por un enlace de la aplicación se guarda en el acto, y al volver el reel está como se dejó', async () => {
    seed();
    const first = await open();
    fireEvent.click(clipButton(2));
    fireEvent.click(screen.getByTestId('reel-bar-delete'));
    fireEvent.click(screen.getByTestId('reel-bar-text'));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(2);
    // Sin esperar al guardado automático: se sale por «Contenidos».
    expect(draftCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Contenidos' }));
    await waitFor(() => expect(screen.queryByTestId('reel-editor')).not.toBeInTheDocument());
    await waitFor(() => expect(draftCalls()).toHaveLength(1));
    expect(savedDraft().p_data.plan.clips.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(await screen.findByText(/queda guardado como borrador/)).toBeInTheDocument();
    first.unmount();

    // Al volver: el montaje a medias, no la versión guardada, y se dice.
    await open();
    expect(clipLabels()).toEqual(['1. Foto plato.jpg, 2 s', '2. Clip cocina.mp4, 3 s']);
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(2);
    expect(screen.getByTestId('reel-draft-recovered')).toHaveTextContent('Has vuelto a lo que dejaste a medias');
    expect(screen.getByTestId('reel-autosave')).toHaveTextContent('Borrador guardado');
    // Se puede descartar: vuelve la versión guardada y el borrador se borra del servidor.
    fireEvent.click(within(screen.getByTestId('reel-draft-recovered')).getByRole('button'));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(3);
    await waitFor(() => expect(fake.callsTo('discard_reel_draft', 'rpc')).toHaveLength(1));
    expect(screen.getByTestId('reel-version')).toHaveTextContent(/^Versión 1$/);
  });

  it('un reel nuevo que nunca tuvo versión tampoco se pierde al salir', async () => {
    seed({ version: 0 });
    const first = await open();
    expect(screen.getByTestId('reel-version')).toHaveTextContent('Sin guardar');
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
    expect(screen.getByTestId('reel-version')).toHaveTextContent('Sin guardar');
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
    expect(screen.queryByTestId('reel-save')).not.toBeInTheDocument();
    expect(barLabels()).toEqual(['Subtítulos', 'Portada']);
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
    await screen.findByTestId('reel-editor');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('«Así se hace»: elige el material');
    expect(within(dialog).getByTestId('reel-media-guide')).toHaveTextContent('1. Resultado2. Cierre');
    fireEvent.click(within(dialog).getByRole('button', { name: /«plato.jpg»/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /«local.jpg»/ }));
    fireEvent.click(within(dialog).getByTestId('reel-media-confirm'));
    await waitFor(() => expect(clipLabels()).toEqual(['1. Foto plato.jpg, 1,8 s', '2. Foto local.jpg, 3 s']));
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual(['Así se hace']);
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
    await waitFor(() => expect(screen.getByTestId('reel-bar-template')).toBeEnabled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByTestId('reel-bar-template')).toBeEnabled());
    fireEvent.click(screen.getByTestId('reel-bar-template'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Necesita: 3 fotos o clips');
    fireEvent.click(within(dialog).getByTestId('reel-apply-template'));
    await waitFor(() =>
      expect(clipLabels()).toEqual(['1. Foto plato.jpg, 1,8 s', '2. Clip cocina.mp4, 2 s', '3. Foto local.jpg, 3 s']),
    );
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual(['Así se hace']);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(clipLabels()).toEqual(['1. Foto plato.jpg, 2 s', '2. Clip cocina.mp4, 3 s', '3. Foto local.jpg, 2 s']);
    expect(screen.getAllByTestId('reel-text-block').map((t) => t.textContent)).toEqual(['Menú del día']);
  });
});
