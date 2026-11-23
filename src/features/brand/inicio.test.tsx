import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandRole, ContentItemRow, OrgRole, ScheduledPublicationRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// Inicio de la marca: «qué hago hoy». Accesos grandes, lo que sale esta semana, lo que está parado
// (con su botón de arreglo) y lo último publicado con sus cifras si existen.

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function piece(patch: Partial<ContentItemRow> = {}): ContentItemRow {
  return {
    id: 'c1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Menú de otoño',
    network: 'instagram',
    format: 'post',
    status: 'approved',
    current_version: 0,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    ...patch,
  };
}

function publication(patch: Partial<ScheduledPublicationRow> = {}): ScheduledPublicationRow {
  return {
    id: 'p1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    content_id: 'c1',
    content_version: 1,
    social_account_id: null,
    network: 'instagram',
    format: 'post',
    scheduled_at: inDays(1),
    media_asset_ids: [],
    status: 'scheduled',
    hold_reason: null,
    generation: 1,
    attempt_count: 0,
    last_error_code: null,
    last_error: null,
    container_id: null,
    container_created_at: null,
    external_id: null,
    external_url: null,
    published_at: null,
    ...patch,
  } as ScheduledPublicationRow;
}

function seed(opts: { orgRole?: OrgRole; brandRole?: BrandRole; publishing?: boolean } = {}) {
  if (opts.publishing) vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
  seedWorkspace({ orgRole: opts.orgRole ?? 'owner', brandRole: opts.brandRole });
  fake.tables.content_items = [piece()];
  fake.tables.scheduled_publications = [];
  fake.tables.social_accounts = [];
  fake.tables.media_assets = [];
  fake.tables.content_versions = [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Inicio de la marca', () => {
  it('no repite los accesos de crear: están en «＋ Crear» del menú', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    await screen.findAllByTestId('home-day');
    expect(screen.queryByTestId('home-tiles')).toBeNull();
    // «Hacer un reel como este» solo sale si el servidor puede (aquí no está activado).
    await user.click(await screen.findByTestId('create-menu'));
    expect(screen.queryByTestId('create-menu-reel-like')).toBeNull();
    await user.click(await screen.findByTestId('create-menu-reel'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByTestId('create-content-format-reel').querySelector('input')).toBeChecked();
  });

  it('quien solo mira no tiene «＋ Crear»', async () => {
    seed({ orgRole: 'member', brandRole: 'viewer' });
    renderApp(`${BRAND_BASE}/inicio`);
    await screen.findAllByTestId('home-day');
    expect(screen.queryByTestId('create-menu')).toBeNull();
    expect(screen.queryByTestId('home-tiles')).toBeNull();
  });

  it('la semana enseña la pieza programada y, sin nada, lo dice en una frase', async () => {
    seed();
    fake.tables.scheduled_publications = [publication()];
    renderApp(`${BRAND_BASE}/inicio`);
    const link = await screen.findByTestId('home-week-piece');
    expect(link).toHaveAttribute('aria-label', expect.stringContaining('Menú de otoño'));
    expect(link).toHaveAttribute('href', `${BRAND_BASE}/contenidos/c1`);
    expect(screen.getAllByTestId('home-day')).toHaveLength(7);
    expect(screen.queryByTestId('home-week-empty')).toBeNull();
  });

  it('con la semana vacía no inventa nada', async () => {
    seed();
    renderApp(`${BRAND_BASE}/inicio`);
    expect(await screen.findByTestId('home-week-empty')).toHaveTextContent('No hay nada programado');
    expect(screen.queryByTestId('home-stalled')).toBeNull();
    expect(screen.queryByTestId('home-published')).toBeNull();
  });

  it('lo parado dice por qué y lleva al arreglo', async () => {
    seed({ publishing: true });
    fake.tables.content_items = [piece(), piece({ id: 'c2', title: 'Reel del vermut', format: 'reel' })];
    fake.tables.scheduled_publications = [
      publication({ hold_reason: 'no_account', status: 'scheduled' }),
      publication({ id: 'p2', content_id: 'c2', status: 'failed', scheduled_at: inDays(2) }),
    ];
    renderApp(`${BRAND_BASE}/inicio`);
    const items = await screen.findAllByTestId('home-stalled-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Menú de otoño');
    expect(items[0]).toHaveTextContent('Sin cuenta de Instagram conectada');
    expect(within(items[0]!).getByTestId('home-stalled-fix')).toHaveAttribute(
      'href',
      expect.stringContaining('/marca?seccion=datos#cuentas-conectadas'),
    );
    expect(items[1]).toHaveTextContent('No se pudo publicar');
    expect(within(items[1]!).getByTestId('home-stalled-fix')).toHaveAttribute('href', `${BRAND_BASE}/calendario`);
  });

  it('avisa de que Instagram no está conectado y ofrece conectarlo', async () => {
    seed({ publishing: true });
    renderApp(`${BRAND_BASE}/inicio`);
    const notice = await screen.findByTestId('home-not-connected');
    expect(notice).toHaveTextContent('Instagram sin conectar');
    expect(within(notice).getByTestId('home-connect')).toBeInTheDocument();
  });

  it('lo último publicado lleva cifras solo si existen', async () => {
    seed();
    fake.tables.scheduled_publications = [
      publication({ status: 'published', published_at: inDays(-2), scheduled_at: inDays(-2) }),
      publication({ id: 'p2', content_id: 'c2', status: 'published', published_at: inDays(-5), scheduled_at: inDays(-5) }),
    ];
    fake.tables.content_items = [piece(), piece({ id: 'c2', title: 'Sin cifras todavía' })];
    fake.rpc('analytics_media_summary', () => [
      {
        publication_id: 'p1',
        title: 'Menú de otoño',
        format: 'post',
        network: 'instagram',
        media_product_type: 'FEED',
        published_at: inDays(-2),
        external_url: null,
        provisional: false,
        metrics: { 'instagram.media.reach': 1234 },
      },
    ]);
    renderApp(`${BRAND_BASE}/inicio`);
    const items = await screen.findAllByTestId('home-published-item');
    expect(items).toHaveLength(2);
    await waitFor(() => expect(within(items[0]!).getByTestId('home-published-figures')).toHaveTextContent('personas'));
    expect(within(items[1]!).queryByTestId('home-published-figures')).toBeNull();
  });
});
