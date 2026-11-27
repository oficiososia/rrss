import { formatMicros } from '@/features/ai/money';
import { PLAN_MAX_COST_MICROS, planOperations, type CopilotPlan } from './plan';

// Coste máximo de un plan del copiloto (plan.ts), dicho en lenguaje llano y con
// la unidad que usa el resto de la interfaz («créditos», o la moneda de cuenta
// si está fijada: features/ai/money.ts). Aparte de plan.ts para que este siga
// sin depender de la configuración de la aplicación (lo usa también el banco).

const operationsOf = planOperations;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface PlanCost {
  /** Coste máximo en micros; `null` si no se ha podido calcular antes de generar. */
  maxMicros: number | null;
  /** «1 fondo con IA ≈ 0,14 créditos · 3 recortes gratis · 2 textos». */
  summary: string;
  /** Lo que cuesta dinero, dicho claro. */
  headline: string;
  /** El plan supera el tope de coste: no se ofrece ejecutar. */
  overLimit: boolean;
}

/**
 * Coste máximo del plan ANTES de gastar. Lo único de pago es el fondo con IA;
 * su precio lo da el servidor (`image.estimate` de `ai-media`): `undefined` =
 * todavía no se sabe, `null` = no se ha podido calcular. Buscar en la
 * biblioteca, quitar el fondo (en el navegador o en el trabajador de medios:
 * no usa cupo de IA) y poner textos no cuestan.
 */
export function planCost(plan: CopilotPlan, photos: number | undefined, backgroundMicros: number | null | undefined): PlanCost {
  const parts: string[] = [];
  const paid = plan.background?.mode === 'ai';
  if (paid) {
    parts.push(
      typeof backgroundMicros === 'number'
        ? `1 fondo con IA ≈ ${formatMicros(backgroundMicros)}`
        : backgroundMicros === undefined
          ? '1 fondo con IA (calculando el coste…)'
          : '1 fondo con IA (el coste se ve al generar)',
    );
  } else if (plan.background?.mode === 'color') {
    parts.push('1 fondo de color gratis');
  }
  if (plan.placement) {
    const count = photos ?? plan.wanted;
    const known = photos !== undefined;
    if (count > 0) {
      const amount = known ? String(count) : `hasta ${count}`;
      parts.push(
        plan.placement.cutout
          ? `${amount} ${count === 1 ? 'recorte' : 'recortes'} gratis`
          : `${amount} ${count === 1 ? 'foto' : 'fotos'} de la biblioteca`,
      );
    }
  }
  const texts = operationsOf(plan).filter((operation) => operation.op === 'add_text').length;
  const others = operationsOf(plan).length - texts;
  if (texts > 0) parts.push(plural(texts, 'texto', 'textos'));
  if (others > 0) parts.push(plural(others, 'cambio más', 'cambios más'));

  const maxMicros = paid ? (typeof backgroundMicros === 'number' ? backgroundMicros : null) : 0;
  const overLimit = maxMicros !== null && maxMicros > PLAN_MAX_COST_MICROS;
  const headline = !paid
    ? 'Coste: nada. Este plan no usa IA de pago.'
    : typeof backgroundMicros === 'number'
      ? `Coste máximo: ${formatMicros(backgroundMicros)} (el fondo con IA; lo demás es gratis).`
      : backgroundMicros === undefined
        ? 'Calculando el coste del fondo con IA…'
        : 'No se ha podido calcular el coste del fondo con IA antes de generarlo: se verá al generar y contará para el cupo de IA.';
  return { maxMicros, summary: parts.join(' · '), headline, overLimit };
}

/**
 * Por qué el plan no se puede ejecutar tal cual (vacío = se puede): demasiados
 * pasos o un coste por encima del tope. Con algún motivo no se ofrece el «sí».
 */
export function planProblems(plan: CopilotPlan, photos: number | undefined, backgroundMicros: number | null | undefined): string[] {
  const cost = planCost(plan, photos, backgroundMicros);
  return [
    ...plan.blockers,
    ...(cost.overLimit
      ? [
          `El fondo con IA cuesta ≈ ${formatMicros(cost.maxMicros ?? 0)} y el tope por plan es ${formatMicros(PLAN_MAX_COST_MICROS)}: no se ejecuta tal cual.`,
        ]
      : []),
  ];
}
