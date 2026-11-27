// ¿Qué integraciones están configuradas y listas en este entorno? Es lo que la
// interfaz pregunta para decidir qué enseña (src/features/platform/integrations/
// availability.ts). Solo booleanos: nunca un valor ni el nombre de lo que falta.
//
// Se calcula con la MISMA lógica con la que las funciones cargan cada servicio
// (los cargadores de config.ts de cada uno), sobre la configuración efectiva
// (base de datos y, si no, entorno). Que esté configurada no garantiza que la
// clave sea buena: eso lo dice «Probar conexión».
//
// Sin dependencias de Deno ni de Node: lo usan las funciones y las pruebas.
import type { MediaReader, MediaStorage } from '../ai/media/contract.ts';
import type { MediaModelRow } from '../ai/media/models.ts';
import { createMediaRuntime } from '../ai/media/runtime.ts';
import { loadAiTextConfig, TEXT_PURPOSES, type TextPurpose } from '../ai/text/config.ts';
import { transcriptionReady } from '../ai/transcription/config.ts';
import { loadLocalTestTextConfig } from '../ai/text/local-test.ts';
import { TEXT_UNITS } from '../ai/text/prompt.ts';
import { normalizeAppUrl } from '../billing/handlers.ts';
import { loadDriveConfig } from '../drive/config.ts';
import { loadSocialConfig } from '../social/config.ts';
import { loadMediaStorageConfig, mediaStorageReady } from '../storage/config.ts';
import type { Env } from './settings.ts';

export interface IntegrationAvailability {
  /** Publicar y medir en Instagram: hay claves de cifrado de los tokens. */
  publishing: boolean;
  /** Conectar por OAuth: además, la aplicación de Meta del producto. */
  socialOAuth: boolean;
  /** Conectar pegando un token de página (no necesita la aplicación del producto). */
  socialToken: boolean;
  /** Alguna tarea de texto tiene proveedor, modelo y precio. Para saber qué botón sale, `aiTextTasks`. */
  aiText: boolean;
  /**
   * Una por tarea de texto: `true` solo si esa tarea tiene proveedor cargado,
   * modelo y precio completo. Cada botón de la interfaz mira SU tarea, no la
   * disponibilidad general: configurar una sola tarea no enciende las demás.
   */
  aiTextTasks: Record<TextPurpose, boolean>;
  aiImage: boolean;
  billing: boolean;
  /** Biblioteca con Google Drive: cliente OAuth, direcciones y claves de cifrado. */
  drive: boolean;
  /** Archivos de la biblioteca en Cloudflare R2: cuenta, clave y cubo. */
  mediaStorage: boolean;
  /** Subtítulos automáticos de los reels: OpenAI cargable (clave y criterio de la UE) con precio. */
  reelSubtitles: boolean;
}

const NO_TEXT_TASKS = Object.fromEntries(TEXT_PURPOSES.map((purpose) => [purpose, false])) as Record<
  TextPurpose,
  boolean
>;

export const NOTHING_AVAILABLE: IntegrationAvailability = {
  publishing: false,
  socialOAuth: false,
  socialToken: false,
  aiText: false,
  aiTextTasks: { ...NO_TEXT_TASKS },
  aiImage: false,
  billing: false,
  drive: false,
  mediaStorage: false,
  reelSubtitles: false,
};

const unused = () => {
  throw new Error('No se usa al calcular la disponibilidad');
};

/**
 * Qué tareas de texto se pueden usar: la tarea tiene una ruta (la suya o la
 * general de «todo el texto»), su adaptador se ha cargado (credenciales y
 * criterio de datos) y su modelo tiene el precio completo. Es la misma
 * comprobación que hace el servicio al generar; si aquí sale `true` y la
 * clave es mala, lo dirá «Probar conexión», no esta lista.
 */
export function textTaskReadiness(env: Env): Record<TextPurpose, boolean> {
  if (loadLocalTestTextConfig(env))
    return Object.fromEntries(TEXT_PURPOSES.map((p) => [p, true])) as Record<TextPurpose, boolean>;
  const config = loadAiTextConfig(env);
  const loaded = new Set(config.providers.map((p) => p.id));
  const ready = { ...NO_TEXT_TASKS };
  for (const model of config.models) {
    if (!loaded.has(model.provider)) continue;
    const needed: string[] = [TEXT_UNITS.input, TEXT_UNITS.output, TEXT_UNITS.cacheRead];
    if (model.provider !== 'mistral' && model.provider !== 'openai') needed.push(TEXT_UNITS.cacheWrite);
    if (!needed.every((unit) => model.microsPerUnit[unit] !== undefined)) continue;
    for (const purpose of model.purposes ?? []) {
      if ((TEXT_PURPOSES as readonly string[]).includes(purpose)) ready[purpose as TextPurpose] = true;
    }
  }
  return ready;
}

/** Lo mismo que necesita drive-media para conectar y servir imágenes. */
export function driveReady(config: ReturnType<typeof loadDriveConfig>): boolean {
  return config.client !== null && config.keyRing !== null && config.callbackUrl !== null && config.appUrl !== null;
}

/** Lanza solo si la configuración de una prueba local está mal puesta (la función tampoco arrancaría). */
export function computeAvailability(env: Env, imageModelRows: MediaModelRow[]): IntegrationAvailability {
  const social = loadSocialConfig(env, async () => {
    throw new Error('Sin red al calcular la disponibilidad');
  });
  const publishing = social.keyRing !== null;

  const runtime = createMediaRuntime({
    env,
    fetch: async () => unused(),
    rpc: async () => unused(),
    reader: { getGeneration: unused, getJob: unused } as unknown as MediaReader,
    storage: {} as MediaStorage,
    modelRows: imageModelRows,
  });

  const drive = loadDriveConfig(env, async () => unused());

  const aiTextTasks = textTaskReadiness(env);
  const webhook = (env.STRIPE_WEBHOOK_SECRET ?? '').split(',').some((s) => s.trim());
  return {
    publishing,
    socialOAuth: publishing && social.meta !== null && social.callbackUrl !== null && social.appUrl !== null,
    socialToken: publishing,
    aiText: Object.values(aiTextTasks).some(Boolean),
    aiTextTasks,
    aiImage: runtime.imageChoices.length > 0,
    billing: Boolean(env.STRIPE_SECRET_KEY?.trim()) && webhook && normalizeAppUrl(env.BILLING_APP_URL) !== null,
    drive: driveReady(drive),
    mediaStorage: mediaStorageReady(loadMediaStorageConfig(env)),
    reelSubtitles: transcriptionReady(env),
  };
}
