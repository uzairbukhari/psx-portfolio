// Steady Steps colour tokens (docs/reviews/2026-10-02-sipwise-mobile/design-spec.md §2). Pure data with no
// imports so tests can check the contrast of every text pair with plain node.

export type Palette = {
  /** Screen background. */
  bg: string;
  /** Cards and sheets. */
  surface: string;
  /** Pressed rows, segmented control track, neutral chips. */
  raised: string;
  /** Dividers and card outlines (non-text). */
  line: string;
  /** Borders of form controls; stronger than `line` so a field's edge is visible (non-text, 3:1). */
  outline: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  muted: string;
  /** Actions, links, selected state. */
  primary: string;
  /** Text and icons on a filled primary button. */
  onPrimary: string;
  /** Selected chip / tonal button background (primary text on it). */
  primarySoft: string;
  /** Positive change text. */
  gain: string;
  gainSoft: string;
  /** Negative change text. */
  loss: string;
  lossSoft: string;
  /** Stale / incomplete notices: `warn` text on `warnSoft`. */
  warn: string;
  warnSoft: string;
  /** Decorative only (step reached, progress complete). Never used for text. */
  brandMint: string;
  /** Backdrop behind sheets. */
  scrim: string;
  /** Ticker monogram backgrounds; `ink` text sits on each. */
  tints: readonly string[];
};

export const lightPalette: Palette = {
  bg: '#f5f6f2',
  surface: '#ffffff',
  raised: '#eef0ea',
  line: '#dfe3da',
  outline: '#7d8a83',
  ink: '#13201b',
  muted: '#56635d',
  primary: '#1d4ed8',
  onPrimary: '#ffffff',
  primarySoft: '#e3eafc',
  gain: '#0a7350',
  gainSoft: '#dcf3ea',
  loss: '#b42318',
  lossSoft: '#fde8e6',
  warn: '#8a5a00',
  warnSoft: '#fbf0d9',
  brandMint: '#22e0a0',
  scrim: 'rgba(19,32,27,0.45)',
  tints: ['#e3eafc', '#dcf3ea', '#f3e8ff', '#fdecd8', '#e0f2fe', '#fde8e6', '#eef0ea'],
};

export const darkPalette: Palette = {
  bg: '#0b1210',
  surface: '#121b18',
  raised: '#1a2622',
  line: '#26332e',
  outline: '#6f8179',
  ink: '#e8efe9',
  muted: '#9fb0a8',
  primary: '#7aa2ff',
  onPrimary: '#0b1210',
  primarySoft: '#1b2a4d',
  gain: '#3fd6a0',
  gainSoft: '#123328',
  loss: '#ff8a80',
  lossSoft: '#3a1a18',
  warn: '#f0c46a',
  warnSoft: '#33280f',
  brandMint: '#22e0a0',
  scrim: 'rgba(0,0,0,0.6)',
  tints: ['#1b2a4d', '#123328', '#2c2147', '#3a2a14', '#12304a', '#3a1a18', '#1a2622'],
};

export type Scheme = 'light' | 'dark';
export const palettes: Record<Scheme, Palette> = { light: lightPalette, dark: darkPalette };

/** Every foreground/background pair the UI draws text or icons with; each must reach WCAG AA (4.5:1). */
export const TEXT_PAIRS: readonly (readonly [fg: keyof Palette, bg: keyof Palette])[] = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink', 'raised'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'raised'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary', 'raised'],
  ['primary', 'primarySoft'],
  ['onPrimary', 'primary'],
  ['gain', 'bg'],
  ['gain', 'surface'],
  ['gain', 'gainSoft'],
  ['loss', 'bg'],
  ['loss', 'surface'],
  ['loss', 'lossSoft'],
  ['gain', 'raised'],
  ['loss', 'raised'],
  ['warn', 'warnSoft'],
  ['warn', 'surface'],
  ['ink', 'primarySoft'],
  ['surface', 'loss'],
  ['muted', 'primarySoft'],
];

/** Non-text pairs (control borders against the surfaces they sit on) that need 3:1. */
export const NON_TEXT_PAIRS: readonly (readonly [keyof Palette, keyof Palette])[] = [
  ['outline', 'bg'],
  ['outline', 'surface'],
];

const channel = (hex: string, i: number) => {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a #rrggbb colour. */
export const luminance = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
