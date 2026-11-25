import { CalendarRange, Images, Plus, Sparkles, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui';
import { reelLikeEnabled } from '@/config/app';
import { campaignPaths, campaignsAvailable } from '@/features/campaigns/labels';
import { FORMAT_CARDS } from '@/features/content/lista/formats';
import { makeBrandContext, useOrg } from '@/features/orgs/context';
import type { BrandRow } from '@/lib/database.types';
import { cn } from '@/lib/utils';

// «Hacer un reel como este» se pregunta desde un trozo aparte: el módulo de reels no entra en el arranque.
const ReelLikeProbe = lazy(() => import('./ReelLikeProbe'));

// La ventana «Nueva idea» (con sus plantillas) se descarga al pedirla: el menú está en todas las pantallas.
const CreateContentDialog = lazy(() =>
  import('@/features/content/CreateContentDialog').then((m) => ({ default: m.CreateContentDialog })),
);

/** Dónde se pinta el botón: menú lateral (completo o plegado) o el «＋» del centro de la barra inferior. */
export type CreateMenuPlacement = 'sidebar' | 'sidebar-compact' | 'mobile';

interface CreateEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/**
 * Lo que se puede crear en una marca, según los permisos de cada persona. Sin nada que crear
 * (solo lectura), el botón no sale.
 */
function useCreateEntries(
  brand: BrandRow | null,
  aiText: boolean,
  reelLikeAvailable: boolean,
  openDialog: (format: string) => void,
) {
  const { org, brandRoles } = useOrg();
  const navigate = useNavigate();
  const ctx = brand ? makeBrandContext(org, brand, brandRoles.get(brand.id)) : null;
  const canEdit = ctx?.can('edit') ?? false;
  // «Hacer un reel como este» solo sale si el servidor puede hacerlo para esta marca (ver ReelLikeProbe).
  const askReelLike = Boolean(brand) && reelLikeEnabled() && canEdit;
  if (!brand || !ctx) return { entries: [] as CreateEntry[], askReelLike };
  const base = `/o/${org.id}/m/${brand.id}`;
  const agency = brand.ai_mode === 'agency';
  // Con la IA hace falta poder crear contenido; a la agencia lo pide quien puede comentar (como un encargo).
  const canAskPlan = campaignsAvailable(brand, aiText) && (agency ? ctx.can('comment') : canEdit);

  const entries: CreateEntry[] = [];
  if (canEdit) {
    for (const card of FORMAT_CARDS) {
      entries.push({ id: card.format, label: card.label, icon: card.icon, onSelect: () => openDialog(card.format) });
    }
    if (reelLikeAvailable) {
      entries.push({
        id: 'reel-like',
        label: 'Hacer un reel como este',
        icon: Sparkles,
        onSelect: () => navigate(`${base}/biblioteca/reels/como-este`),
      });
    }
    entries.push({
      id: 'menus',
      label: 'Menú o carta del restaurante',
      icon: UtensilsCrossed,
      onSelect: () => navigate(`${base}/menus`),
    });
    entries.push({ id: 'upload', label: 'Subir fotos', icon: Images, onSelect: () => navigate(`${base}/biblioteca`) });
  }
  if (canAskPlan) {
    entries.push({
      id: 'plan',
      label: agency ? 'Pedir un plan a la agencia' : 'Preparar un plan con IA',
      icon: CalendarRange,
      onSelect: () => navigate(`${campaignPaths(org.id, brand.id).list}?nuevo=1`),
    });
  }
  return { entries, askReelLike };
}

/**
 * «＋ Crear»: el único botón principal de la aplicación. Abre la lista de lo que se puede crear; los
 * formatos abren la ventana «Nueva idea» de siempre con ese formato marcado.
 */
export function CreateMenu({
  brand,
  aiText,
  placement,
}: {
  brand: BrandRow | null;
  aiText: boolean;
  placement: CreateMenuPlacement;
}) {
  const { org } = useOrg();
  const [creating, setCreating] = useState<string | null>(null);
  // Respuesta de ReelLikeProbe, con la marca a la que corresponde (al cambiar de marca no vale la anterior).
  const [reelLike, setReelLike] = useState<{ brandId: string; available: boolean } | null>(null);
  const onReelLike = useCallback((brandId: string, available: boolean) => setReelLike({ brandId, available }), []);
  const reelLikeAvailable = Boolean(brand && reelLike?.brandId === brand.id && reelLike.available);
  const { entries, askReelLike } = useCreateEntries(brand, aiText, reelLikeAvailable, setCreating);
  const probe = askReelLike && brand && (
    <Suspense fallback={null}>
      <ReelLikeProbe brandId={brand.id} onChange={onReelLike} />
    </Suspense>
  );
  if (!brand || entries.length === 0) return null;
  const formats = entries.filter((e) => FORMAT_CARDS.some((c) => c.format === e.id));
  const others = entries.filter((e) => !formats.includes(e));

  const menu = (
    <>
      <Menu>
        <MenuTrigger
          data-testid={placement === 'mobile' ? 'create-menu-mobile' : 'create-menu'}
          aria-label="Crear"
          title={placement === 'sidebar-compact' ? 'Crear' : undefined}
          className={cn(
            'inline-flex items-center justify-center gap-2 font-semibold text-primary-fg shadow-card transition-colors',
            'bg-primary hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            placement === 'sidebar' && 'h-11 w-full rounded-lg px-4 text-sm',
            placement === 'sidebar-compact' && 'h-10 w-10 rounded-lg',
            placement === 'mobile' && 'h-11 w-11 rounded-full',
          )}
        >
          <Plus className={placement === 'mobile' ? 'h-6 w-6' : 'h-5 w-5'} aria-hidden />
          {placement === 'sidebar' && <span>Crear</span>}
        </MenuTrigger>
        <MenuContent align={placement === 'mobile' ? 'center' : 'start'} side={placement === 'mobile' ? 'top' : 'bottom'}>
          <div data-testid="create-menu-items">
            {formats.map(({ id, label, icon: Icon, onSelect }) => (
              <MenuItem key={id} onSelect={onSelect} data-testid={`create-menu-${id}`}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </MenuItem>
            ))}
            {formats.length > 0 && others.length > 0 && <MenuSeparator />}
            {others.map(({ id, label, icon: Icon, onSelect }) => (
              <MenuItem key={id} onSelect={onSelect} data-testid={`create-menu-${id}`}>
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </MenuItem>
            ))}
          </div>
        </MenuContent>
      </Menu>
      {creating !== null && (
        <Suspense fallback={null}>
          <CreateContentDialog
            organizationId={org.id}
            brandId={brand.id}
            open
            onOpenChange={(open) => !open && setCreating(null)}
            initialFormat={creating}
          />
        </Suspense>
      )}
    </>
  );
  return placement === 'mobile' ? (
    <div className="flex min-w-0 flex-1 items-center justify-center">
      {menu}
      {probe}
    </div>
  ) : (
    <>
      {menu}
      {probe}
    </>
  );
}
