// Análisis del ritmo de la música elegida, a petición (no se descarga ni se
// decodifica la canción hasta que se pide). El resultado se guarda por ruta
// mientras dure la sesión para no repetir el análisis.
import { useCallback, useState } from 'react';
import { analyzeMusic, type BeatAnalysis } from './rhythm';

const cache = new Map<string, BeatAnalysis>();

export interface BeatsState {
  analysis: BeatAnalysis | null;
  busy: boolean;
  error: string | null;
  /** Analiza (o devuelve el análisis ya hecho). Null si falla. */
  analyze: () => Promise<BeatAnalysis | null>;
}

export function useBeats(path: string | undefined, url: string | undefined): BeatsState {
  // Lo analizado en esta sesión (por ruta); `version` fuerza el repintado al guardar un análisis nuevo.
  const [, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ path: string | undefined; message: string } | null>(null);
  const analysis = path ? (cache.get(path) ?? null) : null;
  const error = failure && failure.path === path ? failure.message : null;

  const analyze = useCallback(async () => {
    if (!path || !url) {
      setFailure({ path, message: 'La música todavía no está lista para analizarla.' });
      return null;
    }
    const known = cache.get(path);
    if (known) return known;
    setBusy(true);
    setFailure(null);
    try {
      const result = await analyzeMusic(url);
      cache.set(path, result);
      setVersion((v) => v + 1);
      return result;
    } catch (e) {
      setFailure({ path, message: e instanceof Error ? e.message : 'No se ha podido analizar la música.' });
      return null;
    } finally {
      setBusy(false);
    }
  }, [path, url]);

  return { analysis, busy, error, analyze };
}
