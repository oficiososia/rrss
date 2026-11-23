import { emptyProject, type ReelProject } from '@/features/reels/editor/project';
import { REEL_TEMPLATES } from '@/features/reels/templates';
import type { MediaAssetRow } from '@/lib/database.types';
import type { ContentDocument } from '../document';

// Pasar una pieza a Reel desde el editor de piezas: las fotos del diseño (de
// todas las páginas, en orden y sin repetir) pasan a ser los clips del montaje,
// con la plantilla de siempre del editor de reels y su duración de foto. Lo que
// no es foto de la biblioteca (textos, formas, huecos vacíos) no entra.

/** La plantilla con la que abre el editor de reels (ReelEditor, `fundido-suave`). */
const REEL_START_TEMPLATE = 'fundido-suave';

export function reelFromDesign(document: ContentDocument, assets: readonly MediaAssetRow[]): ReelProject {
  const template = REEL_TEMPLATES.find((t) => t.id === REEL_START_TEMPLATE) ?? REEL_TEMPLATES[0]!;
  const project = emptyProject(template);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const seen = new Set<string>();
  const clips: ReelProject['plan']['clips'] = [];
  for (const page of document.pages) {
    for (const layer of page.layers) {
      if (layer.type !== 'image' || layer.source.kind !== 'asset' || !layer.visible) continue;
      const asset = byId.get(layer.source.assetId);
      if (!asset || asset.kind !== 'image' || seen.has(asset.id)) continue;
      seen.add(asset.id);
      clips.push({
        id: `c${clips.length + 1}`,
        type: 'photo',
        path: asset.storage_path,
        seconds: template.timing.photoSeconds,
      });
    }
  }
  return { ...project, plan: { ...project.plan, clips } };
}
