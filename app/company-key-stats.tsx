'use client';
// Key statistics card on the company page: two columns of label/value rows. Values come from public data only
// (live day quote, today's ticks, cached PSX company facts, payout announcements); a field with no data shows a dash.
import { useEffect, useMemo, useState } from 'react';
import type { PricePoint } from '@/lib/price-history';
import { pktDate } from '@/lib/price-history';
import { compactNumber, type CompanyStats } from '@/lib/company-stats';
import { readJson } from '@/lib/safe-json';

type Day = {
  high: number | null;
  low: number | null;
  volume: number | null;
  previousClose: number | null;
  price: number | null;
};

const rs = (n: number | null) =>
  n === null
    ? '—'
    : n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

export default function CompanyKeyStats({
  ticker,
  day,
  eod,
  intraday,
}: {
  ticker: string;
  day: Day | undefined;
  eod: PricePoint[];
  intraday: PricePoint[];
}) {
  const [loaded, setLoaded] = useState<{
    ticker: string;
    stats: CompanyStats | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/company-stats?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => {
        const body = (await readJson(r)) as { stats?: CompanyStats };
        if (live)
          setLoaded({ ticker, stats: r.ok ? (body.stats ?? null) : null });
      })
      .catch(() => {
        if (live) setLoaded({ ticker, stats: null });
      });
    return () => {
      live = false;
    };
  }, [ticker]);
  const stats = loaded?.ticker === ticker ? loaded.stats : null;

  // The first tick of the latest session is the opening print.
  const open = useMemo(() => {
    const first = intraday[0];
    const last = intraday.at(-1);
    return first && last && pktDate(first[0]) === pktDate(last[0])
      ? first[1]
      : null;
  }, [intraday]);
  // PSX's own 52-week range when scraped; otherwise the range of the last year's daily closes.
  const range = useMemo(() => {
    if (stats?.week52High != null && stats.week52Low != null)
      return { low: stats.week52Low, high: stats.week52High };
    const last = eod.at(-1);
    if (!last) return { low: null, high: null };
    const closes = eod
      .filter(([t]) => t >= last[0] - 365 * 86_400)
      .map(([, p]) => p);
    return closes.length
      ? { low: Math.min(...closes), high: Math.max(...closes) }
      : { low: null, high: null };
  }, [stats, eod]);
  const dps = stats?.dividendPerShare12m ?? null;
  const price = day?.price ?? null;
  const yieldPct = dps !== null && price ? (dps / price) * 100 : null;

  const left: [string, string][] = [
    ['Open', rs(open)],
    ["Day's high", rs(day?.high ?? null)],
    ["Day's low", rs(day?.low ?? null)],
    ['52 wk high', rs(range.high)],
    ['52 wk low', rs(range.low)],
  ];
  const right: [string, string][] = [
    ['Volume', compactNumber(day?.volume ?? null)],
    ['Market cap', compactNumber(stats?.marketCap ?? null)],
    ['PE ratio', stats?.peTtm != null ? stats.peTtm.toFixed(2) : '—'],
    ['Dividend yield', yieldPct === null ? '—' : `${yieldPct.toFixed(2)}%`],
    ['Prev. close', rs(day?.previousClose ?? null)],
  ];
  return (
    <section className="card company-keystats" aria-label="Key statistics">
      <span className="lbl">Key statistics</span>
      <div className="keystats-cols">
        {[left, right].map((col, i) => (
          <dl key={i}>
            {col.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </section>
  );
}
