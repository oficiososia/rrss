// Composiciones de historia (9:16, 1080 × 1920) del catálogo: la tapa del día,
// las tapas de la semana y el menú del día. Pensadas para que quien las usa
// solo ponga la foto («Poner foto») y, si acaso, cambie el nombre y el precio
// con un toque: lo demás (colores, tipografías y logotipo) sale del kit de la
// marca a través del tema (tema.ts).
//
// Zona segura de las historias (src/features/content/networks.ts): nada que
// haya que leer en los 250 px de arriba (barra de progreso y nombre de la
// cuenta) ni en los 340 px de abajo (campo «Enviar mensaje»), ni en los 65 px
// de cada lado. Las fotos sí pueden llegar al borde: no se «leen».
//
// El logotipo es una capa `logo` con el recurso de la biblioteca de la marca
// (`theme.logo`); sin logotipo en el perfil, la historia sale sin él.
import type { DocumentPageInput, LayerInput } from '../../src/features/content/document/schema.ts';
import { tools, type Look } from './publicaciones.ts';
import type { Theme } from './tema.ts';

export const STORY_W = 1080;
export const STORY_H = 1920;
/** Lo que tapa Instagram, en píxeles del lienzo 1080 × 1920. */
export const STORY_SAFE = { top: 250, bottom: STORY_H - 340, left: 65, right: STORY_W - 65 } as const;
const M = 80;
/** Margen de las cuadrículas de fotos: algo menos que el del texto, pero fuera de la franja lateral. */
const GRID_M = 72;

const page = (id: string, name: string, layers: LayerInput[]): DocumentPageInput => ({ id, name, layers });

/** Logotipo centrado dentro de la zona segura de arriba (si la marca lo tiene). */
function logoLayer(theme: Theme, id: string, y: number, height: number, width = 300): LayerInput[] {
  if (!theme.logo) return [];
  return [
    {
      id: `${id}-logo`,
      name: 'Logotipo',
      type: 'logo',
      assetId: theme.logo,
      x: (STORY_W - width) / 2,
      y,
      width,
      height,
      anchor: { x: 'center', y: 'top' },
    },
  ];
}

/** Precio en una píldora del color de acento: cabe «00,00 €» en una línea. */
function priceSeal(theme: Theme, look: Look, id: string, value: string, x: number, y: number) {
  const t = tools(theme, look, id);
  const [w, h] = [300, 140];
  return [
    t.rect('sello', x, y, w, h, theme.accent, { radius: h / 2, label: 'Sello del precio' }),
    t.text(
      'sello-texto',
      x + 16,
      y + 25,
      w - 32,
      90,
      value,
      t.headline(60, theme.onAccent, { align: 'center', name: 'Precio', italic: false }),
    ),
  ];
}

/** Franja de arriba, lisa y del color oscuro, con el logotipo (solo si la marca lo tiene). Devuelve dónde acaba. */
function logoBar(theme: Theme, look: Look, id: string): { bottom: number; layers: LayerInput[] } {
  if (!theme.logo) return { bottom: 0, layers: [] };
  const t = tools(theme, look, id);
  return {
    bottom: 430,
    layers: [t.rect('cabecera', 0, 0, STORY_W, 430, theme.dark, { label: 'Cabecera' }), ...logoLayer(theme, id, 270, 140)],
  };
}

// ───────────────────────────── Tapa del día ─────────────────────────────

/**
 * Una tapa, grande: arriba el logotipo (si lo hay) en una franja lisa, la foto
 * en el centro y abajo, en una franja oscura, qué es y la llamada final. El
 * precio va en una píldora a caballo entre la foto y la franja.
 */
export function tapaDelDia(
  theme: Theme,
  look: Look,
  words: { kicker: string; name: string; price: string; cta: string },
  id = 'h1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  const panelTop = 1200;
  const bar = logoBar(theme, look, id);
  return page(id, 'Tapa del día', [
    t.rect('fondo', 0, 0, STORY_W, STORY_H, theme.dark, { label: 'Fondo' }),
    t.photo('foto', 0, bar.bottom, STORY_W, panelTop - bar.bottom, 'Foto de la tapa'),
    ...bar.layers,
    t.rect('filete', 0, panelTop - 4, STORY_W, 8, theme.accentOnDark, { label: 'Filete' }),
    ...priceSeal(theme, look, id, words.price, STORY_W - M - 300, panelTop - 75),
    t.text(
      'antetitulo',
      M,
      panelTop + 40,
      580,
      44,
      words.kicker.toLocaleUpperCase('es'),
      t.kicker(theme.accentOnDark, { size: 34, align: 'left', anchorY: 'top' }),
    ),
    t.text(
      'nombre',
      M,
      panelTop + 96,
      STORY_W - 2 * M,
      222,
      t.title(words.name),
      t.headline(66, theme.onDark, { align: 'left', anchorY: 'top', name: 'Nombre de la tapa' }),
    ),
    t.text('llamada', M, panelTop + 324, STORY_W - 2 * M, 50, words.cta, {
      size: 38,
      color: theme.accentOnDark,
      font: theme.headline,
      italic: true,
      align: 'left',
      name: 'Llamada final',
      anchorY: 'top',
    }),
  ]);
}

// ───────────────────────────── Tapas de la semana ─────────────────────────────

/** Cabecera de una historia: logotipo (si hay), antetítulo y titular, todo dentro de la zona segura. */
function header(theme: Theme, look: Look, id: string, words: { kicker: string; title: string }, top = 262) {
  const t = tools(theme, look, id);
  const shift = theme.logo ? 110 : 0;
  return {
    bottom: top + shift + 170,
    layers: [
      ...logoLayer(theme, id, top, 96, 240),
      t.text(
        'antetitulo',
        M,
        top + shift,
        STORY_W - 2 * M,
        44,
        words.kicker.toLocaleUpperCase('es'),
        t.kicker(theme.accentOnDark, { size: 32, align: 'center', anchorY: 'top' }),
      ),
      t.text(
        'titular',
        M,
        top + shift + 52,
        STORY_W - 2 * M,
        100,
        t.title(words.title),
        t.headline(80, theme.onDark, { align: 'center', anchorY: 'top' }),
      ),
    ] as LayerInput[],
  };
}

/**
 * De 2 a 4 tapas, cada una con su foto, su nombre y su precio. Con 4, en una
 * cuadrícula de 2 × 2; con 2 o 3, una debajo de otra con el nombre al lado del precio.
 */
export function tapasDeLaSemana(
  theme: Theme,
  look: Look,
  words: { kicker: string; title: string; items: Array<{ name: string; price: string }> },
  id = 'h1',
): DocumentPageInput {
  const t = tools(theme, look, id);
  const items = words.items.slice(0, 4);
  const head = header(theme, look, id, words);
  const layers: LayerInput[] = [t.rect('fondo', 0, 0, STORY_W, STORY_H, theme.dark, { label: 'Fondo' }), ...head.layers];
  const top = head.bottom + 10;
  const bottom = STORY_SAFE.bottom - 10;
  if (items.length === 4) {
    const gap = 28;
    const cellW = (STORY_W - 2 * GRID_M - gap) / 2;
    const cellH = (bottom - top - gap) / 2;
    const photoH = cellH - 150;
    items.forEach((item, i) => {
      const x = GRID_M + (i % 2) * (cellW + gap);
      const y = top + Math.floor(i / 2) * (cellH + gap);
      const n = i + 1;
      layers.push(
        t.photo(`foto-${n}`, x, y, cellW, photoH, `Foto de la tapa ${n}`),
        t.text(`nombre-${n}`, x, y + photoH + 60, cellW, 84, item.name, {
          size: 36,
          color: theme.onDark,
          font: theme.headline,
          weight: 700,
          align: 'left',
          lineHeight: 1.12,
          name: `Nombre de la tapa ${n}`,
          anchorY: 'top',
        }),
        t.text(`dato-${n}`, x, y + photoH + 12, cellW, 44, item.price, {
          size: 36,
          color: theme.accentOnDark,
          weight: 700,
          align: 'left',
          name: `Precio de la tapa ${n}`,
          anchorY: 'top',
        }),
      );
    });
  } else {
    const gap = 30;
    const cellH = (bottom - top - gap * (items.length - 1)) / items.length;
    const photoH = cellH - 96;
    items.forEach((item, i) => {
      const y = top + i * (cellH + gap);
      const n = i + 1;
      layers.push(
        t.photo(`foto-${n}`, GRID_M, y, STORY_W - 2 * GRID_M, photoH, `Foto de la tapa ${n}`),
        t.text(`nombre-${n}`, M, y + photoH + 16, 700, 60, item.name, {
          size: 42,
          color: theme.onDark,
          font: theme.headline,
          weight: 700,
          align: 'left',
          name: `Nombre de la tapa ${n}`,
          anchorY: 'top',
        }),
        t.text(`dato-${n}`, 800, y + photoH + 16, STORY_W - 800 - M, 60, item.price, {
          size: 42,
          color: theme.accentOnDark,
          weight: 700,
          align: 'right',
          name: `Precio de la tapa ${n}`,
          anchorY: 'top',
        }),
      );
    });
  }
  return page(id, 'Tapas de la semana', layers);
}

// ───────────────────────────── Menú del día ─────────────────────────────

export interface MenuWords {
  kicker: string;
  title: string;
  /** Primeros, segundos y postre: un plato por línea. */
  sections: Array<{ label: string; dishes: string }>;
  price: string;
  included: string;
  when: string;
  cta?: string;
}

/**
 * El menú entero en texto grande, centrado, sobre el fondo oscuro. Detrás hay
 * un marco de foto a sangre con un velo: si se pone una foto, se ve oscurecida
 * detrás del texto; si se deja vacío, no sale (el fondo es el color oscuro).
 */
export function menuDelDia(theme: Theme, look: Look, words: MenuWords, id = 'h1'): DocumentPageInput {
  const t = tools(theme, look, id);
  const head = header(theme, look, id, words);
  const sections = words.sections.slice(0, 3);
  const layers: LayerInput[] = [
    t.rect('fondo', 0, 0, STORY_W, STORY_H, theme.dark, { label: 'Fondo' }),
    t.photo('foto', 0, 0, STORY_W, STORY_H, 'Foto de fondo (opcional)'),
    t.rect('velo', 0, 0, STORY_W, STORY_H, theme.dark, { opacity: 0.78, label: 'Velo' }),
    ...head.layers,
    t.rect('filete', (STORY_W - 120) / 2, head.bottom + 4, 120, 4, theme.accentOnDark, { label: 'Filete' }),
  ];
  // Del filete al precio: las tres secciones, repartidas.
  const start = head.bottom + 36;
  const priceTop = 1250;
  const step = (priceTop - 20 - start) / sections.length;
  sections.forEach((section, i) => {
    const y = start + i * step;
    const n = i + 1;
    layers.push(
      t.text(`seccion-${n}`, M, y, STORY_W - 2 * M, 40, section.label.toLocaleUpperCase('es'), {
        size: 30,
        color: theme.accentOnDark,
        weight: 600,
        name: section.label,
        anchorY: 'top',
      }),
      t.text(`platos-${n}`, M, y + 46, STORY_W - 2 * M, step - 56, section.dishes, {
        size: 40,
        color: theme.onDark,
        lineHeight: 1.28,
        name: `Platos: ${section.label.toLocaleLowerCase('es')}`,
        anchorY: 'top',
      }),
    );
  });
  layers.push(
    t.text(
      'dato',
      M,
      priceTop,
      STORY_W - 2 * M,
      110,
      words.price,
      t.headline(96, theme.accentOnDark, { align: 'center', name: 'Precio', italic: false }),
    ),
    t.text('incluye', M, priceTop + 116, STORY_W - 2 * M, 46, words.included, {
      size: 36,
      color: theme.onDark,
      weight: 600,
      name: 'Qué incluye',
      anchorY: 'top',
    }),
    t.text('cuando', M, priceTop + 168, STORY_W - 2 * M, 44, words.when, {
      size: 32,
      color: theme.onDark,
      italic: true,
      name: 'Cuándo',
      anchorY: 'top',
    }),
  );
  return page(id, 'Menú del día', layers);
}

/**
 * Arriba, sobre el color oscuro, el logotipo (si lo hay) y el titular; en
 * medio, una foto de un plato del menú; abajo, el menú en una franja clara que
 * se lee bien en el móvil, con el precio y qué incluye al final.
 */
export function menuConFoto(theme: Theme, look: Look, words: MenuWords, id = 'h1'): DocumentPageInput {
  const t = tools(theme, look, id);
  const head = header(theme, look, id, words);
  const photoTop = head.bottom + 16;
  const bandTop = 1050;
  const sections = words.sections.slice(0, 3);
  const layers: LayerInput[] = [
    t.rect('fondo', 0, 0, STORY_W, STORY_H, theme.dark, { label: 'Fondo' }),
    ...head.layers,
    t.photo('foto', 0, photoTop, STORY_W, bandTop - photoTop, 'Foto del menú'),
    t.rect('franja', 0, bandTop, STORY_W, STORY_H - bandTop, theme.light, { label: 'Franja' }),
  ];
  const start = bandTop + 40;
  const priceTop = 1440;
  const step = (priceTop - 16 - start) / sections.length;
  sections.forEach((section, i) => {
    const y = start + i * step;
    const n = i + 1;
    layers.push(
      t.text(`seccion-${n}`, M, y + 4, 230, 40, section.label.toLocaleUpperCase('es'), {
        size: 28,
        color: theme.accent,
        weight: 700,
        align: 'left',
        name: section.label,
        anchorY: 'top',
      }),
      t.text(`platos-${n}`, 320, y, STORY_W - 320 - M, step - 12, section.dishes, {
        size: 36,
        color: theme.onLight,
        lineHeight: 1.22,
        align: 'left',
        name: `Platos: ${section.label.toLocaleLowerCase('es')}`,
        anchorY: 'top',
      }),
    );
    if (i > 0)
      layers.push(t.rect(`linea-${n}`, M, y - 10, STORY_W - 2 * M, 2, theme.onLight, { opacity: 0.15, label: 'Línea' }));
  });
  layers.push(
    t.rect('linea-precio', M, priceTop - 8, STORY_W - 2 * M, 3, theme.accent, { label: 'Filete' }),
    t.text(
      'dato',
      M,
      priceTop + 8,
      300,
      80,
      words.price,
      t.headline(64, theme.accent, { align: 'left', anchorY: 'top', name: 'Precio', italic: false }),
    ),
    t.text('incluye', 400, priceTop + 10, STORY_W - 400 - M, 84, `${words.included}\n${words.when}`, {
      size: 30,
      color: theme.onLight,
      weight: 600,
      lineHeight: 1.3,
      align: 'right',
      name: 'Qué incluye y cuándo',
      anchorY: 'top',
    }),
  );
  return page(id, 'Menú del día con foto', layers);
}
