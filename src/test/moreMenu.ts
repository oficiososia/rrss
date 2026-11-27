import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

// Las acciones secundarias de una página viven en el menú «⋯» (MoreMenu).
// Estas ayudas lo abren y pulsan o devuelven una de sus acciones.

/** Abre el menú «⋯» con ese data-testid. */
export async function openMoreMenu(user: UserEvent, menuTestId: string): Promise<void> {
  await user.click(await screen.findByTestId(menuTestId));
  await screen.findByRole('menu');
}

/** Abre el menú «⋯» y pulsa la acción. */
export async function chooseMoreAction(user: UserEvent, menuTestId: string, itemTestId: string): Promise<void> {
  await openMoreMenu(user, menuTestId);
  await user.click(await screen.findByTestId(itemTestId));
}

/**
 * Editor de piezas: lo que se hace al terminar una pieza vive en la hoja «Compartir» (descargar,
 * publicar, programar y, en modo agencia, los cambios de estado); el resto, en «⋯».
 */
const SHARE_ACTIONS: Record<string, string> = {
  'editor-export': 'share-download',
  'editor-schedule': 'share-schedule',
  'editor-publish-now': 'share-publish-now',
  'share-download': 'share-download',
  'share-schedule': 'share-schedule',
  'share-publish-now': 'share-publish-now',
  'share-copy-text': 'share-copy-text',
};

/** Abre la hoja «Compartir» del editor de piezas y devuelve su contenido. */
export async function openShareSheet(user: UserEvent) {
  await user.click(await screen.findByTestId('editor-share'));
  return within(await screen.findByRole('dialog', { name: 'Compartir' }));
}

/** Pulsa una acción del editor de una pieza: en la hoja «Compartir» o en «⋯». */
export async function chooseEditorAction(user: UserEvent, itemTestId: string): Promise<void> {
  // «Desde una plantilla» es el cajón «Plantillas» del riel.
  if (itemTestId === 'editor-from-template') {
    await user.click(await screen.findByTestId('drawer-templates'));
    return;
  }
  const share = SHARE_ACTIONS[itemTestId] ?? (itemTestId.startsWith('status-') ? itemTestId : null);
  if (share) {
    const sheet = await openShareSheet(user);
    await user.click(await sheet.findByTestId(share));
    return;
  }
  await chooseMoreAction(user, 'editor-more', itemTestId);
}
