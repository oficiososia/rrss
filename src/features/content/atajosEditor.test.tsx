import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentItemRow, ContentVersionRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { createEmptyDocument, DOCUMENT_SCHEMA_VERSION, type ContentDocument, type Layer } from './document';
import type { CanvasViewProps } from './editor/canvas/types';

// Atajos de teclado del editor de piezas: deshacer (Ctrl+Z), rehacer (Ctrl+Mayús+Z
// y Ctrl+Y), guardar (Ctrl+S), borrar (Supr), mover con las flechas (Mayús = de 10 en
// 10), agrupar (Ctrl+G) y soltar (Esc). El lienzo de Konva se sustituye por un doble:
// cada capa es un botón con su posición.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => (
    <div data-testid="canvas-stub" data-selected={props.selectedIds.join(',')}>
      {props.document.layers.map((layer) => (
        <button
          key={layer.id}
          type="button"
          data-testid={`stub-${layer.id}`}
          data-x={layer.x}
          data-y={layer.y}
          onClick={(event) => props.onSelect(layer.id, { toggle: event.shiftKey })}
        >
          {layer.id}
        </button>
      ))}
      <button type="button" data-testid="stub-marquee" onClick={() => props.onSelectMany(['a', 'b'], false)} />
      {props.toolbar}
      {props.footerStart}
    </div>
  ),
}));

const EDITOR = `${BRAND_BASE}/contenidos/content-1`;

function shape(id: string, x: number, y: number): Layer {
  return {
    id,
    type: 'shape',
    name: '',
    x,
    y,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    anchor: { x: 'center', y: 'center' },
    shape: 'rectangle',
    fill: '#E5E7EB',
    stroke: null,
    cornerRadius: 0,
  };
}

function seed() {
  seedWorkspace({ orgRole: 'member', brandRole: 'editor' });
  const base = createEmptyDocument({ aspectRatio: '1:1' });
  const document: ContentDocument = {
    ...base,
    pages: [{ id: 'p1', name: '', layers: [shape('a', 100, 100), shape('b', 400, 300), shape('c', 700, 600)] }],
  };
  const item: ContentItemRow = {
    id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    title: 'Menú de otoño',
    network: 'instagram',
    format: 'post',
    status: 'draft',
    current_version: 1,
    archived_at: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  };
  const version: ContentVersionRow = {
    id: 'v-1',
    content_id: 'content-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    version: 1,
    schema_version: DOCUMENT_SCHEMA_VERSION,
    data: document as unknown as ContentVersionRow['data'],
    change_note: '',
    restored_from: null,
    created_by: ME.id,
    created_at: '2026-11-11T09:00:00Z',
  };
  fake.tables.content_items = [item];
  fake.tables.content_versions = [version];
  fake.tables.media_assets = [
    {
      id: 'asset-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      kind: 'image',
      origin: 'upload',
      storage_path: `${ORG_ID}/${BRAND_ID}/foto.jpg`,
      file_name: 'foto.jpg',
      mime_type: 'image/jpeg',
      bytes: 100,
      width: 1000,
      height: 800,
      duration_ms: null,
      sha256: null,
      folder: '',
      tags: [],
      rights: {},
      provenance: {},
      created_by: ME.id,
      created_at: '2026-11-18T09:00:00Z',
      updated_at: '2026-11-18T09:00:00Z',
    },
  ];
}

async function openEditor() {
  seed();
  const app = renderApp(EDITOR);
  await screen.findByTestId('canvas-stub');
  return app;
}

const x = (id: string) => screen.getByTestId(`stub-${id}`).getAttribute('data-x');
const y = (id: string) => screen.getByTestId(`stub-${id}`).getAttribute('data-y');
const layerButtons = () => screen.getAllByTestId(/^stub-(?!marquee)/);
/** Lo que pasa cuando se cierra un diálogo y el foco queda en la página, no en el editor. */
const loseFocus = () => (document.activeElement as HTMLElement | null)?.blur();

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('Atajos del editor de piezas', () => {
  it('Ctrl+Z deshace; Ctrl+Mayús+Z y Ctrl+Y rehacen', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-a'));
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(x('a')).toBe('110');

    await user.keyboard('{Control>}z{/Control}');
    expect(x('a')).toBe('100');
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(x('a')).toBe('110');
    await user.keyboard('{Control>}z{/Control}');
    expect(x('a')).toBe('100');
    await user.keyboard('{Control>}y{/Control}');
    expect(x('a')).toBe('110');
  });

  it('también funcionan en macOS con Cmd', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-a'));
    await user.keyboard('{ArrowDown}');
    expect(y('a')).toBe('101');
    await user.keyboard('{Meta>}z{/Meta}');
    expect(y('a')).toBe('100');
  });

  it('tras cambiar una foto (el diálogo se cierra y el foco queda en la página) Ctrl+Z y Ctrl+Mayús+Z siguen funcionando', async () => {
    const { user } = await openEditor();
    expect(layerButtons()).toHaveLength(3);
    // Una foto del cajón «Fotos»: la hoja se cierra y el foco queda en la página.
    await user.click(screen.getByTestId('drawer-photos'));
    await user.click((await screen.findAllByTestId('photo-panel-item'))[0]!);
    await waitFor(() => expect(layerButtons()).toHaveLength(4));

    loseFocus();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(layerButtons()).toHaveLength(3));
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(layerButtons()).toHaveLength(4));
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    await waitFor(() => expect(layerButtons()).toHaveLength(4));
  });

  it('Ctrl+S guarda la versión al momento (y no abre el guardado del navegador ni un diálogo)', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-a'));
    await user.keyboard('{ArrowRight}');
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    screen.getByTestId('stub-a').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1));
    expect(screen.queryByTestId('save-note')).not.toBeInTheDocument();
  });

  it('las flechas mueven 1 px y con Mayús 10 px; Supr borra y Ctrl+Z recupera', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-b'));
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect([x('b'), y('b')]).toEqual(['399', '299']);
    await user.keyboard('{Shift>}{ArrowRight}{ArrowDown}{/Shift}');
    expect([x('b'), y('b')]).toEqual(['409', '309']);
    // Varias capas elegidas se mueven juntas.
    await user.click(screen.getByTestId('stub-marquee'));
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(y('a')).toBe('90');
    expect(y('b')).toBe('299');

    await user.keyboard('{Delete}');
    expect(screen.queryByTestId('stub-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-b')).not.toBeInTheDocument();
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByTestId('stub-a')).toBeInTheDocument();
    expect(screen.getByTestId('stub-b')).toBeInTheDocument();
  });

  it('Supr y las flechas no actúan sobre el lienzo mientras se escribe en un campo', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-a'));
    // Un campo del editor: la opacidad, en «⋯ → Ajustes…».
    await user.click(screen.getByTestId('bar-more'));
    await user.click(await screen.findByTestId('menu-more-options'));
    const field = await screen.findByLabelText('Opacidad (%)');
    await user.click(field);
    await user.keyboard('{ArrowLeft}{Delete}');
    expect(x('a')).toBe('100');
    expect(screen.getByTestId('stub-a')).toBeInTheDocument();
  });

  it('Ctrl+G agrupa, Ctrl+Mayús+G desagrupa y Esc quita la selección', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-marquee'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', 'a,b');
    await user.keyboard('{Control>}g{/Control}');
    await user.click(screen.getByTestId('editor-layers'));
    expect(screen.getAllByTestId('layer-group')).toHaveLength(2);

    await user.click(screen.getByTestId('stub-c'));
    await user.click(screen.getByTestId('stub-a'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', 'a,b');
    await user.keyboard('{Control>}{Shift>}g{/Shift}{/Control}');
    expect(screen.queryAllByTestId('layer-group')).toHaveLength(0);

    await user.keyboard('{Escape}');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', '');
  });

  it('Esc quita la selección también con el foco en la página (p. ej. tras cerrar un diálogo)', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-a'));
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', 'a');
    loseFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', '');
  });

  it('los atajos no actúan mientras hay un diálogo abierto', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByTestId('stub-a'));
    await user.click(screen.getByTestId('editor-share'));
    const dialog = await screen.findByRole('dialog', { name: 'Compartir' });
    expect(within(dialog).getByTestId('share-download')).toBeInTheDocument();
    await user.keyboard('{Delete}');
    expect(screen.getByTestId('stub-a')).toBeInTheDocument();
  });
});
