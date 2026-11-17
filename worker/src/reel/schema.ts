// Esquemas del reel por plantilla.
//
//  * La PLANTILLA es un dato (JSON, con versión): cómo se monta un reel —
//    lienzo, ritmo, movimiento de las fotos, transición, estilo del texto,
//    música y exportación—. No lleva nada de ningún cliente.
//  * El PLAN es lo que propone la IA (o una persona) para una pieza concreta:
//    qué fotos y clips, en qué orden, qué textos y cuándo, y qué música.
//
// El motor (`build.ts`) ejecuta plantilla + plan con FFmpeg. Todo lo que
// depende del tamaño va en proporciones, para poder renderizar la misma
// plantilla a menor resolución (borradores) sin tocarla.
import { z } from 'zod';
import { focalPointSchema, storagePathSchema } from '../handlers/shared.ts';

export const REEL_TEMPLATE_SCHEMA_VERSION = 1;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB');
const evenInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).refine((v) => v % 2 === 0, 'Debe ser par'); // prettier-ignore

export const textPositionSchema = z.enum(['top', 'center', 'bottom']);
export const photoMotionSchema = z.enum(['none', 'zoom-in', 'zoom-out', 'pan-right', 'pan-left', 'alternate']);
export const transitionTypeSchema = z.enum(['cut', 'fade', 'fadeblack', 'dissolve', 'slideleft', 'slideup']);

export const reelTemplateSchema = z.strictObject({
  schemaVersion: z.literal(REEL_TEMPLATE_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(300).default(''),
  /** Lienzo vertical 9:16. Todas las piezas se normalizan a este tamaño y ritmo. */
  canvas: z
    .strictObject({
      width: evenInt(180, 1080).default(1080),
      height: evenInt(320, 1920).default(1920),
      fps: z.number().int().min(15).max(60).default(30),
    })
    .refine((c) => c.width * 16 === c.height * 9, 'El lienzo debe ser 9:16'),
  timing: z.strictObject({
    /** Segundos que dura cada foto si el plan no dice otra cosa. */
    photoSeconds: z.number().min(0.5).max(10).default(2.5),
    /** Máximo que se toma de cada clip si el plan no dice otra cosa. */
    maxClipSeconds: z.number().min(0.5).max(30).default(4),
    /** Duración máxima del reel. Un plan que la supere se rechaza. */
    maxTotalSeconds: z.number().min(3).max(90).default(30),
  }),
  /** Paso de una pieza a la siguiente: corte seco o fundido. */
  transition: z.strictObject({
    type: transitionTypeSchema.default('fade'),
    seconds: z.number().min(0).max(2).default(0.4),
  }),
  /** Movimiento suave sobre las fotos (los clips ya se mueven). */
  photoMotion: z.strictObject({
    type: photoMotionSchema.default('alternate'),
    /** Cuánto se amplía o se desplaza: 0,08 = un 8 %. */
    amount: z.number().min(0).max(0.3).default(0.08),
  }),
  text: z.strictObject({
    /** `default` o el nombre de una tipografía instalada en el trabajador. */
    font: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/).default('default'), // prettier-ignore
    /** Tamaño de letra como fracción del ancho del lienzo. */
    sizeRatio: z.number().min(0.02).max(0.15).default(0.06),
    color: hexColor.default('#FFFFFF'),
    position: textPositionSchema.default('bottom'),
    /** Distancia al borde como fracción del alto (deja libre la zona de botones de la red). */
    marginRatio: z.number().min(0).max(0.4).default(0.2),
    /** Ancho máximo del bloque de texto como fracción del ancho. */
    maxWidthRatio: z.number().min(0.4).max(1).default(0.84),
    lineHeight: z.number().min(1).max(2).default(1.3),
    /** Caja de color detrás de cada línea. */
    box: z
      .strictObject({
        color: hexColor.default('#000000'),
        opacity: z.number().min(0).max(1).default(0.55),
        /** Relleno de la caja como fracción del tamaño de letra. */
        paddingRatio: z.number().min(0).max(1).default(0.35),
      })
      .nullable()
      .default(null),
    /** Contorno de la letra. */
    outline: z
      .strictObject({
        color: hexColor.default('#000000'),
        /** Grosor como fracción del tamaño de letra. */
        widthRatio: z.number().min(0).max(0.2).default(0.06),
      })
      .nullable()
      .default(null),
    /** Aparición y desaparición del texto. */
    fadeSeconds: z.number().min(0).max(1).default(0.25),
  }),
  audio: z.strictObject({
    /** Volumen de la música (atenuada bajo la imagen): 0 a 1. */
    musicVolume: z.number().min(0).max(1).default(0.35),
    /** Volumen del sonido original de los clips. 0 = se silencian. */
    clipVolume: z.number().min(0).max(1).default(0),
    fadeInSeconds: z.number().min(0).max(5).default(0.5),
    fadeOutSeconds: z.number().min(0).max(5).default(1),
  }),
  export: z.strictObject({
    /** Calidad de H.264: menor = mejor y más pesado. */
    crf: z.number().int().min(16).max(32).default(21),
    preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium']).default('veryfast'),
    audioBitrateKbps: z.number().int().min(64).max(256).default(128),
  }),
});
export type ReelTemplate = z.output<typeof reelTemplateSchema>;
export type ReelTemplateInput = z.input<typeof reelTemplateSchema>;

const mediaItemSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('photo'),
    path: storagePathSchema,
    focalPoint: focalPointSchema.optional(),
    /** Segundos en pantalla; por defecto, los de la plantilla. */
    seconds: z.number().min(0.5).max(10).optional(),
  }),
  z.strictObject({
    type: z.literal('video'),
    path: storagePathSchema,
    focalPoint: focalPointSchema.optional(),
    /** Segundo del clip en el que se empieza a tomar. */
    startAt: z.number().min(0).default(0),
    /** Segundos que se toman; por defecto, el máximo de la plantilla. */
    seconds: z.number().min(0.5).max(30).optional(),
  }),
]);

export const reelPlanSchema = z.strictObject({
  /** Fotos y clips reales, en el orden en que aparecen. */
  media: z.array(mediaItemSchema).min(1).max(20),
  /** Textos superpuestos, con sus tiempos sobre el vídeo final (segundos). */
  texts: z
    .array(
      z
        .strictObject({
          text: z.string().min(1).max(200),
          start: z.number().min(0),
          end: z.number().positive(),
          position: textPositionSchema.optional(),
        })
        .refine((t) => t.end > t.start, 'El texto debe terminar después de empezar'),
    )
    .max(20)
    .default([]),
  /** Música opcional. Si es más corta que el reel, se repite. */
  music: z
    .strictObject({
      path: storagePathSchema,
      startAt: z.number().min(0).default(0),
      /** Volumen; por defecto, el de la plantilla. */
      volume: z.number().min(0).max(1).optional(),
    })
    .optional(),
  /** Tipografía de la marca (archivo .ttf u .otf del cubo). Manda sobre la de la plantilla. */
  fontPath: storagePathSchema.regex(/\.(ttf|otf)$/i, 'La tipografía debe ser .ttf u .otf').optional(),
});
export type ReelPlan = z.output<typeof reelPlanSchema>;

export const reelPayloadSchema = z.strictObject({
  /** Una plantilla incluida en el trabajador (por su id) o una plantilla completa. */
  template: z.union([z.strictObject({ id: z.string().min(1).max(60) }), reelTemplateSchema]),
  plan: reelPlanSchema,
  output: z.strictObject({
    path: storagePathSchema.regex(/\.mp4$/i, 'La salida debe ser .mp4'),
    /** Portada opcional (JPEG) sacada del propio reel. */
    posterPath: storagePathSchema.regex(/\.jpe?g$/i, 'La portada debe ser .jpg').optional(),
    /** Ancho de salida, para borradores más ligeros. Por defecto, el del lienzo. */
    width: evenInt(180, 1080).optional(),
  }),
});
export type ReelPayload = z.input<typeof reelPayloadSchema>;
