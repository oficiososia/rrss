import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Pulsa una publicación del calendario y llega a su ficha: una por salir abre la vista rápida y
 * se pasa a la ficha con «Abrir»; una ya publicada abre la ficha directamente.
 */
export async function openFicha(user: UserEvent, entry: HTMLElement): Promise<void> {
  await user.click(entry);
  await waitFor(() => {
    if (!screen.queryByTestId('calendar-quick-open') && !screen.queryByTestId('publication-dialog')) {
      throw new Error('No se ha abierto ni la vista rápida ni la ficha');
    }
  });
  const quickOpen = screen.queryByTestId('calendar-quick-open');
  if (quickOpen) await user.click(quickOpen);
}
