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
  type CopilotApplyContext,
  type CopilotAssetInfo,
  type CopilotBrandStyle,
  type PlacedCopilotOperation,
} from './apply';
import { interpretLocally, LOCAL_COMMAND_EXAMPLES } from './localCommands';
import { MicLevel } from './MicLevel';
import {
  COPILOT_MAX_PLAN_PHOTOS,
  keepDictated,
  parseCopilotResponse,
  summarizeDocument,
  type CopilotOperation,
  type CopilotPhotoFlow,
} from './operations';
import {
  backgroundPrompt,
  buildPlan,
  composePlan,
  hasPlanSteps,
  planAnswer,
  planNeedsConfirmation,
  planOperations,
  type CopilotPlanHost,
  type PlanStepStatus,
} from './plan';
import { PlanCard, type PendingPlan } from './PlanCard';
import { planProblems } from './planCost';
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
//
// Una orden que MONTA una pieza («haz el menú de otoño: crea un fondo otoñal y
// pon los platos en el centro») trae pasos de plan: no se aplica nada al
// momento. Se enseña el plan con su coste máximo (PlanCard) y solo con el «sí»
// de la persona se ejecuta paso a paso y entra como un solo paso de deshacer
// (plan.ts, docs/copiloto-voz.md §15).

type OrderStatus = 'pending' | 'sending' | 'photo' | 'plan' | 'running' | 'applied' | 'nothing' | 'failed';

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
  plan: 'Esperando tu «sí»',
  running: 'Haciendo el plan…',
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
  /**
   * Lo que hace falta para montar una pieza por pasos: generar el fondo, buscar
   * en la biblioteca y quitar el fondo a las fotos (planHost.ts). Sin él, las
   * órdenes que montan una pieza se dicen como no disponibles.
   */
  plan?: CopilotPlanHost;
}

/** Espera a una promesa, pero deja de esperar en cuanto se cancela (lo pedido puede terminar igualmente). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  // Si se deja de esperar, el resultado (o el fallo) ya no le importa a nadie.
  promise.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelado', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject);
  });
}

const namesOf = (assets: readonly CopilotAssetInfo[]) => assets.map((asset) => `«${asset.name}»`).join(', ');

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
  /** Plan a la espera del «sí» o en marcha (uno como mucho). En `planRef`, al día fuera del ciclo de React. */
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const planRef = useRef<PendingPlan | null>(null);
  /** Para cancelar el plan en marcha. */
  const planAbort = useRef<AbortController | null>(null);
  /** Para qué se ha abierto el selector de fotos: para el copiloto («esta foto») o para el plan. */
  const pickingFor = useRef<'copilot' | 'plan'>('copilot');
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

  /** Nombre y medidas de los recursos conocidos: los del documento, los logotipos de la marca y los que se den. */
  const knownAssets = (extra: readonly CopilotAssetInfo[]): Map<string, CopilotAssetInfo> => {
    const current = latest.current;
    const assets = new Map<string, CopilotAssetInfo>();
    for (const asset of current.documentAssets) assets.set(asset.id, asset);
    for (const logo of current.logos) {
      assets.set(logo.id, { id: logo.id, name: logo.file_name, width: logo.width, height: logo.height });
    }
    for (const asset of extra) assets.set(asset.id, asset);
    return assets;
  };

  /** Con qué se aplican las operaciones: la marca, la página activa, lo elegido y los recursos conocidos. */
  const applyContext = (assets: ReadonlyMap<string, CopilotAssetInfo>): CopilotApplyContext => {
    const current = latest.current;
    return {
      brand: current.brand,
      assets,
      logoIds: current.logoIds,
      imageTones: current.imageTones,
      pageIndex: current.pageIndex,
      selectedIds: current.selectedIds,
      pageLimits: current.pageLimits,
      allowedRatios: current.allowedRatios,
    };
  };

  /**
   * Ejecuta las operaciones de una orden (vengan de la IA o del intérprete
   * local): primero deshacer y rehacer, después los cambios del documento como
   * UN paso, y al final lo que abre algo del editor (guardar, plantillas, fotos).
   */
  async function execute(
    order: Order,
    wanted: PlacedCopilotOperation[],
    notes: string[],
    chosen: CopilotAssetInfo[],
    /** Recursos que trae un plan (el fondo generado, las fotos): para sus nombres y medidas. */
    planAssets: readonly CopilotAssetInfo[] = [],
  ) {
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
    const assets = knownAssets([...chosen, ...(photo ? [photo] : []), ...planAssets]);
    const result = applyCopilotOperations(current.document, operations, applyContext(assets));
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

  // ── Plan por pasos (órdenes que montan una pieza) ──

  /** Cambia el plan pendiente (y su copia al día para lo que corre fuera del ciclo de React). */
  const changePlan = (change: (plan: PendingPlan) => PendingPlan) => {
    if (!planRef.current) return;
    planRef.current = change(planRef.current);
    setPendingPlan(planRef.current);
  };
  const clearPlan = () => {
    planRef.current = null;
    planAbort.current = null;
    setPendingPlan(null);
  };
  const setStep = (id: string, status: PlanStepStatus, note?: string) =>
    changePlan((plan) => ({
      ...plan,
      statuses: { ...plan.statuses, [id]: status },
      ...(note !== undefined ? { stepNotes: { ...plan.stepNotes, [id]: note } } : {}),
    }));

  /** Descarta el plan que espera el «sí»: no se ha gastado ni cambiado nada. */
  function discardPlan(reason: string) {
    const pending = planRef.current;
    if (!pending || pending.phase === 'running') return;
    clearPlan();
    update(pending.orderId, { status: 'nothing', notes: [...pending.notes, reason] });
  }

  /**
   * Una orden con pasos de plan: se construye el plan, se busca en la biblioteca
   * y se pide el coste del fondo (ni lo uno ni lo otro gastan) y se enseña. No
   * se genera, no se recorta y no se toca el documento hasta el «sí».
   */
  async function preparePlan(order: Order, operations: CopilotOperation[], notes: string[], chosen: CopilotAssetInfo[]) {
    const now = latest.current;
    const host = now.host?.plan;
    if (!host) {
      update(order.id, { status: 'nothing', notes: [...notes, 'Montar una pieza por pasos hay que hacerlo desde el editor.'] });
      return;
    }
    const plan = buildPlan(operations, {
      canvasRatio: now.document.canvas.aspectRatio,
      imageAi: host.imageAi,
      palette: now.brand.palette,
      canCutout: host.canCutout,
    });
    // Sin fondo que crear ni fotos que colocar no hay nada que confirmar: es una orden normal.
    if (!planNeedsConfirmation(plan)) {
      await execute(order, planOperations(plan), [...notes, ...plan.notes], chosen);
      return;
    }
    const paid = plan.background?.mode === 'ai';
    planRef.current = {
      orderId: order.id,
      transcript: order.transcript,
      plan,
      notes,
      chosen,
      photos: [],
      missing: [],
      backgroundMicros: paid ? undefined : 0,
      phase: 'preparing',
      statuses: {},
      stepNotes: {},
    };
    setPendingPlan(planRef.current);
    update(order.id, { status: 'plan' });
    const mine = () => planRef.current?.orderId === order.id;

    // El precio del fondo y las fotos de la biblioteca, a la vez: leer no gasta.
    const price = paid && plan.background?.mode === 'ai' ? host.estimateBackground(plan.background.ratio).catch(() => null) : Promise.resolve(0);
    const photos: CopilotAssetInfo[] = [];
    const missing: string[] = [];
    for (const [index, search] of plan.searches.entries()) {
      if (!mine()) return;
      setStep(`find-${index}`, 'running');
      let found: CopilotAssetInfo[] = [];
      let failed = false;
      try {
        found = await host.searchLibrary(search.query, search.count);
      } catch {
        failed = true;
      }
      if (!mine()) return;
      const fresh = found.filter((photo) => !photos.some((p) => p.id === photo.id)).slice(0, COPILOT_MAX_PLAN_PHOTOS - photos.length);
      photos.push(...fresh);
      if (fresh.length === 0) missing.push(search.query);
      setStep(
        `find-${index}`,
        fresh.length > 0 ? 'done' : 'failed',
        failed
          ? 'No se ha podido buscar en la biblioteca.'
          : fresh.length > 0
            ? `${fresh.length === 1 ? 'Encontrada' : `Encontradas ${fresh.length}`}: ${namesOf(fresh)}`
            : 'No hay ninguna foto que case.',
      );
    }
    // Sin búsqueda («pon estas fotos en fila»): las elegidas a mano.
    if (plan.placement && plan.searches.length === 0) photos.push(...chosen.slice(0, COPILOT_MAX_PLAN_PHOTOS));
    const backgroundMicros = await price;
    if (!mine()) return;
    changePlan((pending) => ({ ...pending, photos, missing, backgroundMicros, phase: 'ready' }));
  }

  /**
   * Ejecuta el plan confirmado, paso a paso: el fondo (lo único que gasta), los
   * recortes y, al final, TODO al documento de una vez (un paso de deshacer).
   * Si el fondo falla o se cancela, el documento no se toca; lo ya creado queda
   * en la biblioteca y se dice.
   */
  async function runPlan() {
    const pending = planRef.current;
    const host = latest.current.host?.plan;
    if (!pending || pending.phase !== 'ready' || !host) return;
    if (planProblems(pending.plan, pending.photos.length, pending.backgroundMicros).length > 0) return;
    const { plan, orderId } = pending;
    const order: Order = { id: orderId, transcript: pending.transcript, status: 'running' };
    const controller = new AbortController();
    planAbort.current = controller;
    changePlan((current) => ({ ...current, phase: 'running' }));
    update(orderId, { status: 'running' });

    /** Lo creado en este plan, que se queda en la biblioteca pase lo que pase. */
    const created: string[] = [];
    const inLibrary = () => (created.length > 0 ? [`En la biblioteca queda lo creado: ${created.join(', ')}.`] : []);
    const cancelled = (extra: string[] = []) => {
      clearPlan();
      update(orderId, {
        status: 'nothing',
        notes: [...pending.notes, 'Plan cancelado: no se ha cambiado el diseño.', ...extra, ...inLibrary()],
      });
    };

    // 1. El fondo con IA: lo único de pago. Si falla, el plan se para sin tocar el documento.
    let background: CopilotAssetInfo | null = null;
    if (plan.background?.mode === 'ai') {
      setStep('background', 'running');
      try {
        background = await untilAborted(
          host.generateBackground(backgroundPrompt(plan.background.prompt), plan.background.ratio, controller.signal),
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) {
          cancelled(['El fondo que se estaba generando puede terminar igualmente: si termina, quedará en la biblioteca y contará para el cupo de IA.']);
          return;
        }
        clearPlan();
        update(orderId, {
          status: 'failed',
          error: await toAiError(error),
          notes: [...pending.notes, 'No se ha podido crear el fondo: el plan se para aquí y el diseño no ha cambiado.'],
        });
        return;
      }
      created.push(`el fondo «${background.name}»`);
      setStep('background', 'done');
    }

    // 2. Quitar el fondo a las fotos (gratis). Si una no se puede, se coloca tal cual y se dice.
    let photos = [...(planRef.current?.photos ?? pending.photos)];
    const planNotes: string[] = [];
    if (plan.placement?.cutout && photos.length > 0) {
      setStep('cutout', 'running', `0 de ${photos.length}`);
      const cut: CopilotAssetInfo[] = [];
      const failed: CopilotAssetInfo[] = [];
      for (const photo of photos) {
        if (controller.signal.aborted) return cancelled();
        try {
          const result = await untilAborted(host.cutout(photo, controller.signal), controller.signal);
          cut.push(result.asset);
          if (result.created) created.push(`el recorte «${result.asset.name}»`);
        } catch {
          if (controller.signal.aborted) return cancelled();
          cut.push(photo);
          failed.push(photo);
        }
        setStep('cutout', 'running', `${cut.length} de ${photos.length}`);
      }
      photos = cut;
      if (failed.length > 0) {
        planNotes.push(`No se ha podido quitar el fondo de ${namesOf(failed)}: ${failed.length === 1 ? 'se coloca' : 'se colocan'} tal cual.`);
      }
      setStep('cutout', failed.length === 0 ? 'done' : 'failed');
    }
    if (controller.signal.aborted) return cancelled();

    // 3. Todo al documento de una vez: un solo paso de deshacer.
    if (plan.placement && photos.length === 0) planNotes.push('No hay fotos que colocar: ese paso se ha saltado.');
    const planAssets = [...(background ? [background] : []), ...photos];
    const assets = knownAssets([...pending.chosen, ...planAssets]);
    const composed = composePlan(plan, { background, photos }, latest.current.document, applyContext(assets));
    clearPlan();
    await execute(
      order,
      composed.operations,
      [...pending.notes, ...plan.notes, ...planNotes, ...composed.notes, ...inLibrary()],
      pending.chosen,
      planAssets,
    );
  }

  /** «Sí, hazlo»: en la cola, como una orden más, para no pisarse con otra en curso. */
  function confirmPlan() {
    queue.current = queue.current.then(() => runPlan());
  }

  /** «No» o «Cancelar»: descarta el plan que espera o para el que está en marcha. */
  function cancelPlan() {
    const pending = planRef.current;
    if (!pending) return;
    if (pending.phase === 'running') {
      changePlan((plan) => ({ ...plan, cancelling: true }));
      planAbort.current?.abort();
    } else {
      discardPlan('Plan descartado: no se ha gastado ni cambiado nada.');
    }
  }

  async function process(order: Order) {
    // 0. Con un plan a la espera, «sí» y «no» se resuelven aquí, sin IA; cualquier otra orden lo descarta.
    const waiting = planRef.current;
    if (waiting && waiting.phase !== 'running') {
      const answer = planAnswer(order.transcript);
      if (answer === 'yes') {
        const problems = planProblems(waiting.plan, waiting.photos.length, waiting.backgroundMicros);
        if (problems.length > 0) {
          update(order.id, { local: true, status: 'nothing', notes: problems });
          return;
        }
        update(order.id, { local: true, status: 'applied', changes: ['Plan confirmado'] });
        await runPlan();
        return;
      }
      if (answer === 'no') {
        discardPlan('Plan descartado: no se ha gastado ni cambiado nada.');
        update(order.id, { local: true, status: 'applied', changes: ['Plan descartado'] });
        return;
      }
      discardPlan('Plan descartado al dar otra orden: no se ha gastado ni cambiado nada.');
    }
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
      // 3. ¿Monta una pieza por pasos? Nada se aplica todavía: se enseña el plan y se espera el «sí».
      if (hasPlanSteps(dictated.operations)) {
        await preparePlan(order, dictated.operations, notes, chosen);
        return;
      }
      await execute(order, dictated.operations, notes, chosen);
    } catch (error) {
      update(order.id, { status: 'failed', error: await toAiError(error) });
    }
  }

  const onPhrase = useCallback((transcript: string) => {
    const text = transcript.trim();
    if (!text) return;
    // Con un plan en marcha, «no» o «cancela» lo paran al momento (no esperan en la cola).
    if (planRef.current?.phase === 'running' && planAnswer(text) === 'no') {
      cancelPlan();
      return;
    }
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
    const forPlan = pickingFor.current === 'plan';
    pickingFor.current = 'copilot';
    if (resolve) resolve(asset);
    else if (asset && forPlan) {
      // Una foto más para el plan que espera (hasta el tope); no se gasta nada todavía.
      changePlan((plan) =>
        plan.phase !== 'ready' || plan.photos.some((p) => p.id === asset.id) || plan.photos.length >= COPILOT_MAX_PLAN_PHOTOS
          ? plan
          : { ...plan, photos: [...plan.photos, asset] },
      );
    } else if (asset) setPhotos((list) => (list.some((p) => p.id === asset.id) ? list : [...list, asset]));
  }

  // Al cerrar el copiloto, lo que esté en marcha deja de esperarse.
  useEffect(() => () => planAbort.current?.abort(), []);

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
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              pickingFor.current = 'copilot';
              setPickerOpen(true);
            }}
            data-testid="copilot-pick-photo"
          >
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

      {pendingPlan && (
        <PlanCard
          pending={pendingPlan}
          onConfirm={confirmPlan}
          onCancel={cancelPlan}
          onPick={() => {
            pickingFor.current = 'plan';
            setPickerOpen(true);
          }}
          onRemovePhoto={(id) =>
            changePlan((plan) => (plan.phase === 'ready' ? { ...plan, photos: plan.photos.filter((p) => p.id !== id) } : plan))
          }
        />
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
                {order.status === 'sending' || order.status === 'pending' || order.status === 'running' ? (
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
