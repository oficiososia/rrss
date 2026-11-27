// Procedencia y nombre de una foto editada en el navegador (sin IA). Como la de
// «Exportar imagen», se escribe al crear el recurso y no se puede cambiar
// después; la base de datos exige que el original sea de la misma marca
// (migración 20261128010000). La foto original no se toca nunca.
import type { Json } from '@/lib/database.types';
import type { Box, NetworkAspect } from './framing';
import type { Adjustments } from './pixels';

export const PHOTO_EDIT_TYPE = 'photo_edit';
/** Carpeta y etiqueta de las fotos editadas (las mismas que usa el servidor para las de IA). */
export const EDITS_FOLDER = 'Ediciones';
export const EDIT_TAG = 'edición';
const MAX_PROVENANCE_BYTES = 2048;

export type PhotoEditStep =
  | { kind: 'adjust'; adjustments: Adjustments; auto: boolean }
  | { kind: 'crop'; aspect: NetworkAspect | null; box: Box; smart: boolean }
  | { kind: 'remove_background'; engine: 'browser'; model: string }
  | {
      kind: 'background';
      background: { type: 'color'; hex: string } | { type: 'asset'; assetId: string };
      /** Sombra suave bajo el sujeto. */
      shadow?: boolean;
    }
  | {
      /** «Modo retrato»: fondo desenfocado tipo lente con el plato nítido (docs/edicion-fotos.md, §13). */
      kind: 'portrait_blur';
      /** Intensidad de 1 a 100. */
      amount: number;
      /** Más borroso cuanto más lejos del plato. */
      progressive: boolean;
      /** Oscurecido del fondo («Resaltar el plato»), de 0 a 100. */
      dim: number;
    }
  | {
      /** La selección del plato se retocó a mano con el pincel (nº de trazos). */
      kind: 'retouch_selection';
      strokes: number;
    }
  | {
      /** Fondo cambiado con IA y el plato original vuelto a pegar encima (docs/edicion-fotos.md, §9). */
      kind: 'ai_background';
      prompt: string;
      /** Modelo de IA que pintó el fondo («proveedor:modelo»). */
      model: string;
      /** Modelo del recorte que dio la máscara del plato. */
      maskModel: string;
      /** Se volvió a pegar el plato original sobre el resultado de la IA. */
      plateProtected: true;
    };

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;

function stepJson(step: PhotoEditStep): Json {
  if (step.kind === 'adjust') {
    const a = step.adjustments;
    return {
      kind: 'adjust',
      auto: step.auto,
      exposure: a.exposure,
      contrast: a.contrast,
      saturation: a.saturation,
      warmth: a.warmth,
      sharpness: a.sharpness,
      shadows: a.shadows,
      highlights: a.highlights,
      clarity: a.clarity,
      vibrance: a.vibrance,
      levels: a.levels,
      balance: a.balance.map((g) => round(g)),
    };
  }
  if (step.kind === 'crop') {
    return {
      kind: 'crop',
      aspect: step.aspect,
      smart: step.smart,
      box: {
        x: Math.round(step.box.x),
        y: Math.round(step.box.y),
        width: Math.round(step.box.width),
        height: Math.round(step.box.height),
      },
    };
  }
  if (step.kind === 'ai_background') {
    return {
      kind: 'ai_background',
      operation: 'replace_background',
      prompt: step.prompt.slice(0, 300),
      model: step.model.slice(0, 80),
      mask_model: step.maskModel,
      plate_protected: step.plateProtected,
    };
  }
  if (step.kind === 'portrait_blur') {
    return {
      kind: 'portrait_blur',
      amount: step.amount,
      progressive: step.progressive,
      ...(step.dim ? { dim: step.dim } : {}),
    };
  }
  if (step.kind === 'retouch_selection') return { kind: 'retouch_selection', strokes: step.strokes };
  if (step.kind === 'remove_background') return { kind: 'remove_background', engine: step.engine, model: step.model };
  return {
    kind: 'background',
    ...(step.shadow ? { shadow: true } : {}),
    ...(step.background.type === 'color'
      ? { color: step.background.hex.toUpperCase() }
      : { asset_id: step.background.assetId }),
  };
}

/** Procedencia de una edición del navegador: de qué foto sale, qué se hizo y el tamaño final. */
export function photoEditProvenance(input: {
  sourceAssetId: string;
  steps: PhotoEditStep[];
  width: number;
  height: number;
  editedAt?: Date;
}): Json {
  const json = {
    type: PHOTO_EDIT_TYPE,
    source_asset_id: input.sourceAssetId,
    steps: input.steps.map(stepJson),
    width: input.width,
    height: input.height,
    edited_at: (input.editedAt ?? new Date()).toISOString(),
  };
  // Con los pasos que hay no se llega ni a la mitad; si algún día no cabe, se quitan detalles.
  if (new TextEncoder().encode(JSON.stringify(json)).length > MAX_PROVENANCE_BYTES - 200) {
    return { ...json, steps: input.steps.map((step) => ({ kind: step.kind })) };
  }
  return json;
}

const STEP_NAME: Record<PhotoEditStep['kind'], string> = {
  adjust: 'Mejorada',
  crop: 'Recorte',
  background: 'Fondo nuevo',
  ai_background: 'Fondo nuevo',
  portrait_blur: 'Modo retrato',
  retouch_selection: 'Selección retocada',
  remove_background: 'Sin fondo',
};

/** Nombre legible: «Mejorada · Chuletón.jpg», «Recorte 4:5 · Chuletón.jpg», «Fondo nuevo · Chuletón.png». */
export function editedFileName(sourceName: string, steps: PhotoEditStep[], extension: 'png' | 'jpg'): string {
  const base =
    sourceName
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 120)
      .trim() || 'foto';
  const crop = steps.find((s): s is Extract<PhotoEditStep, { kind: 'crop' }> => s.kind === 'crop');
  const main =
    steps.find((s) => s.kind === 'background' || s.kind === 'ai_background' || s.kind === 'portrait_blur') ??
    steps.find((s) => s.kind === 'remove_background') ??
    (steps.some((s) => s.kind === 'adjust') ? steps.find((s) => s.kind === 'adjust') : crop);
  let label = main ? STEP_NAME[main.kind] : 'Editada';
  if (main?.kind === 'crop' && crop?.aspect) label = `Recorte ${crop.aspect}`;
  else if (crop?.aspect) label = `${label} ${crop.aspect}`;
  return `${label} · ${base}.${extension}`;
}

/** De qué foto sale esta (la procedencia de una edición), o `null` si es una foto subida tal cual. */
export function sourceAssetIdOf(provenance: Json | undefined): string | null {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return null;
  const id = (provenance as Record<string, Json | undefined>).source_asset_id;
  return typeof id === 'string' && id ? id : null;
}
