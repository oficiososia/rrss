// Que un plan largo, pedido por tramos a la vez, no repita títulos ni ideas (staging, 26/11/2026:
// «Empieza a tu nivel» dos veces; «Tu sitio para empezar» y «Un espacio para empezar»). Todo puro.
import { describe, expect, it } from 'vitest';
import { planChunks, type CampaignPiece } from '../../supabase/functions/_shared/ai/text/tasks/campaign-plan.ts';
import {
  anglesPrompt,
  assignAngles,
  dedupePieces,
  keyWords,
  PLAN_ANGLES,
  similarIdeas,
  similarTitles,
  titleFromIdea,
} from '../../supabase/functions/_shared/ai/text/tasks/plan-variety.ts';

const piece = (date: string, title: string, extra: Partial<CampaignPiece> = {}): CampaignPiece => ({
  network: 'instagram',
  format: 'post',
  date,
  idea: title,
  caption: 'Texto.',
  hashtags: [],
  assetIds: [],
  why: '',
  title,
  ...extra,
});

describe('reparto de ángulos entre tramos', () => {
  it('un mes de 4 tramos de 4 piezas: 16 ángulos, sin repetir ninguno mientras alcanza la lista', () => {
    const chunks = planChunks('2026-12-01', '2026-12-28', 16);
    expect(chunks.map((c) => c.maxPieces)).toEqual([4, 4, 4, 4]);
    const angles = assignAngles(chunks.map((c) => c.maxPieces));
    expect(angles.map((a) => a.length)).toEqual([4, 4, 4, 4]);
    // Las 12 primeras (tres rondas) son todas distintas; dentro de un tramo, nunca se repite.
    const firstRounds = angles.flatMap((a) => a.slice(0, 3));
    expect(new Set(firstRounds).size).toBe(12);
    for (const own of angles) expect(new Set(own).size).toBe(own.length);
  });

  it('con menos piezas que ángulos, ningún tramo comparte ángulo con otro', () => {
    const angles = assignAngles([3, 3, 2]);
    const all = angles.flat();
    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
    expect(all.every((angle) => PLAN_ANGLES.includes(angle))).toBe(true);
  });

  it('el prompt de un tramo lleva sus ángulos y los de los demás (sin los suyos)', () => {
    const [own, ...rest] = assignAngles([2, 2, 2]);
    const lines = anglesPrompt(own!, rest.flat());
    expect(lines[0]).toContain(own!.join('; '));
    expect(lines[1]).toContain(rest.flat()[0]!);
    expect(lines[1]).not.toContain(own![0]!);
    expect(lines.join('\n')).toMatch(/Los títulos no pueden parecerse/);
    // Corto: el coste del plan (sobre todo salida) apenas cambia.
    expect(lines.join('\n').length).toBeLessThan(1200);
    expect(anglesPrompt([], ['x'])).toEqual([]);
  });

  it('los ángulos son genéricos: nada de un negocio concreto', () => {
    expect(PLAN_ANGLES.join(' ')).not.toMatch(/restaurante|gimnasio|arroz|menú|coctel/i);
  });
});

describe('títulos e ideas repetidos', () => {
  it('normaliza tildes, palabras vacías, plurales y sinónimos corrientes', () => {
    expect([...keyWords('Tu sitio para empezar')].sort()).toEqual([...keyWords('Un espacio para empezar')].sort());
    expect([...keyWords('Empieza a tu nivel')]).toEqual([...keyWords('¡EMPIEZA a tu nivel!')]);
    expect(keyWords('Los platos nuevos')).toEqual(keyWords('El plato nuevo'));
  });

  it('detecta los casos vistos en staging y los casi iguales, sin confundir títulos distintos', () => {
    expect(similarTitles('Empieza a tu nivel', 'Empieza a tu nivel')).toBe(true);
    expect(similarTitles('Tu sitio para empezar', 'Un espacio para empezar')).toBe(true);
    expect(similarTitles('Comienza a tu nivel', 'Empieza a tu nivel')).toBe(true);
    expect(similarTitles('Plato estrella', 'Nuestro plato estrella de la semana')).toBe(true);
    expect(similarTitles('Empieza a tu nivel', 'Clases para mayores')).toBe(false);
    expect(similarTitles('Reserva tu mesa', 'Reserva para Nochevieja')).toBe(false);
    expect(similarTitles('Ven', 'Ven a vernos')).toBe(false);
    expect(similarTitles('', 'Algo')).toBe(false);
  });

  it('ideas: solo cuentan como iguales si comparten casi todas las palabras clave', () => {
    expect(
      similarIdeas(
        'Reel con las máquinas nuevas de la sala y la gente entrenando por la tarde',
        'Reel de las máquinas nuevas de la sala con gente entrenando por la tarde',
      ),
    ).toBe(true);
    expect(similarIdeas('Reel con las máquinas nuevas de la sala', 'Foto del vestuario recién reformado y limpio')).toBe(false);
    expect(similarIdeas('Corto', 'Corto')).toBe(false);
  });

  it('renombra el repetido con su titular, o su formato, o un número; y avisa de cada caso', () => {
    const { pieces, repeats } = dedupePieces([
      piece('2026-12-01', 'Empieza a tu nivel'),
      piece('2026-12-08', 'Empieza a tu nivel', { headline: 'Clases desde cero' }),
      piece('2026-12-10', 'Tu sitio para empezar'),
      piece('2026-12-15', 'Un espacio para empezar', { format: 'reel' }),
      piece('2026-12-22', 'Empieza a tu nivel'),
    ]);
    expect(pieces.map((p) => p.title)).toEqual([
      'Empieza a tu nivel',
      'Clases desde cero',
      'Tu sitio para empezar',
      'Un espacio para empezar en reel',
      'Empieza a tu nivel (3)',
    ]);
    expect(repeats.map((r) => [r.kind, r.date, r.likeDate, r.renamedTo])).toEqual([
      ['title', '2026-12-08', '2026-12-01', 'Clases desde cero'],
      ['title', '2026-12-15', '2026-12-10', 'Un espacio para empezar en reel'],
      ['title', '2026-12-22', '2026-12-01', 'Empieza a tu nivel (3)'],
    ]);
    // Al final no queda ningún par de títulos idénticos.
    const titles = pieces.map((p) => p.title!.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('saca un título corto de la idea: primera frase, sin el formato delante, sin cortar en «de»', () => {
    expect(titleFromIdea('Reel con las máquinas nuevas de la sala y la gente entrenando.')).toBe('Las máquinas nuevas de la sala');
    expect(titleFromIdea('Carrusel de tres ejercicios para principiantes, paso a paso')).toBe('Tres ejercicios para principiantes');
    expect(titleFromIdea('Postres caseros del fin de semana')).toBe('Postres caseros del fin de semana');
    expect(titleFromIdea('Publicación: horario de Navidad')).toBe('');
    expect(titleFromIdea('')).toBe('');
  });

  it('una idea casi igual a otra se avisa (no se reescribe sin IA); un plan sin repetidos sale igual', () => {
    const idea = 'Reel con las máquinas nuevas de la sala y la gente entrenando por la tarde';
    const input = [
      piece('2026-12-01', 'Sala renovada', { idea }),
      piece('2026-12-09', 'Tarde de entreno', { idea: idea.replace('con las', 'de las') }),
    ];
    const { pieces, repeats } = dedupePieces(input);
    expect(pieces).toEqual(input);
    expect(repeats).toEqual([
      { kind: 'idea', date: '2026-12-09', title: 'Tarde de entreno', likeDate: '2026-12-01', likeTitle: 'Sala renovada' },
    ]);
    const clean = [piece('2026-12-01', 'Uno'), piece('2026-12-02', 'Dos'), piece('2026-12-03', 'Tres')];
    expect(dedupePieces(clean)).toEqual({ pieces: clean, repeats: [] });
  });
});
