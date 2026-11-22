import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/features/content/document';
import type { BrandDesignTemplateRow } from '@/lib/database.types';
import { fake } from '@/test/fakeSupabase';
import { BRAND_BASE, BRAND_ID, ORG_ID, renderApp, seedWorkspace } from '@/test/fixtures';

// Gestión de las plantillas de la marca (Marca → Identidad visual): lista, de dónde vienen,
// renombrar, duplicar y borrar; quien solo ve la marca no puede cambiarlas.

function row(id: string, name: string, source: BrandDesignTemplateRow['source']): BrandDesignTemplateRow {
  return {
    id,
    brand_id: BRAND_ID,
    organization_id: ORG_ID,
    template_key: id,
    name,
    network: 'instagram',
    format: 'post',
    document: createEmptyDocument({ aspectRatio: '1:1' }) as unknown as BrandDesignTemplateRow['document'],
    analysis: {},
    source,
    created_by: null,
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-20T09:00:00Z',
  };
}

function seed(role: Parameters<typeof seedWorkspace>[0]) {
  seedWorkspace(role);
  fake.tables.brand_fonts = [];
  fake.tables.brand_design_templates = [
    row('t-1', 'Plato del día', 'instagram_import'),
    row('t-2', 'Cartel', 'manual'),
    row('t-3', 'Mi diseño', 'editor'),
  ];
}

describe('Plantillas de la marca', () => {
  it('lista cada plantilla con su origen', async () => {
    seed({ orgRole: 'owner' });
    renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    const items = await screen.findAllByTestId('brand-template');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('Importada')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Manual')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Del editor')).toBeInTheDocument();
  });

  it('renombrar, duplicar y borrar llaman a sus funciones', async () => {
    seed({ orgRole: 'owner' });
    const calls: string[] = [];
    fake.rpc('rename_design_template', (args) => {
      calls.push(`rename ${args.p_template_id} ${args.p_name}`);
      return null;
    });
    fake.rpc('duplicate_design_template', (args) => {
      calls.push(`duplicate ${args.p_template_id}`);
      return null;
    });
    fake.rpc('delete_design_template', (args) => {
      calls.push(`delete ${args.p_template_id}`);
      return null;
    });
    const { user } = renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    const items = await screen.findAllByTestId('brand-template');

    await user.click(within(items[1]!).getByTestId('brand-template-rename'));
    const input = within(items[1]!).getByTestId('brand-template-rename-input');
    await user.clear(input);
    await user.type(input, 'Cartel de verano');
    await user.click(within(items[1]!).getByTestId('brand-template-rename-save'));
    await waitFor(() => expect(calls).toContain('rename t-2 Cartel de verano'));

    await user.click(within(items[2]!).getByTestId('brand-template-duplicate'));
    await waitFor(() => expect(calls).toContain('duplicate t-3'));

    await user.click(within(items[0]!).getByTestId('brand-template-delete'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Esta no la creaste aquí/)).toBeInTheDocument();
    await user.click(dialog.getByTestId('confirm-action'));
    await waitFor(() => expect(calls).toContain('delete t-1'));
  });

  it('Esc al renombrar cancela sin guardar', async () => {
    seed({ orgRole: 'owner' });
    const { user } = renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    const items = await screen.findAllByTestId('brand-template');
    await user.click(within(items[2]!).getByTestId('brand-template-rename'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('brand-template-rename-input')).not.toBeInTheDocument();
    expect(fake.callsTo('rename_design_template', 'rpc')).toHaveLength(0);
  });

  it('quien solo ve la marca ve la lista sin botones', async () => {
    seed({ orgRole: 'member', brandRole: 'viewer' });
    renderApp(`${BRAND_BASE}/marca?seccion=visual`);
    expect(await screen.findAllByTestId('brand-template')).toHaveLength(3);
    expect(screen.queryByTestId('brand-template-rename')).not.toBeInTheDocument();
    expect(screen.queryByTestId('brand-template-delete')).not.toBeInTheDocument();
  });
});
