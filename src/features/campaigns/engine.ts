import {
  createEmptyDocument,
  pageLimits,
  validateDocument,
  type AspectRatio,
  type ContentDocument,
  type ImageLayer,
  type Layer,
} from '../content/document';
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

/**
 * Aspecto de la marca para lo que el plan promete escribir en la pieza (el
 * titular y su franja). Sin él, colores y letra neutros.
 */
export interface EngineLook {
  /** Colores de la marca (#RRGGBB), el principal primero. */
  colors: readonly string[];
  /** Tipografía de titulares de la marca. */
  fontFamily?: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** ¿Un color es oscuro? (luminancia relativa; para elegir el color del texto encima). */
function isDark(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.4;
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

/** Recorta sin partir palabras. */
function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * Nombre de la pieza: el título corto del plan o, en planes antiguos, el
 * principio de la idea (antes se llamaba «24/11 · Instagram · <la idea entera>»).
 */
export function draftTitle(piece: Pick<CampaignPiece, 'title' | 'idea'>): string {
  const own = piece.title?.trim();
  if (own) return shorten(own, 80);
  const first = piece.idea.split(/[.:](?:\s|$)|[;—–(]|\s-\s/)[0] ?? piece.idea;
  return shorten(first, 60) || shorten(piece.idea, 60);
}

/** Proporción del lienzo: la que pide el plan, si la red y el formato la admiten; si no, la recomendada. */
export function canvasRatioForPiece(piece: Pick<CampaignPiece, 'network' | 'format' | 'aspect'>): AspectRatio {
  const spec = getFormatSpec(piece.network, piece.format);
  const wanted = piece.aspect;
  if (spec && wanted) {
    const allowed = allowedCanvasRatios(spec, spec.media[0]);
    // Sin límites conocidos para ese formato (un carrusel), vale la del plan.
    if (!allowed || allowed.ratios.includes(wanted as AspectRatio)) return wanted as AspectRatio;
  }
  return canvasRatioForTarget(spec);
}

/** La franja con el titular que promete el plan, abajo y con los colores de la marca. */
function headlineLayers(headline: string, canvas: { width: number; height: number }, look: EngineLook): Layer[] {
  const band = look.colors.find((c) => HEX.test(c))?.toUpperCase() ?? '#1F1F1F';
  const ink = isDark(band) ? '#FFFFFF' : '#111111';
  const height = Math.round(canvas.height * 0.2);
  const margin = Math.round(canvas.width * 0.06);
  const fontSize = Math.round(canvas.width * (headline.length > 40 ? 0.05 : 0.065));
  return [
    {
      id: 'campaign-band',
      type: 'shape',
      name: 'Franja del titular',
      shape: 'rectangle',
      x: 0,
      y: canvas.height - height,
      width: canvas.width,
      height,
      rotation: 0,
      opacity: 0.92,
      visible: true,
      locked: false,
      anchor: { x: 'stretch', y: 'bottom' },
      fill: band,
      stroke: null,
      cornerRadius: 0,
    },
    {
      id: 'campaign-headline',
      type: 'text',
      name: 'Titular',
      text: headline,
      x: margin,
      y: canvas.height - height + Math.round(height * 0.18),
      width: canvas.width - margin * 2,
      height: Math.round(height * 0.64),
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      anchor: { x: 'stretch', y: 'bottom' },
      fontFamily: look.fontFamily?.trim() || 'sans-serif',
      fontSize,
      fontWeight: 700,
      italic: false,
      color: ink,
      align: 'center',
      lineHeight: 1.1,
    },
  ] as Layer[];
}

function pieceDocument(
  piece: CampaignPiece,
  assets: ReadonlyMap<string, EngineAsset>,
  look: EngineLook,
): ContentDocument {
  const spec = getFormatSpec(piece.network, piece.format);
  const empty = createEmptyDocument({ aspectRatio: canvasRatioForPiece(piece) });
  const imageLayer = (image: EngineAsset, index: number): ImageLayer => ({
    id: index === 0 ? 'campaign-image' : `campaign-image-${index + 1}`,
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
  });
  const images = piece.assetIds
    .map((id) => assets.get(id))
    .filter((asset): asset is EngineAsset => asset?.kind === 'image');
  const range = pageLimits(spec);
  // Un carrusel: una página por foto elegida (las que falten hasta el mínimo, vacías). Lo demás: una página.
  const count = range.min > 1 ? Math.min(range.max, Math.max(range.min, images.length)) : 1;
  // Lo que el plan promete escribir (titular o franja) llega a la primera página de las piezas de imagen.
  const headline = piece.headline?.trim() && !isVideoTarget(spec) ? piece.headline.trim() : '';
  const pages = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: '',
    layers: [
      ...(images[index] && (range.min > 1 || index === 0) ? [imageLayer(images[index], index)] : []),
      ...(index === 0 && headline ? headlineLayers(headline, empty.canvas, look) : []),
    ],
  }));
  const result = validateDocument({
    ...empty,
    pages,
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
  look: EngineLook = { colors: [] },
): { plan: CampaignPlan; drafts: DraftInput[] } {
  const validation = validatePlan(input, frame);
  if (!validation.ok) throw new EngineError(validation.issues);
  const plan = validation.plan;
  const drafts = plan.pieces.map((piece) => {
    const data = pieceDocument(piece, assets, look);
    return { title: draftTitle(piece), schemaVersion: data.schemaVersion, data };
  });
  return { plan, drafts };
}

/** ¿Es un formato solo de vídeo (reel, vídeo, short)? Su pieza se monta en el editor de reels. */
function isVideoTarget(spec: NetworkFormatSpec | undefined): boolean {
  const media = spec?.media ?? [];
  return media.length > 0 && media.every((kind) => kind === 'video');
}
