'use client';
// Theme picker UI: a submenu for the account dropdown and a card grid for Settings. State lives in use-theme.ts.
import { Monitor, Palette } from 'lucide-react';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { parseThemePreference, THEMES, type Theme } from '@/lib/theme';
import { useTheme } from './use-theme';

function Swatch({ colors }: { colors: (typeof THEMES)[number]['swatch'] }) {
  return (
    <span className="theme-swatch" aria-hidden="true" style={{ background: colors[0], borderColor: colors[2] }}>
      <i style={{ background: colors[1] }} />
      <i style={{ background: colors[2] }} />
    </span>
  );
}

export function ThemeMenuItems() {
  const { preference, setPreference } = useTheme();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette size={15} /> Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setPreference(parseThemePreference(v))}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id}>
              <Swatch colors={t.swatch} /> {t.label}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value="system">
            <Monitor size={15} /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function ThemeSetting() {
  const { preference, setPreference, ready } = useTheme();
  const options: { id: Theme | 'system'; label: string; hint: string; swatch?: (typeof THEMES)[number]['swatch'] }[] = [
    ...THEMES,
    { id: 'system', label: 'System', hint: 'Light or dark, following your device' },
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
            className={preference === o.id ? 'option-card selected' : 'option-card'}
          >
            <RadioGroupItem id={`theme-${o.id}`} value={o.id} />
            {o.swatch ? <Swatch colors={o.swatch} /> : <Monitor size={18} aria-hidden="true" />}
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
