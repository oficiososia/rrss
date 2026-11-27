import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { NavBadge, type NavItem } from './nav';

const tabClass = (active: boolean) =>
  cn(
    // Cada etiqueta cabe en su botón (a 360-402 px, «Calendario» y «Biblioteca» se tocaban): letra algo
    // menor, un margen a cada lado y, si aun así no cabe, «…». El área táctil sigue siendo de 56 px de alto.
    'relative flex min-h-[3.5rem] min-w-[2.75rem] flex-1 basis-0 flex-col items-center justify-center gap-1 overflow-hidden px-1.5 text-[0.625rem] font-medium leading-tight tracking-tight',
    active ? 'text-primary' : 'text-muted',
  );

/** Marca de la pestaña activa: una raya arriba, además del color. */
function ActiveBar({ active }: { active: boolean }) {
  if (!active) return null;
  return <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />;
}

function Tab({ to, label, icon: Icon, end, badge }: NavItem) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => tabClass(isActive)}>
      {({ isActive }) => (
        <>
          <ActiveBar active={isActive} />
          <span className="relative">
            <Icon className="h-5 w-5" aria-hidden />
            <NavBadge count={badge} compact />
          </span>
          <span className="block max-w-full truncate" data-testid="mobile-nav-label">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

/**
 * Barra inferior del móvil y la tableta, como Instagram: Inicio, Contenidos, «＋ Crear» en medio,
 * Calendario y Biblioteca. Lo demás (Resultados y los ajustes) está en el avatar de la cabecera.
 */
export function MobileNav({ items, create }: { items: NavItem[]; create?: ReactNode }) {
  const half = Math.ceil(items.length / 2);
  return (
    <nav
      aria-label="Principal"
      data-testid="mobile-nav"
      className="fixed inset-x-0 bottom-0 z-30 flex items-center border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {items.slice(0, half).map((item) => (
        <Tab key={item.to} {...item} />
      ))}
      {/* El «＋» trae su propio hueco: sin nada que crear (solo lectura) no ocupa sitio. */}
      {create}
      {items.slice(half).map((item) => (
        <Tab key={item.to} {...item} />
      ))}
    </nav>
  );
}
