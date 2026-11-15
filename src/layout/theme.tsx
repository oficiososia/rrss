import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readLocal, writeLocal } from '@/lib/localStore';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'rrss.theme';

interface ThemeValue {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeValue>({ choice: 'system', setChoice: () => {} });

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => {
    const stored = readLocal<string>(KEY, 'system');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });

  useEffect(() => {
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark());
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    writeLocal(KEY, next);
  }, []);

  const value = useMemo(() => ({ choice, setChoice }), [choice, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
