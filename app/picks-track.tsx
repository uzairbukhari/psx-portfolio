'use client';
// "Your picks so far": the buys you recorded through Monthly Picks, set against the KSE-100 bought on the same days with the
// same money. It only shows what happened; it is not a forecast. The index closes are public data.
import { useEffect, useMemo, useState } from 'react';
import type { Portfolio } from '@/lib/portfolio';
import { picksTrack } from '@/lib/picks-track';
import type { PricePoint } from '@/lib/price-history';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthShort = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(2, 4)}`;
const whole = (n: number) => `Rs ${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`);

export default function PicksTrackCard({ portfolio, asOf }: { portfolio: Portfolio; asOf: string }) {
  const runs = portfolio.monthlyPicksRuns ?? [];
  const tagged = useMemo(() => portfolio.trades.some((t) => t.picksRunId && !t.voided), [portfolio.trades]);
  const [index, setIndex] = useState<PricePoint[] | null>(null);
  useEffect(() => {
    if (!tagged) return;
    let live = true;
    fetch('/api/price-history?ticker=KSE100')
      .then((r) => (r.ok ? (r.json() as Promise<{ eod?: PricePoint[] }>) : null))
      .then((body) => live && setIndex(body?.eod ?? []))
      .catch(() => live && setIndex([]));
    return () => { live = false; };
  }, [tagged]);
  const track = useMemo(
    () => (tagged && index ? picksTrack({ trades: portfolio.trades, runs, quotes: portfolio.quotes, index, asOf }) : null),
    [tagged, index, portfolio.trades, runs, portfolio.quotes, asOf],
  );
  if (!track?.months.length) return null;

  const headline = track.returnPct !== null && track.indexPct !== null
    ? `Across ${track.months.length === 1 ? 'your recorded month' : `your last ${track.months.length} recorded months`}, picks bought with ${whole(track.totalBoughtPkr)} are ${pct(track.returnPct)}; the KSE-100 bought on the same days is ${pct(track.indexPct)}.`
    : `${whole(track.totalBoughtPkr)} bought through Monthly Picks so far.`;
  return (
    <section className="mp2-card" aria-label="Your picks so far">
      <div className="mp2-head"><h3>Your picks so far</h3></div>
      <p className="mp2-note">{headline} A look back, not a promise.</p>
      <div className="mp-table-wrap">
        <table className="mp2-track">
          <thead>
            <tr><th>Month</th><th>Bought</th><th>Followed</th><th>Your buys</th><th>KSE-100</th></tr>
          </thead>
          <tbody>
            {track.months.map((m) => (
              <tr key={m.runId}>
                <td>{monthShort(m.month)}</td>
                <td>{whole(m.boughtPkr)}</td>
                <td>{m.followed.bought} of {m.followed.of}</td>
                <td>{pct(m.returnPct)}</td>
                <td>{pct(m.indexPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
