import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Archive, ArchiveRestore, CalendarClock, CheckSquare, Copy, ExternalLink, MoreHorizontal, Repeat } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, MenuContent, MenuItem } from '@/components/ui';
import { networkLabel } from '../labels';
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
  /** «Publicar otra vez» (solo en las ya publicadas): avisa del duplicado y hace una copia. */
  onRepublish?: (item: BoardItem) => void;
  /** «Elegir»: empieza a elegir varias con esta ya elegida. */
  onSelect?: (item: BoardItem) => void;
}

interface CommonProps {
  item: BoardItem;
  href: string;
  thumb: PieceThumb | undefined;
  actions: PieceActions;
  selected: boolean;
  onToggle: (item: BoardItem) => void;
  /** Se está eligiendo varias: tocar la pieza la elige en vez de abrirla. */
  selecting: boolean;
}

interface Entry {
  id: string;
  label: string;
  icon: typeof Copy;
  onSelect: () => void;
}

/** Lo que se puede hacer con una pieza: todo en su «⋯» (y, en el móvil, con una pulsación larga). */
function entriesFor(item: BoardItem, actions: PieceActions): Entry[] {
  const entries: Entry[] = [];
  if (!actions.canEdit) return entries;
  if (item.archived_at) {
    entries.push({ id: 'restore', label: 'Recuperar', icon: ArchiveRestore, onSelect: () => actions.onRestore(item) });
    return entries;
  }
  // Lo publicado no se vuelve a programar: como mucho, «Publicar otra vez», que avisa y hace una copia.
  if (actions.canSchedule && item.stage !== 'published')
    entries.push({ id: 'schedule', label: 'Programar', icon: CalendarClock, onSelect: () => actions.onSchedule(item) });
  if (item.stage === 'published' && actions.onRepublish) {
    const republish = actions.onRepublish;
    entries.push({ id: 'republish', label: 'Publicar otra vez', icon: Repeat, onSelect: () => republish(item) });
  }
  entries.push({ id: 'duplicate', label: 'Duplicar', icon: Copy, onSelect: () => actions.onDuplicate(item) });
  if (actions.onSelect) {
    const select = actions.onSelect;
    entries.push({ id: 'select-start', label: 'Elegir', icon: CheckSquare, onSelect: () => select(item) });
  }
  entries.push({ id: 'archive', label: 'Archivar', icon: Archive, onSelect: () => actions.onArchive(item) });
  return entries;
}

/** Abre el «⋯» al mantener pulsada la pieza con el dedo, y evita que ese toque la abra. */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      fired.current = false;
      if (event.pointerType !== 'touch') return;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, 500);
    },
    onPointerUp: clear,
    onPointerMove: clear,
    onPointerCancel: clear,
    onContextMenu: (event: React.MouseEvent) => {
      // El menú del sistema (copiar enlace…) no: con el dedo, la pulsación larga es el «⋯».
      if (fired.current || timer.current !== null) event.preventDefault();
    },
    onClickCapture: (event: React.MouseEvent) => {
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
        fired.current = false;
      }
    },
  };
}

function PieceMenu({
  item,
  entries,
  open,
  onOpenChange,
  className,
}: {
  item: BoardItem;
  entries: Entry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <Dropdown.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <Dropdown.Trigger
        aria-label={`Más acciones de «${item.title}»`}
        title="Más acciones"
        data-testid="content-menu"
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-lg bg-surface/95 text-fg shadow-sm ring-1 ring-border hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
          className,
        )}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Dropdown.Trigger>
      <MenuContent align="end">
        {entries.map(({ id, label, icon: Icon, onSelect }) => (
          <MenuItem key={id} onSelect={onSelect} destructive={id === 'archive'} data-testid={`content-${id}`}>
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </MenuItem>
        ))}
      </MenuContent>
    </Dropdown.Root>
  );
}

/** Al elegir varias, toda la pieza es la casilla: un toque la elige o la quita. */
function SelectOverlay({ item, selected, onToggle }: Pick<CommonProps, 'item' | 'selected' | 'onToggle'>) {
  return (
    <label className="absolute inset-0 z-10 flex cursor-pointer items-start justify-end p-2" data-testid="content-select-label">
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

/** «Ver en Instagram» de una pieza publicada: fuera de cualquier otro enlace (no se anidan). */
export function PublishedLink({ item }: { item: BoardItem }): ReactNode {
  const url = item.stage === 'published' ? item.publication?.external_url : null;
  if (!url) return null;
  const network = networkLabel(item.publication?.network ?? item.network);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-h-[2.25rem] items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
      aria-label={`Ver «${item.title}» en ${network}`}
      data-testid="content-published-link"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      Ver en {network}
    </a>
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

/** En pantallas con ratón, el «⋯» de la miniatura sale al pasar por encima (o al llegar con el teclado). */
const HOVER_ONLY =
  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:!opacity-100 data-[state=open]:!opacity-100';

/** Una pieza en la rejilla: su miniatura, el título, el formato, el estado y su «⋯». */
export function ContentCard({ item, href, thumb, actions, selected, onToggle, selecting }: CommonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const entries = entriesFor(item, actions);
  const press = useLongPress(() => entries.length > 0 && setMenuOpen(true));
  return (
    <li
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-surface transition-shadow hover:shadow-pop',
        selected ? 'border-primary ring-2 ring-primary' : 'border-border',
      )}
      data-testid="content-card"
      data-stage={item.stage}
      {...(selecting ? {} : press)}
    >
      {selecting && <SelectOverlay item={item} selected={selected} onToggle={onToggle} />}
      <div className="relative">
        <Link
          to={href}
          className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={`Abrir «${item.title}»`}
          data-testid="content-open"
          tabIndex={selecting ? -1 : undefined}
        >
          <span className="block aspect-[4/5]">
            <PieceThumbView thumb={thumb} format={item.format} />
          </span>
        </Link>
        <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white">
          <FormatIcon format={item.format} className="h-3.5 w-3.5" />
          {formatName(item.format)}
        </span>
        {!selecting && (
          <span className="absolute right-2 top-2">
            <PieceMenu item={item} entries={entries} open={menuOpen} onOpenChange={setMenuOpen} className={HOVER_ONLY} />
          </span>
        )}
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
        <PublishedLink item={item} />
      </div>
    </li>
  );
}

/** Una pieza en la lista del móvil: miniatura pequeña, título, formato, estado y su «⋯». */
export function ContentRow({ item, href, thumb, actions, selected, onToggle, selecting }: CommonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const entries = entriesFor(item, actions);
  const press = useLongPress(() => entries.length > 0 && setMenuOpen(true));
  return (
    <li
      className={cn('relative flex items-center gap-2 px-2 py-2', selected && 'bg-primary-soft')}
      data-testid="content-row"
      data-stage={item.stage}
      {...(selecting ? {} : press)}
    >
      {selecting && <SelectOverlay item={item} selected={selected} onToggle={onToggle} />}
      <Link
        to={href}
        className="flex min-w-0 flex-1 items-center gap-3"
        aria-label={`Abrir «${item.title}»`}
        tabIndex={selecting ? -1 : undefined}
      >
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
      <span className="shrink-0">
        <PublishedLink item={item} />
      </span>
      {!selecting && (
        <span className="shrink-0">
          <PieceMenu item={item} entries={entries} open={menuOpen} onOpenChange={setMenuOpen} className="shadow-none ring-0" />
        </span>
      )}
    </li>
  );
}
