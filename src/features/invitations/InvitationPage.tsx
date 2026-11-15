import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailOpen } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, CardBody, ErrorState, Notice, Spinner } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { useAuth } from '@/features/auth/AuthProvider';
import { BRAND_ROLE_LABEL, ORG_ROLE_LABEL } from '@/features/permissions/roles';
import { translateError, unwrap } from '@/lib/errors';
import { removeLocal, writeLocal } from '@/lib/localStore';
import { supabase } from '@/lib/supabase';
import { PENDING_INVITE_KEY } from './pending';

export function InvitationPage() {
  const { token = '' } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const here = `/invitacion/${token}`;

  // Sin sesión se guarda el token: tras entrar o registrarse se vuelve aquí.
  useEffect(() => {
    if (!loading && !user && token) writeLocal(PENDING_INVITE_KEY, token);
  }, [loading, user, token]);

  const preview = useQuery({
    queryKey: ['invitation', token, user?.id],
    enabled: Boolean(user && token),
    retry: false,
    queryFn: async () => unwrap(await supabase.rpc('get_invitation', { p_token: token }))[0] ?? null,
  });

  const accept = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('accept_invitation', { p_token: token })),
    onSuccess: async (orgId) => {
      removeLocal(PENDING_INVITE_KEY);
      await queryClient.invalidateQueries();
      navigate(`/o/${orgId}`, { replace: true });
    },
  });

  function dismiss() {
    removeLocal(PENDING_INVITE_KEY);
    navigate('/', { replace: true });
  }

  const myEmail = user?.email?.toLowerCase() ?? '';
  const invitation = preview.data;
  const wrongAccount = Boolean(invitation && invitation.email !== myEmail);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardBody className="space-y-4 text-center">
          <MailOpen className="mx-auto h-8 w-8 text-primary" aria-hidden />
          <h1 className="text-xl">Invitación a {APP_NAME}</h1>

          {loading ? (
            <Spinner />
          ) : !user ? (
            <div className="space-y-4" data-testid="invitation-needs-login">
              <p className="text-sm text-muted">
                Para aceptarla, entra con la cuenta del correo al que te la enviaron. Si aún no tienes cuenta, créala
                con ese mismo correo.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Link to="/login" state={{ from: here }}>
                  <Button className="w-full">Iniciar sesión</Button>
                </Link>
                <Link to="/registro" state={{ from: here }}>
                  <Button variant="secondary" className="w-full">
                    Crear cuenta
                  </Button>
                </Link>
              </div>
            </div>
          ) : preview.isPending ? (
            <Spinner />
          ) : preview.isError ? (
            <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
          ) : !invitation || !invitation.usable ? (
            <div className="space-y-4" data-testid="invitation-invalid">
              <p className="text-sm text-muted">
                Esta invitación no existe, ya se ha usado, se ha anulado o ha caducado. Pide a quien te invitó que te
                envíe una nueva.
              </p>
              <Button variant="secondary" onClick={dismiss}>
                Ir al inicio
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                Te han invitado a <strong>{invitation.organization_name}</strong> como{' '}
                <strong>{ORG_ROLE_LABEL[invitation.org_role]}</strong>
                {invitation.brand_name && invitation.brand_role && (
                  <>
                    , con el rol <strong>{BRAND_ROLE_LABEL[invitation.brand_role]}</strong> en la marca{' '}
                    <strong>{invitation.brand_name}</strong>
                  </>
                )}
                .
              </p>
              {wrongAccount && (
                <Notice tone="warning">
                  <span data-testid="invitation-wrong-account">
                    La invitación es para <strong>{invitation.email}</strong> y has entrado como{' '}
                    <strong>{myEmail}</strong>. Cierra sesión y entra con la cuenta correcta.
                  </span>
                </Notice>
              )}
              {accept.isError && (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                  {translateError(accept.error)}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button
                  onClick={() => accept.mutate()}
                  loading={accept.isPending}
                  disabled={wrongAccount}
                  data-testid="invitation-accept"
                >
                  Aceptar invitación
                </Button>
                <Button variant="secondary" onClick={dismiss}>
                  Ahora no
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
