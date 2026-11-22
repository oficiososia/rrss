// Lo puro del dictado en un campo de texto (sin React).

/** Añade lo dictado al texto que ya había, con un espacio de por medio, sin pasar del máximo. */
export function appendDictation(current: string, dictated: string, maxLength?: number): string {
  const phrase = dictated.trim();
  if (!phrase) return current;
  const base = current.trimEnd();
  const joined = base ? `${base} ${phrase}` : phrase;
  return maxLength !== undefined && joined.length > maxLength ? joined.slice(0, maxLength).trimEnd() : joined;
}
