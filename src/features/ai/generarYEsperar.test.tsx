import { afterEach, describe, expect, it } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_ID, ORG_ID } from '@/test/fixtures';
import { AiRequestError } from './api';
import { generateImageAndWait } from './imageApi';

// `generateImageAndWait` (lo usa el plan del copiloto para el fondo): genera con
// `ai-media` y devuelve el recurso de la biblioteca, sea el modelo síncrono o
// asíncrono. `ai-media` y la base de datos están simulados.

const assetRow = (id: string) => ({
  id,
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  kind: 'image',
  origin: 'generated',
  storage_path: `${ORG_ID}/${BRAND_ID}/ia/${id}.png`,
  file_name: 'IA · fondo.png',
  mime_type: 'image/png',
  bytes: 100,
  width: 1024,
  height: 1280,
  folder: 'IA',
  tags: ['ia'],
  provenance: { type: 'ai_generation' },
});
const generation = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'g-1',
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  status,
  error_code: null,
  cost_micros: 20_000,
  output: null,
  ...extra,
});
const INPUT = { prompt: 'Madera clara', aspectRatio: '4:5' as const };

function pending() {
  fake.fn('ai-media', (body) => ({
    status: 202,
    body: { action: (body as { action: string }).action, status: 'pending', generationId: 'g-1', jobId: 'job-1', model: 'm', estimatedCostMicros: 20_000, dataHandling: {} },
  }));
}

afterEach(() => {
  fake.reset();
});

describe('generar una imagen y esperar a tenerla en la biblioteca', () => {
  it('síncrono: devuelve el recurso que dejó `ai-media`, con la petición tal cual', async () => {
    fake.tables.media_assets = [assetRow('asset-1')];
    fake.fn('ai-media', (body) => ({
      status: 200,
      body: { action: (body as { action: string }).action, status: 'completed', generationId: 'g-1', model: 'm', costMicros: 20_000, estimatedCostMicros: 20_000, asset: { id: 'asset-1', path: 'x' }, dataHandling: {} },
    }));
    const asset = await generateImageAndWait(BRAND_ID, INPUT);
    expect(asset).toMatchObject({ id: 'asset-1', file_name: 'IA · fondo.png' });
    expect(fake.callsTo('ai-media', 'function')[0]!.payload).toEqual({ action: 'image.generate', brandId: BRAND_ID, input: INPUT });
    // Si el recurso no se puede leer, se dice (no se devuelve nada a medias).
    fake.tables.media_assets = [];
    await expect(generateImageAndWait(BRAND_ID, INPUT)).rejects.toThrow('La IA generó la imagen, pero no se ha podido leer de la biblioteca.');
  });

  it('asíncrono: mira la generación hasta que termina y devuelve el recurso que anotó', async () => {
    pending();
    fake.tables.ai_generations = [generation('reserved')];
    fake.tables.media_assets = [];
    const waiting = generateImageAndWait(BRAND_ID, INPUT, { intervalMs: 5 });
    setTimeout(() => {
      fake.tables.media_assets = [assetRow('asset-2')];
      fake.tables.ai_generations = [generation('succeeded', { output: { assets: [{ asset_id: 'asset-2' }] } })];
    }, 30);
    expect(await waiting).toMatchObject({ id: 'asset-2' });
  });

  it('asíncrono: si la generación falla o tarda demasiado, lo dice con el motivo', async () => {
    pending();
    fake.tables.ai_generations = [generation('failed', { error_code: 'moderated' })];
    await expect(generateImageAndWait(BRAND_ID, INPUT, { intervalMs: 5 })).rejects.toThrow(/ha rechazado la petición por su contenido/);
    fake.tables.ai_generations = [generation('reserved')];
    const late = generateImageAndWait(BRAND_ID, INPUT, { intervalMs: 5, timeoutMs: 20 });
    await expect(late).rejects.toBeInstanceOf(AiRequestError);
    await expect(late).rejects.toThrow('La imagen está tardando más de lo normal. Si termina, aparecerá en la biblioteca.');
  });

  it('con la señal de cancelar deja de esperar', async () => {
    pending();
    fake.tables.ai_generations = [generation('reserved')];
    const controller = new AbortController();
    const waiting = generateImageAndWait(BRAND_ID, INPUT, { intervalMs: 5, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
