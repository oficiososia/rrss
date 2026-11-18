// Lógica de la Edge Function `social-publish`: reclama de la cola los trabajos
// `social.publish` y los publica (../_shared/social/publisher.ts); después
// comprueba, una vez al día por cuenta, que los tokens siguen valiendo.
//
// La dispara pg_cron cada minuto (migración 20261119040000), solo si hay algo
// que hacer. SOLO con la clave de servicio: cualquier otra llamada recibe 401
// sin tocar la cola. El navegador no la llama nunca.
//
// Por qué una Edge Function y no el trabajador de medios: publicar es hablar
// con la API de Meta (segundos, sin CPU), necesita los secretos de Meta y la
// clave de cifrado de los tokens, que viven en las funciones, y el reloj ya es
// pg_cron → función, como el sondeo de imagen. El vídeo de un reel no se
// espera en la función: si Instagram aún lo procesa, el trabajo se aplaza un
// minuto sin gastar intento.
import type { RpcClient } from '../_shared/ai/contract.ts';
import { SOCIAL_PUBLISH_JOB_KIND, type ClaimedSocialJob } from '../_shared/social/contract.ts';
import { processPublishJob, type PublisherDeps, type PublishResult } from '../_shared/social/publisher.ts';
import { hasServiceKey } from '../ai-media-poll/handler.ts';

export interface SocialPublishDeps {
  serviceKeys: string[];
  rpc: RpcClient;
  /** Lo que el publicador necesita, salvo la cola (null si falta configuración). */
  publisher(): Omit<PublisherDeps, 'rpc' | 'workerName'> | null;
  /** Cuentas vivas cuyo token no se ha comprobado en 24 h. */
  accountsToCheck(): Promise<Array<{ id: string; brand_id: string; network: string; external_id: string }>>;
  checkTokens(accounts: Array<{ id: string; brand_id: string; network: string; external_id: string }>): Promise<number>;
  workerName: string;
  /** Trabajos por llamada. Por defecto, 5. */
  batchSize?: number;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export function createSocialPublishHandler(deps: SocialPublishDeps): (request: Request) => Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: { code: 'method_not_allowed' } });
    if (!hasServiceKey(request, deps.serviceKeys)) return json(401, { error: { code: 'unauthorized' } });

    const publisher = deps.publisher();
    const results: Array<Pick<PublishResult, 'outcome' | 'publicationId' | 'errorCode'> & { jobId: string }> = [];
    if (!publisher) {
      deps.log?.('not_configured', {});
    } else {
      const claimed = await deps.rpc('claim_jobs', {
        p_worker: deps.workerName,
        p_kinds: [SOCIAL_PUBLISH_JOB_KIND],
        p_limit: deps.batchSize ?? 5,
        p_lease_seconds: 300,
      });
      if (claimed.error) {
        deps.log?.('claim_failed', { message: claimed.error.message });
        return json(500, { error: { code: 'internal' } });
      }
      const jobs = (Array.isArray(claimed.data) ? claimed.data : []) as ClaimedSocialJob[];
      for (const job of jobs) {
        try {
          const r = await processPublishJob(job, { ...publisher, rpc: deps.rpc, workerName: deps.workerName });
          results.push({ jobId: job.id, outcome: r.outcome, publicationId: r.publicationId, errorCode: r.errorCode });
        } catch {
          // Un fallo inesperado no tumba el lote: la reserva caduca y se reintenta.
          deps.log?.('process_failed', { jobId: job.id });
          results.push({ jobId: job.id, outcome: 'error', publicationId: null });
        }
      }
    }

    let checked = 0;
    try {
      checked = await deps.checkTokens(await deps.accountsToCheck());
    } catch {
      deps.log?.('token_check_failed', {});
    }
    deps.log?.('processed', { count: results.length, checked });
    return json(200, { processed: results.length, results, tokensChecked: checked });
  };
}
