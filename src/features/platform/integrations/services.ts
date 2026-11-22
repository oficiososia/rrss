// Las tarjetas de la vista sencilla de «Plataforma → Integraciones»: una por
// servicio, con un nombre llano, para qué sirve, el campo o campos
// imprescindibles y qué funciones de la aplicación enciende. Todo lo demás
// (cada ajuste del catálogo) cuelga de «Opciones avanzadas» de su tarjeta.
//
// Lógica pura, sin React: la usan la pantalla y sus pruebas. Cada ajuste del
// catálogo (catalog.ts) pertenece a UNA tarjeta; una prueba lo comprueba.
import type { IntegrationAvailability, IntegrationStatus } from './api';
import { TEXT_TASKS, UI_INTEGRATIONS, type AiTextTask, type IntegrationId, type UiGroup } from './catalog';

export type ServiceId =
  | 'openai'
  | 'claude'
  | 'meta'
  | 'storage'
  | 'video'
  | 'fal'
  | 'drive'
  | 'stripe'
  | 'comfyui'
  | 'images_other';

/** Lo que una tarjeta sabe de la configuración (sin valores secretos). */
export interface ServiceCtx {
  availability: IntegrationAvailability;
  /** ¿Está el ajuste guardado o en una variable del servidor? */
  has(key: string): boolean;
  /** Valor guardado de un ajuste que no es secreto. */
  value(key: string): string | undefined;
  /** Última prueba de «Probar conexión» de la integración que prueba esta tarjeta. */
  lastTest: { ok: boolean; message: string } | null;
}

export interface Unlock {
  label: string;
  on(ctx: ServiceCtx): boolean;
  /** Por qué no está activa (en llano). */
  why: string;
}

export interface ServiceDef {
  id: ServiceId;
  title: string;
  /** Para qué sirve, en una frase. */
  blurb: string;
  /** Opcional: sin configurar no es un problema. */
  optional?: boolean;
  /** Integración cuya prueba lanza «Probar conexión». */
  testIntegration: IntegrationId;
  /** Qué hace la prueba, en una frase (y que no gasta). */
  testHint: string;
  /** Ajustes de la vista sencilla, en orden. */
  simple: string[];
  /** Los imprescindibles (subconjunto de `simple`). */
  required: string[];
  /** Todos los ajustes de esta tarjeta. */
  keys: string[];
  /** Cómo se llama cada ajuste imprescindible cuando falta. */
  names?: Record<string, string>;
  /** Cosas que faltan aunque lo imprescindible esté puesto. */
  extraMissing?(ctx: ServiceCtx): string[];
  /** ¿Está configurada por otro camino? (p. ej. por Bedrock en lugar de por Vertex). */
  configuredAlso?(ctx: ServiceCtx): boolean;
  unlocks: Unlock[];
}

const taskLive = (ctx: ServiceCtx, task: AiTextTask) => ctx.availability.aiTextTasks?.[task] ?? ctx.availability.aiText;
const taskKeys = TEXT_TASKS.flatMap((t) => [`${t.prefix}_PROVIDER`, `${t.prefix}_MODEL`]);

export const SERVICES: ServiceDef[] = [
  {
    id: 'openai',
    title: 'OpenAI',
    blurb: 'Textos, copiloto, imágenes y subtítulos, con una sola clave.',
    testIntegration: 'ai_text',
    testHint: 'Pregunta a OpenAI qué modelos ve tu clave. No genera nada ni gasta.',
    simple: ['OPENAI_API_KEY'],
    required: ['OPENAI_API_KEY'],
    keys: [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_ORGANIZATION',
      'OPENAI_PROJECT',
      'AI_TRANSCRIPTION_MODEL',
      'AI_TEXT_PROVIDER',
      'AI_TEXT_MODEL',
      ...taskKeys,
      'AI_PRICES',
      'AI_PRICE_SNAPSHOT',
      'AI_ALLOW_NON_EU_PROCESSING',
      'AI_TIMEOUT_MS',
      'AI_GLOBAL_MONTHLY_CAP',
      'AI_MEDIA_IMAGE_MODEL',
      'AI_MEDIA_ALLOW_NON_EU',
    ],
    names: { OPENAI_API_KEY: 'la clave de OpenAI' },
    extraMissing(ctx) {
      if (ctx.availability.aiText && ctx.availability.reelSubtitles) return [];
      const out: string[] = [];
      if (!ctx.has('OPENAI_BASE_URL') && ctx.value('AI_ALLOW_NON_EU_PROCESSING') !== 'true') out.push('la región');
      if (!ctx.has('AI_TEXT_MODEL') && !ctx.has('AI_TEXT_PROVIDER')) out.push('el modelo de texto');
      if (!ctx.has('AI_PRICES')) out.push('los precios');
      return out;
    },
    unlocks: [
      {
        label: 'Pies de foto y textos de las piezas',
        on: (c) => taskLive(c, 'post.caption'),
        why: 'falta la clave o el modelo de texto',
      },
      {
        label: 'Copiloto por voz del editor',
        on: (c) => taskLive(c, 'editor.copilot'),
        why: 'falta la clave o el modelo de texto',
      },
      {
        label: 'Revisión de marca, planes de campaña y lectura de la analítica',
        on: (c) => taskLive(c, 'brand.check') && taskLive(c, 'campaign.plan') && taskLive(c, 'analytics.summary'),
        why: 'falta la clave o el modelo de texto',
      },
      {
        label: 'Crear y editar imágenes con IA',
        on: (c) => c.availability.aiImage,
        why: 'falta la clave, el modelo de imagen o el permiso de región',
      },
      {
        label: 'Subtítulos automáticos de los reels',
        on: (c) => c.availability.reelSubtitles,
        why: 'falta la clave, la región o el precio de la transcripción',
      },
    ],
  },
  {
    id: 'claude',
    title: 'Claude (Anthropic / Google Cloud)',
    blurb: 'Otra forma de redactar y montar piezas. No hace falta para empezar.',
    optional: true,
    testIntegration: 'ai_text',
    testHint: 'Si alguna tarea usa Claude, comprueba su acceso. No genera nada ni gasta.',
    simple: ['AI_VERTEX_PROJECT_ID', 'AI_VERTEX_LOCATION', 'AI_VERTEX_SERVICE_ACCOUNT_JSON'],
    required: ['AI_VERTEX_PROJECT_ID', 'AI_VERTEX_LOCATION', 'AI_VERTEX_SERVICE_ACCOUNT_JSON'],
    keys: [
      'AI_VERTEX_PROJECT_ID',
      'AI_VERTEX_LOCATION',
      'AI_VERTEX_SERVICE_ACCOUNT_JSON',
      'ANTHROPIC_API_KEY',
      'MISTRAL_API_KEY',
      'AI_BEDROCK_REGION',
      'AI_BEDROCK_ACCESS_KEY_ID',
      'AI_BEDROCK_SECRET_ACCESS_KEY',
      'AI_BEDROCK_BEARER_TOKEN',
    ],
    names: {
      AI_VERTEX_PROJECT_ID: 'el proyecto de Google Cloud',
      AI_VERTEX_LOCATION: 'la región de Google Cloud',
      AI_VERTEX_SERVICE_ACCOUNT_JSON: 'la cuenta de servicio de Google',
    },
    configuredAlso: (c) => c.has('ANTHROPIC_API_KEY') || (c.has('AI_BEDROCK_REGION') && c.has('AI_BEDROCK_BEARER_TOKEN')),
    unlocks: [
      {
        label: 'Usar Claude en alguna tarea de texto (se elige en «Opciones avanzadas» de OpenAI)',
        on: (c) => c.has('AI_VERTEX_SERVICE_ACCOUNT_JSON') && c.availability.aiText,
        why: 'hace falta el acceso de Google Cloud y elegir Claude para una tarea',
      },
    ],
  },
  {
    id: 'meta',
    title: 'Instagram (Meta)',
    blurb: 'Conectar cuentas de Instagram para publicar y medir.',
    testIntegration: 'meta',
    testHint: 'Pregunta a Meta si reconoce la aplicación. No publica nada.',
    simple: ['META_APP_ID', 'META_APP_SECRET', 'SOCIAL_APP_URL', 'SOCIAL_TOKEN_KEYS'],
    required: ['META_APP_ID', 'META_APP_SECRET', 'SOCIAL_APP_URL', 'SOCIAL_TOKEN_KEYS'],
    keys: [
      'META_APP_ID',
      'META_APP_SECRET',
      'META_LOGIN_CONFIG_ID',
      'META_GRAPH_API_VERSION',
      'SOCIAL_APP_URL',
      'SOCIAL_TOKEN_KEYS',
      'SOCIAL_TOKEN_KEY_ID',
    ],
    names: {
      META_APP_ID: 'el identificador de la aplicación de Meta',
      META_APP_SECRET: 'el secreto de la aplicación de Meta',
      SOCIAL_APP_URL: 'la dirección de la aplicación',
      SOCIAL_TOKEN_KEYS: 'la clave de cifrado de las cuentas',
    },
    unlocks: [
      { label: 'Publicar y programar en Instagram', on: (c) => c.availability.publishing, why: 'falta la clave de cifrado' },
      { label: 'Botón «Conectar con Meta»', on: (c) => c.availability.socialOAuth, why: 'falta la aplicación de Meta o su dirección' },
    ],
  },
  {
    id: 'storage',
    title: 'Almacenamiento (Cloudflare R2)',
    blurb: 'Dónde se guardan las fotos, los vídeos y las exportaciones.',
    optional: true,
    testIntegration: 'r2',
    testHint: 'Pregunta a Cloudflare si el cubo existe y la clave puede usarlo. No sube nada.',
    simple: ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
    required: ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
    keys: ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_JURISDICTION', 'MEDIA_UPLOAD_BACKEND'],
    names: {
      R2_ACCOUNT_ID: 'el identificador de la cuenta de Cloudflare',
      R2_BUCKET: 'el nombre del cubo',
      R2_ACCESS_KEY_ID: 'la clave de acceso',
      R2_SECRET_ACCESS_KEY: 'la clave secreta',
    },
    unlocks: [
      {
        label: 'Guardar fotos, vídeos y exportaciones en Cloudflare (en lugar de Supabase)',
        on: (c) => c.availability.mediaStorage,
        why: 'faltan datos del cubo',
      },
    ],
  },
  {
    id: 'video',
    title: 'Máquina de vídeo (Fly.io)',
    blurb: 'Monta los reels, recorta fondos y genera los informes en PDF.',
    testIntegration: 'media_worker',
    testHint: 'Pregunta a Fly si la máquina existe y el token sirve. No la arranca.',
    simple: ['FLY_API_TOKEN', 'FLY_APP', 'FLY_MACHINE_ID', 'WORKER_GATEWAY_TOKEN'],
    required: ['FLY_API_TOKEN', 'FLY_APP', 'FLY_MACHINE_ID', 'WORKER_GATEWAY_TOKEN'],
    keys: ['FLY_API_TOKEN', 'FLY_APP', 'FLY_MACHINE_ID', 'WORKER_GATEWAY_TOKEN', 'MEDIA_JOBS_MONTHLY_PER_BRAND'],
    names: {
      FLY_API_TOKEN: 'el token de Fly',
      FLY_APP: 'el nombre de la app de Fly',
      FLY_MACHINE_ID: 'el identificador de la máquina',
      WORKER_GATEWAY_TOKEN: 'el token del trabajador',
    },
    unlocks: [
      {
        label: 'Montar reels, recortar fondos y generar informes en PDF',
        on: (c) => ['FLY_API_TOKEN', 'FLY_APP', 'FLY_MACHINE_ID', 'WORKER_GATEWAY_TOKEN'].every((k) => c.has(k)),
        why: 'faltan datos de la máquina',
      },
    ],
  },
  {
    id: 'fal',
    title: 'fal.ai — animar fotos',
    blurb: 'Convierte una foto en un vídeo corto con IA. Procesa fuera de la UE.',
    optional: true,
    testIntegration: 'ai_image',
    testHint: 'Consulta el precio de sus modelos de animar fotos. No genera nada.',
    simple: ['FAL_KEY'],
    required: ['FAL_KEY'],
    keys: ['FAL_KEY'],
    names: { FAL_KEY: 'la clave de fal.ai' },
    extraMissing: (c) =>
      c.has('FAL_KEY') && c.value('AI_MEDIA_ALLOW_NON_EU') !== 'true' ? ['el permiso de procesar fuera de la UE'] : [],
    unlocks: [
      {
        label: 'Animar una foto con IA',
        on: (c) => c.has('FAL_KEY') && c.value('AI_MEDIA_ALLOW_NON_EU') === 'true',
        why: 'falta la clave o permitir el tratamiento fuera de la UE',
      },
    ],
  },
  {
    id: 'drive',
    title: 'Google Drive',
    blurb: 'Usar las fotos de Drive en la biblioteca sin copiarlas.',
    optional: true,
    testIntegration: 'google_drive',
    testHint: 'Comprueba que la configuración está completa. Google no deja validar el cliente sin conectar una cuenta.',
    simple: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET'],
    required: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET'],
    keys: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'DRIVE_APP_URL'],
    names: {
      GOOGLE_DRIVE_CLIENT_ID: 'el identificador de cliente de Google',
      GOOGLE_DRIVE_CLIENT_SECRET: 'el secreto de cliente de Google',
    },
    extraMissing: (c) =>
      c.has('GOOGLE_DRIVE_CLIENT_ID') && c.has('GOOGLE_DRIVE_CLIENT_SECRET') && !c.availability.drive
        ? ['la dirección de la aplicación o la clave de cifrado de las cuentas']
        : [],
    unlocks: [
      { label: 'Elegir fotos desde Google Drive', on: (c) => c.availability.drive, why: 'falta alguno de los datos de Google' },
    ],
  },
  {
    id: 'stripe',
    title: 'Pagos (Stripe)',
    blurb: 'Cobrar los planes a las organizaciones.',
    testIntegration: 'stripe',
    testHint: 'Lee los datos de la cuenta de Stripe. No cobra nada.',
    simple: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_APP_URL'],
    required: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_APP_URL'],
    keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_APP_URL'],
    names: {
      STRIPE_SECRET_KEY: 'la clave secreta de Stripe',
      STRIPE_WEBHOOK_SECRET: 'el secreto de los avisos de Stripe',
      BILLING_APP_URL: 'la dirección de la aplicación',
    },
    unlocks: [{ label: 'Cobrar los planes con tarjeta', on: (c) => c.availability.billing, why: 'faltan datos de Stripe' }],
  },
  {
    id: 'comfyui',
    title: 'ComfyUI propio',
    blurb: 'Crear imágenes con modelos abiertos en tu propio servidor.',
    optional: true,
    testIntegration: 'comfyui',
    testHint: 'Pide a ComfyUI su estado. No genera ninguna imagen.',
    simple: ['COMFYUI_BASE_URL', 'COMFYUI_API_TOKEN'],
    required: ['COMFYUI_BASE_URL'],
    keys: ['COMFYUI_BASE_URL', 'COMFYUI_API_TOKEN', 'COMFYUI_DATA_REGION'],
    names: { COMFYUI_BASE_URL: 'la dirección del servidor' },
    unlocks: [
      {
        label: 'Crear imágenes con tu ComfyUI',
        on: (c) => c.has('COMFYUI_BASE_URL'),
        why: 'falta la dirección del servidor',
      },
    ],
  },
  {
    id: 'images_other',
    title: 'Otras imágenes con IA',
    blurb: 'Google (Gemini), Black Forest Labs (FLUX) e Ideogram, para crear imágenes. Opcional.',
    optional: true,
    testIntegration: 'ai_image',
    testHint: 'Pide un token a Google o el saldo a Black Forest Labs. No genera nada.',
    simple: ['BFL_API_KEY'],
    required: ['BFL_API_KEY'],
    keys: [
      'BFL_API_KEY',
      'BFL_API_BASE_URL',
      'IDEOGRAM_API_KEY',
      'GOOGLE_VERTEX_PROJECT_ID',
      'GOOGLE_VERTEX_LOCATION',
      'GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON',
    ],
    names: { BFL_API_KEY: 'la clave de Black Forest Labs' },
    configuredAlso: (c) => c.has('GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON') || c.has('IDEOGRAM_API_KEY'),
    unlocks: [
      {
        label: 'Más modelos de imagen para crear',
        on: (c) => c.has('BFL_API_KEY') || c.has('GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON') || c.has('IDEOGRAM_API_KEY'),
        why: 'falta la clave de algún proveedor',
      },
    ],
  },
];

export const SERVICE_BY_ID = Object.fromEntries(SERVICES.map((s) => [s.id, s])) as Record<ServiceId, ServiceDef>;

/** Ajustes del catálogo que no pertenecen a ninguna tarjeta, o que pertenecen a dos. Debe salir vacío. */
export function catalogCoverageProblems(): string[] {
  const owners = new Map<string, number>();
  for (const s of SERVICES) for (const k of s.keys) owners.set(k, (owners.get(k) ?? 0) + 1);
  const all = UI_INTEGRATIONS.flatMap((i) => i.groups.flatMap((g) => g.fields.map((f) => f.key)));
  const problems: string[] = [];
  for (const k of all) if (!owners.has(k)) problems.push(`${k}: sin tarjeta`);
  for (const [k, n] of owners) {
    if (n > 1) problems.push(`${k}: en ${n} tarjetas`);
    if (!all.includes(k)) problems.push(`${k}: no está en el catálogo`);
  }
  for (const s of SERVICES) {
    for (const k of s.simple) if (!s.keys.includes(k)) problems.push(`${s.id}/${k}: sencillo fuera de la tarjeta`);
    for (const k of s.required) if (!s.simple.includes(k)) problems.push(`${s.id}/${k}: imprescindible fuera de lo sencillo`);
  }
  return problems;
}

/** Los grupos de «Opciones avanzadas»: lo que el catálogo trae para esta tarjeta y no está en la vista sencilla. */
export function advancedGroups(service: ServiceDef): UiGroup[] {
  const mine = new Set(service.keys);
  const simple = new Set(service.simple);
  const out: UiGroup[] = [];
  for (const integration of UI_INTEGRATIONS) {
    for (const group of integration.groups) {
      const fields = group.fields.filter((f) => mine.has(f.key) && !simple.has(f.key) && !f.hidden);
      if (fields.length > 0) out.push({ ...group, fields });
    }
  }
  return out;
}

/** Los campos de la vista sencilla, en el orden de la tarjeta. */
export function simpleFields(service: ServiceDef) {
  const all = new Map(UI_INTEGRATIONS.flatMap((i) => i.groups.flatMap((g) => g.fields.map((f) => [f.key, f] as const))));
  return service.simple.map((k) => all.get(k)!).filter(Boolean);
}

// ───────────────────────────── estado ─────────────────────────────

export type StatusWord = 'Funciona' | 'Sin probar' | 'No funciona' | 'Falta la clave' | 'Falta algo' | 'Sin configurar';
export interface ServiceStatus {
  word: StatusWord;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** Qué falta o por qué falla, en una frase. */
  detail: string | null;
}

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;

export function serviceStatus(service: ServiceDef, ctx: ServiceCtx): ServiceStatus {
  const present = service.required.filter((k) => ctx.has(k));
  const configuredElsewhere = service.configuredAlso?.(ctx) ?? false;
  if (present.length === 0 && !configuredElsewhere) {
    return service.optional
      ? { word: 'Sin configurar', tone: 'neutral', detail: 'Opcional.' }
      : { word: 'Falta la clave', tone: 'warning', detail: null };
  }
  if (!configuredElsewhere) {
    const missing = service.required
      .filter((k) => !ctx.has(k))
      .map((k) => service.names?.[k] ?? k)
      .concat(service.extraMissing?.(ctx) ?? []);
    if (missing.length > 0) return { word: 'Falta algo', tone: 'warning', detail: `Falta ${list(missing)}.` };
  } else {
    const extra = service.extraMissing?.(ctx) ?? [];
    if (extra.length > 0) return { word: 'Falta algo', tone: 'warning', detail: `Falta ${list(extra)}.` };
  }
  if (!ctx.lastTest) return { word: 'Sin probar', tone: 'neutral', detail: 'Pulsa «Probar conexión» para comprobarlo.' };
  return ctx.lastTest.ok
    ? { word: 'Funciona', tone: 'success', detail: null }
    : { word: 'No funciona', tone: 'danger', detail: ctx.lastTest.message };
}

// ───────────────────────────── resumen de arriba ─────────────────────────────

export interface SummaryItem {
  label: string;
  on: (a: IntegrationAvailability) => boolean;
  /** De qué tarjeta depende. */
  needs: ServiceId;
}

const live = (a: IntegrationAvailability, task: AiTextTask) => a.aiTextTasks?.[task] ?? a.aiText;

/** «Qué funciona ahora»: las funciones que la gente nota, en lenguaje llano. */
export const SUMMARY: SummaryItem[] = [
  { label: 'Escribir pies de foto y textos', on: (a) => live(a, 'post.caption'), needs: 'openai' },
  { label: 'Copiloto por voz del editor', on: (a) => live(a, 'editor.copilot'), needs: 'openai' },
  {
    label: 'Revisar la marca, planear campañas y leer la analítica',
    on: (a) => live(a, 'brand.check') && live(a, 'campaign.plan') && live(a, 'analytics.summary'),
    needs: 'openai',
  },
  { label: 'Crear y editar imágenes con IA', on: (a) => a.aiImage, needs: 'openai' },
  { label: 'Subtítulos automáticos de los reels', on: (a) => a.reelSubtitles, needs: 'openai' },
  { label: 'Publicar en Instagram', on: (a) => a.publishing, needs: 'meta' },
  { label: 'Fotos desde Google Drive', on: (a) => a.drive, needs: 'drive' },
  { label: 'Cobrar los planes', on: (a) => a.billing, needs: 'stripe' },
];

/** Lo que la tarjeta sabe de la configuración (sin valores secretos). */
export function buildServiceCtx(service: ServiceDef, status: IntegrationStatus): ServiceCtx {
  const stored = new Map(status.settings.map((s) => [s.setting_key, s]));
  const fromEnv = new Set(status.environment);
  const value = (key: string) => {
    const row = stored.get(key);
    return row && !row.is_secret ? (row.value ?? undefined) : undefined;
  };
  const usesClaude = ['AI_TEXT_PROVIDER', ...UI_INTEGRATIONS.flatMap((i) =>
    i.groups.flatMap((g) => g.fields.map((f) => f.key).filter((k) => k.endsWith('_PROVIDER') && k.startsWith('AI_TEXT_'))),
  )].some((k) => (value(k) ?? '').startsWith('anthropic'));
  const test = status.tests.find((t) => t.integration === service.testIntegration);
  // La prueba de «IA de texto» es de todos los proveedores: a Claude solo le sirve si alguna tarea lo usa.
  const lastTest = test && (service.id !== 'claude' || usesClaude) ? { ok: test.ok, message: test.message } : null;
  return {
    availability: status.availability,
    has: (key) => stored.has(key) || fromEnv.has(key),
    value,
    lastTest,
  };
}

