// Web app themes. The active theme is the `data-theme` attribute on <html>; app/globals.css defines one token block per
// theme. The choice is a per-device display preference kept in localStorage only (never in the vault or on the server).
// An inline script (themeInitScript) applies it before first paint so there is no flash of the wrong theme.

export const THEME_STORAGE_KEY = 'sipwise.theme';

export type Theme = 'light' | 'dark' | 'midnight' | 'paper';
export type ThemePreference = Theme | 'system';

export const THEMES: readonly { id: Theme; label: string; hint: string; swatch: readonly [string, string, string] }[] = [
  { id: 'light', label: 'Light', hint: 'Bright and clean', swatch: ['#f5f7fb', '#ffffff', '#1d4ed8'] },
  { id: 'dark', label: 'Dark', hint: 'Navy night mode', swatch: ['#05070d', '#111b30', '#3b82f6'] },
  { id: 'midnight', label: 'Midnight', hint: 'True black for OLED', swatch: ['#000000', '#101016', '#4d8dff'] },
  { id: 'paper', label: 'Paper', hint: 'Warm, easy on the eyes', swatch: ['#f6f0e4', '#fffaf0', '#9a4412'] },
];

export const DEFAULT_THEME: Theme = 'light';
export const DEFAULT_PREFERENCE: ThemePreference = DEFAULT_THEME;

/** Browser chrome colour (meta theme-color) and native control scheme for each theme. */
export const THEME_META: Record<Theme, { bg: string; scheme: 'light' | 'dark' }> = {
  light: { bg: '#f5f7fb', scheme: 'light' },
  dark: { bg: '#05070d', scheme: 'dark' },
  midnight: { bg: '#000000', scheme: 'dark' },
  paper: { bg: '#f6f0e4', scheme: 'light' },
};

const PREFERENCES: readonly string[] = [...THEMES.map((t) => t.id), 'system'];

export function parseThemePreference(raw: unknown): ThemePreference {
  return typeof raw === 'string' && PREFERENCES.includes(raw) ? (raw as ThemePreference) : DEFAULT_PREFERENCE;
}

/** "system" follows the OS: dark only when the OS asks for dark, otherwise the default light theme. */
export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean | null): Theme {
  if (pref !== 'system') return pref;
  return systemPrefersDark ? 'dark' : DEFAULT_THEME;
}

interface ThemeDocument {
  documentElement: { setAttribute(name: string, value: string): void; style: { colorScheme: string } };
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

/** Applies a resolved theme to the document (attribute, native control scheme, browser chrome colour). */
export function applyTheme(theme: Theme, doc: ThemeDocument) {
  const meta = THEME_META[theme];
  doc.documentElement.setAttribute('data-theme', theme);
  doc.documentElement.style.colorScheme = meta.scheme;
  doc.querySelector('meta[name=theme-color]')?.setAttribute('content', meta.bg);
}

/** Runs in <head> before first paint. Self-contained (no imports); built from the constants above so they cannot drift. */
export function themeInitScript(): string {
  return `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},m=${JSON.stringify(THEME_META)},p=${JSON.stringify(PREFERENCES)},d=${JSON.stringify(DEFAULT_THEME)};var v=null;try{v=localStorage.getItem(k)}catch(e){}if(p.indexOf(v)<0)v=d;var t=v;if(v==='system'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':d}var e=document.documentElement;e.setAttribute('data-theme',t);e.style.colorScheme=m[t].scheme;var c=document.querySelector('meta[name=theme-color]');if(c)c.setAttribute('content',m[t].bg)}catch(e){}})();`;
}
