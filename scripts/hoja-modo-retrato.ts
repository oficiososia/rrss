// Hoja de ejemplo del modo retrato: original | suave | fuerte, una fila por foto.
// Usa el mismo desenfoque que la aplicación (src/features/photo-edit/portrait/blur.ts)
// y máscaras ya calculadas (PNG en gris, una por foto, del mismo nombre).
//
//   npx tsx scripts/hoja-modo-retrato.ts <carpeta-fotos> <carpeta-máscaras> <salida.jpg> foto1 foto2 …
//
// (los nombres, sin extensión). Herramienta de desarrollo: no entra en la aplicación.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { portraitBlur } from '../src/features/photo-edit/portrait/blur';

const [photosArg, masksArg, outArg, ...names] = process.argv.slice(2);
if (!photosArg || !masksArg || !outArg || names.length === 0) {
  console.error('Uso: hoja-modo-retrato.ts <fotos> <máscaras> <salida.jpg> foto…');
  process.exit(1);
}

const photosDir: string = photosArg;
const masksDir: string = masksArg;
const output: string = outArg;
const SIDE = 900;
const files = readdirSync(photosDir);

async function load(name: string) {
  const file = files.find((f) => f.replace(/\.[a-z0-9]+$/i, '') === name);
  if (!file) throw new Error(`No hay foto «${name}»`);
  const { data, info } = await sharp(path.join(photosDir, file))
    .rotate()
    .resize(SIDE, SIDE, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = await sharp(path.join(masksDir, `${name}.png`))
    .resize(info.width, info.height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  return {
    image: { data: new Uint8ClampedArray(data), width: info.width, height: info.height },
    alpha: new Uint8Array(mask),
  };
}

const toJpeg = (p: { data: Uint8ClampedArray; width: number; height: number }) =>
  sharp(Buffer.from(p.data), { raw: { width: p.width, height: p.height, channels: 4 } })
    .removeAlpha()
    .resize(SIDE, SIDE, { fit: 'contain', background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();

const tiles: sharp.OverlayOptions[] = [];
const GAP = 12;
for (let row = 0; row < names.length; row += 1) {
  const { image, alpha } = await load(names[row]!);
  const variants = [
    image,
    portraitBlur(image, alpha, { amount: 35, progressive: true, dim: 0 }),
    portraitBlur(image, alpha, { amount: 90, progressive: true, dim: 25 }),
  ];
  for (let col = 0; col < variants.length; col += 1) {
    tiles.push({ input: await toJpeg(variants[col]!), left: GAP + col * (SIDE + GAP), top: GAP + row * (SIDE + GAP) });
  }
}
const sheet = await sharp({
  create: {
    width: GAP + 3 * (SIDE + GAP),
    height: GAP + names.length * (SIDE + GAP),
    channels: 3,
    background: '#ffffff',
  },
})
  .composite(tiles)
  .png()
  .toBuffer();
// Se reduce DESPUÉS de componer (en sharp, el reescalado va antes que la composición).
await sharp(sheet).resize({ width: 1800 }).jpeg({ quality: 85 }).toFile(output);
console.log('Hoja escrita en', output);
