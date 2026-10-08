'use client';
// Theme preference for the web app: persisted per device in localStorage, applied to <html data-theme>. See lib/theme.ts.
import { useCallback, useEffect, useState } from 'react';
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

export function useTheme() {
  // Starts at the default so server and client markup match; the real value is read after mount.
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_PREFERENCE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPreferenceState(stored());
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const next = stored();
      setPreferenceState(next);
      apply(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // "System" follows the OS live.
  useEffect(() => {
    if (preference !== 'system') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage may be blocked; the theme still applies for this visit */
    }
    apply(next);
    track('theme_changed', { theme: next });
  }, []);

  return { preference, setPreference, ready };
}
