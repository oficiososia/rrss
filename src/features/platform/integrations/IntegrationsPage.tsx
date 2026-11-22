import { ArrowLeft, CheckCircle2, CircleSlash, ShieldCheck } from 'lucide-react';
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
import { UserMenu } from '@/layout/AppShell';
import { formatDateTime } from '@/lib/utils';
import { useIntegrationStatus, type AiTextTask, type IntegrationStatus } from './api';
import { TEXT_TASKS, UI_INTEGRATIONS } from './catalog';
import { ServiceCard } from './ServiceCard';
import { SERVICES, SERVICE_BY_ID, SUMMARY } from './services';

const ACTION_LABEL: Record<string, string> = { set: 'Guardó', delete: 'Borró', test: 'Probó la conexión de' };
const TITLE: Record<string, string> = Object.fromEntries(UI_INTEGRATIONS.map((i) => [i.id, i.title]));

/**
 * Plataforma → Integraciones (solo superadministradores). Vista sencilla: una
 * tarjeta por servicio con su clave, «Guardar» y «Probar conexión»; todo lo
 * demás (proveedor y modelo por tarea, precios, región, nombres de variable)
 * cuelga de «Opciones avanzadas» de cada tarjeta. Los secretos se escriben y no
 * se vuelven a ver: la pantalla solo sabe «configurado · pista · fecha · quién».
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
              description="Pega la clave de cada servicio y la aplicación deja lo demás listo. Las claves se guardan cifradas y no se vuelven a ver."
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
  if (status.isPending) return <Spinner />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const data = status.data;
  return (
    <div className="space-y-6">
      <WorkingNow status={data} />
      <div className="space-y-6">
        {SERVICES.map((service) => (
          <ServiceCard key={service.id} service={service} status={data} />
        ))}
      </div>
      <details className="rounded-xl border border-border bg-surface" data-testid="platform-advanced">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Opciones avanzadas: qué enseña este despliegue y quién cambió qué
        </summary>
        <div className="space-y-6 border-t border-border p-4">
          <BuildFlags status={data} />
          <Activity status={data} />
        </div>
      </details>
    </div>
  );
}

/** «Qué funciona ahora»: las funciones que la gente nota, con su estado. */
function WorkingNow({ status }: { status: IntegrationStatus }) {
  const items = SUMMARY.map((s) => ({ ...s, ok: s.on(status.availability) }));
  const working = items.filter((i) => i.ok).length;
  return (
    <Card data-testid="working-now">
      <CardHeader
        title="Qué funciona ahora"
        description={`${working} de ${items.length} funciones están listas.`}
      />
      <CardBody>
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.label} className="flex items-start gap-2 border-b border-border py-2.5 text-sm last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
              {i.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                {i.label}
                <span className="block text-xs">
                  {i.ok ? (
                    <span className="font-medium text-success">Funciona</span>
                  ) : (
                    <>
                      <span className="text-muted">No disponible · falta </span>
                      <a className="text-primary underline" href={`#integration-${i.needs}`}>
                        {SERVICE_BY_ID[i.needs].title}
                      </a>
                    </>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Qué módulos enseña la interfaz: interruptor de compilación Y servicio configurado. */
function BuildFlags({ status }: { status: IntegrationStatus }) {
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
    {
      label: 'Pago con Stripe',
      build: billingEnabled(),
      live: status.availability.billing,
      flag: 'VITE_BILLING_ENABLED',
    },
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
                {TITLE[a.integration] ?? a.integration}
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
