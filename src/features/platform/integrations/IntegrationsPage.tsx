import { ArrowLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Spinner,
} from '@/components/ui';
import {
  aiImageEnabled,
  aiTextEnabled,
  aiVoiceCopilotEnabled,
  driveLibraryEnabled,
  socialPublishingEnabled,
} from '@/config/app';
import { useUser } from '@/features/auth/AuthProvider';
import { billingEnabled } from '@/features/billing/labels';
import { useIsPlatformAdmin } from '@/features/orgs/api';
import { useInternalUseState } from '@/features/orgs/workMode';
import { UserMenu } from '@/layout/AppShell';
import { cn, formatDateTime } from '@/lib/utils';
import { useIntegrationStatus, type AiTextTask, type IntegrationStatus, type ProbeResult } from './api';
import { TEXT_TASKS, UI_INTEGRATIONS } from './catalog';
import { ServiceSheet } from './ServiceSheet';
import {
  buildServiceCtx,
  rowAction,
  serviceStatus,
  SERVICES,
  SERVICE_BY_ID,
  SUMMARY,
  TEST_RECORD_TITLE,
  type ServiceDef,
  type ServiceId,
  type ServiceStatus,
} from './services';

const ACTION_LABEL: Record<string, string> = { set: 'Guardó', delete: 'Borró', test: 'Probó la conexión de' };
const TITLE: Record<string, string> = Object.fromEntries(UI_INTEGRATIONS.map((i) => [i.id, i.title]));

/**
 * Integraciones (solo superadministradores; se llega desde el menú de la
 * cuenta). Una fila por servicio con lo que hace, su estado y una acción; al
 * tocarla, una hoja con la clave y «Guardar y probar». Lo que no hace falta
 * para empezar va en «Opcionales», plegado; modelos, región, URL y precios, en
 * «Opciones avanzadas» de cada hoja. Los secretos se escriben y no se vuelven a
 * ver: la pantalla solo sabe «configurado · pista · fecha · quién».
 */
export function IntegrationsPage() {
  const user = useUser();
  const admin = useIsPlatformAdmin(user.id);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-10">
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
        {admin.isPending ? (
          <Spinner />
        ) : admin.data !== true ? (
          <Card>
            <EmptyState
              icon={ShieldCheck}
              title="Zona reservada"
              description="Esta sección es solo para los administradores de la plataforma."
            />
          </Card>
        ) : (
          <>
            <PageHeader
              title="Integraciones"
              description="Las claves se guardan cifradas y no se vuelven a ver."
            />
            <IntegrationsBody />
          </>
        )}
      </main>
    </div>
  );
}

function IntegrationsBody() {
  const status = useIntegrationStatus();
  const { internal, pending: modePending } = useInternalUseState();
  const [openId, setOpenId] = useState<ServiceId | null>(null);
  // Lo que dio la última prueba de cada servicio en esta visita: la fila y la hoja lo enseñan
  // aunque el servidor todavía no lo tenga anotado.
  const [probes, setProbes] = useState<Partial<Record<ServiceId, ProbeResult | null>>>({});
  if (status.isPending || modePending) return <Spinner />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const data = status.data;
  // En uso interno no se cobra a nadie: la fila de pagos no sale.
  const visible = SERVICES.filter((service) => !internal || service.id !== 'stripe');
  const main = visible.filter((s) => s.tier === 'main');
  const optional = visible.filter((s) => s.tier === 'optional');
  const open = openId ? SERVICE_BY_ID[openId] : null;
  const row = (service: ServiceDef) => (
    <ServiceRow
      key={service.id}
      service={service}
      status={data}
      probe={probes[service.id] ?? null}
      onOpen={() => setOpenId(service.id)}
    />
  );
  return (
    <div className="space-y-6">
      <WorkingNow status={data} internal={internal} />
      <ul className="space-y-2" data-testid="integration-rows">
        {main.map(row)}
      </ul>
      <details className="rounded-xl border border-border bg-surface" data-testid="integration-optional">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Opcionales ({optional.length}): {optional.map((s) => s.short ?? s.provider).join(', ')}
        </summary>
        <ul className="space-y-2 border-t border-border p-3">{optional.map(row)}</ul>
      </details>
      <details className="rounded-xl border border-border bg-surface" data-testid="platform-advanced">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Opciones avanzadas: qué enseña este despliegue y quién cambió qué
        </summary>
        <div className="space-y-6 border-t border-border p-4">
          <BuildFlags status={data} internal={internal} />
          <Activity status={data} />
        </div>
      </details>
      {open && (
        <ServiceSheet
          key={open.id}
          service={open}
          status={data}
          probe={probes[open.id] ?? null}
          onProbe={(result) => setProbes((p) => ({ ...p, [open.id]: result }))}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

const DOT: Record<ServiceStatus['tone'], string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-muted',
};

/** Una fila por servicio: lo que hace, con qué, su estado y una sola acción (abre su hoja). */
function ServiceRow({
  service,
  status,
  probe,
  onOpen,
}: {
  service: ServiceDef;
  status: IntegrationStatus;
  probe: ProbeResult | null;
  onOpen: () => void;
}) {
  const saved = buildServiceCtx(service, status);
  const ctx = probe ? { ...saved, lastTest: { ok: probe.ok, message: probe.message } } : saved;
  const state = serviceStatus(service, ctx);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`integration-row-${service.id}`}
        className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', DOT[state.tone])} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">{service.does}</span>
          <span className="block break-words text-xs text-muted">{service.provider}</span>
        </span>
        <Badge tone={state.tone} className="shrink-0">
          <span data-testid={`service-status-${service.id}`}>{state.word}</span>
        </Badge>
        <span className="hidden w-20 shrink-0 text-right text-sm font-medium text-primary sm:inline">
          {rowAction(state.word)}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted sm:hidden" aria-hidden />
      </button>
    </li>
  );
}

/** Cuántas de las funciones que la gente nota están listas, en una línea. */
function WorkingNow({ status, internal }: { status: IntegrationStatus; internal: boolean }) {
  const items = SUMMARY.filter((s) => !internal || s.needs !== 'stripe');
  const working = items.filter((i) => i.on(status.availability)).length;
  return (
    <div data-testid="working-now">
      <Badge tone={working === items.length ? 'success' : 'warning'}>
        {working} de {items.length} funciones listas
      </Badge>
    </div>
  );
}

/** Qué módulos enseña la interfaz: interruptor de compilación Y servicio configurado. */
function BuildFlags({ status, internal }: { status: IntegrationStatus; internal: boolean }) {
  // Un servidor anterior a la disponibilidad por tarea solo sabe decir «alguna»: vale para todas.
  const taskLive = (task: AiTextTask) => status.availability.aiTextTasks?.[task] ?? status.availability.aiText;
  const rows = [
    {
      label: 'Publicación en Instagram',
      build: socialPublishingEnabled(),
      live: status.availability.publishing,
      flag: 'VITE_SOCIAL_PUBLISHING_ENABLED',
    },
    {
      label: 'Botón «Conectar con Meta» (sin él, solo con token)',
      build: socialPublishingEnabled(),
      live: status.availability.socialOAuth,
      flag: 'VITE_SOCIAL_PUBLISHING_ENABLED',
    },
    // Una fila por tarea: configurar una no enciende las demás.
    ...TEXT_TASKS.filter((t) => t.task !== 'editor.copilot').map((t) => ({
      label: `IA de texto · ${t.label}`,
      build: aiTextEnabled(),
      live: taskLive(t.task),
      flag: 'VITE_AI_TEXT_ENABLED',
    })),
    {
      label: 'IA de imagen',
      build: aiImageEnabled(),
      live: status.availability.aiImage,
      flag: 'VITE_AI_IMAGE_ENABLED',
    },
    ...(internal
      ? []
      : [
          {
            label: 'Pago con Stripe',
            build: billingEnabled(),
            live: status.availability.billing,
            flag: 'VITE_BILLING_ENABLED',
          },
        ]),
    {
      label: 'IA de texto · Copiloto por voz del editor',
      build: aiVoiceCopilotEnabled(),
      live: taskLive('editor.copilot'),
      flag: 'VITE_AI_VOICE_COPILOT_ENABLED',
    },
    {
      label: 'Fotos de Google Drive',
      build: driveLibraryEnabled(),
      live: status.availability.drive,
      flag: 'VITE_DRIVE_LIBRARY_ENABLED',
    },
    // Sin variable de compilación: si el servidor guarda en R2, la aplicación tiene que saber leerlo.
    {
      label: 'Archivos en Cloudflare R2',
      build: true,
      live: status.availability.mediaStorage,
      flag: '',
    },
  ];
  return (
    <Card>
      <CardHeader
        title="Qué ve la gente"
        description="Una parte sale en la aplicación si este despliegue la permite (variable de compilación) y su integración está configurada aquí o en el servidor."
      />
      <CardBody>
        <ul className="divide-y divide-border text-sm" data-testid="integration-flags">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 font-medium">{r.label}</span>
              {r.build && r.live ? (
                <Badge tone="success">Se enseña</Badge>
              ) : !r.live ? (
                <Badge>Sin configurar</Badge>
              ) : (
                <Badge tone="warning">Configurada, pero este despliegue no la enseña ({r.flag})</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function Activity({ status }: { status: IntegrationStatus }) {
  return (
    <Card>
      <CardHeader title="Actividad" description="Quién cambió o probó qué. Nunca se guarda el valor." />
      <CardBody>
        {status.audit.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay actividad.</p>
        ) : (
          <ul className="divide-y divide-border text-sm" data-testid="integration-audit">
            {status.audit.map((a) => (
              <li key={a.id} className="py-2">
                <span className="text-muted">{formatDateTime(a.created_at)}</span> · {a.actor_email ?? 'alguien'}{' '}
                {ACTION_LABEL[a.action] ?? a.action} {a.setting_key ? <code>{a.setting_key}</code> : null}
                {a.setting_key ? ' en ' : ' '}
                {TITLE[a.integration] ?? TEST_RECORD_TITLE[a.integration] ?? a.integration}
                {a.action === 'test' && typeof a.data === 'object' && a.data && 'ok' in a.data
                  ? (a.data as { ok: boolean }).ok
                    ? ': funcionaba'
                    : ': fallaba'
                  : ''}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
