import { addDays, dayKey, sameDay, startOfWeek, type DisplayState } from './calendar';

// Ayudas para planificar el calendario: huecos de la semana, objetivo semanal y
// franjas de las campañas. Todo con fechas de pared de la zona de la marca (ver
// zone.ts) y sin dependencias: se prueba aparte. Sin IA: son cuentas.

/** Objetivo de publicaciones por semana si la marca no ha elegido otro. */
export const DEFAULT_WEEKLY_GOAL = 3;
export const MAX_WEEKLY_GOAL = 21;

/** Lo cancelado no cuenta como planificado. */
export function countsAsPlanned(state: DisplayState): boolean {
  return state !== 'cancelled';
}

export function clampGoal(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WEEKLY_GOAL;
  return Math.min(MAX_WEEKLY_GOAL, Math.max(1, Math.round(n)));
}

/** Los siete días (lunes a domingo) de la semana de la fecha. */
export function daysOfWeek(date: Date): Date[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** ¿Es un día que ya pasó? (hoy no). */
export function isPastDay(day: Date, today: Date): boolean {
  return dayKey(day) < dayKey(today);
}

/** Días de hoy en adelante, sin nada planificado. `planned` es el número de piezas de cada día (clave AAAA-MM-DD). */
export function gapDays(days: Date[], planned: ReadonlyMap<string, number>, today: Date): Date[] {
  return days.filter((d) => !isPastDay(d, today) && (planned.get(dayKey(d)) ?? 0) === 0);
}

const weekday = (d: Date) => d.toLocaleDateString('es-ES', { weekday: 'long' });

/** «Sin nada el jueves y el sábado»; null si no hay huecos. */
export function gapSentence(gaps: Date[]): string | null {
  if (gaps.length === 0) return null;
  const names = gaps.map((d) => `el ${weekday(d)}`);
  if (names.length === 1) return `Sin nada ${names[0]}`;
  return `Sin nada ${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** «2 de 3» y si se ha llegado al objetivo. */
export function weekProgress(count: number, goal: number): { text: string; reached: boolean; ratio: number } {
  return { text: `${count} de ${goal}`, reached: count >= goal, ratio: Math.min(1, count / Math.max(1, goal)) };
}

/** Campaña mínima que hace falta para pintar su franja. */
export interface BandCampaign {
  id: string;
  title: string;
  starts_on: string;
  ends_on: string;
}

export interface CampaignSpan<T extends BandCampaign = BandCampaign> {
  campaign: T;
  /** Columna donde empieza (1 a 7) y donde acaba. */
  start: number;
  end: number;
  /** La campaña sigue antes o después de esta semana. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Las franjas de las campañas sobre los días de una semana (7 fechas de pared, de lunes a domingo). */
export function campaignSpans<T extends BandCampaign>(campaigns: readonly T[], week: Date[]): CampaignSpan<T>[] {
  const first = dayKey(week[0]!);
  const last = dayKey(week[week.length - 1]!);
  const spans: CampaignSpan<T>[] = [];
  for (const campaign of campaigns) {
    if (campaign.ends_on < first || campaign.starts_on > last) continue;
    const start = Math.max(0, week.findIndex((d) => dayKey(d) >= campaign.starts_on));
    let endIndex = week.length - 1;
    for (let i = week.length - 1; i >= 0; i--) {
      if (dayKey(week[i]!) <= campaign.ends_on) {
        endIndex = i;
        break;
      }
    }
    spans.push({
      campaign,
      start: start + 1,
      end: endIndex + 1,
      continuesBefore: campaign.starts_on < first,
      continuesAfter: campaign.ends_on > last,
    });
  }
  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** ¿Cubre la campaña ese día? */
export function campaignCovers(campaign: BandCampaign, day: Date): boolean {
  const key = dayKey(day);
  return campaign.starts_on <= key && key <= campaign.ends_on;
}

/** Semanas de una cuadrícula de días: cada siete. */
export function chunkWeeks(days: Date[]): Date[][] {
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** ¿La semana entera (lunes a domingo) quedó antes de hoy? */
export function isPastWeek(week: Date[], today: Date): boolean {
  return isPastDay(week[week.length - 1]!, today);
}

export { sameDay };
