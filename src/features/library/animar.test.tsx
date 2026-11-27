import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageApi from '@/features/storage/api';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { motionText } from './animateApi';

const asset = (id: string, fileName: string, extra: Record<string, unknown> = {}) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin: 'upload',
  storage_path: `${ORG_ID}/${BRAND_ID}/media/${fileName}`,
  file_name: fileName,
  mime_type: 'image/jpeg',
  bytes: 1000,
  width: 1080,
  height: 1350,
  duration_ms: null,
  sha256: null,
  folder: '',
  tags: [],
  rights: {},
  provenance: {},
  created_by: null,
  created_at: '2026-11-22T09:00:00Z',
  updated_at: '2026-11-22T09:00:00Z',
  ...extra,
});

const MODELS = [
  {
    id: 'fal:minimax/h3/image-to-video',
    displayName: 'Animar foto · MiniMax H3 768p (fal.ai)',
    pricePerSecondMicros: 60_000,
    priceVerified: true,
    minSeconds: 5,
    maxSeconds: 10,
    dataRegion: 'unknown',
    euProcessing: false,
    trainsOnInputs: 'unknown',
    untestedAdapter: true,
    default: true,
  },
];

function options(available: boolean, reason: string | null = null) {
  return {
    available,
    reason,
    remainingMicros: 5_000_000,
    maxSeconds: 10,
    defaultSeconds: 5,
    models: available ? MODELS : [],
  };
}

/** `ai-media` simulado para animar: devuelve lo que se le pide y apunta las llamadas. */
function fakeAnimate(calls: Array<{ action: string; input?: Record<string, unknown> }>, opts = options(true)) {
  fake.fn('ai-media', (body) => {
    const { action, input } = body as { action: string; input?: Record<string, unknown> };
    calls.push({ action, input });
    if (action === 'video.options') return { status: 200, body: { action, animate: opts } };
    const seconds = Number(input?.seconds ?? 5);
    const common = {
      action,
      model: 'fal:minimax/h3/image-to-video',
      seconds,
      aspectRatio: '4:5',
      exactAspect: true,
      dataHandling: { dataRegion: 'unknown', euProcessing: false, trainsOnInputs: 'unknown', untestedAdapter: true },
    };
    if (action === 'video.estimate') return { status: 200, body: { ...common, costMicros: seconds * 60_000 } };
    return {
      status: 202,
      body: { ...common, status: 'pending', generationId: 'gen-1', jobId: 'job-1', estimatedCostMicros: seconds * 60_000 },
    };
  });
}

async function openPhoto(orgRole: 'owner' | 'member' = 'owner') {
  seedWorkspace(orgRole === 'owner' ? { orgRole: 'owner' } : { orgRole: 'member', brandRole: 'viewer' });
  fake.tables.media_assets = [asset('foto-1', 'Paella.jpg')];
  const { user } = renderApp(`${BRAND_BASE}/biblioteca`);
  await user.click(await screen.findByTestId('library-asset'));
  await screen.findByRole('dialog');
  return user;
}

beforeEach(() => {
  // Direcciones firmadas: una por ruta (el almacenamiento simulado no las da).
  vi.spyOn(storageApi, 'signStoragePaths').mockImplementation(
    async (paths: string[]) => new Map(paths.map((p) => [p, `https://almacen.test/${p}`])),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('motionText', () => {
  it('une el movimiento elegido y la indicación propia', () => {
    expect(motionText('steam', '')).toContain('steam');
    expect(motionText(null, 'que se vea el vapor')).toBe('que se vea el vapor');
    expect(motionText('push-in', 'despacio')).toMatch(/push-in.*\. despacio$/);
    expect(motionText(null, '  ')).toBe('');
  });
});

describe('Animar con IA desde la ficha de una foto', () => {
  it('sin el interruptor no aparece ni se pregunta al servidor', async () => {
    const calls: Array<{ action: string }> = [];
    fakeAnimate(calls);
    await openPhoto();
    expect(screen.queryByTestId('asset-animate')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('si el servidor dice que no hay proveedor, plan o cupo, la acción no sale', async () => {
    vi.stubEnv('VITE_AI_ANIMATE_ENABLED', 'true');
    const calls: Array<{ action: string }> = [];
    fakeAnimate(calls, options(false, 'not_configured'));
    await openPhoto();
    await waitFor(() => expect(calls.map((c) => c.action)).toContain('video.options'));
    expect(screen.queryByTestId('asset-animate')).not.toBeInTheDocument();
  });

  it('quien solo ve la marca no la ve', async () => {
    vi.stubEnv('VITE_AI_ANIMATE_ENABLED', 'true');
    const calls: Array<{ action: string }> = [];
    fakeAnimate(calls);
    await openPhoto('member');
    expect(screen.queryByTestId('asset-animate')).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it(
    'enseña el aviso, el coste máximo antes de confirmar y el estado hasta el vídeo listo',
    async () => {
      vi.stubEnv('VITE_AI_ANIMATE_ENABLED', 'true');
      const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
      fakeAnimate(calls);
      const user = await openPhoto();
      await user.click(await screen.findByTestId('asset-animate'));
      const dialog = within(await screen.findByTestId('animate-dialog'));

      // Aviso honesto, cinco movimientos y aviso de la UE.
      expect(dialog.getByText(/puede alterar el plato/i)).toBeInTheDocument();
      for (const id of ['push-in', 'orbit', 'steam', 'light', 'pull-back']) {
        expect(dialog.getByTestId(`animate-movement-${id}`)).toBeInTheDocument();
      }
      expect(dialog.getByTestId('animate-region')).toHaveTextContent(/no garantizan tratar los datos en la UE/);

      // Coste máximo a la vista antes de confirmar (5 s × 0,06) y sin haber pedido nada todavía.
      await waitFor(() => expect(dialog.getByTestId('animate-estimate')).toHaveTextContent(/0,30/));
      expect(calls.some((c) => c.action === 'video.animate')).toBe(false);

      // Con 10 s el coste máximo cambia.
      await user.selectOptions(dialog.getByTestId('animate-seconds'), '10');
      await waitFor(() => expect(dialog.getByTestId('animate-estimate')).toHaveTextContent(/0,60/));

      await user.click(dialog.getByTestId('animate-movement-steam'));
      await user.type(dialog.getByTestId('animate-free'), 'que se vea el vapor del arroz');
      await user.click(dialog.getByTestId('animate-submit'));

      await waitFor(() => expect(calls.some((c) => c.action === 'video.animate')).toBe(true));
      const sent = calls.find((c) => c.action === 'video.animate')!;
      expect(sent.input).toMatchObject({ assetId: 'foto-1', seconds: 10, model: 'fal:minimax/h3/image-to-video' });
      expect(String(sent.input!.motion)).toContain('steam');
      expect(String(sent.input!.motion)).toContain('que se vea el vapor del arroz');

      // En cola (el trabajo todavía no dice nada).
      fake.tables.ai_generations = [{ id: 'gen-1', status: 'reserved', error_code: null, cost_micros: null, output: null }];
      fake.tables.jobs = [
        { id: 'job-1', brand_id: BRAND_ID, idempotency_key: 'ai-media:gen-1', last_error: null },
      ];
      expect(await dialog.findByTestId('animate-status')).toHaveAttribute('data-state', 'queued');

      // El proveedor dice que ya lo está generando.
      fake.tables.jobs = [
        { id: 'job-1', brand_id: BRAND_ID, idempotency_key: 'ai-media:gen-1', last_error: 'Generándose en el proveedor' },
      ];
      await waitFor(() => expect(dialog.getByTestId('animate-status')).toHaveAttribute('data-state', 'running'), {
        timeout: 9000,
      });

      // Termina: el vídeo es un recurso nuevo con vista previa.
      fake.rows('media_assets').push(
        asset('video-1', 'Animada · Paella.mp4', {
          kind: 'video',
          mime_type: 'video/mp4',
          folder: 'Vídeos con IA',
          provenance: { type: 'ai_animation', animated_from: 'foto-1', ai_generated: true },
        }),
      );
      fake.tables.ai_generations = [
        {
          id: 'gen-1',
          status: 'succeeded',
          error_code: null,
          cost_micros: 600_000,
          output: { assets: [{ kind: 'video', path: 'x', mime_type: 'video/mp4', bytes: 10, asset_id: 'video-1' }] },
        },
      ];
      expect(await dialog.findByTestId('animate-done', {}, { timeout: 9000 })).toHaveTextContent(/Vídeos con IA/);
    },
    30_000,
  );

  it('un fallo del proveedor se cuenta sin jerga y deja reintentar', async () => {
    vi.stubEnv('VITE_AI_ANIMATE_ENABLED', 'true');
    const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
    fakeAnimate(calls);
    const user = await openPhoto();
    await user.click(await screen.findByTestId('asset-animate'));
    const dialog = within(await screen.findByTestId('animate-dialog'));
    await user.click(dialog.getByTestId('animate-submit'));
    fake.tables.ai_generations = [
      { id: 'gen-1', status: 'failed', error_code: 'moderated', cost_micros: null, output: null },
    ];
    expect(await dialog.findByText(/rechazado la petición por su contenido/i, {}, { timeout: 9000 })).toBeInTheDocument();
  }, 30_000);
});

describe('Vídeo animado con IA en la biblioteca', () => {
  it('su ficha avisa de que es contenido generado con IA', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.media_assets = [
      asset('video-1', 'Animada · Paella.mp4', {
        kind: 'video',
        mime_type: 'video/mp4',
        provenance: { type: 'ai_animation', animated_from: 'foto-1', ai_generated: true },
      }),
    ];
    const { user } = renderApp(`${BRAND_BASE}/biblioteca`);
    await user.click(await screen.findByTestId('library-asset'));
    expect(await screen.findByTestId('asset-ai-video')).toHaveTextContent(/Generado con IA/);
    expect(screen.queryByTestId('asset-animate')).not.toBeInTheDocument();
  });
});
