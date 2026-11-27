import { Mic, MicOff } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Textarea } from '@/components/ui';
import { MicLevel } from '@/features/content/copilot/MicLevel';
import { recordingAvailable, useRecordedDictation, type RecordingDeps } from '@/features/content/copilot/recording';
import { speechRecognitionAvailable, useDictation } from '@/features/content/copilot/speech';
import { useTranscriberConfigured } from '@/features/content/copilot/transcriber';
import {
  hideVoiceNotice,
  readVoiceEngine,
  resolveVoiceEngine,
  voiceNoticeHidden,
  voiceNoticeText,
  type VoiceEngine,
} from '@/features/content/copilot/voiceEngine';
import { legalPath } from '@/features/legal/legal';
import { cn } from '@/lib/utils';
import { AiErrorNotice } from './AiErrorNotice';
import { appendDictation } from './dictation';

// «Campo que se puede dictar»: un cuadro de texto de los de siempre con un
// micrófono al lado para contarle algo a la IA hablando. Usa el mismo motor de
// voz y el mismo aviso de privacidad que el copiloto del editor
// (src/features/content/copilot/voiceEngine.ts): el transcriptor de OpenAI si
// el servidor lo tiene, y si no el dictado del navegador. Si el navegador no
// puede dictar de ninguna de las dos formas, no sale el micrófono y el campo
// es exactamente el de siempre: escribir sigue valiendo.
//
// Lo dictado se añade al final de lo que ya hay (nunca lo borra) y la persona
// lo corrige como cualquier texto. Con el transcriptor cada pulsación es un
// dictado (pulsar, hablar, y al callarte se transcribe); con el dictado del
// navegador se escucha de seguido hasta que se vuelve a pulsar.

type Shared = {
  /** Marca en la que se dicta: el cupo de IA y el permiso son los suyos. */
  brandId: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Vocabulario de pista para el transcriptor (nombre de la marca, platos…). */
  hints?: readonly string[];
  /** Prefijo de los `data-testid` del micrófono y del aviso (por defecto, el del campo o «dictable»). */
  voiceTestId?: string;
  /** Solo para pruebas: sustituye lo que se toma del micrófono y del servidor. */
  recordingDeps?: Partial<RecordingDeps>;
};

export type DictableTextareaProps = Shared &
  Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'ref'> & { as?: 'textarea' };
export type DictableInputProps = Shared & Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'ref'> & { as: 'input' };

/**
 * Cuadro de texto (o de una línea con `as="input"`) con micrófono. Sustituye a
 * `<Textarea>` / `<Input>` sin cambiar nada más: mismas propiedades, pero el
 * valor llega con `onValueChange(texto)` en lugar de un evento.
 */
export const DictableField = forwardRef<HTMLTextAreaElement | HTMLInputElement, DictableTextareaProps | DictableInputProps>(
  function DictableField(props, ref) {
    const { brandId, value, onValueChange, hints, voiceTestId, recordingDeps, as, ...control } = props;
    const testId = voiceTestId ?? (control as Record<string, unknown>)['data-testid']?.toString() ?? 'dictable';
    const maxLength = control.maxLength;
    const disabled = Boolean(control.disabled);

    // Lo último de cada cosa, para que una frase que llega tarde no pise lo que se ha escrito después.
    const latest = useRef({ value, onValueChange, maxLength });
    useEffect(() => {
      latest.current = { value, onValueChange, maxLength };
    });
    const onPhrase = useCallback((text: string) => {
      const { value: current, onValueChange: change, maxLength: max } = latest.current;
      change(appendDictation(current, text, max));
    }, []);

    const browser = useDictation(onPhrase);
    const recorded = useRecordedDictation(onPhrase, { brandId, hints, deps: recordingDeps });
    const transcriberConfigured = useTranscriberConfigured();
    const available = useMemo(
      () => ({
        transcriberAvailable: transcriberConfigured && (recordingDeps?.available?.() ?? recordingAvailable()),
        browserAvailable: speechRecognitionAvailable(),
      }),
      [transcriberConfigured, recordingDeps],
    );
    const engine: VoiceEngine | null = resolveVoiceEngine(available, readVoiceEngine());

    // Aviso previo, uno por motor: sin leerlo no se escucha.
    const [seen, setSeen] = useState<Record<VoiceEngine, boolean>>(() => ({
      browser: voiceNoticeHidden('browser'),
      transcriber: voiceNoticeHidden('transcriber'),
    }));
    const [askingNotice, setAskingNotice] = useState(false);
    const [dontShowAgain, setDontShowAgain] = useState(false);

    const dictation = engine === 'transcriber' ? recorded : browser;
    const listening = dictation.listening;
    const busy = engine === 'transcriber' && recorded.busy;

    // Al desmontar o desactivar el campo, el micrófono se suelta.
    const { stop: stopBrowser } = browser;
    const { cancel: cancelRecording } = recorded;
    useEffect(() => {
      if (disabled) {
        stopBrowser();
        cancelRecording();
      }
    }, [disabled, stopBrowser, cancelRecording]);

    function begin() {
      if (engine === 'transcriber') recorded.start();
      else browser.start();
    }

    function toggle() {
      if (!engine) return;
      if (listening) {
        dictation.stop();
        return;
      }
      if (!seen[engine]) {
        setAskingNotice(true);
        return;
      }
      begin();
    }

    const sharedControl = {
      ...control,
      value,
      onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
    };

    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {as === 'input' ? (
              <Input
                {...(sharedControl as ComponentProps<typeof Input>)}
                ref={ref as Ref<HTMLInputElement>}
              />
            ) : (
              <Textarea
                {...(sharedControl as ComponentProps<typeof Textarea>)}
                ref={ref as Ref<HTMLTextAreaElement>}
              />
            )}
          </div>
          {engine && (
            <Button
              type="button"
              size="icon"
              variant={listening ? 'primary' : 'secondary'}
              className={cn('shrink-0', as === 'input' ? 'h-11 w-11' : '')}
              aria-pressed={listening}
              aria-label={
                busy
                  ? 'Transcribiendo lo dictado'
                  : listening
                    ? engine === 'transcriber'
                      ? 'Parar y transcribir'
                      : 'Dejar de dictar'
                    : 'Dictar con el micrófono'
              }
              title={listening ? 'Pulsa para terminar' : 'Pulsa y habla'}
              disabled={disabled || busy}
              onClick={toggle}
              data-testid={`${testId}-mic`}
            >
              {listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
            </Button>
          )}
        </div>

        {engine && askingNotice && !seen[engine] && (
          <div
            className="space-y-2 rounded-lg border border-border bg-subtle p-3 text-sm"
            data-testid={`${testId}-notice`}
          >
            <p>
              {voiceNoticeText(engine)}{' '}
              <Link to={legalPath('privacy')} target="_blank" className="text-primary underline">
                Política de privacidad
              </Link>
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                data-testid={`${testId}-notice-hide`}
              />
              No volver a mostrar este aviso
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (dontShowAgain) hideVoiceNotice(engine);
                  setSeen((current) => ({ ...current, [engine]: true }));
                  setAskingNotice(false);
                  begin();
                }}
                data-testid={`${testId}-notice-ok`}
              >
                <Mic className="h-4 w-4" aria-hidden />
                Entendido, empezar a dictar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAskingNotice(false)}>
                Mejor escribo
              </Button>
            </div>
          </div>
        )}

        {engine && (listening || busy || dictation.interim) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted" aria-live="polite">
            {engine === 'transcriber' && <MicLevel level={recorded.level} active={recorded.listening} />}
            <span data-testid={`${testId}-status`}>
              {busy
                ? 'Transcribiendo…'
                : listening
                  ? engine === 'transcriber'
                    ? 'Te escucho. Al callarte, se transcribe.'
                    : 'Te escucho. Pulsa otra vez para terminar.'
                  : ''}
            </span>
            {dictation.interim && !busy && <span className="italic">{dictation.interim}</span>}
          </div>
        )}
        {engine === 'transcriber' && recorded.aiError ? (
          <AiErrorNotice error={recorded.aiError} />
        ) : (
          engine &&
          dictation.error && (
            <p role="alert" className="text-xs text-danger" data-testid={`${testId}-error`}>
              {dictation.error}
            </p>
          )
        )}
      </div>
    );
  },
);
