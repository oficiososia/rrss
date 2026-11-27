// Plataforma → «Gasto y uso», avisos y consumo frente al cupo en cada organización.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { AiRequestError } from '@/features/ai/api';
import type { PlatformAlertRow, PlatformStorageRow, PlatformUsageRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BASE, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { capToMicros, formatSeconds, percentText, severityOf, usageRatio } from './usage';

const M = 1_000_000;

const usageRow = (over: Partial<PlatformUsageRow>): PlatformUsageRow => ({
  organization_id: ORG_ID,
  organization_name: 'Grupo Demo',
  kind: 'business',
  plan_name: 'Pro',
  plan_code: 'professional',
  plan_unlimited: false,
  ai_limit_micros: 10 * M,
  ai_limit_overridden: false,
  ai_committed_micros: 8_500_000,
  ai_cost_micros: 8 * M,
  cost_text_micros: 3 * M,
  cost_image_micros: 4 * M,
  cost_video_micros: 0,
  cost_transcription_micros: M,
  generations: 12,
  media_jobs: 5,
  media_jobs_succeeded: 3,
  media_jobs_failed: 1,
  media_jobs_active: 1,
  media_machine_seconds: 125,
  media_jobs_without_timings: 1,
  storage_bytes: 2 * 1024 ** 3,
  storage_limit_bytes: 4 * 1024 ** 3,
  ...over,
});

const alertRow = (over: Partial<PlatformAlertRow>): PlatformAlertRow => ({
  id: 'a1',
  kind: 'ai_quota_80',
  dedupe_key: 'k1',
  organization_id: ORG_ID,
  title: 'Cupo de IA al 80 %: Grupo Demo',
  detail: 'Esta organización ha usado más del 80 % de su cupo de IA de este mes.',
  data: { limit_micros: 10 * M, committed_micros: 8_500_000 },
  created_at: '2026-11-22T10:00:00Z',
  resolved_at: null,
  resolved_by: null,
  ...over,
});

const brandStorage: PlatformStorageRow = {
  organization_id: ORG_ID,
  organization_name: 'Grupo Demo',
  brand_id: 'brand-1',
  brand_name: 'Casa Demo',
  assets: 40,
  bytes: 1024 ** 3,
  r2_bytes: 512 * 1024 ** 2,
  media_jobs_month: 400,
  media_jobs_cap: 400,
};

function seedPlatform({ alerts = [alertRow({})] as PlatformAlertRow[] } = {}) {
  seedWorkspace({ orgRole: 'owner', platformAdmin: true });
  fake.tables.platform_alerts = alerts;
  fake.rpc('platform_usage_overview', () => [
    usageRow({}),
    usageRow({
      organization_id: 'org-2',
      organization_name: 'Otra SL',
      plan_name: 'Heredado',
      plan_code: 'legacy',
      plan_unlimited: true,
      ai_limit_overridden: true,
      ai_limit_micros: 0,
      ai_committed_micros: 0,
      ai_cost_micros: 0,
      media_jobs: 0,
      storage_limit_bytes: null,
      storage_bytes: 10,
    }),
  ]);
  fake.rpc('platform_storage_by_brand', () => [brandStorage]);
  fake.rpc('platform_price_review', () => [
    {
      task: 'image',
      provider: 'openai',
      model: 'gpt-image-2',
      generations: 6,
      cost_micros: 4 * M,
      status: 'unverified',
    },
    { task: 'text', provider: 'simulated', model: 'sim-1', generations: 3, cost_micros: 100_000, status: 'simulated' },
    { task: 'video', provider: 'fal', model: 'kling', generations: 1, cost_micros: 300_000, status: 'verified' },
  ]);
  fake.rpc('platform_ai_global_status', () => ({
    period_start: '2026-11-01',
    cap_micros: 20 * M,
    committed_micros: 20 * M,
    cost_micros: 19 * M,
    paused: true,
  }));
}

describe('cálculos de «Gasto y uso»', () => {
  it('usageRatio, severidad y porcentajes', () => {
    expect(usageRatio(5, 10)).toBe(0.5);
    expect(usageRatio(5, null)).toBeNull();
    expect(usageRatio(0, 0)).toBeNull();
    expect(usageRatio(1, 0)).toBe(1);
    expect(severityOf(0.79)).toBe('ok');
    expect(severityOf(0.8)).toBe('warning');
    expect(severityOf(1)).toBe('danger');
    expect(severityOf(null)).toBe('ok');
    expect(percentText(0.855)).toBe('86 %');
    expect(percentText(null)).toBe('—');
  });

  it('segundos de máquina y tope', () => {
    expect(formatSeconds(45)).toBe('45 s');
    expect(formatSeconds(200)).toBe('3 min 20 s');
    expect(formatSeconds(7500)).toBe('2 h 05 min');
    expect(capToMicros('50')).toBe(50_000_000);
    expect(capToMicros('0.5')).toBe(500_000);
    expect(capToMicros('50,5')).toBeNull();
    expect(capToMicros('')).toBeNull();
  });
});

describe('pantalla «Gasto y uso»', () => {
  it('enseña IA por tipo, cupo consumido, trabajador de medios, almacenamiento y el tope global en pausa', async () => {
    seedPlatform();
    renderApp('/plataforma/gasto');

    const ai = await screen.findByTestId(`gasto-ai-${ORG_ID}`);
    expect(within(ai).getByText('3,00 créditos')).toBeInTheDocument();
    expect(within(ai).getByText('4,00 créditos')).toBeInTheDocument();
    expect(screen.getByTestId(`gasto-quota-${ORG_ID}`)).toHaveTextContent('8,50 créditos de 10,00 créditos · 85 %');
    expect(within(ai).getByText('Más del 80 %')).toBeInTheDocument();
    expect(within(screen.getByTestId('gasto-ai-org-2')).getByText('Sin cupo')).toBeInTheDocument();

    expect(screen.getByTestId('gasto-global-figures')).toHaveTextContent('20,00 créditos de 20,00 créditos (100 %)');
    expect(screen.getByTestId('gasto-global-paused')).toHaveTextContent('pausa');

    const media = screen.getByTestId('gasto-media');
    expect(within(media).getByText('2 min 05 s')).toBeInTheDocument();
    expect(screen.getByTestId('gasto-media-total')).toHaveTextContent('1 trabajo hecho no guardó tiempos');

    expect(screen.getByTestId(`gasto-storage-${ORG_ID}`)).toHaveTextContent('2 GB de 4 GB (50 %)');
    expect(screen.getByRole('rowheader', { name: 'Casa Demo' })).toBeInTheDocument();
    expect(fake.callsTo('platform_usage_overview', 'rpc')[0]!.payload).toEqual({
      p_period_start: expect.stringMatching(/^\d{4}-\d{2}-01$/),
    });
  });

  it('el cambio de mes pide ese mes', async () => {
    seedPlatform();
    const { user } = renderApp('/plataforma/gasto');
    await screen.findByTestId('gasto-ai');
    const select = screen.getByTestId('gasto-period') as HTMLSelectElement;
    const previous = select.options[1]!.value;
    await user.selectOptions(select, previous);
    await screen.findByTestId('gasto-ai');
    const calls = fake.callsTo('platform_usage_overview', 'rpc');
    expect(calls[calls.length - 1]!.payload).toEqual({ p_period_start: previous });
  });

  it('sin tope lo dice, y quien no es superadministrador no ve nada', async () => {
    seedPlatform();
    fake.rpc('platform_ai_global_status', () => ({
      period_start: '2026-11-01',
      cap_micros: null,
      committed_micros: 0,
      cost_micros: 4 * M,
      paused: false,
    }));
    renderApp('/plataforma/gasto');
    expect(await screen.findByTestId('gasto-global-none')).toHaveTextContent('4,00 créditos');
  });

  it('un usuario normal ve «Zona reservada»', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp('/plataforma/gasto');
    expect(await screen.findByText('Zona reservada')).toBeInTheDocument();
    expect(fake.callsTo('platform_usage_overview', 'rpc')).toHaveLength(0);
  });
});

describe('lo que el cupo no cubre', () => {
  it('marca los precios sin verificar y los del simulador, y avisa de que el cupo puede no ser fiable', async () => {
    seedPlatform();
    renderApp('/plataforma/gasto');
    const card = await screen.findByTestId('gasto-prices');
    expect(await within(card).findByTestId('gasto-prices-warning')).toHaveTextContent('2 modelos');
    expect(within(card).getByText('Sin verificar')).toBeInTheDocument();
    expect(within(card).getByText('Precio del simulador')).toBeInTheDocument();
    expect(within(card).getByText('Verificado')).toBeInTheDocument();
  });

  it('si todos los precios están verificados no hay aviso', async () => {
    seedPlatform();
    fake.rpc('platform_price_review', () => [
      { task: 'video', provider: 'fal', model: 'kling', generations: 1, cost_micros: 300_000, status: 'verified' },
    ]);
    renderApp('/plataforma/gasto');
    const card = await screen.findByTestId('gasto-prices');
    await within(card).findByText('Verificado');
    expect(within(card).queryByTestId('gasto-prices-warning')).not.toBeInTheDocument();
  });

  it('señala los cupos puestos a mano y los planes sin límites', async () => {
    seedPlatform();
    renderApp('/plataforma/gasto');
    await screen.findByTestId('gasto-ai');
    expect(screen.getByTestId('gasto-manual-org-2')).toHaveTextContent('Cupo puesto a mano');
    expect(screen.getByTestId('gasto-unlimited-org-2')).toHaveTextContent('Plan sin límites');
    expect(screen.queryByTestId(`gasto-manual-${ORG_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`gasto-unlimited-${ORG_ID}`)).not.toBeInTheDocument();
  });

  it('enseña los trabajos de medios del mes frente al tope de cada marca', async () => {
    seedPlatform();
    renderApp('/plataforma/gasto');
    const cell = await screen.findByTestId('gasto-jobs-brand-1');
    expect(cell).toHaveTextContent('400 de 400');
    expect(cell).toHaveClass('text-danger');
  });

  it('comprueba la máquina de Fly: encendida demasiado tiempo se dice claro; parada, también', async () => {
    seedPlatform();
    fake.fn('platform-integrations', () => ({
      status: 200,
      body: { known: true, state: 'started', startedAt: '2026-11-22T01:00:00Z', hours: 9.5, tooLong: true },
    }));
    const { user } = renderApp('/plataforma/gasto');
    await user.click(await screen.findByTestId('worker-check'));
    expect(await screen.findByTestId('worker-check-result')).toHaveTextContent('unas 9 horas: demasiado');
    expect(fake.callsTo('platform-integrations', 'function')[0]!.payload).toEqual({ action: 'worker_check' });

    fake.fn('platform-integrations', () => ({
      status: 200,
      body: { known: false, problem: 'Falta configurar la máquina de Fly en Integraciones.' },
    }));
    await user.click(screen.getByTestId('worker-check'));
    expect(await screen.findByTestId('worker-check-result')).toHaveTextContent('Falta configurar');
  });
});

describe('avisos de la plataforma', () => {
  it('lista los abiertos con sus cifras, se marcan como vistos y se pueden revisar a mano', async () => {
    seedPlatform({
      alerts: [
        alertRow({}),
        alertRow({
          id: 'a2',
          kind: 'ai_global_cap_reached',
          organization_id: null,
          title: 'La IA de pago está en pausa: tope global alcanzado',
          data: { cap_micros: 20 * M, committed_micros: 20 * M },
          created_at: '2026-11-22T11:00:00Z',
        }),
      ],
    });
    fake.rpc('platform_alert_resolve', (args) => {
      const id = (args as { p_id: string | null }).p_id;
      fake.tables.platform_alerts = (fake.tables.platform_alerts ?? []).filter((a) => id !== null && a.id !== id);
      return 1;
    });
    fake.rpc('platform_alerts_refresh', () => 0);
    const { user } = renderApp('/plataforma/gasto');

    const list = await screen.findByTestId('alerts-list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Cupo de IA al 80 %: Grupo Demo')).toBeInTheDocument();
    expect(within(list).getByText('8,50 créditos de 10,00 créditos')).toBeInTheDocument();
    expect(within(list).getByText('Urgente')).toBeInTheDocument();

    await user.click(screen.getByTestId('alert-resolve-a1'));
    expect(fake.callsTo('platform_alert_resolve', 'rpc')[0]!.payload).toEqual({ p_id: 'a1' });
    expect(await screen.findByTestId('alerts-list')).not.toHaveTextContent('Cupo de IA al 80 %');

    await user.click(screen.getByTestId('alerts-refresh'));
    expect(fake.callsTo('platform_alerts_refresh', 'rpc')).toHaveLength(1);
    expect(await screen.findByText('Nada nuevo')).toBeInTheDocument();
  });

  it('sin avisos lo dice, y en Plataforma el enlace lleva la cuenta de avisos abiertos', async () => {
    seedPlatform({ alerts: [] });
    renderApp('/plataforma/gasto');
    expect(await screen.findByTestId('alerts-empty')).toBeInTheDocument();
  });

  it('la página de Plataforma enlaza a «Gasto y uso» con el número de avisos', async () => {
    seedPlatform();
    renderApp('/plataforma');
    const link = await screen.findByTestId('platform-usage-link');
    expect(link).toHaveAttribute('href', '/plataforma/gasto');
    expect(await within(link).findByTestId('platform-alert-count')).toHaveTextContent('1');
  });
});

describe('consumo frente al cupo en cada organización', () => {
  it('Ajustes → Consumo de IA avisa al pasar del 80 %', async () => {
    seedWorkspace({ orgRole: 'admin' });
    fake.tables.usage_quotas = [
      { organization_id: ORG_ID, metric: 'ai_cost_micros', period: 'month', limit_value: 10 * M, updated_by: null },
    ];
    const period = new Date().toISOString().slice(0, 7) + '-01';
    fake.tables.ai_usage = [
      {
        id: 1,
        organization_id: ORG_ID,
        brand_id: null,
        generation_id: 'g1',
        period_start: period,
        entry: 'settle',
        reserved_delta_micros: 0,
        cost_delta_micros: 8_500_000,
        created_at: `${period}T10:00:00Z`,
      },
    ];
    fake.rpc('organization_plan_usage', () => ({ plan: { name: 'Pro' }, ai_limit_micros: 10 * M }));
    fake.rpc('ai_cost_by_organization', () => []);
    renderApp(`${BASE}/ajustes/ia`);
    expect(await screen.findByTestId('ai-quota-near')).toHaveTextContent('85 %');
    expect(screen.queryByTestId('ai-quota-exhausted')).not.toBeInTheDocument();
  });
});

describe('IA en pausa por el tope global', () => {
  it('el aviso lo explica y deja claro que se puede seguir a mano', () => {
    const error = new AiRequestError('ai_paused', 'La IA de pago está en pausa este mes.', { status: 503 });
    render(<AiErrorNotice error={error} />);
    expect(screen.getByTestId('ai-quota-error')).toHaveTextContent('La IA de pago está en pausa');
    expect(screen.getByTestId('ai-quota-error')).toHaveTextContent('seguir escribiendo y editando a mano');
  });
});
