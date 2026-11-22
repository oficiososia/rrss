// Barra de herramientas del editor de reels. Cambia con lo que está elegido,
// como en los editores de móvil: sin nada elegido ofrece lo que se puede
// añadir; con un clip, lo que se le puede hacer a ese clip; con un texto, lo
// del texto. En móvil va pegada abajo, con botones grandes (se desliza de lado
// si no caben); en escritorio es la misma barra, entre la vista previa y la
// línea de tiempo.
//
// `contextActions` es puro (qué botones salen y cuáles están apagados y por
// qué): la pantalla solo les pone la acción.
import {
  ArrowLeftRight,
  Captions,
  ChevronLeft,
  Clapperboard,
  Copy,
  Crop,
  Gauge,
  Image as ImageIcon,
  Images,
  LayoutTemplate,
  ListChecks,
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
import { cn } from '@/lib/utils';
import type { Selection } from './history';
import type { ReelProject } from './project';

export type BarActionId =
  // Nada elegido
  | 'add'
  | 'text'
  | 'music'
  | 'style'
  | 'template'
  | 'subtitles'
  | 'cover'
  | 'guide'
  | 'renders'
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
  hasBrandTemplates: boolean;
  hasRenders: boolean;
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

/** Los botones de la barra para lo que está elegido, en orden. */
export function contextActions(context: BarContext): BarAction[] {
  const { project, selection, readOnly } = context;
  const kind = barKind(project, selection);
  if (kind === 'none') {
    const actions: BarAction[] = [
      { id: 'add', label: 'Añadir', icon: Images, disabled: context.full, hint: context.full ? 'El reel ya tiene el máximo de piezas' : 'Fotos y clips de la biblioteca' },
      { id: 'text', label: 'Texto', icon: Type, hint: 'Un texto en el instante del cabezal' },
      { id: 'music', label: 'Música', icon: Music2 },
      { id: 'style', label: 'Estilo', icon: Palette, hint: 'Ritmo, transiciones y estilo del texto' },
      {
        id: 'template',
        label: 'Plantilla',
        icon: LayoutTemplate,
        disabled: !context.hasBrandTemplates,
        hint: context.hasBrandTemplates ? 'Reparte el material en los planos de una plantilla de la marca' : 'La marca todavía no tiene plantillas de reel',
      },
      { id: 'subtitles', label: 'Subtítulos', icon: Captions, panel: 'subtitles' },
      { id: 'cover', label: 'Portada', icon: ImageIcon, panel: 'cover' },
    ];
    if (project.guide) actions.push({ id: 'guide', label: 'Guion', icon: ListChecks, panel: 'guide' });
    if (context.hasRenders) actions.push({ id: 'renders', label: 'Montajes', icon: Clapperboard, panel: 'renders' });
    return readOnly ? actions.filter((a) => a.panel) : actions;
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
        hint: context.canSplit ? 'Corta en dos en el cabezal' : 'Lleva el cabezal dentro del clip, a más de medio segundo de sus extremos',
        keys: 'S',
      },
      { id: 'trim', label: 'Recortar', icon: Crop, panel: 'trim' },
      ...(video
        ? ([
            { id: 'speed', label: 'Velocidad', icon: Gauge, panel: 'speed' },
            { id: 'volume', label: 'Volumen', icon: Volume2, panel: 'volume' },
            { id: 'mute', label: clip.volume === 0 ? 'Con sonido' : 'Silenciar', icon: VolumeX },
          ] satisfies BarAction[])
        : ([{ id: 'motion', label: 'Movimiento', icon: Move, panel: 'motion' }] satisfies BarAction[])),
      { id: 'filter', label: 'Filtro', icon: SlidersHorizontal, panel: 'filter' },
      { id: 'replace', label: 'Sustituir', icon: ArrowLeftRight, hint: 'Otro archivo en su sitio, con su duración y sus efectos' },
      { id: 'duplicate', label: 'Duplicar', icon: Copy, disabled: context.full, keys: 'Ctrl+D' },
      ...(video ? ([{ id: 'clip-subtitles', label: 'Subtítulos', icon: Captions, panel: 'clip-subtitles' }] satisfies BarAction[]) : []),
      { id: 'delete', label: 'Borrar', icon: Trash2, danger: true, keys: 'Supr' },
    ];
    return readOnly ? actions.filter((a) => a.panel) : actions;
  }
  if (kind === 'text') {
    const actions: BarAction[] = [
      { id: 'edit', label: 'Editar', icon: PencilLine, panel: 'edit' },
      { id: 'text-style', label: 'Estilo', icon: Sparkles, panel: 'style' },
      { id: 'animation', label: 'Animación', icon: Wand2, panel: 'animation' },
      { id: 'duration', label: 'Duración', icon: Timer, panel: 'duration' },
      { id: 'duplicate', label: 'Duplicar', icon: Copy, keys: 'Ctrl+D' },
      { id: 'delete', label: 'Borrar', icon: Trash2, danger: true, keys: 'Supr' },
    ];
    return readOnly ? actions.filter((a) => a.panel) : actions;
  }
  if (kind === 'music') {
    const actions: BarAction[] = [
      { id: 'volume', label: 'Volumen', icon: Volume2, panel: 'volume' },
      { id: 'rhythm', label: 'Al ritmo', icon: Wand2, panel: 'rhythm', hint: 'Ajusta los cortes a los golpes de la música' },
      { id: 'change-music', label: 'Cambiar', icon: ArrowLeftRight },
      { id: 'delete', label: 'Quitar', icon: Trash2, danger: true, keys: 'Supr' },
    ];
    return readOnly ? actions.filter((a) => a.panel) : actions;
  }
  if (kind === 'transition') {
    return [{ id: 'transition', label: 'Transición', icon: Wand2, panel: 'transition' }];
  }
  return [{ id: 'subtitles', label: 'Subtítulos', icon: Captions, panel: 'subtitles' }];
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

export function ContextBar({ kind, actions, activePanel, onAction, onBack }: ContextBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={BAR_TITLE[kind]}
      className="flex shrink-0 items-stretch gap-1 overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-surface p-1 [scrollbar-width:none]"
      data-testid="reel-toolbar"
      data-kind={kind}
    >
      {kind !== 'none' && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex w-10 shrink-0 flex-col items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Soltar lo elegido y volver a añadir"
          title="Volver (Esc)"
          data-testid="reel-bar-back"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      )}
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onAction(action)}
          disabled={action.disabled}
          title={[action.hint, action.keys && `(${action.keys})`].filter(Boolean).join(' ') || undefined}
          aria-keyshortcuts={action.keys === 'Supr' ? 'Delete' : action.keys === 'Ctrl+D' ? 'Control+D' : action.keys}
          aria-pressed={action.panel ? activePanel === action.panel : undefined}
          className={cn(
            'flex h-14 min-w-[4.25rem] flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary lg:h-12 lg:max-w-[7rem]',
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
    </div>
  );
}
