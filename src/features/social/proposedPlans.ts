import { useMemo } from 'react';
import { useCampaigns, useCampaignsOverview } from '@/features/campaigns/api';
import type { CampaignRow } from '@/lib/database.types';
import type { GhostPiece } from './CalendarViews';

// El plan propuesto (campaña «por revisar», sin aceptar) en el calendario: un aviso arriba y sus
// piezas en gris en su día hasta que se acepta. Solo se LEE de Campañas (sus consultas, desde
// fuera); aceptar o descartar se hace en la ficha de la campaña.

export interface ProposedPlan {
  campaign: Pick<CampaignRow, 'id' | 'title' | 'starts_on' | 'ends_on'>;
  pieces: number;
}

/** Las piezas de los planes propuestos, por día (AAAA-MM-DD), y la lista de planes para el aviso. */
export function useProposedPlans(brandId: string, enabled = true) {
  const campaigns = useCampaigns(brandId);
  const proposed = useMemo(
    () => (enabled ? (campaigns.data ?? []).filter((c) => c.status === 'proposed' && c.current_plan_version > 0) : []),
    [campaigns.data, enabled],
  );
  const overview = useCampaignsOverview(brandId, proposed);

  return useMemo(() => {
    const ghostsByDay = new Map<string, GhostPiece[]>();
    const plans: ProposedPlan[] = [];
    for (const campaign of proposed) {
      const plan = overview.data?.plans.get(campaign.id);
      if (!plan) continue;
      plans.push({ campaign, pieces: plan.pieces.length });
      plan.pieces.forEach((piece, index) => {
        const list = ghostsByDay.get(piece.date) ?? [];
        list.push({
          key: `${campaign.id}:${index}`,
          campaignTitle: campaign.title,
          network: piece.network,
          format: piece.format,
          idea: piece.idea,
        });
        ghostsByDay.set(piece.date, list);
      });
    }
    return { plans, ghostsByDay };
  }, [proposed, overview.data]);
}
