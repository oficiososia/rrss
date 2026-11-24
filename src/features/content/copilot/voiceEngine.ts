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
 * Aviso previo ya leído, uno por motor: el audio no va al mismo sitio, así que
 * haber leído uno no vale para el otro. La del navegador es la que ya existía.
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

// Una línea (simplificación aceptada, K2): adónde va el audio y qué no dictar. El detalle, en la
// política de privacidad, que el componente enlaza al lado («Más»).
const NOTICE: Record<VoiceEngine, string> = {
  browser: 'Lo pasa a texto el servicio de voz de tu navegador (Google o Microsoft). No dictes datos de otras personas.',
  transcriber: 'Lo que dictes va a OpenAI para pasarlo a texto y cada dictado cuenta para el cupo. No dictes datos de otras personas.',
};

/**
 * Aviso previo al primer dictado con cada motor: sale una vez y, al aceptarlo, no
 * vuelve. El enlace a la política de privacidad lo pone el componente al lado.
 */
export function voiceNoticeText(engine: VoiceEngine): string {
  return NOTICE[engine];
}

/** ¿Ha leído ya la persona el aviso de este motor (en este navegador)? */
export function voiceNoticeHidden(engine: VoiceEngine): boolean {
  return readLocal<boolean>(VOICE_NOTICE_KEYS[engine], false) === true;
}

export function hideVoiceNotice(engine: VoiceEngine): void {
  writeLocal(VOICE_NOTICE_KEYS[engine], true);
}
