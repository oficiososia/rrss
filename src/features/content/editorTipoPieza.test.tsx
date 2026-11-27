import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { renderApp } from '@/test/fixtures';
import { assetRow, canvas, EDITOR, PHOTO_A, photo, seedPiece, text } from './editorTestKit';

// El tipo de pieza, a la vista en la cabecera del editor: cambiarlo recoloca las
// capas a la proporción del formato nuevo (como «Proporción») y, a Reel, las
// fotos del diseño pasan a ser los clips del montaje.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
  default: (await import('./editorTestCanvas')).CanvasStub,
}));

describe('Tipo de pieza en la cabecera', () => {
  it('se ve junto al nombre, con su proporción, y pasar a Historia recoloca las capas a 9:16', async () => {
    seedPiece({ layers: [photo('foto'), text('titulo', 'Oferta')] });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    const select = screen.getByTestId('editor-format');
    expect(select).toHaveValue('post');
    expect(select).toHaveDisplayValue(/Publicación · 4:5/);
    await user.selectOptions(select, 'story');
    await waitFor(() => expect(fake.callsTo('content_items', 'update')).toHaveLength(1));
    expect(fake.callsTo('content_items', 'update')[0]!.payload).toEqual({ network: 'instagram', format: 'story' });
    await waitFor(() => expect(canvas().document.canvas.aspectRatio).toBe('9:16'));
    // Un solo paso de deshacer devuelve la proporción.
    await user.click(screen.getByTestId('undo'));
    expect(canvas().document.canvas.aspectRatio).toBe('4:5');
  });

  it('a Reel: las fotos del diseño quedan como clips del montaje (borrador del reel)', async () => {
    seedPiece({ layers: [photo('foto', PHOTO_A), text('titulo', 'Oferta')], assets: [assetRow(PHOTO_A)] });
    const drafts: unknown[] = [];
    fake.rpc('save_reel_draft', (args) => {
      drafts.push(args);
      return '2026-11-23T10:00:00Z';
    });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await user.selectOptions(screen.getByTestId('editor-format'), 'reel');
    await waitFor(() => expect(drafts).toHaveLength(1));
    expect(fake.callsTo('content_items', 'update')[0]!.payload).toEqual({ network: 'instagram', format: 'reel' });
    const draft = drafts[0] as { p_content_id: string; p_data: { kind: string; plan: { clips: { path: string }[] } } };
    expect(draft.p_content_id).toBe('content-1');
    expect(draft.p_data.kind).toBe('reel');
    expect(draft.p_data.plan.clips.map((clip) => clip.path)).toEqual([assetRow(PHOTO_A).storage_path]);
  });

  it('quien no edita ve el tipo, pero no lo cambia', async () => {
    seedPiece({ role: { orgRole: 'member', brandRole: 'viewer' } });
    renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    expect(screen.queryByTestId('editor-format')).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-format-label')).toHaveTextContent('Publicación · 4:5');
  });
});
