import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as libraryApi from '@/features/library/api';
import type { MediaAssetRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_ID, ORG_ID, renderApp } from '@/test/fixtures';
import { chooseEditorAction } from '@/test/moreMenu';
import { assetRow, EDITOR, frame, seedPiece, text } from './editorTestKit';

// Publicar sin tropiezos desde el editor: un solo botón «Publicar o compartir»;
// «Programar» ya no rechaza la pieza porque su exportación sea PNG (la que viene
// marcada): prepara sola la imagen que hace falta, como «Publicar ahora»; y el
// pie de la plantilla es un ejemplo en gris, no el texto que se publicaría.
vi.mock('@/features/content/editor/canvas/KonvaCanvas', async () => ({
  default: (await import('./editorTestCanvas')).CanvasStub,
}));
const exporter = vi.hoisted(() => ({ renderDocument: vi.fn() }));
vi.mock('@/features/content/editor/canvas/exporter', () => exporter);

const JPEG = '44444444-4444-4444-8444-444444444444';
const account = {
  id: 'acc-1',
  brand_id: BRAND_ID,
  organization_id: ORG_ID,
  network: 'instagram',
  status: 'active',
  external_id: '1784',
  username: 'casa_demo',
};

/** La exportación que deja «Exportar imagen» con el formato que viene marcado: PNG. */
const pngExport = assetRow('55555555-5555-4555-8555-555555555555', {
  file_name: 'oferta-1080x1350-v1.png',
  mime_type: 'image/png',
  folder: 'Exportaciones',
  provenance: { type: 'export', content_id: 'content-1', version: 1, format: 'png', unsaved_changes: false },
} as Partial<MediaAssetRow>);

const upload = vi.fn<typeof libraryApi.uploadAsset>();

beforeEach(() => {
  vi.stubEnv('VITE_SOCIAL_PUBLISHING_ENABLED', 'true');
  exporter.renderDocument.mockReset();
  exporter.renderDocument.mockResolvedValue({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 1080,
    height: 1350,
  });
  upload.mockReset();
  upload.mockResolvedValue(assetRow(JPEG, { file_name: 'oferta-1080x1350-v1.jpg' }));
  vi.spyOn(libraryApi, 'uploadAsset').mockImplementation(upload);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function seedPublishing(options: Parameters<typeof seedPiece>[0] = {}) {
  seedPiece({ layers: [text('titulo', 'Oferta de la semana')], assets: [pngExport], ...options });
  fake.tables.social_accounts = [account];
  fake.tables.scheduled_publications = [];
  fake.rpc('save_publication', (args) => ({
    id: 'pub-1',
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    content_id: args.p_content_id,
    content_version: args.p_content_version,
    social_account_id: args.p_social_account_id,
    media_asset_ids: args.p_media_asset_ids,
    scheduled_at: args.p_scheduled_at,
    status: 'scheduled',
    hold_reason: null,
  }));
}

describe('Programar desde el editor', () => {
  it('con la exportación en PNG no rechaza la pieza: prepara sola la imagen al guardar en el calendario', async () => {
    seedPublishing({ status: 'approved' });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await chooseEditorAction(user, 'editor-schedule');

    const dialog = within(await screen.findByRole('dialog', { name: 'Programar una publicación' }));
    expect(await dialog.findByTestId('schedule-content')).toHaveValue('content-1');
    // Antes: «No hay ninguna exportación JPEG de la versión 1: expórtala desde el editor…».
    expect(await dialog.findByTestId('schedule-auto-export')).toHaveTextContent(
      'No hace falta exportar nada: la imagen se prepara sola al guardar',
    );
    expect(dialog.queryByTestId('schedule-no-media')).not.toBeInTheDocument();
    expect(dialog.queryByText(/JPEG/)).not.toBeInTheDocument();

    await user.click(dialog.getByTestId('schedule-submit'));
    await waitFor(() => expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(1));
    // Se ha exportado la versión aprobada en el formato que publica la red y se ha guardado en la biblioteca…
    expect(exporter.renderDocument).toHaveBeenCalledTimes(1);
    expect(exporter.renderDocument.mock.calls[0]![2]).toMatchObject({ format: 'jpeg', pixelRatio: 1 });
    expect(upload.mock.calls[0]![0]).toMatchObject({
      folder: 'Exportaciones',
      provenance: { type: 'export', content_id: 'content-1', version: 1, format: 'jpeg', unsaved_changes: false },
    });
    // …y es esa imagen la que va en la publicación programada.
    expect(fake.callsTo('save_publication', 'rpc')[0]!.payload).toMatchObject({
      p_content_id: 'content-1',
      p_media_asset_ids: [JPEG],
      p_content_version: 1,
      p_social_account_id: 'acc-1',
    });
    expect(await screen.findByText('Programada')).toBeInTheDocument();
  });

  it('si ya hay una imagen JPEG de esa versión, se usa esa y no se exporta otra', async () => {
    const jpeg = assetRow(JPEG, {
      file_name: 'oferta-1080x1350-v1.jpg',
      provenance: { type: 'export', content_id: 'content-1', version: 1, format: 'jpeg', unsaved_changes: false },
    } as Partial<MediaAssetRow>);
    seedPublishing({ status: 'approved', assets: [pngExport, jpeg] });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await chooseEditorAction(user, 'editor-schedule');
    const dialog = within(await screen.findByRole('dialog', { name: 'Programar una publicación' }));
    // Viene ya marcada: no hay que elegirla.
    expect(await dialog.findByTestId('schedule-asset')).toBeChecked();
    await user.click(dialog.getByTestId('schedule-submit'));
    await waitFor(() => expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(1));
    expect(exporter.renderDocument).not.toHaveBeenCalled();
    expect(fake.callsTo('save_publication', 'rpc')[0]!.payload).toMatchObject({ p_media_asset_ids: [JPEG] });
  });

  it('si preparar la imagen falla, lo dice y no programa nada a medias', async () => {
    exporter.renderDocument.mockRejectedValue(new Error('No se ha podido cargar la imagen «Foto».'));
    seedPublishing({ status: 'approved' });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await chooseEditorAction(user, 'editor-schedule');
    const dialog = within(await screen.findByRole('dialog', { name: 'Programar una publicación' }));
    await dialog.findByTestId('schedule-auto-export');
    await user.click(dialog.getByTestId('schedule-submit'));
    expect(await dialog.findByTestId('schedule-error')).toHaveTextContent('No se ha podido preparar la imagen');
    expect(fake.callsTo('save_publication', 'rpc')).toHaveLength(0);
  });

  it('sin aprobar, «Aprobar y programar…» guarda lo que haya, aprueba esa versión y abre el calendario', async () => {
    seedPublishing({ status: 'draft' });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await user.click(screen.getByTestId('add-text'));
    await user.click(screen.getByTestId('editor-share'));
    const item = await screen.findByTestId('editor-schedule');
    expect(item).toHaveTextContent('Aprobar y programar…');
    await user.click(item);

    await screen.findByRole('dialog', { name: 'Programar una publicación' });
    expect(fake.callsTo('save_content_version', 'rpc')).toHaveLength(1);
    expect(fake.callsTo('set_content_status', 'rpc')[0]!.payload).toMatchObject({
      p_status: 'approved',
      p_expected_version: 2,
    });
    expect(screen.getByTestId('editor-version')).toHaveTextContent('Versión 2');
  });
});

describe('El pie de la plantilla es un ejemplo, no el texto que se publica', () => {
  const HINT = 'Qué es, cuánto cuesta y hasta cuándo, con las condiciones de verdad. Una sola llamada al final.';

  it('se enseña en gris en el campo del pie, que está vacío; no cuenta ni sale en la vista previa', async () => {
    seedPiece({ layers: [frame('foto'), text('titulo', 'Oferta')], captionHint: HINT });
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await user.click(screen.getByRole('tab', { name: 'Publicación' }));
    const caption = screen.getByTestId('copy-caption') as HTMLTextAreaElement;
    expect(caption).toHaveValue('');
    expect(caption).toHaveAttribute('placeholder', HINT);
    expect(screen.getByTestId('copy-caption-hint')).toHaveTextContent('no se publica');
    expect(screen.getByTestId('counter-caption')).toHaveTextContent('0 / 2200');

    // La vista previa de la red no enseña la indicación como si fuera el pie.
    await chooseEditorAction(user, 'editor-preview');
    const preview = await screen.findByRole('dialog');
    expect(within(preview).queryByText(/Qué es, cuánto cuesta/)).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // Al escribir el pie de verdad, la nota desaparece (la indicación sigue guardada por si se vacía).
    await user.type(screen.getByTestId('copy-caption'), 'Esta semana, chuletón a 28 €.');
    expect(screen.queryByTestId('copy-caption-hint')).not.toBeInTheDocument();
    expect(screen.getByTestId('copy-caption')).toHaveValue('Esta semana, chuletón a 28 €.');
  });

  it('sin plantilla, el campo vacío dice para qué es', async () => {
    seedPiece();
    const { user } = renderApp(EDITOR);
    await screen.findByTestId('canvas-stub');
    await user.click(screen.getByRole('tab', { name: 'Publicación' }));
    expect(screen.getByTestId('copy-caption')).toHaveAttribute(
      'placeholder',
      'Escribe aquí el texto que acompaña a la publicación…',
    );
    expect(screen.queryByTestId('copy-caption-hint')).not.toBeInTheDocument();
  });
});
