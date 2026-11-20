import { z } from 'zod';
import { validateDocument, HEX_COLOR, type ContentDocument } from '../content/document';
import { allowedCanvasRatios, getFormatSpec } from '../content/networks';

// Plantillas de diseño de una marca, sacadas de las publicaciones que ya tiene
// en Instagram (docs/importar-publicaciones.md). Cada plantilla es:
//   · un documento v3 importable en el editor (el mismo esquema de las piezas), y
//   · su análisis: qué se vio y en cuántas publicaciones se repite, con 2 o 3
//     ejemplos (enlace a la publicación importada).
// La sesión de la agencia las prepara a mano (sin API de IA) con `agency/` y las
// entrega con `deliver_design_templates`. Este esquema lo comparten la
// herramienta y la aplicación.
//
// Por qué una tabla (`brand_design_templates`) y no el perfil de marca: el perfil
// es corto, versionado y lo lee el verificador y la IA en cada pieza; una
// plantilla lleva un documento entero, hay varias por marca, se entregan una a
// una y no deben engordar cada versión del perfil.

export const TEMPLATES_DELIVERY_FORMAT = 'rrss.agency-templates';
export const TEMPLATES_DELIVERY_VERSION = 1;
export const MAX_TEMPLATES = 12;

const text = (max: number) => z.string().trim().min(1).max(max);
const hex = z.string().regex(HEX_COLOR, 'El color debe tener el formato #RRGGBB');

export const LAYER_ROLES = [
  'photo',
  'background',
  'headline',
  'body',
  'cta',
  'logo',
  'badge',
  'frame',
  'overlay',
  'price',
  'date',
  'other',
] as const;

export const LOGO_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
  'none',
] as const;

export const templateAnalysisSchema = z
  .object({
    /** En una frase: qué plantilla es y cuándo se usa. */
    summary: text(600),
    /** Disposición de las capas, de abajo arriba. */
    layers: z
      .array(
        z
          .object({
            role: z.enum(LAYER_ROLES),
            position: text(200),
            description: z.string().trim().max(300).default(''),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    /** Tipografías APROXIMADAS: se ven en una imagen, no se conocen. */
    typography: z
      .array(
        z
          .object({
            role: z.enum(['headline', 'body', 'accent']),
            family: text(120),
            weight: z.number().int().min(100).max(900).default(400),
            case: z.enum(['upper', 'lower', 'title', 'sentence']).default('sentence'),
            note: z.string().trim().max(200).default(''),
          })
          .strict(),
      )
      .max(6)
      .default([]),
    colors: z
      .array(
        z
          .object({
            hex,
            role: z.enum(['background', 'text', 'accent', 'overlay', 'other']),
            note: z.string().trim().max(120).default(''),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    logo: z
      .object({
        position: z.enum(LOGO_POSITIONS),
        /** Ancho aproximado del logotipo respecto al lienzo, en %. */
        sizePercent: z.number().min(0).max(100).optional(),
      })
      .strict(),
    photo: z
      .object({
        type: text(200),
        treatment: z.string().trim().max(200).default(''),
      })
      .strict(),
    tone: z
      .object({
        description: text(400),
        samples: z.array(text(200)).max(3).default([]),
      })
      .strict(),
    /** En cuántas de las publicaciones revisadas se repite. */
    recurrence: z
      .object({
        count: z.number().int().min(1).max(100_000),
        reviewed: z.number().int().min(1).max(100_000),
      })
      .strict()
      .refine((r) => r.count <= r.reviewed, 'count no puede superar a reviewed'),
    /** De 2 a 3 publicaciones importadas que la ilustran. */
    examples: z
      .array(z.object({ permalink: z.string().url().max(500) }).strict())
      .min(2)
      .max(3),
  })
  .strict();

export type TemplateAnalysis = z.infer<typeof templateAnalysisSchema>;

export interface TemplateInput {
  key: string;
  name: string;
  network: string;
  format: string;
  document: ContentDocument;
  analysis: TemplateAnalysis;
}

export interface TemplateIssue {
  path: string;
  message: string;
}

const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Valida una plantilla entregada: forma, documento v3, red y formato conocidos, proporción admitida y análisis. */
export function validateTemplate(
  raw: unknown,
  at: string,
): { ok: true; template: TemplateInput } | { ok: false; issues: TemplateIssue[] } {
  const issues: TemplateIssue[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: at, message: 'debe ser un objeto' }] };
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!['key', 'name', 'network', 'format', 'document', 'analysis'].includes(key)) {
      issues.push({ path: `${at}.${key}`, message: 'campo no previsto' });
    }
  }
  if (typeof input.key !== 'string' || !KEY.test(input.key)) {
    issues.push({
      path: `${at}.key`,
      message: 'clave en minúsculas, cifras y guiones (hasta 63), p. ej. «plato-del-dia»',
    });
  }
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120) {
    issues.push({ path: `${at}.name`, message: 'nombre de 1 a 120 caracteres' });
  }
  const network = typeof input.network === 'string' ? input.network : '';
  const format = typeof input.format === 'string' ? input.format : '';
  const spec = getFormatSpec(network, format);
  if (!spec) issues.push({ path: `${at}.format`, message: `«${network}/${format}» no está en el catálogo de redes` });

  let document: ContentDocument | null = null;
  const documentRaw = input.document;
  if ((documentRaw as { schemaVersion?: unknown } | null)?.schemaVersion !== 3) {
    issues.push({ path: `${at}.document.schemaVersion`, message: 'el documento debe ser de la versión 3' });
  } else {
    const parsed = validateDocument(documentRaw);
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((i) => ({ path: `${at}.document.${i.path}`, message: i.message })));
    } else {
      document = parsed.document;
      const ratios = spec ? allowedCanvasRatios(spec) : null;
      if (ratios && !ratios.ratios.includes(document.canvas.aspectRatio)) {
        issues.push({
          path: `${at}.document.canvas.aspectRatio`,
          message: `${document.canvas.aspectRatio} no la admite ${network}/${format} (vale ${ratios.ratios.join(', ')})`,
        });
      }
    }
  }
  const analysis = templateAnalysisSchema.safeParse(input.analysis);
  if (!analysis.success) {
    issues.push(
      ...analysis.error.issues.map((i) => ({ path: `${at}.analysis.${i.path.join('.')}`, message: i.message })),
    );
  }
  if (issues.length || !document || !analysis.success) return { ok: false, issues };
  return {
    ok: true,
    template: {
      key: input.key as string,
      name: (input.name as string).trim(),
      network,
      format,
      document,
      analysis: analysis.data,
    },
  };
}

export type TemplatesDeliveryParse =
  { ok: true; templates: TemplateInput[]; note: string | null } | { ok: false; issues: TemplateIssue[] };

/** Valida el archivo de entrega de plantillas (ver agency/ejemplos/plantillas.json). */
export function validateTemplatesDelivery(raw: unknown): TemplatesDeliveryParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', message: 'La entrega debe ser un objeto JSON.' }] };
  }
  const input = raw as Record<string, unknown>;
  const issues: TemplateIssue[] = [];
  if (input.format !== TEMPLATES_DELIVERY_FORMAT) {
    issues.push({ path: 'format', message: `debe ser "${TEMPLATES_DELIVERY_FORMAT}"` });
  }
  if (input.version !== TEMPLATES_DELIVERY_VERSION) {
    issues.push({ path: 'version', message: `debe ser ${TEMPLATES_DELIVERY_VERSION}` });
  }
  for (const key of Object.keys(input)) {
    if (!['format', 'version', 'note', 'templates'].includes(key))
      issues.push({ path: key, message: 'campo no previsto' });
  }
  if (input.note !== undefined && input.note !== null && (typeof input.note !== 'string' || input.note.length > 500)) {
    issues.push({ path: 'note', message: 'texto de hasta 500 caracteres' });
  }
  const list = input.templates;
  const templates: TemplateInput[] = [];
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_TEMPLATES) {
    issues.push({ path: 'templates', message: `entre 1 y ${MAX_TEMPLATES} plantillas` });
  } else {
    const keys = new Set<string>();
    list.forEach((item, index) => {
      const result = validateTemplate(item, `templates[${index}]`);
      if (!result.ok) issues.push(...result.issues);
      else {
        if (keys.has(result.template.key)) {
          issues.push({ path: `templates[${index}].key`, message: 'clave repetida en la entrega' });
        }
        keys.add(result.template.key);
        templates.push(result.template);
      }
    });
  }
  if (issues.length) return { ok: false, issues };
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  return { ok: true, templates, note };
}
