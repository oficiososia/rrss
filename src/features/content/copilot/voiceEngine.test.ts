// Motor de voz del copiloto: cuál toca, la preferencia guardada y el aviso de cada uno.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultVoiceEngine,
  hideVoiceNotice,
  readVoiceEngine,
  resolveVoiceEngine,
  VOICE_ENGINE_KEY,
  VOICE_NOTICE_KEYS,
  voiceEngineAvailable,
  voiceEngineHint,
  voiceEngineLabel,
  voiceNoticeHidden,
  voiceNoticeText,
  writeVoiceEngine,
} from './voiceEngine';

const BOTH = { transcriberAvailable: true, browserAvailable: true };
const ONLY_BROWSER = { transcriberAvailable: false, browserAvailable: true };
const ONLY_TRANSCRIBER = { transcriberAvailable: true, browserAvailable: false };
const NONE = { transcriberAvailable: false, browserAvailable: false };

describe('motor de voz', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('por defecto, el transcriptor si se puede usar; si no, el dictado del navegador', () => {
    expect(defaultVoiceEngine(BOTH)).toBe('transcriber');
    expect(defaultVoiceEngine(ONLY_TRANSCRIBER)).toBe('transcriber');
    expect(defaultVoiceEngine(ONLY_BROWSER)).toBe('browser');
    expect(defaultVoiceEngine(NONE)).toBe('browser');
    expect(voiceEngineAvailable('transcriber', ONLY_BROWSER)).toBe(false);
    expect(voiceEngineAvailable('browser', ONLY_BROWSER)).toBe(true);
  });

  it('respeta la preferencia de la persona solo si ese motor se puede usar aquí', () => {
    expect(readVoiceEngine()).toBeNull();
    expect(resolveVoiceEngine(BOTH)).toBe('transcriber');
    writeVoiceEngine('browser');
    expect(window.localStorage.getItem(VOICE_ENGINE_KEY)).toBe('"browser"');
    expect(readVoiceEngine()).toBe('browser');
    expect(resolveVoiceEngine(BOTH)).toBe('browser');
    // Prefiere el navegador, pero este no tiene dictado: transcriptor.
    expect(resolveVoiceEngine(ONLY_TRANSCRIBER)).toBe('transcriber');
    writeVoiceEngine('transcriber');
    // Prefiere el transcriptor, pero el servidor no lo tiene: navegador.
    expect(resolveVoiceEngine(ONLY_BROWSER)).toBe('browser');
    // Sin ninguno no hay motor: el copiloto no puede escuchar.
    expect(resolveVoiceEngine(NONE)).toBeNull();
    // Se puede pasar la preferencia a mano (sin leer el almacenamiento).
    expect(resolveVoiceEngine(BOTH, 'browser')).toBe('browser');
    expect(resolveVoiceEngine(BOTH, null)).toBe('transcriber');
  });

  it('una preferencia guardada que no es un motor conocido se ignora', () => {
    window.localStorage.setItem(VOICE_ENGINE_KEY, '"whisper"');
    expect(readVoiceEngine()).toBeNull();
    window.localStorage.setItem(VOICE_ENGINE_KEY, 'no es json');
    expect(readVoiceEngine()).toBeNull();
    expect(resolveVoiceEngine(BOTH)).toBe('transcriber');
  });

  it('el aviso del navegador, en una línea: quién pasa el audio a texto y qué no dictar', () => {
    const text = voiceNoticeText('browser');
    expect(text).toContain('servicio de voz de tu navegador');
    expect(text).toContain('Google');
    expect(text).toContain('Microsoft');
    expect(text).toContain('No dictes datos de otras personas');
    expect(text).not.toContain('OpenAI');
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it('el aviso del transcriptor, en una línea: va a OpenAI y cuenta para el cupo', () => {
    const text = voiceNoticeText('transcriber');
    expect(text).toContain('OpenAI');
    expect(text).toContain('cada dictado cuenta para el cupo');
    expect(text).toContain('No dictes datos de otras personas');
    expect(text).not.toContain('Google');
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it('el aviso leído es de cada motor', () => {
    expect(VOICE_NOTICE_KEYS.browser).toBe('rrss.voiceNoticeHidden');
    expect(VOICE_NOTICE_KEYS.transcriber).not.toBe(VOICE_NOTICE_KEYS.browser);
    expect(voiceNoticeHidden('browser')).toBe(false);
    expect(voiceNoticeHidden('transcriber')).toBe(false);
    hideVoiceNotice('browser');
    expect(voiceNoticeHidden('browser')).toBe(true);
    expect(voiceNoticeHidden('transcriber')).toBe(false);
    hideVoiceNotice('transcriber');
    expect(voiceNoticeHidden('transcriber')).toBe(true);
    // La clave del navegador es la de siempre: quien ya lo ocultó no lo vuelve a ver.
    expect(window.localStorage.getItem('rrss.voiceNoticeHidden')).toBe('true');
  });

  it('cada motor tiene su nombre y su explicación', () => {
    expect(voiceEngineLabel('browser')).toBe('Dictado del navegador');
    expect(voiceEngineLabel('transcriber')).toBe('Transcriptor (OpenAI)');
    expect(voiceEngineHint('transcriber')).toContain('cupo de IA');
    expect(voiceEngineHint('browser')).toContain('No cuenta');
  });
});
