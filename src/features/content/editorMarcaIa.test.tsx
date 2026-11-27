import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';
import { openShareSheet } from '@/test/moreMenu';
import type { UserEvent } from '@testing-library/user-event';
import { createEmptyDocument, type ContentDocument } from './document';
import type { CanvasViewProps } from './editor/canvas/types';

// El editor con las piezas de otros bloques ya conectadas: el verificador de
// marca («Revisión de marca», en «Compartir») y la IA de texto (redactar y
// comprobar el tono), también en «Compartir».

vi.mock('@/features/content/editor/canvas/KonvaCanvas', () => ({
  default: (props: CanvasViewProps) => (
    <div
      data-testid="canvas-stub"
      data-layers={props.document.layers.length}
      data-selected={props.selectedIds.join(',')}
      data-editing={props.editingTextId ?? ''}
    />
  ),
}));

const EDITOR = `${BRAND_BASE}/contenidos/content-1`;

function documentWith(caption: string, textColor = '#111111'): ContentDocument {
  const doc = createEmptyDocument();
  return {
    ...doc,
    canvas: { ...doc.canvas, backgroundColor: '#FFFFFF' },
    copy: { ...doc.copy, caption, altText: 'Plato de temporada' },
    pages: [{ id: 'p1', name: '', layers: [
      {
        id: 'titular',
        type: 'text',
        name: '',
        x: 100,
        y: 100,
        width: 800,
        height: 200,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        anchor: { x: 'center', y: 'center' },
        text: 'Titular de otoño',
        fontFamily: 'sans-serif',
        fontSize: 40,
        fontWeight: 400,
        italic: false,
        color: textColor,
        align: 'center',
        lineHeight: 1.2,
      },
    ] }],
  };
}

function seed(document: ContentDocument) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.brand_profiles = [
    {
      id: 'perfil-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      status: 'active',
      schema_version: 1,
      data: { voice: { tone: ['Cercano'], forbiddenPhrases: ['barato'] } },
      provenance: {},
      change_note: '',
      created_by: ME.id,
      created_at: '2026-11-01T10:00:00Z',
    },
  ];
  fake.tables.content_items = [
    {
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
    },
  ];
  fake.tables.content_versions = [
    {
      id: 'v-1',
      content_id: 'content-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      schema_version: 1,
      data: document,
      change_note: '',
      restored_from: null,
      created_by: ME.id,
      created_at: '2026-11-11T09:00:00Z',
    },
  ];
}

async function openEditor(document: ContentDocument) {
  seed(document);
  const app = renderApp(EDITOR);
  await screen.findByTestId('editor-title');
  return app;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Abre «Compartir» y despliega la revisión de marca. */
async function openBrandCheck(user: UserEvent) {
  const sheet = await openShareSheet(user);
  await user.click(sheet.getByText('Revisión de marca'));
  return sheet;
}

describe('Editor: comprobación de marca', () => {
  it('la revisión de marca da el veredicto y un hallazgo del pie lleva a su campo con el fragmento elegido', async () => {
    const { user } = await openEditor(documentWith('Un menú barato y rico'));
    const sheet = await openBrandCheck(user);
    const finding = await sheet.findByTestId('brandcheck-finding-FORBIDDEN_PHRASE');
    expect(sheet.getByTestId('brandcheck-verdict')).toHaveAttribute('data-verdict', 'fail');

    await user.click(finding);
    const caption = sheet.getByTestId('copy-caption') as HTMLTextAreaElement;
    await waitFor(() => expect(caption).toHaveFocus());
    expect(caption.value.slice(caption.selectionStart, caption.selectionEnd)).toBe('barato');
  });

  it('un hallazgo de una capa de texto cierra la hoja, la elige y abre su texto sobre el lienzo', async () => {
    const { user } = await openEditor(documentWith('Un menú rico', '#F4F4F4'));
    const sheet = await openBrandCheck(user);
    await user.click(await sheet.findByTestId('brandcheck-finding-CONTRAST_TOO_LOW'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Compartir' })).not.toBeInTheDocument());
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-selected', 'titular');
    expect(screen.getByTestId('canvas-stub')).toHaveAttribute('data-editing', 'titular');
  });
});

describe('Editor: IA de texto', () => {
  it('sin IA configurada en el entorno no enseña redactar ni comprobar el tono', async () => {
    const { user } = await openEditor(documentWith('Un menú rico'));
    const sheet = await openBrandCheck(user);
    expect(sheet.queryByRole('button', { name: /Redactar con IA/ })).not.toBeInTheDocument();
    await sheet.findByTestId('brandcheck-verdict');
    expect(sheet.queryByTestId('ai-brand-check')).not.toBeInTheDocument();
  });

  it('redactar con IA aplica la variante elegida como un paso que se deshace', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    fake.fn('ai-generate', () => ({
      status: 200,
      body: {
        action: 'post.caption',
        generationId: 'g-1',
        network: 'instagram',
        requestedVariants: 1,
        variants: [
          { text: 'Llega el otoño a la mesa.', hashtags: ['#otoño'], caption: '', characters: 0, withinLimits: true },
        ],
      },
    }));
    const { user } = await openEditor(documentWith('Texto de antes'));
    await openShareSheet(user);
    await user.click(screen.getByRole('button', { name: /Redactar con IA/ }));
    const dialog = (await screen.findAllByRole('dialog')).find((d) => within(d).queryByLabelText(/Encargo/))!;
    await user.type(within(dialog).getByLabelText(/Encargo/), 'Menú de otoño');
    await user.click(within(dialog).getByRole('button', { name: /^Generar$/ }));
    await user.click(await within(dialog).findByRole('button', { name: 'Usar esta' }));

    await waitFor(() => expect(screen.getByTestId('copy-caption')).toHaveValue('Llega el otoño a la mesa.'));
    expect(screen.getByTestId('copy-hashtags')).toHaveValue('#otoño');
    expect(screen.getByTestId('copy-alt')).toHaveValue('Plato de temporada');
    expect(screen.getByTestId('editor-dirty')).toBeInTheDocument();
    // El texto aplicado lleva la marca de contenido generado con IA (RGPD / Reglamento de IA).
    expect(screen.getByTestId('editor-ai-label')).toHaveTextContent(/texto/);

    // Deshacer (desde la cabecera, con la hoja cerrada) devuelve el texto de antes.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Compartir' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    const sheet = await openShareSheet(user);
    expect(sheet.getByTestId('copy-caption')).toHaveValue('Texto de antes');
    expect(sheet.queryByTestId('editor-ai-label')).not.toBeInTheDocument();
  });

  it('con IA, la pestaña Marca ofrece comprobar el tono del texto que se publicaría', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    fake.fn('ai-generate', () => ({
      status: 200,
      body: {
        action: 'brand.check',
        generationId: 'g-2',
        verdict: 'fail',
        criteria: [
          { criterion: 'tone', verdict: 'pass', explanation: 'Cercano.', evidence: [] },
          { criterion: 'banned_topics', verdict: 'fail', explanation: 'Usa «barato».', evidence: ['barato'] },
        ],
      },
    }));
    const { user } = await openEditor(documentWith('Un menú barato'));
    const sheet = await openBrandCheck(user);
    await user.click(await sheet.findByTestId('ai-brand-check-run'));
    expect(await screen.findByTestId('ai-criterion-banned_topics')).toHaveTextContent('No cumple');
    const calls = fake.callsTo('ai-generate', 'function');
    expect(calls[calls.length - 1]!.payload).toMatchObject({
      action: 'brand.check',
      input: { text: 'Un menú barato' },
    });
  });
});
