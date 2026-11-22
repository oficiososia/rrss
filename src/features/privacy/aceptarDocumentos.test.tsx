// Aviso que bloquea el uso hasta aceptar la versión vigente de los documentos legales.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LEGAL_VERSIONS } from '@/features/legal/legal';
import { fake } from '@/test/fakeSupabase';
import { BASE, ME, renderApp, seedWorkspace } from '@/test/fixtures';
import { pendingDocuments } from './LegalGate';

const row = (document: 'terms' | 'privacy', version: string, id: number) => ({
  id,
  user_id: ME.id,
  document,
  version,
  accepted_at: '2026-10-01T09:00:00Z',
  source: 'signup',
});

describe('LegalGate', () => {
  it('con las versiones vigentes aceptadas, no estorba', async () => {
    seedWorkspace({ orgRole: 'owner' });
    renderApp(BASE);
    await screen.findAllByTestId('user-menu');
    expect(screen.queryByTestId('legal-gate')).not.toBeInTheDocument();
  });

  it('si cambió la versión, bloquea hasta aceptar, y la aceptación se registra con las versiones vigentes', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.legal_acceptances = [row('terms', '2020-01-01', 1), row('privacy', LEGAL_VERSIONS.privacy, 2)];
    fake.rpc('accept_legal_documents', (args) => {
      expect(args).toEqual({ p_terms_version: LEGAL_VERSIONS.terms, p_privacy_version: LEGAL_VERSIONS.privacy });
      return [row('terms', LEGAL_VERSIONS.terms, 3), row('privacy', LEGAL_VERSIONS.privacy, 2)];
    });
    const { user } = renderApp(BASE);

    await screen.findByTestId('legal-gate');
    expect(screen.getByTestId('legal-gate-text')).toHaveTextContent('condiciones de uso');
    expect(screen.getByTestId('legal-gate-text')).not.toHaveTextContent('política de privacidad');
    expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument();

    // Sin marcar la casilla no se puede aceptar.
    expect(screen.getByTestId('legal-gate-accept')).toBeDisabled();
    await user.click(screen.getByTestId('legal-gate-check'));
    await user.click(screen.getByTestId('legal-gate-accept'));

    await waitFor(() => expect(screen.queryByTestId('legal-gate')).not.toBeInTheDocument());
    expect(fake.callsTo('accept_legal_documents', 'rpc')).toHaveLength(1);
    expect(await screen.findAllByTestId('user-menu')).not.toHaveLength(0);
  });

  it('quien nunca ha aceptado también tiene que hacerlo', async () => {
    seedWorkspace({ orgRole: 'member', brandRole: 'viewer' });
    fake.tables.legal_acceptances = [];
    renderApp(BASE);
    expect(await screen.findByTestId('legal-gate')).toBeInTheDocument();
    expect(screen.getByTestId('legal-gate-text')).toHaveTextContent('No consta');
  });

  it('deja entrar a «Mi cuenta» para descargar o borrar los datos sin aceptar', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.tables.legal_acceptances = [];
    renderApp('/cuenta');
    expect(await screen.findByRole('heading', { name: 'Mi cuenta y privacidad' })).toBeInTheDocument();
    expect(screen.queryByTestId('legal-gate')).not.toBeInTheDocument();
  });

  it('si no se puede leer el registro de aceptaciones, no deja a nadie fuera', async () => {
    seedWorkspace({ orgRole: 'owner' });
    fake.failNext('legal_acceptances', 'select', { message: 'caído' });
    renderApp(BASE);
    await screen.findAllByTestId('user-menu');
    expect(screen.queryByTestId('legal-gate')).not.toBeInTheDocument();
  });

  it('pendingDocuments dice cuáles faltan', () => {
    expect(pendingDocuments([])).toEqual(['terms', 'privacy']);
    expect(pendingDocuments([{ document: 'terms', version: LEGAL_VERSIONS.terms }])).toEqual(['privacy']);
  });
});
