import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandRole, OrgRole, SocialAccountRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BASE, BRAND_BASE, BRAND_ID, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// Aviso con antelación de que el acceso a Instagram caduca y no se ha podido
// renovar solo: lo ven la marca (calendario, inicio y Cuentas conectadas) y la
// agencia (listado de marcas). La renovación en sí (servidor) se prueba en
// tests/db/publicacion.test.ts.

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

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

function seed(accounts: SocialAccountRow[], opts: { orgRole?: OrgRole; brandRole?: BrandRole } = {}) {
  vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
  seedWorkspace({ orgRole: opts.orgRole ?? 'owner', brandRole: opts.brandRole });
  fake.tables.content_items = [];
  fake.tables.scheduled_publications = [];
  fake.tables.publication_attempts = [];
  fake.tables.content_comments = [];
  fake.tables.media_assets = [];
  fake.tables.social_accounts = accounts;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Aviso de que el acceso a Instagram caduca', () => {
  it('si no se pudo renovar solo, el calendario lo dice con la fecha y lleva a volver a conectar', async () => {
    seed([
      account({
        token_expires_at: inDays(9),
        renewal_attempted_at: inDays(0),
        renewal_error: 'Meta no ha ampliado la caducidad del acceso',
      }),
    ]);
    renderApp(`${BRAND_BASE}/calendario`);
    const notice = await screen.findByTestId('account-attention-item');
    expect(notice).toHaveTextContent('@casa_demo');
    expect(notice).toHaveTextContent(/caduca el .* \(quedan 9 días\) y no se ha podido renovar solo/);
    expect(within(notice).getByTestId('account-attention-fix')).toHaveAttribute(
      'href',
      `${BRAND_BASE}/marca?seccion=datos#cuentas-conectadas`,
    );
  });

  it('si la renovación automática va bien, no molesta: ni con 10 días de margen ni tras renovarse', async () => {
    seed([account({ token_expires_at: inDays(10), token_renewed_at: inDays(-1) })]);
    renderApp(`${BRAND_BASE}/calendario`);
    await screen.findByTestId('calendar-zone');
    expect(screen.queryByTestId('account-attention')).toBeNull();
  });

  it('a 7 días o menos avisa aunque aún no haya intentado renovar', async () => {
    seed([account({ token_expires_at: inDays(6) })]);
    renderApp(`${BRAND_BASE}/inicio`);
    expect(await screen.findByTestId('account-attention-item')).toHaveTextContent(
      /quedan 6 días\) y aún no se ha renovado/,
    );
  });

  it('con el acceso retirado, el inicio de la marca dice que lo programado está detenido', async () => {
    seed([account({ status: 'needs_reauth', last_error: 'Token revocado' })]);
    renderApp(`${BRAND_BASE}/inicio`);
    expect(await screen.findByTestId('account-attention-item')).toHaveTextContent(/lo programado está detenido/);
  });

  it('una conexión avanzada (token pegado) no se renueva sola: avisa a 14 días', async () => {
    seed([account({ connection_method: 'token', token_expires_at: inDays(12) })]);
    renderApp(`${BRAND_BASE}/calendario`);
    expect(await screen.findByTestId('account-attention-item')).toHaveTextContent(/renueva la conexión avanzada/);
  });

  it('quien no gestiona la marca ve el aviso sin botón y con quién puede arreglarlo', async () => {
    seed([account({ token_expires_at: inDays(5), renewal_error: 'No se pudo' })], {
      orgRole: 'member',
      brandRole: 'editor',
    });
    renderApp(`${BRAND_BASE}/calendario`);
    const notice = await screen.findByTestId('account-attention-item');
    expect(within(notice).queryByTestId('account-attention-fix')).toBeNull();
    expect(notice).toHaveTextContent('¿Por qué?');
  });

  it('Cuentas conectadas enseña hasta cuándo vale el acceso y cuándo se renovó solo', async () => {
    seed([account({ token_expires_at: inDays(50), token_renewed_at: inDays(-2) })]);
    const { user } = renderApp(`${BRAND_BASE}/marca`);
    await user.click(await screen.findByRole('tab', { name: /Datos/ }));
    const card = await screen.findByTestId('social-accounts');
    expect(await within(card).findByTestId('social-account-expiry')).toHaveTextContent(
      /acceso hasta el .*renovado solo el/,
    );
  });

  it('la agencia lo ve en el listado de marcas, sin entrar en cada una', async () => {
    seed([account({ token_expires_at: inDays(4), renewal_error: 'No se pudo' })]);
    renderApp(BASE);
    expect(await screen.findByTestId(`brand-access-warning-${BRAND_ID}`)).toHaveTextContent('Instagram caduca pronto');
  });

  it('en el listado, una cuenta con el acceso retirado pide reconectar', async () => {
    seed([account({ status: 'needs_reauth' })]);
    renderApp(BASE);
    expect(await screen.findByTestId(`brand-access-warning-${BRAND_ID}`)).toHaveTextContent('Instagram: reconectar');
  });

  it('sin la publicación activa en el entorno no se avisa de nada', async () => {
    seed([account({ status: 'needs_reauth' })]);
    vi.unstubAllEnvs();
    renderApp(`${BRAND_BASE}/inicio`);
    await screen.findByText('Archivos en la biblioteca');
    expect(screen.queryByTestId('account-attention')).toBeNull();
  });
});
