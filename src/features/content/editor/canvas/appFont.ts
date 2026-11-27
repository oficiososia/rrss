import latinExtItalic from '@fontsource-variable/inter/files/inter-latin-ext-wght-italic.woff2?url';
import latinExtNormal from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import latinItalic from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url';
import latinNormal from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import baskervilleLatinExt from '@fontsource-variable/libre-baskerville/files/libre-baskerville-latin-ext-wght-normal.woff2?url';
import baskervilleLatin from '@fontsource-variable/libre-baskerville/files/libre-baskerville-latin-wght-normal.woff2?url';

// Letra de pantalla de la aplicación para los diseños: Inter (licencia SIL Open
// Font License 1.1, paquete @fontsource-variable/inter), incluida en la propia
// aplicación. Es la que usan las plantillas cuando la marca no tiene tipografía
// propia (tema neutro del catálogo) y la de reserva de cualquier familia que no
// esté cargada: sin ella, el lienzo y la exportación caían en la letra por
// defecto del navegador (Times). Se registra con FontFace bajo el nombre «Inter».

export const APP_FONT = 'Inter';

/**
 * Libre Baskerville (SIL OFL 1.1, `@fontsource-variable/libre-baskerville`), la letra de las plantillas de
 * menús (`features/menus`). Solo en normal: las plantillas de menús no llevan cursivas.
 */
export const MENU_FONT = 'Libre Baskerville';

/** Las familias genéricas de CSS: ya son una reserva, no se les añade otra. */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

/**
 * La familia de un texto con la letra de la aplicación detrás: si la de la marca no está cargada, se
 * dibuja con Inter y no con Times. Una genérica («serif», «sans-serif»…) se deja tal cual.
 */
export function withAppFont(family: string): string {
  const names = family
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return `${APP_FONT}, sans-serif`;
  const last = names[names.length - 1]!.replace(/^["']|["']$/g, '').toLowerCase();
  if (GENERIC.has(last)) return family;
  const hasApp = names.some((name) => name.replace(/^["']|["']$/g, '') === APP_FONT);
  return [...names, ...(hasApp ? [] : [APP_FONT]), 'sans-serif'].join(', ');
}

let registered: Promise<void> | null = null;

/**
 * Registra Inter (una vez) y espera a que sus archivos estén listos. Nunca falla: si el navegador no
 * tiene FontFace o no puede cargarla, se sigue con la de reserva.
 */
export function loadAppFont(): Promise<void> {
  if (registered) return registered;
  registered = (async () => {
    if (typeof window === 'undefined' || typeof FontFace === 'undefined' || !window.document.fonts) return;
    const faces = [
      new FontFace(APP_FONT, `url(${latinNormal}) format("woff2")`, {
        weight: '100 900',
        style: 'normal',
        unicodeRange: LATIN,
      }),
      new FontFace(APP_FONT, `url(${latinItalic}) format("woff2")`, {
        weight: '100 900',
        style: 'italic',
        unicodeRange: LATIN,
      }),
      new FontFace(APP_FONT, `url(${latinExtNormal}) format("woff2")`, {
        weight: '100 900',
        style: 'normal',
        unicodeRange: LATIN_EXT,
      }),
      new FontFace(APP_FONT, `url(${latinExtItalic}) format("woff2")`, {
        weight: '100 900',
        style: 'italic',
        unicodeRange: LATIN_EXT,
      }),
    ];
    const menuFaces = [
      new FontFace(MENU_FONT, `url(${baskervilleLatin}) format("woff2")`, {
        weight: '400 700',
        style: 'normal',
        unicodeRange: LATIN,
      }),
      new FontFace(MENU_FONT, `url(${baskervilleLatinExt}) format("woff2")`, {
        weight: '400 700',
        style: 'normal',
        unicodeRange: LATIN_EXT,
      }),
    ];
    for (const face of [...faces, ...menuFaces]) window.document.fonts.add(face);
    // Lo básico (latín, normal y cursiva) antes de dibujar; el resto se carga si hace falta.
    await Promise.allSettled([faces[0]!.load(), faces[1]!.load(), menuFaces[0]!.load()]);
  })().catch(() => undefined);
  return registered;
}
