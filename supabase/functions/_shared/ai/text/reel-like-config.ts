// Qué modelo sirve «Hacer un reel como este» (propósito `reel.like`).
//
// No es una tarea más de `TEXT_PURPOSES` (config.ts) a propósito: aquellas
// alimentan la disponibilidad por tarea de «Plataforma → Integraciones», y esta
// función tiene la suya (`ai-reel-like`, acción `options`). Se resuelve con las
// MISMAS reglas y credenciales que el resto del texto (`loadAiTextConfig`):
//
//   AI_TEXT_REEL_LIKE_PROVIDER / AI_TEXT_REEL_LIKE_MODEL   (secretos de la función), o, si no están,
//   AI_TEXT_PROVIDER / AI_TEXT_MODEL                        (Integraciones → IA de texto)
//
// con el precio de `AI_PRICES` para ese adaptador y modelo. El modelo tiene que
// saber mirar imágenes (text/vision.ts): si su adaptador no las admite, no hay
// función. El proveedor simulado solo existe con la guarda de las pruebas
// locales (local-test.ts).
import type { AiModelSpec } from '../contract.ts';
import { SIMULATED_PROVIDER_ID } from '../simulated-provider.ts';
import { loadAiTextConfig, type AiTextConfig, type Env } from './config.ts';
import type { FetchLike } from './http.ts';
import { loadLocalTestTextConfig } from './local-test.ts';
import { supportsImages } from './vision.ts';

export const REEL_LIKE_PURPOSE = 'reel.like';
export const REEL_LIKE_ENV_PREFIX = 'AI_TEXT_REEL_LIKE';

export interface ReelLikeTextConfig extends AiTextConfig {
  /** El modelo de `reel.like` con su precio, si hay uno elegido. */
  spec: AiModelSpec | null;
  /** ¿Está cargado su adaptador y admite imágenes? Sin esto, la función no se ofrece. */
  ready: boolean;
}

const value = (env: Env, name: string): string | undefined => {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
};

export function loadReelLikeTextConfig(env: Env, options: { fetch?: FetchLike } = {}): ReelLikeTextConfig {
  // Pruebas locales: el simulado cuenta las imágenes, no las mira.
  const local = loadLocalTestTextConfig(env);
  if (local) {
    const any = local.models[0];
    const spec: AiModelSpec | null = any ? { ...any, purposes: [REEL_LIKE_PURPOSE] } : null;
    return { ...local, models: spec ? [spec] : [], spec, ready: Boolean(spec && spec.provider === SIMULATED_PROVIDER_ID) };
  }

  // Una sola ruta: la propia de esta función o la general. Las de las demás tareas no cuentan aquí.
  const scoped: Env = {};
  for (const [key, raw] of Object.entries(env)) {
    if (/^AI_TEXT_[A-Z_]+_(PROVIDER|MODEL)$/.test(key)) continue;
    scoped[key] = raw;
  }
  const provider = value(env, `${REEL_LIKE_ENV_PREFIX}_PROVIDER`) ?? value(env, 'AI_TEXT_PROVIDER');
  const model = value(env, `${REEL_LIKE_ENV_PREFIX}_MODEL`) ?? value(env, 'AI_TEXT_MODEL');
  if (provider) scoped.AI_TEXT_PROVIDER = provider;
  else delete scoped.AI_TEXT_PROVIDER;
  if (model) scoped.AI_TEXT_MODEL = model;
  else delete scoped.AI_TEXT_MODEL;

  const base = loadAiTextConfig(scoped, options);
  const route = base.models[0];
  const spec: AiModelSpec | null = route ? { ...route, purposes: [REEL_LIKE_PURPOSE] } : null;
  const problems = [...new Set(base.problems)];
  const loaded = Boolean(spec && base.providers.some((p) => p.id === spec.provider));
  const vision = Boolean(spec && supportsImages(spec.provider));
  if (spec && loaded && !vision) {
    problems.push(
      `«Hacer un reel como este» necesita un modelo que mire imágenes y el adaptador «${spec.provider}» no las admite: define ${REEL_LIKE_ENV_PREFIX}_PROVIDER y ${REEL_LIKE_ENV_PREFIX}_MODEL.`,
    );
  }
  return { ...base, problems, models: spec ? [spec] : [], spec, ready: loaded && vision };
}
