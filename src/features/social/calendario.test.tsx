import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BrandRole,
  ContentItemRow,
  OrgRole,
  ScheduledPublicationRow,
  SocialAccountRow,
} from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// Calendario y cuentas conectadas (Fase 3): lo que se ve según el estado real
// de cada publicación, el interruptor del entorno, aprobar por lotes, mover y
// programar. Las reglas las impone la base de datos (tests/db/publicacion.test.ts).

const soon = () => new Date(Date.now() + 2 * 3_600_000).toISOString();
const justNow = () => new Date(Date.now() - 60_000).toISOString();

function content(id: string, patch: Partial<ContentItemRow> = {}): ContentItemRow {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: `Pieza ${id}`,
    network: 'instagram',
    format: 'post',
    status: 'approved',
    current_version: 1,
    archived_at: null,
    created_by: null,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
    ...patch,
  } as ContentItemRow;
}

function pub(id: string, contentId: string, patch: Partial<ScheduledPublicationRow> = {}): ScheduledPublicationRow {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    content_id: contentId,
    content_version: 1,
    social_account_id: 'acc-1',
    network: 'instagram',
    format: 'post',
    scheduled_at: soon(),
    media_asset_ids: ['asset-1'],
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
    locked_by: null,
    locked_until: null,
    created_by: null,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
    ...patch,
  };
}

function account(patch: Partial<SocialAccountRow> = {}): SocialAccountRow {
  return {
    id: 'acc-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    network: 'instagram',
    provider: 'meta',
    external_id: '17841400000000001',
    username: 'casa_demo',
    display_name: 'Casa Demo',
    page_id: '1',
    status: 'active',
    scopes: [],
    token_expires_at: null,
    token_checked_at: null,
    quota_usage: null,
    quota_total: null,
    quota_checked_at: null,
    last_error: null,
    connected_by: null,
    connected_at: '2026-11-18T09:00:00Z',
    disconnected_at: null,
    connection_method: 'oauth',
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
    ...patch,
  };
}

function seed({ orgRole = 'owner', brandRole }: { orgRole?: OrgRole; brandRole?: BrandRole } = {}) {
  seedWorkspace({ orgRole, brandRole });
  fake.tables.content_items = [content('c-prog'), content('c-pub'), content('c-rev', { status: 'in_review' })];
  fake.tables.scheduled_publications = [
    pub('p-prog', 'c-prog'),
    pub('p-pub', 'c-pub', {
      status: 'published',
      scheduled_at: justNow(),
      external_id: '17900000000001',
      external_url: 'https://instagram.simulado.invalid/p/17900000000001/',
      published_at: justNow(),
    }),
    pub('p-rev', 'c-rev', { status: 'planned', hold_reason: 'not_approved', content_version: null }),
  ];
  fake.tables.publication_attempts = [];
  fake.tables.content_comments = [];
  fake.tables.social_accounts = [account()];
  fake.tables.media_assets = [
    {
      id: 'asset-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      kind: 'image',
      mime_type: 'image/jpeg',
      file_name: 'exportada-v1.jpg',
      provenance: { type: 'export', content_id: 'c-new', version: 1, unsaved_changes: false },
      created_at: '2026-11-18T09:00:00Z',
    },
  ];
}

const entry = async (title: string) =>
  (await screen.findAllByTestId('calendar-entry')).find((e) => e.textContent?.includes(title))!;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Calendario', () => {
  it('está en el menú y enseña el estado real: programada, publicada con su enlace, en revisión', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    await user.click((await screen.findAllByRole('link', { name: 'Calendario' }))[0]!);

    expect(await entry('Pieza c-prog')).toHaveAttribute('data-state', 'scheduled');
    expect(await entry('Pieza c-pub')).toHaveAttribute('data-state', 'published');
    expect(await entry('Pieza c-rev')).toHaveAttribute('data-state', 'in_review');
    expect(await entry('Pieza c-prog')).toHaveTextContent('Programada');

    await user.click(await entry('Pieza c-pub'));
    const dialog = await screen.findByTestId('publication-dialog');
    expect(within(dialog).getByTestId('publication-external-id')).toHaveTextContent('17900000000001');
    expect(within(dialog).getByTestId('publication-link')).toHaveAttribute(
      'href',
      'https://instagram.simulado.invalid/p/17900000000001/',
    );
  });

  it('sin el interruptor del entorno se ve lo programado, pero no se programa', async () => {
    seed();
    renderApp(`${BRAND_BASE}/calendario`);
    await entry('Pieza c-prog');
    expect(screen.queryByTestId('calendar-schedule')).toBeNull();
    expect(screen.getByText(/no está activa en este entorno/)).toBeInTheDocument();
  });

  it('sin el interruptor no aparecen las cuentas conectadas en los ajustes de la marca', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/marca`);
    await user.click(await screen.findByRole('tab', { name: /Datos/ }));
    await screen.findByTestId('brand-ai-mode');
    expect(screen.queryByTestId('social-accounts')).toBeNull();
  });

  it('con el interruptor, quien gestiona ve la cuenta y los avisos; quien edita no conecta', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed();
    fake.tables.social_accounts = [account({ status: 'needs_reauth', quota_usage: 45, quota_total: 50 })];
    const { user } = renderApp(`${BRAND_BASE}/marca`);
    await user.click(await screen.findByRole('tab', { name: /Datos/ }));
    const card = await screen.findByTestId('social-accounts');
    expect(within(card).getByText('@casa_demo')).toBeInTheDocument();
    expect(within(card).getByText(/volver a conectarla/)).toBeInTheDocument();
    expect(within(card).getByText(/45 de 50/)).toBeInTheDocument();
    expect(within(card).getByTestId('social-connect-instagram')).toHaveTextContent('Volver a conectar');
  });

  it('quien solo edita ve la cuenta pero no puede conectar ni desconectar', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed({ orgRole: 'member', brandRole: 'editor' });
    const { user } = renderApp(`${BRAND_BASE}/marca`);
    await user.click(await screen.findByRole('tab', { name: /Datos/ }));
    const card = await screen.findByTestId('social-accounts');
    await within(card).findByText('@casa_demo');
    expect(within(card).queryByTestId('social-connect-instagram')).toBeNull();
    expect(within(card).queryByTestId('social-disconnect')).toBeNull();
  });

  it('quien aprueba aprueba varias piezas en revisión desde el calendario', async () => {
    seed({ orgRole: 'member', brandRole: 'reviewer' });
    fake.rpc('approve_content_items', () => [{ content_id: 'c-rev', ok: true, message: null }]);
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await user.click(await screen.findByTestId('calendar-approve-batch'));
    const checks = await screen.findAllByTestId('calendar-select');
    expect(checks).toHaveLength(1);
    await user.click(checks[0]!);
    await user.click(screen.getByTestId('calendar-approve-batch'));
    await waitFor(() => expect(fake.callsTo('approve_content_items', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('approve_content_items', 'rpc')[0]!.payload).toEqual({
      p_items: [{ content_id: 'c-rev', version: 1 }],
    });
  });

  it('quien edita mueve, cancela y reintenta desde la ficha; quien solo ve, no', async () => {
    seed();
    fake.tables.scheduled_publications!.push(
      pub('p-fail', 'c-prog', { status: 'failed', last_error: 'Instagram lo rechazó', last_error_code: 'rejected' }),
    );
    fake.rpc('retry_publication', () => pub('p-fail', 'c-prog'));
    fake.rpc('reschedule_publication', (args) =>
      pub('p-prog', 'c-prog', { scheduled_at: String(args.p_scheduled_at) }),
    );
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    const failed = (await screen.findAllByTestId('calendar-entry')).find(
      (e) => e.getAttribute('data-state') === 'failed',
    )!;
    await user.click(failed);
    expect(await screen.findByTestId('publication-error')).toHaveTextContent('Instagram lo rechazó');
    await user.click(screen.getByTestId('publication-retry'));
    await waitFor(() => expect(fake.callsTo('retry_publication', 'rpc')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Mover' }));
    await waitFor(() => expect(fake.callsTo('reschedule_publication', 'rpc')).toHaveLength(1));
  });

  it('programar: solo se ofrecen exportaciones JPEG de la versión vigente de la pieza', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed();
    fake.rows('content_items').push(content('c-new', { title: 'Nueva pieza' }), content('c-otra', { title: 'Otra' }));
    fake.rpc('save_publication', (args) =>
      pub('p-new', String(args.p_content_id), { scheduled_at: String(args.p_scheduled_at) }),
    );
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await user.click(await screen.findByTestId('calendar-schedule'));
    await user.selectOptions(await screen.findByTestId('schedule-content'), 'c-otra');
    expect(await screen.findByTestId('schedule-no-media')).toHaveTextContent(/exportación JPEG de la versión 1/);
    await user.selectOptions(screen.getByTestId('schedule-content'), 'c-new');
    await user.click(await screen.findByTestId('schedule-asset'));
    await user.click(screen.getByTestId('schedule-submit'));
    await waitFor(() => expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('save_publication', 'rpc')[0]!.payload).toMatchObject({
      p_publication_id: null,
      p_content_id: 'c-new',
      p_social_account_id: 'acc-1',
      p_media_asset_ids: ['asset-1'],
      p_content_version: 1,
    });
  });
});
