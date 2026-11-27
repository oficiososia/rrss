// Campo que se puede dictar: micrófono del navegador SIMULADO (ninguna voz real, ningún servidor).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DictableField } from './DictableField';
import { appendDictation } from './dictation';

interface Result {
  isFinal: boolean;
  0: { transcript: string };
}
const instances: FakeRecognition[] = [];
const last = () => instances[instances.length - 1]!;
const started = vi.fn();
const stopped = vi.fn();

class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: { resultIndex: number; results: Result[] }) => void) | null = null;
  onerror = null;
  onend: (() => void) | null = null;
  constructor() {
    instances.push(this);
  }
  start = () => started();
  stop = () => {
    stopped();
    this.onend?.();
  };
  abort = () => undefined;
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }
}

function Harness({ initial = '', as, maxLength }: { initial?: string; as?: 'input'; maxLength?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="campo">Qué quieres</label>
      <DictableField
        id="campo"
        as={as as 'input'}
        brandId="brand"
        value={value}
        onValueChange={setValue}
        maxLength={maxLength}
        data-testid="campo"
      />
    </>
  );
}

function renderField(props: Parameters<typeof Harness>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Harness {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('appendDictation', () => {
  it('añade al final con un espacio y sin borrar lo que había', () => {
    expect(appendDictation('Prepara', ' la semana que viene ')).toBe('Prepara la semana que viene');
    expect(appendDictation('', 'hola')).toBe('hola');
    expect(appendDictation('Hola', '   ')).toBe('Hola');
  });
  it('no pasa del máximo', () => {
    expect(appendDictation('abc', 'defghi', 6)).toBe('abc de');
  });
});

describe('DictableField', () => {
  beforeEach(() => {
    instances.length = 0;
    started.mockClear();
    stopped.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    window.localStorage.clear();
  });

  it('sin dictado en el navegador no sale el micrófono y escribir sigue valiendo', async () => {
    renderField();
    expect(screen.queryByTestId('campo-mic')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Qué quieres'), 'Menú de otoño');
    expect(screen.getByLabelText('Qué quieres')).toHaveValue('Menú de otoño');
  });

  it('antes del primer dictado avisa de adónde va el audio y no escucha hasta aceptar', async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    renderField();
    await userEvent.click(screen.getByTestId('campo-mic'));
    expect(screen.getByTestId('campo-notice')).toHaveTextContent('servicio de voz de tu navegador');
    expect(screen.getByRole('link', { name: 'Política de privacidad' })).toHaveAttribute('href', '/legal/privacidad');
    expect(started).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('campo-notice-ok'));
    expect(started).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('campo-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('campo-mic')).toHaveAttribute('aria-pressed', 'true');
  });

  it('lo dictado se añade a lo escrito y se puede seguir corrigiendo a mano', async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    window.localStorage.setItem('rrss.voiceNoticeHidden', 'true');
    renderField({ initial: 'Campaña' });
    await userEvent.click(screen.getByTestId('campo-mic'));
    expect(screen.queryByTestId('campo-notice')).not.toBeInTheDocument();
    act(() => last().say('del menú de otoño'));
    expect(screen.getByLabelText('Qué quieres')).toHaveValue('Campaña del menú de otoño');
    act(() => last().say('sobre todo reels'));
    expect(screen.getByLabelText('Qué quieres')).toHaveValue('Campaña del menú de otoño sobre todo reels');
    await userEvent.type(screen.getByLabelText('Qué quieres'), '!');
    expect(screen.getByLabelText('Qué quieres')).toHaveValue('Campaña del menú de otoño sobre todo reels!');
    // Pulsar otra vez para.
    await userEvent.click(screen.getByTestId('campo-mic'));
    expect(stopped).toHaveBeenCalled();
    expect(screen.getByTestId('campo-mic')).toHaveAttribute('aria-pressed', 'false');
  });

  it('respeta el máximo de caracteres del campo y vale también como una línea', async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    window.localStorage.setItem('rrss.voiceNoticeHidden', 'true');
    renderField({ as: 'input', maxLength: 12 });
    await userEvent.click(screen.getByTestId('campo-mic'));
    act(() => last().say('mesa de mármol blanco'));
    expect(screen.getByLabelText('Qué quieres')).toHaveValue('mesa de márm');
    expect(screen.getByLabelText('Qué quieres').tagName).toBe('INPUT');
  });

  it('«Mejor escribo» cierra el aviso sin escuchar nada', async () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    renderField();
    await userEvent.click(screen.getByTestId('campo-mic'));
    await userEvent.click(screen.getByRole('button', { name: 'Mejor escribo' }));
    expect(screen.queryByTestId('campo-notice')).not.toBeInTheDocument();
    expect(started).not.toHaveBeenCalled();
  });
});
