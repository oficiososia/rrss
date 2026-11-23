import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { AiRequestError, periodStartOf } from '@/features/ai/api';
import { GenerateCaptionDialog } from '@/features/ai/GenerateCaptionDialog';
import type { OrgWorkMode } from '@/lib/database.types';
import { ALL_AVAILABLE, fake } from '@/test/fakeSupabase';
import { BASE, BRAND_ID, brandRow, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import type { MyOrganization } from './api';
import { OrgContext } from './context';

// En autogestión («Lo llevamos nosotros») la interfaz no enseña planes de pago, cupos, márgenes ni
// cobros: el dueño lleva sus marcas y eso es ruido. El gasto real sí se ve. Con una agencia de por
// medio todo sigue como estaba (lo comprueban las pruebas de cada pantalla, que siembran `agency`).

const M = 1_000_000;
const PERIOD = periodStartOf(new Date());

const ledger = (id: number, entry: string, reserved: number, cost = 0) => ({
  id,
  organization_id: ORG_ID,
  brand_id: BRAND_ID,
  generation_id: `g-${id}`,
  period_start: PERIOD,
  entry,
  reserved_delta_micros: reserved,
  cost_delta_micros: cost,
  created_at: `${PERIOD}T10:00:00Z`,
});

/** Consumo del mes: `spent` gastado de un tope de `limit` (o sin tope). */
function seedSpend({ limit, spent }: { limit: number | null; spent: number }) {
  fake.tables.usage_quotas =
    limit === null
      ? []
      : [{ organization_id: ORG_ID, metric: 'ai_cost_micros', period: 'month', limit_value: limit, updated_by: null }];
  fake.tables.ai_usage = [ledger(1, 'reserve', spent), ledger(2, 'settle', -spent, spent)];
  fake.rpc('organization_plan_usage', () => ({ plan: { name: 'Profesional' }, ai_limit_micros: 0 }));
  fake.rpc('ai_cost_by_organization', () => []);
  fake.rpc('org_usage_overview', () => [
    {
      organization_id: ORG_ID,
      organization_name: 'Grupo Demo',
      kind: 'business',
      plan_name: 'Profesional',
      plan_code: 'professional',
      plan_unlimited: false,
      ai_limit_micros: limit ?? 0,
      ai_limit_overridden: false,
      ai_committed_micros: spent,
      ai_cost_micros: spent,
      cost_text_micros: spent,
      cost_image_micros: 0,
      cost_video_micros: 0,
      cost_transcription_micros: 0,
      generations: 1,
      media_jobs: 0,
      media_jobs_succeeded: 0,
      media_jobs_failed: 0,
      media_jobs_active: 0,
      media_machine_seconds: 0,
      media_jobs_without_timings: 0,
      storage_bytes: 1024,
      storage_limit_bytes: null,
    },
  ]);
}

const tabs = () =>
  within(screen.getByRole('navigation', { name: 'Secciones de configuración' }))
    .getAllByRole('link')
    .map((l) => l.textContent);

describe('Configuración en autogestión', () => {
  it('no hay pestaña «Plan», y su dirección vuelve a General', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    renderApp(`${BASE}/ajustes/general`);
    await screen.findByTestId('org-settings-name');
    expect(tabs()).toEqual(['General', 'Equipo', 'Actividad', 'Consumo de IA', 'Datos']);
  });

  it('entrar por la dirección del plan lleva a General sin pedir el plan', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    renderApp(`${BASE}/ajustes/plan`);
    await waitFor(() => expect(window.location.pathname).toBe(`${BASE}/ajustes/general`));
    expect(screen.queryByTestId('plan-page')).toBeNull();
    expect(fake.callsTo('organization_plan_usage', 'rpc')).toHaveLength(0);
  });

  it('con agencia, la pestaña «Plan» sigue ahí', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'agency' });
    renderApp(`${BASE}/ajustes/general`);
    await screen.findByTestId('org-settings-name');
    expect(tabs()).toContain('Plan');
  });
});

describe('Consumo de IA en autogestión', () => {
  it('enseña el gasto real y ni cupo, ni plan, ni barra', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    seedSpend({ limit: 10 * M, spent: 2 * M });
    renderApp(`${BASE}/ajustes/ia`);
    expect(await screen.findByTestId('spend-total')).toHaveTextContent('2,00 créditos');
    expect(await screen.findByTestId('ai-usage-brands')).toHaveTextContent('2,00 créditos');
    const page = screen.getByTestId('ai-usage-page');
    expect(page).not.toHaveTextContent(/cupo|plan «|Profesional/i);
    expect(screen.queryByTestId('ai-quota-limit')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    // Con margen de sobra tampoco hay avisos.
    expect(screen.queryByTestId('ai-spend-limit-near')).toBeNull();
    expect(screen.queryByTestId('ai-spend-limit-reached')).toBeNull();
  });

  it('el límite sigue protegiendo: cerca del tope y al llegar lo dice en llano, sin hablar de cupos', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    seedSpend({ limit: 10 * M, spent: 8_500_000 });
    const near = renderApp(`${BASE}/ajustes/ia`);
    expect(await screen.findByTestId('ai-spend-limit-near')).toHaveTextContent(
      'Lleváis gastado el 85 % del tope de gasto de IA de este mes',
    );
    expect(screen.getByTestId('ai-usage-page')).not.toHaveTextContent(/cupo/i);
    near.unmount();

    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    seedSpend({ limit: 10 * M, spent: 10 * M });
    const reached = renderApp(`${BASE}/ajustes/ia`);
    expect(await screen.findByTestId('ai-spend-limit-reached')).toHaveTextContent(
      'Se ha llegado al tope de gasto de IA de este mes',
    );
    reached.unmount();

    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    seedSpend({ limit: null, spent: 0 });
    renderApp(`${BASE}/ajustes/ia`);
    expect(await screen.findByTestId('ai-spend-limit-missing')).toHaveTextContent(
      'La IA no tiene un tope de gasto asignado',
    );
    expect(screen.getByTestId('ai-usage-page')).not.toHaveTextContent(/cupo|plan/i);
  });
});

describe('avisos de la IA en autogestión', () => {
  const org = (work_mode: OrgWorkMode): MyOrganization => ({
    id: ORG_ID,
    name: 'Grupo Demo',
    kind: 'business',
    work_mode,
    settings: {},
    created_by: null,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    role: 'owner',
  });
  const show = (mode: OrgWorkMode, code: 'quota_exhausted' | 'quota_missing' | 'ai_paused') =>
    render(
      <OrgContext.Provider value={{ org: org(mode), isAdmin: true, brands: [brandRow()], brandRoles: new Map() }}>
        {/* El mensaje del servidor habla de cupos y planes: en autogestión no se enseña. */}
        <AiErrorNotice error={new AiRequestError(code, 'El cupo de tu plan está agotado.')} />
      </OrgContext.Provider>,
    );

  it('el límite alcanzado se explica como tope de gasto, sin cupos ni planes', () => {
    const exhausted = show('self', 'quota_exhausted');
    expect(screen.getByTestId('ai-quota-error')).toHaveTextContent('Se ha llegado al tope de gasto de IA de este mes');
    expect(screen.getByTestId('ai-quota-error')).not.toHaveTextContent(/cupo|plan\b/i);
    exhausted.unmount();
    const missing = show('self', 'quota_missing');
    expect(screen.getByTestId('ai-quota-error')).toHaveTextContent('La IA no tiene un tope de gasto asignado');
    expect(screen.getByTestId('ai-quota-error')).not.toHaveTextContent(/cupo|plan\b/i);
    missing.unmount();
    // La pausa global ya hablaba de gasto: igual en los dos modos.
    show('self', 'ai_paused');
    expect(screen.getByTestId('ai-quota-error')).toHaveTextContent('La IA de pago está en pausa');
  });

  it('«Redactar con IA» no recuerda el cupo en cada generación; con agencia, sí', async () => {
    const open = async (mode: OrgWorkMode) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const user = userEvent.setup();
      const ui = render(
        <QueryClientProvider client={client}>
          <OrgContext.Provider value={{ org: org(mode), isAdmin: true, brands: [brandRow()], brandRoles: new Map() }}>
            <GenerateCaptionDialog
              brandId={BRAND_ID}
              network="instagram"
              format="post"
              onApply={() => undefined}
              currentCopy={{
                caption: '',
                hashtags: [],
                mentions: [],
                altText: '',
                callToAction: { label: '', url: '' },
              }}
            />
          </OrgContext.Provider>
        </QueryClientProvider>,
      );
      await user.click(screen.getByRole('button', { name: /Redactar con IA/ }));
      await screen.findByRole('button', { name: /^Generar$/ });
      return ui;
    };
    const self = await open('self');
    expect(screen.queryByTestId('ai-quota-hint')).toBeNull();
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/cupo/i);
    self.unmount();
    await open('agency');
    expect(screen.getByTestId('ai-quota-hint')).toHaveTextContent('descuenta del cupo de IA');
  });

  it('con agencia, los textos de siempre', () => {
    show('agency', 'quota_exhausted');
    expect(screen.getByTestId('ai-quota-error')).toHaveTextContent('El cupo de IA de este mes está agotado');
    expect(screen.getByTestId('ai-quota-error')).toHaveTextContent('El cupo de tu plan está agotado.');
  });
});

// ───────────────────────────── Plataforma ─────────────────────────────

function seedPlatform(workMode: OrgWorkMode) {
  seedWorkspace({ orgRole: 'owner', platformAdmin: true, workMode });
  fake.tables.platform_alerts = [];
  fake.tables.plans = [];
  fake.rpc('admin_list_organizations', () => [
    {
      id: ORG_ID,
      name: 'Grupo Demo',
      kind: 'business',
      created_at: '2026-10-01T09:00:00Z',
      members: 1,
      brands: 1,
      assets: 0,
      storage_bytes: 0,
    },
  ]);
  fake.rpc('ai_cost_by_organization', () => []);
  fake.rpc('admin_billing_overview', () => []);
  fake.rpc('platform_usage_overview', () => [
    {
      organization_id: ORG_ID,
      organization_name: 'Grupo Demo',
      kind: 'business',
      plan_name: 'Profesional',
      plan_code: 'professional',
      plan_unlimited: true,
      ai_limit_micros: 10 * M,
      ai_limit_overridden: true,
      ai_committed_micros: 8_500_000,
      ai_cost_micros: 8 * M,
      cost_text_micros: 3 * M,
      cost_image_micros: 4 * M,
      cost_video_micros: 0,
      cost_transcription_micros: M,
      generations: 12,
      media_jobs: 0,
      media_jobs_succeeded: 0,
      media_jobs_failed: 0,
      media_jobs_active: 0,
      media_machine_seconds: 0,
      media_jobs_without_timings: 0,
      storage_bytes: 2 * 1024 ** 3,
      storage_limit_bytes: 4 * 1024 ** 3,
    },
  ]);
  fake.rpc('platform_storage_by_brand', () => []);
  fake.rpc('platform_price_review', () => [
    {
      task: 'image',
      provider: 'openai',
      model: 'gpt-image-2',
      generations: 6,
      cost_micros: 4 * M,
      status: 'unverified',
    },
  ]);
  fake.rpc('platform_ai_global_status', () => ({
    period_start: PERIOD,
    cap_micros: null,
    committed_micros: 8 * M,
    cost_micros: 8 * M,
    paused: false,
  }));
}

describe('Plataforma en uso interno (todas las organizaciones propias en autogestión)', () => {
  it('la página de Plataforma no enseña cupos, ingresos, margen ni planes; quedan plegados', async () => {
    seedPlatform('self');
    const { user } = renderApp('/plataforma');
    expect(await screen.findByTestId('platform-orgs')).toHaveTextContent('Grupo Demo');
    const folded = await screen.findByTestId('platform-commercial');
    expect(screen.getByRole('main')).not.toHaveTextContent(/Cupo mensual|Ingresos|margen|Planes/i);
    expect(screen.queryByTestId('ai-quota-org')).toBeNull();
    // Cerrado no pide nada de eso.
    expect(fake.callsTo('admin_billing_overview', 'rpc')).toHaveLength(0);
    // Siguen a mano por si hay que subir un tope.
    await user.click(within(folded).getByText(/Opciones avanzadas/));
    expect(await screen.findByTestId('ai-quota-org')).toBeInTheDocument();
    expect(screen.getByText('Planes')).toBeInTheDocument();
  });

  it('con una organización que trabaja con agencia, Plataforma lo enseña todo como siempre', async () => {
    seedPlatform('agency');
    renderApp('/plataforma');
    expect(await screen.findByTestId('ai-quota-org')).toBeInTheDocument();
    expect(await screen.findByText(/Ingresos, coste y margen/)).toBeInTheDocument();
    expect(screen.queryByTestId('platform-commercial')).toBeNull();
  });

  it('basta una organización con agencia entre las propias para que no sea uso interno', async () => {
    seedPlatform('self');
    fake.rows('organizations').push({
      id: 'org-cliente',
      name: 'Cliente SL',
      kind: 'business',
      work_mode: 'agency',
      settings: {},
      created_by: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
    });
    fake.rows('organization_members').push({
      organization_id: 'org-cliente',
      user_id: ME.id,
      role: 'owner',
      created_at: '2026-10-01T09:00:00Z',
    });
    renderApp('/plataforma');
    expect(await screen.findByText(/Ingresos, coste y margen/)).toBeInTheDocument();
  });

  it('«Gasto y uso» conserva el gasto real y quita cupos, planes y límites del plan', async () => {
    seedPlatform('self');
    renderApp('/plataforma/gasto');
    const row = await screen.findByTestId(`gasto-ai-${ORG_ID}`);
    // El gasto real, tal cual.
    expect(within(row).getByText('3,00 créditos')).toBeInTheDocument();
    expect(within(row).getByText('8,00 créditos')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Cupo consumido')).toBeNull());
    expect(screen.queryByTestId(`gasto-quota-${ORG_ID}`)).toBeNull();
    expect(screen.queryByTestId(`gasto-manual-${ORG_ID}`)).toBeNull();
    expect(screen.queryByTestId(`gasto-unlimited-${ORG_ID}`)).toBeNull();
    expect(row).not.toHaveTextContent('Profesional');
    expect(await screen.findByTestId(`gasto-storage-${ORG_ID}`)).toHaveTextContent(/^2 GB$/);
    expect(await screen.findByTestId('gasto-prices-warning')).toHaveTextContent('el gasto se calcula');
    expect(screen.getByTestId('gasto-page')).not.toHaveTextContent(/cupo|plan\b|planes/i);
  });

  it('Integraciones: sin la fila de pagos ni «Cobrar los planes»', async () => {
    seedPlatform('self');
    fake.fn('platform-integrations', (raw) => {
      const body = raw as { action: string };
      if (body.action === 'availability') return { status: 200, body: { ...ALL_AVAILABLE } };
      if (body.action === 'status') {
        return {
          status: 200,
          body: {
            settings: [],
            tests: [],
            audit: [],
            environment: [],
            availability: { ...ALL_AVAILABLE, billing: false },
          },
        };
      }
      return { status: 400, body: { error: { message: 'Acción desconocida.' } } };
    });
    renderApp('/plataforma/integraciones');
    const summary = await screen.findByTestId('working-now');
    expect(summary).toHaveTextContent('7 de 7 funciones listas');
    expect(screen.queryByTestId('integration-row-stripe')).toBeNull();
    expect(screen.getByTestId('integration-row-openai')).toBeInTheDocument();
    expect(screen.getByRole('main')).not.toHaveTextContent(/Stripe|Cobrar los planes/);
  });
});
