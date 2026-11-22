// Vídeo de referencia de ejemplo para «Hacer un reel como este», generado con
// FFmpeg (nada de binarios en el repositorio). Cuatro planos verticales con un
// rótulo cada uno, dos cortes secos y un encadenado, y un golpe de sonido cada
// medio segundo (120 pulsaciones por minuto):
//
//   plano 1  0,0 – 2,0 s   carta de ajuste en movimiento   «EL GANCHO» arriba
//   plano 2  2,0 – 3,5 s   barras fijas (parece una foto)   «PASO 1» en el centro
//   plano 3  3,5 – 5,75 s  fractal en movimiento            «PASO 2» abajo
//   plano 4  5,75 – 7,5 s  color liso                       «SIGUENOS» en el centro
//
// Los dos primeros cortes son secos y caen en un golpe; el tercero es un
// encadenado de 0,5 s (de 5,5 a 6,0 s), cuyo centro (5,75 s) no cae en ninguno.
// Lo usan las pruebas del trabajador y la de punta a punta de la raíz
// (tests/db/reel-como-este.test.ts).
import { execFile } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const REFERENCE_REEL = {
  durationSeconds: 7.5,
  width: 540,
  height: 960,
  fps: 30,
  bpm: 120,
  /** Dónde empieza cada plano y cuánto dura. */
  shots: [
    { start: 0, seconds: 2, text: 'EL GANCHO', position: 'top', still: false },
    { start: 2, seconds: 1.5, text: 'PASO 1', position: 'center', still: true },
    { start: 3.5, seconds: 2.25, text: 'PASO 2', position: 'bottom', still: false },
    { start: 5.75, seconds: 1.75, text: 'SIGUENOS', position: 'center', still: true },
  ],
  /** El tercer corte es un encadenado de medio segundo. */
  dissolve: { from: 5.5, seconds: 0.5 },
} as const;

/**
 * Escribe el vídeo de ejemplo en `file`. `fontFile` es la tipografía de los
 * rótulos (sin ella, se genera sin rótulos: los cortes son los mismos).
 */
export async function makeReferenceReel(
  file: string,
  options: { ffmpeg?: string; fontFile?: string } = {},
): Promise<void> {
  const dir = path.dirname(file);
  const size = `${REFERENCE_REEL.width}x${REFERENCE_REEL.height}`;
  const rate = REFERENCE_REEL.fps;
  // La tipografía se copia junto al vídeo: así la ruta del filtro no lleva `:` ni `\`.
  let font = '';
  if (options.fontFile) {
    await copyFile(options.fontFile, path.join(dir, 'rotulo.ttf'));
    font = 'rotulo.ttf';
  }
  const label = (text: string, y: string) =>
    font
      ? `,drawtext=fontfile=${font}:text='${text}':fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=16:x=(w-text_w)/2:y=${y}`
      : '';
  const graph = [
    `[0:v]format=yuv420p${label('EL GANCHO', 'h*0.12')}[a]`,
    `[1:v]format=yuv420p${label('PASO 1', '(h-text_h)/2')}[b]`,
    `[2:v]trim=duration=2.5,setpts=PTS-STARTPTS,format=yuv420p${label('PASO 2', 'h*0.8')}[c]`,
    `[3:v]format=yuv420p${label('SIGUENOS', '(h-text_h)/2')},settb=1/${rate}[d]`,
    `[a][b][c]concat=n=3:v=1:a=0,settb=1/${rate}[abc]`,
    `[abc][d]xfade=transition=fade:duration=${REFERENCE_REEL.dissolve.seconds}:offset=${REFERENCE_REEL.dissolve.from}[v]`,
  ].join(';');
  await exec(
    options.ffmpeg ?? 'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${size}:rate=${rate}:duration=2`,
      '-f',
      'lavfi',
      '-i',
      `smptebars=size=${size}:rate=${rate}:duration=1.5`,
      '-f',
      'lavfi',
      '-i',
      `mandelbrot=size=${size}:rate=${rate}:end_scale=0.3`,
      '-f',
      'lavfi',
      '-i',
      `color=c=0x224466:size=${size}:rate=${rate}:duration=2`,
      '-f',
      'lavfi',
      '-i',
      // Un golpe corto cada medio segundo.
      `aevalsrc='0.8*sin(2*PI*900*t)*exp(-mod(t\\,0.5)*60)':s=44100:d=${REFERENCE_REEL.durationSeconds}`,
      '-filter_complex',
      graph,
      '-map',
      '[v]',
      '-map',
      '4:a',
      '-t',
      String(REFERENCE_REEL.durationSeconds),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      path.basename(file),
    ],
    { cwd: dir },
  );
}
