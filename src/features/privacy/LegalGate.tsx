import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, Spinner } from '@/components/ui';
import { useUser } from '@/features/auth/AuthProvider';
import { useIsPlatformAdmin } from '@/features/orgs/api';
import { LEGAL_VERSIONS, legalPath } from '@/features/legal/legal';
import { supabase } from '@/lib/supabase';
import { translateError } from '@/lib/errors';
import { acceptedCurrent, useAcceptLegal, useLegalAcceptances } from './api';

const LABEL = { terms: 'las condiciones de uso', privacy: 'la política de privacidad' } as const;

/** Qué documentos tienen una versión vigente que la persona no ha aceptado. */
// eslint-disable-next-line react-refresh/only-export-components
export function pendingDocuments(rows: { document: 'terms' | 'privacy'; version: string }[]): ('terms' | 'privacy')[] {
  return (['terms', 'privacy'] as const).filter(
    (doc) => !rows.some((r) => r.document === doc && r.version === LEGAL_VERSIONS[doc]),
  );
}

/**
 * Bloquea la aplicación hasta aceptar la versión vigente de las condiciones y de
 * la política de privacidad. Deja pasar «Mi cuenta» (para descargar o borrar los
 * datos sin tener que aceptar nada) y cerrar sesión. La aceptación queda en
 * `legal_acceptances` con la hora del servidor (`accept_legal_documents`).
 * No bloquea a los superadministradores (uso interno de la agencia).
 *
 * Es un bloqueo de la interfaz: la base de datos no impide usar la API a quien
 * no haya aceptado. Si no se puede leer el registro de aceptaciones, no se
 * bloquea (no se deja a nadie fuera por un fallo de lectura).
 */
export function LegalGate() {
  const user = useUser();
  const location = useLocation();
  const acceptances = useLegalAcceptances(user.id);
  const accept = useAcceptLegal(user.id);
  const platformAdmin = useIsPlatformAdmin(user.id);
  const [checked, setChecked] = useState(false);

  if (location.pathname === '/cuenta') return <Outlet />;
  // Uso interno de la agencia: quien administra la plataforma no se bloquea.
  if (platformAdmin.data === true) return <Outlet />;
  if (acceptances.isPending || platformAdmin.isPending) return <Spinner className="min-h-dvh" />;
  if (acceptances.isError || acceptedCurrent(acceptances.data)) return <Outlet />;

  const rows = acceptances.data;
  const pending = pendingDocuments(rows);
  const first = rows.length === 0;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-subtle px-4 py-10" data-testid="legal-gate">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-gate-title"
        className="w-full max-w-lg space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-lg"
      >
        <ScrollText className="h-8 w-8 text-primary" aria-hidden />
        <h1 id="legal-gate-title" className="text-xl font-semibold">
          {first ? 'Antes de seguir, lee y acepta' : 'Hemos actualizado nuestros documentos'}
        </h1>
        <p className="text-sm" data-testid="legal-gate-text">
          {first ? 'No consta que hayas aceptado ' : 'Ha cambiado la versión vigente de '}
          {pending.map((doc) => LABEL[doc]).join(' y ')}
          {first ? '.' : ': tienes que leerla y aceptarla para seguir usando la aplicación.'}
        </p>
        <ul className="space-y-1 text-sm">
          {pending.map((doc) => (
            <li key={doc}>
              <Link to={legalPath(doc)} target="_blank" className="text-primary underline">
                {doc === 'terms' ? 'Condiciones de uso' : 'Política de privacidad'}
              </Link>{' '}
              <span className="text-muted">(versión {LEGAL_VERSIONS[doc]})</span>
            </li>
          ))}
        </ul>
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            data-testid="legal-gate-check"
          />
          <span>He leído y acepto {pending.map((doc) => LABEL[doc]).join(' y ')}.</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!checked}
            loading={accept.isPending}
            onClick={() =>
              accept.mutate(undefined, {
                onSuccess: () => toast.success('Aceptación guardada'),
                onError: (e) => toast.error(translateError(e)),
              })
            }
            data-testid="legal-gate-accept"
          >
            Aceptar y continuar
          </Button>
          <Link to="/cuenta" className="text-sm text-primary underline" data-testid="legal-gate-account">
            Descargar o borrar mis datos
          </Link>
          <button
            type="button"
            className="text-sm text-muted underline"
            onClick={() => void supabase.auth.signOut()}
            data-testid="legal-gate-signout"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
