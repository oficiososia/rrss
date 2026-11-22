import { readLocal, writeLocal } from '@/lib/localStore';

// Motor de voz del copiloto: con qué se pasa a texto lo que se dicta.
//
//   · `browser`: el dictado del navegador (Web Speech API, speech.ts). El audio
//     lo procesa el servicio de voz del navegador; la aplicación solo recibe el
//     texto. No cuesta nada y no pasa por el cupo de IA.
//   · `transcriber`: se graba en el dispositivo (recording.ts) y se transcribe
//     en el servidor con el transcriptor de OpenAI (función `ai-transcribe`).
//     Cuenta para el cupo de IA.
//
// Aquí solo está lo que no depende de React ni de la red: la preferencia de la
// persona, cuál toca por defecto y el aviso de privacidad de cada motor.

export type VoiceEngine = 'browser' | 'transcriber';

export const VOICE_ENGINES: readonly VoiceEngine[] = ['transcriber', 'browser'];

/** Preferencia de la persona (en este navegador). */
export const VOICE_ENGINE_KEY = 'rrss.voiceEngine';

/**
 * «No volver a mostrar» del aviso previo, uno por motor: el audio no va al
 * mismo sitio, así que haber leído uno no vale para el otro. La del navegador
 * es la que ya existía.
 */
export const VOICE_NOTICE_KEYS: Record<VoiceEngine, string> = {
  browser: 'rrss.voiceNoticeHidden',
  transcriber: 'rrss.voiceNoticeHidden.transcriber',
};

export interface VoiceEngineAvailability {
  /** El transcriptor está configurado en el servidor Y este navegador puede grabar. */
  transcriberAvailable: boolean;
  /** Este navegador tiene dictado (Web Speech API). */
  browserAvailable: boolean;
}

function isVoiceEngine(value: unknown): value is VoiceEngine {
  return value === 'browser' || value === 'transcriber';
}

/** ¿Se puede usar este motor aquí? */
export function voiceEngineAvailable(engine: VoiceEngine, available: VoiceEngineAvailability): boolean {
  return engine === 'transcriber' ? available.transcriberAvailable : available.browserAvailable;
}

/**
 * Motor por defecto: el transcriptor si se puede usar (entiende mejor los
 * nombres propios y funciona igual en todos los navegadores); si no, el dictado
 * del navegador. Si no hay ninguno, también devuelve `browser`: quien llama
 * debe mirar antes `resolveVoiceEngine`, que en ese caso da `null`.
 */
export function defaultVoiceEngine(available: VoiceEngineAvailability): VoiceEngine {
  return available.transcriberAvailable ? 'transcriber' : 'browser';
}

/** La preferencia guardada, o `null` si no hay (o no es un motor conocido). */
export function readVoiceEngine(): VoiceEngine | null {
  const stored = readLocal<unknown>(VOICE_ENGINE_KEY, null);
  return isVoiceEngine(stored) ? stored : null;
}

export function writeVoiceEngine(engine: VoiceEngine): void {
  writeLocal(VOICE_ENGINE_KEY, engine);
}

/**
 * El motor que toca usar: el preferido si se puede usar aquí; si no, el de por
 * defecto; `null` si no hay ninguno (ni transcriptor ni dictado del navegador).
 */
export function resolveVoiceEngine(
  available: VoiceEngineAvailability,
  preferred: VoiceEngine | null = readVoiceEngine(),
): VoiceEngine | null {
  if (preferred && voiceEngineAvailable(preferred, available)) return preferred;
  const fallback = defaultVoiceEngine(available);
  return voiceEngineAvailable(fallback, available) ? fallback : null;
}

/** Nombre de cada motor en la interfaz. */
export function voiceEngineLabel(engine: VoiceEngine): string {
  return engine === 'transcriber' ? 'Transcriptor (OpenAI)' : 'Dictado del navegador';
}

/** Una línea que explica cada motor, para el selector. */
export function voiceEngineHint(engine: VoiceEngine): string {
  return engine === 'transcriber'
    ? 'Pulsas, hablas y al callarte se transcribe. Cuenta para el cupo de IA.'
    : 'Escucha de seguido y cada frase es una orden. No cuenta para el cupo de IA.';
}

const NOTICE: Record<VoiceEngine, string> = {
  browser:
    'El dictado lo hace el servicio de voz de tu navegador (Google o Microsoft), no esta aplicación: el audio sale de tu dispositivo y aquí solo llega el texto. No dictes datos personales de terceros.',
  transcriber:
    'Lo que dictas se graba en tu dispositivo, va a nuestro servidor y de ahí a OpenAI, que lo pasa a texto (con algunos nombres de la marca y de la pieza como pista). No guardamos el audio; el texto queda en el registro de uso de IA y cada dictado cuenta para el cupo. No dictes datos personales de terceros.',
};

/**
 * Aviso previo al primer dictado: adónde va el audio con cada motor. El enlace
 * a la política de privacidad lo pone el componente al lado.
 */
export function voiceNoticeText(engine: VoiceEngine): string {
  return NOTICE[engine];
}

/** ¿Pidió la persona no volver a ver el aviso de este motor? */
export function voiceNoticeHidden(engine: VoiceEngine): boolean {
  return readLocal<boolean>(VOICE_NOTICE_KEYS[engine], false) === true;
}

export function hideVoiceNotice(engine: VoiceEngine): void {
  writeLocal(VOICE_NOTICE_KEYS[engine], true);
}
