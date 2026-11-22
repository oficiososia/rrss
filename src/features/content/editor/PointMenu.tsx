import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { Fragment } from 'react';
import { MenuItem, MenuSeparator, type MoreMenuItem } from '@/components/ui';

/**
 * Menú que se abre en un punto de la ventana: el del botón derecho sobre el
 * lienzo. Es el mismo menú accesible de siempre (flechas, Intro, Escape), con
 * un disparador invisible colocado donde está el puntero.
 */
export function PointMenu({
  at,
  items,
  label,
  onClose,
}: {
  /** Dónde se abre, en coordenadas de la ventana; null = cerrado. */
  at: { x: number; y: number } | null;
  items: MoreMenuItem[];
  label: string;
  onClose: () => void;
}) {
  // Sin separadores al principio, al final ni repetidos.
  const clean = items.filter((item, i, all) => item !== null || (i > 0 && i < all.length - 1 && all[i - 1] !== null));
  if (!at || !clean.some(Boolean)) return null;
  return (
    <Dropdown.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <Dropdown.Trigger asChild>
        <span
          aria-label={label}
          className="pointer-events-none fixed h-px w-px"
          style={{ left: at.x, top: at.y }}
          data-testid="point-menu-anchor"
        />
      </Dropdown.Trigger>
      {/* Al lado del puntero y no debajo: así, si no cabe, se desliza hacia arriba en vez de salirse de la ventana. */}
      <Dropdown.Portal>
        <Dropdown.Content
          side="right"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          className="z-50 max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] min-w-[14rem] max-w-[90vw] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-pop"
        >
          {clean.map((item, i) =>
            item === null ? (
              <MenuSeparator key={`sep-${i}`} />
            ) : (
              <Fragment key={item.id}>
                <MenuItem
                  onSelect={item.onSelect}
                  destructive={item.destructive}
                  disabled={item.disabled}
                  title={item.hint}
                  data-testid={item.testId}
                >
                  {item.icon && <item.icon className="h-4 w-4 shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1">{item.label}</span>
                </MenuItem>
              </Fragment>
            ),
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
