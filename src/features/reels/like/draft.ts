// «Hacer un reel como este»: del resultado del análisis a un BORRADOR de reel
// del editor, con material de la biblioteca de la marca.
//
//   1. `matchShots`  busca para cada plano del guion una foto o un clip de la
//      biblioteca que encaje, SIN IA: por tipo (foto o vídeo), etiquetas,
//      carpeta y nombre, frente al texto de la escena (qué tiene que verse y
//      sus rótulos) y las palabras de búsqueda del guion. Cada recurso se usa
//      una sola vez. Lo que no encaja queda como hueco, y se dice.
//   2. `buildDraft`  monta el proyecto del editor: los planos con material, en
//      orden, con la duración y la transición de la plantilla; los textos en
//      pantalla sobre los planos que ya existen; y el guion (`guide`) con lo
//      que falta por grabar.
//   3. `fillGuideShot` rellena un hueco con un recurso elegido a mano: lo pone
//      en su sitio y recoloca los textos del guion.
//
// Calidad (docs/reels-calidad.md), como los reels que salen de una plantilla
// (`buildBrandReel`): cada texto lleva su papel (`role`: titular, rótulo,
// llamada) y, con el perfil de la marca, el reel acaba con el cierre de la
// marca (`outro`: logotipo, llamada, usuario y dirección). La llamada final del
// guion pasa al cierre en vez de salir dos veces y los textos acaban cuando
// entra el cierre.
//
// Todo es puro: sin red ni React. Del vídeo de referencia no llega nada aquí:
// solo la estructura (duraciones, tipos de plano) y los textos ya escritos
// para la marca.
import {
  parseReelLikeResult,
  type ReelLikeResult,
  type TextSize,
  type TransitionKind,
} from '../../../../supabase/functions/_shared/reels/like';
import {
  outroSpan,
  PHOTO_SECONDS,
  planTimeline,
  PROJECT_KIND,
  REEL_MAX_CLIPS,
  REEL_MAX_SECONDS,
  REEL_PLAN_VERSION,
  REEL_TEXT_MAX_LENGTH,
  type Clip,
  type GuideShot,
  type GuideText,
  type ReelGuide,
  type ReelProject,
  type ReelText,
  type TextStyle,
  type Transition,
} from '../editor/project';
import type { ReelTemplateSummary } from '../templates';
import {
  isCallToAction,
  reelAssetScore,
  roleTextStyle,
  separateTexts,
  withBrandOutro,
  type BrandReelKit,
  type ReelTextRole,
} from '../quality';

/** Lo que se necesita de un recurso de la biblioteca para saber si encaja. */
export interface LibraryAsset {
  id: string;
  kind: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  duration_ms: number | null;
  folder: string;
  tags: string[];
  created_at: string;
  /** Medidas y peso, para preferir las fotos nítidas y con resolución (quality.ts). */
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  /** De dónde sale (recortes y «Quitar el fondo»): da el punto de interés y la máscara guardados. */
  provenance?: unknown;
}

export interface ShotMatch {
  /** Plano de la plantilla (`s1`…). */
  shot: string;
  /** El recurso elegido, o null si no encaja ninguno (hueco: falta grabar). */
  asset: LibraryAsset | null;
  score: number;
  /** Por qué encaja, para enseñarlo: «etiqueta pan», «carpeta Obrador»… */
  reasons: string[];
}

const round = (n: number, decimals = 2) => Number(n.toFixed(decimals));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Minúsculas, sin acentos y sin la «s» del plural: «Panes» y «pan» son la misma palabra. */
export function normalizeWord(word: string): string {
  const base = word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
  if (base.length > 4 && base.endsWith('es')) return base.slice(0, -2);
  if (base.length > 3 && base.endsWith('s')) return base.slice(0, -1);
  return base;
}

/** Palabras de un texto (de dos letras o más), normalizadas. */
export function words(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalizeWord)
    .filter((w) => w.length >= 2);
}

const WEIGHT = { tag: 3, folder: 2, name: 1, kind: 1, tooShort: -1 } as const;
/** Lo que encaja solo por contexto («marisco») cuenta la mitad que lo que encaja con lo que tiene que verse. */
const CONTEXT_ONLY = 0.5;

/**
 * Palabras que no dicen QUÉ tiene que verse: de rodaje («primer plano», «toma»), los tipos de
 * plano del análisis, nombres de cámara («IMG», «DSC»…) y relleno. Lo que lleva cifras tampoco.
 */
const GENERIC_WORDS = new Set(
  words(
    'de del la las el los un una unos unas lo al a y o e en con sin por para su sus que se muy mas ' +
      'plano primer primero cerrado abierto medio detalle general persona texto toma foto fotografia ' +
      'video clip imagen camara grabar grabado grabando encuadre cerca lejos lento rapido movimiento ' +
      'img dsc pxl mvimg vid whatsapp screenshot captura copia final editada recorte',
  ),
);

/** Palabras que dicen qué se ve (sin las genéricas ni las que llevan cifras). */
function meaningful(text: string): string[] {
  return words(text).filter((w) => !GENERIC_WORDS.has(w) && !/\d/.test(w));
}

/** Lo que pide un plano del guion para elegir su material. */
export interface ShotWanted {
  media: 'foto' | 'video';
  seconds: number;
  /** Palabras de búsqueda que trae el guion. */
  search: string[];
  /**
   * El texto de la escena: qué tiene que verse («what») y los rótulos que van solo sobre ese
   * plano. Sus palabras también cuentan y, con las de búsqueda, dicen cuál es el protagonista.
   */
  scene?: string;
}

/**
 * Lo que tiene que verse en el plano, en palabras: las que el guion dice a la vez en la escena y
 * en la búsqueda («Zamburiñas a la plancha» + «zamburiñas, marisco» → «zamburiña»). Si no
 * coinciden, la primera palabra de búsqueda y las de la escena. Las demás («marisco») solo dan
 * contexto.
 */
export function shotSubject(shot: Pick<ShotWanted, 'search' | 'scene'>): string[] {
  const scene = new Set(meaningful(shot.scene ?? ''));
  const search = [...new Set(shot.search.flatMap(meaningful))];
  const agreed = search.filter((w) => scene.has(w));
  if (agreed.length > 0) return agreed;
  return [...new Set([...meaningful(shot.search[0] ?? ''), ...scene])];
}

/**
 * Cuánto encaja un recurso con un plano y por qué. 0 = no encaja.
 *
 * Encaja si alguna palabra (etiqueta, carpeta o nombre) coincide con lo que tiene que verse
 * (`shotSubject`). Si solo coincide una de contexto («marisco»), vale a medias y únicamente si su
 * nombre no dice que es otra cosa: «Ostras.jpg» no sirve para un plano de zamburiñas aunque esté
 * etiquetada como marisco; «IMG_0001.mp4» con la etiqueta «Panes», sí para «la hogaza».
 */
export function scoreAsset(shot: ShotWanted, asset: LibraryAsset): { score: number; reasons: string[] } {
  if (asset.kind !== 'image' && asset.kind !== 'video') return { score: 0, reasons: [] };
  const subject = new Set(shotSubject(shot));
  const terms = [...new Set([...shot.search.flatMap(meaningful), ...subject])];
  if (terms.length === 0) return { score: 0, reasons: [] };
  const tagWords = new Map<string, string>();
  for (const tag of asset.tags) for (const w of words(tag)) tagWords.set(w, tag);
  const folderWords = new Set(words(asset.folder));
  const name = asset.file_name.replace(/\.[^.]*$/, '');
  const nameWords = new Set(words(name));
  let score = 0;
  let onSubject = false;
  const reasons: string[] = [];
  for (const term of terms) {
    const before = score;
    if (tagWords.has(term)) {
      score += WEIGHT.tag;
      reasons.push(`etiqueta «${tagWords.get(term)}»`);
    } else if (folderWords.has(term)) {
      score += WEIGHT.folder;
      reasons.push(`carpeta «${asset.folder}»`);
    } else if (nameWords.has(term)) {
      score += WEIGHT.name;
      reasons.push('nombre del archivo');
    }
    if (score > before && subject.has(term)) onSubject = true;
  }
  if (score === 0) return { score: 0, reasons: [] };
  if (!onSubject) {
    // Solo por contexto: si el nombre del archivo dice que es otra cosa, no se usa.
    const known = new Set(terms);
    if (meaningful(name).some((w) => !known.has(w))) return { score: 0, reasons: [] };
    score *= CONTEXT_ONLY;
  }
  // El tipo solo desempata entre lo que ya coincide por palabras.
  const wanted = shot.media === 'video' ? 'video' : 'image';
  if (asset.kind === wanted) score += WEIGHT.kind;
  if (asset.kind === 'video' && asset.duration_ms !== null && asset.duration_ms / 1000 < shot.seconds - 0.2) {
    score += WEIGHT.tooShort;
    reasons.push('el clip es más corto que el plano');
  }
  return { score: Math.max(score, 0.5), reasons: [...new Set(reasons)] };
}

/** Cuánto pesa la calidad (de 0 a 100, `reelAssetScore`) frente a las palabras: desempata y aparta lo flojo. */
const QUALITY_WEIGHT = 0.04;

/** El texto de la escena de un plano: qué tiene que verse y los rótulos que van solo sobre él. */
function sceneOf(result: ReelLikeResult, index: number): string {
  const shot = result.template.shots[index];
  const values = new Map(result.texts.onScreen.map((entry) => [entry.text, entry.value]));
  const labels = result.template.texts
    .filter(
      (t) =>
        shot !== undefined &&
        t.fromShot === shot.id &&
        t.toShot === shot.id &&
        t.role !== 'gancho' &&
        t.role !== 'llamada',
    )
    .map((t) => values.get(t.id) ?? '');
  return [result.script.shots[index]?.what ?? '', ...labels].join(' ');
}

/**
 * Para cada plano, el recurso que mejor encaja con su escena (cada uno, una sola
 * vez, y nunca dos veces el mismo archivo). Se reparte por orden de plano; cuenta
 * lo que encaja por palabras (sobre todo con lo que tiene que verse) y, además,
 * la calidad de la foto (resolución, nitidez, proporción y que no sea un recorte
 * o una captura): entre dos que encajan igual, gana la mejor; a igualdad, la más
 * reciente. Lo que no encaja queda como hueco: nunca se pone uno cualquiera.
 */
export function matchShots(result: ReelLikeResult, assets: LibraryAsset[]): ShotMatch[] {
  const used = new Set<string>();
  const recent = [...assets].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return result.template.shots.map((shot, index) => {
    const search = result.script.shots[index]?.search ?? [];
    const wanted: ShotWanted = { media: shot.media, seconds: shot.seconds, search, scene: sceneOf(result, index) };
    let best: { asset: LibraryAsset; score: number; rank: number; reasons: string[] } | null = null;
    for (const asset of recent) {
      if (used.has(asset.id) || used.has(asset.storage_path)) continue;
      const scored = scoreAsset(wanted, asset);
      if (scored.score <= 0) continue;
      const rank = scored.score + reelAssetScore(asset) * QUALITY_WEIGHT;
      if (!best || rank > best.rank) best = { asset, rank, ...scored };
    }
    if (best) {
      used.add(best.asset.id);
      used.add(best.asset.storage_path);
    }
    return { shot: shot.id, asset: best?.asset ?? null, score: best?.score ?? 0, reasons: best?.reasons ?? [] };
  });
}

// ───────────────────────────── Estilo con la marca ─────────────────────────────

export interface BrandLook {
  /** Colores de la marca (#RRGGBB), el principal primero. */
  colors?: string[];
  /** Tipografía .ttf/.otf de la marca que puede usar el trabajador. */
  font?: { path: string; family: string };
  /**
   * Logotipo, llamada, usuario, dirección y colores del perfil (`brandReelKit`): con él, el
   * borrador acaba con el cierre de la marca. Sin él (o sin llamada), sin cierre.
   */
  kit?: BrandReelKit | null;
}

/** Tamaño pedido por el análisis → papel del texto en el vídeo (quality.ts). */
const SIZE_ROLE: Record<TextSize, ReelTextRole> = { grande: 'headline', normal: 'label', pequeno: 'label' };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Contraste entre dos colores (WCAG): de 1 a 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Estilo de un texto del guion: el de su papel (titular para lo «grande», rótulo
 * en caja para lo demás, con letra que se lee en un móvil), la tipografía de la
 * marca y, si el texto va en caja, la caja del color principal de la marca cuando
 * se lee bien encima. Un texto que cierra el reel con una llamada («Reserva…»)
 * va como llamada final. `template` queda por compatibilidad: el papel manda.
 */
export function guideTextStyle(
  size: TextSize,
  template: ReelTemplateSummary,
  look: BrandLook = {},
  role: ReelTextRole = SIZE_ROLE[size],
): TextStyle {
  void template;
  const brand = (look.colors ?? []).find((c) => /^#[0-9a-fA-F]{6}$/.test(c))?.toUpperCase();
  const style = roleTextStyle(role, { ...(brand ? { accent: brand } : {}) }, look.font);
  if (role === 'label' && style.box && brand && contrast(style.color, brand) >= 4.5) {
    style.box = { ...style.box, color: brand, opacity: Math.max(style.box.opacity, 0.85) };
  }
  return style;
}

// ───────────────────────────── Borrador ─────────────────────────────

const toTransition = (transition: { type: TransitionKind; seconds: number }): Transition =>
  transition.type === 'fade'
    ? { type: 'fade', seconds: round(clamp(transition.seconds || 0.4, 0.1, 2)) }
    : { type: 'cut', seconds: 0 };

/** El estilo de partida que más se parece: cortes secos o fundidos. */
export function baseTemplate(result: ReelLikeResult, templates: ReelTemplateSummary[]): ReelTemplateSummary {
  const later = result.template.shots.slice(1);
  const fades = later.filter((shot) => shot.transition.type === 'fade').length;
  const wanted = later.length > 0 && fades * 2 >= later.length ? 'fundido-suave' : 'corte-ritmico';
  return templates.find((t) => t.id === wanted) ?? templates[0]!;
}

/** El clip de un plano con el recurso elegido: su duración, sin pasar de lo que dura el archivo. */
function clipFor(
  id: string,
  shot: GuideShot,
  asset: Pick<LibraryAsset, 'kind' | 'storage_path' | 'duration_ms'>,
  template: ReelTemplateSummary,
): Clip {
  if (asset.kind === 'video') {
    const available = asset.duration_ms !== null && asset.duration_ms > 0 ? asset.duration_ms / 1000 : shot.seconds;
    return {
      id,
      type: 'video',
      path: asset.storage_path,
      in: 0,
      out: round(Math.max(0.5, Math.min(shot.seconds, available, 60))),
      volume: template.audio.clipVolume,
    };
  }
  return {
    id,
    type: 'photo',
    path: asset.storage_path,
    seconds: round(clamp(shot.seconds, PHOTO_SECONDS.min, PHOTO_SECONDS.max)),
  };
}

const present = (project: ReelProject, shot: GuideShot) =>
  shot.clipId !== undefined && project.plan.clips.some((clip) => clip.id === shot.clipId);

/** Qué planos del guion tienen ya material en el reel y cuáles faltan por grabar. */
export function guideStatus(project: ReelProject): Array<{ shot: GuideShot; filled: boolean }> {
  return (project.guide?.shots ?? []).map((shot) => ({ shot, filled: present(project, shot) }));
}

export const guideGaps = (project: ReelProject) => guideStatus(project).filter((entry) => !entry.filled).length;

/** La transición de cada clip unido al guion: la del plano (el primero del reel entra sin transición). */
function withGuideTransitions(project: ReelProject): ReelProject {
  const byClip = new Map((project.guide?.shots ?? []).filter((s) => s.clipId).map((s) => [s.clipId!, s]));
  const clips = project.plan.clips.map((clip, index) => {
    const shot = byClip.get(clip.id);
    if (!shot) return clip;
    const next = { ...clip };
    if (index === 0 || !shot.transition) delete next.transition;
    else next.transition = shot.transition;
    return next;
  });
  return { ...project, plan: { ...project.plan, clips } };
}

/** Planos del guion (con material) que cubre un texto, en orden del reel. */
function coveredClips(project: ReelProject, text: GuideText): number[] {
  const shots = project.guide?.shots ?? [];
  const from = shots.findIndex((s) => s.id === text.fromShot);
  const to = shots.findIndex((s) => s.id === text.toShot);
  if (from < 0 || to < from) return [];
  return shots
    .slice(from, to + 1)
    .map((shot) => project.plan.clips.findIndex((clip) => clip.id === shot.clipId))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
}

/**
 * Coloca los textos del guion sobre el reel de ahora. `add` dice cuáles se
 * pueden crear (los que ya están en el reel solo se mueven: su letra y su estilo
 * no se tocan, por si la persona los cambió; los que borró no vuelven).
 */
function placeGuideTexts(
  project: ReelProject,
  template: ReelTemplateSummary,
  look: BrandLook,
  add: (text: GuideText) => boolean,
): ReelProject {
  const guide = project.guide;
  if (!guide) return project;
  const timeline = planTimeline(project.plan.clips, template);
  const span = (text: GuideText): { start: number; end: number } | null => {
    const clips = coveredClips(project, text);
    if (clips.length === 0) return null;
    const first = clips[0]!;
    const last = clips[clips.length - 1]!;
    const start = round(timeline.starts[first]!);
    const end = round(timeline.starts[last]! + timeline.durations[last]!);
    return end - start >= 0.2 ? { start, end } : null;
  };
  const guideIds = new Set(guide.texts.map((t) => t.id));
  const texts: ReelText[] = [];
  for (const existing of project.plan.texts) {
    if (!guideIds.has(existing.id)) {
      texts.push(existing);
      continue;
    }
    const at = span(guide.texts.find((t) => t.id === existing.id)!);
    // Su plano ya no está: el texto se quita (vuelve si se rellena otra vez el hueco).
    if (at) texts.push({ ...existing, ...at });
  }
  const placed = new Set(texts.map((t) => t.id));
  let outro = project.plan.outro;
  for (const text of guide.texts) {
    if (placed.has(text.id) || !add(text)) continue;
    const at = span(text);
    if (!at) continue;
    const isLast = at.end >= timeline.total - 0.05;
    const role: ReelTextRole = isLast && isCallToAction(text.text) ? 'cta' : SIZE_ROLE[text.size];
    // Con el cierre de la marca, la llamada final es la del cierre: no sale dos veces.
    if (outro && role === 'cta') {
      outro = { ...outro, cta: text.text.trim().slice(0, 60) };
      continue;
    }
    texts.push({
      id: text.id,
      text: text.text.slice(0, REEL_TEXT_MAX_LENGTH),
      ...at,
      position: role === 'cta' && text.position === 'top' ? 'bottom' : text.position,
      style: guideTextStyle(text.size, template, look, role),
      // El papel va al trabajador: tamaño mínimo, líneas y animación por defecto.
      role,
    });
  }
  // Dos textos nunca a la vez en la misma franja.
  const next = { ...project, plan: { ...project.plan, texts: separateTexts(texts), ...(outro ? { outro } : {}) } };
  return endTextsAtOutro(next, template);
}

/** Los textos acaban cuando entra el cierre (si no, el trabajador los recorta y lo avisa). */
function endTextsAtOutro(project: ReelProject, template: ReelTemplateSummary): ReelProject {
  if (!project.plan.outro || project.plan.clips.length === 0) return project;
  const until = outroSpan(project.plan, planTimeline(project.plan.clips, template), template)?.start;
  if (until === undefined) return project;
  const texts = project.plan.texts
    .map((t) => (t.end > until ? { ...t, end: Math.floor(until * 100) / 100 } : t))
    .filter((t) => t.end - t.start >= 0.3);
  return { ...project, plan: { ...project.plan, texts } };
}

export interface DraftOptions {
  /** Análisis del que sale el borrador. */
  referenceId: string;
  templates: ReelTemplateSummary[];
  look?: BrandLook;
}

export interface ReelDraft {
  project: ReelProject;
  template: ReelTemplateSummary;
  /** Planos con material de la biblioteca y planos que faltan por grabar. */
  filled: number;
  gaps: number;
  /** Avisos para la persona. */
  notes: string[];
}

/**
 * El borrador del reel: los planos de la plantilla con el material que encaja
 * (en su orden, con su duración y su transición), los textos en pantalla de los
 * planos que ya existen y el guion con los huecos («falta grabar: …»).
 */
export function buildDraft(result: ReelLikeResult, matches: ShotMatch[], options: DraftOptions): ReelDraft {
  const template = baseTemplate(result, options.templates);
  const notes: string[] = [];
  // Un reel del editor dura como mucho 90 s y tiene como mucho 30 elementos.
  const shots: GuideShot[] = [];
  let total = 0;
  for (const [index, shot] of result.template.shots.entries()) {
    if (shots.length >= REEL_MAX_CLIPS || total + shot.seconds > REEL_MAX_SECONDS + 1e-6) {
      notes.push(
        `El vídeo de referencia es más largo que un reel del editor (${REEL_MAX_SECONDS} s): el borrador se queda con sus ${shots.length} primeros planos.`,
      );
      break;
    }
    total += shot.seconds;
    const script = result.script.shots[index];
    shots.push({
      id: shot.id,
      label: (script?.what || `Plano ${index + 1}`).slice(0, 240),
      ...(script?.tip ? { tip: script.tip.slice(0, 240) } : {}),
      kind: shot.kind,
      media: shot.media,
      seconds: shot.seconds,
      ...(index > 0 ? { transition: toTransition(shot.transition) } : {}),
    });
  }
  const kept = new Set(shots.map((s) => s.id));
  const values = new Map(result.texts.onScreen.map((entry) => [entry.text, entry.value]));
  const texts: GuideText[] = result.template.texts
    .filter((t) => kept.has(t.fromShot) && values.get(t.id))
    .map((t) => ({
      id: `g${t.id}`,
      text: values.get(t.id)!.slice(0, REEL_TEXT_MAX_LENGTH),
      position: t.position,
      size: t.size,
      fromShot: t.fromShot,
      toShot: kept.has(t.toShot) ? t.toShot : shots[shots.length - 1]!.id,
    }));

  const byShot = new Map(matches.map((m) => [m.shot, m.asset]));
  const clips: Clip[] = [];
  for (const shot of shots) {
    const asset = byShot.get(shot.id);
    if (!asset) continue;
    const id = `c${clips.length + 1}`;
    clips.push(clipFor(id, shot, asset, template));
    shot.clipId = id;
  }

  let project: ReelProject = {
    kind: PROJECT_KIND,
    template: { id: template.id },
    plan: { version: REEL_PLAN_VERSION, clips, texts: [] },
    guide: { referenceId: options.referenceId, shots, texts } satisfies ReelGuide,
  };
  project = withGuideTransitions(project);
  project = placeGuideTexts(project, template, options.look ?? {}, () => true);

  // El cierre con la marca, como los reels de una plantilla (`buildBrandReel`): la llamada
  // final del guion (si está en el reel) pasa al cierre; si no, la del perfil.
  const kit = options.look?.kit;
  if (kit) {
    const total = project.plan.clips.length > 0 ? planTimeline(project.plan.clips, template).total : 0;
    const closed = withBrandOutro(project.plan, kit, total);
    if (closed.outro) project = endTextsAtOutro({ ...project, plan: closed }, template);
  }

  // Portada: el fotograma que dice la plantilla, si su plano ya tiene material.
  const coverShot = [...result.template.shots].reverse().find((s) => {
    const start = result.template.shots
      .slice(0, result.template.shots.indexOf(s))
      .reduce((sum, x) => sum + x.seconds, 0);
    return start <= result.template.cover.at + 1e-6;
  });
  const coverClip = project.plan.clips.findIndex(
    (clip) => clip.id === shots.find((s) => s.id === coverShot?.id)?.clipId,
  );
  if (coverClip >= 0) {
    const timeline = planTimeline(project.plan.clips, template);
    project = {
      ...project,
      plan: {
        ...project.plan,
        cover: { type: 'frame', at: round(timeline.starts[coverClip]! + timeline.durations[coverClip]! * 0.6) },
      },
    };
  }

  const filled = clips.length;
  const gaps = shots.length - filled;
  if (filled === 0)
    notes.push(
      'En la biblioteca no hay nada que encaje todavía: el borrador empieza con el guion de lo que hay que grabar.',
    );
  else if (gaps > 0) {
    // Se dice qué planos no tienen material que case con el guion, en vez de poner uno cualquiera.
    const missing = shots.filter((s) => !s.clipId).map((s) => `«${s.label}»`);
    const listed = missing.slice(0, 3).join(', ') + (missing.length > 3 ? ` y ${missing.length - 3} más` : '');
    notes.push(
      missing.length === 1
        ? `En la biblioteca no hay nada que case con el plano ${listed}: queda como hueco para grabarlo o elegirlo a mano.`
        : `En la biblioteca no hay nada que case con ${missing.length} planos (${listed}): quedan como huecos para grabarlos o elegirlos a mano.`,
    );
  }
  return { project, template, filled, gaps, notes };
}

/** Lee el resultado guardado de un análisis y monta su borrador. Null si no se puede leer. */
export function draftFromReference(
  result: unknown,
  assets: LibraryAsset[],
  options: DraftOptions,
): (ReelDraft & { result: ReelLikeResult; matches: ShotMatch[] }) | null {
  const parsed = parseReelLikeResult(result);
  if (!parsed) return null;
  const matches = matchShots(parsed, assets);
  return { ...buildDraft(parsed, matches, options), result: parsed, matches };
}

/**
 * Rellena un hueco del guion con un recurso de la biblioteca: el clip entra en
 * su sitio (detrás del último plano anterior que ya tiene material), con la
 * duración y la transición del plano, y los textos del guion se recolocan (los
 * de ese plano aparecen).
 */
export function fillGuideShot(
  project: ReelProject,
  shotId: string,
  asset: Pick<LibraryAsset, 'kind' | 'storage_path' | 'duration_ms'>,
  template: ReelTemplateSummary,
  look: BrandLook = {},
): ReelProject {
  const guide = project.guide;
  const index = guide?.shots.findIndex((s) => s.id === shotId) ?? -1;
  if (!guide || index < 0 || project.plan.clips.length >= REEL_MAX_CLIPS) return project;
  const shot = guide.shots[index]!;
  if (present(project, shot)) return project;
  if (asset.kind !== 'image' && asset.kind !== 'video') return project;

  const taken = new Set([...project.plan.clips.map((c) => c.id), ...project.plan.texts.map((t) => t.id)]);
  let n = 1;
  while (taken.has(`c${n}`)) n += 1;
  const id = `c${n}`;
  // Detrás del último plano anterior con material; si no hay ninguno, al principio.
  let position = 0;
  for (const earlier of guide.shots.slice(0, index)) {
    const at = project.plan.clips.findIndex((clip) => clip.id === earlier.clipId);
    if (at >= 0) position = Math.max(position, at + 1);
  }
  const wasCovered = new Set(guide.texts.filter((t) => coveredClips(project, t).length > 0).map((t) => t.id));
  const clips = [...project.plan.clips];
  clips.splice(position, 0, clipFor(id, shot, asset, template));
  let next: ReelProject = {
    ...project,
    plan: { ...project.plan, clips },
    guide: { ...guide, shots: guide.shots.map((s) => (s.id === shotId ? { ...s, clipId: id } : s)) },
  };
  next = withGuideTransitions(next);
  // Solo aparecen los textos que este plano trae; los que la persona borró no vuelven.
  return placeGuideTexts(next, template, look, (text) => !wasCovered.has(text.id));
}
