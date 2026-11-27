// El coste de la IA dicho como lo entiende quien la usa. Pura: se prueba aparte.
//
//   · Con una agencia de por medio importa qué parte del cupo del mes se lleva («menos del 1 %»).
//   · En autogestión el cupo no pinta nada en pantalla: se dice lo que cuesta, en llano
//     («unos céntimos»), con el mismo dato (el coste máximo en micros).
import { formatMicros, MICROS_PER_UNIT, MONEY_DISPLAY, type MoneyDisplay } from './money';

/**
 * «≈ 2 % del cupo de este mes» (o «menos del 1 % …»). `null` si no se sabe el cupo o no hay coste.
 * Los dos importes van en micros, la misma unidad.
 */
export function quotaShareText(costMicros: number, limitMicros: number | null | undefined): string | null {
  if (!limitMicros || limitMicros <= 0 || !Number.isFinite(costMicros) || costMicros <= 0) return null;
  const percent = (costMicros / limitMicros) * 100;
  if (percent < 1) return 'menos del 1 % del cupo de este mes';
  return `≈ ${Math.round(percent)} % del cupo de este mes`;
}

/**
 * El coste en llano, sin cupos: «menos de un céntimo», «unos céntimos», «unos 20 céntimos»,
 * «unos 1,50 €». Sin moneda fijada (la plataforma cuenta en créditos) no se inventan céntimos:
 * «unos 0,20 créditos». `null` si no hay coste.
 */
export function plainCostText(costMicros: number, display: MoneyDisplay = MONEY_DISPLAY): string | null {
  if (!Number.isFinite(costMicros) || costMicros <= 0) return null;
  const units = costMicros / MICROS_PER_UNIT;
  // A dos decimales: en una frase, «0,1990» sobra.
  const rounded = formatMicros(Math.round(units * 100) * (MICROS_PER_UNIT / 100), display);
  if (!display.currency)
    return units < 0.01 ? `menos de ${formatMicros(MICROS_PER_UNIT / 100, display)}` : `unos ${rounded}`;
  if (units < 0.01) return 'menos de un céntimo';
  if (units < 0.1) return 'unos céntimos';
  if (units < 1) return `unos ${Math.round(units * 100)} céntimos`;
  return `unos ${rounded}`;
}

/**
 * La frase del coste máximo de una operación de IA, entera y con punto.
 *
 *   · Autogestión (`selfManaged`): «Cuesta unos céntimos.» / «Cuesta como mucho unos 20 céntimos.»
 *     Nunca menciona el cupo.
 *   · Con agencia: «Gasta menos del 1 % del cupo de este mes.» / «Gasta como mucho un 2 % del cupo
 *     de este mes.»; si no se sabe el cupo, el importe («Gasta como mucho 0,05 créditos.»).
 *
 * `null` si no hay coste que decir.
 */
export function costSentence(
  costMicros: number,
  options: { selfManaged: boolean; limitMicros?: number | null; display?: MoneyDisplay },
): string | null {
  if (!Number.isFinite(costMicros) || costMicros <= 0) return null;
  const display = options.display ?? MONEY_DISPLAY;
  if (options.selfManaged) {
    const plain = plainCostText(costMicros, display)!;
    // «menos de…» y «unos céntimos» ya son un tope: «como mucho» sobra.
    return costMicros / MICROS_PER_UNIT < 0.1 ? `Cuesta ${plain}.` : `Cuesta como mucho ${plain}.`;
  }
  const limit = options.limitMicros;
  if (!limit || limit <= 0) return `Gasta como mucho ${formatMicros(costMicros, display)}.`;
  const percent = (costMicros / limit) * 100;
  return percent < 1
    ? 'Gasta menos del 1 % del cupo de este mes.'
    : `Gasta como mucho un ${Math.round(percent)} % del cupo de este mes.`;
}

/**
 * El límite mensual de gasto de IA sigue existiendo en autogestión (protege de un gasto desbocado),
 * pero allí no es el «cupo» de un plan: es un tope de gasto. Estos son sus textos cuando se alcanza
 * o falta; con agencia se usan los de siempre (los del servidor, `ai/api.ts`).
 */
export const SPEND_LIMIT_TEXT = {
  exhaustedTitle: 'Se ha llegado al tope de gasto de IA de este mes',
  exhausted:
    'Se pone a cero el día 1 del mes que viene. Si hace falta antes, quien administra la plataforma puede subirlo.',
  missingTitle: 'La IA no tiene un tope de gasto asignado',
  missing: 'Sin él no se puede usar la IA. Lo pone quien administra la plataforma.',
  near: (percent: number) =>
    `Lleváis gastado el ${percent} % del tope de gasto de IA de este mes. Al llegar al 100 % la IA se para hasta el mes que viene, salvo que se suba el tope.`,
} as const;
