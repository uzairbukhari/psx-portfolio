'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export type HistoryTag = 'buy' | 'sell' | 'income' | 'value' | 'neutral';
export type HistoryRow = {
  id: string;
  /** Already formatted, e.g. "5 Mar 2026". */
  date: string;
  tag: HistoryTag;
  tagLabel: string;
  /** What happened, e.g. "3 × 1 tola (35 g)". */
  title: string;
  note?: string;
  /** Money or units on the right, already formatted. */
  amount?: string;
  amountTone?: string;
  /** Small facts under the amount: "holding 12 g", "gain +Rs 4k". */
  meta?: string[];
  voided?: boolean;
  action?: { label: string; disabled?: boolean; onClick: () => void };
  /** Opens the entry for correction; shown beside the void / restore button. */
  edit?: { disabled?: boolean; onClick: () => void };
};

const FIRST = 6;

/**
 * An asset's record as a dated list: a coloured label for what happened, the amount on the right and the running
 * position underneath. Newest first, with the oldest hidden until asked for. Replaces the wide history tables.
 */
export default function AssetHistory({
  rows,
  summary,
  onOpenChange,
  children,
}: {
  rows: HistoryRow[];
  /** e.g. "12 records, 1 voided". */
  summary: string;
  /** Lets the owner load extra data (a chart) only once the history is opened. */
  onOpenChange?: (open: boolean) => void;
  /** Extra content shown above the list when open (a price chart). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <div className="asset-history">
      <button
        type="button"
        className="asset-history__toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          onOpenChange?.(!open);
        }}
      >
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="asset-history__chevron"
          data-open={open || undefined}
        />
        <span>{open ? 'Hide history' : 'Show history'}</span>
        <small>{summary}</small>
      </button>
      {open && (
        <div className="asset-history__body">
          {children}
          <ol className="asset-history__list">
            {shown.map((r) => (
              <li
                key={r.id}
                className={`asset-history__row${r.voided ? ' is-voided' : ''}`}
              >
                <time className="asset-history__date">{r.date}</time>
                <span className={`asset-history__tag tag-${r.tag}`}>
                  {r.tagLabel}
                  {r.voided ? ' · voided' : ''}
                </span>
                <span className="asset-history__what">
                  {r.title}
                  {r.note && <small>{r.note}</small>}
                </span>
                <span className="asset-history__amount">
                  {r.amount && (
                    <b className={`amount ${r.amountTone ?? ''}`}>{r.amount}</b>
                  )}
                  {r.meta?.map((m) => (
                    <small key={m}>{m}</small>
                  ))}
                </span>
                {(r.action || r.edit) && (
                  <span className="asset-history__action asset-history__actions">
                    {r.edit && (
                      <button
                        type="button"
                        className="secondary compact"
                        disabled={r.edit.disabled}
                        onClick={r.edit.onClick}
                      >
                        Edit
                      </button>
                    )}
                    {r.action && (
                      <button
                        type="button"
                        className="secondary compact"
                        disabled={r.action.disabled}
                        onClick={r.action.onClick}
                      >
                        {r.action.label}
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {rows.length > FIRST && (
            <button
              type="button"
              className="link-button asset-history__more"
              onClick={() => setAll(!all)}
            >
              {all ? 'Show fewer' : `Show ${rows.length - FIRST} older`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
