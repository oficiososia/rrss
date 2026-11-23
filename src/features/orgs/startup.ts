import type { QueryClient } from '@tanstack/react-query';
import { aiTextEnabled } from '@/config/app';
import { callIntegrations, integrationKeys } from '@/features/platform/integrations/api';
import { legalAcceptancesQuery } from '@/features/privacy/api';
import { readLocal } from '@/lib/localStore';
import { brandsQuery, myBrandRolesQuery, myOrganizationsQuery, platformAdminQuery } from './api';
import { lastSelectionKey, type LastSelection } from './context';

/**
 * Organización de la dirección a la que se entra: la de `/o/:orgId/…` o, en «/», la última que se
 * visitó (RootRedirect lleva allí sin esperar a la lista de organizaciones).
 */
export function startupOrgId(pathname: string, userId: string): string | undefined {
  const match = /^\/o\/([^/]+)/.exec(pathname);
  if (match) return decodeURIComponent(match[1]!);
  if (pathname === '/') return readLocal<LastSelection>(lastSelectionKey(userId), {}).orgId;
  return undefined;
}

// ¿Se entró en frío por «/» y RootRedirect todavía no ha decidido? Antes de lanzar las consultas a la
// vez, al entrar así la lista de organizaciones nunca estaba lista y RootRedirect iba directo a la
// última organización (la que, si ya no hay acceso, enseña «No tienes acceso» y la olvida). Ahora la
// lista puede llegar antes; con esta marca se decide igual que siempre, sin depender de quién llegue antes.
let coldRootEntry = false;

/** Entrada en frío por «/» pendiente de decidir (ver arriba). */
export function isColdRootEntry(): boolean {
  return coldRootEntry;
}

/** RootRedirect ya ha decidido: las siguientes visitas a «/» se deciden con la lista. */
export function endColdRootEntry(): void {
  coldRootEntry = false;
}

/**
 * Lanza A LA VEZ todas las consultas que necesita el arranque, en cuanto se sabe la sesión.
 *
 * Antes iban en cascada: primero la aceptación de los documentos legales y si se administra la
 * plataforma (LegalGate); al llegar, las organizaciones, las marcas y los permisos por marca
 * (OrgLayout); y al llegar ésas, la pantalla. Con cada viaje a Supabase de unos cientos de
 * milisegundos, el armazón tardaba varios segundos en salir. Ahora todo sale en el mismo instante y
 * cada componente encuentra su consulta ya en marcha (misma clave): no se pide nada dos veces.
 *
 * Solo adelanta lecturas que se iban a hacer igualmente; no cambia lo que se enseña ni los permisos
 * (RLS decide qué filas vuelven).
 */
export function prefetchStartup(queryClient: QueryClient, userId: string, pathname: string): void {
  coldRootEntry = pathname === '/';
  void queryClient.prefetchQuery(legalAcceptancesQuery(userId));
  void queryClient.prefetchQuery(platformAdminQuery(userId));
  void queryClient.prefetchQuery(myOrganizationsQuery(userId));
  const orgId = startupOrgId(pathname, userId);
  if (orgId) {
    void queryClient.prefetchQuery(brandsQuery(orgId));
    void queryClient.prefetchQuery(myBrandRolesQuery(orgId, userId));
  }
  // El menú pregunta si hay IA de texto (useFeature('aiText') en OrgLayout): misma clave y misma
  // llamada que useIntegrationAvailability, para que la función del servidor arranque ya.
  if (aiTextEnabled()) {
    void queryClient.prefetchQuery({
      queryKey: integrationKeys.availability,
      queryFn: () => callIntegrations({ action: 'availability' }),
      staleTime: 5 * 60_000,
    });
  }
}
