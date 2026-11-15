import { Briefcase, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, CardBody, Field, Input } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { useUser } from '@/features/auth/AuthProvider';
import type { OrgKind } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { UserMenu } from '@/layout/AppShell';
import { useCreateOrganization, useMyOrganizations } from './api';

const KINDS: { value: OrgKind; title: string; description: string; icon: typeof Store }[] = [
  { value: 'business', title: 'Empresa', description: 'Gestiono las redes de mi propio negocio.', icon: Store },
  { value: 'agency', title: 'Agencia', description: 'Gestiono las redes de varios clientes.', icon: Briefcase },
];

export function WelcomePage() {
  const user = useUser();
  const navigate = useNavigate();
  const orgs = useMyOrganizations(user.id);
  const create = useCreateOrganization(user.id);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<OrgKind>('business');
  const hasOrgs = (orgs.data?.length ?? 0) > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), kind },
      {
        onSuccess: (org) =>
          // Una empresa empieza por dar de alta su marca; una agencia, por su panel.
          navigate(kind === 'business' ? `/o/${org.id}/marcas/nueva` : `/o/${org.id}`, { replace: true }),
      },
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6">
      <div className="flex justify-end">
        <UserMenu compact />
      </div>
      <div className="flex flex-1 flex-col justify-center py-8">
        <h1 className="text-2xl">{hasOrgs ? 'Crear otra organización' : `Te damos la bienvenida a ${APP_NAME}`}</h1>
        <p className="mt-1 text-sm text-muted">
          Una organización agrupa tus marcas y tu equipo. Podrás invitar a más personas después.
        </p>
        <Card className="mt-6">
          <CardBody>
            <form onSubmit={submit} className="space-y-5" data-testid="create-org-form">
              <Field label="Nombre de la organización" hint="El nombre de tu empresa o de tu agencia.">
                {(p) => (
                  <Input
                    {...p}
                    required
                    maxLength={120}
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="org-name"
                  />
                )}
              </Field>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">¿Cómo vas a usarla?</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {KINDS.map(({ value, title, description, icon: Icon }) => (
                    <label
                      key={value}
                      className={cn(
                        'flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                        kind === value ? 'border-primary bg-primary-soft' : 'border-border hover:bg-subtle',
                      )}
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={value}
                        checked={kind === value}
                        onChange={() => setKind(value)}
                        className="sr-only"
                        data-testid={`org-kind-${value}`}
                      />
                      <Icon
                        className={cn('mt-0.5 h-5 w-5 shrink-0', kind === value ? 'text-primary' : 'text-muted')}
                        aria-hidden
                      />
                      <span>
                        <span className="block text-sm font-medium">{title}</span>
                        <span className="block text-xs text-muted">{description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {create.isError && (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                  {translateError(create.error)}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {hasOrgs ? (
                  <Link to="/" className="text-sm font-medium text-primary hover:underline">
                    Volver
                  </Link>
                ) : (
                  <span />
                )}
                <Button type="submit" loading={create.isPending} disabled={!name.trim()} data-testid="org-submit">
                  Crear organización
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
