// Appearance setting (System / Light / Dark) and how it resolves to the scheme the UI draws. Pure.
import type { Scheme } from './palette.ts';

export type Appearance = 'system' | 'light' | 'dark';
export const APPEARANCES: { key: Appearance; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/** Reads a stored value; anything unknown (or missing) is "system". */
export function parseAppearance(raw: unknown): Appearance {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/**
 * The scheme to draw. "System" follows the phone (`useColorScheme()` can be null or "unspecified" before the
 * OS answers; that reads as light, the spec's default).
 */
export function resolveScheme(appearance: Appearance, system: string | null | undefined): Scheme {
  if (appearance === 'light' || appearance === 'dark') return appearance;
  return system === 'dark' ? 'dark' : 'light';
}
