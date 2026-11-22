import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useCampaigns } from '@/features/campaigns/api';
import { unwrap } from '@/lib/errors';
import { readLocal, writeLocal } from '@/lib/localStore';
import { supabase } from '@/lib/supabase';
import { socialKeys, useSchedulableContents, type CalendarContent } from './api';
import { isCalendarView, type CalendarView } from './calendar';
import { clampGoal, DEFAULT_WEEKLY_GOAL, type BandCampaign } from './calendarPlan';

// Datos que solo usa el calendario para planificar: campañas activas (solo
// lectura), qué piezas están en cada campaña, qué piezas faltan por programar y
// las preferencias de este dispositivo (vista y objetivo semanal).

const VIEW_KEY = 'rrss.calendar.view';
const goalKey = (brandId: string) => `rrss.calendar.goal.${brandId}`;

/** Vista de partida: la recordada; si no hay, la semana en pantallas anchas y la lista en las estrechas. */
export function initialView(): CalendarView {
  const saved = readLocal<unknown>(VIEW_KEY, null);
  if (isCalendarView(saved)) return saved;
  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches;
  return wide ? 'week' : 'agenda';
}

export function useCalendarView(): [CalendarView, (view: CalendarView) => void] {
  const [view, setView] = useState<CalendarView>(initialView);
  const choose = useCallback((next: CalendarView) => {
    setView(next);
    writeLocal(VIEW_KEY, next);
  }, []);
  return [view, choose];
}

/** Objetivo de publicaciones por semana de la marca. Se guarda en este dispositivo. */
export function useWeeklyGoal(brandId: string): [number, (goal: number) => void] {
  const [goal, setGoal] = useState(() => clampGoal(readLocal<unknown>(goalKey(brandId), DEFAULT_WEEKLY_GOAL)));
  const choose = useCallback(
    (next: number) => {
      const value = clampGoal(next);
      setGoal(value);
      writeLocal(goalKey(brandId), value);
    },
    [brandId],
  );
  return [goal, choose];
}

/** Campañas aceptadas (las que están en marcha), para pintar su franja y filtrar. Solo lectura. */
export function useActiveCampaigns(brandId: string): BandCampaign[] {
  const campaigns = useCampaigns(brandId);
  return (campaigns.data ?? [])
    .filter((c) => c.status === 'accepted')
    .map((c) => ({ id: c.id, title: c.title, starts_on: c.starts_on, ends_on: c.ends_on }));
}

/** Qué campañas lleva cada pieza (para filtrar el calendario por campaña). */
export function useCampaignLinks(brandId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...socialKeys.calendar(brandId), 'campaign-links'] as const,
    enabled,
    queryFn: async (): Promise<Map<string, string[]>> => {
      const rows = unwrap(
        await supabase.from('campaign_contents').select('campaign_id, content_id').eq('brand_id', brandId).limit(2000),
      );
      const map = new Map<string, string[]>();
      for (const r of rows) map.set(r.content_id, [...(map.get(r.content_id) ?? []), r.campaign_id]);
      return map;
    },
  });
}

/** Piezas con la que se puede planificar y que aún no están en el calendario: aprobadas y borradores con versión. */
export function useUnscheduled(brandId: string, enabled: boolean) {
  const contents = useSchedulableContents(brandId, enabled);
  const used = useQuery({
    queryKey: [...socialKeys.calendar(brandId), 'in-use'] as const,
    enabled,
    queryFn: async (): Promise<Set<string>> => {
      const rows = unwrap(
        await supabase
          .from('scheduled_publications')
          .select('content_id, status')
          .eq('brand_id', brandId)
          .in('status', ['planned', 'scheduled', 'publishing', 'published'])
          .limit(2000),
      );
      return new Set(rows.map((r) => r.content_id));
    },
  });
  const list: CalendarContent[] = [];
  if (contents.data && used.data) {
    for (const c of contents.data) {
      if (used.data.has(c.id)) continue;
      if (c.status === 'approved' || (c.status === 'draft' && c.current_version > 0)) list.push(c);
    }
    list.sort((a, b) => Number(b.status === 'approved') - Number(a.status === 'approved'));
  }
  return { list, isPending: contents.isPending || used.isPending };
}
