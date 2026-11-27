import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// Historias del catálogo (tapas y menú del día): se arman con un tema, se rellenan sus marcos con
// fotos y se exportan con el exportador real del editor. Tienen que salir a 1080 × 1920 y con las
// fotos dentro.
//
// Vistas previas (opcional, no es una prueba): con HISTORIAS_VISTAS=<archivo.json> deja un PNG por
// historia con fotos y tipografías de verdad. El archivo dice dónde están (fuera del repositorio):
//   { "salida": "<carpeta>", "tema": { …papeles del tema… }, "logo": "<png>",
//     "fuentes": [{ "family": "…", "file": "<woff2>", "weight": "400", "style": "normal" }],
//     "fotos": { "<clave de la historia>": ["<jpg o png>", …] },
//     "textos": { "<clave de la historia>": { "<id de la capa>": "texto", … } } }

interface Rendered {
  width: number;
  height: number;
  frames: number;
  dataUrl: string;
}

async function open(page: Page) {
  await page.goto('/historias.html');
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
}

const render = (page: Page, input: Record<string, unknown>) =>
  page.evaluate(
    (i) => (window as unknown as { renderStory: (x: unknown) => Promise<Rendered> }).renderStory(i),
    input,
  );

/** Una «foto» sintética (data: URL) hecha en el navegador. */
const synthetic = (page: Page, hue: number) =>
  page.evaluate((h) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 800;
    const c = canvas.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 800, 800);
    g.addColorStop(0, `hsl(${h} 70% 45%)`);
    g.addColorStop(1, `hsl(${(h + 60) % 360} 70% 30%)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 800, 800);
    return canvas.toDataURL('image/png');
  }, hue);

test('cada historia del juego de restaurante sale a 1080 × 1920 con sus fotos', async ({ page }) => {
  await open(page);
  const keys = (await page.evaluate(() =>
    (window as unknown as { storyKeys: () => string[] }).storyKeys(),
  )) as string[];
  expect(keys).toEqual([
    'rest-historia-tapa-del-dia',
    'rest-historia-tapas-semana',
    'rest-historia-dos-tapas',
    'rest-historia-menu-dia',
    'rest-historia-menu-foto',
  ]);
  const photos = await Promise.all([0, 70, 140, 210].map((h) => synthetic(page, h)));
  for (const key of keys) {
    const result = await render(page, { key, photos });
    expect([result.width, result.height], key).toEqual([1080, 1920]);
    expect(result.frames, key).toBeGreaterThan(0);
    expect(result.dataUrl.startsWith('data:image/png'), key).toBe(true);
  }
  // El menú sin foto también sale: el marco vacío no se dibuja y queda el fondo de la marca.
  const sinFoto = await render(page, { key: 'rest-historia-menu-dia', photos: [] });
  expect([sinFoto.width, sinFoto.height]).toEqual([1080, 1920]);
});

const config = process.env.HISTORIAS_VISTAS;

test('vistas previas con fotos reales (solo con HISTORIAS_VISTAS)', async ({ page }) => {
  test.skip(!config, 'Sin HISTORIAS_VISTAS no se generan vistas previas');
  const setup = JSON.parse(await readFile(config!, 'utf8')) as {
    salida: string;
    tema: Record<string, string>;
    logo?: string;
    fuentes: Array<{ family: string; file: string; weight?: string; style?: string }>;
    fotos: Record<string, string[]>;
    textos?: Record<string, Record<string, string>>;
  };
  const dataUrl = async (file: string) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime =
      ext === 'woff2' ? 'font/woff2' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
  };
  const fonts = await Promise.all(
    setup.fuentes.map(async (f) => ({ family: f.family, url: await dataUrl(f.file), weight: f.weight, style: f.style })),
  );
  const logo = setup.logo ? await dataUrl(setup.logo) : undefined;
  await open(page);
  for (const [key, files] of Object.entries(setup.fotos)) {
    const photos = await Promise.all(files.map(dataUrl));
    const texts = setup.textos?.[key];
    const result = await render(page, { key, photos, theme: setup.tema, logo, fonts, texts });
    expect([result.width, result.height]).toEqual([1080, 1920]);
    await writeFile(
      path.join(setup.salida, `${key}.png`),
      Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64'),
    );
  }
});
