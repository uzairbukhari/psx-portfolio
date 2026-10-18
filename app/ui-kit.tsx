// Small building blocks shared by the redesigned pages. Colours come from the theme tokens in redesign.css.
import type { ReactNode } from 'react';

/** Tiles take their hue from the symbol, so a company looks the same on every page. */
export function hueOf(ticker: string): number {
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function TickerTile({ ticker, size = 36 }: { ticker: string; size?: number }) {
  return (
    <span
      className="ticker-tile"
      aria-hidden="true"
      style={{ '--tt': `${size}px`, '--hue': hueOf(ticker) } as React.CSSProperties}
    >
      {ticker.slice(0, 2)}
    </span>
  );
}

/** A gain or loss as a pill: "+4.2%". */
export function DeltaPill({ value, suffix = '%', digits = 1 }: { value: number; suffix?: string; digits?: number }) {
  const loss = value < 0;
  return (
    <span className={'delta-pill' + (loss ? ' is-loss' : '')}>
      {loss ? '−' : '+'}
      {Math.abs(value).toFixed(digits)}
      {suffix}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="sw-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" data-slot="seg" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat-tile">
      <span className="lbl">{label}</span>
      <b className="num">{children}</b>
    </div>
  );
}

export function Skeleton({ width = '100%', height = 16 }: { width?: number | string; height?: number }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height }} />;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}
