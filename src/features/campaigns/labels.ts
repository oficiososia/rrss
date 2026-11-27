import type { BrandRow, CampaignStatus } from '@/lib/database.types';
import type { PlanRepeat } from './api';
import { shortDay } from './plan';

// Estados de una campaña, rutas de la sección y cuándo se enseña. Espejo de la
// migración 20261119510000: aquí solo se decide qué enseñar; manda la base de datos.

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  requested: 'Pedido a la agencia',
  proposed: 'Plan por revisar',
  accepted: 'Aceptado',
  discarded: 'Descartado',
};

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, 'neutral' | 'primary' | 'warning' | 'success' | 'danger'> = {
  requested: 'primary',
  proposed: 'warning',
  accepted: 'success',
  discarded: 'neutral',
};

/**
 * ¿Hay forma de preparar un plan en esta marca? Con la IA de texto conectada
 * (VITE_AI_TEXT_ENABLED) o con la marca en modo agencia. Si no, la sección no
 * sale (lo que no funciona no se enseña).
 */
export function campaignsAvailable(brand: Pick<BrandRow, 'ai_mode'>, aiText: boolean): boolean {
  return brand.ai_mode === 'agency' || aiText;
}

/** Campañas es una vista del Calendario (antes, `/campanas`: esas direcciones redirigen aquí). */
export function campaignPaths(orgId: string, brandId: string) {
  const base = `/o/${orgId}/m/${brandId}/calendario/campanas`;
  return { list: base, item: (campaignId: string) => `${base}/${campaignId}` };
}

/** Lo que se dice de los títulos renombrados y las ideas parecidas al terminar el plan. */
export function repeatsText(repeats: readonly PlanRepeat[]): string {
  const renamed = repeats.filter((r) => r.kind === 'title').length;
  const ideas = repeats.filter((r) => r.kind === 'idea');
  const parts: string[] = [];
  if (renamed) {
    parts.push(
      `He cambiado el nombre de ${renamed === 1 ? 'una pieza que se parecía' : `${renamed} piezas que se parecían`} a otra.`,
    );
  }
  if (ideas.length) {
    const days = ideas.map((r) => shortDay(r.date)).join(', ');
    parts.push(
      ideas.length === 1
        ? `Una idea se parece a otra (${days}): revísala.`
        : `${ideas.length} ideas se parecen a otras (${days}): revísalas.`,
    );
  }
  return parts.join(' ');
}
