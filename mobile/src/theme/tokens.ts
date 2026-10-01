import type { TextStyle } from 'react-native';

// Steady Steps type, space and shape (design-spec §2). Colours live in palette.ts and come from useTheme().
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
/** Screen gutter, card padding and the gap between cards. */
export const layout = { gutter: 16, cardPadding: 16, cardGap: 12, minTarget: 48 } as const;
export const radii = { card: 16, control: 12, sheet: 24, pill: 999 } as const;

// System fonts (Roboto / SF Pro) so Dynamic Type and Android font scale work without bundling.
// Numbers use tabular figures; text wraps rather than shrinking.
const styles = <T extends Record<string, TextStyle>>(x: T) => x;
export const type = styles({
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  number: { fontSize: 15, lineHeight: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.4 },
});
