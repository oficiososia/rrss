import { validateDocument, type DocumentIssue } from './document';
import { DOCUMENT_SCHEMA_VERSION, type ContentDocument } from './schema';

/** Convierte un documento de la versión N del esquema a la N + 1. No debe modificar el que recibe. */
export type DocumentMigration = (document: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migraciones del esquema: la entrada `n` lleva un documento de la versión `n`
 * a la `n + 1`. Hoy solo existe la versión 1, así que está vacía. Al cambiar el
 * esquema: subir DOCUMENT_SCHEMA_VERSION y añadir aquí la función que adapta
 * los documentos guardados (los antiguos no se reescriben: se migran al leer).
 */
export const DOCUMENT_MIGRATIONS: Record<number, DocumentMigration> = {};

export type DocumentReadFailure =
  /** No es un objeto o no dice su versión de esquema. */
  | 'not_a_document'
  /** Lo guardó una versión de la aplicación más nueva que esta. */
  | 'newer_version'
  /** Falta la migración de alguna versión intermedia (error de programación). */
  | 'missing_migration'
  /** Tras migrar, no cumple el esquema actual. */
  | 'invalid';

const MESSAGES: Record<DocumentReadFailure, string> = {
  not_a_document: 'El documento no es válido.',
  newer_version: 'Este documento se guardó con una versión más reciente de la aplicación. Recarga la página.',
  missing_migration: 'No se puede abrir este documento: falta la conversión desde su versión.',
  invalid: 'El documento no es válido.',
};

export class DocumentReadError extends Error {
  readonly reason: DocumentReadFailure;
  readonly issues: DocumentIssue[];

  constructor(reason: DocumentReadFailure, issues: DocumentIssue[] = []) {
    super(MESSAGES[reason]);
    this.name = 'DocumentReadError';
    this.reason = reason;
    this.issues = issues;
  }
}

/**
 * Aplica en orden las migraciones necesarias para llevar `raw` a la versión
 * `target`. Devuelve una copia: `raw` no se toca. No valida el resultado.
 */
export function runMigrations(
  raw: unknown,
  target: number = DOCUMENT_SCHEMA_VERSION,
  migrations: Record<number, DocumentMigration> = DOCUMENT_MIGRATIONS,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new DocumentReadError('not_a_document');
  let document = structuredClone(raw) as Record<string, unknown>;
  let version = document.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DocumentReadError('not_a_document');
  }
  if (version > target) throw new DocumentReadError('newer_version');

  while (version < target) {
    const migrate = migrations[version];
    if (!migrate) throw new DocumentReadError('missing_migration');
    document = { ...migrate(document), schemaVersion: version + 1 };
    version += 1;
  }
  return document;
}

/**
 * Lee un documento guardado con cualquier versión anterior del esquema y lo
 * devuelve en la actual, validado. Lanza `DocumentReadError` si no puede.
 */
export function migrateDocument(raw: unknown): ContentDocument {
  const result = validateDocument(runMigrations(raw));
  if (!result.ok) throw new DocumentReadError('invalid', result.issues);
  return result.document;
}
