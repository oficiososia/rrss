// Aviso antes del primer dictado: el audio lo procesa el servicio de voz del navegador.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument } from '../document';
import { VOICE_NOTICE_KEY, VoiceCopilot } from './VoiceCopilot';

const starts = vi.fn();

class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult = null;
  onerror = null;
  onend = null;
  start = () => starts();
  stop = () => undefined;
  abort = () => undefined;
}

function renderCopilot(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VoiceCopilot
          orgId="org"
          brandId="brand"
          document={createEmptyDocument()}
          pageIndex={0}
          brand={{ palette: [], fonts: [] }}
          logoIds={[]}
          selectedImage={null}
          libraryPath="/biblioteca"
          onApply={() => undefined}
          onClose={onClose}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onClose;
}

describe('aviso previo al dictado', () => {
  beforeEach(() => {
    starts.mockClear();
    window.localStorage.clear();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    window.localStorage.clear();
  });

  it('antes de nada explica adónde va el audio y no escucha hasta que se acepta', async () => {
    renderCopilot();
    const notice = screen.getByTestId('copilot-voice-notice');
    expect(notice).toHaveTextContent('servicio de voz de tu navegador');
    expect(notice).toHaveTextContent('Google');
    expect(notice).toHaveTextContent('Microsoft');
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute('href', '/legal/privacidad');
    expect(starts).not.toHaveBeenCalled();
    expect(screen.queryByTestId('copilot-mic')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('copilot-voice-notice-ok'));
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('copilot-mic')).toBeInTheDocument();
    expect(starts).toHaveBeenCalledTimes(1);
    // Sin «No volver a mostrar», la próxima vez se avisa otra vez.
    expect(window.localStorage.getItem(VOICE_NOTICE_KEY)).toBeNull();
  });

  it('con «No volver a mostrar» no vuelve a salir y se empieza a escuchar directamente', async () => {
    renderCopilot();
    await userEvent.click(screen.getByTestId('copilot-voice-notice-hide'));
    await userEvent.click(screen.getByTestId('copilot-voice-notice-ok'));
    expect(window.localStorage.getItem(VOICE_NOTICE_KEY)).toBe('true');
    expect(starts).toHaveBeenCalledTimes(1);
  });

  it('si ya se pidió no volver a mostrarlo, entra escuchando', () => {
    window.localStorage.setItem(VOICE_NOTICE_KEY, 'true');
    renderCopilot();
    expect(screen.queryByTestId('copilot-voice-notice')).not.toBeInTheDocument();
    expect(starts).toHaveBeenCalledTimes(1);
  });

  it('se puede cerrar el copiloto sin aceptar y sin que se haya escuchado nada', async () => {
    const onClose = renderCopilot();
    await userEvent.click(screen.getByTestId('copilot-close'));
    expect(onClose).toHaveBeenCalled();
    expect(starts).not.toHaveBeenCalled();
  });
});
