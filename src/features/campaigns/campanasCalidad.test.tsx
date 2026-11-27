import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignRow } from '@/lib/database.types';
import { REEL_TEMPLATES } from '@/features/reels/templates';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, brandRow, renderApp, seedWorkspace } from '@/test/fixtures';
import { fetchPlannedSlot, prepareCampaignReels } from './api';
import { nextWeek, type CampaignPlan } from './plan';

// Prueba de calidad del 23/11/2026 (fallos 1, 2, 3, 15 y 16), en la interfaz:
// una marca sin perfil puede preparar un plan (con el sector, si falta), el
// coste máximo se ve antes, hay indicador mientras se prepara, un plan que no
// sirve dice que no se ha cobrado, los reels del plan salen con plantilla y
// fotos, y al programar se propone el día y la hora del plan.

const GENERATION = '11111111-1111-4111-8111-111111111111';
const week = nextWeek(new Date());

function seed(sector = 'Restauración') {
  seedWorkspace({ orgRole: 'member', brandRole: 'editor', brands: [brandRow({ sector })] });
  for (const table of [
    'campaigns',
    'campaign_plans',
    'campaign_contents',
    'content_items',
    'content_versions',
    'content_requests',
    'media_assets',
    'brand_knowledge_sources',
    'brand_design_templates',
    'brand_reel_templates',
    'brand_profiles',
    'brand_fonts',
  ]) {
    fake.tables[table] = [];
  }
  fake.tables.social_accounts = [
    {
      id: 'acc-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      network: 'instagram',
      status: 'active',
      external_id: '1',
      username: 'cuenta',
    },
  ];
}

function campaignRow(over: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: 'camp-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Campaña',
    instruction: 'x',
    networks: ['instagram'],
    starts_on: week.start,
    ends_on: week.end,
    origin: 'ai',
    status: 'accepted',
    current_plan_version: 1,
    accepted_plan_version: 1,
    created_by: ME.id,
    accepted_by: ME.id,
    accepted_at: '2026-11-18T09:00:00Z',
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
    ...over,
  };
}

async function openDialog() {
  const { user } = renderApp(`${BRAND_BASE}/campanas`);
  await user.click(await screen.findByTestId('campaign-new'));
  return { user, dialog: within(await screen.findByRole('dialog')) };
}

describe('marca sin perfil: la IA funciona y avisa', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sin perfil ni sector, pide el sector en el mismo diálogo antes de gastar y luego prepara el plan', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seed('');
    fake.fn('ai-generate', () => ({ status: 502, body: { error: { code: 'internal', message: 'x' } } }));
    const { user, dialog } = await openDialog();
    // Una línea, con enlace: no bloquea nada.
    const hint = await dialog.findByTestId('ai-profile-hint');
    expect(hint).toHaveTextContent('Con el perfil completo, los textos se parecerán más a tu marca');
    expect(within(hint).getByRole('link', { name: 'Completar el perfil' })).toHaveAttribute('href', `${BRAND_BASE}/marca`);
    // Coste máximo antes de pulsar.
    await user.type(dialog.getByTestId('campaign-instruction'), 'Reto Fuerza de 30 días, que se apunten');
    expect(await dialog.findByTestId('campaign-plan-cost')).toHaveTextContent(/Coste máximo de la propuesta y el plan \(hasta 9 semanas\)/);
    // Sin sector no se gasta nada.
    await user.click(dialog.getByTestId('campaign-submit'));
    expect(await dialog.findByText(/a qué se dedica la marca/)).toBeInTheDocument();
    expect(fake.callsTo('ai-generate', 'function')).toHaveLength(0);
    // Con el sector, va en la petición: primero la propuesta (no se ha pedido ni se han tocado los «Detalles»).
    await user.type(dialog.getByTestId('ai-brand-sector'), 'Gimnasio');
    await user.click(dialog.getByTestId('campaign-submit'));
    await waitFor(() => expect(fake.callsTo('ai-generate', 'function')).toHaveLength(1));
    const sent = fake.callsTo('ai-generate', 'function')[0]!.payload as { action: string; input: Record<string, unknown> };
    expect(sent).toMatchObject({ action: 'campaign.brief', input: { brandSector: 'Gimnasio' } });
    // La propuesta ha fallado: el plan no sale con lo de por defecto; se explica el error.
    expect(await dialog.findByTestId('ai-error')).toBeInTheDocument();
    expect(fake.callsTo('ai-generate', 'function')).toHaveLength(1);
    // Con «Detalles» tocados a mano, el plan sale con lo suyo y lleva el sector.
    await user.click(dialog.getByTestId('campaign-details-toggle'));
    fireEvent.change(dialog.getByTestId('campaign-ends'), { target: { value: week.start } });
    await user.click(dialog.getByTestId('campaign-submit'));
    await waitFor(() => expect(fake.callsTo('ai-generate', 'function')).toHaveLength(2));
    const plan = fake.callsTo('ai-generate', 'function')[1]!.payload as { action: string; input: Record<string, unknown> };
    expect(plan).toMatchObject({ action: 'campaign.plan', input: { brandSector: 'Gimnasio', endDate: week.start } });
  });

  it('con sector y sin perfil, no pide nada más: avisa en una línea y prepara', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seed('Coctelería');
    fake.fn('ai-generate', () => ({ status: 502, body: { error: { code: 'internal', message: 'x' } } }));
    const { dialog } = await openDialog();
    expect(await dialog.findByTestId('ai-profile-hint')).toHaveTextContent(/todavía no tiene perfil/);
    expect(dialog.queryByTestId('ai-brand-sector')).not.toBeInTheDocument();
  });
});

describe('plan con detalles a mano', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('mientras se prepara se ve que está trabajando; si la respuesta no sirve, se dice que no se ha cobrado', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    seed();
    let answer: (value: { status: number; body: unknown }) => void = () => undefined;
    fake.fn('ai-generate', () => new Promise((resolve) => (answer = resolve)));
    const { user, dialog } = await openDialog();
    await user.type(dialog.getByTestId('campaign-instruction'), 'Semana del arroz: 3 posts y 1 reel, el 24, 26 y 27');
    // Fechas puestas a mano en «Detalles»: el plan sale con ellas, sin propuesta antes.
    await user.click(dialog.getByTestId('campaign-details-toggle'));
    const later = new Date(Date.parse(`${week.end}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    fireEvent.change(dialog.getByTestId('campaign-ends'), { target: { value: later } });
    await user.click(dialog.getByTestId('campaign-submit'));
    expect(await dialog.findByTestId('campaign-plan-pending')).toHaveTextContent('Preparando el plan');
    expect((fake.callsTo('ai-generate', 'function')[0]!.payload as { action: string }).action).toBe('campaign.plan');
    answer({
      status: 502,
      body: {
        error: {
          code: 'invalid_output',
          message: 'La IA ha respondido con un formato que no se puede usar.',
          retryable: true,
          generationId: GENERATION,
          charged: false,
        },
      },
    });
    expect(await dialog.findByTestId('ai-error')).toHaveTextContent('No se ha descontado nada');
    expect(dialog.queryByTestId('campaign-plan-pending')).not.toBeInTheDocument();
  });
});

describe('aceptar un plan con reels', () => {
  const plan: CampaignPlan = {
    objective: 'Dar a conocer la carta.',
    summary: '',
    reasoning: { observed: [], dataBacked: [], hypotheses: [], dataNote: '' },
    pieces: [
      { network: 'instagram', format: 'reel', date: week.start, idea: 'Reel del arroz meloso', caption: 'Reserva.', hashtags: [], assetIds: [], why: '', title: 'Arroz', headline: 'Arroz meloso', time: '13:00' },
      { network: 'instagram', format: 'post', date: week.start, idea: 'Post', caption: 'Ven.', hashtags: [], assetIds: [], why: '' },
      { network: 'instagram', format: 'reel', date: week.end, idea: 'Reel del chuletón a la brasa', caption: 'Reserva.', hashtags: [], assetIds: [], why: '', title: 'Chuletón' },
    ],
  };

  it('cada reel se guarda con plantilla y fotos de la biblioteca, sin repetir y sin exportaciones', async () => {
    seed();
    fake.tables.campaign_contents = [0, 1, 2].map((i) => ({
      campaign_id: 'camp-1',
      content_id: `c-${i}`,
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      plan_version: 1,
      piece_index: i,
      created_at: '2026-11-18T10:00:00Z',
    }));
    fake.tables.media_assets = ['arroz meloso', 'chuletón', 'tarta', 'salón', 'terraza', 'calamar', 'exportación arroz'].map(
      (name, i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        kind: 'image',
        storage_path: `${ORG_ID}/${BRAND_ID}/biblioteca/${i}.jpg`,
        file_name: `${name}.jpg`,
        mime_type: 'image/jpeg',
        duration_ms: null,
        created_at: `2026-11-1${i}T10:00:00Z`,
        provenance: name.startsWith('exportación') ? { type: 'export' } : null,
        folder: name.startsWith('exportación') ? 'Exportaciones' : '',
        tags: [],
      }),
    );
    fake.rpc('brand_reel_font_info', () => []);
    fake.rpc('save_content_version', (args) => ({ content_id: args.p_content_id, version: 2 }));

    const result = await prepareCampaignReels(BRAND_ID, campaignRow(), plan);
    expect(result).toMatchObject({ total: 2, prepared: 2, withoutMaterial: 0, failed: 0, mounted: 0 });
    const saved = fake.callsTo('save_content_version', 'rpc').map(
      (c) =>
        c.payload as {
          p_content_id: string;
          p_expected_version: number;
          p_data: { kind: string; copy?: unknown; template: { id: string }; plan: { clips: { path: string }[]; texts: { text: string }[] } };
        },
    );
    expect(saved.map((s) => s.p_content_id)).toEqual(['c-0', 'c-2']);
    for (const call of saved) {
      expect(call.p_expected_version).toBe(1);
      expect(call.p_data.kind).toBe('reel');
      expect(REEL_TEMPLATES.map((t) => t.id)).toContain(call.p_data.template.id);
      const paths = call.p_data.plan.clips.map((c) => c.path);
      expect(paths.length).toBeGreaterThan(0);
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths.some((p) => p.endsWith('/6.jpg'))).toBe(false); // la exportación, nunca
    }
    // Cada reel abre con la foto de su tema y el primero lleva el titular del plan.
    expect(saved[0]!.p_data.plan.clips[0]!.path).toMatch(/\/0\.jpg$/);
    expect(saved[1]!.p_data.plan.clips[0]!.path).toMatch(/\/1\.jpg$/);
    expect(saved[0]!.p_data.plan.texts.map((t) => t.text)).toContain('Arroz meloso');
    // Y el pie del plan, para publicarlo con él.
    expect(saved[0]!.p_data).toMatchObject({ copy: { caption: 'Reserva.', hashtags: [], aiGenerated: true } });
  });

  it('al programar se propone el día y la hora del plan', async () => {
    seed();
    fake.tables.campaign_contents = [
      { campaign_id: 'camp-1', content_id: 'c-0', brand_id: BRAND_ID, organization_id: ORG_ID, plan_version: 1, piece_index: 0, created_at: '' },
      { campaign_id: 'camp-1', content_id: 'c-1', brand_id: BRAND_ID, organization_id: ORG_ID, plan_version: 1, piece_index: 1, created_at: '' },
    ];
    fake.tables.campaign_plans = [
      { id: 'p-1', campaign_id: 'camp-1', brand_id: BRAND_ID, organization_id: ORG_ID, version: 1, data: plan, source: 'ai', generation_id: null, created_by: ME.id, created_at: '' },
    ];
    expect(await fetchPlannedSlot('c-0')).toBe(`${week.start}T13:00`);
    // Sin hora en el plan, a las 10:00, como el calendario.
    expect(await fetchPlannedSlot('c-1')).toBe(`${week.start}T10:00`);
    // Una pieza que no sale de un plan: nada.
    expect(await fetchPlannedSlot('otra')).toBeNull();
  });
});
