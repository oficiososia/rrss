import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ContentVersionRow, ManualPublicationRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { buildRenderRequest, parseProject } from './project';

// «Exportar → Terminar en Instagram (para poner música)» (docs/editor-reels.md §12): compartir el vídeo
// en el móvil o descargarlo con un QR en un ordenador, el pie copiado, «Ya lo publiqué» y el emparejado
// automático con las publicaciones de la cuenta (simuladas: ni Instagram ni el almacén son reales).

const EDITOR = `${BRAND_BASE}/contenidos/reel-1`;
const path = (name: string) => `${ORG_ID}/${BRAND_ID}/media/${name}`;
const SLOW = { timeout: 10_000 };
const SIGNED = 'https://almacen.test/firmado/reel-final.mp4?token=t';

const asset = (id: string, kind: string, fileName: string, mime: string, storagePath = path(fileName)) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind,
  origin: 'upload',
  storage_path: storagePath,
  file_name: fileName,
  mime_type: mime,
  bytes: 1000,
  width: null,
  height: null,
  duration_ms: kind === 'video' ? 6000 : null,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: null,
  created_by: null,
  created_at: '2026-11-18T09:00:00Z',
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
      { id: 'c2', type: 'photo', path: path('local.jpg'), seconds: 2, transition: { type: 'cut', seconds: 0 } },
    ],
    texts: [],
    subtitles: { enabled: false, position: 'bottom', style: STYLE },
  },
};

const handoffRow = (extra: Partial<ManualPublicationRow> = {}): ManualPublicationRow => ({
  id: 'manual-1',
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  content_id: 'reel-1',
  content_version: 1,
  media_asset_id: 'asset-9',
  caption: 'Pan recién hecho, ven a por él.\n\n#pan',
  status: 'pending',
  handed_off_at: '2026-11-22T10:00:00Z',
  published_at: null,
  match_source: null,
  imported_media_id: null,
  external_id: null,
  external_url: null,
  created_by: ME.id,
  created_at: '2026-11-22T10:00:00Z',
  updated_at: '2026-11-22T10:00:00Z',
  ...extra,
});

/** Un reel aprobable con su vídeo ya montado (asset-9) y, si se pide, una cuenta de Instagram. */
function seed(options: { accounts?: boolean; manual?: ManualPublicationRow | null; status?: string } = {}) {
  vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
  vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
  seedWorkspace({ orgRole: 'owner', workMode: 'self' });
  const item = {
    id: 'reel-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Reel de la semana',
    network: 'instagram',
    format: 'reel',
    status: options.status ?? 'draft',
    current_version: 1,
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
    version: 1,
    schema_version: 2,
    data: project,
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  } as unknown as ContentVersionRow;
  fake.tables.content_items = [item];
  fake.tables.content_versions = [version];
  fake.tables.media_assets = [
    asset('foto-1', 'image', 'plato.jpg', 'image/jpeg'),
    asset('foto-2', 'image', 'local.jpg', 'image/jpeg'),
    asset('asset-9', 'video', 'reel-final.mp4', 'video/mp4', path('reels/reel-final.mp4')),
  ];
  fake.tables.jobs = [
    {
      id: 'job-ok',
      organization_id: ORG_ID,
      brand_id: BRAND_ID,
      kind: 'media.reel.template',
      payload: buildRenderRequest(parseProject(project), { id: 'reel-1', version: 1 }) as Record<string, unknown>,
      status: 'succeeded',
      attempts: 1,
      max_attempts: 3,
      last_error: null,
      result: { assets: [{ id: 'asset-9' }] },
      created_at: '2026-11-21T10:00:00Z',
    },
  ];
  fake.tables.reel_drafts = [];
  fake.tables.brand_fonts = [];
  fake.tables.scheduled_publications = [];
  fake.tables.social_imported_media = [];
  fake.tables.manual_publications = options.manual ? [options.manual] : [];
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
  fake.rpc('save_reel_draft', () => '2026-11-22T12:00:00Z');
  fake.rpc('discard_reel_draft', () => null);
  fake.rpc('brand_reel_font_info', () => []);
  fake.rpc('save_content_version', (args) => {
    const row = { ...version, id: 'v-2', version: 2, data: args.p_data };
    fake.tables.content_versions!.push(row);
    fake.tables.content_items![0] = { ...fake.tables.content_items![0]!, current_version: 2 };
    return row;
  });
  fake.rpc('set_content_status', (args) => {
    const row = { ...fake.tables.content_items![0]!, status: args.p_status };
    fake.tables.content_items![0] = row;
    return row;
  });
  fake.rpc('start_manual_publication', (args) => {
    const row = handoffRow({
      media_asset_id: String(args.p_media_asset_id),
      caption: String(args.p_caption),
      handed_off_at: new Date().toISOString(),
    });
    fake.tables.manual_publications = [row];
    return row;
  });
  // El almacén firma el vídeo montado (el enlace del QR y la descarga).
  vi.spyOn(fake.storage, 'from').mockImplementation(
    () =>
      ({
        download: async () => ({ data: null, error: { message: 'no' } }),
        upload: async () => ({ data: null, error: null }),
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: SIGNED }, error: null }),
        createSignedUrls: async (paths: string[], seconds: number) => {
          signedFor.push(seconds);
          return { data: paths.map((p) => ({ path: p, signedUrl: SIGNED, error: null })), error: null };
        },
      }) as unknown as ReturnType<typeof fake.storage.from>,
  );
}

let signedFor: number[] = [];
let writeText: ReturnType<typeof vi.fn>;
const restore: Array<() => void> = [];

/** Sustituye una propiedad de `navigator` durante la prueba. */
function setNavigator(name: string, value: unknown) {
  const had = Object.getOwnPropertyDescriptor(navigator, name);
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
  restore.push(() => (had ? Object.defineProperty(navigator, name, had) : delete (navigator as never)[name]));
}

/** ¿Pantalla táctil? (lo que pregunta el editor para compartir con el diálogo del sistema). */
function setTouch(touch: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: touch && query.includes('coarse'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  signedFor = [];
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('mp4', { status: 200 }));
});

afterEach(() => {
  while (restore.length) restore.pop()!();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function openEditor() {
  renderApp(EDITOR);
  await screen.findByTestId('reel-editor', {}, SLOW);
}

async function openSheet() {
  fireEvent.click(screen.getByTestId('reel-export'));
  const sheet = await screen.findByTestId('reel-export-sheet');
  await waitFor(() => expect(sheet).toHaveAttribute('data-state', 'ready'), SLOW);
  return sheet;
}

async function openFinish() {
  const sheet = await openSheet();
  const row = within(sheet).getByTestId('reel-export-instagram');
  expect(row).toHaveTextContent('Terminar en Instagram (para poner música)');
  await waitFor(() => expect(row).toBeEnabled(), SLOW);
  fireEvent.click(row);
  return screen.findByTestId('reel-instagram-panel');
}

/** El portapapeles, justo antes de pulsar (la aplicación de prueba pone el suyo al arrancar). */
function mockClipboard() {
  setNavigator('clipboard', { writeText });
}

function writeCaption(panel: HTMLElement) {
  fireEvent.change(within(panel).getByTestId('reel-caption'), {
    target: { value: 'Pan recién hecho, ven a por él.' },
  });
  fireEvent.change(within(panel).getByTestId('reel-hashtags'), { target: { value: '#pan' } });
  fireEvent.blur(within(panel).getByTestId('reel-hashtags'));
}

describe('editor de reels: «Terminar en Instagram»', () => {
  it('en el móvil: copia el pie, comparte el MP4 con el diálogo del sistema y queda pendiente', async () => {
    setTouch(true);
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', share);
    setNavigator('canShare', () => true);
    seed();
    await openEditor();
    const panel = await openFinish();
    expect(panel).toHaveAttribute('data-mode', 'share');
    expect(within(panel).getByTestId('reel-instagram-help')).toHaveTextContent('Sound Collection');
    writeCaption(panel);
    const button = within(panel).getByTestId('reel-instagram-share');
    await waitFor(() => expect(button).toBeEnabled(), SLOW);
    expect(button).toHaveTextContent('Compartir con Instagram');
    // Si el diálogo no lleva a Instagram, se puede guardar el vídeo.
    expect(within(panel).getByTestId('reel-instagram-download')).toHaveAttribute('href', SIGNED);
    mockClipboard();
    fireEvent.click(button);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1), SLOW);
    const files = (share.mock.calls[0]![0] as { files: File[] }).files;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'reel.mp4', type: 'video/mp4' });
    // El pie, con los hashtags, al portapapeles, y el aviso.
    expect(writeText).toHaveBeenCalledWith('Pan recién hecho, ven a por él.\n\n#pan');
    expect(await screen.findByText('Pie copiado: pégalo en Instagram')).toBeInTheDocument();
    // La pieza se aprueba por debajo (autogestión) y queda pendiente con el vídeo montado.
    await waitFor(() => expect(fake.callsTo('start_manual_publication', 'rpc')).toHaveLength(1), SLOW);
    expect(fake.callsTo('start_manual_publication', 'rpc')[0]!.payload).toMatchObject({
      p_content_id: 'reel-1',
      p_media_asset_id: 'asset-9',
      p_caption: 'Pan recién hecho, ven a por él.\n\n#pan',
    });
    expect(fake.callsTo('set_content_status', 'rpc').map((c) => c.payload)).toEqual([
      expect.objectContaining({ p_status: 'approved' }),
    ]);
    expect(within(panel).getByTestId('reel-instagram-steps')).toHaveTextContent('Añade música y pega el pie');
    expect(await screen.findByTestId('reel-manual-badge')).toHaveTextContent('Pendiente en Instagram');
    // Sin música: no se manda nada más que el vídeo montado (ni se vuelve a montar).
    expect(fake.callsTo('request_media_job', 'rpc')).toHaveLength(0);
  });

  it('en el móvil, cerrar el diálogo de compartir sin elegir nada no marca nada', async () => {
    setTouch(true);
    const share = vi.fn().mockRejectedValue(new DOMException('cancelado', 'AbortError'));
    setNavigator('share', share);
    setNavigator('canShare', () => true);
    seed({ status: 'approved' });
    await openEditor();
    const panel = await openFinish();
    const button = within(panel).getByTestId('reel-instagram-share');
    await waitFor(() => expect(button).toBeEnabled(), SLOW);
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1), SLOW);
    await waitFor(() => expect(button).toBeEnabled(), SLOW);
    expect(fake.callsTo('start_manual_publication', 'rpc')).toHaveLength(0);
    expect(screen.queryByTestId('reel-instagram-steps')).not.toBeInTheDocument();
  });

  it('en un ordenador (sin navigator.share): descarga, copia el pie y enseña el QR con los pasos', async () => {
    setTouch(false);
    setNavigator('share', undefined);
    setNavigator('canShare', undefined);
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    seed({ accounts: false });
    await openEditor();
    const panel = await openFinish();
    expect(panel).toHaveAttribute('data-mode', 'download');
    expect(within(panel).queryByTestId('reel-instagram-share')).not.toBeInTheDocument();
    // Sin cuenta conectada, se avisa de que al volver se marca a mano.
    expect(panel).toHaveTextContent('Sin una cuenta conectada');
    writeCaption(panel);
    const send = within(panel).getByTestId('reel-instagram-send');
    await waitFor(() => expect(send).toBeEnabled(), SLOW);
    mockClipboard();
    fireEvent.click(send);

    expect(writeText).toHaveBeenCalledWith('Pan recién hecho, ven a por él.\n\n#pan');
    expect(clicks).toHaveBeenCalled();
    expect((clicks.mock.contexts[0] as HTMLAnchorElement).getAttribute('href')).toBe(SIGNED);
    expect((clicks.mock.contexts[0] as HTMLAnchorElement).getAttribute('download')).toBe('reel.mp4');
    expect(await screen.findByText('Pie copiado: pégalo en Instagram')).toBeInTheDocument();
    const qr = await within(panel).findByTestId('reel-instagram-qr', {}, SLOW);
    expect(qr).toHaveAttribute('aria-label', 'Código QR para abrir el vídeo en el móvil');
    // Enlace firmado de corta duración (15 min en el almacén de Supabase).
    expect(signedFor).toContain(900);
    const steps = within(panel).getByTestId('reel-instagram-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(3);
    expect(steps).toHaveTextContent('Abre Instagram');
    expect(steps).toHaveTextContent('Elige el vídeo');
    expect(steps).toHaveTextContent('Añade música y pega el pie');
    await waitFor(() => expect(fake.callsTo('start_manual_publication', 'rpc')).toHaveLength(1), SLOW);
  });

  it('«Ya lo publiqué», con el enlace: queda «Publicada» y ya no se ofrece terminarla otra vez', async () => {
    setTouch(false);
    seed({ accounts: false, status: 'approved', manual: handoffRow() });
    fake.rpc('confirm_manual_publication', (args) =>
      handoffRow({
        status: 'published',
        match_source: 'manual',
        external_url: (args.p_url as string | null) ?? null,
        published_at: '2026-11-22T11:00:00Z',
      }),
    );
    await openEditor();
    expect(await screen.findByTestId('reel-manual-badge')).toHaveTextContent('Pendiente en Instagram');
    const sheet = await openSheet();
    const line = within(sheet).getByTestId('reel-manual');
    expect(within(line).getByTestId('reel-manual-pending')).toHaveTextContent('Pendiente de publicar en Instagram');
    // Pendiente: «Publicar o programar» no, para que no salga dos veces.
    expect(within(sheet).getByTestId('reel-export-publish')).toBeDisabled();
    // Sin cuenta conectada no se busca solo.
    expect(within(line).queryByTestId('reel-manual-find')).not.toBeInTheDocument();

    fireEvent.click(within(line).getByTestId('reel-manual-done'));
    const url = within(line).getByTestId('reel-manual-url');
    fireEvent.change(url, { target: { value: 'https://otra.web/reel/x' } });
    fireEvent.click(within(line).getByTestId('reel-manual-save'));
    expect(await within(line).findByRole('alert')).toHaveTextContent('instagram.com');
    expect(fake.callsTo('confirm_manual_publication', 'rpc')).toHaveLength(0);

    fireEvent.change(url, { target: { value: 'instagram.com/reel/AbC123/' } });
    fireEvent.click(within(line).getByTestId('reel-manual-save'));
    await waitFor(() => expect(fake.callsTo('confirm_manual_publication', 'rpc')).toHaveLength(1), SLOW);
    expect(fake.callsTo('confirm_manual_publication', 'rpc')[0]!.payload).toEqual({
      p_id: 'manual-1',
      p_url: 'https://instagram.com/reel/AbC123/',
    });
    expect(await within(sheet).findByTestId('reel-manual-link')).toHaveAttribute(
      'href',
      'https://instagram.com/reel/AbC123/',
    );
    expect(within(sheet).getByTestId('reel-manual')).toHaveTextContent('marcada a mano');
    expect(screen.getByTestId('reel-published-badge')).toHaveTextContent('Publicada');
    expect(within(sheet).getByTestId('reel-export-publish')).toHaveTextContent('Publicar otra vez');
    expect(within(sheet).queryByTestId('reel-export-instagram')).not.toBeInTheDocument();
  });

  it('con cuenta conectada, la encuentra sola entre las últimas publicaciones y la deja «Publicada»', async () => {
    setTouch(false);
    seed({ status: 'approved', manual: handoffRow() });
    fake.fn('social-import/recent', () => {
      // Lo que guarda el servidor al leer /media: una foto, un reel de antes y el reel con el pie pegado.
      fake.tables.social_imported_media = [
        {
          id: 'ig-foto',
          brand_id: BRAND_ID,
          external_id: '180',
          caption: 'Pan recién hecho, ven a por él.',
          media_type: 'IMAGE',
          media_product_type: 'FEED',
          permalink: 'https://www.instagram.com/p/F0t0/',
          published_at: '2026-11-22T10:20:00Z',
        },
        {
          id: 'ig-antiguo',
          brand_id: BRAND_ID,
          external_id: '170',
          caption: 'Pan recién hecho, ven a por él.',
          media_type: 'VIDEO',
          media_product_type: 'REELS',
          permalink: 'https://www.instagram.com/reel/Ant1/',
          published_at: '2026-11-20T10:00:00Z',
        },
        {
          id: 'ig-reel',
          brand_id: BRAND_ID,
          external_id: '190',
          caption: 'Pan recién hecho, ven a por él. 🥖\n\n#pan',
          media_type: 'VIDEO',
          media_product_type: 'REELS',
          permalink: 'https://www.instagram.com/reel/R33l/',
          published_at: '2026-11-22T10:40:00Z',
        },
      ];
      return { status: 200, body: { outcome: 'ok', saved: 3, message: null } };
    });
    fake.rpc('match_manual_publication', (args) =>
      handoffRow({
        status: 'published',
        match_source: 'import',
        imported_media_id: String(args.p_imported_media_id),
        external_id: '190',
        external_url: 'https://www.instagram.com/reel/R33l/',
        published_at: '2026-11-22T10:40:00Z',
      }),
    );
    await openEditor();
    // Al abrir el editor con algo pendiente se busca solo.
    await waitFor(() => expect(fake.callsTo('match_manual_publication', 'rpc')).toHaveLength(1), SLOW);
    expect(fake.callsTo('social-import/recent', 'function')[0]!.payload).toEqual({ accountId: 'cuenta-1' });
    expect(fake.callsTo('match_manual_publication', 'rpc')[0]!.payload).toEqual({
      p_id: 'manual-1',
      p_imported_media_id: 'ig-reel',
    });
    expect(await screen.findByTestId('reel-published-badge')).toHaveTextContent('Publicada');
    const sheet = await openSheet();
    expect(within(sheet).getByTestId('reel-manual-link')).toHaveAttribute(
      'href',
      'https://www.instagram.com/reel/R33l/',
    );
    expect(within(sheet).getByTestId('reel-manual')).not.toHaveTextContent('marcada a mano');
  });

  it('si todavía no aparece lo dice, y se puede volver a buscar', async () => {
    setTouch(false);
    seed({ status: 'approved', manual: handoffRow() });
    fake.fn('social-import/recent', () => ({ status: 200, body: { outcome: 'ok', saved: 0, message: null } }));
    await openEditor();
    await waitFor(() => expect(fake.callsTo('social-import/recent', 'function')).toHaveLength(1), SLOW);
    const sheet = await openSheet();
    expect(await within(sheet).findByTestId('reel-manual-find-result')).toHaveTextContent(
      'Todavía no aparece en la cuenta',
    );
    fireEvent.click(within(sheet).getByTestId('reel-manual-find'));
    await waitFor(() => expect(fake.callsTo('social-import/recent', 'function')).toHaveLength(2), SLOW);
    expect(fake.callsTo('match_manual_publication', 'rpc')).toHaveLength(0);
    expect(within(sheet).getByTestId('reel-manual-pending')).toBeInTheDocument();
  });
});
