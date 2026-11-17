import { z } from 'zod';

// Formato del documento de una publicación: un lienzo con capas y el texto que
// la acompaña. Es propio y no depende de ningún editor ni motor de dibujo: el
// editor, el render del servidor y la IA leen y escriben este mismo JSON.
// Se guarda en content_versions.data; `schemaVersion` permite migrarlo
// (ver migrate.ts) sin migraciones de base de datos.
export const DOCUMENT_SCHEMA_VERSION = 1;

// ── Lienzo ───────────────────────────────────────────────────────────────

export const ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * Lienzo lógico de cada proporción. Todas las medidas del documento (posición,
 * tamaño, cuerpo de letra, trazo) van en estas unidades. No es la resolución
 * de exportación: quien dibuja escala el lienzo entero al tamaño que necesite.
 */
export const CANVAS_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

/** Proporción como número (ancho / alto). */
export function aspectRatioValue(ratio: AspectRatio): number {
  const [w, h] = ratio.split(':').map(Number) as [number, number];
  return w / h;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const color = z.string().regex(HEX_COLOR, 'El color debe tener el formato #RRGGBB');
const coordinate = z.number().finite().min(-100_000).max(100_000);
const size = z.number().finite().positive().max(100_000);

export const canvasSchema = z
  .object({
    aspectRatio: z.enum(ASPECT_RATIOS),
    width: size,
    height: size,
    backgroundColor: color.default('#FFFFFF'),
  })
  .superRefine((canvas, ctx) => {
    if (Math.abs(canvas.width / canvas.height - aspectRatioValue(canvas.aspectRatio)) > 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['width'],
        message: 'El tamaño del lienzo no corresponde a su proporción',
      });
    }
  });

// ── Capas ────────────────────────────────────────────────────────────────

/**
 * Anclaje de una capa, por eje. Decide qué se conserva al adaptar el documento
 * a otra proporción (ver adapt.ts):
 *  - `left` / `top`, `right` / `bottom`: la distancia a ese borde.
 *  - `center`: la posición relativa de su centro.
 *  - `stretch`: la distancia relativa a los dos bordes (la capa se estira).
 */
export const ANCHORS_X = ['left', 'center', 'right', 'stretch'] as const;
export const ANCHORS_Y = ['top', 'center', 'bottom', 'stretch'] as const;
export type AnchorX = (typeof ANCHORS_X)[number];
export type AnchorY = (typeof ANCHORS_Y)[number];

const anchorSchema = z
  .object({ x: z.enum(ANCHORS_X).default('center'), y: z.enum(ANCHORS_Y).default('center') })
  .default({});

// Común a todas las capas. `x`, `y` son la esquina superior izquierda de la
// caja sin girar; `rotation`, grados en sentido horario alrededor de su centro.
// El orden de apilado es el del array `layers`: la primera capa queda al fondo.
const layerBase = {
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'El identificador de la capa solo admite letras, números, guion y guion bajo'),
  name: z.string().max(120).default(''),
  x: coordinate,
  y: coordinate,
  width: size,
  height: size,
  rotation: z.number().finite().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  anchor: anchorSchema,
};

/** De dónde sale una imagen: un recurso de la biblioteca o una generación de IA. Nunca la imagen incrustada. */
export const imageSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('asset'), assetId: z.string().uuid() }),
  z.object({ kind: z.literal('generation'), generationId: z.string().uuid() }),
]);

const imageLayerSchema = z.object({
  ...layerBase,
  type: z.literal('image'),
  source: imageSourceSchema,
  /** `cover` llena la caja recortando; `contain` muestra la imagen entera. */
  fit: z.enum(['cover', 'contain']).default('cover'),
  /** Punto de interés de la imagen (0–1): lo que no debe perderse al recortar. */
  focus: z.object({ x: z.number().min(0).max(1).default(0.5), y: z.number().min(0).max(1).default(0.5) }).default({}),
});

const textLayerSchema = z.object({
  ...layerBase,
  type: z.literal('text'),
  text: z.string().max(2000),
  fontFamily: z.string().trim().min(1).max(120),
  /** Cuerpo de letra, en unidades del lienzo. */
  fontSize: z.number().finite().positive().max(2000),
  fontWeight: z.number().int().min(100).max(900).default(400),
  italic: z.boolean().default(false),
  color,
  align: z.enum(['left', 'center', 'right']).default('left'),
  /** Interlineado como múltiplo del cuerpo de letra. */
  lineHeight: z.number().min(0.5).max(4).default(1.2),
});

/** Logotipo de la marca (un recurso de la biblioteca). Se dibuja siempre entero, sin deformar, dentro de su caja. */
const logoLayerSchema = z.object({
  ...layerBase,
  type: z.literal('logo'),
  assetId: z.string().uuid(),
});

const shapeLayerSchema = z.object({
  ...layerBase,
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'ellipse']),
  fill: color.nullable().default(null),
  stroke: z
    .object({ color, width: z.number().finite().positive().max(1000) })
    .nullable()
    .default(null),
  /** Radio de las esquinas (solo rectángulos). */
  cornerRadius: z.number().finite().min(0).max(100_000).default(0),
});

export const layerSchema = z.discriminatedUnion('type', [
  imageLayerSchema,
  textLayerSchema,
  logoLayerSchema,
  shapeLayerSchema,
]);

export const LAYER_TYPES = ['image', 'text', 'logo', 'shape'] as const;
export const MAX_LAYERS = 60;

// ── Texto de la publicación ──────────────────────────────────────────────
// Los máximos de aquí son el techo técnico del documento, no los límites de
// ninguna red: esos están en networks.ts y los comprueba el verificador.

const tag = (prefix: string, pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .transform((value) => value.replace(new RegExp(`^${prefix}+`), ''))
    .pipe(z.string().min(1, message).max(100).regex(pattern, message));

export const postCopySchema = z.object({
  /** Pie o cuerpo de la publicación. */
  caption: z.string().max(10_000).default(''),
  /** Sin la almohadilla. */
  hashtags: z
    .array(tag('#', /^[\p{L}\p{N}_]+$/u, 'Un hashtag solo admite letras, números y guion bajo'))
    .max(100)
    .default([]),
  /** Sin la arroba. */
  mentions: z
    .array(tag('@', /^[^\s@]+$/, 'Una mención no admite espacios ni arrobas'))
    .max(100)
    .default([]),
  /** Descripción de la imagen para quien no la ve. */
  altText: z.string().max(2000).default(''),
  callToAction: z
    .object({
      label: z.string().trim().max(120).default(''),
      url: z
        .string()
        .trim()
        .max(2000)
        .regex(/^(https?:\/\/\S+)?$/i, 'El enlace debe empezar por http:// o https://')
        .default(''),
    })
    .default({}),
});

// ── Documento ────────────────────────────────────────────────────────────

export const contentDocumentSchema = z
  .object({
    schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
    canvas: canvasSchema,
    layers: z.array(layerSchema).max(MAX_LAYERS).default([]),
    copy: postCopySchema.default({}),
  })
  .superRefine((document, ctx) => {
    const seen = new Set<string>();
    document.layers.forEach((layer, index) => {
      if (seen.has(layer.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['layers', index, 'id'],
          message: 'Hay dos capas con el mismo identificador',
        });
      }
      seen.add(layer.id);
    });
  });

export type ContentDocument = z.infer<typeof contentDocumentSchema>;
/** Lo que se puede escribir: lo que tiene valor por defecto es opcional. */
export type ContentDocumentInput = z.input<typeof contentDocumentSchema>;
export type Canvas = ContentDocument['canvas'];
export type Layer = z.infer<typeof layerSchema>;
export type LayerInput = z.input<typeof layerSchema>;
export type LayerType = Layer['type'];
export type ImageLayer = Extract<Layer, { type: 'image' }>;
export type TextLayer = Extract<Layer, { type: 'text' }>;
export type LogoLayer = Extract<Layer, { type: 'logo' }>;
export type ShapeLayer = Extract<Layer, { type: 'shape' }>;
export type ImageSource = z.infer<typeof imageSourceSchema>;
export type LayerAnchor = Layer['anchor'];
export type PostCopy = z.infer<typeof postCopySchema>;
