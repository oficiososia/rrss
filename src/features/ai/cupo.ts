// El coste de la IA dicho como lo entiende quien la usa: qué parte del cupo del mes se lleva, no
// «0,1990 créditos». Pura: se prueba aparte.

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
