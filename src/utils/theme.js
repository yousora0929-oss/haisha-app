export const THEME_STORAGE_KEY = 'concrete_link_theme_mode_v1';

/** @typedef {'light' | 'dark' | 'system'} ThemeMode */

/** @type {ThemeMode[]} */
export const THEME_MODES = ['light', 'dark', 'system'];

export const THEME_MODE_LABELS = {
  light: 'Light',
  dark: 'Dark',
  system: 'OS Sync',
};

/**
 * @param {string} mode
 * @returns {ThemeMode}
 */
export function normalizeThemeMode(mode) {
  if (mode === 'light' || mode === 'dark' || mode === 'system') return mode;
  return 'system';
}

export function getStoredThemeMode() {
  if (typeof window === 'undefined') return 'system';
  try {
    return normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function setStoredThemeMode(mode) {
  const next = normalizeThemeMode(mode);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

/**
 * @param {ThemeMode} mode
 * @returns {'light' | 'dark'}
 */
export function resolveEffectiveTheme(mode) {
  const m = normalizeThemeMode(mode);
  if (m === 'dark') return 'dark';
  if (m === 'light') return 'light';
  if (typeof window === 'undefined') return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * @param {ThemeMode} mode
 * @returns {'light' | 'dark'}
 */
export function applyTheme(mode) {
  const stored = setStoredThemeMode(mode);
  const effective = resolveEffectiveTheme(stored);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.toggle('dark', effective === 'dark');
    root.dataset.themeMode = stored;
    root.dataset.themeEffective = effective;
    root.style.colorScheme = effective;
  }
  return effective;
}

export function initTheme() {
  return applyTheme(getStoredThemeMode());
}
