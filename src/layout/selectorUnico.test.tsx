import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, brandRow, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// Un solo selector de marca. Antes había dos (organización y marca): para ir a una marca de otra
// organización había que cambiar primero de organización. Ahora la organización se lee y el
// selector de marca enseña todas las marcas a las que se tiene acceso.

const OTHER_ORG = 'org-2';
const EMPTY_ORG = 'org-3';

/** Además de «Grupo Demo» con «Casa Demo»: otra organización con dos marcas y una tercera sin ninguna. */
function seedMoreOrganizations() {
  for (const [id, name] of [
    [OTHER_ORG, 'Gimnasio Demo'],
    [EMPTY_ORG, 'Recién creada'],
  ] as const) {
    fake.rows('organizations').push({
      id,
      name,
      kind: 'business',
      work_mode: 'self',
      settings: {},
      created_by: null,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z',
    });
    fake.rows('organization_members').push({
      organization_id: id,
      user_id: ME.id,
      role: 'owner',
      created_at: '2026-10-01T09:00:00Z',
    });
  }
  fake
    .rows('brands')
    .push(
      brandRow({ id: 'brand-gym', organization_id: OTHER_ORG, name: 'EnerGym' }),
      brandRow({ id: 'brand-vieja', organization_id: OTHER_ORG, name: 'Marca archivada', status: 'archived' }),
    );
  // Una marca de una organización a la que NO se pertenece (un superadministrador las lee todas): no sale.
  fake.rows('brands').push(brandRow({ id: 'brand-ajena', organization_id: 'org-ajena', name: 'Marca ajena' }));
}

async function openSwitcher(user: ReturnType<typeof renderApp>['user']) {
  await user.click((await screen.findAllByTestId('brand-switcher'))[0]!);
  return within(await screen.findByRole('menu'));
}

describe('un solo selector de marca', () => {
  it('no hay selector de organización: su nombre se lee en el selector de marca', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    renderApp(`${BRAND_BASE}/inicio`);
    const [switcher] = await screen.findAllByTestId('brand-switcher');
    expect(switcher).toHaveTextContent('Casa Demo');
    expect(within(switcher!).getByTestId('org-name')).toHaveTextContent('Grupo Demo');
    expect(switcher).toHaveAccessibleName('Marca: Casa Demo. Cambiar');
    // Ni el desplegable de organizaciones ni otro botón para cambiar de organización.
    expect(screen.queryByTestId('org-switcher')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Organización:/ })).toBeNull();
    // Uno en el menú lateral y el mismo en la cabecera del móvil (el CSS enseña uno): ninguno más.
    expect(screen.getAllByTestId('brand-switcher')).toHaveLength(2);
  });

  it('con una sola organización el menú es el de siempre, sin grupos', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    const menu = await openSwitcher(user);
    expect(menu.getByText('Marcas')).toBeInTheDocument();
    expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Casa Demo',
      'Ver todas las marcas',
      'Nueva marca',
      'Crear organización',
    ]);
  });

  it('enseña las marcas de todas las organizaciones, agrupadas, y se va a cualquiera de un toque', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    seedMoreOrganizations();
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    const menu = await openSwitcher(user);
    // La organización en la que se está, primero y con su nombre.
    expect(menu.getByText('Grupo Demo')).toBeInTheDocument();
    expect(menu.getByTestId(`brand-option-${BRAND_ID}`)).toHaveTextContent('Casa Demo');
    // La marca de la otra organización, sin cambiar antes de organización.
    const gym = within(await menu.findByTestId(`brand-group-${OTHER_ORG}`));
    expect(gym.getByText('Gimnasio Demo')).toBeInTheDocument();
    expect(await gym.findByTestId('brand-option-brand-gym')).toHaveTextContent('EnerGym');
    // Ni las archivadas ni las de organizaciones a las que no se pertenece.
    expect(menu.queryByText('Marca archivada')).toBeNull();
    expect(menu.queryByText('Marca ajena')).toBeNull();
    // Una organización sin marcas se puede abrir (allí se crea la primera).
    const empty = within(menu.getByTestId(`brand-group-${EMPTY_ORG}`));
    expect(await empty.findByRole('menuitem', { name: 'Todavía sin marcas: abrir' })).toBeInTheDocument();

    await user.click(gym.getByTestId('brand-option-brand-gym'));
    await waitFor(() => expect(window.location.pathname).toBe(`/o/${OTHER_ORG}/m/brand-gym/inicio`));
    // Ya en la otra organización, el selector dice dónde se está.
    await waitFor(() => expect(screen.getAllByTestId('brand-switcher')[0]).toHaveTextContent('EnerGym'));
    expect(within(screen.getAllByTestId('brand-switcher')[0]!).getByTestId('org-name')).toHaveTextContent(
      'Gimnasio Demo',
    );
  });

  it('desde el selector se abre una organización sin marcas', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    seedMoreOrganizations();
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    const menu = await openSwitcher(user);
    await user.click(await menu.findByTestId(`org-option-${EMPTY_ORG}`));
    await waitFor(() => expect(window.location.pathname).toBe(`/o/${EMPTY_ORG}`));
    expect(await screen.findByTestId('new-brand-empty')).toBeInTheDocument();
    expect(screen.getAllByTestId('brand-switcher')[0]).toHaveTextContent('Elegir marca');
  });

  it('sin marca elegida (páginas de la organización) sigue habiendo un solo selector', async () => {
    seedWorkspace({ orgRole: 'owner', workMode: 'self' });
    renderApp(`/o/${ORG_ID}`);
    const [switcher] = await screen.findAllByTestId('brand-switcher');
    expect(switcher).toHaveAccessibleName('Elegir marca');
    expect(within(switcher!).getByTestId('org-name')).toHaveTextContent('Grupo Demo');
    expect(screen.queryByTestId('org-switcher')).toBeNull();
  });
});
