// Composiciones de publicación y carrusel del catálogo: funciones que, con el
// tema de una marca (tema.ts) y unos textos de muestra, devuelven las páginas de
// un documento v5 del editor. Todo en 4:5 (1080 × 1350), con 72 px de margen:
// lo importante queda dentro del recorte 3:4 de la cuadrícula del perfil.
//
// Las fotos son MARCOS vacíos (documento v6): una plantilla no puede llevar
// fotos que no sean de la biblioteca de la marca, y el catálogo no tiene
// ninguna. Quien usa la plantilla pulsa el hueco («Poner foto») o suelta su foto
// encima, y la foto rellena el marco. El nombre del marco dice qué foto va ahí.
import type { DocumentPageInput, LayerInput } from '../../src/features/content/document/schema.ts';
import type { Theme } from './tema.ts';

export const W = 1080;
export const H = 1350;
const M = 72;

/** Aire de un sector: cómo se componen los textos (no los colores, que son de la marca). */
export interface Look {
  /** Fondo de los carteles y paneles. */
  surface: 'dark' | 'light';
  align: 'left' | 'center';
  /** Titulares en mayúsculas. */
  upper: boolean;
  italic: boolean;
  /** Peso de los titulares. */
  weight: number;
}

export type TextOptions = {
  size: number;
  color: string;
  font?: string;
  weight?: number;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  lineHeight?: number;
  name?: string;
  background?: { color: string; opacity?: number; padding?: number; radius?: number };
  anchorY?: 'top' | 'center' | 'bottom';
};

/** Herramientas de una página: los identificadores llevan el de la página para no repetirse en el documento. */
export function tools(theme: Theme, look: Look, page: string) {
  const id = (name: string) => `${page}-${name}`;
  const surface = look.surface === 'dark' ? theme.dark : theme.light;
  const onSurface = look.surface === 'dark' ? theme.onDark : theme.onLight;
  const accentOnSurface = look.surface === 'dark' ? theme.accentOnDark : theme.accent;
  const anchorX = look.align === 'center' ? 'center' : 'left';
  return {
    surface,
    onSurface,
    accentOnSurface,
    title: (value: string) => (look.upper ? value.toLocaleUpperCase('es') : value),
    photo: (name: string, x: number, y: number, width: number, height: number, label = 'Foto'): LayerInput => ({
      id: id(name),
      name: label,
      type: 'image',
      source: { kind: 'empty' },
      frame: true,
      fit: 'cover',
      x,
      y,
      width,
      height,
      anchor: { x: 'stretch', y: 'stretch' },
    }),
    rect: (
      name: string,
      x: number,
      y: number,
      width: number,
      height: number,
      fill: string,
      extra: { opacity?: number; label?: string; radius?: number; shape?: 'rectangle' | 'ellipse' } = {},
    ): LayerInput => ({
      id: id(name),
      name: extra.label ?? '',
      type: 'shape',
      shape: extra.shape ?? 'rectangle',
      x,
      y,
      width,
      height,
      fill,
      ...(extra.opacity !== undefined ? { opacity: extra.opacity } : {}),
      ...(extra.radius !== undefined ? { cornerRadius: extra.radius } : {}),
    }),
    text: (
      name: string,
      x: number,
      y: number,
      width: number,
      height: number,
      value: string,
      o: TextOptions,
    ): LayerInput => ({
      id: id(name),
      name: o.name ?? '',
      type: 'text',
      x,
      y,
      width,
      height,
      text: value,
      fontFamily: o.font ?? theme.body,
      fontSize: o.size,
      fontWeight: o.weight ?? 400,
      italic: o.italic ?? false,
      color: o.color,
      align: o.align ?? look.align,
      lineHeight: o.lineHeight ?? 1.2,
      anchor: { x: anchorX, y: o.anchorY ?? 'center' },
      ...(o.background
        ? {
            background: {
              color: o.background.color,
              opacity: o.background.opacity ?? 1,
              padding: o.background.padding ?? 18,
              radius: o.background.radius ?? 8,
            },
          }
        : {}),
    }),
    /** Titular con la tipografía y el peso del sector. */
    headline: (size: number, color: string, extra: Partial<TextOptions> = {}): TextOptions => ({
      size,
      color,
      font: theme.headline,
      weight: look.weight,
      italic: look.italic,
      lineHeight: 1.08,
      name: 'Titular',
      ...extra,
    }),
    /** Antetítulo: pequeño, en mayúsculas, con el acento. */
    kicker: (color: string, extra: Partial<TextOptions> = {}): TextOptions => ({
      size: 28,
      color,
      font: theme.body,
      weight: 600,
      name: 'Antetítulo',
      ...extra,
    }),
  };
}

const page = (id: string, name: string, layers: LayerInput[]): DocumentPageInput => ({ id, name, layers });

// ───────────────────────────── Una página ─────────────────────────────

/** Solo la foto, sin nada encima. */
export function fotoASangre(theme: Theme, look: Look, id = 'p1'): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, 'Foto', [t.photo('foto', 0, 0, W, H)]);
}

/** Foto con una franja abajo: antetítulo y nombre. */
export function fotoConFranja(
  theme: Theme,
  look: Look,
  words: { kicker: string; title: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, 'Foto con nombre', [
    t.photo('foto', 0, 0, W, H),
    t.rect('franja', 0, 1090, W, 260, theme.dark, { label: 'Franja' }),
    t.text(
      'antetitulo',
      M,
      1126,
      W - 2 * M,
      40,
      words.kicker.toLocaleUpperCase('es'),
      t.kicker(theme.accentOnDark, { anchorY: 'bottom' }),
    ),
    t.text(
      'titular',
      M,
      1178,
      W - 2 * M,
      110,
      t.title(words.title),
      t.headline(64, theme.onDark, { anchorY: 'bottom' }),
    ),
  ]);
}

/** Foto con un velo y un titular grande encima. */
export function titularSobreFoto(
  theme: Theme,
  look: Look,
  words: { kicker: string; title: string; sub?: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, 'Titular sobre foto', [
    t.photo('foto', 0, 0, W, H),
    t.rect('velo', 0, 0, W, H, theme.dark, { opacity: 0.5, label: 'Velo' }),
    t.text('antetitulo', M, 430, W - 2 * M, 40, words.kicker.toLocaleUpperCase('es'), t.kicker(theme.accentOnDark)),
    t.text('titular', M, 490, W - 2 * M, 330, t.title(words.title), t.headline(100, theme.onDark)),
    ...(words.sub
      ? [t.text('detalle', M, 840, W - 2 * M, 110, words.sub, { size: 38, color: theme.onDark, name: 'Detalle' })]
      : []),
  ]);
}

/** Cartel de texto sobre un color: una idea, bien grande. `tone` elige el fondo. */
export function cartel(
  theme: Theme,
  look: Look,
  words: { kicker: string; title: string; body?: string; foot?: string },
  tone: 'surface' | 'accent' | 'dark' = 'surface',
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  const background = tone === 'accent' ? theme.accent : tone === 'dark' ? theme.dark : t.surface;
  const ink = tone === 'accent' ? theme.onAccent : tone === 'dark' ? theme.onDark : t.onSurface;
  const mark = tone === 'accent' ? theme.onAccent : tone === 'dark' ? theme.accentOnDark : t.accentOnSurface;
  const lineX = look.align === 'center' ? (W - 120) / 2 : M;
  return page(id, 'Cartel', [
    t.rect('fondo', 0, 0, W, H, background, { label: 'Fondo' }),
    t.text('antetitulo', M, 300, W - 2 * M, 40, words.kicker.toLocaleUpperCase('es'), t.kicker(mark)),
    t.rect('filete', lineX, 362, 120, 6, mark, { label: 'Filete' }),
    t.text('titular', M, 410, W - 2 * M, 380, t.title(words.title), t.headline(104, ink)),
    ...(words.body
      ? [t.text('texto', M, 820, W - 2 * M, 200, words.body, { size: 40, color: ink, lineHeight: 1.35, name: 'Texto' })]
      : []),
    ...(words.foot
      ? [
          t.text('pie', M, 1190, W - 2 * M, 44, words.foot, {
            size: 30,
            color: ink,
            weight: 600,
            name: 'Pie',
            anchorY: 'bottom',
          }),
        ]
      : []),
  ]);
}

/** Foto arriba, panel abajo y un sello con el precio o la fecha. */
export function oferta(
  theme: Theme,
  look: Look,
  words: { kicker: string; title: string; badge: string; terms: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, 'Oferta', [
    t.photo('foto', 0, 0, W, 830),
    t.rect('panel', 0, 830, W, 520, t.surface, { label: 'Panel' }),
    t.rect('sello', 760, 690, 260, 260, theme.accent, { shape: 'ellipse', label: 'Sello' }),
    t.text(
      'sello-texto',
      770,
      772,
      240,
      100,
      words.badge,
      t.headline(72, theme.onAccent, { align: 'center', name: 'Precio o fecha' }),
    ),
    t.text(
      'antetitulo',
      M,
      890,
      660,
      40,
      words.kicker.toLocaleUpperCase('es'),
      t.kicker(t.accentOnSurface, { align: 'left' }),
    ),
    t.text('titular', M, 990, W - 2 * M, 170, t.title(words.title), t.headline(72, t.onSurface, { align: 'left' })),
    t.text('condiciones', M, 1200, W - 2 * M, 90, words.terms, {
      size: 30,
      color: t.onSurface,
      align: 'left',
      lineHeight: 1.3,
      name: 'Condiciones',
      anchorY: 'bottom',
    }),
  ]);
}

/** Lista de filas con dos columnas: carta, menú, horario, precios. */
export function lista(
  theme: Theme,
  look: Look,
  words: { kicker: string; title: string; rows: Array<[string, string]>; foot?: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  const rows = words.rows.slice(0, 6);
  const top = 420;
  const step = Math.min(128, Math.floor(720 / rows.length));
  return page(id, 'Lista', [
    t.rect('fondo', 0, 0, W, H, t.surface, { label: 'Fondo' }),
    t.text(
      'antetitulo',
      M,
      130,
      W - 2 * M,
      40,
      words.kicker.toLocaleUpperCase('es'),
      t.kicker(t.accentOnSurface, { align: 'left', anchorY: 'top' }),
    ),
    t.text(
      'titular',
      M,
      190,
      W - 2 * M,
      170,
      t.title(words.title),
      t.headline(84, t.onSurface, { align: 'left', anchorY: 'top' }),
    ),
    ...rows.flatMap(([left, right], index) => [
      t.text(`fila-${index + 1}`, M, top + index * step, 470, 56, left, {
        size: 40,
        color: t.onSurface,
        align: 'left',
        name: `Fila ${index + 1}`,
      }),
      t.text(`dato-${index + 1}`, 560, top + index * step, W - 560 - M, 56, right, {
        size: 40,
        color: t.accentOnSurface,
        weight: 700,
        align: 'right',
        name: `Dato ${index + 1}`,
      }),
      t.rect(`linea-${index + 1}`, M, top + index * step + 78, W - 2 * M, 2, t.onSurface, {
        opacity: 0.2,
        label: 'Línea',
      }),
    ]),
    ...(words.foot
      ? [
          t.text('pie', M, 1220, W - 2 * M, 44, words.foot, {
            size: 28,
            color: t.onSurface,
            align: 'left',
            name: 'Pie',
            anchorY: 'bottom',
          }),
        ]
      : []),
  ]);
}

/** Dos fotos, una encima de otra, cada una con su etiqueta. */
export function antesYDespues(
  theme: Theme,
  look: Look,
  words: { first: string; second: string; foot?: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  const label = (name: string, y: number, value: string, color: string, ink: string) =>
    t.text(name, M, y, 420, 60, value.toLocaleUpperCase('es'), {
      size: 34,
      color: ink,
      weight: 700,
      align: 'left',
      name: 'Etiqueta',
      background: { color, padding: 20, radius: 6 },
    });
  return page(id, 'Antes y después', [
    t.rect('fondo', 0, 0, W, H, theme.dark, { label: 'Fondo' }),
    t.photo('foto-1', 0, 0, W, 663, 'Foto de antes'),
    t.photo('foto-2', 0, 687, W, 663, 'Foto de después'),
    label('etiqueta-1', 60, words.first, theme.dark, theme.onDark),
    label('etiqueta-2', 747, words.second, theme.accent, theme.onAccent),
    ...(words.foot
      ? [
          t.text('pie', M, 1250, W - 2 * M, 44, words.foot, {
            size: 28,
            color: theme.onDark,
            weight: 600,
            align: 'left',
            name: 'Pie',
            anchorY: 'bottom',
            background: { color: theme.dark, opacity: 0.7, padding: 14, radius: 6 },
          }),
        ]
      : []),
  ]);
}

/** Una frase de alguien, grande, con su nombre. */
export function opinion(
  theme: Theme,
  look: Look,
  words: { quote: string; author: string; detail: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  const lineX = look.align === 'center' ? (W - 120) / 2 : M;
  return page(id, 'Opinión', [
    t.rect('fondo', 0, 0, W, H, t.surface, { label: 'Fondo' }),
    t.text('comillas', M, 120, W - 2 * M, 290, '“', {
      size: 280,
      color: t.accentOnSurface,
      font: theme.headline,
      weight: 700,
      lineHeight: 1,
      name: 'Comillas',
    }),
    t.text('frase', M, 420, W - 2 * M, 430, words.quote, {
      size: 56,
      color: t.onSurface,
      font: theme.headline,
      italic: true,
      lineHeight: 1.3,
      name: 'Frase',
    }),
    t.rect('filete', lineX, 900, 120, 6, t.accentOnSurface, { label: 'Filete' }),
    t.text('autor', M, 940, W - 2 * M, 50, words.author, {
      size: 36,
      color: t.onSurface,
      weight: 700,
      name: 'Quién lo dice',
    }),
    t.text('detalle', M, 1000, W - 2 * M, 44, words.detail, { size: 28, color: t.onSurface, name: 'Detalle' }),
  ]);
}

/** Retrato a sangre con el nombre y el puesto en dos etiquetas. */
export function persona(
  theme: Theme,
  look: Look,
  words: { name: string; role: string; line?: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, 'Persona', [
    t.photo('foto', 0, 0, W, H, 'Retrato'),
    t.text(
      'nombre',
      M,
      1040,
      700,
      76,
      t.title(words.name),
      t.headline(56, theme.onAccent, {
        align: 'left',
        name: 'Nombre',
        anchorY: 'bottom',
        background: { color: theme.accent, padding: 22, radius: 6 },
      }),
    ),
    t.text('puesto', M, 1150, 700, 48, words.role, {
      size: 32,
      color: theme.onDark,
      weight: 600,
      align: 'left',
      name: 'Puesto',
      anchorY: 'bottom',
      background: { color: theme.dark, padding: 16, radius: 6 },
    }),
    ...(words.line
      ? [
          t.text('frase', M, 1228, W - 2 * M, 48, words.line, {
            size: 30,
            color: theme.onDark,
            italic: true,
            align: 'left',
            name: 'Frase',
            anchorY: 'bottom',
            background: { color: theme.dark, opacity: 0.75, padding: 16, radius: 6 },
          }),
        ]
      : []),
  ]);
}

/** Foto arriba y, abajo, el día en grande con lo que pasa. */
export function fecha(
  theme: Theme,
  look: Look,
  words: { day: string; month: string; title: string; detail: string },
  id = 'p1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, 'Fecha', [
    t.rect('fondo', 0, 0, W, H, theme.dark, { label: 'Fondo' }),
    t.photo('foto', 0, 0, W, 700),
    t.text(
      'dia',
      M,
      760,
      330,
      300,
      words.day,
      t.headline(260, theme.accentOnDark, { align: 'left', lineHeight: 1, name: 'Día' }),
    ),
    t.text(
      'mes',
      M,
      1070,
      330,
      50,
      words.month.toLocaleUpperCase('es'),
      t.kicker(theme.onDark, { size: 36, align: 'left', name: 'Mes' }),
    ),
    t.text(
      'titular',
      430,
      790,
      W - 430 - M,
      240,
      t.title(words.title),
      t.headline(68, theme.onDark, { align: 'left' }),
    ),
    t.text('detalle', 430, 1050, W - 430 - M, 130, words.detail, {
      size: 32,
      color: theme.onDark,
      align: 'left',
      lineHeight: 1.3,
      name: 'Detalle',
    }),
  ]);
}

// ───────────────────────────── Carruseles ─────────────────────────────

/** Página de un paso: foto arriba y, abajo, el número, el título y la explicación. */
function paso(
  theme: Theme,
  look: Look,
  id: string,
  number: number,
  words: { title: string; text: string },
): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, `Paso ${number}`, [
    t.photo('foto', 0, 0, W, 800),
    t.rect('panel', 0, 800, W, 550, t.surface, { label: 'Panel' }),
    t.text(
      'numero',
      M,
      850,
      200,
      210,
      String(number),
      t.headline(190, t.accentOnSurface, { align: 'left', lineHeight: 1, name: 'Número' }),
    ),
    t.text('titular', 280, 872, W - 280 - M, 150, t.title(words.title), t.headline(60, t.onSurface, { align: 'left' })),
    t.text('texto', M, 1090, W - 2 * M, 170, words.text, {
      size: 36,
      color: t.onSurface,
      align: 'left',
      lineHeight: 1.35,
      name: 'Texto',
    }),
  ]);
}

/** Página de un motivo: foto con velo, el número enorme y una línea. */
function motivo(
  theme: Theme,
  look: Look,
  id: string,
  number: number,
  words: { title: string; text: string },
): DocumentPageInput {
  const t = tools(theme, look, id);
  return page(id, `Motivo ${number}`, [
    t.photo('foto', 0, 0, W, H),
    t.rect('velo', 0, 0, W, H, theme.dark, { opacity: 0.55, label: 'Velo' }),
    t.text(
      'numero',
      M,
      250,
      W - 2 * M,
      330,
      String(number),
      t.headline(320, theme.accentOnDark, { lineHeight: 1, name: 'Número' }),
    ),
    t.text('titular', M, 620, W - 2 * M, 230, t.title(words.title), t.headline(80, theme.onDark)),
    t.text('texto', M, 880, W - 2 * M, 170, words.text, {
      size: 38,
      color: theme.onDark,
      lineHeight: 1.35,
      name: 'Texto',
    }),
  ]);
}

/** Carrusel «paso a paso»: portada con el resultado, un paso por página y cierre. */
export function carruselPasos(
  theme: Theme,
  look: Look,
  words: {
    cover: { kicker: string; title: string; sub?: string };
    steps: Array<{ title: string; text: string }>;
    end: { kicker: string; title: string; body?: string; foot?: string };
  },
): DocumentPageInput[] {
  return [
    { ...titularSobreFoto(theme, look, words.cover, 'portada'), name: 'Portada' },
    ...words.steps.slice(0, 7).map((step, index) => paso(theme, look, `paso${index + 1}`, index + 1, step)),
    { ...cartel(theme, look, words.end, 'accent', 'cierre'), name: 'Cierre' },
  ];
}

/** Carrusel de lista: portada con la promesa, un motivo por página y cierre. */
export function carruselMotivos(
  theme: Theme,
  look: Look,
  words: {
    cover: { kicker: string; title: string; body?: string; foot?: string };
    items: Array<{ title: string; text: string }>;
    end: { kicker: string; title: string; body?: string; foot?: string };
  },
): DocumentPageInput[] {
  return [
    { ...cartel(theme, look, words.cover, 'dark', 'portada'), name: 'Portada' },
    ...words.items.slice(0, 7).map((item, index) => motivo(theme, look, `motivo${index + 1}`, index + 1, item)),
    { ...cartel(theme, look, words.end, 'accent', 'cierre'), name: 'Cierre' },
  ];
}
