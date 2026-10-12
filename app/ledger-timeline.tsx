'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Pencil, Search } from 'lucide-react';
import { money, realizedSales, type Portfolio } from '@/lib/portfolio';
import {
  FILTERS,
  MONTHS,
  monthLabel,
  sipChip,
  cents,
  type EntryType,
  type Filter,
  type LedgerEntry,
} from '@/lib/ledger-entries';
export type { LedgerEntry } from '@/lib/ledger-entries';

export default function LedgerTimeline({
  portfolio,
  entries,
  ticker,
  onOpenCompany,
  hideKpis,
}: {
  portfolio: Portfolio;
  entries: LedgerEntry[];
  /** When set the list is already scoped to one company: hides the ticker and search. */
  ticker?: string;
  onOpenCompany?: (ticker: string) => void;
  hideKpis?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  // Per-month open/closed overrides; unset months follow the default (latest 3 open).
  const [monthOpen, setMonthOpen] = useState<Record<string, boolean>>({});
  const [showOlder, setShowOlder] = useState(false);
  const names = useMemo(
    () => new Map(portfolio.companies.map((c) => [c.ticker, c.name])),
    [portfolio.companies],
  );
  // Realized gain per sale (average-cost basis), keyed like the ledger entries.
  const gains = useMemo(() => {
    const out = new Map<string, number | null>();
    try {
      for (const s of realizedSales(portfolio))
        out.set('t' + s.tradeId, s.realizedGain);
    } catch {
      // An invalid ledger is reported elsewhere; skip gains rather than break Activity.
    }
    return out;
  }, [portfolio]);
  const voidedCount = entries.filter((e) => e.voided).length;
  const q = query.trim().toLowerCase();
  const matchesSearch = (e: LedgerEntry) =>
    !q ||
    e.ticker.toLowerCase().includes(q) ||
    (names.get(e.ticker) ?? '').toLowerCase().includes(q);
  const visible = entries.filter(
    (e) =>
      (showVoided || !e.voided) &&
      (filter === 'all' ||
        (filter === 'asset' ? !!e.assetKind : e.type === filter) ||
        (filter === 'buy' && e.type === 'opening')) &&
      matchesSearch(e),
  );
  // The summary cards ignore the type filter (they follow the search only).
  const live = entries.filter((e) => !e.voided && matchesSearch(e));
  const sum = (types: EntryType[]) =>
    live
      .filter((e) => types.includes(e.type) && !e.expected)
      .reduce((a, e) => a + (e.amount ?? 0), 0);
  const fees = live.reduce((a, e) => a + (e.fees ?? 0), 0);
  const gainOf = (e: LedgerEntry) =>
    e.realizedGain !== undefined ? e.realizedGain : (gains.get(e.key) ?? null);
  const sales = live.filter((e) => e.type === 'sell' && !e.noGain);
  const pnlKnown = sales.filter((e) => gainOf(e) != null);
  const pnl = cents(pnlKnown.reduce((a, e) => a + (gainOf(e) ?? 0), 0));
  const pnlUnknown = sales.length - pnlKnown.length;
  const signed = (n: number) =>
    (n > 0 ? '+' : n < 0 ? '−' : '') + money(Math.abs(n));

  const groups: [string, LedgerEntry[]][] = [];
  for (const e of visible) {
    const m = monthLabel(e.date);
    const last = groups.at(-1);
    if (last && last[0] === m) last[1].push(e);
    else groups.push([m, [e]]);
  }

  const collapsible = !ticker && !q && filter === 'all';
  const isOpen = (month: string, index: number) =>
    !collapsible || (monthOpen[month] ?? (showOlder || index < 3));
  const olderCount = collapsible ? Math.max(0, groups.length - 3) : 0;
  const flow = (rows: LedgerEntry[], types: EntryType[]) =>
    cents(
      rows
        .filter((e) => !e.voided && !e.expected && types.includes(e.type))
        .reduce((a, e) => a + (e.amount ?? 0), 0),
    );

  return (
    <div className="ledger">
      {!hideKpis && (
        <div className="ledger-kpis">
          <div>
            <span>Invested</span>
            <b>{money(cents(sum(['buy', 'opening'])))}</b>
          </div>
          <div>
            <span>Sold</span>
            <b>{money(cents(sum(['sell'])))}</b>
          </div>
          <div>
            <span>Realised profit / loss</span>
            {sales.length === 0 ? (
              <b>—</b>
            ) : (
              <b
                className={
                  pnl > 0 ? 'pos-text' : pnl < 0 ? 'neg-text' : undefined
                }
              >
                {signed(pnl)}
              </b>
            )}
            {pnlUnknown > 0 && (
              <small>{pnlUnknown} sale(s) without a cost basis</small>
            )}
          </div>
          <div>
            <span>Dividends received</span>
            <b className="pos-text">{money(cents(sum(['dividend'])))}</b>
          </div>
          <div>
            <span>Fees paid</span>
            <b>{money(cents(fees))}</b>
          </div>
        </div>
      )}
      <div className="ledger-bar">
        <div className="seg" aria-label="Entry type">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-active={filter === value || undefined}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {voidedCount > 0 && (
          <label className="check-row ledger-voided">
            <input
              type="checkbox"
              checked={showVoided}
              onChange={(e) => setShowVoided(e.target.checked)}
            />
            Voided ({voidedCount})
          </label>
        )}
        {!ticker && (
          <label className="ledger-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ticker or company"
              aria-label="Search ledger"
            />
          </label>
        )}
      </div>
      {groups.length === 0 ? (
        <p className="muted ledger-empty">Nothing matches these filters.</p>
      ) : (
        groups.map(([month, rows], index) => {
          const open = isOpen(month, index);
          const invested = flow(rows, ['buy', 'opening']);
          const received = flow(rows, ['sell', 'dividend']);
          const totals = (
            <span className="ledger-month-total">
              {invested > 0 && <span>Invested {money(invested)}</span>}
              {received > 0 && (
                <span className="pos-text">Received {money(received)}</span>
              )}
            </span>
          );
          return (
            <section key={month} className="ledger-month">
              {collapsible ? (
                <h4>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setMonthOpen({ ...monthOpen, [month]: !open })
                    }
                  >
                    <ChevronDown
                      size={15}
                      className="ledger-chev"
                      aria-hidden="true"
                    />
                    <span>{month}</span>
                    {totals}
                  </button>
                </h4>
              ) : (
                <h4>
                  <div>
                    <span>{month}</span>
                    {totals}
                  </div>
                </h4>
              )}
              {open &&
                rows.map((e) => (
                  <div
                    key={e.key}
                    className={'ledger-row' + (e.voided ? ' row-voided' : '')}
                  >
                    <span className="ledger-date">{e.date.slice(8)}</span>
                    <span className={`ledger-type type-${e.type}`}>
                      {e.label}
                    </span>
                    <div className="ledger-main">
                      <span className="ledger-tk">
                        {!ticker && (
                          <button
                            type="button"
                            className="quote-btn ticker"
                            onClick={() =>
                              e.assetKind
                                ? e.correct()
                                : onOpenCompany?.(e.ticker)
                            }
                          >
                            {e.ticker}
                          </button>
                        )}
                        {e.assetKind && (
                          <span className="ledger-sip">{e.assetKind}</span>
                        )}
                        {e.sipMonth && (
                          <span className="ledger-sip">
                            {sipChip(e.sipMonth)}
                          </span>
                        )}
                      </span>
                      <small>
                        {e.detail}
                        {e.type === 'sell' &&
                          !e.voided &&
                          gainOf(e) != null && (
                            <>
                              {' · '}
                              <span
                                className={
                                  gainOf(e)! >= 0 ? 'pos-text' : 'neg-text'
                                }
                              >
                                {gainOf(e)! >= 0 ? 'Profit ' : 'Loss '}
                                {money(Math.abs(gainOf(e)!))}
                              </span>
                            </>
                          )}
                        {e.voided ? ' · voided' : ''}
                      </small>
                      {!e.voided && e.confirm && (
                        <button
                          type="button"
                          className="link-button ledger-confirm"
                          onClick={e.confirm}
                        >
                          Mark received
                        </button>
                      )}
                    </div>
                    <span
                      className={
                        'ledger-amount amount' + (e.inflow ? ' pos-text' : '')
                      }
                    >
                      {e.amount === null
                        ? e.type === 'split'
                          ? '—'
                          : 'Unknown'
                        : (e.inflow ? '+' : '') + money(cents(e.amount))}
                    </span>
                    {e.toggleVoid ? (
                      <span className="ledger-actions">
                        {!e.voided && (
                          <button
                            type="button"
                            className="secondary compact ledger-edit"
                            aria-label={`Correct ${e.label.toLowerCase()} for ${e.ticker}`}
                            onClick={e.correct}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary compact ledger-edit"
                          onClick={e.toggleVoid}
                        >
                          {e.voided ? 'Restore' : 'Void'}
                        </button>
                      </span>
                    ) : !e.voided ? (
                      <button
                        type="button"
                        className="secondary compact ledger-edit"
                        aria-label={
                          e.assetKind
                            ? `Open ${e.ticker} in Holdings to correct it`
                            : `Correct ${e.label.toLowerCase()} for ${e.ticker}`
                        }
                        onClick={e.correct}
                      >
                        <Pencil size={13} />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
            </section>
          );
        })
      )}
      {olderCount > 0 && (
        <button
          type="button"
          className="secondary ledger-older"
          onClick={() => {
            setShowOlder(!showOlder);
            setMonthOpen({});
          }}
        >
          {showOlder
            ? 'Collapse older months'
            : `Show older months (${olderCount})`}
        </button>
      )}
    </div>
  );
}
