import { defineConfig } from 'vitest/config';

// Las pruebas lanzan FFmpeg de verdad: van en serie para no saturar la máquina.
//
// Límite de 5 minutos por prueba y por preparación: muchas pruebas montan varios vídeos seguidos
// con FFmpeg real (hasta nueve en una). Con la máquina libre tardan 10–40 s, pero con la máquina
// cargada (otras tandas de pruebas a la vez) se han medido más de 120 s, que era el límite, sin
// que nada fallara. Es lento por lo que hace (codificar vídeo), no por una espera mal puesta.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
