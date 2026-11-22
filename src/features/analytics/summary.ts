import {
  formatNumber,
  type MetricTotal,
  type Period,
} from '../../../supabase/functions/_shared/analytics/analyst';

// Lo que se ve de un vistazo en Analítica: las cifras grandes del periodo, la frase
// que las cuenta con palabras y el eje del gráfico. Todo sale de cifras medidas: si
// no hay cifra, no hay frase (nunca se rellena con ceros ni con ejemplos).

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
  { id: 'instagram.account.views', label: 'Veces que te han visto' },
  { id: 'instagram.account.total_interactions', label: 'Interacciones' },
  { id: 'instagram.account.followers', label: 'Seguidores' },
];

export interface Headline extends MetricTotal {
  /** Nombre corto, en llano. */
  plainLabel: string;
}

/** De 3 a 4 cifras con dato: primero las de siempre y, si faltan, otras medidas. */
export function pickHeadlines(totals: readonly MetricTotal[], max = 4): Headline[] {
  const measured = totals.filter((t) => t.value !== null);
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

/** Notas cortas de una cifra (estimación de Meta, últimos días provisionales, días sin cifra). */
export function tileNotes(t: MetricTotal): string[] {
  const notes: string[] = [];
  if (t.estimated) notes.push('Estimación de Meta');
  if (t.provisional) notes.push('Provisional');
  if (t.aggregation === 'daily' && t.daysWithData < t.days) notes.push(`${t.daysWithData} de ${t.days} días`);
  return notes;
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
