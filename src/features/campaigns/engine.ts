import {
  createEmptyDocument,
  validateDocument,
  type AspectRatio,
  type ContentDocument,
  type ImageLayer,
} from '../content/document';
import { targetLabel } from '../content/labels';
import {
  allowedCanvasRatios,
  getFormatSpec,
  recommendedCanvasRatio,
  type NetworkFormatSpec,
} from '../content/networks';
import { validatePlan, type CampaignFrame, type CampaignPiece, type CampaignPlan, type PlanIssue } from './plan';

// Motor determinista de campañas: convierte un plan ACEPTADO en borradores.
//
// Patrón «la IA propone un plan y un motor lo ejecuta» (docs/00-auditoria-casatomas.md):
// la IA (o la agencia) solo escribe datos; este motor es el único que actúa, y
// solo sabe hacer una cosa de una lista cerrada: crear un borrador por pieza.
// No hay acción de aprobar, programar ni publicar, y nada de lo que diga el
// plan (ni un texto que «ordene» aprobar) cambia eso: el texto es contenido.
//
// Mitad cliente (esto): plan → documentos, puro y repetible (el mismo plan da
// siempre los mismos borradores). Mitad servidor: accept_campaign_plan, que
// vuelve a validar el plan y cada documento y crea las piezas en estado
// «borrador», todo o nada.

/** Lo único que el motor sabe hacer. */
export const ENGINE_ACTIONS = ['create_draft'] as const;
export type EngineAction = (typeof ENGINE_ACTIONS)[number];

/** Borrador listo para accept_campaign_plan (`p_drafts`). */
export interface DraftInput {
  title: string;
  schemaVersion: number;
  data: ContentDocument;
}

/** Recurso de la biblioteca que el motor puede poner en el lienzo. */
export interface EngineAsset {
  id: string;
  kind: string;
  name: string;
}

export class EngineError extends Error {
  readonly issues: PlanIssue[];
  constructor(issues: PlanIssue[]) {
    super(issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join(' · '));
    this.name = 'EngineError';
    this.issues = issues;
  }
}

/** Proporción del lienzo para una pieza nueva de esa red y formato (la recomendada, si la hay). */
export function canvasRatioForTarget(spec: NetworkFormatSpec | undefined): AspectRatio {
  if (!spec) return '1:1';
  const kind = spec.media[0];
  return recommendedCanvasRatio(spec, kind)?.ratio ?? allowedCanvasRatios(spec, kind)?.ratios[0] ?? '1:1';
}

function pieceTitle(piece: CampaignPiece): string {
  const [, month, day] = piece.date.split('-');
  return `${day}/${month} · ${targetLabel(piece.network, piece.format)} · ${piece.idea}`.slice(0, 200).trim();
}

function pieceDocument(piece: CampaignPiece, assets: ReadonlyMap<string, EngineAsset>): ContentDocument {
  const empty = createEmptyDocument({ aspectRatio: canvasRatioForTarget(getFormatSpec(piece.network, piece.format)) });
  const image = piece.assetIds.map((id) => assets.get(id)).find((asset) => asset?.kind === 'image');
  const layers: ImageLayer[] = image
    ? [
        {
          id: 'campaign-image',
          type: 'image',
          name: image.name.slice(0, 120),
          x: 0,
          y: 0,
          width: empty.canvas.width,
          height: empty.canvas.height,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          anchor: { x: 'stretch', y: 'stretch' },
          source: { kind: 'asset', assetId: image.id },
          fit: 'cover',
          focus: { x: 0.5, y: 0.5 },
        },
      ]
    : [];
  const result = validateDocument({
    ...empty,
    layers,
    copy: {
      caption: piece.caption,
      hashtags: piece.hashtags,
      mentions: [],
      altText: '',
      callToAction: { label: '', url: '' },
    },
  });
  if (!result.ok) {
    throw new EngineError(result.issues.map((issue) => ({ path: `document.${issue.path}`, message: issue.message })));
  }
  return result.document;
}

/**
 * Plan aceptado → un borrador por pieza, en el mismo orden. Valida antes el
 * plan contra su campaña; si algo no cuadra, no devuelve nada (EngineError).
 */
export function planToDrafts(
  input: unknown,
  frame: CampaignFrame,
  assets: ReadonlyMap<string, EngineAsset> = new Map(),
): { plan: CampaignPlan; drafts: DraftInput[] } {
  const validation = validatePlan(input, frame);
  if (!validation.ok) throw new EngineError(validation.issues);
  const plan = validation.plan;
  const drafts = plan.pieces.map((piece) => {
    const data = pieceDocument(piece, assets);
    return { title: pieceTitle(piece), schemaVersion: data.schemaVersion, data };
  });
  return { plan, drafts };
}
