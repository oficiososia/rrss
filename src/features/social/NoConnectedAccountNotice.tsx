import { Link2Off } from 'lucide-react';
import { ActionNotice, LinkButton } from '@/components/ui';
import { noAccountText, type ConnectionState } from './connectedAccount';
import { connectedAccountsPath } from './links';

/**
 * «No hay ninguna cuenta conectada» con el botón que lleva a conectarla (Marca → Cuentas
 * conectadas). Va donde se iba a aprobar, programar o publicar, en lugar de hacerlo a medias.
 */
export function NoConnectedAccountNotice({
  orgId,
  brandId,
  state = 'none',
  why,
  className,
  testId = 'no-account-notice',
}: {
  orgId: string;
  brandId: string;
  state?: ConnectionState;
  /** Qué pasa mientras tanto (p. ej. «La pieza no se ha aprobado.»). */
  why?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <ActionNotice
      icon={Link2Off}
      title={noAccountText(state)}
      action={
        <LinkButton to={connectedAccountsPath(orgId, brandId)} data-testid={`${testId}-connect`}>
          {state === 'needs_reauth' ? 'Volver a conectar' : 'Conectar la cuenta'}
        </LinkButton>
      }
      why={why}
      className={className}
      data-testid={testId}
    />
  );
}
