import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { lastSelectionKey } from '@/features/orgs/context';
import { CHUNK_RELOAD_KEY, isChunkLoadError, lazyRoute, pageReloader, reloadOnceForNewVersion } from '@/lib/lazyRoute';
import { BASE, BRAND_BASE, BRAND_ID, brandRow, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { ErrorBoundary } from './ErrorBoundary';

const chunkError = () =>
  new TypeError('Failed to fetch dynamically imported module: https://app.example/assets/Marca-abc123.js');

function renderLazy(load: () => Promise<() => JSX.Element>) {
  const Screen = lazyRoute(load);
  return render(
    <ErrorBoundary>
      <Suspense fallback={<p>Cargando la sección</p>}>
        <Screen />
      </Suspense>
    </ErrorBoundary>,
  );
}

describe('Trozo de código que ya no existe tras un despliegue', () => {
  it('reconoce los mensajes de los navegadores y no confunde otros errores', () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new Error('permission denied'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it('recarga la página una sola vez y apunta la marca en sessionStorage', async () => {
    window.sessionStorage.clear();
    const reload = vi.spyOn(pageReloader, 'reload').mockImplementation(() => {});
    renderLazy(() => Promise.reject(chunkError()));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    // Mientras recarga no sale ningún error a medias.
    expect(screen.queryByTestId('section-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-version-notice')).not.toBeInTheDocument();
    // Un segundo fallo enseguida no vuelve a recargar: sin bucle.
    expect(reloadOnceForNewVersion()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('si ya se recargó y vuelve a fallar, enseña «Hay una versión nueva» con su botón', async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    const reload = vi.spyOn(pageReloader, 'reload').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderLazy(() => Promise.reject(chunkError()));

    const notice = await screen.findByTestId('new-version-notice');
    expect(notice).toHaveTextContent('Hay una versión nueva de la aplicación');
    expect(reload).not.toHaveBeenCalled();
    await user.click(within(notice).getByRole('button', { name: 'Recargar' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('pasado el margen, un despliegue posterior vuelve a recargar solo', async () => {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now() - 5 * 60_000));
    const reload = vi.spyOn(pageReloader, 'reload').mockImplementation(() => {});
    expect(reloadOnceForNewVersion()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('se puede precargar sin recargar la página aunque falle', async () => {
    window.sessionStorage.clear();
    const reload = vi.spyOn(pageReloader, 'reload').mockImplementation(() => {});
    const Screen = lazyRoute(() => Promise.reject(chunkError()));
    await expect(Screen.preload()).resolves.toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('Límite de errores de una sección', () => {
  it('enseña un mensaje con «Reintentar» en lugar de dejar la pantalla en negro, y reintenta', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.spyOn(pageReloader, 'reload').mockImplementation(() => {});
    let broken = true;
    function Fragile() {
      if (broken) throw new Error('fallo al pintar');
      return <p>Sección pintada</p>;
    }
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );

    const error = await screen.findByTestId('section-error');
    expect(error).toHaveTextContent('Esta sección no se ha podido mostrar');
    expect(reload).not.toHaveBeenCalled();

    broken = false;
    await user.click(within(error).getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sección pintada')).toBeInTheDocument();
  });

  it('al cambiar de sección se olvida el error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Fragile({ section }: { section: string }) {
      if (section === 'rota') throw new Error('fallo');
      return <p>Sección {section}</p>;
    }
    function Harness() {
      const [section, setSection] = useState('rota');
      return (
        <MemoryRouter>
          <button onClick={() => setSection('buena')}>Cambiar</button>
          <ErrorBoundary resetKey={section}>
            <Fragile section={section} />
          </ErrorBoundary>
        </MemoryRouter>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByTestId('section-error');
    await user.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(await screen.findByText('Sección buena')).toBeInTheDocument();
    expect(screen.queryByTestId('section-error')).not.toBeInTheDocument();
  });
});

describe('Barra inferior del móvil', () => {
  async function mobileNav() {
    return within(await screen.findByTestId('mobile-nav'));
  }
  // El avatar de la cabecera del móvil es el segundo menú de la cuenta (el primero, el del menú lateral).
  async function openAvatarMenu(user: ReturnType<typeof renderApp>['user']) {
    await user.click((await screen.findAllByTestId('user-menu'))[1]!);
    return within(await screen.findByRole('menu'));
  }

  it('Inicio, Contenidos, «＋» en medio, Calendario y Biblioteca; nada de «Más»', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp(`${BRAND_BASE}/inicio`);
    const nav = await mobileNav();
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Inicio',
      'Contenidos',
      'Calendario',
      'Biblioteca',
    ]);
    // El «＋ Crear» va entre Contenidos y Calendario.
    const slots = [...(await screen.findByTestId('mobile-nav')).children];
    expect(slots).toHaveLength(5);
    expect(within(slots[2] as HTMLElement).getByTestId('create-menu-mobile')).toHaveAccessibleName('Crear');
    expect(nav.queryByRole('button', { name: 'Más' })).not.toBeInTheDocument();
    expect(nav.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page');
  });

  it('el avatar lleva Resultados y los ajustes, y abre la sección elegida', async () => {
    seedWorkspace({ orgRole: 'owner' });
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    const menu = await openAvatarMenu(user);
    const names = menu.getAllByRole('menuitem').map((item) => item.textContent);
    expect(names.slice(0, 4)).toEqual(['Resultados', 'Marca', 'Equipo', 'Configuración']);
    await user.click(menu.getByRole('menuitem', { name: 'Equipo' }));
    await waitFor(() => expect(window.location.pathname).toBe(`${BRAND_BASE}/equipo`));
  });

  it('quien solo mira no tiene «＋» y le quedan las cuatro secciones', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
    renderApp(`${BRAND_BASE}/inicio`);
    const nav = await mobileNav();
    expect(nav.getAllByRole('link')).toHaveLength(4);
    expect(nav.queryByTestId('create-menu-mobile')).not.toBeInTheDocument();
  });

  it('con modo agencia, Encargos va en el avatar y su insignia se ve en él', async () => {
    seedWorkspace({ orgRole: 'owner', brands: [brandRow({ ai_mode: 'agency' })] });
    const { fake } = await import('@/test/fakeSupabase');
    fake.tables.request_notifications = [
      {
        id: 'n1',
        user_id: ME.id,
        organization_id: ORG_ID,
        brand_id: BRAND_ID,
        request_id: 'r1',
        kind: 'comment',
        read_at: null,
        created_at: '2026-11-20T10:00:00Z',
      },
    ] as never;
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    const nav = await mobileNav();
    expect(nav.queryByRole('link', { name: /Encargos/ })).not.toBeInTheDocument();
    const avatar = (await screen.findAllByTestId('user-menu'))[1]!;
    await waitFor(() => expect(within(avatar).getByTestId('nav-badge')).toHaveTextContent('1'));
    const menu = await openAvatarMenu(user);
    expect(menu.getByRole('menuitem', { name: /Encargos/ })).toBeInTheDocument();
  });

  it('sin marca, solo «Marcas» y sin «＋»', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp(BASE);
    const nav = await mobileNav();
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual(['Marcas']);
    expect(nav.queryByTestId('create-menu-mobile')).not.toBeInTheDocument();
  });
});

describe('Configuración sin perder la marca', () => {
  it('mantiene la última marca en el menú y Configuración sale marcada en el menú de la cuenta', async () => {
    seedWorkspace({ orgRole: 'owner' });
    window.localStorage.setItem(
      lastSelectionKey(ME.id),
      JSON.stringify({ orgId: ORG_ID, brandByOrg: { [ORG_ID]: BRAND_ID } }),
    );
    const { user } = renderApp(`${BASE}/ajustes/general`);

    const navs = await screen.findAllByRole('navigation', { name: 'Principal' });
    const side = within(navs[0]!);
    await waitFor(() => expect(side.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', `${BRAND_BASE}/inicio`));
    expect(side.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
    expect(screen.getAllByTestId('brand-switcher')[0]).toHaveAccessibleName('Marca: Casa Demo. Cambiar');
    await user.click(screen.getAllByTestId('user-menu')[0]!);
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getByRole('menuitem', { name: /Configuración/ })).toHaveTextContent('(estás aquí)');
  });

  it('sin marca recordada, el menú sigue siendo el de la organización', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp(`${BASE}/ajustes/general`);
    const navs = await screen.findAllByRole('navigation', { name: 'Principal' });
    await waitFor(() =>
      expect(
        within(navs[0]!)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Marcas']),
    );
  });
});

describe('Entrada a la app', () => {
  it('con una visita anterior va directo a la última marca', async () => {
    seedWorkspace({ orgRole: 'owner' });
    window.localStorage.setItem(
      lastSelectionKey(ME.id),
      JSON.stringify({ orgId: ORG_ID, brandByOrg: { [ORG_ID]: BRAND_ID } }),
    );
    renderApp('/');
    await waitFor(() => expect(window.location.pathname).toBe(`${BRAND_BASE}/inicio`));
  });

  it('al salir de la organización recordada, vuelve a la bienvenida y no a ella', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
    window.localStorage.setItem(
      lastSelectionKey(ME.id),
      JSON.stringify({ orgId: ORG_ID, brandByOrg: { [ORG_ID]: BRAND_ID } }),
    );
    const { fake } = await import('@/test/fakeSupabase');
    fake.rpc('remove_member', () => {
      fake.tables.organization_members = [];
      return null;
    });
    const { user } = renderApp(`${BASE}/ajustes/equipo`);
    await user.click(await screen.findByRole('button', { name: /Salir de la organización/ }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(window.location.pathname).toBe('/bienvenida'));
  });

  it('si ya no hay acceso a la organización recordada, la olvida', async () => {
    seedWorkspace({ orgRole: 'owner' });
    window.localStorage.setItem(lastSelectionKey(ME.id), JSON.stringify({ orgId: 'org-vieja' }));
    renderApp('/');
    expect(await screen.findByText('No tienes acceso a esta organización')).toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(lastSelectionKey(ME.id)) ?? '{}').orgId).toBeUndefined(),
    );
  });
});
