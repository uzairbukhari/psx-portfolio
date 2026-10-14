// Chart colour palettes. The active palette is the `data-chart-palette` attribute on <html> (absent = default); app/globals.css
// holds the colours as tokens (--cat-1..7 and --chart-up/--chart-down), so every chart and legend follows it. Like the theme,
// the choice is a per-device display preference kept in localStorage only.

export const CHART_PALETTE_STORAGE_KEY = 'sipwise.chart-palette';

export type ChartPalette = 'default' | 'vibrant' | 'accessible';

export const CHART_PALETTES: readonly {
  id: ChartPalette;
  label: string;
  hint: string;
}[] = [
  { id: 'default', label: 'Classic', hint: 'Calm, balanced colours' },
  {
    id: 'vibrant',
    label: 'Vibrant',
    hint: 'Bright, saturated colours that stand out',
  },
  {
    id: 'accessible',
    label: 'Colour-blind friendly',
    hint: 'Blue and orange for gains and losses',
  },
];

export const DEFAULT_CHART_PALETTE: ChartPalette = 'default';

export function parseChartPalette(raw: unknown): ChartPalette {
  return CHART_PALETTES.some((p) => p.id === raw)
    ? (raw as ChartPalette)
    : DEFAULT_CHART_PALETTE;
}

interface PaletteElement {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Applies a palette to <html>; the default is the absence of the attribute. */
export function applyChartPalette(palette: ChartPalette, root: PaletteElement) {
  if (palette === DEFAULT_CHART_PALETTE)
    root.removeAttribute('data-chart-palette');
  else root.setAttribute('data-chart-palette', palette);
}
