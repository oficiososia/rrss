import { CheckCircle2, CircleSlash, Plug } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import type { IntegrationSettingRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';
import { AiAdvisor, AppliedNotice } from './AiAdvisor';
import {
  SETTING_INTEGRATION,
  useAiApply,
  useOpenAiRegion,
  useSaveIntegration,
  useTestIntegration,
  type AppliedChange,
  type IntegrationStatus,
  type ProbeResult,
} from './api';
import { UI_INTEGRATIONS, type IntegrationId, type UiField } from './catalog';
import { ReadOnlySetting, SettingField, TokenKeys, WorkerGatewayToken } from './fields';
import { advancedGroups, buildServiceCtx, serviceStatus, simpleFields, type ServiceDef } from './services';

const ALL_FIELDS = new Map<string, UiField>(
  UI_INTEGRATIONS.flatMap((i) => i.groups.flatMap((g) => g.fields.map((f) => [f.key, f] as const))),
);

/** El resultado de una prueba, en una frase. */
function TestSentence({
  test,
  live,
}: {
  test: { ok: boolean; message: string; tested_at: string; tested_by_email: string | null } | undefined;
  live: ProbeResult | null;
}) {
  if (live) {
    return (
      <div className="space-y-1.5" data-testid="integration-test-result" role="status">
        <p className={live.ok ? 'text-sm font-medium text-success' : 'text-sm font-medium text-danger'}>
          {live.ok ? <>Funciona. {live.message}</> : <>No funciona. {live.message}</>}
        </p>
        {live.checks.length > 1 && (
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Ver el detalle</summary>
            <ul className="mt-1 space-y-1">
              {live.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-1.5">
                  {c.ok === true ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-label="Bien" />
                  ) : c.ok === false ? (
                    <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-label="Mal" />
                  ) : (
                    <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-label="No se comprueba" />
                  )}
                  <span>
                    <span className="font-medium">{c.name}:</span> {c.message}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }
  if (!test) return <p className="text-sm text-muted">Todavía no se ha probado.</p>;
  return (
    <p className="text-sm" data-testid="integration-last-test">
      <span className={test.ok ? 'font-medium text-success' : 'font-medium text-danger'}>
        {test.ok ? 'Funcionaba' : 'Fallaba'}
      </span>{' '}
      en la última prueba ({formatDateTime(test.tested_at)}
      {test.tested_by_email ? `, ${test.tested_by_email}` : ''}): {test.message}
    </p>
  );
}

/**
 * Una tarjeta por servicio. Vista sencilla: estado en una palabra, el campo o
 * campos imprescindibles, «Guardar» y «Probar conexión», y qué funciones
 * enciende. Todo lo demás cuelga de «Opciones avanzadas».
 */
export function ServiceCard({ service, status }: { service: ServiceDef; status: IntegrationStatus }) {
  const save = useSaveIntegration();
  const test = useTestIntegration();
  const apply = useAiApply();
  const region = useOpenAiRegion();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [done, setDone] = useState<{ title: string; change: AppliedChange } | null>(null);
  const [saving, setSaving] = useState(false);

  const stored = new Map(status.settings.map((s) => [s.setting_key, s]));
  const fromEnv = new Set(status.environment);
  const ctx = buildServiceCtx(service, status);
  const state = serviceStatus(service, ctx);
  const lastTest = status.tests.find((t) => t.integration === service.testIntegration);
  const fields = service.keys.map((k) => ALL_FIELDS.get(k)!).filter((f) => f && !f.hidden);

  const changes: Record<string, string | null> = {};
  for (const f of fields) {
    if (removing.has(f.key)) changes[f.key] = null;
    else if (f.key in draft) {
      const value = draft[f.key]!.trim();
      const current = stored.get(f.key)?.value ?? '';
      if (value && (f.secret || value !== current)) changes[f.key] = value;
      if (!value && !f.secret && current) changes[f.key] = null;
    }
  }
  const dirty = Object.keys(changes).length > 0;

  const runTest = () => {
    setProbe(null);
    test.mutate(service.testIntegration, {
      onSuccess: (result) => setProbe(result),
      onError: (e) => toast.error(translateError(e)),
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const byIntegration = new Map<IntegrationId, Record<string, string | null>>();
      for (const [key, value] of Object.entries(changes)) {
        const integration = SETTING_INTEGRATION[key]!;
        byIntegration.set(integration, { ...(byIntegration.get(integration) ?? {}), [key]: value });
      }
      for (const [integration, values] of byIntegration) await save.mutateAsync({ integration, values });
      const newKey = service.id === 'openai' && typeof changes.OPENAI_API_KEY === 'string';
      toast.success('Guardado');
      setDraft({});
      setRemoving(new Set());
      setProbe(null);
      setDone(null);
      if (newKey) {
        // Con la clave puesta, lo demás se deja listo solo (sin pisar nada ya elegido).
        try {
          const change = await apply.mutateAsync({ provider: 'openai', scope: 'defaults' });
          setDone({ title: 'Clave guardada. Se ha dejado todo lo demás listo con valores razonables.', change });
        } catch (e) {
          setError(
            `La clave está guardada, pero no se han podido aplicar los valores por defecto: ${translateError(e)} Puedes aplicarlos con «Usar la configuración recomendada».`,
          );
        }
      }
    } catch (e) {
      setError(translateError(e));
    } finally {
      setSaving(false);
    }
  };

  const useGlobal = () =>
    region.mutate('global', {
      onSuccess: (change) => {
        setDone({
          title: 'OpenAI usa ahora su servidor general. Los datos se tratan fuera de la UE.',
          change,
        });
        runTest();
      },
      onError: (e) => toast.error(translateError(e)),
    });
  const backToEu = () =>
    region.mutate('eu', {
      onSuccess: (change) => setDone({ title: 'OpenAI vuelve a su servidor europeo.', change }),
      onError: (e) => toast.error(translateError(e)),
    });

  const openaiBase = ctx.value('OPENAI_BASE_URL');
  const openaiOutsideEu = service.id === 'openai' && Boolean(openaiBase) && !/\/\/eu\.api\.openai\.com/.test(openaiBase!);

  const renderSimple = (field: UiField) => {
    if (field.key === 'SOCIAL_TOKEN_KEYS') {
      return <TokenKeys key={field.key} row={stored.get(field.key)} fromEnv={fromEnv.has(field.key)} plain />;
    }
    if (field.key === 'WORKER_GATEWAY_TOKEN') return <WorkerGatewayToken key={field.key} row={stored.get(field.key)} plain />;
    return renderField(field, true);
  };

  const renderField = (field: UiField, plain: boolean) => {
    if (field.key === 'SOCIAL_TOKEN_KEYS') {
      return <TokenKeys key={field.key} row={stored.get(field.key)} fromEnv={fromEnv.has(field.key)} />;
    }
    if (field.key === 'WORKER_GATEWAY_TOKEN') return <WorkerGatewayToken key={field.key} row={stored.get(field.key)} />;
    if (field.key === 'SOCIAL_TOKEN_KEY_ID') {
      return (
        <ReadOnlySetting key={field.key} field={field} row={stored.get(field.key)} fromEnv={fromEnv.has(field.key)} />
      );
    }
    return (
      <SettingField
        key={field.key}
        field={field}
        row={stored.get(field.key) as IntegrationSettingRow | undefined}
        fromEnv={fromEnv.has(field.key)}
        value={draft[field.key]}
        removing={removing.has(field.key)}
        plain={plain}
        onChange={(value) => setDraft((d) => ({ ...d, [field.key]: value }))}
        onRemove={(remove) =>
          setRemoving((r) => {
            const next = new Set(r);
            if (remove) next.add(field.key);
            else next.delete(field.key);
            return next;
          })
        }
      />
    );
  };

  const advanced = advancedGroups(service);
  const keyReady = service.id === 'openai' ? ctx.has('OPENAI_API_KEY') : ctx.has('AI_VERTEX_SERVICE_ACCOUNT_JSON');
  const falNeedsPermission = service.id === 'fal' && ctx.has('FAL_KEY') && ctx.value('AI_MEDIA_ALLOW_NON_EU') !== 'true';

  return (
    <Card id={`integration-${service.id}`} data-testid={`integration-${service.id}`} className="scroll-mt-6">
      <CardHeader
        title={service.title}
        description={service.blurb}
        action={
          <Badge tone={state.tone} className="shrink-0">
            <span data-testid={`service-status-${service.id}`}>{state.word}</span>
          </Badge>
        }
      />
      <CardBody className="space-y-5">
        {state.detail && (
          <p className="text-sm" data-testid={`service-detail-${service.id}`}>
            {state.detail}
          </p>
        )}

        {done && <AppliedNotice title={done.title} change={done.change} onDone={() => setDone(null)} />}

        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-4">{simpleFields(service).map(renderSimple)}</div>
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!dirty} loading={saving} data-testid="integration-save">
              Guardar
            </Button>
            <Button
              variant="secondary"
              onClick={runTest}
              loading={test.isPending}
              disabled={dirty || state.word === 'Falta la clave' || state.word === 'Sin configurar'}
              data-testid="integration-test"
            >
              <Plug className="h-4 w-4" aria-hidden />
              Probar conexión
            </Button>
          </div>
          <p className="text-xs text-muted">
            {service.testHint} Se prueba lo guardado{dirty ? ': guarda antes los cambios' : ''}.
          </p>
          <TestSentence test={lastTest} live={probe} />
        </form>

        {probe?.fix === 'openai_global' && (
          <Notice tone="warning">
            <div className="space-y-2" data-testid="openai-region-fix">
              <p>
                Si no tienes un proyecto europeo en OpenAI, puedes usar su servidor general. Los datos se tratarían fuera
                de la UE.
              </p>
              <Button size="sm" loading={region.isPending} onClick={useGlobal} data-testid="openai-use-global">
                Usar el servidor general de OpenAI
              </Button>
            </div>
          </Notice>
        )}
        {openaiOutsideEu && !probe?.fix && (
          <Notice tone="warning">
            <div className="space-y-2" data-testid="openai-outside-eu">
              <p>OpenAI está usando su servidor general: los datos se tratan fuera de la UE.</p>
              <Button variant="secondary" size="sm" loading={region.isPending} onClick={backToEu}>
                Volver al servidor europeo
              </Button>
            </div>
          </Notice>
        )}
        {falNeedsPermission && (
          <Notice tone="warning">
            <div className="space-y-2" data-testid="fal-permission">
              <p>
                fal.ai no garantiza que los datos se traten en la UE y reenvía la foto a un tercero. Para animar fotos hay
                que permitirlo.
              </p>
              <Button
                size="sm"
                loading={save.isPending}
                onClick={() =>
                  save.mutate(
                    { integration: 'ai_image', values: { AI_MEDIA_ALLOW_NON_EU: 'true' } },
                    {
                      onSuccess: () => toast.success('Permitido'),
                      onError: (e) => toast.error(translateError(e)),
                    },
                  )
                }
                data-testid="fal-allow"
              >
                Permitir fuera de la UE
              </Button>
            </div>
          </Notice>
        )}

        <div data-testid={`unlocks-${service.id}`} className="space-y-1.5">
          <h3 className="text-sm font-semibold">Con esto se enciende</h3>
          <ul className="space-y-1 text-sm">
            {service.unlocks.map((u) => {
              const on = u.on(ctx);
              return (
                <li key={u.label} className="flex items-start gap-2">
                  {on ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                  )}
                  <span>
                    {u.label}:{' '}
                    {on ? (
                      <span className="font-medium text-success">activa</span>
                    ) : (
                      <span className="text-muted">todavía no, {u.why}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {(service.id === 'openai' || service.id === 'claude') && (
          <AiAdvisor provider={service.id === 'openai' ? 'openai' : 'claude'} keyReady={keyReady} />
        )}

        {advanced.length > 0 && (
          <details className="rounded-lg border border-border" data-testid={`advanced-${service.id}`}>
            <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-medium">Opciones avanzadas</summary>
            <div className="space-y-8 border-t border-border px-3.5 py-4">
              {advanced.map((group) => (
                <fieldset key={group.title} className="space-y-4">
                  <legend className="text-sm font-semibold">{group.title}</legend>
                  {group.description && <p className="text-sm text-muted">{group.description}</p>}
                  {group.fields.map((field) => renderField(field, false))}
                </fieldset>
              ))}
              <Button
                onClick={(e) => void submit(e)}
                disabled={!dirty}
                loading={saving}
                data-testid="integration-save-advanced"
              >
                Guardar
              </Button>
            </div>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
