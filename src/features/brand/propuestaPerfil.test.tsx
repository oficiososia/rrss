import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ME, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// Propuesta de perfil con IA desde la pestaña «Fuentes»: solo con las fuentes
// de texto plano, que son las únicas que ya guardan su contenido legible.

const SOURCES_URL = `${BRAND_BASE}/marca?seccion=fuentes`;
const TXT_PATH = `${ORG_ID}/${BRAND_ID}/sources/notas.txt`;

function source(id: string, kind: 'text' | 'pdf', title: string, path: string) {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    kind,
    title,
    storage_path: path,
    url: null,
    mime_type: kind === 'text' ? 'text/plain' : 'application/pdf',
    bytes: 100,
    status: 'pending',
    error: null,
    created_by: ME.id,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
  };
}

function seed(kinds: ('text' | 'pdf')[]) {
  seedWorkspace({ orgRole: 'owner' });
  fake.tables.brand_profiles = [
    {
      id: 'perfil-1',
      brand_id: BRAND_ID,
      organization_id: ORG_ID,
      version: 1,
      status: 'active',
      schema_version: 1,
      data: { business: { description: '' }, voice: { tone: ['Cercano'] } },
      provenance: {},
      change_note: '',
      created_by: ME.id,
      created_at: '2026-11-01T10:00:00Z',
    },
  ];
  fake.tables.brand_knowledge_sources = kinds.map((kind, i) =>
    kind === 'text'
      ? source(`s-${i}`, 'text', 'notas.txt', TXT_PATH)
      : source(`s-${i}`, 'pdf', 'Manual.pdf', `${ORG_ID}/${BRAND_ID}/sources/manual.pdf`),
  );
  fake.files[TXT_PATH] = 'Somos una casa de comidas de barrio.';
  fake.rpc('save_brand_profile', (args) => {
    for (const row of fake.rows('brand_profiles')) row.status = 'archived';
    const row = { ...fake.rows('brand_profiles')[0]!, id: 'perfil-2', version: 2, status: 'active', data: args.p_data };
    fake.rows('brand_profiles').push(row);
    return row;
  });
}

const PROPOSAL = {
  action: 'profile.proposal',
  generationId: 'g-p',
  status: 'proposal',
  sources: ['notas.txt'],
  notes: [],
  proposal: {
    business: { description: 'Casa de comidas de barrio', products: [], locations: [], valueProps: [] },
    voice: { tone: ['Cercano'] },
  },
};

describe('Propuesta de perfil con IA', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lee solo las fuentes de texto, y lo aceptado se guarda como versión nueva marcada como de la IA', async () => {
    seed(['text', 'pdf']);
    fake.fn('ai-generate', () => ({ status: 200, body: PROPOSAL }));
    const { user } = renderApp(SOURCES_URL);
    await user.click(await screen.findByTestId('profile-ai-propose'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByTestId('ai-proposal-run'));
    await within(dialog).findByTestId('proposal-field-business.description');
    await user.click(within(dialog).getByTestId('ai-proposal-accept'));

    await screen.findByText('Perfil guardado (versión 2)');
    const sent = fake.callsTo('ai-generate', 'function')[0]!.payload;
    expect(sent).toEqual({
      action: 'profile.proposal',
      brandId: BRAND_ID,
      input: { sources: [{ title: 'notas.txt', text: 'Somos una casa de comidas de barrio.' }] },
    });
    const saved = fake.callsTo('save_brand_profile', 'rpc')[0]!.payload as {
      p_data: { business: { description: string } };
      p_provenance: Record<string, { source: string; verified: boolean }>;
      p_change_note: string;
    };
    expect(saved.p_data.business.description).toBe('Casa de comidas de barrio');
    expect(saved.p_provenance.business).toMatchObject({ source: 'ai', verified: false });
    expect(saved.p_change_note).toBe('Propuesta de la IA: 1 campos aceptados');
  });

  it('sin fuentes de texto no aparece', async () => {
    seed(['pdf']);
    renderApp(SOURCES_URL);
    await screen.findByText('Manual.pdf');
    expect(screen.queryByTestId('profile-ai-propose')).not.toBeInTheDocument();
  });

  it('sin IA configurada en el entorno no aparece', async () => {
    vi.unstubAllEnvs();
    seed(['text']);
    renderApp(SOURCES_URL);
    await screen.findByText('notas.txt');
    await waitFor(() => expect(screen.queryByTestId('profile-ai-propose')).not.toBeInTheDocument());
  });
});
