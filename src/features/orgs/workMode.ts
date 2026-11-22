import { useContext } from 'react';
import { useUser } from '@/features/auth/AuthProvider';
import type { OrganizationRow, OrgWorkMode } from '@/lib/database.types';
import { useMyOrganizations } from './api';
import { OrgContext } from './context';

// Cómo trabaja la organización (migración 20261227010000):
//   · `self`   «Lo llevamos nosotros»: el equipo lo hace todo, con toda la IA a mano.
//   · `agency` «Nos lo lleva una agencia»: encargos, IA cerrada al cliente (flujo de siempre).
// La base de datos garantiza que en autogestión ninguna marca está en modo agencia
// (`brands.ai_mode = 'api'`), así que las pantallas que miran la marca ya se
// comportan; este módulo es para lo que depende de la organización.

export const WORK_MODE_OPTIONS: { value: OrgWorkMode; title: string; help: string }[] = [
  {
    value: 'self',
    title: 'Lo llevamos nosotros',
    help: 'Quien edita una marca usa toda la IA (textos, imágenes, vídeo, copiloto), las plantillas y el calendario directamente. No hay encargos ni agencia de por medio.',
  },
  {
    value: 'agency',
    title: 'Nos lo lleva una agencia',
    help: 'Una agencia prepara los textos y las piezas por encargo («Encargos»), y en cada marca se elige si el cliente puede o no usar la IA.',
  },
];

/** El modo de una organización; sin la columna (base sin migrar) se deduce del tipo. */
export function workModeOf(org: Pick<OrganizationRow, 'kind'> & { work_mode?: OrgWorkMode }): OrgWorkMode {
  return org.work_mode ?? (org.kind === 'agency' ? 'agency' : 'self');
}

/**
 * Modo de la organización a la vista. Fuera de una organización (pruebas
 * aisladas de un componente) se conserva el comportamiento de siempre: agencia.
 */
export function useWorkMode(): { mode: OrgWorkMode; selfManaged: boolean } {
  const ctx = useContext(OrgContext);
  const mode: OrgWorkMode = ctx ? workModeOf(ctx.org) : 'agency';
  return { mode, selfManaged: mode === 'self' };
}

/**
 * Lo comercial (planes de pago, cupos, márgenes, precio de venta, cobros) solo tiene sentido con
 * clientes de por medio. En autogestión estorba: las pantallas de la organización lo esconden con
 * `useWorkMode().selfManaged`.
 *
 * Las de Plataforma no son de ninguna organización, así que miran las de quien las abre: si lleva
 * alguna organización y TODAS son de autogestión, la instalación es de uso interno y lo comercial
 * se guarda (plegado o fuera). En cuanto una pasa a «Nos lo lleva una agencia», vuelve a verse
 * todo; sin organizaciones, o si no se pueden leer, también (como siempre).
 *
 * `pending`: todavía no se sabe. Las pantallas esperan a saberlo antes de pintar lo comercial,
 * para que no asome un momento y desaparezca.
 */
export function useInternalUseState(): { internal: boolean; pending: boolean } {
  const user = useUser();
  const orgs = useMyOrganizations(user.id);
  const mine = orgs.data ?? [];
  return {
    internal: mine.length > 0 && mine.every((org) => workModeOf(org) === 'self'),
    pending: orgs.isPending,
  };
}

/** Lo mismo, sin distinguir «todavía no se sabe» (vale donde solo cambia un texto). */
export function useInternalUse(): boolean {
  return useInternalUseState().internal;
}
