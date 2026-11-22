// Prueba A CIEGAS fuera del producto: anima el MISMO movimiento de 5 fotos de la
// biblioteca con los dos modelos de «Animar con IA» (principal y respaldo, los
// de `ai_media_models` con operación `animate_photo`) y deja una hoja HTML para
// compararlos sin saber cuál es cuál. Sirve para decidir con ojos, no con
// anuncios, qué modelo activar (docs/ia-medios.md, §15).
//
//   node scripts/animacion-a-ciegas.ts --marca <brand_id> [opciones]            (en seco)
//   node scripts/animacion-a-ciegas.ts --marca <brand_id> --apply [opciones]    (GASTA dinero)
//   node scripts/animacion-a-ciegas.ts --resumen <carpeta> <votos.json>         (desvela el resultado)
//
// Por defecto es EN SECO: solo LEE la base de datos (fotos y precios del
// registro) y escribe en pantalla qué se haría y cuánto costaría como máximo.
// No llama a fal.ai, no descarga nada ni crea ningún archivo.
// Con --apply: avisa del coste máximo, pide confirmación (salvo --yes) y no
// pasa del tope --max-coste (5 USD por defecto). Después manda las fotos a
// fal.ai (un tercero que no garantiza la UE: usa fotos sin personas), espera,
// descarga los vídeos y escribe en <salida>:
//   hoja.html            para ver y votar (A o B, sin nombres de modelo);
//   clave-NO-ABRIR.json  qué modelo es A y cuál B en cada foto (se desvela con --resumen);
//   fotos/ y clips/      las fotos de origen y los clips (foto-1-A.mp4…).
//
// Opciones:
//   --marca <brand_id>     marca de la que salen las fotos (obligatoria)
//   --fotos <id,id,…>      fotos concretas en vez de las más recientes
//   --n <n>                cuántas fotos (5 por defecto, máximo 10)
//   --segundos <s>         duración de cada clip (5 por defecto, máximo 10)
//   --movimiento <id>      push-in (por defecto), orbit, steam, light o pull-back
//   --max-coste <USD>      tope del coste máximo estimado (5 por defecto)
//   --salida <carpeta>     dónde se escribe (animacion-a-ciegas-<fecha>)
//   --yes                  no pedir confirmación con --apply
//
// Credenciales (nunca se imprimen ni se guardan; se piden en el momento):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   la base de datos de staging, no la de producción
//   FAL_KEY                                   solo con --apply
// Solo se usan fotos guardadas en Supabase Storage; las de R2 o Drive se saltan y se dice.
//
// Se ejecuta con Node ≥ 23.6 (TypeScript sin compilar).
import { randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { MediaModel, VideoRequest } from '../supabase/functions/_shared/ai/media/contract.ts';
import { createFalVideoProvider } from '../supabase/functions/_shared/ai/media/fal-video.ts';
import { mediaModelsFromRows, type MediaModelRow } from '../supabase/functions/_shared/ai/media/models.ts';
import { createSupabaseObjectStorage } from '../supabase/functions/_shared/storage/supabase.ts';
import { buildAnimatePrompt } from '../supabase/functions/ai-media/handler.ts';

/** Los mismos movimientos que la interfaz (`src/features/library/animateApi.ts`; una prueba comprueba que coinciden). */
export const MOVEMENT_PROMPTS: Record<string, string> = {
  'push-in': 'slow smooth camera push-in towards the dish',
  orbit: 'slow camera orbit around the dish',
  steam: 'gentle steam rising from the food, camera almost still',
  light: 'soft warm light slowly moving across the dish, camera almost still',
  'pull-back': 'slow smooth camera pull-back revealing the table',
};

export const DEFAULTS = { photos: 5, seconds: 5, maxCostUsd: 5 };
const MAX_PHOTOS = 10;
const MAX_SECONDS = 10;
const POLL_MS = 5000;
const DEADLINE_MS = 15 * 60_000;

export interface BlindPhoto {
  id: string;
  organization_id: string;
  brand_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  width: number;
  height: number;
}

export interface BlindDb {
  /** Fotos de Storage de la marca, JPEG, PNG o WebP con medidas, las más recientes primero (o las pedidas). */
  photos(brandId: string, ids: string[] | null, limit: number): Promise<BlindPhoto[]>;
  /** Modelos de animar fotos del registro (activos o no). */
  models(): Promise<MediaModelRow[]>;
}

export function restBlindDb(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): BlindDb {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  async function get<T>(query: string): Promise<T> {
    const response = await fetchImpl(`${base}/${query}`, { headers });
    if (!response.ok) throw new Error(`No se pudo leer la base de datos (HTTP ${response.status})`);
    return (await response.json()) as T;
  }
  return {
    photos(brandId, ids, limit) {
      const filters = [
        'select=id,organization_id,brand_id,storage_path,file_name,mime_type,width,height',
        `brand_id=eq.${brandId}`,
        'kind=eq.image',
        'source=eq.storage',
        'storage_backend=eq.supabase',
        'mime_type=in.(image/jpeg,image/png,image/webp)',
        'width=not.is.null',
        'height=not.is.null',
        'order=created_at.desc',
        `limit=${limit}`,
      ];
      if (ids) filters.push(`id=in.(${ids.join(',')})`);
      return get<BlindPhoto[]>(`media_assets?${filters.join('&')}`);
    },
    models() {
      return get<MediaModelRow[]>(
        'ai_media_models?operation=eq.animate_photo&order=priority.desc&select=provider,model,task,operation,display_name,billing_unit,price_micros,price_details,price_verified,data_region,trains_on_inputs,delivery,settings,priority,active',
      );
    },
  };
}

// ───────────────────────────── Plan y coste ─────────────────────────────

export interface BlindPlan {
  photos: BlindPhoto[];
  models: MediaModel[];
  seconds: number;
  /** Cota del coste de cada modelo (n fotos × segundos × precio), en millonésimas de USD. */
  perModelMicros: Record<string, number>;
  totalMicros: number;
}

export const modelId = (m: Pick<MediaModel, 'provider' | 'model'>) => `${m.provider}:${m.model}`;

export function planBlind(photos: BlindPhoto[], models: MediaModel[], seconds: number): BlindPlan {
  const perModelMicros: Record<string, number> = {};
  let totalMicros = 0;
  for (const model of models) {
    const micros = Math.ceil(photos.length * seconds * model.priceMicros);
    perModelMicros[modelId(model)] = micros;
    totalMicros += micros;
  }
  return { photos, models, seconds, perModelMicros, totalMicros };
}

const usd = (micros: number) => `${(micros / 1_000_000).toFixed(2).replace('.', ',')} USD`;

export function formatPlan(plan: BlindPlan, movement: string): string {
  const lines = [
    `Fotos: ${plan.photos.length} · ${plan.seconds} s cada clip · movimiento «${movement}»`,
    `Modelos: ${plan.models.length}`,
  ];
  for (const model of plan.models) {
    lines.push(
      `  ${modelId(model)} · ${usd(model.priceMicros)} por segundo` +
        `${model.priceVerified ? '' : ' (precio SIN VERIFICAR: contrástalo en fal.ai)'}` +
        ` → hasta ${usd(plan.perModelMicros[modelId(model)]!)}`,
    );
  }
  lines.push(`COSTE MÁXIMO TOTAL: ${usd(plan.totalMicros)} (${plan.photos.length * plan.models.length} clips)`);
  return lines.join('\n');
}

// ───────────────────────────── A ciegas ─────────────────────────────

export type Blind = { A: string; B: string };
/** Para cada foto, qué modelo se esconde tras la A y cuál tras la B (al azar, independiente por foto). */
export function assignBlind(photoIds: string[], models: string[], rand: (n: number) => number = randomInt): Record<string, Blind> {
  if (models.length !== 2) throw new Error('La prueba a ciegas compara exactamente dos modelos');
  const out: Record<string, Blind> = {};
  for (const id of photoIds) out[id] = rand(2) === 0 ? { A: models[0]!, B: models[1]! } : { A: models[1]!, B: models[0]! };
  return out;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface SheetItem {
  index: number;
  photoFile: string;
  /** Archivos de vídeo por letra, o `null` si ese clip no se pudo generar. */
  clips: { A: string | null; B: string | null };
}

/** Hoja para compararlos: sin nombres de modelo, ni en el texto ni en los nombres de archivo. */
export function sheetHtml(items: SheetItem[], movement: string, seconds: number): string {
  const rows = items
    .map((item) => {
      const clip = (letter: 'A' | 'B') =>
        item.clips[letter]
          ? `<figure><video src="${escapeHtml(item.clips[letter]!)}" controls loop muted playsinline></video><figcaption>${letter}</figcaption></figure>`
          : `<figure class="vacio"><p>Sin clip (falló la generación)</p><figcaption>${letter}</figcaption></figure>`;
      return `<section data-foto="${item.index}">
  <h2>Foto ${item.index}</h2>
  <div class="fila">
    <figure><img src="${escapeHtml(item.photoFile)}" alt="Foto ${item.index} de origen"><figcaption>Original</figcaption></figure>
    ${clip('A')}
    ${clip('B')}
  </div>
  <p class="voto" role="radiogroup" aria-label="Qué clip es mejor en la foto ${item.index}">
    <label><input type="radio" name="f${item.index}" value="A"> Mejor A</label>
    <label><input type="radio" name="f${item.index}" value="B"> Mejor B</label>
    <label><input type="radio" name="f${item.index}" value="empate" checked> Empate o ninguno</label>
  </p>
</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Animar fotos: comparación a ciegas</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 16px; line-height: 1.4; }
  .fila { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  figure { margin: 0; } img, video { width: 100%; max-height: 420px; object-fit: contain; background: #eee; border-radius: 8px; }
  figcaption { text-align: center; font-weight: 600; } .vacio { display: grid; place-items: center; background: #f6e8e8; border-radius: 8px; padding: 24px; }
  section { border-bottom: 1px solid #ccc; padding: 16px 0; } .voto label { margin-right: 16px; } button { padding: 8px 14px; font-size: 1rem; }
</style>
</head>
<body>
<h1>Animar fotos: comparación a ciegas</h1>
<p>Mismo movimiento («${escapeHtml(movement)}», ${seconds} s) con dos modelos, mezclados al azar en cada foto. Fíjate en lo importante para un restaurante:
que el plato siga siendo el mismo (forma, cantidades, adornos, vajilla), que el movimiento sea suave y que no aparezcan cosas raras.
Vota sin saber qué modelo es cuál; al terminar, descarga tus votos y desvela el resultado con
<code>node scripts/animacion-a-ciegas.ts --resumen &lt;carpeta&gt; votos.json</code>.</p>
${rows}
<p><button type="button" id="descargar">Descargar mis votos (votos.json)</button></p>
<script>
document.getElementById('descargar').addEventListener('click', function () {
  var votos = {};
  document.querySelectorAll('section[data-foto]').forEach(function (s) {
    var marcado = s.querySelector('input[type=radio]:checked');
    votos[s.getAttribute('data-foto')] = marcado ? marcado.value : 'empate';
  });
  var enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([JSON.stringify(votos, null, 2)], { type: 'application/json' }));
  enlace.download = 'votos.json';
  enlace.click();
});
</script>
</body>
</html>
`;
}

export interface Tally {
  wins: Record<string, number>;
  ties: number;
  total: number;
}

/** Desvela los votos: `key` es `{ "1": {A: modelo, B: modelo}, … }` y `votes` `{ "1": "A" | "B" | "empate", … }`. */
export function tally(key: Record<string, Blind>, votes: Record<string, string>): Tally {
  const wins: Record<string, number> = {};
  let ties = 0;
  let total = 0;
  for (const [photo, blind] of Object.entries(key)) {
    wins[blind.A] ??= 0;
    wins[blind.B] ??= 0;
    total += 1;
    const vote = votes[photo];
    if (vote === 'A') wins[blind.A]! += 1;
    else if (vote === 'B') wins[blind.B]! += 1;
    else ties += 1;
  }
  return { wins, ties, total };
}

export function formatTally(result: Tally): string {
  const lines = [`Fotos votadas: ${result.total} (empates o ninguno: ${result.ties})`];
  for (const [model, wins] of Object.entries(result.wins).sort((a, b) => b[1] - a[1])) lines.push(`  ${model}: ${wins}`);
  return lines.join('\n');
}

// ───────────────────────────── Ejecución ─────────────────────────────

export interface RunDeps {
  db: BlindDb;
  /** Firma la lectura de la foto de origen (15 min). */
  sign(photo: BlindPhoto): Promise<string>;
  fetch: typeof fetch;
  falKey: string | null;
  confirm(question: string): Promise<boolean>;
  write(file: string, data: string | Uint8Array): Promise<void>;
  mkdir(dir: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  rand?: (n: number) => number;
  log(line: string): void;
}

export interface RunOptions {
  brandId: string;
  photoIds: string[] | null;
  count: number;
  seconds: number;
  movement: string;
  apply: boolean;
  yes: boolean;
  maxCostUsd: number;
  outDir: string;
}

export async function runBlind(opts: RunOptions, deps: RunDeps): Promise<number> {
  const prompt = MOVEMENT_PROMPTS[opts.movement];
  if (!prompt) throw new Error(`Movimiento desconocido «${opts.movement}»: ${Object.keys(MOVEMENT_PROMPTS).join(', ')}`);
  if (!Number.isInteger(opts.seconds) || opts.seconds < 1 || opts.seconds > MAX_SECONDS) {
    throw new Error(`--segundos debe ser un entero de 1 a ${MAX_SECONDS}`);
  }
  const count = Math.min(Math.max(1, opts.count), MAX_PHOTOS);

  const models = mediaModelsFromRows(await deps.db.models());
  if (models.length !== 2) {
    throw new Error(`Hacen falta los dos modelos de animar fotos en el registro (hay ${models.length}). ¿Está aplicada la migración 20261217010000?`);
  }
  const photos = await deps.db.photos(opts.brandId, opts.photoIds, count);
  if (photos.length === 0) throw new Error('No hay fotos utilizables en esa marca (JPEG, PNG o WebP guardadas en Supabase Storage).');
  const plan = planBlind(photos, models, opts.seconds);
  deps.log(formatPlan(plan, opts.movement));

  if (!opts.apply) {
    deps.log('\nEN SECO: no se ha llamado a fal.ai ni se ha escrito nada. Para hacerlo de verdad, añade --apply.');
    return 0;
  }
  if (plan.totalMicros / 1_000_000 > opts.maxCostUsd) {
    throw new Error(`El coste máximo (${usd(plan.totalMicros)}) supera el tope --max-coste (${opts.maxCostUsd} USD). Baja --n o --segundos, o sube el tope a propósito.`);
  }
  if (!deps.falKey) throw new Error('Falta FAL_KEY');
  if (!opts.yes && !(await deps.confirm(`Se enviarán ${photos.length} fotos a fal.ai y se gastará hasta ${usd(plan.totalMicros)}. ¿Seguir? [s/N] `))) {
    deps.log('Cancelado: no se ha gastado nada.');
    return 0;
  }

  const provider = createFalVideoProvider({ apiKey: deps.falKey, fetch: deps.fetch as never });
  await deps.mkdir(path.join(opts.outDir, 'fotos'));
  await deps.mkdir(path.join(opts.outDir, 'clips'));
  const key = assignBlind(photos.map((_, i) => String(i + 1)), plan.models.map(modelId), deps.rand);

  interface Job { index: number; model: MediaModel; letter: 'A' | 'B'; ref: Awaited<ReturnType<typeof provider.start>> | null; file: string | null; error?: string }
  const jobs: Job[] = [];
  const photoFiles: string[] = [];
  for (const [i, photo] of photos.entries()) {
    const index = i + 1;
    const url = await deps.sign(photo);
    const original = await deps.fetch(url);
    if (!original.ok) throw new Error(`No se pudo bajar la foto ${index} (HTTP ${original.status})`);
    const ext = photo.mime_type === 'image/png' ? 'png' : photo.mime_type === 'image/webp' ? 'webp' : 'jpg';
    const photoFile = `fotos/foto-${index}.${ext}`;
    photoFiles.push(photoFile);
    await deps.write(path.join(opts.outDir, photoFile), new Uint8Array(await original.arrayBuffer()));
    const request: VideoRequest = {
      kind: 'video',
      operation: 'animate_photo',
      startImage: { mimeType: photo.mime_type, url, width: photo.width, height: photo.height },
      prompt: buildAnimatePrompt(prompt),
      durationSeconds: opts.seconds,
      aspectRatio: '4:5',
    };
    for (const letter of ['A', 'B'] as const) {
      const model = plan.models.find((m) => modelId(m) === key[String(index)]![letter])!;
      const job: Job = { index, model, letter, ref: null, file: null };
      try {
        job.ref = await provider.start({ request, model, idempotencyKey: `ciegas-${index}-${letter}`, signal: new AbortController().signal });
        deps.log(`Foto ${index} · clip ${letter} enviado`);
      } catch (error) {
        job.error = error instanceof Error ? error.message : 'error desconocido';
        deps.log(`Foto ${index} · clip ${letter} NO se pudo enviar: ${job.error}`);
      }
      jobs.push(job);
    }
  }

  const deadline = deps.now() + DEADLINE_MS;
  const open = () => jobs.filter((j) => j.ref?.status === 'pending' && !j.file && !j.error);
  while (open().length > 0 && deps.now() < deadline) {
    for (const job of open()) {
      if (job.ref?.status !== 'pending') continue;
      try {
        const outcome = await provider.poll!(job.ref.job, job.model, new AbortController().signal);
        if (outcome.status === 'failed') {
          job.error = outcome.message;
        } else if (outcome.status === 'completed') {
          const video = await deps.fetch(outcome.outputs[0]!.url!);
          if (!video.ok) throw new Error(`HTTP ${video.status} al bajar el clip`);
          job.file = `clips/foto-${job.index}-${job.letter}.mp4`;
          await deps.write(path.join(opts.outDir, job.file), new Uint8Array(await video.arrayBuffer()));
          deps.log(`Foto ${job.index} · clip ${job.letter} listo`);
        }
      } catch (error) {
        job.error = error instanceof Error ? error.message : 'error desconocido';
      }
      if (job.error) deps.log(`Foto ${job.index} · clip ${job.letter} falló: ${job.error}`);
    }
    if (open().length > 0) await deps.sleep(POLL_MS);
  }
  for (const job of open()) deps.log(`Foto ${job.index} · clip ${job.letter}: no terminó en 15 minutos (se da por perdido; fal.ai puede cobrarlo igualmente)`);

  const items: SheetItem[] = photos.map((_, i) => ({
    index: i + 1,
    photoFile: photoFiles[i]!,
    clips: {
      A: jobs.find((j) => j.index === i + 1 && j.letter === 'A')?.file ?? null,
      B: jobs.find((j) => j.index === i + 1 && j.letter === 'B')?.file ?? null,
    },
  }));
  await deps.write(path.join(opts.outDir, 'hoja.html'), sheetHtml(items, opts.movement, opts.seconds));
  await deps.write(path.join(opts.outDir, 'clave-NO-ABRIR.json'), JSON.stringify(key, null, 2));
  const made = jobs.filter((j) => j.file).length;
  deps.log(`\nListo: ${made} de ${jobs.length} clips. Abre ${path.join(opts.outDir, 'hoja.html')}, vota y desvela con --resumen.`);
  deps.log(`Gasto estimado: hasta ${usd(Math.ceil(made * opts.seconds * (plan.models[0]!.priceMicros + plan.models[1]!.priceMicros) / 2))}; el real está en el panel de fal.ai.`);
  return jobs.some((j) => j.error) ? 1 : 0;
}

// ───────────────────────────── Terminal ─────────────────────────────

export function args(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}

async function ask(question: string, hidden: boolean): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s: string) {
      if (s.includes(question)) write.call(this, s);
    };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function secret(name: string): Promise<string> {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (process.stdin.isTTY) {
    const typed = await ask(`${name}: `, true);
    if (typed) return typed;
  }
  throw new Error(`Falta ${name}`);
}

async function main(): Promise<number> {
  const a = args(process.argv.slice(2));
  if (typeof a.resumen === 'string') {
    const votesFile = process.argv[process.argv.indexOf('--resumen') + 2];
    if (!votesFile) throw new Error('Uso: --resumen <carpeta> <votos.json>');
    const key = JSON.parse(await readFile(path.join(a.resumen, 'clave-NO-ABRIR.json'), 'utf8')) as Record<string, Blind>;
    const votes = JSON.parse(await readFile(votesFile, 'utf8')) as Record<string, string>;
    console.log(formatTally(tally(key, votes)));
    return 0;
  }
  if (typeof a.marca !== 'string') throw new Error('Falta --marca <brand_id>');
  const apply = a.apply === true;
  const url = await secret('SUPABASE_URL');
  const serviceKey = await secret('SUPABASE_SERVICE_ROLE_KEY');
  const storage = createSupabaseObjectStorage({ url, serviceKey });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return runBlind(
    {
      brandId: a.marca,
      photoIds: typeof a.fotos === 'string' ? a.fotos.split(',').map((s) => s.trim()).filter(Boolean) : null,
      count: typeof a.n === 'string' ? Number(a.n) || DEFAULTS.photos : DEFAULTS.photos,
      seconds: typeof a.segundos === 'string' ? Number(a.segundos) : DEFAULTS.seconds,
      movement: typeof a.movimiento === 'string' ? a.movimiento : 'push-in',
      apply,
      yes: a.yes === true,
      maxCostUsd: typeof a['max-coste'] === 'string' ? Number(a['max-coste']) : DEFAULTS.maxCostUsd,
      outDir: typeof a.salida === 'string' ? a.salida : `animacion-a-ciegas-${stamp}`,
    },
    {
      db: restBlindDb(url, serviceKey),
      sign: (photo) => storage.signGet(photo.storage_path, 15 * 60),
      fetch,
      falKey: apply ? await secret('FAL_KEY') : null,
      confirm: async (question) => /^(s|si|sí|y|yes)$/i.test(await ask(question, false)),
      write: (file, data) => writeFile(file, data),
      mkdir: async (dir) => void (await mkdir(dir, { recursive: true })),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      log: (line) => console.log(line),
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
}
