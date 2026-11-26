import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { campaignReelsAutoEnabled, STORAGE_BUCKET } from '@/config/app';
import { AiRequestError, aiErrorMessage, toAiError } from '@/features/ai/api';
import { parseProfile } from '@/features/brand/profile';
import { contentKeys } from '@/features/content/api';
import { formatsOf } from '@/features/content/networks';
import { isAppDesign } from '@/features/library/filters';
import { REEL_KIND } from '@/features/reels/api';
import { readBrandReelTemplates, saveReelVersion } from '@/features/reels/editor/api';
import { buildRenderRequest } from '@/features/reels/editor/project';
import { brandReelKit, reelLogoPath, type BrandReelKit } from '@/features/reels/quality';
import { REEL_TEMPLATES } from '@/features/reels/templates';
import { requestKeys } from '@/features/requests/api';
import type {
  CampaignContentRow,
  CampaignPlanRow,
  CampaignRequestRow,
  CampaignRow,
  ContentRequestRow,
  ContentStatus,
  Json,
} from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { PlanAgreement } from './brief';
import { planToDrafts, type EngineAsset, type EngineLook } from './engine';
import { buildCampaignReels, type CampaignMaterial } from './reelPieces';
import { suggestTemplates } from './templateHints';
import {
  MAX_CAMPAIGN_NETWORKS,
  MAX_INSTRUCTION_CHARS,
  MAX_PLAN_DAYS,
  campaignPlanSchema,
  daysInclusive,
  isRealDate,
  type CampaignPlan,
} from './plan';

// Acceso a datos de las campañas. Pedir un plan (con la IA o a la agencia),
// leerlo, aceptarlo (motor → borradores) o descartarlo. Las reglas viven en la
// base de datos (migración 20261119510000); aquí solo se dice antes lo obvio.

export const campaignKeys = {
  all: (brandId: string) => ['brand', brandId, 'campaigns'] as const,
  list: (brandId: string) => ['brand', brandId, 'campaigns', 'list'] as const,
  item: (brandId: string, id: string) => ['brand', brandId, 'campaigns', 'item', id] as const,
  plan: (brandId: string, id: string, version: number) => ['brand', brandId, 'campaigns', 'plan', id, version] as const,
  contents: (brandId: string, id: string) => ['brand', brandId, 'campaigns', 'contents', id] as const,
  request: (brandId: string, id: string) => ['brand', brandId, 'campaigns', 'request', id] as const,
};

/** Recursos de la biblioteca que se ofrecen a la IA (solo su descripción). */
const MAX_LIBRARY_FOR_AI = 60;
/** Fuentes de texto que se envían a la IA. */
const MAX_SOURCES_FOR_AI = 5;
const MAX_SOURCES_CHARS = 60_000;

// ── Lectura ──────────────────────────────────────────────────────────────

export function useCampaigns(brandId: string) {
  return useQuery({
    queryKey: campaignKeys.list(brandId),
    queryFn: async (): Promise<CampaignRow[]> =>
      unwrap(
        await supabase
          .from('campaigns')
          .select('*')
          .eq('brand_id', brandId)
          .order('created_at', { ascending: false })
          .limit(200),
      ),
  });
}

export function useCampaign(brandId: string, campaignId: string) {
  return useQuery({
    queryKey: campaignKeys.item(brandId, campaignId),
    queryFn: async (): Promise<CampaignRow> =>
      unwrap(await supabase.from('campaigns').select('*').eq('id', campaignId).single()),
  });
}

/** Una versión del plan (0 = todavía no hay plan). */
export function useCampaignPlan(brandId: string, campaignId: string, version: number) {
  return useQuery({
    queryKey: campaignKeys.plan(brandId, campaignId, version),
    enabled: version > 0,
    queryFn: async (): Promise<CampaignPlanRow> =>
      unwrap(
        await supabase.from('campaign_plans').select('*').eq('campaign_id', campaignId).eq('version', version).single(),
      ),
  });
}

export interface CampaignPieceLink extends CampaignContentRow {
  title: string;
  status: ContentStatus | null;
  network: string;
  format: string;
  /** Versión vigente de la pieza (0 = sin documento). Para su vista previa. */
  current_version: number;
}

/** Piezas que creó el motor, en el orden del plan, con su estado de ahora. */
export function useCampaignContents(brandId: string, campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: campaignKeys.contents(brandId, campaignId),
    enabled,
    queryFn: async (): Promise<CampaignPieceLink[]> => {
      const links = unwrap(
        await supabase
          .from('campaign_contents')
          .select('*')
          .eq('campaign_id', campaignId)
          .order('piece_index', { ascending: true }),
      );
      const ids = links.map((l) => l.content_id);
      const items = ids.length
        ? unwrap(await supabase.from('content_items').select('id, title, status, network, format, current_version').in('id', ids))
        : [];
      const byId = new Map(items.map((i) => [i.id, i]));
      return links.map((link) => {
        const item = byId.get(link.content_id);
        return {
          ...link,
          title: item?.title ?? 'Pieza',
          status: item?.status ?? null,
          network: item?.network ?? '',
          format: item?.format ?? '',
          current_version: item?.current_version ?? 0,
        };
      });
    },
  });
}

export interface CampaignOverview {
  /** Plan vigente de cada campaña que ya lo tiene (null si no tiene el formato esperado). */
  plans: Map<string, CampaignPlan | null>;
  /** Piezas creadas de cada campaña aceptada, en el orden del plan. */
  contents: Map<string, { content_id: string; piece_index: number; current_version: number }[]>;
}

/**
 * Para la lista: el plan vigente de cada campaña (cuántas piezas lleva y sus
 * recursos sugeridos) y las piezas creadas de las aceptadas (sus miniaturas).
 * Solo lectura; dos o tres consultas para toda la lista.
 */
export function useCampaignsOverview(brandId: string, campaigns: CampaignRow[]) {
  const withPlan = campaigns.filter((c) => c.current_plan_version > 0);
  const accepted = campaigns.filter((c) => c.status === 'accepted');
  const key = withPlan.map((c) => `${c.id}:${c.current_plan_version}:${c.status}`).join(',');
  return useQuery({
    queryKey: [...campaignKeys.all(brandId), 'overview', key] as const,
    enabled: withPlan.length > 0,
    queryFn: async (): Promise<CampaignOverview> => {
      const rows = unwrap(
        await supabase
          .from('campaign_plans')
          .select('campaign_id, version, data')
          .in(
            'campaign_id',
            withPlan.map((c) => c.id),
          ),
      );
      const plans = new Map<string, CampaignPlan | null>();
      for (const campaign of withPlan) {
        const row = rows.find((r) => r.campaign_id === campaign.id && r.version === campaign.current_plan_version);
        const parsed = row ? campaignPlanSchema.safeParse(row.data) : null;
        plans.set(campaign.id, parsed?.success ? parsed.data : null);
      }
      const contents = new Map<string, { content_id: string; piece_index: number; current_version: number }[]>();
      if (accepted.length) {
        const links = unwrap(
          await supabase
            .from('campaign_contents')
            .select('*')
            .in(
              'campaign_id',
              accepted.map((c) => c.id),
            )
            .order('piece_index', { ascending: true }),
        );
        const ids = links.map((l) => l.content_id);
        const items = ids.length
          ? unwrap(await supabase.from('content_items').select('id, current_version').in('id', ids))
          : [];
        const versions = new Map(items.map((i) => [i.id, i.current_version]));
        for (const link of links) {
          const list = contents.get(link.campaign_id) ?? [];
          list.push({
            content_id: link.content_id,
            piece_index: link.piece_index,
            current_version: versions.get(link.content_id) ?? 0,
          });
          contents.set(link.campaign_id, list);
        }
      }
      return { plans, contents };
    },
  });
}

/**
 * El encargo a la agencia de una campaña (modo agencia), o null. La columna
 * `campaign_id` la añade la migración de campañas (tipo CampaignRequestRow).
 */
export function useCampaignRequest(brandId: string, campaignId: string, enabled: boolean) {
  return useQuery({
    queryKey: campaignKeys.request(brandId, campaignId),
    enabled,
    queryFn: async (): Promise<CampaignRequestRow | null> => {
      const rows = unwrap(
        await supabase
          .from('content_requests')
          .select('*')
          .eq('campaign_id' as keyof ContentRequestRow, campaignId)
          .limit(1),
      ) as CampaignRequestRow[];
      return rows[0] ?? null;
    },
  });
}

// ── Pedir un plan ────────────────────────────────────────────────────────

export interface PlanRequestInput {
  brandId: string;
  title: string;
  instruction: string;
  networks: string[];
  /** AAAA-MM-DD, ambas incluidas. */
  startsOn: string;
  endsOn: string;
  /** Enviar a la IA las fuentes de texto de la marca. */
  useSources?: boolean;
  /** Lo acordado con la IA al rellenar el formulario (duración, ritmo, formatos): el plan lo respeta. */
  agreement?: PlanAgreement;
  /** A qué se dedica la marca, si no tiene perfil ni sector (lo pide el diálogo antes de gastar). */
  brandSector?: string;
}

export function validatePlanRequest(input: PlanRequestInput): string | null {
  if (!input.title.trim()) return 'Ponle un nombre a la campaña.';
  if (input.title.trim().length > 200) return 'El nombre es demasiado largo.';
  if (!input.instruction.trim()) return 'Escribe qué quieres preparar.';
  if (input.instruction.trim().length > MAX_INSTRUCTION_CHARS)
    return `La instrucción es demasiado larga (máximo ${MAX_INSTRUCTION_CHARS} caracteres).`;
  if (input.networks.length === 0) return 'Elige al menos una red.';
  if (input.networks.length > MAX_CAMPAIGN_NETWORKS) return `Como mucho ${MAX_CAMPAIGN_NETWORKS} redes.`;
  if (!isRealDate(input.startsOn) || !isRealDate(input.endsOn)) return 'Las fechas no son válidas.';
  if (input.endsOn < input.startsOn) return 'La fecha final es anterior a la inicial.';
  if (daysInclusive(input.startsOn, input.endsOn) > MAX_PLAN_DAYS)
    return `Un plan dura como mucho ${MAX_PLAN_DAYS} días.`;
  return null;
}

/** Destinos que se ofrecen a la IA: todos los formatos del catálogo de las redes elegidas. */
export function targetsFor(networks: string[]) {
  return networks.flatMap((network) => formatsOf(network).map((spec) => ({ network, format: spec.format })));
}

export interface GeneratedPlan {
  action: 'campaign.plan';
  generationId: string;
  status: 'proposal';
  plan: CampaignPlan;
  discarded: { index: number; reason: string }[];
  /** Días que se han quedado sin piezas porque la IA falló con ellos (el resto del plan sí salió). */
  gaps?: { startDate: string; endDate: string; reason: string }[];
  /**
   * Piezas cuyo título o idea se parecía a la de otra (un plan largo se pide por tramos a la vez).
   * Los títulos ya vienen renombrados (`renamedTo`); las ideas, solo avisadas.
   */
  repeats?: PlanRepeat[];
}

export interface PlanRepeat {
  kind: 'title' | 'idea';
  date: string;
  title: string;
  likeDate: string;
  likeTitle: string;
  renamedTo?: string;
}

async function textSources(brandId: string) {
  const rows = unwrap(
    await supabase
      .from('brand_knowledge_sources')
      .select('*')
      .eq('brand_id', brandId)
      .eq('kind', 'text')
      .order('created_at', { ascending: false })
      .limit(MAX_SOURCES_FOR_AI),
  ).filter((source) => source.storage_path !== null);
  const sources: { title: string; text: string }[] = [];
  let total = 0;
  for (const source of rows) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(source.storage_path!);
    if (error || !data) throw error ?? new Error(`No se ha podido leer «${source.title}».`);
    const text = (await data.text()).slice(0, MAX_SOURCES_CHARS - total);
    if (!text.trim()) continue;
    total += text.length;
    sources.push({ title: source.title, text });
    if (total >= MAX_SOURCES_CHARS) break;
  }
  return sources;
}

/**
 * Lo que la IA puede sugerir de la biblioteca: material (fotos y vídeos), no
 * piezas ya diseñadas. Antes iban las 60 más recientes y eran casi todas
 * exportaciones (prueba de calidad del 23/11/2026, fallo 17).
 */
async function libraryForAi(brandId: string) {
  const rows = unwrap(
    await supabase
      .from('media_assets')
      .select('id, file_name, kind, tags, folder, provenance')
      .eq('brand_id', brandId)
      .in('kind', ['image', 'video'])
      .order('created_at', { ascending: false })
      .limit(MAX_LIBRARY_FOR_AI * 5),
  );
  return rows
    .filter((a) => !isAppDesign({ provenance: a.provenance, folder: a.folder ?? '' }))
    .slice(0, MAX_LIBRARY_FOR_AI)
    .map((a) => ({ id: a.id, name: a.file_name, kind: a.kind, tags: a.tags ?? [], folder: a.folder ?? '' }));
}

/** Lo que viaja a `campaign.plan` (también para calcular su coste antes). */
export async function planInput(input: PlanRequestInput) {
  const [assets, sources] = await Promise.all([
    libraryForAi(input.brandId),
    input.useSources ? textSources(input.brandId) : Promise.resolve([]),
  ]);
  return {
    instruction: input.instruction.trim(),
    startDate: input.startsOn,
    endDate: input.endsOn,
    targets: targetsFor(input.networks),
    assets,
    sources,
    ...(input.agreement ? { agreement: input.agreement } : {}),
    ...(input.brandSector ? { brandSector: input.brandSector } : {}),
  };
}

/** Pide el plan a la IA (ai-generate, `campaign.plan`). Solo propone: no guarda nada. */
export async function generateCampaignPlan(input: PlanRequestInput): Promise<GeneratedPlan> {
  const body = await planInput(input);
  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.functions.invoke('ai-generate', {
      body: { action: 'campaign.plan', brandId: input.brandId, input: body },
      // El servidor prepara los planes largos por tramos y, si hace falta, repite uno: hasta 125 s.
      timeout: 140_000,
    });
  } catch (error) {
    throw await toAiError(error);
  }
  if (result.error) throw await toAiError(result.error);
  const data = result.data as GeneratedPlan | null;
  if (!data || data.action !== 'campaign.plan' || !data.plan) {
    throw new AiRequestError('internal', aiErrorMessage('internal'), { retryable: true });
  }
  return data;
}

export function useCampaignMutations(brandId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: campaignKeys.all(brandId) });

  /** Con la IA: genera el plan y guarda la campaña con él (queda «por revisar»). */
  const createWithAi = useMutation({
    mutationFn: async (input: PlanRequestInput) => {
      const problem = validatePlanRequest(input);
      if (problem) throw new Error(problem);
      const generated = await generateCampaignPlan(input);
      const campaign = unwrap(
        await supabase.rpc('create_campaign', {
          p_brand_id: input.brandId,
          p_title: input.title.trim(),
          p_instruction: input.instruction.trim(),
          p_networks: input.networks,
          p_starts_on: input.startsOn,
          p_ends_on: input.endsOn,
          p_plan: generated.plan as unknown as Json,
          p_generation_id: generated.generationId,
        }),
      );
      return {
        campaign,
        discarded: generated.discarded,
        gaps: generated.gaps ?? [],
        repeats: generated.repeats ?? [],
      };
    },
    onSuccess: refresh,
  });

  /** Modo agencia: pide el plan a la agencia (crea el encargo). */
  const requestFromAgency = useMutation({
    mutationFn: async (input: PlanRequestInput) => {
      const problem = validatePlanRequest(input);
      if (problem) throw new Error(problem);
      return unwrap(
        await supabase.rpc('request_campaign_plan', {
          p_brand_id: input.brandId,
          p_title: input.title.trim(),
          p_instruction: input.instruction.trim(),
          p_networks: input.networks,
          p_starts_on: input.startsOn,
          p_ends_on: input.endsOn,
        }),
      );
    },
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: requestKeys.all(brandId) })]);
    },
  });

  /**
   * El motor: plan revisado → borradores. Después, cada reel del plan se prepara
   * con una plantilla de la marca y fotos de la biblioteca (versión 2 de la pieza)
   * y, si se pide, se encarga su montaje al trabajador.
   */
  const accept = useMutation({
    mutationFn: async ({
      campaign,
      plan,
      mountReels = false,
    }: {
      campaign: CampaignRow;
      plan: unknown;
      mountReels?: boolean;
    }): Promise<{ campaign: CampaignRow; reels: PreparedReels }> => {
      const ids = [
        ...new Set(
          ((plan as CampaignPlan).pieces ?? []).flatMap((piece) =>
            Array.isArray(piece.assetIds) ? piece.assetIds : [],
          ),
        ),
      ];
      const assets = ids.length
        ? unwrap(
            await supabase.from('media_assets').select('id, kind, file_name').eq('brand_id', brandId).in('id', ids),
          )
        : [];
      const map = new Map<string, EngineAsset>(
        assets.map((a) => [a.id, { id: a.id, kind: a.kind, name: a.file_name }]),
      );
      const built = planToDrafts(plan, campaign, map, await brandLook(brandId));
      const accepted = unwrap(
        await supabase.rpc('accept_campaign_plan', {
          p_campaign_id: campaign.id,
          p_expected_version: campaign.current_plan_version,
          p_plan: built.plan as unknown as Json,
          p_drafts: built.drafts as unknown as Json,
        }),
      );
      // El plan ya está aceptado: si preparar algún reel falla, esa pieza se queda como antes (vacía).
      // Con los reels de IA apagados (config/flags.ts) no se preparan ni se montan: quedan como borrador a mano.
      const reels = campaignReelsAutoEnabled()
        ? await prepareCampaignReels(brandId, accepted, built.plan, { mount: mountReels }).catch(
            (): PreparedReels => ({ total: 0, prepared: 0, withoutMaterial: 0, failed: 0, mounted: 0 }),
          )
        : { total: 0, prepared: 0, withoutMaterial: 0, failed: 0, mounted: 0 };
      return { campaign: accepted, reels };
    },
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: contentKeys.all(brandId) }),
        queryClient.invalidateQueries({ queryKey: requestKeys.all(brandId) }),
      ]);
    },
  });

  const discard = useMutation({
    mutationFn: async (campaignId: string) =>
      unwrap(await supabase.rpc('discard_campaign', { p_campaign_id: campaignId, p_reason: '' })),
    onSuccess: async () => {
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: requestKeys.all(brandId) })]);
    },
  });

  return { createWithAi, requestFromAgency, accept, discard };
}

// ── Reels de la campaña, listos al aceptar ───────────────────────────────

/** Colores y tipografía de titulares de la marca, para lo que el plan escribe en las piezas. */
async function brandLook(brandId: string): Promise<EngineLook> {
  const row = unwrap(
    await supabase.from('brand_profiles').select('data').eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
  ) as { data: unknown } | null;
  if (!row) return { colors: [] };
  const profile = parseProfile(row.data);
  const font = profile.visual.fonts[0]?.family;
  return { colors: profile.visual.colors.map((c) => c.hex), ...(font ? { fontFamily: font } : {}) };
}

/** Lo que los reels toman de la marca (colores, logotipo, usuario, dirección y llamada) para el cierre. */
async function brandKit(brandId: string): Promise<BrandReelKit | null> {
  const row = unwrap(
    await supabase.from('brand_profiles').select('data').eq('brand_id', brandId).eq('status', 'active').maybeSingle(),
  ) as { data: unknown } | null;
  if (!row) return null;
  const profile = parseProfile(row.data);
  const ids = profile.visual.logoAssetIds;
  const logos =
    ids.length > 0
      ? unwrap(
          await supabase
            .from('media_assets')
            .select('id, kind, storage_path, mime_type')
            .eq('brand_id', brandId)
            .in('id', ids),
        )
      : [];
  return brandReelKit(profile, reelLogoPath(ids, logos));
}

export interface PreparedReels {
  /** Reels del plan (piezas en formato reel). */
  total: number;
  /** Con plantilla y material, guardados como versión 2. */
  prepared: number;
  /** Sin ninguna foto o clip que encaje: se quedan vacíos. */
  withoutMaterial: number;
  /** No se han podido guardar (se quedan vacíos). */
  failed: number;
  /** Montajes encargados al trabajador. */
  mounted: number;
}

/** Piezas del plan que se montan en el editor de reels. */
export const reelIndexes = (plan: CampaignPlan): number[] =>
  plan.pieces.flatMap((piece, index) => (piece.format === 'reel' ? [index] : []));

/**
 * Prepara los reels de un plan recién aceptado con el mismo camino que «Desde
 * una plantilla» (reelPieces.ts → buildReelFromTemplate) y los guarda como
 * versión 2 de su pieza. Con `mount`, encarga además el montaje de cada uno.
 */
export async function prepareCampaignReels(
  brandId: string,
  campaign: CampaignRow,
  plan: CampaignPlan,
  options: { mount?: boolean } = {},
): Promise<PreparedReels> {
  const indexes = reelIndexes(plan);
  const empty: PreparedReels = { total: indexes.length, prepared: 0, withoutMaterial: 0, failed: 0, mounted: 0 };
  if (indexes.length === 0) return empty;

  const [links, library, templateRows, fontInfo, kit] = await Promise.all([
    supabase
      .from('campaign_contents')
      .select('content_id, piece_index, plan_version')
      .eq('campaign_id', campaign.id)
      .eq('plan_version', campaign.current_plan_version),
    supabase
      .from('media_assets')
      .select('id, kind, storage_path, file_name, mime_type, duration_ms, created_at, provenance, folder, tags')
      .eq('brand_id', brandId)
      .in('kind', ['image', 'video'])
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('brand_reel_templates')
      .select('id, template_key, name, source, document')
      .eq('brand_id', brandId)
      .order('name')
      .limit(60),
    supabase.rpc('brand_reel_font_info', { p_brand_id: brandId }),
    // Sin perfil (o si falla al leerlo), los reels salen igual, sin el cierre de la marca.
    brandKit(brandId).catch(() => null),
  ]);
  const contentOf = new Map(unwrap(links).map((l) => [l.piece_index, l.content_id]));
  const templates = readBrandReelTemplates(
    unwrap(templateRows),
    REEL_TEMPLATES.map((t) => t.id),
  );
  const hints = new Map<number, string>();
  suggestTemplates(plan.pieces, [], templates).forEach((hint, index) => {
    if (hint?.kind === 'reel') hints.set(index, hint.id);
  });
  // La tipografía de los reels de la marca (.ttf u .otf), si la tiene.
  let font: { path: string; family: string } | undefined;
  const info = (fontInfo.data as { font_id: string; family: string }[] | null)?.[0];
  if (info) {
    const row = await supabase.from('brand_fonts').select('storage_path, family').eq('id', info.font_id).maybeSingle();
    if (row.data?.storage_path) font = { path: row.data.storage_path, family: row.data.family };
  }

  const { reels, withoutMaterial } = buildCampaignReels({
    pieces: plan.pieces,
    videoIndexes: indexes,
    templates,
    hints,
    library: unwrap(library) as CampaignMaterial[],
    ...(font ? { font } : {}),
    kit,
    aiGenerated: campaign.origin === 'ai',
  });

  const result = { ...empty, withoutMaterial: withoutMaterial.length };
  for (const reel of reels) {
    const contentId = contentOf.get(reel.pieceIndex);
    if (!contentId) {
      result.failed += 1;
      continue;
    }
    try {
      const version = await saveReelVersion({
        contentId,
        project: reel.project,
        note: `Reel preparado desde el plan con «${reel.templateName}»`,
        expectedVersion: 1,
      });
      result.prepared += 1;
      if (options.mount) {
        const job = await supabase.rpc('request_media_job', {
          p_brand_id: brandId,
          p_kind: REEL_KIND,
          p_input: buildRenderRequest(reel.project, { id: contentId, version: version.version }),
          p_idempotency_key: `campana-${contentId}-${version.version}`,
        });
        if (!job.error) result.mounted += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/** Lo que se dice al aceptar: borradores y, si hay reels, cuántos quedan listos. */
export function acceptedMessage(reels: PreparedReels): string {
  if (reels.total === 0) return 'Plan aceptado: sus piezas están en Contenidos como borradores';
  const ready =
    reels.prepared === reels.total
      ? reels.total === 1
        ? 'el reel ya tiene plantilla y fotos'
        : `los ${reels.total} reels ya tienen plantilla y fotos`
      : `${reels.prepared} de ${reels.total} reels tienen plantilla y fotos (a los demás les faltan fotos que encajen)`;
  const mounted = reels.mounted > 0 ? `; ${reels.mounted === 1 ? 'se está montando 1 vídeo' : `se están montando ${reels.mounted} vídeos`}` : '';
  return `Plan aceptado: ${ready}${mounted}.`;
}

// ── Fecha y hora del plan, al programar ──────────────────────────────────

/**
 * Día y hora que el plan de su campaña propone para una pieza
 * («AAAA-MM-DDTHH:MM», hora de la marca), o null si la pieza no sale de un
 * plan. Sin hora en el plan, a las 10:00 (como el calendario).
 */
export async function fetchPlannedSlot(contentId: string): Promise<string | null> {
  const link = unwrap(
    await supabase
      .from('campaign_contents')
      .select('campaign_id, plan_version, piece_index')
      .eq('content_id', contentId)
      .limit(1),
  )[0];
  if (!link) return null;
  const row = unwrap(
    await supabase
      .from('campaign_plans')
      .select('data')
      .eq('campaign_id', link.campaign_id)
      .eq('version', link.plan_version)
      .maybeSingle(),
  ) as { data: unknown } | null;
  const parsed = row ? campaignPlanSchema.safeParse(row.data) : null;
  const piece = parsed?.success ? parsed.data.pieces[link.piece_index] : undefined;
  if (!piece || !isRealDate(piece.date)) return null;
  return `${piece.date}T${piece.time || '10:00'}`;
}

export function usePlannedSlot(brandId: string, contentId: string) {
  return useQuery({
    queryKey: [...campaignKeys.all(brandId), 'planned-slot', contentId] as const,
    enabled: Boolean(contentId),
    staleTime: 60_000,
    queryFn: () => fetchPlannedSlot(contentId),
  });
}
