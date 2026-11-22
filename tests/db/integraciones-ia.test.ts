/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON de la función, sin tipar */
// Integraciones: IA sencilla (migración 20261222010000). Precios al día leídos por
// el servidor (fuente simulada: ninguna llamada real), configuración recomendada
// de OpenAI al guardar la clave, cambio de región y coste real por operación.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RpcClient } from '../../supabase/functions/_shared/ai/contract.ts';
import {
  buildAiOverview,
  buildApplyPlan,
  comparePrices,
  estimateCents,
  expectedMicros,
  openAiRegion,
  type AiContext,
} from '../../supabase/functions/_shared/integrations/ai-setup.ts';
import {
  extractSnapshot,
  loadPrices,
  PRICE_MIN_REFRESH_MS,
  PRICE_TTL_MS,
  type PriceSnapshot,
} from '../../supabase/functions/_shared/integrations/pricing.ts';
import { RECOMMENDED_TASKS } from '../../supabase/functions/_shared/integrations/recommendations.ts';
import { listOpenAiModels, probeIntegration } from '../../supabase/functions/_shared/integrations/probes.ts';
import { createSettingsLoader } from '../../supabase/functions/_shared/integrations/settings.ts';
import { createPlatformIntegrationsHandler } from '../../supabase/functions/platform-integrations/handler.ts';
import { as, asService, createBrand, createDb, createOrg, createUser, type Db, type TestUser } from './helpers';

/** Fuente simulada con la forma de la de LiteLLM (precios inventados solo en lo que no se compara con la realidad). */
const SOURCE = {
  'gpt-6-luna': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 1e-7, output_cost_per_token: 5e-7, cache_read_input_token_cost: 1e-8 },
  'gpt-6.1-terra': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 1e-6, output_cost_per_token: 5e-6, cache_read_input_token_cost: 5e-8 },
  'gpt-6.2-sol': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 },
  'gpt-transcribe': { litellm_provider: 'openai', mode: 'audio_transcription', input_cost_per_second: 0.000075 },
  'gpt-image-2.5-flare': {
    litellm_provider: 'openai',
    mode: 'image_generation',
    input_cost_per_image_token: 8e-6,
    output_cost_per_image_token: 3e-5,
  },
  'claude-haiku-5-5': { litellm_provider: 'anthropic', mode: 'chat', input_cost_per_token: 1e-7, output_cost_per_token: 5e-7, cache_read_input_token_cost: 1e-8, cache_creation_input_token_cost: 1.25e-7 },
  'claude-sonnet-5-5': { litellm_provider: 'anthropic', mode: 'chat', input_cost_per_token: 2e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 1e-7, cache_creation_input_token_cost: 2.5e-6 },
  // Mismo nombre, otro proveedor: no debe contar como de OpenAI.
  'gpt-6-sol': { litellm_provider: 'azure', mode: 'chat', input_cost_per_token: 9, output_cost_per_token: 9 },
};
const WANTED = {
  openai: ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-transcribe', 'gpt-image-2.5-flare', 'gpt-6-sol', 'no-existe'],
  claude: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
};
const NOW = new Date('2026-11-22T10:00:00Z');
const snapshot = (at = NOW): PriceSnapshot => extractSnapshot(SOURCE, WANTED, at);

describe('precios al día: la fuente', () => {
  it('extrae solo lo que se pide y del proveedor correcto, en dólares por millón', () => {
    const s = snapshot();
    expect(Object.keys(s.models).sort()).toEqual(
      ['claude-haiku-5-5', 'claude-sonnet-5-5', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-image-2.5-flare', 'gpt-transcribe'].sort(),
    );
    expect(s.models['gpt-6.1-terra']).toMatchObject({ provider: 'openai', inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.05 });
    expect(s.models['claude-haiku-5-5']).toMatchObject({ provider: 'claude', inputPerM: 0.1, outputPerM: 0.5, cacheWritePerM: 0.125 });
    expect(s.models['gpt-transcribe']).toMatchObject({ mode: 'transcription', perSecond: 0.000075 });
    // Imagen: solo por token de imagen, nunca por imagen.
    expect(s.models['gpt-image-2.5-flare']).toMatchObject({ mode: 'image', imageInputPerM: 8, imageOutputPerM: 30 });
    expect(s.models['gpt-6-sol']).toBeUndefined();
    expect(s.source).toBe('LiteLLM');
  });

  it('usa la lectura guardada mientras es reciente y no llama a la fuente', async () => {
    let calls = 0;
    const stored = snapshot(new Date(NOW.getTime() - 3 * 3_600_000));
    const r = await loadPrices({ stored, wanted: WANTED, now: NOW, readSource: async () => (calls++, SOURCE) });
    expect(calls).toBe(0);
    expect(r).toMatchObject({ fresh: false });
    expect(r.snapshot).toEqual(stored);
  });

  it('pasadas 12 h lee de nuevo; si la fuente falla, devuelve lo guardado y dice por qué', async () => {
    const old = snapshot(new Date(NOW.getTime() - PRICE_TTL_MS - 60_000));
    const ok = await loadPrices({ stored: old, wanted: WANTED, now: NOW, readSource: async () => SOURCE });
    expect(ok.fresh).toBe(true);
    expect(ok.snapshot!.fetchedAt).toBe(NOW.toISOString());

    const failed = await loadPrices({
      stored: old,
      wanted: WANTED,
      now: NOW,
      readSource: async () => {
        throw new Error('sin red');
      },
    });
    expect(failed.fresh).toBe(false);
    expect(failed.snapshot).toEqual(old);
    expect(failed.problem).toMatch(/últimos precios guardados/);

    const none = await loadPrices({
      stored: null,
      wanted: WANTED,
      now: NOW,
      readSource: async () => {
        throw new Error('sin red');
      },
    });
    expect(none.snapshot).toBeNull();
    expect(none.problem).toMatch(/todavía no hay/);
  });

  it('«Actualizar» salta la caché, salvo si la lectura es de hace minutos', async () => {
    let calls = 0;
    const read = async () => (calls++, SOURCE);
    await loadPrices({ stored: snapshot(new Date(NOW.getTime() - 60_000)), wanted: WANTED, now: NOW, readSource: read, force: true });
    expect(calls).toBe(0);
    await loadPrices({
      stored: snapshot(new Date(NOW.getTime() - PRICE_MIN_REFRESH_MS - 1)),
      wanted: WANTED,
      now: NOW,
      readSource: read,
      force: true,
    });
    expect(calls).toBe(1);
  });

  it('una fuente que no trae ninguno de los modelos no sustituye lo guardado', async () => {
    const stored = snapshot(new Date(NOW.getTime() - PRICE_TTL_MS - 1));
    const r = await loadPrices({ stored, wanted: WANTED, now: NOW, readSource: async () => ({ otro: {} }) });
    expect(r.fresh).toBe(false);
    expect(r.snapshot).toEqual(stored);
    expect(r.problem).toMatch(/no trae ninguno/);
  });
});

describe('configuración recomendada (lógica)', () => {
  const ctx = (env: Record<string, string>, available: string[] | null = null): AiContext => ({
    env,
    snapshot: snapshot(),
    available: available ? new Set(available) : null,
  });

  it('con solo la clave: procesa en la UE, elige barato para el copiloto y mejor para redactar, y carga los precios', () => {
    const plan = buildApplyPlan(ctx({ OPENAI_API_KEY: 'x' }), 'openai', 'defaults');
    expect(plan.changes).toMatchObject({
      OPENAI_BASE_URL: 'https://eu.api.openai.com',
      AI_TEXT_PROVIDER: 'openai',
      AI_TEXT_MODEL: 'gpt-6-luna',
      AI_TEXT_POST_CAPTION_PROVIDER: 'openai',
      AI_TEXT_POST_CAPTION_MODEL: 'gpt-6.1-terra',
      AI_TEXT_BRAND_CHECK_MODEL: 'gpt-6.1-terra',
    });
    expect(plan.changes.AI_TEXT_EDITOR_COPILOT_MODEL).toBeUndefined();
    const prices = JSON.parse(plan.changes.AI_PRICES!) as Record<string, Record<string, number>>;
    // Con recargo de la UE (+10 %).
    expect(prices['openai/gpt-6.1-terra']).toEqual({
      input_tokens: 1.1,
      output_tokens: 5.5,
      cache_read_input_tokens: 0.055,
    });
    expect(prices['openai/gpt-6-luna']!.input_tokens).toBeCloseTo(0.11, 6);
    expect(prices['openai/gpt-transcribe']).toEqual({ audio_seconds: 82.5 });
    expect(plan.activateImageModels).toEqual(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
  });

  it('con la clave sin más, si la cuenta no lista el barato se propone el siguiente', () => {
    const plan = buildApplyPlan(ctx({ OPENAI_API_KEY: 'x' }, ['gpt-6.1-terra', 'gpt-transcribe']), 'openai', 'defaults');
    expect(plan.changes.AI_TEXT_MODEL).toBe('gpt-6.1-terra');
    // Si todo es el mismo modelo no hacen falta excepciones por tarea.
    expect(plan.changes.AI_TEXT_POST_CAPTION_MODEL).toBeUndefined();
    expect(plan.activateImageModels).toEqual([]);
  });

  it('al guardar la clave no pisa lo que ya estaba elegido ni los precios ya puestos', () => {
    const plan = buildApplyPlan(
      ctx({
        OPENAI_API_KEY: 'x',
        OPENAI_BASE_URL: 'https://eu.api.openai.com',
        AI_TEXT_PROVIDER: 'anthropic-vertex',
        AI_TEXT_MODEL: 'claude-haiku-5-5',
        AI_PRICES: JSON.stringify({ 'openai/gpt-6.1-terra': { input_tokens: 9, output_tokens: 9 } }),
      }),
      'openai',
      'defaults',
    );
    expect(plan.changes.AI_TEXT_PROVIDER).toBeUndefined();
    expect(plan.changes.AI_TEXT_MODEL).toBeUndefined();
    expect(plan.notes.join(' ')).toMatch(/Ya había un modelo de texto elegido/);
    const prices = JSON.parse(plan.changes.AI_PRICES ?? '{}') as Record<string, unknown>;
    expect(prices['openai/gpt-6.1-terra']).toEqual({ input_tokens: 9, output_tokens: 9 });
  });

  it('con una clave que no admite el servidor europeo no se fuerza: en «defaults» se queda con la UE y la región es un clic aparte', () => {
    expect(openAiRegion({})).toBe('unset');
    expect(openAiRegion({ OPENAI_BASE_URL: 'https://eu.api.openai.com' })).toBe('eu');
    expect(openAiRegion({ OPENAI_BASE_URL: 'https://api.openai.com' })).toBe('global');
    // Ya admitido el tratamiento fuera de la UE: no se pone el servidor europeo.
    const plan = buildApplyPlan(ctx({ OPENAI_API_KEY: 'x', AI_ALLOW_NON_EU_PROCESSING: 'true' }), 'openai', 'defaults');
    expect(plan.changes.OPENAI_BASE_URL).toBeUndefined();
    // Sin recargo de la UE.
    const prices = JSON.parse(plan.changes.AI_PRICES!) as Record<string, Record<string, number>>;
    expect(prices['openai/gpt-6.1-terra']!.input_tokens).toBe(1);
  });

  it('«Usar estos precios» solo cambia la tabla de precios y mantiene lo demás', () => {
    const env = {
      OPENAI_API_KEY: 'x',
      OPENAI_BASE_URL: 'https://eu.api.openai.com',
      AI_TEXT_PROVIDER: 'openai',
      AI_TEXT_MODEL: 'gpt-6.1-terra',
      AI_PRICES: JSON.stringify({
        'openai/gpt-6.1-terra': { input_tokens: 3, output_tokens: 9 },
        'anthropic-vertex/otro': { input_tokens: 7, output_tokens: 7 },
      }),
    };
    const plan = buildApplyPlan(ctx(env), 'openai', 'prices');
    expect(Object.keys(plan.changes)).toEqual(['AI_PRICES']);
    const prices = JSON.parse(plan.changes.AI_PRICES!) as Record<string, Record<string, number>>;
    expect(prices['openai/gpt-6.1-terra']).toMatchObject({ input_tokens: 1.1, output_tokens: 5.5 });
    expect(prices['anthropic-vertex/otro']).toEqual({ input_tokens: 7, output_tokens: 7 });
  });

  it('Claude: solo precios, con el precio de escribir en caché, y sin tocar el proveedor de texto', () => {
    const plan = buildApplyPlan(ctx({}), 'claude', 'prices');
    expect(Object.keys(plan.changes)).toEqual(['AI_PRICES']);
    const prices = JSON.parse(plan.changes.AI_PRICES!) as Record<string, Record<string, number>>;
    expect(prices['anthropic-vertex/claude-haiku-5-5']).toEqual({
      input_tokens: 0.11,
      output_tokens: 0.55,
      cache_read_input_tokens: 0.011,
      cache_write_input_tokens: 0.1375,
    });
  });

  it('el resumen compara con lo cargado, estima el coste y dice lo que la fuente no da', () => {
    const env = {
      OPENAI_API_KEY: 'x',
      OPENAI_BASE_URL: 'https://eu.api.openai.com',
      AI_PRICES: JSON.stringify({ 'openai/gpt-6-luna': { input_tokens: 0.11, output_tokens: 0.55 }, 'openai/gpt-6.1-terra': { input_tokens: 5, output_tokens: 5 } }),
    };
    const overview = buildAiOverview(ctx(env, ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-transcribe']), {
      fetchedAt: null,
      stale: false,
      problem: null,
      modelsProblem: null,
    });
    const openai = overview.providers.openai;
    const status = (m: string) => openai.prices.find((p) => p.model === m)?.status;
    expect(status('gpt-6-luna')).toBe('same');
    expect(status('gpt-6.1-terra')).toBe('different');
    expect(status('gpt-transcribe')).toBe('same'); // el precio por defecto del código coincide
    const copilot = openai.tasks.find((t) => t.id === 'copilot')!;
    expect(copilot.recommended).toMatchObject({ model: 'gpt-6-luna', measured: 'sin medir con nuestros casos' });
    // 2.300 entrada + 200 salida a 0,11 / 0,55 USD por millón = 0,0363 céntimos.
    expect(copilot.recommended!.centsPerUse).toBeCloseTo(0.0363, 4);
    // Imagen: sin precio por imagen en la fuente, y se dice.
    expect(openai.monthly.notCounted).toEqual(expect.arrayContaining(['Crear una imagen', 'Editar una foto (cambiar el fondo, mejorar)']));
    expect(openai.monthly.usd).toBeGreaterThan(0);
    expect(openai.differing).toBe(1);
    expect(overview.source.officialUrl.openai).toMatch(/^https:\/\/developers\.openai\.com/);
    // Claude trae sugerencia y precio sin hacer falta configurarlo.
    expect(overview.providers.claude.tasks.find((t) => t.id === 'copilot')!.recommended).toMatchObject({
      model: 'claude-haiku-5-5',
      measured: expect.stringContaining('12 de 12'),
    });
    expect(overview.providers.claude.tasks.some((t) => t.kind !== 'text')).toBe(false);
  });

  it('comparar y estimar: sin fuente no se inventa nada', () => {
    const entry = snapshot().models['gpt-6-luna']!;
    expect(comparePrices({ input_tokens: 0.1, output_tokens: 0.5 }, expectedMicros(entry, 1))).toBe('same');
    expect(comparePrices(null, expectedMicros(entry, 1))).toBe('none');
    expect(comparePrices({ input_tokens: 1 }, null)).toBe('no_source');
    const task = RECOMMENDED_TASKS.find((t) => t.id === 'image_create')!;
    expect(estimateCents({ env: {}, snapshot: snapshot(), available: null }, task, 'openai', 'gpt-image-2.5-flare')).toBeNull();
  });
});

describe('probar conexión: la región', () => {
  const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });

  it('si la clave no es de un proyecto europeo, lo dice y ofrece el servidor general', async () => {
    const r = await probeIntegration(
      'ai_text',
      { OPENAI_API_KEY: 'sk-prueba', OPENAI_BASE_URL: 'https://eu.api.openai.com', AI_TEXT_PROVIDER: 'openai', AI_TEXT_MODEL: 'm', AI_PRICES: '{"openai/m":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":1}}' },
      { fetch: reply(401) },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/servidor europeo/);
    expect(r.message).toMatch(/fuera de la UE/);
    expect(r.fix).toBe('openai_global');
  });

  it('con el servidor general y la clave mala, el aviso es el de siempre y no ofrece cambiar de región', async () => {
    const r = await probeIntegration(
      'ai_text',
      { OPENAI_API_KEY: 'sk-prueba', OPENAI_BASE_URL: 'https://api.openai.com', AI_ALLOW_NON_EU_PROCESSING: 'true', AI_TEXT_PROVIDER: 'openai', AI_TEXT_MODEL: 'm', AI_PRICES: '{"openai/m":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":1}}' },
      { fetch: reply(401) },
    );
    expect(r.ok).toBe(false);
    expect(r.fix).toBeUndefined();
  });

  it('lista los modelos de la cuenta (gratis) y no revela la clave', async () => {
    const seen: string[] = [];
    const r = await listOpenAiModels(
      { OPENAI_API_KEY: 'sk-prueba' },
      {
        fetch: async (url, init) => {
          seen.push(url, JSON.stringify(init?.headers));
          return new Response(JSON.stringify({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-transcribe' }] }), { status: 200 });
        },
      },
    );
    expect(r).toEqual({ models: ['gpt-6-luna', 'gpt-transcribe'] });
    expect(seen[0]).toBe('https://api.openai.com/v1/models');
    expect(await listOpenAiModels({}, { fetch: reply(200) })).toEqual({ problem: 'Falta la clave de OpenAI.' });
  });
});

// ─────────────────────── la función, con la base de datos real ───────────────────────

let db: Db;
let root: TestUser, ana: TestUser;

function rpcAs(user: TestUser | null): RpcClient {
  return async (fn, args) => {
    const names = Object.keys(args).filter((n) => args[n] !== undefined);
    const params = names.map((n) => args[n]);
    const list = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
    const [meta] = await db.query<{ retset: boolean; void: boolean }>(
      `select p.proretset as retset, p.prorettype = 'void'::regtype as void from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = $1 limit 1`,
      [fn],
    );
    const sql = meta?.retset
      ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as data from public.${fn}(${list}) r`
      : meta?.void
        ? `select null::jsonb as data from (select public.${fn}(${list})) x`
        : `select to_jsonb(public.${fn}(${list})) as data`;
    try {
      const rows = user
        ? await as<{ data: unknown }>(db, user, sql, params)
        : await asService<{ data: unknown }>(db, sql, params);
      return { data: rows[0]?.data ?? null, error: null };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { data: null, error: { code, message } };
    }
  };
}

beforeAll(async () => {
  db = await createDb();
  root = await createUser(db, 'root@ia.test', 'Root');
  ana = await createUser(db, 'ana@ia.test', 'Ana');
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [root.id]);
});
afterAll(async () => {
  await db?.close();
});

describe('función platform-integrations: IA sencilla', () => {
  const tokens = new Map<string, TestUser>();
  let sourceCalls = 0;
  let sourceFails = false;
  let accountModels: string[] | { problem: string } = ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-transcribe', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
  let activated: string[][] = [];

  function handler() {
    const settings = createSettingsLoader({
      baseEnv: {},
      async readStored() {
        const [row] = await asService<{ data: Record<string, unknown> }>(db, `select public.integration_settings_for_service() as data`);
        return row!.data;
      },
    });
    return createPlatformIntegrationsHandler({
      rpc: rpcAs(null),
      userRpc: (token) => rpcAs(tokens.get(token) ?? null),
      authenticate: async (token) => (tokens.has(token) ? { userId: tokens.get(token)!.id } : null),
      settings,
      baseEnv: {},
      imageModelRows: async () => [],
      probe: async () => ({ ok: true, message: 'ok', checks: [] }),
      readPriceSource: async () => {
        sourceCalls++;
        if (sourceFails) throw new Error('sin red');
        return SOURCE;
      },
      listOpenAiModels: async () => (Array.isArray(accountModels) ? { models: accountModels } : accountModels),
      activateImageModels: async (models) => {
        activated.push(models);
        return models;
      },
      now: () => new Date('2026-11-22T10:00:00Z'),
    });
  }
  const post = async (token: string, body: unknown) => {
    const res = await handler()(
      new Request('http://funciones.test/platform-integrations', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const stored = async (key: string) =>
    (await db.query<{ v: string | null }>(`select plain_value as v from private.integration_settings where setting_key = $1`, [key]))[0]?.v ?? null;

  beforeAll(() => {
    tokens.set('t-root', root);
    tokens.set('t-ana', ana);
  });

  it('solo el superadministrador: los demás reciben 403', async () => {
    for (const body of [
      { action: 'ai_overview' },
      { action: 'ai_apply', provider: 'openai', scope: 'defaults' },
      { action: 'openai_region', region: 'global' },
    ]) {
      expect((await post('t-ana', body)).status).toBe(403);
    }
  });

  it('sin la clave de OpenAI no aplica nada; con precios sin fuente avisa y no inventa', async () => {
    const r = await post('t-root', { action: 'ai_apply', provider: 'openai', scope: 'defaults' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/clave de OpenAI/);
    sourceFails = true;
    await db.query(`delete from private.integration_settings where setting_key = 'AI_PRICE_SNAPSHOT'`);
    const o = await post('t-root', { action: 'ai_overview' });
    expect(o.status).toBe(200);
    expect(o.body.source).toMatchObject({ fetchedAt: null, stale: true });
    expect(o.body.source.problem).toMatch(/todavía no hay/);
    sourceFails = false;
  });

  it('lee la fuente, guarda la lectura y la reutiliza (caché); si falla después, usa la guardada', async () => {
    sourceCalls = 0;
    const first = await post('t-root', { action: 'ai_overview' });
    expect(first.body.source).toMatchObject({ name: 'LiteLLM', fetchedAt: '2026-11-22T10:00:00.000Z', stale: false, problem: null });
    expect(sourceCalls).toBe(1);
    expect(JSON.parse((await stored('AI_PRICE_SNAPSHOT'))!).models['gpt-6.1-terra'].inputPerM).toBe(1);

    await post('t-root', { action: 'ai_overview' });
    expect(sourceCalls).toBe(1);

    // «Actualizar» con una lectura de ahora mismo: tampoco llama.
    await post('t-root', { action: 'ai_overview', refresh: true });
    expect(sourceCalls).toBe(1);

    // Lectura vieja y la fuente caída: sigue funcionando con lo guardado.
    await db.query(
      `update private.integration_settings set plain_value = replace(plain_value, '2026-11-22T10:00:00.000Z', '2026-11-20T10:00:00.000Z') where setting_key = 'AI_PRICE_SNAPSHOT'`,
    );
    sourceFails = true;
    const stale = await post('t-root', { action: 'ai_overview' });
    expect(stale.status).toBe(200);
    expect(stale.body.source).toMatchObject({ stale: true, fetchedAt: '2026-11-20T10:00:00.000Z' });
    expect(stale.body.providers.openai.prices.length).toBeGreaterThan(0);
    sourceFails = false;
  });

  it('al guardar la clave se aplican los valores por defecto, y se pueden deshacer', async () => {
    await as(db, root, `select public.admin_set_integration_setting('OPENAI_API_KEY', 'sk-prueba-0123456789abcdef')`);
    activated = [];
    const r = await post('t-root', { action: 'ai_apply', provider: 'openai', scope: 'defaults' });
    expect(r.status).toBe(200);
    expect(await stored('OPENAI_BASE_URL')).toBe('https://eu.api.openai.com');
    expect(await stored('AI_TEXT_PROVIDER')).toBe('openai');
    expect(await stored('AI_TEXT_MODEL')).toBe('gpt-6-luna');
    expect(await stored('AI_TEXT_POST_CAPTION_MODEL')).toBe('gpt-6.1-terra');
    expect(JSON.parse((await stored('AI_PRICES'))!)['openai/gpt-6-luna']).toMatchObject({ input_tokens: 0.11 });
    expect(activated[0]).toEqual(expect.arrayContaining(['gpt-image-2.5-flare']));
    // Lo anterior para deshacer: nada estaba guardado.
    expect(r.body.previous).toMatchObject({ AI_TEXT_MODEL: null, OPENAI_BASE_URL: null });
    // La clave no aparece en ninguna respuesta.
    expect(JSON.stringify(r.body)).not.toContain('sk-prueba');

    // Deshacer = guardar lo anterior (null borra).
    for (const [key, value] of Object.entries(r.body.previous as Record<string, string | null>)) {
      if (value === null) await as(db, root, `select public.admin_delete_integration_setting($1)`, [key]);
      else await as(db, root, `select public.admin_set_integration_setting($1, $2)`, [key, value]);
    }
    expect(await stored('AI_TEXT_MODEL')).toBeNull();
    expect(await stored('AI_PRICES')).toBeNull();
  });

  it('con la cuenta sin el modelo barato propone el siguiente; sin poder mirar la cuenta lo dice', async () => {
    accountModels = ['gpt-6.1-terra', 'gpt-transcribe'];
    const o = await post('t-root', { action: 'ai_overview' });
    const copilot = o.body.providers.openai.tasks.find((t: any) => t.id === 'copilot');
    expect(copilot.recommended).toMatchObject({ model: 'gpt-6.1-terra', skipped: ['gpt-6-luna'], unchecked: false });
    expect(o.body.providers.openai.tasks.find((t: any) => t.id === 'image_create').recommended).toBeNull();

    accountModels = { problem: 'OpenAI no respondió a tiempo.' };
    const u = await post('t-root', { action: 'ai_overview' });
    expect(u.body.openaiModels).toEqual({ known: false, problem: 'OpenAI no respondió a tiempo.' });
    expect(u.body.providers.openai.tasks.find((t: any) => t.id === 'copilot').recommended).toMatchObject({ model: 'gpt-6-luna', unchecked: true });
    accountModels = ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-transcribe', 'gpt-image-2.5-flare'];
  });

  it('«Usar la configuración recomendada» sustituye lo elegido; «Usar estos precios» solo toca los precios', async () => {
    await as(db, root, `select public.admin_set_integration_setting('AI_TEXT_PROVIDER', 'openai')`);
    await as(db, root, `select public.admin_set_integration_setting('AI_TEXT_MODEL', 'gpt-6.2-sol')`);
    await as(db, root, `select public.admin_set_integration_setting('OPENAI_BASE_URL', 'https://eu.api.openai.com')`);
    await as(db, root, `select public.admin_set_integration_setting('AI_PRICES', $1)`, [JSON.stringify({ 'openai/gpt-6.2-sol': { input_tokens: 1, output_tokens: 1 } })]);

    const prices = await post('t-root', { action: 'ai_apply', provider: 'openai', scope: 'prices' });
    expect(prices.status).toBe(200);
    expect(Object.keys(prices.body.previous)).toEqual(['AI_PRICES']);
    expect(JSON.parse((await stored('AI_PRICES'))!)['openai/gpt-6.2-sol']).toMatchObject({ input_tokens: 2.2, output_tokens: 11 });
    expect(await stored('AI_TEXT_MODEL')).toBe('gpt-6.2-sol');

    const all = await post('t-root', { action: 'ai_apply', provider: 'openai', scope: 'all' });
    expect(all.status).toBe(200);
    expect(await stored('AI_TEXT_MODEL')).toBe('gpt-6-luna');
  });

  it('Claude solo admite precios y los carga con su clave de proveedor', async () => {
    expect((await post('t-root', { action: 'ai_apply', provider: 'claude', scope: 'all' })).status).toBe(400);
    const r = await post('t-root', { action: 'ai_apply', provider: 'claude', scope: 'prices' });
    expect(r.status).toBe(200);
    expect(JSON.parse((await stored('AI_PRICES'))!)['anthropic-vertex/claude-sonnet-5-5']).toMatchObject({ input_tokens: 2.2, output_tokens: 11 });
  });

  it('cambiar al servidor general: guarda la dirección y el permiso fuera de la UE, y ajusta los precios sin recargo', async () => {
    const before = JSON.parse((await stored('AI_PRICES'))!)['openai/gpt-6-luna'];
    expect(before.input_tokens).toBeCloseTo(0.11, 6);
    const r = await post('t-root', { action: 'openai_region', region: 'global' });
    expect(r.status).toBe(200);
    expect(await stored('OPENAI_BASE_URL')).toBe('https://api.openai.com');
    expect(await stored('AI_ALLOW_NON_EU_PROCESSING')).toBe('true');
    expect(await stored('AI_MEDIA_ALLOW_NON_EU')).toBe('true');
    expect(JSON.parse((await stored('AI_PRICES'))!)['openai/gpt-6-luna'].input_tokens).toBeCloseTo(0.1, 6);
    expect(r.body.previous.OPENAI_BASE_URL).toBe('https://eu.api.openai.com');

    const back = await post('t-root', { action: 'openai_region', region: 'eu' });
    expect(back.status).toBe(200);
    expect(await stored('OPENAI_BASE_URL')).toBe('https://eu.api.openai.com');
    expect(JSON.parse((await stored('AI_PRICES'))!)['openai/gpt-6-luna'].input_tokens).toBeCloseTo(0.11, 6);
    expect((await post('t-root', { action: 'openai_region', region: 'marte' })).status).toBe(400);
  });
});

describe('coste real por operación (platform_cost_per_operation)', () => {
  const PERIOD = '2026-11-01';

  it('suma lo liquidado por tarea y modelo, con los segundos de audio, sin simulados; solo superadministradores', async () => {
    const owner = await createUser(db, 'dueno@ia.test', 'Dueño');
    const org = await createOrg(db, owner, 'Org coste');
    const brand = await createBrand(db, owner, org, 'Marca coste');
    const gen = (task: string, purpose: string, provider: string, model: string, cost: number, usage: object = {}) =>
      db.query(
        `insert into public.ai_generations (brand_id, organization_id, requested_by, task, purpose, provider, model, status,
                                            period_start, reserved_micros, reserved_until, cost_micros, usage, finished_at)
         values ($1, $2, $3, $4::public.ai_task, $5, $6, $7, 'succeeded', $8::date, 1, now(), $9, $10::jsonb, now())`,
        [brand, org, owner.id, task, purpose, provider, model, PERIOD, cost, JSON.stringify(usage)],
      );
    await gen('text', 'editor.copilot', 'openai', 'gpt-6-luna', 400);
    await gen('text', 'editor.copilot', 'openai', 'gpt-6-luna', 600);
    await gen('text', 'post.caption', 'openai', 'gpt-6.1-terra', 3900);
    await gen('transcription', 'reel.subtitles', 'openai', 'gpt-transcribe', 1000, { audio_seconds: 120 });
    await gen('transcription', 'reel.subtitles', 'openai', 'gpt-transcribe', 500, { audio_seconds: 60.5 });
    await gen('text', 'post.caption', 'simulated', 'sim', 99999);

    const rows = await as<{ purpose: string; operations: string; cost_micros: string; audio_seconds: string }>(
      db,
      root,
      `select purpose, operations, cost_micros, audio_seconds from public.platform_cost_per_operation($1::date)
       where model <> 'zzz' order by purpose`,
      [PERIOD],
    );
    const by = (purpose: string) => rows.find((r) => r.purpose === purpose)!;
    expect(Number(by('editor.copilot').operations)).toBe(2);
    expect(Number(by('editor.copilot').cost_micros)).toBe(1000);
    expect(Number(by('post.caption').cost_micros)).toBe(3900); // sin el simulado
    expect(Number(by('reel.subtitles').audio_seconds)).toBeCloseTo(180.5, 3);
    expect(rows.some((r) => Number(r.cost_micros) === 99999)).toBe(false);

    await expect(
      as(db, ana, `select * from public.platform_cost_per_operation($1::date)`, [PERIOD]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      as(db, root, `select * from public.platform_cost_per_operation($1::date)`, ['2026-11-15']),
    ).rejects.toMatchObject({ code: '22023' });
  });
});
