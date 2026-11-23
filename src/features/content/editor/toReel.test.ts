import { describe, expect, it } from 'vitest';
import { assetRow, frame, photo, PHOTO_A, PHOTO_B, text } from '../editorTestKit';
import { createEmptyDocument } from '../document';
import { reelFromDesign } from './toReel';

describe('pasar una pieza a Reel', () => {
  it('las fotos del diseño (todas las páginas, sin repetir) son los clips; textos y huecos no entran', () => {
    const empty = createEmptyDocument({ aspectRatio: '4:5' });
    const document = {
      ...empty,
      pages: [
        { id: 'p1', name: '', layers: [photo('a', PHOTO_A), text('t', 'Hola'), frame('hueco')] },
        { id: 'p2', name: '', layers: [photo('b', PHOTO_B), photo('c', PHOTO_A)] },
      ],
    };
    const project = reelFromDesign(document, [assetRow(PHOTO_A), assetRow(PHOTO_B)]);
    expect(project.kind).toBe('reel');
    expect(project.plan.clips.map((clip) => clip.path)).toEqual([
      assetRow(PHOTO_A).storage_path,
      assetRow(PHOTO_B).storage_path,
    ]);
    expect(project.plan.clips.every((clip) => clip.type === 'photo')).toBe(true);
  });
});
