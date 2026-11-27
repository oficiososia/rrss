import {
  aiImageEnabled,
  aiTextEnabled,
  driveLibraryEnabled,
  reelSubtitlesEnabled,
  socialPublishingEnabled,
} from '@/config/app';
import { billingEnabled } from '@/features/billing/labels';
import { useIntegrationAvailability, type AiTextTask, type IntegrationAvailability } from './api';

// Interruptores de la interfaz. Una parte del producto se enseña solo si:
//   1. este despliegue la permite (variable `VITE_*` de compilación), y
//   2. el servidor dice que su integración está configurada
//      (`platform-integrations`, acción `availability`; sin valores).
// Así lo que no funciona sigue sin salir, y las claves se meten desde
// «Plataforma → Integraciones» sin volver a compilar: la variable de
// compilación se pone una vez por despliegue (decide QUÉ módulos ofrece ese
// despliegue) y el servidor decide si de verdad funcionan. Mientras no hay
// respuesta del servidor, o si falla, no se enseña.

export type Feature = 'aiText' | 'aiImage' | 'publishing' | 'billing' | 'drive' | 'mediaStorage' | 'reelSubtitles';

const BUILD_FLAGS: Record<Feature, () => boolean> = {
  aiText: aiTextEnabled,
  aiImage: aiImageEnabled,
  publishing: socialPublishingEnabled,
  billing: billingEnabled,
  drive: driveLibraryEnabled,
  // Archivos en Cloudflare R2: sin variable de compilación. Si el servidor guarda
  // archivos en R2, la aplicación tiene que saber leerlos en cualquier despliegue.
  mediaStorage: () => true,
  // Subtítulos automáticos de los reels: interruptor propio y OpenAI configurado en el servidor.
  reelSubtitles: reelSubtitlesEnabled,
};

export function useFeature(feature: Feature): boolean {
  return useFeatureStatus(feature) === true;
}

/**
 * Igual que `useFeature`, pero distingue «todavía no se sabe» (`undefined`,
 * mientras el servidor responde) para las pantallas que, si no está, redirigen.
 */
export function useFeatureStatus(feature: Feature): boolean | undefined {
  const allowed = BUILD_FLAGS[feature]();
  const availability = useIntegrationAvailability(allowed);
  if (!allowed) return false;
  if (availability.isPending) return undefined;
  return availability.data?.[feature] === true;
}

/**
 * ¿Se puede usar esta tarea de texto? Hace falta el interruptor de compilación
 * y que el servidor diga que ESA tarea tiene proveedor, modelo y precio: que
 * otra tarea esté configurada no enciende ésta (el botón fallaría con
 * `not_configured`). Mientras no hay respuesta, o si falla, no se enseña.
 * Un servidor antiguo, que no manda la lista por tarea, se trata como antes
 * (vale `aiText`); solo ocurre mientras las funciones no se han redesplegado.
 */
export function useTextTask(task: AiTextTask): boolean {
  return useTextTaskStatus(task) === true;
}

/** Igual que `useTextTask`, pero distingue «todavía no se sabe» (`undefined`). */
export function useTextTaskStatus(task: AiTextTask): boolean | undefined {
  const allowed = aiTextEnabled();
  const availability = useIntegrationAvailability(allowed);
  if (!allowed) return false;
  if (availability.isPending) return undefined;
  const data = availability.data;
  if (!data) return false;
  return data.aiTextTasks ? data.aiTextTasks[task] === true : data.aiText === true;
}

/** Cómo se puede conectar una cuenta de Instagram en este entorno. */
export function useSocialConnectModes(): Pick<IntegrationAvailability, 'socialOAuth' | 'socialToken'> & {
  publishing: boolean;
} {
  const allowed = socialPublishingEnabled();
  const availability = useIntegrationAvailability(allowed);
  const data = allowed ? availability.data : undefined;
  return {
    publishing: data?.publishing === true,
    socialOAuth: data?.socialOAuth === true,
    socialToken: data?.socialToken === true,
  };
}
