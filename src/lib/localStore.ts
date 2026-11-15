// localStorage puede no existir o lanzar (modo privado, datos bloqueados): la
// app debe funcionar igual, así que todo acceso pasa por aquí.
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: se pierde la preferencia, nada más */
  }
}

export function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nada que hacer */
  }
}
