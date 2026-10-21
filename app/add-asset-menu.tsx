'use client';

import type { ComponentType } from 'react';
import { Banknote, Coins, Landmark, Layers, PiggyBank, TrendingUp } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type AssetPick = 'stock' | 'metal' | 'plan' | 'fund' | 'currency';

export const ASSET_CHOICES: {
  kind: AssetPick;
  label: string;
  hint: string;
  Icon: ComponentType<{ size?: number }>;
}[] = [
  {
    kind: 'stock',
    label: 'Stocks',
    hint: 'PSX shares: record a purchase or import your broker history.',
    Icon: TrendingUp,
  },
  {
    kind: 'fund',
    label: 'Mutual fund',
    hint: 'Any fund listed with MUFAP, valued from its daily price.',
    Icon: Landmark,
  },
  {
    kind: 'metal',
    label: 'Gold or Silver',
    hint: 'Coins and bars, valued at today’s rate.',
    Icon: Coins,
  },
  {
    kind: 'currency',
    label: 'Foreign currency',
    hint: 'US dollars, UAE dirhams or Saudi riyals, tracked in rupees.',
    Icon: Banknote,
  },
  {
    kind: 'plan',
    label: 'Savings plan',
    hint: 'Pak-Qatar Mahana Bachat or any plan that reports a value.',
    Icon: PiggyBank,
  },
];

/** "Add asset" beside the header's + Add: pick which kind of asset to add to this portfolio. */
export function AddAssetMenu({
  onPick,
  disabled,
  header = false,
}: {
  onPick: (kind: AssetPick) => void;
  disabled?: boolean;
  /** Styled as a header button (the label hides on narrow screens). */
  header?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={header ? 'hdr-btn hdr-asset' : 'secondary compact add-asset__trigger'}
        data-slot={header ? 'hdr' : undefined}
        aria-label="Add an asset"
        disabled={disabled}
      >
        <Layers size={header ? 18 : 15} /> <span className={header ? 'hdr-label' : undefined}>Add asset</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ASSET_CHOICES.map(({ kind, label, Icon }) => (
          <DropdownMenuItem key={kind} onClick={() => onPick(kind)}>
            <Icon size={16} /> {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The empty-portfolio screen's choices. */
export function StartTiles({
  onPick,
  disabled,
  only,
}: {
  onPick: (kind: AssetPick) => void;
  disabled?: boolean;
  /** Limit the choices (the All view can only start with stocks). */
  only?: AssetPick[];
}) {
  return (
    <div className="start-grid">
      {ASSET_CHOICES.filter((c) => !only || only.includes(c.kind)).map(
        ({ kind, label, hint, Icon }) => (
          <button
            key={kind}
            type="button"
            className="start-tile"
            disabled={disabled}
            onClick={() => onPick(kind)}
          >
            <span className="start-tile__icon" aria-hidden="true">
              <Icon size={20} />
            </span>
            <b>{label}</b>
            <small>{hint}</small>
          </button>
        ),
      )}
    </div>
  );
}
