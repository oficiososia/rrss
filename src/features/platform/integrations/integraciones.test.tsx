import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IntegrationSettingRow } from '@/lib/database.types';
import { ALL_AVAILABLE, fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import type { AiOverview } from './api';

// Plataforma → Integraciones y lo que cambia en el resto de la interfaz:
// el navegador manda los valores al guardar y nunca recibe un secreto de vuelta.

const NO_TEXT_TASKS = {
  'post.caption': false,
  'profile.proposal': false,
  'brand.check': false,
  'campaign.plan': false,
  'analytics.summary': false,
  'editor.copilot': false,
};

const SECRET = 'token-de-prueba-del-tunel-9f8e';
const WORKER_TOKEN = `rrss_wgt_${'q'.repeat(43)}`;

const payloads = (action: string) =>
  fake
    .callsTo('platform-integrations', 'function')
    .map((c) => c.payload as Record<string, unknown>)
    .filter((p) => p.action === action);

/** Servidor simulado de `platform-integrations` con estado: se comporta como la función real. */
function serveIntegrations(options: { availability?: Record<string, unknown>; environment?: string[] } = {}) {
  const settings: IntegrationSettingRow[] = [];
  const responses: unknown[] = [];
  fake.fn('platform-integrations', (raw) => {
    const body = raw as { action: string; integration?: string; values?: Record<string, string | null> };
    let reply: { status: number; body: unknown };
    if (body.action === 'availability') reply = { status: 200, body: { ...ALL_AVAILABLE } };
    else if (body.action === 'status') {
      reply = {
        status: 200,
        body: {
          settings: settings.map((s) => ({ ...s })),
          tests: [],
          audit: [],
          environment: options.environment ?? ['STRIPE_SECRET_KEY'],
          availability: { ...ALL_AVAILABLE, billing: false, ...options.availability },
        },
      };
    } else if (body.action === 'save') {
      for (const [key, value] of Object.entries(body.values ?? {})) {
        const at = settings.findIndex((s) => s.setting_key === key);
        if (at >= 0) settings.splice(at, 1);
        if (value === null) continue;
        const secret = key.endsWith('TOKEN') || key.endsWith('_KEY');
        // Como la base de datos: del secreto, solo la pista.
        settings.push({
          setting_key: key,
          integration: body.integration!,
          is_secret: secret,
          value: secret ? null : value,
          hint: secret ? `…${value.slice(-4)}` : null,
          updated_at: '2026-11-20T10:00:00Z',
          updated_by_email: 'yo@example.com',
        });
      }
      reply = { status: 200, body: { saved: Object.keys(body.values ?? {}) } };
    } else if (body.action === 'test') {
      reply = {
        status: 200,
        body: {
          ok: true,
          message: 'ComfyUI 0.9.1 responde.',
          checks: [{ name: 'ComfyUI', ok: true, message: 'ComfyUI 0.9.1 responde.' }],
        },
      };
    } else if (body.action === 'generate_worker_token') {
      // Como la función: guarda la huella y devuelve el token una sola vez.
      const at = settings.findIndex((s) => s.setting_key === 'WORKER_GATEWAY_TOKEN');
      if (at >= 0) settings.splice(at, 1);
      settings.push({
        setting_key: 'WORKER_GATEWAY_TOKEN',
        integration: 'media_worker',
        is_secret: true,
        value: null,
        hint: '…beef',
        updated_at: '2026-11-21T10:00:00Z',
        updated_by_email: 'yo@example.com',
      });
      reply = { status: 200, body: { token: WORKER_TOKEN } };
    } else if (body.action === 'ai_overview') reply = { status: 200, body: overview() };
    else reply = { status: 400, body: { error: { message: 'Acción desconocida.' } } };
    responses.push(reply.body);
    return reply;
  });
  return { settings, responses };
}

/** Lo que el servidor devuelve de precios y sugerencias (fuente simulada: ninguna llamada real). */
function overview(patch: Partial<AiOverview['source']> = {}, differing = 1): AiOverview {
  const luna = { input_tokens: 0.11, output_tokens: 0.55, cache_read_input_tokens: 0.011 };
  return {
    source: {
      name: 'LiteLLM',
      url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
      officialUrl: { openai: 'https://developers.openai.com/api/docs/pricing', claude: 'https://platform.claude.com/docs/en/about-claude/pricing' },
      fetchedAt: '2026-11-22T09:00:00Z',
      stale: false,
      problem: null,
      ...patch,
    },
    region: 'eu',
    openaiModels: { known: true, problem: null },
    providers: {
      openai: {
        tasks: [
          {
            id: 'copilot',
            label: 'Copiloto por voz del editor',
            kind: 'text',
            unit: 'orden',
            recommended: {
              model: 'gpt-6-luna',
              why: 'Rápido y barato para órdenes cortas.',
              measured: 'sin medir con nuestros casos',
              centsPerUse: 0.0363,
              skipped: [],
              unchecked: false,
            },
            current: null,
          },
          {
            id: 'captions',
            label: 'Pies de foto y textos de las piezas',
            kind: 'text',
            unit: 'pie',
            recommended: {
              model: 'gpt-6.1-terra',
              why: 'Mejor redacción que el barato.',
              measured: 'sin medir con nuestros casos',
              centsPerUse: 0.3,
              skipped: ['gpt-6.2-sol'],
              unchecked: false,
            },
            current: 'openai/gpt-6-luna',
          },
          {
            id: 'image_create',
            label: 'Crear una imagen',
            kind: 'image',
            unit: 'imagen',
            recommended: {
              model: 'gpt-image-2.5-flare',
              why: 'Rápido para generar desde cero.',
              measured: 'sin medir con nuestros casos',
              centsPerUse: null,
              skipped: [],
              unchecked: false,
            },
            current: null,
          },
        ],
        prices: [
          {
            provider: 'openai',
            model: 'gpt-6-luna',
            usedFor: ['Copiloto por voz del editor'],
            source: { mode: 'chat', inputPerM: 0.1, outputPerM: 0.5 },
            expected: luna,
            loaded: luna,
            status: 'same',
            surcharge: 1.1,
          },
          {
            provider: 'openai',
            model: 'gpt-6.1-terra',
            usedFor: ['Pies de foto y textos de las piezas'],
            source: { mode: 'chat', inputPerM: 1, outputPerM: 5 },
            expected: { input_tokens: 1.1, output_tokens: 5.5 },
            loaded: { input_tokens: 3, output_tokens: 9 },
            status: 'different',
            surcharge: 1.1,
          },
        ],
        monthly: { usd: 12.34, notCounted: ['Crear una imagen'] },
        differing,
      },
      claude: {
        tasks: [
          {
            id: 'copilot',
            label: 'Copiloto por voz del editor',
            kind: 'text',
            unit: 'orden',
            recommended: {
              model: 'claude-haiku-5-5',
              why: 'Rápido y barato para órdenes cortas.',
              measured: 'medido: 12 de 12 casos del copiloto (docs/copiloto-voz.md §8)',
              centsPerUse: 0.0363,
              skipped: [],
              unchecked: false,
            },
            current: null,
          },
        ],
        prices: [],
        monthly: { usd: 3.1, notCounted: [] },
        differing: 0,
      },
    },
  };
}

/** Las entradas y selectores de una tarjeta que NO están en «Opciones avanzadas». */
function simpleControls(card: HTMLElement, id: string) {
  const advanced = card.querySelector(`[data-testid="advanced-${id}"]`);
  return [...card.querySelectorAll('input, textarea, select')].filter((el) => !advanced?.contains(el));
}

describe('Plataforma → Integraciones', () => {
  it('«Qué ve la gente» dice qué tarea de texto está lista, una por una', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    vi.stubEnv('VITE_AI_VOICE_COPILOT_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    fake.fn('platform-integrations', (raw) => {
      const action = (raw as { action: string }).action;
      const availability = { ...ALL_AVAILABLE, aiTextTasks: { ...NO_TEXT_TASKS, 'editor.copilot': true } };
      return {
        status: 200,
        body:
          action === 'status' ? { settings: [], tests: [], audit: [], environment: [], availability } : availability,
      };
    });
    renderApp('/plataforma/integraciones');
    const flags = await screen.findByTestId('integration-flags');
    const row = (name: string) => within(flags).getByText(name).closest('li')!;
    expect(within(row('IA de texto · Copiloto por voz del editor')).getByText('Se enseña')).toBeInTheDocument();
    expect(within(row('IA de texto · Plan de campaña')).getByText('Sin configurar')).toBeInTheDocument();
    expect(within(row('IA de texto · Textos de las piezas')).getByText('Sin configurar')).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('el token del trabajador se genera, se enseña una vez y se puede revocar', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    const { user } = renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-video');
    const zone = within(card).getByTestId('setting-WORKER_GATEWAY_TOKEN');
    expect(within(zone).getByText('Sin generar')).toBeInTheDocument();
    // No hay campo para pegarlo a mano.
    expect(within(zone).queryByRole('textbox')).toBeNull();
    await user.click(within(zone).getByTestId('integration-generate-worker-token'));
    expect(await within(zone).findByTestId('worker-token-value')).toHaveValue(WORKER_TOKEN);
    expect(within(zone).getByText(/no se volverá a ver/)).toBeInTheDocument();
    expect(await within(zone).findByText('Generado')).toBeInTheDocument();
    // Revocar: borra el ajuste (con confirmación).
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(within(zone).getByTestId('integration-revoke-worker-token'));
    await waitFor(() => expect(server.settings.find((r) => r.setting_key === 'WORKER_GATEWAY_TOKEN')).toBeUndefined());
    expect(within(zone).queryByTestId('worker-token-value')).toBeNull();
  });

  it('quien no es superadministrador no la ve', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp('/plataforma/integraciones');
    expect(await screen.findByText('Zona reservada')).toBeInTheDocument();
    expect(fake.callsTo('platform-integrations', 'function')).toEqual([]);
  });

  it('el superadministrador guarda ComfyUI, lo prueba y lo ve configurado sin ver el secreto', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    const { user } = renderApp('/plataforma/integraciones');

    const card = await screen.findByTestId('integration-comfyui');
    expect(within(card).getAllByText('Sin configurar').length).toBeGreaterThan(1);

    const url = within(within(card).getByTestId('setting-COMFYUI_BASE_URL')).getByRole('textbox');
    await user.type(url, 'https://tunel.ejemplo.test');
    const token = within(card).getByLabelText(/Token de acceso/);
    expect(token).toHaveAttribute('type', 'password');
    await user.type(token, SECRET);
    // La región está en «Opciones avanzadas» y se guarda con el mismo botón.
    await user.selectOptions(within(card).getByLabelText(/Región de los datos/), 'eu');
    await user.click(within(card).getByTestId('integration-save'));

    await waitFor(() => expect(server.settings).toHaveLength(3));
    expect(payloads('save')[0]).toEqual({
      action: 'save',
      integration: 'comfyui',
      values: { COMFYUI_BASE_URL: 'https://tunel.ejemplo.test', COMFYUI_API_TOKEN: SECRET, COMFYUI_DATA_REGION: 'eu' },
    });

    // Tras guardar: configurado, la pista y quién; el campo del secreto vacío.
    const state = await within(card).findByTestId('setting-state-COMFYUI_API_TOKEN');
    await within(state).findByText('Configurado');
    expect(state).toHaveTextContent('…9f8e');
    expect(state).toHaveTextContent('yo@example.com');
    expect(within(card).getByLabelText(/Token de acceso/)).toHaveValue('');
    expect(document.body.textContent).not.toContain(SECRET);
    // Ninguna respuesta del servidor llevó el secreto.
    expect(JSON.stringify(server.responses)).not.toContain(SECRET);

    await user.click(within(card).getByTestId('integration-test'));
    expect(await within(card).findByTestId('integration-test-result')).toHaveTextContent('Funciona');

    // Lo que viene de una variable de entorno se dice, en llano y sin valor.
    const stripe = await screen.findByTestId('integration-stripe');
    expect(within(stripe).getByTestId('setting-state-STRIPE_SECRET_KEY')).toHaveTextContent(
      'Ya está puesta en el servidor',
    );
  });

  it('borrar un ajuste manda null y el servidor deja de tenerlo', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    server.settings.push({
      setting_key: 'COMFYUI_API_TOKEN',
      integration: 'comfyui',
      is_secret: true,
      value: null,
      hint: '…abcd',
      updated_at: '2026-11-19T10:00:00Z',
      updated_by_email: 'otra@example.com',
    });
    const { user } = renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-comfyui');
    const field = await within(card).findByTestId('setting-COMFYUI_API_TOKEN');
    await user.click(within(field).getByRole('button', { name: 'Borrar' }));
    await user.click(within(card).getByTestId('integration-save'));
    await waitFor(() => expect(server.settings).toEqual([]));
  });
});

describe('vista sencilla', () => {
  it('una tarjeta por servicio, con nombre llano; OpenAI es una sola aunque sus ajustes estén en dos integraciones', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    renderApp('/plataforma/integraciones');
    await screen.findByTestId('integration-openai');
    const titles = [
      'OpenAI',
      'Claude (Anthropic / Google Cloud)',
      'Instagram (Meta)',
      'Almacenamiento (Cloudflare R2)',
      'Máquina de vídeo (Fly.io)',
      'fal.ai — animar fotos',
      'Google Drive',
      'Pagos (Stripe)',
      'ComfyUI propio',
    ];
    for (const title of titles) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getAllByTestId('integration-openai')).toHaveLength(1);
    // Ya no hay una pestaña por integración técnica.
    expect(screen.queryByRole('tab', { name: 'IA de texto' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'IA de imagen' })).toBeNull();
    expect(screen.queryByTestId('integration-ai_text')).toBeNull();
  });

  it('OpenAI: en la vista sencilla solo hay una clave, y todo lo demás cuelga de «Opciones avanzadas»', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-openai');
    const controls = simpleControls(card, 'openai');
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('type', 'password');
    expect(within(card).getByTestId('service-status-openai')).toHaveTextContent('Falta la clave');

    // Nada de nombres de variable fuera de «Opciones avanzadas».
    const advanced = within(card).getByTestId('advanced-openai');
    expect(advanced.tagName).toBe('DETAILS');
    for (const code of card.querySelectorAll('code')) expect(advanced.contains(code)).toBe(true);
    for (const key of ['AI_TEXT_PROVIDER', 'AI_TEXT_MODEL', 'AI_PRICES', 'OPENAI_BASE_URL', 'AI_ALLOW_NON_EU_PROCESSING']) {
      expect(within(advanced).getByText(key)).toBeInTheDocument();
    }
    // Las excepciones por tarea y los modelos de imagen (de otra integración) también están ahí.
    expect(within(advanced).getByLabelText(/Copiloto por voz del editor · modelo/)).toBeInTheDocument();
    expect(within(advanced).getByText('AI_MEDIA_IMAGE_MODEL')).toBeInTheDocument();
    expect(card.textContent).not.toContain('En la variable de entorno del servidor');
  });

  it('cada tarjeta dice qué enciende y qué no, y por qué', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations({
      availability: { aiImage: false, reelSubtitles: false, aiTextTasks: { ...NO_TEXT_TASKS, 'post.caption': true } },
    });
    renderApp('/plataforma/integraciones');
    const unlocks = within(await screen.findByTestId('unlocks-openai'));
    expect(unlocks.getByText('Con esto se enciende')).toBeInTheDocument();
    const row = (text: string) => unlocks.getByText(text, { exact: false }).closest('li')!;
    expect(row('Pies de foto y textos de las piezas')).toHaveTextContent('activa');
    expect(row('Copiloto por voz del editor')).toHaveTextContent('todavía no, falta la clave o el modelo de texto');
    expect(row('Crear y editar imágenes con IA')).toHaveTextContent('todavía no');
    expect(row('Subtítulos automáticos de los reels')).toHaveTextContent('todavía no');
  });

  it('«Qué funciona ahora» resume en 8 funciones llanas cuáles funcionan y de qué tarjeta dependen las que no', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations({ availability: { aiImage: false, billing: false, aiTextTasks: { ...NO_TEXT_TASKS, 'post.caption': true } } });
    renderApp('/plataforma/integraciones');
    const summary = within(await screen.findByTestId('working-now'));
    expect(summary.getAllByRole('listitem')).toHaveLength(8);
    const row = (text: string) => summary.getByText(text).closest('li')!;
    expect(within(row('Escribir pies de foto y textos')).getByText('Funciona')).toBeInTheDocument();
    expect(within(row('Publicar en Instagram')).getByText('Funciona')).toBeInTheDocument();
    const images = row('Crear y editar imágenes con IA');
    expect(images).toHaveTextContent('No disponible · falta OpenAI');
    expect(within(images).getByRole('link', { name: 'OpenAI' })).toHaveAttribute('href', '#integration-openai');
    expect(row('Cobrar los planes')).toHaveTextContent('falta Pagos (Stripe)');
  });

  it('el estado de cada tarjeta es una palabra con color: Falta la clave, Falta algo, Sin probar', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations({ availability: { aiText: false, aiImage: false, reelSubtitles: false } });
    server.settings.push({
      setting_key: 'OPENAI_API_KEY',
      integration: 'ai_text',
      is_secret: true,
      value: null,
      hint: '…abcd',
      updated_at: '2026-11-19T10:00:00Z',
      updated_by_email: 'otra@example.com',
    });
    renderApp('/plataforma/integraciones');
    const openai = await screen.findByTestId('integration-openai');
    expect(within(openai).getByTestId('service-status-openai')).toHaveTextContent('Falta algo');
    expect(within(openai).getByTestId('service-detail-openai')).toHaveTextContent('Falta la región');
    // Stripe: la clave viene del servidor, falta lo demás.
    const stripe = screen.getByTestId('integration-stripe');
    expect(within(stripe).getByTestId('service-status-stripe')).toHaveTextContent('Falta algo');
    expect(within(stripe).getByTestId('service-detail-stripe')).toHaveTextContent(/el secreto de los avisos de Stripe/);
    // Los opcionales sin tocar no son un problema.
    expect(within(screen.getByTestId('integration-comfyui')).getByTestId('service-status-comfyui')).toHaveTextContent(
      'Sin configurar',
    );
  });
});

describe('valores por defecto al guardar la clave de OpenAI', () => {
  it('guarda la clave y deja listo lo demás sin tocar nada más; se puede deshacer', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    const previous = { OPENAI_BASE_URL: null, AI_TEXT_PROVIDER: null, AI_TEXT_MODEL: null, AI_PRICES: null, AI_MEDIA_ALLOW_NON_EU: 'false' };
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string; integration?: string; values?: Record<string, string | null> };
      if (body.action === 'ai_apply') {
        return {
          status: 200,
          body: {
            previous,
            applied: [{ key: 'AI_TEXT_MODEL', from: null, to: 'gpt-6-luna' }],
            notes: ['Procesado en la UE (servidor europeo de OpenAI).'],
            activatedImageModels: ['gpt-image-2.5-flare'],
          },
        };
      }
      // Lo demás, como el servidor de antes.
      return serveOnce(server, body);
    });
    const { user } = renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-openai');

    await user.type(within(card).getByLabelText(/Clave de OpenAI/), 'sk-prueba-0123456789abcdef');
    await user.click(within(card).getByTestId('integration-save'));

    // Primero la clave, sola; después los valores por defecto (ninguno lo teclea la persona).
    await waitFor(() => expect(payloads('ai_apply')).toHaveLength(1));
    expect(payloads('save')[0]).toEqual({
      action: 'save',
      integration: 'ai_text',
      values: { OPENAI_API_KEY: 'sk-prueba-0123456789abcdef' },
    });
    expect(payloads('ai_apply')[0]).toEqual({ action: 'ai_apply', provider: 'openai', scope: 'defaults' });
    const notice = await within(card).findByTestId('applied-notice');
    expect(notice).toHaveTextContent('Se ha dejado todo lo demás listo');
    expect(notice).toHaveTextContent('Procesado en la UE');
    expect(document.body.textContent).not.toContain('sk-prueba-0123456789abcdef');

    // Deshacer: vuelve a guardar lo anterior, una llamada por integración, borrando lo que no había.
    await user.click(within(notice).getByTestId('undo-applied'));
    await waitFor(() => expect(payloads('save')).toHaveLength(3));
    const saves = payloads('save').slice(1);
    expect(saves).toContainEqual({
      action: 'save',
      integration: 'ai_text',
      values: { OPENAI_BASE_URL: null, AI_TEXT_PROVIDER: null, AI_TEXT_MODEL: null, AI_PRICES: null },
    });
    expect(saves).toContainEqual({ action: 'save', integration: 'ai_image', values: { AI_MEDIA_ALLOW_NON_EU: 'false' } });
  });

  it('si no se pueden aplicar los valores por defecto, la clave queda guardada y se dice qué hacer', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string };
      if (body.action === 'ai_apply') {
        return { status: 502, body: { error: { message: 'No se han podido leer los precios al día.' } } };
      }
      return serveOnce(server, body as never);
    });
    const { user } = renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-openai');
    await user.type(within(card).getByLabelText(/Clave de OpenAI/), 'sk-prueba-0123456789abcdef');
    await user.click(within(card).getByTestId('integration-save'));
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('La clave está guardada');
    expect(alert).toHaveTextContent('Usar la configuración recomendada');
    expect(server.settings.some((s) => s.setting_key === 'OPENAI_API_KEY')).toBe(true);
  });
});

describe('región de OpenAI', () => {
  it('si la clave no es de un proyecto europeo, «Probar conexión» lo dice y ofrece el servidor general en un clic', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    server.settings.push({
      setting_key: 'OPENAI_API_KEY',
      integration: 'ai_text',
      is_secret: true,
      value: null,
      hint: '…abcd',
      updated_at: '2026-11-19T10:00:00Z',
      updated_by_email: 'otra@example.com',
    });
    let probes = 0;
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string; integration?: string; values?: Record<string, string | null>; region?: string };
      if (body.action === 'test') {
        probes += 1;
        return {
          status: 200,
          body:
            probes === 1
              ? {
                  ok: false,
                  message:
                    'OpenAI no acepta esta clave en su servidor europeo. Lo más habitual es que la clave no sea de un proyecto con región Europa; también puede estar mal copiada. Si no tienes un proyecto europeo, puedes usar el servidor general (los datos se tratarían fuera de la UE).',
                  checks: [],
                  fix: 'openai_global',
                }
              : { ok: true, message: 'OpenAI acepta la clave (api.openai.com).', checks: [] },
        };
      }
      if (body.action === 'openai_region') {
        return {
          status: 200,
          body: {
            previous: { OPENAI_BASE_URL: 'https://eu.api.openai.com', AI_ALLOW_NON_EU_PROCESSING: null, AI_MEDIA_ALLOW_NON_EU: null },
            applied: [],
            notes: [],
          },
        };
      }
      return serveOnce(server, body as never);
    });
    const { user } = renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-openai');
    await user.click(within(card).getByTestId('integration-test'));
    const result = await within(card).findByTestId('integration-test-result');
    expect(result).toHaveTextContent('No funciona');
    expect(result).toHaveTextContent('servidor europeo');
    // La salida no pide tocar ninguna dirección: un botón y el aviso de los datos.
    const fix = await within(card).findByTestId('openai-region-fix');
    expect(fix).toHaveTextContent('fuera de la UE');
    await user.click(within(fix).getByTestId('openai-use-global'));

    await waitFor(() => expect(payloads('openai_region')).toEqual([{ action: 'openai_region', region: 'global' }]));
    const notice = await within(card).findByTestId('applied-notice');
    expect(notice).toHaveTextContent('servidor general');
    expect(notice).toHaveTextContent('fuera de la UE');
    // Vuelve a probar sola, ya con el servidor general.
    await waitFor(() => expect(probes).toBe(2));
    expect(await within(card).findByTestId('integration-test-result')).toHaveTextContent('Funciona');
  });
});

describe('«Probar conexión» de la IA de texto genera de verdad', () => {
  const COST =
    'Probar conexión hace una generación mínima real (1 token de salida) por cada modelo configurado: coste despreciable, pero no cero.';

  it('las tarjetas de IA de texto avisan del coste junto al botón; las demás no', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    renderApp('/plataforma/integraciones');
    const openai = await screen.findByTestId('integration-openai');
    const hint = within(openai).getByTestId('integration-test-hint');
    expect(hint).toHaveTextContent(COST);
    // Ya no promete que no gasta.
    expect(hint).not.toHaveTextContent(/No genera nada|ni gasta/);
    // El aviso está al lado del botón: en el mismo formulario.
    expect(hint.closest('form')).toBe(within(openai).getByTestId('integration-test').closest('form'));
    // Claude también genera al probar (solo con lo suyo): mismo aviso.
    expect(within(screen.getByTestId('integration-claude')).getByTestId('integration-test-hint')).toHaveTextContent(COST);
    // Las pruebas que no generan nada no llevan el aviso.
    for (const id of ['comfyui', 'stripe', 'meta']) {
      const other = within(screen.getByTestId(`integration-${id}`)).getByTestId('integration-test-hint');
      expect(other).not.toHaveTextContent('generación mínima real');
    }
  });

  it('si la clave lista modelos pero el servidor la rechaza al generar, sale «No funciona» con el motivo y el detalle', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    server.settings.push({
      setting_key: 'OPENAI_API_KEY',
      integration: 'ai_text',
      is_secret: true,
      value: null,
      hint: '…abcd',
      updated_at: '2026-11-19T10:00:00Z',
      updated_by_email: 'otra@example.com',
    });
    const rejected =
      'La clave lista modelos, pero el servidor europeo de OpenAI (eu.api.openai.com) la rechaza al generar con «gpt-6-luna» (401): revisa que la clave sea de un proyecto con región Europa.';
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string; integration?: string; values?: Record<string, string | null> };
      if (body.action === 'test') {
        return {
          status: 200,
          body: {
            ok: false,
            message: rejected,
            fix: 'openai_global',
            checks: [
              { name: 'OpenAI', ok: true, message: 'OpenAI acepta la clave (eu.api.openai.com).' },
              { name: 'Generar con openai/gpt-6-luna', ok: false, message: rejected, fix: 'openai_global' },
              {
                name: 'Coste de la prueba',
                ok: null,
                message:
                  'Se ha hecho 1 generación mínima real (1 token de salida por cada modelo configurado): coste despreciable, pero no cero. No consume el cupo de ninguna organización.',
              },
            ],
          },
        };
      }
      return serveOnce(server, body);
    });
    const { user } = renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-openai');
    await user.click(within(card).getByTestId('integration-test'));
    // Pide solo lo de OpenAI: la tarjeta no prueba (ni paga) lo de Claude.
    expect(payloads('test')).toEqual([{ action: 'test', integration: 'ai_text', service: 'openai' }]);
    const result = await within(card).findByTestId('integration-test-result');
    expect(result).toHaveTextContent('No funciona');
    expect(result).toHaveTextContent('la rechaza al generar con «gpt-6-luna» (401)');
    // El detalle: listar fue bien, generar no, y lo que ha costado la prueba.
    expect(within(result).getByLabelText('Bien').closest('li')).toHaveTextContent('OpenAI acepta la clave');
    expect(within(result).getByLabelText('Mal').closest('li')).toHaveTextContent('Generar con openai/gpt-6-luna');
    expect(within(result).getByLabelText('No se comprueba').closest('li')).toHaveTextContent(
      'coste despreciable, pero no cero',
    );
    // Y sigue ofreciendo el servidor general en un clic.
    expect(await within(card).findByTestId('openai-region-fix')).toBeInTheDocument();
  });
});

describe('cada tarjeta prueba y enseña solo lo suyo', () => {
  const setting = (key: string, integration: string, secret = true): IntegrationSettingRow => ({
    setting_key: key,
    integration,
    is_secret: secret,
    value: secret ? null : 'valor',
    hint: secret ? '…abcd' : null,
    updated_at: '2026-11-19T10:00:00Z',
    updated_by_email: 'otra@example.com',
  });
  const OPENAI_TEST = {
    integration: 'ai_text',
    ok: true,
    message: 'OpenAI acepta la clave (eu.api.openai.com).',
    tested_at: '2026-11-22T10:00:00Z',
    tested_by_email: 'yo@example.com',
  };

  /** Servidor con claves de OpenAI, Claude (Vertex), fal.ai y Black Forest Labs, y las pruebas guardadas que se le den. */
  function serveWithTests(tests: unknown[], reply: (body: { integration?: string; service?: string }) => unknown) {
    const server = serveIntegrations();
    server.settings.push(
      setting('OPENAI_API_KEY', 'ai_text'),
      setting('AI_VERTEX_PROJECT_ID', 'ai_text', false),
      setting('AI_VERTEX_LOCATION', 'ai_text', false),
      setting('AI_VERTEX_SERVICE_ACCOUNT_JSON', 'ai_text'),
      setting('FAL_KEY', 'ai_image'),
      setting('AI_MEDIA_ALLOW_NON_EU', 'ai_image', false),
      setting('BFL_API_KEY', 'ai_image'),
    );
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string; integration?: string; service?: string };
      if (body.action === 'test') return { status: 200, body: reply(body) };
      const usual = serveOnce(server, body);
      if (body.action === 'status') (usual.body as { tests: unknown[] }).tests = tests;
      return usual;
    });
  }

  it('la tarjeta de Claude no enseña la última prueba de OpenAI: tiene la suya', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveWithTests([OPENAI_TEST], () => ({ ok: true, message: '', checks: [] }));
    renderApp('/plataforma/integraciones');
    const openai = await screen.findByTestId('integration-openai');
    expect(within(openai).getByTestId('integration-last-test')).toHaveTextContent('OpenAI acepta la clave');
    const claude = screen.getByTestId('integration-claude');
    // Antes: «Funcionaba en la última prueba … OpenAI acepta la clave» también aquí.
    expect(within(claude).queryByTestId('integration-last-test')).toBeNull();
    expect(claude).not.toHaveTextContent('OpenAI acepta la clave');
    expect(within(claude).getByTestId('service-status-claude')).toHaveTextContent('Sin probar');
    expect(claude).toHaveTextContent('Todavía no se ha probado.');
  });

  it('«Probar conexión» en Claude pide solo lo de Claude y enseña solo su resultado', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const access = 'Google da acceso a la cuenta de servicio rrss@proyecto.iam.gserviceaccount.com.';
    serveWithTests([OPENAI_TEST], (body) =>
      body.service === 'claude'
        ? {
            ok: true,
            message: access,
            checks: [
              { name: 'Google Vertex AI', ok: true, message: access },
              { name: 'Tareas', ok: null, message: 'Ninguna tarea de texto usa todavía este acceso: no se ha probado a generar.' },
            ],
          }
        : { ok: true, message: 'OpenAI acepta la clave (eu.api.openai.com).', checks: [] },
    );
    const { user } = renderApp('/plataforma/integraciones');
    const claude = await screen.findByTestId('integration-claude');
    await user.click(within(claude).getByTestId('integration-test'));
    expect(payloads('test')).toEqual([{ action: 'test', integration: 'ai_text', service: 'claude' }]);
    const result = await within(claude).findByTestId('integration-test-result');
    expect(result).toHaveTextContent('Funciona. Google da acceso a la cuenta de servicio');
    expect(result).not.toHaveTextContent('OpenAI');
    // El estado de la tarjeta sigue al resultado, aunque el servidor aún no lo tenga anotado.
    expect(within(claude).getByTestId('service-status-claude')).toHaveTextContent('Funciona');
    // La de OpenAI no se entera de la prueba de Claude.
    const openai = screen.getByTestId('integration-openai');
    expect(within(openai).queryByTestId('integration-test-result')).toBeNull();
    expect(within(openai).getByTestId('integration-test-hint')).not.toHaveTextContent('Claude');
    expect(within(claude).getByTestId('integration-test-hint')).toHaveTextContent('No prueba OpenAI');
  });

  it('la prueba guardada de Claude sale en Claude y no en OpenAI', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveWithTests(
      [
        OPENAI_TEST,
        {
          integration: 'ai_text_claude',
          ok: false,
          message: 'Google no da acceso a la cuenta de servicio.',
          tested_at: '2026-11-22T11:00:00Z',
          tested_by_email: null,
        },
      ],
      () => ({ ok: true, message: '', checks: [] }),
    );
    renderApp('/plataforma/integraciones');
    const claude = await screen.findByTestId('integration-claude');
    expect(within(claude).getByTestId('service-status-claude')).toHaveTextContent('No funciona');
    expect(within(claude).getByTestId('integration-last-test')).toHaveTextContent('Google no da acceso');
    const openai = screen.getByTestId('integration-openai');
    expect(within(openai).getByTestId('service-status-openai')).toHaveTextContent('Funciona');
    expect(openai).not.toHaveTextContent('Google no da acceso');
  });

  it('fal.ai y «Otras imágenes con IA» tampoco se pisan: cada una pide lo suyo', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveWithTests(
      [
        {
          integration: 'ai_image',
          ok: true,
          message: 'Black Forest Labs acepta la clave.',
          tested_at: '2026-11-22T10:00:00Z',
          tested_by_email: null,
        },
      ],
      (body) => ({ ok: true, message: `prueba de ${body.service}`, checks: [] }),
    );
    const { user } = renderApp('/plataforma/integraciones');
    const fal = await screen.findByTestId('integration-fal');
    const others = screen.getByTestId('integration-images_other');
    expect(fal).not.toHaveTextContent('Black Forest Labs acepta la clave');
    expect(within(others).getByTestId('integration-last-test')).toHaveTextContent('Black Forest Labs acepta la clave');
    await user.click(within(fal).getByTestId('integration-test'));
    await within(fal).findByTestId('integration-test-result');
    await user.click(within(others).getByTestId('integration-test'));
    await within(others).findByTestId('integration-test-result');
    expect(payloads('test')).toEqual([
      { action: 'test', integration: 'ai_image', service: 'fal' },
      { action: 'test', integration: 'ai_image', service: 'images_other' },
    ]);
    expect(within(fal).getByTestId('integration-test-result')).toHaveTextContent('prueba de fal');
    expect(within(others).getByTestId('integration-test-result')).toHaveTextContent('prueba de images_other');
    // Las que no comparten integración siguen como siempre, sin `service`.
    const stripe = screen.getByTestId('integration-stripe');
    await user.click(within(stripe).getByTestId('integration-test'));
    await within(stripe).findByTestId('integration-test-result');
    expect(payloads('test').at(-1)).toEqual({ action: 'test', integration: 'stripe' });
  });
});

describe('precios al día y sugerencias de modelo', () => {
  it('enseña la sugerencia por tarea con su precio por uso, de dónde salen los precios y qué no se ha medido', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    renderApp('/plataforma/integraciones');
    const advisor = within(await screen.findByTestId('ai-advisor-openai'));
    const copilot = await advisor.findByTestId('ai-task-copilot');
    expect(copilot).toHaveTextContent('Recomendado: gpt-6-luna');
    expect(copilot).toHaveTextContent('≈ 0,036 céntimos por orden');
    expect(copilot).toHaveTextContent('Rápido y barato para órdenes cortas.');
    expect(copilot).toHaveTextContent('sin medir con nuestros casos');
    expect(advisor.getByTestId('ai-task-captions')).toHaveTextContent('Se salta gpt-6.2-sol');
    expect(advisor.getByTestId('ai-task-captions')).toHaveTextContent('Ahora usa: openai/gpt-6-luna');
    // Imagen: la fuente no da precio por imagen y no se inventa.
    expect(advisor.getByTestId('ai-task-image_create')).toHaveTextContent('sin precio por imagen en la fuente');
    expect(advisor.getByTestId('ai-monthly-openai')).toHaveTextContent('12,34');
    expect(advisor.getByTestId('ai-monthly-openai')).toHaveTextContent('sin contar: crear una imagen');
    expect(advisor.getByTestId('ai-source-openai')).toHaveTextContent(
      /Precios de LiteLLM, actualizados el .+; no es la tarifa oficial de tu cuenta\./,
    );
    expect(advisor.getByRole('link', { name: 'Tarifa oficial de OpenAI' })).toHaveAttribute(
      'href',
      'https://developers.openai.com/api/docs/pricing',
    );
  });

  it('compara con el precio cargado; si difiere avisa y «Usar estos precios» lo corrige en un clic, deshaciéndose', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations();
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string; provider?: string; scope?: string };
      if (body.action === 'ai_apply') {
        return {
          status: 200,
          body: { previous: { AI_PRICES: '{"openai/gpt-6.1-terra":{"input_tokens":3,"output_tokens":9}}' }, applied: [], notes: [] },
        };
      }
      return serveOnce(server, body as never);
    });
    const { user } = renderApp('/plataforma/integraciones');
    const advisor = within(await screen.findByTestId('ai-advisor-openai'));
    const differs = await advisor.findByTestId('ai-differs-openai');
    expect(differs).toHaveTextContent('no coincide con el de la fuente');
    const rows = within(advisor.getByTestId('ai-prices-openai')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('gpt-6-luna');
    expect(rows[0]).toHaveTextContent('Igual');
    expect(rows[1]).toHaveTextContent('gpt-6.1-terra');
    expect(rows[1]).toHaveTextContent('Distinto');
    expect(rows[1]).toHaveTextContent('Al día: 1 $ entrada · 5 $ salida');
    expect(rows[1]).toHaveTextContent('Cargado en la app: 3 $ entrada · 9 $ salida');
    expect(rows[1]).toHaveTextContent('incluyen un 10 % por procesar en la UE');

    await user.click(within(differs).getByTestId('ai-use-prices-openai'));
    await waitFor(() => expect(payloads('ai_apply')).toEqual([{ action: 'ai_apply', provider: 'openai', scope: 'prices' }]));
    const notice = await screen.findByTestId('applied-notice');
    expect(notice).toHaveTextContent('Precios actualizados.');
    await user.click(within(notice).getByTestId('undo-applied'));
    await waitFor(() =>
      expect(payloads('save')).toContainEqual({
        action: 'save',
        integration: 'ai_text',
        values: { AI_PRICES: '{"openai/gpt-6.1-terra":{"input_tokens":3,"output_tokens":9}}' },
      }),
    );
  });

  it('si la fuente falla se usan los últimos precios guardados y se dice, sin romper nada', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    fake.fn('platform-integrations', (raw) => {
      const action = (raw as { action: string }).action;
      if (action === 'ai_overview') {
        return {
          status: 200,
          body: overview({
            stale: true,
            fetchedAt: '2026-11-20T09:00:00Z',
            problem: 'No se pudo leer la fuente de precios: se usan los últimos precios guardados.',
          }),
        };
      }
      return {
        status: 200,
        body: { settings: [], tests: [], audit: [], environment: [], availability: { ...ALL_AVAILABLE } },
      };
    });
    renderApp('/plataforma/integraciones');
    const advisor = within(await screen.findByTestId('ai-advisor-openai'));
    expect(await advisor.findByText(/se usan los últimos precios guardados/)).toBeInTheDocument();
    expect(advisor.getByTestId('ai-source-openai')).toHaveTextContent('actualizados el');
  });

  it('«Usar la configuración recomendada» aparece con la clave puesta y pide al servidor aplicarla entera', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations({ environment: ['OPENAI_API_KEY'] });
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string };
      if (body.action === 'ai_apply') {
        return { status: 200, body: { previous: { AI_TEXT_MODEL: 'gpt-6.2-sol' }, applied: [], notes: ['Ya había un precio.'] } };
      }
      return serveOnce(server, body as never, ['OPENAI_API_KEY']);
    });
    const { user } = renderApp('/plataforma/integraciones');
    await user.click(await screen.findByTestId('ai-use-recommended'));
    await waitFor(() => expect(payloads('ai_apply')).toEqual([{ action: 'ai_apply', provider: 'openai', scope: 'all' }]));
    expect(await screen.findByTestId('applied-notice')).toHaveTextContent('Configuración recomendada aplicada.');
  });

  it('Claude es una tarjeta nueva con sugerencia y precio, sin hacer falta configurarla', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-claude');
    expect(within(card).getByTestId('service-status-claude')).toHaveTextContent('Sin configurar');
    expect(within(card).getByTestId('service-detail-claude')).toHaveTextContent('Opcional');
    const copilot = await within(card).findByTestId('ai-task-copilot');
    expect(copilot).toHaveTextContent('Recomendado: claude-haiku-5-5');
    expect(copilot).toHaveTextContent('medido: 12 de 12 casos del copiloto');
    expect(within(card).queryByTestId('ai-use-recommended')).toBeNull();
    expect(within(card).getByRole('link', { name: 'Tarifa oficial de Claude' })).toBeInTheDocument();
  });
});

describe('lo que cuesta de verdad', () => {
  it('calcula el coste medio por operación del mes con el uso real: orden, pie, imagen y minuto transcrito', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    fake.rpc('platform_cost_per_operation', () => [
      { task: 'text', purpose: 'editor.copilot', provider: 'openai', model: 'gpt-6-luna', operations: 2000, cost_micros: 800_000, audio_seconds: 0 },
      { task: 'text', purpose: 'post.caption', provider: 'openai', model: 'gpt-6.1-terra', operations: 100, cost_micros: 390_000, audio_seconds: 0 },
      { task: 'image', purpose: 'image.generate', provider: 'openai', model: 'gpt-image-2.5-flare', operations: 10, cost_micros: 500_000, audio_seconds: 0 },
      { task: 'transcription', purpose: 'reel.subtitles', provider: 'openai', model: 'gpt-transcribe', operations: 4, cost_micros: 90_000, audio_seconds: 1200 },
      { task: 'text', purpose: 'editor.copilot', provider: 'anthropic-vertex', model: 'claude-haiku-5-5', operations: 50, cost_micros: 25_000, audio_seconds: 0 },
    ]);
    renderApp('/plataforma/integraciones');
    const real = within(await screen.findByTestId('real-cost-openai'));
    const line = async (label: string) => (await real.findByText(label)).closest('li')!;
    // 800.000 micros / 2.000 órdenes = 0,04 céntimos por orden.
    expect(await line('Órdenes del copiloto')).toHaveTextContent('≈ 0,04 céntimos por orden');
    expect(await line('Pies de foto y textos')).toHaveTextContent('≈ 0,39 céntimos por pie');
    expect(await line('Imágenes')).toHaveTextContent('≈ 5 céntimos por imagen');
    // 0,09 $ en 20 minutos = 0,45 céntimos por minuto.
    expect(await line('Subtítulos')).toHaveTextContent('≈ 0,45 céntimos por minuto transcrito');
    expect(real.queryByText(/claude/i)).toBeNull();
    // Claude, con lo suyo.
    const claude = within(await screen.findByTestId('real-cost-claude'));
    expect((await claude.findByText('Órdenes del copiloto')).closest('li')).toHaveTextContent('≈ 0,05 céntimos por orden');
  });

  it('sin operaciones de pago este mes lo dice', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    serveIntegrations();
    fake.rpc('platform_cost_per_operation', () => []);
    renderApp('/plataforma/integraciones');
    expect(await within(await screen.findByTestId('real-cost-openai')).findByText(/Todavía no hay operaciones de pago/)).toBeInTheDocument();
  });
});

describe('fal.ai', () => {
  it('con la clave puesta pero sin permiso fuera de la UE, avisa y lo permite en un clic', async () => {
    seedWorkspace({ orgRole: 'owner', platformAdmin: true });
    const server = serveIntegrations({ environment: ['FAL_KEY'] });
    const { user } = renderApp('/plataforma/integraciones');
    const card = await screen.findByTestId('integration-fal');
    expect(within(card).getByTestId('service-status-fal')).toHaveTextContent('Falta algo');
    const notice = within(card).getByTestId('fal-permission');
    expect(notice).toHaveTextContent('no garantiza que los datos se traten en la UE');
    await user.click(within(notice).getByTestId('fal-allow'));
    await waitFor(() =>
      expect(payloads('save')).toContainEqual({ action: 'save', integration: 'ai_image', values: { AI_MEDIA_ALLOW_NON_EU: 'true' } }),
    );
    expect(server.settings.some((s) => s.setting_key === 'AI_MEDIA_ALLOW_NON_EU')).toBe(true);
  });
});

/** Responde lo de siempre del servidor simulado a una acción (para sobrescribir solo una). */
function serveOnce(
  server: { settings: IntegrationSettingRow[] },
  body: { action: string; integration?: string; values?: Record<string, string | null> },
  environment: string[] = ['STRIPE_SECRET_KEY'],
): { status: number; body: unknown } {
  if (body.action === 'status') {
    return {
      status: 200,
      body: {
        settings: server.settings.map((s) => ({ ...s })),
        tests: [],
        audit: [],
        environment,
        availability: { ...ALL_AVAILABLE, billing: false },
      },
    };
  }
  if (body.action === 'save') {
    for (const [key, value] of Object.entries(body.values ?? {})) {
      const at = server.settings.findIndex((s) => s.setting_key === key);
      if (at >= 0) server.settings.splice(at, 1);
      if (value === null) continue;
      const secret = key.endsWith('TOKEN') || key.endsWith('_KEY');
      server.settings.push({
        setting_key: key,
        integration: body.integration!,
        is_secret: secret,
        value: secret ? null : value,
        hint: secret ? `…${value.slice(-4)}` : null,
        updated_at: '2026-11-20T10:00:00Z',
        updated_by_email: 'yo@example.com',
      });
    }
    return { status: 200, body: { saved: Object.keys(body.values ?? {}) } };
  }
  if (body.action === 'ai_overview') return { status: 200, body: overview() };
  if (body.action === 'availability') return { status: 200, body: { ...ALL_AVAILABLE } };
  return { status: 200, body: { ok: true, message: 'ok', checks: [] } };
}

describe('interruptores: compilación Y servidor', () => {
  it('con VITE_AI_TEXT_ENABLED pero sin IA configurada en el servidor, Campañas no sale', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    fake.fn('platform-integrations', () => ({
      status: 200,
      body: { ...ALL_AVAILABLE, aiText: false, aiTextTasks: NO_TEXT_TASKS },
    }));
    renderApp(`${BRAND_BASE}/campanas`);
    await waitFor(() => expect(window.location.pathname).toBe(`${BRAND_BASE}/inicio`));
    expect(screen.queryByRole('link', { name: /Campañas/ })).not.toBeInTheDocument();
  });

  it('con solo el copiloto configurado, Campañas no sale (cada botón mira su tarea)', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    fake.fn('platform-integrations', () => ({
      status: 200,
      body: { ...ALL_AVAILABLE, aiText: true, aiTextTasks: { ...NO_TEXT_TASKS, 'editor.copilot': true } },
    }));
    renderApp(`${BRAND_BASE}/campanas`);
    await waitFor(() => expect(window.location.pathname).toBe(`${BRAND_BASE}/inicio`));
    expect(screen.queryByRole('link', { name: /Campañas/ })).not.toBeInTheDocument();
  });

  it('si el servidor no contesta, no se enseña nada que dependa de él', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    fake.fn('platform-integrations', () => {
      throw new Error('sin red');
    });
    const { user } = renderApp(`${BRAND_BASE}/marca`);
    await user.click(await screen.findByRole('tab', { name: /Datos/ }));
    await screen.findByTestId('brand-ai-mode');
    expect(screen.queryByTestId('social-accounts')).toBeNull();
  });

  it('con VITE_DRIVE_LIBRARY_ENABLED pero sin Google Drive configurado, no se ofrece conectar', async () => {
    vi.stubEnv('VITE_DRIVE_LIBRARY_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    fake.fn('platform-integrations', () => ({ status: 200, body: { ...ALL_AVAILABLE, drive: false } }));
    renderApp(`/o/${ORG_ID}/ajustes/drive`);
    expect(await screen.findByTestId('drive-not-configured')).toBeInTheDocument();
    expect(screen.queryByTestId('drive-connect')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Google Drive' })).toBeNull();
  });

  it('con Google Drive configurado, sale en los ajustes y se puede conectar', async () => {
    vi.stubEnv('VITE_DRIVE_LIBRARY_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    fake.fn('platform-integrations', () => ({ status: 200, body: { ...ALL_AVAILABLE } }));
    renderApp(`/o/${ORG_ID}/ajustes/drive`);
    expect(await screen.findByTestId('drive-connect')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Google Drive' })).toBeInTheDocument();
  });
});

describe('conectar Instagram con un token', () => {
  it('sin aplicación de Meta solo se ofrece el token; se valida en el servidor y la cuenta queda «con token»', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.social_accounts = [];
    fake.fn('platform-integrations', () => ({ status: 200, body: { ...ALL_AVAILABLE, socialOAuth: false } }));
    fake.fn('social-connect/token', (body) => {
      const { igUserId } = body as { igUserId: string };
      fake.tables.social_accounts = [
        {
          id: 'acc-1',
          brand_id: BRAND_ID,
          organization_id: ORG_ID,
          network: 'instagram',
          provider: 'meta',
          external_id: igUserId,
          username: 'casa_demo',
          display_name: 'Casa Demo',
          page_id: '1000',
          status: 'active',
          scopes: ['instagram_basic', 'instagram_content_publish'],
          token_expires_at: null,
          token_checked_at: '2026-11-20T10:00:00Z',
          quota_usage: null,
          quota_total: null,
          quota_checked_at: null,
          last_error: null,
          connected_by: 'user-me',
          connected_at: '2026-11-20T10:00:00Z',
          disconnected_at: null,
          connection_method: 'token',
          created_at: '2026-11-20T10:00:00Z',
          updated_at: '2026-11-20T10:00:00Z',
        },
      ];
      return {
        status: 200,
        body: {
          accountId: 'acc-1',
          username: 'casa_demo',
          expiresAt: null,
          dataAccessExpiresAt: '2027-02-18T10:00:00Z',
          tokenType: 'PAGE',
          warnings: [],
        },
      };
    });
    const { user } = renderApp(`${BRAND_BASE}/marca`);
    await user.click(await screen.findByRole('tab', { name: /Datos/ }));
    const card = await screen.findByTestId('social-accounts');
    await within(card).findByTestId('social-connect-token');
    expect(within(card).queryByTestId('social-connect-instagram')).toBeNull();

    await user.click(within(card).getByTestId('social-connect-token'));
    expect(await screen.findByText(/La clave de acceso sustituye al inicio de sesión con Meta/)).toBeInTheDocument();
    expect(screen.getByText(/Caduca cuando lo diga Meta/)).toBeInTheDocument();
    await user.type(screen.getByTestId('social-token-ig-id'), '17841400000000001');
    await user.type(screen.getByTestId('social-token-value'), 'EAAprueba0000000000000000');
    await user.click(screen.getByTestId('social-token-submit'));

    await waitFor(() => expect(fake.callsTo('social-connect/token', 'function')).toHaveLength(1));
    expect(fake.callsTo('social-connect/token', 'function')[0]!.payload).toEqual({
      brandId: BRAND_ID,
      network: 'instagram',
      igUserId: '17841400000000001',
      accessToken: 'EAAprueba0000000000000000',
    });
    expect(await within(card).findByTestId('social-account-token')).toHaveTextContent('Conexión avanzada');
    expect(within(card).getByText(/conexión avanzada, sin fecha de caducidad/)).toBeInTheDocument();
  });

  it('si Meta rechaza el token, se dice en el diálogo', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.social_accounts = [];
    fake.fn('social-connect/token', () => ({
      status: 400,
      body: { error: { code: 'invalid_token', message: 'Meta dice que ese token no es válido.' } },
    }));
    const { user } = renderApp(`${BRAND_BASE}/marca`);
    await user.click(await screen.findByRole('tab', { name: /Datos/ }));
    await user.click(await screen.findByTestId('social-connect-token'));
    await user.type(screen.getByTestId('social-token-ig-id'), '17841400000000001');
    await user.type(screen.getByTestId('social-token-value'), 'EAAcaducado000000000000000');
    await user.click(screen.getByTestId('social-token-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Meta dice que ese token no es válido.');
  });
});
