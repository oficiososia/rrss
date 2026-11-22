// Cabezal del editor de reels fuera del estado de React.
//
// Mientras se reproduce o se arrastra la línea de tiempo, el segundo del
// cabezal cambia en cada fotograma. Si viviera en `useState`, toda la pantalla
// (línea de tiempo, panel, barra) se volvería a pintar 60 veces por segundo.
// Aquí es un valor suelto con suscriptores: la vista previa dibuja y la línea
// de tiempo se desplaza directamente, y solo lo que enseña el número (el
// reloj, los textos elegibles) se repinta, y redondeado.
import { useSyncExternalStore } from 'react';

export interface PlayClock {
  get(): number;
  set(seconds: number): void;
  subscribe(listener: () => void): () => void;
}

export function createClock(initial = 0): PlayClock {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(seconds) {
      if (seconds === value || !Number.isFinite(seconds)) return;
      value = seconds;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** El segundo del cabezal redondeado a `step`: el componente solo se repinta cuando cambia ese redondeo. */
export function useClockValue(clock: PlayClock, step = 0.1): number {
  const read = () => Math.round(clock.get() / step) * step;
  return useSyncExternalStore(clock.subscribe, read, read);
}
