import {
  BarChart3,
  CalendarDays,
  Building2,
  ClipboardList,
  FileText,
  Check,
  ChevronsUpDown,
  Home,
  Images,
  LayoutGrid,
  LogOut,
  Megaphone,
  Monitor,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui';
import { APP_NAME } from '@/config/app';
import { campaignsAvailable } from '@/features/campaigns/labels';
import { useUser } from '@/features/auth/AuthProvider';
import { LegalFooter } from '@/features/legal/LegalFooter';
import { useBrandsElsewhere, useIsPlatformAdmin, type MyOrganization } from '@/features/orgs/api';
import { useUnreadRequestNotifications } from '@/features/requests/notifications';
import type { BrandRow } from '@/lib/database.types';
import { translateError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { cn, initials } from '@/lib/utils';
import { MobileNav } from './MobileNav';
import { NavBadge, type NavItem } from './nav';
import { useTheme, type ThemeChoice } from './theme';
import { useTextTask } from '@/features/platform/integrations/useFeature';
import { useWorkspace, WorkspaceProvider } from './workspace';

interface AppShellProps {
  orgs: MyOrganization[];
  org: MyOrganization;
  brands: BrandRow[];
  brand: BrandRow | null;
  children: ReactNode;
}

function navItems(org: MyOrganization, brand: BrandRow | null, unreadRequests = 0, aiText = false): NavItem[] {
  const base = `/o/${org.id}`;
  const settings: NavItem = { to: `${base}/ajustes`, label: 'Configuración', icon: Settings };
  if (!brand) return [{ to: base, label: 'Marcas', icon: LayoutGrid, end: true }, settings];
  const b = `${base}/m/${brand.id}`;
  return [
    { to: `${b}/inicio`, label: 'Inicio', icon: Home },
    { to: `${b}/contenidos`, label: 'Contenidos', icon: FileText },
    // Encargos: solo con la marca en modo agencia (quien los atiende es la agencia).
    ...(brand.ai_mode === 'agency'
      ? [{ to: `${b}/encargos`, label: 'Encargos', icon: ClipboardList, badge: unreadRequests }]
      : []),
    { to: `${b}/calendario`, label: 'Calendario', icon: CalendarDays },
    // Campañas: con IA de texto conectada o con la marca en modo agencia (docs/03, área «Campañas»).
    ...(campaignsAvailable(brand, aiText) ? [{ to: `${b}/campanas`, label: 'Campañas', icon: Megaphone }] : []),
    { to: `${b}/analitica`, label: 'Analítica', icon: BarChart3 },
    { to: `${b}/biblioteca`, label: 'Biblioteca', icon: Images },
    { to: `${b}/marca`, label: 'Marca', icon: Palette },
    { to: `${b}/equipo`, label: 'Equipo', icon: Users },
    settings,
  ];
}

const switcherButton =
  'flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-sm hover:bg-subtle';

/**
 * El ÚNICO selector: todas las marcas a las que se tiene acceso, sean de la organización que sean.
 * Antes había dos (organización y marca) y para ir a una marca de otra organización había que cambiar
 * primero de organización. La organización ya no se elige: se lee (debajo del nombre de la marca) y,
 * con más de una, agrupa las marcas del menú.
 */
function BrandSwitcher({
  orgs,
  org,
  brands,
  brand,
}: {
  orgs: MyOrganization[];
  org: MyOrganization;
  brands: BrandRow[];
  brand: BrandRow | null;
}) {
  const navigate = useNavigate();
  const visible = brands.filter((b) => b.status !== 'archived' || b.id === brand?.id);
  const canCreate = org.role === 'owner' || org.role === 'admin';
  const others = orgs.filter((o) => o.id !== org.id);
  const elsewhere = useBrandsElsewhere(others.map((o) => o.id));
  return (
    <Menu>
      <MenuTrigger
        className={switcherButton}
        data-testid="brand-switcher"
        aria-label={brand ? `Marca: ${brand.name}. Cambiar` : 'Elegir marca'}
      >
        <Palette className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate', brand ? 'font-medium' : 'text-muted')}>
            {brand ? brand.name : 'Elegir marca'}
          </span>
          <span className="block truncate text-xs text-muted" data-testid="org-name">
            {org.name}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </MenuTrigger>
      <MenuContent>
        <div data-testid="brand-menu">
          <MenuLabel>{others.length > 0 ? org.name : 'Marcas'}</MenuLabel>
          {visible.length === 0 && <p className="px-2.5 py-2 text-sm text-muted">Todavía no hay marcas.</p>}
          {visible.map((b) => (
            <MenuItem
              key={b.id}
              onSelect={() => navigate(`/o/${org.id}/m/${b.id}/inicio`)}
              data-testid={`brand-option-${b.id}`}
            >
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {b.id === brand?.id && <Check className="h-4 w-4 text-primary" aria-label="Seleccionada" />}
            </MenuItem>
          ))}
          {others.map((other) => {
            const theirs = (elsewhere.data ?? []).filter((b) => b.organization_id === other.id);
            return (
              <div key={other.id} data-testid={`brand-group-${other.id}`}>
                <MenuSeparator />
                <MenuLabel>{other.name}</MenuLabel>
                {theirs.map((b) => (
                  <MenuItem
                    key={b.id}
                    onSelect={() => navigate(`/o/${other.id}/m/${b.id}/inicio`)}
                    data-testid={`brand-option-${b.id}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  </MenuItem>
                ))}
                {/* Sin marcas (o sin haberlas leído todavía), se entra a la organización: allí se crean. */}
                {theirs.length === 0 && (
                  <MenuItem onSelect={() => navigate(`/o/${other.id}`)} data-testid={`org-option-${other.id}`}>
                    <Building2 className="h-4 w-4" aria-hidden />
                    {elsewhere.isPending ? 'Abrir' : 'Todavía sin marcas: abrir'}
                  </MenuItem>
                )}
              </div>
            );
          })}
          <MenuSeparator />
          <MenuItem onSelect={() => navigate(`/o/${org.id}`)}>
            <LayoutGrid className="h-4 w-4" aria-hidden />
            Ver todas las marcas
          </MenuItem>
          {canCreate && (
            <MenuItem onSelect={() => navigate(`/o/${org.id}/marcas/nueva`)}>
              <Plus className="h-4 w-4" aria-hidden />
              Nueva marca
            </MenuItem>
          )}
          <MenuItem onSelect={() => navigate('/bienvenida')} data-testid="new-organization">
            <Building2 className="h-4 w-4" aria-hidden />
            Crear organización
          </MenuItem>
        </div>
      </MenuContent>
    </Menu>
  );
}

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'Como el sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
];

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const user = useUser();
  const navigate = useNavigate();
  const { choice, setChoice } = useTheme();
  const isPlatformAdmin = useIsPlatformAdmin(user.id).data === true;
  const fullName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '';
  const display = fullName || user.email || 'Cuenta';

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(translateError(error));
    else navigate('/login', { replace: true });
  }

  return (
    <Menu>
      <MenuTrigger
        data-testid="user-menu"
        aria-label={`Cuenta de ${display}`}
        className={cn(
          'flex min-w-0 items-center gap-2.5 rounded-lg text-left text-sm hover:bg-subtle',
          compact ? 'p-1' : 'w-full px-2 py-2',
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
          {initials(display)}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{display}</span>
            {fullName && <span className="block truncate text-xs text-muted">{user.email}</span>}
          </span>
        )}
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Apariencia</MenuLabel>
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <MenuItem key={value} onSelect={() => setChoice(value)} data-testid={`theme-${value}`}>
            <Icon className="h-4 w-4" aria-hidden />
            <span className="flex-1">{label}</span>
            {choice === value && <Check className="h-4 w-4 text-primary" aria-label="Activo" />}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => navigate('/cuenta')} data-testid="nav-account">
          <UserRound className="h-4 w-4" aria-hidden />
          Mi cuenta y privacidad
        </MenuItem>
        {isPlatformAdmin && (
          <MenuItem onSelect={() => navigate('/plataforma')} data-testid="nav-platform">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Plataforma
          </MenuItem>
        )}
        <MenuItem onSelect={() => void signOut()} data-testid="sign-out">
          <LogOut className="h-4 w-4" aria-hidden />
          Cerrar sesión
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <WorkspaceProvider>
      <Shell {...props} />
    </WorkspaceProvider>
  );
}

function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? 'Mostrar menú' : 'Ocultar menú';
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls="menu-lateral"
      aria-label={label}
      aria-keyshortcuts="Control+B"
      title={`${label} (Ctrl+B)`}
      data-testid="sidebar-toggle"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}

function Shell({ orgs, org, brands, brand, children }: AppShellProps) {
  const unread = useUnreadRequestNotifications(brand?.id, brand?.ai_mode === 'agency');
  const aiText = useTextTask('campaign.plan');
  const { working, collapsed, toggle } = useWorkspace();
  const items = navItems(org, brand, unread.data?.length ?? 0, aiText);
  return (
    <div
      className={cn(
        'min-h-dvh lg:grid',
        collapsed ? 'lg:grid-cols-[3.75rem_minmax(0,1fr)]' : 'lg:grid-cols-[17rem_minmax(0,1fr)]',
        // Pantalla de trabajo: la página mide justo la ventana y no se desplaza.
        working && 'h-dvh overflow-hidden',
      )}
      data-testid="app-shell"
      data-sidebar={collapsed ? 'collapsed' : 'expanded'}
    >
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Saltar al contenido
      </a>

      {/* Escritorio: barra lateral (completa o plegada a los iconos) */}
      <aside
        id="menu-lateral"
        className={cn(
          'sticky top-0 hidden h-dvh flex-col gap-4 border-r border-border bg-surface lg:flex',
          collapsed ? 'items-center p-2' : 'p-4',
        )}
      >
        <div className={cn('flex items-center gap-2.5', collapsed ? 'flex-col' : 'px-1')}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-fg">
            {APP_NAME.charAt(0)}
          </span>
          {!collapsed && <span className="flex-1 text-base font-semibold tracking-tight">{APP_NAME}</span>}
          <SidebarToggle collapsed={collapsed} onToggle={toggle} />
        </div>
        {!collapsed && <BrandSwitcher orgs={orgs} org={org} brands={brands} brand={brand} />}
        <nav aria-label="Principal" className="w-full flex-1 space-y-1 overflow-y-auto">
          {items.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              data-testid={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[2.75rem] items-center rounded-lg text-sm font-medium transition-colors',
                  collapsed ? 'justify-center' : 'gap-3 px-3',
                  // La sección activa la decide solo la ruta (aria-current lo pone NavLink):
                  // fondo, color y una raya a la izquierda, para no confundirla con el
                  // fondo de «pasar por encima» de la entrada que se acaba de pulsar.
                  isActive
                    ? 'bg-primary-soft font-semibold text-primary before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-primary'
                    : 'text-muted hover:bg-subtle hover:text-fg',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
              <NavBadge count={badge} compact={collapsed} />
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border pt-3">
          <UserMenu compact={collapsed} />
        </div>
      </aside>

      <div className={cn('min-w-0', working && 'flex h-dvh min-h-0 flex-col')}>
        {/* Móvil y tablet (sin menú lateral): cabecera con el mismo selector único */}
        <header className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur lg:hidden">
          <div className="min-w-0 flex-1">
            <BrandSwitcher orgs={orgs} org={org} brands={brands} brand={brand} />
          </div>
          <UserMenu compact />
        </header>

        {working ? (
          // Pantalla de trabajo: sin pie legal ni margen de sobra; en móvil deja sitio al menú inferior.
          <main
            id="contenido"
            className="flex min-h-0 w-full flex-1 flex-col px-3 pb-[calc(3.5rem+env(safe-area-inset-bottom))] pt-2 sm:px-4 lg:px-5 lg:pb-3"
          >
            {children}
          </main>
        ) : (
          <main id="contenido" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
            {children}
            <LegalFooter className="mt-12" />
          </main>
        )}

        {/* Móvil y tablet: 4 secciones fijas y «Más» con el resto */}
        <MobileNav items={items} brandName={brand?.name} />
      </div>
    </div>
  );
}
