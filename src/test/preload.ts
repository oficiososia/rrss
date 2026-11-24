// Precarga de pantallas que la aplicación carga aparte (`lazy`) y que setup.components.ts no precarga
// para todos los archivos (sería pagarlas en cada uno).
//
// Por qué: la primera vez que un archivo de pruebas abre una de estas pantallas, Vitest tiene que
// transformar y evaluar todo su árbol de módulos. Con la máquina libre son un par de segundos; con la
// máquina cargada (dos tandas a la vez) se ha medido más de 20 s, así que la primera prueba del archivo
// agotaba la espera de `findBy…` sin que nada fallara de verdad. Pagarlo en un `beforeAll`, con su
// propio límite holgado, deja a cada prueba solo lo suyo.

/** Límite del `beforeAll` que precarga: es la transformación de cientos de módulos, legítimamente lenta. */
export const PRELOAD_TIMEOUT_MS = 120_000;

/** El editor de reels (se carga aparte desde el editor de piezas). */
export async function preloadReelEditor(): Promise<void> {
  await import('@/features/reels/editor/ReelEditor');
}
