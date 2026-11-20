import { CalendarDays, CheckSquare, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, ErrorState, Notice, PageHeader, Select, Skeleton } from '@/components/ui';
import { networkLabel } from '@/features/content/labels';
import { useBrand, useOrg } from '@/features/orgs/context';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useApproveContents, useCalendar, useReschedulePublication, type CalendarEntry } from './api';
import {
  CALENDAR_VIEWS,
  DISPLAY_LABEL,
  DISPLAY_STATES,
  DISPLAY_TONE,
  dayKey,
  displayState,
  formatTime,
  isEditable,
  isPast,
  moveToDay,
  moveToHour,
  rangeTitle,
  sameDay,
  shiftAnchor,
  viewRange,
  type CalendarView,
  type DisplayState,
} from './calendar';
import { PublicationDialog } from './PublicationDialog';
import { PublishNowDialog } from './PublishNowDialog';
import { ScheduleDialog } from './ScheduleDialog';
import { useFeature } from '@/features/platform/integrations/useFeature';

const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Calendario editorial de la marca: mes, semana, día y por red, con arrastrar y soltar. */
export function CalendarPage() {
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const canEdit = can('edit');
  const canApprove = can('approve');
  const publishing = useFeature('publishing');

  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [network, setNetwork] = useState('');
  const [state, setState] = useState<DisplayState | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{ date: Date | null } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [publishNow, setPublishNow] = useState<CalendarEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const calendar = useCalendar(brand.id, range.from, range.to);
  const reschedule = useReschedulePublication(brand.id);
  const approve = useApproveContents(brand.id);

  const entries = useMemo(
    () =>
      (calendar.data ?? []).filter((e) => {
        if (network && e.network !== network) return false;
        if (state && displayState(e, e.content?.status ?? null) !== state) return false;
        return true;
      }),
    [calendar.data, network, state],
  );
  const networks = useMemo(() => [...new Set((calendar.data ?? []).map((e) => e.network))].sort(), [calendar.data]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const key = dayKey(new Date(e.scheduled_at));
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [entries]);
  const open = (calendar.data ?? []).find((e) => e.id === openId) ?? null;
  const reviewable = entries.filter((e) => e.content?.status === 'in_review');

  const drop = (target: Date, event: DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const entry = (calendar.data ?? []).find((e) => e.id === id);
    if (!entry || !canEdit || !isEditable(entry.status)) return;
    if (isPast(target)) return void toast.error('No se puede mover al pasado.');
    reschedule.mutate(
      { publicationId: entry.id, scheduledAt: target.toISOString() },
      { onSuccess: () => toast.success('Movida'), onError: (e) => toast.error(translateError(e)) },
    );
  };

  const approveSelected = () => {
    const items = reviewable
      .filter((e) => selected.has(e.content_id) && e.content)
      .map((e) => ({ contentId: e.content_id, version: e.content!.current_version }));
    if (items.length === 0) return;
    approve.mutate(items, {
      onSuccess: (results) => {
        const ok = results.filter((r) => r.ok).length;
        const ko = results.length - ok;
        if (ok) toast.success(`${ok} aprobada${ok === 1 ? '' : 's'}`);
        if (ko) toast.error(`${ko} sin aprobar: ${results.find((r) => !r.ok)?.message ?? ''}`);
        setSelected(new Set());
        setSelecting(false);
      },
      onError: (e) => toast.error(translateError(e)),
    });
  };

  const chip = (e: CalendarEntry, compact = false) => {
    const s = displayState(e, e.content?.status ?? null);
    const draggable = canEdit && isEditable(e.status);
    const selectable = selecting && e.content?.status === 'in_review';
    return (
      <div key={e.id} className="flex items-center gap-1">
        {selectable && (
          <input
            type="checkbox"
            aria-label={`Seleccionar ${e.content?.title ?? 'publicación'}`}
            checked={selected.has(e.content_id)}
            onChange={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(e.content_id)) next.delete(e.content_id);
                else next.add(e.content_id);
                return next;
              })
            }
            data-testid="calendar-select"
          />
        )}
        <button
          type="button"
          draggable={draggable}
          onDragStart={(ev) => ev.dataTransfer.setData('text/plain', e.id)}
          onClick={() => setOpenId(e.id)}
          className={cn(
            'flex w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1 text-left text-xs hover:bg-subtle',
            draggable && 'cursor-grab',
          )}
          data-testid="calendar-entry"
          data-state={s}
        >
          <span className="shrink-0 tabular-nums text-muted">{formatTime(e.scheduled_at)}</span>
          <span className="min-w-0 flex-1 truncate">{e.content?.title ?? 'Pieza'}</span>
          {!compact && <span className="shrink-0 text-muted">{networkLabel(e.network)}</span>}
          <Badge tone={DISPLAY_TONE[s]} className="shrink-0 px-1.5">
            {DISPLAY_LABEL[s]}
          </Badge>
        </button>
      </div>
    );
  };

  const dayCell = (day: Date, muted: boolean) => {
    const list = byDay.get(dayKey(day)) ?? [];
    const today = sameDay(day, new Date());
    return (
      <div
        key={day.toISOString()}
        className={cn('min-h-[6.5rem] space-y-1 border-b border-r border-border p-1', muted && 'bg-subtle/50')}
        onDragOver={(ev) => canEdit && ev.preventDefault()}
        onDrop={(ev) => {
          const id = ev.dataTransfer.getData('text/plain');
          const entry = (calendar.data ?? []).find((x) => x.id === id);
          if (entry) drop(moveToDay(new Date(entry.scheduled_at), day), ev);
        }}
        data-testid="calendar-day"
        data-day={dayKey(day)}
      >
        <div className="flex items-center justify-between">
          <span className={cn('text-xs', today ? 'font-semibold text-primary' : 'text-muted')}>{day.getDate()}</span>
          {publishing && canEdit && (
            <button
              type="button"
              className="rounded p-0.5 text-muted hover:bg-subtle"
              aria-label={`Programar el ${day.toLocaleDateString('es-ES')}`}
              onClick={() => setScheduling({ date: day })}
            >
              <Plus className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
        {list.map((e) => chip(e, true))}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Calendario"
        description={`Lo programado en las redes de ${brand.name}. «Programada» no es «publicada»: se publica a su hora y solo si está aprobada.`}
        action={
          publishing &&
          canEdit && (
            <Button onClick={() => setScheduling({ date: null })} data-testid="calendar-schedule">
              <Plus className="h-4 w-4" aria-hidden />
              Programar
            </Button>
          )
        }
      />

      {!publishing && (
        <div className="mb-4">
          <Notice>
            La publicación en redes no está activa en este entorno: aquí se ve lo programado, pero no se publica nada.
          </Notice>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border" role="group" aria-label="Vista">
          {CALENDAR_VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              onClick={() => setView(v.value)}
              className={cn(
                'px-3 py-1.5 text-sm',
                view === v.value ? 'bg-primary-soft text-primary' : 'hover:bg-subtle',
              )}
              data-testid={`calendar-view-${v.value}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Anterior"
          onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setAnchor(new Date())}>
          Hoy
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Siguiente"
          onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <h2 className="mr-auto text-sm font-semibold capitalize" data-testid="calendar-title">
          {rangeTitle(view, anchor)}
        </h2>
        <Select
          aria-label="Filtrar por red"
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="w-auto"
          data-testid="calendar-network-filter"
        >
          <option value="">Todas las redes</option>
          {networks.map((n) => (
            <option key={n} value={n}>
              {networkLabel(n)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filtrar por estado"
          value={state}
          onChange={(e) => setState(e.target.value as DisplayState | '')}
          className="w-auto"
          data-testid="calendar-state-filter"
        >
          <option value="">Todos los estados</option>
          {DISPLAY_STATES.map((s) => (
            <option key={s} value={s}>
              {DISPLAY_LABEL[s]}
            </option>
          ))}
        </Select>
        {canApprove && reviewable.length > 0 && (
          <Button
            variant={selecting ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => (selecting ? approveSelected() : setSelecting(true))}
            loading={approve.isPending}
            disabled={selecting && selected.size === 0}
            data-testid="calendar-approve-batch"
          >
            <CheckSquare className="h-4 w-4" aria-hidden />
            {selecting ? `Aprobar seleccionadas (${selected.size})` : 'Aprobar varias'}
          </Button>
        )}
        {selecting && (
          <Button variant="ghost" size="sm" onClick={() => (setSelecting(false), setSelected(new Set()))}>
            Cancelar
          </Button>
        )}
      </div>

      {calendar.isPending ? (
        <Skeleton className="h-96" />
      ) : calendar.isError ? (
        <Card>
          <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
        </Card>
      ) : view === 'month' || view === 'week' ? (
        <div
          className="overflow-x-auto rounded-xl border-l border-t border-border bg-surface"
          data-testid="calendar-grid"
        >
          <div className="grid min-w-[42rem] grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div key={d} className="border-b border-r border-border px-1 py-1 text-xs font-medium text-muted">
                {d}
              </div>
            ))}
            {range.days.map((day) => dayCell(day, view === 'month' && day.getMonth() !== anchor.getMonth()))}
          </div>
        </div>
      ) : view === 'day' ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface" data-testid="calendar-hours">
          {HOURS.map((h) => {
            const list = (byDay.get(dayKey(anchor)) ?? []).filter((e) => new Date(e.scheduled_at).getHours() === h);
            return (
              <li
                key={h}
                className="flex min-h-[2.5rem] gap-2 px-2 py-1"
                onDragOver={(ev) => canEdit && ev.preventDefault()}
                onDrop={(ev) => {
                  const id = ev.dataTransfer.getData('text/plain');
                  const entry = (calendar.data ?? []).find((x) => x.id === id);
                  if (entry) drop(moveToHour(new Date(entry.scheduled_at), anchor, h), ev);
                }}
              >
                <span className="w-12 shrink-0 pt-1 text-xs tabular-nums text-muted">
                  {String(h).padStart(2, '0')}:00
                </span>
                <div className="flex-1 space-y-1">{list.map((e) => chip(e))}</div>
              </li>
            );
          })}
        </ul>
      ) : entries.length === 0 ? (
        <Card>
          <p className="flex items-center gap-2 p-6 text-sm text-muted">
            <CalendarDays className="h-4 w-4" aria-hidden /> Nada en estas fechas.
          </p>
        </Card>
      ) : (
        <div className="space-y-4" data-testid="calendar-by-network">
          {[...new Set(entries.map((e) => e.network))].sort().map((n) => (
            <Card key={n} className="p-3">
              <h3 className="mb-2 text-sm font-semibold">{networkLabel(n)}</h3>
              <div className="space-y-1">{entries.filter((e) => e.network === n).map((e) => chip(e))}</div>
            </Card>
          ))}
        </div>
      )}

      <PublicationDialog
        key={open ? `${open.id}:${open.scheduled_at}` : 'cerrada'}
        orgId={org.id}
        brandId={brand.id}
        entry={open}
        onOpenChange={(o) => !o && setOpenId(null)}
        canEdit={canEdit}
        canApprove={canApprove}
        canComment={can('comment')}
        onPublishNow={(e) => {
          setOpenId(null);
          setPublishNow(e);
        }}
      />
      {publishing && publishNow && (
        <PublishNowDialog
          brandId={brand.id}
          open
          onOpenChange={(o) => !o && setPublishNow(null)}
          contentId={publishNow.content_id}
          accountId={publishNow.social_account_id ?? undefined}
          assetIds={publishNow.media_asset_ids.length > 0 ? publishNow.media_asset_ids : undefined}
        />
      )}
      {publishing && scheduling && (
        <ScheduleDialog
          brandId={brand.id}
          open
          onOpenChange={(o) => !o && setScheduling(null)}
          initialDate={scheduling.date}
        />
      )}
    </>
  );
}
