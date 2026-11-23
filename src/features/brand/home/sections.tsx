import { CheckCircle2, ExternalLink } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui';
import { contentPaths, networkLabel } from '@/features/content/labels';
import { PieceThumbView } from '@/features/content/lista/PieceThumb';
import { useContentThumbs } from '@/features/content/lista/useContentThumbs';
import { useWorkMode } from '@/features/orgs/workMode';
import { activeAccountOf, holdAdvice, selfManagedAdvice } from '@/features/social/holdAdvice';
import { useCalendar, useSocialAccounts } from '@/features/social/api';
import { useBrandZone } from '@/features/social/useBrandZone';
import { shortDateTime } from '@/features/content/lista/dateText';
import { formatDate, cn } from '@/lib/utils';
import { fixTarget } from './fixTarget';
import type { PublishedWithFigures, WithPiece } from './useHomeData';
import { groupByDay, weekDays, weekProgress, weekRange } from './week';

function Section({
  title,
  badge,
  action,
  children,
  testId,
}: {
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section aria-labelledby={`${testId}-t`} data-testid={testId} className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <h2 id={`${testId}-t`} className="shrink-0 text-base">
          {title}
        </h2>
        {badge}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

const numberFormat = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * La semana de lunes a domingo: una columna por día con las miniaturas de las piezas y la ficha
 * «N de M publicadas» (lo programado no cuenta como publicado hasta que sale).
 */
export function WeekStrip({ orgId, brandId, now }: { orgId: string; brandId: string; now: Date }) {
  const zone = useBrandZone();
  const days = useMemo(() => weekDays(now, zone), [now, zone]);
  const range = useMemo(() => weekRange(now, zone), [now, zone]);
  const calendar = useCalendar(brandId, range.from, range.to);
  const entries = useMemo(
    () => (calendar.data ?? []).filter((e) => e.status !== 'cancelled' && e.content),
    [calendar.data],
  );
  const byDay = useMemo(() => groupByDay(entries, zone), [entries, zone]);
  const progress = useMemo(() => weekProgress(entries), [entries]);
  const thumbs = useContentThumbs(
    brandId,
    entries.map((e) => ({ id: e.content!.id, current_version: e.content!.current_version })),
  );
  const base = `/o/${orgId}/m/${brandId}`;

  return (
    <Section
      title="Esta semana"
      testId="home-week"
      badge={
        !calendar.isPending &&
        progress.total > 0 && (
          <span
            className={cn(
              'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
              progress.published === progress.total ? 'bg-success-soft text-success' : 'bg-subtle text-fg',
            )}
            data-testid="home-week-count"
          >
            {progress.published} de {progress.total}
            <span className="sr-only sm:not-sr-only"> publicadas</span>
          </span>
        )
      }
      action={
        <Link
          to={`${base}/calendario`}
          className="whitespace-nowrap text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Ver calendario
        </Link>
      }
    >
      {calendar.isPending ? (
        <Skeleton className="h-36" />
      ) : (
        <>
          <ol className="grid grid-cols-7 gap-1 sm:gap-2" aria-label="De lunes a domingo">
            {days.map((day) => {
              const list = byDay.get(day.key) ?? [];
              return (
                <li
                  key={day.key}
                  className={cn(
                    'flex min-w-0 flex-col gap-1 rounded-lg border p-1 sm:p-1.5',
                    day.today ? 'border-primary bg-primary-soft' : 'border-border bg-surface',
                    day.past && 'opacity-70',
                  )}
                  data-testid="home-day"
                  data-count={list.length}
                >
                  <span className="text-center text-[0.6875rem] leading-tight sm:text-xs">
                    <span className="block capitalize text-muted">{day.weekday}</span>
                    <span className="block text-sm font-semibold tabular-nums">{day.day}</span>
                  </span>
                  {list.length === 0 ? (
                    <span className="mx-auto block aspect-[4/5] w-full max-w-[4.5rem] rounded-md border border-dashed border-border" aria-hidden />
                  ) : (
                    <>
                      {list.slice(0, 2).map((entry) => (
                        <Link
                          key={entry.id}
                          to={contentPaths(orgId, brandId).item(entry.content!.id)}
                          aria-label={`${entry.content!.title}, ${shortDateTime(entry.scheduled_at, zone)}`}
                          className="mx-auto block aspect-[4/5] w-full max-w-[4.5rem] overflow-hidden rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          data-testid="home-week-piece"
                        >
                          <PieceThumbView thumb={thumbs.get(entry.content!.id)} format={entry.format} />
                        </Link>
                      ))}
                      {list.length > 2 && (
                        <span className="text-center text-xs text-muted">+{list.length - 2}</span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {entries.length === 0 && (
            <p className="mt-2 text-sm text-muted" data-testid="home-week-empty">
              No hay nada programado esta semana.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

/** Lo que no va a salir solo y por qué, con el botón que lo arregla. */
export function StalledList({ orgId, brandId, items, canFix }: { orgId: string; brandId: string; items: WithPiece[]; canFix: boolean }) {
  const accounts = useSocialAccounts(brandId);
  const zone = useBrandZone();
  const { selfManaged } = useWorkMode();
  const shown = items.slice(0, 3);
  return (
    <Section title="Parado" testId="home-stalled">
      <ul className="space-y-2">
        {shown.map(({ publication, piece }) => {
          const reason = publication.hold_reason;
          const advice = reason
            ? selfManagedAdvice(holdAdvice(reason, activeAccountOf(accounts.data, publication.network)), selfManaged)
            : null;
          const target = advice
            ? fixTarget(advice.fix, { orgId, brandId, contentId: publication.content_id })
            : { to: `/o/${orgId}/m/${brandId}/calendario`, label: 'Ver en el calendario' };
          const text = advice ? advice.short : 'No se pudo publicar';
          return (
            <li
              key={publication.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5"
              data-testid="home-stalled-item"
            >
              <span className="min-w-[10rem] flex-1">
                <span className="block truncate text-sm font-medium">{piece?.title ?? 'Pieza'}</span>
                <span className="block text-sm text-muted">
                  {text} · {shortDateTime(publication.scheduled_at, zone)}
                </span>
              </span>
              {target && canFix && (
                <Link
                  to={target.to}
                  className="inline-flex min-h-10 items-center rounded-lg bg-surface px-3 text-sm font-medium ring-1 ring-border hover:bg-subtle"
                  data-testid="home-stalled-fix"
                >
                  {target.label ?? advice?.label ?? 'Abrir'}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > shown.length && (
        <Link
          to={`/o/${orgId}/m/${brandId}/calendario`}
          className="mt-2 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          Y {items.length - shown.length} más en el calendario
        </Link>
      )}
    </Section>
  );
}

/** Las últimas publicaciones salidas, con su enlace a la red si lo hay. Las cifras solo salen si existen. */
export function LatestPublished({ orgId, brandId, items }: { orgId: string; brandId: string; items: PublishedWithFigures[] }) {
  const thumbs = useContentThumbs(
    brandId,
    items.flatMap((i) => (i.piece ? [{ id: i.piece.id, current_version: i.piece.current_version }] : [])),
  );
  return (
    <Section title="Lo último publicado" testId="home-published">
      <ul className="space-y-2">
        {items.map(({ publication, piece, figures }) => (
          <li
            key={publication.id}
            className="flex items-center gap-1 rounded-xl border border-border bg-surface"
            data-testid="home-published-item"
          >
            <Link
              to={contentPaths(orgId, brandId).item(publication.content_id)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 hover:bg-subtle"
            >
              <span className="block h-14 w-11 shrink-0 overflow-hidden rounded-md">
                <PieceThumbView thumb={piece ? thumbs.get(piece.id) : undefined} format={publication.format} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{piece?.title ?? 'Pieza'}</span>
                <span className="flex items-center gap-1 text-xs text-muted">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
                  {networkLabel(publication.network)} · {formatDate(publication.published_at ?? publication.scheduled_at)}
                </span>
              </span>
              {(figures.reach !== undefined || figures.interactions !== undefined) && (
                <span className="flex shrink-0 gap-3 text-right" data-testid="home-published-figures">
                  {figures.reach !== undefined && (
                    <span>
                      <span className="block text-sm font-semibold tabular-nums">{numberFormat.format(figures.reach)}</span>
                      <span className="block text-xs text-muted">personas</span>
                    </span>
                  )}
                  {figures.interactions !== undefined && (
                    <span>
                      <span className="block text-sm font-semibold tabular-nums">
                        {numberFormat.format(figures.interactions)}
                      </span>
                      <span className="block text-xs text-muted">reacciones</span>
                    </span>
                  )}
                </span>
              )}
            </Link>
            {publication.external_url && (
              <a
                href={publication.external_url}
                target="_blank"
                rel="noreferrer"
                className="mr-1 inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium text-primary hover:bg-subtle"
                data-testid="home-published-link"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                <span className="sr-only lg:not-sr-only">Ver en {networkLabel(publication.network)}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
