import { CalendarDays, ChevronDown, ChevronRight, Film, Image as ImageIcon, Minus, Plus } from 'lucide-react';
import { useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from './api';
import { dayKey, sameDay } from './calendar';
import {
  campaignSpans,
  chunkWeeks,
  gapDays,
  gapSentence,
  isPastDay,
  isPastWeek,
  MAX_WEEKLY_GOAL,
  weekProgress,
  type BandCampaign,
} from './calendarPlan';
import type { EntryThumb } from './CalendarEntryCard';

// Las tres vistas del calendario (semana, mes y lista) y las ayudas para planificar:
// franjas de campañas, huecos y objetivo semanal. Los datos y las acciones los pone
// CalendarPage; aquí solo se pinta y se reparte lo que se arrastra.

const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const longDay = (d: Date) => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const spanishDate = (iso: string) => iso.split('-').reverse().join('/');

export interface ViewCommon {
  /** Lo que se ve (con los filtros puestos). */
  byDay: Map<string, CalendarEntry[]>;
  /** Número de piezas planificadas por día, sin filtros: de ahí salen los huecos y el contador. */
  plannedByDay: Map<string, number>;
  today: Date;
  renderCard: (entry: CalendarEntry, layout: 'week' | 'row') => ReactNode;
  thumbOf: (entry: CalendarEntry) => EntryThumb | undefined;
  /** Se puede soltar una pieza en un día. */
  canDrop: boolean;
  /** Se puede crear una publicación desde un día. */
  canSchedule: boolean;
  onAdd: (day: Date) => void;
  onDropOnDay: (day: Date, event: DragEvent) => void;
  campaigns: BandCampaign[];
  goal: number;
}

/** Lo que hace falta para que un día acepte lo que se arrastra, y saber si se está arrastrando encima. */
function useDayDrop(common: Pick<ViewCommon, 'canDrop' | 'onDropOnDay'>) {
  const [over, setOver] = useState<string | null>(null);
  return {
    isOver: (day: Date) => over === dayKey(day),
    props: (day: Date) => ({
      onDragOver: (ev: DragEvent) => {
        if (!common.canDrop) return;
        ev.preventDefault();
        setOver(dayKey(day));
      },
      onDragLeave: (ev: DragEvent) => {
        if (!(ev.currentTarget as Element).contains(ev.relatedTarget as Node | null)) setOver(null);
      },
      onDrop: (ev: DragEvent) => {
        setOver(null);
        common.onDropOnDay(day, ev);
      },
    }),
  };
}

/** El «+» de un día: solo se ve al pasar el ratón, al enfocarlo con teclado o al tocar el día. */
function AddButton({
  day,
  onAdd,
  active,
  className,
}: {
  day: Date;
  onAdd: (day: Date) => void;
  active: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onAdd(day);
      }}
      aria-label={`Programar el ${day.toLocaleDateString('es-ES')}`}
      data-active={active}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition-opacity',
        'hover:bg-subtle hover:text-fg focus-visible:opacity-100 group-focus-within/day:opacity-100 group-hover/day:opacity-100',
        'data-[active=true]:opacity-100',
        className,
      )}
      data-testid="calendar-day-add"
    >
      <Plus className="h-4 w-4" aria-hidden />
    </button>
  );
}

// ── Campañas ─────────────────────────────────────────────────────────────

const BAND_TONES = ['bg-primary-soft text-primary', 'bg-success-soft text-success', 'bg-warning-soft text-warning'];
const MAX_BAND_ROWS = 3;

/** Franjas de las campañas activas sobre los siete días de una semana. */
export function CampaignBands({
  week,
  campaigns,
  className,
}: {
  week: Date[];
  campaigns: BandCampaign[];
  className?: string;
}) {
  const spans = campaignSpans(campaigns, week);
  if (spans.length === 0) return null;
  const shown = spans.slice(0, MAX_BAND_ROWS);
  return (
    <div className={cn('grid grid-cols-7 gap-y-0.5 px-0.5', className)} data-testid="calendar-campaigns">
      {shown.map(({ campaign, start, end, continuesBefore, continuesAfter }, i) => (
        <div
          key={campaign.id}
          style={{ gridColumn: `${start} / ${end + 1}` }}
          title={`${campaign.title} · del ${spanishDate(campaign.starts_on)} al ${spanishDate(campaign.ends_on)}`}
          className={cn(
            'truncate px-2 py-0.5 text-xs font-medium',
            BAND_TONES[i % BAND_TONES.length],
            continuesBefore ? 'rounded-l-none' : 'rounded-l-md',
            continuesAfter ? 'rounded-r-none' : 'rounded-r-md',
          )}
          data-testid="calendar-campaign"
        >
          {continuesBefore && '‹ '}
          Campaña: {campaign.title}
          {continuesAfter && ' ›'}
        </div>
      ))}
      {spans.length > shown.length && (
        <div className="col-span-7 px-2 text-xs text-muted">y {spans.length - shown.length} campañas más</div>
      )}
    </div>
  );
}

/** Lo mismo en pantallas estrechas: una línea por campaña. */
function CampaignList({ week, campaigns }: { week: Date[]; campaigns: BandCampaign[] }) {
  const spans = campaignSpans(campaigns, week);
  if (spans.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid="calendar-campaigns-list">
      {spans.map(({ campaign }, i) => (
        <li
          key={campaign.id}
          className={cn('rounded-md px-2 py-0.5 text-xs font-medium', BAND_TONES[i % BAND_TONES.length])}
        >
          Campaña: {campaign.title}
        </li>
      ))}
    </ul>
  );
}

// ── Contador, huecos y objetivo ──────────────────────────────────────────

interface PlanStripProps {
  /** Los siete días de la semana que se resume. */
  week: Date[];
  plannedByDay: Map<string, number>;
  today: Date;
  goal: number;
  onGoal: (goal: number) => void;
}

/** «2 de 3 esta semana», los días sin nada y el objetivo, que se puede cambiar. */
export function PlanStrip({ week, plannedByDay, today, goal, onGoal }: PlanStripProps) {
  const count = week.reduce((sum, d) => sum + (plannedByDay.get(dayKey(d)) ?? 0), 0);
  const progress = weekProgress(count, goal);
  const gaps = gapSentence(gapDays(week, plannedByDay, today));
  const current = week.some((d) => sameDay(d, today));
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded-lg border border-border bg-surface px-3 py-1 text-sm"
      data-testid="calendar-plan"
    >
      <span className="flex items-center gap-2">
        <span className="font-medium">{current ? 'Esta semana' : `Semana del ${shortDay(week[0]!)}`}:</span>
        <span
          role="meter"
          aria-label="Publicaciones de la semana frente al objetivo"
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(count, goal)}
          aria-valuetext={`${progress.text} publicaciones`}
          className="h-1.5 w-16 overflow-hidden rounded-full bg-subtle"
        >
          <span
            className={cn('block h-full rounded-full', progress.reached ? 'bg-success' : 'bg-primary')}
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </span>
        <span className={cn('tabular-nums', progress.reached && 'text-success')} data-testid="calendar-week-count">
          {progress.text}
        </span>
      </span>
      {gaps && (
        <span className="text-warning" data-testid="calendar-gaps">
          {gaps}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1 text-muted">
        <span id="objetivo-semanal">Objetivo por semana</span>
        <span className="flex items-center" role="group" aria-labelledby="objetivo-semanal">
          <button
            type="button"
            aria-label="Bajar el objetivo"
            disabled={goal <= 1}
            onClick={() => onGoal(goal - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-subtle disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <output className="w-6 text-center font-medium tabular-nums text-fg" data-testid="calendar-goal">
            {goal}
          </output>
          <button
            type="button"
            aria-label="Subir el objetivo"
            disabled={goal >= MAX_WEEKLY_GOAL}
            onClick={() => onGoal(goal + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-subtle disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        </span>
      </span>
    </div>
  );
}

// ── Semana ───────────────────────────────────────────────────────────────

function DayHeading({ day, today }: { day: Date; today: Date }) {
  const isToday = sameDay(day, today);
  return (
    <h3 className="flex items-baseline gap-1.5 text-sm">
      <span className="text-muted first-letter:uppercase md:hidden">{longDay(day)}</span>
      <span className="hidden text-xs text-muted md:inline">{WEEKDAYS[(day.getDay() + 6) % 7]}</span>
      <span
        className={cn(
          'hidden rounded-full px-1.5 text-sm font-semibold md:inline',
          isToday ? 'bg-primary text-primary-fg' : 'text-fg',
        )}
        aria-hidden
      >
        {day.getDate()}
      </span>
      {isToday && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-fg md:hidden">Hoy</span>}
    </h3>
  );
}

interface WeekViewProps extends ViewCommon {
  days: Date[];
}

/** Semana: siete columnas con las piezas como tarjetas (en móvil, un día debajo de otro). */
export function WeekView(common: WeekViewProps) {
  const { days, byDay, plannedByDay, today, renderCard, canSchedule, onAdd, campaigns } = common;
  const drop = useDayDrop(common);
  const [active, setActive] = useState<string | null>(null);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-border bg-surface"
      data-testid="calendar-week"
    >
      <div className="hidden pt-1 md:block">
        <CampaignBands week={days} campaigns={campaigns} />
      </div>
      <div className="px-2 pt-2 md:hidden">
        <CampaignList week={days} campaigns={campaigns} />
      </div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const past = isPastDay(day, today);
          const gap = !past && (plannedByDay.get(key) ?? 0) === 0;
          return (
            <section
              key={key}
              aria-label={longDay(day)}
              className={cn(
                'group/day flex min-w-0 flex-col border-b border-border md:border-b-0 md:border-r md:last:border-r-0',
                past && 'bg-subtle/40',
                drop.isOver(day) && 'bg-primary-soft/60',
              )}
              onClick={() => setActive(key)}
              {...drop.props(day)}
              data-testid="calendar-day"
              data-day={key}
              data-gap={gap}
              data-today={sameDay(day, today)}
            >
              <header className="flex items-center justify-between gap-1 px-2 pt-1.5">
                <DayHeading day={day} today={today} />
                {canSchedule && !past && <AddButton day={day} onAdd={onAdd} active={active === key} />}
              </header>
              <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
                {list.map((e) => (
                  <div key={e.id}>{renderCard(e, 'week')}</div>
                ))}
                {list.length === 0 && gap && (
                  <p
                    className="rounded-lg border border-dashed border-warning/50 px-2 py-3 text-center text-xs text-warning"
                    data-testid="calendar-day-gap"
                  >
                    Sin nada
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── Mes ──────────────────────────────────────────────────────────────────

interface MonthViewProps extends ViewCommon {
  days: Date[];
  anchor: Date;
  selected: Date;
  onSelect: (day: Date) => void;
}

function MiniThumb({ thumb }: { thumb: EntryThumb | undefined }) {
  return (
    <span
      className="flex h-5 w-5 items-center justify-center overflow-hidden rounded border border-surface bg-subtle text-muted"
      data-testid="calendar-month-thumb"
    >
      {thumb?.url ? (
        <img src={thumb.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : thumb?.video ? (
        <Film className="h-3 w-3" aria-hidden />
      ) : (
        <ImageIcon className="h-3 w-3" aria-hidden />
      )}
    </span>
  );
}

/** Mes compacto: las semanas pasadas se pliegan, la actual se destaca y cada día enseña miniaturas y un contador. */
export function MonthView(common: MonthViewProps) {
  const { days, anchor, selected, onSelect, byDay, plannedByDay, today, thumbOf, campaigns, goal } = common;
  const drop = useDayDrop(common);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const weeks = chunkWeeks(days);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface"
      data-testid="calendar-month"
    >
      <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium text-muted" aria-hidden>
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {weeks.map((week) => {
          const weekKey = dayKey(week[0]!);
          const planned = week.reduce((sum, d) => sum + (plannedByDay.get(dayKey(d)) ?? 0), 0);
          const current = week.some((d) => sameDay(d, today));
          const past = isPastWeek(week, today);
          if (past && !open.has(weekKey)) {
            return (
              <button
                key={weekKey}
                type="button"
                aria-expanded={false}
                onClick={() => setOpen((prev) => new Set(prev).add(weekKey))}
                className="flex h-8 w-full items-center gap-2 border-b border-border bg-subtle/50 px-3 text-left text-xs text-muted hover:bg-subtle"
                data-testid="calendar-week-folded"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                Semana del {shortDay(week[0]!)}
                <span className="ml-auto tabular-nums">
                  {planned === 0 ? 'sin nada' : `${planned} ${planned === 1 ? 'pieza' : 'piezas'}`}
                </span>
              </button>
            );
          }
          return (
            <div
              key={weekKey}
              className={cn('border-b border-border', current && 'bg-primary-soft/30 ring-1 ring-inset ring-primary/40')}
              data-testid="calendar-week-row"
              data-current={current}
            >
              <div className="flex items-center gap-2 px-2 pt-1 text-[11px] text-muted">
                {past ? (
                  <button
                    type="button"
                    aria-expanded
                    onClick={() =>
                      setOpen((prev) => {
                        const next = new Set(prev);
                        next.delete(weekKey);
                        return next;
                      })
                    }
                    className="flex items-center gap-1 hover:text-fg"
                  >
                    <ChevronDown className="h-3 w-3" aria-hidden />
                    Semana del {shortDay(week[0]!)}
                  </button>
                ) : (
                  <span className={cn(current && 'font-semibold text-primary')}>
                    {current ? 'Esta semana' : `Semana del ${shortDay(week[0]!)}`}
                  </span>
                )}
                <span className="tabular-nums">
                  {planned} de {goal}
                </span>
              </div>
              <CampaignBands week={week} campaigns={campaigns} className="pt-0.5" />
              <div className="grid grid-cols-7">
                {week.map((day) => {
                  const key = dayKey(day);
                  const list = byDay.get(key) ?? [];
                  const pastDay = isPastDay(day, today);
                  const outside = day.getMonth() !== anchor.getMonth();
                  const isToday = sameDay(day, today);
                  const isSelected = sameDay(day, selected);
                  const label = list.length === 0 ? 'sin nada' : `${list.length} ${list.length === 1 ? 'publicación' : 'publicaciones'}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onSelect(day)}
                      aria-pressed={isSelected}
                      aria-label={`${longDay(day)}: ${label}`}
                      className={cn(
                        'flex min-h-[3.25rem] min-w-0 flex-col items-center gap-1 border-r border-border p-1 text-xs last:border-r-0 sm:min-h-[4.25rem]',
                        'hover:bg-subtle focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                        (pastDay || outside) && 'text-muted',
                        outside && 'bg-subtle/40',
                        isSelected && 'bg-primary-soft',
                        drop.isOver(day) && 'bg-primary-soft',
                      )}
                      {...drop.props(day)}
                      data-testid="calendar-day"
                      data-day={key}
                      data-count={list.length}
                    >
                      <span
                        className={cn(
                          'flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-semibold',
                          isToday && 'bg-primary text-primary-fg',
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {list.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <span className="hidden -space-x-1.5 sm:flex">
                            {list.slice(0, 3).map((e) => (
                              <MiniThumb key={e.id} thumb={thumbOf(e)} />
                            ))}
                          </span>
                          <span
                            className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-fg"
                            data-testid="calendar-day-count"
                          >
                            {list.length}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** El día elegido en el mes: sus piezas como tarjetas y «Programar este día». */
export function DayPanel({
  day,
  list,
  today,
  renderCard,
  canSchedule,
  onAdd,
}: {
  day: Date;
  list: CalendarEntry[];
  today: Date;
  renderCard: ViewCommon['renderCard'];
  canSchedule: boolean;
  onAdd: (day: Date) => void;
}) {
  const past = isPastDay(day, today);
  return (
    <section
      aria-label={`Día elegido: ${longDay(day)}`}
      className="max-h-[38%] shrink-0 overflow-y-auto rounded-xl border border-border bg-surface p-2"
      data-testid="calendar-day-panel"
    >
      <header className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold first-letter:uppercase">{longDay(day)}</h3>
        {canSchedule && !past && (
          <button
            type="button"
            onClick={() => onAdd(day)}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-primary hover:bg-subtle"
            data-testid="calendar-day-panel-add"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Programar este día
          </button>
        )}
      </header>
      {list.length === 0 ? (
        <p className="py-2 text-sm text-muted">Sin nada este día.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <div key={e.id}>{renderCard(e, 'row')}</div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Lista ────────────────────────────────────────────────────────────────

interface AgendaViewProps extends ViewCommon {
  days: Date[];
}

/** Lista: semana a semana, día a día, con los huecos a la vista. Es la de móvil. */
export function AgendaView(common: AgendaViewProps) {
  const { days, byDay, plannedByDay, today, renderCard, canSchedule, onAdd, campaigns, goal } = common;
  const drop = useDayDrop(common);
  const [active, setActive] = useState<string | null>(null);
  const weeks = chunkWeeks(days).filter(
    (week) => !isPastWeek(week, today) || week.some((d) => (byDay.get(dayKey(d)) ?? []).length > 0),
  );
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto" data-testid="calendar-agenda">
      {weeks.length === 0 && (
        <p className="flex items-center gap-2 p-4 text-sm text-muted">
          <CalendarDays className="h-4 w-4" aria-hidden /> Nada en estas fechas.
        </p>
      )}
      {weeks.map((week) => {
        const planned = week.reduce((sum, d) => sum + (plannedByDay.get(dayKey(d)) ?? 0), 0);
        const current = week.some((d) => sameDay(d, today));
        return (
          <section key={dayKey(week[0]!)} aria-label={`Semana del ${shortDay(week[0]!)}`} className="space-y-1">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold">
              {current ? 'Esta semana' : `Semana del ${shortDay(week[0]!)}`}
              <span className="text-xs font-normal tabular-nums text-muted">
                {planned} de {goal}
              </span>
            </h3>
            <CampaignList week={week} campaigns={campaigns} />
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {week.map((day) => {
                const key = dayKey(day);
                const list = byDay.get(key) ?? [];
                const past = isPastDay(day, today);
                const gap = !past && (plannedByDay.get(key) ?? 0) === 0;
                if (past && list.length === 0) return null;
                return (
                  <div
                    key={key}
                    className={cn(
                      'group/day flex gap-3 border-b border-border p-2 last:border-b-0',
                      past && 'bg-subtle/40',
                      drop.isOver(day) && 'bg-primary-soft/60',
                    )}
                    onClick={() => setActive(key)}
                    {...drop.props(day)}
                    data-testid="calendar-day"
                    data-day={key}
                    data-gap={gap}
                  >
                    <div className="w-14 shrink-0 pt-1 text-center">
                      <p className="text-xs capitalize text-muted">
                        {day.toLocaleDateString('es-ES', { weekday: 'short' })}
                      </p>
                      <p
                        className={cn(
                          'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                          sameDay(day, today) && 'bg-primary text-primary-fg',
                        )}
                      >
                        {day.getDate()}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      {list.map((e) => (
                        <div key={e.id}>{renderCard(e, 'row')}</div>
                      ))}
                      {list.length === 0 && (
                        <p className="py-2 text-sm text-warning" data-testid="calendar-day-gap">
                          Sin nada
                        </p>
                      )}
                    </div>
                    {canSchedule && !past && <AddButton day={day} onAdd={onAdd} active={active === key} />}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
