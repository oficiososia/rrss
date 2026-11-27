import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui';
import { lastPeriods, periodStartOf } from '@/features/ai/api';
import { formatMicros, moneyEstimateNote } from '@/features/ai/money';
import { useUser } from '@/features/auth/AuthProvider';
import { useIsPlatformAdmin } from '@/features/orgs/api';
import { useInternalUseState } from '@/features/orgs/workMode';
import { UserMenu } from '@/layout/AppShell';
import { cn, formatBytes } from '@/lib/utils';
import { toast } from 'sonner';
import { translateError } from '@/lib/errors';
import type { PriceStatus } from '@/lib/database.types';
import { Button } from '@/components/ui';
import { useAiGlobalStatus, usePlatformStorage, usePlatformUsage, usePriceReview, useWorkerCheck } from './api';
import { AlertsPanel } from './AlertsPanel';
import { formatSeconds, percentText, severityOf, usageRatio } from './usage';

const count = new Intl.NumberFormat('es-ES');

function monthLabel(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

function Bar({ ratio, label }: { ratio: number | null; label: string }) {
  if (ratio === null) return null;
  const severity = severityOf(ratio);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(ratio * 100))}
      className="h-1.5 w-24 overflow-hidden rounded-full bg-subtle"
    >
      <div
        className={cn(
          'h-full rounded-full',
          severity === 'danger' ? 'bg-danger' : severity === 'warning' ? 'bg-warning' : 'bg-primary',
        )}
        style={{ width: `${Math.min(1, ratio) * 100}%` }}
      />
    </div>
  );
}

/** Plataforma → «Gasto y uso»: IA por organización y tipo, trabajador de medios, almacenamiento y cupo (solo superadministradores). */
export function GastoPage({ now = new Date() }: { now?: Date }) {
  const user = useUser();
  const admin = useIsPlatformAdmin(user.id);
  const periods = useMemo(() => lastPeriods(now, 6), [now]);
  const [period, setPeriod] = useState(periodStartOf(now));
  const enabled = admin.data === true;
  const usage = usePlatformUsage(period, enabled);
  const storage = usePlatformStorage(enabled);
  const global = useAiGlobalStatus(enabled);
  // Uso interno: se ve el gasto real; los cupos y los planes de cada organización, no.
  const { internal, pending: modePending } = useInternalUseState();

  return (
    <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10">
      <div className="mb-6 flex items-center justify-between">
        <Link
          to="/plataforma"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a Plataforma
        </Link>
        <UserMenu compact />
      </div>
      <main>
        {admin.isPending || modePending ? (
          <Spinner />
        ) : !enabled ? (
          <Card>
            <EmptyState
              icon={ShieldCheck}
              title="Zona reservada"
              description="Esta sección es solo para los administradores de la plataforma."
            />
          </Card>
        ) : (
          <div className="space-y-6" data-testid="gasto-page">
            <PageHeader
              title="Gasto y uso"
              description="Cuánto gasta cada organización en IA, qué usa del trabajador de medios y cuánto almacena."
              action={
                <Field label="Mes">
                  {(p) => (
                    <Select
                      {...p}
                      value={period}
                      onChange={(e) => setPeriod(e.target.value)}
                      data-testid="gasto-period"
                    >
                      {periods.map((value) => (
                        <option key={value} value={value}>
                          {monthLabel(value)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              }
            />
            <GlobalCard status={global} internal={internal} />
            <AlertsPanel />
            <AiTable usage={usage} internal={internal} />
            <PriceCard period={period} internal={internal} />
            <MediaTable usage={usage} />
            <StorageTable usage={usage} storage={storage} internal={internal} />
            <p className="text-xs text-muted">{moneyEstimateNote()}</p>
          </div>
        )}
      </main>
    </div>
  );
}

function GlobalCard({ status, internal }: { status: ReturnType<typeof useAiGlobalStatus>; internal: boolean }) {
  return (
    <Card data-testid="gasto-global">
      <CardHeader
        title="Tope global del mes"
        description="El tope se fija en Integraciones → IA de texto («Tope global de gasto mensual»). Al alcanzarlo se pausa la IA de pago de todas las organizaciones; lo que no cuesta sigue igual."
      />
      <CardBody>
        {status.isPending ? (
          <Spinner />
        ) : status.isError ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : status.data.cap_micros === null ? (
          <p className="text-sm text-muted" data-testid="gasto-global-none">
            Sin tope: la plataforma lleva gastados {formatMicros(Number(status.data.cost_micros))} este mes
            {internal ? '.' : ' y solo la frena el cupo de cada organización.'}
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="tabular-nums" data-testid="gasto-global-figures">
              {formatMicros(Number(status.data.committed_micros))} de {formatMicros(Number(status.data.cap_micros))} (
              {percentText(usageRatio(Number(status.data.committed_micros), Number(status.data.cap_micros)))})
            </p>
            <Bar
              ratio={usageRatio(Number(status.data.committed_micros), Number(status.data.cap_micros))}
              label="Tope global"
            />
            {status.data.paused && (
              <Notice tone="warning">
                <span data-testid="gasto-global-paused">
                  La IA de pago está en pausa hasta el mes que viene o hasta que amplíes el tope.
                </span>
              </Notice>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AiTable({ usage, internal }: { usage: ReturnType<typeof usePlatformUsage>; internal: boolean }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="IA por organización"
        description={
          internal
            ? 'Coste real del mes por tipo de generación.'
            : 'Coste real del mes por tipo de generación y cupo comprometido (coste más reservas en curso).'
        }
      />
      {usage.isPending ? (
        <CardBody>
          <Spinner />
        </CardBody>
      ) : usage.isError ? (
        <CardBody>
          <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm" data-testid="gasto-ai">
            <caption className="sr-only">Gasto de IA por organización</caption>
            <thead className="border-y border-border bg-subtle text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Organización
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Texto
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Imagen
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Vídeo
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Transcripción
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Total
                </th>
                {!internal && (
                  <th scope="col" className="px-5 py-3 font-medium">
                    Cupo consumido
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usage.data.map((row) => {
                const ratio = usageRatio(Number(row.ai_committed_micros), Number(row.ai_limit_micros));
                const severity = severityOf(ratio);
                return (
                  <tr key={row.organization_id} data-testid={`gasto-ai-${row.organization_id}`}>
                    <th scope="row" className="px-5 py-3 font-medium">
                      {row.organization_name}
                      {!internal && (
                        <>
                          <span className="block text-xs font-normal text-muted">{row.plan_name}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {row.ai_limit_overridden && (
                              <span data-testid={`gasto-manual-${row.organization_id}`}>
                                <Badge tone="warning">Cupo puesto a mano</Badge>
                              </span>
                            )}
                            {row.plan_unlimited && (
                              <span data-testid={`gasto-unlimited-${row.organization_id}`}>
                                <Badge tone="warning">Plan sin límites</Badge>
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMicros(Number(row.cost_text_micros))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMicros(Number(row.cost_image_micros))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMicros(Number(row.cost_video_micros))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMicros(Number(row.cost_transcription_micros))}
                    </td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">
                      {formatMicros(Number(row.ai_cost_micros))}
                    </td>
                    {!internal && (
                      <td className="px-5 py-3">
                        {Number(row.ai_limit_micros) > 0 ? (
                          <div className="space-y-1">
                            <span className="tabular-nums" data-testid={`gasto-quota-${row.organization_id}`}>
                              {formatMicros(Number(row.ai_committed_micros))} de{' '}
                              {formatMicros(Number(row.ai_limit_micros))} · {percentText(ratio)}
                            </span>
                            <Bar ratio={ratio} label={`Cupo de ${row.organization_name}`} />
                            {severity !== 'ok' && (
                              <Badge tone={severity === 'danger' ? 'danger' : 'warning'}>
                                {severity === 'danger' ? 'Agotado' : 'Más del 80 %'}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted">Sin cupo</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function WorkerMachineCheck() {
  const check = useWorkerCheck();
  const data = check.data;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Button
        size="sm"
        variant="secondary"
        loading={check.isPending}
        onClick={() => check.mutate(undefined, { onError: (e) => toast.error(translateError(e)) })}
        data-testid="worker-check"
      >
        Comprobar la máquina de Fly
      </Button>
      {data && (
        <span data-testid="worker-check-result" className={cn(data.tooLong && 'font-medium text-danger')}>
          {!data.known
            ? (data.problem ?? 'No se sabe.')
            : data.tooLong
              ? `Encendida desde hace unas ${Math.floor(data.hours ?? 0)} horas: demasiado. Se ha dejado un aviso.`
              : data.state === 'started'
                ? `Encendida${data.hours != null ? ` desde hace ${formatSeconds(data.hours * 3600)}` : ''}: normal si hay trabajo.`
                : `Parada (estado «${data.state}»): bien, no gasta.`}
        </span>
      )}
    </div>
  );
}

function MediaTable({ usage }: { usage: ReturnType<typeof usePlatformUsage> }) {
  const rows = (usage.data ?? []).filter((r) => Number(r.media_jobs) > 0);
  const untimed = rows.reduce((sum, r) => sum + Number(r.media_jobs_without_timings), 0);
  const seconds = rows.reduce((sum, r) => sum + Number(r.media_machine_seconds), 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Trabajador de medios"
        description="Trabajos del mes y segundos de máquina estimados con los tiempos que guarda cada trabajo en jobs.result (descarga, proceso y subida)."
        action={<WorkerMachineCheck />}
      />
      {usage.isPending ? (
        <CardBody>
          <Spinner />
        </CardBody>
      ) : rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted" data-testid="gasto-media-empty">
            Este mes no ha habido trabajos de medios.
          </p>
        </CardBody>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm" data-testid="gasto-media">
              <caption className="sr-only">Uso del trabajador de medios por organización</caption>
              <thead className="border-y border-border bg-subtle text-xs text-muted">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Organización
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Trabajos
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Hechos
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Fallidos
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    En curso
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Máquina (estimada)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.organization_id}>
                    <th scope="row" className="px-5 py-3 font-medium">
                      {r.organization_name}
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums">{count.format(Number(r.media_jobs))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {count.format(Number(r.media_jobs_succeeded))}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-3 text-right tabular-nums',
                        Number(r.media_jobs_failed) > 0 && 'text-danger',
                      )}
                    >
                      {count.format(Number(r.media_jobs_failed))}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{count.format(Number(r.media_jobs_active))}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {formatSeconds(Number(r.media_machine_seconds))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody>
            <p className="text-xs text-muted" data-testid="gasto-media-total">
              Total estimado: {formatSeconds(seconds)}.
              {untimed > 0 &&
                ` ${untimed} trabajo${untimed === 1 ? ' hecho no guardó tiempos y no cuenta' : 's hechos no guardaron tiempos y no cuentan'}: la cifra se queda corta.`}{' '}
              Es el tiempo de trabajo del proceso, no la factura de Fly (que incluye arranque y espera).
            </p>
          </CardBody>
        </>
      )}
    </Card>
  );
}

function StorageTable({
  usage,
  storage,
  internal,
}: {
  usage: ReturnType<typeof usePlatformUsage>;
  storage: ReturnType<typeof usePlatformStorage>;
  internal: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Almacenamiento"
        description={
          internal
            ? 'Por organización y por marca (biblioteca y fuentes).'
            : 'Por organización frente al límite de su plan, y por marca (biblioteca y fuentes).'
        }
      />
      {usage.isPending || storage.isPending ? (
        <CardBody>
          <Spinner />
        </CardBody>
      ) : usage.isError || storage.isError ? (
        <CardBody>
          <ErrorState
            error={usage.error ?? storage.error}
            onRetry={() => {
              void usage.refetch();
              void storage.refetch();
            }}
          />
        </CardBody>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm" data-testid="gasto-storage">
            <caption className="sr-only">Almacenamiento por organización y marca</caption>
            <thead className="border-y border-border bg-subtle text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Organización / marca
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Recursos
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  En R2
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Trabajos de medios este mes
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Ocupa
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usage.data.flatMap((org) => {
                const limit = org.storage_limit_bytes === null ? null : Number(org.storage_limit_bytes);
                const ratio = usageRatio(Number(org.storage_bytes), limit);
                const brands = storage.data.filter((b) => b.organization_id === org.organization_id);
                return [
                  <tr key={org.organization_id} className="bg-subtle/50">
                    <th scope="row" colSpan={4} className="px-5 py-3 font-medium">
                      {org.organization_name}
                    </th>
                    <td
                      className={cn('px-5 py-3 text-right tabular-nums', severityOf(ratio) !== 'ok' && 'text-warning')}
                      data-testid={`gasto-storage-${org.organization_id}`}
                    >
                      {formatBytes(Number(org.storage_bytes))}
                      {internal
                        ? ''
                        : limit !== null
                          ? ` de ${formatBytes(limit)} (${percentText(ratio)})`
                          : ' (sin límite)'}
                    </td>
                  </tr>,
                  ...brands.map((b) => (
                    <tr key={b.brand_id}>
                      <th scope="row" className="py-2 pl-9 pr-3 font-normal">
                        {b.brand_name}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">{count.format(Number(b.assets))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatBytes(Number(b.r2_bytes))}</td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          b.media_jobs_cap !== null &&
                            Number(b.media_jobs_month) >= Number(b.media_jobs_cap) &&
                            'text-danger',
                        )}
                        data-testid={`gasto-jobs-${b.brand_id}`}
                      >
                        {count.format(Number(b.media_jobs_month))}
                        {b.media_jobs_cap !== null ? ` de ${count.format(Number(b.media_jobs_cap))}` : ' (sin tope)'}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums">{formatBytes(Number(b.bytes))}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const PRICE_LABEL: Record<PriceStatus, { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  verified: { text: 'Verificado', tone: 'success' },
  unverified: { text: 'Sin verificar', tone: 'danger' },
  unknown: { text: 'No está en el registro', tone: 'danger' },
  simulated: { text: 'Precio del simulador', tone: 'danger' },
  unconfirmed: { text: 'Cargado, sin contrastar', tone: 'warning' },
  no_price: { text: 'Sin precio', tone: 'danger' },
};

function PriceCard({ period, internal }: { period: string; internal: boolean }) {
  const prices = usePriceReview(period);
  const bad = (prices.data ?? []).filter((r) => r.status !== 'verified');
  return (
    <Card className="overflow-hidden" data-testid="gasto-prices">
      <CardHeader
        title="Precios de IA"
        description={
          internal
            ? 'El gasto que se enseña solo es de fiar si el precio cargado es el real. Aquí, los modelos usados este mes y si su precio es de fiar.'
            : 'El cupo solo protege si el precio cargado es el real. Aquí, los modelos usados este mes y si su precio es de fiar.'
        }
      />
      {prices.isPending ? (
        <CardBody>
          <Spinner />
        </CardBody>
      ) : prices.isError ? (
        <CardBody>
          <ErrorState error={prices.error} onRetry={() => void prices.refetch()} />
        </CardBody>
      ) : prices.data.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Este mes no se ha usado ningún modelo de IA.</p>
        </CardBody>
      ) : (
        <>
          {bad.length > 0 && (
            <CardBody>
              <Notice tone="warning">
                <span data-testid="gasto-prices-warning">
                  {bad.length === 1 ? 'Hay 1 modelo' : `Hay ${bad.length} modelos`} con un precio que no está
                  verificado:{' '}
                  {internal
                    ? 'el gasto se calcula con una regla que puede no ser la real. Contrasta el precio con el proveedor y con su factura.'
                    : 'el cupo se calcula con una regla que puede no ser la real. Contrasta el precio con el proveedor y con su factura antes de fiarte del cupo.'}
                </span>
              </Notice>
            </CardBody>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Modelos de IA usados y estado de su precio</caption>
              <thead className="border-y border-border bg-subtle text-xs text-muted">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Modelo
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Generaciones
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Coste
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Precio
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {prices.data.map((r) => (
                  <tr key={`${r.task}/${r.provider}/${r.model}`}>
                    <th scope="row" className="px-5 py-3 font-medium">
                      {r.provider}/{r.model}
                      <span className="block text-xs font-normal text-muted">{r.task}</span>
                    </th>
                    <td className="px-3 py-3 text-right tabular-nums">{count.format(Number(r.generations))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMicros(Number(r.cost_micros))}</td>
                    <td className="px-5 py-3">
                      <Badge tone={PRICE_LABEL[r.status].tone}>{PRICE_LABEL[r.status].text}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
