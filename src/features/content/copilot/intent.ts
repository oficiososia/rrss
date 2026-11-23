import type { CopilotOperation } from './operations';

// Lo que el copiloto entiende de la orden SIN IA, para que lo que hace y lo que
// dice cuadren con lo que se ha pedido (prueba real en staging del 23/11/2026,
// fallos 6 y 7; docs/copiloto-voz.md §16):
//
//  - qué parte de la nota de la IA se puede enseñar (`trustedNotes`): nunca lo
//    que dice haber hecho, porque lo hecho lo cuenta el editor a partir de lo
//    que de verdad aplica;
//  - si la orden pide un fondo (`asksForBackground`): sin pedirlo, el fondo con
//    IA no es lo primero, se usan fotos reales;
//  - si pide que la foto llene todo (`wantsFullBleed`);
//  - el titular que se propone cuando se pide «algo para el finde» sin decir
//    cuál (`occasionHeadline`).
//
// Todo es por palabras y en español: no entiende la frase, solo evita los
// errores medidos. Nada es de un cliente concreto.

const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

// ── La nota de la IA ─────────────────────────────────────────────────────

/**
 * Frases en las que la IA dice haber HECHO algo («Añadí el título…», «He puesto
 * la foto…», «La foto ahora llena el lienzo», «Listo»). No se enseñan: lo hecho
 * sale de las operaciones aplicadas.
 */
const CLAIM = new RegExp(
  [
    // «he puesto», «hemos cambiado», «he añadido»… (no «he podido»: «no he podido» es una explicación).
    String.raw`\b(?:he|hemos)\s+(?!podido\b)[a-z]+(?:ado|ido|to|cho|sto|uesto)\b`,
    // Pretérito en primera persona de lo que hace un editor.
    String.raw`\b(?:anadi|puse|coloque|cambie|subi|baje|quite|movi|centre|agrande|amplie|reduje|hice|cree|aplique|borre|duplique|gire|recorte|difumine|desenfoque|ajuste|llene|rellene|meti|deje|escribi|ponga|pondre|anadire|colocare)\b`,
    // «ahora llena…», «ya está», «listo», «hecho».
    String.raw`\bahora\s+(?:la|el|los|las|se|esta|estan|llena|ocupa|tiene|va|queda)\b`,
    String.raw`\b(?:ya\s+esta|listo|hecho|perfecto|aplicado|aplicada)\b`,
  ].join('|'),
);

/** Lo que sí puede decir la nota: lo que no se puede, lo que falta o una pregunta. */
const EXPLAINS = new RegExp(
  [
    String.raw`\?`,
    String.raw`\bno\b`,
    String.raw`\b(?:ningun|ninguna|nada|falta|faltan|dime|dimelo|indica|elige|necesito|cual|cuales|que texto|que foto|prueba|puedes)\b`,
  ].join('|'),
);

/**
 * Las frases de la nota de la IA que se pueden enseñar: las preguntas y las que
 * explican lo que no se ha podido hacer o lo que falta. Las que dicen haber
 * hecho algo se quitan siempre (aunque la misma frase diga también algo que no
 * se pudo): lo hecho lo cuenta el editor con lo que de verdad ha aplicado.
 */
export function trustedNotes(note: string | null | undefined): string[] {
  const text = (note ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  // Frases: hasta el punto, el cierre de pregunta o exclamación, o el punto y coma.
  const sentences = text.match(/[^.!?;]+[.!?;]*/g) ?? [text];
  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence) return false;
      const words = plain(sentence);
      return !CLAIM.test(words) && EXPLAINS.test(words);
    })
    .map((sentence) => sentence.replace(/;$/, '.'));
}

// ── Lo que pide la orden ─────────────────────────────────────────────────

/**
 * ¿Pide la orden un fondo? («crea un fondo otoñal», «con un fondo de mármol»,
 * «un fondo que parezca…»). «Llévalo al fondo» no cuenta: es el orden de las
 * capas. Sin pedirlo, un plan no genera el fondo con IA: usa fotos reales.
 */
export function asksForBackground(transcript: string): boolean {
  const words = plain(transcript).replace(/\b(?:al|del)\s+fondo\b/g, ' ');
  return /\b(?:fondos?|ambiente|escenario)\b/.test(words);
}

/** ¿Pide que la foto llene todo el lienzo, de borde a borde? («que la foto llene todo», «a sangre», «sin márgenes»). */
export function wantsFullBleed(transcript: string): boolean {
  const words = plain(transcript);
  return /\b(?:llen[ea]n?|ocupen?|cubr[ae]n?)\s+(?:todo|toda|el lienzo|la pieza|la pantalla)\b|\ba sangre\b|\bde borde a borde\b|\bpantalla completa\b|\btodo el lienzo\b|\bsin (?:margenes|bordes)\b/.test(
    words,
  );
}

/**
 * «Que la foto llene todo» es llenar EL LIENZO, no su caja: si la IA ha pedido
 * `fit: cover` (llena su caja y deja los márgenes), se cambia por `canvas`.
 */
export function alignWithOrder(operations: readonly CopilotOperation[], transcript: string): CopilotOperation[] {
  if (!wantsFullBleed(transcript)) return [...operations];
  return operations.map((operation) =>
    operation.op === 'transform_image' && operation.fit === 'cover' ? { ...operation, fit: 'canvas' } : operation,
  );
}

/** Ocasiones que se dicen al pedir una pieza, y el titular que les corresponde. El primero que encaje. */
const OCCASIONS: Array<[RegExp, string]> = [
  [/\b(?:este )?(?:finde|fin de semana)\b/, 'Este finde'],
  [/\b(?:la semana que viene|la proxima semana)\b/, 'La semana que viene'],
  [/\besta semana\b/, 'Esta semana'],
  [/\besta noche\b/, 'Esta noche'],
  [/\bhoy\b/, 'Hoy'],
  [/\bmanana\b/, 'Mañana'],
  [/\bnavidad(?:es)?\b/, 'Esta Navidad'],
  [/\bnochevieja\b/, 'Nochevieja'],
  [/\bsan valentin\b/, 'San Valentín'],
  [/\bverano\b/, 'Este verano'],
  [/\bprimavera\b/, 'Esta primavera'],
  [/\botono\b/, 'Este otoño'],
  [/\binvierno\b/, 'Este invierno'],
];

/**
 * El titular que se propone cuando la orden pide una pieza para una ocasión
 * sin decir el texto («hazme algo para el finde» → «Este finde»). Es la propia
 * orden dicha como titular, no un texto inventado; se enseña en el plan antes
 * del «sí» y se cambia como cualquier texto. `null` si no se nombra ninguna.
 */
export function occasionHeadline(transcript: string): string | null {
  const words = plain(transcript);
  return OCCASIONS.find(([pattern]) => pattern.test(words))?.[1] ?? null;
}
