import { Archive, ArchiveRestore, CalendarClock, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { FormatIcon } from './FormatIcon';
import { formatName } from './formats';
import { useBrandZone } from '@/features/social/useBrandZone';
import { dateText } from './dateText';
import { PieceThumbView } from './PieceThumb';
import { stageBadge } from './stage';
import type { PieceThumb } from './useContentThumbs';
import type { BoardItem } from './useContentBoard';

export interface PieceActions {
  /** Se ofrece «Programar» (la pieza está aprobada y sin fecha). */
  canSchedule: boolean;
  canEdit: boolean;
  onSchedule: (item: BoardItem) => void;
  onDuplicate: (item: BoardItem) => void;
  onArchive: (item: BoardItem) => void;
  onRestore: (item: BoardItem) => void;
}

interface CommonProps {
  item: BoardItem;
  href: string;
  thumb: PieceThumb | undefined;
  actions: PieceActions;
  selected: boolean;
  onToggle: (item: BoardItem) => void;
  /** Se enseñan las casillas de selección (quien puede editar). */
  selectable: boolean;
}

function QuickActions({ item, actions }: { item: BoardItem; actions: PieceActions }) {
  const buttons: { id: string; label: string; icon: typeof Copy; onClick: () => void }[] = [];
  if (item.archived_at) {
    if (actions.canEdit)
      buttons.push({ id: 'restore', label: 'Recuperar', icon: ArchiveRestore, onClick: () => actions.onRestore(item) });
  } else {
    if (actions.canSchedule)
      buttons.push({ id: 'schedule', label: 'Programar', icon: CalendarClock, onClick: () => actions.onSchedule(item) });
    if (actions.canEdit) {
      buttons.push({ id: 'duplicate', label: 'Duplicar', icon: Copy, onClick: () => actions.onDuplicate(item) });
      buttons.push({ id: 'archive', label: 'Archivar', icon: Archive, onClick: () => actions.onArchive(item) });
    }
  }
  if (buttons.length === 0) return null;
  return (
    <span className="flex items-center gap-1">
      {buttons.map(({ id, label, icon: Icon, onClick }) => (
        <button
          key={id}
          type="button"
          onClick={onClick}
          aria-label={`${label} «${item.title}»`}
          title={label}
          data-testid={`content-${id}`}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface/95 text-fg shadow-sm ring-1 ring-border hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      ))}
    </span>
  );
}

function Check({ item, selected, onToggle }: Pick<CommonProps, 'item' | 'selected' | 'onToggle'>) {
  return (
    <label className="flex h-10 w-10 cursor-pointer items-center justify-center" data-testid="content-select-label">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item)}
        aria-label={`Elegir «${item.title}»`}
        className="h-5 w-5 rounded border-border accent-primary"
        data-testid="content-select"
      />
    </label>
  );
}

function StateLine({ item }: { item: BoardItem }): ReactNode {
  const badge = stageBadge(item.stage, item.publication);
  const zone = useBrandZone();
  const date = dateText(item, zone);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={badge.tone} className="shrink-0">
        {badge.label}
      </Badge>
      {item.empty && (
        <Badge tone="neutral" className="shrink-0">
          Vacía
        </Badge>
      )}
      {date && <span className="text-xs text-muted">{date}</span>}
    </span>
  );
}

const HOVER_ONLY =
  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:!opacity-100';

/** Una pieza en la rejilla: su miniatura, el título, el formato y el estado. */
export function ContentCard({ item, href, thumb, actions, selected, onToggle, selectable }: CommonProps) {
  return (
    <li
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-surface transition-shadow hover:shadow-pop',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border',
      )}
      data-testid="content-card"
      data-stage={item.stage}
    >
      <div className="relative">
      <Link to={href} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Abrir «${item.title}»`} data-testid="content-open">
        <span className="block aspect-[4/5]">
          <PieceThumbView thumb={thumb} format={item.format} />
        </span>
      </Link>
      <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white">
        <FormatIcon format={item.format} className="h-3.5 w-3.5" />
        {formatName(item.format)}
      </span>
      {selectable && (
        <span className="absolute right-0 top-0 rounded-bl-lg bg-surface/90">
          <Check item={item} selected={selected} onToggle={onToggle} />
        </span>
      )}
      <span className={cn('absolute bottom-2 right-2 transition-opacity', HOVER_ONLY)}>
        <QuickActions item={item} actions={actions} />
      </span>
      </div>
      <div className="space-y-1.5 p-3">
        <Link
          to={href}
          className="block truncate text-sm font-medium hover:underline"
          data-testid="content-title"
          tabIndex={-1}
        >
          {item.title}
        </Link>
        <StateLine item={item} />
      </div>
    </li>
  );
}

/** Una pieza en la lista compacta: miniatura pequeña, título, formato, estado y acciones. */
export function ContentRow({ item, href, thumb, actions, selected, onToggle, selectable }: CommonProps) {
  return (
    <li
      className={cn('group flex items-center gap-2 px-2 py-2', selected && 'bg-primary-soft')}
      data-testid="content-row"
      data-stage={item.stage}
    >
      {selectable && <Check item={item} selected={selected} onToggle={onToggle} />}
      <Link to={href} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`Abrir «${item.title}»`}>
        <span className="block h-14 w-11 shrink-0 overflow-hidden rounded-md">
          <PieceThumbView thumb={thumb} format={item.format} />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-sm font-medium" data-testid="content-title">
            {item.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <FormatIcon format={item.format} className="h-3.5 w-3.5" />
              {formatName(item.format)}
            </span>
            <StateLine item={item} />
          </span>
        </span>
      </Link>
      <span className={cn('shrink-0 transition-opacity', HOVER_ONLY)}>
        <QuickActions item={item} actions={actions} />
      </span>
    </li>
  );
}
