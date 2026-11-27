// PRUEBA REAL de «Hacer un reel como este» fuera del producto, de un solo
// comando (docs/reel-como-este.md, «Prueba real»). Sirve para comprobar, con la
// clave de verdad, que el modelo con visión elegido mira los fotogramas y
// devuelve algo que el producto puede usar, y cuánto cuesta.
//
//   node scripts/reel-como-este-prueba.ts                    (en seco)
//   node scripts/reel-como-este-prueba.ts --apply [opciones]  (LLAMA al proveedor: gasta céntimos)
//
// Por defecto es EN SECO: no llama a nadie, no crea archivos y no lee ninguna
// clave; solo dice con qué modelo se haría, qué falta por configurar y cuánto
// costaría como mucho.
// Con --apply:
//   1. genera con FFmpeg un vídeo de ejemplo de 4 planos con rótulos (o usa --video);
//   2. lo mide con el trabajador de verdad (sin IA): cortes, planos, compás, fotogramas;
//   3. enseña los fotogramas al modelo configurado (UNA llamada de visión; con
//      --voz, además, la transcripción) y valida la respuesta con el esquema del producto;
//   4. escribe en <salida>/resultado.json la plantilla, el guion y los textos, y
//      dice el consumo real y su coste.
// No toca Supabase: ni cupo, ni registro de uso, ni almacenamiento.
//
// Opciones:
//   --video <archivo>     un vídeo tuyo en vez del de ejemplo (MP4, MOV o WebM; hasta 3 min)
//   --voz                 transcribe también lo que se dice (OpenAI)
//   --idea "<texto>"      de qué quieres que vaya el reel
//   --perfil <archivo>    perfil de marca en JSON (por defecto, uno de ejemplo neutro)
//   --max-coste <n>       tope del coste máximo estimado, en la moneda de AI_PRICES (0.25 por defecto)
//   --salida <carpeta>    dónde se escribe (reel-como-este-<fecha>)
//   --yes                 no pedir confirmación con --apply
//
// Configuración, la misma de la función `ai-reel-like` (se lee del entorno en el
// momento; nunca se imprime ni se guarda):
//   AI_TEXT_REEL_LIKE_PROVIDER / AI_TEXT_REEL_LIKE_MODEL   o   AI_TEXT_PROVIDER / AI_TEXT_MODEL
//   OPENAI_API_KEY, OPENAI_BASE_URL (https://eu.api.openai.com), o las del adaptador elegido
//   AI_PRICES            {"openai/<modelo>": {"input_tokens": …, "output_tokens": …, "cache_read_input_tokens": …}}
//   AI_ALLOW_NON_EU_PROCESSING=true   solo si se acepta procesar fuera de la UE
//
// Necesita Node ≥ 23.6 (TypeScript sin compilar), FFmpeg y `npm install` en worker/.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import type { AiInput, AiProvider, AiUsage, Json } from '../supabase/functions/_shared/ai/contract.ts';
import { parseStructuredOutput } from '../supabase/functions/_shared/ai/schema.ts';
import { priceUsage } from '../supabase/functions/_shared/ai/service.ts';
import { loadReelLikeTextConfig } from '../supabase/functions/_shared/ai/text/reel-like-config.ts';
import {
  REEL_LIKE_SCHEMA,
  reelLikeInput,
  type ReelLikeFrame,
} from '../supabase/functions/_shared/ai/text/tasks/reel-like.ts';
import { loadTranscriptionConfig, transcriptionPrice } from '../supabase/functions/_shared/ai/transcription/config.ts';
import {
  buildReelLikeResult,
  parseMeasurement,
  type ReelLikeAiOutput,
  type ReelLikeResult,
  type ReelMeasurement,
} from '../supabase/functions/_shared/reels/like.ts';

type Env = Record<string, string | undefined>;

export const DEFAULT_MAX_COST = 0.25;
/** Organización y marca inventadas: solo dan forma a las rutas de la carpeta temporal. */
const ORG = '00000000-0000-4000-8000-000000000001';
const BRAND = '00000000-0000-4000-8000-000000000002';
const REFERENCE = '00000000-0000-4000-8000-000000000003';

/** Perfil de marca de ejemplo, neutro (no es de ningún cliente). */
export const SAMPLE_PROFILE: Json = {
  business: { description: 'Panadería de barrio con obrador propio', products: ['pan de masa madre', 'bollería'], locations: [], valueProps: [] },
  audience: { segments: [] },
  goals: [],
  voice: {
    tone: ['cercano', 'sencillo'],
    personality: 'Vecinos de toda la vida',
    values: [],
    keyMessages: ['Pan hecho hoy, con masa madre'],
    allowedPhrases: [],
    forbiddenPhrases: ['el mejor pan del mundo'],
    callsToAction: ['Pásate antes de las doce'],
    hashtags: { required: [], recommended: ['masamadre', 'panaderia'] },
  },
  visual: { colors: [], fonts: [], styleNotes: '' },
  channels: [],
  languages: { primary: 'es', others: [] },
  restrictions: { legal: [], advertising: [] },
  notes: [],
};

/** La medición del vídeo de ejemplo (4 planos), para calcular el coste sin generar nada. */
const SAMPLE_MEASUREMENT: ReelMeasurement = parseMeasurement({
  source: { kind: 'upload', durationSeconds: 7.5, width: 540, height: 960, fps: 30, hasAudio: true },
  shots: [
    { index: 0, start: 0, end: 2, seconds: 2, motion: 0.7, still: false },
    { index: 1, start: 2, end: 3.5, seconds: 1.5, motion: 0, still: true, transitionIn: { type: 'cut', seconds: 0 } },
    { index: 2, start: 3.5, end: 5.75, seconds: 2.25, motion: 0.7, still: false, transitionIn: { type: 'cut', seconds: 0 } },
    { index: 3, start: 5.75, end: 7.5, seconds: 1.75, motion: 0, still: true, transitionIn: { type: 'fade', seconds: 0.5 } },
  ],
  frames: [],
  audio: { present: true, silent: false, bpm: 120, confidence: 0.8, cutsOnBeat: 0.67, beatsPerCut: 4, speech: [] },
  warnings: [],
})!;

const money = (micros: number) => (micros / 1_000_000).toFixed(4).replace('.', ',');

export interface RealTestPlan {
  ready: boolean;
  provider: string | null;
  model: string | null;
  /** Coste máximo de la llamada de visión (y de la voz, si se pide), en micros. */
  maxMicros: number | null;
  problems: string[];
}

/** Qué se haría y cuánto costaría como mucho, sin llamar a nadie. */
export function planRealTest(env: Env, options: { speech?: boolean; frames?: number; speechSeconds?: number } = {}): RealTestPlan {
  const config = loadReelLikeTextConfig(env);
  const problems = [...config.problems];
  const spec = config.spec;
  const provider = spec ? config.providers.find((p) => p.id === spec.provider) : undefined;
  let maxMicros: number | null = null;
  if (!spec) problems.push('No hay modelo elegido: define AI_TEXT_REEL_LIKE_PROVIDER y AI_TEXT_REEL_LIKE_MODEL (o AI_TEXT_PROVIDER y AI_TEXT_MODEL).');
  if (spec && provider && config.ready) {
    const input = reelLikeInput(BRAND, {
      brandProfile: SAMPLE_PROFILE,
      measurement: SAMPLE_MEASUREMENT,
      frames: Array.from({ length: options.frames ?? 4 }, (_, shot) => ({ data: new Uint8Array(), mimeType: 'image/jpeg', shot, at: shot })),
    });
    const priced = priceUsage(spec, provider.estimateUsage({ task: 'text', model: spec.model, input }));
    if (priced.unpriced.length > 0) problems.push(`A «${spec.provider}/${spec.model}» le falta precio en AI_PRICES: ${priced.unpriced.join(', ')}.`);
    else maxMicros = priced.micros;
  }
  let speechReady = true;
  if (options.speech) {
    const rate = transcriptionPrice(loadTranscriptionConfig(env));
    speechReady = rate !== null;
    if (rate === null) problems.push('La transcripción no está disponible (OPENAI_API_KEY con el endpoint de la UE): quita --voz o configúrala.');
    else if (maxMicros !== null) maxMicros += Math.ceil(rate * (options.speechSeconds ?? 8));
  }
  return {
    ready: Boolean(spec && provider && config.ready && maxMicros !== null && speechReady),
    provider: spec?.provider ?? null,
    model: spec?.model ?? null,
    maxMicros,
    problems: [...new Set(problems)],
  };
}

export function formatPlan(plan: RealTestPlan, apply: boolean): string[] {
  const lines = ['«Hacer un reel como este» · prueba real'];
  lines.push(plan.model ? `Modelo: ${plan.provider}/${plan.model}` : 'Modelo: (sin configurar)');
  if (plan.maxMicros !== null) lines.push(`Coste máximo estimado: ${money(plan.maxMicros)} (en la moneda de AI_PRICES)`);
  for (const problem of plan.problems) lines.push(`Falta: ${problem}`);
  lines.push(
    apply
      ? plan.ready
        ? 'Se va a llamar al proveedor (una llamada de visión).'
        : 'No se puede hacer la prueba hasta arreglar lo de arriba. No se ha llamado a nadie.'
      : 'EN SECO: no se ha llamado a nadie ni se ha creado ningún archivo. Con --apply se hace de verdad.',
  );
  return lines;
}

/** Lo que se usa del trabajador (worker/), cargado por ruta calculada (tiene sus propias dependencias). */
interface WorkerModules {
  analyze(job: { video: string; bucket: string; workDir: string; speech: boolean }): Promise<Json>;
  makeSample(file: string): Promise<void>;
}

async function loadWorker(root: string): Promise<WorkerModules> {
  const load = <T>(file: string): Promise<T> => import(pathToFileURL(path.resolve(root, 'worker', file)).href) as Promise<T>;
  const { createReelAnalyzeHandler } = await load<{
    createReelAnalyzeHandler(deps: { tools: unknown; defaultFontFile?: string }): { run(context: Record<string, unknown>): Promise<Json> };
  }>('src/handlers/reel-analyze.ts');
  const { createFolderStorage } = await load<{ createFolderStorage(root: string): unknown }>('src/storage.ts');
  const { toolsFromEnv } = await load<{ toolsFromEnv(): { ffmpeg: string } }>('src/ffmpeg/run.ts');
  const { findDefaultFont } = await load<{ findDefaultFont(): string | undefined }>('src/ffmpeg/fonts.ts');
  const { createMemoryLogger } = await load<{ createMemoryLogger(): unknown }>('src/logger.ts');
  const { makeReferenceReel } = await load<{ makeReferenceReel(file: string, options: { ffmpeg?: string; fontFile?: string }): Promise<void> }>(
    'tests/helpers/reference.ts',
  );
  const tools = toolsFromEnv();
  return {
    makeSample: (file) => makeReferenceReel(file, { ffmpeg: tools.ffmpeg, fontFile: findDefaultFont() }),
    analyze: ({ video, bucket, workDir, speech }) =>
      createReelAnalyzeHandler({ tools, defaultFontFile: findDefaultFont() }).run({
        job: {
          id: 'prueba-real',
          organization_id: ORG,
          brand_id: BRAND,
          kind: 'media.reel.analyze',
          payload: {
            reference: { id: REFERENCE },
            source: { path: video },
            speech,
            output: { dir: `${ORG}/${BRAND}/referencias/${REFERENCE}` },
          },
          attempts: 1,
          max_attempts: 1,
        },
        signal: new AbortController().signal,
        storage: createFolderStorage(bucket),
        workDir,
        log: createMemoryLogger(),
      }),
  };
}

export interface RealTestOptions {
  env: Env;
  root: string;
  out: string;
  video?: string;
  speech: boolean;
  idea?: string;
  profile: Json;
  log: (line: string) => void;
  /** Para las pruebas: el trabajador y el proveedor se pueden sustituir. */
  worker?: WorkerModules;
  provider?: { text: AiProvider; model: string; price: (usage: AiUsage) => number };
}

async function generate(provider: AiProvider, model: string, input: AiInput, task: 'text' | 'transcription' = 'text') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150_000);
  try {
    return await provider.generate({ task, model, input, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** La prueba de verdad. Devuelve el resultado y el coste real (micros). */
export async function runRealTest(options: RealTestOptions): Promise<{ result: ReelLikeResult; costMicros: number; file: string }> {
  const { env, log } = options;
  const worker = options.worker ?? (await loadWorker(options.root));
  const config = options.provider ? null : loadReelLikeTextConfig(env);
  const spec = config?.spec ?? null;
  const text = options.provider?.text ?? (spec ? config!.providers.find((p) => p.id === spec.provider) : undefined);
  const model = options.provider?.model ?? spec?.model;
  if (!text || !model) throw new Error('No hay un modelo con visión cargado: revisa la configuración (prueba primero en seco).');
  const price = options.provider?.price ?? ((usage: AiUsage) => priceUsage(spec!, usage).micros);

  const bucket = await mkdtemp(path.join(os.tmpdir(), 'rrss-reel-como-este-prueba-'));
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'rrss-reel-como-este-trabajo-'));
  try {
    // 1. El vídeo, en la carpeta que hace de almacenamiento.
    const video = `${ORG}/${BRAND}/referencias/${REFERENCE}.mp4`;
    await mkdir(path.dirname(path.join(bucket, video)), { recursive: true });
    if (options.video) await writeFile(path.join(bucket, video), await readFile(options.video));
    else await worker.makeSample(path.join(bucket, video));
    log(options.video ? `Vídeo: ${options.video}` : 'Vídeo de ejemplo generado con FFmpeg (4 planos con rótulos).');

    // 2. Medición sin IA.
    const measurement = parseMeasurement(await worker.analyze({ video, bucket, workDir, speech: options.speech }));
    if (!measurement) throw new Error('El trabajador no ha devuelto una medición válida.');
    log(
      `Medido sin IA: ${measurement.shots.length} planos (${measurement.shots.map((s) => `${s.seconds.toFixed(2)} s`).join(', ')}), ` +
        `${measurement.audio.bpm ? `${Math.round(measurement.audio.bpm)} pulsaciones/min` : 'sin compás claro'}, ${measurement.frames.length} fotogramas.`,
    );
    const frames: ReelLikeFrame[] = [];
    for (const frame of measurement.frames) {
      frames.push({ data: new Uint8Array(await readFile(path.join(bucket, frame.path))), mimeType: 'image/jpeg', shot: frame.shot, at: frame.at });
    }

    // 3. Voz (opcional) y la llamada de visión.
    let costMicros = 0;
    const transcript: Array<{ start: number; text: string }> = [];
    if (options.speech && measurement.audio.speech.length > 0) {
      const speech = loadTranscriptionConfig(env);
      const voice = speech.models[0];
      const voiceProvider = voice ? speech.providers.find((p) => p.id === voice.provider) : undefined;
      if (!voice || !voiceProvider) throw new Error('La transcripción no está configurada: quita --voz.');
      const chunks = [];
      for (const piece of measurement.audio.speech) {
        chunks.push({ data: new Uint8Array(await readFile(path.join(bucket, piece.path))), mimeType: 'audio/mp4', seconds: piece.seconds });
      }
      const heard = await generate(voiceProvider, voice.model, { prompt: 'Transcribe literalmente lo que se dice.', audio: { chunks } }, 'transcription');
      costMicros += priceUsage(voice, heard.usage).micros;
      const segments = Array.isArray(heard.output.segments) ? heard.output.segments : [];
      for (const segment of segments) {
        const entry = segment as { index?: number; text?: string } | null;
        const piece = typeof entry?.index === 'number' ? measurement.audio.speech[entry.index] : undefined;
        if (piece && entry?.text) transcript.push({ start: piece.start, text: entry.text });
      }
      log(`Voz transcrita: ${transcript.length} trozos.`);
    }
    const input = reelLikeInput(BRAND, {
      brandProfile: options.profile,
      measurement,
      frames,
      transcript,
      ...(options.idea ? { idea: options.idea } : {}),
    });
    const answer = await generate(text, model, input);
    costMicros += price(answer.usage);
    const parsed = parseStructuredOutput(answer.output.text, REEL_LIKE_SCHEMA.schema);
    if (!parsed.ok) {
      throw new Error(`El modelo ha respondido, pero no con la forma del producto (${parsed.problems.slice(0, 3).join('; ')}). Coste: ${money(costMicros)}.`);
    }
    const result = buildReelLikeResult(measurement, parsed.value as unknown as ReelLikeAiOutput, { transcriptUsed: transcript.length > 0 });

    // 4. Resultado.
    await mkdir(options.out, { recursive: true });
    const file = path.join(options.out, 'resultado.json');
    await writeFile(file, `${JSON.stringify({ model, usage: answer.usage, costMicros, result }, null, 2)}\n`);
    log(`Plantilla: «${result.template.name}» · ${result.template.shots.map((s) => s.kind).join(', ')}`);
    log(`Gancho: ${result.texts.hook}`);
    log(`Consumo: ${JSON.stringify(answer.usage)} · coste real: ${money(costMicros)}`);
    log(`Resultado completo: ${file}`);
    return { result, costMicros, file };
  } finally {
    // Del vídeo (el de ejemplo o el tuyo) y de sus fotogramas no queda copia.
    await rm(bucket, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
}

function args(argv: string[]) {
  const value = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  return {
    apply: argv.includes('--apply'),
    yes: argv.includes('--yes'),
    speech: argv.includes('--voz'),
    video: value('--video'),
    idea: value('--idea'),
    profile: value('--perfil'),
    maxCost: Number((value('--max-coste') ?? String(DEFAULT_MAX_COST)).replace(',', '.')),
    out: value('--salida') ?? `reel-como-este-${new Date().toISOString().slice(0, 10)}`,
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(`${question} (escribe «sí»): `, (answer) => resolve(/^s[ií]$/i.test(answer.trim()))));
  } finally {
    rl.close();
  }
}

async function main(): Promise<number> {
  const a = args(process.argv.slice(2));
  const say = (line: string) => process.stdout.write(`${line}\n`);
  const plan = planRealTest(process.env, { speech: a.speech });
  for (const line of formatPlan(plan, a.apply)) say(line);
  if (!a.apply) return 0;
  if (!plan.ready || plan.maxMicros === null) return 1;
  if (!(a.maxCost > 0) || plan.maxMicros > a.maxCost * 1_000_000) {
    say(`El coste máximo estimado pasa del tope (--max-coste ${a.maxCost}). No se ha llamado a nadie.`);
    return 1;
  }
  if (!a.yes && !(await confirm(`Esto llama al proveedor y gasta hasta ${money(plan.maxMicros)}. ¿Seguir?`))) {
    say('Cancelado. No se ha llamado a nadie.');
    return 0;
  }
  const profile = a.profile ? (JSON.parse(await readFile(a.profile, 'utf8')) as Json) : SAMPLE_PROFILE;
  await runRealTest({ env: process.env, root: process.cwd(), out: a.out, video: a.video, speech: a.speech, idea: a.idea, profile, log: say });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      // Nunca el objeto entero: un error de red puede llevar cabeceras.
      process.stderr.write(`${error instanceof Error ? error.message : 'Error inesperado'}\n`);
      process.exit(1);
    },
  );
}
