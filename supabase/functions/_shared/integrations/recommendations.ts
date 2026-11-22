// Qué modelo sugiere la pantalla de Integraciones para cada tarea, y por qué.
//
// ÚNICO archivo de datos que hay que tocar para cambiar una recomendación o
// añadir un modelo nuevo (los precios NO están aquí: se leen al día de la fuente
// de precios, ver pricing.ts). Origen: docs/modelos-ia-comparativa.md (22/11/2026).
//
// Reglas:
//   * Los candidatos van en orden de preferencia. La pantalla propone el primero
//     que existe en la lista de modelos de la cuenta (y tiene precio); si no, el
//     siguiente.
//   * `measured` dice qué se ha medido de verdad. Lo que no se ha medido con
//     nuestros casos se dice así, sin inventar calidades.
//   * `usage` y `monthlyUses` son SUPUESTOS para estimar el coste, no medidas:
//     los de copiloto y pies salen de docs/modelos-ia-comparativa.md §2 y los
//     demás son supuestos propios (marcados).
//
// Sin dependencias de Deno ni de Node.

export const UNMEASURED = 'sin medir con nuestros casos';

export type RecProvider = 'openai' | 'claude';
export type RecTaskId =
  | 'copilot'
  | 'captions'
  | 'profile'
  | 'brand'
  | 'campaigns'
  | 'analytics'
  | 'image_create'
  | 'photo_edit'
  | 'subtitles';

export interface RecCandidate {
  /** Identificador del modelo tal como lo llama el proveedor. */
  model: string;
  /** Una línea de por qué, en español llano. */
  why: string;
  /** Qué se ha medido (o `UNMEASURED`). */
  measured: string;
}

export interface RecTask {
  id: RecTaskId;
  /** En español llano, para la pantalla. */
  label: string;
  kind: 'text' | 'image' | 'transcription';
  /** Nombre de la tarea en el servidor (`purpose`) cuando es de texto. */
  purpose?: string;
  /** Prefijo de sus ajustes AI_TEXT_<TAREA>_* cuando es de texto. */
  prefix?: string;
  /** Supuesto de consumo de un uso (solo texto). */
  usage?: { inputTokens: number; outputTokens: number; assumption: string };
  /** Usos al mes en un uso normal (5-10 marcas): ver docs/modelos-ia-comparativa.md §2. */
  monthlyUses: number;
  /** Unidad de «un uso» para el texto de la pantalla. */
  unit: string;
  candidates: Partial<Record<RecProvider, RecCandidate[]>>;
}

const FROM_DOC = 'docs/modelos-ia-comparativa.md §2';
const MEASURED_COPILOT = 'medido: 12 de 12 casos del copiloto (docs/copiloto-voz.md §8)';

export const RECOMMENDED_TASKS: RecTask[] = [
  {
    id: 'copilot',
    label: 'Copiloto por voz del editor',
    kind: 'text',
    purpose: 'editor.copilot',
    prefix: 'AI_TEXT_EDITOR_COPILOT',
    usage: { inputTokens: 2300, outputTokens: 200, assumption: `Supuesto de ${FROM_DOC}` },
    monthlyUses: 3000,
    unit: 'orden',
    candidates: {
      openai: [
        { model: 'gpt-6-luna', why: 'Rápido y barato para órdenes cortas.', measured: UNMEASURED },
        {
          model: 'gpt-6.1-terra',
          why: 'Más fiable que el barato si falla con las órdenes; cuesta unas 10 veces más.',
          measured: UNMEASURED,
        },
      ],
      claude: [
        { model: 'claude-haiku-5-5', why: 'Rápido y barato para órdenes cortas.', measured: MEASURED_COPILOT },
        {
          model: 'claude-sonnet-5-5',
          why: 'Para montar una pieza desde cero, no para órdenes sueltas.',
          measured: MEASURED_COPILOT,
        },
      ],
    },
  },
  {
    id: 'captions',
    label: 'Pies de foto y textos de las piezas',
    kind: 'text',
    purpose: 'post.caption',
    prefix: 'AI_TEXT_POST_CAPTION',
    usage: { inputTokens: 1500, outputTokens: 400, assumption: `Supuesto de ${FROM_DOC}` },
    monthlyUses: 1000,
    unit: 'pie',
    candidates: {
      openai: [
        {
          model: 'gpt-6.1-terra',
          why: 'Mejor redacción que el barato; es el candidato de la comparativa para pies en español.',
          measured: UNMEASURED,
        },
        { model: 'gpt-6.2-sol', why: 'Redacta algo mejor y cuesta el doble.', measured: UNMEASURED },
        { model: 'gpt-6-luna', why: 'Barato, pero redacta peor.', measured: UNMEASURED },
      ],
      claude: [
        {
          model: 'claude-sonnet-5-5',
          why: 'Mejor redacción en español de los candidatos de la comparativa.',
          measured: UNMEASURED,
        },
        { model: 'claude-haiku-5-5', why: 'Barato, pero redacta peor.', measured: UNMEASURED },
      ],
    },
  },
  {
    id: 'profile',
    label: 'Propuesta de perfil de marca',
    kind: 'text',
    purpose: 'profile.proposal',
    prefix: 'AI_TEXT_PROFILE_PROPOSAL',
    usage: { inputTokens: 4000, outputTokens: 1500, assumption: 'Supuesto propio' },
    monthlyUses: 20,
    unit: 'propuesta',
    candidates: {
      openai: [
        { model: 'gpt-6.1-terra', why: 'Se hace pocas veces y conviene que redacte bien.', measured: UNMEASURED },
        { model: 'gpt-6.2-sol', why: 'Redacta algo mejor y cuesta el doble.', measured: UNMEASURED },
        { model: 'gpt-6-luna', why: 'Barato, pero redacta peor.', measured: UNMEASURED },
      ],
      claude: [
        { model: 'claude-sonnet-5-5', why: 'Se hace pocas veces y conviene que redacte bien.', measured: UNMEASURED },
        { model: 'claude-haiku-5-5', why: 'Barato, pero redacta peor.', measured: UNMEASURED },
      ],
    },
  },
  {
    id: 'brand',
    label: 'Revisión de marca',
    kind: 'text',
    purpose: 'brand.check',
    prefix: 'AI_TEXT_BRAND_CHECK',
    usage: { inputTokens: 1500, outputTokens: 300, assumption: 'Supuesto propio' },
    monthlyUses: 500,
    unit: 'revisión',
    candidates: {
      openai: [
        {
          model: 'gpt-6.1-terra',
          why: 'Juzgar si un texto respeta la marca pide criterio; el barato se queda corto.',
          measured: UNMEASURED,
        },
        { model: 'gpt-6-luna', why: 'Barato y rápido, con menos criterio.', measured: UNMEASURED },
      ],
      claude: [
        { model: 'claude-haiku-5-5', why: 'Barato y rápido para revisar muchas piezas.', measured: UNMEASURED },
        { model: 'claude-sonnet-5-5', why: 'Más criterio al juzgar el tono de la marca.', measured: UNMEASURED },
      ],
    },
  },
  {
    id: 'campaigns',
    label: 'Planes de campaña',
    kind: 'text',
    purpose: 'campaign.plan',
    prefix: 'AI_TEXT_CAMPAIGN_PLAN',
    usage: { inputTokens: 3000, outputTokens: 1500, assumption: 'Supuesto propio' },
    monthlyUses: 40,
    unit: 'plan',
    candidates: {
      openai: [
        { model: 'gpt-6.1-terra', why: 'Planificar varias piezas a la vez necesita un modelo medio.', measured: UNMEASURED },
        { model: 'gpt-6.2-sol', why: 'Planifica algo mejor y cuesta el doble.', measured: UNMEASURED },
        { model: 'gpt-6-luna', why: 'Barato, pero planifica peor.', measured: UNMEASURED },
      ],
      claude: [
        {
          model: 'claude-sonnet-5-5',
          why: 'Planificar varias piezas a la vez necesita un modelo medio.',
          measured: UNMEASURED,
        },
        { model: 'claude-haiku-5-5', why: 'Barato, pero planifica peor.', measured: UNMEASURED },
      ],
    },
  },
  {
    id: 'analytics',
    label: 'Interpretación de la analítica',
    kind: 'text',
    purpose: 'analytics.summary',
    prefix: 'AI_TEXT_ANALYTICS_SUMMARY',
    usage: { inputTokens: 2500, outputTokens: 600, assumption: 'Supuesto propio' },
    monthlyUses: 40,
    unit: 'informe',
    candidates: {
      openai: [
        {
          model: 'gpt-6.1-terra',
          why: 'Interpretar cifras como hipótesis necesita un modelo medio.',
          measured: UNMEASURED,
        },
        { model: 'gpt-6-luna', why: 'Barato, pero interpreta peor.', measured: UNMEASURED },
      ],
      claude: [
        {
          model: 'claude-sonnet-5-5',
          why: 'Interpretar cifras como hipótesis necesita un modelo medio.',
          measured: UNMEASURED,
        },
        { model: 'claude-haiku-5-5', why: 'Barato, pero interpreta peor.', measured: UNMEASURED },
      ],
    },
  },
  {
    id: 'image_create',
    label: 'Crear una imagen',
    kind: 'image',
    monthlyUses: 300,
    unit: 'imagen',
    candidates: {
      openai: [
        {
          model: 'gpt-image-2.5-flare',
          why: 'Rápido para generar desde cero, en calidad media.',
          measured: `puesto alto en clasificaciones públicas; ${UNMEASURED}`,
        },
      ],
    },
  },
  {
    id: 'photo_edit',
    label: 'Editar una foto (cambiar el fondo, mejorar)',
    kind: 'image',
    monthlyUses: 250,
    unit: 'edición',
    candidates: {
      openai: [
        {
          model: 'gpt-image-2.5-sunburst',
          why: 'El de mayor precisión al editar; la máscara no garantiza que el plato quede intacto.',
          measured: `puesto alto en clasificaciones públicas; ${UNMEASURED}`,
        },
      ],
    },
  },
  {
    id: 'subtitles',
    label: 'Subtítulos de los reels',
    kind: 'transcription',
    monthlyUses: 100,
    unit: 'minuto',
    candidates: {
      openai: [
        { model: 'gpt-transcribe', why: 'El de transcripción de OpenAI que ya usa la aplicación.', measured: UNMEASURED },
      ],
    },
  },
];

/** Modelos de imagen de OpenAI que el registro de modelos trae sembrados (inactivos). */
export const SEEDED_OPENAI_IMAGE_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const;

/** Recargo por procesar en la UE (OpenAI y Claude por Vertex o Bedrock), docs/modelos-ia-comparativa.md. */
export const EU_SURCHARGE = 1.1;

/** Modelos distintos que citan las recomendaciones de un proveedor. */
export function candidateModels(provider: RecProvider): string[] {
  const out = new Set<string>();
  for (const t of RECOMMENDED_TASKS) for (const c of t.candidates[provider] ?? []) out.add(c.model);
  return [...out];
}
