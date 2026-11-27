import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { rankReelAssets, type PhotoLook } from '../quality';
import { cachedLooks, useReelLooks } from './useReelLooks';

// F67: el selector de material mira la miniatura de cada foto (luz y fondo) antes de ordenar.
// Aquí la medida se simula (jsdom no dibuja en un lienzo): lo que se prueba es cuándo se mide,
// qué se recuerda y que el orden cambia una sola vez, al terminar.

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const LOOKS: Record<string, PhotoLook> = {
  cocina: { brightness: 0.45, clipped: 0.01, plainBackground: 0.2, backgroundColor: 0.05, unevenness: 0.21 },
  carta: { brightness: 0.56, clipped: 0, plainBackground: 0.54, backgroundColor: 0.25, unevenness: 0.14 },
};

const asset = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'image',
  storage_path: `org/marca/media/${id}.jpg`,
  thumb_path: `org/marca/thumbs/${id}.webp`,
  file_name: `${id}.jpg`,
  mime_type: 'image/jpeg',
  duration_ms: null,
  created_at: '2026-11-20T10:00:00Z',
  ...extra,
});

describe('orden del selector con la luz y el fondo de cada foto', () => {
  it('mide las miniaturas, se recuerda lo medido y, al terminar, las limpias van delante', async () => {
    const storage = fake.storage.from;
    (fake.storage as { from: unknown }).from = () => ({
      ...storage(),
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://example.test/${path}` })),
        error: null,
      }),
    });
    const measured: string[] = [];
    const measure = async (url: string) => {
      measured.push(url);
      return url.includes('cocina') ? LOOKS.cocina! : url.includes('carta') ? LOOKS.carta! : null;
    };
    const library = [
      asset('cocina-1', { width: 3024, height: 4032, bytes: 2_900_000 }),
      asset('carta-1', { width: 1080, height: 1350, bytes: 180_000, mime_type: 'image/webp' }),
      asset('video-1', { kind: 'video', mime_type: 'video/mp4' }),
    ];
    const { result } = renderHook(() => useReelLooks(library, true, measure), { wrapper });
    await waitFor(() => expect(result.current.settled).toBe(true));
    // Solo las fotos, y por su miniatura.
    expect(measured.sort()).toEqual([
      'https://example.test/org/marca/thumbs/carta-1.webp',
      'https://example.test/org/marca/thumbs/cocina-1.webp',
    ]);
    expect(rankReelAssets(library).map((a) => a.id)[0]).toBe('cocina-1');
    expect(rankReelAssets(library, result.current.looks).map((a) => a.id)[0]).toBe('carta-1');
    // Lo medido se recuerda: el editor lo usa al montar desde una plantilla, sin volver a medir.
    expect(cachedLooks(library).get('carta-1')).toEqual(LOOKS.carta);
    fake.storage.from = storage;
  });

  it('si no se puede medir (sin dirección o sin lienzo), no espera: ordena por los datos', async () => {
    const library = [asset('sin-firma-1'), asset('sin-firma-2')];
    const { result } = renderHook(() => useReelLooks(library, true, async () => null), { wrapper });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect([...result.current.looks.values()]).toEqual([null, null]);
  });
});
