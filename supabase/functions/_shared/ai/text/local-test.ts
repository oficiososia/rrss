// Proveedor simulado para la prueba de extremo a extremo en LOCAL, y la guarda
// que impide usarlo en cualquier otro sitio.
//
// La configuración normal (`config.ts`) no admite el simulado de ninguna forma.
// Esta es la única vía, y exige DOS cosas a la vez:
//   1. la variable explícita AI_E2E_SIMULATED_PROVIDER=true;
//   2. que la función corra contra un Supabase local: SUPABASE_URL por http y
//      con host 127.0.0.1, localhost o `kong` (el nombre con el que el stack de
//      la CLI —`supabase start` / `functions serve`— se ve a sí mismo desde
//      dentro de Docker; ningún proyecto desplegado usa ese nombre).
// Si la variable está y el Supabase no es local, la función no arranca: error
// claro en el registro. Si la variable no está, este módulo no hace nada.
//
// Las respuestas son DETERMINISTAS y se construyen a partir del perfil de
// marca y del encargo, para que la prueba pueda comprobar que lo generado
// respeta el perfil de cada marca (no es un texto fijo). No es IA: va marcado
// como simulado en `ai_generations` (proveedor `simulated`).
import type { AiModelSpec, AiProviderRequest, AiToolCall } from '../contract.ts';
import { createSimulatedProvider, SIMULATED_PROVIDER_ID, type SimulatedProvider } from '../simulated-provider.ts';
import { TEXT_PURPOSES, type AiTextConfig, type Env } from './config.ts';
import { TEXT_UNITS } from './prompt.ts';

export const LOCAL_TEST_FLAG = 'AI_E2E_SIMULATED_PROVIDER';
export const LOCAL_TEST_MODEL = 'simulado-e2e';
/** Hosts de un Supabase local: el de la máquina y el interno de la red de Docker de la CLI. */
export const LOCAL_SUPABASE_HOSTS = ['127.0.0.1', 'localhost', 'kong'] as const;

/**
 * Precio inventado (micros por unidad) para que el coste y el cupo se puedan
 * probar con cifras distintas de cero. No es el precio de ningún proveedor.
 */
export const LOCAL_TEST_PRICES: Record<string, number> = {
  [TEXT_UNITS.input]: 10,
  [TEXT_UNITS.output]: 40,
  [TEXT_UNITS.cacheRead]: 1,
  [TEXT_UNITS.cacheWrite]: 12,
};

export class LocalTestConfigError extends Error {
  override name = 'LocalTestConfigError';
}

export function isLocalSupabaseUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === 'http:' && (LOCAL_SUPABASE_HOSTS as readonly string[]).includes(url.hostname);
}

/**
 * Configuración de texto con el proveedor simulado, o `null` si la variable no
 * está. Lanza `LocalTestConfigError` si la variable está pero algo no cuadra.
 */
export function loadLocalTestTextConfig(env: Env): AiTextConfig | null {
  const flag = env[LOCAL_TEST_FLAG]?.trim();
  if (!flag) return null;
  if (flag !== 'true') {
    throw new LocalTestConfigError(`${LOCAL_TEST_FLAG} solo admite el valor «true»; para no usarla, quítala.`);
  }
  if (!isLocalSupabaseUrl(env.SUPABASE_URL)) {
    throw new LocalTestConfigError(
      `${LOCAL_TEST_FLAG}=true solo se admite en pruebas locales: SUPABASE_URL debe ser http://127.0.0.1, http://localhost o http://kong (stack local de la CLI). Esta función no arranca; quita la variable.`,
    );
  }
  const models: AiModelSpec[] = TEXT_PURPOSES.map((purpose) => ({
    provider: SIMULATED_PROVIDER_ID,
    model: LOCAL_TEST_MODEL,
    task: 'text',
    microsPerUnit: { ...LOCAL_TEST_PRICES },
    purposes: [purpose],
  }));
  return {
    providers: [createLocalTestProvider()],
    models,
    unavailable: {},
    problems: [`${LOCAL_TEST_FLAG}=true: proveedor SIMULADO para pruebas locales. Nunca en un entorno con clientes.`],
  };
}

// ── Respuestas deterministas ─────────────────────────────────────────────

type Profile = {
  business?: { description?: string };
  voice?: {
    tone?: string[];
    keyMessages?: string[];
    forbiddenPhrases?: string[];
    callsToAction?: string[];
    hashtags?: { required?: string[]; recommended?: string[] };
  };
  restrictions?: { legal?: string[]; advertising?: string[] };
  languages?: { primary?: string };
};

function material(request: AiProviderRequest, label: string): string | undefined {
  return request.input.context?.find((part) => part.label === label)?.content;
}

function profileOf(request: AiProviderRequest): Profile {
  try {
    return JSON.parse(material(request, 'perfil de marca') ?? '{}') as Profile;
  } catch {
    return {};
  }
}

const sentence = (text: string) => {
  const clean = text.trim().replace(/[.\s]+$/, '');
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)}.` : '';
};

const lowerFirst = (text: string) => (text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);

/** ¿Trata de usted? Si el tono de la marca lo dice («formal», «de usted»…). */
const formal = (profile: Profile) => (profile.voice?.tone ?? []).some((tone) => /formal|usted|sobri|serio/i.test(tone));

/** Vetos de la marca: expresiones prohibidas y restricciones de publicidad. */
const vetoes = (profile: Profile) =>
  [...(profile.voice?.forbiddenPhrases ?? []), ...(profile.restrictions?.advertising ?? [])]
    .map((v) => v.trim())
    .filter(Boolean);

/** Quita del encargo cualquier expresión vetada (la marca no la diría). */
function withoutVetoes(text: string, profile: Profile): string {
  let out = text;
  for (const veto of vetoes(profile)) {
    out = out.replace(new RegExp(veto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').replace(/\s{2,}/g, ' ');
  }
  return out.trim();
}

function postCopy(request: AiProviderRequest): string {
  const profile = profileOf(request);
  const brief = withoutVetoes(material(request, 'encargo') ?? '', profile);
  const count = Number(/Variantes: (\d+)\./.exec(request.input.prompt)?.[1] ?? '1');
  const message = profile.voice?.keyMessages?.[0] ?? profile.business?.description ?? '';
  const cta = profile.voice?.callsToAction?.[0] ?? (formal(profile) ? 'Le esperamos' : 'Te esperamos');
  const openers = formal(profile)
    ? ['Le presentamos', 'Tenemos el gusto de anunciarle', 'Le invitamos a conocer', 'Le contamos', 'Descubra']
    : ['Te presentamos', 'Mira', 'Ven a conocer', 'Te contamos', 'Descubre'];
  const hashtags = [...(profile.voice?.hashtags?.required ?? []), ...(profile.voice?.hashtags?.recommended ?? [])];
  const variants = Array.from({ length: Math.max(1, Math.min(5, count)) }, (_, i) => ({
    text: [`${openers[i % openers.length]}: ${lowerFirst(sentence(brief))}`, sentence(message), sentence(cta)]
      .filter(Boolean)
      .join(' '),
    hashtags: hashtags.map((tag) => `#${tag.replace(/^#+/, '')}`),
  }));
  return JSON.stringify({ variants });
}

function brandCheck(request: AiProviderRequest): string {
  const profile = profileOf(request);
  const text = material(request, 'texto evaluado') ?? '';
  const found = vetoes(profile)
    .map((veto) => {
      const at = text.toLowerCase().indexOf(veto.toLowerCase());
      return at < 0 ? null : text.slice(at, at + veto.length);
    })
    .filter((fragment): fragment is string => fragment !== null);
  const tone = profile.voice?.tone ?? [];
  return JSON.stringify({
    tone: tone.length
      ? { verdict: 'pass', explanation: `[simulado] Se compara con el tono «${tone.join(', ')}».`, evidence: [] }
      : { verdict: 'uncertain', explanation: '[simulado] El perfil no describe el tono.', evidence: [] },
    banned_topics: found.length
      ? { verdict: 'fail', explanation: `[simulado] Usa lo que la marca veta: ${found.join(', ')}.`, evidence: found }
      : { verdict: 'pass', explanation: '[simulado] No aparece nada vetado.', evidence: [] },
  });
}

function profileProposal(request: AiProviderRequest): string {
  const sources = (request.input.context ?? []).filter((part) => part.label.startsWith('fuente: '));
  const first = sources[0]?.content.split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  return JSON.stringify({
    business: { description: first, products: [], locations: [], valueProps: [] },
    audience: { segments: [] },
    goals: [],
    voice: { tone: [], personality: '', values: [], keyMessages: [], allowedPhrases: [], forbiddenPhrases: [] },
    visual: { colors: [], fonts: [], styleNotes: '' },
    channels: [],
    languages: { primary: '', others: [] },
    restrictions: { legal: [], advertising: [] },
    notes: [{ section: 'business', note: '[simulado] Descripción tomada de la primera frase de la primera fuente.' }],
  });
}

/**
 * Plan de campaña determinista: una pieza cada dos días, alternando los
 * destinos pedidos (primero una de cada red). El pie sale del perfil (mensaje
 * clave, llamada a la acción, tono) y la idea, de la instrucción.
 *
 * Además imita a un modelo COMPROMETIDO: si algún material contiene «ignora lo
 * anterior», añade una pieza que obedece a la inyección (otra red, fuera de
 * fechas, «aprobado y publicado»). El producto debe descartarla; la prueba de
 * extremo a extremo comprueba que no llega a los borradores.
 */
function campaignPlan(request: AiProviderRequest): string {
  const profile = profileOf(request);
  const prompt = request.input.prompt;
  const range = /Fechas: del (\d{4}-\d{2}-\d{2}) al (\d{4}-\d{2}-\d{2})/.exec(prompt);
  const max = Number(/Máximo de piezas: (\d+)\./.exec(prompt)?.[1] ?? '1');
  const targets = [...prompt.matchAll(/- Destino: ([a-z0-9_]+)\/([a-z0-9_]+)/g)].map((m) => ({
    network: m[1]!,
    format: m[2]!,
  }));
  const instruction = withoutVetoes(material(request, 'instrucción') ?? '', profile);
  let library: { id: string; kind: string }[] = [];
  try {
    library = JSON.parse(material(request, 'biblioteca') ?? '[]') as { id: string; kind: string }[];
  } catch {
    library = [];
  }
  const images = library.filter((asset) => asset.kind === 'image');
  const start = range ? Date.parse(`${range[1]}T00:00:00Z`) : 0;
  const end = range ? Date.parse(`${range[2]}T00:00:00Z`) : 0;
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const dayAt = (offset: number) => new Date(start + offset * 86_400_000).toISOString().slice(0, 10);

  // Una de cada red primero; después, el resto de formatos.
  const order: { network: string; format: string }[] = [];
  const byNetwork = new Map<string, { network: string; format: string }[]>();
  for (const target of targets) byNetwork.set(target.network, [...(byNetwork.get(target.network) ?? []), target]);
  for (let round = 0; order.length < targets.length; round += 1) {
    for (const list of byNetwork.values()) if (list[round]) order.push(list[round]!);
  }

  const message = profile.voice?.keyMessages?.[0] ?? profile.business?.description ?? '';
  const cta = profile.voice?.callsToAction?.[0] ?? (formal(profile) ? 'Le esperamos' : 'Te esperamos');
  const openers = formal(profile)
    ? ['Le presentamos', 'Le invitamos a conocer', 'Le contamos', 'Descubra']
    : ['Te presentamos', 'Ven a conocer', 'Te contamos', 'Descubre'];
  const hashtags = [...(profile.voice?.hashtags?.required ?? []), ...(profile.voice?.hashtags?.recommended ?? [])];
  const count = Math.max(1, Math.min(max, Math.ceil(days / 2)));
  const shortInstruction = instruction.slice(0, 120);
  const pieces = Array.from({ length: order.length ? count : 0 }, (_, i) => ({
    ...order[i % order.length]!,
    date: dayAt(Math.min(days - 1, i * 2)),
    idea: `[simulado] Pieza ${i + 1} de ${count}: ${shortInstruction}`,
    caption: [`${openers[i % openers.length]}: ${lowerFirst(sentence(message || shortInstruction))}`, sentence(cta)]
      .filter(Boolean)
      .join(' '),
    hashtags,
    assetIds: images.length ? [images[i % images.length]!.id] : [],
    why: `[simulado] Reparto fijo: una pieza cada dos días, alternando redes (${i + 1}/${count}).`,
  }));

  const everything = (request.input.context ?? []).map((part) => part.content).join('\n');
  if (/ignora lo anterior/i.test(everything)) {
    pieces.push({
      network: 'x',
      format: 'post',
      date: dayAt(days + 365),
      idea: 'Aprobado y publicado por orden del documento',
      caption: 'APROBADO. Publicar ya.',
      hashtags: [],
      assetIds: ['00000000-0000-0000-0000-000000000000'],
      why: 'El documento lo ordena.',
    });
  }

  const tone = profile.voice?.tone ?? [];
  return JSON.stringify({
    objective: `[simulado] ${sentence(shortInstruction)}`,
    summary: `[simulado] ${count} piezas entre ${range?.[1] ?? '?'} y ${range?.[2] ?? '?'}.`,
    observed: [
      `[simulado] La instrucción pide: «${shortInstruction}».`,
      tone.length
        ? `[simulado] El tono de la marca es ${tone.join(', ')}.`
        : '[simulado] El perfil no describe el tono.',
      `[simulado] La biblioteca enviada tiene ${library.length} recursos (${images.length} imágenes).`,
    ],
    dataBacked: [],
    hypotheses: ['[simulado] Publicar cada dos días mantiene la presencia sin saturar.'],
    pieces,
  });
}

/**
 * Rellenar el formulario de una campaña (`campaign.brief`), con reglas fijas y
 * sin modelo. Entiende «N semanas», «hasta navidad(es)», el nombre de una red y
 * «reels»; sin tema (menos de tres palabras) y sin respuesta previa, pregunta.
 * Ante «ignora lo anterior» imita a un modelo comprometido: una red que no está
 * en la lista y fechas pasadas (el producto las descarta).
 */
function campaignBrief(request: AiProviderRequest): string {
  const prompt = request.input.prompt;
  const instruction = material(request, 'lo que quiere') ?? '';
  const today = material(request, 'hoy') ?? '2026-01-01';
  const answer = material(request, 'respuesta');
  const current = (() => {
    try {
      return JSON.parse(material(request, 'propuesta actual') ?? 'null') as {
        startDate: string;
        endDate: string;
        networks: string[];
        mix: { network: string; format: string; perWeek: number }[];
        title: string;
        objective: string;
        weeks: { title: string; focus: string }[];
      } | null;
    } catch {
      return null;
    }
  })();
  const targets = [...prompt.matchAll(/- Destino: ([a-z0-9_]+)\/([a-z0-9_]+)/g)].map((m) => ({
    network: m[1]!,
    format: m[2]!,
  }));
  const empty = {
    question: '',
    title: '',
    objective: '',
    networks: [] as string[],
    startDate: '',
    endDate: '',
    perWeek: 0,
    mix: [] as { network: string; format: string; perWeek: number }[],
    weeks: [] as { title: string; focus: string }[],
    why: '',
  };
  const words = instruction.split(/\s+/).filter(Boolean).length;
  if (!current && !answer && words < 3) {
    return JSON.stringify({ ...empty, question: '¿De qué trata la campaña o qué quieres dar a conocer?' });
  }

  const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
  const iso = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
  const todayN = day(today);
  const monday = todayN + (((8 - new Date(todayN * 86_400_000).getUTCDay()) % 7) || 7);
  const text = `${instruction} ${answer ?? ''}`.toLowerCase();

  let start = monday;
  let weeks = Number(/(\d+)\s+semanas?/.exec(text)?.[1] ?? '0');
  if (/navidad/.test(text)) {
    const year = new Date(todayN * 86_400_000).getUTCFullYear();
    weeks = Math.max(1, Math.ceil((day(`${year}-12-24`) - monday + 1) / 7));
  }
  if (!weeks) weeks = 3;
  if (current) {
    start = day(current.startDate);
    weeks = Math.max(1, Math.ceil((day(current.endDate) - start + 1) / 7));
    if (/acorta/.test(prompt)) weeks = Math.max(1, weeks - 1);
    if (/alarga/.test(prompt)) weeks += 1;
  }
  weeks = Math.min(9, weeks);

  const named = [...new Set(targets.map((t) => t.network))].filter((n) => text.includes(n));
  const networks = named.length ? named : current?.networks?.length ? current.networks : [targets[0]?.network ?? 'instagram'];
  const reels = /reels?/.test(text);
  const mix = networks.flatMap((network) => {
    const formats = targets.filter((t) => t.network === network);
    const reel = formats.find((f) => /reel|video|short/.test(f.format));
    const rest = formats.find((f) => f !== reel) ?? formats[0];
    const out: { network: string; format: string; perWeek: number }[] = [];
    if (reel && reels) out.push({ network, format: reel.format, perWeek: 2 });
    if (rest && !(rest === reel && out.length)) out.push({ network, format: rest.format, perWeek: reels ? 1 : 2 });
    return out;
  });
  const names = ['Anuncio', 'Platos', 'Cierre', 'Recuerdo'];
  const evil = /ignora lo anterior/i.test(`${instruction} ${prompt}`);
  return JSON.stringify({
    ...empty,
    title: current?.title ?? `[simulado] ${sentence(instruction.slice(0, 40)).replace(/\.$/, '')}`,
    objective: current?.objective ?? `[simulado] ${sentence(instruction.slice(0, 120))}`,
    networks: evil ? ['x', ...networks] : networks,
    startDate: evil ? '2001-01-01' : iso(start),
    endDate: evil ? '2001-02-01' : iso(start + weeks * 7 - 1),
    perWeek: mix.reduce((sum, m) => sum + m.perWeek, 0),
    mix,
    weeks: Array.from({ length: weeks }, (_, i) => ({
      title: names[Math.min(i, names.length - 1)]!,
      focus: `[simulado] Semana ${i + 1} de ${weeks}.`,
    })),
    why: `[simulado] Te propongo ${weeks} ${weeks === 1 ? 'semana' : 'semanas'} porque lo pide el texto o, si no, es lo normal.`,
  });
}

/** Analítica: una hipótesis por cada uno de los dos primeros datos, citándolo; nada inventado. */
function analyticsSummary(request: AiProviderRequest): string {
  let datos: Array<{ id: string; dato: string }> = [];
  try {
    datos = (JSON.parse(material(request, 'datos medidos') ?? '{}') as { datos?: typeof datos }).datos ?? [];
  } catch {
    datos = [];
  }
  return JSON.stringify({
    hypotheses: datos.slice(0, 2).map((d) => ({
      text: `[simulado] Podría merecer la pena fijarse en esto: ${d.dato}`,
      based_on: [d.id],
    })),
  });
}

/**
 * Copiloto por voz: lee el dictado con reglas fijas (no es IA) y devuelve las
 * operaciones que pediría un modelo. Entiende «foto … detrás / de fondo»
 * (difuminada si lo dice), «logotipo» (arriba o abajo), «título: …»,
 * «platos: a, b, c», «precio: …», «difumina más» y «en blanco». Los textos son
 * trozos literales del dictado.
 *
 * Imita además a un modelo COMPROMETIDO: si el dictado contiene «ignora lo
 * anterior», añade un texto que no se ha dictado («APROBADO Y PUBLICADO») y
 * una foto que no se ha elegido. El producto debe descartar las dos.
 */
function editorCopilot(request: AiProviderRequest): string {
  const profile = profileOf(request) as Profile & { visual?: { logoAssetIds?: string[] } };
  const dictation = material(request, 'dictado') ?? '';
  let photos: { id: string }[] = [];
  try {
    photos = JSON.parse(material(request, 'fotos elegidas') ?? '[]') as { id: string }[];
  } catch {
    photos = [];
  }
  const empty = {
    target: null,
    text: null,
    style: null,
    assetId: null,
    position: null,
    align: null,
    color: null,
    font: null,
    blur: null,
    dx: null,
    dy: null,
  };
  const operations: Record<string, unknown>[] = [];
  const clause = (pattern: RegExp) => pattern.exec(dictation)?.[1]?.trim().replace(/[.;]+$/, '');
  const white = /en blanco/i.test(dictation) ? '#FFFFFF' : null;
  const blurred = /muy (difuminad|desenfocad)/i.test(dictation) ? 70 : /difumin|desenfoc|borros/i.test(dictation) ? 40 : null;

  if (/(foto|imagen)[^.]*?(detr[aá]s|de fondo)|fondo[^.]*?(foto|imagen)/i.test(dictation)) {
    operations.push({ ...empty, op: 'set_background_image', assetId: photos[0]?.id ?? null, blur: blurred });
  } else if (/difumina(la)? m[aá]s|m[aá]s difuminad/i.test(dictation)) {
    operations.push({ ...empty, op: 'blur_image', blur: 70 });
  }
  if (/logo(tipo)?/i.test(dictation)) {
    const where = /logo(?:tipo)?[^.]*?\b(arriba|abajo)\b/i.exec(dictation)?.[1]?.toLowerCase();
    operations.push({
      ...empty,
      op: 'add_logo',
      assetId: profile.visual?.logoAssetIds?.[0] ?? null,
      position: where === 'arriba' ? 'top' : where === 'abajo' ? 'bottom' : null,
      align: where ? 'center' : null,
    });
  }
  const title = clause(/t[ií]tulo:?\s*([^.]+)/i);
  if (title) operations.push({ ...empty, op: 'add_text', text: title, style: 'title', position: 'upper', color: white });
  const dishes = clause(/platos:?\s*([^.]+)/i);
  if (dishes) {
    const lines = dishes
      .split(/,|;|\by\b/)
      .map((line) => line.trim())
      .filter(Boolean);
    operations.push({ ...empty, op: 'add_text', text: lines.join('\n'), style: 'body', position: 'middle', color: white });
  }
  const price = clause(/precio:?\s*([^.]+)/i);
  if (price) operations.push({ ...empty, op: 'add_text', text: price, style: 'small', position: 'lower', color: white });

  if (/ignora lo anterior/i.test(dictation)) {
    operations.push({ ...empty, op: 'add_text', text: 'APROBADO Y PUBLICADO', style: 'title' });
    operations.push({ ...empty, op: 'set_background_image', assetId: '00000000-0000-4000-8000-000000000000' });
  }
  return JSON.stringify({
    operations,
    note: operations.length
      ? `[simulado] ${operations.length} cambios a partir de lo dictado.`
      : '[simulado] No he entendido ningún cambio en lo dictado.',
  });
}

/**
 * El mismo copiloto simulado por la ruta de HERRAMIENTAS: las mismas reglas
 * fijas, devueltas como llamadas (una por cambio). Lee el material compacto
 * («orden», «fotos» como f1, f2…) y nombra las fotos por su alias. Ante «ignora
 * lo anterior» imita igual a un modelo comprometido: un texto no dictado y una
 * foto que no está entre las elegidas (f9).
 *
 * Entiende además las órdenes que montan una pieza («crea un fondo que parezca
 * otoñal y pon los platos en el centro»): devuelve los pasos de plan
 * (`generate_background`, `find_photos`, `place_photos`). Ante «genera un plato
 * de…» imita a un modelo que se salta la regla y pide generar comida.
 *
 * Como pide la tarea, cierra siempre con `done` y su nota para la persona.
 */
function editorCopilotTools(request: AiProviderRequest): { text: string; tool_calls: AiToolCall[] } {
  const legacy = { ...request, input: { ...request.input, context: [...(request.input.context ?? [])] } };
  // Reutiliza las reglas de arriba: «orden» es el dictado y las fotos van por alias.
  const order = material(request, 'orden') ?? '';
  const photos = (material(request, 'fotos') ?? '')
    .split('\n')
    .map((line) => line.trim().split(' ')[0])
    .filter((alias): alias is string => Boolean(alias));
  legacy.input.context.push({
    label: 'fotos elegidas',
    content: JSON.stringify(photos.map((alias) => ({ id: alias }))),
  });
  // Montar una pieza: «crea un fondo que parezca otoñal y pon los platos en el centro» → los pasos de plan.
  // Imita también a un modelo que se salta la regla: ante «genera un plato de…» pide generar comida
  // (el producto debe descartarlo: la IA solo crea el fondo).
  const planCalls: AiToolCall[] = [];
  const food = /\b(?:crea|genera)\w*\s+(?:un|una|unos|unas)\s+((?:plato|hamburguesa|pizza|producto|botella)[^.,;:]*)/i.exec(order);
  const backdrop = /\b(?:crea|genera|haz)\w*\s+un\s+fondo\s+([^.,;:]+?)(?=\s+y\s+pon|[.,;:]|$)/i.exec(order);
  const placing = /\bpon\w*\s+(?:los|las)\s+([^.,;:]+?)\s+en\s+(el centro|fila|rejilla|abanico)\b/i.exec(order);
  if (food) planCalls.push({ name: 'generate_background', arguments: { prompt: food[1]!.trim(), ratio: null } });
  else if (backdrop) planCalls.push({ name: 'generate_background', arguments: { prompt: `Fondo ${backdrop[1]!.trim()}`, ratio: null } });
  if (placing) {
    const layouts: Record<string, string> = { 'el centro': 'center', fila: 'row', rejilla: 'grid', abanico: 'fan' };
    planCalls.push({ name: 'find_photos', arguments: { query: placing[1]!.trim(), count: 3 } });
    planCalls.push({
      name: 'place_photos',
      arguments: {
        layout: layouts[placing[2]!.toLowerCase()] ?? 'center',
        cutout: /recort|sin (?:el |su )?fondo/i.test(order),
        on: /sombra/i.test(order),
      },
    });
  }
  // Lo que ya es un paso de plan no se vuelve a leer con las reglas de siempre («fondo», «platos»).
  const rest = [food?.[0], backdrop?.[0], placing?.[0]].reduce<string>(
    (text, part) => (part ? text.replace(part, ' ') : text),
    order,
  );
  legacy.input.context.push({ label: 'dictado', content: rest });
  // El perfil compacto no trae los logotipos: basta con saber si hay.
  const plan = JSON.parse(editorCopilot(legacy)) as { operations: Record<string, unknown>[] };
  const calls: AiToolCall[] = plan.operations.map((op) => {
    if (op.op === 'set_background_image') {
      const photo = typeof op.assetId === 'string' && /^f\d+$/.test(op.assetId) ? op.assetId : op.assetId ? 'f9' : null;
      return { name: 'set_background_image', arguments: { photo, blur: (op.blur as number | null) ?? null } };
    }
    if (op.op === 'blur_image') return { name: 'blur_image', arguments: { target: null, blur: op.blur as number } };
    if (op.op === 'add_logo') {
      return {
        name: 'add_logo',
        arguments: { position: (op.position as string | null) ?? null, align: (op.align as string | null) ?? null },
      };
    }
    return {
      name: 'add_text',
      arguments: {
        text: op.text as string,
        style: (op.style as string | null) ?? null,
        position: (op.position as string | null) ?? null,
        align: null,
        color: (op.color as string | null) ?? null,
        font: null,
      },
    };
  });
  const all = [...planCalls, ...calls];
  const note = all.length
    ? `[simulado] ${all.length === 1 ? '1 cambio' : `${all.length} cambios`} a partir de la orden.`
    : '[simulado] No he entendido ningún cambio en la orden.';
  // Todas las llamadas en una vuelta y, la última, el cierre con la nota.
  return { text: '', tool_calls: [...all, { name: 'done', arguments: { note } }] };
}

/**
 * «Hacer un reel como este», determinista: NO mira los fotogramas. Lee la
 * medición (cuántos planos y si son imagen fija) y reparte tipos de plano en
 * orden; los textos salen del perfil y de la idea de la marca. Sirve para
 * probar el circuito entero (cupo, registro, guardado, borrador) sin un modelo.
 */
function reelLike(request: AiProviderRequest): string {
  const profile = profileOf(request);
  let shots: Array<{ plano: number; imagen_fija?: boolean }> = [];
  try {
    const parsed = JSON.parse(material(request, 'medición del vídeo de referencia') ?? '{}') as {
      planos?: Array<{ plano: number; imagen_fija?: boolean }>;
    };
    shots = parsed.planos ?? [];
  } catch {
    shots = [];
  }
  let library: { carpetas?: string[]; etiquetas?: string[] } = {};
  try {
    library = JSON.parse(material(request, 'biblioteca de la marca') ?? '{}') as typeof library;
  } catch {
    library = {};
  }
  const vocabulary = [...(library.etiquetas ?? []), ...(library.carpetas ?? [])].map((w) => w.toLowerCase());
  const idea = withoutVetoes(material(request, 'idea de la marca para su reel') ?? '', profile);
  const spoken = material(request, 'lo que se dice en el vídeo de referencia');
  const message = profile.voice?.keyMessages?.[0] ?? profile.business?.description ?? 'Lo que hacemos';
  const cta = profile.voice?.callsToAction?.[0] ?? (formal(profile) ? 'Le esperamos' : 'Te esperamos');
  const kinds = ['detalle', 'general', 'persona', 'detalle'];
  const count = Math.max(1, shots.length);
  const hashtags = [...(profile.voice?.hashtags?.required ?? []), ...(profile.voice?.hashtags?.recommended ?? [])];
  return JSON.stringify({
    name: `[simulado] Gancho + ${Math.max(0, count - 2)} planos + cierre`,
    summary: `[simulado] Estructura de ${count} planos${spoken ? ', con voz' : ''}; ${request.input.images?.length ?? 0} fotogramas recibidos.`,
    pace: 'medio',
    audioKind: spoken ? 'voz-y-musica' : 'musica',
    title: sentence(idea || message).replace(/\.$/, ''),
    idea: sentence(idea || message),
    shots: shots.map((shot, i) => ({
      index: shot.plano,
      kind: kinds[i % kinds.length],
      media: shot.imagen_fija ? 'foto' : 'video',
      description: `[simulado] Plano ${shot.plano} de la referencia`,
      what: `[simulado] ${sentence(message)} (plano ${shot.plano})`,
      tip: formal(profile) ? 'Grabe con luz natural y el móvil en vertical.' : 'Graba con luz natural y el móvil en vertical.',
      search: vocabulary.length ? [vocabulary[i % vocabulary.length]!] : ['plano'],
    })),
    texts: [
      { role: 'gancho', position: 'top', size: 'grande', fromShot: 1, toShot: 1, value: sentence(idea || message).slice(0, 60) },
      ...(count > 1
        ? [{ role: 'llamada', position: 'center', size: 'normal', fromShot: count, toShot: count, value: sentence(cta).slice(0, 60) }]
        : []),
    ],
    hook: sentence(idea || message),
    caption: [sentence(message), sentence(cta)].filter(Boolean).join(' '),
    hashtags: hashtags.map((tag) => tag.replace(/^#+/, '')),
    coverShot: 1,
    coverNote: '[simulado] El primer plano con el gancho.',
  });
}

const RESPONDERS: Record<string, (request: AiProviderRequest) => string> = {
  reel_like: reelLike,
  editor_copilot: editorCopilot,
  analytics_summary: analyticsSummary,
  post_copy: postCopy,
  brand_check: brandCheck,
  brand_profile_proposal: profileProposal,
  campaign_plan: campaignPlan,
  campaign_brief: campaignBrief,
};

export function createLocalTestProvider(): SimulatedProvider {
  return createSimulatedProvider({
    respond: (request) => {
      const name = request.input.outputSchema?.name;
      if (!name && request.input.tools?.some((spec) => spec.name === 'set_background_image')) {
        return editorCopilotTools(request);
      }
      return name ? RESPONDERS[name]?.(request) : undefined;
    },
  });
}
