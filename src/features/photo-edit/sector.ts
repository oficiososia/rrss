// Qué tipo de negocio es la marca, para que «Fondo con IA» no suponga siempre un restaurante:
// las ideas de fondo y lo que se le dice a la IA que no toque salen de aquí.
// El sector es un texto libre de la marca («Restauración», «Coctelería», «Gimnasio»…); sin sector
// reconocible se usa lo genérico, nunca la comida por defecto.

export type SectorKind = 'restaurant' | 'cocktail' | 'gym' | 'generic';

/** Lo que se le dice a la IA que no cambie: comida, bebida u otra cosa (producto, persona, equipo). */
export type AiSubject = 'food' | 'drink' | 'other';

const RULES: Array<[SectorKind, RegExp]> = [
  ['cocktail', /cocteler|c[oó]ctel|cocktail|bar de copas|\bpub\b|discoteca|vinoteca|cervecer|brewery/i],
  [
    'restaurant',
    /restaur|gastro|hosteler|cafeter|\bcaf[eé]\b|bistr|taberna|tapas|asador|pizzer|panader|pasteler|helader|comida|marisquer|\bbar\b|food/i,
  ],
  ['gym', /gimnas|\bgym\b|fitness|crossfit|yoga|pilates|entrenad|deport|musculaci|wellness|spinning/i],
];

/** Tipo de negocio a partir del sector de la marca (y, si el sector no dice nada, de su descripción). */
export function sectorKindOf(sector: string | null | undefined, description?: string | null): SectorKind {
  for (const text of [sector ?? '', description ?? '']) {
    const clean = text.trim();
    if (!clean) continue;
    for (const [kind, pattern] of RULES) if (pattern.test(clean)) return kind;
  }
  return 'generic';
}

const SUGGESTIONS: Record<SectorKind, readonly string[]> = {
  restaurant: [
    'mesa de mármol blanco con luz cálida',
    'mantel de lino beige',
    'mesa de madera rústica',
    'pizarra oscura',
  ],
  cocktail: [
    'barra de madera oscura con luces cálidas desenfocadas',
    'encimera de mármol negro con reflejos suaves',
    'terraza al atardecer con luces de guirnalda',
    'fondo de neón suave en tonos rosas y azules',
  ],
  gym: [
    'sala de entrenamiento luminosa con mancuernas desenfocadas',
    'suelo de madera clara y pared blanca',
    'fondo oscuro con luz lateral y mucho contraste',
    'exterior al amanecer con cielo despejado',
  ],
  generic: [
    'fondo blanco limpio con luz suave',
    'pared de color neutro con sombra suave',
    'mesa de madera clara',
    'fondo degradado en tonos cálidos',
  ],
};

/** Ideas de fondo a un clic para este tipo de negocio (el texto sigue siendo libre). */
export function backgroundSuggestionsFor(kind: SectorKind): readonly string[] {
  return SUGGESTIONS[kind];
}

/** Qué hay que proteger en la foto según el negocio (se manda a la IA). */
export function aiSubjectFor(kind: SectorKind): AiSubject {
  return kind === 'restaurant' ? 'food' : kind === 'cocktail' ? 'drink' : 'other';
}

/** ¿Los textos de ayuda pueden hablar de platos? Solo en restauración (y bebidas, en coctelería). */
export function mentionsFood(kind: SectorKind): boolean {
  return kind === 'restaurant';
}
