import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance as NativeAppearance, StyleSheet, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import { parseAppearance, resolveScheme, type Appearance } from './appearance';
import { palettes, type Palette, type Scheme } from './palette';

// A device preference (not account data), so it survives sign-out like the app lock does.
const KEY = 'sipwise.appearance';

type ThemeValue = { colors: Palette; scheme: Scheme; appearance: Appearance; setAppearance: (a: Appearance) => void };
const ThemeContext = createContext<ThemeValue>({ colors: palettes.light, scheme: 'light', appearance: 'system', setAppearance: () => {} });

export const useTheme = () => useContext(ThemeContext);
/** Shorthand for components that only need the colours. */
export const useColors = () => useContext(ThemeContext).colors;

/**
 * Builds a hook that returns a StyleSheet for the active palette (cached per palette), so screens keep
 * the `StyleSheet.create` habit without importing a fixed colour:
 *   const useStyles = makeStyles((c) => ({ box: { backgroundColor: c.surface } }));
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(factory: (c: Palette) => T) {
  const cache = new WeakMap<Palette, T>();
  return function useStyles(): T {
    const { colors } = useTheme();
    let sheet = cache.get(colors);
    if (!sheet) {
      sheet = StyleSheet.create(factory(colors));
      cache.set(colors, sheet);
    }
    return sheet;
  };
}

/** Holds the Appearance setting, resolves it against the phone's scheme and keeps the system UI in step. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance>('system');
  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(KEY)
      .then((v) => live && setAppearanceState(parseAppearance(v)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const scheme = resolveScheme(appearance, system);
  const colors = palettes[scheme];

  // Native dialogs (alerts, pickers) follow the same choice; "system" hands control back to the phone.
  useEffect(() => {
    try {
      NativeAppearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
    } catch {
      // older native shells without the override
    }
  }, [appearance]);
  // Window background and status bar follow the active theme (the native shell only knows the OS setting).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    SecureStore.setItemAsync(KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ colors, scheme, appearance, setAppearance }), [colors, scheme, appearance, setAppearance]);
  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeContext.Provider>
  );
}
