import { describe, expect, it } from 'vitest';
import type { MetricTotal } from '../../../supabase/functions/_shared/analytics/analyst';
import type { MediaSummary } from '../../../supabase/functions/_shared/analytics/analyst';
import {
  changeInWords,
  footnote,
  headlineSentence,
  niceTicks,
  periodText,
  pickHeadlines,
  secondaryFigures,
  topPosts,
} from './summary';

const total = (metricId: string, value: number | null, changePct: number | null, extra: Partial<MetricTotal> = {}) =>
  ({
    metricId,
    label: metricId.split('.').pop()!,
    aggregation: 'daily',
    value,
    previous: changePct === null ? null : 100,
    change: null,
    changePct,
    daysWithData: 7,
    days: 7,
    estimated: false,
    provisional: false,
    ...extra,
  }) as MetricTotal;

describe('frase del periodo', () => {
  it('cuenta el alcance con palabras y la variación', () => {
    const t = [total('instagram.account.reach', 1234, 12)];
    expect(headlineSentence(t, 'last7')).toBe(
      'En los últimos 7 días llegaste a 1234 personas, un 12 % más que en los 7 días anteriores.',
    );
    expect(headlineSentence([total('instagram.account.reach', 900, -5.7)], 'thisMonth')).toBe(
      'Este mes llegaste a 900 personas, un 5,7 % menos que en el mes anterior.',
    );
    expect(headlineSentence([total('instagram.account.reach', 1, 0)], 'lastMonth')).toBe(
      'El mes pasado llegaste a 1 persona, lo mismo que en el mes anterior a ese.',
    );
  });

  it('sin periodo anterior no compara y sin cifras no dice nada', () => {
    expect(headlineSentence([total('instagram.account.reach', 50, null)], 'last28')).toBe(
      'En los últimos 28 días llegaste a 50 personas.',
    );
    expect(headlineSentence([total('instagram.account.reach', null, null)], 'last28')).toBeNull();
    expect(headlineSentence([], 'last28')).toBeNull();
  });

  it('sin alcance usa otra cifra medida', () => {
    expect(
      headlineSentence([total('instagram.account.followers', 1500, 2, { aggregation: 'snapshot' })], 'last28'),
    ).toBe('Tienes 1500 seguidores, un 2 % más que en los 28 días anteriores.');
  });

  it('la variación en palabras', () => {
    expect(changeInWords(null)).toBe('');
    expect(changeInWords(0.04)).toBe('lo mismo');
    expect(changeInWords(-12)).toBe('un 12 % menos');
  });
});

describe('cifras grandes', () => {
  it('salen primero las de siempre, con nombre en llano, y solo las medidas', () => {
    const list = pickHeadlines([
      total('instagram.account.followers', 10, 1, { aggregation: 'snapshot' }),
      total('instagram.account.likes', 5, 1),
      total('instagram.account.reach', 100, 10),
      total('instagram.account.views', null, null),
      total('instagram.account.total_interactions', 20, -3),
    ]);
    expect(list.map((h) => h.plainLabel)).toEqual(['Personas alcanzadas', 'Interacciones', 'Seguidores']);
  });

  it('completa hasta tres con otras medidas, nunca pasa de tres y «Veces que te han visto» no va arriba', () => {
    const only = pickHeadlines([total('instagram.account.likes', 5, 1), total('instagram.account.saves', 3, 1)]);
    expect(only.map((h) => h.metricId)).toEqual(['instagram.account.likes', 'instagram.account.saves']);
    const many = pickHeadlines(
      ['reach', 'views', 'total_interactions', 'followers', 'likes'].map((m) => total(`instagram.account.${m}`, 1, 1)),
    );
    expect(many).toHaveLength(3);
    expect(many.map((h) => h.metricId)).not.toContain('instagram.account.views');
    expect(pickHeadlines([total('instagram.account.views', 26, null)])).toEqual([]);
    expect(secondaryFigures([total('instagram.account.views', 26, null)]).map((h) => h.plainLabel)).toEqual([
      'Veces que te han visto',
    ]);
    expect(secondaryFigures([total('instagram.account.views', null, null)])).toEqual([]);
  });

  it('una sola nota al pie dice lo que hay que saber de las cifras, sin repetirlo en cada una', () => {
    expect(
      footnote([total('a', 1, 10, { estimated: true, provisional: true, daysWithData: 5, days: 7 })], 'last28'),
    ).toBe(
      'Cifras de Meta. Las de los últimos días pueden cambiar. Algunas son estimaciones. Los días sin cifra no cuentan como cero. Los porcentajes comparan con los 28 días anteriores.',
    );
    expect(footnote([total('a', 1, null)], 'last7')).toBe('Cifras de Meta.');
  });
});

describe('las mejores piezas', () => {
  const media = (id: string, metrics: Record<string, number>, day = '2026-11-10'): MediaSummary =>
    ({
      publication_id: id,
      title: id,
      format: 'post',
      network: 'instagram',
      media_product_type: 'FEED',
      published_at: `${day}T10:00:00Z`,
      external_url: null,
      provisional: false,
      metrics,
    }) as MediaSummary;

  it('son las tres con más respuesta, aunque haya pocas', () => {
    const list = [
      media('a', { 'instagram.media.total_interactions': 4 }),
      media('b', { 'instagram.media.total_interactions': 9 }),
      media('c', {}),
      media('d', { 'instagram.media.reach': 7 }),
      media('e', { 'instagram.media.total_interactions': 1 }),
    ];
    expect(topPosts(list).map((p) => p.publication_id)).toEqual(['b', 'd', 'a']);
    expect(topPosts(list.slice(0, 1)).map((p) => p.publication_id)).toEqual(['a']);
    expect(topPosts([media('c', {})])).toEqual([]);
  });
});

describe('eje del gráfico', () => {
  it('marcas en números redondos que cubren el máximo', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(87)).toEqual([0, 50, 100]);
    expect(niceTicks(4200).at(-1)).toBeGreaterThanOrEqual(4200);
    for (const max of [3, 12, 99, 1234, 56789]) {
      const ticks = niceTicks(max);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)!).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeLessThanOrEqual(6);
    }
  });

  it('el periodo se escribe con el último día incluido', () => {
    expect(periodText({ from: '2026-11-01', to: '2026-11-29' })).toBe('01/11/2026 – 28/11/2026');
  });
});
