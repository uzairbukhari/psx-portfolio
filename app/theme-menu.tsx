'use client';
// Theme picker UI: a swatch row for the account menu and More sheet, a card grid for Settings. State lives in use-theme.ts.
import { Monitor } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CHART_PALETTES, parseChartPalette } from '@/lib/chart-palette';
import { parseThemePreference, THEMES, type Theme } from '@/lib/theme';
import { useChartPalette } from './use-chart-palette';
import { useTheme } from './use-theme';

/** A miniature dashboard drawn from the theme's own three colours: page, card and accent. */
function ThemePreview({ colors }: { colors: (typeof THEMES)[number]['swatch'] }) {
  return (
    <span className="theme-preview" aria-hidden="true" style={{ background: colors[0], borderColor: colors[2] }}>
      <span className="tp-slab">
        <i />
        <i />
      </span>
      <span className="tp-card" style={{ background: colors[1] }}>
        <i style={{ background: colors[2] }} />
        <i style={{ background: colors[2] }} />
        <i style={{ background: colors[2] }} />
        <i style={{ background: colors[2] }} />
      </span>
    </span>
  );
}

/** One row of theme swatches (Dark, Light, Midnight, Paper, System): used by the account menu and the phone's More sheet. */
export function ThemeSwatches({ labelledBy }: { labelledBy: string }) {
  const { preference, setPreference } = useTheme();
  const order = ['dark', 'light', 'midnight', 'paper'];
  const options = [...[...THEMES].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map((t) => ({ id: t.id as Theme | 'system', label: t.label, swatch: t.swatch })), { id: 'system' as const, label: 'System', swatch: null }];
  return (
    <div className="theme-swatches" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          data-slot="theme-swatch"
          role="radio"
          aria-checked={preference === o.id}
          aria-label={o.label}
          title={o.label}
          onClick={() => setPreference(parseThemePreference(o.id))}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.id === o.id);
            const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
            if (next === null) return;
            e.preventDefault();
            const n = options[(next + options.length) % options.length];
            setPreference(parseThemePreference(n.id));
            (e.currentTarget.parentElement?.children[(next + options.length) % options.length] as HTMLElement | undefined)?.focus();
          }}
          tabIndex={preference === o.id ? 0 : -1}
          style={o.swatch ? { background: o.swatch[0] } : undefined}
        >
          {o.swatch ? <i style={{ background: o.swatch[2] }} /> : <Monitor size={15} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

export function ThemeSetting() {
  const { preference, setPreference, ready } = useTheme();
  const options: {
    id: Theme | 'system';
    label: string;
    hint: string;
    swatch?: (typeof THEMES)[number]['swatch'];
  }[] = [
    ...THEMES,
    {
      id: 'system',
      label: 'System',
      hint: 'Light or dark, following your device',
    },
  ];
  return (
    <>
      <RadioGroup
        className="option-cards theme-cards"
        value={ready ? preference : ''}
        onValueChange={(v) => setPreference(parseThemePreference(v))}
      >
        {options.map((o) => (
          <label
            key={o.id}
            htmlFor={`theme-${o.id}`}
            className={
              preference === o.id ? 'option-card selected' : 'option-card'
            }
          >
            <RadioGroupItem id={`theme-${o.id}`} value={o.id} />
            {o.swatch ? (
              <ThemePreview colors={o.swatch} />
            ) : (
              <span className="theme-preview theme-preview--system" aria-hidden="true">
                <Monitor size={22} />
              </span>
            )}
            <span>
              <strong>{o.label}</strong>
              <small>{o.hint}</small>
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="set-hint">Saved on this device only.</p>
    </>
  );
}

/** Colours used by every chart; separate from the theme so any palette works in any theme. */
export function ChartPaletteSetting() {
  const { palette, setPalette } = useChartPalette();
  const ready = useTheme().ready;
  return (
    <>
      <RadioGroup
        className="option-cards palette-cards"
        value={ready ? palette : ''}
        onValueChange={(v) => setPalette(parseChartPalette(v))}
      >
        {CHART_PALETTES.map((o) => (
          <label
            key={o.id}
            htmlFor={`palette-${o.id}`}
            className={
              palette === o.id ? 'option-card selected' : 'option-card'
            }
          >
            <RadioGroupItem id={`palette-${o.id}`} value={o.id} />
            <span
              className="palette-chips"
              data-chart-palette={o.id}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>{o.label}</strong>
              <small>{o.hint}</small>
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="set-hint">
        Applies to every chart. Saved on this device only.
      </p>
    </>
  );
}
