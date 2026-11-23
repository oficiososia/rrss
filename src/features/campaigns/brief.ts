import { useMutation } from '@tanstack/react-query';
import { invokeAiGenerate } from '@/features/ai/api';
import { networkLabel, targetLabel } from '@/features/content/labels';
import { NETWORKS, formatsOf, getFormatSpec } from '@/features/content/networks';
import { useBrandTemplates } from '@/features/content/templates/api';
import { useSocialAccounts } from '@/features/social/api';
import { daysInclusive, isoDay, shortDay } from './plan';

// «La IA rellena el formulario contigo» (acción `campaign.brief` de
// ai-generate): de lo que la persona cuenta propone redes, fechas, ritmo,
// nombre y objetivo. Aquí viven los tipos, la petición, qué redes se ofrecen
// y los ajustes que no necesitan IA («solo Instagram»). Puro salvo los hooks.

export interface BriefMixItem {
  network: string;
  format: string;
  /** Publicaciones por semana en ese formato. */
  perWeek: number;
}

export interface BriefWeek {
  title: string;
  focus: string;
}

export interface BriefProposal {
  title: string;
  objective: string;
  networks: string[];
  startDate: string;
  endDate: string;
  perWeek: number;
  mix: BriefMixItem[];
  weeks: BriefWeek[];
  /** «Te propongo 3 semanas porque…». */
  why: string;
}

/** Lo que la propuesta lleva a «Preparar el plan» (campaign.plan, campo `agreement`). */
export interface PlanAgreement {
  objective?: string;
  perWeek?: number;
  mix?: BriefMixItem[];
  phases?: BriefWeek[];
}

export interface CampaignBriefResult {
  action: 'campaign.brief';
  generationId: string;
  status: 'question' | 'proposal';
  question: string | null;
  proposal: BriefProposal | null;
  /** Retoques que el producto ha hecho a lo que dijo el modelo. */
  notes: string[];
  /** Lo que ha costado esta propuesta (millonésimas de la moneda de cuenta). */
  costMicros?: number;
}

export type BriefAdjustment = 'shorter' | 'longer';

export interface BriefRequest {
  brandId: string;
  instruction: string;
  /** Redes de la marca: lo único que se ofrece. */
  networks: string[];
  current?: BriefProposal;
  adjust?: BriefAdjustment;
  answer?: { question: string; text: string };
  /** A qué se dedica la marca, si no tiene perfil ni sector. */
  brandSector?: string;
}

/** Todos los formatos de las redes dadas (los destinos que se ofrecen a la IA). */
export function briefTargets(networks: readonly string[]) {
  return networks.flatMap((network) => formatsOf(network).map((spec) => ({ network, format: spec.format })));
}

/** Pide la propuesta (o la pregunta) a la IA. No guarda nada. */
export function requestCampaignBrief(request: BriefRequest): Promise<CampaignBriefResult> {
  return invokeAiGenerate<CampaignBriefResult>('campaign.brief', request.brandId, {
    instruction: request.instruction.trim(),
    today: isoDay(new Date()),
    targets: briefTargets(request.networks),
    ...(request.current ? { current: request.current } : {}),
    ...(request.adjust ? { adjust: request.adjust } : {}),
    ...(request.answer ? { answer: request.answer } : {}),
    ...(request.brandSector ? { brandSector: request.brandSector } : {}),
  });
}

export function useCampaignBrief(brandId: string) {
  return useMutation({
    mutationFn: (request: Omit<BriefRequest, 'brandId'>) => requestCampaignBrief({ ...request, brandId }),
  });
}

// ── Redes de la marca ────────────────────────────────────────────────────

/** Red por defecto cuando la marca no tiene ninguna conectada ni plantillas. */
export const DEFAULT_NETWORK = 'instagram';

/**
 * Redes «de la marca»: las que tienen una cuenta conectada y las de sus
 * plantillas de diseño (salen de lo que ya publica). Si no hay ninguna,
 * Instagram (como siempre). El resto de redes se pueden marcar a mano.
 */
export function brandNetworkIds(accountNetworks: readonly string[], templateNetworks: readonly string[]): string[] {
  const known = new Set<string>(NETWORKS.map((n) => n.id));
  const found = new Set([...accountNetworks, ...templateNetworks].filter((n) => known.has(n)));
  const ordered = NETWORKS.map((n) => n.id as string).filter((id) => found.has(id));
  return ordered.length ? ordered : [DEFAULT_NETWORK];
}

export function useBrandNetworks(brandId: string): { networks: string[]; connected: string[]; ready: boolean } {
  const accounts = useSocialAccounts(brandId);
  const templates = useBrandTemplates(brandId);
  const connected = (accounts.data ?? []).map((a) => a.network as string);
  const fromTemplates = (templates.data ?? []).map((t) => t.network);
  return {
    networks: brandNetworkIds(connected, fromTemplates),
    connected: [...new Set(connected)],
    ready: !accounts.isPending && !templates.isPending,
  };
}

// ── Lo que se enseña de una propuesta ────────────────────────────────────

/** Semanas (de siete días; la última puede quedar corta) entre dos fechas AAAA-MM-DD. */
export function weeksOf(startDate: string, endDate: string): number {
  return Math.max(1, Math.ceil(daysInclusive(startDate, endDate) / 7));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** «3 semanas, del lun 30/11 al dom 20/12». */
export function durationText(proposal: Pick<BriefProposal, 'startDate' | 'endDate'>): string {
  const weeks = weeksOf(proposal.startDate, proposal.endDate);
  return `${plural(weeks, 'semana', 'semanas')}, del ${shortDay(proposal.startDate)} al ${shortDay(proposal.endDate)}`;
}

/** «3 a la semana: 2 × Instagram · Reel, 1 × Instagram · Publicación». */
export function rhythmText(proposal: Pick<BriefProposal, 'perWeek' | 'mix'>): string {
  const parts = proposal.mix.map((m) => `${m.perWeek} × ${targetLabel(m.network, m.format)}`);
  return `${proposal.perWeek} a la semana${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

// ── Ajustes sin IA ───────────────────────────────────────────────────────

/** «Solo Instagram»: deja una red y su parte del reparto (o una publicación por semana de su primer formato). */
export function onlyNetwork(proposal: BriefProposal, network: string): BriefProposal {
  let mix = proposal.mix.filter((m) => m.network === network);
  if (mix.length === 0) {
    const first = formatsOf(network)[0];
    mix = first ? [{ network, format: first.format, perWeek: Math.max(1, Math.min(7, proposal.perWeek)) }] : [];
  }
  return { ...proposal, networks: [network], mix, perWeek: mix.reduce((sum, m) => sum + m.perWeek, 0) };
}

/**
 * Lo acordado que viaja a «Preparar el plan», puesto al día con lo que la
 * persona haya cambiado en «Detalles»: solo las redes marcadas y, si las fechas
 * ya no cuadran con las semanas que describía la propuesta, sin fases.
 */
export function agreementFor(
  proposal: BriefProposal | null,
  networks: readonly string[],
  startsOn: string,
  endsOn: string,
): PlanAgreement | undefined {
  if (!proposal) return undefined;
  const mix = proposal.mix.filter((m) => networks.includes(m.network) && getFormatSpec(m.network, m.format));
  const perWeek = mix.reduce((sum, m) => sum + m.perWeek, 0);
  const phases = proposal.weeks.length === weeksOf(startsOn, endsOn) ? proposal.weeks : [];
  const agreement: PlanAgreement = {
    ...(proposal.objective ? { objective: proposal.objective } : {}),
    ...(perWeek >= 1 && perWeek <= 14 ? { perWeek, mix } : {}),
    ...(phases.length ? { phases } : {}),
  };
  return Object.keys(agreement).length ? agreement : undefined;
}

/** Nombre de la red para el botón «Solo …». */
export const onlyLabel = (network: string) => `Solo ${networkLabel(network)}`;
