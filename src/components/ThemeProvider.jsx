import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyTheme,
  getStoredThemeMode,
  initTheme,
  normalizeThemeMode,
  resolveEffectiveTheme,
} from '../utils/theme.js';

const ThemeContext = createContext({
  mode: 'system',
  effective: 'light',
  setMode: () => {},
});

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => getStoredThemeMode());
  const [effective, setEffective] = useState(() => initTheme());

  const setMode = useCallback((next) => {
    const normalized = normalizeThemeMode(next);
    setModeState(normalized);
    setEffective(applyTheme(normalized));
  }, []);

  useEffect(() => {
    if (mode !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setEffective(applyTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key && e.key !== 'concrete_link_theme_mode_v1') return;
      const stored = getStoredThemeMode();
      setModeState(stored);
      setEffective(resolveEffectiveTheme(stored));
      applyTheme(stored);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({ mode, effective, setMode }), [mode, effective, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
