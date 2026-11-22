import { useCallback, useEffect, useRef, useState } from 'react';
import { AiRequestError, toAiError } from '@/features/ai/api';
import type { Dictation } from './speech';
import { DICTATION_SAMPLE_RATE, transcribeDictation, trimSilence, type DictationRequest } from './transcriber';

// Segundo motor de voz del copiloto: «pulsar para hablar». Graba el micrófono
// en el navegador (MediaRecorder), enseña el nivel de lo que oye, termina solo
// tras un silencio (o al pulsar «Parar», o al llegar al tope) y manda lo grabado
// a la función `ai-transcribe`, que lo pasa a texto con el transcriptor de
// OpenAI. Una grabación = una orden. Tiene la misma forma que `useDictation`
// (speech.ts) para que el copiloto use uno u otro (docs/copiloto-voz.md).
//
// El audio solo existe en memoria mientras se graba y se envía: no se guarda en
// el dispositivo. El micrófono se suelta siempre: al parar, al fallar y al
// cerrar el copiloto.

/** Tipos de grabación, por orden de preferencia (el primero que admita el navegador). */
export const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

/** Silencio, después de haber oído voz, con el que se da la orden por terminada. */
export const DEFAULT_SILENCE_MS = 1500;
/** Tope de una grabación. `ai-transcribe` admite 120 s por petición; una orden no necesita tanto. */
export const DEFAULT_MAX_MS = 30_000;
/** Si en este tiempo no se ha oído nada, se deja de grabar (y no se envía nada). */
export const DEFAULT_IDLE_MS = 8000;
/** Nivel (RMS, de 0 a 1) a partir del cual se considera que hay voz. */
export const DEFAULT_VOICE_THRESHOLD = 0.02;
/** Voz acumulada mínima para dar por oído algo (un chasquido no cuenta). */
const MIN_VOICE_MS = 150;
/** Lo que se espera a que el grabador entregue lo grabado después de pararlo. */
const STOP_GRACE_MS = 2000;
/** Una grabación comprimida de 30 s no llega ni a 1 MB: más que esto es que algo va mal. */
const MAX_RECORDING_BYTES = 5_000_000;

export const RECORDING_MESSAGES = {
  denied: 'No hay permiso para usar el micrófono: puedes escribir la orden.',
  unsupported: 'Este navegador no puede grabar audio: puedes escribir la orden.',
  noMicrophone: 'No se encuentra ningún micrófono: puedes escribir la orden.',
  microphoneFailed: 'No se ha podido abrir el micrófono. Comprueba que no lo esté usando otra aplicación.',
  recorderFailed: 'La grabación se ha cortado. Vuelve a pulsar para hablar.',
  silence: 'No se ha oído nada. Comprueba el micrófono y vuelve a pulsar para hablar.',
  unreadable: 'No se ha podido leer lo grabado en este navegador. Prueba otra vez o escribe la orden.',
  nothingUnderstood: 'No se ha entendido nada. Vuelve a pulsar y dilo otra vez.',
  transcribing: 'Transcribiendo…',
} as const;

// ── Lo mínimo del navegador que se usa (simulable en las pruebas) ─────────

export interface StreamLike {
  getTracks(): Array<{ stop(): void }>;
}

/** Lo mínimo de `MediaRecorder`. */
export interface RecorderLike {
  state: string;
  mimeType?: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(): void;
  stop(): void;
}

/** Medidor del nivel del micrófono (AnalyserNode). */
export interface MicMeter {
  /** Nivel de ahora mismo (RMS, de 0 a 1). */
  read(): number;
  close(): void;
}

/** Todo lo que el dictado grabado toma del navegador y del servidor. */
export interface RecordingDeps {
  /** ¿Puede grabar este navegador? */
  available(): boolean;
  /** Pide el micrófono. Rechaza con el error del navegador (`NotAllowedError`…). */
  getUserMedia(): Promise<StreamLike>;
  createRecorder(stream: StreamLike): RecorderLike;
  createMeter(stream: StreamLike): MicMeter;
  /** Lo grabado → muestras en 16 kHz mono. */
  decode(blob: Blob): Promise<Float32Array>;
  /** Muestras → texto (la función `ai-transcribe`). */
  transcribe(request: DictationRequest): Promise<string>;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  now(): number;
}

type RecorderCtor = (new (stream: MediaStream, options?: { mimeType?: string }) => RecorderLike) & {
  isTypeSupported?: (type: string) => boolean;
};
type AudioContextCtor = new () => AudioContext;

function recorderCtor(): RecorderCtor | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { MediaRecorder?: RecorderCtor }).MediaRecorder ?? null;
}

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function offlineContextCtor(): typeof OfflineAudioContext | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ?? null;
}

/**
 * ¿Puede este navegador grabar y preparar el audio? Hace falta micrófono
 * (`getUserMedia`, solo en páginas seguras), `MediaRecorder` y Web Audio (para
 * el nivel y para pasar lo grabado a WAV).
 */
export function recordingAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    recorderCtor() !== null &&
    audioContextCtor() !== null &&
    offlineContextCtor() !== null
  );
}

/** El primer tipo de grabación que admite el navegador, o '' para dejarle elegir. */
export function pickRecordingMimeType(isSupported?: (type: string) => boolean): string {
  const supported = isSupported ?? ((type: string) => recorderCtor()?.isTypeSupported?.(type) === true);
  return RECORDING_MIME_TYPES.find((type) => supported(type)) ?? '';
}

function browserMeter(stream: StreamLike): MicMeter {
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error('Sin Web Audio');
  const context = new Ctor();
  // Creado tras un await: algún navegador lo deja en pausa hasta que se le pide seguir.
  void context.resume?.().catch(() => undefined);
  const source = context.createMediaStreamSource(stream as unknown as MediaStream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) sum += buffer[i]! * buffer[i]!;
      return Math.sqrt(sum / buffer.length);
    },
    close() {
      try {
        source.disconnect();
      } catch {
        // ya estaba suelto
      }
      void context.close().catch(() => undefined);
    },
  };
}

/** Lo grabado (webm, mp4, ogg…) → muestras en 16 kHz mono, con Web Audio. */
async function browserDecode(blob: Blob): Promise<Float32Array> {
  const Ctor = audioContextCtor();
  const Offline = offlineContextCtor();
  if (!Ctor || !Offline) throw new Error('Sin Web Audio');
  const data = await blob.arrayBuffer();
  const context = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(data);
  } finally {
    void context.close().catch(() => undefined);
  }
  const length = Math.round(decoded.duration * DICTATION_SAMPLE_RATE);
  if (length <= 0) return new Float32Array(0);
  const offline = new Offline(1, length, DICTATION_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

const BROWSER_DEPS: RecordingDeps = {
  available: recordingAvailable,
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createRecorder(stream) {
    const Ctor = recorderCtor();
    if (!Ctor) throw new Error('Sin MediaRecorder');
    const mimeType = pickRecordingMimeType();
    return mimeType
      ? new Ctor(stream as unknown as MediaStream, { mimeType })
      : new Ctor(stream as unknown as MediaStream);
  },
  createMeter: browserMeter,
  decode: browserDecode,
  transcribe: transcribeDictation,
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** Por qué no se ha podido abrir el micrófono, en español llano. */
export function microphoneErrorMessage(error: unknown): string {
  const name = typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return RECORDING_MESSAGES.denied;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return RECORDING_MESSAGES.noMicrophone;
  }
  return RECORDING_MESSAGES.microphoneFailed;
}

/** Nivel para pintar (0–1) a partir del RMS: la voz normal queda hacia la mitad del medidor. */
export function levelOf(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, Math.sqrt(rms / 0.35));
}

// ── Hook ──────────────────────────────────────────────────────────────────

export interface RecordedDictationOptions {
  /** Marca en la que se dicta: el cupo de IA y el permiso son los suyos. */
  brandId: string;
  /** Vocabulario de pista: nombres de capas, de la marca, de platos de la biblioteca… */
  hints?: readonly string[];
  /** Idioma que se habla (ISO 639-1). Por defecto, español. */
  language?: string;
  /** Silencio tras la voz con el que se termina (ms). Por defecto, 1500. */
  silenceMs?: number;
  /** Tope de la grabación (ms). Por defecto, 30 000. */
  maxMs?: number;
  /** Tiempo sin oír nada tras el que se deja de grabar (ms). Por defecto, 8000. */
  idleMs?: number;
  /** Nivel (RMS, 0–1) a partir del cual hay voz. Por defecto, 0,02. */
  voiceThreshold?: number;
  /** Para las pruebas: sustituye lo que se toma del navegador o del servidor. */
  deps?: Partial<RecordingDeps>;
}

export interface RecordedDictation extends Dictation {
  /** Nivel del micrófono mientras se graba, de 0 a 1 (para el medidor). */
  level: number;
  /** Se está transcribiendo lo grabado (no se puede volver a grabar todavía). */
  busy: boolean;
  /** El fallo de la IA, si lo hubo (cupo, sin configurar, red…), para `AiErrorNotice`. */
  aiError: AiRequestError | null;
  /** Deja de grabar y tira lo grabado, sin enviarlo. */
  cancel(): void;
}

interface Session {
  stream: StreamLike | null;
  recorder: RecorderLike | null;
  meter: MicMeter | null;
  frame: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  chunks: Blob[];
  startedAt: number;
  lastFrameAt: number;
  lastVoiceAt: number;
  voicedMs: number;
  heardVoice: boolean;
  /** El navegador ya ha dado el micrófono (antes de eso no hay nada que parar). */
  opened: boolean;
  /** Ya se ha pedido terminar. */
  ending: boolean;
  /** Ya se ha recogido lo grabado. */
  finished: boolean;
  /** Tirar lo grabado (cancelado o copiloto cerrado). */
  discard: boolean;
}

/**
 * Dictado grabado, de «pulsar para hablar»: `start()` pide el micrófono y graba;
 * termina solo tras un silencio, al llegar al tope o con `stop()`; entonces
 * transcribe y llama a `onPhrase` con el texto (una orden por grabación). Si no
 * se oyó nada, no se envía nada.
 */
export function useRecordedDictation(
  onPhrase: (text: string) => void,
  options: RecordedDictationOptions,
): RecordedDictation {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<AiRequestError | null>(null);
  const [level, setLevel] = useState(0);

  const phrase = useRef(onPhrase);
  const latest = useRef(options);
  useEffect(() => {
    phrase.current = onPhrase;
    latest.current = options;
  });
  const current = useRef<Session | null>(null);
  const transcribing = useRef(false);
  const mounted = useRef(true);
  const shownLevel = useRef(0);

  const deps = (): RecordingDeps => ({ ...BROWSER_DEPS, ...latest.current.deps });

  /** Suelta el micrófono y el medidor. Se puede llamar más de una vez. */
  const release = (session: Session) => {
    if (session.frame !== null) deps().cancelFrame(session.frame);
    session.frame = null;
    if (session.timer !== null) clearTimeout(session.timer);
    session.timer = null;
    session.meter?.close();
    session.meter = null;
    for (const track of session.stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        // ya estaba parada
      }
    }
    session.stream = null;
  };

  const showLevel = (value: number) => {
    // De veinteavo en veinteavo: el medidor no necesita más y así no se repinta en cada fotograma.
    const stepped = Math.round(value * 20) / 20;
    if (stepped === shownLevel.current) return;
    shownLevel.current = stepped;
    if (mounted.current) setLevel(stepped);
  };

  /** Recoge lo grabado: si hubo voz, lo transcribe y entrega el texto. */
  const finish = async (session: Session) => {
    if (session.finished) return;
    session.finished = true;
    release(session);
    if (current.current === session) current.current = null;
    if (session.discard || !mounted.current) return;
    if (!session.heardVoice) {
      setError(RECORDING_MESSAGES.silence);
      return;
    }
    const type = session.recorder?.mimeType || session.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(session.chunks, { type });
    session.chunks = [];
    if (blob.size === 0 || blob.size > MAX_RECORDING_BYTES) {
      setError(blob.size === 0 ? RECORDING_MESSAGES.recorderFailed : RECORDING_MESSAGES.unreadable);
      return;
    }
    transcribing.current = true;
    setBusy(true);
    setInterim(RECORDING_MESSAGES.transcribing);
    try {
      let samples: Float32Array;
      try {
        samples = trimSilence(await deps().decode(blob), DICTATION_SAMPLE_RATE);
      } catch {
        if (mounted.current) setError(RECORDING_MESSAGES.unreadable);
        return;
      }
      // Segunda comprobación, ya con el sonido delante: si es todo silencio, no se envía.
      if (samples.length === 0) {
        if (mounted.current) setError(RECORDING_MESSAGES.silence);
        return;
      }
      const { brandId, hints, language } = latest.current;
      const text = (await deps().transcribe({ brandId, samples, hints, language })).trim();
      if (!mounted.current) return;
      if (text) phrase.current(text);
      else setError(RECORDING_MESSAGES.nothingUnderstood);
    } catch (failure) {
      const ai = await toAiError(failure);
      if (!mounted.current) return;
      setAiError(ai);
      setError(ai.message);
    } finally {
      transcribing.current = false;
      if (mounted.current) {
        setBusy(false);
        setInterim('');
      }
    }
  };

  /** Deja de grabar. Lo grabado llega en `onstop` del grabador (y de ahí, a `finish`). */
  const end = (session: Session) => {
    if (session.ending) return;
    session.ending = true;
    const recorder = session.recorder;
    let stopping = false;
    try {
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
        stopping = true;
      }
    } catch {
      stopping = false;
    }
    // El micrófono se suelta ya, sin esperar a que el grabador entregue lo grabado.
    release(session);
    shownLevel.current = 0;
    if (mounted.current) {
      setListening(false);
      setLevel(0);
    }
    if (!stopping) void finish(session);
    // Si el grabador no avisa de que ha parado, no se queda esperando para siempre.
    else session.timer = setTimeout(() => void finish(session), STOP_GRACE_MS);
  };

  const open = async (session: Session) => {
    const d = deps();
    let stream: StreamLike;
    try {
      stream = await d.getUserMedia();
    } catch (failure) {
      if (current.current === session) {
        current.current = null;
        if (mounted.current) setError(microphoneErrorMessage(failure));
      }
      return;
    }
    // Mientras se pedía el permiso se ha parado o se ha cerrado el copiloto: se suelta sin grabar.
    if (current.current !== session || session.ending) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    session.stream = stream;
    session.opened = true;
    try {
      session.meter = d.createMeter(stream);
      const recorder = d.createRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) session.chunks.push(event.data);
      };
      recorder.onstop = () => void finish(session);
      recorder.onerror = () => {
        session.discard = true;
        end(session);
        if (mounted.current) setError(RECORDING_MESSAGES.recorderFailed);
      };
      session.recorder = recorder;
      recorder.start();
    } catch {
      session.discard = true;
      end(session);
      if (mounted.current) setError(RECORDING_MESSAGES.unsupported);
      return;
    }

    const config = latest.current;
    const silenceMs = config.silenceMs ?? DEFAULT_SILENCE_MS;
    const maxMs = config.maxMs ?? DEFAULT_MAX_MS;
    const idleMs = config.idleMs ?? DEFAULT_IDLE_MS;
    const threshold = config.voiceThreshold ?? DEFAULT_VOICE_THRESHOLD;
    session.startedAt = d.now();
    session.lastFrameAt = session.startedAt;
    // El tope no depende de los fotogramas: con la pestaña en segundo plano no los hay.
    session.timer = setTimeout(() => end(session), maxMs);
    setListening(true);

    const tick = () => {
      session.frame = null;
      if (current.current !== session || session.ending || !session.meter) return;
      const now = d.now();
      const rms = session.meter.read();
      const elapsed = Math.min(100, Math.max(0, now - session.lastFrameAt));
      session.lastFrameAt = now;
      if (rms >= threshold) {
        session.voicedMs += elapsed;
        session.lastVoiceAt = now;
        if (session.voicedMs >= MIN_VOICE_MS) session.heardVoice = true;
      }
      showLevel(levelOf(rms));
      const sinceStart = now - session.startedAt;
      const silent = session.heardVoice && now - session.lastVoiceAt >= silenceMs;
      const idle = !session.heardVoice && sinceStart >= idleMs;
      if (sinceStart >= maxMs || silent || idle) {
        end(session);
        return;
      }
      session.frame = d.requestFrame(tick);
    };
    session.frame = d.requestFrame(tick);
  };

  const start = useCallback(() => {
    // Ya se está grabando (o pidiendo permiso) o transcribiendo: una orden cada vez.
    if (current.current || transcribing.current) return;
    setError(null);
    setAiError(null);
    if (!deps().available()) {
      setError(RECORDING_MESSAGES.unsupported);
      return;
    }
    const session: Session = {
      stream: null,
      recorder: null,
      meter: null,
      frame: null,
      timer: null,
      chunks: [],
      startedAt: 0,
      lastFrameAt: 0,
      lastVoiceAt: 0,
      voicedMs: 0,
      heardVoice: false,
      opened: false,
      ending: false,
      finished: false,
      discard: false,
    };
    current.current = session;
    void open(session);
    // Todo lo que usa se lee de referencias: no cambia entre pintados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const halt = (discard: boolean) => {
    const session = current.current;
    if (!session) return;
    if (discard) session.discard = true;
    if (!session.opened) {
      // Aún se estaba pidiendo el micrófono: no hay nada grabado.
      session.ending = true;
      current.current = null;
      setListening(false);
      return;
    }
    end(session);
  };

  const stop = useCallback(() => {
    halt(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(() => {
    halt(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cerrar el copiloto se suelta el micrófono y no se envía nada.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const session = current.current;
      if (!session) return;
      session.discard = true;
      if (!session.opened) {
        session.ending = true;
        current.current = null;
      } else {
        end(session);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { listening, interim, error, start, stop, level, busy, aiError, cancel };
}
