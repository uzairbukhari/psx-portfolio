'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- a pill switch is a labelled group of toggle buttons and the ring is a CSS drawing described with role=img */

import type { CSSProperties, ReactNode } from 'react';
import { ChartInfo } from './chart-info';

/** A bento card: eyebrow, a headline that states what the chart shows, the chart, and where the numbers come from. */
export function InsightCard({
  eyebrow,
  title,
  info,
  size = 'half',
  aside,
  source,
  index = 0,
  children,
}: {
  eyebrow: string;
  /** The takeaway: a sentence computed from the data, not a generic label. */
  title: ReactNode;
  info?: string;
  size?: 'wide' | 'half' | 'third';
  aside?: ReactNode;
  source?: string;
  /** Position in the grid, for the staggered entrance. */
  index?: number;
  children: ReactNode;
}) {
  return (
    <section
      className="ic panel"
      data-size={size}
      style={{ '--ic-i': index } as CSSProperties}
    >
      <header className="ic-head">
        <div>
          <p className="lbl">{eyebrow}</p>
          <h3>
            {title}
            {info && <ChartInfo text={info} />}
          </h3>
        </div>
        {aside && <div className="ic-aside">{aside}</div>}
      </header>
      <div className="ic-body">{children}</div>
      {source && <p className="ic-source">{source}</p>}
    </section>
  );
}

/** Small pill switch used inside cards and above class views. */
export function PillSwitch<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
  label: string;
}) {
  return (
    <div className="sw-seg ic-switch" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          data-slot="pill"
          data-active={value === o.key || undefined}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A ring drawn with CSS only, for a single percentage. */
export function Ring({
  percent,
  label,
  tone = 'primary',
}: {
  percent: number;
  label: string;
  tone?: 'primary' | 'warn' | 'danger' | 'success';
}) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="ic-ring"
      data-tone={tone}
      style={{ '--p': p } as CSSProperties}
      role="img"
      aria-label={`${label}: ${Math.round(p)}%`}
    >
      <span className="num">{Math.round(p)}%</span>
    </div>
  );
}
