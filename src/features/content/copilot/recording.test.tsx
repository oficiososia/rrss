// Dictado grabado («pulsar para hablar») con MediaRecorder, getUserMedia y Web Audio SIMULADOS:
// no se usa ningún micrófono ni se llama al transcriptor real (la función `ai-transcribe` es la simulada).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiErrorMessage } from '@/features/ai/api';
import { ALL_AVAILABLE, fake } from '@/test/fakeSupabase';
import { MicLevel } from './MicLevel';
import {
  levelOf,
  microphoneErrorMessage,
  pickRecordingMimeType,
  RECORDING_MESSAGES,
  recordingAvailable,
  useRecordedDictation,
  type RecordedDictationOptions,
} from './recording';
import { useTranscriberConfigured } from './transcriber';

const RATE = 16000;
const BRAND = '33333333-3333-4333-8333-333333333333';

// ── Navegador simulado ────────────────────────────────────────────────────

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

/** Lo que «oye» el analizador ahora mismo (RMS) y lo que saldrá al decodificar lo grabado. */
const mic: { level: number; decoded: Float32Array; decodeFails: boolean } = {
  level: 0,
  decoded: new Float32Array(0),
  decodeFails: false,
};
const streams: FakeStream[] = [];
const contexts: FakeAudioContext[] = [];
const recorders: FakeRecorder[] = [];
let permission: 'granted' | 'denied' | 'missing' | 'pending' = 'granted';
let grant: ((stream: FakeStream) => void) | null = null;

class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm' || type === 'audio/mp4';
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly mimeType: string;
  constructor(
    readonly stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? '';
    recorders.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') throw new Error('ya parado');
    this.state = 'inactive';
    // Como el de verdad: lo grabado y el aviso de parada llegan después.
    void Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(['sonido grabado'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

class FakeAudioContext {
  closed = false;
  constructor() {
    contexts.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  createMediaStreamSource() {
    return { connect: () => undefined, disconnect: () => undefined };
  }
  createAnalyser() {
    return {
      fftSize: 2048,
      // Una señal constante de valor `level` tiene ese mismo RMS.
      getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(mic.level),
    };
  }
  decodeAudioData() {
    return mic.decodeFails
      ? Promise.reject(new Error('formato desconocido'))
      : Promise.resolve({ duration: mic.decoded.length / RATE });
  }
}

class FakeOfflineAudioContext {
  destination = {};
  createBufferSource() {
    return { buffer: null, connect: () => undefined, start: () => undefined };
  }
  startRendering() {
    return Promise.resolve({ getChannelData: () => mic.decoded });
  }
}

function installBrowser() {
  const w = window as unknown as Record<string, unknown>;
  w.MediaRecorder = FakeRecorder;
  w.AudioContext = FakeAudioContext;
  w.OfflineAudioContext = FakeOfflineAudioContext;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => {
        if (permission === 'denied') return Promise.reject(new DOMException('Permiso denegado', 'NotAllowedError'));
        if (permission === 'missing') return Promise.reject(new DOMException('Sin micrófono', 'NotFoundError'));
        const stream = new FakeStream();
        streams.push(stream);
        if (permission === 'pending') return new Promise<FakeStream>((resolve) => (grant = resolve));
        return Promise.resolve(stream);
      }),
    },
  });
}

function uninstallBrowser() {
  const w = window as unknown as Record<string, unknown>;
  delete w.MediaRecorder;
  delete w.AudioContext;
  delete w.OfflineAudioContext;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
}

/** Sonido decodificado de prueba: silencio (amplitud 0) y «voz» (un tono). */
function sound(...parts: Array<[seconds: number, amplitude: number]>): Float32Array {
  const out = new Float32Array(parts.reduce((sum, [seconds]) => sum + Math.round(seconds * RATE), 0));
  let at = 0;
  for (const [seconds, amplitude] of parts) {
    const length = Math.round(seconds * RATE);
    for (let i = 0; i < length; i += 1) out[at + i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE);
    at += length;
  }
  return out;
}

// ── Reloj y fotogramas a mano ─────────────────────────────────────────────

let clock = 0;
let pendingFrame: (() => void) | null = null;
const frames = {
  requestFrame: (callback: () => void) => {
    pendingFrame = callback;
    return 1;
  },
  cancelFrame: () => {
    pendingFrame = null;
  },
  now: () => clock,
};

/** Pasa el tiempo de 50 en 50 ms, con un fotograma en cada paso. */
async function advance(ms: number) {
  await act(async () => {
    for (let t = 0; t < ms; t += 50) {
      clock += 50;
      const frame = pendingFrame;
      pendingFrame = null;
      frame?.();
    }
    await Promise.resolve();
  });
}

// ── La función `ai-transcribe` simulada ───────────────────────────────────

interface SentDictation {
  brandId: string;
  meta: { chunks: Array<{ seconds: number }>; language: string; purpose: string; hints?: string[] };
  chunks: Blob[];
}
const sent: SentDictation[] = [];

function serveTranscriber(reply: { status: number; body: unknown } = { status: 200, body: null }) {
  fake.fn('ai-transcribe', (body) => {
    const form = body as FormData;
    const meta = JSON.parse(String(form.get('meta'))) as SentDictation['meta'];
    sent.push({
      brandId: String(form.get('brandId')),
      meta,
      chunks: meta.chunks.map((_, index) => form.get(`chunk-${index}`) as Blob),
    });
    if (reply.status !== 200) return reply;
    return {
      status: 200,
      body: reply.body ?? {
        segments: meta.chunks.map((_, index) => ({
          index,
          text: index === 0 ? ' Pon el título arriba ' : 'y más grande',
        })),
        generationId: 'gen-1',
      },
    };
  });
}

function setup(options: Partial<RecordedDictationOptions> = {}) {
  const onPhrase = vi.fn();
  const view = renderHook(
    (props: Partial<RecordedDictationOptions>) =>
      useRecordedDictation(onPhrase, { brandId: BRAND, ...props, deps: { ...frames, ...props.deps } }),
    { initialProps: options },
  );
  return { onPhrase, ...view };
}

async function startRecording(result: { current: { start(): void } }) {
  await act(async () => {
    result.current.start();
    await Promise.resolve();
  });
}

beforeEach(() => {
  clock = 0;
  pendingFrame = null;
  permission = 'granted';
  grant = null;
  mic.level = 0;
  mic.decoded = sound([0.5, 0], [2, 0.3], [1.5, 0]);
  mic.decodeFails = false;
  streams.length = 0;
  contexts.length = 0;
  recorders.length = 0;
  sent.length = 0;
  installBrowser();
});

afterEach(() => {
  uninstallBrowser();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('dictado grabado: pulsar para hablar', () => {
  it('graba, termina solo tras el silencio, transcribe y entrega la orden', async () => {
    serveTranscriber();
    const { result, onPhrase } = setup({ hints: ['Casa Lola', 'Título', 'casa lola', '<Arroz a banda>'] });
    expect(result.current).toMatchObject({ listening: false, busy: false, level: 0, error: null, interim: '' });

    await startRecording(result);
    expect(result.current.listening).toBe(true);
    expect(recorders).toHaveLength(1);
    expect(recorders[0]!.state).toBe('recording');
    // El primer tipo de grabación que admite el navegador (aquí no hay «webm con opus»).
    expect(recorders[0]!.mimeType).toBe('audio/webm');

    // Se habla: el medidor sube.
    mic.level = 0.2;
    await advance(1000);
    expect(result.current.level).toBeGreaterThan(0.5);
    expect(result.current.listening).toBe(true);

    // Un silencio corto no corta la orden…
    mic.level = 0;
    await advance(1000);
    expect(result.current.listening).toBe(true);
    expect(result.current.level).toBe(0);
    // …pero 1,5 s de silencio después de la voz, sí.
    await advance(600);
    expect(recorders[0]!.state).toBe('inactive');
    expect(result.current.listening).toBe(false);

    await waitFor(() => expect(onPhrase).toHaveBeenCalledTimes(1));
    expect(onPhrase).toHaveBeenCalledWith('Pon el título arriba');
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current).toMatchObject({ interim: '', error: null, aiError: null });

    // Lo que ha salido hacia el servidor: un WAV sin el silencio de los extremos, en español,
    // apuntado como dictado y con el vocabulario de pista ya limpio.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.brandId).toBe(BRAND);
    expect(sent[0]!.meta.language).toBe('es');
    expect(sent[0]!.meta.purpose).toBe('editor.dictation');
    expect(sent[0]!.meta.hints).toEqual(['Casa Lola', 'Título', 'Arroz a banda']);
    expect(sent[0]!.meta.chunks).toHaveLength(1);
    expect(sent[0]!.meta.chunks[0]!.seconds).toBeCloseTo(2.5, 1);
    expect(sent[0]!.chunks[0]!.type).toBe('audio/wav');
    expect(sent[0]!.chunks[0]!.size).toBe(44 + Math.round(sent[0]!.meta.chunks[0]!.seconds * RATE) * 2);

    // El micrófono queda suelto y el medidor cerrado.
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(contexts.every((context) => context.closed)).toBe(true);
  });

  it('mientras transcribe dice «Transcribiendo…» y no deja empezar otra grabación', async () => {
    let reply: (value: { status: number; body: unknown }) => void = () => undefined;
    fake.fn('ai-transcribe', () => new Promise((resolve) => (reply = resolve)));
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.2;
    await advance(500);
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.interim).toBe('Transcribiendo…');
    expect(result.current.listening).toBe(false);

    await startRecording(result);
    expect(recorders).toHaveLength(1);

    await act(async () => reply({ status: 200, body: { segments: [{ index: 0, text: 'quita el logo' }] } }));
    await waitFor(() => expect(onPhrase).toHaveBeenCalledWith('quita el logo'));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.interim).toBe('');

    // Terminada la orden, se puede grabar la siguiente.
    await startRecording(result);
    expect(recorders).toHaveLength(2);
  });

  it('si no se oye nada, deja de grabar y no envía nada', async () => {
    serveTranscriber();
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.004; // ruido de fondo, por debajo del umbral
    await advance(7900);
    expect(result.current.listening).toBe(true);
    await advance(200);
    await waitFor(() => expect(result.current.error).toBe(RECORDING_MESSAGES.silence));
    expect(result.current).toMatchObject({ listening: false, busy: false });
    expect(sent).toHaveLength(0);
    expect(onPhrase).not.toHaveBeenCalled();
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
  });

  it('si se para a mano sin haber dicho nada, tampoco envía', async () => {
    serveTranscriber();
    const { result } = setup();
    await startRecording(result);
    await advance(500);
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.error).toBe(RECORDING_MESSAGES.silence));
    expect(sent).toHaveLength(0);
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
  });

  it('si el medidor oyó algo pero lo grabado es todo silencio, no envía', async () => {
    serveTranscriber();
    mic.decoded = sound([3, 0]);
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.2;
    await advance(400);
    mic.level = 0;
    await advance(1600);
    await waitFor(() => expect(result.current.error).toBe(RECORDING_MESSAGES.silence));
    expect(result.current.busy).toBe(false);
    expect(sent).toHaveLength(0);
    expect(onPhrase).not.toHaveBeenCalled();
  });

  it('con «Parar» envía lo dicho hasta ese momento', async () => {
    serveTranscriber();
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.3;
    await advance(800);
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });
    await waitFor(() => expect(onPhrase).toHaveBeenCalledWith('Pon el título arriba'));
    expect(sent).toHaveLength(1);
  });

  it('con «cancelar» tira lo grabado y suelta el micrófono', async () => {
    serveTranscriber();
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.3;
    await advance(800);
    await act(async () => {
      result.current.cancel();
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ listening: false, busy: false, error: null });
    expect(sent).toHaveLength(0);
    expect(onPhrase).not.toHaveBeenCalled();
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(recorders[0]!.state).toBe('inactive');
  });

  it('tope de duración: a los 30 s corta aunque se siga hablando, y lo largo va en trozos de 15 s como mucho', async () => {
    serveTranscriber();
    mic.decoded = sound([30, 0.3]);
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.3;
    await advance(29_900);
    expect(result.current.listening).toBe(true);
    await advance(200);
    expect(recorders[0]!.state).toBe('inactive');
    await waitFor(() => expect(onPhrase).toHaveBeenCalledTimes(1));
    // Una sola orden, con el texto de todos los trozos seguido.
    expect(onPhrase).toHaveBeenCalledWith('Pon el título arriba y más grande');
    expect(sent[0]!.meta.chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of sent[0]!.meta.chunks) expect(chunk.seconds).toBeLessThanOrEqual(15);
  });

  it('el tope también salta sin fotogramas (pestaña en segundo plano)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    serveTranscriber();
    const { result } = setup({ maxMs: 5000 });
    await startRecording(result);
    expect(recorders[0]!.state).toBe('recording');
    // No pasa ningún fotograma: solo el reloj.
    await act(async () => {
      vi.advanceTimersByTime(4900);
    });
    expect(recorders[0]!.state).toBe('recording');
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(recorders[0]!.state).toBe('inactive');
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
  });

  it('respeta el silencio y el umbral que se le pidan', async () => {
    serveTranscriber();
    const { result, onPhrase } = setup({ silenceMs: 500, voiceThreshold: 0.1 });
    await startRecording(result);
    // Por debajo del umbral pedido no cuenta como voz.
    mic.level = 0.05;
    await advance(1000);
    mic.level = 0.2;
    await advance(300);
    mic.level = 0.05;
    await advance(400);
    expect(result.current.listening).toBe(true);
    await advance(200);
    expect(result.current.listening).toBe(false);
    await waitFor(() => expect(onPhrase).toHaveBeenCalledTimes(1));
  });
});

describe('dictado grabado: errores', () => {
  it('micrófono denegado: lo dice en llano y no revienta', async () => {
    permission = 'denied';
    serveTranscriber();
    const { result, onPhrase } = setup();
    await startRecording(result);
    await waitFor(() =>
      expect(result.current.error).toBe('No hay permiso para usar el micrófono: puedes escribir la orden.'),
    );
    expect(result.current).toMatchObject({ listening: false, busy: false, level: 0 });
    expect(recorders).toHaveLength(0);
    expect(onPhrase).not.toHaveBeenCalled();

    // Si después se da el permiso, vuelve a funcionar y el error se borra.
    permission = 'granted';
    await startRecording(result);
    expect(result.current.error).toBeNull();
    expect(result.current.listening).toBe(true);
  });

  it('sin micrófono lo dice', async () => {
    permission = 'missing';
    const { result } = setup();
    await startRecording(result);
    await waitFor(() => expect(result.current.error).toBe(RECORDING_MESSAGES.noMicrophone));
    expect(microphoneErrorMessage(new Error('otro'))).toBe(RECORDING_MESSAGES.microphoneFailed);
  });

  it('sin MediaRecorder no hay grabación: `recordingAvailable()` es falso y `start()` lo explica', async () => {
    expect(recordingAvailable()).toBe(true);
    delete (window as unknown as Record<string, unknown>).MediaRecorder;
    expect(recordingAvailable()).toBe(false);
    const { result } = setup();
    await startRecording(result);
    expect(result.current.error).toBe('Este navegador no puede grabar audio: puedes escribir la orden.');
    expect(result.current.listening).toBe(false);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('en una página sin micrófono disponible (sin `mediaDevices`) tampoco', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    expect(recordingAvailable()).toBe(false);
  });

  it('cupo agotado: el mensaje de siempre de la IA, y el error para `AiErrorNotice`', async () => {
    serveTranscriber({ status: 402, body: { error: { code: 'quota_exhausted', message: 'x', retryable: false } } });
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.2;
    await advance(500);
    mic.level = 0;
    await advance(1600);
    await waitFor(() => expect(result.current.error).toBe(aiErrorMessage('quota_exhausted')));
    expect(result.current.aiError?.code).toBe('quota_exhausted');
    expect(result.current).toMatchObject({ busy: false, interim: '' });
    expect(onPhrase).not.toHaveBeenCalled();
  });

  it('IA sin configurar y fallo de red: mensajes en español', async () => {
    serveTranscriber({ status: 503, body: { error: { code: 'not_configured', message: 'x' } } });
    const first = setup();
    await startRecording(first.result);
    mic.level = 0.2;
    await advance(500);
    await act(async () => {
      first.result.current.stop();
      await Promise.resolve();
    });
    await waitFor(() => expect(first.result.current.error).toBe(aiErrorMessage('not_configured')));
    first.unmount();

    fake.fn('ai-transcribe', () => {
      throw new TypeError('Failed to fetch');
    });
    const second = setup();
    await startRecording(second.result);
    await advance(500);
    await act(async () => {
      second.result.current.stop();
      await Promise.resolve();
    });
    await waitFor(() => expect(second.result.current.error).toBe(aiErrorMessage('network')));
    expect(second.result.current.aiError?.code).toBe('network');
  });

  it('si el navegador no sabe leer lo que él mismo ha grabado, lo dice y no envía', async () => {
    serveTranscriber();
    mic.decodeFails = true;
    const { result } = setup();
    await startRecording(result);
    mic.level = 0.2;
    await advance(500);
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.error).toBe(RECORDING_MESSAGES.unreadable));
    expect(result.current.busy).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('si el transcriptor no entiende nada, no inventa una orden', async () => {
    serveTranscriber({ status: 200, body: { segments: [{ index: 0, text: '  ' }] } });
    const { result, onPhrase } = setup();
    await startRecording(result);
    mic.level = 0.2;
    await advance(500);
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.error).toBe(RECORDING_MESSAGES.nothingUnderstood));
    expect(onPhrase).not.toHaveBeenCalled();
  });

  it('si el grabador falla a media grabación, suelta el micrófono y lo dice', async () => {
    serveTranscriber();
    const { result } = setup();
    await startRecording(result);
    await act(async () => {
      recorders[0]!.state = 'inactive';
      recorders[0]!.onerror?.(new Event('error'));
      await Promise.resolve();
    });
    expect(result.current.error).toBe(RECORDING_MESSAGES.recorderFailed);
    expect(result.current.listening).toBe(false);
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe('dictado grabado: el micrófono se suelta siempre', () => {
  it('al cerrar el copiloto a media grabación: se suelta y no se envía nada', async () => {
    serveTranscriber();
    const { result, onPhrase, unmount } = setup();
    await startRecording(result);
    mic.level = 0.3;
    await advance(800);
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(recorders[0]!.state).toBe('inactive');
    expect(contexts.every((context) => context.closed)).toBe(true);
    expect(sent).toHaveLength(0);
    expect(onPhrase).not.toHaveBeenCalled();
  });

  it('si se cierra mientras el navegador pregunta por el permiso, el micrófono se suelta en cuanto llega', async () => {
    permission = 'pending';
    const { result, unmount } = setup();
    await startRecording(result);
    expect(result.current.listening).toBe(false);
    unmount();
    await act(async () => {
      grant?.(streams[0]!);
      await Promise.resolve();
    });
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(recorders).toHaveLength(0);
  });

  it('pulsar «Parar» mientras se pide el permiso no deja nada grabando', async () => {
    permission = 'pending';
    const { result } = setup();
    await startRecording(result);
    await act(async () => {
      result.current.stop();
      grant?.(streams[0]!);
      await Promise.resolve();
    });
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
    expect(recorders).toHaveLength(0);
    expect(result.current).toMatchObject({ listening: false, error: null });
  });

  it('dos pulsaciones seguidas no abren dos micrófonos', async () => {
    const { result } = setup();
    await act(async () => {
      result.current.start();
      result.current.start();
      await Promise.resolve();
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(1);
  });
});

describe('piezas sueltas', () => {
  it('elige el primer tipo de grabación admitido, o deja elegir al navegador', () => {
    expect(pickRecordingMimeType((type) => type.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickRecordingMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecordingMimeType(() => false)).toBe('');
    expect(pickRecordingMimeType()).toBe('audio/webm');
  });

  it('el nivel que se pinta va de 0 a 1', () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(Number.NaN)).toBe(0);
    expect(levelOf(0.1)).toBeGreaterThan(0.4);
    expect(levelOf(0.1)).toBeLessThan(0.7);
    expect(levelOf(5)).toBe(1);
  });

  it('el medidor es accesible y dice lo que oye', () => {
    const { rerender } = render(<MicLevel level={0.5} />);
    const meter = screen.getByTestId('copilot-mic-level');
    expect(meter).toHaveAttribute('role', 'meter');
    expect(meter).toHaveAccessibleName('Nivel del micrófono');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuenow', '50');
    expect(meter).toHaveAttribute('aria-valuetext', 'Sonido normal');
    rerender(<MicLevel level={0} />);
    expect(meter).toHaveAttribute('aria-valuetext', 'Sin sonido');
    rerender(<MicLevel level={7} />);
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    rerender(<MicLevel level={0.9} active={false} />);
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    expect(meter).toHaveAttribute('aria-valuetext', 'Micrófono apagado');
  });
});

describe('¿está el transcriptor configurado en el servidor?', () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const serve = (reelSubtitles: boolean) =>
    fake.fn('platform-integrations', () => ({ status: 200, body: { ...ALL_AVAILABLE, reelSubtitles } }));

  it('sí, cuando el despliegue tiene copiloto por voz y el servidor dice que hay transcripción', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    vi.stubEnv('VITE_AI_VOICE_COPILOT_ENABLED', 'true');
    serve(true);
    const { result } = renderHook(() => useTranscriberConfigured(), { wrapper });
    // Mientras el servidor no contesta, no.
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('no, si el servidor no tiene la transcripción configurada o no contesta', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    vi.stubEnv('VITE_AI_VOICE_COPILOT_ENABLED', 'true');
    serve(false);
    const off = renderHook(() => useTranscriberConfigured(), { wrapper });
    await waitFor(() => expect(fake.calls.some((call) => call.name === 'platform-integrations')).toBe(true));
    expect(off.result.current).toBe(false);

    fake.fn('platform-integrations', () => ({ status: 500, body: { error: { message: 'caído' } } }));
    const down = renderHook(() => useTranscriberConfigured(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(down.result.current).toBe(false);
  });

  it('no, y ni pregunta, si este despliegue no tiene copiloto por voz', async () => {
    vi.stubEnv('VITE_AI_TEXT_ENABLED', 'true');
    vi.stubEnv('VITE_AI_VOICE_COPILOT_ENABLED', '');
    serve(true);
    const { result } = renderHook(() => useTranscriberConfigured(), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
    expect(fake.calls.some((call) => call.name === 'platform-integrations')).toBe(false);
  });
});
