// Dark palette copied from the web app (app/globals.css) so both look the same.
export const colors = {
  background: '#05070d',
  foreground: '#e7edf7',
  card: '#0f1a2e',
  cardRaised: '#15233b',
  border: 'rgba(148,178,225,0.16)',
  borderStrong: 'rgba(148,178,225,0.32)',
  muted: '#8fa3c4',
  primary: '#3b82f6',
  primarySoft: 'rgba(59,130,246,0.16)',
  primaryForeground: '#ffffff',
  success: '#22e0a0',
  successSoft: 'rgba(34,224,160,0.14)',
  danger: '#ff5d6c',
  dangerSoft: 'rgba(255,93,108,0.14)',
  warn: '#e8c27a',
  warnSoft: 'rgba(211,154,41,0.14)',
};

export const radius = 14;
export const radii = { sm: 10, md: 14, lg: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

// One type scale for the whole app so headings, labels and numbers stay consistent.
export const type = {
  largeTitle: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.6 },
  hero: { fontSize: 38, lineHeight: 44, fontWeight: '700', letterSpacing: -0.8 },
} as const;
