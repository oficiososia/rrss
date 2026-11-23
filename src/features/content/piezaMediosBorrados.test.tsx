import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/fixtures';
import { createEmptyDocument, isEmptyFrame, type ImageLayer, type Layer, type LogoLayer } from './document';
import { asEmptyFrame, emptyMissingAssets } from './editor/missingAssets';
import { assetRow, canvas, draftLayers, EDITOR, PHOTO_A, PHOTO_B, photo, seedPiece, text } from './editorTestKit';

// Una pieza con una foto o un logotipo que después se borró de la biblioteca: el hueco
// pasa a ser un marco vacío «Poner foto» (documento v6) con un aviso en la cabecera, y
// no sale en la imagen exportada (un marco vacío no se exporta) en vez de impedirla.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
  default: (await import('./editorTestCanvas')).CanvasStub,
}));

const BORRADA = '99999999-9999-4999-8999-999999999999';
const LOGO_BORRADO = '88888888-8888-4888-8888-888888888888';

const logo = (id: string, assetId: string): LogoLayer => ({
  id,
  type: 'logo',
  name: 'Logotipo',
  x: 800,
  y: 40,
  width: 200,
  height: 120,
  rotation: 0,
  opacity: 0.9,
  visible: true,
  locked: false,
  anchor: { x: 'right', y: 'top' },
  assetId,
});

const layerOf = (id: string) => canvas().document.layers.find((layer) => layer.id === id)!;

describe('pieza con fotos borradas de la biblioteca', () => {
  it('la foto y el logotipo borrados pasan a ser marcos vacíos «Poner foto», con aviso arriba', async () => {
    seedPiece({
      layers: [
        photo('plato', BORRADA, {
          blur: 20,
          adjust: { brightness: 10, contrast: 0, saturation: 0, temperature: 0, sharpness: 0 },
        }),
        photo('arroz', PHOTO_B),
        logo('marca', LOGO_BORRADO),
        text('titulo', 'Chuletón'),
      ],
      assets: [assetRow(PHOTO_A), assetRow(PHOTO_B, { file_name: 'arroz.jpg' })],
    });
    renderApp(EDITOR);
    expect(await screen.findByTestId('editor-missing-assets')).toHaveTextContent(
      '2 fotos de esta pieza se han borrado de la biblioteca. Su sitio queda como huecos: pulsa «Poner foto» para sustituirlas.',
    );
    await waitFor(() => expect(isEmptyFrame(layerOf('plato'))).toBe(true));
    const plato = layerOf('plato') as ImageLayer;
    // Conserva la caja y los efectos; solo cambia lo que mostraba.
    expect(plato).toMatchObject({ frame: true, blur: 20, x: 100, width: 600, source: { kind: 'empty' } });
    // El logotipo, en un marco que encaja entero, en su sitio.
    expect(layerOf('marca')).toMatchObject({ type: 'image', frame: true, fit: 'contain', x: 800, opacity: 0.9 });
    // La que sigue existiendo no cambia.
    expect(layerOf('arroz')).toMatchObject({ source: { kind: 'asset', assetId: PHOTO_B } });
    // Queda en el borrador automático (se puede deshacer, como cualquier cambio).
    await waitFor(
      () => expect(draftLayers()?.find((l) => l.id === 'plato')).toMatchObject({ source: { kind: 'empty' } }),
      {
        timeout: 6000,
      },
    );
  });

  it('al poner foto en el hueco, el aviso se va', async () => {
    seedPiece({ layers: [photo('plato', BORRADA)], assets: [assetRow(PHOTO_A, { file_name: 'chuleton.jpg' })] });
    const { user } = renderApp(EDITOR);
    expect(await screen.findByTestId('editor-missing-assets')).toHaveTextContent('1 foto de esta pieza se ha borrado');
    await waitFor(() => expect(isEmptyFrame(layerOf('plato'))).toBe(true));
    // «Poner foto» del marco (el lienzo de verdad lo dibuja; aquí se pide como lo haría él).
    act(() => canvas().onFrameClick?.('plato'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Poner foto' }));
    const option = (await dialog.findAllByTestId('picker-asset')).find((b) => b.textContent?.includes('chuleton.jpg'))!;
    await user.click(option);
    await waitFor(() => expect(layerOf('plato')).toMatchObject({ source: { kind: 'asset', assetId: PHOTO_A } }));
    expect(screen.queryByTestId('editor-missing-assets')).not.toBeInTheDocument();
  });

  it('en solo lectura no se toca el documento, pero se avisa', async () => {
    seedPiece({
      layers: [photo('plato', BORRADA)],
      assets: [assetRow(PHOTO_A)],
      role: { orgRole: 'member', brandRole: 'viewer' },
    });
    renderApp(EDITOR);
    expect(await screen.findByTestId('editor-missing-assets')).toHaveTextContent(
      'Quien edita la pieza puede sustituirlas',
    );
    expect(layerOf('plato')).toMatchObject({ source: { kind: 'asset', assetId: BORRADA } });
  });
});

describe('marcos vacíos a partir de recursos que faltan (puro)', () => {
  it('convierte solo lo que falta, en todas las páginas', () => {
    const empty = createEmptyDocument({ aspectRatio: '1:1' });
    const layers: Layer[] = [photo('a', BORRADA), photo('b', PHOTO_A), logo('l', LOGO_BORRADO)];
    const document = {
      ...empty,
      pages: [
        { id: 'p1', name: '', layers },
        { id: 'p2', name: '', layers: [photo('c', BORRADA)] },
      ],
    };
    const result = emptyMissingAssets(document, new Set([BORRADA, LOGO_BORRADO]));
    expect(result.layerIds).toEqual(['a', 'l', 'c']);
    expect(result.document.pages[0]!.layers.map(isEmptyFrame)).toEqual([true, false, true]);
    expect(result.document.pages[1]!.layers.map(isEmptyFrame)).toEqual([true]);
    // Sin nada que falte, el mismo documento.
    expect(emptyMissingAssets(document, new Set()).document).toBe(document);
    expect(asEmptyFrame(text('t', 'x'))).toMatchObject({ type: 'text' });
  });
});
