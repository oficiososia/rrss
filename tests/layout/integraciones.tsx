import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/index.css';
import type { IntegrationSettingRow } from '@/lib/database.types';
import { ALL_AVAILABLE, fake } from '@/test/fakeSupabase';
import { seedWorkspace } from '@/test/fixtures';

// Banco de maquetación de Integraciones: la aplicación real con el Supabase simulado y una
// instalación a medio configurar (OpenAI, Instagram, R2 y Fly listos; Google Drive sin hacer;
// pagos con la clave en el servidor y nada más). `?modo=self` = uso interno (todas las
// organizaciones en autogestión): sin la fila de pagos. Ninguna llamada sale del navegador.

const params = new URLSearchParams(window.location.search);
seedWorkspace({ orgRole: 'owner', platformAdmin: true, workMode: params.get('modo') === 'self' ? 'self' : 'agency' });

const AT = '2026-11-22T19:50:00Z';
const setting = (key: string, integration: string, value: string | null = null): IntegrationSettingRow => ({
  setting_key: key,
  integration,
  is_secret: value === null,
  value,
  hint: value === null ? '…Vg4A' : null,
  updated_at: AT,
  updated_by_email: 'superadmin@ejemplo.test',
});
const settings: IntegrationSettingRow[] = [
  setting('OPENAI_API_KEY', 'ai_text'),
  setting('OPENAI_BASE_URL', 'ai_text', 'https://eu.api.openai.com'),
  setting('AI_TEXT_PROVIDER', 'ai_text', 'openai'),
  setting('AI_TEXT_MODEL', 'ai_text', 'gpt-6-luna'),
  setting('AI_PRICES', 'ai_text', '{}'),
  setting('META_APP_ID', 'meta', '1234567890123'),
  setting('META_APP_SECRET', 'meta'),
  setting('SOCIAL_APP_URL', 'meta', 'https://rrss.ejemplo.test'),
  setting('SOCIAL_TOKEN_KEYS', 'meta', 'k1'),
  setting('R2_ACCOUNT_ID', 'r2', 'cuenta-de-prueba'),
  setting('R2_BUCKET', 'r2', 'rrss-medios'),
  setting('R2_ACCESS_KEY_ID', 'r2'),
  setting('R2_SECRET_ACCESS_KEY', 'r2'),
  setting('FLY_API_TOKEN', 'media_worker'),
  setting('FLY_APP', 'media_worker', 'rrss-trabajador'),
  setting('FLY_MACHINE_ID', 'media_worker', '0123456789abcd'),
  setting('WORKER_GATEWAY_TOKEN', 'media_worker'),
];
const ok = (integration: string, message: string) => ({
  integration,
  ok: true,
  message,
  tested_at: AT,
  tested_by_email: 'superadmin@ejemplo.test',
});
const tests = [
  ok('ai_text', 'OpenAI acepta la clave (eu.api.openai.com) y genera con gpt-6-luna.'),
  ok('meta', 'Meta reconoce la aplicación.'),
  ok('r2', 'El cubo existe y la clave puede usarlo.'),
  ok('media_worker', 'La máquina existe y el token sirve.'),
];

const price = { input_tokens: 0.11, output_tokens: 0.55 };
const overview = {
  source: {
    name: 'LiteLLM',
    url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
    officialUrl: {
      openai: 'https://developers.openai.com/api/docs/pricing',
      claude: 'https://platform.claude.com/docs/en/about-claude/pricing',
    },
    fetchedAt: AT,
    stale: false,
    problem: null,
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
          current: 'openai/gpt-6-luna',
        },
      ],
      prices: [
        {
          provider: 'openai',
          model: 'gpt-6.1-terra-con-un-nombre-de-modelo-muy-largo-para-probar-el-ancho',
          usedFor: ['Pies de foto y textos de las piezas', 'Revisión de marca', 'Planes de campaña'],
          source: { mode: 'chat', inputPerM: 1, outputPerM: 5 },
          expected: { input_tokens: 1.1, output_tokens: 5.5 },
          loaded: price,
          status: 'different',
          surcharge: 1.1,
        },
      ],
      monthly: { usd: 12.34, notCounted: ['Crear una imagen'] },
      differing: 1,
    },
    claude: { tasks: [], prices: [], monthly: { usd: null, notCounted: [] }, differing: 0 },
  },
};

fake.fn('platform-integrations', (raw) => {
  const action = (raw as { action: string }).action;
  if (action === 'status') {
    return {
      status: 200,
      body: {
        settings,
        tests,
        audit: [],
        environment: ['STRIPE_SECRET_KEY'],
        availability: { ...ALL_AVAILABLE, drive: false, billing: false, mediaStorage: true },
      },
    };
  }
  if (action === 'ai_overview') return { status: 200, body: overview };
  if (action === 'test') return { status: 200, body: { ok: true, message: 'Responde.', checks: [] } };
  return { status: 200, body: { ...ALL_AVAILABLE } };
});
fake.rpc('platform_cost_per_operation', () => []);

window.history.pushState({}, '', '/plataforma/integraciones');
createRoot(document.getElementById('root')!).render(<App />);
