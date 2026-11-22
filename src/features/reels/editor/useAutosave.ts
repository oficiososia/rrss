// Guardado automático del editor de reels.
//
// Mientras se edita, el montaje se guarda solo como BORRADOR de la pieza
// (`reel_drafts`, una fila por pieza) un momento después del último cambio, al
// ocultar la pestaña y al salir de la pantalla. No es una versión: no entra en
// el historial ni se puede montar o aprobar; sirve para que nada se pierda si
// se sale sin pulsar «Guardar versión». Al guardar una versión, la base de
// datos borra el borrador.
//
// Si el guardado no llega al servidor (sin cobertura, la pestaña se cierra a
// medias), queda una copia de reserva en este navegador, que se usa al volver.
//
// El estado que devuelve es lo que enseña la pantalla («Guardando…»,
// «Guardado», «Sin guardar»): solo dice «Guardado» cuando el servidor lo ha
// confirmado.
import { useCallback, useEffect, useRef, useState } from 'react';
import { discardReelDraft, dropLocalDraft, keepLocalDraft, saveReelDraft } from './api';
import type { ReelProject } from './project';

/** Cuánto se espera tras el último cambio antes de guardar. */
export const AUTOSAVE_DELAY_MS = 1500;
/** Cada cuánto se reintenta si el guardado falla. */
export const AUTOSAVE_RETRY_MS = 8000;

export type AutosaveState =
  /** Nada que guardar: el montaje es el de la versión guardada. */
  | 'clean'
  /** Hay cambios que todavía no se han mandado. */
  | 'pending'
  | 'saving'
  /** El borrador del servidor es lo que se ve. */
  | 'saved'
  | 'error';

export interface AutosaveOptions {
  contentId: string;
  project: ReelProject;
  /** El montaje serializado (lo que se compara con lo último guardado). */
  snapshot: string;
  /** ¿Se diferencia de la versión guardada? */
  dirty: boolean;
  baseVersion: number;
  /** Apagado en solo lectura. */
  enabled: boolean;
  /** Lo que ya hay guardado como borrador al abrir (si se abrió con él). */
  initialSnapshot?: string | null;
}

export interface Autosave {
  state: AutosaveState;
  /** Guarda ya lo pendiente (sin esperar). */
  flush: () => void;
  /** Se ha guardado una versión: el borrador ya no existe en el servidor. */
  markVersionSaved: () => void;
  /** Quita el borrador del servidor (al deshacerlo todo o al descartarlo). */
  discard: () => void;
}

/** Lo que se sabe del servidor: qué montaje tiene confirmado y cómo va el último envío. */
interface Remote {
  /** Lo último que el servidor ha confirmado (null = no hay borrador). */
  stored: string | null;
  saving: boolean;
  failed: boolean;
}

export function useAutosave(options: AutosaveOptions): Autosave {
  const { snapshot, dirty, enabled } = options;
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [remote, setRemote] = useState<Remote>({
    stored: options.initialSnapshot ?? null,
    saving: false,
    failed: false,
  });
  const stored = useRef<string | null>(options.initialSnapshot ?? null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const save = useRef<() => void>(() => undefined);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const later = useCallback(
    (ms: number) => {
      clearTimer();
      timer.current = window.setTimeout(() => save.current(), ms);
    },
    [clearTimer],
  );

  useEffect(() => {
    save.current = () => {
      const current = latest.current;
      if (!current.enabled || !current.dirty || inFlight.current || stored.current === current.snapshot) return;
      inFlight.current = true;
      setRemote((r) => ({ ...r, saving: true }));
      const sent = current.snapshot;
      saveReelDraft(current.contentId, current.project, current.baseVersion).then(
        () => {
          inFlight.current = false;
          stored.current = sent;
          dropLocalDraft(current.contentId);
          setRemote({ stored: sent, saving: false, failed: false });
          // Se siguió editando mientras se guardaba: otra vuelta.
          if (latest.current.dirty && latest.current.snapshot !== sent) later(AUTOSAVE_DELAY_MS);
        },
        () => {
          inFlight.current = false;
          // No ha llegado al servidor: al menos queda en este navegador.
          keepLocalDraft(current.contentId, current.project, current.baseVersion);
          setRemote((r) => ({ ...r, saving: false, failed: true }));
          later(AUTOSAVE_RETRY_MS);
        },
      );
    };
  });

  const discard = useCallback(() => {
    clearTimer();
    dropLocalDraft(latest.current.contentId);
    if (stored.current === null) return;
    stored.current = null;
    setRemote({ stored: null, saving: false, failed: false });
    void discardReelDraft(latest.current.contentId).catch(() => undefined);
  }, [clearTimer]);

  // Cada cambio vuelve a poner el reloj: se guarda un momento después del último.
  // Si se ha vuelto a la versión guardada (deshaciendo), el borrador sobra.
  useEffect(() => {
    if (!enabled) return;
    if (!dirty) {
      const id = window.setTimeout(discard, 0);
      return () => window.clearTimeout(id);
    }
    if (stored.current === snapshot) return;
    later(AUTOSAVE_DELAY_MS);
    return clearTimer;
  }, [snapshot, dirty, enabled, discard, later, clearTimer]);

  const flush = useCallback(() => {
    clearTimer();
    const current = latest.current;
    // Al salir, el guardado puede quedarse a medias: antes, la copia de reserva.
    if (current.enabled && current.dirty && stored.current !== current.snapshot) {
      keepLocalDraft(current.contentId, current.project, current.baseVersion);
    }
    save.current();
  }, [clearTimer]);

  // Al ocultar la pestaña (cambiar de aplicación en el móvil, cerrar) y al salir de la pantalla.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [enabled, flush]);

  const markVersionSaved = useCallback(() => {
    clearTimer();
    dropLocalDraft(latest.current.contentId);
    stored.current = null;
    setRemote({ stored: null, saving: false, failed: false });
  }, [clearTimer]);

  const state: AutosaveState = !dirty
    ? 'clean'
    : remote.stored === snapshot
      ? 'saved'
      : remote.saving
        ? 'saving'
        : remote.failed
          ? 'error'
          : 'pending';
  return { state, flush, markVersionSaved, discard };
}

export const AUTOSAVE_LABEL: Record<AutosaveState, string> = {
  clean: 'Guardado',
  pending: 'Guardando…',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'Sin guardar',
};
