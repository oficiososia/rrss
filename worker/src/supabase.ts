// Adaptadores de Supabase para la cola y el almacenamiento, con `fetch` y sin
// dependencias. Son los únicos archivos que saben que detrás hay Supabase:
// PostgREST para las funciones de la cola y la API de Storage para los archivos.
//
// Los archivos viajan en flujo (de la red al disco y al revés): un vídeo de
// cientos de megas nunca se carga entero en memoria.
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { LeaseLostError, PermanentError } from './errors.ts';
import type { Job, JobQueue } from './queue.ts';
import type { MediaStorage } from './storage.ts';

export interface SupabaseOptions {
  /** URL del proyecto, sin barra final. */
  url: string;
  /** Clave de servicio. Solo vive en el entorno del trabajador. */
  serviceKey: string;
  fetch?: typeof fetch;
}

const authHeaders = (key: string) => ({ apikey: key, Authorization: `Bearer ${key}` });

async function errorText(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? body;
  } catch {
    return body.slice(0, 300);
  }
}

export function createSupabaseQueue(options: SupabaseOptions): JobQueue {
  const doFetch = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, '');

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await doFetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { ...authHeaders(options.serviceKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      const message = await errorText(response);
      if (/no está reservado por este trabajador/.test(message)) throw new LeaseLostError(message);
      throw new Error(`La cola respondió ${response.status} a ${name}: ${message}`);
    }
    return (await response.json()) as T;
  }

  return {
    claim: ({ worker, kinds, limit, leaseSeconds }) =>
      rpc<Job[]>('claim_jobs', { p_worker: worker, p_kinds: kinds, p_limit: limit, p_lease_seconds: leaseSeconds }),
    async complete(jobId, worker, result) {
      await rpc('complete_job', { p_job_id: jobId, p_worker: worker, p_result: result });
    },
    async fail(jobId, worker, error, retry) {
      await rpc('fail_job', { p_job_id: jobId, p_worker: worker, p_error: error, p_retry: retry });
    },
    async release(jobId, worker) {
      await rpc('release_job', { p_job_id: jobId, p_worker: worker });
    },
    async extendLease(jobId, worker, leaseSeconds) {
      await rpc('extend_job_lease', { p_job_id: jobId, p_worker: worker, p_lease_seconds: leaseSeconds });
    },
  };
}

export function createSupabaseStorage(options: SupabaseOptions & { bucket: string }): MediaStorage {
  const doFetch = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, '');
  const objectUrl = (objectPath: string) =>
    `${base}/storage/v1/object/${encodeURIComponent(options.bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;

  return {
    async download(objectPath, destinationFile, signal) {
      const response = await doFetch(objectUrl(objectPath), { headers: authHeaders(options.serviceKey), signal });
      if (!response.ok || !response.body) {
        const message = await errorText(response);
        // Storage responde 400 o 404 cuando el objeto no existe: reintentar no lo arregla.
        if (response.status === 400 || response.status === 404) {
          throw new PermanentError(`No existe el archivo «${objectPath}» (${message})`);
        }
        throw new Error(`No se pudo bajar «${objectPath}»: ${response.status} ${message}`);
      }
      await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(destinationFile), {
        signal,
      });
    },
    async upload(sourceFile, objectPath, { contentType, signal }) {
      const { size } = await stat(sourceFile);
      const response = await doFetch(objectUrl(objectPath), {
        method: 'POST',
        headers: {
          ...authHeaders(options.serviceKey),
          'Content-Type': contentType,
          'Content-Length': String(size),
          // Reintentar un trabajo vuelve a escribir el mismo resultado: se sobrescribe.
          'x-upsert': 'true',
        },
        body: Readable.toWeb(createReadStream(sourceFile)) as unknown as RequestInit['body'],
        duplex: 'half',
        signal,
      } as RequestInit);
      if (!response.ok) {
        throw new Error(`No se pudo subir «${objectPath}»: ${response.status} ${await errorText(response)}`);
      }
      await response.arrayBuffer().catch(() => undefined);
    },
  };
}
