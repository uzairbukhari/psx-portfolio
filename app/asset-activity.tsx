'use client';

import { useState } from 'react';
import type { HistoryRow } from './asset-history';

const monthHeading = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-15T12:00:00Z`)
    .toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    .toUpperCase();
const TYPE_CLASS = {
  buy: 'buy',
  sell: 'sell',
  income: 'dividend',
  value: 'opening',
  neutral: 'opening',
} as const;

/**
 * An asset's records laid out like the company page's Activity: month blocks, a day, a coloured type pill, what
 * happened, the amount and Edit / Void. The newest few show first; "Show older" lists the rest.
 */
export default function ActivityList({
  rows,
  limit = 5,
  empty = 'No records yet.',
}: {
  rows: HistoryRow[];
  limit?: number;
  empty?: string;
}) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const shown = all ? rows : rows.slice(0, limit);
  const months: { month: string; items: HistoryRow[] }[] = [];
  for (const r of shown) {
    const month = (r.iso ?? '').slice(0, 7);
    const last = months.at(-1);
    if (last?.month === month) last.items.push(r);
    else months.push({ month, items: [r] });
  }
  return (
    <div className="fund-activity">
      {months.map(({ month, items }) => (
        <div className="ledger-month" key={month}>
          {month && (
            <h4>
              <div>{monthHeading(month)}</div>
            </h4>
          )}
          {items.map((r) => (
            <div
              className="ledger-row"
              key={r.id}
              style={r.voided ? { opacity: 0.55 } : undefined}
            >
              <span className="ledger-date">{(r.iso ?? '').slice(8)}</span>
              <span className={`ledger-type type-${TYPE_CLASS[r.tag]}`}>
                {r.tagLabel}
              </span>
              <div className="ledger-main">
                <small>
                  {[
                    r.title,
                    ...(r.meta ?? []),
                    r.note,
                    r.voided ? 'voided' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
              <span className={`ledger-amount ${r.amountTone ?? ''}`}>
                {r.amount ?? ''}
              </span>
              {(r.edit || r.action) && (
                <span className="fund-activity__actions">
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
            </div>
          ))}
        </div>
      ))}
      {rows.length > limit && (
        <button
          type="button"
          className="link-button ledger-older"
          onClick={() => setAll(!all)}
        >
          {all ? 'Show fewer' : `Show ${rows.length - limit} older`}
        </button>
      )}
    </div>
  );
}
