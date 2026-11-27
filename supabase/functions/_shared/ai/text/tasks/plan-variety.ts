// Que un plan largo no repita títulos ni ideas (prueba en staging del 26/11/2026).
//
// Un plan de varias semanas se pide por TRAMOS a la vez (campaign-plan.ts), y
// cada tramo no ve lo que escriben los demás: salían «Empieza a tu nivel» dos
// veces, o «Tu sitio para empezar» y «Un espacio para empezar». Dos defensas,
// las dos sin llamadas de más:
//
//   1. Antes de pedirlos, cada tramo recibe sus propios ÁNGULOS (de una lista
//      fija y genérica del producto, repartida sin repetir mientras alcance) y
//      la lista de los que llevan los demás, para que no los pise.
//   2. Al juntarlos, se buscan títulos repetidos o casi iguales (normalizados:
//      sin tildes, sin palabras vacías, con sinónimos corrientes y plurales) y se
//      renombran con lo que ya trae la pieza (su titular) o, si no, con una
//      marca corta; las ideas casi iguales se avisan (no se reescriben sin IA).
//
// Todo es puro y determinista: la misma respuesta da siempre el mismo plan.
import type { CampaignPiece } from './campaign-plan.ts';

/**
 * Ángulos de contenido, genéricos para cualquier negocio (nada de un cliente).
 * Son sugerencias: el prompt permite cambiar uno que no encaje por otro libre.
 */
export const PLAN_ANGLES: readonly string[] = [
  'lo que se ofrece, en detalle (el producto o el servicio estrella)',
  'cómo se hace o se prepara (lo que no se ve)',
  'para quién es y qué problema le resuelve',
  'un consejo práctico o una curiosidad del sector',
  'el lugar y el ambiente',
  'la experiencia de un cliente (sin inventar testimonios ni nombres)',
  'una pregunta o una encuesta para la comunidad',
  'una novedad o algo de temporada',
  'un detalle poco conocido (un ingrediente, una herramienta, un paso)',
  'un antes y un después, o una comparación',
  'las personas que lo hacen posible (solo si hay material de ellas)',
  'la invitación directa a actuar (reservar, apuntarse, pedir, venir)',
];

/**
 * Reparte los ángulos entre tramos: por rondas (una pieza de cada tramo cada
 * vez), así que ningún ángulo se repite mientras haya menos piezas que ángulos,
 * y si hay más, la repetición cae lo más lejos posible.
 */
export function assignAngles(counts: readonly number[], angles: readonly string[] = PLAN_ANGLES): string[][] {
  const out = counts.map(() => [] as string[]);
  if (angles.length === 0) return out;
  const rounds = Math.max(0, ...counts);
  let next = 0;
  for (let round = 0; round < rounds; round += 1) {
    counts.forEach((count, i) => {
      if (round >= count) return;
      // El siguiente de la lista que este tramo aún no tenga (al dar la vuelta, no se repite dentro de un tramo).
      let pick = 0;
      while (pick < angles.length - 1 && out[i]!.includes(angles[(next + pick) % angles.length]!)) pick += 1;
      out[i]!.push(angles[(next + pick) % angles.length]!);
      next += pick + 1;
    });
  }
  return out;
}

/** Texto fijo que se añade al prompt de un tramo con sus ángulos y los de los demás. */
export function anglesPrompt(own: readonly string[], others: readonly string[]): string[] {
  if (own.length === 0) return [];
  const rest = [...new Set(others.filter((angle) => !own.includes(angle)))].slice(0, PLAN_ANGLES.length);
  return [
    `Ángulos de este tramo (uno distinto por pieza; si alguno no encaja con la marca, cámbialo por otro que no esté en la lista de los otros tramos): ${own.join('; ')}.`,
    ...(rest.length ? [`Los otros tramos ya tratan: ${rest.join('; ')}. No repitas esos ángulos.`] : []),
    'Los títulos no pueden parecerse entre sí ni a los de otros tramos: no uses dos veces las mismas palabras clave (tampoco con sinónimos).',
  ];
}

// ── Títulos e ideas casi iguales ─────────────────────────────────────────

const STOPWORDS = new Set(
  (
    'a al ante con contra de del desde e el en entre es esta este esto estas estos ese esa eso la las le les lo los ' +
    'mas me mi mis muy nos nuestra nuestras nuestro nuestros o os para pero por que se si sin sobre su sus te ti tu ' +
    'tus un una unas uno unos vuestra vuestro y ya yo hoy como cual aqui alli asi'
  ).split(' '),
);

/** Sinónimos corrientes (genéricos del español): cada palabra → su forma común. */
const SYNONYMS: Record<string, string> = Object.fromEntries(
  (
    [
      ['lugar', 'sitio sitios espacio espacios rincon rincones lugares local'],
      ['empezar', 'empieza empiezas empiezo empezamos empezando empieces comenzar comienza comienzas comienzo arrancar arranca arrancas arranque iniciar inicia inicias inicio'],
      ['nuevo', 'nueva nuevos nuevas novedad novedades estreno'],
      ['descubrir', 'descubre descubres descubrimos conoce conoces conocer conocenos'],
      ['venir', 'ven vente venid visita visitanos visitar'],
      ['reservar', 'reserva reservas reservad'],
      ['oferta', 'ofertas promocion promociones promo descuento descuentos'],
      ['foto', 'fotos imagen imagenes'],
      ['equipo', 'equipos plantilla personas gente'],
      ['consejo', 'consejos truco trucos tip tips'],
      ['favorito', 'favorita favoritos favoritas preferido preferida estrella'],
      ['bienvenida', 'bienvenido bienvenidos bienvenidas'],
    ] as const
  ).flatMap(([canonical, words]) => words.split(' ').map((word) => [word, canonical] as const)),
);

function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('es') && !/[aeiou]es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  if (w.length > 4 && /[ao]$/.test(w)) w = w.slice(0, -1);
  return w;
}

/** Palabras clave de un texto: sin tildes ni signos, sin palabras vacías, con sinónimos y sin plural ni género. */
export function keyWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((word) => word && !STOPWORDS.has(word));
  return new Set(words.map((word) => stem(SYNONYMS[word] ?? word)));
}

const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((word) => b.has(word)).length;

/**
 * ¿Dos títulos son el mismo o casi? Iguales tras normalizar; o, con dos palabras
 * clave o más, uno contenido en el otro o con 3 de cada 5 palabras en común.
 */
export function similarTitles(a: string, b: string): boolean {
  const x = keyWords(a);
  const y = keyWords(b);
  if (x.size === 0 || y.size === 0) return false;
  const common = overlap(x, y);
  if (common === x.size && common === y.size) return true;
  if (Math.min(x.size, y.size) < 2) return false;
  if (common === Math.min(x.size, y.size)) return true;
  return common / (x.size + y.size - common) >= 0.6;
}

/** ¿Dos ideas cuentan lo mismo? Solo con cinco palabras clave o más y 3 de cada 5 en común. */
export function similarIdeas(a: string, b: string): boolean {
  const x = keyWords(a);
  const y = keyWords(b);
  if (x.size < 5 || y.size < 5) return false;
  const common = overlap(x, y);
  return common / (x.size + y.size - common) >= 0.6;
}

export interface PlanRepeat {
  kind: 'title' | 'idea';
  /** Fecha y título (el original) de la pieza que se parecía a otra anterior. */
  date: string;
  title: string;
  /** La pieza anterior a la que se parece. */
  likeDate: string;
  likeTitle: string;
  /** Título nuevo, si se ha renombrado (solo en `title`). */
  renamedTo?: string;
}

const MAX_TITLE = 60;

function clipTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if ([...clean].length <= MAX_TITLE) return clean;
  const cut = [...clean].slice(0, MAX_TITLE - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_TITLE * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

const LEADING = /^(?:(?:un|una|el|la)\s+)?(?:reel|post|foto|fotos|carrusel|v[ií]deo|historia|publicaci[oó]n|short|pin)(?=\s|$)\s*(?:(?:con|de|del|sobre|que|en)\s+)?/i;

/** Un título sacado de la idea: su primera frase, sin el formato delante, en `maxWords` palabras como mucho. */
export function titleFromIdea(idea: string, maxWords = 6): string {
  const first = (idea.split(/[.:;—–(,]|\s-\s/)[0] ?? '').trim().replace(LEADING, '');
  const words = first.split(/\s+/).filter(Boolean).slice(0, maxWords);
  while (words.length > 1 && STOPWORDS.has(words[words.length - 1]!.toLowerCase())) words.pop();
  const text = words.join(' ');
  return text ? clipTitle(text.charAt(0).toUpperCase() + text.slice(1)) : '';
}

const FORMAT_WORDS: Record<string, string> = {
  reel: 'en reel',
  video: 'en vídeo',
  short: 'en short',
  carousel: 'en carrusel',
  story: 'en historia',
  post: 'en foto',
  page_post: 'en foto',
  photo: 'en foto',
  pin: 'en pin',
};

/**
 * Busca títulos e ideas repetidos (o casi) en un plan ya ordenado por fecha. Un
 * título que se parece a otro anterior se renombra sin IA: con el titular de la
 * pieza si es distinto; si no, con el principio de su idea; si no, con su formato
 * si el otro era de otro formato; si no, con un número. Las ideas casi iguales solo se avisan.
 */
export function dedupePieces(pieces: readonly CampaignPiece[]): { pieces: CampaignPiece[]; repeats: PlanRepeat[] } {
  const kept: CampaignPiece[] = [];
  const originals: string[] = [];
  const repeats: PlanRepeat[] = [];
  const titleOf = (piece: CampaignPiece) => piece.title ?? '';
  const clash = (title: string) => kept.find((other) => similarTitles(title, titleOf(other)));

  for (const piece of pieces) {
    const title = titleOf(piece);
    const like = title ? clash(title) : undefined;
    let next = piece;
    if (like) {
      const sameLike = kept.filter((other) => similarTitles(title, titleOf(other)));
      const headline = clipTitle(piece.headline ?? '');
      // Del principio de la idea; si choca, con más palabras (lo que distingue suele venir después).
      const fromIdea = [titleFromIdea(piece.idea), titleFromIdea(piece.idea, 10)].find((t) => t && !clash(t)) ?? '';
      const formatWord = FORMAT_WORDS[piece.format];
      const byFormat =
        formatWord && sameLike.every((other) => other.format !== piece.format) ? clipTitle(`${title} ${formatWord}`) : '';
      const renamed =
        (headline && !clash(headline) ? headline : '') ||
        fromIdea ||
        (byFormat && !kept.some((other) => titleOf(other).toLowerCase() === byFormat.toLowerCase()) ? byFormat : '') ||
        clipTitle(`${title} (${originals.filter((other) => similarTitles(title, other)).length + 1})`);
      next = { ...piece, title: renamed };
      repeats.push({ kind: 'title', date: piece.date, title, likeDate: like.date, likeTitle: titleOf(like), renamedTo: renamed });
    } else {
      const twin = kept.find((other) => similarIdeas(piece.idea, other.idea));
      if (twin) repeats.push({ kind: 'idea', date: piece.date, title, likeDate: twin.date, likeTitle: titleOf(twin) });
    }
    kept.push(next);
    originals.push(title);
  }
  return { pieces: kept, repeats };
}
