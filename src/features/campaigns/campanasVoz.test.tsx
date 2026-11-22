import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument } from '@/features/content/document';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, brandRow, renderApp, seedWorkspace } from '@/test/fixtures';
import type { BrandDesignTemplateRow, CampaignRow } from '@/lib/database.types';
import type { BrandTemplate } from '@/features/content/templates/api';
import type { BrandReelTemplate } from '@/features/reels/editor/api';
import {
  agreementFor,
  brandNetworkIds,
  durationText,
  onlyNetwork,
  rhythmText,
  weeksOf,
  type BriefProposal,
} from './brief';
import { nextWeek } from './plan';
import { isVideoPiece, suggestTemplates } from './templateHints';

// «Preparar un plan con IA»: dictar lo que se quiere, que la IA proponga y
// rellene los detalles (duración razonada, ritmo, redes), ajustarlos, la
// pregunta única, y que todo siga valiendo a mano sin IA. El micrófono del
// navegador y las funciones son simulados: nada sale a ninguna red.

const GENERATION = '11111111-1111-4111-8111-111111111111';
const week = nextWeek(new Date());

const PROPOSAL: BriefProposal = {
  title: 'Menú de otoño',
  objective: 'Dar a conocer el menú de otoño.',
  networks: ['instagram'],
  startDate: week.start,
  endDate: addDays(week.start, 20),
  perWeek: 3,
  mix: [
    { network: 'instagram', format: 'reel', perWeek: 2 },
    { network: 'instagram', format: 'post', perWeek: 1 },
  ],
  weeks: [
    { title: 'Anuncio', focus: 'Se presenta el menú.' },
    { title: 'Platos', focus: 'Los platos, uno a uno.' },
    { title: 'Cierre', focus: 'Últimos días.' },
  ],
  why: 'Te propongo 3 semanas porque el menú se anuncia, se enseña y se cierra.',
};

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function briefReply(proposal: BriefProposal | null, extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: {
      action: 'campaign.brief',
      generationId: GENERATION,
      status: proposal ? 'proposal' : 'question',
      question: proposal ? null : '¿Qué quieres dar a conocer?',
      proposal,
      notes: [],
      costMicros: 1200,
      ...extra,
    },
  };
}

function planReply() {
  return {
    status: 200,
    body: {
      action: 'campaign.plan',
      generationId: GENERATION,
      status: 'proposal',
      discarded: [],
      plan: {
        objective: 'Dar a conocer el menú.',
        summary: '',
        reasoning: { observed: [], dataBacked: [], hypotheses: [], dataNote: '' },
        pieces: [
          {
            network: 'instagram',
            format: 'post',
            date: week.start,
            idea: 'Plato',
            caption: 'Texto.',
            hashtags: [],
            assetIds: [],
            why: '',
          },
        ],
      },
    },
  };
}

function campaignRow(): CampaignRow {
  return {
    id: 'camp-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Menú de otoño',
    instruction: 'x',
    networks: ['instagram'],
    starts_on: week.start,
    ends_on: week.end,
    origin: 'ai',
    status: 'proposed',
    current_plan_version: 1,
    accepted_plan_version: null,
    created_by: ME.id,
    accepted_by: null,
    accepted_at: null,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
  };
}

function seed(accounts: string[] = ['instagram'], agency = false) {
  seedWorkspace({ orgRole: 'member', brandRole: 'editor', brands: [brandRow({ ai_mode: agency ? 'agency' : 'api' })] });
  fake.tables.campaigns = [];
  fake.tables.campaign_plans = [];
  fake.tables.campaign_contents = [];
  fake.tables.content_items = [];
  fake.tables.content_versions = [];
  fake.tables.content_requests = [];
  fake.tables.media_assets = [];
  fake.tables.brand_knowledge_sources = [];
  fake.tables.brand_design_templates = [];
  fake.tables.brand_reel_templates = [];
  fake.tables.social_accounts = accounts.map((network, i) => ({
    id: `acc-${i}`,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    network,
    status: 'active',
    external_id: `${i}`,
    username: `cuenta_${i}`,
  }));
}

async function openDialog() {
  const { user } = renderApp(`${BRAND_BASE}/campanas`);
  await user.click(await screen.findByTestId('campaign-new'));
  const dialog = within(await screen.findByRole('dialog'));
  return { user, dialog };
}

/** Lo último que se mandó a `ai-generate`. */
function lastCall(action: string) {
  const calls = fake
    .callsTo('ai-generate', 'function')
    .map((call) => call.payload as { action: string; input: Record<string, unknown> })
    .filter((payload) => payload.action === action);
  return calls[calls.length - 1];
}

describe('Preparar un plan con IA: dictar y que la IA rellene los detalles', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    window.localStorage.clear();
  });

  it('se puede dictar «qué quieres preparar»: aviso de privacidad primero y lo dicho se añade al campo', async () => {
    const instances: { say(text: string): void }[] = [];
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((event: { resultIndex: number; results: unknown[] }) => void) | null = null;
      onerror = null;
      onend = null;
      constructor() {
        instances.push(this);
      }
      start() {}
      stop() {}
      abort() {}
      say(text: string) {
        this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    seed();
    const { user, dialog } = await openDialog();
    await user.click(dialog.getByTestId('campaign-instruction-mic'));
    expect(dialog.getByTestId('campaign-instruction-notice')).toHaveTextContent('servicio de voz de tu navegador');
    await user.click(dialog.getByTestId('campaign-instruction-notice-ok'));
    act(() => instances[0]!.say('prepárame la campaña del menú de otoño'));
    expect(dialog.getByTestId('campaign-instruction')).toHaveValue('prepárame la campaña del menú de otoño');
    // También se puede escribir encima.
    await user.type(dialog.getByTestId('campaign-instruction'), ' hasta navidades');
    expect(dialog.getByTestId('campaign-instruction')).toHaveValue(
      'prepárame la campaña del menú de otoño hasta navidades',
    );
  });

  it('la IA propone y rellena: duración razonada, ritmo, redes y nombre; los Detalles quedan para corregir', async () => {
    seed();
    fake.fn('ai-generate', () => briefReply(PROPOSAL));
    const { user, dialog } = await openDialog();
    // Lo esencial arriba; los detalles, plegados, con un resumen de lo que valen ahora.
    expect(dialog.getByTestId('campaign-details-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(dialog.getByTestId('campaign-details-summary')).toHaveTextContent('Instagram');
    expect(dialog.queryByTestId('campaign-brief')).not.toBeInTheDocument();
    expect(dialog.getByTestId('campaign-brief-ask')).toBeDisabled();

    await user.type(
      dialog.getByTestId('campaign-instruction'),
      'Prepárame la campaña del menú de otoño, que dure hasta navidades, sobre todo reels',
    );
    await user.click(dialog.getByTestId('campaign-brief-ask'));

    expect(await dialog.findByTestId('campaign-brief-why')).toHaveTextContent('Te propongo 3 semanas porque');
    expect(dialog.getByTestId('campaign-brief-duration')).toHaveTextContent(/^3 semanas, del /);
    expect(dialog.getByTestId('campaign-brief-rhythm')).toHaveTextContent(
      '3 a la semana: 2 × Instagram · Reel, 1 × Instagram · Publicación',
    );
    expect(dialog.getByTestId('campaign-brief-weeks')).toHaveTextContent('Semana 2 · Platos');
    expect(dialog.getByTestId('campaign-brief-cost')).toHaveTextContent('ha costado');

    // Solo se ofrecen las redes de la marca (la conectada), con todos sus formatos.
    const sent = lastCall('campaign.brief')!;
    expect(new Set((sent.input.targets as { network: string }[]).map((t) => t.network))).toEqual(
      new Set(['instagram']),
    );
    expect(sent.input.instruction).toMatch(/menú de otoño/);
    expect(sent.input.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Rellenado en «Detalles»: fechas y nombre, para corregir.
    await user.click(dialog.getByTestId('campaign-details-toggle'));
    expect(dialog.getByTestId('campaign-starts')).toHaveValue(PROPOSAL.startDate);
    expect(dialog.getByTestId('campaign-ends')).toHaveValue(PROPOSAL.endDate);
    expect(dialog.getByTestId('campaign-title')).toHaveValue('Menú de otoño');
    expect(dialog.getByTestId('campaign-network-instagram')).toBeChecked();
    expect(dialog.queryByTestId('campaign-network-tiktok')).not.toBeInTheDocument();
  });

  it('por defecto solo salen las redes de la marca; «Otras redes» enseña el resto, desmarcadas', async () => {
    seed(['instagram', 'facebook']);
    const { user, dialog } = await openDialog();
    await user.click(dialog.getByTestId('campaign-details-toggle'));
    expect(dialog.getByTestId('campaign-network-instagram')).toBeChecked();
    expect(dialog.getByTestId('campaign-network-facebook')).toBeChecked();
    for (const id of ['tiktok', 'linkedin', 'x', 'youtube', 'pinterest', 'google_business']) {
      expect(dialog.queryByTestId(`campaign-network-${id}`)).not.toBeInTheDocument();
    }
    await user.click(dialog.getByTestId('campaign-more-networks'));
    expect(dialog.getByTestId('campaign-network-tiktok')).not.toBeChecked();
    expect(dialog.getByTestId('campaign-network-google_business')).not.toBeChecked();
  });

  it('«Más corta» y «Más larga» piden el ajuste a la IA con la propuesta delante; «Solo Instagram» se hace sin IA', async () => {
    seed(['instagram', 'facebook']);
    const two: BriefProposal = {
      ...PROPOSAL,
      networks: ['instagram', 'facebook'],
      mix: [...PROPOSAL.mix, { network: 'facebook', format: 'page_post', perWeek: 1 }],
      perWeek: 4,
    };
    const shorter: BriefProposal = {
      ...two,
      endDate: addDays(PROPOSAL.startDate, 13),
      weeks: two.weeks.slice(0, 2),
      why: 'Te propongo 2 semanas.',
    };
    let calls = 0;
    fake.fn('ai-generate', () => {
      calls += 1;
      return briefReply(calls === 1 ? two : shorter);
    });
    const { user, dialog } = await openDialog();
    await user.type(dialog.getByTestId('campaign-instruction'), 'Menú de otoño en Instagram y Facebook');
    await user.click(dialog.getByTestId('campaign-brief-ask'));
    await dialog.findByTestId('campaign-brief');
    expect(dialog.getByTestId('campaign-brief-only-instagram')).toBeInTheDocument();

    await user.click(dialog.getByTestId('campaign-brief-shorter'));
    await waitFor(() => expect(dialog.getByTestId('campaign-brief-why')).toHaveTextContent('Te propongo 2 semanas.'));
    const adjust = lastCall('campaign.brief')!;
    expect(adjust.input).toMatchObject({ adjust: 'shorter', current: { startDate: PROPOSAL.startDate } });
    expect(dialog.getByTestId('campaign-brief-duration')).toHaveTextContent(/^2 semanas/);

    // Solo Instagram: sin llamar otra vez a la IA, deja esa red y su reparto.
    const before = fake.callsTo('ai-generate', 'function').length;
    await user.click(dialog.getByTestId('campaign-brief-only-instagram'));
    expect(fake.callsTo('ai-generate', 'function')).toHaveLength(before);
    expect(dialog.getByTestId('campaign-brief-rhythm')).toHaveTextContent('3 a la semana: 2 × Instagram · Reel, 1 × Instagram · Publicación');
    expect(dialog.queryByTestId('campaign-brief-only-instagram')).not.toBeInTheDocument();
    await user.click(dialog.getByTestId('campaign-details-toggle'));
    expect(dialog.getByTestId('campaign-network-instagram')).toBeChecked();
    expect(dialog.getByTestId('campaign-network-facebook')).not.toBeChecked();
  });

  it('si falta un dato imprescindible, hace UNA pregunta corta; contestada, propone', async () => {
    seed();
    let calls = 0;
    fake.fn('ai-generate', () => {
      calls += 1;
      return calls === 1 ? briefReply(null) : briefReply(PROPOSAL);
    });
    const { user, dialog } = await openDialog();
    await user.type(dialog.getByTestId('campaign-instruction'), 'Prepara algo bonito');
    await user.click(dialog.getByTestId('campaign-brief-ask'));
    const question = await dialog.findByTestId('campaign-brief-question');
    expect(question).toHaveTextContent('¿Qué quieres dar a conocer?');
    expect(dialog.queryByTestId('campaign-brief')).not.toBeInTheDocument();

    // Intro en la respuesta contesta la pregunta; no envía el formulario (no pide el plan por error).
    await user.type(dialog.getByTestId('campaign-answer'), 'El menú de otoño{Enter}');
    expect(await dialog.findByTestId('campaign-brief')).toBeInTheDocument();
    expect(fake.callsTo('ai-generate', 'function').map((c) => (c.payload as { action: string }).action)).toEqual([
      'campaign.brief',
      'campaign.brief',
    ]);
    expect(lastCall('campaign.brief')!.input.answer).toEqual({
      question: '¿Qué quieres dar a conocer?',
      text: 'El menú de otoño',
    });
    expect(dialog.queryByTestId('campaign-brief-question')).not.toBeInTheDocument();
  });

  it('«Preparar el plan» lleva lo acordado (ritmo, reparto y semanas) a campaign.plan', async () => {
    seed();
    fake.fn('ai-generate', (body) =>
      (body as { action: string }).action === 'campaign.brief' ? briefReply(PROPOSAL) : planReply(),
    );
    fake.rpc('create_campaign', () => campaignRow());
    const { user, dialog } = await openDialog();
    await user.type(dialog.getByTestId('campaign-instruction'), 'Menú de otoño, sobre todo reels');
    await user.click(dialog.getByTestId('campaign-brief-ask'));
    await dialog.findByTestId('campaign-brief');
    await user.click(dialog.getByTestId('campaign-submit'));
    await waitFor(() => expect(lastCall('campaign.plan')).toBeDefined());
    const plan = lastCall('campaign.plan')!;
    expect(plan.input).toMatchObject({
      startDate: PROPOSAL.startDate,
      endDate: PROPOSAL.endDate,
      agreement: {
        objective: 'Dar a conocer el menú de otoño.',
        perWeek: 3,
        mix: PROPOSAL.mix,
        phases: PROPOSAL.weeks,
      },
    });
    expect(fake.callsTo('create_campaign', 'rpc')[0]!.payload).toMatchObject({
      p_title: 'Menú de otoño',
      p_starts_on: PROPOSAL.startDate,
    });
  });

  it('sin IA (sin proveedor o sin cupo) el formulario funciona a mano y el error se explica', async () => {
    seed();
    fake.fn('ai-generate', (body) =>
      (body as { action: string }).action === 'campaign.brief'
        ? {
            status: 402,
            body: { error: { code: 'quota_exhausted', message: 'Se ha agotado el cupo.', retryable: false } },
          }
        : planReply(),
    );
    fake.rpc('create_campaign', () => campaignRow());
    const { user, dialog } = await openDialog();
    await user.type(dialog.getByTestId('campaign-instruction'), 'Prepara la semana que viene');
    await user.click(dialog.getByTestId('campaign-brief-ask'));
    expect(await dialog.findByTestId('ai-quota-error')).toHaveTextContent('puedes seguir escribiendo y editando a mano');
    expect(dialog.queryByTestId('campaign-brief')).not.toBeInTheDocument();
    // A mano: cambiar una fecha en Detalles y pedir el plan (sin acuerdo previo, como siempre).
    await user.click(dialog.getByTestId('campaign-details-toggle'));
    expect(dialog.getByTestId('campaign-starts')).toHaveValue(week.start);
    await user.click(dialog.getByTestId('campaign-submit'));
    await waitFor(() => expect(lastCall('campaign.plan')).toBeDefined());
    expect(lastCall('campaign.plan')!.input).not.toHaveProperty('agreement');
  });

  it('en modo agencia se dicta y se escribe, pero no hay botón de proponer con IA', async () => {
    seed(['instagram'], true);
    fake.rpc('request_campaign_plan', () => campaignRow());
    const { dialog } = await openDialog();
    expect(dialog.getByTestId('campaign-instruction')).toBeInTheDocument();
    expect(dialog.queryByTestId('campaign-brief-ask')).not.toBeInTheDocument();
    expect(dialog.getByTestId('campaign-submit')).toHaveTextContent('Pedir el plan');
  });

  it('sin texto no se le pregunta nada a la IA y se avisa', async () => {
    seed();
    const { dialog } = await openDialog();
    expect(dialog.getByTestId('campaign-brief-ask')).toBeDisabled();
    expect(fake.callsTo('ai-generate', 'function')).toHaveLength(0);
  });
});

describe('lo puro de la propuesta', () => {
  it('redes de la marca: conectadas y de sus plantillas, en el orden del catálogo; Instagram si no hay ninguna', () => {
    expect(brandNetworkIds(['facebook', 'instagram'], ['tiktok', 'inventada'])).toEqual([
      'instagram',
      'facebook',
      'tiktok',
    ]);
    expect(brandNetworkIds([], [])).toEqual(['instagram']);
  });

  it('cuenta semanas y las dice en llano', () => {
    expect(weeksOf('2026-12-01', '2026-12-07')).toBe(1);
    expect(weeksOf('2026-12-01', '2026-12-08')).toBe(2);
    expect(durationText({ startDate: '2026-12-01', endDate: '2026-12-21' })).toMatch(/^3 semanas, del /);
    expect(durationText({ startDate: '2026-12-01', endDate: '2026-12-07' })).toMatch(/^1 semana, del /);
    expect(rhythmText({ perWeek: 2, mix: [{ network: 'instagram', format: 'reel', perWeek: 2 }] })).toBe(
      '2 a la semana: 2 × Instagram · Reel',
    );
  });

  it('«solo una red» deja su parte del reparto o, si no tenía, una publicación en su primer formato', () => {
    const base: BriefProposal = {
      ...PROPOSAL,
      networks: ['instagram', 'facebook'],
      mix: [
        { network: 'instagram', format: 'reel', perWeek: 2 },
        { network: 'facebook', format: 'page_post', perWeek: 1 },
      ],
      perWeek: 3,
    };
    expect(onlyNetwork(base, 'facebook')).toMatchObject({ networks: ['facebook'], perWeek: 1 });
    const none = onlyNetwork({ ...base, mix: [], perWeek: 2 }, 'instagram');
    expect(none.mix).toHaveLength(1);
    expect(none.mix[0]).toMatchObject({ network: 'instagram', perWeek: 2 });
  });

  it('lo acordado se pone al día con los cambios de «Detalles»', () => {
    // Redes y fechas como las propuso la IA: todo viaja.
    expect(agreementFor(PROPOSAL, ['instagram'], PROPOSAL.startDate, PROPOSAL.endDate)).toMatchObject({
      perWeek: 3,
      phases: PROPOSAL.weeks,
    });
    // Si las semanas ya no cuadran, sin fases; si se quita la red, sin reparto.
    expect(agreementFor(PROPOSAL, ['instagram'], PROPOSAL.startDate, addDays(PROPOSAL.startDate, 6))).not.toHaveProperty(
      'phases',
    );
    const quitada = agreementFor(PROPOSAL, ['facebook'], PROPOSAL.startDate, PROPOSAL.endDate)!;
    expect(quitada).not.toHaveProperty('mix');
    expect(quitada.objective).toBe(PROPOSAL.objective);
    expect(agreementFor(null, ['instagram'], PROPOSAL.startDate, PROPOSAL.endDate)).toBeUndefined();
  });
});

describe('qué plantilla de la marca encaja con cada pieza', () => {
  const design = (id: string, name: string, summary: string): BrandTemplate => ({
    id,
    key: id,
    name,
    network: 'instagram',
    format: 'post',
    document: createEmptyDocument({ aspectRatio: '4:5' }),
    analysis: { summary } as BrandTemplate['analysis'],
    source: 'manual',
  });
  const reel = (id: string, name: string, purpose: string): BrandReelTemplate =>
    ({
      id,
      key: id,
      name,
      source: 'catalog',
      template: { purpose, whenToUse: '' },
    }) as unknown as BrandReelTemplate;
  const piece = (format: string, idea: string, network = 'instagram') => ({ network, format, idea, caption: '' });

  it('un reel mira las plantillas de reel; una publicación, las de diseño que valen para su formato', () => {
    expect(isVideoPiece('instagram', 'reel')).toBe(true);
    expect(isVideoPiece('instagram', 'post')).toBe(false);
    const hints = suggestTemplates(
      [piece('reel', 'Cómo preparamos el arroz'), piece('post', 'Plato del día')],
      [design('d1', 'Plato del día', 'Foto grande con precio')],
      [reel('r1', 'Receta paso a paso', 'Cómo preparamos un plato, paso a paso')],
    );
    expect(hints[0]).toEqual({ kind: 'reel', id: 'r1', name: 'Receta paso a paso' });
    expect(hints[1]).toEqual({ kind: 'design', id: 'd1', name: 'Plato del día' });
  });

  it('elige la que más se parece a la idea y reparte entre las que valen para que no se repita siempre la misma', () => {
    const templates = [
      design('a', 'Oferta', 'Precio y promoción'),
      design('b', 'Plato del día', 'Foto grande'),
      design('c', 'Equipo', 'Retrato del equipo'),
    ];
    const hints = suggestTemplates(
      [piece('post', 'Plato del día de hoy'), piece('post', 'Otra cosa'), piece('post', 'Otra más')],
      templates,
      [],
    );
    expect(hints[0]!.name).toBe('Plato del día');
    // Sin parecido, se reparte: no se repite la usada.
    expect(new Set(hints.map((h) => h!.id)).size).toBe(3);
  });

  it('si no encaja ninguna (otro formato, sin plantillas), no inventa: devuelve nada', () => {
    expect(suggestTemplates([piece('reel', 'Reel')], [design('a', 'Oferta', '')], [])).toEqual([null]);
    expect(suggestTemplates([piece('post', 'Post')], [], [reel('r', 'Receta', '')])).toEqual([null]);
    // Una plantilla de otra proporción no vale para ese formato.
    const ancha = { ...design('x', 'Ancha', ''), document: createEmptyDocument({ aspectRatio: '9:16' }) };
    expect(suggestTemplates([piece('post', 'Post')], [ancha], [])).toEqual([null]);
  });
});

describe('la ficha de una pieza del plan dice de qué plantilla saldría', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('enseña la plantilla de diseño de la marca que encaja, como sugerencia', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    const row: BrandDesignTemplateRow = {
      id: 'tpl-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      template_key: 'plato-del-dia',
      name: 'Plato del día',
      network: 'instagram',
      format: 'post',
      source: 'manual',
      document: createEmptyDocument({ aspectRatio: '4:5' }),
      analysis: null,
      references: [],
      created_at: '2026-11-18T09:00:00Z',
      updated_at: '2026-11-18T09:00:00Z',
    } as unknown as BrandDesignTemplateRow;
    seed();
    const campaign = campaignRow();
    fake.tables.campaigns = [campaign];
    fake.tables.campaign_plans = [
      {
        id: 'camp-1-v1',
        campaign_id: campaign.id,
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        version: 1,
        data: planReply().body.plan,
        source: 'ai',
        generation_id: null,
        created_by: ME.id,
        created_at: '2026-11-18T09:00:00Z',
      },
    ];
    fake.tables.brand_design_templates = [row];
    const { user } = renderApp(`${BRAND_BASE}/campanas/camp-1`);
    await user.click(await screen.findByTestId('campaign-plan-piece'));
    expect(await screen.findByTestId('campaign-piece-template')).toHaveTextContent(
      'Plantilla de diseño de la marca: «Plato del día»',
    );
    expect(screen.getByTestId('campaign-piece-template')).toHaveTextContent('Es una sugerencia');
  });
});
