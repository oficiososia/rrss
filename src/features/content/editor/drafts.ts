import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ContentDraftRow, Json } from '@/lib/database.types';
import { unwrap } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { migrateDocument, validateDocument, type ContentDocument } from '../document';

// Borrador del editor de una pieza: lo que una persona tiene a medias, guardado
// solo cada pocos segundos (tabla `content_drafts`, migración 20270103010000).
// No es una versión: no cambia el estado de la pieza ni entra en el historial.
// Sirve para no perder trabajo al cerrar la pestaña, cambiar de pantalla o
// seguir en otro dispositivo. «Guardar versión» sigue marcando los puntos que
// cuentan (y es lo que se aprueba y se publica); al guardarla, la base de datos
// borra el borrador.

export interface LoadedDraft {
  document: ContentDocument;
  /** Versión de la pieza sobre la que se empezó el borrador. */
  baseVersion: number;
  updatedAt: string;
}

/**
 * El borrador propio de una pieza, ya en la versión vigente del documento. Null
 * si no hay, si no se puede leer o si falla la consulta: un borrador nunca debe
 * impedir abrir la pieza (se abre su última versión, como siempre).
 */
export async function fetchDraft(contentId: string): Promise<LoadedDraft | null> {
  try {
    const row = unwrap(
      await supabase.from('content_drafts').select('*').eq('content_id', contentId).maybeSingle(),
    ) as ContentDraftRow | null;
    if (!row) return null;
    return { document: migrateDocument(row.data), baseVersion: row.base_version, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export async function saveDraft(contentId: string, document: ContentDocument, baseVersion: number): Promise<void> {
  // Nunca se guarda un borrador que no se podría volver a abrir.
  const checked = validateDocument(document);
  if (!checked.ok) throw new Error('El diseño tiene errores: no se puede guardar el borrador.');
  unwrap(
    await supabase.rpc('save_content_draft', {
      p_content_id: contentId,
      p_data: checked.document as unknown as Json,
      p_schema_version: checked.document.schemaVersion,
      p_base_version: baseVersion,
    }),
  );
}

export async function discardDraft(contentId: string): Promise<void> {
  unwrap(await supabase.from('content_drafts').delete().eq('content_id', contentId));
}

/**
 * Qué pasa con los cambios que aún no son una versión:
 *  - `clean`: no hay cambios (lo que se ve es la versión guardada).
 *  - `pending`: hay cambios y todavía no se han mandado.
 *  - `saving`: se están guardando.
 *  - `saved`: el borrador está guardado.
 *  - `error`: no se ha podido guardar (se reintenta con el siguiente cambio o al pulsar «Reintentar»).
 */
export type DraftStatus = 'clean' | 'pending' | 'saving' | 'saved' | 'error';

/** Lo que se espera sin cambios antes de guardar el borrador. */
export const AUTOSAVE_DELAY_MS = 1500;

interface AutosaveInput {
  contentId: string;
  document: ContentDocument;
  /** Versión sobre la que se trabaja. */
  baseVersion: number;
  /** Hay cambios respecto a la versión guardada. */
  dirty: boolean;
  /** Apagado en solo lectura. */
  enabled: boolean;
  /** El borrador con el que se abrió el editor ya está guardado tal cual. */
  startsSaved?: boolean;
  delayMs?: number;
}

export interface Autosave {
  status: DraftStatus;
  /** Guarda ya lo pendiente (antes de salir). Resuelve con true si no queda nada sin guardar. */
  flush: () => Promise<boolean>;
  /** Vuelve a intentar un guardado que falló. */
  retry: () => void;
}

/**
 * Guarda el borrador solo: un rato después del último cambio y, si la pestaña
 * se esconde o se cierra, al momento. Los guardados van de uno en uno y siempre
 * con el último documento. Cuando ya no hay cambios respecto a la versión (se
 * ha guardado una, o se ha deshecho todo), el borrador sobra y se borra.
 */
export function useDraftAutosave({
  contentId,
  document,
  baseVersion,
  dirty,
  enabled,
  startsSaved = false,
  delayMs = AUTOSAVE_DELAY_MS,
}: AutosaveInput): Autosave {
  const [status, setStatus] = useState<DraftStatus>(() => (dirty ? (startsSaved ? 'saved' : 'pending') : 'clean'));
  /** El documento que hay guardado como borrador (por identidad: el estado del editor es inmutable). */
  const savedRef = useRef<ContentDocument | null>(startsSaved && dirty ? document : null);
  /** Hay (o puede haber) un borrador en el servidor que habrá que borrar al quedar limpio. */
  const hasRemote = useRef(startsSaved);
  const latest = useRef({ document, baseVersion, dirty, enabled });
  const running = useRef<Promise<boolean> | null>(null);
  const alive = useRef(true);
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    latest.current = { document, baseVersion, dirty, enabled };
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Guarda lo último hasta que no quede nada pendiente. Nunca lanza. */
  const run = useRef<() => Promise<boolean>>(async () => true);
  run.current = () => {
    if (running.current) return running.current;
    const loop = async (): Promise<boolean> => {
      for (;;) {
        const now = latest.current;
        if (!now.enabled) return true;
        if (!now.dirty) {
          savedRef.current = null;
          if (hasRemote.current) {
            hasRemote.current = false;
            // Si no se puede borrar no pasa nada: al abrir, un borrador igual a la versión se descarta.
            await discardDraft(contentId).catch(() => undefined);
          }
          if (alive.current && !latest.current.dirty) setStatus('clean');
          if (!latest.current.dirty) return true;
          continue;
        }
        if (savedRef.current === now.document) {
          if (alive.current) setStatus('saved');
          return true;
        }
        if (alive.current) setStatus('saving');
        try {
          await saveDraft(contentId, now.document, now.baseVersion);
          hasRemote.current = true;
          savedRef.current = now.document;
        } catch {
          if (alive.current) setStatus('error');
          return false;
        }
      }
    };
    const promise = loop().finally(() => {
      running.current = null;
    });
    running.current = promise;
    return promise;
  };

  // Un rato después del último cambio (o al quedar limpio, enseguida).
  useEffect(() => {
    if (!enabled) return;
    if (!dirty) {
      if (hasRemote.current || savedRef.current) void run.current();
      else setStatus('clean');
      return;
    }
    if (savedRef.current === document) {
      setStatus('saved');
      return;
    }
    setStatus((current) => (current === 'saving' ? current : 'pending'));
    const timer = setTimeout(() => void run.current(), delayMs);
    return () => clearTimeout(timer);
  }, [document, dirty, enabled, delayMs, attempt]);

  // Al esconder o cerrar la pestaña, sin esperar.
  useEffect(() => {
    if (!enabled) return;
    const now = () => {
      if (window.document.visibilityState === 'hidden') void run.current();
    };
    const leaving = () => void run.current();
    window.document.addEventListener('visibilitychange', now);
    window.addEventListener('pagehide', leaving);
    return () => {
      window.document.removeEventListener('visibilitychange', now);
      window.removeEventListener('pagehide', leaving);
    };
  }, [enabled]);

  // Al salir del editor por cualquier sitio (el menú lateral, otra pieza, atrás), lo pendiente se guarda.
  useEffect(
    () => () => {
      if (latest.current.enabled) void run.current();
    },
    [],
  );

  return {
    status: enabled ? status : 'clean',
    flush: () => (enabled ? run.current() : Promise.resolve(true)),
    retry: () => setAttempt((n) => n + 1),
  };
}
