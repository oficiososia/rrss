// Reparto por formato de `campaign.brief` ante salidas mal formadas pero plausibles de un modelo real:
// se normalizan nombres y números en vez de descartar el reparto entero (sanitizeBrief es puro).
import { describe, expect, it } from 'vitest';
import {
  apportion,
  countsInText,
  formatsAsked,
  mixFromText,
  parsePerWeek,
  resolveFormat,
  resolveNetwork,
  sanitizeBrief,
  whyMatchesMix,
} from '../../supabase/functions/_shared/ai/text/tasks/campaign-brief.ts';

const TARGETS = [
  { network: 'instagram', format: 'post' },
  { network: 'instagram', format: 'carousel' },
  { network: 'instagram', format: 'reel' },
  { network: 'instagram', format: 'story' },
];
const HINT =
  'eh, prepárame la campaña del menú de otoño, que dure hasta navidades más o menos, sobre todo reels y alguna foto de los platos nuevos';

const base = {
  question: '',
  title: 'Menú de otoño',
  objective: 'Dar a conocer el menú.',
  networks: ['instagram'],
  startDate: '2026-11-23',
  endDate: '2026-12-24',
  perWeek: 5,
  mix: [] as unknown[],
  weeks: [],
  why: 'Te propongo 5 semanas.',
};
const run = (patch: Record<string, unknown>, hint = HINT) =>
  sanitizeBrief({ ...base, ...patch } as never, { today: '2026-11-22', targets: TARGETS, hint });
const byFormat = (mix: { format: string; perWeek: number }[]) =>
  Object.fromEntries(mix.map((m) => [m.format, m.perWeek]));

describe('nombres y números que un modelo real escribe a su manera', () => {
  it('resuelve redes y formatos con mayúsculas, plurales, acentos y sinónimos', () => {
    expect(resolveNetwork('Instagram', TARGETS)).toBe('instagram');
    expect(resolveNetwork(' IG ', TARGETS)).toBe('instagram');
    expect(resolveNetwork('tiktok', TARGETS)).toBeNull();
    expect(resolveFormat('instagram', 'Reels', TARGETS)).toBe('reel');
    expect(resolveFormat('instagram', 'vídeo', TARGETS)).toBe('reel');
    expect(resolveFormat('instagram', 'Publicación', TARGETS)).toBe('post');
    expect(resolveFormat('instagram', 'foto', TARGETS)).toBe('post');
    expect(resolveFormat('instagram', 'Carrusel', TARGETS)).toBe('carousel');
    expect(resolveFormat('instagram', 'historias', TARGETS)).toBe('story');
    expect(resolveFormat('instagram', 'podcast', TARGETS)).toBeNull();
    expect(resolveFormat('facebook', 'reel', TARGETS)).toBeNull();
  });

  it('lee el número como número o como texto', () => {
    expect(parsePerWeek(2)).toBe(2);
    expect(parsePerWeek(1.6)).toBe(2);
    expect(parsePerWeek('2')).toBe(2);
    expect(parsePerWeek('2,5')).toBe(3);
    expect(parsePerWeek('2 reels')).toBe(2);
    for (const bad of ['', 'varios', null, undefined, NaN, {}]) expect(parsePerWeek(bad)).toBe(0);
  });

  it('reparte en proporción y nunca deja a nadie a cero ni se pasa del total', () => {
    expect(apportion(5, [2, 1])).toEqual([3, 2]);
    expect(apportion(4, [2, 1, 1])).toEqual([2, 1, 1]);
    expect(apportion(2, [1, 1, 1])).toEqual([1, 1, 1]);
    expect(apportion(3, [])).toEqual([]);
  });
});

describe('el reparto que devuelve el modelo se aprovecha aunque venga mal escrito', () => {
  const cases: Array<[string, unknown[], Record<string, number>]> = [
    ['formatos con mayúsculas y en plural', [{ network: 'instagram', format: 'Reels', perWeek: 3 }, { network: 'instagram', format: 'Posts', perWeek: 2 }], { reel: 3, post: 2 }],
    ['red con mayúscula y formatos en español', [{ network: 'Instagram', format: 'reel', perWeek: 3 }, { network: 'Instagram', format: 'publicación', perWeek: 2 }], { reel: 3, post: 2 }],
    ['perWeek como texto', [{ network: 'instagram', format: 'reel', perWeek: '3' }, { network: 'instagram', format: 'post', perWeek: '2' }], { reel: 3, post: 2 }],
    ['perWeek decimal', [{ network: 'instagram', format: 'reel', perWeek: 2.6 }, { network: 'instagram', format: 'post', perWeek: 2.4 }], { reel: 3, post: 2 }],
    ['red y formato en un solo campo', [{ network: '', format: 'instagram/reel', perWeek: 3 }, { network: '', format: 'Instagram/post', perWeek: 2 }], { reel: 3, post: 2 }],
    ['sin decir la red (solo hay una elegida)', [{ format: 'reel', perWeek: 3 }, { format: 'foto', perWeek: 2 }], { reel: 3, post: 2 }],
    ['el mismo formato repetido se suma', [{ network: 'instagram', format: 'reel', perWeek: 1 }, { network: 'instagram', format: 'Reels', perWeek: 2 }, { network: 'instagram', format: 'post', perWeek: 2 }], { reel: 3, post: 2 }],
  ];
  for (const [name, mix, expected] of cases) {
    it(name, () => {
      const { proposal, notes } = run({ mix });
      expect(byFormat(proposal.mix)).toEqual(expected);
      expect(proposal.perWeek).toBe(5);
      // Solo se avisa de lo que cambia de verdad: normalizar nombres no es un cambio.
      expect(notes).toEqual([]);
    });
  }

  it('si la suma no cuadra con el total dicho, se ajusta en proporción en vez de tirar el reparto', () => {
    const { proposal, notes } = run({
      perWeek: 5,
      mix: [
        { network: 'instagram', format: 'reel', perWeek: 2 },
        { network: 'instagram', format: 'post', perWeek: 1 },
      ],
    });
    expect(byFormat(proposal.mix)).toEqual({ reel: 3, post: 2 });
    expect(proposal.perWeek).toBe(5);
    expect(notes).toEqual(['He ajustado el reparto para que sume 5 a la semana.']);
  });

  it('descarta solo las entradas que no sirven y conserva las demás', () => {
    const { proposal } = run({
      mix: [
        { network: 'instagram', format: 'podcast', perWeek: 3 },
        { network: 'tiktok', format: 'video', perWeek: 3 },
        { network: 'instagram', format: 'reel', perWeek: 0 },
        { network: 'instagram', format: 'reel', perWeek: 3 },
        { network: 'instagram', format: 'story', perWeek: 'muchas' },
      ],
      perWeek: 3,
    });
    expect(byFormat(proposal.mix)).toEqual({ reel: 3 });
  });
});

describe('reparto de respaldo cuando el del modelo no sirve de nada', () => {
  it('el caso real: sin reparto utilizable se rehace con lo que pidió la persona (reels primero, y una foto)', () => {
    for (const mix of [[], undefined, 'texto', [{}], [{ network: 'instagram', format: 'podcast', perWeek: 2 }]]) {
      const { proposal, notes, diagnostic } = run({ mix });
      const split = byFormat(proposal.mix);
      expect(Object.keys(split).sort()).toEqual(['post', 'reel']);
      expect(split.reel).toBeGreaterThan(split.post!);
      expect(proposal.perWeek).toBe(5);
      expect(notes).toEqual(['El reparto de la IA no era utilizable: lo he rehecho con los formatos que pediste.']);
      expect(diagnostic).toBeTruthy();
    }
  });

  it('si la persona no nombró ningún formato, reparte de verdad entre todos los de la red', () => {
    const { proposal, notes } = run({ mix: [] }, 'campaña del menú de otoño');
    expect(Object.keys(byFormat(proposal.mix)).sort()).toEqual(['carousel', 'post', 'reel', 'story']);
    expect(proposal.perWeek).toBe(5);
    expect(notes).toEqual(['El reparto de la IA no era utilizable: lo he repartido a partes iguales entre los formatos.']);
  });

  it('sin total válido usa un ritmo normal y respeta los topes', () => {
    const { proposal } = run({ mix: [], perWeek: 'muchísimas' });
    expect(proposal.perWeek).toBe(3);
    const big = run({ mix: [], perWeek: 99 }, 'solo reels');
    expect(big.proposal.perWeek).toBeLessThanOrEqual(14);
    expect(big.proposal.mix.every((m) => m.perWeek <= 7)).toBe(true);
  });

  it('formatsAsked entiende «sobre todo reels y alguna foto»', () => {
    expect(formatsAsked(HINT, TARGETS, ['instagram'])).toEqual([
      { network: 'instagram', format: 'reel', weight: 2 },
      { network: 'instagram', format: 'post', weight: 1 },
    ]);
    expect(formatsAsked('nada en particular', TARGETS, ['instagram'])).toEqual([]);
  });
});

// Prueba de calidad del 23/11/2026, fallo 15: «dos de ellas reels» con un ritmo de 3 × reel.
describe('el texto de la propuesta cuadra con el ritmo', () => {
  it('lee las cifras del texto, por formato y en total', () => {
    expect(countsInText('Te propongo 5 semanas, dos de ellas reels y 1 carrusel').byGroup.size).toBe(2);
    expect(countsInText('tres publicaciones a la semana').total).toBe(3);
    expect(countsInText('Te propongo 3 semanas porque el menú se anuncia').byGroup.size).toBe(0);
  });

  it('si el texto da otras cifras que el ritmo, se rehace con las del ritmo y conserva el porqué', () => {
    const { proposal } = run({
      perWeek: 3,
      mix: [{ network: 'instagram', format: 'reel', perWeek: 3 }],
      why: 'Te propongo 5 semanas, dos de ellas reels, porque diciembre da para mucho.',
    });
    expect(proposal.why).toMatch(/^Te propongo 5 semanas con 3 reels a la semana\./);
    expect(proposal.why).not.toMatch(/dos de ellas/);
    expect(whyMatchesMix(proposal.why, proposal.mix, proposal.perWeek)).toBe(true);
    // «tres publicaciones» con un ritmo de 4 a la semana.
    const total = run({
      perWeek: 4,
      mix: [{ network: 'instagram', format: 'post', perWeek: 2 }, { network: 'instagram', format: 'reel', perWeek: 2 }],
      why: 'Te propongo una semana con tres publicaciones para captar gente nueva.',
    });
    expect(total.proposal.why).toMatch(/2 publicaciones y 2 reels a la semana/);
  });

  it('un texto coherente se deja tal cual', () => {
    const { proposal } = run({
      perWeek: 3,
      mix: [{ network: 'instagram', format: 'reel', perWeek: 2 }, { network: 'instagram', format: 'post', perWeek: 1 }],
      why: 'Te propongo 5 semanas con dos reels y una publicación a la semana.',
    });
    expect(proposal.why).toBe('Te propongo 5 semanas con dos reels y una publicación a la semana.');
  });

  it('sin reparto utilizable, si el texto lo dice con cifras, se usa el del texto (y cuadran)', () => {
    const { proposal } = run({ mix: [], perWeek: 0, why: 'Te propongo 5 semanas con dos reels y una publicación a la semana.' });
    expect(byFormat(proposal.mix)).toEqual({ reel: 2, post: 1 });
    expect(mixFromText('3 carruseles', TARGETS, ['instagram'])).toEqual([{ network: 'instagram', format: 'carousel', perWeek: 3 }]);
  });
});
