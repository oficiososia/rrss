import { getFormatSpec } from '@/features/content/networks';
import { templateFits, type BrandTemplate } from '@/features/content/templates/api';
import type { BrandReelTemplate } from '@/features/reels/editor/api';

// De qué plantilla del catálogo de la marca saldría cada pieza de un plan,
// cuando encaja. Es una SUGERENCIA para quien prepare la pieza (no se aplica
// sola): las piezas de vídeo (reels, vídeos, shorts) miran las plantillas de
// reel de la marca (`brand_reel_templates`); las demás, las plantillas de
// diseño (`brand_design_templates`) que valen para su red y formato. Entre las
// que valen se elige la que más se parece a la idea de la pieza y, a igualdad,
// la menos usada ya en el plan, para que una campaña no repita la misma. Puro y
// determinista: el mismo plan da siempre las mismas sugerencias.

export interface TemplateHint {
  kind: 'design' | 'reel';
  id: string;
  name: string;
}

interface PieceLike {
  network: string;
  format: string;
  idea: string;
  caption: string;
}

/** Palabras con significado (cuatro letras o más, sin acentos ni mayúsculas). */
export function wordsOf(text: string): Set<string> {
  const plain = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return new Set(plain.match(/[a-z0-9ñ]{4,}/g) ?? []);
}

interface Candidate extends TemplateHint {
  text: string;
}

/** ¿La pieza es solo de vídeo (reel, vídeo de TikTok, short)? */
export function isVideoPiece(network: string, format: string): boolean {
  const media = getFormatSpec(network, format)?.media ?? [];
  return media.length > 0 && media.every((kind) => kind === 'video');
}

export function suggestTemplates(
  pieces: readonly PieceLike[],
  design: readonly BrandTemplate[],
  reel: readonly BrandReelTemplate[],
): (TemplateHint | null)[] {
  const used = new Map<string, number>();
  return pieces.map((piece) => {
    const candidates: Candidate[] = isVideoPiece(piece.network, piece.format)
      ? reel.map((t) => ({
          kind: 'reel',
          id: t.id,
          name: t.name,
          text: `${t.name} ${t.template.purpose} ${t.template.whenToUse}`,
        }))
      : design
          .filter((t) => templateFits(t, piece.network, piece.format))
          .map((t) => ({ kind: 'design', id: t.id, name: t.name, text: `${t.name} ${t.analysis?.summary ?? ''}` }));
    if (candidates.length === 0) return null;
    const wanted = wordsOf(`${piece.idea} ${piece.caption}`);
    const scored = candidates.map((candidate) => {
      let hits = 0;
      for (const word of wordsOf(candidate.text)) if (wanted.has(word)) hits += 1;
      return { candidate, hits, uses: used.get(`${candidate.kind}:${candidate.id}`) ?? 0 };
    });
    scored.sort(
      (a, b) =>
        b.hits - a.hits || a.uses - b.uses || a.candidate.name.localeCompare(b.candidate.name, 'es') || (a.candidate.id < b.candidate.id ? -1 : 1),
    );
    const best = scored[0]!.candidate;
    used.set(`${best.kind}:${best.id}`, (used.get(`${best.kind}:${best.id}`) ?? 0) + 1);
    return { kind: best.kind, id: best.id, name: best.name };
  });
}

/** Texto para la ficha de la pieza. */
export function hintText(hint: TemplateHint): string {
  return hint.kind === 'reel'
    ? `Plantilla de reel de la marca: «${hint.name}»`
    : `Plantilla de diseño de la marca: «${hint.name}»`;
}
