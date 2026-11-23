import {
  formatNumber,
  INTERACTIONS_METRIC,
  MEDIA_REACH_METRIC,
  type MediaSummary,
  type MetricTotal,
  type Period,
  type RankedPost,
} from '../../../supabase/functions/_shared/analytics/analyst';

// Lo que se ve de un vistazo en Resultados: las tres cifras grandes del periodo, la frase
// que las cuenta con palabras, la nota al pie y el eje del gráfico. Todo sale de cifras
// medidas: si no hay cifra, no hay frase (nunca se rellena con ceros ni con ejemplos).

export type RangeKey = 'last7' | 'last28' | 'thisMonth' | 'lastMonth';

export const RANGES: Record<RangeKey, string> = {
  last7: 'Últimos 7 días',
  last28: 'Últimos 28 días',
  thisMonth: 'Este mes',
  lastMonth: 'Mes anterior',
};

/** Cómo se nombra el periodo al principio de una frase. */
export const RANGE_PHRASE: Record<RangeKey, string> = {
  last7: 'En los últimos 7 días',
  last28: 'En los últimos 28 días',
  thisMonth: 'Este mes',
  lastMonth: 'El mes pasado',
};

/** Con qué se compara, dicho con palabras. */
export const RANGE_VERSUS: Record<RangeKey, string> = {
  last7: 'los 7 días anteriores',
  last28: 'los 28 días anteriores',
  thisMonth: 'el mes anterior',
  lastMonth: 'el mes anterior a ese',
};

/** Las cifras grandes, por orden de importancia, con el nombre que se entiende sin saber de redes. */
const HEADLINE: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'instagram.account.reach', label: 'Personas alcanzadas' },
  { id: 'instagram.account.total_interactions', label: 'Interacciones' },
  { id: 'instagram.account.followers', label: 'Seguidores' },
];

/** Cifras que no van arriba (se ven en «Más detalle»), con su nombre en llano. */
export const SECONDARY: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'instagram.account.views', label: 'Veces que te han visto' },
];
const SECONDARY_IDS = new Set(SECONDARY.map((s) => s.id));

export interface Headline extends MetricTotal {
  /** Nombre corto, en llano. */
  plainLabel: string;
}

/** Hasta 3 cifras con dato: primero las de siempre y, si faltan, otras medidas (nunca las de «Más detalle»). */
export function pickHeadlines(totals: readonly MetricTotal[], max = 3): Headline[] {
  const measured = totals.filter((t) => t.value !== null && !SECONDARY_IDS.has(t.metricId));
  const chosen: Headline[] = [];
  for (const { id, label } of HEADLINE) {
    const found = measured.find((t) => t.metricId === id);
    if (found) chosen.push({ ...found, plainLabel: label });
  }
  for (const t of measured) {
    if (chosen.length >= Math.min(3, max)) break;
    if (!chosen.some((c) => c.metricId === t.metricId)) chosen.push({ ...t, plainLabel: t.label });
  }
  return chosen.slice(0, max);
}

const pctText = (n: number) => `${formatNumber(Math.abs(Math.round(n * 10) / 10))} %`;

/** «un 12 % más», «un 5 % menos», «igual que»; vacío si no hay con qué comparar. */
export function changeInWords(changePct: number | null): string {
  if (changePct === null) return '';
  const rounded = Math.round(changePct * 10) / 10;
  if (rounded === 0) return 'lo mismo';
  return `un ${pctText(rounded)} ${rounded > 0 ? 'más' : 'menos'}`;
}

/** Frase de cabecera, p. ej. «En los últimos 7 días llegaste a 1.234 personas, un 12 % más que en los 7 días anteriores.» */
export function headlineSentence(totals: readonly MetricTotal[], range: RangeKey): string | null {
  const reach = totals.find((t) => t.metricId === 'instagram.account.reach' && t.value !== null);
  const phrase = RANGE_PHRASE[range];
  const versus = RANGE_VERSUS[range];
  const compare = (t: MetricTotal) => {
    const words = changeInWords(t.changePct);
    if (!words) return '.';
    return words === 'lo mismo' ? `, lo mismo que en ${versus}.` : `, ${words} que en ${versus}.`;
  };
  if (reach) {
    const n = reach.value!;
    return `${phrase} llegaste a ${formatNumber(n)} ${n === 1 ? 'persona' : 'personas'}${compare(reach)}`;
  }
  const other = pickHeadlines(totals, 1)[0];
  if (!other) return null;
  const n = other.value!;
  if (other.aggregation === 'snapshot') {
    return `Tienes ${formatNumber(n)} ${other.plainLabel.toLowerCase()}${compare(other)}`;
  }
  return `${phrase}: ${formatNumber(n)} ${other.plainLabel.toLowerCase()}${compare(other)}`;
}

/** Las cifras de «Más detalle» que sí tienen dato, con su nombre en llano. */
export function secondaryFigures(totals: readonly MetricTotal[]): Headline[] {
  return SECONDARY.flatMap(({ id, label }) => {
    const found = totals.find((t) => t.metricId === id && t.value !== null);
    return found ? [{ ...found, plainLabel: label }] : [];
  });
}

/**
 * Una sola nota al pie para las cifras de arriba, en vez de repetir en cada una «Provisional»,
 * «Estimación de Meta» o «17 de 28 días». Solo dice lo que de verdad pasa con estas cifras.
 */
export function footnote(headlines: readonly MetricTotal[], range: RangeKey): string {
  const parts = ['Cifras de Meta.'];
  if (headlines.some((t) => t.provisional)) parts.push('Las de los últimos días pueden cambiar.');
  if (headlines.some((t) => t.estimated)) parts.push('Algunas son estimaciones.');
  if (headlines.some((t) => t.aggregation === 'daily' && t.daysWithData < t.days))
    parts.push('Los días sin cifra no cuentan como cero.');
  if (headlines.some((t) => t.changePct !== null)) parts.push(`Los porcentajes comparan con ${RANGE_VERSUS[range]}.`);
  return parts.join(' ');
}

/** Puntuación de una publicación: interacciones si las hay; si no, alcance (igual que el analista). */
function postScore(m: MediaSummary): { score: number; metric: string } | null {
  if (typeof m.metrics[INTERACTIONS_METRIC] === 'number') return { score: m.metrics[INTERACTIONS_METRIC]!, metric: INTERACTIONS_METRIC };
  if (typeof m.metrics[MEDIA_REACH_METRIC] === 'number') return { score: m.metrics[MEDIA_REACH_METRIC]!, metric: MEDIA_REACH_METRIC };
  return null;
}

/** Las `size` publicaciones con más respuesta del periodo (solo las que tienen cifra). */
export function topPosts(media: readonly MediaSummary[], size = 3): RankedPost[] {
  return media
    .flatMap((m) => {
      const s = postScore(m);
      return s ? [{ ...m, score: s.score, scoreMetric: s.metric }] : [];
    })
    .sort((a, b) => b.score - a.score || a.published_at.localeCompare(b.published_at))
    .slice(0, size);
}

/** Marcas «redondas» del eje vertical: 0 y hasta `count` más, en números limpios. */
export function niceTicks(max: number, count = 3): number[] {
  const top = Math.max(1, max);
  const rough = top / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  // Son personas y veces: nunca hay media marca (0,5).
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude);
  const ticks: number[] = [];
  for (let v = 0; v < top + step; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
    if (v >= top) break;
  }
  return ticks;
}

const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
export const dayLabel = shortDay;

/** Texto del periodo para una línea pequeña: «01/11 – 28/11». */
export function periodText(p: Period): string {
  const last = new Date(Date.parse(`${p.to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${p.from.split('-').reverse().join('/')} – ${last.split('-').reverse().join('/')}`;
}
