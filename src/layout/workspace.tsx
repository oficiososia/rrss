import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readLocal, writeLocal } from '@/lib/localStore';

// Estado de la barra lateral de la app (plegada o no) y «modo de trabajo» de las
// pantallas que ocupan todo el alto (el editor de piezas): en ese modo la página
// no se desplaza, no hay pie legal y solo hacen scroll sus paneles.

const KEY = 'rrss.sidebar.collapsed';
/** Por debajo de este ancho, el editor pliega solo el menú lateral al entrar. */
export const NARROW_EDITOR_WIDTH = 1440;

interface WorkspaceValue {
  /** Una pantalla de trabajo (editor) está abierta. */
  working: boolean;
  setWorking: (working: boolean) => void;
  /** El menú lateral se ve plegado (preferencia, o plegado solo en el editor de una pantalla estrecha). */
  collapsed: boolean;
  toggle: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue>({
  working: false,
  setWorking: () => {},
  collapsed: false,
  toggle: () => {},
});

export const useWorkspace = () => useContext(WorkspaceContext);

/** Una pantalla de trabajo: mientras está montada, la página ocupa el alto de la ventana y no se desplaza. */
export function useWorkspaceMode(): void {
  const { setWorking } = useContext(WorkspaceContext);
  useEffect(() => {
    setWorking(true);
    return () => setWorking(false);
  }, [setWorking]);
}

/** ¿Se está escribiendo en un campo? Ctrl+B no debe plegar el menú entonces. */
function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [working, setWorkingState] = useState(false);
  const [preferred, setPreferred] = useState<boolean>(() => readLocal<boolean>(KEY, false) === true);
  // Si la persona pliega o despliega en el editor, su elección manda sobre el plegado automático.
  const [manual, setManual] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_EDITOR_WIDTH);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_EDITOR_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const setWorking = useCallback((next: boolean) => {
    setWorkingState(next);
    if (!next) setManual(false);
  }, []);

  const collapsed = manual || !working || !narrow ? preferred : true;

  const value = useMemo<WorkspaceValue>(() => {
    const toggle = () => {
      setManual(true);
      setPreferred(!collapsed);
      writeLocal(KEY, !collapsed);
    };
    return { working, setWorking, collapsed, toggle };
  }, [working, setWorking, collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'b' || event.defaultPrevented || isTyping(event.target)) return;
      event.preventDefault();
      value.toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [value]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
