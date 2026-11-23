import type { NavItem } from './nav';

/** ¿La dirección actual está dentro de esta entrada? (lo mismo que decide NavLink). */
export function isNavItemActive(item: Pick<NavItem, 'to' | 'end'>, pathname: string): boolean {
  if (pathname === item.to) return true;
  return !item.end && pathname.startsWith(item.to.endsWith('/') ? item.to : `${item.to}/`);
}

/**
 * Secciones fijas en la barra inferior del móvil (por el final de su ruta), con «＋ Crear» en medio:
 * las de uso diario. Resultados (y Encargos, en modo agencia) van al menú de la cuenta.
 */
const MOBILE_PRIMARY_SECTIONS = ['inicio', 'contenidos', 'calendario', 'biblioteca'] as const;

export function isMobilePrimary(item: Pick<NavItem, 'to' | 'end'>): boolean {
  // Sin marca elegida («Marcas»), la única entrada va en la barra.
  if (item.end) return true;
  const last = item.to.split('/').pop() ?? '';
  return (MOBILE_PRIMARY_SECTIONS as readonly string[]).includes(last);
}
