'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Pencil, Search } from 'lucide-react';
import { describePieces, metalPosition, type Asset } from '@/lib/assets';
import { fundPosition } from '@/lib/funds';
import {
  money,
  realizedSales,
  type Dividend,
  type Portfolio,
  type StockSplit,
  type TaxedDividend,
  type Trade,
} from '@/lib/portfolio';

type EntryType =
  | 'buy'
  | 'sell'
  | 'opening'
  | 'adjustment'
  | 'dividend'
  | 'split';
type Filter = 'all' | 'buy' | 'sell' | 'dividend' | 'split' | 'asset';

export type LedgerEntry = {
  key: string;
  date: string;
  ticker: string;
  type: EntryType;
  label: string;
  detail: string;
  /** SIP plan month (YYYY-MM) for monthly-plan buys, shown as a chip. */
  sipMonth?: string;
  fees: number | null;
  amount: number | null;
  /** true when the amount is money received rather than paid */
  inflow: boolean;
  voided: boolean;
  /** An announced dividend that is not yet confirmed as received. */
  expected?: boolean;
  /** Set on gold, savings plan and fund entries: the kind of asset, shown as a chip beside its name. */
  assetKind?: 'Gold' | 'Silver' | 'Plan' | 'Fund';
  /** Gain on this sale worked out with the asset's own rules; undefined means "look it up in the stock ledger". */
  realizedGain?: number | null;
  /** True for money taken out of a savings plan: it is cash back, not a sale with a profit. */
  noGain?: boolean;
  correct: () => void;
  /** Present on expected dividends: opens the confirm-receipt form. */
  confirm?: () => void;
};

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['buy', 'Buys'],
  ['sell', 'Sells'],
  ['dividend', 'Dividends'],
  ['split', 'Splits'],
  ['asset', 'Other assets'],
];

const cents = (n: number) => Math.round(n * 100) / 100;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const sipChip = (month: string) =>
  `SIP ${MONTHS[Number(month.slice(5, 7)) - 1] ?? month}`;

const monthLabel = (date: string) =>
  new Date(`${date.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function buildEntries({
  trades,
  dividends,
  splits,
  taxed,
  onCorrectTrade,
  onCorrectDividend,
  onCorrectSplit,
  onConfirmDividend,
}: {
  trades: Trade[];
  dividends: Dividend[];
  splits: StockSplit[];
  taxed: TaxedDividend[];
  onCorrectTrade: (t: Trade) => void;
  onCorrectDividend: (d: Dividend) => void;
  onCorrectSplit: (s: StockSplit) => void;
  onConfirmDividend?: (d: Dividend) => void;
}): LedgerEntry[] {
  const byId = new Map(taxed.map((t) => [t.id, t]));
  const out: LedgerEntry[] = [];
  for (const t of trades) {
    const cash =
      t.price === null
        ? null
        : t.shares * t.price + (t.kind === 'sell' ? -t.fees : t.fees);
    out.push({
      key: 't' + t.id,
      date: t.date,
      ticker: t.ticker,
      type: t.kind,
      label:
        t.kind === 'opening'
          ? 'Opening'
          : t.kind === 'adjustment'
            ? 'Holding adjustment'
            : t.kind === 'sell'
              ? 'Sale'
              : 'Purchase',
      detail:
        `${t.shares.toLocaleString()} sh` +
        (t.price === null ? '' : ` @ ${money(t.price)}`),
      sipMonth: t.month || undefined,
      fees: t.fees,
      amount: cash,
      inflow: t.kind === 'sell',
      voided: !!t.voided,
      correct: () => onCorrectTrade(t),
    });
  }
  for (const d of dividends) {
    const tax = byId.get(d.id);
    const net = tax?.netAmount ?? tax?.grossAmount ?? null;
    const expected = tax?.status === 'expected';
    out.push({
      key: 'd' + d.id,
      date: d.date,
      ticker: d.ticker,
      type: 'dividend',
      label: expected ? 'Expected dividend' : 'Dividend',
      detail:
        (d.perShare === undefined ? '' : `${money(d.perShare)}/sh · `) +
        (d.source === 'import'
          ? 'CDC import'
          : d.source === 'auto'
            ? 'PSX auto'
            : 'Manual') +
        (tax?.netAmount == null
          ? ' · gross'
          : tax.taxBasis === 'actual'
            ? ' · net of recorded tax'
            : ' · net of estimated tax') +
        (expected
          ? ` · not yet received${tax?.entitlementCertain === false ? ' · entitlement date unconfirmed' : ''}`
          : d.paymentDate
            ? ` · paid ${d.paymentDate}${d.paymentDateEstimated ? ' (estimated)' : ''}`
            : ''),
      fees: null,
      amount: net,
      inflow: !expected,
      voided: !!d.voided,
      expected,
      correct: () => onCorrectDividend(d),
      confirm:
        expected && onConfirmDividend ? () => onConfirmDividend(d) : undefined,
    });
  }
  for (const s of splits) {
    out.push({
      key: 's' + s.id,
      date: s.date,
      ticker: s.ticker,
      type: 'split',
      label: 'Split',
      detail:
        `${s.newShares}-for-${s.oldShares}` + (s.note ? ` · ${s.note}` : ''),
      fees: null,
      amount: null,
      inflow: false,
      voided: !!s.voided,
      correct: () => onCorrectSplit(s),
    });
  }
  return out.sort(
    (a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key),
  );
}

/**
 * Gold, savings plan and mutual fund purchases, sales, redemptions and dividends, in the same shape as the stock
 * entries so Activity shows everything in one list. Statement values are not transactions and are left out.
 */
export function buildAssetEntries(
  assets: { asset: Asset; portfolioName?: string }[],
  onOpenAssets: () => void,
): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const { asset, portfolioName } of assets) {
    const where = portfolioName ? ` · ${portfolioName}` : '';
    const key = (id: string) => `a${portfolioName ?? ''}${asset.id}${id}`;
    try {
      if (asset.kind === 'metal') {
        const gains = new Map(
          metalPosition(asset).history.map((h) => [h.id, h.realizedGain]),
        );
        for (const e of asset.entries) {
          out.push({
            key: key(e.id),
            date: e.date,
            ticker: asset.name,
            type: e.type,
            label:
              e.type === 'opening'
                ? 'Opening'
                : e.type === 'sell'
                  ? 'Sale'
                  : 'Purchase',
            detail: `${describePieces(e)}${e.form ? ` · ${e.form}` : ''}${where}`,
            fees: null,
            amount: e.amount,
            inflow: e.type === 'sell',
            voided: !!e.voided,
            assetKind: asset.metal === 'gold' ? 'Gold' : 'Silver',
            realizedGain:
              e.type === 'sell' ? (gains.get(e.id) ?? null) : undefined,
            correct: onOpenAssets,
          });
        }
      } else if (asset.kind === 'plan') {
        for (const e of asset.entries) {
          const paidIn = e.type === 'contribution';
          out.push({
            key: key(e.id),
            date: e.date,
            ticker: asset.name,
            type: paidIn ? 'buy' : 'sell',
            label: paidIn ? 'Paid in' : 'Redeemed',
            detail: `${paidIn ? 'Contribution to the plan' : 'Cash taken out of the plan'}${where}`,
            fees: null,
            amount: e.amount,
            inflow: !paidIn,
            voided: !!e.voided,
            assetKind: 'Plan',
            noGain: !paidIn,
            correct: onOpenAssets,
          });
        }
      } else {
        const gains = new Map(
          fundPosition(asset).history.map((h) => [h.id, h.realizedGain]),
        );
        for (const e of asset.entries) {
          const units =
            e.units === undefined
              ? ''
              : `${Math.round(e.units * 10000) / 10000} units`;
          out.push({
            key: key(e.id),
            date: e.date,
            ticker: asset.name,
            type:
              e.type === 'redeem'
                ? 'sell'
                : e.type === 'dividend' || e.type === 'reinvest'
                  ? 'dividend'
                  : e.type === 'opening'
                    ? 'opening'
                    : 'buy',
            label:
              e.type === 'opening'
                ? 'Opening'
                : e.type === 'redeem'
                  ? 'Redemption'
                  : e.type === 'dividend'
                    ? 'Dividend'
                    : e.type === 'reinvest'
                      ? 'Reinvested'
                      : 'Purchase',
            detail: `${units || 'Cash payout'}${e.type === 'reinvest' ? ' · dividend reinvested' : ''}${where}`,
            fees: null,
            amount: e.amount,
            inflow: e.type === 'redeem' || e.type === 'dividend',
            voided: !!e.voided,
            assetKind: 'Fund',
            realizedGain:
              e.type === 'redeem' ? (gains.get(e.id) ?? null) : undefined,
            correct: onOpenAssets,
          });
        }
      }
    } catch {
      // An asset with an invalid history is reported on its own card; skip it here rather than break Activity.
    }
  }
  return out;
}

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
            <span>Realized profit / loss</span>
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
                    {!e.voided ? (
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
