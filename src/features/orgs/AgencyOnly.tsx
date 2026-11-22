import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useBrand, useOrg } from './context';
import { useWorkMode } from './workMode';

/** Pantallas que solo tienen sentido con una agencia de por medio (Encargos): en autogestión, al inicio de la marca. */
export function AgencyOnly({ children }: { children: ReactNode }) {
  const { org } = useOrg();
  const { brand } = useBrand();
  const { selfManaged } = useWorkMode();
  if (selfManaged) return <Navigate to={`/o/${org.id}/m/${brand.id}/inicio`} replace />;
  return <>{children}</>;
}
