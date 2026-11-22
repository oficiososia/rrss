// Recuerda qué secciones del panel de «Diseño» deja abiertas cada persona.
// Es solo una comodidad del navegador: si no se puede leer o escribir
// (ventana privada, datos bloqueados), el panel funciona igual con sus valores de partida.

const KEY = 'rrss.editor.secciones.v1';

type Memory = Record<string, boolean>;

function read(): Memory {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'boolean'));
  } catch {
    return {};
  }
}

/** Si la persona dejó esta sección abierta (true) o cerrada (false); undefined si nunca la tocó. */
export function recalledSection(id: string): boolean | undefined {
  return read()[id];
}

/** Apunta lo que la persona hizo con la sección. */
export function rememberSection(id: string, open: boolean): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: open }));
  } catch {
    // Sin almacenamiento: no se recuerda y ya está.
  }
}

export const SECTION_MEMORY_KEY = KEY;
