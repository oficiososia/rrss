import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as storageApi from '@/features/storage/api';
import type { AnalyticsMetricDefinitionRow } from '@/lib/database.types';
import { fireEvent } from '@testing-library/react';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, brandRow, renderApp, seedWorkspace } from '@/test/fixtures';

// Panel de analítica (Fase 5) contra el Supabase simulado: cifras medidas,
// dato frente a hipótesis, lo que no se puede medir, informes y el botón de
// IA solo donde existe. Las cifras las impone la base de datos
// (tests/db/analitica-captura.test.ts).

const def = (
  id: string,
  label: string,
  patch: Partial<AnalyticsMetricDefinitionRow> = {},
): AnalyticsMetricDefinitionRow => ({
  id,
  network: id.startsWith('facebook') ? 'facebook' : 'instagram',
  scope: 'account',
  api_name: 'x',
  api_source: 'insights',
  label,
  description: '',
  unit: 'count',
  aggregation: 'daily',
  media_types: [],
  estimated: false,
  in_development: false,
  status: 'captured',
  status_note: '',
  delay_hours: 48,
  source_url: 'https://developers.facebook.com/',
  verified_on: '2026-11-18',
  sort: 10,
  ...patch,
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function seed({ accounts = true, aiMode = 'api' as 'api' | 'agency' } = {}) {
  seedWorkspace({ orgRole: 'owner', brands: [brandRow({ ai_mode: aiMode })] });
  fake.tables.analytics_metric_definitions = [
    def('instagram.account.followers', 'Seguidores', { aggregation: 'snapshot', api_source: 'field', sort: 1 }),
    def('instagram.account.reach', 'Alcance', { estimated: true, sort: 2 }),
    def('instagram.account.impressions', 'Impresiones', {
      status: 'retired',
      api_name: null,
      api_source: null,
      status_note: 'Meta la retiró.',
      sort: 50,
    }),
    def('facebook.account.all', 'Facebook', {
      status: 'not_captured',
      api_name: null,
      api_source: null,
      status_note: 'No se conecta.',
      sort: 90,
    }),
  ];
  fake.tables.social_accounts = accounts
    ? [
        {
          id: 'acc-1',
          brand_id: BRAND_ID,
          organization_id: ORG_ID,
          network: 'instagram',
          username: 'casa_demo',
          status: 'active',
          created_at: '2026-11-01T00:00:00Z',
        },
      ]
    : [];
  const rows = [];
  for (let i = -56; i < 0; i++) {
    rows.push({
      brand_id: BRAND_ID,
      metric_id: 'instagram.account.reach',
      metric_date: day(i),
      value: i < -28 ? '100' : '150',
      provisional: i > -3,
    });
  }
  rows.push({
    brand_id: BRAND_ID,
    metric_id: 'instagram.account.followers',
    metric_date: day(-1),
    value: 1234,
    provisional: false,
  });
  fake.tables.account_metrics_daily = accounts ? rows : [];
  fake.tables.analytics_capture_runs = accounts
    ? [
        {
          id: 'run-1',
          brand_id: BRAND_ID,
          social_account_id: 'acc-1',
          status: 'partial',
          unavailable: [
            { metric_id: 'instagram.account.views', reason: 'no_data', message: 'Meta no dio cifras para estos días.' },
          ],
          error_message: null,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        },
      ]
    : [];
  fake.tables.analytics_reports = [
    {
      id: 'rep-1',
      brand_id: BRAND_ID,
      period_start: '2026-10-01',
      status: 'ready',
      source: 'schedule',
      revision: 1,
      media_asset_id: 'pdf-1',
      error: null,
    },
  ];
  fake.tables.media_assets = [
    {
      id: 'pdf-1',
      brand_id: BRAND_ID,
      storage_path: `${ORG_ID}/${BRAND_ID}/informes/a.pdf`,
      file_name: 'informe-2026-10.pdf',
    },
  ];
  fake.rpc('analytics_media_summary', () =>
    accounts
      ? [
          {
            publication_id: 'p1',
            title: 'Pan de otoño',
            format: 'post',
            network: 'instagram',
            media_product_type: 'FEED',
            published_at: `${day(-5)}T10:00:00Z`,
            external_url: 'https://instagram.simulado.invalid/p/1/',
            provisional: false,
            metrics: { 'instagram.media.total_interactions': '80', 'instagram.media.reach': 400 },
          },
          {
            publication_id: 'p2',
            title: 'Reel del horno',
            format: 'reel',
            network: 'instagram',
            media_product_type: 'REELS',
            published_at: `${day(-4)}T10:00:00Z`,
            external_url: null,
            provisional: true,
            metrics: { 'instagram.media.total_interactions': 20, 'instagram.media.reach': 300 },
          },
        ]
      : [],
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Resultados (Analítica)', () => {
  it('está en el menú como «Resultados» y enseña cifras medidas, datos, hipótesis y lo que no se puede medir', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    await user.click((await screen.findAllByRole('link', { name: 'Resultados' }))[0]!);

    const kpis = await screen.findByTestId('analytics-kpis');
    const reach = within(kpis).getByTestId('kpi-instagram.account.reach');
    expect(reach).toHaveTextContent('4200');
    expect(reach).toHaveTextContent('+50 %');
    expect(reach).toHaveTextContent('Estimación de Meta');
    expect(reach).toHaveTextContent('Provisional');
    expect(within(kpis).getByTestId('kpi-instagram.account.followers')).toHaveTextContent('1234');

    const facts = screen.getByTestId('analytics-facts');
    expect(within(facts).getAllByText('Dato').length).toBeGreaterThan(2);
    expect(facts).toHaveTextContent('Alcance: 4200 (periodo anterior: 2800, +50 %).');
    const hypotheses = screen.getByTestId('analytics-hypotheses');
    expect(within(hypotheses).getAllByText('Interpretación').length).toBeGreaterThan(0);

    const unmeasurable = screen.getByTestId('analytics-unmeasurable');
    expect(unmeasurable).toHaveTextContent('Impresiones: Meta la retiró.');
    expect(unmeasurable).toHaveTextContent('Meta no dio cifras para estos días.');
    expect(screen.getByTestId('analytics-networks')).toHaveTextContent(
      'Las páginas de Facebook todavía no se conectan.',
    );

    expect(screen.getByTestId('analytics-best-posts')).toHaveTextContent('Pan de otoño');
    expect(screen.getByTestId('analytics-worst-posts')).toHaveTextContent('Reel del horno');
    expect(screen.getByTestId('analytics-chart')).toBeInTheDocument();

    // Sin IA en el entorno, no hay botón de IA.
    expect(screen.queryByTestId('analytics-ai')).not.toBeInTheDocument();
  });

  it('el informe listo se descarga y quien edita puede pedir otro', async () => {
    seed();
    fake.rpc('request_analytics_report', (args) => ({ id: 'rep-2', ...args, status: 'queued' }));
    const { user } = renderApp(`${BRAND_BASE}/analitica`);
    const reports = await screen.findByTestId('analytics-reports');
    expect(reports).toHaveTextContent('Listo');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await user.click(within(reports).getByTestId('analytics-download'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.test/signed', '_blank', 'noopener'));
    await user.click(screen.getByTestId('analytics-request-report'));
    await waitFor(() => expect(fake.callsTo('request_analytics_report', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('request_analytics_report', 'rpc')[0]!.payload).toMatchObject({ p_brand_id: BRAND_ID });
  });

  it('con IA en el entorno, la interpretación sale marcada como hipótesis de la IA', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seed();
    fake.fn('ai-generate', (body) => ({
      status: 200,
      body: {
        action: 'analytics.summary',
        generationId: 'gen-1',
        hypotheses: [
          {
            id: 'ai:1',
            kind: 'hypothesis',
            source: 'ai',
            text: 'Podría convenir publicar más reels.',
            basedOn: ['total:instagram.account.reach'],
          },
        ],
        discarded: 1,
        echo: body,
      },
    }));
    const { user } = renderApp(`${BRAND_BASE}/analitica`);
    await user.click(await screen.findByTestId('analytics-ai'));
    const ai = await screen.findByTestId('analytics-ai-hypotheses');
    expect(ai).toHaveTextContent('Interpretación (IA)');
    expect(ai).toHaveTextContent('Podría convenir publicar más reels.');
    expect(ai).toHaveTextContent('Se apoya en: Alcance: 4200');
    expect(ai).toHaveTextContent('Se han descartado 1');
    const payload = fake.callsTo('ai-generate', 'function')[0]!.payload as {
      action: string;
      input: { from: string; to: string };
    };
    expect(payload.action).toBe('analytics.summary');
    // Solo el periodo: las cifras las lee el servidor.
    expect(Object.keys(payload.input).sort()).toEqual(['from', 'to']);
  });

  it('en modo agencia no se ofrece la interpretación con IA', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seed({ aiMode: 'agency' });
    renderApp(`${BRAND_BASE}/analitica`);
    await screen.findByTestId('analytics-facts');
    expect(screen.queryByTestId('analytics-ai')).not.toBeInTheDocument();
  });

  it('sin cuentas conectadas lo dice en vez de enseñar ceros', async () => {
    seed({ accounts: false });
    renderApp(`${BRAND_BASE}/analitica`);
    expect(await screen.findByText('Todavía no hay nada que medir')).toBeInTheDocument();
    expect(screen.queryByTestId('analytics-kpis')).not.toBeInTheDocument();
    // Un botón que lleva a conectarla, y nada de periodo ni informes mientras no hay qué medir.
    expect(screen.getByTestId('analytics-connect')).toHaveAttribute(
      'href',
      `${BRAND_BASE}/marca?seccion=datos#cuentas-conectadas`,
    );
    expect(screen.queryByTestId('analytics-range')).not.toBeInTheDocument();
  });
});

describe('Analítica de un vistazo', () => {
  beforeEach(() => {
    vi.spyOn(storageApi, 'signStoragePaths').mockImplementation(
      async (paths) => new Map(paths.map((path) => [path, `https://example.test/${path}`])),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('arriba va la frase del periodo con la variación en palabras y las cifras grandes', async () => {
    seed();
    renderApp(`${BRAND_BASE}/analitica`);
    const sentence = await screen.findByTestId('analytics-sentence');
    // 28 días a 150 frente a 28 días a 100: 4.200 contra 2.800.
    expect(sentence).toHaveTextContent(
      'En los últimos 28 días llegaste a 4200 personas, un 50 % más que en los 28 días anteriores.',
    );
    const kpis = screen.getByTestId('analytics-kpis');
    expect(within(kpis).getByTestId('kpi-instagram.account.reach')).toHaveTextContent('Personas alcanzadas');
    expect(within(kpis).getByTestId('kpi-instagram.account.reach')).toHaveTextContent('frente al periodo anterior');
    expect(within(kpis).getByTestId('kpi-instagram.account.followers')).toHaveTextContent('Seguidores');
    // Lo demás está plegado.
    expect(screen.getByTestId('analytics-more')).not.toHaveAttribute('open');
  });

  it('elegir una cifra cambia el gráfico y la guía muestra el valor de un día con el teclado', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/analitica`);
    const chart = await screen.findByTestId('analytics-chart');
    expect(within(chart).getByText('Personas alcanzadas')).toBeInTheDocument();
    await user.click(screen.getByTestId('kpi-instagram.account.followers'));
    expect(within(screen.getByTestId('analytics-chart')).getByText('Seguidores')).toBeInTheDocument();
    await user.click(screen.getByTestId('kpi-instagram.account.reach'));
    const area = within(screen.getByTestId('analytics-chart')).getByTestId('chart-area');
    area.focus();
    fireEvent.keyDown(area, { key: 'End' });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent(/^\d\d\/\d\d: 150$/);
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    expect(screen.getByTestId('chart-readout')).toHaveTextContent(/: 150$/);
    // Y la misma información como tabla.
    expect(within(screen.getByTestId('analytics-chart')).getAllByRole('row').length).toBeGreaterThan(20);
  });

  it('lo que mejor funcionó enseña la miniatura de la publicación, y un icono si no la tiene', async () => {
    seed();
    // Seis publicaciones: salen las tres mejores. Solo la primera tiene archivo.
    fake.rpc('analytics_media_summary', () =>
      [80, 70, 60, 30, 20, 10].map((n, i) => ({
        publication_id: `p${i + 1}`,
        title: i === 0 ? 'Pan de otoño' : `Otra ${i + 1}`,
        format: 'post',
        network: 'instagram',
        media_product_type: 'FEED',
        published_at: `${day(-5 + i)}T10:00:00Z`,
        external_url: null,
        provisional: false,
        metrics: { 'instagram.media.total_interactions': n },
      })),
    );
    fake.tables.scheduled_publications = [{ id: 'p1', media_asset_ids: ['img-1'] }];
    fake.tables.media_assets = [
      ...(fake.tables.media_assets ?? []),
      {
        id: 'img-1',
        brand_id: BRAND_ID,
        storage_path: `${ORG_ID}/${BRAND_ID}/media/pan.jpg`,
        thumb_path: `${ORG_ID}/${BRAND_ID}/thumbs/pan.jpg`,
        mime_type: 'image/jpeg',
        file_name: 'pan.jpg',
      },
    ];
    renderApp(`${BRAND_BASE}/analitica`);
    const top = await screen.findByTestId('analytics-top-posts');
    const items = within(top).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Pan de otoño');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('80 interacciones');
    await waitFor(() =>
      expect(items[0]!.querySelector('img')).toHaveAttribute(
        'src',
        `https://example.test/${ORG_ID}/${BRAND_ID}/thumbs/pan.jpg`,
      ),
    );
    // La segunda publicación no tiene archivo: icono, no una imagen inventada.
    expect(items[1]!.querySelector('img')).toBeNull();
  });

  it('con la cuenta conectada pero sin cifras, lo dice y explica cuándo llegan', async () => {
    seed();
    fake.tables.account_metrics_daily = [];
    fake.rpc('analytics_media_summary', () => []);
    renderApp(`${BRAND_BASE}/analitica`);
    expect(await screen.findByText(/Todavía no hay cifras de la cuenta en este periodo/)).toBeInTheDocument();
    expect(screen.queryByTestId('analytics-kpis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analytics-chart')).not.toBeInTheDocument();
    expect(screen.getByTestId('analytics-no-posts')).toBeInTheDocument();
  });

  it('sin publicaciones hechas desde la plataforma, dice cómo conseguir que salgan', async () => {
    seed();
    fake.rpc('analytics_media_summary', () => []);
    renderApp(`${BRAND_BASE}/analitica`);
    expect(await screen.findByTestId('analytics-no-posts')).toHaveTextContent(
      'Cuando publiques desde la plataforma, verás cuáles funcionan mejor.',
    );
  });

  it('si la cuenta hay que volver a conectarla, se avisa arriba', async () => {
    seed();
    fake.tables.social_accounts![0]!.status = 'needs_reauth';
    renderApp(`${BRAND_BASE}/analitica`);
    expect(await screen.findByText(/Hay que volver a conectar la cuenta de Instagram/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a conectarla' })).toBeInTheDocument();
  });

  it('el botón de IA está dentro de «Más detalle» y solo si la tarea está disponible', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seed();
    renderApp(`${BRAND_BASE}/analitica`);
    const more = await screen.findByTestId('analytics-more');
    expect(within(more).getByTestId('analytics-ai')).toBeInTheDocument();
  });
});
