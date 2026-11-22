import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Pulsa una publicación del calendario (abre la vista rápida) y pasa a su ficha con «Abrir». */
export async function openFicha(user: UserEvent, entry: HTMLElement): Promise<void> {
  await user.click(entry);
  await user.click(await screen.findByTestId('calendar-quick-open'));
}
