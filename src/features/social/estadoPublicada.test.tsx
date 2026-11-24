import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BrandContext, makeBrandContext, OrgContext } from '@/features/orgs/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ScheduledPublicationRow, SocialAccountRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, brandRow, renderApp, seedWorkspace } from '@/test/fixtures';
import { createEmptyDocument, DOCUMENT_SCHEMA_VERSION } from '@/features/content/document';
import { connectionOf, noAccountText } from './connectedAccount';
import { publishedInfoOf, publishedText } from './publishedState';
import { ScheduleDialog } from './ScheduleDialog';

// Fallos 9 y 10 de la prueba en staging (23/11/2026):
//   10 · una pieza publicada parecía pendiente («Aprobada», «Programar», «Publicar ahora»);
//    9 · en una marca sin Instagram se aprobaba y luego decía «Falta elegir la cuenta…», sin enlace.

const PUBLISHED_AT = '2026-11-23T09:55:00.000Z';
const URL = 'https://www.instagram.com/p/DgE_qwxoQoS/';

function item(id: string, patch: Partial<ContentItemRow> = {}): ContentItemRow {
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
    created_by: ME.id,
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:00:00Z',
    ...patch,
  } as ContentItemRow;
}

function publication(contentId: string, patch: Partial<ScheduledPublicationRow> = {}): ScheduledPublicationRow {
  return {
    id: `p-${contentId}`,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    content_id: contentId,
    content_version: 1,
    social_account_id: 'acc-1',
    network: 'instagram',
    format: 'post',
    scheduled_at: PUBLISHED_AT,
    media_asset_ids: ['asset-1'],
    status: 'published',
    hold_reason: null,
    generation: 1,
    attempt_count: 1,
    last_error_code: null,
    last_error: null,
    container_id: null,
    container_created_at: null,
    external_id: '17900000000001',
    external_url: URL,
    published_at: PUBLISHED_AT,
    locked_by: null,
    locked_until: null,
    created_by: null,
    created_at: '2026-11-23T09:50:00Z',
    updated_at: '2026-11-23T09:55:00Z',
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
    token_renewed_at: null,
    renewal_attempted_at: null,
    renewal_error: null,
    created_at: '2026-11-18T09:00:00Z',
    updated_at: '2026-11-18T09:00:00Z',
    ...patch,
  };
}

function seed({ accounts = [account()] }: { accounts?: SocialAccountRow[] } = {}) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.content_items = [
    item('c-pub', { title: 'Arroz meloso publicado' }),
    item('c-ready', { title: 'Lista para programar' }),
  ];
  fake.tables.content_versions = ['c-pub', 'c-ready'].map((id) => ({
    id: `v-${id}`,
    content_id: id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    schema_version: DOCUMENT_SCHEMA_VERSION,
    data: createEmptyDocument({ aspectRatio: '4:5' }),
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-20T09:00:00Z',
  }));
  fake.tables.scheduled_publications = [publication('c-pub')];
  fake.tables.social_accounts = accounts;
  fake.tables.media_assets = [];
  fake.tables.campaign_contents = [];
  fake.tables.campaigns = [];
  fake.tables.brand_design_templates = [];
  fake.tables.publication_attempts = [];
  fake.tables.content_comments = [];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Cómo se lee «publicada» (para el editor y las listas)', () => {
  it('publishedInfoOf: solo con la publicación en «published»; con fecha y enlace', () => {
    expect(publishedInfoOf(null)).toBeNull();
    expect(publishedInfoOf(publication('x', { status: 'scheduled', published_at: null }))).toBeNull();
    expect(publishedInfoOf(publication('x'))).toEqual({
      publicationId: 'p-x',
      publishedAt: PUBLISHED_AT,
      url: URL,
      network: 'instagram',
    });
    expect(publishedText({ publishedAt: PUBLISHED_AT }, 'Europe/Madrid')).toBe('Publicada el 23 nov');
    expect(publishedText({ publishedAt: PUBLISHED_AT }, 'Europe/Madrid', true)).toBe('Publicada el 23 nov a las 10:55');
  });

  it('connectionOf: activa, caducada o ninguna (las desconectadas no cuentan)', () => {
    expect(connectionOf([account()]).state).toBe('connected');
    expect(connectionOf([account({ status: 'needs_reauth' })]).state).toBe('needs_reauth');
    expect(connectionOf([account({ status: 'disconnected' })]).state).toBe('none');
    expect(connectionOf([]).state).toBe('none');
    expect(connectionOf(undefined).account).toBeNull();
    expect(noAccountText('none')).toBe('No hay ninguna cuenta conectada');
  });
});

describe('Contenidos: una pieza publicada dice «Publicada» con su enlace', () => {
  it('la tarjeta enseña «Publicada», la fecha y «Ver en Instagram»; no ofrece «Programar», sí «Publicar otra vez» con aviso', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/contenidos`);
    await user.click(await screen.findByTestId('content-tab-published'));
    const card = (await screen.findAllByTestId('content-card')).find((c) =>
      c.textContent?.includes('Arroz meloso publicado'),
    )!;
    expect(card).toHaveAttribute('data-stage', 'published');
    expect(card).toHaveTextContent('Publicada el 23 nov');
    expect(card).not.toHaveTextContent('Aprobada');
    expect(within(card).getByTestId('content-published-link')).toHaveAttribute('href', URL);
    await user.click(within(card).getByTestId('content-menu'));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.queryByTestId('content-schedule')).toBeNull();

    await user.click(menu.getByTestId('content-republish'));
    expect(await screen.findByTestId('republish-warning')).toHaveTextContent(
      'Ya está publicada en Instagram. Si la publicas otra vez, saldrá repetida.',
    );
    // Avisar no publica ni programa nada.
    expect(fake.callsTo('publish_publication_now', 'rpc')).toHaveLength(0);
    expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(0);
  });
});

describe('Calendario → Programar: lo publicado no se vuelve a programar', () => {
  it('en la lista sale como «Publicada el…» y no se puede elegir', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await user.click(await screen.findByTestId('calendar-schedule'));
    const select = await screen.findByTestId('schedule-content');
    await waitFor(() => {
      const option = within(select).getByRole('option', { name: /Arroz meloso publicado/ }) as HTMLOptionElement;
      expect(option.textContent).toContain('Publicada el 23 nov');
      expect(option.textContent).not.toContain('Aprobada');
      expect(option.disabled).toBe(true);
    });
    const ready = within(select).getByRole('option', { name: /Lista para programar/ }) as HTMLOptionElement;
    expect(ready.disabled).toBe(false);
    expect(ready.textContent).toContain('Aprobada');
  });

  it('abierta con una pieza ya publicada (como desde el editor): «Publicada», enlace a Instagram, sin guardar', async () => {
    seed();
    const user = mountSchedule('c-pub');
    const notice = await screen.findByTestId('schedule-published');
    expect(within(notice).getByTestId('schedule-published-text')).toHaveTextContent('Publicada el 23 nov a las 10:55');
    expect(within(notice).getByTestId('schedule-published-link')).toHaveAttribute('href', URL);
    expect(within(notice).getByTestId('schedule-published-open')).toHaveAttribute('href', `${BRAND_BASE}/contenidos/c-pub`);
    expect(screen.getByTestId('schedule-submit')).toBeDisabled();
    expect(screen.queryByTestId('schedule-when')).toBeNull();
    await user.click(screen.getByTestId('schedule-submit'));
    expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(0);
  });
});

/** El diálogo de programar suelto, con la marca y el router, como lo monta el editor. */
function mountSchedule(contentId: string) {
  const org = { id: ORG_ID, name: 'Grupo Demo', kind: 'business', role: 'owner' } as never;
  const brand = brandRow();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrgContext.Provider value={{ org, isAdmin: true, brands: [brand], brandRoles: new Map() }}>
          <BrandContext.Provider value={makeBrandContext(org, brand, undefined)}>
            <ScheduleDialog brandId={BRAND_ID} open onOpenChange={() => undefined} initialContentId={contentId} />
          </BrandContext.Provider>
        </OrgContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('Marca sin cuenta conectada (fallo 9)', () => {
  it('al programar se dice «No hay ninguna cuenta conectada» con el enlace; «Ahora» no deja seguir', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed({ accounts: [] });
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await user.click(await screen.findByTestId('calendar-schedule'));
    await user.selectOptions(await screen.findByTestId('schedule-content'), 'c-ready');
    const notice = await screen.findByTestId('schedule-no-account');
    expect(notice).toHaveTextContent('No hay ninguna cuenta conectada');
    expect(within(notice).getByTestId('schedule-no-account-connect')).toHaveAttribute(
      'href',
      `${BRAND_BASE}/marca?seccion=datos#cuentas-conectadas`,
    );
    await user.click(screen.getByTestId('schedule-mode-now'));
    expect(screen.getByTestId('schedule-submit')).toBeDisabled();
    expect(fake.callsTo('publish_publication_now', 'rpc')).toHaveLength(0);
    expect(fake.callsTo('approve_content_items', 'rpc')).toHaveLength(0);
  });

  it('con la cuenta caducada, el aviso pide volver a conectarla', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed({ accounts: [account({ status: 'needs_reauth' })] });
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await user.click(await screen.findByTestId('calendar-schedule'));
    await user.selectOptions(await screen.findByTestId('schedule-content'), 'c-ready');
    const notice = await screen.findByTestId('schedule-no-account');
    expect(notice).toHaveTextContent('El acceso a la cuenta de Instagram ha caducado');
    expect(within(notice).getByTestId('schedule-no-account-connect')).toHaveTextContent('Volver a conectar');
  });
});
