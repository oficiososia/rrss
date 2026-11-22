import { GripVertical } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { STATUS_LABEL } from '@/features/content/status';
import { cn } from '@/lib/utils';
import type { CalendarContent } from './api';
import { FormatIcon } from './CalendarEntryCard';
import { formatLabel } from './formatLabel';
import { setDrag } from './calendarDnd';

interface CalendarTrayProps {
  items: CalendarContent[];
  loading: boolean;
  /** Se pueden arrastrar y programar. */
  canSchedule: boolean;
  onSchedule: (content: CalendarContent) => void;
  className?: string;
}

/**
 * «Por programar»: piezas aprobadas (y borradores con una versión guardada) que todavía no
 * están en el calendario. Se arrastran al día que se quiera; «Programar…» hace lo mismo con
 * teclado y en móvil, donde no se arrastra.
 */
export function CalendarTray({ items, loading, canSchedule, onSchedule, className }: CalendarTrayProps) {
  return (
    <aside
      aria-label="Por programar"
      className={cn('flex min-h-0 flex-col rounded-xl border border-border bg-surface', className)}
      data-testid="calendar-tray"
    >
      <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Por programar</h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="p-2 text-sm text-muted">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="p-2 text-sm text-muted" data-testid="calendar-tray-empty">
            No queda nada por programar: todo lo aprobado ya está en el calendario.
          </p>
        ) : (
          <>
            {canSchedule && (
              <p className="px-1 pb-2 text-xs text-muted">Arrastra una pieza al día que quieras, o pulsa «Programar…».</p>
            )}
            <ul className="space-y-1.5">
              {items.map((c) => {
                return (
                  <li
                    key={c.id}
                    draggable={canSchedule}
                    onDragStart={(ev) => setDrag(ev.dataTransfer, { kind: 'content', id: c.id })}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border border-border bg-surface p-2',
                      canSchedule && 'cursor-grab active:cursor-grabbing',
                    )}
                    data-testid="calendar-tray-item"
                    data-content={c.id}
                  >
                    {canSchedule && <GripVertical className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <FormatIcon format={c.format} className="h-3.5 w-3.5" />
                        {formatLabel(c.network, c.format)}
                      </p>
                      <Badge tone={c.status === 'approved' ? 'success' : 'neutral'} className="mt-1 px-2">
                        {STATUS_LABEL[c.status]}
                      </Badge>
                    </div>
                    {canSchedule && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onSchedule(c)}
                        aria-label={`Programar ${c.title}`}
                        data-testid="calendar-tray-schedule"
                      >
                        Programar…
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}
