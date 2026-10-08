'use client';
// Theme preference for the web app: persisted per device in localStorage, applied to <html data-theme>. See lib/theme.ts.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { track } from './analytics';
import {
  applyTheme,
  DEFAULT_PREFERENCE,
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const CHANGED = 'sipwise:theme-changed';

function stored(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function apply(pref: ThemePreference) {
  applyTheme(resolveTheme(pref, window.matchMedia(DARK_QUERY).matches), document);
}

function subscribe(onChange: () => void) {
  // "storage" fires for other tabs; CHANGED covers this tab.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    apply(stored());
    onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useTheme() {
  // The server snapshot is the default, so markup matches during hydration; the stored value follows right after.
  const preference = useSyncExternalStore(subscribe, stored, () => DEFAULT_PREFERENCE);
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // "System" follows the OS live.
  useEffect(() => {
    if (preference !== 'system') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage may be blocked; the theme still applies for this visit */
    }
    apply(next);
    window.dispatchEvent(new Event(CHANGED));
    track('theme_changed', { theme: next });
  }, []);

  return { preference, setPreference, ready };
}
