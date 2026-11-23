import { cleanText } from '@/lib/texts';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  Download,
  FileText,
  Film,
  Lightbulb,
  Link2,
  Minus,
  Ruler,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LinkButton,
  Notice,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';
import { AiErrorNotice } from '@/features/ai/AiErrorNotice';
import { networkLabel } from '@/features/content/labels';
import { summarizeAnalytics, type AnalyticsSummaryResult } from '@/features/ai/api';
import { useSignedUrls } from '@/features/library/api';
import { useBrand, useOrg } from '@/features/orgs/context';
import { connectedAccountsPath } from '@/features/social/links';
import { useWorkspaceMode } from '@/layout/workspace';
import type { AnalyticsReportStatus } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  analyze,
  dailySeries,
  formatNumber,
  formatPct,
  lastDays,
  monthPeriod,
  previousPeriod,
  type Analysis,
  type MediaSummary,
  type Period,
  type RankedPost,
} from '../../../supabase/functions/_shared/analytics/analyst';
import {
  latestUnavailable,
  reportDownloadUrl,
  useAccountPoints,
  useAnalyticsAccounts,
  useCaptureRuns,
  useMediaSummary,
  useMetricDefinitions,
  usePostMedia,
  useReports,
  useRequestReport,
} from './api';
import {
  dayLabel,
  footnote,
  headlineSentence,
  periodText,
  pickHeadlines,
  RANGES,
  secondaryFigures,
  topPosts,
  type Headline,
  type RangeKey,
} from './summary';
import { DailyTable, TrendChart } from './TrendChart';
import { useTextTask } from '@/features/platform/integrations/useFeature';

const isoToday = () => new Date().toISOString().slice(0, 10);

function periodFor(key: RangeKey): Period {
  if (key === 'last7') return lastDays(7);
  if (key === 'last28') return lastDays(28);
  const thisMonth = monthPeriod(isoToday());
  return key === 'thisMonth' ? thisMonth : previousPeriod(thisMonth);
}

const shortDate = (day: string) => day.split('-').reverse().join('/');
const monthLabel = (day: string) =>
  new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

const REPORT_STATUS: Record<
  AnalyticsReportStatus,
  { label: string; tone: 'neutral' | 'primary' | 'success' | 'danger' }
> = {
  queued: { label: 'Preparando las cifras', tone: 'neutral' },
  rendering: { label: 'Dibujando el PDF', tone: 'primary' },
  ready: { label: 'Listo', tone: 'success' },
  failed: { label: 'Falló', tone: 'danger' },
};

/**
 * Resultados de la marca (antes «Analítica»). De un vistazo: la frase del periodo, tres cifras
 * grandes, un gráfico, las tres mejores piezas y una sola nota al pie sobre las cifras. Todo lo
 * demás (veces que te han visto, día a día, comparación, resumen del analista, lo que no se puede
 * medir, informes) queda plegado en «Más detalle».
 */
export function AnalyticsPage() {
  useWorkspaceMode();
  const { org } = useOrg();
  const { brand, can } = useBrand();
  const aiText = useTextTask('analytics.summary');
  const [range, setRange] = useState<RangeKey>('last28');
  const period = useMemo(() => periodFor(range), [range]);
  const previous = useMemo(() => previousPeriod(period), [period]);

  const definitions = useMetricDefinitions();
  const points = useAccountPoints(brand.id, previous.from, period.to);
  const media = useMediaSummary(brand.id, period);
  const previousMedia = useMediaSummary(brand.id, previous);
  const accounts = useAnalyticsAccounts(brand.id);
  const runs = useCaptureRuns(brand.id);
  const queries = [definitions, points, media, previousMedia, accounts, runs];

  const analysis = useMemo<Analysis | null>(() => {
    if (!definitions.data || !points.data || !media.data || !previousMedia.data || !accounts.data || !runs.data)
      return null;
    return analyze({
      definitions: definitions.data,
      points: points.data,
      media: media.data,
      previousMedia: previousMedia.data,
      period,
      previous,
      unavailable: latestUnavailable(runs.data),
      accounts: accounts.data,
    });
  }, [definitions.data, points.data, media.data, previousMedia.data, accounts.data, runs.data, period, previous]);

  const failed = queries.find((q) => q.error);
  // Sin cuenta no hay nada que medir: ni periodo ni informes, solo el botón para conectarla.
  const hasAccount = Boolean(accounts.data?.length);
  const needsReconnect = (accounts.data ?? []).some((a) => a.status !== 'active');
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        compact
        title="Resultados"
        meta={hasAccount && analysis ? <span>{`Del ${periodText(period)}`}</span> : undefined}
        action={
          hasAccount && (
            <Select
              aria-label="Periodo"
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              data-testid="analytics-range"
            >
              {Object.entries(RANGES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          )
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2 pr-1" data-testid="analytics-scroll">
        {failed ? (
          <ErrorState error={failed.error} onRetry={() => queries.forEach((q) => void q.refetch())} />
        ) : !analysis ? (
          <Skeleton className="h-64" />
        ) : !accounts.data?.length ? (
          <Card>
            <EmptyState
              icon={BarChart3}
              title="Todavía no hay nada que medir"
              description={
                can('manage')
                  ? 'Conecta Instagram: las primeras cifras llegan al día siguiente.'
                  : 'Cuando se conecte Instagram, las cifras llegarán al día siguiente.'
              }
              action={
                can('manage') && (
                  <LinkButton to={connectedAccountsPath(org.id, brand.id)} size="md" data-testid="analytics-connect">
                    <Link2 className="h-4 w-4" aria-hidden />
                    Conectar Instagram
                  </LinkButton>
                )
              }
            />
          </Card>
        ) : (
          <>
            {needsReconnect && (
              <Notice tone="warning">
                Hay que volver a conectar la cuenta de Instagram para que lleguen cifras nuevas.{' '}
                {can('manage') ? (
                  <a className="font-medium underline" href={connectedAccountsPath(org.id, brand.id)}>
                    Volver a conectarla
                  </a>
                ) : (
                  'Pídeselo a quien gestiona la marca.'
                )}
              </Notice>
            )}
            <Overview
              analysis={analysis}
              points={points.data ?? []}
              media={media.data ?? []}
              range={range}
              brandId={brand.id}
            />
            <details className="group rounded-xl border border-border bg-surface shadow-card" data-testid="analytics-more">
              <summary className="flex min-h-[2.75rem] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <span>Más detalle</span>
                <span className="flex items-center gap-1 text-xs font-normal text-muted">
                  <span className="hidden sm:inline">Veces que te han visto, día a día, comparación e informes</span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
                </span>
              </summary>
              <div className="space-y-6 border-t border-border p-4">
                <MoreFigures analysis={analysis} points={points.data ?? []} />
                <p className="text-sm text-muted">
                  Comparado con {periodText(previous)}. Los días van en hora universal (una o dos horas menos que en
                  España).
                </p>
                <Comparison analysis={analysis} />
                <Posts analysis={analysis} />
                <Summary
                  analysis={analysis}
                  brandId={brand.id}
                  period={period}
                  aiAvailable={aiText && brand.ai_mode !== 'agency' && can('edit')}
                />
                <Unmeasurable analysis={analysis} />
                <Captures runs={runs.data ?? []} />
                <Reports brandId={brand.id} canEdit={can('edit')} />
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

/** Variación frente al periodo anterior: con flecha y signo, nunca solo con el color. */
function Change({ total }: { total: Headline }) {
  // Sin con qué comparar no se dice nada en la cifra: lo explica la nota al pie.
  if (total.changePct === null) return null;
  const up = total.changePct > 0;
  const down = total.changePct < 0;
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus;
  return (
    <Badge tone={up ? 'success' : down ? 'danger' : 'neutral'}>
      <Icon className="h-3 w-3" aria-hidden />
      {formatPct(total.changePct)}
    </Badge>
  );
}

function Overview({
  analysis,
  points,
  media,
  range,
  brandId,
}: {
  analysis: Analysis;
  points: Parameters<typeof dailySeries>[0];
  media: MediaSummary[];
  range: RangeKey;
  brandId: string;
}) {
  const headlines = useMemo(() => pickHeadlines(analysis.totals), [analysis.totals]);
  const sentence = headlineSentence(analysis.totals, range);
  const [metric, setMetric] = useState('');
  const selected = headlines.find((h) => h.metricId === metric) ?? headlines[0];
  if (!headlines.length || !selected) {
    return (
      <div className="space-y-4">
        <Notice>
          Todavía no hay cifras de la cuenta en este periodo. Llegan una vez al día: vuelve mañana o elige otro
          periodo.
        </Notice>
        <BestPosts analysis={analysis} media={media} brandId={brandId} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {sentence && (
        <p className="text-lg font-medium leading-snug sm:text-xl" data-testid="analytics-sentence">
          {sentence}
        </p>
      )}
      <div
        className="grid grid-cols-3 gap-2 sm:gap-3"
        role="group"
        aria-label="Cifras del periodo: elige una para verla en el gráfico"
        data-testid="analytics-kpis"
      >
        {headlines.map((t) => {
          const on = t.metricId === selected.metricId;
          return (
            <button
              key={t.metricId}
              type="button"
              aria-pressed={on}
              onClick={() => setMetric(t.metricId)}
              data-testid={`kpi-${t.metricId}`}
              className={cn(
                'flex min-w-0 flex-col justify-start rounded-xl border bg-surface p-2.5 text-left shadow-card transition-colors sm:p-4',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                on ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-subtle',
              )}
            >
              <span lang="es" className="block break-words text-xs leading-tight text-muted [hyphens:auto] sm:text-sm">
                {t.plainLabel}
              </span>
              <span className="mt-0.5 block truncate text-2xl font-semibold tabular-nums sm:text-3xl">
                {formatNumber(t.value!)}
              </span>
              {t.changePct !== null && (
                <span className="mt-1 flex">
                  <Change total={t} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="min-w-0 p-4">
          <TrendChart
            title={selected.plainLabel}
            points={dailySeries(points, selected.metricId, analysis.period)}
            testId="analytics-chart"
          />
        </Card>
        <BestPosts analysis={analysis} media={media} brandId={brandId} />
      </div>
      <p className="text-xs text-muted" data-testid="analytics-footnote">
        {footnote(headlines, range)}
      </p>
    </div>
  );
}

/** En «Más detalle»: las cifras que no van arriba («Veces que te han visto») y todas, día a día. */
function MoreFigures({ analysis, points }: { analysis: Analysis; points: Parameters<typeof dailySeries>[0] }) {
  const extra = secondaryFigures(analysis.totals);
  const series = [...pickHeadlines(analysis.totals), ...extra]
    .filter((h) => h.aggregation === 'daily')
    .map((h) => ({ title: h.plainLabel, points: dailySeries(points, h.metricId, analysis.period) }));
  return (
    <div className="space-y-3">
      {extra.length > 0 && (
        <ul className="flex flex-wrap gap-x-6 gap-y-2" data-testid="analytics-more-figures">
          {extra.map((t) => (
            <li key={t.metricId}>
              <span className="block text-sm text-muted">{t.plainLabel}</span>
              <span className="block text-xl font-semibold tabular-nums">{formatNumber(t.value!)}</span>
            </li>
          ))}
        </ul>
      )}
      {series.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-fg">Cifras día a día</summary>
          <div className="mt-2">
            <DailyTable series={series} testId="analytics-daily" />
          </div>
        </details>
      )}
    </div>
  );
}

const scoreText = (p: RankedPost) =>
  p.scoreMetric.endsWith('total_interactions')
    ? `${formatNumber(p.score)} ${p.score === 1 ? 'interacción' : 'interacciones'}`
    : `Llegó a ${formatNumber(p.score)} ${p.score === 1 ? 'persona' : 'personas'}`;

/** Las tres piezas que mejor han ido, con su miniatura. Sin ninguna con cifras, lo dice en una línea. */
function BestPosts({ analysis, media, brandId }: { analysis: Analysis; media: MediaSummary[]; brandId: string }) {
  const best = useMemo(() => topPosts(media, 3), [media]);
  const ids = best.flatMap((p) => (p.publication_id ? [p.publication_id] : []));
  const postMedia = usePostMedia(brandId, ids);
  const paths = useMemo(
    () => [...(postMedia.data?.values() ?? [])].filter((m) => !m.video).map((m) => m.path),
    [postMedia.data],
  );
  const urls = useSignedUrls(paths, { variant: 'thumb' });
  return (
    <Card className="p-4">
      <h2 className="text-base font-semibold">Lo que mejor funcionó</h2>
      {best.length === 0 ? (
        <p className="mt-2 text-sm text-muted" data-testid="analytics-no-posts">
          {analysis.posts.count === 0
            ? 'Todavía no has publicado desde aquí en este periodo.'
            : 'Las cifras de cada publicación tardan en llegar.'}
        </p>
      ) : (
        <ol className="mt-3 space-y-3" data-testid="analytics-top-posts">
          {best.map((p) => {
            const media = p.publication_id ? postMedia.data?.get(p.publication_id) : undefined;
            const url = media && !media.video ? urls.data?.get(media.path) : undefined;
            return (
              <li key={`${p.publication_id}-${p.title}`} className="flex items-center gap-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-subtle text-muted">
                  {url ? (
                    <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <Film className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="text-xs text-muted">
                    {p.media_product_type === 'REELS' ? 'Reel' : 'Publicación'} · {dayLabel(p.published_at.slice(0, 10))}
                    {p.manual && ' · publicada a mano'}
                    {p.external_url && (
                      <>
                        {' · '}
                        <a href={p.external_url} target="_blank" rel="noreferrer" className="underline">
                          Ver en {networkLabel(p.network)}
                        </a>
                      </>
                    )}
                  </p>
                  <p className="text-sm tabular-nums">{scoreText(p)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Comparison({ analysis }: { analysis: Analysis }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Comparación entre periodos"
          description="Este periodo frente al anterior de la misma duración."
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="analytics-comparison">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Métrica</th>
                <th className="py-1 text-right font-medium">Ahora</th>
                <th className="py-1 text-right font-medium">Antes</th>
                <th className="py-1 text-right font-medium">Cambio</th>
              </tr>
            </thead>
            <tbody>
              {analysis.totals.map((t) => (
                <tr key={t.metricId} className="border-t border-border">
                  <td className="py-1.5">{t.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{t.value === null ? '—' : formatNumber(t.value)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {t.previous === null ? '—' : formatNumber(t.previous)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {t.changePct === null ? '—' : formatPct(t.changePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">«—»: no hay cifra (no se trata como cero).</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Comparación entre redes" />
        <CardBody>
          <ul className="space-y-3" data-testid="analytics-networks">
            {analysis.byNetwork.map((n) => (
              <li key={n.network}>
                <p className="font-medium">{n.label}</p>
                {n.measured ? (
                  <p className="text-sm text-muted">
                    {n.totals
                      .filter((t) => t.value !== null)
                      .slice(0, 4)
                      .map((t) => `${t.label}: ${formatNumber(t.value!)}`)
                      .join(' · ')}
                  </p>
                ) : (
                  <p className="text-sm text-muted">{n.note}</p>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function PostList({ posts, testId }: { posts: RankedPost[]; testId: string }) {
  if (!posts.length) return <p className="text-sm text-muted">No hay publicaciones suficientes para comparar.</p>;
  return (
    <ol className="space-y-2" data-testid={testId}>
      {posts.map((p) => (
        <li key={`${p.publication_id}-${p.title}`} className="flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{p.title}</p>
            <p className="text-xs text-muted">
              {p.media_product_type === 'REELS' ? 'Reel' : 'Imagen o carrusel'} ·{' '}
              {shortDate(p.published_at.slice(0, 10))}
              {p.manual && ' · publicada a mano'}
              {p.external_url && (
                <>
                  {' · '}
                  <a href={p.external_url} target="_blank" rel="noreferrer" className="underline">
                    Ver en {networkLabel(p.network)}
                  </a>
                </>
              )}
            </p>
          </div>
          <span className="shrink-0 tabular-nums">
            {formatNumber(p.score)} {p.scoreMetric.endsWith('total_interactions') ? 'interacciones' : 'de alcance'}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Posts({ analysis }: { analysis: Analysis }) {
  const { posts, byFormat } = analysis;
  return (
    <Card>
      <CardHeader
        title="Publicaciones"
        description={`Hechas con la plataforma en el periodo: ${posts.count} (antes: ${posts.previousCount}). Cifras acumuladas de cada una hasta su última captura.`}
      />
      <CardBody className="grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="mb-2 text-sm font-medium">Mejores</h3>
          <PostList posts={posts.best} testId="analytics-best-posts" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">Con menos respuesta</h3>
          <PostList posts={posts.worst} testId="analytics-worst-posts" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">Por formato</h3>
          <ul className="space-y-1 text-sm">
            {byFormat.map((f) => (
              <li key={f.format}>
                {f.label}: {f.posts}
                {f.avgInteractions !== null && ` · ${formatNumber(f.avgInteractions)} interacciones de media`}
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}

function Summary({
  analysis,
  brandId,
  period,
  aiAvailable,
}: {
  analysis: Analysis;
  brandId: string;
  period: Period;
  aiAvailable: boolean;
}) {
  const [ai, setAi] = useState<AnalyticsSummaryResult | null>(null);
  const [aiError, setAiError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const factText = new Map(analysis.facts.map((f) => [f.id, f.text]));
  const askAi = async () => {
    setBusy(true);
    setAiError(null);
    try {
      setAi(await summarizeAnalytics(brandId, period));
    } catch (error) {
      setAiError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Resumen del analista"
        description="Lo que dicen las cifras y lo que podría explicarlas."
        action={
          aiAvailable && analysis.hasData ? (
            <Button variant="secondary" onClick={() => void askAi()} disabled={busy} data-testid="analytics-ai">
              <Sparkles className="h-4 w-4" aria-hidden />
              {busy ? 'Interpretando…' : 'Interpretar con IA'}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-5">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Ruler className="h-4 w-4" aria-hidden /> Datos
          </h3>
          <ul className="space-y-1.5 text-sm" data-testid="analytics-facts">
            {analysis.facts.map((f) => (
              <li key={f.id} className="flex gap-2">
                <Badge>Dato</Badge>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="h-4 w-4" aria-hidden /> Interpretaciones
          </h3>
          <ul className="space-y-1.5 text-sm" data-testid="analytics-hypotheses">
            {analysis.hypotheses.length === 0 && (
              <li className="text-muted">
                Con estas cifras no hay ninguna interpretación que merezca la pena proponer.
              </li>
            )}
            {analysis.hypotheses.map((h) => (
              <li key={h.id} className="flex gap-2">
                <Badge tone="warning">Interpretación</Badge>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-3 space-y-1 text-xs text-muted" data-testid="analytics-caveats">
            {analysis.caveats.map((c) => (
              <li key={c}>· {c}</li>
            ))}
          </ul>
        </section>
        {aiError ? <AiErrorNotice error={aiError} onRetry={() => void askAi()} /> : null}
        {ai && (
          <section data-testid="analytics-ai-hypotheses">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" aria-hidden /> Interpretaciones propuestas por la IA
            </h3>
            <p className="mb-2 text-xs text-muted">
              La IA solo ha recibido los datos de arriba. Lo que propone son interpretaciones, no cifras ni
              conclusiones.
              {ai.discarded > 0 && ` Se han descartado ${ai.discarded} por no apoyarse en ningún dato.`}
            </p>
            {ai.hypotheses.length === 0 ? (
              <p className="text-sm text-muted">La IA no ha encontrado ninguna interpretación útil con estos datos.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {ai.hypotheses.map((h) => (
                  <li key={h.id}>
                    <div className="flex gap-2">
                      <Badge tone="warning">Interpretación (IA)</Badge>
                      <span>{h.text}</span>
                    </div>
                    <p className="ml-1 mt-0.5 text-xs text-muted">
                      Se apoya en: {h.basedOn.map((id) => factText.get(id) ?? id).join(' / ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </CardBody>
    </Card>
  );
}

/** Una línea por métrica: si la misma (p. ej. «Impresiones», de la cuenta y de las publicaciones) sale dos veces, se juntan sus motivos. */
function groupUnmeasurable(list: Analysis['unmeasurable']): Array<{ id: string; label: string; reason: string }> {
  const byLabel = new Map<string, { id: string; label: string; reasons: string[] }>();
  for (const u of list) {
    const label = cleanText(u.label);
    const reason = cleanText(u.reason);
    const found = byLabel.get(label);
    if (!found) byLabel.set(label, { id: u.id, label, reasons: reason ? [reason] : [] });
    else if (reason && !found.reasons.includes(reason)) found.reasons.push(reason);
  }
  return [...byLabel.values()].map((g) => ({ id: g.id, label: g.label, reason: g.reasons.join(' ') }));
}

function Unmeasurable({ analysis }: { analysis: Analysis }) {
  return (
    <Card>
      <CardHeader
        title="Lo que no se puede medir"
        description="Métricas que la red no da, que retiró o que todavía no tienen cifra."
      />
      <CardBody>
        <ul className="space-y-1.5 text-sm" data-testid="analytics-unmeasurable">
          {groupUnmeasurable(analysis.unmeasurable).map((u) => (
            <li key={u.id}>
              <strong className="font-medium">{u.label}:</strong> <span className="text-muted">{u.reason}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

const RUN_LABEL = { succeeded: 'Completa', partial: 'Parcial', failed: 'Fallida', skipped: 'Sin medir' } as const;

function Captures({ runs }: { runs: Parameters<typeof latestUnavailable>[0] }) {
  const latest = runs.filter((r, i) => runs.findIndex((x) => x.social_account_id === r.social_account_id) === i);
  return (
    <p className="text-xs text-muted" data-testid="analytics-captures">
      {latest.length === 0
        ? 'Todavía no se ha recogido ninguna cifra: las primeras llegan en menos de una hora.'
        : latest
            .map(
              (r) =>
                `Última captura: ${new Date(r.finished_at).toLocaleString('es-ES')} (${RUN_LABEL[r.status]}${r.error_message ? `: ${r.error_message}` : ''})`,
            )
            .join(' · ')}
    </p>
  );
}

function Reports({ brandId, canEdit }: { brandId: string; canEdit: boolean }) {
  const reports = useReports(brandId);
  const request = useRequestReport(brandId);
  const months = useMemo(() => {
    const out: string[] = [];
    let p = previousPeriod(monthPeriod(isoToday()));
    for (let i = 0; i < 12; i++) {
      out.push(p.from);
      p = previousPeriod(p);
    }
    return out;
  }, []);
  const [month, setMonth] = useState(months[0]!);
  const download = async (path: string) => {
    try {
      window.open(await reportDownloadUrl(path), '_blank', 'noopener');
    } catch (error) {
      toast.error(translateError(error));
    }
  };
  return (
    <Card>
      <CardHeader
        title="Informes mensuales"
        description="Se generan solos el día 3 de cada mes con el mes anterior y quedan en la biblioteca (carpeta «Informes»)."
        action={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Mes del informe" value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={request.isPending}
                data-testid="analytics-request-report"
                onClick={async () => {
                  try {
                    await request.mutateAsync(month);
                    toast.success('Informe pedido: estará en unos minutos.');
                  } catch (error) {
                    toast.error(translateError(error));
                  }
                }}
              >
                <FileText className="h-4 w-4" aria-hidden />
                Generar informe
              </Button>
            </div>
          ) : undefined
        }
      />
      <CardBody>
        {reports.error ? (
          <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
        ) : !reports.data ? (
          <Skeleton className="h-16" />
        ) : reports.data.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay informes.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="analytics-reports">
            {reports.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium first-letter:uppercase">{monthLabel(r.period_start)}</p>
                  <p className="text-xs text-muted">
                    {r.source === 'schedule' ? 'Automático' : 'Pedido a mano'}
                    {r.revision > 1 && ` · versión ${r.revision}`}
                    {r.error && ` · ${r.error}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={REPORT_STATUS[r.status].tone}>{REPORT_STATUS[r.status].label}</Badge>
                  {r.status === 'ready' && r.asset && (
                    <Button
                      variant="secondary"
                      onClick={() => void download(r.asset!.storage_path)}
                      data-testid="analytics-download"
                    >
                      <Download className="h-4 w-4" aria-hidden />
                      Descargar PDF
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
