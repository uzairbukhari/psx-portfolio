'use client';

import type { ComponentType } from 'react';
import { Coins, Landmark, PiggyBank, Plus, TrendingUp } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type AssetPick = 'stock' | 'metal' | 'plan' | 'fund';

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
    kind: 'plan',
    label: 'Savings plan',
    hint: 'Pak-Qatar Mahana Bachat or any plan that reports a value.',
    Icon: PiggyBank,
  },
];

/** The "+" in the Holdings header: pick which kind of asset to add to this portfolio. */
export function AddAssetMenu({
  onPick,
  disabled,
}: {
  onPick: (kind: AssetPick) => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="secondary compact add-asset__trigger"
        aria-label="Add an asset"
        disabled={disabled}
      >
        <Plus size={15} /> <span>Add asset</span>
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
