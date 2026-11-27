import { useBrand } from '@/features/orgs/context';
import { safeZone } from './zone';

/** Zona horaria de la marca actual (la de por defecto si la guardada no se conoce). */
export function useBrandZone(): string {
  return safeZone(useBrand().brand.timezone);
}
