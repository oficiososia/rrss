import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, renderApp, seedWorkspace } from '@/test/fixtures';

// La vista rápida y la ficha de una publicación son hermanas en el Calendario. Cerradas, las dos
// llevaban la misma clave («cerrada») y React avisaba de claves repetidas en la consola: la prueba
// de extremo a extremo de Campañas (14) fallaba por ese error de consola.

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Calendario: claves de las ventanas', () => {
  it('sin nada abierto, la vista rápida y la ficha no repiten clave (sin avisos de React)', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.content_items = [];
    fake.tables.scheduled_publications = [];
    fake.tables.social_accounts = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderApp(`${BRAND_BASE}/calendario`);
    expect(await screen.findByTestId('calendar-more')).toBeInTheDocument();

    const repetidas = error.mock.calls.filter((args) => String(args[0]).includes('two children with the same key'));
    expect(repetidas).toEqual([]);
  });
});
