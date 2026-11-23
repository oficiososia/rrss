import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { renderApp } from '@/test/fixtures';
import { DOCUMENT_SCHEMA_VERSION, type ContentDocument } from './document';
import { draftLayers, EDITOR, frame, seedPiece, text, addFromDrawer } from './editorTestKit';

// Guardado automático del editor de piezas: lo que se cambia se guarda solo
// como borrador (no es una versión: ni cambia el estado ni entra en el
// historial), se recupera al volver a abrir y desaparece al guardar una
// versión. Si no se puede guardar, se dice y se avisa antes de salir.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
  default: (await import('./editorTestCanvas')).CanvasStub,
}));

const SAVED = { timeout: 8000 };
const state = () => screen.getByTestId('editor-dirty').getAttribute('data-state');

async function openEditor(options?: Parameters<typeof seedPiece>[0]) {
  const document = seedPiece(options);
  const app = renderApp(EDITOR);
  await screen.findByTestId('canvas-stub');
  return { ...app, document };
}

/** Un borrador ya guardado en el servidor (como lo dejó la sesión anterior). */
function seedDraft(document: ContentDocument, baseVersion = 1) {
  fake.tables.content_drafts = [
    {
      content_id: 'content-1',
      user_id: 'user-me',
      base_version: baseVersion,
      schema_version: DOCUMENT_SCHEMA_VERSION,
      data: document,
      updated_at: '2026-11-20T10:00:00Z',
    },
  ];
}

describe('Editor: guardado automático del borrador', () => {
  it('lo que se cambia se guarda solo: «Guardando…» y luego «Borrador guardado», sin crear versión ni cambiar el estado', async () => {
    const { user } = await openEditor({ status: 'approved' });
    expect(screen.getByTestId('editor-saved')).toHaveTextContent('Guardado');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();

    await addFromDrawer(user, 'elements', 'add-text');
    expect(screen.getByTestId('editor-dirty')).toHaveTextContent('Guardando…');
    await waitFor(() => expect(state()).toBe('saved'), SAVED);
    expect(screen.getByTestId('editor-dirty')).toHaveTextContent('Borrador guardado');

    const call = fake.callsTo('save_content_draft', 'rpc').at(-1)!.payload as Record<string, unknown>;
    expect(call).toMatchObject({
      p_content_id: 'content-1',
      p_base_version: 1,
      p_schema_version: DOCUMENT_SCHEMA_VERSION,
    });
    expect(draftLayers()).toHaveLength(3);
    // Un borrador no es una versión: la pieza aprobada sigue aprobada y en su versión 1.
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(0);
    expect(fake.rows('content_items')[0]).toMatchObject({ status: 'approved', current_version: 1 });
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 1');
  });

  it('varios cambios seguidos se guardan juntos, con lo último', async () => {
    const { user } = await openEditor();
    await addFromDrawer(user, 'elements', 'add-text');
    await addFromDrawer(user, 'elements', 'add-rectangle');
    await addFromDrawer(user, 'elements', 'add-ellipse');
    await waitFor(() => expect(state()).toBe('saved'), SAVED);
    expect(draftLayers()).toHaveLength(5);
    // No se ha llamado al servidor una vez por cada clic.
    expect(fake.callsTo('save_content_draft', 'rpc').length).toBeLessThanOrEqual(2);
  });

  it('al volver a abrir la pieza se sigue donde se dejó; se dice y se puede descartar', async () => {
    const document = seedPiece();
    seedDraft({
      ...document,
      pages: [
        { ...document.pages[0]!, layers: [...document.pages[0]!.layers, text('nuevo', 'Solo este fin de semana')] },
      ],
    });
    const { user } = renderApp(EDITOR);
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-layers', '3');
    expect(screen.getByTestId('stub-nuevo')).toHaveTextContent('Solo este fin de semana');
    // Ya está guardado como borrador: no hay nada «sin guardar» ni se vuelve a mandar.
    expect(screen.getByTestId('editor-dirty')).toHaveTextContent('Borrador guardado');
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 1');
    expect(fake.callsTo('save_content_draft', 'rpc')).toHaveLength(0);

    expect(await screen.findByText(/Sigues donde lo dejaste/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Descartarlos' }));
    await waitFor(() => expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-layers', '2'));
    await waitFor(() => expect(fake.rows('content_drafts')).toHaveLength(0));
    expect(screen.getByTestId('editor-saved')).toHaveTextContent('Guardado');
  });

  it('«Guardar versión» deja el borrador dentro de la versión: desaparece y queda «Guardado»', async () => {
    const { user } = await openEditor();
    await addFromDrawer(user, 'elements', 'add-text');
    await waitFor(() => expect(state()).toBe('saved'), SAVED);
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('Versión 2 guardada')).toBeInTheDocument();
    expect(screen.getByTestId('editor-saved')).toHaveTextContent('Guardado');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();
    await waitFor(() => expect(fake.rows('content_drafts')).toHaveLength(0));
  });

  it('deshacer hasta lo guardado deja de ser un borrador: se borra', async () => {
    const { user } = await openEditor();
    await addFromDrawer(user, 'elements', 'add-text');
    await waitFor(() => expect(state()).toBe('saved'), SAVED);
    expect(fake.rows('content_drafts')).toHaveLength(1);
    await user.click(screen.getByTestId('undo'));
    await waitFor(() => expect(fake.rows('content_drafts')).toHaveLength(0));
    expect(screen.getByTestId('editor-saved')).toBeInTheDocument();
  });

  it('con el borrador ya guardado, o aún por mandar, se sale sin preguntar y no se pierde nada', async () => {
    const { user } = await openEditor();
    await addFromDrawer(user, 'elements', 'add-text');
    // Sin esperar al guardado: salir lo guarda antes.
    await user.click(screen.getByTestId('editor-back'));
    await screen.findByRole('heading', { name: 'Contenidos' }, { timeout: 8000 });
    expect(screen.queryByText('¿Salir sin guardar?')).not.toBeInTheDocument();
    expect(draftLayers()).toHaveLength(3);
  });

  it('si no se puede guardar, lo dice, avisa antes de salir y deja reintentar', async () => {
    const { user } = await openEditor();
    const working = (args: Record<string, unknown>) => {
      fake.tables.content_drafts = [{ content_id: args.p_content_id, user_id: 'user-me', data: args.p_data }];
      return fake.rows('content_drafts')[0];
    };
    fake.rpc('save_content_draft', () => {
      throw { message: 'Failed to fetch' };
    });
    await addFromDrawer(user, 'elements', 'add-text');
    await waitFor(() => expect(state()).toBe('error'), SAVED);
    expect(screen.getByTestId('editor-dirty')).toHaveTextContent('Sin guardar');

    // Salir con cambios que no se han podido guardar SÍ pregunta.
    await user.click(screen.getByTestId('editor-back'));
    const dialog = within(await screen.findByRole('dialog', { name: '¿Salir sin guardar?' }));
    expect(dialog.getByText(/No se ha podido guardar el borrador/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByTestId('canvas-stub')).toBeInTheDocument();

    // Vuelve la conexión: «Reintentar» lo guarda.
    fake.rpc('save_content_draft', working);
    await user.click(screen.getByTestId('editor-save-retry'));
    await waitFor(() => expect(state()).toBe('saved'), SAVED);
    expect(fake.rows('content_drafts')).toHaveLength(1);
  });

  it('un borrador empezado sobre una versión que ya no es la última avisa, como cualquier conflicto', async () => {
    const document = seedPiece();
    // Mientras tanto, otra persona guardó la versión 2.
    fake.rows('content_versions').push({ ...fake.rows('content_versions')[0]!, id: 'v-2', version: 2 });
    fake.rows('content_items')[0]!.current_version = 2;
    seedDraft({ ...document, pages: [{ ...document.pages[0]!, layers: [frame('foto')] }] }, 1);
    renderApp(EDITOR);
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-layers', '1');
    expect(screen.getByTestId('editor-conflict')).toHaveTextContent(
      'Otra persona ha guardado una versión más reciente',
    );
  });

  it('quien solo mira no tiene borrador ni indicador de guardado', async () => {
    const document = seedPiece({ role: { orgRole: 'member', brandRole: 'viewer' } });
    seedDraft({ ...document, pages: [{ ...document.pages[0]!, layers: [] }] });
    renderApp(EDITOR);
    // Se abre la versión guardada, no el borrador (que con ese rol ni siquiera se debería ver).
    expect(await screen.findByTestId('canvas-stub')).toHaveAttribute('data-layers', '2');
    expect(screen.queryByTestId('editor-dirty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('editor-saved')).not.toBeInTheDocument();
    expect(fake.callsTo('save_content_draft', 'rpc')).toHaveLength(0);
  });
});
