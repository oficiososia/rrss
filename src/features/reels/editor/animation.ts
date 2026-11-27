// Animaciones de entrada y salida de los textos, para la vista previa.
//
// Es la MISMA cuenta que hace el trabajador (worker/src/reel/animation.ts, que
// la traduce a expresiones de FFmpeg): un ejemplo compartido
// (worker/tests/fixtures/text-animation.json) comprueba en las pruebas de los
// dos lados que dan los mismos números. Si cambias una, cambia la otra.
//
//   entrada      qué hace
//   none         aparece de golpe
//   fade         sube la opacidad (la de siempre)
//   rise         sube desde un poco más abajo, con fundido
//   typewriter   sale letra a letra, alineado a la izquierda
//   zoom         crece del 60 % al 100 % con fundido
//   slide        entra deslizándose desde la izquierda, con fundido
//
//   salida       qué hace
//   none         desaparece de golpe
//   fade         baja la opacidad (la de siempre)
//   fall         baja un poco mientras se desvanece
//   slide        se va deslizándose hacia la derecha, con fundido

export const TEXT_IN_ANIMATIONS = ['none', 'fade', 'rise', 'typewriter', 'zoom', 'slide'] as const;
export const TEXT_OUT_ANIMATIONS = ['none', 'fade', 'fall', 'slide'] as const;
export type TextInAnimation = (typeof TEXT_IN_ANIMATIONS)[number];
export type TextOutAnimation = (typeof TEXT_OUT_ANIMATIONS)[number];

export interface TextAnimation {
  in: TextInAnimation;
  out: TextOutAnimation;
  seconds?: number;
}

export const DEFAULT_TEXT_ANIMATION: TextAnimation = { in: 'fade', out: 'fade' };

export const TEXT_IN_LABEL: Record<TextInAnimation, string> = {
  none: 'De golpe',
  fade: 'Aparecer',
  rise: 'Subir',
  typewriter: 'Máquina de escribir',
  zoom: 'Zoom',
  slide: 'Deslizar',
};
export const TEXT_OUT_LABEL: Record<TextOutAnimation, string> = {
  none: 'De golpe',
  fade: 'Desvanecer',
  fall: 'Bajar',
  slide: 'Deslizar',
};

export const RISE_TRAVEL = 0.05;
export const SLIDE_TRAVEL = 0.6;
export const ZOOM_FROM = 0.6;
export const TYPEWRITER_CHARS_PER_SECOND = 20;
export const TYPEWRITER_STEPS_PER_SECOND = 14;
export const TYPEWRITER_MAX_STEPS = 40;
export const MIN_ANIMATION_SECONDS = 0.02;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const easeOut = (p: number) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);

export interface AnimationDurations {
  inSeconds: number;
  outSeconds: number;
  steps: number;
}

export function animationDurations(
  animation: TextAnimation | undefined,
  style: { fadeSeconds: number },
  start: number,
  end: number,
  chars: number,
): AnimationDurations {
  const a = animation ?? DEFAULT_TEXT_ANIMATION;
  const life = Math.max(0, end - start);
  const plain = (a.in === 'none' || a.in === 'fade') && (a.out === 'none' || a.out === 'fade');
  const base = a.seconds ?? (plain ? style.fadeSeconds : Math.max(style.fadeSeconds, 0.4));
  let inSeconds = 0;
  if (a.in === 'typewriter') {
    inSeconds = Math.min(a.seconds ?? clamp(chars / TYPEWRITER_CHARS_PER_SECOND, 0.4, 2.5), life * 0.7);
  } else if (a.in !== 'none') {
    inSeconds = Math.min(base, life / 2);
  }
  let outSeconds = a.out === 'none' ? 0 : Math.min(base, life / 2, Math.max(0, life - inSeconds));
  if (a.in !== 'typewriter' && inSeconds < MIN_ANIMATION_SECONDS) inSeconds = 0;
  if (outSeconds < MIN_ANIMATION_SECONDS) outSeconds = 0;
  const steps =
    a.in === 'typewriter' && inSeconds > 0 && chars > 0
      ? clamp(Math.round(inSeconds * TYPEWRITER_STEPS_PER_SECOND), 1, Math.min(TYPEWRITER_MAX_STEPS, chars))
      : 0;
  return { inSeconds, outSeconds, steps };
}

export interface TextAnimState {
  alpha: number;
  /** Fracción del ancho (positivo = a la derecha). */
  dx: number;
  /** Fracción del alto (positivo = hacia abajo). */
  dy: number;
  scale: number;
  /** Letras visibles contando de seguido todas las líneas. */
  visibleChars: number;
}

export function textAnimState(
  animation: TextAnimation | undefined,
  style: { fadeSeconds: number },
  t: number,
  start: number,
  end: number,
  chars: number,
): TextAnimState {
  const a = animation ?? DEFAULT_TEXT_ANIMATION;
  const { inSeconds, outSeconds, steps } = animationDurations(a, style, start, end, chars);
  const p = inSeconds > 0 ? clamp((t - start) / inSeconds, 0, 1) : 1;
  const q = outSeconds > 0 ? clamp((end - t) / outSeconds, 0, 1) : 1;
  const e = easeOut(p);
  const f = easeOut(q);
  let alpha = 1;
  if (a.in === 'fade' || a.in === 'rise' || a.in === 'zoom' || a.in === 'slide') alpha *= p;
  if (a.out === 'fade' || a.out === 'fall' || a.out === 'slide') alpha *= q;
  let visibleChars = chars;
  if (a.in === 'typewriter' && steps > 0) {
    const step = Math.min(steps, Math.floor(p * steps) + 1);
    visibleChars = Math.round((chars * step) / steps);
  }
  return {
    alpha,
    dx: (a.in === 'slide' ? -(1 - e) * SLIDE_TRAVEL : 0) + (a.out === 'slide' ? (1 - f) * SLIDE_TRAVEL : 0),
    dy: (a.in === 'rise' ? (1 - e) * RISE_TRAVEL : 0) + (a.out === 'fall' ? (1 - f) * RISE_TRAVEL : 0),
    scale: a.in === 'zoom' ? ZOOM_FROM + (1 - ZOOM_FROM) * e : 1,
    visibleChars,
  };
}

/** Letras de cada línea visibles cuando se ven `visible` en total (de seguido, línea a línea). */
export function visiblePerLine(lines: string[], visible: number): number[] {
  let left = visible;
  return lines.map((line) => {
    const shown = clamp(left, 0, line.length);
    left -= line.length;
    return shown;
  });
}
