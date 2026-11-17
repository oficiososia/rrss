// Configuración del trabajador, toda por variables de entorno (ver README).
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);

export const configSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  WORKER_BUCKET: z.string().min(1).default('brand-media'),
  WORKER_MODE: z.enum(['drain', 'continuous']).default('drain'),
  WORKER_ID: z.string().min(1).max(200).default(`media-${os.hostname()}-${process.pid}`),
  WORKER_CONCURRENCY: int(1, 1, 16),
  WORKER_LEASE_SECONDS: int(900, 5, 3600),
  WORKER_POLL_MS: int(5_000, 100, 600_000),
  WORKER_IDLE_EXIT_MS: int(0, 0, 3_600_000),
  WORKER_SHUTDOWN_GRACE_MS: int(0, 0, 600_000),
  WORKER_TMP_DIR: z.string().min(1).default(path.join(os.tmpdir(), 'rrss-worker')),
  WORKER_FONTS_DIR: z.string().min(1).optional(),
});
export type WorkerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    // Solo nombres de variable y motivo: nunca valores.
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuración del trabajador inválida: ${issues}`);
  }
  return parsed.data;
}
