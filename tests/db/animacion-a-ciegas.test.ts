// Script de prueba a ciegas de «Animar con IA» (scripts/animacion-a-ciegas.ts):
// en seco por defecto, coste máximo antes de gastar, hoja sin nombres de modelo
// y desvelado de los votos. Todo con una base de datos y un fal.ai simulados:
// ninguna llamada de pago y ninguna clave.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assignBlind,
  formatPlan,
  planBlind,
  runBlind,
  sheetHtml,
  tally,
  MOVEMENT_PROMPTS,
  type BlindDb,
  type BlindPhoto,
  type RunDeps,
  type RunOptions,
} from '../../scripts/animacion-a-ciegas.ts';
import { mediaModelsFromRows, type MediaModelRow } from '../../supabase/functions/_shared/ai/media/models.ts';

const H3 = 'minimax/h3/image-to-video';
const KLING = 'fal-ai/kling-video/v3/standard/image-to-video';

const row = (model: string, price: number, priority: number, settings: object): MediaModelRow => ({
  provider: 'fal',
  model,
  task: 'video',
  operation: 'animate_photo',
  display_name: model,
  billing_unit: 'second',
  price_micros: price,
  price_details: {},
  price_verified: false,
  data_region: 'unknown',
  trains_on_inputs: 'unknown',
  delivery: 'async',
  settings,
  priority,
  active: false,
});
const ROWS = [
  row(H3, 60_000, 10, { fields: { image: 'image_url', prompt: 'prompt', duration: 'duration' }, static: { resolution: '768P' } }),
  row(KLING, 84_000, 0, { fields: { image: 'start_image_url', prompt: 'prompt', duration: 'duration' }, duration_as_string: true }),
];
const PHOTOS: BlindPhoto[] = Array.from({ length: 5 }, (_, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  organization_id: 'org',
  brand_id: 'marca',
  storage_path: `org/marca/media/foto-${i + 1}.jpg`,
  file_name: `Secreto ${i + 1}.jpg`,
  mime_type: 'image/jpeg',
  width: 1080,
  height: 1350,
}));

const db: BlindDb = { photos: async (_b, _ids, limit) => PHOTOS.slice(0, limit), models: async () => ROWS };

const OPTS: RunOptions = {
  brandId: 'marca',
  photoIds: null,
  count: 5,
  seconds: 5,
  movement: 'push-in',
  apply: false,
  yes: false,
  maxCostUsd: 5,
  outDir: 'salida',
};

function harness(overrides: Partial<RunDeps> = {}) {
  const logs: string[] = [];
  const files = new Map<string, string | Uint8Array>();
  const fetched: string[] = [];
  const posted: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchSim = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    fetched.push(url);
    if (init?.method === 'POST' && url.startsWith('https://queue.fal.run/')) {
      posted.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const id = `req-${posted.length}`;
      const base = `${url.split('?')[0]}/requests/${id}`;
      return Response.json({ request_id: id, status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
    }
    if (url.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
    if (url.includes('/requests/')) return Response.json({ video: { url: 'https://v3.fal.media/clip.mp4' } });
    return new Response(new Uint8Array([1, 2, 3]));
  }) as typeof fetch;
  const deps: RunDeps = {
    db,
    sign: async (photo) => `https://almacen.test/${photo.id}`,
    fetch: fetchSim,
    falKey: 'clave-falsa',
    confirm: async () => true,
    write: async (file, data) => void files.set(file.replace(/\\/g, '/'), data),
    mkdir: async () => undefined,
    sleep: async () => undefined,
    now: () => 0,
    rand: () => 0,
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, logs, files, fetched, posted };
}

describe('script de animar a ciegas', () => {
  it('en seco: estima el coste máximo (5 fotos × 5 s con los dos modelos = 3,60 USD) y no llama ni escribe nada', async () => {
    const h = harness({ falKey: null });
    expect(await runBlind(OPTS, h.deps)).toBe(0);
    const out = h.logs.join('\n');
    expect(out).toContain('COSTE MÁXIMO TOTAL: 3,60 USD (10 clips)');
    expect(out).toContain('precio SIN VERIFICAR');
    expect(out).toContain('EN SECO');
    expect(h.fetched).toEqual([]);
    expect(h.files.size).toBe(0);
  });

  it('con --apply respeta el tope de coste antes de gastar', async () => {
    const h = harness();
    await expect(runBlind({ ...OPTS, apply: true, maxCostUsd: 2 }, h.deps)).rejects.toThrow(/supera el tope/);
    expect(h.fetched).toEqual([]);
  });

  it('con --apply sin la clave de fal o sin confirmar, no gasta', async () => {
    const noKey = harness({ falKey: null });
    await expect(runBlind({ ...OPTS, apply: true }, noKey.deps)).rejects.toThrow(/FAL_KEY/);
    const declined = harness({ confirm: async () => false });
    expect(await runBlind({ ...OPTS, apply: true }, declined.deps)).toBe(0);
    expect(declined.posted).toEqual([]);
  });

  it('con --apply manda el mismo movimiento con los dos modelos y deja una hoja sin nombres de modelo', async () => {
    const h = harness();
    expect(await runBlind({ ...OPTS, apply: true, yes: true }, h.deps)).toBe(0);
    expect(h.posted).toHaveLength(10);
    const h3 = h.posted.filter((p) => p.url.includes(H3));
    const kling = h.posted.filter((p) => p.url.includes(KLING));
    expect(h3).toHaveLength(5);
    expect(kling).toHaveLength(5);
    expect(h3[0]!.body).toMatchObject({ resolution: '768P', duration: 5 });
    expect(kling[0]!.body).toMatchObject({ duration: '5' });
    // El mismo texto de movimiento para los dos.
    expect(h3[0]!.body.prompt).toBe(kling[0]!.body.prompt);
    expect(String(h3[0]!.body.prompt)).toContain(MOVEMENT_PROMPTS['push-in']!);

    const sheet = String(h.files.get('salida/hoja.html'));
    expect(sheet).not.toMatch(/minimax|kling|fal|h3/i);
    expect(sheet).not.toContain('Secreto');
    expect(sheet).toContain('foto-1-A.mp4');
    expect([...h.files.keys()].filter((f) => f.endsWith('.mp4'))).toHaveLength(10);
    expect([...h.files.keys()].some((f) => /minimax|kling/i.test(f))).toBe(false);
    const key = JSON.parse(String(h.files.get('salida/clave-NO-ABRIR.json'))) as Record<string, { A: string; B: string }>;
    expect(Object.keys(key)).toEqual(['1', '2', '3', '4', '5']);
    expect(new Set(Object.values(key[1]!))).toEqual(new Set([`fal:${H3}`, `fal:${KLING}`]));
  });

  it('un clip que falla no tira la prueba: la hoja lo dice', async () => {
    const h = harness();
    let first = true;
    const inner = h.deps.fetch;
    h.deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/status') && first) {
        first = false;
        return Response.json({ status: 'COMPLETED', error: 'boom', error_type: 'x' });
      }
      return inner(input, init);
    }) as typeof fetch;
    expect(await runBlind({ ...OPTS, apply: true, yes: true }, h.deps)).toBe(1);
    expect(String(h.files.get('salida/hoja.html'))).toContain('Sin clip');
  });

  it('desvela los votos con la clave', () => {
    const key = assignBlind(['1', '2', '3'], ['fal:a', 'fal:b'], (n) => (n ? 0 : 0));
    expect(key['1']).toEqual({ A: 'fal:a', B: 'fal:b' });
    const flip = assignBlind(['1'], ['fal:a', 'fal:b'], () => 1);
    expect(flip['1']).toEqual({ A: 'fal:b', B: 'fal:a' });
    expect(tally({ '1': { A: 'fal:a', B: 'fal:b' }, '2': { A: 'fal:b', B: 'fal:a' }, '3': { A: 'fal:a', B: 'fal:b' } }, { '1': 'A', '2': 'A', '3': 'empate' })).toEqual({
      wins: { 'fal:a': 1, 'fal:b': 1 },
      ties: 1,
      total: 3,
    });
  });

  it('los movimientos son los mismos que los de la interfaz', async () => {
    const ui = await readFile(new URL('../../src/features/library/animateApi.ts', import.meta.url), 'utf8');
    for (const [id, prompt] of Object.entries(MOVEMENT_PROMPTS)) {
      expect(ui).toContain(`id: '${id}'`);
      expect(ui).toContain(`prompt: '${prompt}'`);
    }
  });

  it('el plan cuenta bien', () => {
    const plan = planBlind(PHOTOS, mediaModelsFromRows(ROWS), 10);
    expect(plan.totalMicros).toBe(5 * 10 * 60_000 + 5 * 10 * 84_000);
    expect(formatPlan(plan, 'orbit')).toContain('7,20 USD');
    expect(sheetHtml([], 'x', 5)).toContain('votos.json');
  });
});
