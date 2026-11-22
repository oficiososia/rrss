// Cortes y planos de un vídeo de referencia, SIN IA.
//
// FFmpeg (filtro `scdet`) da para cada fotograma cuánto cambia la imagen
// respecto al anterior (`mafd`, diferencia media por píxel) y una puntuación de
// cambio brusco (`score`). Con esa serie:
//   * corte seco: un fotograma con `score` alto (la imagen cambia de golpe);
//   * transición suave (fundido, encadenado, deslizamiento): una racha corta de
//     fotogramas con mucho más cambio que el segundo anterior, sin corte seco
//     dentro. Es una ESTIMACIÓN: un movimiento brusco de cámara puede parecerlo.
// Los planos son los tramos entre cortes. Todo es puro: sin FFmpeg ni disco.

export interface FrameChange {
  /** Segundo del fotograma. */
  t: number;
  /** Diferencia media con el fotograma anterior (escala de FFmpeg, 0 a 100). */
  mafd: number;
  /** Puntuación de cambio brusco de `scdet` (0 a 100). */
  score: number;
}

/** Lee la salida de `scdet,metadata=print:file=-`. */
export function parseScdet(output: string): FrameChange[] {
  const frames: FrameChange[] = [];
  let current: FrameChange | null = null;
  for (const line of output.split(/\r?\n/)) {
    const time = /pts_time:(-?[\d.]+)/.exec(line);
    if (time) {
      current = { t: Number(time[1]), mafd: 0, score: 0 };
      if (Number.isFinite(current.t)) frames.push(current);
      continue;
    }
    if (!current) continue;
    const mafd = /lavfi\.scd\.mafd=([\d.]+)/.exec(line);
    if (mafd) current.mafd = Number(mafd[1]) || 0;
    const score = /lavfi\.scd\.score=([\d.]+)/.exec(line);
    if (score) current.score = Number(score[1]) || 0;
  }
  return frames;
}

export type CutType = 'cut' | 'fade';

export interface Cut {
  /** Segundo en que empieza el plano siguiente (en una transición suave, su centro). */
  at: number;
  type: CutType;
  /** Duración de la transición (0 en un corte seco). */
  seconds: number;
  /** Cuánto cambia la imagen: para quedarse con los más claros si hay demasiados. */
  strength: number;
}

export interface CutOptions {
  /** `score` mínimo de un corte seco (el valor por defecto de `scdet`). */
  hardScore: number;
  /** Una transición suave multiplica al menos por esto el cambio del segundo anterior. */
  softRatio: number;
  /** …y no baja de este cambio por fotograma. */
  softFloor: number;
  /** Duración mínima y máxima de una transición suave. */
  softMinSeconds: number;
  softMaxSeconds: number;
  /** Cambio acumulado mínimo (por encima de lo normal) de una transición suave. */
  softMinExcess: number;
  /** Dos cortes más juntos que esto son el mismo. */
  minShotSeconds: number;
}

export const DEFAULT_CUT_OPTIONS: CutOptions = {
  hardScore: 10,
  softRatio: 1.8,
  softFloor: 1,
  softMinSeconds: 0.15,
  softMaxSeconds: 2,
  softMinExcess: 8,
  minShotSeconds: 0.3,
};

/** Fotogramas del propio plano que hacen falta para saber cuánto se mueve antes de buscar una transición suave. */
const MIN_BASELINE_FRAMES = 4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}

/** Cortes secos y transiciones suaves de la serie de cambios, en orden. */
export function detectCuts(frames: FrameChange[], overrides: Partial<CutOptions> = {}): Cut[] {
  const options = { ...DEFAULT_CUT_OPTIONS, ...overrides };
  const found: Cut[] = [];
  const hard = new Set<number>();
  frames.forEach((frame, index) => {
    if (index > 0 && frame.score >= options.hardScore) {
      hard.add(index);
      found.push({ at: frame.t, type: 'cut', seconds: 0, strength: frame.mafd });
    }
  });

  // Transiciones suaves: rachas de fotogramas con mucho más cambio que el segundo anterior.
  let index = 1;
  while (index < frames.length) {
    if (hard.has(index)) {
      index += 1;
      continue;
    }
    // Lo «normal» justo antes: la mediana del segundo anterior DENTRO del mismo plano (no
    // se cruza un corte seco: el plano anterior puede moverse mucho menos que este).
    const before: number[] = [];
    for (let j = index - 1; j >= 0 && frames[index]!.t - frames[j]!.t <= 1; j -= 1) {
      if (hard.has(j)) break;
      before.push(frames[j]!.mafd);
    }
    if (before.length < MIN_BASELINE_FRAMES) {
      index += 1;
      continue;
    }
    const baseline = median(before);
    const threshold = Math.max(options.softFloor, options.softRatio * baseline);
    if (frames[index]!.mafd < threshold) {
      index += 1;
      continue;
    }
    let end = index;
    let excess = 0;
    let broken = false;
    while (end < frames.length && frames[end]!.mafd >= threshold) {
      if (hard.has(end)) {
        broken = true;
        break;
      }
      excess += frames[end]!.mafd - baseline;
      end += 1;
    }
    const last = end - 1;
    const seconds = frames[last]!.t - frames[index]!.t + (frames[1]!.t - frames[0]!.t);
    if (
      !broken &&
      seconds >= options.softMinSeconds &&
      seconds <= options.softMaxSeconds &&
      excess >= options.softMinExcess
    ) {
      found.push({
        at: Number(((frames[index]!.t + frames[last]!.t) / 2).toFixed(3)),
        type: 'fade',
        seconds: Number(seconds.toFixed(3)),
        strength: excess,
      });
    }
    index = Math.max(end, index + 1);
  }

  // En orden, y si dos caen casi juntos se queda el más claro (el corte seco gana a la racha que lo rodea).
  found.sort((a, b) => a.at - b.at);
  const cuts: Cut[] = [];
  for (const cut of found) {
    const previous = cuts[cuts.length - 1];
    if (previous && cut.at - previous.at < options.minShotSeconds) {
      const better =
        cut.type === 'cut' && previous.type !== 'cut'
          ? cut
          : previous.type === 'cut' && cut.type !== 'cut'
            ? previous
            : cut.strength > previous.strength
              ? cut
              : previous;
      cuts[cuts.length - 1] = better;
    } else {
      cuts.push(cut);
    }
  }
  return cuts.filter((cut) => cut.at >= options.minShotSeconds);
}

export interface Shot {
  index: number;
  start: number;
  end: number;
  seconds: number;
  /** Cambio medio por fotograma dentro del plano: casi 0 = imagen fija (foto); alto = mucho movimiento. */
  motion: number;
  /** ¿Parece una imagen fija (una foto, un rótulo)? */
  still: boolean;
  /** Cómo se entra a este plano desde el anterior (el primero no tiene). */
  transitionIn?: { type: CutType; seconds: number };
}

/** Por debajo de este cambio medio, el plano se considera una imagen fija. */
export const STILL_MOTION = 0.12;

/**
 * Planos entre cortes. Si hay más de `maxShots`, se quedan los cortes más
 * claros y se dice (`truncated`). El último plano que quede en menos de
 * `minShotSeconds` se une al anterior.
 */
export function buildShots(
  cuts: Cut[],
  durationSeconds: number,
  frames: FrameChange[],
  limits: { maxShots: number; minShotSeconds?: number },
): { shots: Shot[]; truncated: boolean } {
  const minShot = limits.minShotSeconds ?? DEFAULT_CUT_OPTIONS.minShotSeconds;
  let kept = cuts.filter((cut) => cut.at > 0 && cut.at <= durationSeconds - minShot);
  const truncated = kept.length > limits.maxShots - 1;
  if (truncated) {
    kept = [...kept]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, Math.max(0, limits.maxShots - 1))
      .sort((a, b) => a.at - b.at);
  }
  const edges = [0, ...kept.map((cut) => cut.at), durationSeconds];
  const shots: Shot[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const start = edges[i]!;
    const end = edges[i + 1]!;
    const cut = i > 0 ? kept[i - 1]! : null;
    // Movimiento: lo que cambia la imagen DENTRO del plano, sin el fotograma del corte ni la transición.
    const margin = cut ? Math.max(cut.seconds / 2, 0.05) : 0.05;
    const next = kept[i];
    const tail = next ? Math.max(next.seconds / 2, 0.05) : 0;
    const inside = frames.filter((f) => f.t > start + margin && f.t < end - tail).map((f) => f.mafd);
    const motion = inside.length > 0 ? inside.reduce((sum, v) => sum + v, 0) / inside.length : 0;
    shots.push({
      index: i,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      seconds: Number((end - start).toFixed(3)),
      motion: Number(motion.toFixed(3)),
      still: motion < STILL_MOTION,
      ...(cut ? { transitionIn: { type: cut.type, seconds: cut.type === 'cut' ? 0 : cut.seconds } } : {}),
    });
  }
  return { shots, truncated };
}

export interface FramePick {
  /** Segundo del fotograma. */
  at: number;
  /** Plano al que pertenece. */
  shot: number;
}

/**
 * Qué fotogramas se guardan para mirarlos después (como mucho `maxFrames`):
 * uno por plano, un poco pasado su centro (los rótulos ya han entrado), y, si
 * sobran, más en los planos largos. Con más planos que fotogramas, se reparten
 * a lo largo del vídeo conservando el primero y el último.
 */
export function pickFrameTimes(shots: Shot[], maxFrames: number): FramePick[] {
  if (shots.length === 0 || maxFrames <= 0) return [];
  const centre = (shot: Shot, fraction = 0.6): FramePick => ({
    at: Number((shot.start + shot.seconds * fraction).toFixed(3)),
    shot: shot.index,
  });
  if (shots.length >= maxFrames) {
    const picks: FramePick[] = [];
    for (let i = 0; i < maxFrames; i += 1) {
      const index = maxFrames === 1 ? 0 : Math.round((i * (shots.length - 1)) / (maxFrames - 1));
      picks.push(centre(shots[index]!));
    }
    return picks;
  }
  const picks = shots.map((shot) => centre(shot));
  // Los que sobran, a los planos más largos (de más de 4 s): al principio y al final.
  const long = shots.filter((shot) => shot.seconds > 4).sort((a, b) => b.seconds - a.seconds);
  for (const fraction of [0.15, 0.9]) {
    for (const shot of long) {
      if (picks.length >= maxFrames) break;
      picks.push(centre(shot, fraction));
    }
  }
  return picks.sort((a, b) => a.at - b.at);
}
