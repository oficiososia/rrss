import { spawn } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { abrir, archivoPng, aviso, dato, png, sinErrores, sql } from './apoyo';

// Reels de punta a punta contra el Supabase LOCAL: subir dos fotos, encargar
// un reel desde la biblioteca, arrancar el trabajador de medios de verdad
// (worker/, con FFmpeg) contra el stack local, esperar a que lo monte y verlo
// en la biblioteca con su procedencia.
//
// Requisitos además de los de la tanda: Node ≥ 22.18 (el trabajador ejecuta su
// TypeScript sin compilar), `npm ci` en worker/ y ffmpeg/ffprobe en el PATH.
// El trabajador lo arranca la propia prueba con `worker/scripts/run-supabase.ts
// local`, que lee la URL y la clave de servicio de `supabase status` en el
// momento (no se escriben en ningún archivo). Modo `drain`: monta lo que haya
// en la cola y sale.
//
// Parte de lo que dejaron los archivos anteriores: Ana es propietaria de la
// organización A (marca La Espiga) y Bruno, de la B.

test.describe.configure({ mode: 'serial' });

const RAIZ = path.resolve('.');
const biblioteca = (lado: 'A' | 'B' = 'A') =>
  `/o/${dato(lado === 'A' ? 'orgA' : 'orgB')}/m/${dato(lado === 'A' ? 'marcaA' : 'marcaB')}/biblioteca`;

/** Arranca el trabajador contra el stack local y espera a que vacíe la cola y salga. */
function trabajadorLocal(limiteMs = 150_000): Promise<{ codigo: number | null; salida: string }> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(process.execPath, ['worker/scripts/run-supabase.ts', 'local'], {
      cwd: RAIZ,
      env: {
        ...process.env,
        WORKER_MODE: 'drain',
        WORKER_ID: 'e2e-reels',
        WORKER_POLL_MS: '500',
        // Margen por si el trabajo tarda en verse en la cola.
        WORKER_IDLE_EXIT_MS: '3000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    hijo.stdout.on('data', (trozo: Buffer) => (salida += trozo.toString()));
    hijo.stderr.on('data', (trozo: Buffer) => (salida += trozo.toString()));
    const tope = setTimeout(() => {
      hijo.kill('SIGTERM');
      rechazar(new Error(`El trabajador no terminó en ${limiteMs / 1000} s.\n${salida}`));
    }, limiteMs);
    hijo.on('error', (error) => {
      clearTimeout(tope);
      rechazar(error);
    });
    hijo.on('exit', (codigo) => {
      clearTimeout(tope);
      resolver({ codigo, salida });
    });
  });
}

interface TrabajoReel extends Record<string, unknown> {
  id: string;
  status: string;
  payload: { output: { path: string }; plan: { media: Array<{ path: string }> } };
}

test('subir dos fotos, encargar un reel, el trabajador lo monta y aparece en la biblioteca', async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await abrir(browser, 'ana');
  const { page } = s;

  // 1. Dos fotos nuevas en la biblioteca de La Espiga. Nombre y tono cambian en
  // cada ejecución: al repetir solo este archivo (E2E_CONTINUAR=1) la biblioteca
  // ya tiene las de la vez anterior (las idénticas se detectan como duplicadas y
  // los nombres repetidos harían ambiguo elegirlas).
  const tono = Date.now() % 50;
  const vez = Date.now().toString(36);
  const horno = `reel-horno-${vez}.png`;
  const mostrador = `reel-mostrador-${vez}.png`;
  await page.goto(biblioteca());
  await page.getByTestId('library-upload-toggle').click();
  await page
    .getByTestId('library-file-input')
    .setInputFiles([
      archivoPng(horno, png(640, 480, [190, 90 + tono, 40])),
      archivoPng(mostrador, png(480, 640, [40, 110, 190 - tono])),
    ]);
  await expect(page.getByTestId('upload-item-done')).toHaveCount(2);

  // 2. Reels: plantilla, las dos fotos en orden y un texto.
  await page.getByTestId('library-reels').click();
  await expect(page.getByRole('heading', { name: 'Reels' })).toBeVisible();
  const plantillas = page.getByTestId('reel-templates');
  for (const nombre of ['Fundido suave', 'Corte rítmico', 'Pase lateral']) {
    await expect(plantillas.getByText(nombre, { exact: true })).toBeVisible();
  }
  await plantillas.getByText('Fundido suave', { exact: true }).click();
  await page.getByRole('button', { name: `Añadir «${horno}»` }).click();
  await page.getByRole('button', { name: `Añadir «${mostrador}»` }).click();
  await expect(page.getByTestId('reel-piece')).toHaveCount(2);
  // Dos fotos de 2,5 s con un fundido de 0,5 s.
  await expect(page.getByTestId('reel-duration')).toHaveText('4,5 s de 30 s como máximo');
  await page.getByRole('button', { name: 'Añadir texto' }).click();
  await page.getByTestId('reel-text').fill('Pan recién hecho');
  await page.getByTestId('reel-submit').click();
  await aviso(page, /Reel encargado/);
  await expect(page.getByTestId('reel-job-status').first()).toHaveText('En cola');

  const [trabajo] = await sql<TrabajoReel>(
    `select id, status, payload from public.jobs
     where brand_id = $1 and kind = 'media.reel.template' order by created_at desc limit 1`,
    [dato('marcaA')],
  );
  expect(trabajo?.status).toBe('queued');
  expect(trabajo!.payload.output.path).toMatch(new RegExp(`^${dato('orgA')}/${dato('marcaA')}/reels/`));
  expect(trabajo!.payload.plan.media.map((m) => path.basename(m.path))).toHaveLength(2);

  // 3. El trabajador de verdad, contra el stack local.
  const { codigo, salida } = await trabajadorLocal();
  expect(codigo, salida).toBe(0);
  expect(salida).toContain('"outcome":"succeeded"');

  // 4. La pantalla lo ve terminado (sondea mientras hay algo en marcha).
  await expect(page.getByTestId('reel-job-status').first()).toHaveText('Listo', { timeout: 30_000 });
  const [recurso] = await sql<{
    id: string;
    file_name: string;
    kind: string;
    origin: string;
    mime_type: string;
    folder: string;
    width: number;
    height: number;
    duration_ms: number;
    bytes: string;
    storage_path: string;
    provenance: { type: string; job_id: string; template_id: string; sources: unknown[] };
  }>(`select * from public.media_assets where provenance ->> 'job_id' = $1`, [trabajo!.id]);
  expect(recurso).toMatchObject({
    kind: 'video',
    origin: 'generated',
    mime_type: 'video/mp4',
    folder: 'Reels',
    width: 1080,
    height: 1920,
    storage_path: trabajo!.payload.output.path,
  });
  expect(recurso!.duration_ms).toBeGreaterThan(4000);
  expect(Number(recurso!.bytes)).toBeLessThan(50 * 1024 * 1024);
  expect(recurso!.provenance).toMatchObject({
    type: 'media_job',
    job_id: trabajo!.id,
    template_id: 'fundido-suave',
  });
  expect(recurso!.provenance.sources).toHaveLength(2);

  // 5. «Abrir en la biblioteca» abre el reel, que se puede reproducir.
  await page.getByTestId('reel-job-open').first().click();
  await expect(page).toHaveURL(/\/biblioteca\?recurso=/);
  const ventana = page.getByRole('dialog');
  await expect(ventana.getByTestId('asset-name')).toHaveValue(recurso!.file_name);
  await expect(ventana.locator('video')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Filtrar por carpeta').selectOption('Reels');
  await expect(page.getByTestId('library-asset').filter({ hasText: recurso!.file_name })).toBeVisible();

  sinErrores(s);
  await s.context.close();

  // 6. La otra organización no lo ve.
  const b = await abrir(browser, 'bruno');
  await b.page.goto(biblioteca('B'));
  await expect(b.page.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible();
  await expect(b.page.getByText(recurso!.file_name)).toHaveCount(0);
  sinErrores(b);
  await b.context.close();
});
