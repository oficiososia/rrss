// Tipografías de los textos de los vídeos. FFmpeg necesita la ruta de un
// archivo de fuente. Por defecto, las que van DENTRO de la imagen del
// trabajador (`worker/fonts/`): Montserrat ExtraBold para titulares y llamadas
// y SemiBold para rótulos y subtítulos, con licencia SIL OFL 1.1
// (`worker/fonts/OFL.txt`). Se puede cambiar con WORKER_FONT_FILE; si no hay
// ninguna, se busca entre las habituales del sistema.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fonts');
export const BUNDLED_DISPLAY_FONT = path.join(FONTS_DIR, 'Montserrat-ExtraBold.ttf');
export const BUNDLED_LABEL_FONT = path.join(FONTS_DIR, 'Montserrat-SemiBold.ttf');

const CANDIDATES = [
  BUNDLED_DISPLAY_FONT,
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', // Alpine (font-dejavu)
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', // Debian y Ubuntu (fonts-dejavu-core)
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf', // Arch
  '/System/Library/Fonts/Supplemental/Arial.ttf', // macOS
  'C:/Windows/Fonts/arial.ttf', // Windows
];

export function findDefaultFont(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.WORKER_FONT_FILE) return env.WORKER_FONT_FILE;
  return CANDIDATES.find((file) => existsSync(file));
}

/** Tipografía de rótulos y subtítulos incluida en el trabajador (si está). */
export function findLabelFont(): string | undefined {
  return existsSync(BUNDLED_LABEL_FONT) ? BUNDLED_LABEL_FONT : undefined;
}
