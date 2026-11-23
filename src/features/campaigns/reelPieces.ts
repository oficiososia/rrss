import { isAiMade, isAppDesign, isCutout } from '@/features/library/filters';
import type { MediaAssetRow } from '@/lib/database.types';
import { REEL_CAPTION_MAX, REEL_HASHTAGS_MAX, type ReelProject } from '@/features/reels/editor/project';
import type { BrandReelKit } from '@/features/reels/quality';
import {
  buildBrandReel,
  reelTemplateNeeds,
  validateReelTemplate,
  type ReelTemplate,
} from '@/features/reels/reelTemplate';
import { REEL_TEMPLATES, type ReelTemplateSummary } from '@/features/reels/templates';
import type { BrandReelTemplate } from '@/features/reels/editor/api';
import { draftTitle } from './engine';
import type { CampaignPiece } from './plan';
import { wordsOf } from './templateHints';

// Los reels de una campaña, listos al aceptar el plan (prueba de calidad del
// 23/11/2026, fallo 3: llegaban vacíos y había que montarlos uno a uno).
//
// Cada reel se construye por el MISMO camino que «Desde una plantilla» del
// editor de reels: una plantilla de reel de la marca + fotos o clips →
// `buildBrandReel` (plan v2 con la calidad de docs/reels-calidad.md: rótulo por
// plano, cortes al pulso, puntos y máscaras guardados, colores y cierre de la
// marca). Aquí solo se decide QUÉ plantilla y QUÉ material, de forma determinista:
//   * plantilla: la de la marca que más se parece a la pieza, repartiendo para
//     que la campaña no repita siempre la misma; sin plantillas de la marca, una
//     sencilla sobre el primer estilo del catálogo;
//   * material: solo fotos y vídeos originales y ediciones de la biblioteca (ni
//     exportaciones, ni reels montados, ni portadas, ni imágenes hechas con IA,
//     ni recortes sin fondo), primero los que sugiere el plan y después los que
//     más se parecen al tema de la pieza; sin repetir dentro de un reel y, si
//     hay de sobra, tampoco entre reels de la misma campaña;
//   * pie: el del plan, con sus hashtags (el reel se publica con él);
//   * textos: el titular del plan sustituye al texto de gancho o de título de la
//     plantilla, y los textos de muestra que describen planos concretos («La
//     zona de clases») se quitan, porque no casan con fotos elegidas por tema.
// Puro: sin red ni React.

export type CampaignMaterial = Pick<
  MediaAssetRow,
  | 'id'
  | 'kind'
  | 'storage_path'
  | 'file_name'
  | 'mime_type'
  | 'duration_ms'
  | 'created_at'
  | 'provenance'
  | 'folder'
  | 'tags'
>;

/** ¿Sirve como material de un reel? Fotos y vídeos originales o editados, nada ya diseñado ni inventado. */
export function isReelMaterial(asset: CampaignMaterial): boolean {
  if (asset.kind !== 'image' && asset.kind !== 'video') return false;
  const shaped = { ...asset, folder: asset.folder ?? '' };
  return !isAppDesign(shaped) && !isAiMade(shaped) && !isCutout(shaped);
}

/** Plantilla sencilla cuando la marca no tiene ninguna: cinco planos de foto, gancho y cierre. */
export function basicReelTemplate(styleId: string): ReelTemplate {
  const parsed = validateReelTemplate({
    kind: 'rrss.reel-template',
    schemaVersion: 1,
    purpose: 'Enseñar el tema de la pieza con fotos de la marca.',
    whenToUse: 'Cuando la marca todavía no tiene plantillas de reel propias.',
    material: '3 a 5 fotos o clips de la biblioteca.',
    style: { id: styleId },
    slots: [
      { id: 's1', label: 'Gancho', kind: 'any', seconds: 2.5, motion: 'zoom-in' },
      { id: 's2', label: 'Detalle', kind: 'any', seconds: 2 },
      { id: 's3', label: 'Detalle', kind: 'any', seconds: 2, optional: true },
      { id: 's4', label: 'Detalle', kind: 'any', seconds: 2, optional: true },
      { id: 's5', label: 'Cierre', kind: 'any', seconds: 2.5, motion: 'zoom-out' },
    ],
    texts: [{ id: 'hook', role: 'hook', text: 'Tu titular', from: 's1', to: 's2', position: 'center' }],
    cover: { slot: 's1' },
  });
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join(' · '));
  return parsed.template;
}

/** La plantilla con los textos de la pieza: titular en el gancho, sin textos de muestra de planos concretos. */
export function templateForPiece(
  template: ReelTemplate,
  piece: Pick<CampaignPiece, 'headline' | 'title' | 'idea'>,
): ReelTemplate {
  const headline = (piece.headline?.trim() || draftTitle(piece)).slice(0, 200);
  if (!headline) return template;
  let placed = false;
  const texts = template.texts.flatMap((text) => {
    if ((text.role === 'hook' || text.role === 'title') && !placed) {
      placed = true;
      return [{ ...text, text: headline }];
    }
    if (text.role === 'detail' || text.role === 'step' || text.role === 'hook' || text.role === 'title') return [];
    return [text];
  });
  if (!placed && template.slots[0]) {
    texts.unshift({ id: 'campaign-hook', role: 'hook', text: headline, from: template.slots[0].id, position: 'center' });
  }
  return { ...template, texts };
}

const pieceWords = (piece: Pick<CampaignPiece, 'title' | 'headline' | 'idea' | 'caption'>) =>
  wordsOf(`${piece.title ?? ''} ${piece.headline ?? ''} ${piece.idea} ${piece.caption}`);

const assetWords = (asset: CampaignMaterial) =>
  wordsOf(`${asset.file_name.replace(/\.[a-z0-9]+$/i, '')} ${(asset.tags ?? []).join(' ')} ${asset.folder ?? ''}`);

/**
 * Material para un reel: primero lo que sugiere el plan, después lo que más se
 * parece al tema; sin repetir dentro del reel y, a igualdad, lo menos usado en
 * la campaña y lo más reciente. Devuelve como mucho `count`.
 */
export function pickReelMaterial(
  piece: Pick<CampaignPiece, 'title' | 'headline' | 'idea' | 'caption' | 'assetIds'>,
  library: readonly CampaignMaterial[],
  count: number,
  usedInCampaign: Map<string, number> = new Map(),
): CampaignMaterial[] {
  const usable = library.filter(isReelMaterial);
  const suggested = new Set(piece.assetIds.map((id) => id.toLowerCase()));
  const wanted = pieceWords(piece);
  const scored = usable.map((asset) => {
    let hits = 0;
    for (const word of assetWords(asset)) if (wanted.has(word)) hits += 1;
    return { asset, suggested: suggested.has(asset.id.toLowerCase()), hits, uses: usedInCampaign.get(asset.id) ?? 0 };
  });
  scored.sort(
    (a, b) =>
      Number(b.suggested) - Number(a.suggested) ||
      b.hits - a.hits ||
      a.uses - b.uses ||
      (a.asset.created_at < b.asset.created_at ? 1 : a.asset.created_at > b.asset.created_at ? -1 : 0) ||
      (a.asset.id < b.asset.id ? -1 : 1),
  );
  const out: CampaignMaterial[] = [];
  const paths = new Set<string>();
  for (const { asset } of scored) {
    if (out.length >= count) break;
    if (paths.has(asset.storage_path)) continue; // la misma foto dos veces (duplicada en la biblioteca), no
    paths.add(asset.storage_path);
    out.push(asset);
  }
  return out;
}

export interface CampaignReel {
  /** Índice de la pieza en el plan. */
  pieceIndex: number;
  /** Proyecto de reel (plan v2) listo para guardar como versión de la pieza. */
  project: ReelProject;
  templateName: string;
  /** Rutas del material usado, en orden. */
  material: string[];
}

export interface CampaignReelsInput {
  pieces: readonly CampaignPiece[];
  /** Qué piezas son de vídeo (índices del plan). */
  videoIndexes: readonly number[];
  templates: readonly BrandReelTemplate[];
  /** Plantilla de reel sugerida para cada pieza (la de la ficha del plan), si la hay. */
  hints?: ReadonlyMap<number, string>;
  library: readonly CampaignMaterial[];
  styles?: readonly ReelTemplateSummary[];
  font?: { path: string; family: string };
  /** Colores, logotipo, usuario, dirección y llamada de la marca (`brandReelKit`): sin él, sin cierre. */
  kit?: BrandReelKit | null;
  /** El pie lo redactó la IA (plan de la IA, no de la agencia): se marca como tal. */
  aiGenerated?: boolean;
}

/**
 * Un reel por pieza de vídeo, con su plantilla y su material. Las piezas para
 * las que no hay material suficiente (ni una foto) se quedan fuera: se abren
 * vacías, como antes, y la interfaz lo dice.
 */
export function buildCampaignReels(input: CampaignReelsInput): { reels: CampaignReel[]; withoutMaterial: number[] } {
  const styles = input.styles ?? REEL_TEMPLATES;
  const fallbackStyle = styles[0];
  const used = new Map<string, number>();
  const templateUses = new Map<string, number>();
  const reels: CampaignReel[] = [];
  const withoutMaterial: number[] = [];
  for (const index of input.videoIndexes) {
    const piece = input.pieces[index];
    if (!piece || !fallbackStyle) continue;
    // Plantilla: la sugerida en la ficha; si no, la de la marca menos usada en la campaña; si no hay, la sencilla.
    const hinted = input.hints?.get(index);
    const brandTemplate =
      input.templates.find((t) => t.id === hinted) ??
      [...input.templates].sort(
        (a, b) => (templateUses.get(a.id) ?? 0) - (templateUses.get(b.id) ?? 0) || a.name.localeCompare(b.name, 'es'),
      )[0];
    const template = brandTemplate?.template ?? basicReelTemplate(fallbackStyle.id);
    const style = styles.find((s) => s.id === template.style.id) ?? fallbackStyle;
    const { max } = reelTemplateNeeds(template);
    const material = pickReelMaterial(piece, input.library, max, used);
    if (material.length === 0) {
      withoutMaterial.push(index);
      continue;
    }
    for (const asset of material) used.set(asset.id, (used.get(asset.id) ?? 0) + 1);
    if (brandTemplate) templateUses.set(brandTemplate.id, (templateUses.get(brandTemplate.id) ?? 0) + 1);
    const built = buildBrandReel(templateForPiece(template, piece), material, style, {
      library: input.library,
      ...(input.font ? { font: input.font } : {}),
      ...(input.kit ? { kit: input.kit } : {}),
    });
    // El pie y los hashtags del plan, para publicar el reel con ellos (antes salía sin pie).
    const project: ReelProject = {
      ...built,
      copy: {
        caption: [...piece.caption].slice(0, REEL_CAPTION_MAX).join(''),
        hashtags: piece.hashtags.filter((tag) => /^[\p{L}\p{N}_]{1,100}$/u.test(tag)).slice(0, REEL_HASHTAGS_MAX),
        ...(input.aiGenerated ? { aiGenerated: true } : {}),
      },
    };
    reels.push({
      pieceIndex: index,
      project,
      templateName: brandTemplate?.name ?? 'Reel sencillo',
      material: material.map((a) => a.storage_path),
    });
  }
  return { reels, withoutMaterial };
}
