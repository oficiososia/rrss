import { CalendarDays, Megaphone } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { campaignPaths, campaignsAvailable } from '@/features/campaigns/labels';
import { useBrand, useOrg } from '@/features/orgs/context';
import { useTextTask } from '@/features/platform/integrations/useFeature';
import { cn } from '@/lib/utils';

/**
 * Las dos vistas del Calendario: el calendario y sus campañas (planes de varias piezas). Campañas
 * ya no es una sección del menú. Sin forma de preparar un plan (ni IA de texto ni agencia), no sale.
 */
export function CalendarTabs() {
  const { org } = useOrg();
  const { brand } = useBrand();
  const aiText = useTextTask('campaign.plan');
  if (!campaignsAvailable(brand, aiText)) return null;
  const tabs = [
    { to: `/o/${org.id}/m/${brand.id}/calendario`, label: 'Calendario', icon: CalendarDays, end: true, id: 'calendar' },
    { to: campaignPaths(org.id, brand.id).list, label: 'Campañas', icon: Megaphone, end: false, id: 'campaigns' },
  ];
  return (
    <nav aria-label="Vistas del calendario" className="flex rounded-lg border border-border" data-testid="calendar-tabs">
      {tabs.map(({ to, label, icon: Icon, end, id }) => (
        <NavLink
          key={id}
          to={to}
          end={end}
          data-testid={`calendar-tab-${id}`}
          className={({ isActive }) =>
            cn(
              'inline-flex h-9 items-center gap-1.5 px-3 text-sm first:rounded-l-lg last:rounded-r-lg',
              isActive ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:bg-subtle hover:text-fg',
            )
          }
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
