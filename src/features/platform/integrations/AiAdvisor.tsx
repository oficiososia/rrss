import { RefreshCw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Notice, Spinner } from '@/components/ui';
import { translateError } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';
import { centsText, costLines, currentPeriodStart } from './aiFormat';
import {
  useAiApply,
  useAiOverview,
  useCostPerOperation,
  useRefreshAiOverview,
  useRestoreSettings,
  type AiPriceRow,
  type AiProviderId,
  type AiTaskView,
  type AppliedChange,
  type MicroPrice,
} from './api';

// Lo que la hoja de OpenAI y la de Claude enseñan, dentro de «Opciones avanzadas», de modelos y precios: qué
// modelo se sugiere para cada tarea y cuánto cuesta un uso, los precios al día
// frente a los cargados en la aplicación, y lo que cuesta de verdad este mes.
// Todo lo calcula el servidor; aquí solo se enseña.

const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const number = (digits: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits });

const perMillion = (micros: number | undefined) => (micros === undefined ? '—' : `${number(4).format(micros)} $`);

/** Aviso de «hecho» con lo que se ha cambiado y un botón para deshacerlo. */
export function AppliedNotice({
  title,
  change,
  onDone,
}: {
  title: string;
  change: AppliedChange;
  onDone: () => void;
}) {
  const restore = useRestoreSettings();
  const keys = Object.keys(change.previous);
  return (
    <Notice>
      <div role="status" data-testid="applied-notice" className="space-y-2">
        <p className="font-medium">{title}</p>
        {change.notes.length > 0 && (
          <ul className="list-disc space-y-1 pl-5">
            {change.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {change.activatedImageModels && change.activatedImageModels.length > 0 && (
          <p>Modelos de imagen de OpenAI activados en el registro de modelos (no se desactivan al deshacer).</p>
        )}
        <div className="flex flex-wrap gap-2">
          {keys.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              loading={restore.isPending}
              data-testid="undo-applied"
              onClick={() =>
                restore.mutate(change.previous, {
                  onSuccess: () => {
                    toast.success('Deshecho');
                    onDone();
                  },
                  onError: (e) => toast.error(translateError(e)),
                })
              }
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Deshacer
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cerrar
          </Button>
        </div>
      </div>
    </Notice>
  );
}

function TaskRow({ task }: { task: AiTaskView }) {
  const r = task.recommended;
  return (
    <li className="space-y-0.5 py-2.5" data-testid={`ai-task-${task.id}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{task.label}</span>
        {r ? (
          <span>
            Recomendado: <span translate="no" className="font-medium">{r.model}</span>
            {r.centsPerUse !== null ? (
              <>
                {' · '}
                <span className="tabular-nums">{centsText(r.centsPerUse)} por {task.unit}</span>
              </>
            ) : task.kind === 'image' ? (
              ' · sin precio por imagen en la fuente'
            ) : null}
          </span>
        ) : (
          <span className="text-muted">Sin recomendación</span>
        )}
      </p>
      {r ? (
        <p className="text-xs text-muted">
          {r.why} ({r.measured})
          {r.skipped.length > 0 && (
            <>
              {' '}
              Se salta {r.skipped.join(', ')} porque tu cuenta no lo tiene o la fuente no lo trae.
            </>
          )}
          {r.unchecked && ' No se ha podido comprobar si tu cuenta tiene este modelo.'}
        </p>
      ) : (
        <p className="text-xs text-muted">{task.none}</p>
      )}
      {task.current && (
        <p className="text-xs text-muted">
          Ahora usa: <span translate="no">{task.current}</span>
        </p>
      )}
    </li>
  );
}

const STATUS_TEXT: Record<AiPriceRow['status'], { tone: 'success' | 'warning' | 'neutral'; text: string }> = {
  same: { tone: 'success', text: 'Igual' },
  different: { tone: 'warning', text: 'Distinto' },
  none: { tone: 'warning', text: 'Sin precio cargado' },
  no_source: { tone: 'neutral', text: 'La fuente no lo trae' },
};

function loadedText(row: AiPriceRow): string {
  const l: MicroPrice | null = row.loaded;
  if (!l) return 'Nada cargado';
  if (l.audio_seconds !== undefined) return `${number(2).format((l.audio_seconds * 60) / 10_000)} céntimos por minuto`;
  return `${perMillion(l.input_tokens)} entrada · ${perMillion(l.output_tokens)} salida`;
}

function sourceText(row: AiPriceRow): string {
  const s = row.source;
  if (!s) return 'La fuente no trae este modelo';
  if (s.perSecond !== undefined) return `${number(2).format((s.perSecond * 60 * 100) / 1)} céntimos por minuto`;
  return `${perMillion(s.inputPerM)} entrada · ${perMillion(s.outputPerM)} salida`;
}

export function RealCost({ provider }: { provider: AiProviderId }) {
  const cost = useCostPerOperation(currentPeriodStart());
  if (cost.isPending) return <Spinner label="Mirando el gasto del mes…" className="py-3" />;
  if (cost.isError) {
    return <p className="text-sm text-danger">No se ha podido leer el gasto del mes: {translateError(cost.error)}</p>;
  }
  const lines = costLines(cost.data, provider);
  return (
    <div className="space-y-1.5" data-testid={`real-cost-${provider}`}>
      <h4 className="text-sm font-semibold">Lo que cuesta de verdad este mes</h4>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay operaciones de pago este mes con este proveedor.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {lines.map((l) => (
            <li key={l.key} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span className="font-medium">{l.label}</span>
              <span className="tabular-nums">
                {centsText(l.centsPerUnit)} por {l.unit}
              </span>
              <span className="text-xs text-muted tabular-nums">
                ({l.operations} {l.operations === 1 ? 'vez' : 'veces'} · {money.format(l.totalUsd)} en total)
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        Es el coste que la aplicación apunta al terminar cada operación con los precios que tiene cargados; la factura
        del proveedor es la que manda.
      </p>
    </div>
  );
}

/** Sugerencias de modelo, precios al día y coste real de OpenAI o de Claude. */
export function AiAdvisor({ provider, keyReady }: { provider: AiProviderId; keyReady: boolean }) {
  const overview = useAiOverview();
  const refresh = useRefreshAiOverview();
  const apply = useAiApply();
  const [done, setDone] = useState<{ title: string; change: AppliedChange } | null>(null);
  const name = provider === 'openai' ? 'OpenAI' : 'Claude';

  if (overview.isPending) return <Spinner label="Leyendo los precios al día…" className="py-4" />;
  if (overview.isError) {
    return (
      <p className="text-sm text-muted" role="alert">
        No se han podido leer las sugerencias y los precios: {translateError(overview.error)}
      </p>
    );
  }
  const data = overview.data;
  const p = data.providers[provider];
  const src = data.source;
  const run = (scope: 'all' | 'prices', title: string) =>
    apply.mutate(
      { provider, scope },
      {
        onSuccess: (change) => setDone({ title, change }),
        onError: (e) => toast.error(translateError(e)),
      },
    );
  const priceRows = p.prices;

  return (
    <div className="space-y-4" data-testid={`ai-advisor-${provider}`}>
      {done && <AppliedNotice title={done.title} change={done.change} onDone={() => setDone(null)} />}

      {/* Resumen siempre a la vista: coste y aviso de precios distintos. */}
      <div className="space-y-2 text-sm">
        {p.monthly.usd !== null && (
          <p data-testid={`ai-monthly-${provider}`}>
            Con un uso normal (5 a 10 marcas), con lo recomendado salen unos{' '}
            <span className="font-semibold tabular-nums">{money.format(p.monthly.usd)} al mes</span> en {name}
            {p.monthly.notCounted.length > 0 && (
              <>
                , sin contar: {p.monthly.notCounted.join(', ').toLowerCase()} (la fuente no da precio por imagen)
              </>
            )}
            . Es una estimación con supuestos de uso (docs/modelos-ia-comparativa.md).
          </p>
        )}
        {src.fetchedAt ? (
          <p className="text-xs text-muted" data-testid={`ai-source-${provider}`}>
            Precios de {src.name}, actualizados el {formatDateTime(src.fetchedAt)}; no es la tarifa oficial de tu cuenta.{' '}
            <a className="text-primary underline" href={src.officialUrl[provider]} target="_blank" rel="noreferrer">
              Tarifa oficial de {name}
            </a>
            .
          </p>
        ) : (
          <p className="text-xs text-muted" data-testid={`ai-source-${provider}`}>
            Todavía no se han podido leer los precios al día.
          </p>
        )}
        {src.problem && (
          <p role="status" className="text-xs font-medium text-warning">
            {src.problem}
          </p>
        )}
        {p.differing > 0 && (
          <Notice tone="warning">
            <div className="space-y-2" data-testid={`ai-differs-${provider}`}>
              <p className="font-medium">
                {p.differing === 1
                  ? 'Un precio que tiene cargado la aplicación no coincide con el de la fuente.'
                  : `${p.differing} precios que tiene cargados la aplicación no coinciden con los de la fuente.`}
              </p>
              <Button
                size="sm"
                loading={apply.isPending}
                onClick={() => run('prices', 'Precios actualizados.')}
                data-testid={`ai-use-prices-${provider}`}
              >
                Usar estos precios
              </Button>
            </div>
          </Notice>
        )}
      </div>

      <div className="space-y-5" data-testid={`ai-details-${provider}`}>
        <div className="space-y-5">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">Qué modelo usar para cada cosa</h4>
            {provider === 'claude' && (
              <p className="text-xs text-muted">
                Solo sugerencias y precios: Claude no hace falta configurarlo para empezar.
              </p>
            )}
            {provider === 'openai' && !data.openaiModels.known && (
              <p className="text-xs text-muted">
                {keyReady
                  ? `No se ha podido mirar qué modelos tiene tu cuenta (${data.openaiModels.problem ?? 'sin respuesta'}): se sugieren los de la lista sin comprobar.`
                  : 'Cuando guardes la clave se mirará qué modelos tiene tu cuenta.'}
              </p>
            )}
            <ul className="divide-y divide-border">
              {p.tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
            {provider === 'openai' && keyReady && (
              <div className="pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={apply.isPending}
                  onClick={() => run('all', 'Configuración recomendada aplicada.')}
                  data-testid="ai-use-recommended"
                >
                  Usar la configuración recomendada
                </Button>
                <p className="mt-1 text-xs text-muted">
                  Cambia el modelo de cada tarea por el recomendado y carga sus precios. Se puede deshacer.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Precios al día frente a los cargados</h4>
              <Button
                variant="ghost"
                size="sm"
                loading={refresh.isPending}
                onClick={() =>
                  refresh.mutate(undefined, {
                    onSuccess: () => toast.success('Precios actualizados'),
                    onError: (e) => toast.error(translateError(e)),
                  })
                }
                data-testid={`ai-refresh-${provider}`}
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Actualizar
              </Button>
            </div>
            {priceRows.length === 0 ? (
              <p className="text-sm text-muted">No hay precios que comparar todavía.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" data-testid={`ai-prices-${provider}`}>
                {priceRows.map((row) => (
                  <li key={row.model} className="space-y-0.5 py-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <span translate="no" className="font-medium">
                        {row.model}
                      </span>
                      <Badge tone={STATUS_TEXT[row.status].tone}>{STATUS_TEXT[row.status].text}</Badge>
                    </p>
                    <p className="text-xs tabular-nums">Al día: {sourceText(row)}</p>
                    <p className="text-xs tabular-nums">Cargado en la app: {loadedText(row)}</p>
                    <p className="text-xs text-muted">
                      {row.usedFor.join(', ')}
                      {row.surcharge > 1 && ' · los precios cargados incluyen un 10 % por procesar en la UE'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              Imágenes: la fuente da el precio por token de imagen, no por imagen, así que no se calcula uno. Mira el gasto real
              abajo o en el panel de {name}.
            </p>
          </div>

          <RealCost provider={provider} />
        </div>
      </div>
    </div>
  );
}
