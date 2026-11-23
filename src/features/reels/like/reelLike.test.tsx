import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chooseMoreAction } from '@/test/moreMenu';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ReelReferenceRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { buildReelLikeResult, parseMeasurement } from '../../../../supabase/functions/_shared/reels/like';

// «Hacer un reel como este» de principio a fin en la aplicación (con la red
// simulada): el botón solo sale si el servidor puede; subir o pegar el enlace
// con el coste máximo a la vista; progreso por pasos; resultado con sus cuatro
// salidas; «Guardar como plantilla» (formato compartido, origen `reference`) y
// «Abrir en el editor» con el borrador y sus huecos.

const REELS = `${BRAND_BASE}/biblioteca/reels`;
const START = `${REELS}/como-este`;
const REF = '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a41';
const DIR = `${ORG_ID}/${BRAND_ID}/referencias/${REF}`;
const path = (name: string) => `${ORG_ID}/${BRAND_ID}/media/${name}`;

beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerType = 'mouse';
    }
    window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const MEASUREMENT = {
  reference: { id: REF },
  source: { kind: 'upload', durationSeconds: 7.5, width: 540, height: 960, fps: 30, hasAudio: true },
  shots: [
    { index: 0, start: 0, end: 2, seconds: 2, motion: 0.7, still: false },
    { index: 1, start: 2, end: 3.5, seconds: 1.5, motion: 0, still: true, transitionIn: { type: 'cut', seconds: 0 } },
    {
      index: 2,
      start: 3.5,
      end: 5.75,
      seconds: 2.25,
      motion: 0.7,
      still: false,
      transitionIn: { type: 'cut', seconds: 0 },
    },
    {
      index: 3,
      start: 5.75,
      end: 7.5,
      seconds: 1.75,
      motion: 0,
      still: true,
      transitionIn: { type: 'fade', seconds: 0.5 },
    },
  ],
  frames: [0, 1, 2, 3].map((shot) => ({ path: `${DIR}/f-0${shot + 1}.jpg`, at: shot + 0.5, shot })),
  audio: { present: true, silent: false, bpm: 120, confidence: 0.8, cutsOnBeat: 0.67, beatsPerCut: 4, speech: [] },
  warnings: [],
};

const RESULT = buildReelLikeResult(
  parseMeasurement(MEASUREMENT)!,
  {
    name: 'Gancho + 2 pasos + cierre',
    summary: 'Promete algo y lo cumple en dos pasos.',
    pace: 'medio',
    audioKind: 'musica',
    title: 'Así hacemos la hogaza',
    idea: 'El proceso del pan de los sábados.',
    shots: [
      {
        index: 1,
        kind: 'detalle',
        media: 'video',
        description: 'Plano cerrado del producto',
        what: 'La hogaza recién salida',
        tip: 'Luz de ventana',
        search: ['pan'],
      },
      {
        index: 2,
        kind: 'general',
        media: 'foto',
        description: 'El local',
        what: 'El obrador entero',
        tip: 'Desde la puerta',
        search: ['obrador'],
      },
      {
        index: 3,
        kind: 'persona',
        media: 'video',
        description: 'Alguien trabajando',
        what: 'Amasando a mano',
        tip: 'Plano medio',
        search: ['amasar'],
      },
      {
        index: 4,
        kind: 'texto',
        media: 'foto',
        description: 'Cierre con rótulo',
        what: 'El escaparate con el horario',
        tip: '',
        search: ['escaparate'],
      },
    ],
    texts: [
      { role: 'gancho', position: 'top', size: 'grande', fromShot: 1, toShot: 1, value: 'El pan de los sábados' },
      { role: 'llamada', position: 'center', size: 'normal', fromShot: 4, toShot: 4, value: 'Te esperamos' },
    ],
    hook: 'El pan de los sábados',
    caption: 'Pan hecho hoy, con masa madre.',
    hashtags: ['masamadre'],
    coverShot: 1,
    coverNote: 'La hogaza',
  },
  { transcriptUsed: false },
);

const OPTIONS = {
  available: true,
  speechAvailable: true,
  estimate: { textMicros: 40_000, speechMicros: 12_000, speechMicrosPerSecond: 100, maxMicros: 52_000 },
  limits: { maxSeconds: 180, maxUploadBytes: 50 * 1024 * 1024, maxSpeechSeconds: 120, maxFrames: 12 },
};

const reference = (patch: Partial<ReelReferenceRow> = {}): ReelReferenceRow => ({
  id: REF,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  job_id: 'job-1',
  source_kind: 'upload',
  source_host: null,
  source_path: `${ORG_ID}/${BRAND_ID}/referencias/origen.mp4`,
  keep_source: false,
  speech: true,
  idea: '',
  status: 'analyzing',
  error: null,
  measurement: null,
  result: null,
  cost_micros: 0,
  generation_ids: [],
  content_id: null,
  files_released_at: null,
  ai_started_at: null,
  created_by: ME.id,
  created_at: '2026-11-22T10:00:00Z',
  updated_at: '2026-11-22T10:00:00Z',
  ...patch,
});

const asset = (id: string, kind: string, fileName: string, extra: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind,
  origin: 'upload',
  storage_path: path(fileName),
  file_name: fileName,
  mime_type: kind === 'image' ? 'image/jpeg' : 'video/mp4',
  bytes: 1000,
  width: null,
  height: null,
  duration_ms: kind === 'video' ? 8000 : null,
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

function seed(options: { reply?: unknown; role?: 'owner' | 'member'; brandRole?: 'viewer' } = {}) {
  vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
  vi.stubEnv('VITE_REEL_LIKE_ENABLED', 'true');
  seedWorkspace({ orgRole: options.role ?? 'owner', ...(options.brandRole ? { brandRole: options.brandRole } : {}) });
  fake.tables.reel_references = [];
  fake.tables.media_assets = [
    asset('clip-1', 'video', 'IMG_0001.mp4', { tags: ['Panes'] }),
    asset('foto-1', 'image', 'IMG_0002.jpg', { folder: 'Obrador' }),
    asset('foto-2', 'image', 'fachada-nueva.jpg', { tags: ['fachada'] }),
  ];
  fake.tables.jobs = [];
  fake.tables.content_items = [];
  fake.tables.content_versions = [];
  fake.tables.brand_fonts = [];
  fake.tables.brand_reel_templates = [];
  fake.rpc('brand_reel_font_info', () => []);
  fake.fn('ai-reel-like', (body) => {
    const request = body as { action: string; referenceId?: string };
    if (request.action === 'options') return { status: 200, body: options.reply ?? OPTIONS };
    // La parte de IA: el servidor deja el análisis listo y borra sus archivos.
    const row = fake.rows('reel_references').find((r) => r.id === request.referenceId)!;
    Object.assign(row, {
      status: 'ready',
      result: RESULT,
      cost_micros: 31_000,
      source_path: null,
      files_released_at: 'ahora',
    });
    return { status: 200, body: { status: 'ready', result: RESULT, costMicros: 31_000 } };
  });
}

describe('«Hacer un reel como este»: cuándo se ofrece', () => {
  it('sin su interruptor no hay botón en Reels ni pantalla', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    renderApp(REELS);
    await screen.findByTestId('reels-open-editor');
    expect(screen.queryByTestId('reels-like')).not.toBeInTheDocument();
    expect(fake.callsTo('ai-reel-like', 'function')).toHaveLength(0);
  });

  it('con el interruptor, el botón solo sale si el servidor tiene un modelo con visión para la marca', async () => {
    seed({ reply: { ...OPTIONS, available: false, reason: 'not_configured', estimate: null } });
    const first = renderApp(REELS);
    await screen.findByTestId('reels-open-editor');
    await waitFor(() => expect(fake.callsTo('ai-reel-like', 'function')).toHaveLength(1));
    expect(screen.queryByTestId('reels-like')).not.toBeInTheDocument();
    first.unmount();

    seed();
    renderApp(REELS);
    const button = await screen.findByTestId('reels-like');
    expect(button).toHaveTextContent('Hacer un reel como este');
    fireEvent.click(button);
    expect(await screen.findByRole('heading', { name: 'Hacer un reel como este' })).toBeInTheDocument();
    expect(await screen.findByTestId('reel-like-start')).toBeDisabled();
  });

  it('en modo agencia o sin perfil se explica en vez del formulario', async () => {
    seed({ reply: { ...OPTIONS, available: false, reason: 'agency_mode', estimate: null } });
    const first = renderApp(START);
    expect(await screen.findByTestId('reel-like-unavailable')).toHaveTextContent('lo usa el equipo de la agencia');
    expect(screen.queryByTestId('reel-like-start')).not.toBeInTheDocument();
    first.unmount();
    seed({ reply: { ...OPTIONS, available: false, reason: 'profile_missing' } });
    renderApp(START);
    expect(await screen.findByTestId('reel-like-unavailable')).toHaveTextContent('todavía no tiene perfil');
  });
});

describe('«Hacer un reel como este»: subir o pegar el enlace', () => {
  it('enseña el coste máximo antes de empezar y lo ajusta al quitar la voz', async () => {
    seed();
    renderApp(START);
    const cost = await screen.findByTestId('reel-like-cost-max');
    // 40.000 de mirar y escribir + 120 s de voz a 100 micros por segundo.
    expect(cost).toHaveTextContent('0,052');
    expect(screen.getByTestId('reel-like-cost')).toHaveTextContent('Medir los cortes y el ritmo no usa IA');
    fireEvent.click(screen.getByTestId('reel-like-speech'));
    expect(cost).toHaveTextContent('0,04');
    expect(screen.getByTestId('reel-like-cost')).toHaveTextContent('Sin transcribir la voz');
    expect(screen.getByText(/No se copian sus imágenes, su música ni sus textos/)).toBeInTheDocument();
  });

  it('sube el vídeo a la carpeta privada de referencias, encarga el análisis y pasa al progreso', async () => {
    seed();
    const uploads: string[] = [];
    const storage = fake.storage.from();
    vi.spyOn(fake.storage, 'from').mockReturnValue({
      ...storage,
      upload: async (...args: unknown[]) => {
        uploads.push(String(args[0]));
        return { data: null, error: null };
      },
    } as unknown as ReturnType<typeof fake.storage.from>);
    fake.rpc('request_media_job', (args) => {
      fake.rows('reel_references').push(reference() as unknown as Record<string, unknown>);
      return { id: 'job-1', kind: args.p_kind, payload: { reference: { id: REF } } };
    });
    const { user } = renderApp(START);
    const input = await screen.findByTestId('reel-like-file');

    // Un archivo que no es vídeo no vale.
    await user.upload(input, new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByText('Sube un vídeo en MP4, MOV o WebM.')).toBeInTheDocument();
    expect(screen.getByTestId('reel-like-start')).toBeDisabled();

    await user.upload(input, new File(['vídeo'], 'reel que me gusta.mp4', { type: 'video/mp4' }));
    fireEvent.change(screen.getByTestId('reel-like-idea'), { target: { value: 'El pan de los sábados' } });
    fireEvent.click(screen.getByTestId('reel-like-keep'));
    await waitFor(() => expect(screen.getByTestId('reel-like-start')).toBeEnabled());
    fireEvent.click(screen.getByTestId('reel-like-start'));

    const steps = await screen.findByTestId('reel-like-steps');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(new RegExp(`^${ORG_ID}/${BRAND_ID}/referencias/[0-9a-f-]{36}\\.mp4$`));
    const [call] = fake.callsTo('request_media_job', 'rpc');
    expect(call!.payload).toMatchObject({
      p_brand_id: BRAND_ID,
      p_kind: 'media.reel.analyze',
      p_input: { source: { path: uploads[0] }, speech: true, keepSource: true, idea: 'El pan de los sábados' },
    });
    // Progreso por pasos: recibido, midiendo (sin IA), y la IA todavía pendiente.
    const items = within(steps).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'active', 'pending', 'pending']);
    expect(items[1]).toHaveTextContent('Medir los cortes, los planos y el ritmo');
    expect(items[1]).toHaveTextContent('Sin IA');
    expect(
      fake.callsTo('ai-reel-like', 'function').filter((c) => (c.payload as { action: string }).action === 'create'),
    ).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('los enlaces de Instagram, TikTok o YouTube se avisan ANTES de pegarlos y no se mandan a estudiar', async () => {
    seed();
    renderApp(START);
    fireEvent.click(await screen.findByTestId('reel-like-mode-link'));
    // El aviso está antes de pegar nada.
    expect(screen.getByTestId('reel-like-link-notice')).toHaveTextContent(
      'Los enlaces de Instagram, TikTok, YouTube y Facebook no se pueden descargar',
    );
    const url = screen.getByTestId('reel-like-url');
    fireEvent.change(url, { target: { value: 'instagram reel' } });
    expect(screen.getByText('Pega la dirección completa, empezando por https://')).toBeInTheDocument();
    expect(screen.getByTestId('reel-like-start')).toBeDisabled();
    // Con un enlace no se ofrece guardar el vídeo.
    expect(screen.queryByTestId('reel-like-keep')).not.toBeInTheDocument();
    fireEvent.change(url, { target: { value: 'https://www.instagram.com/reel/AbC123/' } });
    expect(screen.getByText(/Instagram no deja descargar sus vídeos desde un enlace/)).toBeInTheDocument();
    expect(screen.getByTestId('reel-like-start')).toBeDisabled();
    fireEvent.change(url, { target: { value: 'https://youtu.be/abc' } });
    expect(screen.getByText(/YouTube no deja descargar sus vídeos/)).toBeInTheDocument();
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(0);
  });

  it('un enlace directo se manda tal cual; si no se puede descargar, se dice claro y se pide el archivo', async () => {
    seed();
    fake.rpc('request_media_job', (args) => {
      fake.rows('reel_references').push(
        reference({
          source_kind: 'link',
          source_host: 'videos.ejemplo.es',
          source_path: null,
          status: 'failed',
          error:
            'No se ha podido descargar el vídeo de ese enlace. Descárgalo en tu dispositivo y súbelo aquí como archivo.',
        }) as unknown as Record<string, unknown>,
      );
      return { id: 'job-1', kind: args.p_kind, payload: { reference: { id: REF } } };
    });
    renderApp(START);
    fireEvent.click(await screen.findByTestId('reel-like-mode-link'));
    fireEvent.change(screen.getByTestId('reel-like-url'), { target: { value: 'https://videos.ejemplo.es/reel.mp4' } });
    fireEvent.click(screen.getByTestId('reel-like-start'));
    const failed = await screen.findByTestId('reel-like-failed');
    expect(fake.callsTo('request_media_job', 'rpc')[0]!.payload).toMatchObject({
      p_input: { source: { url: 'https://videos.ejemplo.es/reel.mp4' }, speech: true },
    });
    expect(failed).toHaveTextContent('No se ha podido descargar el vídeo de ese enlace');
    expect(within(failed).getByRole('link', { name: 'Subir el archivo' })).toHaveAttribute('href', START);
    const items = within(screen.getByTestId('reel-like-steps')).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'failed', 'pending', 'pending']);
  });

  it('un vídeo de la biblioteca: se elige, se estudia una copia en la carpeta de referencias y el original no se toca', async () => {
    seed();
    const uploads: Array<{ path: string; file: File }> = [];
    const storage = fake.storage.from();
    vi.spyOn(fake.storage, 'from').mockReturnValue({
      ...storage,
      upload: async (...args: unknown[]) => {
        uploads.push({ path: String(args[0]), file: args[1] as File });
        return { data: null, error: null };
      },
      // La dirección firmada del vídeo de la biblioteca (para leerlo y copiarlo).
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((item) => ({ path: item, signedUrl: 'https://archivos.test/clip.mp4' })),
        error: null,
      }),
    } as unknown as ReturnType<typeof fake.storage.from>);
    const fetchVideo = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['vídeo'], { type: 'video/mp4' }) }));
    vi.stubGlobal('fetch', fetchVideo);
    fake.rpc('request_media_job', (args) => {
      fake.rows('reel_references').push(reference() as unknown as Record<string, unknown>);
      return { id: 'job-1', kind: args.p_kind, payload: { reference: { id: REF } } };
    });
    renderApp(START);
    fireEvent.click(await screen.findByTestId('reel-like-mode-library'));
    const list = await screen.findByTestId('reel-like-library');
    // Solo los vídeos de la marca, no las fotos.
    expect(within(list).getAllByTestId('reel-like-library-video')).toHaveLength(1);
    expect(list).toHaveTextContent('IMG_0001.mp4');
    expect(screen.getByTestId('reel-like-start')).toBeDisabled();
    fireEvent.click(within(list).getByTestId('reel-like-library-video'));
    // Su duración ajusta el coste de la voz: 8 s a 100 micros por segundo.
    expect(screen.getByTestId('reel-like-cost')).toHaveTextContent('Transcribir la voz (hasta 8 s)');
    fireEvent.click(screen.getByTestId('reel-like-start'));
    await screen.findByTestId('reel-like-steps');
    expect(fetchVideo).toHaveBeenCalledTimes(1);
    expect(String((fetchVideo.mock.calls[0] as unknown[])[0])).toBe('https://archivos.test/clip.mp4');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.path).toMatch(new RegExp(`^${ORG_ID}/${BRAND_ID}/referencias/[0-9a-f-]{36}\\.mp4$`));
    expect(uploads[0]!.file.name).toBe('IMG_0001.mp4');
    // Se estudia la copia, que se borra al terminar: nunca se pide guardarla.
    const [call] = fake.callsTo('request_media_job', 'rpc');
    expect(call!.payload).toMatchObject({ p_input: { source: { path: uploads[0]!.path }, speech: true } });
    expect((call!.payload as { p_input: Record<string, unknown> }).p_input).not.toHaveProperty('keepSource');
    expect(fake.rows('media_assets')).toHaveLength(3);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('el nombre escrito en «Nuevo reel» llega a la pantalla y viaja con el análisis', async () => {
    seed();
    fake.rpc('request_media_job', (args) => {
      fake.rows('reel_references').push(reference() as unknown as Record<string, unknown>);
      return { id: 'job-1', kind: args.p_kind, payload: { reference: { id: REF } } };
    });
    const storage = fake.storage.from();
    vi.spyOn(fake.storage, 'from').mockReturnValue({
      ...storage,
      upload: async () => ({ data: null, error: null }),
    } as unknown as ReturnType<typeof fake.storage.from>);
    const { user } = renderApp(`${START}?nombre=${encodeURIComponent('Reel del pan')}`);
    expect(await screen.findByTestId('reel-like-name')).toHaveValue('Reel del pan');
    await user.upload(screen.getByTestId('reel-like-file'), new File(['vídeo'], 'reel.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(screen.getByTestId('reel-like-start')).toBeEnabled());
    fireEvent.click(screen.getByTestId('reel-like-start'));
    await screen.findByTestId('reel-like-steps');
    expect(window.location.search).toBe(`?nombre=${encodeURIComponent('Reel del pan')}`);
    vi.restoreAllMocks();
  });
});

describe('«Hacer un reel como este»: resultado', () => {
  async function openMeasured() {
    seed();
    fake.tables.reel_references = [reference({ status: 'measured', measurement: MEASUREMENT as never })];
    const app = renderApp(`${START}/${REF}`);
    await screen.findByTestId('reel-like-result');
    return app;
  }

  it('con un reel ya hecho (y archivado), el botón crea una pieza NUEVA con el nombre escrito, no abre la vieja', async () => {
    seed();
    const OLD = '7c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5';
    fake.tables.content_items = [
      {
        id: OLD,
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        title: 'Prueba UX reel como este',
        network: 'instagram',
        format: 'reel',
        status: 'draft',
        current_version: 0,
        archived_at: '2026-11-22T12:00:00Z',
        created_by: ME.id,
        created_at: '2026-11-22T11:00:00Z',
        updated_at: '2026-11-22T12:00:00Z',
      } satisfies ContentItemRow as unknown as Record<string, unknown>,
    ];
    fake.tables.reel_references = [
      reference({ status: 'ready', result: RESULT as never, cost_micros: 31_000, source_path: null, content_id: OLD }),
    ];
    fake.rpc('set_reel_reference_content', (args) => {
      Object.assign(fake.rows('reel_references')[0]!, { content_id: args.p_content_id });
      return fake.rows('reel_references')[0];
    });
    renderApp(`${START}/${REF}?nombre=${encodeURIComponent('Reel del pan')}`);
    const button = await screen.findByTestId('reel-like-open-editor');
    expect(button).toHaveTextContent('Hacer otro reel con esto');
    // La archivada no se ofrece.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('reel-like-previous')).not.toBeInTheDocument();
    fireEvent.click(button);
    await screen.findByTestId('reel-editor');
    const items = fake.rows('content_items') as unknown as ContentItemRow[];
    expect(items).toHaveLength(2);
    const created = items.find((item) => item.id !== OLD)!;
    expect(created).toMatchObject({ title: 'Reel del pan', format: 'reel' });
    expect(created.archived_at ?? null).toBeNull();
    expect(fake.callsTo('set_reel_reference_content', 'rpc')[0]!.payload).toEqual({
      p_reference_id: REF,
      p_content_id: created.id,
    });
    expect(window.location.pathname).toContain(created.id);
  });

  it('con el vídeo medido, la IA empieza sola (una vez) y salen las cuatro salidas', async () => {
    await openMeasured();
    const creates = fake
      .callsTo('ai-reel-like', 'function')
      .filter((c) => (c.payload as { action: string }).action === 'create');
    expect(creates).toHaveLength(1);
    expect(creates[0]!.payload).toEqual({ action: 'create', brandId: BRAND_ID, referenceId: REF });

    const result = screen.getByTestId('reel-like-result');
    expect(within(result).getByRole('heading', { name: 'Así hacemos la hogaza' })).toBeInTheDocument();
    expect(screen.getByTestId('reel-like-cost-real')).toHaveTextContent('Ha costado 0,031');
    expect(screen.getByTestId('reel-like-cost-real')).toHaveTextContent('ya se han borrado');

    // 1 · Plantilla: planos, duraciones, tipo, transiciones, ritmo, textos y portada.
    const template = screen.getByTestId('reel-like-template');
    expect(template).toHaveTextContent('Gancho + 2 pasos + cierre');
    expect(template).toHaveTextContent('4 planos');
    expect(template).toHaveTextContent('7,5 s');
    expect(template).toHaveTextContent('120 pulsaciones/min');
    expect(template).toHaveTextContent('67 % de cortes al compás');
    expect(template).toHaveTextContent('Plano 2General· 1,5 s · foto · entra por corte');
    expect(template).toHaveTextContent('Plano 4Texto· 1,8 s · foto · entra con transición suave (0,5 s)');
    expect(template).toHaveTextContent('Gancho · arriba · letra grande · del segundo 0 s al 2 s');
    expect(template).toHaveTextContent('Portada: el segundo 1,2 s. La hogaza');
    expect(screen.getByTestId('reel-like-shot-bar').children).toHaveLength(4);

    // 2 · Guion y lista de planos.
    const script = within(screen.getByTestId('reel-like-script')).getAllByRole('listitem');
    expect(script).toHaveLength(4);
    expect(script[0]).toHaveTextContent('1. La hogaza recién salida');
    expect(script[0]).toHaveTextContent('Consejo: Luz de ventana');

    // 3 · Borrador con la biblioteca: lo que encaja y lo que falta grabar.
    await waitFor(() =>
      expect(screen.getByTestId('reel-like-draft-summary')).toHaveTextContent(
        '2 de 4 planos con material de tu biblioteca; faltan 2 por grabar.',
      ),
    );
    expect(screen.getByTestId('reel-like-draft-shot-s1')).toHaveTextContent('IMG_0001.mp4');
    expect(screen.getByTestId('reel-like-draft-shot-s1')).toHaveTextContent('Encaja por etiqueta «Panes»');
    expect(screen.getByTestId('reel-like-draft-shot-s2')).toHaveTextContent('carpeta «Obrador»');
    expect(screen.getByTestId('reel-like-draft-shot-s3')).toHaveTextContent('Falta grabar: Amasando a mano');
    expect(screen.getByTestId('reel-like-draft-shot-s4')).toHaveTextContent(
      'Falta grabar: El escaparate con el horario',
    );

    // 4 · Textos con el tono de la marca.
    const texts = screen.getByTestId('reel-like-texts');
    expect(texts).toHaveTextContent('El pan de los sábados');
    expect(texts).toHaveTextContent('«Te esperamos» (llamada a la acción, en el centro');
    expect(texts).toHaveTextContent('Pan hecho hoy, con masa madre.');
    expect(texts).toHaveTextContent('#masamadre');
  });

  it('«Guardar como plantilla» la entrega en el formato compartido, con origen «reference»', async () => {
    await openMeasured();
    fake.rpc('deliver_reel_templates', (args) =>
      (args.p_templates as Array<{ key: string; name: string; document: unknown }>).map((t) => ({
        id: 'tpl-1',
        brand_id: BRAND_ID,
        template_key: t.key,
        name: t.name,
        document: t.document,
        source: args.p_source,
      })),
    );
    fireEvent.click(screen.getByTestId('reel-like-save-template'));
    const name = await screen.findByTestId('reel-like-template-name');
    expect(name).toHaveValue('Gancho + 2 pasos + cierre');
    fireEvent.change(name, { target: { value: 'Mi estructura de pasos' } });
    fireEvent.click(screen.getByTestId('reel-like-template-confirm'));
    expect(await screen.findByTestId('reel-like-template-saved')).toHaveTextContent(
      'Guardada como «Mi estructura de pasos»',
    );

    const [call] = fake.callsTo('deliver_reel_templates', 'rpc');
    const payload = call!.payload as {
      p_brand_id: string;
      p_source: string;
      p_templates: Array<{ key: string; name: string; document: Record<string, unknown> }>;
    };
    expect(payload).toMatchObject({ p_brand_id: BRAND_ID, p_source: 'reference' });
    expect(payload.p_templates).toHaveLength(1);
    expect(payload.p_templates[0]!.key).toMatch(/^ref-mi-estructura-de-pasos-[a-z0-9]{8}$/);
    expect(payload.p_templates[0]!.name).toBe('Mi estructura de pasos');
    const document = payload.p_templates[0]!.document as {
      kind: string;
      slots: Array<{ seconds: number; shot: string }>;
      texts: Array<{ role: string; text: string }>;
    };
    expect(document.kind).toBe('rrss.reel-template');
    expect(document.slots.map((s) => [s.seconds, s.shot])).toEqual([
      [2, 'detail'],
      [1.5, 'wide'],
      [2.25, 'person'],
      [1.75, 'text'],
    ]);
    expect(document.texts.map((t) => [t.role, t.text])).toEqual([
      ['hook', 'El pan de los sábados'],
      ['cta', 'Te esperamos'],
    ]);
  });

  it('«Abrir en el editor» crea el borrador: los planos que encajan, sus textos y el guion con lo que falta grabar', async () => {
    await openMeasured();
    fake.rpc('set_reel_reference_content', (args) => {
      Object.assign(fake.rows('reel_references')[0]!, { content_id: args.p_content_id });
      return fake.rows('reel_references')[0];
    });
    fake.rpc('save_content_version', (args) => ({
      id: 'v-1',
      content_id: args.p_content_id,
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      schema_version: 2,
      data: args.p_data,
      change_note: '',
      restored_from: null,
      created_by: ME.id,
      created_at: '2026-11-22T10:10:00Z',
    }));
    fireEvent.click(screen.getByTestId('reel-like-open-editor'));
    await screen.findByTestId('reel-editor');

    // La pieza se crea con el título del guion y queda apuntada en el análisis.
    const item = fake.rows('content_items')[0] as unknown as ContentItemRow;
    expect(item).toMatchObject({ title: 'Así hacemos la hogaza', format: 'reel', network: 'instagram' });
    expect(fake.callsTo('set_reel_reference_content', 'rpc')[0]!.payload).toEqual({
      p_reference_id: REF,
      p_content_id: item.id,
    });
    expect(window.location.search).toBe(`?referencia=${REF}`);

    // Línea de tiempo: los dos planos con material, con la duración de la plantilla.
    const clips = screen
      .getAllByTestId('reel-clip')
      .map((c) => within(c).getAllByRole('button')[0]!.getAttribute('aria-label'));
    expect(clips).toEqual(['1. Clip IMG_0001.mp4, 2 s', '2. Foto IMG_0002.jpg, 1,5 s']);
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(1);
    expect(screen.getByTestId('reel-like-draft-notice')).toHaveTextContent(
      '2 planos con material de tu biblioteca y 2 por grabar',
    );

    // Guion: hechos y huecos.
    expect(screen.getByTestId('reel-guide-summary')).toHaveTextContent('Faltan 2 planos por grabar de 4.');
    expect(screen.getByTestId('reel-guide-shot-s1')).toHaveAttribute('data-filled', 'true');
    const gap = screen.getByTestId('reel-guide-shot-s4');
    expect(gap).toHaveAttribute('data-filled', 'false');
    expect(gap).toHaveTextContent('Falta grabar: El escaparate con el horario');

    // Rellenar el último hueco con una foto de la biblioteca: entra al final, con su texto.
    fireEvent.click(screen.getByTestId('reel-guide-fill-s4'));
    const picker = await screen.findByRole('dialog');
    expect(picker).toHaveTextContent('Plano 4: El escaparate con el horario');
    // Lo que ya está en el reel no se ofrece otra vez.
    expect(within(picker).queryByRole('button', { name: /IMG_0001\.mp4/ })).not.toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('button', { name: 'Elegir «fachada-nueva.jpg»' }));
    fireEvent.click(within(picker).getByRole('button', { name: 'Usar en este plano' }));
    await waitFor(() => expect(screen.getAllByTestId('reel-clip')).toHaveLength(3));
    expect(screen.getByTestId('reel-guide-summary')).toHaveTextContent('Falta 1 plano por grabar de 4.');
    expect(screen.getAllByTestId('reel-text-block')).toHaveLength(2);
    // Es un paso más del historial.
    fireEvent.click(screen.getByTestId('reel-undo'));
    expect(screen.getAllByTestId('reel-clip')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('reel-redo'));

    // Guardar (⋯ → Historial → Marcar esta versión): la versión lleva el plan (válido para el trabajador) y el guion.
    await chooseMoreAction(userEvent.setup(), 'reel-more', 'reel-history');
    fireEvent.click(await screen.findByTestId('reel-save'));
    const dialog = await screen.findByRole('dialog', { name: /Guardar/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1));
    const saved = fake.callsTo('save_content_version', 'rpc')[0]!.payload as {
      p_data: {
        plan: { clips: Array<{ path: string }>; texts: unknown[] };
        guide: { referenceId: string; shots: Array<{ id: string; clipId?: string }> };
      };
    };
    expect(saved.p_data.plan.clips.map((c) => c.path)).toEqual([
      path('IMG_0001.mp4'),
      path('IMG_0002.jpg'),
      path('fachada-nueva.jpg'),
    ]);
    expect(saved.p_data.guide.referenceId).toBe(REF);
    // El pie y los hashtags que propuso el análisis van en la pieza: se publica con ellos (prueba real, fallo 5).
    expect((saved.p_data as unknown as { copy?: unknown }).copy).toEqual({
      caption: 'Pan hecho hoy, con masa madre.',
      hashtags: ['masamadre'],
      aiGenerated: true,
    });
    expect(saved.p_data.guide.shots.map((s) => Boolean(s.clipId))).toEqual([true, true, false, true]);
  });

  it('quien solo ve la marca ve el resultado, pero no gasta, ni guarda, ni abre el editor', async () => {
    seed({ role: 'member', brandRole: 'viewer' });
    fake.tables.reel_references = [
      reference({ status: 'ready', result: RESULT as never, cost_micros: 31_000, source_path: null }),
    ];
    renderApp(`${START}/${REF}`);
    await screen.findByTestId('reel-like-result');
    expect(screen.queryByTestId('reel-like-open-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reel-like-save-template')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reel-like-discard')).not.toBeInTheDocument();
    expect(
      fake.callsTo('ai-reel-like', 'function').some((c) => (c.payload as { action: string }).action === 'create'),
    ).toBe(false);
  });

  it('si la IA falla, se explica (el cupo, aparte) y se puede reintentar; descartar borra el análisis', async () => {
    seed();
    fake.tables.reel_references = [reference({ status: 'measured', measurement: MEASUREMENT as never })];
    let attempts = 0;
    fake.fn('ai-reel-like', (body) => {
      const request = body as { action: string };
      if (request.action === 'options') return { status: 200, body: OPTIONS };
      attempts += 1;
      if (attempts === 1) {
        return {
          status: 402,
          body: {
            error: { code: 'quota_exhausted', message: 'El cupo de IA de este mes está agotado', retryable: false },
          },
        };
      }
      return {
        status: 409,
        body: {
          error: {
            code: 'files_missing',
            message: 'Los fotogramas de este análisis ya no están. Vuelve a subir el vídeo.',
            retryable: false,
          },
        },
      };
    });
    renderApp(`${START}/${REF}`);
    expect(await screen.findByTestId('ai-quota-error')).toHaveTextContent('El cupo de IA de este mes está agotado');
    const items = within(screen.getByTestId('reel-like-steps')).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'failed', 'pending']);
    expect(items[1]).toHaveTextContent('4 planos encontrados');
    // No se reintenta solo.
    expect(attempts).toBe(1);

    fake.rpc('discard_reel_reference', () => {
      fake.tables.reel_references = [];
      return [];
    });
    fake.tables.storage_cleanup_queue = [];
    fireEvent.click(screen.getByTestId('reel-like-discard'));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Descartar' }));
    await screen.findByTestId('reel-like-start');
    expect(fake.callsTo('discard_reel_reference', 'rpc')[0]!.payload).toEqual({ p_reference_id: REF });
    expect(window.location.pathname).toBe(START);
  });
});
