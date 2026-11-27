import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ScheduledPublicationRow, SocialAccountRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { openFicha } from '@/test/calendario';
import { BRAND_BASE, BRAND_ID, ORG_ID, brandRow, renderApp, seedWorkspace } from '@/test/fixtures';
import { toLocalInput } from './calendar';
import { formatTimeIn } from './zone';

// La hora del calendario, de la ficha y del diálogo de programar es la de la
// marca (brands.timezone), no la del dispositivo.

const ZONE = 'Pacific/Auckland'; // lejos de cualquier dispositivo de pruebas
const at = new Date(Date.now() + 2 * 3_600_000).toISOString();

const item = {
  id: 'c-1',
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  title: 'Pieza zona',
  network: 'instagram',
  format: 'post',
  status: 'approved',
  current_version: 1,
  archived_at: null,
  created_by: null,
  created_at: '2026-11-18T09:00:00Z',
  updated_at: '2026-11-18T09:00:00Z',
} as ContentItemRow;

const publication = {
  id: 'p-1',
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  content_id: 'c-1',
  content_version: 1,
  social_account_id: 'acc-1',
  network: 'instagram',
  format: 'post',
  scheduled_at: at,
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
} as ScheduledPublicationRow;

const account = {
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
} as SocialAccountRow;

function seed(timezone: string) {
  seedWorkspace({ orgRole: 'owner', brands: [brandRow({ timezone })] });
  fake.tables.content_items = [item];
  fake.tables.scheduled_publications = [publication];
  fake.tables.publication_attempts = [];
  fake.tables.content_comments = [];
  fake.tables.social_accounts = [account];
  fake.tables.media_assets = [
    {
      id: 'asset-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      kind: 'image',
      mime_type: 'image/jpeg',
      file_name: 'exportada-v1.jpg',
      storage_path: `${ORG_ID}/${BRAND_ID}/media/exportada-v1.jpg`,
      provenance: { type: 'export', content_id: 'c-1', version: 1, unsaved_changes: false },
      created_at: '2026-11-18T09:00:00Z',
    },
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Hora del calendario según la zona de la marca', () => {
  it('el calendario y la ficha enseñan la hora de la marca y lo dicen', async () => {
    seed(ZONE);
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    const entry = (await screen.findAllByTestId('calendar-entry'))[0]!;
    expect(entry).toHaveTextContent(formatTimeIn(at, ZONE));
    // Auckland no es la hora del dispositivo: se dice junto al título.
    expect(screen.getByTestId('calendar-zone')).toHaveTextContent('Horas en hora de Auckland');

    await openFicha(user, entry);
    const dialog = await screen.findByTestId('publication-dialog');
    expect(within(dialog).getByText(/En la hora de Auckland/)).toBeInTheDocument();
    const when = within(dialog).getByLabelText('Mover a') as HTMLInputElement;
    expect(when.value).toBe(toLocalInput(at, ZONE));
  });

  it('mover una publicación escribe la hora en la zona de la marca y guarda el instante correcto', async () => {
    seed(ZONE);
    fake.rpc('reschedule_publication', (args) => ({ ...publication, scheduled_at: String(args.p_scheduled_at) }));
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await openFicha(user, (await screen.findAllByTestId('calendar-entry'))[0]!);
    const dialog = await screen.findByTestId('publication-dialog');
    const when = within(dialog).getByLabelText('Mover a');
    await user.clear(when);
    // Dentro de dos años: siempre en el futuro. 10:00 del 1/12 en Auckland (UTC+13) son las 21:00 del 30/11.
    const year = new Date().getFullYear() + 2;
    await user.type(when, `${year}-12-01T10:00`);
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));
    await waitFor(() => expect(fake.callsTo('reschedule_publication', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('reschedule_publication', 'rpc')[0]!.payload).toMatchObject({
      p_scheduled_at: `${year}-11-30T21:00:00.000Z`,
    });
  });

  it('programar: el día y la hora se interpretan en la zona de la marca', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed('America/Mexico_City'); // UTC−6 todo el año
    fake.tables.scheduled_publications = [];
    fake.rpc('save_publication', (args) => ({ ...publication, scheduled_at: String(args.p_scheduled_at) }));
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await user.click(await screen.findByTestId('calendar-schedule'));
    await user.selectOptions(await screen.findByTestId('schedule-content'), 'c-1');
    expect(await screen.findByText(/En la hora de Mexico City/)).toBeInTheDocument();
    const when = screen.getByTestId('schedule-when');
    const year = new Date().getFullYear() + 2;
    await user.clear(when);
    await user.type(when, `${year}-12-01T10:00`);
    await user.click(await screen.findByTestId('schedule-asset'));
    await user.click(screen.getByTestId('schedule-submit'));
    await waitFor(() => expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('save_publication', 'rpc')[0]!.payload).toMatchObject({
      p_scheduled_at: `${year}-12-01T16:00:00.000Z`,
    });
  });

  it('una zona guardada que el navegador no conoce no rompe el calendario: se usa la de Madrid', async () => {
    seed('Marte/Olimpo');
    renderApp(`${BRAND_BASE}/calendario`);
    // La zona solo se dice si no es la del dispositivo; si se dice, es la de Madrid.
    await screen.findAllByTestId('calendar-entry');
    const zoneNote = screen.queryByTestId('calendar-zone');
    if (zoneNote) expect(zoneNote).toHaveTextContent('Horas en hora de Madrid');
    expect((await screen.findAllByTestId('calendar-entry'))[0]!).toHaveTextContent(formatTimeIn(at, 'Europe/Madrid'));
  });
});
