import { CheckCircle2, ImagePlus, Loader2, Mic, MicOff, SendHorizontal, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { legalPath } from '@/features/legal/legal';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { requestEditorCopilot, toAiError } from '@/features/ai/api';
import { useAssetsByIds } from '@/features/library/api';
import { pageView, type AspectRatio, type ContentDocument, type PageLimits } from '../document';
import { ImagePickerDialog } from '../editor/AssetPickerDialog';
import { layerLabel } from '../editor/layers';
import {
  applyCopilotOperations,
  backgroundImageOf,
  historyActions,
  needsPhotoPick,
  withPickedPhoto,
  type CopilotAssetInfo,
  type CopilotBrandStyle,
} from './apply';
import { interpretLocally, LOCAL_COMMAND_EXAMPLES } from './localCommands';
import { MicLevel } from './MicLevel';
import {
  keepDictated,
  parseCopilotResponse,
  summarizeDocument,
  type CopilotOperation,
  type CopilotPhotoFlow,
} from './operations';
import { recordingAvailable, useRecordedDictation } from './recording';
import { speechRecognitionAvailable, useDictation } from './speech';
import { useTranscriberConfigured } from './transcriber';
import {
  hideVoiceNotice,
  readVoiceEngine,
  resolveVoiceEngine,
  VOICE_ENGINES,
  VOICE_NOTICE_KEYS,
  voiceEngineAvailable,
  voiceEngineHint,
  voiceEngineLabel,
  voiceNoticeHidden,
  voiceNoticeText,
  writeVoiceEngine,
  type VoiceEngine,
} from './voiceEngine';

/** Clave del «No volver a mostrar» del aviso previo al dictado del navegador. */
export const VOICE_NOTICE_KEY = VOICE_NOTICE_KEYS.browser;

// Copiloto del editor (docs/copiloto-voz.md). La persona da órdenes hablando
// (dictado del navegador o transcriptor) o escribiéndolas; cada una se resuelve
// en el propio navegador si es de las frecuentes («deshaz», «más grande»,
// «siguiente página»: sin IA, al momento y sin coste) y, si no, se manda a la IA
// (`editor.copilot`). Sus operaciones, ya validadas, se aplican al documento
// como un solo paso de deshacer. Las órdenes van de una en una y en el orden en
// que llegan, cada una sobre el documento que dejó la anterior.

type OrderStatus = 'pending' | 'sending' | 'photo' | 'applied' | 'nothing' | 'failed';

interface Order {
  id: number;
  transcript: string;
  status: OrderStatus;
  /** Resuelta en el navegador, sin llamar a la IA. */
  local?: boolean;
  changes?: string[];
  notes?: string[];
  error?: unknown;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'En espera',
  sending: 'Interpretando…',
  photo: 'Elige la foto',
  applied: 'Aplicada',
  nothing: 'Sin cambios',
  failed: 'No aplicada',
};

const FLOW_DONE: Record<CopilotPhotoFlow, string> = {
  remove_background: 'Quitando el fondo de la foto…',
  portrait: 'Abierto el «Modo retrato» de la foto',
  edit: 'Abierto «Editar foto»',
  replace: 'Abierta la biblioteca para cambiar la foto',
};

/**
 * Lo que el copiloto pide al editor que no es cambiar el documento: deshacer y
 * rehacer, cambiar de página, guardar, abrir las plantillas y los flujos de
 * foto que ya existen (quitar el fondo, modo retrato, editar, cambiar la foto).
 */
export interface CopilotHost {
  /** Deshace o rehace un paso. Devuelve cómo queda el documento, o null si no había nada. */
  history(kind: 'undo' | 'redo'): { document: ContentDocument; pageIndex: number } | null;
  goToPage(index: number): void;
  /** Guarda una versión (lo mismo que «Guardar»). */
  save(): void;
  openTemplates(): void;
  /** Abre el flujo para la foto de esa capa. Devuelve por qué no se puede, o null si se ha abierto. */
  photoFlow(flow: CopilotPhotoFlow, layerId: string): string | null;
}

export interface VoiceCopilotProps {
  orgId: string;
  brandId: string;
  /** Nombre de la marca: pista de vocabulario para el transcriptor. */
  brandName?: string;
  document: ContentDocument;
  /** Página activa del editor: el copiloto ve y cambia esa página. */
  pageIndex: number;
  /** Capas elegidas en el editor («esto», «eso»). */
  selectedIds?: readonly string[];
  /** Páginas que admite el formato de la pieza. */
  pageLimits?: PageLimits;
  /** Proporciones que admite la red de la pieza. */
  allowedRatios?: readonly AspectRatio[] | null;
  brand: CopilotBrandStyle;
  logoIds: string[];
  /** Tono medio de las fotos ya analizadas, por id de recurso (para que los textos se lean encima). */
  imageTones?: ReadonlyMap<string, string>;
  /** La foto elegida en el lienzo, si la hay: cuenta como «esta foto». */
  selectedImage: CopilotAssetInfo | null;
  /** Medidas de las fotos del documento, por id de recurso (para recortar a una proporción). */
  documentAssets?: readonly CopilotAssetInfo[];
  libraryPath: string;
  /** Aplica el documento nuevo como un paso de deshacer, deja elegidas las capas tocadas y pasa a esa página. */
  onApply: (document: ContentDocument, touched: string[], pageIndex: number) => void;
  /** Acciones del editor. Sin él (pruebas), esas órdenes se dicen como no disponibles. */
  host?: CopilotHost;
  onClose: () => void;
}

let orderCounter = 0;

export function VoiceCopilot({
  orgId,
  brandId,
  brandName,
  document,
  pageIndex,
  selectedIds,
  pageLimits,
  allowedRatios,
  brand,
  logoIds,
  imageTones,
  selectedImage,
  documentAssets,
  libraryPath,
  onApply,
  host,
  onClose,
}: VoiceCopilotProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [photos, setPhotos] = useState<CopilotAssetInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const logos = useAssetsByIds(brandId, logoIds);

  // Lo último de cada cosa, para las órdenes que se procesan en cola (fuera del ciclo de React).
  const fresh = {
    document,
    pageIndex,
    selectedIds: selectedIds ?? [],
    pageLimits,
    allowedRatios,
    photos,
    selectedImage,
    documentAssets: documentAssets ?? [],
    brand,
    logoIds,
    imageTones,
    logos: logos.data ?? [],
    onApply,
    host,
  };
  const latest = useRef(fresh);
  useEffect(() => {
    latest.current = fresh;
  });
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Quien espera a que la persona elija una foto («esta foto» sin ninguna elegida). */
  const waitingPhoto = useRef<((asset: CopilotAssetInfo | null) => void) | null>(null);

  const update = (id: number, change: Partial<Order>) =>
    setOrders((list) => list.map((order) => (order.id === id ? { ...order, ...change } : order)));

  const askPhoto = () =>
    new Promise<CopilotAssetInfo | null>((resolve) => {
      waitingPhoto.current = resolve;
      setPickerOpen(true);
    });

  /**
   * Ejecuta las operaciones de una orden (vengan de la IA o del intérprete
   * local): primero deshacer y rehacer, después los cambios del documento como
   * UN paso, y al final lo que abre algo del editor (guardar, plantillas, fotos).
   */
  async function execute(order: Order, wanted: CopilotOperation[], notes: string[], chosen: CopilotAssetInfo[]) {
    const changes: string[] = [];
    const skipped: string[] = [];
    let operations = wanted;

    for (const kind of historyActions(operations)) {
      const result = latest.current.host?.history(kind) ?? null;
      if (result) {
        latest.current = { ...latest.current, document: result.document, pageIndex: result.pageIndex };
        changes.push(kind === 'undo' ? 'Deshecho el último cambio' : 'Rehecho el cambio');
      } else {
        skipped.push(kind === 'undo' ? 'No hay nada que deshacer.' : 'No hay nada que rehacer.');
      }
    }

    let photo: CopilotAssetInfo | null = chosen[0] ?? null;
    if (needsPhotoPick(operations) && !photo) {
      update(order.id, { status: 'photo' });
      photo = await askPhoto();
      if (photo) setPhotos((list) => (list.some((p) => p.id === photo!.id) ? list : [...list, photo!]));
      update(order.id, { status: 'sending' });
    }
    operations = withPickedPhoto(operations, photo?.id ?? null);

    const current = latest.current;
    const assets = new Map<string, CopilotAssetInfo>();
    for (const asset of current.documentAssets) assets.set(asset.id, asset);
    for (const logo of current.logos) {
      assets.set(logo.id, { id: logo.id, name: logo.file_name, width: logo.width, height: logo.height });
    }
    for (const asset of [...chosen, ...(photo ? [photo] : [])]) assets.set(asset.id, asset);
    const result = applyCopilotOperations(current.document, operations, {
      brand: current.brand,
      assets,
      logoIds: current.logoIds,
      imageTones: current.imageTones,
      pageIndex: current.pageIndex,
      selectedIds: current.selectedIds,
      pageLimits: current.pageLimits,
      allowedRatios: current.allowedRatios,
    });
    if (!result.ok) {
      update(order.id, {
        status: 'failed',
        notes: ['El diseño resultante no sería válido: no se ha cambiado nada.', ...notes],
      });
      return;
    }
    changes.push(...result.changes);
    skipped.push(...result.skipped);
    if (result.document !== current.document) {
      current.onApply(result.document, result.touched, result.pageIndex);
    } else if (result.pageIndex !== current.pageIndex) {
      current.host?.goToPage(result.pageIndex);
    }
    latest.current = { ...latest.current, document: result.document, pageIndex: result.pageIndex };

    // Lo que abre algo del editor, después de aplicar los cambios.
    const unavailable = 'Eso hay que hacerlo desde el editor.';
    for (const flow of result.flows) {
      const problem = current.host ? current.host.photoFlow(flow.flow, flow.layerId) : unavailable;
      if (problem) skipped.push(problem);
      else changes.push(FLOW_DONE[flow.flow]);
    }
    for (const action of result.after) {
      if (!current.host) skipped.push(unavailable);
      else if (action === 'save') {
        current.host.save();
        changes.push('Guardando una versión…');
      } else {
        current.host.openTemplates();
        changes.push('Abiertas las plantillas');
      }
    }
    update(order.id, {
      status: changes.length > 0 ? 'applied' : 'nothing',
      ...(changes.length > 0 ? { changes } : {}),
      notes: [...notes, ...skipped],
    });
  }

  async function process(order: Order) {
    update(order.id, { status: 'sending' });
    const now = latest.current;
    const view = pageView(now.document, now.pageIndex);
    // «Esta foto»: la elegida en el lienzo y, después, las elegidas para el copiloto.
    const chosen = [...(now.selectedImage ? [now.selectedImage] : []), ...now.photos].filter(
      (asset, index, all) => all.findIndex((a) => a.id === asset.id) === index,
    );
    try {
      // 1. Órdenes frecuentes: se resuelven aquí, sin IA.
      const background = backgroundImageOf(view);
      const local = interpretLocally(order.transcript, {
        layers: view.layers.map((layer) => ({
          id: layer.id,
          type: layer.type,
          ...(layer.locked ? { locked: true } : {}),
          ...(layer.type === 'image' ? { blur: layer.blur ?? 0, background: layer.id === background?.id } : {}),
        })),
        selectedIds: [...now.selectedIds],
        pageIndex: now.pageIndex,
        pageCount: now.document.pages.length,
      });
      if (local) {
        update(order.id, { local: true });
        if (local.kind === 'note') {
          update(order.id, { status: 'nothing', notes: [local.note] });
          return;
        }
        await execute(order, local.operations, local.note ? [local.note] : [], chosen);
        return;
      }

      // 2. El resto, a la IA.
      const raw = await requestEditorCopilot(brandId, {
        transcript: order.transcript,
        document: summarizeDocument(view, {
          selectedIds: now.selectedIds,
          pageIndex: now.pageIndex,
          pageCount: now.document.pages.length,
        }),
        assets: chosen.map((asset) => ({ id: asset.id, name: asset.name })),
      });
      const response = parseCopilotResponse(raw);
      if (!response) {
        update(order.id, { status: 'failed', notes: ['La respuesta de la IA no es válida: no se ha cambiado nada.'] });
        return;
      }
      const dictated = keepDictated(response.operations, order.transcript);
      const notes = [
        ...(response.note ? [response.note] : []),
        ...response.discarded.map((item) => item.reason),
        ...(dictated.removed > 0 ? ['Se ha quitado un texto que no estaba en lo dictado.'] : []),
      ];
      await execute(order, dictated.operations, notes, chosen);
    } catch (error) {
      update(order.id, { status: 'failed', error: await toAiError(error) });
    }
  }

  const onPhrase = useCallback((transcript: string) => {
    const text = transcript.trim();
    if (!text) return;
    orderCounter += 1;
    const order: Order = { id: orderCounter, transcript: text, status: 'pending' };
    setOrders((list) => [...list, order]);
    // Una detrás de otra: cada orden parte del documento que dejó la anterior.
    queue.current = queue.current.then(() => process(order));
    // `process` solo lee lo último a través de `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Voz: dictado del navegador o transcriptor (los dos montados; se usa el elegido) ──
  const hints = useMemo(() => {
    const names = pageView(document, pageIndex).layers.map((layer) => layerLabel(layer));
    return [brandName ?? '', ...names, ...photos.map((photo) => photo.name)].filter(Boolean);
  }, [brandName, document, pageIndex, photos]);
  const browser = useDictation(onPhrase);
  const recorded = useRecordedDictation(onPhrase, { brandId, hints });
  const transcriberConfigured = useTranscriberConfigured();
  const available = useMemo(
    () => ({
      transcriberAvailable: transcriberConfigured && recordingAvailable(),
      browserAvailable: speechRecognitionAvailable(),
    }),
    [transcriberConfigured],
  );
  const [preferred, setPreferred] = useState<VoiceEngine | null>(readVoiceEngine);
  /** Motor en uso; null = este navegador no puede dictar: solo teclado. */
  const engine = resolveVoiceEngine(available, preferred);
  const engines = VOICE_ENGINES.filter((option) => voiceEngineAvailable(option, available));

  // Antes del primer dictado con cada motor se avisa de adónde va el audio; sin avisar no se escucha.
  const [seen, setSeen] = useState<Record<VoiceEngine, boolean>>(() => ({
    browser: voiceNoticeHidden('browser'),
    transcriber: voiceNoticeHidden('transcriber'),
  }));
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const noticeDone = engine === null || seen[engine];

  // El dictado del navegador escucha de seguido: empieza al abrir (leído el aviso)
  // y para al cerrar. Con el transcriptor, cada orden es una pulsación.
  const { start: startBrowser, stop: stopBrowser } = browser;
  useEffect(() => {
    if (engine !== 'browser' || !noticeDone) return;
    startBrowser();
    return () => stopBrowser();
  }, [engine, noticeDone, startBrowser, stopBrowser]);

  function chooseEngine(next: VoiceEngine) {
    browser.stop();
    recorded.cancel();
    writeVoiceEngine(next);
    setPreferred(next);
    setDontShowAgain(false);
  }

  function submitTyped(event: FormEvent) {
    event.preventDefault();
    if (!typed.trim()) return;
    onPhrase(typed);
    setTyped('');
  }

  const lastOrders = useMemo(() => orders.slice(-6).reverse(), [orders]);
  const dictation = engine === 'transcriber' ? recorded : browser;

  function closePicker(asset: CopilotAssetInfo | null) {
    setPickerOpen(false);
    const resolve = waitingPhoto.current;
    waitingPhoto.current = null;
    if (resolve) resolve(asset);
    else if (asset) setPhotos((list) => (list.some((p) => p.id === asset.id) ? list : [...list, asset]));
  }

  return (
    <section
      className="w-full basis-full space-y-3 rounded-xl border border-border bg-surface p-3"
      aria-label="Copiloto del editor"
      data-testid="copilot-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{noticeDone ? 'Copiloto' : 'Antes de dictar'}</h2>
        {noticeDone && engine === 'browser' && (
          <Button
            size="sm"
            variant={browser.listening ? 'primary' : 'secondary'}
            aria-pressed={browser.listening}
            onClick={browser.listening ? browser.stop : browser.start}
            data-testid="copilot-mic"
          >
            {browser.listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
            {browser.listening ? 'Parar' : 'Seguir dictando'}
          </Button>
        )}
        {noticeDone && engine === 'transcriber' && (
          <>
            <Button
              size="sm"
              variant={recorded.listening ? 'primary' : 'secondary'}
              aria-pressed={recorded.listening}
              disabled={recorded.busy}
              onClick={recorded.listening ? recorded.stop : recorded.start}
              data-testid="copilot-mic"
            >
              {recorded.listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
              {recorded.busy ? 'Transcribiendo…' : recorded.listening ? 'Parar y enviar' : 'Pulsar para hablar'}
            </Button>
            <MicLevel level={recorded.level} active={recorded.listening} />
          </>
        )}
        {noticeDone && (
          <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)} data-testid="copilot-pick-photo">
            <ImagePlus className="h-4 w-4" aria-hidden />
            Elegir foto
          </Button>
        )}
        {engines.length > 1 && (
          <label className="flex items-center gap-1 text-xs text-muted">
            Voz
            <select
              className="h-8 rounded-md border border-border bg-surface px-1 text-xs"
              value={engine ?? ''}
              title={engine ? voiceEngineHint(engine) : undefined}
              onChange={(event) => chooseEngine(event.target.value as VoiceEngine)}
              data-testid="copilot-voice-engine"
            >
              {engines.map((option) => (
                <option key={option} value={option}>
                  {voiceEngineLabel(option)}
                </option>
              ))}
            </select>
          </label>
        )}
        {noticeDone && (
          <span className="text-xs text-muted" data-testid="copilot-voice-status">
            {engine === null
              ? 'Este navegador no puede dictar: escribe la orden.'
              : engine === 'transcriber'
                ? recorded.listening
                  ? 'Grabando. Al callarte se envía.'
                  : 'Pulsa para hablar o escribe la orden.'
                : browser.listening
                  ? 'Escuchando. Cada frase es una orden; se deshace con Ctrl+Z.'
                  : 'En pausa. También puedes escribir la orden.'}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="Cerrar el copiloto"
          onClick={onClose}
          data-testid="copilot-close"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {!noticeDone && engine && (
        <div className="space-y-3">
          <p className="text-sm" data-testid="copilot-voice-notice">
            {voiceNoticeText(engine)}{' '}
            <Link to={legalPath('privacy')} target="_blank" className="text-primary underline">
              Política de privacidad
            </Link>
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              data-testid="copilot-voice-notice-hide"
            />
            No volver a mostrar este aviso
          </label>
          <Button
            size="sm"
            onClick={() => {
              if (dontShowAgain) hideVoiceNotice(engine);
              setSeen((current) => ({ ...current, [engine]: true }));
            }}
            data-testid="copilot-voice-notice-ok"
          >
            <Mic className="h-4 w-4" aria-hidden />
            Entendido, empezar a dictar
          </Button>
          <p className="text-xs text-muted">Sin dictar también funciona: escribe la orden aquí abajo.</p>
        </div>
      )}

      {/* Órdenes por teclado: mismo camino que las dictadas. Sirve sin micrófono. */}
      <form className="flex items-center gap-2" onSubmit={submitTyped} data-testid="copilot-text-form">
        <label htmlFor="copilot-text" className="sr-only">
          Escribe una orden
        </label>
        <input
          id="copilot-text"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
          value={typed}
          maxLength={2000}
          autoComplete="off"
          placeholder={`Escribe una orden: «${LOCAL_COMMAND_EXAMPLES[0] ?? 'deshaz'}», «pon el título arriba»…`}
          onChange={(event) => setTyped(event.target.value)}
          data-testid="copilot-text-input"
        />
        <Button size="sm" type="submit" disabled={!typed.trim()} data-testid="copilot-text-send">
          <SendHorizontal className="h-4 w-4" aria-hidden />
          Enviar
        </Button>
      </form>

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Fotos para el copiloto" data-testid="copilot-photos">
          {photos.map((photo) => (
            <li key={photo.id} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5">
              {photo.name}
              <button
                type="button"
                aria-label={`Quitar ${photo.name}`}
                onClick={() => setPhotos((list) => list.filter((p) => p.id !== photo.id))}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {noticeDone && engine && (
        <p className="min-h-[1.25rem] text-sm italic text-muted" aria-live="polite" data-testid="copilot-interim">
          {dictation.interim}
        </p>
      )}
      {noticeDone && engine === 'transcriber' && recorded.aiError ? (
        <AiErrorNotice error={recorded.aiError} />
      ) : (
        noticeDone &&
        dictation.error && (
          <p role="alert" className="text-sm text-danger" data-testid="copilot-speech-error">
            {dictation.error}
          </p>
        )
      )}

      {lastOrders.length > 0 && (
        <ol className="max-h-48 space-y-2 overflow-y-auto" aria-label="Órdenes" data-testid="copilot-orders">
          {lastOrders.map((order) => (
            <li
              key={order.id}
              className="rounded-lg bg-subtle px-3 py-2 text-sm"
              data-testid="copilot-order"
              data-status={order.status}
              data-source={order.local ? 'local' : 'ai'}
            >
              <p className="flex items-start gap-2">
                {order.status === 'sending' || order.status === 'pending' ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
                ) : order.status === 'applied' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : null}
                <span className="min-w-0 flex-1">«{order.transcript}»</span>
                {order.local && (
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted"
                    title="Orden resuelta en tu navegador: no ha llamado a la IA ni ha gastado cupo"
                  >
                    <Zap className="h-3 w-3" aria-hidden />
                    Sin IA
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted">{STATUS_LABEL[order.status]}</span>
              </p>
              {order.changes && order.changes.length > 0 && (
                <ul className="mt-1 list-disc pl-6 text-xs" data-testid="copilot-changes">
                  {order.changes.map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
                </ul>
              )}
              {order.notes && order.notes.length > 0 && (
                <ul className="mt-1 space-y-0.5 pl-6 text-xs text-muted" data-testid="copilot-notes">
                  {order.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              )}
              {order.error !== undefined && (
                <div className="mt-2">
                  <AiErrorNotice error={order.error} />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <ImagePickerDialog
        brandId={brandId}
        libraryPath={libraryPath}
        title="Foto para el copiloto"
        uploadTo={{ organizationId: orgId }}
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!open) closePicker(null);
        }}
        onPick={(asset) =>
          closePicker({ id: asset.id, name: asset.file_name, width: asset.width, height: asset.height })
        }
      />
    </section>
  );
}
