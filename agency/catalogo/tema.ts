// Tema de una marca para el catálogo de plantillas: los colores y las
// tipografías por PAPEL (fondo oscuro, fondo claro, acento, titulares…), no por
// nombre. El catálogo (juegos.ts) solo conoce estos papeles; qué color y qué
// tipografía ocupa cada uno sale del perfil de la marca (`visual.colors` y
// `visual.fonts`), que es configuración. Así no hay nada de ningún cliente en
// el código.
//
// Cómo se reparte, con el orden en que la marca puso sus colores:
//   · acento       el primer color con color de verdad (ni gris ni casi negro o blanco)
//   · oscuro       el primer color muy oscuro que no sea el acento
//   · claro        el primer color muy claro
//   · acento sobre oscuro   el acento si se lee sobre el oscuro; si no, el primer
//                           color vivo que sí se lea
//   · titulares    la primera tipografía; texto, la segunda (o la misma)
// Si el reparto automático no convence, se corrige con un archivo de tema
// (`--tema tema.json`) que fija los papeles que haga falta.
import { z } from 'zod';
import type { BrandProfileData } from '../../src/features/brand/profile.ts';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB');
const family = z.string().trim().min(1).max(120);

export const themeSchema = z
  .object({
    /** Fondo oscuro: franjas, velos y carteles. */
    dark: hex,
    /** Fondo claro: carteles y tarjetas. */
    light: hex,
    /** Acento de la marca: etiquetas, precios, botones. */
    accent: hex,
    /** Acento que se lee sobre el fondo oscuro. */
    accentOnDark: hex,
    /** Texto sobre el fondo oscuro, sobre el claro y sobre el acento. */
    onDark: hex,
    onLight: hex,
    onAccent: hex,
    /** Marcador de foto (lo que se sustituye por la foto de verdad). */
    placeholder: hex,
    /** Familia de los titulares y del texto. */
    headline: family,
    body: family,
  })
  .strict();
export type Theme = z.infer<typeof themeSchema>;
export const themeOverridesSchema = themeSchema.partial();
export type ThemeOverrides = z.infer<typeof themeOverridesSchema>;

/** Tema neutro: para una marca sin colores ni tipografías en su perfil. */
export const NEUTRAL_THEME: Theme = {
  dark: '#1F2328',
  light: '#F7F5F2',
  accent: '#C2562B',
  accentOnDark: '#E8956F',
  onDark: '#FFFFFF',
  onLight: '#1F2328',
  onAccent: '#FFFFFF',
  placeholder: '#5A6068',
  headline: 'Inter',
  body: 'Inter',
};

const channels = (color: string): [number, number, number] => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
];

/** Luminancia relativa (WCAG), de 0 a 1. */
export function luminance(color: string): number {
  const [r, g, b] = channels(color).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste entre dos colores (WCAG), de 1 a 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Saturación (HSL), de 0 a 1. */
export function saturation(color: string): number {
  const [r, g, b] = channels(color).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const light = (max + min) / 2;
  return (max - min) / (light > 0.5 ? 2 - max - min : max + min);
}

/** Mezcla dos colores: `amount` = 0 da `a`; 1 da `b`. */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [channels(a), channels(b)];
  const out = x.map((value, i) => Math.round(value + (y[i]! - value) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const isVivid = (color: string) => {
  const light = luminance(color);
  return saturation(color) >= 0.35 && light > 0.03 && light < 0.8;
};

/** El tema de una marca a partir de su perfil. Lo que el perfil no da sale del tema neutro. */
export function themeFromProfile(
  profile: Pick<BrandProfileData, 'visual'> | null,
  overrides: ThemeOverrides = {},
): Theme {
  const colors = (profile?.visual.colors ?? []).map((c) => c.hex.toUpperCase());
  const fonts = (profile?.visual.fonts ?? []).map((f) => f.family);
  const typography = {
    headline: fonts[0] ?? NEUTRAL_THEME.headline,
    body: fonts[1] ?? fonts[0] ?? NEUTRAL_THEME.body,
  };
  // Sin colores en el perfil no hay nada que repartir: el tema neutro, tal cual.
  if (colors.length === 0) return themeSchema.parse({ ...NEUTRAL_THEME, ...typography, ...overrides });

  const accent = colors.find(isVivid) ?? NEUTRAL_THEME.accent;
  const dark = colors.find((c) => c !== accent && luminance(c) < 0.1) ?? NEUTRAL_THEME.dark;
  const light = colors.find((c) => luminance(c) > 0.8) ?? NEUTRAL_THEME.light;
  const readable = (on: string) => (contrast(light, on) >= contrast(dark, on) ? light : dark);
  const accentOnDark =
    contrast(accent, dark) >= 3 ? accent : (colors.find((c) => isVivid(c) && contrast(c, dark) >= 3) ?? light);

  const theme: Theme = {
    dark,
    light,
    accent,
    accentOnDark,
    onDark: light,
    onLight: dark,
    onAccent: readable(accent),
    placeholder: mix(dark, light, 0.28),
    ...typography,
    ...overrides,
  };
  return themeSchema.parse(theme);
}
