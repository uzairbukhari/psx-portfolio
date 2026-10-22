'use client';
// The order ticket: what to buy this month, in whole shares, with the money it costs and the money left over. It stays in
// view beside the shortlist. Recording the buys opens one review instead of one form per company.
import { Copy, RefreshCw } from 'lucide-react';
import { money } from '@/lib/portfolio';
import { explainSizing } from '@/lib/monthly-picks-allocation';
import type { EstimateSummary, MonthlyPickEstimate, MonthlyPicksResearch } from '@/lib/monthly-picks';

const swatch = (index: number) => `var(--cat-${(index % 7) + 1})`;
const whole = (n: number) => `Rs ${Math.round(n).toLocaleString('en-US')}`;

export default function PicksTicket({
  estimates, summary, result, feePct, leftOut, priceDate, canRecord, copied,
  onRecord, onCopy, onRefreshPrices, onManualPrice, onFeeChange,
}: {
  estimates: MonthlyPickEstimate[];
  summary: EstimateSummary;
  result: MonthlyPicksResearch | null;
  feePct: number;
  leftOut: string[];
  priceDate: string | null;
  canRecord: boolean;
  copied: boolean;
  onRecord: () => void;
  onCopy: () => void;
  onRefreshPrices: () => void;
  onManualPrice: (ticker: string) => void;
  onFeeChange: (fee: number) => void;
}) {
  const sizing = explainSizing(result?.sizing).filter((line) => !line.includes('is left out'));
  const recordable = estimates.filter((e) => (e.shares ?? 0) > 0).length;
  const fees = Math.max(0, summary.estimatedSpendPkr - estimates.reduce((sum, e) => sum + (e.shares ?? 0) * (e.price ?? 0), 0));
  return (
    <section className="mp2-card mp2-ticket" aria-label="Order ticket">
      <div className="mp2-head">
        <h3>Order ticket</h3>
        <button type="button" data-slot="plain" className="link-button" onClick={onRefreshPrices}>
          <RefreshCw size={13} /> {priceDate ? `Prices from ${priceDate}` : 'Refresh prices'}
        </button>
      </div>
      {!estimates.length ? (
        <p className="muted">
          {result ? 'No company scored high enough this month. Add more companies to your shortlist, or tick more of them.' : 'Tick the companies you would be happy to own and the ranking appears here.'}
        </p>
      ) : (
        <>
          <div className="mp2-alloc" aria-hidden="true">
            {estimates.map((pick, i) => <i key={pick.ticker} style={{ width: `${pick.allocationPct}%`, background: swatch(i) }} title={`${pick.ticker} ${pick.allocationPct}%`} />)}
          </div>
          <div>
            {estimates.map((pick, i) => (
              <div className="mp2-line" key={pick.ticker}>
                <span className="t">
                  <i className="mp2-sw" style={{ background: swatch(i) }} />
                  {pick.ticker}
                  {pick.shares !== null && <span className="muted"> · {pick.shares.toLocaleString()} shares</span>}
                </span>
                <b>{pick.estimatedSpend === null ? money(pick.allocationPkr) : whole(pick.estimatedSpend)}</b>
                <small>
                  {pick.price === null
                    ? (
                        <>
                          No price from the last 7 days.{' '}
                          <button type="button" data-slot="plain" className="link-button" onClick={() => onManualPrice(pick.ticker)}>Enter price</button>
                        </>
                      )
                    : `@ ${money(pick.price)} · ${pick.allocationPct}%`}
                </small>
                <small>{pick.extraShares ? `+${pick.extraShares} from leftover` : ''}</small>
              </div>
            ))}
          </div>
          <div className="mp2-totals">
            <span>Spend incl. fees</span>
            <b className="em">{summary.incomplete ? 'Incomplete' : whole(summary.estimatedSpendPkr)}</b>
            <span className="muted">Left as cash</span>
            <b>{summary.unspentPkr === null ? '—' : whole(summary.unspentPkr)}</b>
            {!summary.incomplete && (
              <>
                <span className="muted">
                  Fees{' '}
                  <input
                    className="mp2-fee" type="number" inputMode="decimal" min="0" max="10" step="0.01"
                    aria-label="Estimated fees in percent" value={Number.isFinite(feePct) ? feePct : ''}
                    onChange={(event) => onFeeChange(Number(event.target.value))}
                  />
                  % (saved)
                </span>
                <b>{whole(fees)}</b>
              </>
            )}
          </div>
        </>
      )}
      {summary.incomplete && (
        <p className="mp2-callout" role="status">
          Estimate incomplete: no recent price for {summary.missingPrices.join(', ')}. Refresh prices or enter one.
        </p>
      )}
      {leftOut.map((line) => <p className="mp2-callout ok" key={line}>{line}</p>)}
      {sizing.map((line) => <p className="mp2-note" key={line}>{line}</p>)}
      <div className="mp2-actions">
        <button type="button" disabled={!canRecord || !recordable} onClick={onRecord}>
          Record {recordable === 1 ? 'this buy' : `these ${recordable} buys`}
        </button>
        <button type="button" className="secondary" disabled={!recordable} onClick={onCopy}>
          <Copy size={14} /> {copied ? 'Copied' : 'Copy order list for my broker'}
        </button>
      </div>
      <p className="mp2-note">A data-based estimate, not a promise of returns or an order to trade. Nothing is recorded until you record it.</p>
    </section>
  );
}

/** The phone's bottom bar: the total and the one action. */
export function PicksDock({ spend, left, recordable, onRecord, disabled }: { spend: number | null; left: number | null; recordable: number; onRecord: () => void; disabled: boolean }) {
  if (!recordable) return null;
  return (
    <div className="mp2-dock">
      <span>
        <b>{spend === null ? 'Incomplete' : whole(spend)}</b>
        <small>{left === null ? '' : `${whole(left)} left as cash`}</small>
      </span>
      <button type="button" disabled={disabled} onClick={onRecord}>Record buys</button>
    </div>
  );
}
