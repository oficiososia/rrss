import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, seedWorkspace, renderApp } from '@/test/fixtures';

const asset = (id: string, kind: string, fileName: string, mime: string, durationMs: number | null = null) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind,
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${fileName}`,
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
  created_by: null,
  created_at: `2026-11-18T09:0${id.length}:00Z`,
  updated_at: '2026-11-18T09:00:00Z',
});

const job = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG_ID,
  brand_id: BRAND_ID,
  kind: 'media.reel.template',
  payload: { template: { id: 'corte-ritmico' }, plan: { media: [{}, {}] } },
  status,
  priority: 0,
  idempotency_key: `media:${BRAND_ID}:${id}`,
  attempts: status === 'queued' ? 0 : 1,
  max_attempts: 3,
  run_after: '2026-11-18T10:00:00Z',
  locked_by: null,
  locked_until: null,
  result: null,
  last_error: null,
  created_by: null,
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-18T10:00:00Z',
  finished_at: null,
  ...extra,
});

function seedLibrary() {
  fake.tables.media_assets = [
    asset('foto-1', 'image', 'plato.jpg', 'image/jpeg'),
    asset('foto-2', 'image', 'local.png', 'image/png'),
    asset('clip-1', 'video', 'cocina.mp4', 'video/mp4', 3000),
    asset('audio-1', 'audio', 'musica.m4a', 'audio/mp4'),
  ];
  fake.tables.jobs = [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Reels en la biblioteca', () => {
  it('sin trabajador de medios desplegado no aparece nada', async () => {
    seedWorkspace({ orgRole: 'owner' });
    seedLibrary();
    renderApp(`${BRAND_BASE}/biblioteca`);
    await screen.findByTestId('library-grid');
    expect(screen.queryByTestId('library-reels')).not.toBeInTheDocument();
  });

  it('sin trabajador, entrar por la dirección devuelve a la biblioteca', async () => {
    seedWorkspace({ orgRole: 'owner' });
    seedLibrary();
    renderApp(`${BRAND_BASE}/biblioteca/reels`);
    await waitFor(() => expect(window.location.pathname).toBe(`${BRAND_BASE}/biblioteca`));
    expect(screen.queryByRole('heading', { name: 'Reels' })).not.toBeInTheDocument();
  });

  it('elegir fotos y clip en orden, plantilla, texto y música, ver la duración y encargar', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
    seedLibrary();
    fake.rpc('request_media_job', (args) => {
      const created = job('nuevo', 'queued', { payload: args.p_input });
      fake.rows('jobs').push(created);
      return created;
    });
    const { user } = renderApp(`${BRAND_BASE}/biblioteca`);
    await user.click(await screen.findByTestId('library-reels'));
    expect(await screen.findByRole('heading', { name: 'Reels' })).toBeInTheDocument();

    // Las tres plantillas de ejemplo, con su nombre y descripción.
    const templates = screen.getByTestId('reel-templates');
    expect(within(templates).getByText('Fundido suave')).toBeInTheDocument();
    expect(within(templates).getByText('Corte rítmico')).toBeInTheDocument();
    expect(within(templates).getByText('Pase lateral')).toBeInTheDocument();
    await user.click(within(templates).getByText('Corte rítmico'));

    // Sin piezas no se puede encargar.
    expect(screen.getByTestId('reel-submit')).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: 'Añadir «cocina.mp4»' }));
    await user.click(screen.getByRole('button', { name: 'Añadir «plato.jpg»' }));
    await user.click(screen.getByRole('button', { name: 'Subir la pieza 2' }));
    const pieces = screen.getAllByTestId('reel-piece');
    expect(pieces[0]).toHaveTextContent('plato.jpg');
    expect(pieces[1]).toHaveTextContent('cocina.mp4');
    // Corte rítmico: foto de 1,5 s + clip de 3 s (la plantilla toma hasta 3), sin solapes.
    expect(screen.getByTestId('reel-duration')).toHaveTextContent('4,5 s de 20 s como máximo');

    await user.click(screen.getByRole('button', { name: /Añadir texto/ }));
    await user.type(screen.getByTestId('reel-text'), 'Menú del día');
    await user.selectOptions(screen.getByTestId('reel-music'), `${ORG_ID}/${BRAND_ID}/media/musica.m4a`);
    await user.click(screen.getByTestId('reel-submit'));

    await screen.findByText(/Reel encargado/);
    const [call] = fake.callsTo('request_media_job', 'rpc');
    expect(call!.payload).toMatchObject({
      p_brand_id: BRAND_ID,
      p_kind: 'media.reel.template',
      p_input: {
        template: { id: 'corte-ritmico' },
        plan: {
          media: [
            { type: 'photo', path: `${ORG_ID}/${BRAND_ID}/media/plato.jpg` },
            { type: 'video', path: `${ORG_ID}/${BRAND_ID}/media/cocina.mp4` },
          ],
          texts: [{ text: 'Menú del día', start: 0, end: 3 }],
          music: { path: `${ORG_ID}/${BRAND_ID}/media/musica.m4a` },
        },
      },
    });
    expect(String((call!.payload as { p_idempotency_key: string }).p_idempotency_key)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByTestId('reel-job-status')).toHaveTextContent('En cola');
  });

  it('pasarse del máximo de la plantilla se ve antes de encargar', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    seedLibrary();
    const { user } = renderApp(`${BRAND_BASE}/biblioteca/reels`);
    await user.click(await screen.findByText('Corte rítmico'));
    const add = await screen.findByRole('button', { name: 'Añadir «plato.jpg»' });
    for (let i = 0; i < 14; i++) await user.click(add);
    expect(screen.getByTestId('reel-problems')).toHaveTextContent(
      'El reel duraría 21 s y la plantilla admite 20 s como máximo.',
    );
    expect(screen.getByTestId('reel-submit')).toBeDisabled();
  });

  it('el estado de cada encargo: en cola, montando, listo con enlace a la biblioteca y falló con su motivo', async () => {
    vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
    seedLibrary();
    fake.tables.media_assets.push({
      ...asset('reel-1', 'video', 'reel-corte-ritmico.mp4', 'video/mp4', 4500),
      created_at: '2026-11-18T11:00:00Z',
    });
    fake.tables.jobs = [
      job('j-cola', 'queued', { created_at: '2026-11-18T10:04:00Z' }),
      job('j-montando', 'running', { created_at: '2026-11-18T10:03:00Z' }),
      job('j-listo', 'succeeded', {
        created_at: '2026-11-18T10:02:00Z',
        result: { assets: [{ id: 'reel-1', path: 'x', kind: 'video' }] },
      }),
      job('j-fallo', 'failed', {
        created_at: '2026-11-18T10:01:00Z',
        last_error: 'El archivo resultante pesa 61,2 MB y el almacenamiento admite 50,0 MB',
      }),
    ];
    const { user } = renderApp(`${BRAND_BASE}/biblioteca/reels`);
    // Quien solo ve la marca no monta reels, pero ve los encargos.
    expect(await screen.findByText(/Solo quien edita la marca puede montar reels/)).toBeInTheDocument();
    const statuses = await screen.findAllByTestId('reel-job-status');
    expect(statuses.map((s) => s.textContent)).toEqual(['En cola', 'Montando', 'Listo', 'Falló']);
    expect(screen.getByTestId('reel-job-error')).toHaveTextContent('pesa 61,2 MB');

    await user.click(screen.getByTestId('reel-job-open'));
    await waitFor(() => expect(window.location.pathname).toBe(`${BRAND_BASE}/biblioteca`));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('reel-corte-ritmico.mp4')).toBeInTheDocument();
  });
});
