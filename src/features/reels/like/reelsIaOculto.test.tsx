import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignReelsAutoEnabled, reelLikeEnabled } from '@/config/app';
import { REELS_IA_VISIBLE } from '@/config/flags';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, renderApp, seedWorkspace } from '@/test/fixtures';

// Decisión del 26/11/2026: los reels hechos por la IA se ocultan (config/flags.ts).
// Aunque el entorno lo tenga todo encendido, con el interruptor apagado no sale
// ninguna entrada y la ruta de «Hacer un reel como este» vuelve a Reels.

const REELS = `${BRAND_BASE}/biblioteca/reels`;

function seed() {
  vi.stubEnv('VITE_MEDIA_WORKER_ENABLED', 'true');
  vi.stubEnv('VITE_REEL_LIKE_ENABLED', 'true');
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.content_items = [];
  fake.tables.content_versions = [];
  fake.tables.media_assets = [];
  fake.tables.jobs = [];
  fake.tables.brand_fonts = [];
  fake.tables.brand_reel_templates = [];
  fake.rpc('brand_reel_font_info', () => []);
  fake.fn('ai-reel-like', () => ({
    status: 200,
    body: {
      available: true,
      speechAvailable: false,
      estimate: { textMicros: 1, speechMicros: 1, speechMicrosPerSecond: 1, maxMicros: 2 },
      limits: { maxSeconds: 180, maxUploadBytes: 1, maxSpeechSeconds: 1, maxFrames: 12 },
    },
  }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Reels con IA ocultos (REELS_IA_VISIBLE apagado)', () => {
  it('el interruptor está apagado y apaga «como este» y el montaje automático de las campañas', () => {
    seed();
    expect(REELS_IA_VISIBLE).toBe(false);
    expect(reelLikeEnabled()).toBe(false);
    expect(campaignReelsAutoEnabled()).toBe(false);
  });

  it('Reels no ofrece «Hacer un reel como este», pero sí crear con el editor', async () => {
    seed();
    renderApp(REELS);
    await screen.findByTestId('reels-open-editor');
    expect(screen.queryByTestId('reels-like')).not.toBeInTheDocument();
    expect(fake.callsTo('ai-reel-like', 'function')).toHaveLength(0);
  });

  it('«＋ Crear» no ofrece «como este» y el reel a mano sigue', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    await user.click(await screen.findByTestId('create-menu'));
    await screen.findByTestId('create-menu-reel');
    expect(screen.queryByTestId('create-menu-reel-like')).toBeNull();
    expect(fake.callsTo('ai-reel-like', 'function')).toHaveLength(0);
  });

  it('la ruta de «como este» redirige a Reels', async () => {
    seed();
    renderApp(`${REELS}/como-este`);
    await screen.findByTestId('reels-open-editor');
    await waitFor(() => expect(window.location.pathname).toBe(REELS));
    expect(fake.callsTo('ai-reel-like', 'function')).toHaveLength(0);
  });
});
