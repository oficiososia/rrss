// Entrada del trabajador de medios: `node src/main.ts`.
//
// Lee la configuración del entorno, conecta la cola y el almacenamiento de
// Supabase y arranca el bucle. Por defecto (`WORKER_MODE=drain`) vacía la cola
// y termina, para alojamientos que arrancan el contenedor bajo demanda.
import { loadConfig } from './config.ts';
import { errorMessage } from './errors.ts';
import { findDefaultFont } from './ffmpeg/fonts.ts';
import { runProcess, toolsFromEnv } from './ffmpeg/run.ts';
import { createMediaHandlers } from './handlers/index.ts';
import { createJsonLogger } from './logger.ts';
import { createSupabaseQueue, createSupabaseStorage } from './supabase.ts';
import { createWorker } from './worker.ts';

async function main(): Promise<number> {
  const logger = createJsonLogger({ service: 'rrss-worker' });
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    logger.error('worker.config_invalid', { error: errorMessage(error) });
    return 2;
  }

  const tools = toolsFromEnv();
  try {
    const version = (await runProcess(tools.ffmpeg, ['-version'])).split('\n')[0];
    logger.info('worker.ffmpeg', { version });
  } catch (error) {
    logger.error('worker.ffmpeg_missing', { error: errorMessage(error) });
    return 2;
  }
  const defaultFontFile = findDefaultFont();
  if (!defaultFontFile) logger.warn('worker.font_missing', { hint: 'Define WORKER_FONT_FILE para poner texto en los vídeos' });

  const supabase = { url: config.SUPABASE_URL, serviceKey: config.SUPABASE_SERVICE_ROLE_KEY };
  const worker = createWorker({
    queue: createSupabaseQueue(supabase),
    storage: createSupabaseStorage({ ...supabase, bucket: config.WORKER_BUCKET }),
    handlers: createMediaHandlers({ tools, defaultFontFile, fontsDir: config.WORKER_FONTS_DIR }),
    logger,
    workerId: config.WORKER_ID,
    mode: config.WORKER_MODE,
    concurrency: config.WORKER_CONCURRENCY,
    leaseSeconds: config.WORKER_LEASE_SECONDS,
    pollIntervalMs: config.WORKER_POLL_MS,
    idleExitMs: config.WORKER_IDLE_EXIT_MS,
    shutdownGraceMs: config.WORKER_SHUTDOWN_GRACE_MS,
    tmpRoot: config.WORKER_TMP_DIR,
  });

  // Apagado ordenado: el alojamiento avisa con SIGTERM antes de matar el contenedor.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => worker.stop(`Señal ${signal}`));
  }

  const summary = await worker.run();
  return summary.stoppedBy === 'queue-error' ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exit(1);
  },
);
