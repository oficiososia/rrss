import { Film, Image as ImageIcon, Images, Smartphone, type LucideIcon } from 'lucide-react';
import type { DragEvent } from 'react';
import { Badge } from '@/components/ui';
import { networkLabel } from '@/features/content/labels';
import { ThumbImage } from '@/features/library/ThumbImage';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from './api';
import { DISPLAY_LABEL, DISPLAY_TONE, displayState, formatTime, type DisplayState } from './calendar';
import { setDrag } from './calendarDnd';
import { formatLabel } from './formatLabel';

// La pieza del calendario como tarjeta: miniatura real, hora en la zona de la
// marca, red y formato con icono, y el estado con color y con texto (el color
// solo no basta). Pulsarla abre la vista rápida (ver CalendarQuickView).

const FORMAT_ICON: Record<string, LucideIcon> = {
  post: ImageIcon,
  carousel: Images,
  reel: Film,
  story: Smartphone,
};

/** El icono del formato: imagen, carrusel, reel o historia. */
export function FormatIcon({ format, className }: { format: string; className?: string }) {
  const Icon = FORMAT_ICON[format] ?? ImageIcon;
  return <Icon className={className} aria-hidden />;
}

const EDGE: Record<'neutral' | 'primary' | 'success' | 'warning' | 'danger', string> = {
  neutral: 'border-l-muted',
  primary: 'border-l-primary',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
};

export interface EntryThumb {
  url?: string;
  video: boolean;
}

interface CalendarEntryCardProps {
  entry: CalendarEntry;
  zone: string;
  thumb: EntryThumb | undefined;
  /** Motivo en una frase si la publicación está detenida. */
  reason: string | undefined;
  draggable: boolean;
  /** `week`: tarjeta alta en columnas anchas y en fila en pantallas estrechas; `row`: siempre en fila. */
  layout: 'week' | 'row';
  select?: { checked: boolean; onChange: () => void };
  onOpen: (entry: CalendarEntry) => void;
}

export function CalendarEntryCard({
  entry,
  zone,
  thumb,
  reason,
  draggable,
  layout,
  select,
  onOpen,
}: CalendarEntryCardProps) {
  const state: DisplayState = displayState(entry, entry.content?.status ?? null);
  const tone = DISPLAY_TONE[state];
  const title = entry.content?.title ?? 'Pieza';
  const pages = entry.media_asset_ids.length;
  const week = layout === 'week';
  const onDragStart = (ev: DragEvent) => setDrag(ev.dataTransfer, { kind: 'entry', id: entry.id });

  return (
    <div className="relative min-w-0">
      {select && (
        <input
          type="checkbox"
          aria-label={`Seleccionar ${title}`}
          checked={select.checked}
          onChange={select.onChange}
          className="absolute left-1.5 top-1.5 z-10 h-5 w-5"
          data-testid="calendar-select"
        />
      )}
      <button
        type="button"
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={() => onOpen(entry)}
        className={cn(
          'flex w-full min-w-0 overflow-hidden rounded-lg border border-l-4 border-border bg-surface text-left shadow-card transition-colors hover:bg-subtle',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
          EDGE[tone],
          week ? 'flex-row md:flex-col' : 'flex-row',
          draggable && 'cursor-grab active:cursor-grabbing',
          state === 'cancelled' && 'opacity-60',
        )}
        data-testid="calendar-entry"
        data-state={state}
        title={reason ? `Detenida: ${reason}` : undefined}
      >
        <span
          className={cn(
            'relative flex shrink-0 items-center justify-center overflow-hidden bg-subtle text-muted',
            week ? 'h-20 w-20 md:aspect-[4/3] md:h-auto md:w-full' : 'h-16 w-16',
          )}
          data-testid="calendar-entry-thumb"
        >
          {thumb?.video ? (
            <Film className="h-6 w-6" aria-label="Vídeo" />
          ) : thumb?.url ? (
            <ThumbImage url={thumb.url} size={160} />
          ) : (
            <FormatIcon format={entry.format} className="h-6 w-6 opacity-60" />
          )}
          {pages > 1 && (
            <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 text-[11px] text-white">
              {pages} págs.
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1 p-2">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="font-medium tabular-nums text-fg">{formatTime(entry.scheduled_at, zone)}</span>
            <FormatIcon format={entry.format} className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              <span className={week ? 'md:sr-only' : undefined}>{networkLabel(entry.network)} · </span>
              {formatLabel(entry.network, entry.format)}
            </span>
          </span>
          <span className="line-clamp-2 break-words text-sm font-medium leading-snug">{title}</span>
          <span className="flex flex-wrap items-center gap-1">
            <Badge tone={tone} className="px-2">
              {DISPLAY_LABEL[state]}
            </Badge>
          </span>
          {reason && (
            <span className="line-clamp-2 text-xs text-warning" data-testid="calendar-entry-reason">
              {reason}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
