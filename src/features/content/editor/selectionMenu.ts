import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Group,
  ImageOff,
  Lock,
  Move,
  MousePointerSquareDashed,
  SendToBack,
  SlidersHorizontal,
  Trash2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import type { MoreAction, MoreMenuItem } from '@/components/ui';
import { isEmptyFrame, MAX_LAYERS, type Layer } from '../document';
import { ALIGN_LABEL, MIN_TO_DISTRIBUTE } from './arrange';
import { emptyFramePatch } from './frames';
import type { EditorAction } from './history';
import { ALIGN_ICONS } from './panels/alignIcons';

// Lo que se puede hacer con lo elegido y no cabe en la barra flotante: es el
// menú «⋯» de la barra y también el del botón derecho sobre el lienzo. Una sola
// lista, para que las dos puertas ofrezcan lo mismo con las mismas palabras.

export interface SelectionMenuContext {
  /** Capas elegidas, en el orden del documento. Vacío: el menú es el del lienzo. */
  layers: Layer[];
  /** Capas de la página (para saber si cabe una copia y si hay algo que elegir). */
  pageLayers: Layer[];
  dispatch: (action: EditorAction) => void;
  canPaste: boolean;
  onCopy: () => void;
  onPaste: () => void;
  /** Encuadrar la foto dentro de su caja (solo con una foto elegida). */
  onFramePhoto?: (id: string) => void;
  /** Abre el panel «Diseño» con todas las opciones de lo elegido. */
  onMoreOptions: () => void;
}

const when = <T>(condition: boolean, item: T): T[] => (condition ? [item] : []);

export function selectionMenuItems(ctx: SelectionMenuContext): MoreMenuItem[] {
  const { layers, pageLayers, dispatch } = ctx;
  const paste: MoreAction = {
    id: 'paste',
    label: 'Pegar',
    icon: ClipboardPaste,
    onSelect: ctx.onPaste,
    disabled: !ctx.canPaste,
    hint: ctx.canPaste ? 'Ctrl+V' : 'No hay nada copiado',
    testId: 'menu-paste',
  };

  if (layers.length === 0) {
    return [
      paste,
      {
        id: 'select-all',
        label: 'Elegir todo',
        icon: MousePointerSquareDashed,
        onSelect: () =>
          dispatch({ type: 'selectMany', ids: pageLayers.filter((l) => l.visible && !l.locked).map((l) => l.id) }),
        disabled: pageLayers.length === 0,
        hint: 'Ctrl+A',
        testId: 'menu-select-all',
      },
    ];
  }

  const single = layers.length === 1 ? layers[0]! : null;
  const allLocked = layers.every((layer) => layer.locked);
  const grouped = layers.some((layer) => layer.groupId);
  const full = pageLayers.length + layers.length > MAX_LAYERS;
  const setLocked = (locked: boolean) =>
    dispatch({ type: 'updateMany', changes: layers.map((layer) => ({ id: layer.id, patch: { locked } })) });
  const photo = single?.type === 'image' && !isEmptyFrame(single) ? single : null;

  return [
    { id: 'copy', label: 'Copiar', icon: Copy, onSelect: ctx.onCopy, hint: 'Ctrl+C', testId: 'menu-copy' },
    paste,
    {
      id: 'duplicate',
      label: 'Duplicar',
      icon: CopyPlus,
      onSelect: () => dispatch({ type: 'duplicateSelection' }),
      disabled: full,
      hint: full ? `La página ya tiene el máximo de ${MAX_LAYERS} capas` : 'Ctrl+D',
      testId: 'menu-duplicate',
    },
    null,
    ...when<MoreAction>(Boolean(photo && photo.fit === 'cover' && ctx.onFramePhoto && !photo.locked), {
      id: 'frame-photo',
      label: 'Encuadrar la foto',
      icon: Move,
      onSelect: () => photo && ctx.onFramePhoto?.(photo.id),
      hint: 'Moverla y ampliarla dentro de su marco (doble clic)',
      testId: 'menu-frame-photo',
    }),
    ...when<MoreAction>(Boolean(photo && !photo.locked), {
      id: 'empty-frame',
      label: 'Quitar la foto y dejar el hueco',
      icon: ImageOff,
      onSelect: () =>
        photo &&
        dispatch({
          type: 'update',
          id: photo.id,
          patch: emptyFramePatch(),
        }),
      hint: 'Queda un marco vacío para poner otra foto (útil al preparar una plantilla)',
      testId: 'menu-empty-frame',
    }),
    ...(single
      ? (
          [
            { id: 'front', label: 'Traer al frente', icon: BringToFront, to: 'front' },
            { id: 'forward', label: 'Subir un nivel', icon: ArrowUp, to: 'forward' },
            { id: 'backward', label: 'Bajar un nivel', icon: ArrowDown, to: 'backward' },
            { id: 'back', label: 'Llevar al fondo', icon: SendToBack, to: 'back' },
          ] as const
        ).map((order): MoreAction => ({
          id: `order-${order.id}`,
          label: order.label,
          icon: order.icon,
          onSelect: () => dispatch({ type: 'reorder', id: single.id, to: order.to }),
          testId: `menu-order-${order.to}`,
        }))
      : []),
    null,
    ...(allLocked
      ? []
      : ALIGN_ICONS.map(([to, icon]): MoreAction => ({
          id: `align-${to}`,
          label: single ? `${ALIGN_LABEL[to]} del lienzo` : ALIGN_LABEL[to],
          icon,
          onSelect: () => dispatch({ type: 'align', to }),
          testId: `menu-align-${to}`,
        }))),
    ...when<MoreAction>(layers.length >= MIN_TO_DISTRIBUTE, {
      id: 'distribute-h',
      label: 'Repartir en horizontal',
      icon: AlignHorizontalDistributeCenter,
      onSelect: () => dispatch({ type: 'distribute', axis: 'horizontal' }),
      testId: 'menu-distribute-horizontal',
    }),
    ...when<MoreAction>(layers.length >= MIN_TO_DISTRIBUTE, {
      id: 'distribute-v',
      label: 'Repartir en vertical',
      icon: AlignVerticalDistributeCenter,
      onSelect: () => dispatch({ type: 'distribute', axis: 'vertical' }),
      testId: 'menu-distribute-vertical',
    }),
    null,
    ...when<MoreAction>(layers.length > 1, {
      id: 'group',
      label: 'Agrupar',
      icon: Group,
      onSelect: () => dispatch({ type: 'group' }),
      hint: 'Ctrl+G',
      testId: 'menu-group',
    }),
    ...when<MoreAction>(grouped, {
      id: 'ungroup',
      label: 'Desagrupar',
      icon: Ungroup,
      onSelect: () => dispatch({ type: 'ungroup' }),
      hint: 'Ctrl+Mayús+G',
      testId: 'menu-ungroup',
    }),
    allLocked
      ? {
          id: 'unlock',
          label: 'Desbloquear',
          icon: Unlock,
          onSelect: () => setLocked(false),
          testId: 'menu-unlock',
        }
      : {
          id: 'lock',
          label: 'Bloquear',
          icon: Lock,
          onSelect: () => setLocked(true),
          hint: 'No se mueve ni se borra hasta desbloquearla',
          testId: 'menu-lock',
        },
    null,
    {
      id: 'more-options',
      label: 'Todas las opciones',
      icon: SlidersHorizontal,
      onSelect: ctx.onMoreOptions,
      hint: 'Abre el panel «Diseño»',
      testId: 'menu-more-options',
    },
    {
      id: 'delete',
      label: 'Borrar',
      icon: Trash2,
      onSelect: () => dispatch({ type: 'removeSelection' }),
      destructive: true,
      disabled: allLocked,
      hint: allLocked ? 'Está bloqueada' : 'Supr',
      testId: 'menu-delete',
    },
  ];
}
