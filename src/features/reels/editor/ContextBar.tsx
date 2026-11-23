// Barra de herramientas del editor de reels, como la de CapCut: una sola fila
// que cambia con lo que está elegido. Sin nada elegido ofrece lo que se puede
// añadir; con un clip, lo que se le hace a ese clip; con un texto, lo del
// texto. Lo menos usado de cada cosa va en su «Más» (⋯), no en otra fila. En
// móvil va pegada abajo, con botones grandes; en escritorio, entre la vista
// previa y la línea de tiempo.
//
// `contextActions` es puro (qué botones salen, cuáles van en «Más» y cuáles
// están apagados y por qué): la pantalla solo les pone la acción.
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
  ArrowLeftRight,
  Captions,
  ChevronLeft,
  Copy,
  Gauge,
  Images,
  ListChecks,
  MoreHorizontal,
  Move,
  Music2,
  Palette,
  PencilLine,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { MenuContent, MenuItem } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Selection } from './history';
import type { ReelProject } from './project';

export type BarActionId =
  // Nada elegido
  | 'add'
  | 'text'
  | 'music'
  | 'style'
  | 'subtitles'
  | 'guide'
  // Clip
  | 'split'
  | 'trim'
  | 'speed'
  | 'motion'
  | 'volume'
  | 'mute'
  | 'filter'
  | 'replace'
  | 'duplicate'
  | 'delete'
  | 'clip-subtitles'
  // Texto
  | 'edit'
  | 'text-style'
  | 'animation'
  | 'duration'
  // Música
  | 'rhythm'
  | 'change-music'
  // Transición
  | 'transition';

export interface BarAction {
  id: BarActionId;
  label: string;
  icon: LucideIcon;
  /** Abre una sección del panel (en lugar de hacer algo al instante). */
  panel?: string;
  /** Va en el «Más» (⋯) de la barra, no a la vista. */
  more?: boolean;
  disabled?: boolean;
  /** Por qué está apagado, o qué hace. */
  hint?: string;
  danger?: boolean;
  keys?: string;
}

export interface BarContext {
  project: ReelProject;
  selection: Selection;
  readOnly: boolean;
  /** ¿Se puede dividir lo elegido en el cabezal? */
  canSplit: boolean;
  full: boolean;
}

export type BarKind = 'none' | 'clip' | 'text' | 'music' | 'subtitles' | 'transition';

export const BAR_TITLE: Record<BarKind, string> = {
  none: 'Añadir al reel',
  clip: 'Herramientas del clip',
  text: 'Herramientas del texto',
  music: 'Herramientas de la música',
  subtitles: 'Subtítulos',
  transition: 'Transición del corte',
};

export function barKind(project: ReelProject, selection: Selection): BarKind {
  if (!selection) return 'none';
  if (selection.kind === 'clip') return project.plan.clips.some((c) => c.id === selection.id) ? 'clip' : 'none';
  if (selection.kind === 'text') return project.plan.texts.some((t) => t.id === selection.id) ? 'text' : 'none';
  if (selection.kind === 'transition') return 'transition';
  if (selection.kind === 'music') return project.plan.music ? 'music' : 'none';
  return 'subtitles';
}

/** Los botones de la barra para lo que está elegido, en orden (los de «Más», al final). */
export function contextActions(context: BarContext): BarAction[] {
  const { project, selection, readOnly } = context;
  const kind = barKind(project, selection);
  // En solo lectura se pueden mirar los ajustes, pero no cambiar nada.
  const visible = (actions: BarAction[]) => (readOnly ? actions.filter((a) => a.panel) : actions);
  if (kind === 'none') {
    const actions: BarAction[] = [
      {
        id: 'add',
        label: 'Añadir',
        icon: Images,
        disabled: context.full,
        hint: context.full ? 'El reel ya tiene el máximo de piezas' : 'Fotos y clips de la biblioteca',
      },
      { id: 'text', label: 'Texto', icon: Type, hint: 'Un texto en el instante del cabezal' },
      { id: 'music', label: 'Música', icon: Music2 },
      { id: 'subtitles', label: 'Subtítulos', icon: Captions, panel: 'subtitles' },
      { id: 'style', label: 'Estilo', icon: Palette, hint: 'Ritmo, transiciones y plantillas de la marca' },
    ];
    if (project.guide) actions.push({ id: 'guide', label: 'Guion', icon: ListChecks, panel: 'guide' });
    return visible(actions);
  }
  if (kind === 'clip') {
    const clip = project.plan.clips.find((c) => selection?.kind === 'clip' && c.id === selection.id)!;
    const video = clip.type === 'video';
    const actions: BarAction[] = [
      {
        id: 'split',
        label: 'Dividir',
        icon: Scissors,
        disabled: !context.canSplit,
        hint: context.canSplit
          ? 'Corta en dos en el cabezal'
          : 'Lleva el cabezal dentro del clip, a más de medio segundo de sus extremos',
        keys: 'S',
      },
      { id: 'trim', label: 'Duración', icon: Timer, panel: 'trim', hint: 'Cuánto dura y qué tramo se usa' },
      video
        ? { id: 'speed', label: 'Velocidad', icon: Gauge, panel: 'speed' }
        : { id: 'motion', label: 'Movimiento', icon: Move, panel: 'motion' },
      { id: 'filter', label: 'Filtro', icon: SlidersHorizontal, panel: 'filter' },
      {
        id: 'replace',
        label: 'Sustituir',
        icon: ArrowLeftRight,
        hint: 'Otro archivo en su sitio, con su duración y sus efectos',
      },
      ...(video
        ? ([
            { id: 'volume', label: 'Volumen', icon: Volume2, panel: 'volume', more: true },
            { id: 'mute', label: clip.volume === 0 ? 'Con sonido' : 'Silenciar', icon: VolumeX, more: true },
            { id: 'clip-subtitles', label: 'Subtítulos', icon: Captions, panel: 'clip-subtitles', more: true },
          ] satisfies BarAction[])
        : []),
      { id: 'duplicate', label: 'Duplicar', icon: Copy, disabled: context.full, keys: 'Ctrl+D', more: true },
      { id: 'delete', label: 'Borrar', icon: Trash2, danger: true, keys: 'Supr', more: true },
    ];
    return visible(actions);
  }
  if (kind === 'text') {
    return visible([
      { id: 'edit', label: 'Editar', icon: PencilLine, panel: 'edit' },
      { id: 'text-style', label: 'Estilo', icon: Sparkles, panel: 'style' },
      { id: 'animation', label: 'Animación', icon: Wand2, panel: 'animation' },
      { id: 'duration', label: 'Duración', icon: Timer, panel: 'duration' },
      { id: 'duplicate', label: 'Duplicar', icon: Copy, keys: 'Ctrl+D', more: true },
      { id: 'delete', label: 'Borrar', icon: Trash2, danger: true, keys: 'Supr', more: true },
    ]);
  }
  if (kind === 'music') {
    return visible([
      { id: 'volume', label: 'Volumen', icon: Volume2, panel: 'volume' },
      { id: 'rhythm', label: 'Al ritmo', icon: Wand2, panel: 'rhythm', hint: 'Ajusta los cortes a los golpes de la música' },
      { id: 'change-music', label: 'Cambiar', icon: ArrowLeftRight },
      { id: 'delete', label: 'Quitar', icon: Trash2, danger: true, keys: 'Supr' },
    ]);
  }
  if (kind === 'transition') {
    return [{ id: 'transition', label: 'Transición', icon: Wand2, panel: 'transition' }];
  }
  return [{ id: 'subtitles', label: 'Subtítulos', icon: Captions, panel: 'subtitles' }];
}

/** Título del panel que abre un botón de la barra (la cabecera del panel). */
export function panelTitle(actions: BarAction[], panel: string | null): string {
  if (panel === 'guide') return 'Guion';
  return actions.find((a) => a.panel === panel)?.label ?? 'Ajustes';
}

export interface ContextBarProps {
  kind: BarKind;
  actions: BarAction[];
  /** Sección del panel que está abierta (para marcar su botón). */
  activePanel: string | null;
  onAction: (action: BarAction) => void;
  /** Suelta lo elegido (vuelve a la barra de añadir). */
  onBack?: () => void;
}

const keysOf = (keys?: string) => (keys === 'Supr' ? 'Delete' : keys === 'Ctrl+D' ? 'Control+D' : keys);
const titleOf = (action: BarAction) =>
  [action.hint, action.keys && `(${action.keys})`].filter(Boolean).join(' ') || undefined;
// En un móvil de 375 px caben los siete de un clip (volver, cinco y «Más») sin deslizar la barra.
const buttonClass =
  'flex h-14 min-w-[3rem] flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-[10px] font-medium leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:min-w-[4.25rem] sm:px-1 sm:text-[11px] lg:h-12 lg:max-w-[7rem]';

export function ContextBar({ kind, actions, activePanel, onAction, onBack }: ContextBarProps) {
  const shown = actions.filter((a) => !a.more);
  const more = actions.filter((a) => a.more);
  return (
    <div
      role="toolbar"
      aria-label={BAR_TITLE[kind]}
      className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto overscroll-x-contain sm:gap-1 rounded-xl border border-border bg-surface p-1 [scrollbar-width:none]"
      data-testid="reel-toolbar"
      data-kind={kind}
    >
      {kind !== 'none' && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex w-8 shrink-0 flex-col sm:w-10 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Soltar lo elegido y volver a añadir"
          title="Volver (Esc)"
          data-testid="reel-bar-back"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      {shown.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onAction(action)}
          disabled={action.disabled}
          title={titleOf(action)}
          aria-keyshortcuts={keysOf(action.keys)}
          aria-pressed={action.panel ? activePanel === action.panel : undefined}
          className={cn(
            buttonClass,
            action.danger ? 'text-danger hover:bg-danger/10' : 'hover:bg-subtle',
            action.panel && activePanel === action.panel && 'bg-primary-soft text-primary',
            action.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
          )}
          data-testid={`reel-bar-${action.id}`}
        >
          <action.icon className="h-5 w-5" aria-hidden />
          <span className="max-w-full truncate">{action.label}</span>
        </button>
      ))}
      {more.length > 0 && (
        <Dropdown.Root modal={false}>
          <Dropdown.Trigger asChild>
            <button
              type="button"
              className={cn(
                buttonClass,
                'hover:bg-subtle',
                more.some((a) => a.panel && a.panel === activePanel) && 'bg-primary-soft text-primary',
              )}
              aria-label={`Más: ${more.map((a) => a.label.toLowerCase()).join(', ')}`}
              title="Más"
              data-testid="reel-bar-more"
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden />
              <span>Más</span>
            </button>
          </Dropdown.Trigger>
          <MenuContent align="end">
            {more.map((action) => (
              <MenuItem
                key={action.id}
                onSelect={() => onAction(action)}
                destructive={action.danger}
                disabled={action.disabled}
                title={titleOf(action)}
                data-testid={`reel-bar-${action.id}`}
              >
                <action.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">{action.label}</span>
                {action.keys && <span className="text-xs text-muted">{action.keys}</span>}
              </MenuItem>
            ))}
          </MenuContent>
        </Dropdown.Root>
      )}
    </div>
  );
}
