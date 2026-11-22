import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/features/content/document';
import { periodStartOf } from '@/features/ai/api';
import type { BrandDesignTemplateRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BASE, BRAND_BASE, BRAND_ID, brandRow, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// Cómo trabaja la organización: autogestión («Lo llevamos nosotros») frente a modo agencia.

function sidebarLinks() {
  const aside = document.getElementById('menu-lateral') as HTMLElement;
  return within(aside)
    .getAllByRole('link')
    .map((l) => l.textContent?.trim());
}

describe('Menú y pantallas según el modo de trabajo', () => {
  it('en autogestión no hay Encargos en el menú', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    renderApp(`${BRAND_BASE}/inicio`);
    await screen.findAllByTestId('brand-switcher');
    expect(sidebarLinks()).not.toContain('Encargos');
    expect(sidebarLinks()).toContain('Contenidos');
  });

  it('en autogestión, la dirección de Encargos vuelve al inicio de la marca', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    renderApp(`${BRAND_BASE}/encargos`);
    await waitFor(() => expect(window.location.pathname).toBe(`${BRAND_BASE}/inicio`));
  });

  it('en autogestión la ficha de la marca no ofrece «Quién redacta»', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    renderApp(`${BRAND_BASE}/marca?seccion=datos`);
    await screen.findByTestId('brand-data-save');
    expect(screen.queryByTestId('brand-ai-mode')).not.toBeInTheDocument();
  });

  it('en modo agencia sigue todo igual: Encargos en el menú y selector de quién redacta', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'agency', brands: [brandRow({ ai_mode: 'agency' })] });
    renderApp(`${BRAND_BASE}/marca?seccion=datos`);
    expect(await screen.findByTestId('brand-ai-mode')).toBeInTheDocument();
    expect(sidebarLinks()).toContain('Encargos');
  });
});

describe('Configuración → Cómo trabajáis', () => {
  it('en autogestión no se enseña el tipo (empresa o agencia) y se guarda solo el nombre', async () => {
    seedWorkspace({ orgRole: 'admin', workMode: 'self' });
    const { user } = renderApp(`${BASE}/ajustes/general`);
    const name = await screen.findByTestId('org-settings-name');
    expect(screen.queryByText('Tipo')).not.toBeInTheDocument();
    expect(screen.getByTestId('work-mode-self')).toBeChecked();
    await user.clear(name);
    await user.type(name, 'Casa Propia');
    await user.click(screen.getByTestId('org-settings-save'));
    await screen.findByText('Cambios guardados');
    expect(fake.callsTo('organizations', 'update')[0]?.payload).toEqual({ name: 'Casa Propia' });
  });

  it('pasar a «Nos lo lleva una agencia» se guarda al momento', async () => {
    seedWorkspace({ orgRole: 'admin', workMode: 'self' });
    const { user } = renderApp(`${BASE}/ajustes/general`);
    await user.click(await screen.findByTestId('work-mode-agency'));
    await user.click(screen.getByTestId('work-mode-save'));
    await screen.findByText('Cambios guardados');
    expect(fake.callsTo('organizations', 'update').at(-1)?.payload).toEqual({ work_mode: 'agency' });
  });

  it('volver a autogestión pide confirmar y explica qué cambia', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'agency' });
    const { user } = renderApp(`${BASE}/ajustes/general`);
    await user.click(await screen.findByTestId('work-mode-self'));
    await user.click(screen.getByTestId('work-mode-save'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('pasan a usar la IA directamente');
    expect(fake.callsTo('organizations', 'update')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Pasar a autogestión' }));
    await screen.findByText('Cambios guardados');
    expect(fake.callsTo('organizations', 'update')[0]?.payload).toEqual({ work_mode: 'self' });
  });

  it('un miembro sin permiso de administrar ve el modo pero no lo cambia', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer', workMode: 'self' });
    renderApp(`${BASE}/ajustes/general`);
    expect(await screen.findByTestId('work-mode-self')).toBeDisabled();
    expect(screen.queryByTestId('work-mode-save')).not.toBeInTheDocument();
  });
});

function templateRow(id: string, source: BrandDesignTemplateRow['source']): BrandDesignTemplateRow {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    template_key: id,
    name: `Plantilla ${id}`,
    network: 'instagram',
    format: 'post',
    document: createEmptyDocument({ aspectRatio: '1:1' }) as unknown as BrandDesignTemplateRow['document'],
    analysis: {},
    source,
    created_by: null,
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:00:00Z',
  };
}

describe('Plantillas: etiquetas y catálogo', () => {
  it('en autogestión las preparadas a mano son «Nuestra»; en modo agencia, «De la agencia»', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    fake.tables.brand_fonts = [];
    fake.tables.brand_design_templates = [templateRow('t-1', 'manual')];
    const first = renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    const item = await screen.findByTestId('brand-template');
    expect(within(item).getByText('Nuestra')).toBeInTheDocument();
    expect(screen.queryByText('De la agencia')).not.toBeInTheDocument();
    first.unmount();

    seedWorkspace({ orgRole: 'owner', workMode: 'agency' });
    fake.tables.brand_fonts = [];
    fake.tables.brand_design_templates = [templateRow('t-1', 'manual')];
    renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    expect(await screen.findByText('De la agencia')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-open')).not.toBeInTheDocument();
  });

  it('«Cargar plantillas del catálogo» guarda el juego elegido: publicaciones y reels, con los permisos de la marca', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    fake.tables.brand_fonts = [];
    fake.tables.brand_design_templates = [];
    fake.tables.brand_profiles = [];
    const delivered: { posts: Array<{ key: string }>; reels: Array<{ key: string }>; source: unknown } = {
      posts: [],
      reels: [],
      source: null,
    };
    fake.rpc('deliver_design_templates', (args) => {
      delivered.posts = args.p_templates as Array<{ key: string }>;
      return [];
    });
    fake.rpc('deliver_reel_templates', (args) => {
      delivered.reels = args.p_templates as Array<{ key: string }>;
      delivered.source = args.p_source;
      return [];
    });
    const { user } = renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    await user.click(await screen.findByTestId('catalog-open'));
    await user.click(await screen.findByTestId('catalog-set-gimnasio'));
    expect(await screen.findByText(/todavía no tiene perfil/)).toBeInTheDocument();
    await user.click(screen.getByTestId('catalog-load'));
    await waitFor(() => expect(delivered.posts.length).toBeGreaterThan(0));
    expect(delivered.reels.length).toBeGreaterThan(0);
    expect(delivered.source).toBe('catalog');
    expect(await screen.findByText(/Cargadas \d+ plantillas de publicación/)).toBeInTheDocument();
  });

  it('quien solo ve la marca no tiene el botón del catálogo', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer', workMode: 'self' });
    fake.tables.brand_fonts = [];
    fake.tables.brand_design_templates = [];
    renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    await screen.findByTestId('brand-templates-empty');
    expect(screen.queryByTestId('catalog-open')).not.toBeInTheDocument();
  });
});

describe('Gasto de la organización en autogestión', () => {
  const PERIOD = periodStartOf(new Date());
  const usage = {
    organization_id: ORG_ID,
    organization_name: 'Grupo Demo',
    kind: 'business',
    plan_name: 'P',
    plan_code: 'p',
    plan_unlimited: false,
    ai_limit_micros: 10_000_000,
    ai_limit_overridden: false,
    ai_committed_micros: 3_000_000,
    ai_cost_micros: 2_500_000,
    cost_text_micros: 500_000,
    cost_image_micros: 1_500_000,
    cost_video_micros: 500_000,
    cost_transcription_micros: 0,
    generations: 7,
    media_jobs: 3,
    media_jobs_succeeded: 2,
    media_jobs_failed: 1,
    media_jobs_active: 0,
    media_machine_seconds: 125,
    media_jobs_without_timings: 0,
    storage_bytes: 2048,
    storage_limit_bytes: null,
  };

  function seedUsage() {
    fake.tables.usage_quotas = [];
    fake.tables.ai_usage = [];
    fake.rpc('organization_plan_usage', () => ({ plan: { name: 'Prueba' }, ai_limit_micros: 10_000_000 }));
    fake.rpc('ai_cost_by_organization', () => []);
    fake.rpc('org_usage_overview', () => [usage]);
  }

  it('el propietario ve el gasto real del mes de su organización', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    seedUsage();
    renderApp(`${BASE}/ajustes/ia`);
    expect(await screen.findByTestId('spend-image')).toHaveTextContent('1,50 créditos');
    expect(screen.getByTestId('spend-total')).toHaveTextContent('2,50 créditos');
    expect(screen.getByTestId('spend-jobs')).toHaveTextContent('2 hechos, 1 fallidos');
    expect(fake.callsTo('org_usage_overview', 'rpc')[0]?.payload).toEqual({
      p_organization_id: ORG_ID,
      p_period_start: PERIOD,
    });
  });

  it('el administrador que no es propietario, y el modo agencia, no lo ven (ni se pide)', async () => {
    seedWorkspace({ orgRole: 'admin', workMode: 'self' });
    seedUsage();
    const first = renderApp(`${BASE}/ajustes/ia`);
    await screen.findByTestId('ai-usage-page');
    expect(screen.queryByTestId('org-spend')).not.toBeInTheDocument();
    first.unmount();

    seedWorkspace({ orgRole: 'owner', workMode: 'agency' });
    seedUsage();
    renderApp(`${BASE}/ajustes/ia`);
    await screen.findByTestId('ai-usage-page');
    expect(screen.queryByTestId('org-spend')).not.toBeInTheDocument();
    expect(fake.callsTo('org_usage_overview', 'rpc')).toHaveLength(0);
  });
});
