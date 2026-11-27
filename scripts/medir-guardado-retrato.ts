// Mide cuánto tarda, a tamaño completo, lo que «Editar foto» hace en el hilo principal al guardar
// con retoques: aplicar los trazos del pincel, ponerle alfa a la foto y el modo retrato.
//
//   npx vite-node scripts/medir-guardado-retrato.ts [megapíxeles=12] [trazos=40]
//
// Herramienta de desarrollo (Node, sin navegador): sirve de orden de magnitud; un móvil tarda
// varias veces más. Ver docs/edicion-fotos.md §13.
import { applyStrokes, withAlpha, type BrushStroke } from '../src/features/photo-edit/portrait/brush';
import { composeCutout } from '../src/features/photo-edit/cutout/composition';
import { portraitBlur } from '../src/features/photo-edit/portrait/blur';

const mp = Number(process.argv[2] ?? 12);
const strokesN = Number(process.argv[3] ?? 40);
const width = Math.round(Math.sqrt((mp * 1e6 * 4) / 3));
const height = Math.round((width * 3) / 4);
const data = new Uint8ClampedArray(width * height * 4);
for (let i = 0; i < width * height; i += 1) data.set([(i * 7) & 255, (i * 3) & 255, (i * 11) & 255, 255], i * 4);
const image = { data, width, height };
const base = new Uint8Array(width * height);
for (let y = height * 0.25; y < height * 0.75; y += 1)
  base.fill(255, Math.floor(y) * width + width * 0.25, Math.floor(y) * width + width * 0.75);
const strokes: BrushStroke[] = Array.from({ length: strokesN }, (_, k) => ({
  mode: k % 2 ? 'remove' : 'add',
  radius: 0.03,
  points: Array.from(
    { length: 30 },
    (_, j) => [0.2 + ((k * 0.013 + j * 0.02) % 0.6), 0.2 + ((k * 0.021 + j * 0.01) % 0.6)] as [number, number],
  ),
}));

const time = <T>(label: string, fn: () => T): T => {
  const t = performance.now();
  const out = fn();
  console.log(`${label.padEnd(44)} ${(performance.now() - t).toFixed(0).padStart(6)} ms`);
  return out;
};
console.log(`${width}×${height} (${((width * height) / 1e6).toFixed(1)} MP), ${strokesN} trazos de 30 puntos`);
const alpha = time('aplicar los trazos a la máscara completa', () => applyStrokes(base, width, height, strokes));
time('withAlpha (foto con la selección retocada)', () => withAlpha(image, alpha));
time('modo retrato completo (desenfoque + pegado)', () =>
  portraitBlur(image, alpha, { amount: 60, progressive: true, dim: 30 }),
);
const subject = withAlpha(image, alpha);
time('fondo de color con sombra (composeCutout)', () =>
  composeCutout(subject, { kind: 'color', hex: '#FFFFFF' }, { shadow: true }),
);
time('fondo de color sin sombra', () => composeCutout(subject, { kind: 'color', hex: '#FFFFFF' }, { shadow: false }));
