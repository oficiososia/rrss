import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ScheduledPublicationRow, SocialAccountRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { openFicha } from '@/test/calendario';
import { BRAND_BASE, BRAND_ID, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// El calendario para planificar de un vistazo: semana, mes y lista; la vista rápida de cada
// pieza; mover arrastrando (con deshacer) y desde «Mover a»; la bandeja «Por programar»; y
// las ayudas (huecos, objetivo semanal, campañas). «Hoy» es el miércoles 18/11/2026 a las
// 11:00 en Madrid, con la zona de la marca (Madrid) en el calendario.

const NOW = new Date('2026-11-18T10:00:00Z');

function content(id: string, title: string, patch: Partial<ContentItemRow> = {}): ContentItemRow {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title,
    network: 'instagram',
    format: 'post',
    status: 'approved',
    current_version: 1,
    archived_at: null,
    created_by: null,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    ...patch,
  } as ContentItemRow;
}

function pub(id: string, contentId: string, at: string, patch: Partial<ScheduledPublicationRow> = {}) {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    content_id: contentId,
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
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    ...patch,
  } as ScheduledPublicationRow;
}

const account = {
  id: 'acc-1',
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  network: 'instagram',
  provider: 'meta',
  external_id: '1784',
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
  connected_at: '2026-11-10T09:00:00Z',
  disconnected_at: null,
  connection_method: 'oauth',
  token_renewed_at: null,
  renewal_attempted_at: null,
  renewal_error: null,
  created_at: '2026-11-10T09:00:00Z',
  updated_at: '2026-11-10T09:00:00Z',
} as SocialAccountRow;

// Semana del 16 al 22 de noviembre: lunes publicada (ya pasó), miércoles, viernes (dos) y domingo.
const MON = '2026-11-16T10:00:00Z';
const WED = '2026-11-18T14:00:00Z'; // 15:00 en Madrid
const FRI_1 = '2026-11-20T09:00:00Z'; // 10:00
const FRI_2 = '2026-11-20T17:00:00Z'; // 18:00
const SUN = '2026-11-22T10:00:00Z';

function seed(extra: { tray?: boolean } = {}) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.content_items = [
    content('c-mon', 'Domingo de brasa', {}),
    content('c-wed', 'Menú del día'),
    content('c-fri1', 'Carrusel de postres', { format: 'carousel' }),
    content('c-fri2', 'Reel del chef', { format: 'reel', status: 'draft' }),
    content('c-sun', 'Vermut de domingo'),
    ...(extra.tray ? [content('c-tray', 'Tapas de otoño'), content('c-borrador', 'Idea a medias', { status: 'draft' })] : []),
  ];
  fake.tables.scheduled_publications = [
    pub('p-mon', 'c-mon', MON, {
      status: 'published',
      external_id: '1790',
      external_url: 'https://instagram.simulado.invalid/p/1790/',
      published_at: MON,
    }),
    pub('p-wed', 'c-wed', WED),
    pub('p-fri1', 'c-fri1', FRI_1, { format: 'carousel', media_asset_ids: ['asset-1', 'asset-2'] }),
    pub('p-fri2', 'c-fri2', FRI_2, { format: 'reel', status: 'planned', hold_reason: 'not_approved' }),
    pub('p-sun', 'c-sun', SUN),
  ];
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
      file_name: 'plato.jpg',
      storage_path: `${ORG_ID}/${BRAND_ID}/media/plato.jpg`,
      provenance: { type: 'export', content_id: 'c-wed', version: 1, unsaved_changes: false },
      created_at: '2026-11-10T09:00:00Z',
    },
  ];
  fake.tables.content_versions = [
    {
      id: 'v-fri1',
      content_id: 'c-fri1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      data: { copy: { caption: 'Tres postres para cerrar la semana.', hashtags: ['postres'] } },
    },
  ];
  fake.storage.from = () =>
    ({
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://example.test/${path}` })),
        error: null,
      }),
    }) as never;
}

/** Un `DataTransfer` mínimo para simular arrastrar y soltar. */
function transfer() {
  const data: Record<string, string> = {};
  return {
    data,
    effectAllowed: 'all',
    setData: (k: string, v: string) => void (data[k] = v),
    getData: (k: string) => data[k] ?? '',
  };
}

const card = async (title: string) =>
  (await screen.findAllByTestId('calendar-entry')).find((e) => e.textContent?.includes(title))!;
const day = (key: string) =>
  screen.getAllByTestId('calendar-day').find((d) => d.getAttribute('data-day') === key)!;

async function week(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByTestId('calendar-view-week'));
  await screen.findByTestId('calendar-week');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Calendario: la semana', () => {
  it('siete días con las piezas como tarjetas: miniatura, hora de la marca, red y formato, y estado con texto', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('16 nov');
    expect(screen.getAllByTestId('calendar-day')).toHaveLength(7);

    const wed = await card('Menú del día');
    expect(wed).toHaveTextContent('15:00');
    expect(wed).toHaveTextContent('Instagram · Publicación');
    expect(wed).toHaveTextContent('Programada');
    expect(wed).toHaveAttribute('data-state', 'scheduled');
    await waitFor(() => expect(within(wed).getByTestId('calendar-entry-thumb').querySelector('img')).not.toBeNull());
    expect(day('2026-11-18')).toContainElement(wed);

    const carousel = await card('Carrusel de postres');
    expect(carousel).toHaveTextContent('Instagram · Carrusel');
    expect(carousel).toHaveTextContent('2 págs.');
    const reel = await card('Reel del chef');
    expect(reel).toHaveTextContent('Instagram · Reel');
    expect(reel).toHaveAttribute('data-state', 'draft');
    expect(reel).toHaveTextContent('Borrador');
    // Las dos del viernes, una columna.
    expect(day('2026-11-20')).toContainElement(carousel);
    expect(day('2026-11-20')).toContainElement(reel);
  });

  it('resalta los huecos de la semana y cuenta frente al objetivo, que se puede cambiar y se recuerda', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    await screen.findByTestId('calendar-plan');
    // Jueves y sábado: sin nada. Lunes y martes ya pasaron: no son huecos.
    expect(screen.getByTestId('calendar-gaps')).toHaveTextContent('Sin nada el jueves y el sábado');
    expect(day('2026-11-19')).toHaveAttribute('data-gap', 'true');
    expect(within(day('2026-11-19')).getByTestId('calendar-day-gap')).toHaveTextContent('Sin nada');
    expect(day('2026-11-21')).toHaveAttribute('data-gap', 'true');
    expect(day('2026-11-17')).toHaveAttribute('data-gap', 'false');
    expect(day('2026-11-20')).toHaveAttribute('data-gap', 'false');

    expect(screen.getByTestId('calendar-week-count')).toHaveTextContent('5 de 3');
    expect(screen.getByTestId('calendar-goal')).toHaveTextContent('3');
    await user.click(screen.getByRole('button', { name: 'Subir el objetivo' }));
    await user.click(screen.getByRole('button', { name: 'Subir el objetivo' }));
    await user.click(screen.getByRole('button', { name: 'Subir el objetivo' }));
    expect(screen.getByTestId('calendar-week-count')).toHaveTextContent('5 de 6');
    expect(window.localStorage.getItem(`rrss.calendar.goal.${BRAND_ID}`)).toBe('6');
    expect(window.localStorage.getItem('rrss.calendar.view')).toBe('"week"');
  });

  it('un filtro no inventa huecos: se cuentan siempre todas las piezas de la semana', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    await user.selectOptions(await screen.findByTestId('calendar-format-filter'), 'reel');
    expect(screen.getAllByTestId('calendar-entry')).toHaveLength(1);
    expect(screen.getByTestId('calendar-gaps')).toHaveTextContent('Sin nada el jueves y el sábado');
    expect(screen.getByTestId('calendar-week-count')).toHaveTextContent('5 de 3');
    await user.click(screen.getByTestId('calendar-filters-clear'));
    expect(screen.getAllByTestId('calendar-entry')).toHaveLength(5);
  });

  it('las campañas activas son una franja sobre los días que cubren, y se filtra por campaña', async () => {
    seed();
    fake.tables.campaigns = [
      {
        id: 'camp-1',
        brand_id: BRAND_ID,
        organization_id: ORG_ID,
        title: 'Menú de otoño',
        instruction: '',
        networks: ['instagram'],
        starts_on: '2026-11-17',
        ends_on: '2026-11-20',
        origin: 'ai',
        status: 'accepted',
        current_plan_version: 1,
        accepted_plan_version: 1,
        created_by: null,
        accepted_by: null,
        accepted_at: null,
        created_at: '2026-11-10T09:00:00Z',
        updated_at: '2026-11-10T09:00:00Z',
      },
      { id: 'camp-2', brand_id: BRAND_ID, title: 'Sin aceptar', status: 'proposed', starts_on: '2026-11-17', ends_on: '2026-11-20' },
    ];
    fake.tables.campaign_contents = [{ campaign_id: 'camp-1', content_id: 'c-fri1', brand_id: BRAND_ID }];
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    const band = await screen.findByTestId('calendar-campaign');
    expect(band).toHaveTextContent('Campaña: Menú de otoño');
    // Martes (columna 2) a viernes (columna 5); la propuesta sin aceptar no sale.
    expect(band).toHaveStyle({ gridColumn: '2 / 6' });
    expect(screen.getAllByTestId('calendar-campaign')).toHaveLength(1);

    await user.selectOptions(screen.getByTestId('calendar-campaign-filter'), 'camp-1');
    await waitFor(() => expect(screen.getAllByTestId('calendar-entry')).toHaveLength(1));
    expect(screen.getByTestId('calendar-entry')).toHaveTextContent('Carrusel de postres');
  });
});

describe('Calendario: el mes y la lista', () => {
  it('mes compacto: las semanas pasadas se pliegan, la actual se destaca y cada día lleva un contador', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await user.click(await screen.findByTestId('calendar-view-month'));
    await screen.findByTestId('calendar-month');
    // Noviembre de 2026 se ve en 6 semanas; las tres que ya pasaron, plegadas.
    expect(screen.getAllByTestId('calendar-week-folded')).toHaveLength(3);
    const rows = screen.getAllByTestId('calendar-week-row');
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.getAttribute('data-current') === 'true')).toHaveLength(1);
    // Una semana plegada se abre y se vuelve a plegar.
    await user.click(screen.getAllByTestId('calendar-week-folded')[0]!);
    expect(screen.getAllByTestId('calendar-week-folded')).toHaveLength(2);

    const friday = day('2026-11-20');
    expect(within(friday).getByTestId('calendar-day-count')).toHaveTextContent('2');
    expect(within(friday).getAllByTestId('calendar-month-thumb')).toHaveLength(2);
    // Sin etiquetas dentro de la celda: las tarjetas solo salen del día elegido (de entrada, hoy).
    expect(within(friday).queryAllByTestId('calendar-entry')).toHaveLength(0);
    expect(within(screen.getByTestId('calendar-day-panel')).getAllByTestId('calendar-entry')).toHaveLength(1);
    await user.click(friday);
    const panel = screen.getByTestId('calendar-day-panel');
    expect(within(panel).getAllByTestId('calendar-entry')).toHaveLength(2);
  });

  it('lista: semana a semana, con los huecos, y la vista elegida se recuerda', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    // Sin preferencia y en una pantalla estrecha (la de las pruebas), la lista.
    const agenda = await screen.findByTestId('calendar-agenda');
    expect(screen.getByTestId('calendar-view-agenda')).toHaveAttribute('aria-pressed', 'true');
    expect(within(agenda).getAllByTestId('calendar-entry')).toHaveLength(5);
    expect(within(agenda).getAllByTestId('calendar-day-gap').length).toBeGreaterThanOrEqual(2);
    expect(within(agenda).getByText('Esta semana')).toBeInTheDocument();

    await user.click(screen.getByTestId('calendar-view-month'));
    expect(window.localStorage.getItem('rrss.calendar.view')).toBe('"month"');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('diciembre de 2026');
    await user.click(screen.getByTestId('calendar-today'));
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('noviembre de 2026');
  });
});

describe('Calendario: vista rápida y mover', () => {
  it('pulsar una pieza enseña la imagen, el pie de foto y las acciones; «Abrir» lleva a la ficha', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    await user.click(await card('Carrusel de postres'));
    const quick = await screen.findByTestId('calendar-quick');
    expect(await within(quick).findByTestId('publication-text')).toHaveTextContent(
      'Tres postres para cerrar la semana.',
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Carrusel de postres');
    expect(screen.getByRole('dialog')).toHaveTextContent('Programada');
    expect(screen.getByTestId('calendar-quick-publish-now')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-quick-cancel')).toBeInTheDocument();
    expect(screen.getByLabelText('Mover a')).toBeInTheDocument();
    await user.click(screen.getByTestId('calendar-quick-open'));
    expect(await screen.findByTestId('publication-dialog')).toBeInTheDocument();
  });

  it('una detenida enseña el motivo y su botón de arreglo también en la vista rápida', async () => {
    seed();
    fake.tables.social_accounts = [];
    fake.tables.scheduled_publications = [
      pub('p-1', 'c-wed', WED, { status: 'planned', hold_reason: 'no_account', social_account_id: null }),
    ];
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    const held = await card('Menú del día');
    expect(held).toHaveTextContent('Detenida');
    expect(held).toHaveTextContent('Sin cuenta de Instagram conectada');
    await user.click(held);
    const hold = await screen.findByTestId('calendar-quick-hold');
    expect(within(hold).getByRole('link', { name: 'Conectar cuenta' })).toHaveAttribute(
      'href',
      `${BRAND_BASE}/marca?seccion=datos#cuentas-conectadas`,
    );
  });

  it('«Mover a…» con teclado: guarda la hora de la marca y «Deshacer» la devuelve', async () => {
    seed();
    fake.rpc('reschedule_publication', (args) => pub('p-wed', 'c-wed', String(args.p_scheduled_at)));
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    await user.click(await card('Menú del día'));
    const when = (await screen.findByLabelText('Mover a')) as HTMLInputElement;
    expect(when.value).toBe('2026-11-18T15:00');
    await user.clear(when);
    await user.type(when, '2026-11-19T19:30');
    await user.click(screen.getByRole('button', { name: 'Mover' }));
    await waitFor(() => expect(fake.callsTo('reschedule_publication', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('reschedule_publication', 'rpc')[0]!.payload).toMatchObject({
      p_publication_id: 'p-wed',
      p_scheduled_at: '2026-11-19T18:30:00.000Z',
    });
    await user.click(await screen.findByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(fake.callsTo('reschedule_publication', 'rpc')).toHaveLength(2));
    expect(fake.callsTo('reschedule_publication', 'rpc')[1]!.payload).toMatchObject({ p_scheduled_at: WED });
  });

  it('no deja mover lo ya publicado ni al pasado', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    const published = await card('Domingo de brasa');
    expect(published).toHaveAttribute('draggable', 'false');
    await user.click(published);
    // Se abre su ficha (no la vista rápida): publicada, sin mover ni cancelar.
    expect(await screen.findByTestId('publication-published')).toBeInTheDocument();
    expect(screen.queryByLabelText('Mover a')).toBeNull();
    expect(screen.queryByTestId('calendar-quick-cancel')).toBeNull();
    expect(screen.queryByTestId('publication-cancel')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    // Soltar una publicada en otro día no hace nada.
    const dt = transfer();
    fireEvent.dragStart(published, { dataTransfer: dt });
    fireEvent.drop(day('2026-11-19'), { dataTransfer: dt });
    // Y una programada, a un día que ya pasó, tampoco.
    const dt2 = transfer();
    fireEvent.dragStart(await card('Menú del día'), { dataTransfer: dt2 });
    fireEvent.drop(day('2026-11-17'), { dataTransfer: dt2 });
    expect(await screen.findAllByText(/No se puede mover al pasado|Lo ya publicado no se puede mover/)).not.toHaveLength(0);
    expect(fake.callsTo('reschedule_publication', 'rpc')).toHaveLength(0);
  });

  it('arrastrar una pieza a otro día conserva la hora y deja deshacer', async () => {
    seed();
    fake.rpc('reschedule_publication', (args) => pub('p-fri1', 'c-fri1', String(args.p_scheduled_at)));
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    const carousel = await card('Carrusel de postres');
    expect(carousel).toHaveAttribute('draggable', 'true');
    const dt = transfer();
    fireEvent.dragStart(carousel, { dataTransfer: dt });
    fireEvent.dragOver(day('2026-11-19'), { dataTransfer: dt });
    fireEvent.drop(day('2026-11-19'), { dataTransfer: dt });
    await waitFor(() => expect(fake.callsTo('reschedule_publication', 'rpc')).toHaveLength(1));
    expect(fake.callsTo('reschedule_publication', 'rpc')[0]!.payload).toMatchObject({
      p_publication_id: 'p-fri1',
      p_scheduled_at: '2026-11-19T09:00:00.000Z', // jueves, a las 10:00 de Madrid como el viernes
    });
    await user.click(await screen.findByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(fake.callsTo('reschedule_publication', 'rpc')).toHaveLength(2));
    expect(fake.callsTo('reschedule_publication', 'rpc')[1]!.payload).toMatchObject({ p_scheduled_at: FRI_1 });
  });

  it('quien solo comenta no arrastra ni mueve', async () => {
    seed();
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    const wed = await card('Menú del día');
    expect(wed).toHaveAttribute('draggable', 'false');
    await user.click(wed);
    await screen.findByTestId('calendar-quick');
    expect(screen.queryByLabelText('Mover a')).toBeNull();
    expect(screen.queryByTestId('calendar-quick-cancel')).toBeNull();
  });
});

describe('Calendario: crear desde un día y «Por programar»', () => {
  it('el «+» de un día abre «Programar» con la fecha puesta', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    // Solo se ve al pasar el ratón o al enfocarlo: está en el día, oculto hasta entonces.
    const add = within(day('2026-11-19')).getByTestId('calendar-day-add');
    expect(add).toHaveClass('opacity-0');
    // Los días que ya pasaron no tienen «+».
    expect(within(day('2026-11-17')).queryByTestId('calendar-day-add')).toBeNull();
    await user.click(add);
    expect(await screen.findByTestId('schedule-when')).toHaveValue('2026-11-19T10:00');
  });

  it('arrastrar una pieza de «Por programar» a un día abre «Programar» con la pieza y el día; también con «Programar…»', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed({ tray: true });
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    const toggle = await screen.findByTestId('calendar-tray-toggle');
    await waitFor(() => expect(toggle).toHaveTextContent('2'));
    await user.click(toggle);
    const items = await screen.findAllByTestId('calendar-tray-item');
    // Aprobadas primero; lo que ya está en el calendario no sale.
    expect(items.map((i) => i.getAttribute('data-content'))).toEqual(['c-tray', 'c-borrador']);

    const dt = transfer();
    fireEvent.dragStart(items[0]!, { dataTransfer: dt });
    fireEvent.drop(day('2026-11-21'), { dataTransfer: dt });
    expect(await screen.findByTestId('schedule-content')).toHaveValue('c-tray');
    expect(screen.getByTestId('schedule-when')).toHaveValue('2026-11-21T10:00');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    await user.click(within(items[1]!).getByRole('button', { name: 'Programar Idea a medias' }));
    expect(await screen.findByTestId('schedule-content')).toHaveValue('c-borrador');
  });

  it('sin permiso de edición no hay «+» ni bandeja', async () => {
    vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
    seed();
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await week(user);
    await card('Menú del día');
    expect(screen.queryByTestId('calendar-day-add')).toBeNull();
    expect(screen.queryByTestId('calendar-tray-toggle')).toBeNull();
  });
});

describe('Calendario: abrir la ficha desde la lista', () => {
  it('la lista usa las mismas tarjetas', async () => {
    seed();
    const { user } = renderApp(`${BRAND_BASE}/calendario`);
    await openFicha(user, await card('Menú del día'));
    expect(await screen.findByTestId('publication-dialog')).toBeInTheDocument();
  });
});
