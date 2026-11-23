// Calidad de los reels en el lado de la aplicación (docs/reels-calidad.md).
//
// Lo que el trabajador ya hace solo con cualquier plan (worker/src/reel/):
// encuadre por sujeto, textos legibles sin solaparse y dentro de las zonas
// seguras, gradación, cierre si el plan lo trae, codificación y vídeo sin
// pista de audio cuando no hay sonido.
//
// Lo que se decide AQUÍ, antes de encargar:
//   * qué material entra: sin repetir y por calidad (`rankReelAssets`);
//   * el estilo de cada texto según su papel (`roleTextStyle`), con los colores
//     de la marca;
//   * el punto de interés guardado de cada foto (`savedFocalPoints`, de sus
//     recortes) y su máscara de «Quitar el fondo» (`subjectMasks`);
//   * el cierre con la marca (`brandReelKit` + `brandOutro`);
//   * el aviso «Sin música» (`reelAudioNotice`).
//
// Todo es puro (sin red ni React): lo usan las plantillas, «Hacer un reel como
// este», los reels de las campañas y las pantallas del editor (crear desde una
// plantilla, selectores de material, aviso de música).
import type { BrandProfileData } from '@/features/brand/profile';
import { logoVariantFor, type LogoTones } from '@/features/content/editor/logoContrast';
import { OUTRO_SECONDS, TEXT_ROLES, type ReelOutro, type TextRole, type TextStyle } from './editor/project';

// ───────────────────────────── Papeles de los textos ─────────────────────────────

/**
 * Papel de un texto en el vídeo. Es el mismo vocabulario que entiende el
 * trabajador (worker/src/reel/textlayout.ts, campo `role` del plan v2 desde la
 * migración 20270113010000): el editor lo guarda en cada texto (`role`) y, sin
 * él, el trabajador lo deduce.
 */
export const REEL_TEXT_ROLES = TEXT_ROLES;
export type ReelTextRole = TextRole;

/** Papel de un texto de plantilla (reelTemplate.ts) → papel en el vídeo. */
export const TEMPLATE_ROLE_TO_TEXT_ROLE: Record<'hook' | 'title' | 'step' | 'detail' | 'cta', ReelTextRole> = {
  hook: 'headline',
  title: 'headline',
  step: 'label',
  detail: 'label',
  cta: 'cta',
};

export interface BrandColors {
  /** Color de acento de la marca (cajas de la llamada y del precio). */
  accent?: string;
  /** Color oscuro de la marca (cajas de los rótulos). */
  dark?: string;
  /** Color de la letra sobre el acento; si falta, el que más contraste. */
  onAccent?: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Contraste entre dos colores (WCAG): de 1 a 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Blanco o casi negro, el que mejor se lea sobre `background`. */
export function readableOn(background: string): string {
  return contrastRatio('#FFFFFF', background) >= contrastRatio('#141414', background) ? '#FFFFFF' : '#141414';
}

/**
 * Estilo de un texto por su papel, con los colores de la marca. Los tamaños
 * son los mínimos del trabajador o algo más (en 1080 px de ancho):
 *   titular ≈ 99 px, grueso, con contorno fino y sombra;
 *   rótulo ≈ 67 px en caja oscura de la marca;
 *   precio ≈ 92 px y llamada ≈ 82 px, en caja del color de acento.
 * La tipografía la pone la marca (`fontPath`), como siempre.
 */
export function roleTextStyle(
  role: ReelTextRole,
  colors: BrandColors = {},
  font?: { path: string; family: string },
): TextStyle {
  const accent = colors.accent && HEX.test(colors.accent) ? colors.accent.toUpperCase() : '#FFFFFF';
  const dark = colors.dark && HEX.test(colors.dark) ? colors.dark.toUpperCase() : '#111111';
  const onAccent =
    colors.onAccent && HEX.test(colors.onAccent) && contrastRatio(colors.onAccent, accent) >= 4.5
      ? colors.onAccent.toUpperCase()
      : readableOn(accent);
  const fontPart = font ? { fontPath: font.path, fontFamily: font.family } : {};
  switch (role) {
    case 'headline':
      return {
        ...fontPart,
        sizeRatio: 0.092,
        color: '#FFFFFF',
        marginRatio: 0.2,
        maxWidthRatio: 0.82,
        lineHeight: 1.1,
        box: null,
        outline: { color: '#000000', widthRatio: 0.04 },
        fadeSeconds: 0.25,
      };
    case 'label':
      return {
        ...fontPart,
        sizeRatio: 0.062,
        color: readableOn(dark),
        marginRatio: 0.23,
        maxWidthRatio: 0.8,
        lineHeight: 1.45,
        box: { color: dark, opacity: 0.82, paddingRatio: 0.3 },
        outline: null,
        fadeSeconds: 0.25,
      };
    case 'price':
      return {
        ...fontPart,
        sizeRatio: 0.085,
        color: onAccent,
        marginRatio: 0.2,
        maxWidthRatio: 0.8,
        lineHeight: 1.2,
        box: { color: accent, opacity: 1, paddingRatio: 0.35 },
        outline: null,
        fadeSeconds: 0.25,
      };
    case 'cta':
      return {
        ...fontPart,
        sizeRatio: 0.076,
        color: onAccent,
        marginRatio: 0.23,
        maxWidthRatio: 0.82,
        lineHeight: 1.3,
        box: { color: accent, opacity: 1, paddingRatio: 0.4 },
        outline: null,
        fadeSeconds: 0.25,
      };
  }
}

// ───────────────────────────── Material ─────────────────────────────

/** Lo que hace falta de un recurso de la biblioteca para juzgar si sirve para un reel. */
export interface RankableAsset {
  id: string;
  kind: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  folder?: string | null;
  tags?: string[] | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  duration_ms?: number | null;
  provenance?: unknown;
}

/** Carpetas de material de trabajo, no de foto final: se dejan para el final. */
const WEAK_FOLDERS = ['recortes', 'ediciones', 'reels', 'portadas', 'capturas', 'screenshots', 'whatsapp'];

const lower = (s: string | null | undefined) => (s ?? '').toLocaleLowerCase('es');

/**
 * Nota de 0 a 100 de lo bien que quedará un recurso en un reel 9:16, sin
 * descargarlo: resolución (el lado corto frente a los 1080 px del reel),
 * detalle (bytes por píxel de una foto comprimida: una foto movida o muy
 * oscura pesa poco), proporción (vertical mejor que apaisada) y procedencia
 * (un PNG sin fondo, una captura o un recorte ya hecho no son tomas).
 */
export function reelAssetScore(asset: RankableAsset): number {
  let score = 50;
  const name = lower(asset.file_name);
  const folder = lower(asset.folder);
  if (asset.kind === 'video') score += 8;
  if (asset.width && asset.height) {
    const short = Math.min(asset.width, asset.height);
    score += short >= 1080 ? 18 : short >= 720 ? 8 : short >= 480 ? -6 : -25;
    const ratio = asset.width / asset.height;
    score += ratio <= 0.8 ? 8 : ratio <= 1.05 ? 3 : ratio <= 1.5 ? -2 : -8;
    if (asset.kind !== 'video' && asset.bytes && /jpe?g|webp|heic/.test(lower(asset.mime_type))) {
      const bpp = asset.bytes / (asset.width * asset.height);
      // Una foto nítida y con luz suele pasar de 0,2 bytes por píxel; una movida u oscura se queda en 0,05.
      score += bpp >= 0.25 ? 10 : bpp >= 0.12 ? 4 : bpp >= 0.06 ? -4 : -12;
    }
  }
  // Un PNG sin fondo o un recorte ya hecho no son una toma: casi nunca deben abrir ni llenar un plano.
  if (/sin fondo|cutout|recorte/.test(name)) score -= 60;
  if (/captura|screenshot|whatsapp|img-\d{8}-wa/.test(name)) score -= 20;
  if (WEAK_FOLDERS.some((w) => folder.includes(w))) score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Sin repetir: el primero de cada archivo (por ruta), en el mismo orden. */
export function uniqueAssets<T extends { storage_path: string }>(assets: readonly T[]): T[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.storage_path)) return false;
    seen.add(asset.storage_path);
    return true;
  });
}

/**
 * Material ordenado para un reel: sin repetidos, lo mejor primero (a igualdad,
 * lo más reciente primero si trae `created_at`). Es lo que deberían proponer los
 * selectores de material por defecto.
 */
export function rankReelAssets<T extends RankableAsset & { created_at?: string }>(assets: readonly T[]): T[] {
  return uniqueAssets(assets)
    .filter((a) => a.kind === 'image' || a.kind === 'video')
    .map((asset, index) => ({ asset, index, score: reelAssetScore(asset) }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.asset.created_at ?? '').localeCompare(a.asset.created_at ?? '') || a.index - b.index,
    )
    .map((entry) => entry.asset);
}

/**
 * El plano más fuerte para abrir el reel (gancho): el de más nota de los
 * elegidos. Devuelve el orden con ese primero; el resto, como venía.
 */
export function strongestFirst<T extends RankableAsset>(assets: readonly T[]): T[] {
  if (assets.length < 2) return [...assets];
  let best = 0;
  assets.forEach((asset, index) => {
    if (reelAssetScore(asset) > reelAssetScore(assets[best]!) + 5) best = index;
  });
  return best === 0 ? [...assets] : [assets[best]!, ...assets.filter((_, i) => i !== best)];
}

interface Provenance {
  kind?: unknown;
  focal_point?: { x?: unknown; y?: unknown };
  sources?: Array<{ path?: unknown }>;
}

const sourcePaths = (p: Provenance) =>
  (Array.isArray(p.sources) ? p.sources : []).map((s) => s?.path).filter((x): x is string => typeof x === 'string');

/**
 * Punto de interés guardado de cada foto: el de su último recorte («Recortes»,
 * `media.image.process`). Ruta de la foto → { x, y }.
 */
export function savedFocalPoints(library: readonly RankableAsset[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const asset of library) {
    const p = (asset.provenance ?? {}) as Provenance;
    if (p.kind !== 'media.image.process') continue;
    const x = Number(p.focal_point?.x);
    const y = Number(p.focal_point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) continue;
    for (const path of sourcePaths(p)) if (!out.has(path)) out.set(path, { x, y });
  }
  return out;
}

/**
 * Máscara del sujeto de cada foto: su PNG de «Quitar el fondo» (`media.cutout`).
 * Ruta de la foto → ruta del PNG. Va al plan como `subjectMaskPath` cuando el
 * editor lo guarde (campo del plan v2 desde 20270113010000).
 */
export function subjectMasks(library: readonly RankableAsset[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const asset of library) {
    const p = (asset.provenance ?? {}) as Provenance;
    if (p.kind !== 'media.cutout') continue;
    for (const path of sourcePaths(p)) if (!out.has(path)) out.set(path, asset.storage_path);
  }
  return out;
}

/** Nombres de archivo que no dicen nada (cámara, móvil, capturas). */
const MEANINGLESS =
  /^(img|dsc|dscn|pxl|vid|video|mvimg|whatsapp|foto|image|imagen|photo|screenshot|captura|sin fondo|recorte)\b/i;

/**
 * Rótulo de un plano a partir del nombre del archivo, si dice algo: «Alcachofa a
 * la parrilla con oreja, guanciale….webp» → «Alcachofa a la parrilla con oreja».
 * Null si el nombre es de cámara o de móvil («IMG_0379», «PXL_2026…»).
 */
export function assetCaption(fileName: string): string | null {
  const base = fileName
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/(\p{L})-(?=\p{L})/gu, '$1 ')
    .replace(/\s*[-–]\s*(c\d+|img\s?\d+|copia|copy|\d+)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || MEANINGLESS.test(base)) return null;
  const letters = (base.match(/\p{L}/gu) ?? []).length;
  const digits = (base.match(/\d/g) ?? []).length;
  if (letters < 3 || digits > letters / 2) return null;
  // Lo primero hasta una coma y, como mucho, unas 34 letras sin partir palabras.
  let caption = base.split(/[,(]/)[0]!.trim();
  if (caption.length > 34) {
    const words = caption.split(' ');
    caption = '';
    for (const w of words) {
      if ((caption ? caption.length + 1 : 0) + w.length > 34) break;
      caption = caption ? `${caption} ${w}` : w;
    }
    caption = caption.replace(/\s+(a|al|con|de|del|el|en|la|las|los|y|e|o)$/i, '');
  }
  if (caption.length < 3) return null;
  return caption.charAt(0).toLocaleUpperCase('es') + caption.slice(1);
}

/**
 * Orden del material para una plantilla: los vídeos van a los planos de ambiente
 * (huecos `video` o de tipo general o persona) y las fotos a los de detalle
 * (huecos `photo`, detalle o texto); los planos sin preferencia se llenan con lo
 * que queda, en el orden en que venía. Un vídeo real del sitio cuenta más que una
 * foto en un plano de ambiente.
 */
export function orderForSlots<T extends { kind: string }>(
  slots: ReadonlyArray<{ kind?: string; shot?: string }>,
  assets: readonly T[],
): T[] {
  const pool = [...assets];
  const take = (video: boolean) => {
    const index = pool.findIndex((a) => (a.kind === 'video') === video);
    return index >= 0 ? pool.splice(index, 1)[0] : undefined;
  };
  const used = slots.slice(0, assets.length);
  // Primero los planos que piden algo concreto; después, los demás con lo que quede, en su orden.
  const out: Array<T | undefined> = used.map((slot) => {
    if (slot.kind === 'video' || slot.shot === 'wide' || slot.shot === 'person') return take(true);
    if (slot.kind === 'photo' || slot.shot === 'detail' || slot.shot === 'text') return take(false);
    return undefined;
  });
  return out.map((asset) => asset ?? pool.shift()).filter((a): a is T => Boolean(a));
}

// ───────────────────────────── Cierre con la marca ─────────────────────────────

export interface BrandReelKit {
  colors: BrandColors;
  /** Logotipo (ruta de la biblioteca de la marca). */
  logoPath?: string;
  /** Usuario de Instagram (o de la primera red con usuario), con «@». */
  handle?: string;
  /** Dirección o ciudad (la primera del perfil). */
  address?: string;
  /** Primera llamada a la acción del perfil. */
  cta?: string;
}

function pickColor(colors: BrandProfileData['visual']['colors'], words: RegExp, fallback?: (hex: string) => boolean) {
  const byRole = colors.find((c) => words.test(lower(`${c.role} ${c.name}`)));
  if (byRole) return byRole.hex.toUpperCase();
  const other = fallback ? colors.find((c) => fallback(c.hex)) : undefined;
  return other?.hex.toUpperCase();
}

/**
 * Luminancia del fondo del cierre: siempre oscuro (el vídeo oscurecido o el color oscuro de la
 * marca). Sobre él se quiere la variante clara del logotipo.
 */
export const REEL_OUTRO_BACKDROP_LUMINANCE = 0.02;

interface LogoAsset {
  id: string;
  kind: string;
  storage_path: string;
  mime_type: string;
  file_name?: string;
  tags?: readonly string[];
}

/**
 * El logotipo para el cierre, entre los del perfil (`visual.logoAssetIds`, en su orden) que el
 * trabajador puede superponer (PNG, JPEG o WebP; un SVG no). Como el fondo del cierre siempre es
 * oscuro, se prefiere la variante que contrasta con él, con la misma regla que las plantillas
 * del editor (content/editor/logoContrast.ts):
 *  - con la luminancia medida de los logotipos (`tones`), la variante que llega a 3:1 o, si
 *    ninguna, la que más contrasta;
 *  - sin medir, la que su nombre o sus etiquetas dicen clara («claro», «blanco», «white»…),
 *    salvo que la primera ya lo sea.
 * Si nada indica otra cosa, el primero. Undefined si no hay ninguno que se pueda superponer.
 */
export function reelLogoPath(
  logoIds: readonly string[],
  assets: ReadonlyArray<LogoAsset>,
  tones?: LogoTones,
): string | undefined {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const usable = logoIds.flatMap((id) => {
    const asset = byId.get(id);
    return asset &&
      (asset.kind === 'image' || asset.kind === 'logo') &&
      /^image\/(png|jpeg|webp)$/i.test(asset.mime_type)
      ? [asset]
      : [];
  });
  const first = usable[0];
  if (!first) return undefined;
  // La misma regla que las plantillas del editor y sus miniaturas, sobre el fondo oscuro del cierre.
  const best = logoVariantFor(
    first.id,
    usable.map((a) => a.id),
    new Map(usable.map((a) => [a.id, a])),
    tones,
    REEL_OUTRO_BACKDROP_LUMINANCE,
  );
  return byId.get(best)!.storage_path;
}

/** Lo que el reel toma del perfil de la marca: colores, logotipo, usuario, dirección y llamada. */
export function brandReelKit(profile: BrandProfileData, logoPath?: string | null): BrandReelKit {
  const colors = profile.visual.colors.filter((c) => HEX.test(c.hex));
  const accent =
    pickColor(colors, /acento|accent|principal|primary|marca|brand|dorad|oro|gold/) ?? colors[0]?.hex.toUpperCase();
  const dark = pickColor(colors, /oscur|dark|fondo|negro|black|texto|text/, (hex) => luminance(hex) < 0.08);
  const instagram = profile.channels.find((c) => /instagram/i.test(c.platform) && c.handle.trim());
  const anyHandle = instagram ?? profile.channels.find((c) => c.handle.trim());
  const handle = anyHandle ? `@${anyHandle.handle.trim().replace(/^@+/, '')}`.slice(0, 60) : undefined;
  const address = profile.business.locations
    .find((l) => l.trim())
    ?.trim()
    .slice(0, 120);
  const cta = profile.voice.callsToAction.find((c) => c.trim() && c.trim().length <= 60)?.trim();
  return {
    colors: { ...(accent ? { accent } : {}), ...(dark ? { dark } : {}) },
    ...(logoPath ? { logoPath } : {}),
    ...(handle ? { handle } : {}),
    ...(address ? { address } : {}),
    ...(cta ? { cta } : {}),
  };
}

/** Cierre del plan v2 (`plan.outro`): sin campos vacíos, como lo pide `request_media_job`. */
export type ReelOutroPlan = ReelOutro & { seconds: number };

/**
 * El cierre con la marca: logotipo, llamada grande (la del texto final de la
 * plantilla o la del perfil) y, si los hay, usuario y dirección, durante 2 s.
 */
export function brandOutro(kit: BrandReelKit, cta?: string | null, seconds = 2): ReelOutroPlan | null {
  const call = (cta ?? kit.cta ?? '').trim().slice(0, 60);
  if (!call) return null;
  const accent = kit.colors.accent;
  return {
    seconds: Math.min(OUTRO_SECONDS.max, Math.max(OUTRO_SECONDS.min, seconds)),
    cta: call,
    ...(kit.handle ? { handle: kit.handle } : {}),
    ...(kit.address ? { address: kit.address } : {}),
    ...(kit.logoPath ? { logoPath: kit.logoPath } : {}),
    ...(accent ? { accent, accentText: readableOn(accent) } : {}),
  };
}

const CALL_TO_ACTION =
  /\b(reserva|reservar|pide|pídelo|llama|llámanos|visítanos|ven|venid|encarga|compra|apúntate|escríbenos|enlace|bio|te esperamos|pruébalo)\b/i;

/** ¿El texto es una llamada a la acción («Reserva tu mesa», «Te esperamos»…)? */
export const isCallToAction = (text: string) => CALL_TO_ACTION.test(text);

/**
 * Añade al plan el cierre con la marca. Si el último texto del reel ya es la
 * llamada («Reserva tu mesa» sobre el último plano), pasa al cierre en lugar de
 * salir dos veces. Devuelve el plan tal cual si no hay llamada con la que cerrar.
 * El editor lo guarda en el plan (`outro`) al crear un reel desde una plantilla.
 */
export function withBrandOutro<
  P extends { texts: Array<{ text: string; start: number; end: number }>; clips: unknown[] },
>(plan: P, kit: BrandReelKit, total: number): P & { outro?: ReelOutroPlan } {
  // La llamada del final: de los textos que llegan hasta el final, el último que es una llamada.
  const last = plan.texts
    .filter((t) => t.end >= total - 0.3 && CALL_TO_ACTION.test(t.text))
    .sort((a, b) => b.start - a.start)[0];
  const outro = brandOutro(kit, last ? last.text : null);
  if (!outro) return plan;
  return {
    ...plan,
    texts: last ? plan.texts.filter((t) => t !== last) : plan.texts,
    outro,
  };
}

// ───────────────────────────── Textos sin pisarse ─────────────────────────────

type Position = 'top' | 'center' | 'bottom';

/**
 * Que dos textos no coincidan a la vez en la misma franja (la vista previa del
 * editor los dibujaría encima; el trabajador los separaría por su cuenta). Por
 * orden de aparición: si uno choca con otro en su franja, pasa a una franja libre
 * en ese momento (abajo, arriba o centro); si no hay ninguna, entra cuando el
 * otro ya se ha ido (y si así no se leería, el otro sale antes).
 */
export function separateTexts<T extends { start: number; end: number; position: Position }>(texts: readonly T[]): T[] {
  const MIN = 0.9;
  const out: T[] = [];
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.02;
  const ordered = texts.map((t, i) => ({ t: { ...t }, i })).sort((a, b) => a.t.start - b.t.start || a.i - b.i);
  for (const { t } of ordered) {
    const busy = (pos: Position, span: { start: number; end: number }) =>
      out.some((o) => o.position === pos && overlaps(o, span));
    // Un roce corto (lo que dura una transición): el anterior sale justo antes y este conserva su franja.
    const touching = out.filter((o) => o.position === t.position && overlaps(o, t));
    if (touching.length > 0 && touching.every((o) => o.end - t.start <= 0.6 && t.start - o.start >= MIN)) {
      for (const o of touching) o.end = Number((t.start - 0.05).toFixed(2));
    }
    if (!busy(t.position, t)) {
      out.push(t);
      continue;
    }
    const free = (['bottom', 'top', 'center'] as const).find((pos) => !busy(pos, t));
    if (free) {
      out.push({ ...t, position: free });
      continue;
    }
    const clashing = out.filter((o) => o.position === t.position && overlaps(o, t));
    const after = Math.max(...clashing.map((o) => o.end)) + 0.05;
    if (t.end - after >= MIN) {
      out.push({ ...t, start: Number(after.toFixed(2)) });
      continue;
    }
    for (const o of clashing) {
      if (t.start - o.start >= MIN) o.end = Number((t.start - 0.05).toFixed(2));
    }
    if (!busy(t.position, t)) out.push(t);
  }
  return out.sort((a, b) => a.start - b.start);
}

// ───────────────────────────── Sonido ─────────────────────────────

/**
 * Aviso de sonido de un plan: «Sin música» si no lleva música (el vídeo sale
 * con el sonido de los clips o, si no lo hay, sin pista de audio). La pantalla
 * del editor debería enseñarlo junto a «Montar el vídeo» y en el panel del vídeo
 * final; el trabajo terminado lo confirma en `result.output.audio`
 * (`music` | `clips` | `none`).
 */
export function reelAudioNotice(plan: { music?: unknown; clips: ReadonlyArray<{ type: string; volume?: number }> }): {
  kind: 'music' | 'clips' | 'none';
  notice: string | null;
} {
  if (plan.music) return { kind: 'music', notice: null };
  const clipSound = plan.clips.some((c) => c.type === 'video' && (c.volume ?? 0) > 0);
  return clipSound
    ? { kind: 'clips', notice: 'Sin música: sonará el audio de los clips.' }
    : { kind: 'none', notice: 'Sin música: el vídeo saldrá sin sonido.' };
}
