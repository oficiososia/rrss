import { CalendarDays, Film, Image as ImageIcon, Plus, Sparkles } from 'lucide-react';
import { useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from './api';
import { dayKey, sameDay } from './calendar';
import { campaignSpans, chunkWeeks, isPastDay, isPastWeek, weekProgress, type BandCampaign } from './calendarPlan';
import { formatLabel } from './formatLabel';
import type { EntryThumb } from './CalendarEntryCard';

// Las vistas del calendario (semana, mes y, desde «⋯», lista) y las ayudas para planificar:
// franjas de campañas, huecos, el plan propuesto en gris y la línea «Esta semana 1 de 3».
// Los datos y las acciones los pone CalendarPage; aquí solo se pinta y se reparte lo que se
// arrastra. Para programar un día concreto se toca su hueco (ya no hay «Programar este día»).

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
  /** Piezas de un plan propuesto (sin aceptar), por día: se ven en gris. */
  ghostsByDay: Map<string, GhostPiece[]>;
}

/** Una pieza de un plan propuesto que todavía no existe: se pinta en gris hasta aceptar el plan. */
export interface GhostPiece {
  key: string;
  campaignTitle: string;
  network: string;
  format: string;
  idea: string;
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

/** El hueco de un día sin nada: tocarlo programa ese día. */
function DaySlot({ day, onAdd, className }: { day: Date; onAdd: (day: Date) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onAdd(day);
      }}
      aria-label={`Programar el ${day.toLocaleDateString('es-ES')}`}
      className={cn(
        'relative flex min-h-[2.75rem] w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted',
        'hover:border-primary/50 hover:bg-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
        className,
      )}
      data-testid="calendar-day-slot"
    >
      <Plus className="h-4 w-4" aria-hidden />
      <span className="sr-only md:not-sr-only">Programar</span>
    </button>
  );
}

/** Una pieza de un plan propuesto: en gris, sin acciones (se acepta o descarta el plan entero). */
function GhostCard({ ghost }: { ghost: GhostPiece }) {
  return (
    <div
      className="flex min-w-0 items-start gap-1.5 rounded-lg border border-dashed border-border bg-subtle/60 p-2 text-xs text-muted"
      title={`Plan propuesto «${ghost.campaignTitle}»: ${ghost.idea}`}
      data-testid="calendar-ghost"
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block font-medium">{formatLabel(ghost.network, ghost.format)} · propuesta</span>
        <span className="line-clamp-2 break-words">{ghost.idea}</span>
      </span>
    </div>
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

// ── «Esta semana 1 de 3 · 4 sin fecha» ──────────────────────────────────

interface WeekLineProps {
  /** Los siete días de la semana que se resume. */
  week: Date[];
  plannedByDay: Map<string, number>;
  today: Date;
  goal: number;
  /** Piezas listas o en borrador que aún no tienen fecha (se programan con «Programar»). */
  unscheduled: number;
}

/**
 * Una línea: «Esta semana 1 de 3» (el objetivo se cambia en «⋯») y cuántas piezas faltan por
 * fechar (se programan con «Programar», que las enseña primero).
 */
export function WeekLine({ week, plannedByDay, today, goal, unscheduled }: WeekLineProps) {
  const count = week.reduce((sum, d) => sum + (plannedByDay.get(dayKey(d)) ?? 0), 0);
  const progress = weekProgress(count, goal);
  const current = week.some((d) => sameDay(d, today));
  const label = current ? 'Esta semana' : `Semana del ${shortDay(week[0]!)}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="calendar-plan">
      <span
        role="meter"
        aria-label={`${label}: publicaciones frente al objetivo`}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(count, goal)}
        aria-valuetext={`${progress.text} publicaciones`}
        className={cn(
          'rounded-full px-2.5 py-0.5 text-xs font-medium',
          progress.reached ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary',
        )}
      >
        {label} <span className="tabular-nums" data-testid="calendar-week-count">{progress.text}</span>
      </span>
      {unscheduled > 0 && (
        // Solo se dice: se programan con «Programar», que las enseña primero (una acción, un sitio).
        <span className="text-xs text-muted" data-testid="calendar-unscheduled">
          {unscheduled} sin fecha
        </span>
      )}
    </div>
  );
}

// ── Semana ───────────────────────────────────────────────────────────────

function DayHeading({ day, today }: { day: Date; today: Date }) {
  const isToday = sameDay(day, today);
  return (
    <h3 className="flex w-12 shrink-0 flex-col items-center gap-0.5 text-sm md:w-auto md:flex-row md:items-baseline md:gap-1.5">
      <span className="text-xs capitalize text-muted">{WEEKDAYS[(day.getDay() + 6) % 7]}</span>
      <span
        className={cn(
          'flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-semibold md:h-auto',
          isToday ? 'bg-primary text-primary-fg' : 'text-fg',
        )}
      >
        {day.getDate()}
      </span>
      <span className="sr-only">{longDay(day)}</span>
    </h3>
  );
}

interface WeekViewProps extends ViewCommon {
  days: Date[];
}

/**
 * Semana: siete columnas con las piezas como tarjetas. En el móvil, la semana como agenda: un
 * día por fila (el día a la izquierda, lo programado a la derecha y el hueco para programar).
 */
export function WeekView(common: WeekViewProps) {
  const { days, byDay, ghostsByDay, today, renderCard, canSchedule, onAdd, campaigns } = common;
  const drop = useDayDrop(common);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-border bg-surface"
      data-testid="calendar-week"
    >
      <div className="hidden pt-1 md:block">
        <CampaignBands week={days} campaigns={campaigns} />
      </div>
      <div className="px-2 pt-2 empty:hidden md:hidden">
        <CampaignList week={days} campaigns={campaigns} />
      </div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const ghosts = ghostsByDay.get(key) ?? [];
          const past = isPastDay(day, today);
          const empty = list.length === 0 && ghosts.length === 0;
          return (
            <section
              key={key}
              aria-label={longDay(day)}
              className={cn(
                // `relative`: los textos solo para lector (sr-only) se colocan aquí y no alargan la página.
                'relative flex min-w-0 items-start gap-2 border-b border-border px-2 py-1.5 last:border-b-0 md:flex-col md:items-stretch md:gap-1 md:border-b-0 md:border-r md:last:border-r-0',
                past && 'bg-subtle/40',
                drop.isOver(day) && 'bg-primary-soft/60',
              )}
              {...drop.props(day)}
              data-testid="calendar-day"
              data-day={key}
              data-gap={!past && empty}
              data-today={sameDay(day, today)}
            >
              <DayHeading day={day} today={today} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {list.map((e) => (
                  <div key={e.id}>{renderCard(e, 'week')}</div>
                ))}
                {ghosts.map((g) => (
                  <GhostCard key={g.key} ghost={g} />
                ))}
                {empty && !past && canSchedule && <DaySlot day={day} onAdd={onAdd} />}
                {empty && !past && !canSchedule && (
                  <p className="py-2 text-xs text-muted" data-testid="calendar-day-gap">
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

/** Mes compacto: la semana actual se destaca y cada día enseña miniaturas y un contador (las propuestas, en gris). */
export function MonthView(common: MonthViewProps) {
  const { days, anchor, selected, onSelect, byDay, ghostsByDay, today, thumbOf, campaigns } = common;
  const drop = useDayDrop(common);
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
          const current = week.some((d) => sameDay(d, today));
          return (
            <div
              key={weekKey}
              className={cn('border-b border-border', current && 'bg-primary-soft/30 ring-1 ring-inset ring-primary/40')}
              data-testid="calendar-week-row"
              data-current={current}
            >
              <CampaignBands week={week} campaigns={campaigns} className="pt-0.5" />
              <div className="grid grid-cols-7">
                {week.map((day) => {
                  const key = dayKey(day);
                  const list = byDay.get(key) ?? [];
                  const ghosts = ghostsByDay.get(key) ?? [];
                  const pastDay = isPastDay(day, today);
                  const outside = day.getMonth() !== anchor.getMonth();
                  const isToday = sameDay(day, today);
                  const isSelected = sameDay(day, selected);
                  const label =
                    (list.length === 0
                      ? 'sin nada'
                      : `${list.length} ${list.length === 1 ? 'publicación' : 'publicaciones'}`) +
                    (ghosts.length ? ` y ${ghosts.length} ${ghosts.length === 1 ? 'propuesta' : 'propuestas'}` : '');
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
                      {(list.length > 0 || ghosts.length > 0) && (
                        <span className="flex items-center gap-0.5">
                          <span className="hidden -space-x-1.5 sm:flex">
                            {list.slice(0, 3).map((e) => (
                              <MiniThumb key={e.id} thumb={thumbOf(e)} />
                            ))}
                          </span>
                          {list.length > 0 && (
                            <span
                              className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-fg"
                              data-testid="calendar-day-count"
                            >
                              {list.length}
                            </span>
                          )}
                          {ghosts.length > 0 && (
                            <span
                              className="rounded-full border border-dashed border-muted px-1.5 text-[11px] tabular-nums text-muted"
                              data-testid="calendar-day-ghosts"
                            >
                              {ghosts.length}
                            </span>
                          )}
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

/** El día elegido en el mes: sus piezas como tarjetas; si no tiene nada, su hueco programa ese día. */
export function DayPanel({
  day,
  list,
  ghosts = [],
  today,
  renderCard,
  canSchedule,
  onAdd,
}: {
  day: Date;
  list: CalendarEntry[];
  ghosts?: GhostPiece[];
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
      <h3 className="mb-1 text-sm font-semibold first-letter:uppercase">{longDay(day)}</h3>
      {list.length === 0 && ghosts.length === 0 ? (
        canSchedule && !past ? (
          <DaySlot day={day} onAdd={onAdd} />
        ) : (
          <p className="py-2 text-sm text-muted">Sin nada este día.</p>
        )
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <div key={e.id}>{renderCard(e, 'row')}</div>
          ))}
          {ghosts.map((g) => (
            <GhostCard key={g.key} ghost={g} />
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
  const { days, byDay, ghostsByDay, plannedByDay, today, renderCard, canSchedule, onAdd, campaigns, goal } = common;
  const drop = useDayDrop(common);
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
                const ghosts = ghostsByDay.get(key) ?? [];
                const past = isPastDay(day, today);
                const gap = !past && (plannedByDay.get(key) ?? 0) === 0;
                if (past && list.length === 0) return null;
                return (
                  <div
                    key={key}
                    className={cn(
                      'flex gap-3 border-b border-border p-2 last:border-b-0',
                      past && 'bg-subtle/40',
                      drop.isOver(day) && 'bg-primary-soft/60',
                    )}
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
                      {ghosts.map((g) => (
                        <GhostCard key={g.key} ghost={g} />
                      ))}
                      {list.length === 0 && ghosts.length === 0 && canSchedule && !past && (
                        <DaySlot day={day} onAdd={onAdd} />
                      )}
                      {list.length === 0 && ghosts.length === 0 && !(canSchedule && !past) && (
                        <p className="py-2 text-sm text-muted" data-testid="calendar-day-gap">
                          Sin nada
                        </p>
                      )}
                    </div>
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
