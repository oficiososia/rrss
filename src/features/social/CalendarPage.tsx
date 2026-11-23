import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  List,
  Megaphone,
  Plus,
  Target,
  X,
} from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ActionNotice,
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  Input,
  LinkButton,
  Notice,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { contentPaths } from '@/features/content/labels';
import { networkLabel } from '@/features/content/labels';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useWorkMode } from '@/features/orgs/workMode';
import type { SocialAccountRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { useWorkspaceMode } from '@/layout/workspace';
import { campaignPaths, campaignsAvailable } from '@/features/campaigns/labels';
import { useTextTask } from '@/features/platform/integrations/useFeature';
import { cn } from '@/lib/utils';
import {
  useApproveContents,
  useCalendar,
  useReschedulePublication,
  useSavePublication,
  useSocialAccounts,
  type CalendarEntry,
} from './api';
import {
  CALENDAR_VIEWS,
  DISPLAY_LABEL,
  DISPLAY_STATES,
  dayKey,
  displayState,
  isEditable,
  isEntryEditable,
  isPast,
  moveToDay,
  rangeTitle,
  sameDay,
  shiftAnchor,
  viewRange,
  type DisplayState,
} from './calendar';
import {
  useActiveCampaigns,
  useCalendarView,
  useCampaignLinks,
  useUnscheduled,
  useWeeklyGoal,
} from './calendarData';
import { readDrag } from './calendarDnd';
import { clampGoal, countsAsPlanned, daysOfWeek, isPastDay, MAX_WEEKLY_GOAL } from './calendarPlan';
import { CalendarEntryCard } from './CalendarEntryCard';
import { formatLabel } from './formatLabel';
import { CalendarQuickView } from './CalendarQuickView';
import { useConnectedAccount } from './connectedAccount';
import { NoConnectedAccountNotice } from './NoConnectedAccountNotice';
import { AgendaView, DayPanel, MonthView, WeekLine, WeekView, type ViewCommon } from './CalendarViews';
import { useProposedPlans } from './proposedPlans';
import {
  activeAccountOf,
  heldCountText,
  holdAdvice,
  holdReasonText,
  selfManagedAdvice,
  type HoldAdvice,
} from './holdAdvice';
import { CalendarTabs } from './CalendarTabs';
import { connectedAccountsPath, exportPath, planPath } from './links';
import { PublicationDialog } from './PublicationDialog';
import { useEntryThumbs } from './previewData';
import { PublishNowDialog } from './PublishNowDialog';
import { AccountAttentionNotice } from './AccountAttentionNotice';
import { ScheduleDialog } from './ScheduleDialog';
import { useBrandZone } from './useBrandZone';
import { differsFromDevice, fromZoned, nowInZone, toZoned, zoneLabel } from './zone';
import { useFeature } from '@/features/platform/integrations/useFeature';

/** Motivo en una frase y botón que lo arregla, para una publicación detenida (o null si no lo está). */
function entryAdvice(
  e: CalendarEntry,
  accounts: SocialAccountRow[] | undefined,
  selfManaged: boolean,
): HoldAdvice | null {
  return e.status === 'planned' && e.hold_reason && displayState(e, e.content?.status ?? null) === 'held'
    ? selfManagedAdvice(holdAdvice(e.hold_reason, activeAccountOf(accounts, e.network)), selfManaged)
    : null;
}

/** Una lista desplegable con forma de chip: se ve qué filtra y se resalta cuando está puesto. */
function FilterChip({
  label,
  value,
  onChange,
  testId,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  const active = value !== '';
  return (
    <label
      className={cn(
        'relative inline-flex h-9 shrink-0 items-center gap-1 rounded-full border pl-3 pr-7 text-sm',
        active ? 'border-primary/40 bg-primary-soft text-primary' : 'border-border bg-surface text-muted',
      )}
    >
      <span aria-hidden>{label}:</span>
      <select
        aria-label={`Filtrar por ${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[9rem] cursor-pointer appearance-none truncate bg-transparent font-medium text-fg outline-none focus-visible:underline"
        data-testid={testId}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5" aria-hidden />
    </label>
  );
}

/** «⋯ → Objetivo semanal»: cuántas publicaciones a la semana se quieren (se recuerda en el dispositivo). */
function GoalDialog({ goal, onClose, onSave }: { goal: number; onClose: () => void; onSave: (goal: number) => void }) {
  const [value, setValue] = useState(String(goal));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Objetivo semanal"
      description="Cuántas publicaciones quieres a la semana."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onSave(clampGoal(Number(value)));
              onClose();
            }}
            data-testid="calendar-goal-save"
          >
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Publicaciones por semana">
        {(props) => (
          <Input
            {...props}
            type="number"
            min={1}
            max={MAX_WEEKLY_GOAL}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="calendar-goal-input"
          />
        )}
      </Field>
    </Dialog>
  );
}

/** Calendario editorial de la marca: semana, mes y lista, con arrastrar y soltar y ayudas para planificar. */
export function CalendarPage() {
  // Pantalla de trabajo: la página mide justo la ventana y solo se desplaza el calendario por dentro.
  useWorkspaceMode();
  const { org, isAdmin } = useOrg();
  const { brand, can } = useBrand();
  const canEdit = can('edit');
  const canApprove = can('approve');
  const publishing = useFeature('publishing');
  const { selfManaged } = useWorkMode();
  const navigate = useNavigate();

  const [view, setView] = useCalendarView();
  const zone = useBrandZone();
  // El calendario trabaja con «fechas de pared» de la zona de la marca (ver zone.ts).
  const [anchor, setAnchor] = useState(() => nowInZone(zone));
  const [network, setNetwork] = useState('');
  const [state, setState] = useState<DisplayState | ''>('');
  const [format, setFormat] = useState('');
  const [campaign, setCampaign] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => nowInZone(zone));
  const [openId, setOpenId] = useState<string | null>(null);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{ date: Date | null; contentId?: string } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [publishNow, setPublishNow] = useState<CalendarEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [goal, setGoal] = useWeeklyGoal(brand.id);

  const today = nowInZone(zone);
  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const from = useMemo(() => fromZoned(range.from, zone), [range.from, zone]);
  const to = useMemo(() => fromZoned(range.to, zone), [range.to, zone]);
  const calendar = useCalendar(brand.id, from, to);
  const reschedule = useReschedulePublication(brand.id);
  const approve = useApproveContents(brand.id);
  const accounts = useSocialAccounts(brand.id);
  const connection = useConnectedAccount(brand.id);
  const rearm = useSavePublication(brand.id);
  const campaigns = useActiveCampaigns(brand.id);
  const links = useCampaignLinks(brand.id, campaigns.length > 0);
  const canSchedule = publishing && canEdit;
  const unscheduled = useUnscheduled(brand.id, canSchedule);
  const aiText = useTextTask('campaign.plan');
  const agency = brand.ai_mode === 'agency';
  const canAskPlan = campaignsAvailable(brand, aiText) && (agency ? can('comment') : canEdit);
  // Un plan propuesto se enseña siempre (aunque ahora no se pueda preparar otro).
  const proposed = useProposedPlans(brand.id);

  const entries = useMemo(
    () =>
      (calendar.data ?? []).filter((e) => {
        if (network && e.network !== network) return false;
        if (format && e.format !== format) return false;
        if (state && displayState(e, e.content?.status ?? null) !== state) return false;
        if (campaign && !(links.data?.get(e.content_id) ?? []).includes(campaign)) return false;
        return true;
      }),
    [calendar.data, network, format, state, campaign, links.data],
  );
  const networks = useMemo(() => [...new Set((calendar.data ?? []).map((e) => e.network))].sort(), [calendar.data]);
  const formats = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of calendar.data ?? []) if (!map.has(e.format)) map.set(e.format, formatLabel(e.network, e.format));
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [calendar.data]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const key = dayKey(toZoned(e.scheduled_at, zone));
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return map;
  }, [entries, zone]);
  // Sin filtros: de aquí salen los huecos y el contador de la semana (un filtro no debe inventar huecos).
  const plannedByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of calendar.data ?? []) {
      if (!countsAsPlanned(displayState(e, e.content?.status ?? null))) continue;
      const key = dayKey(toZoned(e.scheduled_at, zone));
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [calendar.data, zone]);
  const thumbs = useEntryThumbs(brand.id, entries);
  const open = (calendar.data ?? []).find((e) => e.id === openId) ?? null;
  const quick = (calendar.data ?? []).find((e) => e.id === quickId) ?? null;
  const reviewable = entries.filter((e) => e.content?.status === 'in_review');
  const filtering = Boolean(network || state || format || campaign);
  const clearFilters = () => {
    setNetwork('');
    setState('');
    setFormat('');
    setCampaign('');
  };

  // La semana que resumen el contador y los huecos: la que se ve, o la de hoy si se ve un mes o la lista.
  const stripWeek =
    view === 'week' ? daysOfWeek(anchor) : range.days.some((d) => sameDay(d, today)) ? daysOfWeek(today) : null;

  const panelDay = range.days.some((d) => sameDay(d, selectedDay))
    ? selectedDay
    : range.days.some((d) => sameDay(d, today))
      ? today
      : range.days.find((d) => d.getDate() === 1) ?? range.days[0]!;

  const adviceFor = (e: CalendarEntry) => entryAdvice(e, accounts.data, selfManaged);
  // Un aviso por motivo encima del calendario, con cuántas hay en estas fechas.
  const heldGroups = useMemo(() => {
    const groups = new Map<string, { advice: HoldAdvice; reason: string; entries: CalendarEntry[] }>();
    for (const e of calendar.data ?? []) {
      const advice = entryAdvice(e, accounts.data, selfManaged);
      if (!advice || !e.hold_reason) continue;
      const key = `${advice.fix}:${advice.short}`;
      const group = groups.get(key) ?? { advice, reason: e.hold_reason, entries: [] };
      group.entries.push(e);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [calendar.data, accounts.data, selfManaged]);

  /** Volver a guardar las publicaciones con la cuenta conectada (las que se detuvieron por no tenerla). */
  const chooseAccount = async (list: CalendarEntry[]) => {
    let ok = 0;
    let firstError: unknown = null;
    for (const e of list) {
      const account = (accounts.data ?? []).find((a) => a.network === e.network && a.status === 'active');
      if (!account) continue;
      try {
        await rearm.mutateAsync({
          publicationId: e.id,
          contentId: e.content_id,
          scheduledAt: e.scheduled_at,
          accountId: account.id,
          mediaAssetIds: e.media_asset_ids,
          contentVersion: e.content_version,
        });
        ok += 1;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (ok) toast.success(ok === 1 ? 'Cuenta elegida' : `Cuenta elegida en ${ok} publicaciones`);
    if (firstError) toast.error(translateError(firstError));
  };

  /** El botón de un aviso de publicación detenida. */
  const fixButton = (advice: HoldAdvice, list: CalendarEntry[], testId: string) => {
    const first = list[0]!;
    switch (advice.fix) {
      case 'connect':
        return (
          <LinkButton to={connectedAccountsPath(org.id, brand.id)} data-testid={testId}>
            {advice.label}
          </LinkButton>
        );
      case 'change_plan':
        // En autogestión no se llega aquí (selfManagedAdvice lo cambia por 'none').
        return isAdmin && !selfManaged ? (
          <LinkButton to={planPath(org.id)} data-testid={testId}>
            {advice.label}
          </LinkButton>
        ) : null;
      case 'use_account':
        return canEdit ? (
          <Button size="sm" loading={rearm.isPending} onClick={() => void chooseAccount(list)} data-testid={testId}>
            {advice.label}
          </Button>
        ) : null;
      case 'export':
        return list.length === 1 ? (
          <LinkButton to={exportPath(org.id, brand.id, first.content_id)} data-testid={testId}>
            {advice.label}
          </LinkButton>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setOpenId(first.id)} data-testid={testId}>
            Revisar
          </Button>
        );
      case 'use_approved':
        // Se hace en la ficha, que comprueba antes que la versión aprobada tenga su exportación.
        return (
          <Button size="sm" onClick={() => setOpenId(first.id)} data-testid={testId}>
            {list.length === 1 ? advice.label : 'Revisar'}
          </Button>
        );
      case 'open_editor':
        return (
          <LinkButton
            to={contentPaths(org.id, brand.id).item(first.content_id)}
            variant="secondary"
            data-testid={testId}
          >
            {advice.label}
          </LinkButton>
        );
      case 'none':
        return null;
    }
  };

  /** Día a las 10:00 (o dentro de una hora si hoy ya pasó), como fecha de pared de la marca. */
  const scheduleDate = (day: Date): Date => {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0);
    return isPast(fromZoned(at, zone)) ? new Date(nowInZone(zone).getTime() + 3_600_000) : at;
  };
  const openSchedule = (day: Date | null, contentId?: string) =>
    setScheduling({ date: day ? scheduleDate(day) : null, ...(contentId ? { contentId } : {}) });

  /** Mover una publicación a otro día y hora, con «Deshacer». No se mueve lo ya publicado ni al pasado. */
  const moveEntry = (entry: CalendarEntry, scheduledAt: string) => {
    if (entry.manual) return void toast.error('Lo terminado en Instagram no se mueve desde aquí.');
    if (!isEditable(entry.status)) return void toast.error('Lo ya publicado no se puede mover.');
    if (isPast(scheduledAt)) return void toast.error('No se puede mover al pasado.');
    const previous = entry.scheduled_at;
    reschedule.mutate(
      { publicationId: entry.id, scheduledAt },
      {
        onSuccess: () => {
          setQuickId(null);
          toast.success('Movida', {
            action: {
              label: 'Deshacer',
              onClick: () =>
                reschedule.mutate(
                  { publicationId: entry.id, scheduledAt: previous },
                  {
                    onSuccess: () => toast.success('Vuelta a su sitio'),
                    onError: (e) => toast.error(translateError(e)),
                  },
                ),
            },
          });
        },
        onError: (e) => toast.error(translateError(e)),
      },
    );
  };

  /** Lo que se suelta en un día: una publicación (se mueve) o una pieza de «Por programar» (se programa). */
  const dropOnDay = (day: Date, event: DragEvent) => {
    event.preventDefault();
    const payload = readDrag(event.dataTransfer);
    if (!payload || !canEdit) return;
    if (payload.kind === 'entry') {
      const entry = (calendar.data ?? []).find((e) => e.id === payload.id);
      if (!entry) return;
      const wall = toZoned(entry.scheduled_at, zone);
      if (sameDay(wall, day)) return;
      moveEntry(entry, fromZoned(moveToDay(wall, day), zone).toISOString());
    } else {
      if (!publishing) return;
      if (isPastDay(day, today)) return void toast.error('No se puede programar en un día que ya pasó.');
      openSchedule(day, payload.id);
    }
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

  const renderCard = (e: CalendarEntry, layout: 'week' | 'row') => (
    <CalendarEntryCard
      entry={e}
      zone={zone}
      thumb={thumbs.get(e.media_asset_ids[0] ?? '')}
      reason={adviceFor(e)?.short}
      draggable={canEdit && isEntryEditable(e)}
      layout={layout}
      {...(selecting && e.content?.status === 'in_review'
        ? {
            select: {
              checked: selected.has(e.content_id),
              onChange: () =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(e.content_id)) next.delete(e.content_id);
                  else next.add(e.content_id);
                  return next;
                }),
            },
          }
        : {})}
      // Lo publicado ya no se mueve ni se cancela: se abre su ficha (con el enlace a la red y «Abrir la pieza»).
      // Lo terminado a mano no tiene ficha de publicación: su vista rápida dice cómo está y lleva al reel.
      onOpen={(entry) =>
        entry.status === 'published' && !entry.manual ? setOpenId(entry.id) : setQuickId(entry.id)
      }
    />
  );

  const common: ViewCommon = {
    byDay,
    plannedByDay,
    today,
    renderCard,
    thumbOf: (e) => thumbs.get(e.media_asset_ids[0] ?? ''),
    canDrop: canEdit,
    canSchedule,
    onAdd: (day) => openSchedule(day),
    onDropOnDay: dropOnDay,
    campaigns,
    goal,
    ghostsByDay: proposed.ghostsByDay,
  };

  const quickAdvice = quick ? adviceFor(quick) : null;
  const unscheduledCount = unscheduled.list.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="calendar-page">
      <PageHeader
        compact
        title="Calendario"
        action={
          canSchedule && (
            <Button onClick={() => openSchedule(null)} data-testid="calendar-schedule">
              <Plus className="h-4 w-4" aria-hidden />
              Programar
            </Button>
          )
        }
        more={[
          canAskPlan
            ? {
                id: 'plan',
                label: agency ? 'Pedir un plan a la agencia' : 'Preparar un plan con IA',
                icon: Megaphone,
                onSelect: () => navigate(`${campaignPaths(org.id, brand.id).list}?nuevo=1`),
                testId: 'calendar-plan-ai',
              }
            : null,
          {
            id: 'goal',
            label: `Objetivo semanal: ${goal}`,
            icon: Target,
            onSelect: () => setEditingGoal(true),
            testId: 'calendar-goal-edit',
          },
          {
            id: 'filter',
            label: showFilters || filtering ? 'Ocultar los filtros' : 'Filtrar',
            icon: Filter,
            onSelect: () => {
              if (showFilters || filtering) {
                clearFilters();
                setShowFilters(false);
              } else setShowFilters(true);
            },
            testId: 'calendar-filter-toggle',
          },
          view === 'agenda'
            ? {
                id: 'week',
                label: 'Ver por semanas',
                icon: CalendarDays,
                onSelect: () => setView('week'),
                testId: 'calendar-view-calendar',
              }
            : { id: 'list', label: 'Ver en lista', icon: List, onSelect: () => setView('agenda'), testId: 'calendar-view-list' },
          canApprove && reviewable.length > 0 && !selecting
            ? {
                id: 'approve-many',
                label: `Aprobar varias (${reviewable.length} en revisión)`,
                icon: CheckSquare,
                onSelect: () => setSelecting(true),
                testId: 'calendar-approve-start',
              }
            : null,
        ]}
        moreTestId="calendar-more"
        meta={<CalendarTabs />}
      />

      <div className="max-h-[24dvh] space-y-2 overflow-y-auto empty:hidden">
        <div className="empty:hidden">
          <AccountAttentionNotice />
        </div>
        {proposed.plans.map(({ campaign, pieces }) => (
          <ActionNotice
            key={campaign.id}
            tone="info"
            icon={Megaphone}
            title={`Plan propuesto «${campaign.title}»: ${pieces} ${pieces === 1 ? 'pieza' : 'piezas'} en gris hasta que lo aceptes`}
            action={
              <LinkButton to={campaignPaths(org.id, brand.id).item(campaign.id)} data-testid="calendar-proposed-open">
                Revisar el plan
              </LinkButton>
            }
            data-testid="calendar-proposed"
          />
        ))}
        {heldGroups.length > 0 && (
          <div className="space-y-2" data-testid="calendar-held">
            {heldGroups.map(({ advice, reason, entries: list }) => (
              <ActionNotice
                key={`${advice.fix}:${advice.short}`}
                title={`${heldCountText(list.length)}: ${advice.short.charAt(0).toLowerCase()}${advice.short.slice(1)}`}
                action={fixButton(advice, list, `calendar-held-fix-${reason}`)}
                why={holdReasonText(reason as Parameters<typeof holdReasonText>[0], selfManaged)}
                data-testid={`calendar-held-${reason}`}
              />
            ))}
          </div>
        )}
        {!publishing && (
          <Notice>
            La publicación en redes no está activa en este entorno: aquí se ve lo programado, pero no se publica nada.
          </Notice>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Anterior"
            onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(nowInZone(zone))} data-testid="calendar-today">
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
        </div>
        <h2 className="order-last min-w-0 basis-full truncate text-sm font-semibold first-letter:uppercase sm:order-none sm:basis-0 sm:flex-1" data-testid="calendar-title">
          {rangeTitle(view, anchor)}
          {/* Solo si la hora de la marca no es la del dispositivo: entonces sí hay que decirlo. */}
          {differsFromDevice(zone) && (
            <span className="ml-2 text-xs font-normal text-muted" data-testid="calendar-zone">
              Horas en {zoneLabel(zone)}
            </span>
          )}
        </h2>
        <div className="flex rounded-lg border border-border" role="group" aria-label="Vista">
          {CALENDAR_VIEWS.filter((v) => v.value !== 'agenda').map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              onClick={() => setView(v.value)}
              className={cn(
                'h-9 px-3 text-sm first:rounded-l-lg last:rounded-r-lg',
                view === v.value ? 'bg-primary-soft font-medium text-primary' : 'hover:bg-subtle',
              )}
              data-testid={`calendar-view-${v.value}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {canApprove && selecting && (
          <Button
            size="sm"
            onClick={approveSelected}
            loading={approve.isPending}
            disabled={selected.size === 0}
            data-testid="calendar-approve-batch"
          >
            <CheckSquare className="h-4 w-4" aria-hidden />
            {`Aprobar seleccionadas (${selected.size})`}
          </Button>
        )}
        {selecting && (
          <Button variant="ghost" size="sm" onClick={() => (setSelecting(false), setSelected(new Set()))}>
            Cancelar
          </Button>
        )}
      </div>

      {selecting && publishing && !connection.isLoading && !connection.connected && (
        <NoConnectedAccountNotice
          orgId={org.id}
          brandId={brand.id}
          state={connection.state}
          why="Puedes aprobarlas: quedarán en el calendario, pero no se publicará nada hasta que conectes la cuenta."
          testId="calendar-approve-no-account"
        />
      )}

      {(showFilters || filtering) && (
      <div className="flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Filtros" data-testid="calendar-filters">
        <FilterChip
          label="Estado"
          value={state}
          onChange={(v) => setState(v as DisplayState | '')}
          testId="calendar-state-filter"
          allLabel="Todos"
          options={DISPLAY_STATES.map((s) => ({ value: s, label: DISPLAY_LABEL[s] }))}
        />
        {networks.length > 1 && (
          <FilterChip
            label="Red"
            value={network}
            onChange={setNetwork}
            testId="calendar-network-filter"
            allLabel="Todas"
            options={networks.map((n) => ({ value: n, label: networkLabel(n) }))}
          />
        )}
        <FilterChip
          label="Formato"
          value={format}
          onChange={setFormat}
          testId="calendar-format-filter"
          allLabel="Todos"
          options={formats}
        />
        {campaigns.length > 0 && (
          <FilterChip
            label="Campaña"
            value={campaign}
            onChange={setCampaign}
            testId="calendar-campaign-filter"
            allLabel="Todas"
            options={campaigns.map((c) => ({ value: c.id, label: c.title }))}
          />
        )}
        {filtering && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm text-primary hover:bg-subtle"
            data-testid="calendar-filters-clear"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Quitar filtros
          </button>
        )}
      </div>
      )}

      {stripWeek && calendar.isSuccess && (
        <WeekLine
          week={stripWeek}
          plannedByDay={plannedByDay}
          today={today}
          goal={goal}
          unscheduled={canSchedule && !unscheduled.isPending ? unscheduledCount : 0}
        />
      )}

      {calendar.isSuccess && entries.length === 0 && !filtering && (
        <ActionNotice
          tone="info"
          icon={CalendarDays}
          title="Nada programado en estas fechas"
          action={
            canSchedule ? (
              <Button size="sm" onClick={() => openSchedule(null)} data-testid="calendar-empty-action">
                <Plus className="h-4 w-4" aria-hidden />
                Programar
              </Button>
            ) : (
              <LinkButton
                to={contentPaths(org.id, brand.id).list}
                variant="secondary"
                data-testid="calendar-empty-action"
              >
                <FileText className="h-4 w-4" aria-hidden />
                Ver los contenidos
              </LinkButton>
            )
          }
          why="Al calendario llegan las piezas que se programan, desde aquí o desde el editor de una pieza aprobada."
          data-testid="calendar-empty"
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className="flex min-h-[8rem] min-w-0 flex-1 flex-col gap-2 lg:min-h-0">
          {calendar.isPending ? (
            <Skeleton className="min-h-0 flex-1" />
          ) : calendar.isError ? (
            <Card>
              <ErrorState error={calendar.error} onRetry={() => void calendar.refetch()} />
            </Card>
          ) : view === 'week' ? (
            <WeekView {...common} days={range.days} />
          ) : view === 'month' ? (
            <>
              <MonthView
                {...common}
                days={range.days}
                anchor={anchor}
                selected={panelDay}
                onSelect={setSelectedDay}
              />
              <DayPanel
                day={panelDay}
                list={byDay.get(dayKey(panelDay)) ?? []}
                ghosts={proposed.ghostsByDay.get(dayKey(panelDay)) ?? []}
                today={today}
                renderCard={renderCard}
                canSchedule={canSchedule}
                onAdd={(day) => openSchedule(day)}
              />
            </>
          ) : (
            <AgendaView {...common} days={range.days} />
          )}
        </div>
      </div>

      <CalendarQuickView
        key={quick ? `${quick.id}:${quick.scheduled_at}` : 'cerrada'}
        brandId={brand.id}
        entry={quick}
        zone={zone}
        canEdit={canEdit}
        publishing={publishing}
        advice={quickAdvice}
        fix={quick && quickAdvice ? fixButton(quickAdvice, [quick], 'calendar-quick-fix') : null}
        onClose={() => setQuickId(null)}
        onOpenFicha={(e) => {
          setQuickId(null);
          if (e.manual) navigate(contentPaths(org.id, brand.id).item(e.content_id));
          else setOpenId(e.id);
        }}
        onPublishNow={(e) => {
          setQuickId(null);
          setPublishNow(e);
        }}
        onMove={moveEntry}
        moving={reschedule.isPending}
      />
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
          key={`${scheduling.date?.toISOString() ?? 'sin-fecha'}:${scheduling.contentId ?? ''}`}
          brandId={brand.id}
          open
          onOpenChange={(o) => !o && setScheduling(null)}
          initialDate={scheduling.date}
          {...(scheduling.contentId ? { initialContentId: scheduling.contentId } : {})}
          firstIds={unscheduled.list.map((c) => c.id)}
        />
      )}
      {editingGoal && <GoalDialog goal={goal} onClose={() => setEditingGoal(false)} onSave={setGoal} />}
    </div>
  );
}
