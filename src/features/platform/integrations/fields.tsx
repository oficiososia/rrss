import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import type { IntegrationSettingRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';
import { useState } from 'react';
import { useGenerateTokenKey, useGenerateWorkerToken, useSaveIntegration } from './api';
import type { UiField } from './catalog';

// Los campos de Integraciones: un ajuste suelto, el solo-lectura, las claves de
// cifrado de los tokens y el token del trabajador. Los usa la hoja de cada
// servicio, tanto a la vista como en «Opciones avanzadas».

function storedLine(row: IntegrationSettingRow | undefined, fromEnv: boolean, secret: boolean, plain = false) {
  if (row) {
    return (
      <>
        <Badge tone="success">Configurado</Badge>
        {secret && row.hint && <span className="font-mono">{row.hint}</span>}
        <span>
          {formatDateTime(row.updated_at)}
          {row.updated_by_email ? ` · ${row.updated_by_email}` : ''}
        </span>
        {fromEnv && <span>{plain ? '(manda sobre la del servidor)' : '(manda sobre la variable de entorno)'}</span>}
      </>
    );
  }
  if (fromEnv) {
    return <Badge tone="primary">{plain ? 'Ya está puesta en el servidor' : 'En la variable de entorno del servidor'}</Badge>;
  }
  return <span>Sin configurar</span>;
}

export function SettingField({
  field,
  row,
  fromEnv,
  value,
  removing,
  plain = false,
  onChange,
  onRemove,
}: {
  field: UiField;
  row: IntegrationSettingRow | undefined;
  fromEnv: boolean;
  value: string | undefined;
  removing: boolean;
  /** Vista sencilla: sin el nombre de la variable ni jerga del servidor. */
  plain?: boolean;
  onChange: (value: string) => void;
  onRemove: (remove: boolean) => void;
}) {
  const shown = value ?? (field.secret ? '' : (row?.value ?? ''));
  const placeholder = field.secret
    ? row
      ? 'Escribe uno nuevo para sustituirlo'
      : (field.placeholder ?? '')
    : (field.placeholder ?? '');
  return (
    <div className="space-y-1.5" data-testid={`setting-${field.key}`}>
      <Field label={field.label} hint={field.help} optional>
        {(props) =>
          field.input === 'select' ? (
            <Select {...props} value={shown} disabled={removing} onChange={(e) => onChange(e.target.value)}>
              <option value="">— Sin elegir —</option>
              {field.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : field.input === 'textarea' ? (
            <Textarea
              {...props}
              rows={field.secret ? 4 : 3}
              value={shown}
              placeholder={placeholder}
              disabled={removing}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <Input
              {...props}
              type={field.secret ? 'password' : 'text'}
              value={shown}
              placeholder={placeholder}
              disabled={removing}
              autoComplete={field.secret ? 'new-password' : 'off'}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
            />
          )
        }
      </Field>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid={`setting-state-${field.key}`}>
        {!plain && <code className="break-all rounded bg-subtle px-1.5 py-0.5">{field.key}</code>}
        {storedLine(row, fromEnv, field.secret, plain)}
        {/* En la vista sencilla, borrar está en el «⋯» de la hoja. */}
        {row && !plain && (
          <Button variant="ghost" size="sm" onClick={() => onRemove(!removing)}>
            {removing ? 'No borrar' : 'Borrar'}
          </Button>
        )}
        {removing && <span className="font-medium text-danger">Se borrará al guardar</span>}
      </div>
    </div>
  );
}

export function ReadOnlySetting({
  field,
  row,
  fromEnv,
}: {
  field: UiField;
  row: IntegrationSettingRow | undefined;
  fromEnv: boolean;
}) {
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">{field.label}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <code className="break-all rounded bg-subtle px-1.5 py-0.5">{field.key}</code>
        {row?.value && <span className="font-mono text-fg">{row.value}</span>}
        {storedLine(row, fromEnv, false)}
      </div>
    </div>
  );
}

export function TokenKeys({
  row,
  fromEnv,
  plain = false,
}: {
  row: IntegrationSettingRow | undefined;
  fromEnv: boolean;
  plain?: boolean;
}) {
  const generate = useGenerateTokenKey();
  return (
    <div className="space-y-2 text-sm" data-testid="setting-SOCIAL_TOKEN_KEYS">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {plain ? <span className="font-medium text-fg">Clave de cifrado de las cuentas</span> : <code className="break-all rounded bg-subtle px-1.5 py-0.5">SOCIAL_TOKEN_KEYS</code>}
        {storedLine(row, fromEnv, false, plain)}
      </div>
      {fromEnv && !row && (
        <Notice>
          Las claves del servidor siguen sirviendo para descifrar lo ya guardado aunque generes una aquí: se usan las
          dos.
        </Notice>
      )}
      <Button
        variant="secondary"
        size="sm"
        loading={generate.isPending}
        onClick={() =>
          generate.mutate(undefined, {
            onSuccess: (r) => toast.success(`Clave de cifrado ${r.keyId} generada`),
            onError: (e) => toast.error(translateError(e)),
          })
        }
        data-testid="integration-generate-key"
      >
        <KeyRound className="h-4 w-4" aria-hidden />
        {row || fromEnv ? 'Generar una clave nueva (rotar)' : 'Generar clave'}
      </Button>
    </div>
  );
}

/**
 * Token del trabajador para `worker-gateway`: se genera aquí (nunca se pega a
 * mano), se enseña UNA vez para copiarlo a Fly y en la base de datos solo
 * queda su huella. Revocar lo borra: el trabajador deja de poder entrar.
 */
export function WorkerGatewayToken({ row, plain = false }: { row: IntegrationSettingRow | undefined; plain?: boolean }) {
  const generate = useGenerateWorkerToken();
  const save = useSaveIntegration();
  const [token, setToken] = useState<string | null>(null);
  const copy = () => {
    if (!token) return;
    navigator.clipboard?.writeText(token).then(
      () => toast.success('Token copiado'),
      () => toast.error('No se pudo copiar: selecciónalo y cópialo a mano'),
    );
  };
  return (
    <div className="space-y-2 text-sm" data-testid="setting-WORKER_GATEWAY_TOKEN">
      <p className="font-medium">Token del trabajador</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {!plain && <code className="break-all rounded bg-subtle px-1.5 py-0.5">WORKER_GATEWAY_TOKEN</code>}
        {row ? (
          <>
            <Badge tone="success">Generado</Badge>
            <span>
              {formatDateTime(row.updated_at)}
              {row.updated_by_email ? ` · ${row.updated_by_email}` : ''}
            </span>
          </>
        ) : (
          <span>Sin generar</span>
        )}
      </div>
      {token && (
        <Notice tone="warning">
          <span className="block font-medium">Cópialo ahora: no se volverá a ver.</span>
          <span className="mt-1 block">
            Pégalo en Fly (la app → «Secrets») como <code>WORKER_GATEWAY_TOKEN</code>. El anterior, si había, ya no
            vale.
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              readOnly
              value={token}
              aria-label="Token del trabajador"
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
              data-testid="worker-token-value"
            />
            <Button variant="secondary" size="sm" onClick={copy}>
              Copiar
            </Button>
          </span>
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={generate.isPending}
          onClick={() =>
            generate.mutate(undefined, {
              onSuccess: (r) => setToken(r.token),
              onError: (e) => toast.error(translateError(e)),
            })
          }
          data-testid="integration-generate-worker-token"
        >
          <KeyRound className="h-4 w-4" aria-hidden />
          {row ? 'Generar uno nuevo (rotar)' : 'Generar token'}
        </Button>
        {row && (
          <Button
            variant="ghost"
            size="sm"
            loading={save.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  '¿Revocar el token? El trabajador dejará de poder reclamar trabajos hasta que generes otro.',
                )
              )
                return;
              save.mutate(
                { integration: 'media_worker', values: { WORKER_GATEWAY_TOKEN: null } },
                {
                  onSuccess: () => {
                    setToken(null);
                    toast.success('Token revocado');
                  },
                  onError: (e) => toast.error(translateError(e)),
                },
              );
            }}
            data-testid="integration-revoke-worker-token"
          >
            Revocar
          </Button>
        )}
      </div>
    </div>
  );
}

