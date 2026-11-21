import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BRAND_BASE, renderApp, seedWorkspace } from '@/test/fixtures';

const shell = () => screen.getByTestId('app-shell');

describe('Menú lateral plegable', () => {
  it('se pliega y se despliega con el botón, con su etiqueta y aria-expanded, y se recuerda', async () => {
    seedWorkspace({ orgRole: 'owner' });
    const { user, unmount } = renderApp(`${BRAND_BASE}/inicio`);
    const toggle = await screen.findByTestId('sidebar-toggle');
    expect(toggle).toHaveAccessibleName('Ocultar menú');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(shell()).toHaveAttribute('data-sidebar', 'expanded');

    await user.click(toggle);
    expect(screen.getByTestId('sidebar-toggle')).toHaveAccessibleName('Mostrar menú');
    expect(screen.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(shell()).toHaveAttribute('data-sidebar', 'collapsed');
    // Quedan los iconos con su nombre (y tooltip).
    expect(screen.getAllByTestId('nav-contenidos')[0]).toHaveAttribute('title', 'Contenidos');
    expect(window.localStorage.getItem('rrss.sidebar.collapsed')).toBe('true');

    // Al volver a abrir la aplicación se recuerda.
    unmount();
    renderApp(`${BRAND_BASE}/inicio`);
    await waitFor(() => expect(shell()).toHaveAttribute('data-sidebar', 'collapsed'));

    await (await import('@testing-library/user-event')).default.setup().click(screen.getByTestId('sidebar-toggle'));
    expect(shell()).toHaveAttribute('data-sidebar', 'expanded');
    expect(window.localStorage.getItem('rrss.sidebar.collapsed')).toBe('false');
  });

  it('Ctrl+B lo pliega, salvo mientras se escribe en un campo', async () => {
    seedWorkspace({ orgRole: 'owner' });
    const { user } = renderApp(`${BRAND_BASE}/inicio`);
    await screen.findByTestId('sidebar-toggle');
    await user.keyboard('{Control>}b{/Control}');
    expect(shell()).toHaveAttribute('data-sidebar', 'collapsed');
    await user.keyboard('{Control>}b{/Control}');
    expect(shell()).toHaveAttribute('data-sidebar', 'expanded');

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await user.keyboard('{Control>}b{/Control}');
    expect(shell()).toHaveAttribute('data-sidebar', 'expanded');
    input.remove();
  });

  it('funciona aunque el almacenamiento del navegador falle', async () => {
    seedWorkspace({ orgRole: 'owner' });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('bloqueado');
    };
    try {
      const { user } = renderApp(`${BRAND_BASE}/inicio`);
      await user.click(await screen.findByTestId('sidebar-toggle'));
      expect(shell()).toHaveAttribute('data-sidebar', 'collapsed');
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
