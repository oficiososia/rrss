import {
  CANVAS_SIZES,
  DOCUMENT_SCHEMA_VERSION,
  contentDocumentSchema,
  type AspectRatio,
  type ContentDocument,
} from './schema';

export interface DocumentIssue {
  /** Dónde está el problema: «layers.2.fontSize», «copy.hashtags.0»… Vacío si es el documento entero. */
  path: string;
  message: string;
}

export type DocumentValidation = { ok: true; document: ContentDocument } | { ok: false; issues: DocumentIssue[] };

/** Documento nuevo: un lienzo de la proporción pedida, sin capas ni texto. */
export function createEmptyDocument(
  options: { aspectRatio?: AspectRatio; backgroundColor?: string } = {},
): ContentDocument {
  const aspectRatio = options.aspectRatio ?? '1:1';
  return contentDocumentSchema.parse({
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    canvas: { aspectRatio, ...CANVAS_SIZES[aspectRatio], backgroundColor: options.backgroundColor },
  });
}

/**
 * Comprueba que algo es un documento de la versión actual del esquema. Si lo
 * es, lo devuelve normalizado (valores por defecto puestos, hashtags sin
 * almohadilla); si no, dice qué falla y dónde. No migra: para leer un
 * documento guardado, `migrateDocument`.
 */
export function validateDocument(input: unknown): DocumentValidation {
  const result = contentDocumentSchema.safeParse(input);
  if (result.success) return { ok: true, document: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  };
}
