// Animaciones de entrada y salida de los textos del reel.
//
// Un texto puede entrar (`in`) y salir (`out`) de seis y cuatro maneras. Aquí
// está la CUENTA de cada una, en una sola función pura (`textAnimState`): la
// vista previa del navegador (src/features/reels/editor/animation.ts) repite
// exactamente esta cuenta y un ejemplo compartido
// (worker/tests/fixtures/text-animation.json) comprueba que los dos lados dan
// los mismos números. `build.ts` la traduce a expresiones de `drawtext`.
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
//
// Sin `animation` el texto entra y sale con fundido, como antes.

export const TEXT_IN_ANIMATIONS = ['none', 'fade', 'rise', 'typewriter', 'zoom', 'slide'] as const;
export const TEXT_OUT_ANIMATIONS = ['none', 'fade', 'fall', 'slide'] as const;
export type TextInAnimation = (typeof TEXT_IN_ANIMATIONS)[number];
export type TextOutAnimation = (typeof TEXT_OUT_ANIMATIONS)[number];

export interface TextAnimation {
  in: TextInAnimation;
  out: TextOutAnimation;
  /** Duración de cada entrada y salida. Por defecto, según el tipo (ver `animationDurations`). */
  seconds?: number;
}

export const DEFAULT_TEXT_ANIMATION: TextAnimation = { in: 'fade', out: 'fade' };

/** Cuánto sube o baja un texto, como fracción del alto del vídeo. */
export const RISE_TRAVEL = 0.05;
/** Cuánto recorre un texto al deslizarse, como fracción del ancho. */
export const SLIDE_TRAVEL = 0.6;
/** Tamaño con el que empieza el zoom (fracción del tamaño final). */
export const ZOOM_FROM = 0.6;
/** Letras que salen por segundo en la máquina de escribir, si no se fija la duración. */
export const TYPEWRITER_CHARS_PER_SECOND = 20;
/** Pasos por segundo con que se dibuja la máquina de escribir (un `drawtext` por paso y línea). */
export const TYPEWRITER_STEPS_PER_SECOND = 14;
export const TYPEWRITER_MAX_STEPS = 40;
/** Lo que no pasa de este valor no se anima (fundidos más cortos que dos fotogramas). */
export const MIN_ANIMATION_SECONDS = 0.02;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const easeOut = (p: number) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);

export interface AnimationDurations {
  inSeconds: number;
  outSeconds: number;
  /** Pasos de la máquina de escribir (0 si la entrada no lo es). */
  steps: number;
}

/**
 * Cuánto dura la entrada y la salida de un texto que está en pantalla de
 * `start` a `end` y tiene `chars` letras. Las entradas y salidas de fundido
 * usan `style.fadeSeconds` (como siempre); las demás, el valor propio
 * (`animation.seconds`) o, si no hay, al menos 0,4 s. Cada una dura como mucho
 * la mitad del texto (la máquina de escribir, hasta el 70 %).
 */
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
  /** Opacidad de 0 a 1. */
  alpha: number;
  /** Desplazamiento como fracción del ancho (positivo = a la derecha). */
  dx: number;
  /** Desplazamiento como fracción del alto (positivo = hacia abajo). */
  dy: number;
  /** Tamaño respecto al de la letra. */
  scale: number;
  /** Letras visibles contando de seguido todas las líneas (máquina de escribir); `chars` si no aplica. */
  visibleChars: number;
}

/** Cómo se ve un texto de `chars` letras en el segundo `t` del reel. */
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

/** Letras de cada línea visibles cuando se ven `visible` letras en total (de seguido, línea a línea). */
export function visiblePerLine(lines: string[], visible: number): number[] {
  let left = visible;
  return lines.map((line) => {
    const shown = clamp(left, 0, line.length);
    left -= line.length;
    return shown;
  });
}
